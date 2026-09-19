/**
 * Skin Streak v3 — Main Application Controller
 * Handles Supabase magic-link auth flow, Owner vs Partner role rendering,
 * one-tap check-in with instant WhatsApp notification, adaptive adapalene guide,
 * 60-cycle timeline strip, and settings modal with in-app confirmations.
 */

import {
  sendMagicLink,
  signInWithPassword,
  signUpWithPassword,
  getCurrentUser,
  signOut,
  onAuthStateChange,
  extractInviteTokenFromUrl,
  clearPendingInviteToken
} from './auth.js';

import { StorageController } from './storage.js';

import {
  getOpenCycle,
  isCycleComplete,
  computeTonightPlan,
  computeAdapalenePhase,
  computeCycleStreak,
  computeLongestCycleStreak,
  computeMissedCycles,
  checkAdaptiveNudge,
  buildCycleTimeline,
  formatTime,
  formatDateTime,
  formatWhatsAppMessage,
  formatManualWhatsAppMessage,
  getAfterSleepGuide,
  computeProgressScore,
  getProgressMilestone,
  renderProgressMotif,
  computePersonalGaps,
  computeRiskRingState,
  getGraceEligibility,
  computeCycleStreakWithGrace,
  formatProactivePartnerAlert,
  canSendPartnerNudge,
  formatPartnerNudgeMessage
} from './cycles.js';

import {
  registerServiceWorker,
  getNotificationPermission,
  subscribeToPush,
  syncExistingPushSubscription
} from './push.js';

// Application State
const state = {
  user: null,
  loading: true,
  storage: new StorageController(),
  selectedCycleId: null,
  settingsOpen: false,
  confirmResetOpen: false,
  confirmRevokeOpen: false,
  magicLinkSentEmail: null,
  inviteLinkData: null,
  pendingInviteToken: null,
  authMode: 'password', // 'password' | 'magic'
  deferredInstallPrompt: null
};

const APP = document.getElementById('app');
const TOAST = document.getElementById('toast');
let toastTimer = null;

function showToast(msg) {
  if (!TOAST) return;
  if (toastTimer) clearTimeout(toastTimer);
  TOAST.textContent = msg;
  TOAST.classList.add('show');
  toastTimer = setTimeout(() => {
    TOAST.classList.remove('show');
  }, 2800);
}

function openWhatsApp(phone, message) {
  const clean = (phone || '').replace(/[^0-9]/g, '');
  if (!clean) {
    showToast("Add your partner's WhatsApp number in Settings to enable notifications");
    state.settingsOpen = true;
    render();
    return;
  }
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

// -----------------------------------------------------------------------------
// App Initialization
// -----------------------------------------------------------------------------
async function initApp() {
  state.pendingInviteToken = extractInviteTokenFromUrl();

  // Register PWA service worker
  registerServiceWorker();

  // Capture PWA install prompt for Android/Chrome
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    state.deferredInstallPrompt = e;
    render();
  });

  window.addEventListener('appinstalled', () => {
    state.deferredInstallPrompt = null;
    showToast('Skin Streak successfully installed!');
    render();
  });

  // Listen to auth state transitions
  onAuthStateChange(async (event, session) => {
    console.log('[App] Auth state change event:', event);
    const user = session ? session.user : null;
    state.user = user;

    if (user) {
      state.loading = true;
      render();
      await state.storage.init(user, state.pendingInviteToken);
      await syncExistingPushSubscription(state.storage);
      state.loading = false;
      render();
    } else {
      state.loading = false;
      render();
    }
  });

  // Initial user check
  const user = await getCurrentUser();
  state.user = user;
  if (user) {
    await state.storage.init(user, state.pendingInviteToken);
    await syncExistingPushSubscription(state.storage);
  }
  state.loading = false;

  // Subscribe to storage changes (realtime updates, DB mutations)
  state.storage.subscribe(() => {
    render();
  });

  // Listen to hash changes (e.g. user lands on #/join/<token>)
  window.addEventListener('hashchange', async () => {
    const token = extractInviteTokenFromUrl();
    if (token !== state.pendingInviteToken) {
      state.pendingInviteToken = token;
      if (state.user) {
        state.loading = true;
        render();
        await state.storage.init(state.user, token);
        state.loading = false;
      }
      render();
    }
  });

  render();
}

// -----------------------------------------------------------------------------
// Action Handlers
// -----------------------------------------------------------------------------

async function handleSendMagicLink(e) {
  e.preventDefault();
  const input = document.getElementById('authEmailInput');
  const email = input ? input.value.trim() : '';

  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.');
    return;
  }

  const btn = document.getElementById('btnSendMagic');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Sending link…';
  }

  try {
    await sendMagicLink(email);
    state.magicLinkSentEmail = email;
    render();
  } catch (err) {
    console.error('Magic link error:', err);
    showToast(err.message || 'Failed to send magic link.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Send Magic Link';
    }
  }
}

async function handlePasswordAuth(e, isSignUp = false) {
  e.preventDefault();
  const emailInput = document.getElementById('authEmailInput');
  const passInput = document.getElementById('authPasswordInput');

  const email = emailInput ? emailInput.value.trim() : '';
  const password = passInput ? passInput.value : '';

  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.');
    return;
  }
  if (!password) {
    showToast('Please enter your password.');
    return;
  }
  if (isSignUp && password.length < 6) {
    showToast('Password must be at least 6 characters.');
    return;
  }

  const btnId = isSignUp ? 'btnPasswordSignUp' : 'btnPasswordSignIn';
  const btn = document.getElementById(btnId);
  if (btn) {
    btn.disabled = true;
    btn.textContent = isSignUp ? 'Creating account…' : 'Signing in…';
  }

  try {
    if (isSignUp) {
      const data = await signUpWithPassword(email, password);
      showToast('Account created successfully! Signing in...');
      if (data.session) {
        state.user = data.session.user;
        await state.storage.init(data.session.user, state.pendingInviteToken);
        render();
      } else {
        // Auto-login after sign-up
        const signData = await signInWithPassword(email, password);
        state.user = signData.user;
        await state.storage.init(signData.user, state.pendingInviteToken);
        render();
      }
    } else {
      const data = await signInWithPassword(email, password);
      state.user = data.user;
      showToast('Signed in successfully!');
      await state.storage.init(data.user, state.pendingInviteToken);
      render();
    }
  } catch (err) {
    console.error('Password auth error:', err);
    showToast(err.message || 'Authentication failed.');
    if (btn) {
      btn.disabled = false;
      btn.textContent = isSignUp ? 'Create Account' : 'Sign In';
    }
  }
}

async function handleSignOut() {
  await signOut();
  state.user = null;
  state.magicLinkSentEmail = null;
  state.settingsOpen = false;
  state.confirmResetOpen = false;
  state.confirmRevokeOpen = false;
  render();
}

/**
 * Feature 1: One-tap check-in
 * Logs timestamp into current open cycle, saves to Supabase, and opens WhatsApp
 */
async function handleCheckInTap(type) {
  if (state.storage.role !== 'owner') return;

  const storageState = state.storage.getState();
  const tracker = storageState.tracker;
  const cycles = storageState.cycles;
  const tonightPlan = computeTonightPlan(cycles);

  try {
    // 1. Record and save to Supabase
    const savedCycle = await state.storage.checkIn(type);
    showToast(`${type === 'afterSleep' ? 'After Sleep' : 'Before Sleep'} check-in recorded!`);

    // 2. Open WhatsApp to Partner with pre-filled message (one tap does both)
    const newCycles = state.storage.getState().cycles;
    const streak = computeCycleStreak(newCycles);
    const message = formatWhatsAppMessage(type, savedCycle, streak, tonightPlan);

    const partnerPhone = tracker?.partner_phone;
    if (partnerPhone) {
      openWhatsApp(partnerPhone, message);
    } else {
      showToast("Check-in logged! (Add partner's WhatsApp number in Settings to notify them)");
    }
  } catch (err) {
    console.error('Check-in error:', err);
    showToast('Failed to save check-in. Please try again.');
  }
}

async function handleUnCheckInTap(type) {
  if (state.storage.role !== 'owner') return;
  try {
    await state.storage.unCheckIn(type);
    showToast('Check-in un-checked.');
  } catch (err) {
    console.error('Un-check error:', err);
    showToast('Failed to update.');
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const nameInput = document.getElementById('inPartnerName');
  const phoneInput = document.getElementById('inPartnerPhone');
  const nudgeInput = document.getElementById('inNudgeThreshold');
  const afterCueInput = document.getElementById('inAfterSleepCue');
  const beforeCueInput = document.getElementById('inBeforeSleepCue');

  const partner_name = nameInput ? nameInput.value.trim() : '';
  const partner_phone = phoneInput ? phoneInput.value.trim() : '';
  const nudge_threshold_hours = nudgeInput ? Number(nudgeInput.value) || 14 : 14;
  const after_sleep_cue = afterCueInput ? afterCueInput.value.trim() : '';
  const before_sleep_cue = beforeCueInput ? beforeCueInput.value.trim() : '';

  try {
    await state.storage.updateSettings({
      partner_name,
      partner_phone,
      nudge_threshold_hours,
      after_sleep_cue,
      before_sleep_cue
    });
    showToast('Settings saved successfully!');
    state.settingsOpen = false;
    render();
  } catch (err) {
    showToast('Failed to save settings.');
  }
}

async function handleGenerateInvite() {
  try {
    const invite = await state.storage.createInvite();
    state.inviteLinkData = invite;
    render();
    showToast('Invite link generated! Valid for 7 days.');
  } catch (err) {
    showToast('Failed to generate invite link.');
  }
}

async function handleCopyInviteLink(url) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const temp = document.createElement('input');
      temp.value = url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    showToast('Invite link copied to clipboard!');
  } catch (e) {
    showToast('URL: ' + url);
  }
}

async function handleRevokePartner() {
  try {
    await state.storage.revokePartner();
    state.confirmRevokeOpen = false;
    showToast('Partner access has been revoked.');
    render();
  } catch (e) {
    showToast('Failed to revoke partner access.');
  }
}

async function handleResetCycles() {
  try {
    await state.storage.resetCycles();
    state.confirmResetOpen = false;
    state.settingsOpen = false;
    showToast('All cycle history reset! Phase restarted at Build-up.');
    render();
  } catch (e) {
    showToast('Failed to reset cycles.');
  }
}

// -----------------------------------------------------------------------------
// Render Methods
// -----------------------------------------------------------------------------

function render() {
  if (!APP) return;

  if (state.loading) {
    APP.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Loading your habit log…</div>
      </div>
    `;
    return;
  }

  // Not authenticated -> Render Auth Screen
  if (!state.user) {
    renderAuthScreen();
    return;
  }

  const storageState = state.storage.getState();

  // Revoked view
  if (storageState.role === 'revoked') {
    APP.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-icon">🔒</div>
        <h2 class="auth-title">Access Revoked</h2>
        <p class="auth-desc">Your partner access to this Skin Streak log has been removed by the owner.</p>
        <button class="btn-primary" id="btnSignOutRevoked" style="max-width: 200px; margin: 0 auto;">Sign Out</button>
      </div>
    `;
    document.getElementById('btnSignOutRevoked')?.addEventListener('click', handleSignOut);
    return;
  }

  // Schema setup required view
  if (storageState.role === 'needs_schema') {
    APP.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-icon">🗄️</div>
        <h2 class="auth-title">Database Setup Required</h2>
        <p class="auth-desc">Your Supabase project is connected, but the 4 required tables have not been created yet.</p>
        <div class="auth-card" style="text-align: left;">
          <div style="font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 8px;">
            One-Time Setup (takes 10 seconds):
          </div>
          <ol style="font-size: 13px; color: var(--ink-soft); padding-left: 20px; line-height: 1.6; margin-bottom: 16px;">
            <li>Open your <a href="https://supabase.com/dashboard/project/whekrgnecterjouoyxer/sql" target="_blank" rel="noreferrer" style="color: var(--ink); font-weight: 600; text-decoration: underline;">Supabase SQL Editor</a>.</li>
            <li>Click <strong>New query</strong>.</li>
            <li>Paste the contents of <code>supabase_schema.sql</code> and click <strong>Run</strong>.</li>
          </ol>
          <button class="btn-primary" id="btnRefreshAfterSchema">
            ✓ I've Run the SQL Schema (Reload)
          </button>
        </div>
        <button id="btnSignOutFromSetup" style="font-size: 12px; color: var(--ink-soft); margin-top: 20px; text-decoration: underline; cursor: pointer; background: none; border: none;">
          Sign Out
        </button>
      </div>
    `;
    document.getElementById('btnRefreshAfterSchema')?.addEventListener('click', () => {
      state.loading = true;
      render();
      state.storage.init(state.user, state.pendingInviteToken).then(() => {
        state.loading = false;
        render();
      });
    });
    document.getElementById('btnSignOutFromSetup')?.addEventListener('click', handleSignOut);
    return;
  }

  // Main App View (Owner or Partner)
  renderDashboard(storageState);
}

function renderAuthScreen() {
  const isInvite = !!state.pendingInviteToken;

  if (state.magicLinkSentEmail) {
    APP.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-icon">✨</div>
        <h1 class="auth-title">Check Your Email</h1>
        <p class="auth-desc">We sent a secure, passwordless magic link to:</p>
        <div class="auth-success-card">
          <div class="auth-success-title">Magic Link Sent</div>
          <div class="auth-success-msg">
            Click the link sent to <strong>${escapeHtml(state.magicLinkSentEmail)}</strong> to instantly sign in.
          </div>
        </div>
        <p style="font-size: 12px; color: var(--ink-soft); margin-top: 20px;">
          Didn't receive it? Check spam, or
          <button id="btnTryDifferentEmail" style="color: var(--ink); text-decoration: underline; font-weight: 600;">try another email</button>.
        </p>
      </div>
    `;
    document.getElementById('btnTryDifferentEmail')?.addEventListener('click', () => {
      state.magicLinkSentEmail = null;
      render();
    });
    return;
  }

  const isPassword = state.authMode === 'password';

  APP.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-icon">✨</div>
      <h1 class="auth-title">Skin Streak</h1>
      <p class="auth-desc">Shared two-person habit tracker for irregular sleep schedules.</p>

      ${isInvite ? `
        <div class="auth-invite-banner">
          <strong>Accountability Partner Invite</strong><br>
          You've been invited to view your friend's skincare log in real time. Enter your credentials below to connect!
        </div>
      ` : ''}

      <div class="auth-card">
        <div class="auth-tabs" style="display: flex; gap: 8px; margin-bottom: 18px; border-bottom: 1px solid var(--line); padding-bottom: 12px;">
          <button type="button" id="tabPassword" style="flex: 1; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; ${isPassword ? 'background: var(--ink); color: #fff; border: 1px solid var(--ink);' : 'background: var(--panel); color: var(--ink-soft); border: 1px solid var(--line);'}">
            🔑 Password
          </button>
          <button type="button" id="tabMagic" style="flex: 1; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; ${!isPassword ? 'background: var(--ink); color: #fff; border: 1px solid var(--ink);' : 'background: var(--panel); color: var(--ink-soft); border: 1px solid var(--line);'}">
            ✨ Magic Link
          </button>
        </div>

        ${isPassword ? `
          <form id="authPasswordForm">
            <div class="form-group">
              <label class="form-label" for="authEmailInput">Your Email</label>
              <input
                type="email"
                id="authEmailInput"
                class="form-input"
                placeholder="you@example.com"
                required
                autocomplete="email"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="authPasswordInput">Password</label>
              <input
                type="password"
                id="authPasswordInput"
                class="form-input"
                placeholder="••••••••"
                required
                autocomplete="current-password"
              />
            </div>
            <div style="display: flex; gap: 10px; margin-top: 8px;">
              <button type="submit" id="btnPasswordSignIn" class="btn-primary" style="flex: 1;">
                Sign In
              </button>
              <button type="button" id="btnPasswordSignUp" class="btn-secondary" style="flex: 1; padding: 13px; font-size: 14px;">
                Sign Up
              </button>
            </div>
            <p style="font-size: 11px; color: var(--ink-light); margin-top: 14px; text-align: center;">
              Instant sign in. No waiting for email verification or rate limits.
            </p>
          </form>
        ` : `
          <form id="authMagicForm">
            <div class="form-group">
              <label class="form-label" for="authEmailInput">Your Email Address</label>
              <input
                type="email"
                id="authEmailInput"
                class="form-input"
                placeholder="you@example.com"
                required
                autocomplete="email"
              />
            </div>
            <button type="submit" id="btnSendMagic" class="btn-primary">
              Send Magic Link
            </button>
            <p style="font-size: 11px; color: var(--ink-light); margin-top: 14px; text-align: center;">
              Passwordless & secure. Email magic link authentication.
            </p>
          </form>
        `}
      </div>
    </div>
  `;

  // Tab switchers
  document.getElementById('tabPassword')?.addEventListener('click', () => {
    state.authMode = 'password';
    render();
  });
  document.getElementById('tabMagic')?.addEventListener('click', () => {
    state.authMode = 'magic';
    render();
  });

  // Form handlers
  if (isPassword) {
    document.getElementById('authPasswordForm')?.addEventListener('submit', (e) => handlePasswordAuth(e, false));
    document.getElementById('btnPasswordSignUp')?.addEventListener('click', (e) => handlePasswordAuth(e, true));
  } else {
    document.getElementById('authMagicForm')?.addEventListener('submit', handleSendMagicLink);
  }
}

function renderDashboard(storageState) {
  const isOwner = storageState.role === 'owner';
  const isPartner = storageState.role === 'partner';
  const tracker = storageState.tracker;
  const cycles = storageState.cycles || [];

  // Metrics & JITAI Circadian Gaps
  const graceLog = tracker?.grace_log || [];
  const streakData = computeCycleStreakWithGrace(cycles, graceLog);
  const streak = streakData.streak;
  const graceApplied = streakData.graceApplied;
  const shieldedCycleId = streakData.shieldedCycleId;

  const longest = computeLongestCycleStreak(cycles);
  const missed = computeMissedCycles(cycles);
  const adapalenePhase = computeAdapalenePhase(cycles);
  const tonightPlan = computeTonightPlan(cycles);
  const progress = computeProgressScore(cycles);
  const openCycle = getOpenCycle(cycles);
  const personalGaps = computePersonalGaps(cycles);
  const riskRing = computeRiskRingState(cycles, personalGaps, streak, progress.score);
  const nudgeStatus = isPartner ? canSendPartnerNudge(tracker?.last_partner_nudge_at) : null;

  // Status of open cycle
  const afterLogged = !!(openCycle && openCycle.after_sleep_at);
  const beforeLogged = !!(openCycle && openCycle.before_sleep_at);

  // When Before Sleep is already logged, compute what was recommended prior to logging
  // and preview what is on deck for the NEXT cycle instead of displaying contradictory tags.
  let priorPlan = null;
  let nextPlan = tonightPlan;
  let followedRecommendation = true;
  if (beforeLogged) {
    const priorCycles = cycles.map(c => {
      if (c.id === openCycle.id) {
        return { ...c, before_sleep_at: null, adapalene: null };
      }
      return c;
    });
    priorPlan = computeTonightPlan(priorCycles);
    followedRecommendation = (openCycle.adapalene === priorPlan.useAdapalene);
  }

  const afterSleepGuide = getAfterSleepGuide();

  // Timeline (with grace-shielded cycle IDs)
  const timelineMarkers = buildCycleTimeline(cycles, 60, shieldedCycleId);
  const selectedCycle = state.selectedCycleId
    ? timelineMarkers.find(m => m.id === state.selectedCycleId)
    : null;

  APP.innerHTML = `
    <!-- Header -->
    <header>
      <div class="header-top">
        <div class="header-brand">
          <h1>Skin Streak</h1>
          <span class="role-badge ${isOwner ? 'owner' : 'partner'}">
            ${isOwner ? 'Owner' : 'Partner'}
          </span>
        </div>
        <div class="header-actions">
          <button class="btn-icon" id="btnOpenSettings" title="Settings" aria-label="Settings">
            ⚙️
          </button>
          <button class="btn-icon" id="btnSignOut" title="Sign Out" aria-label="Sign Out">
            🚪
          </button>
        </div>
      </div>
      <div class="header-subtitle">
        ${isOwner ? 'Your personal routine & accountability hub' : `Viewing ${escapeHtml(tracker?.partner_name || 'Owner')}'s habit log`}
      </div>
    </header>

    <!-- Partner View Read-Only Banner & Nudge Card -->
    ${isPartner ? `
      <div class="partner-view-banner">
        <span class="icon">👀</span>
        <div>
          <strong>Read-Only Accountability View</strong>
          You're tracking in real time. Changes made by the owner update automatically.
        </div>
      </div>

      <!-- Partner-Initiated "Did You Forget?" Nudge Card -->
      <div class="partner-nudge-card">
        <div class="partner-nudge-header">
          <div class="partner-nudge-icon">🔔</div>
          <div class="partner-nudge-text">
            <div class="partner-nudge-title">Accountability Nudge</div>
            <div class="partner-nudge-desc">
              Send an instant push notification to ${escapeHtml(tracker?.partner_name || 'Owner')}'s phone if you think they might have forgotten their routine.
            </div>
          </div>
        </div>
        <button
          class="btn-partner-nudge"
          id="btnSendPartnerNudge"
          ${nudgeStatus?.allowed ? '' : 'disabled'}
        >
          ${nudgeStatus?.allowed
            ? `💬 Nudge ${escapeHtml(tracker?.partner_name || 'Owner')} ("Did you forget?")`
            : `⏳ Nudge sent • Cooldown (${nudgeStatus?.remainingMinutes}m remaining)`
          }
        </button>
      </div>
    ` : ''}

    <!-- Risk Ring Banner (JITAI Adaptive Reminder & Loss-Framed Visual) -->
    <div class="risk-ring-banner zone-${riskRing.zone}">
      <div class="risk-ring-visual">
        <svg class="risk-ring-svg" viewBox="0 0 58 58">
          <circle class="risk-ring-bg" cx="29" cy="29" r="24" />
          <circle
            class="risk-ring-circle"
            cx="29"
            cy="29"
            r="24"
            stroke="${riskRing.color}"
            stroke-dasharray="150.8"
            stroke-dashoffset="${150.8 * (1 - riskRing.percentRemaining / 100)}"
          />
        </svg>
        <div class="risk-ring-center-icon">
          ${riskRing.zone === 'red' ? '⚠️' : (riskRing.zone === 'amber' ? '⏱️' : '⚡')}
        </div>
      </div>
      <div class="risk-ring-content">
        <div class="risk-ring-header">
          <span class="risk-ring-title">${escapeHtml(riskRing.pendingTitle)} Buffer</span>
          <span class="risk-ring-badge">${escapeHtml(riskRing.label)}</span>
        </div>
        <div class="risk-ring-msg">${escapeHtml(riskRing.lossFramedCopy)}</div>
        <div class="risk-ring-meta">
          ${riskRing.elapsedHours}h elapsed &bull; Typical rhythm: ~${Math.round(riskRing.typicalHours)}h &bull; ${riskRing.percentRemaining}% buffer
        </div>
        ${(isOwner && riskRing.zone === 'red' && tracker?.partner_phone) ? `
          ${tracker?.partner_alerted_cycle_id === openCycle?.id ? `
            <div style="font-size: 11px; color: var(--ink-soft); margin-top: 6px;">
              ✓ WhatsApp check-in sent to ${escapeHtml(tracker.partner_name || 'Partner')}
            </div>
          ` : `
            <button class="btn-proactive-whatsapp" id="btnProactiveAlert">
              📱 Ask ${escapeHtml(tracker.partner_name || 'Partner')} to check in
            </button>
          `}
        ` : ''}
      </div>
    </div>

    <!-- Streak Hero Card (Feature 3) -->
    <div class="hero-card">
      <div class="streak-display">
        <div class="streak-number">${streak}</div>
        <div class="streak-unit">
          ${streak === 1 ? 'Cycle Streak' : 'Cycles Streak'}
          ${graceApplied ? '<span class="grace-shield-pill" title="Protected by 30-day streak grace">🛡️ Grace Shield</span>' : ''}
        </div>
      </div>
      <div class="stats-grid">
        <div class="stat-item">
          <div class="stat-val">${longest}</div>
          <div class="stat-lbl">Best Run</div>
        </div>
        <div class="stat-item">
          <div class="stat-val">${missed}</div>
          <div class="stat-lbl">Missed</div>
        </div>
        <div class="stat-item">
          <div class="stat-val">${adapalenePhase.count}</div>
          <div class="stat-lbl">Adapalene</div>
        </div>
      </div>
    </div>

    <!-- Progress Score Card (Dermatological Cumulative Saturation) -->
    <div class="progress-card">
      <div class="progress-card-top">
        <div class="progress-header-info">
          <span class="progress-tag">Cumulative Retinoid Progress</span>
          <h3 class="progress-title">${escapeHtml(progress.milestone.label)}</h3>
        </div>
        <div class="progress-motif-wrap">
          ${renderProgressMotif(progress.score)}
        </div>
      </div>
      <div class="progress-main-row">
        <div class="progress-score-num">${progress.roundedScore}</div>
        <div class="progress-score-denom">/ 100</div>
        <span
          class="progress-milestone-badge"
          style="background: ${progress.milestone.softColor}; color: ${progress.milestone.color}; border: 1px solid ${progress.milestone.color}33;"
        >
          ● Band ${escapeHtml(progress.milestone.band)}
        </span>
      </div>
      <div class="progress-bar-track">
        <div
          class="progress-bar-fill"
          style="width: ${progress.score}%; background: ${progress.milestone.gradient};"
        ></div>
      </div>
      <div class="progress-card-footer">
        <strong>${escapeHtml(progress.milestone.phaseName)}:</strong>
        ${escapeHtml(progress.milestone.description)}
      </div>
    </div>

    <!-- Owner Check-In Targets (Feature 1) -->
    ${isOwner ? `
      <div class="checkin-section">
        <!-- After Sleep Card -->
        <div class="checkin-card after-sleep">
          <div class="checkin-main">
            <div class="checkin-info">
              <div class="checkin-tag">Event 1</div>
              <h2 class="checkin-title">After Sleep</h2>
              <div class="checkin-status ${afterLogged ? 'logged' : ''}">
                ${afterLogged
                  ? `✓ Logged at ${formatTime(openCycle.after_sleep_at)}`
                  : 'Pending check-in'
                }
              </div>
            </div>
            ${afterLogged ? `
              <button class="btn-tap-target checked" id="btnAfterSleepDone">
                ✓ Done
              </button>
            ` : `
              <button class="btn-tap-target after-sleep" id="btnAfterSleepTap">
                Log & Notify
              </button>
            `}
          </div>

          ${afterLogged ? `
            <div class="checkin-uncheck-hint">
              Mistake? <button class="btn-uncheck" id="btnUncheckAfter">Un-check slot</button>
            </div>
          ` : ''}

          <!-- Situational Habit Cue (Gollwitzer 1999) -->
          <div class="cue-box">
            <span class="cue-icon">💡</span>
            <div>
              <span class="cue-label">Your Cue:</span>
              <span class="cue-text">"${escapeHtml(tracker?.after_sleep_cue || 'right when I wake up')}"</span>
            </div>
          </div>

          <!-- After Sleep Routine Guide -->
          <div class="guide-box">
            <div class="guide-steps">
              Wash <b>&rarr;</b> Azelaic acid 10% <b>&rarr;</b> Moisturizer <b>&rarr;</b> Sunscreen
            </div>
            <div class="guide-subtext">Consistent daily barrier defense & post-inflammatory care.</div>
          </div>
        </div>

        <!-- Before Sleep Card -->
        <div class="checkin-card before-sleep">
          <div class="checkin-main">
            <div class="checkin-info">
              <div class="checkin-tag">Event 2</div>
              <h2 class="checkin-title">Before Sleep</h2>
              <div class="checkin-status ${beforeLogged ? 'logged' : ''}">
                ${beforeLogged
                  ? `✓ Logged at ${formatTime(openCycle.before_sleep_at)} (${openCycle.adapalene ? 'Adapalene' : 'Rest'})`
                  : 'Pending check-in'
                }
              </div>
            </div>
            ${beforeLogged ? `
              <button class="btn-tap-target checked" id="btnBeforeSleepDone">
                ✓ Done
              </button>
            ` : `
              <button class="btn-tap-target before-sleep" id="btnBeforeSleepTap">
                Log & Notify
              </button>
            `}
          </div>

          ${beforeLogged ? `
            <div class="checkin-uncheck-hint">
              Mistake? <button class="btn-uncheck" id="btnUncheckBefore">Un-check slot</button>
            </div>
          ` : ''}

          <!-- Situational Habit Cue (Gollwitzer 1999) -->
          <div class="cue-box">
            <span class="cue-icon">💡</span>
            <div>
              <span class="cue-label">Your Cue:</span>
              <span class="cue-text">"${escapeHtml(tracker?.before_sleep_cue || 'right before I get into bed')}"</span>
            </div>
          </div>

          <!-- Live Adaptive Adapalene Guide / Logged Routine Summary (Fix 2) -->
          <div class="guide-box">
            ${beforeLogged ? `
              <div class="guide-badge-row">
                <span class="badge-pill ${openCycle.adapalene ? 'adapalene' : 'rest'}">
                  ✓ ${openCycle.adapalene ? 'Adapalene Applied' : 'Intentional Rest'}
                </span>
                <span class="badge-pill phase">
                  ${escapeHtml(adapalenePhase.label)}
                </span>
              </div>
              <div class="guide-steps">
                ${openCycle.adapalene
                  ? 'Wash <b>&rarr;</b> Adapalene 0.1% <b>&rarr;</b> Moisturizer'
                  : 'Wash <b>&rarr;</b> Moisturizer only'
                }
              </div>
              <div class="guide-subtext">
                ${!followedRecommendation
                  ? `Recorded at ${formatTime(openCycle.before_sleep_at)} (${openCycle.adapalene ? 'Adapalene applied' : 'Rest taken'} — app had suggested ${escapeHtml(priorPlan.badge)}). Next session: ${escapeHtml(nextPlan.badge)}.`
                  : `Completed at ${formatTime(openCycle.before_sleep_at)} as scheduled. Next session will be: ${escapeHtml(nextPlan.badge)}.`
                }
              </div>
            ` : `
              <div class="guide-badge-row">
                <span class="badge-pill ${tonightPlan.useAdapalene ? 'adapalene' : 'rest'}">
                  ${escapeHtml(tonightPlan.badge)}
                </span>
                <span class="badge-pill phase">
                  ${escapeHtml(adapalenePhase.label)}
                </span>
              </div>
              <div class="guide-steps">
                ${escapeHtml(tonightPlan.instructions).replace(/→/g, '<b>&rarr;</b>')}
              </div>
              <div class="guide-subtext">
                ${escapeHtml(tonightPlan.subtext)}
              </div>
            `}
          </div>
        </div>
      </div>

      <!-- Manual WhatsApp Nudge (Feature 5) -->
      <button class="btn-whatsapp-manual" id="btnManualWhatsapp">
        💬 Send Status Nudge via WhatsApp
      </button>
    ` : `
      <!-- Partner Guidance Summary (Read-Only) -->
      <div class="checkin-card before-sleep" style="margin-bottom: 24px;">
        ${beforeLogged ? `
          <div class="guide-badge-row">
            <span class="badge-pill ${openCycle.adapalene ? 'adapalene' : 'rest'}">
              Tonight: ${openCycle.adapalene ? 'Adapalene Applied' : 'Intentional Rest'}
            </span>
            <span class="badge-pill phase">
              ${escapeHtml(adapalenePhase.name)} (${adapalenePhase.count} nights)
            </span>
          </div>
          <div class="guide-steps" style="margin-top: 8px;">
            ${openCycle.adapalene
              ? 'Wash <b>&rarr;</b> Adapalene 0.1% <b>&rarr;</b> Moisturizer'
              : 'Wash <b>&rarr;</b> Moisturizer only'
            }
          </div>
          <div class="guide-subtext">
            ${escapeHtml(tracker?.partner_name || 'Owner')} logged at ${formatTime(openCycle.before_sleep_at)}. Next session: ${escapeHtml(nextPlan.badge)}.
          </div>
        ` : `
          <div class="guide-badge-row">
            <span class="badge-pill ${tonightPlan.useAdapalene ? 'adapalene' : 'rest'}">
              Tonight: ${escapeHtml(tonightPlan.badge)}
            </span>
            <span class="badge-pill phase">
              ${escapeHtml(adapalenePhase.name)} (${adapalenePhase.count} nights)
            </span>
          </div>
          <div class="guide-steps" style="margin-top: 8px;">
            ${escapeHtml(tonightPlan.instructions).replace(/→/g, '<b>&rarr;</b>')}
          </div>
          <div class="guide-subtext">
            ${escapeHtml(tonightPlan.subtext)}
          </div>
        `}
      </div>
    `}

    <!-- 60-Cycle Timeline Strip (Feature 4) -->
    <div class="timeline-card">
      <div class="timeline-header">
        <h3 class="timeline-title">Cycle History</h3>
        <span class="timeline-subtitle">Last ${timelineMarkers.length} cycles (oldest &rarr; newest)</span>
      </div>

      <div class="timeline-strip-container">
        <div class="timeline-strip">
          ${timelineMarkers.length === 0 ? `
            <div style="font-size: 12px; color: var(--ink-soft); padding: 12px 0;">
              No cycles logged yet. Check in to begin your streak!
            </div>
          ` : timelineMarkers.map((m, idx) => `
            <div
              class="cycle-marker ${selectedCycle && selectedCycle.id === m.id ? 'active' : ''}"
              data-cycle-id="${m.id}"
              title="Cycle #${m.cycleIndex}"
            >
              <div class="marker-half after-${m.afterState}"></div>
              <div class="marker-half before-${m.beforeState}"></div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Selected Cycle Tooltip Card -->
      ${selectedCycle ? `
        <div class="timeline-details-card">
          <div class="timeline-details-title">
            Cycle #${selectedCycle.cycleIndex} ${selectedCycle.isOpen ? '(Current Open Cycle)' : ''}
            ${selectedCycle.isShielded ? '<span class="grace-shield-pill" style="margin-left: 6px;">🛡️ Shielded</span>' : ''}
          </div>
          <div class="timeline-details-grid">
            <div class="timeline-details-item">
              <span class="lbl">After Sleep</span>
              <span class="val">
                ${selectedCycle.afterSleepAt ? formatDateTime(selectedCycle.afterSleepAt) : (selectedCycle.isOpen ? 'Pending' : (selectedCycle.isShielded ? 'Missed (Grace Shielded)' : 'Missed'))}
              </span>
            </div>
            <div class="timeline-details-item">
              <span class="lbl">Before Sleep</span>
              <span class="val">
                ${selectedCycle.beforeSleepAt
                  ? `${formatDateTime(selectedCycle.beforeSleepAt)} (${selectedCycle.adapalene ? 'Adapalene' : 'Rest'})`
                  : (selectedCycle.isOpen ? 'Pending' : (selectedCycle.isShielded ? 'Missed (Grace Shielded)' : 'Missed'))
                }
              </span>
            </div>
          </div>
          ${selectedCycle.isShielded ? `
            <div style="margin-top: 8px; font-size: 11px; color: #B45309; background: #FEF3C7; padding: 4px 8px; border-radius: 4px; font-weight: 500;">
              🛡️ Protected by 30-day streak grace. Motivational streak maintained; progress score decayed biologically.
            </div>
          ` : ''}
        </div>
      ` : ''}

      <div class="timeline-legend">
        <div class="legend-item">
          <div class="legend-dot gold"></div>
          <span>After Sleep Done</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot indigo"></div>
          <span>Adapalene</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot sage"></div>
          <span>Intentional Rest</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot brick"></div>
          <span>Missed</span>
        </div>
        <div class="legend-item">
          <div class="legend-dot" style="background: #E2A64B; border: 1px solid #B45341;"></div>
          <span>Grace Shielded</span>
        </div>
      </div>
    </div>

    <!-- Settings Modal (Owner & Partner) -->
    ${state.settingsOpen ? renderSettingsModal(tracker, storageState) : ''}
  `;

  // Attach event listeners
  attachDashboardListeners(isOwner, tracker, cycles);
}

function renderSettingsModal(tracker, storageState) {
  const isOwner = storageState.role === 'owner';
  const partner = storageState.partner;
  const activeInvites = storageState.activeInvites || [];
  const inviteData = state.inviteLinkData;
  const notifPerm = getNotificationPermission();

  return `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-card">
        <div class="modal-header">
          <h2 class="modal-title">Settings</h2>
          <button class="btn-icon" id="btnCloseSettings" aria-label="Close">✕</button>
        </div>

        ${isOwner ? `
          <form id="settingsForm">
            <div class="form-group">
              <label class="form-label" for="inPartnerName">Partner's Display Name</label>
              <input
                type="text"
                id="inPartnerName"
                class="form-input"
                placeholder="e.g. Sarah"
                value="${escapeHtml(tracker?.partner_name || '')}"
              />
            </div>

            <div class="form-group">
              <label class="form-label" for="inPartnerPhone">Partner's WhatsApp Number</label>
              <input
                type="tel"
                id="inPartnerPhone"
                class="form-input"
                placeholder="e.g. +14155552671 or 919876543210"
                value="${escapeHtml(tracker?.partner_phone || '')}"
              />
              <span style="font-size: 11px; color: var(--ink-soft); display: block; margin-top: 4px;">
                Kept strictly private on your owner record. Never visible to your partner's client.
              </span>
            </div>

            <div class="form-group">
              <label class="form-label" for="inNudgeThreshold">Nudge Threshold (Hours)</label>
              <input
                type="number"
                id="inNudgeThreshold"
                class="form-input"
                min="1"
                max="48"
                value="${tracker?.nudge_threshold_hours || 14}"
              />
              <span style="font-size: 11px; color: var(--ink-soft); display: block; margin-top: 4px;">
                Shows an in-app banner when one half of a cycle has been open for longer than this.
              </span>
            </div>

            <div class="form-group">
              <label class="form-label" for="inAfterSleepCue">After Sleep Situational Cue</label>
              <input
                type="text"
                id="inAfterSleepCue"
                class="form-input"
                placeholder="e.g. right when my alarm rings"
                value="${escapeHtml(tracker?.after_sleep_cue || 'right when I wake up')}"
              />
              <div class="cue-presets" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                <button type="button" class="btn-cue-preset" data-target="inAfterSleepCue" data-val="right when my alarm rings" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">alarm rings</button>
                <button type="button" class="btn-cue-preset" data-target="inAfterSleepCue" data-val="right after my morning shower" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">morning shower</button>
                <button type="button" class="btn-cue-preset" data-target="inAfterSleepCue" data-val="while morning coffee brews" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">coffee brews</button>
              </div>
              <span style="font-size: 11px; color: var(--ink-soft); display: block; margin-top: 4px;">
                Anchoring your routine to an existing situational cue increases follow-through 2–3x (Gollwitzer 1999).
              </span>
            </div>

            <div class="form-group">
              <label class="form-label" for="inBeforeSleepCue">Before Sleep Situational Cue</label>
              <input
                type="text"
                id="inBeforeSleepCue"
                class="form-input"
                placeholder="e.g. right before I get into bed"
                value="${escapeHtml(tracker?.before_sleep_cue || 'right before I get into bed')}"
              />
              <div class="cue-presets" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                <button type="button" class="btn-cue-preset" data-target="inBeforeSleepCue" data-val="right after brushing my teeth" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">brushing teeth</button>
                <button type="button" class="btn-cue-preset" data-target="inBeforeSleepCue" data-val="right before plugging phone into charger" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">charging phone</button>
                <button type="button" class="btn-cue-preset" data-target="inBeforeSleepCue" data-val="right after changing into nightwear" style="font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--bg); border: 1px solid var(--line); cursor: pointer; color: var(--ink-soft);">nightwear</button>
              </div>
            </div>

            <button type="submit" class="btn-primary" style="margin-top: 8px;">
              Save Settings
            </button>
          </form>
        ` : `
          <div style="font-size: 13px; color: var(--ink); margin-bottom: 14px; padding: 12px; background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-sm);">
            You are connected as an accountability partner for <strong>${escapeHtml(tracker?.partner_name || 'Owner')}</strong>.
          </div>
        `}

        <!-- Push Notifications & App Installation (Both Owner & Partner) -->
        <div class="modal-section">
          <div class="modal-section-title">Push Notifications & Install</div>
          <div class="push-settings-card">
            <div>
              <div style="font-size: 13px; font-weight: 600; color: var(--ink);">Push Notifications</div>
              <div style="font-size: 11px; color: var(--ink-soft); margin-top: 2px;">
                ${notifPerm === 'granted'
                  ? 'Active on this device (receiving routine nudges).'
                  : (notifPerm === 'denied'
                    ? 'Blocked in browser settings.'
                    : 'Get real phone notifications when routines are pending.')}
              </div>
            </div>
            <div>
              ${notifPerm === 'granted' ? `
                <span class="push-status-badge granted">Active</span>
              ` : (notifPerm === 'denied' ? `
                <span class="push-status-badge denied">Blocked</span>
              ` : `
                <button type="button" class="btn-push-action" id="btnEnablePush">
                  Enable
                </button>
              `)}
            </div>
          </div>

          ${state.deferredInstallPrompt ? `
            <div class="pwa-install-banner" style="margin-top: 10px;">
              <div style="font-size: 12px; color: var(--ink);">
                <strong>Install Skin Streak App</strong><br>
                Add to Android home screen for one-tap tracking.
              </div>
              <button type="button" class="btn-install-pwa" id="btnTriggerInstall">
                Install App
              </button>
            </div>
          ` : ''}
        </div>

        ${isOwner ? `
          <!-- Partner Invite Flow -->
          <div class="modal-section">
            <div class="modal-section-title">Accountability Partner Access</div>

            ${partner ? `
              <div style="font-size: 13px; color: var(--ink); margin-bottom: 10px;">
                ✓ Partner connected since ${formatDateTime(partner.joined_at)}
              </div>
              ${state.confirmRevokeOpen ? `
                <div class="confirm-box">
                  <div class="confirm-title">Revoke Partner Access?</div>
                  <div class="confirm-msg">They will immediately lose read access to your tracker log.</div>
                  <div class="confirm-actions">
                    <button class="btn-danger" id="btnConfirmRevoke">Yes, Revoke</button>
                    <button class="btn-secondary" id="btnCancelRevoke">Cancel</button>
                  </div>
                </div>
              ` : `
                <button class="btn-danger" id="btnRevokePartner">
                  Revoke Partner Access
                </button>
              `}
            ` : `
              <p style="font-size: 12px; color: var(--ink-soft); margin-bottom: 12px;">
                Invite an accountability partner to see your real-time log, streak, and timeline (read-only).
              </p>
              <button class="btn-secondary" id="btnGenerateInvite" style="width: 100%;">
                + Generate 7-Day Single-Use Invite Link
              </button>
            `}

            ${inviteData ? `
              <div class="invite-box">
                <div style="font-size: 11px; font-weight: 600; color: var(--ink); margin-bottom: 4px;">
                  Single-Use Invite Link (Expires in 7 days):
                </div>
                <div class="invite-url-text">${escapeHtml(inviteData.inviteUrl)}</div>
                <div class="invite-actions">
                  <button class="btn-secondary" id="btnCopyInvite">Copy Link</button>
                  <button class="btn-secondary" id="btnShareInviteWhatsApp">Send on WhatsApp</button>
                </div>
              </div>
            ` : ''}
          </div>

          <!-- In-App Reset Confirmation (Feature 6) -->
          <div class="modal-section">
            <div class="modal-section-title">Reset Cycle History</div>
            <p style="font-size: 12px; color: var(--ink-soft); margin-bottom: 10px;">
              Clears all logged cycles for this tracker. Resets your streak, missed counts, and restarts Adapalene at the build-up phase.
            </p>

            ${state.confirmResetOpen ? `
              <div class="confirm-box">
                <div class="confirm-title">Clear all cycles and restart streak?</div>
                <div class="confirm-msg">This cannot be undone. All your past check-in logs will be permanently deleted.</div>
                <div class="confirm-actions">
                  <button class="btn-danger" id="btnConfirmReset">Yes, Reset Everything</button>
                  <button class="btn-secondary" id="btnCancelReset">Cancel</button>
                </div>
              </div>
            ` : `
              <button class="btn-danger" id="btnOpenResetConfirm">
                Reset Tracker History
              </button>
            `}
          </div>
        ` : `
          <div style="margin-top: 16px; text-align: center;">
            <button class="btn-secondary" id="btnPartnerSignOutModal" style="width: 100%;">
              Sign Out
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

function attachDashboardListeners(isOwner, tracker, cycles) {
  // Sign out
  document.getElementById('btnSignOut')?.addEventListener('click', handleSignOut);
  document.getElementById('btnPartnerSignOutModal')?.addEventListener('click', handleSignOut);

  // Settings trigger
  document.getElementById('btnOpenSettings')?.addEventListener('click', () => {
    state.settingsOpen = true;
    render();
  });

  // Timeline marker selection
  document.querySelectorAll('.cycle-marker').forEach(el => {
    el.addEventListener('click', () => {
      const cycleId = el.getAttribute('data-cycle-id');
      state.selectedCycleId = state.selectedCycleId === cycleId ? null : cycleId;
      render();
    });
  });

  // Partner Nudge Button (Partner View)
  document.getElementById('btnSendPartnerNudge')?.addEventListener('click', async () => {
    const btn = document.getElementById('btnSendPartnerNudge');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Sending nudge...';
    }
    try {
      await state.storage.sendPartnerNudge(tracker.id);
      showToast(`Push nudge sent to ${escapeHtml(tracker?.partner_name || 'Owner')}!`);
      render();
    } catch (err) {
      console.error('Partner nudge error:', err);
      showToast(err.message || 'Failed to send nudge.');
      render();
    }
  });

  // Settings Modal Listeners (Both Owner & Partner)
  if (state.settingsOpen) {
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => {
      state.settingsOpen = false;
      state.confirmResetOpen = false;
      state.confirmRevokeOpen = false;
      render();
    });

    // Push notification toggle button
    document.getElementById('btnEnablePush')?.addEventListener('click', async () => {
      const btn = document.getElementById('btnEnablePush');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Enabling...';
      }
      try {
        await subscribeToPush(state.storage);
        showToast('Push notifications enabled on this device!');
        render();
      } catch (err) {
        console.error('Push enable error:', err);
        showToast(err.message || 'Failed to enable push notifications.');
        render();
      }
    });

    // PWA Install button
    document.getElementById('btnTriggerInstall')?.addEventListener('click', async () => {
      if (state.deferredInstallPrompt) {
        state.deferredInstallPrompt.prompt();
        const choice = await state.deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          showToast('Skin Streak installed!');
        }
        state.deferredInstallPrompt = null;
        render();
      }
    });

    if (isOwner) {
      // Situational Cue preset pills
      document.querySelectorAll('.btn-cue-preset').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = btn.getAttribute('data-target');
          const val = btn.getAttribute('data-val');
          const input = document.getElementById(targetId);
          if (input && val) {
            input.value = val;
          }
        });
      });

      document.getElementById('settingsForm')?.addEventListener('submit', handleSaveSettings);
      document.getElementById('btnGenerateInvite')?.addEventListener('click', handleGenerateInvite);

      if (state.inviteLinkData) {
        document.getElementById('btnCopyInvite')?.addEventListener('click', () => {
          handleCopyInviteLink(state.inviteLinkData.inviteUrl);
        });

        document.getElementById('btnShareInviteWhatsApp')?.addEventListener('click', () => {
          const text = `Hey! Here's your invite link to be my accountability partner on Skin Streak: ${state.inviteLinkData.inviteUrl}`;
          openWhatsApp(tracker?.partner_phone, text);
        });
      }

      // Revoke partner confirmation
      document.getElementById('btnRevokePartner')?.addEventListener('click', () => {
        state.confirmRevokeOpen = true;
        render();
      });

      document.getElementById('btnConfirmRevoke')?.addEventListener('click', handleRevokePartner);
      document.getElementById('btnCancelRevoke')?.addEventListener('click', () => {
        state.confirmRevokeOpen = false;
        render();
      });

      // Reset confirmation
      document.getElementById('btnOpenResetConfirm')?.addEventListener('click', () => {
        state.confirmResetOpen = true;
        render();
      });

      document.getElementById('btnConfirmReset')?.addEventListener('click', handleResetCycles);
      document.getElementById('btnCancelReset')?.addEventListener('click', () => {
        state.confirmResetOpen = false;
        render();
      });
    }
  }

  if (!isOwner) return;

  // Check-in buttons (Feature 1)
  document.getElementById('btnAfterSleepTap')?.addEventListener('click', () => {
    handleCheckInTap('afterSleep');
  });

  document.getElementById('btnBeforeSleepTap')?.addEventListener('click', () => {
    handleCheckInTap('beforeSleep');
  });

  // Un-check buttons
  document.getElementById('btnUncheckAfter')?.addEventListener('click', () => {
    handleUnCheckInTap('afterSleep');
  });

  document.getElementById('btnUncheckBefore')?.addEventListener('click', () => {
    handleUnCheckInTap('beforeSleep');
  });

  // Manual WhatsApp Nudge (Feature 5)
  document.getElementById('btnManualWhatsapp')?.addEventListener('click', () => {
    const msg = formatManualWhatsAppMessage(cycles);
    openWhatsApp(tracker?.partner_phone, msg);
  });

  // Proactive WhatsApp check-in trigger (Miss-Prevention Feature 4)
  document.getElementById('btnProactiveAlert')?.addEventListener('click', async () => {
    const gaps = computePersonalGaps(cycles);
    const streakData = computeCycleStreakWithGrace(cycles, tracker?.grace_log || []);
    const prog = computeProgressScore(cycles);
    const risk = computeRiskRingState(cycles, gaps, streakData.streak, prog.score);
    const openC = getOpenCycle(cycles);

    const alertMsg = formatProactivePartnerAlert(
      'your friend',
      risk.pendingType,
      risk.elapsedHours,
      risk.typicalHours
    );
    openWhatsApp(tracker?.partner_phone, alertMsg);
    if (openC?.id) {
      await state.storage.markPartnerAlerted(openC.id);
    }
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start application
window.addEventListener('DOMContentLoaded', initApp);
