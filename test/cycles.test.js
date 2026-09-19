import assert from 'node:assert';
import {
  handleCheckIn,
  handleUnCheckIn,
  getOpenCycle,
  isCycleComplete,
  computeTonightPlan,
  computeAdapalenePhase,
  computeCycleStreak,
  computeLongestCycleStreak,
  computeMissedCycles,
  checkAdaptiveNudge,
  buildCycleTimeline,
  formatWhatsAppMessage,
  formatManualWhatsAppMessage,
  computeProgressScore,
  getProgressMilestone,
  TAU_GAIN,
  TAU_DECAY,
  decayFactor,
  computePersonalGaps,
  computeRiskRingState,
  getGraceEligibility,
  computeCycleStreakWithGrace,
  formatProactivePartnerAlert
} from '../src/cycles.js';

console.log('=== Running Skin Streak v3 Cycle Engine Tests ===');

// -----------------------------------------------------------------------------
// 1. Cycle-Filling Logic
// -----------------------------------------------------------------------------
console.log('Test 1: Cycle-filling and open-cycle mechanics...');

let cycles = [];
// 1a. First check-in: After Sleep
let res = handleCheckIn(cycles, 'afterSleep', { id: 'c1', timestamp: '2026-09-01T08:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 1);
assert.strictEqual(cycles[0].after_sleep_at, '2026-09-01T08:00:00Z');
assert.strictEqual(cycles[0].before_sleep_at, null);
assert.strictEqual(isCycleComplete(cycles[0]), false);
assert.strictEqual(getOpenCycle(cycles)?.id, 'c1');

// 1b. Complementary check-in: Before Sleep into same open cycle
res = handleCheckIn(cycles, 'beforeSleep', { timestamp: '2026-09-01T23:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 1);
assert.strictEqual(cycles[0].before_sleep_at, '2026-09-01T23:00:00Z');
assert.strictEqual(cycles[0].adapalene, true); // First night is adapalene
assert.strictEqual(isCycleComplete(cycles[0]), true);
assert.strictEqual(getOpenCycle(cycles), null); // Now closed!

// 1c. Repeated check-in of same type: Before Sleep again without After Sleep
// Should start a NEW cycle c2 with beforeSleep, leaving c2's after_sleep_at null
res = handleCheckIn(cycles, 'beforeSleep', { id: 'c2', timestamp: '2026-09-02T22:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 2);
assert.strictEqual(cycles[1].id, 'c2');
assert.strictEqual(cycles[1].after_sleep_at, null);
assert.strictEqual(cycles[1].before_sleep_at, '2026-09-02T22:00:00Z');
assert.strictEqual(cycles[1].adapalene, false); // Rest night because previous was adapalene!
assert.strictEqual(getOpenCycle(cycles)?.id, 'c2');

// 1d. Repeated same-type check-in: Before Sleep AGAIN!
// Should leave c2's afterSleep permanently null (a real miss) and start c3!
res = handleCheckIn(cycles, 'beforeSleep', { id: 'c3', timestamp: '2026-09-03T21:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 3);
assert.strictEqual(cycles[1].after_sleep_at, null); // permanently missed
assert.strictEqual(cycles[2].id, 'c3');
assert.strictEqual(getOpenCycle(cycles)?.id, 'c3');

// 1e. Fill After Sleep into c3
res = handleCheckIn(cycles, 'afterSleep', { timestamp: '2026-09-04T07:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 3);
assert.strictEqual(cycles[2].after_sleep_at, '2026-09-04T07:00:00Z');
assert.strictEqual(isCycleComplete(cycles[2]), true);

// 1f. Un-tapping test
res = handleCheckIn(cycles, 'afterSleep', { id: 'c4', timestamp: '2026-09-05T09:00:00Z' });
cycles = res.updatedCycles;
assert.strictEqual(cycles.length, 4);
const uncheckRes = handleUnCheckIn(cycles, 'afterSleep');
cycles = uncheckRes.updatedCycles;
assert.strictEqual(cycles.length, 3); // c4 removed since both fields became null

console.log('✓ Cycle filling mechanics verified.');

// -----------------------------------------------------------------------------
// 2. Adaptive Adapalene Schedule & Lazy-Skip Logic
// -----------------------------------------------------------------------------
console.log('Test 2: Adaptive Adapalene schedule & lazy skip verification...');

// Phase 1 (< 7 adapalene nights)
const testCyclesPhase1 = [];
assert.strictEqual(computeAdapalenePhase(testCyclesPhase1).key, 'build-up');
assert.strictEqual(computeTonightPlan(testCyclesPhase1).plan, 'ADAPALENE');

// Log 1 adapalene
testCyclesPhase1.push({
  id: 't1',
  after_sleep_at: '2026-09-01T08:00:00Z',
  before_sleep_at: '2026-09-01T23:00:00Z',
  adapalene: true
});
// Next night should recommend REST
assert.strictEqual(computeTonightPlan(testCyclesPhase1).plan, 'REST');

// LAZY SKIP TEST:
// Owner skips Before Sleep for an entire cycle!
testCyclesPhase1.push({
  id: 't2',
  after_sleep_at: '2026-09-02T08:00:00Z',
  before_sleep_at: null, // SKIPPED!
  adapalene: null
});
// A forgotten night can NEVER be silently treated as a rest night!
// Because the most recent logged beforeSleep was t1 (adapalene = true),
// tonight's plan MUST still be REST!
assert.strictEqual(computeTonightPlan(testCyclesPhase1).plan, 'REST');

// Now log a REST night in t3
testCyclesPhase1.push({
  id: 't3',
  after_sleep_at: '2026-09-03T08:00:00Z',
  before_sleep_at: '2026-09-03T23:00:00Z',
  adapalene: false // REST
});

// Next night after REST must recommend ADAPALENE
assert.strictEqual(computeTonightPlan(testCyclesPhase1).plan, 'ADAPALENE');

// Lazy skip after REST: skip a whole cycle
testCyclesPhase1.push({
  id: 't4',
  after_sleep_at: '2026-09-04T08:00:00Z',
  before_sleep_at: null,
  adapalene: null
});
// Lookup still finds t3 (rest) -> must still recommend ADAPALENE
assert.strictEqual(computeTonightPlan(testCyclesPhase1).plan, 'ADAPALENE');

// Phase 2: Building Nightly (7 to 20 adapalene nights)
const testCyclesPhase2 = [];
for (let i = 0; i < 7; i++) {
  testCyclesPhase2.push({
    id: `p2_${i}`,
    after_sleep_at: '2026-09-01T08:00:00Z',
    before_sleep_at: '2026-09-01T23:00:00Z',
    adapalene: true
  });
}
assert.strictEqual(computeAdapalenePhase(testCyclesPhase2).key, 'building-nightly');
assert.strictEqual(computeTonightPlan(testCyclesPhase2).plan, 'ADAPALENE');

// Even if previous night was adapalene, in building-nightly plan is always ADAPALENE
assert.strictEqual(computeTonightPlan(testCyclesPhase2).useAdapalene, true);

// Phase 3: Maintenance (>= 21 adapalene nights)
const testCyclesPhase3 = [];
for (let i = 0; i < 21; i++) {
  testCyclesPhase3.push({
    id: `p3_${i}`,
    after_sleep_at: '2026-09-01T08:00:00Z',
    before_sleep_at: '2026-09-01T23:00:00Z',
    adapalene: true
  });
}
assert.strictEqual(computeAdapalenePhase(testCyclesPhase3).key, 'maintenance');
assert.strictEqual(computeTonightPlan(testCyclesPhase3).plan, 'ADAPALENE');

console.log('✓ Adaptive adapalene and lazy-skip logic verified.');

// -----------------------------------------------------------------------------
// 3. Streak & Missed Metrics
// -----------------------------------------------------------------------------
console.log('Test 3: Streak and missed counts...');

// Case A: 3 complete cycles
const streakCyclesA = [
  { id: 's1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: true },
  { id: 's2', after_sleep_at: 'T3', before_sleep_at: 'T4', adapalene: false },
  { id: 's3', after_sleep_at: 'T5', before_sleep_at: 'T6', adapalene: true }
];
assert.strictEqual(computeCycleStreak(streakCyclesA), 3);
assert.strictEqual(computeLongestCycleStreak(streakCyclesA), 3);
assert.strictEqual(computeMissedCycles(streakCyclesA), 0);

// Case B: 3 complete cycles + current open cycle in progress (After Sleep only)
// The current open cycle doesn't break the streak while genuinely in progress!
const streakCyclesB = [
  ...streakCyclesA,
  { id: 's4', after_sleep_at: 'T7', before_sleep_at: null, adapalene: null }
];
assert.strictEqual(computeCycleStreak(streakCyclesB), 3);
assert.strictEqual(computeMissedCycles(streakCyclesB), 0); // s4 is in progress, not missed!

// Case C: Gap/break in the past
const streakCyclesC = [
  { id: 'c1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: true },
  { id: 'c2', after_sleep_at: 'T3', before_sleep_at: null, adapalene: null }, // MISSED!
  { id: 'c3', after_sleep_at: 'T5', before_sleep_at: 'T6', adapalene: true },
  { id: 'c4', after_sleep_at: 'T7', before_sleep_at: 'T8', adapalene: false }
];
assert.strictEqual(computeCycleStreak(streakCyclesC), 2); // c3 and c4
assert.strictEqual(computeLongestCycleStreak(streakCyclesC), 2);
assert.strictEqual(computeMissedCycles(streakCyclesC), 1); // c2 is missed

// Case D: Reset clears cycles -> streak returns to 0
assert.strictEqual(computeCycleStreak([]), 0);
assert.strictEqual(computeLongestCycleStreak([]), 0);
assert.strictEqual(computeMissedCycles([]), 0);

console.log('✓ Streak and missed count mechanics verified.');

// -----------------------------------------------------------------------------
// 4. Adaptive Nudge Banner
// -----------------------------------------------------------------------------
console.log('Test 4: Adaptive Nudge Banner...');

const now = Date.now();
const past15h = new Date(now - 15 * 3600000).toISOString();
const past5h = new Date(now - 5 * 3600000).toISOString();

// Open cycle with After Sleep logged 15 hours ago (> 14h threshold)
const nudgeCyclesA = [
  { id: 'n1', after_sleep_at: past15h, before_sleep_at: null, adapalene: null }
];
const nudgeA = checkAdaptiveNudge(nudgeCyclesA, 14);
assert.ok(nudgeA);
assert.strictEqual(nudgeA.pendingType, 'beforeSleep');
assert.strictEqual(nudgeA.hours, 15);

// Open cycle with After Sleep logged 5 hours ago (<= 14h threshold)
const nudgeCyclesB = [
  { id: 'n2', after_sleep_at: past5h, before_sleep_at: null, adapalene: null }
];
assert.strictEqual(checkAdaptiveNudge(nudgeCyclesB, 14), null);

console.log('✓ Adaptive nudge banner logic verified.');

// -----------------------------------------------------------------------------
// 5. Timeline Strip Generation
// -----------------------------------------------------------------------------
console.log('Test 5: Cycle Timeline Strip...');

const timelineCycles = [
  { id: 'm1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: true },
  { id: 'm2', after_sleep_at: 'T3', before_sleep_at: 'T4', adapalene: false },
  { id: 'm3', after_sleep_at: 'T5', before_sleep_at: null, adapalene: null }, // past missed
  { id: 'm4', after_sleep_at: 'T7', before_sleep_at: null, adapalene: null }  // current open
];

const timeline = buildCycleTimeline(timelineCycles, 60);
assert.strictEqual(timeline.length, 4);

// m1: gold / adapalene indigo
assert.strictEqual(timeline[0].afterState, 'done');
assert.strictEqual(timeline[0].beforeState, 'adapalene');

// m2: gold / intentional rest sage
assert.strictEqual(timeline[1].afterState, 'done');
assert.strictEqual(timeline[1].beforeState, 'rest');

// m3: gold / missed brick red
assert.strictEqual(timeline[2].afterState, 'done');
assert.strictEqual(timeline[2].beforeState, 'missed');

// m4 (current open): gold / pending blank
assert.strictEqual(timeline[3].afterState, 'done');
assert.strictEqual(timeline[3].beforeState, 'pending');

console.log('✓ Timeline strip markers verified.');

// -----------------------------------------------------------------------------
// 6. WhatsApp Messages
// -----------------------------------------------------------------------------
console.log('Test 6: WhatsApp message formatting...');

const msgAfter = formatWhatsAppMessage('afterSleep', { after_sleep_at: '2026-09-01T08:30:00Z' }, 3);
assert.match(msgAfter, /^After Sleep skincare done/);
assert.match(msgAfter, /Streak: 3 cycles\./);

const msgBeforeAdapalene = formatWhatsAppMessage('beforeSleep', { before_sleep_at: '2026-09-01T22:45:00Z', adapalene: true }, 4);
assert.match(msgBeforeAdapalene, /^Before Sleep skincare done/);
assert.match(msgBeforeAdapalene, /adapalene/);
assert.match(msgBeforeAdapalene, /Streak: 4 cycles\./);

const msgBeforeRest = formatWhatsAppMessage('beforeSleep', { before_sleep_at: '2026-09-01T22:45:00Z', adapalene: false }, 4);
assert.match(msgBeforeRest, /^Before Sleep skincare done/);
assert.match(msgBeforeRest, /intentional rest/);

console.log('✓ WhatsApp messages verified.');

// -----------------------------------------------------------------------------
// 7. Guide Card State Reconciliation (Fix 2)
// -----------------------------------------------------------------------------
console.log('Test 7: Before Sleep guide card state reconciliation...');

const reconciliationCycles = [
  { id: 'c_prior', after_sleep_at: '2026-09-15T08:00:00Z', before_sleep_at: null, adapalene: null },
  { id: 'c_tonight', after_sleep_at: null, before_sleep_at: '2026-09-18T23:06:00Z', adapalene: true }
];

const open = getOpenCycle(reconciliationCycles);
assert.strictEqual(open?.id, 'c_tonight');
assert.strictEqual(open.adapalene, true);

// Prior plan before this check-in:
const priorCycles = reconciliationCycles.map(c => c.id === open.id ? { ...c, before_sleep_at: null, adapalene: null } : c);
const priorPlan = computeTonightPlan(priorCycles);
assert.strictEqual(priorPlan.plan, 'ADAPALENE');

// Next plan after this check-in:
const nextPlan = computeTonightPlan(reconciliationCycles);
assert.strictEqual(nextPlan.plan, 'REST');

// Phase count must include the logged night:
const phase = computeAdapalenePhase(reconciliationCycles);
assert.strictEqual(phase.count, 1);
assert.strictEqual(phase.key, 'build-up');

console.log('✓ Guide card state reconciliation verified.');

// -----------------------------------------------------------------------------
// 8. Progress Score Algorithm & Sanity-Check Fixtures
// -----------------------------------------------------------------------------
console.log('Test 8: Progress Score algorithm & sanity-check fixtures...');

// Constants verification
assert.strictEqual(TAU_GAIN, 60);
assert.strictEqual(TAU_DECAY, 58);

// Empty state
assert.strictEqual(computeProgressScore([]).score, 0);
assert.strictEqual(computeProgressScore([]).roundedScore, 0);
assert.strictEqual(computeProgressScore([]).milestone.band, '0-39');
assert.strictEqual(computeProgressScore([]).milestone.label, 'Just started');

// Fixture 1: 30 days perfect consistency (P is about 39)
const c30 = Array.from({ length: 30 }, (_, i) => ({
  id: `c30_${i}`,
  after_sleep_at: `2026-01-${String(i + 1).padStart(2, '0')}T08:00:00Z`,
  before_sleep_at: `2026-01-${String(i + 1).padStart(2, '0')}T23:00:00Z`,
  adapalene: i % 2 === 0
}));
const res30 = computeProgressScore(c30);
assert.strictEqual(res30.roundedScore, 39);
assert.ok(res30.score >= 39.0 && res30.score <= 39.7, `Expected ~39, got ${res30.score}`);
assert.strictEqual(res30.milestone.band, '0-39');

// Fixture 2: 42 days (6 weeks) perfect consistency (P is about 50)
const c42 = Array.from({ length: 42 }, (_, i) => ({
  id: `c42_${i}`,
  after_sleep_at: 'T1',
  before_sleep_at: 'T2',
  adapalene: i % 2 === 0
}));
const res42 = computeProgressScore(c42);
assert.strictEqual(res42.roundedScore, 50);
assert.ok(res42.score >= 50.0 && res42.score <= 50.7, `Expected ~50, got ${res42.score}`);
assert.strictEqual(res42.milestone.band, '40-74');
assert.strictEqual(res42.milestone.label, 'Initial improvement window');

// Fixture 3: 84 days (12 weeks) perfect consistency (P is about 75)
const c84 = Array.from({ length: 84 }, (_, i) => ({
  id: `c84_${i}`,
  after_sleep_at: 'T1',
  before_sleep_at: 'T2',
  adapalene: true
}));
const res84 = computeProgressScore(c84);
assert.strictEqual(res84.roundedScore, 75);
assert.ok(res84.score >= 75.0 && res84.score <= 75.7, `Expected ~75, got ${res84.score}`);
assert.strictEqual(res84.milestone.band, '75-94');
assert.strictEqual(res84.milestone.label, 'Clearest change window');

// Fixture 4: 180 days (6 months) perfect consistency (P is about 95)
const c180 = Array.from({ length: 180 }, (_, i) => ({
  id: `c180_${i}`,
  after_sleep_at: 'T1',
  before_sleep_at: 'T2',
  adapalene: true
}));
const res180 = computeProgressScore(c180);
assert.strictEqual(res180.roundedScore, 95);
assert.ok(res180.score >= 94.8 && res180.score <= 95.3, `Expected ~95, got ${res180.score}`);
assert.strictEqual(res180.milestone.band, '95-100');
assert.strictEqual(res180.milestone.label, 'Long-term maintenance');

// Fixture 5: One single missed cycle at P=75 drops to about 73.7
const c84_1miss = [...c84, { status: 'miss', elapsedDays: 1 }];
const res1miss = computeProgressScore(c84_1miss);
assert.ok(res1miss.score >= 73.5 && res1miss.score <= 74.2, `Expected ~73.7, got ${res1miss.score}`);
assert.strictEqual(Math.round(75 * decayFactor(1) * 10) / 10, 73.7);

// Fixture 6: 7 consecutive missed cycles at P=75 drops to about 66.5
const c84_7misses = [...c84, { status: 'miss', elapsedDays: 7 }];
const res7miss = computeProgressScore(c84_7misses);
assert.ok(res7miss.score >= 66.2 && res7miss.score <= 67.0, `Expected ~66.5, got ${res7miss.score}`);
assert.strictEqual(Math.round(75 * decayFactor(7) * 10) / 10, 66.5);

// Fixture 7: About 40 consecutive missed cycles at P=75 drops to about 37.5
const c84_40misses = [...c84, { status: 'miss', elapsedDays: 40 }];
const res40miss = computeProgressScore(c84_40misses);
assert.ok(res40miss.score >= 37.0 && res40miss.score <= 38.0, `Expected ~37.5, got ${res40miss.score}`);
assert.strictEqual(Math.round(75 * decayFactor(40) * 10) / 10, 37.6);

// Design Decision 1: Intentional Rest Night parity with Adapalene night
const adapaleneNight = [{ id: 'a1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: true }];
const restNight = [{ id: 'r1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: false }];
assert.strictEqual(computeProgressScore(adapaleneNight).score, computeProgressScore(restNight).score);

// Partial credit: exactly one half filled earns 0.5 * g * (100 - P)
const partialNight = [{ id: 'p1', after_sleep_at: 'T1', before_sleep_at: null, isResolved: true, adapalene: null }];
const g = 1 - Math.exp(-1 / 60);
assert.ok(Math.abs(computeProgressScore(partialNight).score - (0.5 * g * 100)) < 0.0001);

// Grace period: open in-progress cycle does not score until resolved
const withOpenCycle = [
  ...c30,
  { id: 'open_today', after_sleep_at: '2026-02-01T08:00:00Z', before_sleep_at: null, adapalene: null }
];
assert.strictEqual(computeProgressScore(withOpenCycle).score, computeProgressScore(c30).score);

console.log('✓ Progress Score algorithm & sanity-check fixtures verified.');

// -----------------------------------------------------------------------------
// 9. Miss-Prevention Design Engine
// -----------------------------------------------------------------------------
console.log('Test 9: Miss-prevention mechanisms (JITAI, Risk Ring, Bounded Grace, Proactive Alert)...');

// 9a. JITAI Personal Gaps: Defaults when < 3 samples
const emptyGaps = computePersonalGaps([]);
assert.strictEqual(emptyGaps.typicalWakingGapHours, 15.0);
assert.strictEqual(emptyGaps.typicalSleepingGapHours, 9.0);
assert.strictEqual(emptyGaps.wakingSamples, 0);

// 9b. JITAI Personal Gaps: Rolling average calculation from real cycles
// Create 4 cycles with 16h waking gap and 8h sleeping gap
const circadianCycles = [];
let baseTime = new Date('2026-09-01T08:00:00Z').getTime();
for (let i = 0; i < 4; i++) {
  const afterAt = new Date(baseTime).toISOString();
  const beforeAt = new Date(baseTime + 16 * 3600000).toISOString(); // 16h waking gap
  circadianCycles.push({
    id: `circ_${i}`,
    after_sleep_at: afterAt,
    before_sleep_at: beforeAt,
    adapalene: true
  });
  baseTime += 24 * 3600000; // next afterSleep is 8h after beforeSleep (16h + 8h = 24h)
}
const computedGaps = computePersonalGaps(circadianCycles);
assert.strictEqual(computedGaps.typicalWakingGapHours, 16.0);
assert.strictEqual(computedGaps.typicalSleepingGapHours, 8.0);
assert.strictEqual(computedGaps.wakingSamples, 4);
assert.strictEqual(computedGaps.sleepingSamples, 3);

// 9c. Risk Ring State: Green (< 70%), Amber (70-99%), Red (>= 100%)
const testOpenCycle = {
  id: 'open_risk',
  after_sleep_at: '2026-09-10T08:00:00Z',
  before_sleep_at: null,
  adapalene: null
};
const riskCycles = [...circadianCycles, testOpenCycle];

// Green zone: 5h elapsed (5 / 16 = 31.25% < 70%)
const greenTime = new Date('2026-09-10T13:00:00Z').getTime();
const ringGreen = computeRiskRingState(riskCycles, computedGaps, 5, 60, greenTime);
assert.strictEqual(ringGreen.zone, 'green');
assert.strictEqual(ringGreen.color, '#059669');
assert.strictEqual(ringGreen.label, 'Buffer Healthy');
assert.ok(ringGreen.percentRemaining > 60);

// Amber zone: 12h elapsed (12 / 16 = 75% in 70..99%)
const amberTime = new Date('2026-09-10T20:00:00Z').getTime();
const ringAmber = computeRiskRingState(riskCycles, computedGaps, 5, 60, amberTime);
assert.strictEqual(ringAmber.zone, 'amber');
assert.strictEqual(ringAmber.color, '#D97706');
assert.strictEqual(ringAmber.label, 'Approaching Window');
assert.ok(ringAmber.lossFramedCopy.includes('5-cycles streak'));

// Red zone: 17h elapsed (17 / 16 = 106% >= 100%)
const redTime = new Date('2026-09-11T01:00:00Z').getTime();
const ringRed = computeRiskRingState(riskCycles, computedGaps, 5, 60, redTime);
assert.strictEqual(ringRed.zone, 'red');
assert.strictEqual(ringRed.color, '#B45341');
assert.strictEqual(ringRed.label, 'Past Typical Window');
assert.strictEqual(ringRed.percentRemaining, 0);
assert.ok(ringRed.lossFramedCopy.includes('protect your 5-cycles streak and current progress score (60)'));

// 9d. Grace Eligibility (1 per rolling 30 real days)
const nowTest = new Date('2026-09-19T10:00:00Z').getTime();
assert.strictEqual(getGraceEligibility([], nowTest).isEligible, true);

// Grace used 10 days ago -> NOT eligible
const tenDaysAgo = new Date(nowTest - 10 * 24 * 3600000).toISOString();
assert.strictEqual(getGraceEligibility([{ timestamp: tenDaysAgo, cycleId: 'c_old' }], nowTest).isEligible, false);

// Grace used 35 days ago -> ELIGIBLE (pruned/expired)
const thirtyFiveDaysAgo = new Date(nowTest - 35 * 24 * 3600000).toISOString();
assert.strictEqual(getGraceEligibility([{ timestamp: thirtyFiveDaysAgo, cycleId: 'c_expired' }], nowTest).isEligible, true);

// 9e. Bounded Streak Grace Calculation:
// Setup: 4 completed cycles, 1 missed cycle, 2 completed cycles
const streakCycles = [
  { id: 'sc1', after_sleep_at: 'T1', before_sleep_at: 'T2', adapalene: true },
  { id: 'sc2', after_sleep_at: 'T3', before_sleep_at: 'T4', adapalene: false },
  { id: 'sc3', after_sleep_at: 'T5', before_sleep_at: 'T6', adapalene: true },
  { id: 'sc4', after_sleep_at: 'T7', before_sleep_at: 'T8', adapalene: true },
  { id: 'sc_miss', after_sleep_at: 'T9', before_sleep_at: null, adapalene: null }, // Missed cycle
  { id: 'sc5', after_sleep_at: 'T11', before_sleep_at: 'T12', adapalene: true },
  { id: 'sc6', after_sleep_at: 'T13', before_sleep_at: 'T14', adapalene: false }
];

// Standard streak without grace breaks at miss -> streak is 2 (sc5 and sc6)
assert.strictEqual(computeCycleStreak(streakCycles), 2);

// Streak with grace shields sc_miss -> streak is 6 (4 + 2)
const graceResult = computeCycleStreakWithGrace(streakCycles, [], nowTest);
assert.strictEqual(graceResult.streak, 6);
assert.strictEqual(graceResult.graceApplied, true);
assert.strictEqual(graceResult.shieldedCycleId, 'sc_miss');

// Two misses: 2 completed, 1 miss, 2 completed, 1 miss, 2 completed
// Only 1 miss can be shielded in a 30-day window
const twoMissCycles = [
  { id: 'tm1', after_sleep_at: 'T1', before_sleep_at: 'T2' },
  { id: 'tm2', after_sleep_at: 'T3', before_sleep_at: 'T4' },
  { id: 'tm_miss1', after_sleep_at: 'T5', before_sleep_at: null }, // older miss
  { id: 'tm3', after_sleep_at: 'T7', before_sleep_at: 'T8' },
  { id: 'tm4', after_sleep_at: 'T9', before_sleep_at: 'T10' },
  { id: 'tm_miss2', after_sleep_at: 'T11', before_sleep_at: null }, // recent miss
  { id: 'tm5', after_sleep_at: 'T13', before_sleep_at: 'T14' },
  { id: 'tm6', after_sleep_at: 'T15', before_sleep_at: 'T16' }
];
const twoMissResult = computeCycleStreakWithGrace(twoMissCycles, [], nowTest);
assert.strictEqual(twoMissResult.streak, 4);
assert.strictEqual(twoMissResult.graceApplied, true);

// 9f. Strict Progress Score Immunity:
// Progress Score MUST NEVER be affected by graceLog or shielded status
assert.strictEqual(typeof computeProgressScore, 'function');
assert.strictEqual(computeProgressScore.length, 0); // cycles = [] has default value
const scoreWithoutGrace = computeProgressScore(streakCycles);
assert.ok(scoreWithoutGrace.score > 0);
const scoreWithExtraneous = computeProgressScore(streakCycles, [{ timestamp: '2026-09-19', cycleId: 'sc_miss' }]);
assert.strictEqual(scoreWithExtraneous.score, scoreWithoutGrace.score);

// 9g. Timeline Marker Shielded State
const shieldedTimeline = buildCycleTimeline(streakCycles, 60, ['sc_miss']);
const shieldedMarker = shieldedTimeline.find(m => m.id === 'sc_miss');
assert.strictEqual(shieldedMarker.isShielded, true);
assert.strictEqual(shieldedMarker.beforeState, 'shielded');

// 9h. Proactive Partner Alert WhatsApp Format
const alertMsg = formatProactivePartnerAlert('Alex', 'beforeSleep', 17.5, 15);
assert.ok(alertMsg.includes('Alex'));
assert.ok(alertMsg.includes('Before Sleep'));
assert.ok(alertMsg.includes('18h vs typical 15h'));
assert.ok(alertMsg.includes('Could you check in on them?'));

console.log('✓ Miss-prevention design engine & research mechanisms verified.');

console.log('=== All 9 Test Suites Passed Successfully! ===');


