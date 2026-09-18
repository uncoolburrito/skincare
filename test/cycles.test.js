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
  formatManualWhatsAppMessage
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

console.log('=== All 6 Test Suites Passed Successfully! ===');
