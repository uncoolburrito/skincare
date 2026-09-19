# Skin Streak ✨ (v3)

> A two-person shared skincare habit tracker tailored for irregular sleep schedules, featuring real authenticated roles (**Owner** and **Partner**), event-driven sleep-cycle logging, an adaptive Adapalene schedule, and instant WhatsApp accountability check-ins.

[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Supabase](https://img.shields.io/badge/Database-Supabase%20Postgres%20%26%20RLS-3ECF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com/)
[![Auth](https://img.shields.io/badge/Auth-Passwordless%20Magic%20Links-2B2E6B?style=flat-square)](#authentication--roles)
[![Design](https://img.shields.io/badge/Palette-Warm%20Parchment-E2A64B?style=flat-square)](#design-philosophy)
[![License](https://img.shields.io/badge/License-MIT-5B7D62?style=flat-square)](LICENSE)

---

## Why Skin Streak v3?

Traditional habit trackers make two fatal assumptions:
1. **Clock-time rigidity**: Assuming a fixed 24-hour cycle where "morning" is 8 AM and "night" is 10 PM. For shift workers, creative freelancers, or anyone with an irregular circadian rhythm, calendar-day resets create false misses or quietly break retinol ramp-up protocols.
2. **Unguessable links without access control**: Sharing a raw open URL means anyone with the link can edit the log, and there is no private, secure place to store your accountability partner's contact info.

**Skin Streak v3 solves both with a clean, role-authenticated architecture**:
- **Event-Driven Check-Ins**: Logged as **"After Sleep"** and **"Before Sleep"** whenever life happens, never inferred from the clock.
- **Two Real Authenticated Roles**:
  - **Owner**: Logs check-ins, sees everything, manages partner invites, updates private settings.
  - **Partner**: Read-only real-time accountability view. Cannot edit anything. Stored partner contact details are strictly hidden at the PostgreSQL database level.
- **Adaptive Adapalene Schedule**: Self-paces based on actual logged retinoid count, never elapsed calendar days. A forgotten night can never be silently counted as a scheduled rest night.
- **One-Tap Logging & WhatsApp Alerts**: Tapping a routine records the timestamp, updates the streak, and opens a pre-filled WhatsApp message to your partner in one gesture.

---

## Core Features

### 1. Event-Based Sleep-Cycle Logging (Owner Only)
- Two large tactile buttons (48px+ tap targets): **"After Sleep"** and **"Before Sleep"**.
- Tapping either one immediately:
  1. Records the exact timestamp into the current open cycle.
  2. Persists the cycle to Supabase.
  3. Opens a WhatsApp compose window (`wa.me`) to your accountability partner with a pre-filled message (*"After Sleep skincare done (8:14 PM). Cycle streak: 14 cycles."*).
- **Cycle-Filling Logic**:
  - A cycle consists of `{ after_sleep_at, before_sleep_at, adapalene }`.
  - The "open cycle" is the latest cycle missing at least one timestamp.
  - Check-in of type T fills the open cycle if T is missing; if T is already filled (or no open cycle exists), it starts a brand new cycle.
  - Repeated same-type check-ins correctly leave the previous cycle's other half permanently unfilled—a real, visible miss.
  - Mistake correction: Un-checking quietly clears that slot without sending a WhatsApp message.

### 2. Adaptive Adapalene Schedule (Self-Pacing)
- **Derived strictly from logged behavior**:
  - Looks up the most recent past cycle with `before_sleep_at` filled.
  - In Phase 1 (**Build-up**, `< 7` adapalene nights): Alternates Adapalene and Rest. If the last logged before-sleep was Adapalene, tonight is **REST**. If Rest, tonight is **ADAPALENE**.
  - **Lazy-Skip Protection**: Skipped cycles in between simply do not exist in this lookup—skipping a night can never be used to justify skipping the next real application.
  - In Phase 2 (**Building Nightly**, `7–20` adapalene nights): Always **ADAPALENE** (skip only on visible skin irritation).
  - In Phase 3 (**Maintenance**, `21+` adapalene nights): Long-term nightly application.
- **After Sleep Guide** is constant across all phases:  
  `Wash → Azelaic acid 10% → Moisturizer → Sunscreen`

### 3. Cycle-Based Streak Metrics
- **Complete Cycle**: Both `after_sleep_at` and `before_sleep_at` are filled.
- **Current Streak**: Consecutive complete cycles counting backward from the most recent. The current open cycle does not break the streak while still in progress.
- **Best Run (Longest Streak)**: Max consecutive complete cycles across your entire history.
- **Missed Cycles**: Incomplete past cycles where life got in the way.

### 4. 60-Cycle Timeline Strip
- Scrollable strip displaying the last ~60 cycles (oldest to newest).
- Each marker has a top and bottom half:
  - **Top (After Sleep)**: Done (gold), Missed (brick red), Pending (blank border).
  - **Bottom (Before Sleep)**: Adapalene (indigo), Intentional Rest (sage green), Missed (brick red), Pending (blank border).
- Interactive tap inspection reveals exact timestamps and routine mode for that cycle.

### 5. Adaptive Nudge Banner
- If an open cycle has had one half logged and more than `nudge_threshold_hours` (default 14h) have elapsed, an in-app banner reminds the Owner which routine is still pending.

### 6. Settings & Partner Management (Owner Only)
- Partner's display name and WhatsApp phone number.
- `nudge_threshold_hours` configuration.
- **Single-Use 7-Day Invites**: Generates cryptographically secure tokenized links (`#/join/<token>`).
- **Partner Access Revocation**: Instantly revoke partner access with one click.
- **Reset History**: In-app confirmation modal (no native dialogs) that resets cycles and restarts the phase at build-up.

---

## Algorithms & Behavioral Science Engineering

Beyond standard habit tracking, Skin Streak runs three distinct computational engines designed for irregular schedules:

### 1. Biological Progress Score (Dual Asymptotic Kinetics)
Unlike streak counters that drop to zero on an accidental miss, the **Progress Score** ($0–100$) models real-world epidermal cellular turnover, follicular desquamation, and retinoid receptor saturation:
- **Zero Database State**: Computed fresh on every render directly from chronological cycle history; never stored as a volatile running total.
- **Asymptotic Gain ($\tau_{\text{gain}} = 60\text{ days}$)**:
  $$\Delta P = g \cdot (100 - P), \quad g = 1 - e^{-1/60} \approx 0.01653$$
  Early adherence yields rapid initial gains; approaching steady-state requires prolonged consistency. Complete cycles earn full gain ($+g(100 - P)$); partial/orphaned cycles earn half ($+0.5g(100 - P)$).
- **Exponential Biological Decay ($\tau_{\text{decay}} = 58\text{ days}$)**:
  $$P(t) = P_0 \cdot e^{-\Delta t / 58}$$
  Models microcomedone reformation and desquamation slowdown during missed intervals.
- **Clinical Phase Bands**: Maps score to biological milestones (Receptor Upregulation `0–39`, Keratinization Normalization `40–74`, Therapeutic Clarity Peak `75–94`, Epidermal Equilibrium `95–100`) accompanied by abstract radiant geometric SVG motifs.

### 2. Research-Backed Miss-Prevention Engine
Engineered to reduce actual missed routines before they occur, backed by behavioral science:
- **Implementation Intentions (Gollwitzer 1999)**: Anchors routines to situational cues (*"right when my alarm rings"*, *"while morning coffee brews"*) rather than clock times, proven to boost follow-through 2–3x for irregular schedules.
- **Personal Risk Ring (JITAI / Nahum-Shani 2018)**: Just-in-Time Adaptive Intervention that computes the user's rolling median waking and sleeping gaps. A dynamic SVG ring shifts through 3 visual buffer zones:
  - **Healthy Buffer (Green)**: $< 70\%$ of typical personal gap elapsed.
  - **Approaching Window (Amber)**: $70\%–99\%$ elapsed.
  - **Past Typical Window (Red)**: $\ge 100\%$ elapsed, loss-framed against the current streak and score.
- **Bounded Streak Grace (Herman & Polivy 1975, 2010 Restraint Theory)**: Prevents the destructive *"What-the-Hell Effect"* (where one lapse causes complete habit abandonment). Allows at most **1 shielded miss per rolling 30 real days** on the motivational streak counter, while the biological Progress Score remains strictly unshielded and decays honestly.
- **Proactive Partner Escalation**: Auto-detects overdue routines past the personal gap (+2h buffer) with database deduplication (`partner_alerted_cycle_id`) to prevent duplicate pings.

### 3. PWA & Native Android Push Architecture
- **PWA Standalone Shell**: Web app manifest (`display: standalone`, `#FAF7F2`), adaptive maskable icon set, and service worker precaching for instant launch from the Android home screen.
- **Web Push & FCM Subscriptions**: Device tokens registered via PushManager and stored in Supabase `public.push_subscriptions` with strict owner-only RLS.
- **Partner-Initiated Nudge**: A `SECURITY DEFINER` stored procedure (`record_partner_nudge`) enforces a strict **1-hour atomic cooldown** on `trackers.last_partner_nudge_at` and dispatches native OS push notifications to the owner's devices without exposing contact info or device tokens to the partner.

---

## Authentication & Security

```text
               ┌───────────────────────────────┐
               │    Supabase Auth (Magic Links)│
               └──────────────┬────────────────┘
                              │
             ┌────────────────┴────────────────┐
             ▼                                 ▼
   ┌───────────────────┐             ┌───────────────────┐
   │    Owner Role     │             │   Partner Role    │
   │ Full Read & Write │             │  Read-Only Access │
   │ Controls Settings │             │   Phone Hidden    │
   └─────────┬─────────┘             └─────────┬─────────┘
             │                                 │
             ▼                                 ▼
   ┌─────────────────────────────────────────────────────┐
   │         PostgreSQL Row Level Security (RLS)         │
   │  - cycles: SELECT (all), INSERT/UPDATE/DELETE (owner)│
   │  - trackers: partner_phone masked via trackers_view │
   │  - partner_invites: owner-only                      │
   │  - redeem_partner_invite(): SECURITY DEFINER RPC    │
   └─────────────────────────────────────────────────────┘
```

1. **Passwordless Magic Links**: Both Owner and Partner authenticate via Supabase email magic links. No passwords to leak or hash.
2. **Zero Service-Role Key Exposure**: Invite redemption occurs via a PostgreSQL `SECURITY DEFINER` stored procedure (`redeem_partner_invite`). Tokens are single-use, 7-day expiring, and validated server-side.
3. **Database-Enforced Phone Privacy**: The Partner's phone number is masked to `NULL` for non-owners via PostgreSQL security definitions. Even a raw API query cannot leak the Owner's stored contact details.
4. **Row Level Security (RLS)**: Enforced directly on tables so any unauthorized write attempts by a Partner session are rejected by Postgres.

---

## Design Philosophy

The interface is built to be calm, editorial, and tactile—reminiscent of high-end skincare packaging:

| Token | Hex | Role |
| :--- | :--- | :--- |
| **Background** | `#F6EFE6` | Warm parchment canvas |
| **Panel** | `#FFFDF8` | Tactile card surfaces |
| **Ink** | `#2A2420` | High-contrast editorial typography |
| **After Sleep** | `#E2A64B` | Warm gold |
| **Before Sleep** | `#2B2E6B` | Deep indigo |
| **Intentional Rest** | `#5B7D62` | Sage green (barrier recovery success) |
| **Missed** | `#B45341` | Brick red (unfilled cycle half) |

**Typography**:
- **Fraunces** (Serif) — Expressive display typeface for streak counters and headers.
- **Sora** (Sans-Serif) — Geometric modern sans for buttons, metrics, and routine guides.

---

## Setup & Deployment

### 1. Database Setup (Supabase)
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) and open the **SQL Editor**.
2. Copy and paste the contents of [`supabase_schema.sql`](./supabase_schema.sql).
3. Click **Run**. This creates:
   - Tables: `trackers`, `cycles`, `partner_invites`, `tracker_partners`.
   - RLS policies and `trackers_view`.
   - `redeem_partner_invite` RPC function.
   - Realtime publication replication.

### 2. Environment Variables
Create a `.env` file (or set in Vercel / Netlify):
```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 3. Local Development
```bash
# Install dependencies
npm install

# Run automated logic tests
npm test

# Start local dev server
npm run dev
```

### 4. Deploying to Vercel
1. Push this repository to GitHub.
2. Import the repo in [Vercel](https://vercel.com/new).
3. Framework Preset: **Vite**.
4. Add environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Click **Deploy**.

---

## Project Structure

```text
skincare/
├── index.html              # HTML entry point with PWA meta & Google Fonts
├── supabase_schema.sql     # Schema, RLS policies, trackers_view & SECURITY DEFINER RPCs
├── vercel.json             # SPA routing rewrite & API endpoint passthrough
├── vite.config.js          # Vite build configuration
├── api/
│   ├── send-push.js        # Serverless FCM / Web Push dispatcher
│   └── send-partner-nudge.js # Partner nudge handler with JWT & rate-limit validation
├── public/
│   ├── manifest.json       # PWA manifest with gcm_sender_id & theme tokens
│   ├── sw.js               # Service worker: precache, push handler & notificationclick
│   └── icons/              # Standard & maskable icons (192, 512, badge-96)
├── src/
│   ├── main.js             # Application controller, routing, PWA prompt & views
│   ├── cycles.js           # Progress Score, JITAI Risk Ring, Adapalene & Grace algorithms
│   ├── push.js             # PushManager registration & FCM token acquisition
│   ├── auth.js             # Supabase Auth magic-link & invite token handler
│   ├── storage.js          # Role discovery, cycles CRUD, push sync & Realtime subscriptions
│   └── style.css           # Design tokens, Fraunces/Sora styling, Risk Ring & PWA cards
├── test/
│   └── cycles.test.js      # 10 comprehensive automated logic & algorithm test suites
└── scripts/
    └── check-reminders.js  # Scheduled hourly reminder script (Push + WhatsApp)
```

---

## License

MIT © [uncoolburrito](https://github.com/uncoolburrito)
