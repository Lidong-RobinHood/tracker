import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as w from '../src/core/workout.js';

const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });
const entry = (sets, t = { targetSets: 3, targetReps: 6, targetRepsMax: null }) => ({ exerciseId: 'x', ...t, sets, note: '' });
const WO = (id, date, entries, finished = true, startedAt = 1) => ({ id, date, startedAt, finishedAt: finished ? startedAt + 1 : null, exercises: entries });

test('formatSets / formatTarget match the sheet', () => {
  assert.equal(w.formatSets([S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset')]), '100×7, 100×8, 100×8 + drop 80×5');
  assert.equal(w.formatSets([S(100, 7), S(100, 8, 'normal', false)]), '100×7');
  assert.equal(w.formatSets([S(0, 12), S(null, 10), S(22.5, 8)]), 'BW×12, BW×10, 22.5×8');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: null }), '3 x 6');
  assert.equal(w.formatTarget({ targetSets: 3, targetReps: 6, targetRepsMax: 8 }), '3 x 6–8');
  assert.equal(w.formatTarget({ targetSets: 4, targetReps: null }), '4 sets');
});

test('prefill copies last done sets (dropsets as dropsets), else target rows with empty weight', () => {
  const last = entry([S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset'), S(100, 3, 'normal', false)]);
  assert.deepEqual(w.prefillSets(last, { targetSets: 3, targetReps: 6 }), [
    S(100, 7, 'normal', false), S(100, 8, 'normal', false), S(100, 8, 'normal', false), S(80, 5, 'dropset', false),
  ]);
  assert.deepEqual(w.prefillSets(null, { targetSets: 2, targetReps: 6 }), [S(null, 6, 'normal', false), S(null, 6, 'normal', false)]);
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
  assert.deepEqual(e1.sets, [S(100, 8, 'normal', false)]);
  assert.equal(w.buildEntry('x', null, [b]).targetSets, 5);
  const e3 = w.buildEntry('new', null, [b]);
  assert.deepEqual([e3.targetSets, e3.targetReps, e3.sets.length], [3, 8, 3]);
});

test('normaliseTarget drops a max that is not above reps', () => {
  assert.deepEqual(w.normaliseTarget({ targetSets: 3, targetReps: 8, targetRepsMax: 8 }), { targetSets: 3, targetReps: 8, targetRepsMax: null });
  assert.deepEqual(w.normaliseTarget({ targetSets: 0, targetReps: 0 }), { targetSets: 3, targetReps: null, targetRepsMax: null });
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
