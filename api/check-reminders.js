import { checkAndSendReminders } from '../scripts/check-reminders.js';

export default async function handler(req, res) {
  // Verify optional cron secret if configured for security
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await checkAndSendReminders();
    return res.status(200).json(result);
  } catch (error) {
    console.error('Reminder handler error:', error);
    return res.status(500).json({ error: error.message });
  }
}
