/**
 * Skin Streak v3 — Main Application Controller
 * Handles Supabase magic-link auth flow, Owner vs Partner role rendering,
 * one-tap check-in with instant WhatsApp notification, adaptive adapalene guide,
 * 60-cycle timeline strip, and settings modal with in-app confirmations.
 */

import {
  sendMagicLink,
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
  getAfterSleepGuide
} from './cycles.js';

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
  pendingInviteToken: null
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

  // Listen to auth state transitions
  onAuthStateChange(async (event, session) => {
    console.log('[App] Auth state change event:', event);
    const user = session ? session.user : null;
    state.user = user;

    if (user) {
      state.loading = true;
      render();
      await state.storage.init(user, state.pendingInviteToken);
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

  const partner_name = nameInput ? nameInput.value.trim() : '';
  const partner_phone = phoneInput ? phoneInput.value.trim() : '';
  const nudge_threshold_hours = nudgeInput ? Number(nudgeInput.value) || 14 : 14;

  try {
    await state.storage.updateSettings({
      partner_name,
      partner_phone,
      nudge_threshold_hours
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

  APP.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-icon">✨</div>
      <h1 class="auth-title">Skin Streak</h1>
      <p class="auth-desc">Shared two-person habit tracker for irregular sleep schedules.</p>

      ${isInvite ? `
        <div class="auth-invite-banner">
          <strong>Accountability Partner Invite</strong><br>
          You've been invited to view your friend's skincare log in real time. Enter your email below to connect!
        </div>
      ` : ''}

      <div class="auth-card">
        <form id="authForm">
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
        </form>
        <p style="font-size: 11px; color: var(--ink-light); margin-top: 14px; text-align: center;">
          Passwordless & secure. Supabase email magic link authentication.
        </p>
      </div>
    </div>
  `;

  document.getElementById('authForm')?.addEventListener('submit', handleSendMagicLink);
}

function renderDashboard(storageState) {
  const isOwner = storageState.role === 'owner';
  const isPartner = storageState.role === 'partner';
  const tracker = storageState.tracker;
  const cycles = storageState.cycles || [];

  // Metrics
  const streak = computeCycleStreak(cycles);
  const longest = computeLongestCycleStreak(cycles);
  const missed = computeMissedCycles(cycles);
  const adapalenePhase = computeAdapalenePhase(cycles);
  const tonightPlan = computeTonightPlan(cycles);
  const openCycle = getOpenCycle(cycles);
  const nudge = checkAdaptiveNudge(cycles, tracker?.nudge_threshold_hours || 14);

  // Status of open cycle
  const afterLogged = !!(openCycle && openCycle.after_sleep_at);
  const beforeLogged = !!(openCycle && openCycle.before_sleep_at);

  const afterSleepGuide = getAfterSleepGuide();

  // Timeline
  const timelineMarkers = buildCycleTimeline(cycles, 60);
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
          ${isOwner ? `
            <button class="btn-icon" id="btnOpenSettings" title="Settings" aria-label="Settings">
              ⚙️
            </button>
          ` : ''}
          <button class="btn-icon" id="btnSignOut" title="Sign Out" aria-label="Sign Out">
            🚪
          </button>
        </div>
      </div>
      <div class="header-subtitle">
        ${isOwner ? 'Your personal routine & accountability hub' : `Viewing ${escapeHtml(tracker?.partner_name || 'Owner')}'s habit log`}
      </div>
    </header>

    <!-- Partner View Read-Only Banner -->
    ${isPartner ? `
      <div class="partner-view-banner">
        <span class="icon">👀</span>
        <div>
          <strong>Read-Only Accountability View</strong>
          You're tracking in real time. Changes made by the owner update automatically.
        </div>
      </div>
    ` : ''}

    <!-- Adaptive Nudge Banner (Feature 7) -->
    ${(isOwner && nudge) ? `
      <div class="nudge-banner">
        <div class="nudge-icon">⏰</div>
        <div class="nudge-content">
          <div class="nudge-title">${escapeHtml(nudge.pendingLabel)} Pending</div>
          <div class="nudge-msg">${escapeHtml(nudge.message)}</div>
        </div>
      </div>
    ` : ''}

    <!-- Streak Hero Card (Feature 3) -->
    <div class="hero-card">
      <div class="streak-display">
        <div class="streak-number">${streak}</div>
        <div class="streak-unit">${streak === 1 ? 'Cycle Streak' : 'Cycles Streak'}</div>
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

          <!-- Live Adaptive Adapalene Guide (Feature 2) -->
          <div class="guide-box">
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
          </div>
          <div class="timeline-details-grid">
            <div class="timeline-details-item">
              <span class="lbl">After Sleep</span>
              <span class="val">
                ${selectedCycle.afterSleepAt ? formatDateTime(selectedCycle.afterSleepAt) : (selectedCycle.isOpen ? 'Pending' : 'Missed')}
              </span>
            </div>
            <div class="timeline-details-item">
              <span class="lbl">Before Sleep</span>
              <span class="val">
                ${selectedCycle.beforeSleepAt
                  ? `${formatDateTime(selectedCycle.beforeSleepAt)} (${selectedCycle.adapalene ? 'Adapalene' : 'Rest'})`
                  : (selectedCycle.isOpen ? 'Pending' : 'Missed')
                }
              </span>
            </div>
          </div>
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
      </div>
    </div>

    <!-- Settings Modal (Owner Only, Feature 6) -->
    ${(isOwner && state.settingsOpen) ? renderSettingsModal(tracker, storageState) : ''}
  `;

  // Attach event listeners
  attachDashboardListeners(isOwner, tracker, cycles);
}

function renderSettingsModal(tracker, storageState) {
  const partner = storageState.partner;
  const activeInvites = storageState.activeInvites || [];
  const inviteData = state.inviteLinkData;

  return `
    <div class="modal-overlay" id="modalOverlay">
      <div class="modal-card">
        <div class="modal-header">
          <h2 class="modal-title">Settings</h2>
          <button class="btn-icon" id="btnCloseSettings" aria-label="Close">✕</button>
        </div>

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

          <button type="submit" class="btn-primary" style="margin-top: 8px;">
            Save Settings
          </button>
        </form>

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
      </div>
    </div>
  `;
}

function attachDashboardListeners(isOwner, tracker, cycles) {
  // Sign out
  document.getElementById('btnSignOut')?.addEventListener('click', handleSignOut);

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

  // Settings Modal Listeners
  if (state.settingsOpen) {
    document.getElementById('btnCloseSettings')?.addEventListener('click', () => {
      state.settingsOpen = false;
      state.confirmResetOpen = false;
      state.confirmRevokeOpen = false;
      render();
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
