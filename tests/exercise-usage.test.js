import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exerciseUsage, recentExercises, rankExercises, matchScore, compareUsage } from '../src/core/exercise-usage.js';

const S = (done = true) => ({ weight: 50, reps: 8, type: 'normal', done });
const WO = (id, date, startedAt, ids, done = true) => ({ id, date, startedAt, finishedAt: startedAt + 1, exercises: ids.map((exerciseId) => ({ exerciseId, sets: [S(done)] })) });
const EX = [
  { id: 'bench', name: 'Bench Press', equipment: 'barbell', primary: ['chest'] },
  { id: 'incl', name: 'Incline Bench Press', equipment: 'barbell', primary: ['chest'] },
  { id: 'db', name: 'Dumbbell Bench Press', equipment: 'dumbbell', primary: ['chest'] },
  { id: 'squat', name: 'Back Squat', equipment: 'barbell', primary: ['quads'] },
  { id: 'curl', name: 'Barbell Curl', equipment: 'barbell', primary: ['biceps'] },
  { id: 'row', name: 'Cable Row', equipment: 'cable', primary: ['back'] },
];

test('usage: one pass, count of workouts with done sets, latest by date then start (not insertion)', () => {
  const u = exerciseUsage([
    WO('a', '2026-11-18', 5, ['bench', 'squat']),
    WO('b', '2026-11-10', 9, ['bench', 'curl', 'curl']), // back-dated insert after a
    WO('c', '2026-11-18', 7, ['curl']),
    WO('d', '2026-11-19', 1, ['row'], false), // nothing done: not used
  ]);
  assert.deepEqual(u.get('bench'), { count: 2, lastDate: '2026-11-18', lastAt: 5 });
  assert.deepEqual(u.get('curl'), { count: 2, lastDate: '2026-11-18', lastAt: 7 });
  assert.deepEqual(u.get('squat'), { count: 1, lastDate: '2026-11-18', lastAt: 5 });
  assert.equal(u.has('row'), false);
  assert.ok(compareUsage(u.get('curl'), u.get('bench')) < 0);
  assert.ok(compareUsage(undefined, u.get('bench')) > 0);
});

test('recent: most recent first, then more often, limited', () => {
  const u = exerciseUsage([
    WO('a', '2026-11-12', 1, ['squat']),
    WO('b', '2026-11-12', 1, ['incl']),
    WO('c', '2026-11-05', 1, ['incl']),
    WO('d', '2026-11-18', 1, ['curl']),
  ]);
  // squat and incl share the last day and time; incl was used twice → first.
  assert.deepEqual(recentExercises(EX, u).map((e) => e.id), ['curl', 'incl', 'squat']);
  assert.deepEqual(recentExercises(EX, u, 2).map((e) => e.id), ['curl', 'incl']);
});

test('search: match quality first, used before unused among equal matches', () => {
  assert.equal(matchScore(EX[0], 'bench'), 4);
  assert.equal(matchScore(EX[1], 'bench'), 3);
  assert.equal(matchScore(EX[1], 'nch'), 2);
  assert.equal(matchScore(EX[3], 'quads'), 1);
  assert.equal(matchScore(EX[5], 'bench'), 0);
  const none = new Map();
  assert.deepEqual(rankExercises(EX, 'bench', none).map((e) => e.id), ['bench', 'db', 'incl']);
  const u = exerciseUsage([WO('a', '2026-11-18', 1, ['incl'])]);
  assert.deepEqual(rankExercises(EX, 'bench', u).map((e) => e.id), ['bench', 'incl', 'db']);
  assert.deepEqual(rankExercises(EX, 'press', u).map((e) => e.id), ['incl', 'bench', 'db']);
  assert.deepEqual(rankExercises(EX, 'barbell', u).map((e) => e.id), ['curl', 'incl', 'squat', 'bench']);
});
