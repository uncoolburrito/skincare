/**
 * Skin Streak — Automated Reminder Scheduled Job (Feature 7 / Stretch Goal)
 * Checks Supabase for uncompleted AM/PM check-ins and fires WhatsApp nudges via CallMeBot.
 * Can be run via:
 * 1. GitHub Actions scheduled workflow (.github/workflows/reminder.yml)
 * 2. Vercel Cron Job (/api/check-reminders)
 * 3. Node CLI: node scripts/check-reminders.js
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const CALLMEBOT_PHONE = process.env.VITE_CALLMEBOT_PHONE || process.env.CALLMEBOT_PHONE;
const CALLMEBOT_API_KEY = process.env.VITE_CALLMEBOT_API_KEY || process.env.CALLMEBOT_API_KEY;

function getTodayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentTimeHHMM() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

async function sendCallMeBotWhatsApp(phone, apiKey, message) {
  if (!phone || !apiKey) {
    console.log('[Reminder] CallMeBot phone or API key missing. Skipping message.');
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
      console.error(`[Reminder] CallMeBot responded with status: ${res.status}`);
      return false;
    }
  } catch (err) {
    console.error('[Reminder] CallMeBot fetch error:', err);
    return false;
  }
}

export async function checkAndSendReminders() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[Reminder] Supabase credentials not configured in environment.');
    return { success: false, reason: 'missing_supabase_env' };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const today = getTodayStr();
  const currentTime = getCurrentTimeHHMM();

  console.log(`[Reminder Check] Date: ${today}, Time: ${currentTime}`);

  const { data: logs, error } = await supabase.from('skin_streak_logs').select('*');
  if (error) {
    console.error('[Reminder] Error fetching logs from Supabase:', error);
    return { success: false, error };
  }

  if (!logs || logs.length === 0) {
    console.log('[Reminder] No tracker records found in Supabase.');
    return { success: true, processed: 0 };
  }

  const results = [];

  for (const record of logs) {
    const { id, entries = {}, settings = {} } = record;
    const todayEntry = entries[today] || { am: false, pm: false };
    const amTime = settings.amTime || '08:00';
    const pmTime = settings.pmTime || '22:00';
    const phone = CALLMEBOT_PHONE || settings.callMeBotPhone || settings.friendPhone;
    const apiKey = CALLMEBOT_API_KEY || settings.callMeBotApiKey;

    let reminderNeeded = false;
    let reminderText = '';

    // Check Morning slot: current time is past amTime, before pmTime, and AM is not logged yet
    if (currentTime >= amTime && currentTime < pmTime && !todayEntry.am) {
      if (!todayEntry.amReminderSent) {
        reminderNeeded = true;
        reminderText = `Friendly reminder from Skin Streak ✨: Morning skincare is still pending for today (${today}). Don't forget your SPF!`;
        todayEntry.amReminderSent = true;
      }
    }

    // Check Night slot: current time is past pmTime and PM is not logged yet
    if (currentTime >= pmTime && !todayEntry.pm) {
      if (!todayEntry.pmReminderSent) {
        reminderNeeded = true;
        reminderText = `Friendly reminder from Skin Streak 🌙: Night skincare is not logged yet for today (${today}). Protect your streak!`;
        todayEntry.pmReminderSent = true;
      }
    }

    if (reminderNeeded && phone && apiKey) {
      console.log(`[Reminder] Triggering notification for tracker ${id} to ${phone}`);
      const sent = await sendCallMeBotWhatsApp(phone, apiKey, reminderText);
      if (sent) {
        // Persist that the reminder was sent to avoid duplicate spamming today
        entries[today] = todayEntry;
        await supabase
          .from('skin_streak_logs')
          .update({ entries, updated_at: new Date().toISOString() })
          .eq('id', id);
        results.push({ id, status: 'sent', text: reminderText });
      } else {
        results.push({ id, status: 'failed_to_send' });
      }
    } else {
      results.push({ id, status: 'no_reminder_needed', amDone: !!todayEntry.am, pmDone: !!todayEntry.pm });
    }
  }

  return { success: true, results };
}

// If invoked directly from CLI: node scripts/check-reminders.js
if (process.argv[1] && process.argv[1].endsWith('check-reminders.js')) {
  checkAndSendReminders().then(res => {
    console.log('[Reminder Job Finished]:', JSON.stringify(res, null, 2));
    process.exit(0);
  }).catch(err => {
    console.error('[Reminder Job Fatal Error]:', err);
    process.exit(1);
  });
}
