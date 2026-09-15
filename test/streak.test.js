import assert from 'node:assert';
import {
  computeStreak,
  computeLongest,
  computeMissed,
  computeNightPlan,
  buildGridCells,
  cellStatus,
  waMessageForSlot,
  waMessageNow,
  daysSince
} from '../src/streak.js';

console.log('Running streak logic verification tests...');

// Test 1: Day-by-day night plan progression
const start = '2026-09-01';

// Day 0: Week 1, Day 0 -> even -> adapalene night
const d0 = computeNightPlan(start, '2026-09-01');
assert.strictEqual(d0.week, 1);
assert.strictEqual(d0.useAdapalene, true);
assert.match(d0.label, /Adapalene night/);

// Day 1: Week 1, Day 1 -> odd -> rest night
const d1 = computeNightPlan(start, '2026-09-02');
assert.strictEqual(d1.week, 1);
assert.strictEqual(d1.useAdapalene, false);
assert.match(d1.label, /Rest night/);

// Day 14: Week 3 (14 / 7 = 2 + 1 = 3) -> nightly adapalene
const d14 = computeNightPlan(start, '2026-09-15');
assert.strictEqual(d14.week, 3);
assert.strictEqual(d14.useAdapalene, true);
assert.match(d14.phase, /week 3 of 4/);

// Day 35: Week 6 -> Maintenance nightly
const d35 = computeNightPlan(start, '2026-10-06');
assert.strictEqual(d35.week, 6);
assert.strictEqual(d35.useAdapalene, true);
assert.match(d35.phase, /Maintenance/);

// Test 2: Streak calculation
// Case A: Today not yet done, but yesterday and day before were done
const mockEntriesA = {
  '2026-09-13': { am: true, pm: true },
  '2026-09-14': { am: true, pm: true },
  '2026-09-15': { am: true, pm: false } // today in progress
};
assert.strictEqual(computeStreak(mockEntriesA, '2026-09-15'), 2);

// Case B: Today both done -> streak is 3
const mockEntriesB = {
  '2026-09-13': { am: true, pm: true },
  '2026-09-14': { am: true, pm: true },
  '2026-09-15': { am: true, pm: true }
};
assert.strictEqual(computeStreak(mockEntriesB, '2026-09-15'), 3);
assert.strictEqual(computeLongest(mockEntriesB, '2026-09-15'), 3);

// Case C: Broken streak yesterday
const mockEntriesC = {
  '2026-09-12': { am: true, pm: true },
  '2026-09-13': { am: true, pm: false }, // broken
  '2026-09-14': { am: true, pm: true },
  '2026-09-15': { am: false, pm: false }
};
assert.strictEqual(computeStreak(mockEntriesC, '2026-09-15'), 1);
assert.strictEqual(computeLongest(mockEntriesC, '2026-09-15'), 1);

// Test 3: Missed count
assert.strictEqual(computeMissed(mockEntriesC, '2026-09-15'), 1); // Only 2026-09-13 is past and incomplete

// Test 4: Heatmap grid structure
const cells = buildGridCells('2026-09-15', 12);
assert.strictEqual(cells.length % 7, 0); // Multiple of 7
assert.ok(cells.length >= 84); // At least 12 weeks

// Test 5: Cell status
assert.strictEqual(cellStatus('2026-09-14', mockEntriesC, '2026-09-15'), 'both');
assert.strictEqual(cellStatus('2026-09-13', mockEntriesC, '2026-09-15'), 'am');
assert.strictEqual(cellStatus('2026-09-15', mockEntriesC, '2026-09-15'), 'pending');

// Test 6: WhatsApp message formatting
const settings = { friendPhone: '919876543210', routineStartDate: '2026-09-01' };
const msgAm = waMessageForSlot('am', mockEntriesB, settings, '2026-09-15');
assert.match(msgAm, /^Morning skincare done/);
assert.match(msgAm, /Streak: 3 days\./);

const msgPm = waMessageForSlot('pm', mockEntriesB, settings, '2026-09-15');
assert.match(msgPm, /^Night skincare done/);
assert.match(msgPm, /adapalene night/);
assert.match(msgPm, /Streak: 3 days\./);

console.log('All streak logic tests passed successfully!');
