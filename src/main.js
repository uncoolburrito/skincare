/**
 * Skin Streak — Main Application Controller
 */

import {
  todayStr,
  formatTime,
  formatDateFull,
  computeStreak,
  computeLongest,
  computeMissed,
  computeTotals,
  computeNightPlan,
  amGuideHtml,
  pmGuideHtml,
  buildGridCells,
  cellStatus,
  cellDetails,
  waMessageForSlot,
  waMessageNow
} from './streak.js';

import {
  StorageController,
  getOrCreateTrackerSlug,
  getShareableUrl,
  getSupabaseCredentials,
  saveSupabaseCredentials,
  DEFAULT_SETTINGS
} from './storage.js';

// Global application state
const state = {
  slug: getOrCreateTrackerSlug(),
  entries: {},
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,
  settingsOpen: false,
  cloudSettingsOpen: false,
  selectedCellDate: null,
  syncStatus: { status: 'local', provider: 'local', message: 'Initializing…' }
};

const APP = document.getElementById('app');
const TOAST = document.getElementById('toast');
let toastTimer = null;
let storage = null;

function showToast(msg) {
  if (!TOAST) return;
  if (toastTimer) clearTimeout(toastTimer);
  TOAST.textContent = msg;
  TOAST.classList.add('show');
  toastTimer = setTimeout(() => {
    TOAST.classList.remove('show');
  }, 2600);
}

function checkBanner() {
  const now = new Date();
  const hhmm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const t = todayStr();
  const e = state.entries[t] || { am: false, pm: false };

  if (state.settings.pmTime && hhmm >= state.settings.pmTime && !e.pm) {
    return "Past your night routine time and it's not logged yet.";
  }
  if (
    state.settings.amTime &&
    hhmm >= state.settings.amTime &&
    !e.am &&
    hhmm < (state.settings.pmTime || '23:59')
  ) {
    return "Past your morning routine time and it's not logged yet.";
  }
  return null;
}

function openWhatsapp(message) {
  const phone = (state.settings.friendPhone || '').replace(/[^0-9]/g, '');
  if (!phone) {
    showToast("Add your friend's number in Settings to enable WhatsApp check-ins");
    state.settingsOpen = true;
    render(false);
    setTimeout(() => {
      const input = document.getElementById('inFriendPhone');
      if (input) input.focus();
    }, 150);
    return;
  }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyShareLink() {
  const url = getShareableUrl(state.slug);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      // Fallback
      const temp = document.createElement('input');
      temp.value = url;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    showToast('Link copied! Share this with your friend.');
  } catch (e) {
    showToast('URL: ' + url);
  }
}

function toggleSlot(slot) {
  const t = todayStr();
  const current = state.entries[t] ? { ...state.entries[t] } : { am: false, pm: false };
  const turningOn = !current[slot];

  current[slot] = turningOn;
  if (turningOn) {
    current[`${slot}At`] = new Date().toISOString();
  } else {
    delete current[`${slot}At`];
  }

  state.entries[t] = current;

  // If turning on: immediately trigger WhatsApp compose in response to user click
  if (turningOn) {
    const msg = waMessageForSlot(slot, state.entries, state.settings, t);
    openWhatsapp(msg);
  }

  // Save to storage
  storage.save(state.entries, state.settings);
  render(turningOn);
}

async function testCallMeBot() {
  const phone = (state.settings.callMeBotPhone || state.settings.friendPhone || '').replace(/[^0-9]/g, '');
  const apiKey = (state.settings.callMeBotApiKey || '').trim();

  if (!phone || !apiKey) {
    showToast('Enter your WhatsApp phone number and CallMeBot API key first.');
    return;
  }

  showToast('Sending test message via CallMeBot…');
  try {
    const testMsg = encodeURIComponent('Test reminder from Skin Streak: Your webhook reminders are working!');
    const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${testMsg}&apikey=${apiKey}`;
    const res = await fetch(url, { mode: 'no-cors' });
    showToast('Test sent! Check your WhatsApp.');
  } catch (e) {
    showToast('Failed to send CallMeBot test alert.');
  }
}

function render(pulse = false) {
  if (!state.loaded) {
    APP.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div>Loading your log…</div>
      </div>
    `;
    return;
  }

  const t = todayStr();
  const todayEntry = state.entries[t] || { am: false, pm: false };
  const streak = computeStreak(state.entries, t);
  const longest = computeLongest(state.entries, t);
  const missed = computeMissed(state.entries, t);
  const totals = computeTotals(state.entries);
  const banner = checkBanner();
  const cells = buildGridCells(t, 12);
  const friendName = state.settings.friendName ? state.settings.friendName.trim() : 'your friend';
  const nightPlan = computeNightPlan(state.settings.routineStartDate, t);
  const credentials = getSupabaseCredentials();

  // Selected cell details (for mobile or desktop tap)
  const inspected = state.selectedCellDate ? cellDetails(state.selectedCellDate, state.entries, t) : null;

  APP.innerHTML = `
    <header>
      <div class="header-top">
        <h1>Skin Streak</h1>
        <button class="share-pill-btn" id="btnShare" title="Copy shareable link for friend">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
          </svg>
          Share link
        </button>
      </div>
      <p>Tap a slot when you finish it — it logs, shows what to use, and pings ${friendName} automatically.</p>
    </header>

    <div class="sync-bar">
      <div class="sync-status-indicator" title="${state.syncStatus.message}">
        <span class="sync-dot ${state.syncStatus.status}"></span>
        <span>${state.syncStatus.provider === 'supabase' ? 'Supabase Live Sync' : 'Local / Offline Sync'}</span>
      </div>
      <span class="sync-slug" title="Tracker ID">#${state.slug.slice(0, 8)}…</span>
    </div>

    ${banner ? `
      <section>
        <div class="banner">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div>${banner}</div>
        </div>
      </section>
    ` : ''}

    <section class="hero">
      <div class="streak-number ${pulse ? 'pulse' : ''}" id="streakNum">${streak}</div>
      <div class="streak-label">day streak</div>
      <div class="best-label">best streak: <b>${longest}</b> &nbsp;&middot;&nbsp; missed days: <b>${missed}</b></div>
    </section>

    <section>
      <h2>Today</h2>
      <div class="today-card">
        <!-- Morning Slot -->
        <div class="slot am">
          <div class="slot-top">
            <button class="slot-btn am ${todayEntry.am ? 'done' : ''}" id="btnAm" aria-pressed="${todayEntry.am ? 'true' : 'false'}">
              <span class="dot">${todayEntry.am ? '&#10003;' : ''}</span>
              Morning
            </button>
            <div class="slot-meta">
              <span class="slot-time ${todayEntry.am ? 'done' : ''}">${todayEntry.am ? 'logged ' + formatTime(todayEntry.amAt) : 'not yet'}</span>
            </div>
          </div>
          <div class="slot-guide">${amGuideHtml()}</div>
        </div>

        <!-- Night Slot -->
        <div class="slot pm">
          <div class="slot-top">
            <button class="slot-btn pm ${todayEntry.pm ? 'done' : ''}" id="btnPm" aria-pressed="${todayEntry.pm ? 'true' : 'false'}">
              <span class="dot">${todayEntry.pm ? '&#10003;' : ''}</span>
              Night
            </button>
            <div class="slot-meta">
              <span class="slot-time ${todayEntry.pm ? 'done' : ''}">${todayEntry.pm ? 'logged ' + formatTime(todayEntry.pmAt) : 'not yet'}</span>
            </div>
          </div>
          <div class="slot-guide">${pmGuideHtml(nightPlan)}</div>
        </div>
      </div>
    </section>

    <section>
      <button class="checkin-btn" id="btnWhatsapp">
        <svg viewBox="0 0 24 24">
          <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm.01 1.67c4.54 0 8.24 3.7 8.24 8.24 0 2.2-.86 4.27-2.42 5.82a8.19 8.19 0 0 1-5.82 2.42c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24zm4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.02-1.25-.75-.67-1.26-1.5-1.41-1.75-.15-.25-.02-.39.11-.51.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.08s.89 2.41 1.02 2.58c.13.17 1.76 2.68 4.26 3.76.6.26 1.06.41 1.43.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.08.15-1.18-.06-.1-.22-.17-.47-.29z"/>
        </svg>
        Send a check-in now
      </button>
      <p class="checkin-hint">Marking morning or night done already messages ${friendName} for you — use this only if you want to nudge her separately (e.g. before you've done anything yet).</p>
    </section>

    <section>
      <h2>Last 12 weeks</h2>
      <div class="heatmap-card">
        <div class="grid-scroll">
          <div class="grid" id="gridEl"></div>
        </div>

        ${inspected ? `
          <div class="cell-inspector">
            <div>
              <span class="cell-inspector-date">${inspected.dateFull}</span>
              <span style="margin-left: 6px; color: var(--ink-soft);">
                ${inspected.am ? 'AM: ' + inspected.amAt : 'AM: not done'} &bull; ${inspected.pm ? 'PM: ' + inspected.pmAt : 'PM: not done'}
              </span>
            </div>
            <span class="cell-inspector-badge ${inspected.status}">${inspected.status.toUpperCase()}</span>
          </div>
        ` : ''}

        <div class="legend">
          <span><i class="am"></i>AM only</span>
          <span><i class="pm"></i>Night only</span>
          <span><i class="both"></i>Both done</span>
          <span><i class="missed"></i>Missed</span>
          <span><i class="pending"></i>Today</span>
        </div>
      </div>
    </section>

    <section class="stats-row">
      <div class="stat"><b>${totals.totalTracked}</b><span>days tracked</span></div>
      <div class="stat"><b>${totals.rate}%</b><span>completion rate</span></div>
    </section>

    <section class="settings-card">
      <button class="settings-toggle" id="btnSettings">
        <span>Settings</span>
        <span style="font-size: 18px;">${state.settingsOpen ? '&minus;' : '+'}</span>
      </button>

      ${state.settingsOpen ? `
        <div class="settings-body">
          <div class="settings-section-title">Accountability Partner</div>
          <label>Friend's name
            <input id="inFriendName" type="text" value="${state.settings.friendName || ''}" placeholder="e.g. Priya">
          </label>
          <label>Friend's WhatsApp number
            <input id="inFriendPhone" type="tel" value="${state.settings.friendPhone || ''}" placeholder="Country code + number, e.g. 9198XXXXXXXX">
          </label>

          <div class="settings-section-title">Schedule & Routine</div>
          <label>Morning routine target time
            <input id="inAmTime" type="time" value="${state.settings.amTime || '08:00'}">
          </label>
          <label>Night routine target time
            <input id="inPmTime" type="time" value="${state.settings.pmTime || '22:00'}">
          </label>
          <label>Adapalene start date
            <input id="inStartDate" type="date" value="${state.settings.routineStartDate || t}">
          </label>
          <p class="hint">This date drives the day-by-day guide above — every-other-night for the first 2 weeks, nightly from week 3. Set it to the day you actually started.</p>

          <div class="settings-section-title">Backend & Cloud Sync</div>
          <div style="font-size: 13px; color: var(--ink-soft); line-height: 1.5; background: var(--bg); padding: 10px 12px; border-radius: 10px;">
            ${credentials.url ? `
              <div style="display: flex; align-items: center; gap: 6px; color: var(--both); font-weight: 600;">
                <span class="sync-dot online"></span> Supabase Realtime Active
              </div>
              <div style="font-size: 11.5px; margin-top: 4px; color: var(--ink-soft);">Configured via <code>.env</code>. Multi-device live sync is enabled.</div>
            ` : `
              <div style="display: flex; align-items: center; gap: 6px; color: var(--am); font-weight: 600;">
                <span class="sync-dot local"></span> Local Storage Mode
              </div>
              <div style="font-size: 11.5px; margin-top: 4px; color: var(--ink-soft);">To sync across different phones, add your free Supabase credentials to <code>.env</code> (see <code>.env.example</code>).</div>
            `}
          </div>

          <div class="btn-row" style="margin-top: 10px;">
            <button class="btn primary" id="btnSaveSettings">Save settings</button>
          </div>
        </div>
      ` : ''}
    </section>

    <p class="privacy-note">
      Your log uses shared storage, so anyone with this private link — like your accountability friend — can view it in real time and see exactly when you did morning and night routines. Keep this link private between you two.
    </p>
  `;

  // Populate heatmap grid
  const gridEl = document.getElementById('gridEl');
  if (gridEl) {
    cells.forEach((dStr) => {
      const status = cellStatus(dStr, state.entries, t);
      const cell = document.createElement('div');
      cell.className = `cell ${status}` + (state.selectedCellDate === dStr ? ' selected' : '');
      if (dStr) {
        const details = cellDetails(dStr, state.entries, t);
        const times = [];
        if (details.amAt) times.push(`AM ${details.amAt}`);
        if (details.pmAt) times.push(`PM ${details.pmAt}`);
        cell.title = `${dStr}: ${status}${times.length ? ' (' + times.join(', ') + ')' : ''}`;

        cell.addEventListener('click', () => {
          state.selectedCellDate = state.selectedCellDate === dStr ? null : dStr;
          render(false);
        });
      }
      gridEl.appendChild(cell);
    });
  }

  // Attach event listeners
  document.getElementById('btnAm')?.addEventListener('click', () => toggleSlot('am'));
  document.getElementById('btnPm')?.addEventListener('click', () => toggleSlot('pm'));
  document.getElementById('btnWhatsapp')?.addEventListener('click', () => {
    openWhatsapp(waMessageNow(state.entries, t));
  });
  document.getElementById('btnShare')?.addEventListener('click', copyShareLink);
  document.getElementById('btnSettings')?.addEventListener('click', () => {
    state.settingsOpen = !state.settingsOpen;
    render(false);
  });

  if (state.settingsOpen) {
    document.getElementById('btnSaveSettings')?.addEventListener('click', () => {
      state.settings.friendName = (document.getElementById('inFriendName')?.value || '').trim();
      state.settings.friendPhone = (document.getElementById('inFriendPhone')?.value || '').trim();
      state.settings.amTime = document.getElementById('inAmTime')?.value || '08:00';
      state.settings.pmTime = document.getElementById('inPmTime')?.value || '22:00';
      state.settings.routineStartDate = document.getElementById('inStartDate')?.value || t;

      storage.save(state.entries, state.settings);
      showToast('Settings saved successfully');
      render(false);
    });
  }
}

// Initialize Application
function init() {
  storage = new StorageController(
    state.slug,
    // onDataChanged
    (data, meta) => {
      state.entries = data.entries || {};
      state.settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };

      // Ensure routineStartDate defaults to today if never set
      if (!state.settings.routineStartDate) {
        state.settings.routineStartDate = todayStr();
        storage.save(state.entries, state.settings);
      }

      state.loaded = true;
      render(false);

      if (meta && meta.source === 'supabase-realtime') {
        showToast('Sync update received from friend');
      }
    },
    // onStatusChanged
    (statusObj) => {
      state.syncStatus = statusObj;
      if (state.loaded) {
        render(false);
      }
    }
  );

  // Set initial data from storage cache
  state.entries = storage.currentData.entries || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(storage.currentData.settings || {}) };
  if (!state.settings.routineStartDate) {
    state.settings.routineStartDate = todayStr();
  }
  state.loaded = true;
  render(false);

  // Re-check banner every minute
  setInterval(() => {
    const banner = checkBanner();
    const existing = document.querySelector('.banner');
    if (!!banner !== !!existing) {
      render(false);
    }
  }, 60000);
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
