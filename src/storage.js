/**
 * Skin Streak v3 — Storage & Supabase Sync Engine
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
      this.role = 'error';
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
  }

  cleanupRealtime() {
    if (this.realtimeChannel) {
      supabase.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
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
  async updateSettings({ partner_name, partner_phone, nudge_threshold_hours }) {
    if (this.role !== 'owner' || !this.tracker) {
      throw new Error('Only the tracker owner can update settings.');
    }

    const updates = {};
    if (partner_name !== undefined) updates.partner_name = partner_name;
    if (partner_phone !== undefined) updates.partner_phone = partner_phone;
    if (nudge_threshold_hours !== undefined) updates.nudge_threshold_hours = Number(nudge_threshold_hours);

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
}
