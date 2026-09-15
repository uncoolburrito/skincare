# Skin Streak ✨

A private, shared two-person skincare habit tracker built for accountability. One user logs daily morning and night routines; an accountability partner sees the exact same log in real time and receives automatic WhatsApp check-in updates.

![Skin Streak Preview](https://img.shields.io/badge/Designed%20for-Accountability-E2A64B?style=for-the-badge)
![Supabase Realtime](https://img.shields.io/badge/Database-Supabase%20Realtime-5B7D62?style=for-the-badge)
![Deployment](https://img.shields.io/badge/Deploy-Vercel%20%7C%20Netlify-2B2E6B?style=for-the-badge)

---

## Features

- **One-Tap AM/PM Check-In**: Tapping a routine ON marks the slot done with an exact timestamp, persists the log, and automatically deep-links to WhatsApp with a pre-filled update for your friend.
- **Silent Un-logging**: Tapping a slot OFF silently un-logs without triggering any WhatsApp notification.
- **Contextual Adapalene Routine Guide**: Eliminates guesswork by computing weeks elapsed since `routineStartDate`:
  - **Morning**: Constant: *Wash → Azelaic acid 10% → Moisturizer → Sunscreen*
  - **Weeks 1–2**: Alternates adapalene and rest nights every other day
  - **Weeks 3–4**: Nightly adapalene (with irritation warnings)
  - **Week 5+**: Nightly maintenance routine
- **Streak & Consistency Metrics**:
  - **Current Streak**: Consecutive completed days (today in progress never breaks streak).
  - **Longest Streak**: Historical best consecutive run.
  - **Missed Days**: Past calendar days where routines weren't finished.
- **12-Week Heatmap**: GitHub-contribution-style grid (Sunday-first, 7 rows × 12 columns). Clicking/tapping any cell displays full date details and AM/PM timestamps.
- **Multi-Device Realtime Sync**: Powered by Supabase Realtime (PostgreSQL CDC over WebSockets) with automatic fallback to `localStorage` and `BroadcastChannel`.
- **In-App Reset Flow**: Native confirmation dialogs (no `alert()` or `confirm()`) that cleanly wipes past data and resets the cycle to Day 1.
- **Stretch Goal: Automated Reminders**: Optional webhook support via CallMeBot for scheduled WhatsApp nudges.

---

## Getting Started Locally

```bash
# 1. Clone the repository
git clone git@github.com:uncoolburrito/skincare.git
cd skincare

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```

Visit `http://localhost:5173/` in your browser.

---

## Multi-Device Cloud Sync Setup (Supabase)

To sync in real time across different phones/laptops:

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to the **SQL Editor** in your Supabase dashboard and run the contents of [`supabase_schema.sql`](./supabase_schema.sql).
3. Copy your **Project URL** and **anon public key** from *Project Settings → API*.
4. Open Skin Streak in your browser, tap **Settings**, scroll down to **Cloud Sync (Supabase)**, paste both keys, and tap **Save all settings**.
5. Once saved, both devices on the same link will receive instant live updates whenever either routine is checked off!

---

## Obscurity-Based Privacy (Unguessable Link)

Skin Streak generates an unguessable 16-character hex token in the URL:
```
https://your-domain.com/#/t/3f9a7c1e82b4501a
```
Tap **Share link** in the top header to copy the URL and send it to your friend. Anyone with this link shares the exact same log and real-time state.

---

## Deployment

### Vercel (Recommended)
1. Push this repository to your GitHub account (`uncoolburrito/skincare-streak`).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repository.
3. Framework Preset: **Vite** (Build command: `npm run build`, Output directory: `dist`).
4. (Optional) Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Click **Deploy**.

---

## License

MIT License. Personal accountability tool.
