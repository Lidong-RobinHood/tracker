import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as o from '../src/core/workout-overview.js';
import { analyseWorkout } from '../src/core/workout-analytics.js';
import { routineProgress } from '../src/core/workout-progress.js';
import { muscleVolume } from '../src/core/volume.js';
import { addDays } from '../src/core/dates.js';

const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
const E = (exerciseId, sets) => ({ exerciseId, targetSets: 3, targetReps: 6, targetRepsMax: null, sets, note: '' });
let n = 0;
const W = (date, entries, { routineId = 'push', finished = true, id, kind, name = 'Push' } = {}) => {
  n++;
  const st = Date.parse(`${date}T10:00:00`) + n;
  return { id: id || `w${n}`, ...(kind ? { kind } : {}), date, routineId, name, startedAt: st, finishedAt: finished ? st + 3600000 : null, exercises: entries };
};
const EX = new Map([
  ['bench', { id: 'bench', primary: ['chest'], secondary: ['triceps', 'shoulders'] }],
  ['row', { id: 'row', primary: ['back'], secondary: ['biceps'] }],
  ['squat', { id: 'squat', primary: ['quads', 'glutes'], secondary: [] }],
  ['pullup', { id: 'pullup', primary: ['back'], secondary: ['biceps'] }],
]);
const ROUTINES = [{ id: 'push', name: 'Push', items: [] }, { id: 'pull', name: 'Pull', items: [] }, { id: 'legs', name: 'Legs', items: [] }];

/** A deterministic 12-week Push/Pull/Legs history with a starting point and an unfinished workout. */
function history() {
  n = 0;
  const out = [W('2026-08-20', [E('bench', [S(60, 8), S(60, 8), S(70, 5, 'normal')]), E('pullup', [S(null, 6)])], { kind: 'baseline', routineId: null, name: 'Starting point' })];
  let d = '2026-08-24';
  let k = 0;
  while (d <= '2026-11-16') {
    const step = k % 3;
    const wk = Math.floor(k / 3);
    const wave = [0, 2.5, -2.5, 5][k % 4];
    if (step === 0) out.push(W(d, [E('bench', [S(60 + wk * 1.25 + wave, 8), S(60 + wk * 1.25, 7), S(50, 10, 'dropset')])], { routineId: 'push', name: 'Push' }));
    if (step === 1) out.push(W(d, [E('row', [S(50 + wk, 10), S(50 + wk, 9)]), E('pullup', [S(null, 5 + (k % 5)), S(null, 5)])], { routineId: 'pull', name: 'Pull' }));
    if (step === 2) out.push(W(d, [E('squat', [S(80 + wk * 2.5, 5), S(80 + wk * 2.5, 5), S(100, 3, 'normal', false)])], { routineId: 'legs', name: 'Legs' }));
    d = addDays(d, k % 2 ? 2 : 3);
    k++;
  }
  out.push(W('2026-11-18', [E('bench', [S(90, 5, 'normal', false)])], { finished: false, routineId: 'push' }));
  return out;
}

test('scanHistory: record counts equal analyseWorkout all-time records for every session', () => {
  const ws = history();
  const scan = o.scanHistory(ws);
  let total = 0;
  for (const w of ws) {
    if (!w.finishedAt || w.kind === 'baseline') continue;
    const res = analyseWorkout(ws, w, EX);
    const prs = res.records.filter((r) => r.status === 'pr');
    assert.equal(scan.byWorkout.get(w.id), prs.length, `${w.id} ${w.date}`);
    const mine = scan.records.filter((r) => r.workoutId === w.id).map((r) => `${r.exerciseId}:${r.metric}:${r.cur.value}:${r.prev.value}`).sort();
    const theirs = prs.map((r) => `${r.exerciseId}:${r.metric}:${r.cur.value}:${r.prevAll.value}`).sort();
    assert.deepEqual(mine, theirs);
    total += prs.length;
  }
  assert.ok(total > 5);
  assert.equal(scan.records.length, total);
});

test('scanHistory: starting point and unfinished workouts never set records or count as sessions', () => {
  const ws = history();
  const scan = o.scanHistory(ws);
  assert.ok(!scan.records.some((r) => r.workoutId === 'w1'));
  assert.ok(!scan.sessions.some((w) => w.kind === 'baseline' || !w.finishedAt));
  // first real bench session is compared with the starting point (not "first time")
  const firstBench = ws.find((w) => w.routineId === 'push' && w.finishedAt);
  const res = analyseWorkout(ws, firstBench, EX);
  assert.equal(res.records.filter((r) => r.status === 'pr').length, scan.byWorkout.get(firstBench.id));
  // the first row session: every metric is "first", so no records
  const firstRow = ws.find((w) => w.routineId === 'pull');
  assert.ok(!scan.records.some((r) => r.workoutId === firstRow.id && r.exerciseId === 'row'));
  // bodyweight exercise records are in reps
  assert.ok(scan.records.some((r) => r.exerciseId === 'pullup' && (r.metric === 'bwReps' || r.metric === 'bwTotal')));
  assert.ok(!scan.records.some((r) => r.exerciseId === 'pullup' && r.metric === 'e1rm'));
});

test('recentRecords: newest session first, grouped by exercise, lead metric, limit', () => {
  const recs = [
    { workoutId: 'a', date: '2026-01-01', exerciseId: 'x', metric: 'heaviest' },
    { workoutId: 'b', date: '2026-01-02', exerciseId: 'x', metric: 'tonnage' },
    { workoutId: 'b', date: '2026-01-02', exerciseId: 'x', metric: 'e1rm' },
    { workoutId: 'b', date: '2026-01-02', exerciseId: 'y', metric: 'heaviest' },
    { workoutId: 'c', date: '2026-01-03', exerciseId: 'z', metric: 'bwTotal' },
  ];
  const g = o.recentRecords(recs, 3);
  assert.deepEqual(g.map((x) => `${x.workoutId}/${x.exerciseId}`), ['c/z', 'b/x', 'b/y']);
  assert.equal(g[1].lead.metric, 'e1rm');
  assert.deepEqual(g[1].others.map((r) => r.metric), ['tonnage']);
  assert.deepEqual(o.recentRecords([], 8), []);
});

test('monthComparison: month to date vs the same days of last month; null-safe percentages', () => {
  const ws = history();
  const scan = o.scanHistory(ws);
  const m = o.monthComparison(scan.sessions, scan.byWorkout, '2026-11-16');
  assert.deepEqual(m.curRange, { from: '2026-11-01', to: '2026-11-16' });
  assert.deepEqual(m.prevRange, { from: '2026-10-01', to: '2026-10-16' });
  const inNov = scan.sessions.filter((w) => w.date >= '2026-11-01' && w.date <= '2026-11-16');
  assert.equal(m.cur.sessions, inNov.length);
  // equals the analysis screen's month view as of the last session of the month
  const last = inNov[inNov.length - 1];
  const mv = analyseWorkout(ws, last, EX).monthView;
  assert.equal(m.cur.sessions, mv.sessions);
  assert.equal(m.cur.tonnage, mv.tonnage);
  assert.equal(m.cur.records, mv.records);
  // 31 March -> 1..28 Feb (capped), empty months -> null percentages
  const e = o.monthComparison([], new Map(), '2026-03-31');
  assert.deepEqual(e.prevRange, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(e.pct, { sessions: null, tonnage: null, records: null });
  const j = o.monthComparison([], new Map(), '2026-01-15');
  assert.deepEqual(j.prevRange, { from: '2025-12-01', to: '2025-12-15' });
});

test('routineOverview matches routineProgress', () => {
  const ws = history();
  for (const r of o.routineOverview(ws, ROUTINES)) {
    const rp = routineProgress(ws, ROUTINES.find((x) => x.id === r.routineId));
    assert.equal(r.sessions, rp.sessions.length);
    assert.equal(r.last.workoutId, rp.sessions[0].workout.id);
    assert.equal(r.last.tonnage, rp.sessions[0].totals.load);
    assert.equal(r.pct, rp.sessions[0].pct);
    assert.equal(r.history[r.history.length - 1].workoutId, r.last.workoutId);
  }
  const [none] = o.routineOverview([], [{ id: 'q', name: 'Q', items: [] }]);
  assert.deepEqual(none, { routineId: 'q', sessions: 0, last: null, prevTonnage: null, pct: null, history: [] });
});

test('topExercises: most sessions in the window, e1rm or reps, change from first to latest', () => {
  const ws = history();
  const scan = o.scanHistory(ws);
  const top = o.topExercises(scan.histories, '2026-11-19', { weeks: 8 });
  assert.equal(top.length, 4);
  const pu = top.find((t) => t.exerciseId === 'pullup');
  assert.equal(pu.metric, 'bestReps');
  const bench = top.find((t) => t.exerciseId === 'bench');
  assert.equal(bench.metric, 'e1rm');
  const from = addDays('2026-11-19', -55);
  assert.ok(bench.points.every((p) => p.date >= from));
  assert.ok(!bench.points.some((p) => p.workoutId === 'w1'), 'starting point is not a point');
  assert.equal(bench.value, bench.points[bench.points.length - 1].value);
  assert.ok(top.every((t, i) => i === 0 || top[i - 1].sessions >= t.sessions));
  assert.deepEqual(o.topExercises(new Map(), '2026-11-19'), []);
});

test('weeklyMuscleSets: totals equal muscleVolume per week; starting point ignored', () => {
  const ws = history();
  const w = { primary: 1, secondary: 0.5, dropset: 0 };
  const res = o.weeklyMuscleSets(ws, EX, w, '2026-11-19', { weeks: 6 });
  assert.equal(res.weeks.length, 6);
  assert.equal(res.weeks[5].from, '2026-11-16');
  res.weeks.forEach((r, i) => {
    const mv = muscleVolume(ws, EX, w, r);
    for (const row of res.rows) assert.equal(row.values[i].total, mv[row.muscle] || 0);
  });
  const t = o.weeklyMuscleSets([], EX, w, '2026-11-19', { targets: { calves: 6 } });
  assert.deepEqual(t.rows.map((r) => r.muscle), ['calves']);
});

test('finished workouts without a done set never count (routine overview, month, last-workout pool)', () => {
  const a = W('2026-11-02', [E('bench', [S(100, 5), S(100, 5)])]);
  const empty = W('2026-11-09', [E('bench', [S(100, 5, 'normal', false)])]);
  const scan = o.scanHistory([a, empty]);
  assert.deepEqual(scan.sessions.map((w) => w.id), [a.id]);
  const ro = o.routineOverview([a, empty], ROUTINES)[0];
  assert.equal(ro.sessions, 1);
  assert.equal(ro.last.workoutId, a.id);
  assert.equal(ro.pct, null);
  assert.equal(o.monthComparison(scan.sessions, scan.byWorkout, '2026-11-18').cur.sessions, 1);
  // the comparison of a later session skips the empty one (no "−100 %")
  const b = W('2026-11-16', [E('bench', [S(100, 5), S(100, 5)])]);
  assert.equal(analyseWorkout([a, empty, b], b, EX).routine.prev.id, a.id);
});
