/**
 * renasce — Storage & Supabase Sync Engine
 * Handles role discovery (Owner vs Partner), normalized cycles CRUD,
 * Realtime WebSocket subscriptions, and partner invite management.
 */

import { supabase, redeemInvite, clearPendingInviteToken } from './auth.js';
import { handleCheckIn, handleUnCheckIn, computeTonightPlan } from './cycles.js';

export class StorageController {
  constructor() {
    this.user = null;
    this.tracker = null;
    this.role = 'unknown'; // 'owner' | 'partner'
    this.cycles = [];
    this.partner = null; // linked partner record if owner
    this.activeInvites = [];
    this.realtimeChannel = null;
    this.partnerPollInterval = null;
    this.visibilityHandler = null;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch (e) {
        console.error('[StorageController] Listener error:', e);
      }
    }
  }

  getState() {
    return {
      user: this.user,
      tracker: this.tracker,
      role: this.role,
      cycles: [...this.cycles],
      partner: this.partner,
      activeInvites: [...this.activeInvites]
    };
  }

  /**
   * Initializes the session, identifies the tracker & role,
   * handles pending invite token redemption if present,
   * and loads all cycles.
   */
  async init(user, pendingInviteToken = null) {
    this.user = user;
    if (!user) {
      this.role = 'unauthenticated';
      this.tracker = null;
      this.cycles = [];
      this.cleanupRealtime();
      this.notify();
      return;
    }

    // 1. If there is a pending invite token, attempt redemption first
    if (pendingInviteToken) {
      console.log('[StorageController] Attempting invite redemption...');
      try {
        const result = await redeemInvite(pendingInviteToken);
        if (result.success) {
          console.log('[StorageController] Successfully redeemed invite for tracker:', result.tracker_id);
          clearPendingInviteToken();
        } else {
          console.warn('[StorageController] Invite redemption notice:', result.error);
        }
      } catch (e) {
        console.error('[StorageController] Invite redemption exception:', e);
      }
    }

    // 2. Discover user's role and tracker
    await this.loadTrackerAndRole();

    // 3. If user has a tracker, load its cycles & partner data, and setup Realtime
    if (this.tracker) {
      await this.loadCycles();
      if (this.role === 'owner') {
        if (this.cycles.length === 0) {
          await this.autoMigrateLegacyLogs();
        }
        await this.loadPartnerData();
      }
      this.setupRealtime();
    }

    this.notify();
  }

  /**
   * Queries trackers_view to discover whether user is Owner or Partner
   */
  async loadTrackerAndRole() {
    // Check if user is owner of any tracker
    const { data: ownerTrackers, error: ownerErr } = await supabase
      .from('trackers')
      .select('*')
      .eq('owner_id', this.user.id)
      .limit(1);

    if (ownerErr) {
      console.warn('[StorageController] Error checking owner trackers:', ownerErr);
      if (ownerErr.code === 'PGRST205' || ownerErr.message?.includes('schema cache')) {
        this.tracker = null;
        this.role = 'needs_schema';
        return;
      }
    }

    if (ownerTrackers && ownerTrackers.length > 0) {
      this.tracker = ownerTrackers[0];
      this.role = 'owner';
      return;
    }

    // Check if user is partner of any tracker via tracker_partners
    const { data: partnerLinks, error: partnerErr } = await supabase
      .from('tracker_partners')
      .select('tracker_id, joined_at')
      .eq('partner_user_id', this.user.id)
      .limit(1);

    if (partnerErr) {
      console.warn('[StorageController] Error checking partner links:', partnerErr);
      if (partnerErr.code === 'PGRST205' || partnerErr.message?.includes('schema cache')) {
        this.tracker = null;
        this.role = 'needs_schema';
        return;
      }
    }

    if (partnerLinks && partnerLinks.length > 0) {
      const trackerId = partnerLinks[0].tracker_id;
      // Load tracker metadata via trackers_view (which securely hides partner_phone)
      const { data: viewData, error: viewErr } = await supabase
        .from('trackers_view')
        .select('*')
        .eq('id', trackerId)
        .single();

      if (!viewErr && viewData) {
        this.tracker = viewData;
        this.role = 'partner';
        return;
      }
    }

    // First-time login and not an invited partner -> Automatically create their tracker!
    console.log('[StorageController] First-time login: creating initial owner tracker...');
    const { data: newTracker, error: createErr } = await supabase
      .from('trackers')
      .insert({
        owner_id: this.user.id,
        partner_name: '',
        partner_phone: '',
        nudge_threshold_hours: 14
      })
      .select()
      .single();

    if (createErr) {
      console.error('[StorageController] Failed to create tracker for user:', createErr);
      this.tracker = null;
      if (createErr.code === 'PGRST205' || createErr.message?.includes('schema cache')) {
        this.role = 'needs_schema';
      } else {
        this.role = 'error';
      }
    } else {
      this.tracker = newTracker;
      this.role = 'owner';
    }
  }

  /**
   * Loads all cycles for the current tracker ordered oldest to newest
   */
  async loadCycles() {
    if (!this.tracker) return;

    const { data, error } = await supabase
      .from('cycles')
      .select('*')
      .eq('tracker_id', this.tracker.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[StorageController] Error loading cycles:', error);
      return;
    }

    this.cycles = data || [];
  }

  /**
   * Automatically migrates legacy check-in logs from skin_streak_logs into the new cycles table.
   * Note on `adapalene` values: PM entries from skin_streak_logs (id 'd5167ad2d258c91a',
   * specifically Sept 18 PM) have adapalene = true based on owner-verified night routine logs.
   */
  async autoMigrateLegacyLogs() {
    if (!this.tracker || this.role !== 'owner' || this.cycles.length > 0) return;

    try {
      console.log('[StorageController] Checking for legacy logs to migrate...');
      // Data origin: legacy single-row store with id 'd5167ad2d258c91a'
      const { data: legacy, error } = await supabase
        .from('skin_streak_logs')
        .select('*')
        .eq('id', 'd5167ad2d258c91a')
        .maybeSingle();

      if (!error && legacy && legacy.entries) {
        const entries = legacy.entries;
        const dates = Object.keys(entries).sort();
        const toInsert = [];

        const existingAfter = new Set(this.cycles.map(c => c.after_sleep_at).filter(Boolean));
        const existingBefore = new Set(this.cycles.map(c => c.before_sleep_at).filter(Boolean));

        for (const dStr of dates) {
          const e = entries[dStr];
          if (e.amAt && !e.pmAt && !existingAfter.has(e.amAt)) {
            toInsert.push({
              tracker_id: this.tracker.id,
              after_sleep_at: e.amAt,
              before_sleep_at: null,
              adapalene: null,
              created_at: e.amAt
            });
          } else if (!e.amAt && e.pmAt && !existingBefore.has(e.pmAt)) {
            toInsert.push({
              tracker_id: this.tracker.id,
              after_sleep_at: null,
              before_sleep_at: e.pmAt,
              adapalene: true,
              created_at: e.pmAt
            });
          } else if (e.amAt && e.pmAt && (!existingAfter.has(e.amAt) || !existingBefore.has(e.pmAt))) {
            toInsert.push({
              tracker_id: this.tracker.id,
              after_sleep_at: e.amAt,
              before_sleep_at: e.pmAt,
              adapalene: true,
              created_at: e.amAt
            });
          }
        }

        if (toInsert.length > 0) {
          console.log(`[StorageController] Migrating ${toInsert.length} legacy cycles...`);
          const { data: inserted, error: insertErr } = await supabase
            .from('cycles')
            .insert(toInsert)
            .select();

          if (!insertErr && inserted) {
            this.cycles = inserted.sort(
              (a, b) => new Date(a.created_at) - new Date(b.created_at)
            );
            this.notify();
          }
        }
      }
    } catch (err) {
      console.warn('[StorageController] Legacy auto-migration notice:', err);
    }
  }

  /**
   * Loads linked partner and active invites (Owner only)
   */
  async loadPartnerData() {
    if (!this.tracker || this.role !== 'owner') return;

    // Load linked partner
    const { data: partners, error: pErr } = await supabase
      .from('tracker_partners')
      .select('partner_user_id, joined_at')
      .eq('tracker_id', this.tracker.id);

    if (!pErr && partners && partners.length > 0) {
      this.partner = partners[0];
    } else {
      this.partner = null;
    }

    // Load active invites
    const { data: invites, error: iErr } = await supabase
      .from('partner_invites')
      .select('*')
      .eq('tracker_id', this.tracker.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });

    if (!iErr && invites) {
      this.activeInvites = invites;
    }
  }

  /**
   * Sets up Supabase Realtime WebSocket replication
   */
  setupRealtime() {
    this.cleanupRealtime();
    if (!this.tracker) return;

    const trackerId = this.tracker.id;
    this.realtimeChannel = supabase
      .channel(`realtime:tracker:${trackerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cycles', filter: `tracker_id=eq.${trackerId}` },
        payload => {
          this.handleRealtimeCycleChange(payload);
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trackers', filter: `id=eq.${trackerId}` },
        payload => {
          if (payload.eventType === 'UPDATE') {
            this.tracker = { ...this.tracker, ...payload.new };
            // Ensure partner_phone is kept hidden if partner
            if (this.role === 'partner') {
              this.tracker.partner_phone = null;
            }
            this.notify();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tracker_partners', filter: `tracker_id=eq.${trackerId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            if (this.role === 'partner' && payload.old.partner_user_id === this.user.id) {
              // Partner access was revoked by the Owner
              this.role = 'revoked';
              this.cycles = [];
              this.notify();
              return;
            }
            if (this.role === 'owner') {
              this.partner = null;
              this.notify();
            }
          } else if (payload.eventType === 'INSERT' && this.role === 'owner') {
            this.partner = payload.new;
            this.notify();
          }
        }
      )
      .subscribe(status => {
        console.log('[StorageController] Realtime status:', status);
      });

    // Partner fallback for settings changes (Fix 3):
    // Base table `trackers` SELECT is owner-only to protect `partner_phone`.
    // Since Supabase Realtime does not support postgres_changes on views (`trackers_view`),
    // partner client periodically polls and refreshes on visibility focus.
    if (this.role === 'partner') {
      this.partnerPollInterval = setInterval(() => {
        this.refetchTrackerSettings();
      }, 60000);

      this.visibilityHandler = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
          this.refetchTrackerSettings();
        }
      };
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
    }
  }

  /**
   * Refetches tracker settings from trackers_view for Partner view (Fix 3).
   * Keeps partner_name and nudge_threshold_hours fresh without exposing partner_phone.
   */
  async refetchTrackerSettings() {
    if (!this.tracker || this.role !== 'partner') return;
    try {
      const { data, error } = await supabase
        .from('trackers_view')
        .select('*')
        .eq('id', this.tracker.id)
        .maybeSingle();

      if (!error && data) {
        let changed = false;
        if (
          this.tracker.partner_name !== data.partner_name ||
          this.tracker.nudge_threshold_hours !== data.nudge_threshold_hours ||
          this.tracker.last_partner_nudge_at !== data.last_partner_nudge_at
        ) {
          changed = true;
        }
        this.tracker = { ...this.tracker, ...data, partner_phone: null };
        if (changed) {
          this.notify();
        }
      }
    } catch (e) {
      console.warn('[StorageController] Failed to refetch partner settings:', e);
    }
  }

  handleRealtimeCycleChange(payload) {
    if (payload.eventType === 'INSERT') {
      const exists = this.cycles.some(c => c.id === payload.new.id);
      if (!exists) {
        this.cycles = [...this.cycles, payload.new].sort(
          (a, b) => new Date(a.created_at) - new Date(b.created_at)
        );
        this.notify();
      }
    } else if (payload.eventType === 'UPDATE') {
      this.cycles = this.cycles.map(c => (c.id === payload.new.id ? payload.new : c));
      this.notify();
    } else if (payload.eventType === 'DELETE') {
      this.cycles = this.cycles.filter(c => c.id !== payload.old.id);
      this.notify();
    }

    // Whenever cycles are modified, also refresh settings if partner
    if (this.role === 'partner') {
      this.refetchTrackerSettings();
    }
  }

  cleanupRealtime() {
    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    if (this.partnerPollInterval) {
      clearInterval(this.partnerPollInterval);
      this.partnerPollInterval = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  // ===========================================================================
  // Owner Actions
  // ===========================================================================

  /**
   * Check in a slot ('afterSleep' | 'beforeSleep')
   */
  async checkIn(type) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can record check-ins.');
    }

    const timestamp = new Date().toISOString();
    const result = handleCheckIn(this.cycles, type, {
      tracker_id: this.tracker.id,
      timestamp
    });

    if (result.action === 'created') {
      // Optimistic update
      this.cycles = result.updatedCycles;
      this.notify();

      // Persist to Supabase
      const { data, error } = await supabase
        .from('cycles')
        .insert({
          tracker_id: this.tracker.id,
          after_sleep_at: result.cycle.after_sleep_at,
          before_sleep_at: result.cycle.before_sleep_at,
          adapalene: result.cycle.adapalene,
          created_at: timestamp
        })
        .select()
        .single();

      if (error) {
        console.error('[StorageController] Failed to insert cycle:', error);
        await this.loadCycles();
        this.notify();
        throw error;
      }

      // Replace temp id with real db id
      this.cycles = this.cycles.map(c => (c.id === result.cycle.id ? data : c));
      this.notify();
      return data;
    } else if (result.action === 'updated') {
      // Optimistic update
      this.cycles = result.updatedCycles;
      this.notify();

      const { data, error } = await supabase
        .from('cycles')
        .update({
          after_sleep_at: result.cycle.after_sleep_at,
          before_sleep_at: result.cycle.before_sleep_at,
          adapalene: result.cycle.adapalene
        })
        .eq('id', result.cycle.id)
        .select()
        .single();

      if (error) {
        console.error('[StorageController] Failed to update cycle:', error);
        await this.loadCycles();
        this.notify();
        throw error;
      }

      return data;
    }
  }

  /**
   * Un-check a slot to correct a mistake (no WhatsApp triggered)
   */
  async unCheckIn(type) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can edit check-ins.');
    }

    const result = handleUnCheckIn(this.cycles, type);
    this.cycles = result.updatedCycles;
    this.notify();

    const changed = result.changedCycle;
    if (!changed) return;

    if (changed.deleted) {
      const { error } = await supabase
        .from('cycles')
        .delete()
        .eq('id', changed.id);
      if (error) {
        console.error('[StorageController] Error deleting cycle:', error);
        await this.loadCycles();
        this.notify();
      }
    } else {
      const { error } = await supabase
        .from('cycles')
        .update({
          after_sleep_at: changed.after_sleep_at,
          before_sleep_at: changed.before_sleep_at,
          adapalene: changed.adapalene
        })
        .eq('id', changed.id);
      if (error) {
        console.error('[StorageController] Error updating cycle on uncheck:', error);
        await this.loadCycles();
        this.notify();
      }
    }
  }

  /**
   * Updates tracker settings
   */
  async updateSettings({ partner_name, partner_phone, nudge_threshold_hours, after_sleep_cue, before_sleep_cue }) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can update settings.');
    }

    const updates = {};
    if (partner_name !== undefined) updates.partner_name = partner_name;
    if (partner_phone !== undefined) updates.partner_phone = partner_phone;
    if (nudge_threshold_hours !== undefined) updates.nudge_threshold_hours = Number(nudge_threshold_hours);
    if (after_sleep_cue !== undefined) updates.after_sleep_cue = after_sleep_cue;
    if (before_sleep_cue !== undefined) updates.before_sleep_cue = before_sleep_cue;

    const { data, error } = await supabase
      .from('trackers')
      .update(updates)
      .eq('id', this.tracker.id)
      .select()
      .single();

    if (error) {
      console.error('[StorageController] Error updating tracker settings:', error);
      throw error;
    }

    this.tracker = data;
    this.notify();
    return data;
  }

  /**
   * Updates tracker routine configuration, titration schedule, tau parameters, and sources summary
   */
  async updateRoutineConfig({
    routine_config,
    has_titration_schedule,
    titration_phase_thresholds,
    progress_gain_tau_days,
    progress_decay_tau_days,
    sources_summary
  }) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can update routine configuration.');
    }

    const updates = {};
    if (routine_config !== undefined) {
      const mergedConfig = { ...routine_config };
      if (sources_summary !== undefined) {
        mergedConfig.sources_summary = sources_summary;
      }
      updates.routine_config = mergedConfig;
    }
    if (has_titration_schedule !== undefined) updates.has_titration_schedule = Boolean(has_titration_schedule);
    if (titration_phase_thresholds !== undefined) updates.titration_phase_thresholds = titration_phase_thresholds;
    if (progress_gain_tau_days !== undefined) updates.progress_gain_tau_days = Number(progress_gain_tau_days);
    if (progress_decay_tau_days !== undefined) updates.progress_decay_tau_days = Number(progress_decay_tau_days);
    if (sources_summary !== undefined) updates.sources_summary = sources_summary;

    let { data, error } = await supabase
      .from('trackers')
      .update(updates)
      .eq('id', this.tracker.id)
      .select()
      .single();

    // Graceful fallback if sources_summary column is not yet present on remote DB
    if (error && (error.code === '42703' || error.message?.includes('sources_summary'))) {
      console.warn('[StorageController] Column sources_summary not in schema, retrying without column...');
      const fallbackUpdates = { ...updates };
      delete fallbackUpdates.sources_summary;
      const res = await supabase
        .from('trackers')
        .update(fallbackUpdates)
        .eq('id', this.tracker.id)
        .select()
        .single();
      data = res.data;
      error = res.error;
    }

    if (error) {
      console.error('[StorageController] Error updating routine config:', error);
      throw error;
    }

    this.tracker = data;
    this.notify();
    return data;
  }

  /**
   * Applies streak grace to a missed cycle, appending to trackers.grace_log
   */
  async applyStreakGrace(cycleId) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can use streak grace.');
    }

    const now = new Date().toISOString();
    const currentLog = Array.isArray(this.tracker.grace_log) ? this.tracker.grace_log : [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
    const pruned = currentLog.filter(entry => {
      const t = new Date(typeof entry === 'string' ? entry : entry.timestamp).getTime();
      return !isNaN(t) && t >= thirtyDaysAgo;
    });

    const updatedLog = [...pruned, { timestamp: now, cycleId }];

    const { data, error } = await supabase
      .from('trackers')
      .update({ grace_log: updatedLog })
      .eq('id', this.tracker.id)
      .select()
      .single();

    if (error) {
      console.error('[StorageController] Error applying grace:', error);
      throw error;
    }

    this.tracker = data;
    this.notify();
    return data;
  }

  /**
   * Records that a proactive partner alert was dispatched for this cycle to avoid duplicate WhatsApp pings
   */
  async markPartnerAlerted(cycleId) {
    if (this.role !== 'owner' || !this.tracker) return;

    try {
      const { data, error } = await supabase
        .from('trackers')
        .update({ partner_alerted_cycle_id: cycleId })
        .eq('id', this.tracker.id)
        .select()
        .single();

      if (!error && data) {
        this.tracker = data;
        this.notify();
      }
    } catch (e) {
      console.warn('[StorageController] Failed to record partner alert dispatch:', e);
    }
  }

  /**
   * Generates a single-use 7-day invite token and returns the invite link
   */
  async createInvite() {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can create invite links.');
    }

    // Generate random 32-character hex token
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const token = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');

    const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();

    const { data, error } = await supabase
      .from('partner_invites')
      .insert({
        tracker_id: this.tracker.id,
        token,
        expires_at: expiresAt
      })
      .select()
      .single();

    if (error) {
      console.error('[StorageController] Error creating invite:', error);
      throw error;
    }

    this.activeInvites.unshift(data);
    this.notify();

    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/+$/, '');
    const inviteUrl = `${origin}${path}#/join/${token}`;
    return { token, expiresAt, inviteUrl };
  }

  /**
   * Revokes the current partner's access
   */
  async revokePartner() {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can revoke partner access.');
    }

    const { error } = await supabase
      .from('tracker_partners')
      .delete()
      .eq('tracker_id', this.tracker.id);

    if (error) {
      console.error('[StorageController] Error revoking partner:', error);
      throw error;
    }

    this.partner = null;
    this.notify();
  }

  /**
   * Resets all cycles for this tracker.
   * Clears streak, misses, and resets Adapalene phase to build-up (count 0).
   */
  async resetCycles() {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can reset cycle history.');
    }

    const { error } = await supabase
      .from('cycles')
      .delete()
      .eq('tracker_id', this.tracker.id);

    if (error) {
      console.error('[StorageController] Error resetting cycles:', error);
      throw error;
    }

    this.cycles = [];
    this.notify();
  }

  /**
   * Saves or updates a device push subscription token for the current user
   */
  async savePushSubscription(fcmToken) {
    if (!this.user || !fcmToken) return null;
    try {
      const { data, error } = await supabase
        .from('push_subscriptions')
        .upsert(
          { user_id: this.user.id, fcm_token: fcmToken },
          { onConflict: 'user_id, fcm_token' }
        )
        .select()
        .single();

      if (error) {
        console.warn('[StorageController] Error saving push subscription:', error);
      }
      return data;
    } catch (e) {
      console.warn('[StorageController] Exception saving push subscription:', e);
      return null;
    }
  }

  /**
   * Removes a device push subscription token
   */
  async removePushSubscription(fcmToken) {
    if (!this.user || !fcmToken) return;
    try {
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('user_id', this.user.id)
        .eq('fcm_token', fcmToken);
    } catch (e) {
      console.warn('[StorageController] Exception removing push subscription:', e);
    }
  }

  /**
   * Partner triggers a "did you forget?" nudge to the Owner
   */
  async sendPartnerNudge(trackerId) {
    if (!this.user || !trackerId) {
      throw new Error('You must be logged in to send a nudge.');
    }

    const sessionRes = await supabase.auth.getSession();
    const token = sessionRes.data.session?.access_token;

    // 1. Try serverless endpoint first
    try {
      const res = await fetch('/api/send-partner-nudge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ tracker_id: trackerId })
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Nudge request failed');
      }

      if (this.tracker) {
        this.tracker.last_partner_nudge_at = json.nudged_at || new Date().toISOString();
        this.notify();
      }
      return json;
    } catch (apiErr) {
      console.warn('[StorageController] Serverless API unavailable or failed, falling back to direct RPC:', apiErr);

      // 2. Direct fallback to Supabase stored procedure
      const { data, error } = await supabase.rpc('record_partner_nudge', {
        p_tracker_id: trackerId
      });

      if (error) throw error;
      if (!data || data.success === false) {
        throw new Error(data?.error || 'Nudge request failed');
      }

      if (this.tracker) {
        this.tracker.last_partner_nudge_at = data.nudged_at || new Date().toISOString();
        this.notify();
      }
      return data;
    }
  }
}
