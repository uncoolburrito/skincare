/**
 * renasce — Core Streak, Metrics & Routine Guidance Logic
 */

export function todayStr() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function fmt(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0);
}

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

export function formatDateFull(dateStr) {
  if (!dateStr) return '';
  try {
    const d = parseDate(dateStr);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch (e) {
    return dateStr;
  }
}

export function daysSince(startDateStr, referenceDateStr = todayStr()) {
  if (!startDateStr) return 0;
  const start = parseDate(startDateStr);
  const current = parseDate(referenceDateStr);
  const diffTime = current.getTime() - start.getTime();
  return Math.round(diffTime / 86400000);
}

/**
 * Computes the Adapalene night routine plan based on routineStartDate
 */
export function computeNightPlan(routineStartDate, refToday = todayStr()) {
  const startStr = routineStartDate || refToday;
  const n = daysSince(startStr, refToday);

  if (n < 0) {
    return {
      phase: 'Not started yet',
      week: 0,
      daysElapsed: n,
      useAdapalene: false,
      label: 'Adapalene starts on ' + startStr,
      instructions: 'Wash → Moisturizer only',
      subtext: `Starting date is in the future (${startStr}). Stick to gentle wash and moisturizer.`
    };
  }

  const week = Math.floor(n / 7) + 1;

  if (week <= 2) {
    const useAdapalene = n % 2 === 0;
    const label = useAdapalene ? 'Adapalene night' : 'Rest night — skip adapalene';
    const phase = `Build-up, week ${week} of 2 — every other night`;
    return {
      phase,
      week,
      daysElapsed: n,
      useAdapalene,
      label,
      instructions: useAdapalene
        ? 'Wash → Adapalene → Moisturizer'
        : 'Wash → Moisturizer only',
      subtext: useAdapalene
        ? `${label} · ${phase}. Active pimple? Spot-treat with benzoyl peroxide on a different spot only.`
        : `${label} · ${phase}. Active pimple? Fine to spot-treat with benzoyl peroxide tonight.`
    };
  }

  if (week <= 4) {
    const label = 'Adapalene night (skip only if your skin feels very irritated)';
    const phase = `Build-up, week ${week} of 4 — nightly`;
    return {
      phase,
      week,
      daysElapsed: n,
      useAdapalene: true,
      label,
      instructions: 'Wash → Adapalene → Moisturizer',
      subtext: `${label} · ${phase}. Active pimple? Spot-treat with benzoyl peroxide on a different spot only.`
    };
  }

  const label = 'Adapalene night, as usual';
  const phase = 'Maintenance — nightly';
  return {
    phase,
    week,
    daysElapsed: n,
    useAdapalene: true,
    label,
    instructions: 'Wash → Adapalene → Moisturizer',
    subtext: `${label} · ${phase}. Active pimple? Spot-treat with benzoyl peroxide on a different spot only.`
  };
}

export function amGuideHtml() {
  return 'Wash <b>&rarr;</b> Azelaic acid 10% <b>&rarr;</b> Moisturizer <b>&rarr;</b> Sunscreen';
}

export function pmGuideHtml(plan) {
  if (plan.useAdapalene) {
    return `Wash <b>&rarr;</b> Adapalene <b>&rarr;</b> Moisturizer<span class="phase">${plan.subtext}</span>`;
  }
  return `Wash <b>&rarr;</b> Moisturizer only<span class="phase">${plan.subtext}</span>`;
}

/**
 * Streak computation:
 * Current streak: consecutive days ending today or yesterday where both AM and PM were completed.
 * Today doesn't break the streak while it's still in progress (before both are logged).
 */
export function computeStreak(entries = {}, refToday = todayStr()) {
  const entryToday = entries[refToday];
  let cursor = parseDate(refToday);

  // If today is not yet both completed, streak counts up to yesterday
  if (!(entryToday && entryToday.am && entryToday.pm)) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (true) {
    const dStr = fmt(cursor);
    const e = entries[dStr];
    if (e && e.am && e.pm) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Longest streak: best historical run across all logged days
 */
export function computeLongest(entries = {}, refToday = todayStr()) {
  const dates = Object.keys(entries).sort();
  if (dates.length === 0) return 0;

  let longest = 0;
  let run = 0;
  const first = parseDate(dates[0]);
  const last = parseDate(refToday);
  let cur = new Date(first);

  while (cur <= last) {
    const dStr = fmt(cur);
    const e = entries[dStr];
    if (e && e.am && e.pm) {
      run++;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return longest;
}

/**
 * Missed-day count: past days (strictly before today) where AM+PM were not both done.
 */
export function computeMissed(entries = {}, refToday = todayStr()) {
  const dates = Object.keys(entries).sort();
  if (dates.length === 0) return 0;

  const first = parseDate(dates[0]);
  const yesterday = parseDate(refToday);
  yesterday.setDate(yesterday.getDate() - 1);

  let missed = 0;
  let cur = new Date(first);

  while (cur <= yesterday) {
    const dStr = fmt(cur);
    const e = entries[dStr];
    if (!(e && e.am && e.pm)) {
      missed++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return missed;
}

export function computeTotals(entries = {}) {
  const dates = Object.keys(entries);
  const totalTracked = dates.length;
  const bothDone = dates.filter(d => {
    const e = entries[d];
    return e && e.am && e.pm;
  }).length;
  const rate = totalTracked ? Math.round((bothDone / totalTracked) * 100) : 0;
  return { totalTracked, bothDone, rate };
}

/**
 * Heatmap cell status
 */
export function cellStatus(dStr, entries = {}, refToday = todayStr()) {
  if (!dStr) return 'blank';
  if (dStr > refToday) return 'blank';
  const e = entries[dStr];
  const am = !!(e && e.am);
  const pm = !!(e && e.pm);

  if (am && pm) return 'both';
  if (dStr === refToday) return 'pending';
  if (am) return 'am';
  if (pm) return 'pm';
  return 'missed';
}

export function cellDetails(dStr, entries = {}, refToday = todayStr()) {
  if (!dStr) return null;
  const status = cellStatus(dStr, entries, refToday);
  const e = entries[dStr] || {};
  return {
    date: dStr,
    dateFull: formatDateFull(dStr),
    status,
    am: !!e.am,
    pm: !!e.pm,
    amAt: e.amAt ? formatTime(e.amAt) : null,
    pmAt: e.pmAt ? formatTime(e.pmAt) : null
  };
}

/**
 * 12-week GitHub-style heatmap grid:
 * 7 rows (Sunday to Saturday, Sun at top) x 12 columns
 */
export function buildGridCells(refToday = todayStr(), totalWeeks = 12) {
  const totalDays = totalWeeks * 7;
  const today = parseDate(refToday);
  const start = new Date(today);
  start.setDate(start.getDate() - (totalDays - 1));

  // Align to Sunday (start of week)
  const startWeekday = start.getDay(); // 0 = Sunday
  start.setDate(start.getDate() - startWeekday);

  const cells = [];
  let cur = new Date(start);
  while (cur <= today) {
    cells.push(fmt(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // Pad to complete the final column
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

/**
 * WhatsApp message generator for one-tap AM/PM check-in
 */
export function waMessageForSlot(slot, entries = {}, settings = {}, refToday = todayStr()) {
  const streak = computeStreak(entries, refToday);
  const streakTxt = `${streak} day${streak === 1 ? '' : 's'}`;
  const todayEntry = entries[refToday] || {};

  if (slot === 'am') {
    const timeStr = formatTime(todayEntry.amAt) || 'just now';
    return `Morning skincare done (${timeStr}). Streak: ${streakTxt}.`;
  }

  const plan = computeNightPlan(settings.routineStartDate, refToday);
  const planTxt = plan.useAdapalene ? 'adapalene night' : 'rest night, no adapalene';
  const timeStr = formatTime(todayEntry.pmAt) || 'just now';
  return `Night skincare done (${timeStr}, ${planTxt}). Streak: ${streakTxt}.`;
}

/**
 * WhatsApp manual check-in message
 */
export function waMessageNow(entries = {}, refToday = todayStr()) {
  const todayEntry = entries[refToday] || { am: false, pm: false };
  if (todayEntry.am && todayEntry.pm) {
    return 'Check-in: done both AM + PM today.';
  }
  if (todayEntry.am && !todayEntry.pm) {
    return 'Check-in: only did AM today so far, still missing night routine.';
  }
  if (!todayEntry.am && todayEntry.pm) {
    return 'Check-in: only did PM today so far, still missing morning routine.';
  }
  return "Check-in: haven't done my routine yet today.";
}
