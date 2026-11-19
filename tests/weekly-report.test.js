import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseWeek, weekStatus, weekDates, countedDays, macroSplit, targetsForWeek, compareWeeks,
  buildWeeklyReport, weekSummaries, ON_TARGET_TOLERANCE,
} from '../src/core/weekly-report.js';
import { addDays } from '../src/core/dates.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const TARGETS = { kcal: 2000, protein: 150, carbs: 200, fat: 70, source: 'manual' };
const VOL = { primary: 1, secondary: 0.5, dropset: 0 };

/** Quick-add style diary entry: amount 100, per100 = totals. */
const E = (date, kcal, protein = 0, carbs = 0, fat = 0) => ({
  id: `${date}-${kcal}-${Math.random()}`, date, meal: 'lunch', foodId: null, name: 'x', amount: 100, basis: 'g',
  per100: { kcal, protein, carbs, fat, sugars: null, satFat: null, fibre: null, salt: null },
});
const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
const WO = (id, date, exerciseId, sets, finished = true) => ({
  id, date, routineId: null, name: `Session ${id}`, startedAt: 1, finishedAt: finished ? 2 : null,
  exercises: [{ exerciseId, targetSets: 3, targetReps: 8, targetRepsMax: null, sets, note: '' }],
});

const isClean = (v) => {
  if (typeof v === 'number') return Number.isFinite(v);
  if (v && typeof v === 'object') return Object.values(v).every(isClean);
  return true;
};

const report = (over) => buildWeeklyReport({
  today: '2026-11-18', entries: [], weights: [], workouts: [], exercises: EX, targets: TARGETS,
  history: [], goal: { rateKgPerWeek: 0 }, volumeWeights: VOL, setTargets: undefined, ...over,
});

test('week boundaries: Monday normalisation across month, year and DST changes', () => {
  assert.equal(normaliseWeek('2026-11-18'), '2026-11-16');
  assert.equal(normaliseWeek('2026-11-16'), '2026-11-16');
  assert.equal(normaliseWeek('2026-11-22'), '2026-11-16'); // Sunday belongs to the week before
  assert.equal(normaliseWeek('2026-03-01'), '2026-02-23'); // month change
  assert.equal(normaliseWeek('2027-01-01'), '2026-12-28'); // year change
  assert.equal(normaliseWeek('2026-03-29'), '2026-03-23'); // EU DST start (Sunday)
  assert.equal(normaliseWeek('2026-10-25'), '2026-10-19'); // EU DST end (Sunday)
  assert.equal(normaliseWeek('2026-02-30'), null);
  assert.equal(normaliseWeek('nope'), null);
  assert.deepEqual(weekDates('2026-12-28'), ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  assert.equal(weekDates('2026-10-19')[6], '2026-10-25');
  assert.equal(weekDates('2026-03-23').length, 7);
});

test('week status and counted days', () => {
  assert.equal(weekStatus('2026-11-16', '2026-11-18'), 'current');
  assert.equal(weekStatus('2026-11-09', '2026-11-18'), 'past');
  assert.equal(weekStatus('2026-11-23', '2026-11-18'), 'future');
  assert.equal(countedDays('2026-11-16', '2026-11-18'), 2); // Mon, Tue (today Wed excluded)
  assert.equal(countedDays('2026-11-16', '2026-11-16'), 0);
  assert.equal(countedDays('2026-11-09', '2026-11-18'), 7);
});

test('empty week: no data, nulls instead of NaN', () => {
  const r = report({ weekStart: '2026-11-09' });
  assert.equal(r.hasData, false);
  assert.equal(r.previous, null);
  assert.equal(r.nutrition.loggedDays, 0);
  assert.equal(r.nutrition.avg.kcal, null);
  assert.equal(r.nutrition.pct.kcal, null);
  assert.equal(r.nutrition.split, null);
  assert.equal(r.nutrition.highest, null);
  assert.equal(r.nutrition.total.pct, null);
  assert.equal(r.weight.change, null);
  assert.equal(r.training.loadPct, null);
  assert.ok(r.comparison.every((x) => x.pct === null && x.diff === null));
  assert.ok(isClean(r));
});

test('partially logged week: averages over complete days, percent of target, on-target days', () => {
  // Week 2026-11-09 .. 15. Context weeks so the median is ~2000.
  const entries = [];
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-11-02', '2026-11-03', '2026-11-04']) entries.push(E(d, 2000, 150, 200, 70));
  entries.push(E('2026-11-09', 2000, 150, 200, 70)); // on target
  entries.push(E('2026-11-10', 2150, 160, 220, 70)); // +7.5 % on target
  entries.push(E('2026-11-11', 2500, 120, 300, 90)); // +25 % over
  entries.push(E('2026-11-12', 600, 40, 60, 20)); // under-logged → incomplete
  // 13, 14, 15 not logged
  const r = report({ weekStart: '2026-11-12', entries }); // non-Monday → normalised
  const n = r.nutrition;
  assert.equal(r.weekStart, '2026-11-09');
  assert.equal(r.status, 'past');
  assert.equal(n.loggedDays, 4);
  assert.equal(n.completeDays, 3);
  assert.equal(n.incompleteDays, 1);
  assert.equal(n.days[3].incomplete, true);
  assert.equal(n.onTargetDays, 2);
  assert.equal(Math.round(n.avg.kcal), Math.round((2000 + 2150 + 2500) / 3)); // 2217
  assert.equal(n.pct.kcal, 111); // 2216.7 / 2000
  assert.equal(n.avg.protein, (150 + 160 + 120) / 3);
  assert.equal(n.pct.protein, Math.round(((430 / 3) / 150) * 100)); // 96
  assert.equal(n.highest.date, '2026-11-11');
  assert.equal(n.lowest.date, '2026-11-09'); // incomplete day not the lowest
  assert.equal(n.total.kcal, 6650);
  assert.equal(n.total.target, 6000);
  assert.equal(n.total.weekTarget, 14000);
  assert.equal(n.total.pct, 111);
  const sum = n.split.protein + n.split.carbs + n.split.fat;
  assert.equal(sum, 100);
  assert.deepEqual(macroSplit({ protein: 150, carbs: 200, fat: 70 }), n.targetSplit);
  assert.ok(isClean(r));
});

test('on-target tolerance is ±10 % inclusive', () => {
  assert.equal(ON_TARGET_TOLERANCE, 0.1);
  const entries = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => E(d, 2000));
  entries.push(E('2026-11-09', 2200), E('2026-11-10', 1800), E('2026-11-11', 2201), E('2026-11-12', 1799));
  const r = report({ weekStart: '2026-11-09', entries });
  assert.equal(r.nutrition.onTargetDays, 2);
});

test('in-progress week: today and later are not counted', () => {
  const entries = ['2026-11-02', '2026-11-03', '2026-11-04'].map((d) => E(d, 2000));
  entries.push(E('2026-11-16', 1900), E('2026-11-17', 2100), E('2026-11-18', 400)); // today partial
  const r = report({ weekStart: '2026-11-16', entries });
  assert.equal(r.status, 'current');
  assert.equal(r.nutrition.countedDays, 2);
  assert.equal(r.nutrition.loggedDays, 2);
  assert.equal(r.nutrition.avg.kcal, 2000);
  assert.equal(r.nutrition.days[2].isToday, true);
  assert.equal(r.nutrition.days[2].logged, false);
  assert.equal(r.nutrition.todaySoFar.kcal, 400);
  assert.equal(r.nutrition.days[3].isFuture, true);
  assert.equal(r.targets.source, 'current');
});

test('percentage maths never NaN/Infinity: zero targets, zero previous values', () => {
  const entries = [E('2026-11-09', 2000, 0, 0, 0), E('2026-11-10', 2000, 0, 0, 0)];
  const r = report({ weekStart: '2026-11-09', entries, targets: { kcal: 0, protein: 0, carbs: null, fat: undefined } });
  assert.equal(r.nutrition.pct.kcal, null);
  assert.equal(r.nutrition.pct.protein, null);
  assert.equal(r.nutrition.onTargetDays, 0);
  assert.equal(r.nutrition.split, null); // no macro energy
  assert.equal(r.nutrition.targetSplit, null);
  assert.equal(r.nutrition.total.pct, null);
  assert.ok(isClean(r));
  const rows = compareWeeks({ nutrition: { avg: { kcal: 10 }, completeDays: 2, onTargetDays: 0 }, weight: {}, training: { done: 1, sets: 3, load: 100 } },
    { nutrition: { avg: { kcal: 0 }, completeDays: 0, onTargetDays: 0 }, weight: {}, training: { done: 0, sets: 0, load: 0 } });
  for (const row of rows) assert.ok(row.pct === null || Number.isFinite(row.pct));
  assert.equal(rows.find((x) => x.key === 'kcal').pct, null);
  assert.equal(rows.find((x) => x.key === 'kcal').diff, 10);
});

test('comparison with a missing previous week → "–" (null) everywhere', () => {
  const r = report({ weekStart: '2026-11-09', entries: [E('2026-11-09', 2000)] });
  assert.equal(r.previous, null);
  const k = r.comparison.find((x) => x.key === 'kcal');
  assert.equal(k.cur, 2000);
  assert.equal(k.prev, null);
  assert.equal(k.pct, null);
  assert.equal(k.diff, null);
});

test('comparison with previous week: kcal, workouts, sets and load', () => {
  const entries = ['2026-11-02', '2026-11-03', '2026-11-09', '2026-11-10'].map((d, i) => E(d, i < 2 ? 2000 : 2200));
  const workouts = [
    WO('a', '2026-11-03', 'seed:bench-press', [S(100, 5), S(100, 5)]),
    WO('b', '2026-11-10', 'seed:bench-press', [S(100, 5), S(100, 5), S(100, 6)]),
  ];
  const r = report({ weekStart: '2026-11-09', entries, workouts });
  const k = r.comparison.find((x) => x.key === 'kcal');
  assert.equal(k.pct, 10);
  assert.equal(r.training.load, 1600);
  assert.equal(r.training.prev.load, 1000);
  assert.equal(r.training.loadPct, 60);
  assert.equal(r.comparison.find((x) => x.key === 'sets').pct, 50);
});

test('training: sets per muscle with targets, dropsets, unfinished sessions, records', () => {
  const workouts = [
    WO('old', '2026-11-02', 'seed:bench-press', [S(100, 5), S(100, 5), S(100, 5)]),
    WO('w1', '2026-11-10', 'seed:bench-press', [S(105, 5), S(100, 5), S(80, 8, 'dropset'), S(100, 5, 'normal', false)]),
    WO('w2', '2026-11-12', 'seed:back-squat', [S(140, 5), S(140, 5)], false),
  ];
  const r = report({ weekStart: '2026-11-09', workouts, setTargets: { chest: 4, quads: 10, bogus: 3 } });
  const t = r.training;
  assert.equal(t.workouts.length, 2);
  assert.equal(t.done, 1);
  assert.equal(t.sets, 4); // 2 bench normal + 2 squat (unfinished still counted in sets)
  assert.equal(t.dropsets, 1);
  const chest = t.muscles.find((m) => m.muscle === 'chest');
  assert.equal(chest.sets, 2);
  assert.equal(chest.prev, 3);
  assert.equal(chest.target, 4);
  assert.equal(chest.pct, 50);
  const quads = t.muscles.find((m) => m.muscle === 'quads');
  assert.equal(quads.sets, 2);
  assert.equal(quads.pct, 20);
  assert.equal(t.hasTargets, true);
  assert.equal(t.records.length, 1);
  assert.equal(t.records[0].workoutId, 'w1');
  assert.ok(t.records[0].records.some((x) => x.kind === 'weight' && x.weight === 105));
  // no targets setting at all
  const r2 = report({ weekStart: '2026-11-09', workouts, setTargets: undefined });
  assert.equal(r2.training.hasTargets, false);
  assert.equal(r2.training.muscles.find((m) => m.muscle === 'chest').pct, null);
});

test('body weight: weigh-ins, average, trend change vs previous week and goal', () => {
  const weights = [];
  for (let i = 0; i < 14; i++) weights.push({ date: addDays('2026-11-02', i), kg: 80 - i * 0.1 });
  const r = report({ weekStart: '2026-11-09', weights, goal: { rateKgPerWeek: -0.5 } });
  const w = r.weight;
  assert.equal(w.count, 7);
  assert.ok(Math.abs(w.avg - (79.3 + 78.7) / 2) < 1e-9);
  assert.ok(w.change < 0);
  assert.ok(Math.abs(w.changePct - (w.change / w.prevTrend) * 100) < 0.01);
  assert.equal(w.goalRate, -0.5);
  assert.equal(w.expected, -0.5);
  assert.ok(Math.abs(w.vsGoal - (w.change + 0.5)) < 1e-9);
  // no earlier weigh-in → no change
  const r2 = report({ weekStart: '2026-11-02', weights });
  assert.equal(r2.weight.change, null);
  assert.equal(r2.weight.changePct, null);
  assert.equal(r2.weight.goalRate, null);
});

test('targets for a past week come from targetHistory when available', () => {
  const history = [
    { weekStart: '2026-10-19', kcalTarget: 2300, decision: 'accepted', proposal: { kcal: 2300, protein: 160, carbs: 260, fat: 75 }, createdAt: 1 },
    { weekStart: '2026-10-26', kcalTarget: 2300, decision: 'kept', proposal: { kcal: 2250, protein: 160, carbs: 250, fat: 75 }, createdAt: 2 },
    { weekStart: '2026-11-09', kcalTarget: 2150, decision: 'accepted', proposal: { kcal: 2150, protein: 160, carbs: 230, fat: 72 }, createdAt: 3 },
  ];
  const t1 = targetsForWeek('2026-11-02', '2026-11-18', TARGETS, history);
  assert.equal(t1.source, 'history');
  assert.equal(t1.kcal, 2300);
  assert.equal(t1.fromWeek, '2026-10-26');
  assert.equal(t1.macroSource, 'history');
  assert.equal(t1.carbs, 260);
  const t2 = targetsForWeek('2026-10-12', '2026-11-18', TARGETS, history);
  assert.equal(t2.source, 'current');
  assert.equal(t2.kcal, 2000);
  const t3 = targetsForWeek('2026-11-16', '2026-11-18', TARGETS, history); // current week → current targets
  assert.equal(t3.source, 'current');
  const kept = [{ weekStart: '2026-10-26', kcalTarget: 2400, decision: 'kept', proposal: null, createdAt: 1 }];
  const t4 = targetsForWeek('2026-11-02', '2026-11-18', TARGETS, kept);
  assert.equal(t4.kcal, 2400);
  assert.equal(t4.macroSource, 'current');
  assert.equal(t4.protein, 150);
  const r = report({ weekStart: '2026-11-09', history });
  assert.equal(r.checkIn.decision, 'accepted');
  assert.equal(r.targets.kcal, 2150);
});

test('macroSplit sums to 100 and handles rounding', () => {
  const s = macroSplit({ protein: 100, carbs: 100, fat: 100 / 9 * 4 }); // equal thirds
  assert.equal(s.protein + s.carbs + s.fat, 100);
  assert.deepEqual(macroSplit({ protein: 0, carbs: 0, fat: 0 }), null);
  assert.deepEqual(macroSplit({ protein: 25, carbs: null, fat: 0 }), { protein: 100, carbs: 0, fat: 0 });
});

test('weekSummaries: weeks with data plus the current one, newest first', () => {
  const entries = [E('2026-10-26', 2000), E('2026-10-27', 2200), E('2026-11-18', 500)];
  const weights = [{ date: '2026-11-04', kg: 80 }];
  const workouts = [WO('x', '2026-11-05', 'seed:bench-press', [S(100, 5)])];
  const list = weekSummaries({ today: '2026-11-18', entries, weights, workouts });
  assert.deepEqual(list.map((w) => w.weekStart), ['2026-11-16', '2026-11-02', '2026-10-26']);
  assert.equal(list[0].status, 'current');
  assert.equal(list[0].loggedDays, 0); // today's partial day is not counted
  assert.equal(list[0].hasData, true);
  assert.equal(list[1].workouts, 1);
  assert.equal(list[1].avgWeight, 80);
  assert.equal(list[2].avgKcal, 2100);
  assert.equal(list[2].loggedDays, 2);
  const empty = weekSummaries({ today: '2026-11-18', entries: [], weights: [], workouts: [] });
  assert.equal(empty.length, 1);
  assert.equal(empty[0].hasData, false);
});

test('training: a finished workout without a done set is not counted', () => {
  const workouts = [
    WO('w1', '2026-11-10', 'seed:bench-press', [S(100, 5), S(100, 5)]),
    WO('empty', '2026-11-11', 'seed:bench-press', [S(100, 5, 'normal', false)]),
  ];
  const t = report({ weekStart: '2026-11-09', workouts }).training;
  assert.deepEqual(t.workouts.map((w) => w.id), ['w1']);
  assert.equal(t.done, 1);
});
