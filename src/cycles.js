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
 * Top = After Sleep (done | missed | pending)
 * Bottom = Before Sleep (adapalene | rest | missed | pending)
 */
export function buildCycleTimeline(cycles = [], maxDisplay = 60) {
  if (!cycles) return [];
  const openCycle = getOpenCycle(cycles);

  // Take the last maxDisplay cycles
  const slice = cycles.slice(-maxDisplay);

  return slice.map((c, index) => {
    const isOpen = openCycle && openCycle.id === c.id;

    // After Sleep state
    let afterState = 'missed';
    if (c.after_sleep_at) {
      afterState = 'done'; // gold
    } else if (isOpen) {
      afterState = 'pending'; // blank
    }

    // Before Sleep state
    let beforeState = 'missed';
    if (c.before_sleep_at) {
      beforeState = c.adapalene === true ? 'adapalene' : 'rest';
    } else if (isOpen) {
      beforeState = 'pending'; // blank
    }

    return {
      cycleIndex: cycles.indexOf(c) + 1,
      id: c.id,
      isOpen,
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
