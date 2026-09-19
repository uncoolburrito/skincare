/**
 * renasce — Partner-Initiated "Did you forget?" Nudge Endpoint
 * Verifies partner authorization, enforces hourly rate limit in Supabase,
 * and sends real FCM push notification to Owner's registered devices.
 */

import { createClient } from '@supabase/supabase-js';
import { sendPushNotification } from './send-push.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.replace('Bearer ', '').trim();
  const { tracker_id } = req.body || {};

  if (!tracker_id) {
    return res.status(400).json({ error: 'tracker_id is required' });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Supabase credentials missing on server' });
  }

  try {
    // Authenticate Supabase client using caller's JWT token
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    // Invoke SECURITY DEFINER function record_partner_nudge
    const { data, error } = await supabase.rpc('record_partner_nudge', {
      p_tracker_id: tracker_id
    });

    if (error) {
      console.error('[Partner Nudge] RPC error:', error);
      return res.status(500).json({ error: error.message });
    }

    if (!data || data.success === false) {
      const status = data?.cooldown_remaining_seconds ? 429 : 403;
      return res.status(status).json({
        error: data?.error || 'Nudge failed',
        cooldown_remaining_seconds: data?.cooldown_remaining_seconds,
        last_partner_nudge_at: data?.last_partner_nudge_at
      });
    }

    // Prepare push message
    const partnerName = data.partner_name || 'Your partner';
    const pendingSlot = data.pending_slot || 'routine';
    const pushTitle = 'renasce ✨';
    const pushBody = `${partnerName} thinks you might have forgotten your ${pendingSlot} routine.`;

    const pushResult = await sendPushNotification(data.fcm_tokens, {
      title: pushTitle,
      body: pushBody,
      icon: '/icons/icon-192.png',
      tag: 'partner-nudge',
      data: { url: '/', type: 'partner_nudge', tracker_id }
    });

    return res.status(200).json({
      success: true,
      nudged_at: data.nudged_at,
      partner_name: partnerName,
      pending_slot: pendingSlot,
      push_result: pushResult
    });
  } catch (err) {
    console.error('[Partner Nudge] Server error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
