import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../src/core/workout.js';

const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
/** A pre-filled (untouched) row. */
const A = (weight, reps, type = 'normal') => ({ weight, reps, type, done: false, auto: true });
const entry = (sets, t = { targetSets: 3, targetReps: 6, targetRepsMax: null }) => ({ exerciseId: 'x', ...t, sets, note: '' });
const WO = (id, date, entries, finished = true, startedAt = 1) => ({ id, date, startedAt, finishedAt: finished ? startedAt + 1 : null, exercises: entries });

test('formatSets / formatTarget match the sheet', () => {
  assert.equal(w.formatSets([S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset')]), '100 × 7, 100 × 8, 100 × 8 + drop 80 × 5');
  assert.equal(w.formatSets([S(100, 7), S(100, 8, 'normal', false)]), '100 × 7');
  assert.equal(w.formatSets([S(0, 12), S(null, 10), S(22.5, 8)]), 'BW × 12, BW × 10, 22.5 × 8');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: null }), '3 × 6');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: 8 }), '3 × 6–8');
  assert.equal(w.formatTarget({ targetSets: 4, targetReps: null }), '4 sets');
});

test('prefill copies last done sets (dropsets as dropsets), else target rows with empty weight', () => {
  const last = entry([S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset'), S(100, 3, 'normal', false)]);
  assert.deepEqual(w.prefillSets(last, { targetSets: 3, targetReps: 6 }), [A(100, 7), A(100, 8), A(100, 8), A(80, 5, 'dropset')]);
  assert.deepEqual(w.prefillSets(null, { targetSets: 2, targetReps: 6 }), [A(null, 6), A(null, 6)]);
});

test('lastEntryFor: newest finished with done sets, skipping excluded and unfinished', () => {
  const a = WO('a', '2026-11-10', [entry([S(90, 8)])]);
  const b = WO('b', '2026-11-12', [entry([S(100, 8)])]);
  const c = WO('c', '2026-11-12', [entry([S(110, 8)])], true, 5); // same day, later
  const d = WO('d', '2026-11-14', [entry([S(1, 1, 'normal', false)])]); // skipped
  const e = WO('e', '2026-11-15', [entry([S(120, 8)])], false);
  assert.equal(w.lastEntryFor([a, b, c, d, e], 'x').workout.id, 'c');
  assert.equal(w.lastEntryFor([a, b, c, d, e], 'x', { excludeId: 'c' }).workout.id, 'b');
  assert.equal(w.lastEntryFor([a], 'y'), null);
  assert.deepEqual(w.historyFor([a, b, c, d, e], 'x').map((h) => h.workout.id), ['c', 'b', 'a']);
});

test('buildEntry: explicit target wins, else last target, else default', () => {
  const b = WO('b', '2026-11-12', [entry([S(100, 8)], { targetSets: 5, targetReps: 5, targetRepsMax: null })]);
  const e1 = w.buildEntry('x', { targetSets: 3, targetReps: 6, targetRepsMax: 8 }, [b]);
  assert.equal(e1.targetSets, 3);
  assert.equal(e1.targetRepsMax, 8);
  assert.deepEqual(e1.sets, [A(100, 8), A(100, 8), A(100, 8)], 'at least targetSets rows');
  assert.equal(w.buildEntry('x', null, [b]).targetSets, 5);
  const e3 = w.buildEntry('new', null, [b]);
  assert.deepEqual([e3.targetSets, e3.targetReps, e3.sets.length], [3, 8, 3]);
});

test('normaliseTarget drops a max that is not above reps', () => {
  assert.deepEqual(w.normaliseTarget({ targetSets: 3, targetReps: 8, targetRepsMax: 8 }), { targetSets: 3, targetReps: 8, targetRepsMax: null, targetWeight: null });
  assert.deepEqual(w.normaliseTarget({ targetSets: 0, targetReps: 0 }), { targetSets: 3, targetReps: null, targetRepsMax: null, targetWeight: null });
});

test('fillDownTargets: untouched, undone, normal rows below only', () => {
  const sets = [S(100, 6, 'normal', false), S(100, 6, 'normal', true), S(100, 6, 'normal', false), S(80, 5, 'dropset', false), S(100, 6, 'normal', false)];
  const touched = new Set([4]);
  assert.deepEqual(w.fillDownTargets(sets, 0, (i) => !touched.has(i)), [2]);
  assert.deepEqual(w.pendingNormalSets(sets), [0, 2, 4]);
});

test('bestSet by estimated 1RM, normal sets only', () => {
  const h = [
    { workout: { id: 'a' }, entry: entry([S(100, 8), S(120, 1), S(150, 20, 'dropset')]) },
    { workout: { id: 'b' }, entry: entry([S(105, 5)]) },
  ];
  const b = w.bestSet(h);
  assert.deepEqual(b.set, S(100, 8));
  assert.equal(b.workout.id, 'a');
  assert.equal(w.bestSet([]), null);
  assert.equal(w.e1rm(100, 1), 100);
});

test('sessionStats and routineItemsFromWorkout', () => {
  const wo = { startedAt: 0, finishedAt: 3600000, exercises: [
    entry([S(100, 7), S(100, 8), S(80, 5, 'dropset'), S(1, 1, 'normal', false)]),
    { ...entry([S(1, 1, 'normal', false)]), exerciseId: 'y' },
    { ...entry([S(1, 1)]), exerciseId: 'x' },
  ] };
  assert.deepEqual(w.sessionStats(wo), { durationMs: 3600000, setsDone: 4, normalSets: 3, dropsets: 1, exercises: 2 });
  assert.deepEqual(w.routineItemsFromWorkout(wo).map((i) => i.exerciseId), ['x', 'y']);
});

// ---------------------------------------------------------------- target weight
test('formatTarget with a weight target; bodyweight/empty shows none', () => {
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: null, targetWeight: 100 }), '3 × 6 @ 100 kg');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: 8, targetWeight: 102.5 }), '3 × 6–8 @ 102.5 kg');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: null, targetWeight: 20 }), '3 sets @ 20 kg');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetWeight: 0 }), '3 × 6');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetWeight: null }), '3 × 6');
  assert.equal(w.normaliseTarget({ targetSets: 3, targetReps: 6, targetWeight: 82.456 }).targetWeight, 82.46);
  assert.equal(w.normaliseTarget({ targetSets: 3, targetReps: 6, targetWeight: -5 }).targetWeight, null);
  assert.equal(w.normaliseTarget({ targetSets: 3, targetReps: 6 }).targetWeight, null); // old data
});

test('prefill from the target weight only without a previous session', () => {
  const t = { targetSets: 3, targetReps: 6, targetWeight: 100 };
  assert.deepEqual(w.prefillSets(null, t), [A(100, 6), A(100, 6), A(100, 6)]);
  const last = entry([S(95, 6), S(95, 5)]);
  assert.deepEqual(w.prefillSets(last, t), [A(95, 6), A(95, 5), A(95, 5)]);
  const e = w.buildEntry('x', t, []);
  assert.equal(e.targetWeight, 100);
  assert.deepEqual(e.sets.map((s) => s.weight), [100, 100, 100]);
  const routineItems = w.routineItemsFromWorkout({ exercises: [e] });
  assert.equal(routineItems[0].targetWeight, 100);
});

test('targetCheck: per done normal set, met with targetSets hits', () => {
  const t = { targetSets: 3, targetReps: 6, targetRepsMax: 8, targetWeight: 100 };
  const e = { ...entry([S(100, 6), S(102.5, 7), S(100, 5), S(100, 6, 'normal', false), S(120, 8, 'dropset')], t) };
  assert.deepEqual(w.targetCheck(e), { perSet: [true, true, false, false, false], hits: 2, needed: 3, met: false });
  e.sets[2].reps = 6;
  assert.equal(w.targetCheck(e).met, true);
  assert.equal(w.targetCheck({ ...e, targetWeight: null }), null);
  assert.equal(w.targetCheck({ ...e, targetReps: null }), null);
});

// ---------------------------------------------------------------- dates / times
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 19, 20, 0);

test('atLocal / timeOfDay', () => {
  assert.equal(w.atLocal('2026-11-12', '07:05'), at(2026, 11, 12, 7, 5));
  assert.equal(w.atLocal('2026-11-12', '24:00'), null);
  assert.equal(w.atLocal('2026-02-30', '07:00'), null);
  assert.equal(w.timeOfDay(at(2026, 11, 12, 7, 5)), '07:05');
});

test('rescheduleWorkout: finished keeps duration, date follows start, no future', () => {
  const fin = { date: '2026-11-19', startedAt: at(2026, 11, 19, 18), finishedAt: at(2026, 11, 19, 19, 15) };
  const r = w.rescheduleWorkout(fin, { date: '2026-11-12', time: '07:30' }, NOW);
  assert.deepEqual(r, { ok: true, value: { date: '2026-11-12', startedAt: at(2026, 11, 12, 7, 30), finishedAt: at(2026, 11, 12, 8, 45), plannedDurationMs: null } });
  const r2 = w.rescheduleWorkout(fin, { date: '2026-11-12', time: '07:30', durationMin: 50 }, NOW);
  assert.equal(r2.value.finishedAt, at(2026, 11, 12, 8, 20));
  assert.equal(w.rescheduleWorkout(fin, { date: '2026-11-20', time: '07:00' }, NOW).ok, false);
  assert.equal(w.rescheduleWorkout(fin, { date: '2026-11-19', time: '20:30' }, NOW).ok, false); // starts in the future
  assert.equal(w.rescheduleWorkout(fin, { date: '2026-11-19', time: '19:30' }, NOW).ok, false); // would end 20:45
  assert.equal(w.rescheduleWorkout(fin, { date: '2026-11-12', time: '' }, NOW).ok, false);
  assert.equal(w.rescheduleWorkout(fin, { date: '2026-11-12', time: '07:00', durationMin: 0 }, NOW).ok, false);
  const open = { date: '2026-11-19', startedAt: at(2026, 11, 19, 19), finishedAt: null };
  assert.deepEqual(w.rescheduleWorkout(open, { date: '2026-11-09', time: '18:00', durationMin: 45 }, NOW).value,
    { date: '2026-11-09', startedAt: at(2026, 11, 9, 18), finishedAt: null, plannedDurationMs: 45 * 60000 });
  const rec = w.applySchedule({ ...open, plannedDurationMs: 5 }, w.rescheduleWorkout(open, { date: '2026-11-19', time: '19:10' }, NOW).value);
  assert.equal('plannedDurationMs' in rec, false);
  assert.equal(rec.startedAt, at(2026, 11, 19, 19, 10));
});

test('finishTime: live → now; past → start + planned or 60 min; never after now', () => {
  assert.equal(w.finishTime({ startedAt: NOW - 3600000 }, NOW), NOW);
  assert.equal(w.finishTime({ startedAt: at(2026, 11, 9, 18), plannedDurationMs: 45 * 60000 }, NOW), at(2026, 11, 9, 18, 45));
  assert.equal(w.finishTime({ startedAt: at(2026, 11, 9, 18) }, NOW), at(2026, 11, 9, 19));
  assert.equal(w.finishTime({ startedAt: NOW - 20 * 60000, plannedDurationMs: 3600000 }, NOW), NOW);
  assert.equal(w.finishTime({}, NOW), NOW);
});

test('lastEntryFor uses the most recent by date/time, not insertion order (back-dated insert)', () => {
  const newer = WO('n', '2026-11-18', [entry([S(110, 6)])], true, at(2026, 11, 18, 18));
  const backdated = WO('b', '2026-11-09', [entry([S(90, 6)])], true, at(2026, 11, 9, 18)); // created later
  assert.equal(w.lastEntryFor([newer, backdated], 'x').workout.id, 'n');
  assert.equal(w.lastEntryFor([backdated, newer], 'x').workout.id, 'n');
  // A session being logged for 10 Nov sees only what came before it.
  const logging = { id: 'l', date: '2026-11-10', startedAt: at(2026, 11, 10, 18) };
  const older = [newer, backdated].filter((x) => w.byRecent(x, logging) > 0);
  assert.deepEqual(older.map((x) => x.id), ['b']);
});

// ---------------------------------------------------------------- pre-fill row count, auto rows, logged predicate
test('prefill gives at least targetSets normal rows; extras copy the last done set, dropsets stay last', () => {
  const t = { targetSets: 3, targetReps: 8 };
  // 2 of 3 ticked last time
  assert.deepEqual(w.prefillSets(entry([S(100, 8), S(100, 7), S(100, 8, 'normal', false)]), t), [A(100, 8), A(100, 7), A(100, 7)]);
  // with a dropset: extras go before it
  assert.deepEqual(w.prefillSets(entry([S(100, 8), S(80, 5, 'dropset')]), t), [A(100, 8), A(100, 8), A(100, 8), A(80, 5, 'dropset')]);
  // only a dropset done: extras from the target
  assert.deepEqual(w.prefillSets(entry([S(80, 5, 'dropset')]), { ...t, targetWeight: 90 }), [A(90, 8), A(90, 8), A(90, 8), A(80, 5, 'dropset')]);
  // more done than the target: all kept
  assert.equal(w.prefillSets(entry([S(1, 1), S(1, 1), S(1, 1), S(1, 1)]), t).length, 4);
});

test('refreshAutoSets: untouched rows re-derived, edited/ticked rows kept', () => {
  const edited = { weight: 105, reps: 6, type: 'normal', done: false };
  const ticked = S(100, 8);
  const cur = [ticked, A(100, 8), edited, A(100, 8)];
  const fresh = [A(110, 6), A(110, 6), A(110, 6), A(110, 6), A(90, 5, 'dropset')];
  const out = w.refreshAutoSets(cur, fresh);
  assert.equal(out[0], ticked);
  assert.deepEqual(out[1], A(110, 6));
  assert.equal(out[2], edited);
  assert.deepEqual(out.slice(3), [A(110, 6), A(90, 5, 'dropset')]);
  // all untouched -> exactly fresh (row count may shrink)
  assert.deepEqual(w.refreshAutoSets([A(1, 8), A(1, 8), A(1, 8)], [A(100, 6), A(100, 6)]), [A(100, 6), A(100, 6)]);
  // target 3 x 8 -> 3 x 6 @ 100 without history (verifier case)
  const before = w.prefillSets(null, { targetSets: 3, targetReps: 8 });
  assert.deepEqual(w.refreshAutoSets(before, w.prefillSets(null, { targetSets: 3, targetReps: 6, targetWeight: 100 })), [A(100, 6), A(100, 6), A(100, 6)]);
});

test('isLoggedWorkout: finished with a done set; empty or unfinished workouts do not count', () => {
  assert.equal(w.isLoggedWorkout(WO('a', '2026-11-10', [entry([S(90, 8)])])), true);
  assert.equal(w.isLoggedWorkout(WO('b', '2026-11-10', [entry([S(90, 8, 'normal', false)])])), false);
  assert.equal(w.isLoggedWorkout(WO('c', '2026-11-10', [])), false);
  assert.equal(w.isLoggedWorkout(WO('d', '2026-11-10', [entry([S(90, 8)])], false)), false);
  assert.equal(w.hasDoneSet(WO('d', '2026-11-10', [entry([S(90, 8)])], false)), true);
});

test('format helpers take translated labels; English defaults stay for other callers', () => {
  const L = { sets: (n) => `${n} Sätze`, bw: 'KG', drop: 'Drop' };
  assert.equal(w.formatTarget({ targetSets: 4, targetReps: null }, L), '4 Sätze');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: 8, targetWeight: 100 }, L), '3 × 6–8 @ 100 kg');
  assert.equal(w.formatSets([S(0, 12), S(100, 8), S(80, 5, 'dropset')], L), 'KG × 12, 100 × 8 + Drop 80 × 5');
  assert.equal(w.formatWeight(null, L), 'KG');
  assert.equal(w.isBodyweightWeight(0), true);
  assert.equal(w.isBodyweightWeight(2.5), false);
});

test('rescheduleWorkout errors are catalogue keys with params', async () => {
  const { default: EN } = await import('../src/i18n/en/workout.js');
  const NOW = new Date(2026, 10, 19, 20, 0).getTime();
  const r = w.rescheduleWorkout({ finishedAt: null }, { date: '2026-11-12', time: '07:00', durationMin: 0 }, NOW);
  assert.deepEqual(r, { ok: false, error: 'workout.schedule.errDuration', params: { max: w.MAX_DURATION_MIN } });
  for (const input of [{ date: 'x', time: '07:00' }, { date: '2026-11-25', time: '07:00' }, { date: '2026-11-12', time: '' }]) {
    assert.ok(w.rescheduleWorkout({ finishedAt: null }, input, NOW).error in EN);
  }
});
