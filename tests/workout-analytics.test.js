import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as a from '../src/core/workout-analytics.js';

const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
const E = (exerciseId, sets) => ({ exerciseId, targetSets: 3, targetReps: 6, targetRepsMax: null, sets, note: '' });
let n = 0;
const W = (date, entries, { routineId = 'push', finished = true, id, startedAt } = {}) => {
  n++;
  const st = startedAt ?? n * 1000;
  return { id: id || `w${n}`, date, routineId, name: 'Push', startedAt: st, finishedAt: finished ? st + 3600000 : null, exercises: entries };
};
const EX = new Map([
  ['bench', { id: 'bench', primary: ['chest'], secondary: ['triceps', 'shoulders'] }],
  ['dl', { id: 'dl', primary: ['back', 'glutes', 'hamstrings'], secondary: ['quads'] }],
  ['pull', { id: 'pull', primary: ['back'], secondary: ['biceps'] }],
]);

/** Walk every value and fail on NaN / ±Infinity. */
function assertFinite(v, path = 'root') {
  if (typeof v === 'number') { assert.ok(Number.isFinite(v), `${path} = ${v}`); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) assertFinite(x, `${path}.${k}`);
}
const st = (res, ex, metric) => res.exercises.find((r) => r.exerciseId === ex).statuses.find((s) => s.metric === metric);

test('sessionBests: heaviest (tie -> more reps), tonnage set, e1rm, tonnage; dropsets and undone ignored', () => {
  const b = a.sessionBests(E('bench', [
    S(100, 5), S(100, 6), S(90, 8), S(80, 12, 'dropset'), S(120, 3, 'normal', false), S(60, null),
  ]));
  assert.deepEqual(b.heaviest, { value: 100, weight: 100, reps: 6 });
  assert.deepEqual(b.tonnageSet, { value: 720, weight: 90, reps: 8 });
  assert.equal(b.e1rm.value, 120); // 100 × (1 + 6/30) = 120; 90 × 1.2667 = 114
  assert.equal(b.e1rm.weight, 100);
  assert.equal(b.tonnage.value, 500 + 600 + 720);
  assert.equal(b.bwReps, null);
  assert.equal(b.bwTotal, null);
});

test('sessionBests: tonnage-set tie -> heavier set; 1 rep e1rm = weight', () => {
  const b = a.sessionBests(E('x', [S(50, 10), S(100, 5), S(140, 1)]));
  assert.deepEqual(b.tonnageSet, { value: 500, weight: 100, reps: 5 });
  assert.equal(b.e1rm.value, 140); // 140×1 = 140 beats 100 × (1 + 5/30) = 116.67
  assert.equal(a.sessionBests(E('x', [S(100, 5)])).e1rm.value, 116.67);
});

test('sessionBests: bodyweight uses reps; empty / all-undone entries give nulls', () => {
  const b = a.sessionBests(E('pull', [S(null, 10), S(0, 12), S(null, 8), S(null, 20, 'dropset')]));
  assert.equal(b.bwReps.value, 12);
  assert.equal(b.bwTotal.value, 30);
  assert.equal(b.heaviest, null);
  assert.equal(b.tonnage, null);
  const e = a.sessionBests(E('x', [S(100, 5, 'normal', false)]));
  assert.ok(Object.values(e).every((v) => v === null));
  assert.equal(a.modeOf(E('pull', [S(null, 10)])), 'reps');
  assert.equal(a.modeOf(E('pull', [S(null, 10), S(10, 5)])), 'load');
});

test('scopeBests: the first session to reach a value holds the record; order by date not array order', () => {
  const w2 = W('2026-10-05', [E('bench', [S(100, 5)])], { id: 'b' });
  const w1 = W('2026-10-01', [E('bench', [S(100, 5)])], { id: 'a' });
  const best = a.scopeBests([{ workout: w2, entry: w2.exercises[0] }, { workout: w1, entry: w1.exercises[0] }]);
  assert.equal(best.heaviest.workoutId, 'a');
  assert.equal(best.heaviest.date, '2026-10-01');
});

test('records: pr vs matched vs first time vs below, with previous holder, delta and %', () => {
  const ws = [
    W('2026-10-12', [E('bench', [S(100, 6), S(100, 6)])], { id: 'o1' }),
    W('2026-10-20', [E('bench', [S(95, 8)])], { id: 'o2' }),
    W('2026-11-03', [E('bench', [S(102.5, 6), S(100, 6)]), E('dl', [S(140, 5)])], { id: 'cur' }),
  ];
  const res = a.analyseWorkout(ws, ws[2], EX);
  const h = st(res, 'bench', 'heaviest');
  assert.equal(h.status, 'pr');
  assert.equal(h.prevAll.weight, 100);
  assert.equal(h.prevAll.reps, 6);
  assert.equal(h.prevAll.date, '2026-10-12');
  assert.deepEqual(h.delta, { abs: 2.5, unit: 'kg', pct: 2.5 });
  // tonnage set: 102.5×6 = 615 vs 95×8 = 760 (o2) -> below
  assert.equal(st(res, 'bench', 'tonnageSet').status, 'below');
  assert.equal(st(res, 'bench', 'tonnageSet').prevAll.workoutId, 'o2');
  // session tonnage 1215 vs 1200 -> pr
  const t = st(res, 'bench', 'tonnage');
  assert.equal(t.status, 'pr');
  assert.equal(t.delta.abs, 15);
  assert.equal(t.delta.pct, 1.3);
  // deadlift first time: no previous, not a record
  assert.ok(res.exercises.find((r) => r.exerciseId === 'dl').firstTime);
  assert.ok(res.exercises.find((r) => r.exerciseId === 'dl').statuses.every((s) => s.status === 'first'));
  assert.ok(!res.records.some((r) => r.exerciseId === 'dl'));
  // records sorted: all pr before others
  const kinds = res.records.map((r) => r.status);
  assert.deepEqual(kinds, [...kinds].sort((x, y) => ({ pr: 0, month: 1, matched: 2 }[x] - { pr: 0, month: 1, matched: 2 }[y])));

  const again = [...ws, W('2026-11-10', [E('bench', [S(102.5, 6)])], { id: 'm' })];
  const r2 = a.analyseWorkout(again, again[3], EX);
  assert.equal(st(r2, 'bench', 'heaviest').status, 'matched');
  assert.ok(r2.records.some((r) => r.status === 'matched' && r.metric === 'heaviest'));
});

test('records: heaviest with equal weight and more reps beats; delta in reps', () => {
  const ws = [W('2026-10-01', [E('bench', [S(100, 5)])]), W('2026-10-08', [E('bench', [S(100, 7)])], { id: 'c' })];
  const s = st(a.analyseWorkout(ws, ws[1], EX), 'bench', 'heaviest');
  assert.equal(s.status, 'pr');
  assert.deepEqual(s.delta, { abs: 2, unit: 'reps', pct: null });
});

test('monthly best: below all-time but beats earlier sessions in the same calendar month; month boundaries', () => {
  const ws = [
    W('2026-09-30', [E('bench', [S(110, 5)])], { id: 'sep' }), // all-time best, last day of September
    W('2026-10-01', [E('bench', [S(100, 5)])], { id: 'oct1' }), // first day of October
    W('2026-10-31', [E('bench', [S(105, 5)])], { id: 'oct31' }),
    W('2026-11-01', [E('bench', [S(102.5, 5)])], { id: 'nov1' }),
  ];
  const r = a.analyseWorkout(ws, ws[2], EX);
  const h = st(r, 'bench', 'heaviest');
  assert.equal(h.status, 'month');
  assert.equal(h.ref.workoutId, 'oct1');
  assert.equal(h.delta.abs, 5);
  assert.equal(r.exercises[0].scopes.month.heaviest.weight, 105);
  assert.equal(r.exercises[0].scopes.all.heaviest.weight, 110);
  assert.equal(r.exercises[0].scopes.monthBefore.heaviest.weight, 100);
  // first session of a month has no monthly comparison -> below, not 'month'
  const first = a.analyseWorkout(ws, ws[1], EX);
  assert.equal(st(first, 'bench', 'heaviest').status, 'below');
  assert.equal(first.exercises[0].scopes.month.heaviest.workoutId, 'oct1');
  // November: month scope only 1 Nov
  const nov = a.analyseWorkout(ws, ws[3], EX);
  assert.equal(nov.exercises[0].scopes.month.heaviest.weight, 102.5);
  assert.equal(nov.monthView.month, '2026-11');
  assert.equal(nov.monthView.sessions, 1);
});

test('records as of an old workout: later sessions are ignored; stored order and creation order do not matter', () => {
  const later = W('2026-11-15', [E('bench', [S(130, 3)])], { id: 'later' });
  const old = W('2026-10-10', [E('bench', [S(105, 5)])], { id: 'old' });
  const backdated = W('2026-10-01', [E('bench', [S(100, 5)])], { id: 'back' }); // created last, dated first
  const res = a.analyseWorkout([later, old, backdated], old, EX);
  const h = st(res, 'bench', 'heaviest');
  assert.equal(h.status, 'pr');
  assert.equal(h.prevAll.workoutId, 'back');
  assert.equal(res.exercises[0].scopes.all.heaviest.weight, 105);
  assert.equal(res.exercises[0].trend.points.length, 2);
  // same date: start time decides
  const morning = W('2026-10-10', [E('bench', [S(104, 5)])], { id: 'am', startedAt: 1 });
  const res2 = a.analyseWorkout([later, old, backdated, morning], old, EX);
  assert.equal(st(res2, 'bench', 'heaviest').prevAll.workoutId, 'am');
  // the later workout: old is a previous record holder
  const res3 = a.analyseWorkout([later, old, backdated], later, EX);
  assert.equal(st(res3, 'bench', 'heaviest').prevAll.workoutId, 'old');
});

test('dropsets and undone sets never make a record or a best', () => {
  const ws = [
    W('2026-10-01', [E('bench', [S(100, 5), S(150, 10, 'dropset'), S(200, 1, 'normal', false)])], { id: 'p' }),
    W('2026-10-08', [E('bench', [S(101, 5), S(300, 10, 'dropset'), S(300, 1, 'normal', false)])], { id: 'c' }),
  ];
  const r = a.analyseWorkout(ws, ws[1], EX);
  const ex = r.exercises[0];
  assert.equal(ex.scopes.all.heaviest.weight, 101);
  assert.equal(st(r, 'bench', 'heaviest').prevAll.weight, 100);
  assert.equal(ex.dropsets, 1);
  assert.equal(ex.dropTonnage, 3000);
  assert.equal(ex.undone, 1);
  assert.equal(r.totals.load, 505);
});

test('bodyweight exercise: most reps and total reps, previous bodyweight sessions only', () => {
  const ws = [
    W('2026-10-01', [E('pull', [S(null, 10), S(null, 8)])]),
    W('2026-10-05', [E('pull', [S(20, 6)])]), // weighted session: not a reps reference
    W('2026-10-09', [E('pull', [S(null, 11), S(null, 7)])], { id: 'c' }),
  ];
  const r = a.analyseWorkout(ws, ws[2], EX);
  const ex = r.exercises[0];
  assert.equal(ex.mode, 'reps');
  assert.equal(ex.trend.metric, 'bwReps');
  assert.deepEqual(ex.statuses.map((s) => s.metric), ['bwReps', 'bwTotal']);
  assert.equal(st(r, 'pull', 'bwReps').status, 'pr');
  assert.deepEqual(st(r, 'pull', 'bwReps').delta, { abs: 1, unit: 'reps', pct: 10 });
  assert.equal(st(r, 'pull', 'bwTotal').status, 'matched'); // 18 = 18
  assert.equal(r.muscles.length, 0); // no tonnage
  assert.equal(ex.trend.points.length, 2); // weighted session has no bwReps point
});

test('closest miss when nothing was beaten', () => {
  const ws = [
    W('2026-10-01', [E('bench', [S(100, 5)]), E('dl', [S(200, 5)])]),
    W('2026-10-08', [E('bench', [S(97.5, 5)]), E('dl', [S(150, 5)])], { id: 'c' }),
  ];
  const r = a.analyseWorkout(ws, ws[1], EX);
  assert.equal(r.records.length, 0);
  assert.equal(r.closestMiss.exerciseId, 'bench');
  assert.equal(r.closestMiss.delta.pct, -2.5);
  assert.equal(r.closestMiss.best.weight, 100);
});

test('muscle tonnage: primary muscles only, split equally; routine history and % vs previous time', () => {
  const ws = [
    W('2026-10-01', [E('bench', [S(100, 10)])], { id: 'r1' }),
    W('2026-10-03', [E('bench', [S(50, 10)])], { id: 'other', routineId: 'pull' }),
    W('2026-10-08', [E('bench', [S(100, 11)]), E('dl', [S(100, 3)])], { id: 'r2' }),
  ];
  const r = a.analyseWorkout(ws, ws[2], EX);
  assert.deepEqual(r.muscles, [
    { muscle: 'chest', name: 'Chest', tonnage: 1100 },
    { muscle: 'back', name: 'Back', tonnage: 100 },
    { muscle: 'glutes', name: 'Glutes', tonnage: 100 },
    { muscle: 'hamstrings', name: 'Hamstrings', tonnage: 100 },
  ]);
  assert.equal(r.routine.prev.id, 'r1');
  assert.equal(r.routine.prevTonnage, 1000);
  assert.equal(r.routine.pct, 40);
  assert.deepEqual(r.routine.history.map((h) => [h.workoutId, h.current]), [['r1', false], ['r2', true]]);
  assert.equal(a.muscleTonnage(W('2026-10-01', [E('gone', [S(10, 10)])]), EX)[0].muscle, 'unknown');
});

test('month summary: sessions, tonnage, all-time records counted as of each session, per-exercise bests', () => {
  const ws = [
    W('2026-09-20', [E('bench', [S(100, 5)])]),
    W('2026-10-02', [E('bench', [S(102.5, 5)])], { id: 'o1' }), // pr heaviest, tonnageSet, e1rm, tonnage = 4
    W('2026-10-09', [E('bench', [S(100, 5)])], { id: 'o2' }), // nothing
    W('2026-10-16', [E('bench', [S(102.5, 6)])], { id: 'o3' }), // 4 again (heaviest by reps)
    W('2026-10-23', [E('bench', [S(110, 5)])], { id: 'o4' }), // later, not counted for o3
  ];
  const r = a.analyseWorkout(ws, ws[3], EX);
  assert.equal(r.monthView.sessions, 3);
  assert.equal(r.monthView.tonnage, 512.5 + 500 + 615);
  assert.equal(r.monthView.records, 8);
  assert.equal(r.monthView.exercises[0].heaviest.reps, 6);
  assert.equal(r.monthView.exercises[0].heaviest.workoutId, 'o3');
  assert.equal(r.monthView.exercises[0].tonnageSet.value, 615);
});

test('empty workout and unfinished workout: no NaN/Infinity, nothing to report', () => {
  const empty = W('2026-10-01', [E('bench', [S(100, 5, 'normal', false)])], { finished: false, id: 'e' });
  const r = a.analyseWorkout([empty], empty, EX);
  assert.equal(r.exercises.length, 0);
  assert.equal(r.records.length, 0);
  assert.equal(r.closestMiss, null);
  assert.equal(r.totals.load, 0);
  assert.equal(r.totals.durationMs, null);
  assert.equal(r.routine.pct, null);
  assertFinite(r);
  const none = W('2026-10-01', [], { id: 'none' });
  assertFinite(a.analyseWorkout([], none, EX));
  // previous routine session with 0 tonnage -> pct null, never Infinity
  const bw0 = W('2026-10-01', [E('pull', [S(null, 10)])]);
  const cur = W('2026-10-05', [E('bench', [S(60, 10)])]);
  const r2 = a.analyseWorkout([bw0, cur], cur, EX);
  assert.equal(r2.routine.prevTonnage, 0);
  assert.equal(r2.routine.pct, null);
  assertFinite(r2);
});

test('unfinished workout analysed against finished history; other unfinished workouts ignored', () => {
  const ws = [
    W('2026-10-01', [E('bench', [S(100, 5)])]),
    W('2026-10-02', [E('bench', [S(150, 5)])], { finished: false }),
    W('2026-10-08', [E('bench', [S(105, 5)])], { finished: false, id: 'c' }),
  ];
  const r = a.analyseWorkout(ws, ws[2], EX);
  assert.equal(st(r, 'bench', 'heaviest').status, 'pr');
  assert.equal(st(r, 'bench', 'heaviest').prevAll.weight, 100);
});

test('item 7: scopeBests — starting point is older than a real session on the same date even without startedAt', () => {
  const midnight = new Date(2026, 8, 30).getTime();
  const base = { id: 'base', kind: 'baseline', date: '2026-09-30', routineId: null, name: 'Starting point',
    startedAt: midnight, finishedAt: midnight, exercises: [E('bench', [S(100, 5), S(100, 5), S(100, 5), S(120, 1)])] };
  const real = { id: 'real', date: '2026-09-30', routineId: 'push', name: 'Push', finishedAt: midnight + 7200000,
    exercises: [E('bench', [S(120, 1)])] };
  for (const order of [[base, real], [real, base]]) {
    const best = a.scopeBests(order.map((w) => ({ workout: w, entry: w.exercises[0] })));
    assert.equal(best.heaviest.workoutId, 'base');
    assert.equal(best.heaviest.baseline, true);
  }
});

test('roundToTotal: displayed parts add up to the shown total (largest remainder)', () => {
  // 9 999 kg split into three muscles of 3 333 each: plain rounding is fine, thirds of 10 000 are not
  assert.deepEqual(a.roundToTotal([3333, 3333, 3333]), [3333, 3333, 3333]);
  const parts = [3333.4, 3333.3, 3332.3]; // Σ 9 999.0; Math.round each → 3333 + 3333 + 3332 = 9 998
  assert.deepEqual(a.roundToTotal(parts), [3334, 3333, 3332]);
  const p2 = [4999.5, 4999.5]; // Σ 9 999; Math.round each → 10 000
  assert.equal(a.roundToTotal(p2).reduce((x, y) => x + y, 0), 9999);
  assert.deepEqual(a.roundToTotal([]), []);
});
