/**
 * Skin Streak v3 — Sleep-Cycle Habit Tracking & Adapalene Schedule Engine
 *
 * Irregular Sleep Schedule Architecture:
 * - Check-ins are explicitly tagged "After Sleep" or "Before Sleep"
 * - Never inferred from clock time or calendar dates
 * - Adapalene schedule derived strictly from logged history, self-pacing
 * - Real-time streak and timeline generation
 */

/**
 * Formats a Date or ISO string to friendly 12-hour time (e.g. "9:45 PM")
 */
export function formatTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch (e) {
    return '';
  }
}

/**
 * Formats a Date or ISO string to friendly short date & time
 */
export function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  } catch (e) {
    return '';
  }
}

/**
 * Determines whether a cycle is completely finished (both timestamps logged)
 */
export function isCycleComplete(cycle) {
  return !!(cycle && cycle.after_sleep_at && cycle.before_sleep_at);
}

/**
 * Returns the "current open cycle":
 * The latest cycle for this tracker if it is missing at least one timestamp.
 */
export function getOpenCycle(cycles = []) {
  if (!cycles || cycles.length === 0) return null;
  const last = cycles[cycles.length - 1];
  if (!last.after_sleep_at || !last.before_sleep_at) {
    return last;
  }
  return null;
}

/**
 * Computes the Adapalene Phase based strictly on actual logged adapalene count:
 * - count < 7:  build-up (alternate adapalene and rest)
 * - count < 21: building nightly (nightly adapalene; skip only on irritation)
 * - count >= 21: maintenance (nightly adapalene)
 */
export function computeAdapalenePhase(cycles = []) {
  const adapaleneCount = cycles.filter(c => c.adapalene === true).length;

  if (adapaleneCount < 7) {
    return {
      key: 'build-up',
      name: 'Build-up',
      count: adapaleneCount,
      target: 7,
      label: `Build-up phase (${adapaleneCount}/7 adapalene nights)`,
      subtext: 'Every other night — alternating with restorative rest nights to build tolerance.'
    };
  }

  if (adapaleneCount < 21) {
    return {
      key: 'building-nightly',
      name: 'Building Nightly',
      count: adapaleneCount,
      target: 21,
      label: `Building nightly phase (${adapaleneCount}/21 adapalene nights)`,
      subtext: 'Nightly application. Skip only on visible irritation or barrier distress.'
    };
  }

  return {
    key: 'maintenance',
    name: 'Maintenance',
    count: adapaleneCount,
    target: null,
    label: `Maintenance phase (${adapaleneCount} adapalene nights)`,
    subtext: 'Long-term maintenance routine. Applied nightly.'
  };
}

/**
 * Computes tonight's Adapalene plan live before "Before Sleep" is tapped:
 *
 * lastBeforeSleep = most recent PAST cycle with beforeSleepAt filled
 * if phase is building-nightly or maintenance: plan = ADAPALENE
 * elif lastBeforeSleep does not exist:         plan = ADAPALENE
 * elif lastBeforeSleep.adapalene === true:    plan = REST
 * else:                                       plan = ADAPALENE
 *
 * Cycles skipped entirely in between simply don't exist in this lookup!
 */
export function computeTonightPlan(cycles = []) {
  const phase = computeAdapalenePhase(cycles);

  // In nightly phases, plan is always Adapalene
  if (phase.key === 'building-nightly' || phase.key === 'maintenance') {
    return {
      useAdapalene: true,
      plan: 'ADAPALENE',
      phase,
      title: 'Adapalene Night',
      badge: 'Adapalene',
      instructions: 'Wash → Adapalene 0.1% → Moisturizer',
      subtext: `${phase.name} phase. Nightly routine. (Skip only if skin feels irritated).`
    };
  }

  // Build-up phase: alternate based on most recent logged beforeSleepAt
  let lastBeforeSleep = null;
  for (let i = cycles.length - 1; i >= 0; i--) {
    const c = cycles[i];
    if (c.before_sleep_at) {
      lastBeforeSleep = c;
      break;
    }
  }

  let useAdapalene = true;
  let reason = '';

  if (!lastBeforeSleep) {
    useAdapalene = true;
    reason = 'First logged night — starting with Adapalene';
  } else if (lastBeforeSleep.adapalene === true) {
    useAdapalene = false;
    reason = 'Last logged routine was Adapalene — scheduled rest tonight';
  } else {
    useAdapalene = true;
    reason = 'Last logged routine was Rest — back to Adapalene tonight';
  }

  if (useAdapalene) {
    return {
      useAdapalene: true,
      plan: 'ADAPALENE',
      phase,
      title: 'Adapalene Night',
      badge: 'Adapalene',
      instructions: 'Wash → Adapalene 0.1% → Moisturizer',
      subtext: `${reason}. Thin layer over dry skin.`
    };
  } else {
    return {
      useAdapalene: false,
      plan: 'REST',
      phase,
      title: 'Rest Night',
      badge: 'Rest Night',
      instructions: 'Wash → Moisturizer only',
      subtext: `${reason}. Intentional barrier recovery night.`
    };
  }
}

/**
 * Constant routine guide for After Sleep
 */
export function getAfterSleepGuide() {
  return {
    title: 'After Sleep Routine',
    instructions: 'Wash → Azelaic acid 10% → Moisturizer → Sunscreen',
    subtext: 'Consistent across all phases for barrier defense and tone.'
  };
}

/**
 * Cycle-filling logic:
 * On check-in of type T ('afterSleep' | 'beforeSleep'):
 * - If no open cycle, or open cycle already has type T filled: start new cycle with T
 * - Otherwise: fill T into open cycle
 *
 * Returns: { updatedCycles, action: 'created' | 'updated', cycleId, cycle }
 */
export function handleCheckIn(cycles = [], type, options = {}) {
  const timestamp = options.timestamp || new Date().toISOString();
  const openCycle = getOpenCycle(cycles);
  const updated = cycles.map(c => ({ ...c }));

  if (type === 'afterSleep') {
    if (!openCycle || openCycle.after_sleep_at) {
      // Start new cycle with after_sleep_at
      const newCycle = {
        id: options.id || ('temp_' + Math.random().toString(36).substring(2, 9)),
        tracker_id: options.tracker_id,
        after_sleep_at: timestamp,
        before_sleep_at: null,
        adapalene: null,
        created_at: timestamp
      };
      updated.push(newCycle);
      return { updatedCycles: updated, action: 'created', cycle: newCycle };
    } else {
      // Fill into open cycle
      const idx = updated.findIndex(c => c.id === openCycle.id);
      updated[idx] = {
        ...updated[idx],
        after_sleep_at: timestamp
      };
      return { updatedCycles: updated, action: 'updated', cycle: updated[idx] };
    }
  }

  if (type === 'beforeSleep') {
    // Determine adapalene
    let adapaleneVal = options.adapalene;
    if (typeof adapaleneVal !== 'boolean') {
      const plan = computeTonightPlan(cycles);
      adapaleneVal = plan.useAdapalene;
    }

    if (!openCycle || openCycle.before_sleep_at) {
      // Start new cycle with before_sleep_at
      const newCycle = {
        id: options.id || ('temp_' + Math.random().toString(36).substring(2, 9)),
        tracker_id: options.tracker_id,
        after_sleep_at: null,
        before_sleep_at: timestamp,
        adapalene: adapaleneVal,
        created_at: timestamp
      };
      updated.push(newCycle);
      return { updatedCycles: updated, action: 'created', cycle: newCycle };
    } else {
      // Fill into open cycle
      const idx = updated.findIndex(c => c.id === openCycle.id);
      updated[idx] = {
        ...updated[idx],
        before_sleep_at: timestamp,
        adapalene: adapaleneVal
      };
      return { updatedCycles: updated, action: 'updated', cycle: updated[idx] };
    }
  }

  return { updatedCycles: updated, action: 'none', cycle: null };
}

/**
 * Un-tapping logic:
 * Clears that field on the current open cycle.
 */
export function handleUnCheckIn(cycles = [], type) {
  const openCycle = getOpenCycle(cycles);
  if (!openCycle) return { updatedCycles: cycles, changedCycle: null };

  const updated = cycles.map(c => ({ ...c }));
  const idx = updated.findIndex(c => c.id === openCycle.id);
  if (idx === -1) return { updatedCycles: cycles, changedCycle: null };

  if (type === 'afterSleep') {
    updated[idx].after_sleep_at = null;
  } else if (type === 'beforeSleep') {
    updated[idx].before_sleep_at = null;
    updated[idx].adapalene = null;
  }

  // If both timestamps are now null, filter out this empty cycle
  if (!updated[idx].after_sleep_at && !updated[idx].before_sleep_at) {
    const deletedId = updated[idx].id;
    const cleaned = updated.filter(c => c.id !== deletedId);
    return { updatedCycles: cleaned, changedCycle: { id: deletedId, deleted: true } };
  }

  return { updatedCycles: updated, changedCycle: updated[idx] };
}

/**
 * Cycle Streak Calculation:
 * - Complete cycle: both after_sleep_at and before_sleep_at filled.
 * - Current streak: consecutive complete cycles counting backward from the most recent.
 * - The current open cycle doesn't break the streak while genuinely still in progress.
 */
export function computeCycleStreak(cycles = []) {
  if (!cycles || cycles.length === 0) return 0;

  let streak = 0;
  let startIndex = cycles.length - 1;

  // If the last cycle is incomplete (open), start checking from the cycle before it
  const last = cycles[startIndex];
  if (!isCycleComplete(last)) {
    startIndex = cycles.length - 2;
  }

  for (let i = startIndex; i >= 0; i--) {
    if (isCycleComplete(cycles[i])) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}

/**
 * Longest Streak: best historical run of consecutive complete cycles
 */
export function computeLongestCycleStreak(cycles = []) {
  if (!cycles || cycles.length === 0) return 0;

  let longest = 0;
  let currentRun = 0;

  for (let i = 0; i < cycles.length; i++) {
    if (isCycleComplete(cycles[i])) {
      currentRun++;
      if (currentRun > longest) {
        longest = currentRun;
      }
    } else {
      currentRun = 0;
    }
  }

  return longest;
}

/**
 * Missed Count: past cycles that never got both halves filled.
 * (Excludes current open cycle while still in progress).
 */
export function computeMissedCycles(cycles = []) {
  if (!cycles || cycles.length === 0) return 0;

  let missed = 0;
  const lastIndex = cycles.length - 1;
  const last = cycles[lastIndex];
  const lastIsOpen = !isCycleComplete(last);

  // Exclude the current open cycle if it's in progress
  const evaluateCount = lastIsOpen ? lastIndex : cycles.length;

  for (let i = 0; i < evaluateCount; i++) {
    if (!isCycleComplete(cycles[i])) {
      missed++;
    }
  }

  return missed;
}

/**
 * Adaptive Nudge Banner Checker:
 * If the open cycle has one half filled and > nudgeThresholdHours have passed
 * since that timestamp, returns nudge info.
 */
export function checkAdaptiveNudge(cycles = [], nudgeThresholdHours = 14) {
  const openCycle = getOpenCycle(cycles);
  if (!openCycle) return null;

  const now = Date.now();
  const thresholdMs = nudgeThresholdHours * 3600000;

  if (openCycle.after_sleep_at && !openCycle.before_sleep_at) {
    const elapsed = now - new Date(openCycle.after_sleep_at).getTime();
    if (elapsed >= thresholdMs) {
      const hours = Math.floor(elapsed / 3600000);
      return {
        pendingType: 'beforeSleep',
        pendingLabel: 'Before Sleep',
        completedLabel: 'After Sleep',
        hours,
        message: `It's been ${hours}h since your After Sleep check-in — Before Sleep routine is pending!`
      };
    }
  }

  if (openCycle.before_sleep_at && !openCycle.after_sleep_at) {
    const elapsed = now - new Date(openCycle.before_sleep_at).getTime();
    if (elapsed >= thresholdMs) {
      const hours = Math.floor(elapsed / 3600000);
      return {
        pendingType: 'afterSleep',
        pendingLabel: 'After Sleep',
        completedLabel: 'Before Sleep',
        hours,
        message: `It's been ${hours}h since your Before Sleep check-in — After Sleep routine is pending!`
      };
    }
  }

  return null;
}

/**
 * Builds the 60-cycle timeline strip (oldest to newest):
 * Top = After Sleep (done | missed | shielded | pending)
 * Bottom = Before Sleep (adapalene | rest | missed | shielded | pending)
 */
export function buildCycleTimeline(cycles = [], maxDisplay = 60, shieldedIds = []) {
  if (!cycles) return [];
  const openCycle = getOpenCycle(cycles);
  const shieldedSet = new Set(Array.isArray(shieldedIds) ? shieldedIds : (shieldedIds ? [shieldedIds] : []));

  // Take the last maxDisplay cycles
  const slice = cycles.slice(-maxDisplay);

  return slice.map((c, index) => {
    const isOpen = openCycle && openCycle.id === c.id;
    const isShielded = shieldedSet.has(c.id);

    // After Sleep state
    let afterState = isShielded ? 'shielded' : 'missed';
    if (c.after_sleep_at) {
      afterState = 'done'; // gold
    } else if (isOpen) {
      afterState = 'pending'; // blank
    }

    // Before Sleep state
    let beforeState = isShielded ? 'shielded' : 'missed';
    if (c.before_sleep_at) {
      beforeState = c.adapalene === true ? 'adapalene' : 'rest';
    } else if (isOpen) {
      beforeState = 'pending'; // blank
    }

    return {
      cycleIndex: cycles.indexOf(c) + 1,
      id: c.id,
      isOpen,
      isShielded,
      afterState,
      beforeState,
      afterSleepAt: c.after_sleep_at,
      beforeSleepAt: c.before_sleep_at,
      adapalene: c.adapalene,
      isComplete: isCycleComplete(c)
    };
  });
}

/**
 * Formats WhatsApp message for one-tap check-in
 */
export function formatWhatsAppMessage(type, cycle, streak, plan) {
  const streakTxt = `${streak} cycle${streak === 1 ? '' : 's'}`;

  if (type === 'afterSleep') {
    const timeStr = formatTime(cycle?.after_sleep_at) || 'just now';
    return `After Sleep skincare done (${timeStr}). Streak: ${streakTxt}.`;
  }

  if (type === 'beforeSleep') {
    const timeStr = formatTime(cycle?.before_sleep_at) || 'just now';
    const planTxt = cycle?.adapalene ? 'adapalene' : 'intentional rest';
    return `Before Sleep skincare done (${timeStr}, ${planTxt}). Streak: ${streakTxt}.`;
  }

  return `Skincare check-in logged. Current streak: ${streakTxt}.`;
}

/**
 * Formats Manual WhatsApp check-in message
 */
export function formatManualWhatsAppMessage(cycles = []) {
  const streak = computeCycleStreak(cycles);
  const openCycle = getOpenCycle(cycles);
  const streakTxt = `${streak} cycle${streak === 1 ? '' : 's'}`;

  if (!openCycle) {
    return `Skincare check-in: current streak is ${streakTxt}. Ready for next cycle!`;
  }

  if (openCycle.after_sleep_at && !openCycle.before_sleep_at) {
    const timeStr = formatTime(openCycle.after_sleep_at);
    return `Check-in: After Sleep done (${timeStr}), Before Sleep still pending. Streak: ${streakTxt}.`;
  }

  if (!openCycle.after_sleep_at && openCycle.before_sleep_at) {
    const timeStr = formatTime(openCycle.before_sleep_at);
    return `Check-in: Before Sleep done (${timeStr}), After Sleep still pending. Streak: ${streakTxt}.`;
  }

  return `Skincare check-in: streak is ${streakTxt}.`;
}

// =============================================================================
// 8. Progress Score Engine (Dermatological Cumulative Saturation Model)
// =============================================================================

export const TAU_GAIN = 60;   // days: cellular turnover & retinoid receptor saturation constant
export const TAU_DECAY = 58;  // days: microcomedone rebound & barrier desaturation constant
export const G_GAIN = 1 - Math.exp(-1 / TAU_GAIN); // approx 0.01653

/**
 * Exponential decay factor over elapsed days
 */
export function decayFactor(days) {
  return Math.exp(-days / TAU_DECAY);
}

/**
 * Returns milestone band, label, description, and color palette
 */
export function getProgressMilestone(score) {
  const rounded = Math.round(score);
  if (rounded < 40) {
    return {
      band: '0-39',
      label: 'Just started',
      phaseName: 'Tolerance & Receptor Induction',
      description: 'Building cellular tolerance and establishing initial barrier routine.',
      color: '#D97706',
      softColor: '#FEF3C7',
      gradient: 'linear-gradient(135deg, #F59E0B, #D97706)'
    };
  }
  if (rounded < 75) {
    return {
      band: '40-74',
      label: 'Initial improvement window',
      phaseName: 'Microcomedone Clearance',
      description: 'Accelerated stratum corneum renewal; deep microcomedone expulsion underway.',
      color: '#0D9488',
      softColor: '#CCFBF1',
      gradient: 'linear-gradient(135deg, #14B8A6, #0D9488)'
    };
  }
  if (rounded < 95) {
    return {
      band: '75-94',
      label: 'Clearest change window',
      phaseName: 'Therapeutic Clarity Peak',
      description: 'Peak therapeutic efficacy; sustained follicular desquamation and visible clarity.',
      color: '#2563EB',
      softColor: '#DBEAFE',
      gradient: 'linear-gradient(135deg, #3B82F6, #2563EB)'
    };
  }
  return {
    band: '95-100',
    label: 'Long-term maintenance',
    phaseName: 'Epidermal Equilibrium',
    description: 'Steady-state epidermal homeostasis; chronic microcomedone suppression.',
    color: '#059669',
    softColor: '#D1FAE5',
    gradient: 'linear-gradient(135deg, #10B981, #059669)'
  };
}

/**
 * Renders an abstract, non-photographic geometric bloom/glow motif SVG.
 * Reflects radiance and cellular renewal without faces or skin photography.
 */
export function renderProgressMotif(score) {
  const rounded = Math.round(score);
  const milestone = getProgressMilestone(score);
  const scale = 0.75 + (rounded / 100) * 0.45; // 0.75 to 1.20
  const ringCount = rounded < 40 ? 2 : rounded < 75 ? 3 : rounded < 95 ? 4 : 5;

  const rings = Array.from({ length: ringCount }).map((_, idx) => {
    const r = 8 + (idx * 5.2) * (scale / 1.1);
    const opacity = 0.25 + (idx / ringCount) * 0.55;
    const dash = idx % 2 === 0 ? '3 3' : 'none';
    return `<circle cx="32" cy="32" r="${r.toFixed(1)}" stroke="${milestone.color}" stroke-width="1.4" stroke-dasharray="${dash}" stroke-opacity="${opacity}" fill="none" />`;
  }).join('');

  return `
    <svg class="progress-motif-svg" viewBox="0 0 64 64" width="52" height="52" aria-hidden="true">
      <defs>
        <radialGradient id="bloomGlow_${rounded}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${milestone.color}" stop-opacity="0.45" />
          <stop offset="60%" stop-color="${milestone.color}" stop-opacity="0.12" />
          <stop offset="100%" stop-color="${milestone.color}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#bloomGlow_${rounded})" />
      ${rings}
      <circle cx="32" cy="32" r="3.5" fill="${milestone.color}" />
      <circle cx="32" cy="32" r="1.5" fill="#FFFDF8" />
    </svg>
  `;
}

/**
 * Computes the Cumulative Progress Score (0-100) dynamically from cycles history.
 *
 * Algorithm:
 * - Constants: TAU_GAIN = 60, TAU_DECAY = 58, g = 1 - e^(-1/TAU_GAIN)
 * - Chronological walk of past resolved cycles (skips still-open cycle).
 * - COMPLETE (both halves filled): P = P + g * (100 - P)
 *   (Rest nights and Adapalene nights earn identical growth credit)
 * - PARTIAL (one half filled, orphaned miss): P = P + 0.5 * g * (100 - P)
 * - FULL MISS (neither half filled or >= 1.5 days gap between same-type check-ins):
 *   P = P * decayFactor(elapsedDays)
 */
export function computeProgressScore(cycles = []) {
  if (!cycles || cycles.length === 0) {
    return {
      score: 0,
      roundedScore: 0,
      milestone: getProgressMilestone(0),
      tauGain: TAU_GAIN,
      tauDecay: TAU_DECAY
    };
  }

  // Grace period: skip the current still-open cycle (if in progress, waiting to resolve)
  let evalCycles = cycles;
  const lastIndex = cycles.length - 1;
  const last = cycles[lastIndex];

  if (last && !last.isResolved && !last.fullMiss && last.status !== 'miss') {
    // If last cycle has exactly one half filled, it's currently in progress
    const isInProgress = (last.after_sleep_at && !last.before_sleep_at) || (!last.after_sleep_at && last.before_sleep_at);
    if (isInProgress) {
      evalCycles = cycles.slice(0, lastIndex);
    }
  }

  if (evalCycles.length === 0) {
    return {
      score: 0,
      roundedScore: 0,
      milestone: getProgressMilestone(0),
      tauGain: TAU_GAIN,
      tauDecay: TAU_DECAY
    };
  }

  let P = 0;
  let prevTimestamp = null;
  let prevType = null;

  for (let i = 0; i < evalCycles.length; i++) {
    const c = evalCycles[i];

    // Explicit full miss object in history
    const isExplicitMiss =
      (!c.after_sleep_at && !c.before_sleep_at) ||
      c.status === 'miss' ||
      c.type === 'miss' ||
      c.fullMiss === true;

    if (isExplicitMiss) {
      const elapsedDays = typeof c.elapsedDays === 'number' ? c.elapsedDays : 1;
      P = P * decayFactor(elapsedDays);
      prevTimestamp = null;
      prevType = null;
      continue;
    }

    // Determine current cycle timestamp & type for gap detection
    const currTimestamp = c.after_sleep_at || c.before_sleep_at;
    const currType = c.after_sleep_at ? 'afterSleep' : 'beforeSleep';

    if (prevTimestamp && currTimestamp) {
      const prevMs = new Date(prevTimestamp).getTime();
      const currMs = new Date(currTimestamp).getTime();
      if (!isNaN(prevMs) && !isNaN(currMs) && currMs > prevMs) {
        const elapsedDays = (currMs - prevMs) / (24 * 3600 * 1000);
        // If same check-in type occurred after >= 1.5 days, full cycle(s) were missed
        if (prevType === currType && elapsedDays >= 1.5) {
          const missedCycles = Math.round(elapsedDays) - 1;
          if (missedCycles > 0) {
            P = P * decayFactor(missedCycles);
          }
        }
      }
    }

    if (isCycleComplete(c)) {
      // COMPLETE: growth on compliance (whether Adapalene or intentional Rest)
      P = P + G_GAIN * (100 - P);
    } else {
      // PARTIAL: orphaned cycle with only one half filled
      P = P + 0.5 * G_GAIN * (100 - P);
    }

    prevTimestamp = currTimestamp;
    prevType = currType;
  }

  // Bound to 0..100
  P = Math.max(0, Math.min(100, P));

  return {
    score: P,
    roundedScore: Math.round(P),
    milestone: getProgressMilestone(P),
    tauGain: TAU_GAIN,
    tauDecay: TAU_DECAY
  };
}

// =============================================================================
// 9. Miss-Prevention Design Engine
// =============================================================================

/**
 * JITAI: Computes rolling personal average gaps from trailing cycles (14-20 samples).
 * Replaces flat threshold with individual circadian behavior.
 */
export function computePersonalGaps(cycles = []) {
  const DEFAULT_WAKING = 15.0;  // hours between After Sleep and Before Sleep
  const DEFAULT_SLEEPING = 9.0; // hours between Before Sleep and next After Sleep

  if (!cycles || cycles.length === 0) {
    return {
      typicalWakingGapHours: DEFAULT_WAKING,
      typicalSleepingGapHours: DEFAULT_SLEEPING,
      wakingSamples: 0,
      sleepingSamples: 0
    };
  }

  const recent = cycles.slice(-20);
  const wakingGaps = [];
  const sleepingGaps = [];

  for (let i = 0; i < recent.length; i++) {
    const c = recent[i];
    // Waking gap: within the same cycle, from after_sleep_at to before_sleep_at
    if (c.after_sleep_at && c.before_sleep_at) {
      const tAfter = new Date(c.after_sleep_at).getTime();
      const tBefore = new Date(c.before_sleep_at).getTime();
      if (!isNaN(tAfter) && !isNaN(tBefore) && tBefore > tAfter) {
        const gapH = (tBefore - tAfter) / 3600000;
        if (gapH >= 6 && gapH <= 26) {
          wakingGaps.push(gapH);
        }
      }
    }

    // Sleeping gap: from previous cycle's before_sleep_at to this cycle's after_sleep_at
    if (i > 0) {
      const prev = recent[i - 1];
      if (prev.before_sleep_at && c.after_sleep_at) {
        const tPrevBefore = new Date(prev.before_sleep_at).getTime();
        const tCurrAfter = new Date(c.after_sleep_at).getTime();
        if (!isNaN(tPrevBefore) && !isNaN(tCurrAfter) && tCurrAfter > tPrevBefore) {
          const gapH = (tCurrAfter - tPrevBefore) / 3600000;
          if (gapH >= 4 && gapH <= 18) {
            sleepingGaps.push(gapH);
          }
        }
      }
    }
  }

  const avgWaking = wakingGaps.length >= 3
    ? wakingGaps.reduce((sum, g) => sum + g, 0) / wakingGaps.length
    : DEFAULT_WAKING;

  const avgSleeping = sleepingGaps.length >= 3
    ? sleepingGaps.reduce((sum, g) => sum + g, 0) / sleepingGaps.length
    : DEFAULT_SLEEPING;

  return {
    typicalWakingGapHours: Math.round(avgWaking * 10) / 10,
    typicalSleepingGapHours: Math.round(avgSleeping * 10) / 10,
    wakingSamples: wakingGaps.length,
    sleepingSamples: sleepingGaps.length
  };
}

/**
 * Computes Risk Ring State (battery/fitness ring language):
 * - Green: < 70% of personal typical gap
 * - Amber: 70% - 99% of personal typical gap (heads-up)
 * - Red: >= 100% of personal typical gap (firmer reminder, loss-framed)
 */
export function computeRiskRingState(cycles = [], personalGaps = null, streak = 0, progressScore = 0, nowMs = Date.now()) {
  const gaps = personalGaps || computePersonalGaps(cycles);
  const openCycle = getOpenCycle(cycles);

  let pendingType = null;
  let elapsedHours = 0;
  let typicalHours = 15;

  if (openCycle && openCycle.after_sleep_at && !openCycle.before_sleep_at) {
    // Waiting for Before Sleep
    pendingType = 'beforeSleep';
    const startMs = new Date(openCycle.after_sleep_at).getTime();
    if (!isNaN(startMs)) {
      elapsedHours = Math.max(0, (nowMs - startMs) / 3600000);
    }
    typicalHours = gaps.typicalWakingGapHours;
  } else {
    // Waiting for After Sleep from last resolved before_sleep
    pendingType = 'afterSleep';
    let lastBeforeSleepAt = null;
    for (let i = cycles.length - 1; i >= 0; i--) {
      if (cycles[i].before_sleep_at) {
        lastBeforeSleepAt = cycles[i].before_sleep_at;
        break;
      }
    }
    if (lastBeforeSleepAt) {
      const startMs = new Date(lastBeforeSleepAt).getTime();
      if (!isNaN(startMs)) {
        elapsedHours = Math.max(0, (nowMs - startMs) / 3600000);
      }
    }
    typicalHours = gaps.typicalSleepingGapHours;
  }

  const ratio = typicalHours > 0 ? elapsedHours / typicalHours : 0;
  const percentRemaining = Math.max(0, Math.min(100, Math.round((1 - Math.min(1, ratio)) * 100)));

  let zone = 'green';
  let color = '#059669'; // sage/green
  let label = 'Buffer Healthy';
  let lossFramedCopy = '';

  const streakNoun = streak === 1 ? 'cycle streak' : 'cycles streak';
  const roundedProgress = Math.round(progressScore);
  const pendingTitle = pendingType === 'beforeSleep' ? 'Before Sleep' : 'After Sleep';

  if (ratio >= 1.0) {
    zone = 'red';
    color = '#B45341'; // brick red
    label = 'Past Typical Window';
    lossFramedCopy = streak > 0
      ? `Past your typical ${Math.round(typicalHours)}h window. Complete ${pendingTitle} to protect your ${streak}-${streakNoun} and current progress score (${roundedProgress}).`
      : `Past your typical ${Math.round(typicalHours)}h window. Complete ${pendingTitle} to keep your progress score (${roundedProgress}) on track.`;
  } else if (ratio >= 0.70) {
    zone = 'amber';
    color = '#D97706'; // warm amber
    label = 'Approaching Window';
    lossFramedCopy = streak > 0
      ? `Your ${streak}-${streakNoun} is in the safe buffer window. Complete ${pendingTitle} soon to keep it secure.`
      : `Progress score is at ${roundedProgress}. Complete ${pendingTitle} to maintain momentum.`;
  } else {
    zone = 'green';
    color = '#059669';
    label = 'Buffer Healthy';
    lossFramedCopy = streak > 0
      ? `Your ${streak}-${streakNoun} is on track (${Math.round(elapsedHours)}h elapsed of typical ${Math.round(typicalHours)}h).`
      : `Routine buffer is healthy (${Math.round(elapsedHours)}h elapsed of typical ${Math.round(typicalHours)}h).`;
  }

  return {
    zone,
    ratio,
    percentRemaining,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    typicalHours,
    color,
    label,
    pendingType,
    pendingTitle,
    lossFramedCopy
  };
}

/**
 * Checks if streak grace is currently eligible (1 per 30 rolling real days).
 */
export function getGraceEligibility(graceLog = [], nowMs = Date.now()) {
  const thirtyDaysMs = 30 * 24 * 3600 * 1000;
  const recentUses = (Array.isArray(graceLog) ? graceLog : []).filter(entry => {
    const t = new Date(typeof entry === 'string' ? entry : entry.timestamp).getTime();
    return !isNaN(t) && (nowMs - t) < thirtyDaysMs;
  });

  const isEligible = recentUses.length === 0;
  const lastUse = recentUses.length > 0 ? recentUses[recentUses.length - 1] : null;

  return {
    isEligible,
    recentUses,
    lastUseTimestamp: lastUse ? (typeof lastUse === 'string' ? lastUse : lastUse.timestamp) : null
  };
}

/**
 * Bounded Streak Grace Calculation:
 *
 * Research Citation: Polivy et al. (2010); Herman & Polivy (1975, 2002).
 * Mechanism: Restraint Theory & The "What-the-Hell Effect".
 * When behavioral goals are governed by rigid, all-or-nothing boundaries, a single
 * perceived violation or lapse is interpreted as categorical failure. This triggers
 * acute counter-regulatory disinhibition ("what the hell, I already blew my streak,
 * might as well abandon the routine entirely"), leading to total habit abandonment.
 *
 * Bounded Streak Grace acts as a psychological emergency reserve (Sharps & Schroeder 2019;
 * Herman & Polivy 2010), permitting at most 1 missed cycle shield per rolling 30 real days.
 * This absorbs an isolated lapse, preserving motivational momentum and self-efficacy,
 * while the biological Progress Score strictly ignores grace and continues its honest
 * exponential decay.
 */
export function computeCycleStreakWithGrace(cycles = [], graceLog = [], nowMs = Date.now()) {
  if (!cycles || cycles.length === 0) {
    return { streak: 0, graceApplied: false, shieldedCycleId: null };
  }

  let startIndex = cycles.length - 1;
  const last = cycles[startIndex];
  if (!isCycleComplete(last)) {
    startIndex = cycles.length - 2;
  }

  if (startIndex < 0) {
    return { streak: 0, graceApplied: false, shieldedCycleId: null };
  }

  const thirtyDaysMs = 30 * 24 * 3600 * 1000;
  const validGraceEntries = (Array.isArray(graceLog) ? graceLog : []).filter(e => {
    const t = new Date(typeof e === 'string' ? e : e.timestamp).getTime();
    return !isNaN(t) && (nowMs - t) < thirtyDaysMs;
  });

  let streak = 0;
  let graceUsedInStreak = false;
  let shieldedCycleId = null;

  for (let i = startIndex; i >= 0; i--) {
    const c = cycles[i];
    if (isCycleComplete(c)) {
      streak++;
    } else {
      // Incomplete or missed cycle
      if (!graceUsedInStreak) {
        // Check if this cycle is shielded
        const matchedGrace = validGraceEntries.find(e => (typeof e === 'object' && e.cycleId === c.id));
        const canShield = matchedGrace || validGraceEntries.length === 0;

        if (canShield) {
          graceUsedInStreak = true;
          shieldedCycleId = c.id;
          // Grace shields streak: streak continues
          continue;
        }
      }
      break;
    }
  }

  return {
    streak,
    graceApplied: graceUsedInStreak,
    shieldedCycleId
  };
}

/**
 * Formats Proactive Partner Alert WhatsApp message when entering red zone.
 */
export function formatProactivePartnerAlert(ownerName = 'The tracker owner', pendingType = 'beforeSleep', elapsedHours = 16, typicalHours = 15) {
  const routine = pendingType === 'beforeSleep' ? 'Before Sleep' : 'After Sleep';
  return `Hey! Quick nudge for ${ownerName}: they haven't logged ${routine} skincare yet and it's later than usual for them (${Math.round(elapsedHours)}h vs typical ${Math.round(typicalHours)}h). Could you check in on them?`;
}

/**
 * Formats the push notification message body for Partner-initiated nudge.
 */
export function formatPartnerNudgeMessage(partnerName = 'Your partner', pendingSlot = 'routine') {
  const cleanName = (partnerName || '').trim() || 'Your partner';
  const cleanSlot = pendingSlot === 'beforeSleep' ? 'Before Sleep' : (pendingSlot === 'afterSleep' ? 'After Sleep' : (pendingSlot || 'skincare'));
  if (cleanSlot.toLowerCase().endsWith('routine')) {
    return `${cleanName} thinks you might have forgotten your ${cleanSlot}.`;
  }
  return `${cleanName} thinks you might have forgotten your ${cleanSlot} routine.`;
}

/**
 * Determines whether the Partner can send a nudge based on 1-hour rate limit.
 */
export function canSendPartnerNudge(lastNudgeAt, nowMs = Date.now(), cooldownMs = 3600000) {
  if (!lastNudgeAt) {
    return { allowed: true, remainingMinutes: 0, remainingSeconds: 0 };
  }
  const lastMs = new Date(lastNudgeAt).getTime();
  if (isNaN(lastMs)) {
    return { allowed: true, remainingMinutes: 0, remainingSeconds: 0 };
  }
  const elapsed = nowMs - lastMs;
  if (elapsed >= cooldownMs) {
    return { allowed: true, remainingMinutes: 0, remainingSeconds: 0 };
  }
  const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  return { allowed: false, remainingMinutes, remainingSeconds };
}

