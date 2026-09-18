/**
 * Skin Streak v3 — Automated Hourly Reminder Scheduled Job (Feature 8 / Stretch Goal)
 * Checks each tracker's open cycle; if a gap has exceeded nudgeThresholdHours,
 * sends one WhatsApp nudge via CallMeBot, tracking lastNudgedCycleId so it fires once per gap.
 */

import { createClient } from '@supabase/supabase-js';

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
    const { id, partner_phone, nudge_threshold_hours = 14, last_nudged_cycle_id } = tracker;
    const thresholdMs = (nudge_threshold_hours || 14) * 3600000;

    // Fetch latest cycle for this tracker
    const { data: cycles, error: cErr } = await supabase
      .from('cycles')
      .select('*')
      .eq('tracker_id', id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (cErr || !cycles || cycles.length === 0) {
      results.push({ id, status: 'no_cycles' });
      continue;
    }

    const openCycle = cycles[0];
    const isComplete = openCycle.after_sleep_at && openCycle.before_sleep_at;

    if (isComplete) {
      results.push({ id, status: 'cycle_complete' });
      continue;
    }

    // Check if already nudged for this cycle
    if (last_nudged_cycle_id === openCycle.id) {
      results.push({ id, status: 'already_nudged_for_this_cycle' });
      continue;
    }

    let gapExceeded = false;
    let reminderText = '';

    if (openCycle.after_sleep_at && !openCycle.before_sleep_at) {
      const elapsed = now - new Date(openCycle.after_sleep_at).getTime();
      if (elapsed >= thresholdMs) {
        gapExceeded = true;
        const hours = Math.floor(elapsed / 3600000);
        reminderText = `Skin Streak nudge ✨: It's been ${hours}h since the After Sleep check-in — Before Sleep routine is pending!`;
      }
    } else if (openCycle.before_sleep_at && !openCycle.after_sleep_at) {
      const elapsed = now - new Date(openCycle.before_sleep_at).getTime();
      if (elapsed >= thresholdMs) {
        gapExceeded = true;
        const hours = Math.floor(elapsed / 3600000);
        reminderText = `Skin Streak nudge 🌙: It's been ${hours}h since the Before Sleep check-in — After Sleep routine is pending!`;
      }
    }

    if (gapExceeded && partner_phone && CALLMEBOT_API_KEY) {
      console.log(`[Reminder] Nudging tracker ${id} to ${partner_phone}...`);
      const sent = await sendCallMeBotWhatsApp(partner_phone, CALLMEBOT_API_KEY, reminderText);
      if (sent) {
        // Track last_nudged_cycle_id so it fires once per gap, not hourly
        await supabase
          .from('trackers')
          .update({ last_nudged_cycle_id: openCycle.id })
          .eq('id', id);
        results.push({ id, status: 'nudged', cycle_id: openCycle.id });
      } else {
        results.push({ id, status: 'failed_to_send' });
      }
    } else {
      results.push({ id, status: gapExceeded ? 'missing_phone_or_key' : 'threshold_not_reached' });
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
