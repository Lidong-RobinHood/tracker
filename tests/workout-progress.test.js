import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/core/workout-progress.js';
import { sanitiseTargets, targetProgress } from '../src/core/volume.js';

const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
const E = (exerciseId, sets) => ({ exerciseId, targetSets: 3, targetReps: 6, targetRepsMax: null, sets, note: '' });
let n = 0;
const W = (date, entries, { routineId = null, finished = true, id } = {}) => {
  n++;
  return { id: id || `w${n}`, date, routineId, name: 'W', startedAt: n * 1000, finishedAt: finished ? n * 1000 + 3600000 : null, exercises: entries };
};

test('pctChange: sign, 1-decimal rounding, null for missing/zero previous, never NaN/Infinity', () => {
  assert.equal(p.pctChange(110, 100), 10);
  assert.equal(p.pctChange(90, 100), -10);
  assert.equal(p.pctChange(2460, 2400), 2.5);
  assert.equal(p.pctChange(1, 3), -66.7);
  assert.equal(p.pctChange(2, 3), -33.3);
  assert.equal(p.pctChange(100.04, 100), 0); // rounds to 0, not -0/0.04
  assert.ok(!Object.is(p.pctChange(99.96, 100), -0));
  assert.equal(p.pctChange(5, 0), null);
  assert.equal(p.pctChange(5, null), null);
  assert.equal(p.pctChange(5, undefined), null);
  assert.equal(p.pctChange(NaN, 5), null);
  assert.equal(p.pctChange(5, Infinity), null);
  assert.equal(p.pctChange(0, 5), -100);
  assert.equal(p.trendOf(null), 'none');
  assert.equal(p.trendOf(0), 'flat');
  assert.equal(p.trendOf(-0.1), 'down');
  assert.equal(p.formatPct(2.5), '+2.5 %');
  assert.equal(p.formatPct(-3), '−3 %');
  assert.equal(p.formatPct(0), '±0 %');
  assert.equal(p.formatPct(null), '–');
});

test('entryMetrics: volume load of done normal sets only; dropsets separate; top set; e1rm', () => {
  const m = p.entryMetrics(E('x', [S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset'), S(105, 3, 'normal', false)]));
  assert.equal(m.load, 2300);
  assert.equal(m.dropLoad, 400);
  assert.equal(m.sets, 3);
  assert.equal(m.dropsets, 1);
  assert.equal(m.reps, 23);
  assert.deepEqual(m.top, { weight: 100, reps: 8 });
  assert.equal(m.e1rm, 126.67); // 100 × (1 + 8/30)
  assert.equal(m.bodyweight, false);
  // a heavier dropset never becomes the top set
  assert.deepEqual(p.entryMetrics(E('x', [S(60, 10), S(70, 5, 'dropset')])).top, { weight: 60, reps: 10 });
});

test('bodyweight entries progress by reps', () => {
  const a = p.entryMetrics(E('pu', [S(0, 10), S(null, 8)]));
  const b = p.entryMetrics(E('pu', [S(0, 12), S(0, 9)]));
  assert.equal(a.bodyweight, true);
  assert.equal(a.load, 0);
  assert.deepEqual(a.top, { weight: 0, reps: 10 });
  const c = p.compareMetrics(b, a);
  assert.equal(c.basis, 'reps');
  assert.equal(c.pct, 16.7); // 21 vs 18
  // weighted on one side -> load basis; previous load 0 -> no percentage
  const d = p.compareMetrics(p.entryMetrics(E('pu', [S(10, 8)])), a);
  assert.equal(d.basis, 'load');
  assert.equal(d.pct, null);
});

test('routine matching: by routineId, previous session of the same routine, fallback to any session', () => {
  const push1 = W('2026-09-01', [E('bench', [S(100, 6), S(100, 6)]), E('fly', [S(20, 12)])], { routineId: 'push' });
  const pull1 = W('2026-09-02', [E('row', [S(80, 8)]), E('bench', [S(90, 5)])], { routineId: 'pull' });
  const empty = W('2026-09-03', [E('dips', [S(0, 10)])]);
  const push2 = W('2026-09-08', [E('bench', [S(102.5, 6), S(102.5, 6)]), E('dips', [S(0, 12)])], { routineId: 'push' });
  const all = [push2, empty, pull1, push1];
  assert.deepEqual(p.routineSessions(all, 'push').map((w) => w.id), [push2.id, push1.id]);
  assert.equal(p.previousRoutineSession(all, push2).id, push1.id);
  assert.equal(p.previousRoutineSession(all, push1), null);
  // bench compares with push1 (same routine) although pull1 is more recent
  const b = p.previousEntry(all, push2, 'bench');
  assert.equal(b.workout.id, push1.id);
  assert.equal(b.sameRoutine, true);
  // dips were never in push -> fallback to the empty workout
  const d = p.previousEntry(all, push2, 'dips');
  assert.equal(d.workout.id, empty.id);
  assert.equal(d.sameRoutine, false);
  // an empty workout compares each exercise with its last occurrence anywhere
  const e2 = W('2026-09-04', [E('bench', [S(95, 5)])]);
  assert.equal(p.previousEntry([...all, e2], e2, 'bench').workout.id, pull1.id);
});

test('compareSession: routine total vs previous routine session, per exercise status, skipped/new', () => {
  const r1 = W('2026-10-01', [E('bench', [S(100, 6), S(100, 6), S(100, 6)]), E('ohp', [S(50, 8), S(50, 8)]), E('fly', [S(20, 12)])], { routineId: 'push' });
  const r2 = W('2026-10-08', [E('bench', [S(100, 7), S(100, 6), S(100, 6)]), E('ohp', [S(50, 7), S(50, 7)]), E('tri', [S(30, 10)])], { routineId: 'push' });
  const c = p.compareSession([r1, r2], r2);
  assert.equal(c.prevSession.id, r1.id);
  // r1 load = 1800 + 800 + 240 = 2840; r2 = 1900 + 700 + 300 = 2900
  assert.equal(c.total.basis, 'session');
  assert.equal(c.total.cur, 2900);
  assert.equal(c.total.prev, 2840);
  assert.equal(c.total.pct, 2.1);
  const by = Object.fromEntries(c.rows.map((r) => [r.exerciseId, r]));
  assert.equal(by.bench.status, 'up');
  assert.equal(by.bench.cmp.pct, 5.6); // 1900 / 1800
  assert.equal(by.ohp.status, 'down');
  assert.equal(by.ohp.cmp.pct, -12.5);
  assert.equal(by.tri.status, 'new');
  assert.equal(by.fly.status, 'skipped');
  // same numbers again -> flat
  const r3 = W('2026-10-15', [E('bench', [S(100, 7), S(100, 6), S(100, 6)])], { routineId: 'push' });
  assert.equal(p.compareSession([r1, r2, r3], r3).rows.find((r) => r.exerciseId === 'bench').status, 'flat');
});

test('compareSession: empty workout uses matched exercises for the total', () => {
  const a = W('2026-10-01', [E('bench', [S(100, 5)]), E('row', [S(60, 10)])]);
  const b = W('2026-10-03', [E('bench', [S(100, 6)]), E('curl', [S(15, 10)])]);
  const c = p.compareSession([a, b], b);
  assert.equal(c.prevSession, null);
  assert.equal(c.total.basis, 'matched');
  assert.equal(c.total.cur, 600);
  assert.equal(c.total.prev, 500);
  assert.equal(c.total.pct, 20);
  assert.equal(c.rows.find((r) => r.exerciseId === 'curl').status, 'new');
  assert.equal(c.rows.some((r) => r.status === 'skipped'), false);
  // nothing to compare -> no percentage
  const first = W('2026-01-01', [E('z', [S(10, 10)])]);
  assert.equal(p.compareSession([first], first).total.pct, null);
});

test('routineProgress: sessions newest first with pct vs previous, exercise rows incl. added ones', () => {
  const r = { id: 'legs', items: [{ exerciseId: 'squat' }, { exerciseId: 'curl' }] };
  const s1 = W('2026-08-01', [E('squat', [S(100, 5), S(100, 5)]), E('curl', [S(40, 10)])], { routineId: 'legs' });
  const s2 = W('2026-08-08', [E('squat', [S(105, 5), S(105, 5)])], { routineId: 'legs' });
  const s3 = W('2026-08-15', [E('squat', [S(105, 5), S(105, 4)]), E('curl', [S(40, 10)]), E('calf', [S(80, 15)])], { routineId: 'legs' });
  const other = W('2026-08-16', [E('squat', [S(200, 1)])]);
  const unfinished = W('2026-08-20', [E('squat', [S(200, 1)])], { routineId: 'legs', finished: false });
  const rp = p.routineProgress([s1, s2, s3, other, unfinished], r);
  assert.deepEqual(rp.sessions.map((s) => s.workout.id), [s3.id, s2.id, s1.id]);
  // s1 1400, s2 1050, s3 945 + 400 + 1200 = 2545
  assert.equal(rp.sessions[2].pct, null);
  assert.equal(rp.sessions[1].pct, -25);
  assert.equal(rp.sessions[0].pct, 142.4);
  assert.deepEqual(rp.sessions[1].skipped, ['curl']);
  assert.deepEqual(rp.sessions[0].added, ['calf']);
  assert.deepEqual(rp.sessions[0].returned, ['curl']);
  assert.equal(rp.sessions[0].totals.durationMs, 3600000);
  assert.deepEqual(rp.exercises.map((e) => [e.exerciseId, e.inRoutine, e.entries.length]), [['squat', true, 3], ['curl', true, 2], ['calf', false, 1]]);
  const squat = rp.exercises[0].entries;
  assert.equal(squat[0].cmp.pct, -10); // 945 vs 1050
  assert.equal(squat[1].cmp.pct, 5); // 1050 vs 1000
  assert.equal(squat[2].cmp, null);
  // curl compares with its previous occurrence (s1), skipping s2
  assert.equal(rp.exercises[1].entries[0].cmp.pct, 0);
});

test('personal records: first achievement holds, dropsets excluded, reps at weight', () => {
  const hist = [
    { workout: W('2026-06-01', []), entry: E('x', [S(100, 5), S(90, 8)]) },
    { workout: W('2026-06-08', []), entry: E('x', [S(100, 6), S(120, 1, 'dropset')]) },
    { workout: W('2026-06-15', []), entry: E('x', [S(105, 3), S(90, 8)]) },
    { workout: W('2026-06-22', []), entry: E('x', [S(105, 3), S(90, 10)]) },
  ];
  const pr = p.personalRecords(hist);
  assert.equal(pr.heaviest.weight, 105);
  assert.equal(pr.heaviest.date, '2026-06-15');
  // e1rm: 100×6 = 120, 90×10 = 120 too -> first one (06-08) holds
  assert.equal(pr.e1rm.value, 120);
  assert.equal(pr.e1rm.date, '2026-06-08');
  assert.deepEqual(pr.repsByWeight.map((r) => [r.weight, r.reps, r.date]), [[105, 3, '2026-06-15'], [100, 6, '2026-06-08'], [90, 10, '2026-06-22']]);
  assert.equal(pr.mostReps.reps, 10);

  const recs = p.recordSessions(hist);
  assert.equal(recs.has(hist[0].workout.id), false); // first session is never a PR
  assert.deepEqual(recs.get(hist[1].workout.id).map((r) => r.kind), ['e1rm', 'reps']);
  assert.deepEqual(recs.get(hist[2].workout.id).map((r) => r.kind), ['weight']);
  assert.deepEqual(recs.get(hist[3].workout.id).map((r) => [r.kind, r.weight, r.reps]), [['reps', 90, 10]]);
  assert.equal(p.personalRecords([]).heaviest, null);
});

test('newRecords: bodyweight reps PR; nothing on first session', () => {
  const prior = [{ workout: W('2026-06-01', []), entry: E('pu', [S(0, 10), S(0, 8)]) }];
  assert.deepEqual(p.newRecords(prior, E('pu', [S(0, 11)])), [{ kind: 'reps', weight: 0, reps: 11, value: 11 }]);
  assert.deepEqual(p.newRecords(prior, E('pu', [S(0, 10)])), []);
  assert.deepEqual(p.newRecords([], E('pu', [S(0, 20)])), []);
});

test('exerciseSeries, filterRange, seriesChange', () => {
  const hist = [
    { workout: W('2026-01-10', []), entry: E('x', [S(80, 8), S(80, 8)]) },
    { workout: W('2026-09-01', []), entry: E('x', [S(90, 8), S(90, 8), S(70, 6, 'dropset')]) },
    { workout: W('2026-11-01', []), entry: E('x', [S(95, 8), S(95, 6)]) },
  ].reverse();
  const pts = p.exerciseSeries(hist);
  assert.deepEqual(pts.map((x) => [x.date, x.topWeight, x.load]), [['2026-01-10', 80, 1280], ['2026-09-01', 90, 1440], ['2026-11-01', 95, 1330]]);
  assert.equal(p.filterRange(pts, '3m', '2026-11-18').length, 2);
  assert.equal(p.filterRange(pts, '1y', '2026-11-18').length, 3);
  assert.equal(p.filterRange(pts, 'all', '2026-11-18').length, 3);
  const c = p.seriesChange(pts, 'topWeight');
  assert.equal(c.rangePct, 18.8); // 95 / 80
  assert.equal(c.prevPct, 5.6); // 95 / 90
  const one = p.seriesChange(pts.slice(0, 1), 'load');
  assert.equal(one.rangePct, null);
  assert.equal(one.prevPct, null);
  assert.equal(p.seriesChange([], 'load').last, null);
});

test('liveComparison compares the ticked sets with the same number of sets last time', () => {
  const last = E('x', [S(100, 8), S(100, 8), S(100, 7), S(80, 5, 'dropset')]);
  const cur = E('x', [S(102.5, 8), S(100, 8, 'normal', false), S(100, 8, 'normal', false)]);
  const a = p.liveComparison(cur, last);
  assert.equal(a.compared, 1);
  assert.equal(a.pct, 2.5); // 820 vs 800
  cur.sets[1].done = true; cur.sets[2].done = true;
  const b = p.liveComparison(cur, last);
  assert.equal(b.pct, p.compareMetrics(p.entryMetrics(cur), p.entryMetrics(last)).pct); // equals full comparison
  assert.equal(b.pct, 5.2); // 2420 vs 2300
  assert.equal(p.liveComparison(E('x', [S(100, 8, 'normal', false)]), last), null);
  assert.equal(p.liveComparison(cur, null), null);
  const bw = p.liveComparison(E('pu', [S(0, 12)]), E('pu', [S(0, 10), S(0, 10)]));
  assert.equal(bw.basis, 'reps');
  assert.equal(bw.pct, 20);
});

test('doneEntries merges a duplicated exercise and drops skipped ones', () => {
  const w = W('2026-10-01', [E('a', [S(10, 10)]), E('b', [S(10, 10, 'normal', false)]), E('a', [S(20, 5)])]);
  const m = p.doneEntries(w);
  assert.deepEqual([...m.keys()], ['a']);
  assert.equal(p.entryMetrics(m.get('a')).load, 200);
});

test('weekly targets: sanitise and percentage reached', () => {
  assert.deepEqual(sanitiseTargets(undefined), {});
  assert.deepEqual(sanitiseTargets({ chest: 12, back: 0, nope: 5, abs: 'x', quads: 10.04, calves: 101 }), { chest: 12, quads: 10 });
  assert.deepEqual(targetProgress(9, 12), { done: 9, target: 12, pct: 75, fraction: 0.75, reached: false });
  assert.equal(targetProgress(8, 12).pct, 67);
  assert.equal(targetProgress(13.5, 12).pct, 113);
  assert.equal(targetProgress(13.5, 12).fraction, 1);
  assert.equal(targetProgress(0, 12).pct, 0);
  assert.equal(targetProgress(5, 0), null);
  assert.equal(targetProgress(5, undefined), null);
});
