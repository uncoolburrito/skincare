/**
 * Skin Streak — Server-side Push Notification Dispatcher
 * Sends real push notifications to Android PWA / Chrome devices via FCM / Web Push.
 */

export async function sendPushNotification(tokens = [], { title, body, icon = '/icons/icon-192.png', tag = 'skin-streak-nudge', data = { url: '/' } } = {}) {
  const fcmTokens = Array.isArray(tokens) ? tokens.filter(Boolean) : (tokens ? [tokens] : []);
  if (fcmTokens.length === 0) {
    return { sent: 0, failed: 0, reason: 'no_tokens' };
  }

  const serverKey = process.env.FCM_SERVER_KEY || process.env.FIREBASE_SERVER_KEY;
  if (!serverKey) {
    console.warn('[Push] FCM_SERVER_KEY not configured in environment. Logged push notification dispatch locally.');
    return { sent: 0, simulated: fcmTokens.length, reason: 'missing_fcm_server_key' };
  }

  let sent = 0;
  let failed = 0;

  for (const token of fcmTokens) {
    try {
      // Legacy FCM HTTP Protocol (works universally with FCM Web Push registration tokens)
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `key=${serverKey.trim()}`
        },
        body: JSON.stringify({
          to: token,
          notification: {
            title,
            body,
            icon,
            tag
          },
          data: {
            ...data,
            title,
            body,
            tag
          }
        })
      });

      if (res.ok) {
        sent++;
      } else {
        failed++;
        console.error('[Push] FCM dispatch failed with status:', res.status);
      }
    } catch (err) {
      failed++;
      console.error('[Push] FCM request exception:', err);
    }
  }

  return { sent, failed };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tokens, title, body, data } = req.body || {};
  const result = await sendPushNotification(tokens, { title, body, data });
  return res.status(200).json(result);
}
