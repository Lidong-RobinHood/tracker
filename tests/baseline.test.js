import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as b from '../src/core/baseline.js';
import { lastEntryFor, buildEntry, prefillSets, byRecent } from '../src/core/workout.js';
import { suggestProgression } from '../src/core/progression.js';
import * as p from '../src/core/workout-progress.js';
import { analyseWorkout } from '../src/core/workout-analytics.js';
import { muscleVolume, muscleVolumeBreakdown, weeklyComparison, workoutVolume } from '../src/core/volume.js';
import { muscleRecovery } from '../src/core/recovery.js';
import { exerciseUsage, recentExercises } from '../src/core/exercise-usage.js';
import { buildWeeklyReport, weekSummaries } from '../src/core/weekly-report.js';
import { parseDate } from '../src/core/dates.js';

const EX = new Map([
  ['bench', { id: 'bench', name: 'Bench press', primary: ['chest'], secondary: ['triceps'], equipment: 'barbell', increment: 2.5 }],
  ['squat', { id: 'squat', name: 'Squat', primary: ['quads'], secondary: ['glutes'], equipment: 'barbell', increment: 5 }],
  ['pullup', { id: 'pullup', name: 'Pull-up', primary: ['back'], secondary: ['biceps'], equipment: 'bodyweight', increment: 0 }],
]);
const isBodyweight = (id) => EX.get(id)?.equipment === 'bodyweight';
const TODAY = '2026-11-19';

/** Starting point as of 2026-11-18: bench 100×6 ×3 (best 105×3), squat 120×5 ×3, pull-ups 8 reps ×3. */
function makeBaseline(date = '2026-11-18', extra = {}) {
  const v = b.validateBaseline({
    date,
    rows: [
      { exerciseId: 'bench', weight: 100, reps: 6, sets: 3, bestWeight: 105, bestReps: 3 },
      { exerciseId: 'squat', weight: 120, reps: 5, sets: null, bestWeight: null, bestReps: null },
      { exerciseId: 'pullup', weight: 50, reps: 8, sets: 3, bestWeight: null, bestReps: null },
    ],
  }, { today: TODAY, isBodyweight });
  assert.ok(v.ok, v.error);
  return { ...b.buildBaseline(v.value, { id: 'base', now: 1000 }), ...extra };
}
const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
let n = 0;
const W = (date, entries, { routineId = null, hour = 18, id } = {}) => {
  n++;
  const start = parseDate(date).getTime() + hour * 3600000;
  return { id: id || `w${n}`, date, routineId, name: 'Push', startedAt: start, finishedAt: start + 3600000,
    exercises: entries.map(([exerciseId, sets]) => ({ exerciseId, targetSets: 3, targetReps: 6, targetRepsMax: null, targetWeight: null, sets, note: '' })) };
};

// ------------------------------------------------------------------ predicate, build, validate

test('isBaseline: only kind "baseline"', () => {
  assert.equal(b.isBaseline(makeBaseline()), true);
  assert.equal(b.isBaseline({ id: 'x', date: TODAY }), false);
  assert.equal(b.isBaseline(null), false);
  assert.equal(b.isBaseline({ kind: 'other' }), false);
  assert.deepEqual(b.realWorkouts([makeBaseline(), W(TODAY, [])]).length, 1);
});

test('buildBaseline: one finished record with working sets and the best set last', () => {
  const r = makeBaseline();
  assert.equal(r.kind, 'baseline');
  assert.equal(r.name, 'Starting point');
  assert.equal(r.routineId, null);
  assert.equal(r.date, '2026-11-18');
  assert.equal(r.startedAt, parseDate('2026-11-18').getTime());
  assert.equal(r.finishedAt, r.startedAt);
  const bench = r.exercises[0];
  assert.deepEqual(bench.sets, [S(100, 6), S(100, 6), S(100, 6), { ...S(105, 3), best: true }]);
  assert.equal(bench.targetSets, 3);
  assert.equal(bench.targetReps, 6);
  assert.equal(r.exercises[1].sets.length, 3, 'sets default to 3');
  assert.deepEqual(r.exercises[2].sets, [S(null, 8), S(null, 8), S(null, 8)], 'bodyweight: reps only, weight ignored');
  // editing keeps id and createdAt
  const v = b.validateBaseline({ date: '2026-11-10', rows: b.baselineRows(r) }, { today: TODAY, isBodyweight });
  const r2 = b.buildBaseline(v.value, { id: 'other', now: 5000, existing: r });
  assert.equal(r2.id, 'base');
  assert.equal(r2.createdAt, 1000);
  assert.equal(r2.updatedAt, 5000);
  assert.deepEqual(r2.exercises, r.exercises, 'rows → record → rows is lossless');
});

test('baselineRows: editor values back from the record', () => {
  assert.deepEqual(b.baselineRows(makeBaseline()), [
    { exerciseId: 'bench', weight: 100, reps: 6, sets: 3, bestWeight: 105, bestReps: 3 },
    { exerciseId: 'squat', weight: 120, reps: 5, sets: 3, bestWeight: null, bestReps: null },
    { exerciseId: 'pullup', weight: null, reps: 8, sets: 3, bestWeight: null, bestReps: null },
  ]);
  assert.deepEqual(b.baselineRows(null), []);
});

test('validateBaseline: date rules, required fields, best set only when different', () => {
  const ok = (rows, date = '2026-11-18') => b.validateBaseline({ date, rows }, { today: TODAY, isBodyweight });
  assert.equal(ok([], '2026-11-20').ok, false, 'future date');
  assert.equal(ok([], 'nope').ok, false);
  assert.equal(ok([], TODAY).ok, true, 'today is allowed');
  const r = (o) => ({ exerciseId: 'bench', weight: 100, reps: 6, sets: 3, bestWeight: null, bestReps: null, ...o });
  assert.deepEqual(ok([r({ weight: null })]), { ok: false, error: 'Enter the working weight in kg.', row: 0, field: 'weight' });
  assert.equal(ok([r({ reps: null })]).field, 'reps');
  assert.equal(ok([r({ reps: 2.5 })]).field, 'reps');
  assert.equal(ok([r({ sets: 11 })]).field, 'sets');
  assert.equal(ok([r({ bestWeight: 110 })]).field, 'bestReps');
  assert.equal(ok([r({ bestReps: 3 })]).field, 'bestWeight');
  assert.equal(ok([r({}), r({})]).row, 1, 'duplicate exercise');
  assert.deepEqual(ok([r({ weight: null, reps: null, sets: 3 })]).value.rows, [], 'an untouched row is dropped');
  assert.equal(ok([r({ bestWeight: 100, bestReps: 6 })]).value.rows[0].best, null, 'best equal to working → not stored');
  assert.deepEqual(ok([r({ weight: 102.456, bestWeight: 105, bestReps: 3 })]).value.rows[0], { exerciseId: 'bench', weight: 102.46, reps: 6, sets: 3, best: { weight: 105, reps: 3 } });
  assert.deepEqual(ok([{ exerciseId: 'pullup', weight: null, reps: 8, sets: 4, bestWeight: null, bestReps: 12 }]).value.rows[0].best, { weight: null, reps: 12 });
});

test('export → import round trip: plain JSON, unchanged', () => {
  const r = makeBaseline();
  const file = JSON.parse(JSON.stringify({ app: 'tracker', schemaVersion: 1, stores: { workouts: [r] } }));
  assert.deepEqual(file.stores.workouts[0], r);
  assert.equal(b.isBaseline(file.stores.workouts[0]), true);
  assert.deepEqual(b.baselineRows(file.stores.workouts[0]), b.baselineRows(r));
  assert.equal(b.findBaseline([W(TODAY, []), file.stores.workouts[0]]).id, 'base');
});

// ------------------------------------------------------------------ used: pre-fill, Last, progression

test('pre-fill and "Last:" use the starting point (working sets only)', () => {
  const base = makeBaseline();
  const last = lastEntryFor([base], 'bench');
  assert.equal(last.workout.id, 'base');
  assert.deepEqual(prefillSets(last.entry, {}), [S(100, 6, 'normal', false), S(100, 6, 'normal', false), S(100, 6, 'normal', false)].map((s) => ({ ...s, auto: true })));
  const e = buildEntry('bench', { targetSets: 3, targetReps: 6 }, [base]);
  assert.deepEqual(e.sets.map((s) => s.weight), [100, 100, 100]);
  // no routine target: the starting point's sets × reps become the target
  const e2 = buildEntry('squat', null, [base]);
  assert.equal(e2.targetSets, 3);
  assert.equal(e2.targetReps, 5);
  assert.deepEqual(buildEntry('pullup', null, [base]).sets.map((s) => [s.weight, s.reps]), [[null, 8], [null, 8], [null, 8]]);
});

test('a real session on the same date or later wins over the starting point; an earlier one does not', () => {
  const base = makeBaseline('2026-11-10');
  const before = W('2026-11-05', [['bench', [S(90, 6), S(90, 6), S(90, 6)]]], { hour: 23 });
  assert.equal(lastEntryFor([before, base], 'bench').workout.id, 'base', 'imported/backdated real workout before the date');
  const same = W('2026-11-10', [['bench', [S(95, 6)]]], { hour: 0 });
  same.startedAt = base.startedAt - 1; // even with an earlier start time
  assert.equal(lastEntryFor([base, same], 'bench').workout.id, same.id);
  assert.ok(byRecent(same, base) < 0 && byRecent(base, same) > 0);
  const after = W('2026-11-12', [['bench', [S(97.5, 6)]]]);
  assert.equal(lastEntryFor([before, base, after], 'bench').workout.id, after.id);
  // exercise only in the starting point still uses it
  assert.equal(lastEntryFor([base, after], 'squat').workout.id, 'base');
});

test('progression: the starting point never triggers a suggestion, only real sessions do', () => {
  const base = makeBaseline();
  const bench = EX.get('bench');
  assert.equal(suggestProgression([base], bench, { target: { targetSets: 3, targetReps: 6 } }), null);
  assert.equal(suggestProgression([base], bench, { target: { targetSets: 3, targetReps: 6, targetRepsMax: 8 } }), null);
  // after a real session the real session decides
  const real = W(TODAY, [['bench', [S(100, 6), S(100, 6), S(100, 6)]]]);
  const s2 = suggestProgression([base, real], bench, { target: { targetSets: 3, targetReps: 6 } });
  assert.equal(s2.weight, 102.5);
  assert.equal(s2.workoutId, real.id);
  assert.equal(s2.baseline, undefined);
});

test('compareSession / live comparison: previous = starting point working sets, records against its best set', () => {
  const base = makeBaseline();
  const real = W(TODAY, [['bench', [S(100, 6), S(100, 6), S(107.5, 3)]], ['pullup', [S(null, 9), S(null, 8)]]]);
  const cmp = p.compareSession([base, real], real);
  assert.equal(cmp.prevSession, null);
  const bench = cmp.rows.find((r) => r.exerciseId === 'bench');
  assert.equal(bench.prevWorkout.id, 'base');
  assert.equal(bench.prevMetrics.load, 1800, 'best set not in the comparison');
  assert.deepEqual(bench.records.map((r) => r.kind), ['weight'], 'records vs starting point, not first time (e1rm 118.25 < 120 of 100×6)');
  assert.notEqual(bench.status, 'new');
  assert.equal(cmp.rows.find((r) => r.exerciseId === 'pullup').status, 'down', 'bodyweight: 17 reps vs 24');
  const live = p.liveComparison({ sets: [S(100, 6), S(100, 6), S(100, 6), S(100, 6)] }, lastEntryFor([base], 'bench').entry);
  assert.equal(live.prev, 1800);
  assert.equal(live.compared, 3);
});

test('exercise screen: records include the starting point (flagged); chart and record sessions do not', () => {
  const base = makeBaseline();
  const r1 = W(TODAY, [['bench', [S(100, 6), S(100, 6), S(100, 6)]]]);
  const hist = p.exerciseHistory([base, r1], 'bench');
  assert.equal(hist.length, 2);
  const pr = p.personalRecords(hist);
  assert.deepEqual(pr.heaviest, { weight: 105, reps: 3, date: '2026-11-18', workoutId: 'base', baseline: true });
  assert.equal(pr.e1rm.workoutId, 'base');
  assert.deepEqual(p.exerciseSeries(hist).map((x) => x.workoutId), [r1.id]);
  // a starting point dated after imported real sessions never "sets" a record itself
  const old = W('2026-10-01', [['bench', [S(90, 5)]]]);
  assert.equal(p.recordSessions(p.exerciseHistory([old, base], 'bench')).size, 0);
  const r2 = W(TODAY, [['bench', [S(107.5, 3)]]], { hour: 20 });
  assert.ok(p.recordSessions(p.exerciseHistory([old, base, r1, r2], 'bench')).has(r2.id));
});

test('analysis: records against the starting point; month/tonnage/trend/routine ignore it', () => {
  const base = makeBaseline('2026-11-18');
  const real = W(TODAY, [['bench', [S(100, 6), S(100, 6), S(107.5, 3)]], ['squat', [S(120, 5)]]], { routineId: 'r1' });
  const a = analyseWorkout([base, real], real, EX);
  const bench = a.exercises.find((r) => r.exerciseId === 'bench');
  assert.equal(bench.firstTime, false);
  assert.equal(bench.sessions, 1);
  assert.deepEqual(bench.startingPoint, { date: '2026-11-18', workoutId: 'base' });
  const st = Object.fromEntries(bench.statuses.map((s) => [s.metric, s]));
  assert.equal(st.heaviest.status, 'pr');
  assert.deepEqual([st.heaviest.prevAll.weight, st.heaviest.prevAll.reps, st.heaviest.prevAll.baseline], [105, 3, true]);
  assert.equal(st.e1rm.status, 'matched', '100×6 = the starting point\'s 100×6');
  assert.equal(st.tonnage.status, 'first', 'session tonnage never compared with the starting point');
  assert.equal(st.heaviest.prevMonth, null, 'month scope ignores the starting point');
  assert.equal(bench.scopes.month.heaviest.workoutId, real.id);
  assert.equal(bench.scopes.all.heaviest.workoutId, real.id);
  assert.equal(bench.scopes.allBefore.tonnage, null);
  assert.deepEqual(bench.trend.points.map((x) => x.workoutId), [real.id]);
  assert.ok(a.records.some((r) => r.exerciseId === 'bench' && r.status === 'pr'));
  assert.equal(a.monthView.sessions, 1);
  assert.equal(a.monthView.tonnage, a.totals.load);
  assert.deepEqual(a.routine.history.map((h) => h.workoutId), [real.id]);
  // squat 120×5 equals the starting point
  const sq = a.exercises.find((r) => r.exerciseId === 'squat');
  assert.equal(sq.statuses.find((s) => s.metric === 'heaviest').status, 'matched');
});

test('exercise usage (picker "Recent") includes the starting point', () => {
  const usage = exerciseUsage([makeBaseline()]);
  assert.equal(usage.get('bench').lastDate, '2026-11-18');
  assert.deepEqual(recentExercises([...EX.values()], usage).map((e) => e.id).sort(), ['bench', 'pullup', 'squat']);
});

// ------------------------------------------------------------------ excluded

test('weekly volume, breakdown, recovery and routine progress ignore the starting point', () => {
  const base = makeBaseline(TODAY);
  const wts = { primary: 1, secondary: 0.5, dropset: 0 };
  assert.deepEqual(muscleVolume([base], EX, wts, { from: '2026-11-16', to: '2026-11-22' }), {});
  assert.deepEqual(muscleVolumeBreakdown([base], EX, wts, { from: '2026-11-16', to: '2026-11-22' }), {});
  assert.deepEqual(weeklyComparison([base], EX, wts, TODAY).rows, []);
  assert.deepEqual(workoutVolume(base, EX, wts), {});
  const rec = muscleRecovery([base], EX, wts, { now: base.finishedAt + 3600000 });
  assert.ok(rec.every((r) => !r.trained));
  const real = W(TODAY, [['bench', [S(100, 6)]]], { routineId: 'r1' });
  assert.equal(muscleVolume([base, real], EX, wts, { from: TODAY, to: TODAY }).chest, 1);
  const rp = p.routineProgress([{ ...base, routineId: 'r1' }, real], { id: 'r1', items: [{ exerciseId: 'bench' }] });
  assert.deepEqual(rp.sessions.map((s) => s.workout.id), [real.id]);
  assert.equal(rp.sessions[0].prev, null);
  assert.equal(rp.sessions[0].pct, null);
  assert.equal(p.previousRoutineSession([{ ...base, routineId: 'r1' }, real], real), null);
});

test('weekly report: training section and week summaries ignore the starting point', () => {
  const base = makeBaseline('2026-11-17');
  const real = W(TODAY, [['bench', [S(107.5, 3)]]]);
  const args = { weekStart: '2026-11-16', today: TODAY, entries: [], weights: [], targets: { kcal: 2000, protein: 120, carbs: 220, fat: 70 },
    targetHistory: [], goal: { rateKgPerWeek: 0 }, exercises: EX, volumeWeights: { primary: 1, secondary: 0.5, dropset: 0 }, setTargets: {} };
  const only = buildWeeklyReport({ ...args, workouts: [base] });
  assert.equal(only.training.workouts.length, 0);
  assert.equal(only.training.sets, 0);
  assert.deepEqual(only.training.muscles, []);
  const both = buildWeeklyReport({ ...args, workouts: [base, real] });
  assert.deepEqual(both.training.workouts.map((w) => w.id), [real.id]);
  assert.equal(both.training.load, 322.5);
  assert.deepEqual(both.training.records.map((r) => r.workoutId), [real.id], 'record vs starting point');
  const sums = weekSummaries({ today: TODAY, entries: [], weights: [], workouts: [base] });
  assert.equal(sums[0].workouts, 0);
  assert.equal(sums[0].sessions, 0);
});
