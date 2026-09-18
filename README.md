# Skin Streak ✨

> A minimal, real-time shared skincare habit tracker designed for two-person accountability.

[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20Realtime-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Design](https://img.shields.io/badge/Palette-Warm%20Parchment-E2A64B?style=flat-square)](#design-philosophy)
[![License](https://img.shields.io/badge/License-MIT-2B2E6B?style=flat-square)](LICENSE)

---

## Why Skin Streak?

Skincare consistency—especially when introducing powerful active ingredients like **Adapalene** or retinoids—is notoriously difficult to maintain alone. Most habit apps fail here because they are either bloated with generic features or require too many taps to log a simple daily routine.

**Skin Streak** strips away all friction:
- **No account sign-ups or passwords**: Accessible only via an unguessable private link shared between you and your accountability partner.
- **One-tap check-in**: Tapping a routine logs the exact timestamp, updates the streak, and opens a pre-filled WhatsApp update to your partner in a single gesture.
- **Contextual routine guidance**: Eliminates mental load by computing your exact retinoid ramp-up phase day-by-day.
- **Instant multi-device sync**: When you check off a routine, your partner's screen updates within milliseconds.

---

## Key Features

### 1. One-Tap AM/PM Check-In & WhatsApp Compose
- **Morning & Night targets**: Large, tactile buttons (48px+ tap targets) designed for quick mobile check-ins.
- **One-action logging**: Tapping a slot ON logs the exact timestamp (`amAt` / `pmAt`), persists data, and opens a WhatsApp compose window (`wa.me`) with a pre-formatted message (e.g., *"Morning skincare done (8:14 AM). Streak: 12 days."*).
- **Silent correction**: Tapping a slot back OFF quietly un-logs the routine without sending an alert.
- **Manual status nudge**: A dedicated button to nudge your partner before logging (*"Check-in: haven't done my routine yet today"*).

### 2. Day-by-Day Routine Guide
Active dermatological routines require progressive adaptation to avoid skin barrier irritation. Based on your `routineStartDate`, Skin Streak automatically calculates your current stage:
- **Morning**: Fixed everyday routine:  
  `Wash → Azelaic acid 10% → Moisturizer → Sunscreen`
- **Night**: Contextual guidance adapted to elapsed weeks:
  - **Weeks 1–2 (Build-up)**: Alternates Adapalene and rest nights every other day.
  - **Weeks 3–4 (Build-up)**: Nightly Adapalene (with sensitivity precautions).
  - **Week 5+ (Maintenance)**: Nightly standard routine.

### 3. Consistency Metrics & Streak Math
- **Current Streak**: Consecutive completed days (today in progress never breaks an active streak).
- **Longest Streak**: All-time personal best consecutive run.
- **Missed Days**: Past calendar days where routines were not completed.
- **Completion Rate**: Real-time percentage of tracked days successfully completed.

### 4. 12-Week Consistency Heatmap
- GitHub-contribution-style grid: 7 rows (Sunday-first) × 12 columns (84 days).
- Cell states: **Both Completed** (sage green), **AM Only** (gold), **Night Only** (indigo), **Missed** (brick red), and **Today Pending** (dashed border).
- Interactive tap inspection on both desktop and mobile to view exact AM/PM completion times.

### 5. Multi-Device Real-Time Sync
- Powered by **Supabase Realtime** (PostgreSQL Change Data Capture over WebSockets).
- Automatic offline fallback to `localStorage` and instant tab-to-tab sync via `BroadcastChannel`.

### 6. Privacy by Obscurity
- No multi-tenant user authentication or database tables tracking personal identities.
- The entire log is keyed to an unguessable 16-character token in the URL (`/t/<token>`), accessible only to the two people who possess the link.

---

## Design Philosophy

The interface was designed from the ground up to feel warm, calm, and tactile—avoiding generic SaaS dashboards and heavy drop shadows:

| Token | Hex | Role |
| :--- | :--- | :--- |
| **Background** | `#F6EFE6` | Warm parchment canvas |
| **Panel** | `#FFFDF8` | Soft card surfaces |
| **Ink** | `#2A2420` | High-contrast editorial typography |
| **Morning Accent** | `#E2A64B` | Warm gold |
| **Night Accent** | `#2B2E6B` | Deep indigo |
| **Success** | `#5B7D62` | Sage green for completed routines |
| **Missed** | `#B45341` | Brick red for past incomplete days |

**Typography**:
- **Fraunces** (Serif) — Expressive display typeface for streak counters and primary headings.
- **Sora** (Sans-Serif) — Clean, legible modern sans for interface controls and routine steps.

---

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES Modules), HTML5, Vanilla CSS
- **Build Tool**: [Vite](https://vitejs.dev/) (lightning-fast HMR and minimal static bundle)
- **Database & Sync**: [Supabase](https://supabase.com/) (PostgreSQL + Realtime WebSockets)
- **Deployment**: [Vercel](https://vercel.com/) / [Netlify](https://www.netlify.com/) (Static SPA)

---

## Project Structure

```text
skincare/
├── index.html              # Main HTML entry point with Google Fonts
├── supabase_schema.sql     # Database schema, RLS policies & Realtime publication
├── vercel.json             # SPA routing rewrite configuration
├── vite.config.js          # Vite build configuration
├── src/
│   ├── main.js             # Application controller & DOM rendering
│   ├── storage.js          # Dual-engine sync (Supabase Realtime + local cache)
│   ├── streak.js           # Core streak math, routine rules & WhatsApp templates
│   └── style.css           # Design tokens, responsive grid & tactile animations
├── scripts/
│   └── check-reminders.js  # Scheduled reminder script for CallMeBot WhatsApp nudges
└── test/
    └── streak.test.js      # Unit tests for streak calculations & routine phases
```

---

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/uncoolburrito/skincare.git
cd skincare
npm install
```

### 2. Environment Configuration

Copy the example environment file:
```bash
cp .env.example .env
```

Add your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

### 3. Database Setup (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the **SQL Editor** in your Supabase dashboard.
3. Paste and run the contents of [`supabase_schema.sql`](./supabase_schema.sql).
4. Copy your **Project URL** and **`anon` `public` key** from *Settings → API* into `.env`.

### 4. Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173/` in your browser.

---

## Deployment

Deploying Skin Streak is as simple as hosting any modern static Vite web app:

1. Import the repository into [Vercel](https://vercel.com) or [Netlify](https://www.netlify.com).
2. Configure your Environment Variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. Deploy! The application builds into a static bundle served via global CDN edge nodes with sub-second page loads.

---

## License

Distributed under the [MIT License](LICENSE). Built for personal accountability and consistency.
