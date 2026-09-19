/**
 * renasce — Automated Hourly Reminder Scheduled Job (Feature 8 / Stretch Goal)
 * Checks each tracker's open cycle; if a gap has exceeded nudgeThresholdHours,
 * sends one WhatsApp nudge via CallMeBot, tracking lastNudgedCycleId so it fires once per gap.
 */

import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from '../api/send-push.js';
import { computePersonalGaps } from '../src/cycles.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
const CALLMEBOT_API_KEY = process.env.VITE_CALLMEBOT_API_KEY || process.env.CALLMEBOT_API_KEY;

async function sendCallMeBotWhatsApp(phone, apiKey, message) {
  if (!phone || !apiKey) {
    console.log('[Reminder] Phone or CallMeBot API key missing. Skipping notification.');
    return false;
  }
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${apiKey.trim()}`;

  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`[Reminder] Successfully sent notification to ${cleanPhone}`);
      return true;
    } else {
      console.error(`[Reminder] CallMeBot error HTTP ${res.status}`);
      return false;
    }
  } catch (err) {
    console.error('[Reminder] CallMeBot fetch exception:', err);
    return false;
  }
}

export async function checkAndSendReminders() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Reminder] Supabase credentials not found in environment.');
    return { success: false, reason: 'missing_supabase_credentials' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Fetch all trackers
  const { data: trackers, error: tErr } = await supabase.from('trackers').select('*');
  if (tErr) {
    console.error('[Reminder] Error fetching trackers:', tErr);
    return { success: false, error: tErr };
  }

  if (!trackers || trackers.length === 0) {
    console.log('[Reminder] No trackers found.');
    return { success: true, processed: 0 };
  }

  const now = Date.now();
  const results = [];

  for (const tracker of trackers) {
    const {
      id,
      owner_id,
      partner_phone,
      nudge_threshold_hours = 14,
      last_nudged_cycle_id,
      partner_alerted_cycle_id
    } = tracker;

    // Fetch cycles for this tracker to compute both open cycle and personal rhythm
    const { data: cycles, error: cErr } = await supabase
      .from('cycles')
      .select('*')
      .eq('tracker_id', id)
      .order('created_at', { ascending: true });

    if (cErr || !cycles || cycles.length === 0) {
      results.push({ id, status: 'no_cycles' });
      continue;
    }

    const openCycle = cycles[cycles.length - 1];
    const isComplete = openCycle.after_sleep_at && openCycle.before_sleep_at;

    if (isComplete) {
      results.push({ id, status: 'cycle_complete' });
      continue;
    }

    // Dedup guard: Check if already nudged or alerted for this open cycle
    if (last_nudged_cycle_id === openCycle.id || partner_alerted_cycle_id === openCycle.id) {
      results.push({ id, status: 'already_alerted_for_this_cycle', cycle_id: openCycle.id });
      continue;
    }

    // Model individual personalized rhythm
    const gaps = computePersonalGaps(cycles);
    let gapExceeded = false;
    let reminderText = '';

    if (openCycle.after_sleep_at && !openCycle.before_sleep_at) {
      const elapsed = now - new Date(openCycle.after_sleep_at).getTime();
      const elapsedHours = elapsed / 3600000;
      // Proactive red-zone threshold: personalized waking gap + 2h safety buffer (capped by nudge_threshold_hours)
      const typicalHours = gaps.typicalWakingGapHours;
      const redZoneThresholdHours = Math.min(nudge_threshold_hours || 14, typicalHours + 2);
      const thresholdMs = redZoneThresholdHours * 3600000;

      if (elapsed >= thresholdMs) {
        gapExceeded = true;
        const hours = Math.floor(elapsedHours);
        reminderText = `renasce nudge ✨: It's been ${hours}h since the After Sleep check-in — Before Sleep routine is pending!`;
      }
    } else if (openCycle.before_sleep_at && !openCycle.after_sleep_at) {
      const elapsed = now - new Date(openCycle.before_sleep_at).getTime();
      const elapsedHours = elapsed / 3600000;
      // Proactive red-zone threshold: personalized sleeping gap + 2h safety buffer (capped by nudge_threshold_hours)
      const typicalHours = gaps.typicalSleepingGapHours;
      const redZoneThresholdHours = Math.min(nudge_threshold_hours || 14, typicalHours + 2);
      const thresholdMs = redZoneThresholdHours * 3600000;

      if (elapsed >= thresholdMs) {
        gapExceeded = true;
        const hours = Math.floor(elapsedHours);
        reminderText = `renasce nudge 🌙: It's been ${hours}h since the Before Sleep check-in — After Sleep routine is pending!`;
      }
    }

    if (gapExceeded) {
      let sentAny = false;

      // 1. Send push notification directly to owner's registered devices
      if (owner_id) {
        try {
          const { data: pushSubs } = await supabase
            .from('push_subscriptions')
            .select('fcm_token')
            .eq('user_id', owner_id);

          const tokens = (pushSubs || []).map(s => s.fcm_token).filter(Boolean);
          if (tokens.length > 0) {
            console.log(`[Reminder] Dispatching push notification to ${tokens.length} device(s) for owner ${owner_id}...`);
            const pushRes = await sendPushNotification(tokens, {
              title: 'renasce Reminder ✨',
              body: reminderText,
              tag: `reminder-${openCycle.id}`,
              data: { url: '/', cycleId: openCycle.id }
            });
            if (pushRes && (pushRes.sent > 0 || pushRes.simulated > 0)) {
              sentAny = true;
            }
          }
        } catch (pushErr) {
          console.error('[Reminder] Push notification dispatch error:', pushErr);
        }
      }

      // 2. Send WhatsApp notification to partner (if configured)
      if (partner_phone && CALLMEBOT_API_KEY) {
        console.log(`[Reminder] Nudging tracker ${id} to partner ${partner_phone}...`);
        const sent = await sendCallMeBotWhatsApp(partner_phone, CALLMEBOT_API_KEY, reminderText);
        if (sent) {
          sentAny = true;
        }
      }

      if (sentAny) {
        // Track both last_nudged_cycle_id and partner_alerted_cycle_id so it fires once per open cycle
        await supabase
          .from('trackers')
          .update({
            last_nudged_cycle_id: openCycle.id,
            partner_alerted_cycle_id: openCycle.id
          })
          .eq('id', id);
        results.push({ id, status: 'nudged', cycle_id: openCycle.id });
      } else {
        results.push({ id, status: (!partner_phone && !owner_id) ? 'missing_recipients' : 'failed_to_send' });
      }
    } else {
      results.push({ id, status: 'threshold_not_reached' });
    }
  }

  return { success: true, results };
}

if (process.argv[1] && process.argv[1].endsWith('check-reminders.js')) {
  checkAndSendReminders().then(res => {
    console.log('[Reminder Job Finished]:', JSON.stringify(res, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('[Reminder Job Fatal Error]:', err);
    process.exit(1);
  });
}
