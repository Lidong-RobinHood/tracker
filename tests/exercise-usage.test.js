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

test('search: abbreviations and base lifts first among equal matches (seed library)', async () => {
  const { SEED_EXERCISES } = await import('../src/data/exercises.js');
  const lib = SEED_EXERCISES.map((e) => ({ ...e }));
  const top = (q, u = new Map()) => rankExercises(lib, q, u).slice(0, 3).map((e) => e.id);
  assert.equal(top('incline db')[0], 'seed:incline-dumbbell-press');
  assert.ok(rankExercises(lib, 'incline db', new Map()).every((e) => e.equipment === 'dumbbell' || e.id === 'seed:incline-dumbbell-press'));
  assert.equal(top('ohp')[0], 'seed:overhead-press');
  assert.equal(top('rdl')[0], 'seed:romanian-deadlift');
  assert.ok(rankExercises(lib, 'bb row', new Map()).every((e) => e.equipment === 'barbell'), '"bb" is barbell, not the bb in dumbbell');
  assert.ok(rankExercises(lib, 'bb row', new Map()).some((e) => e.id === 'seed:barbell-row'));
  assert.ok(rankExercises(lib, 'bw', new Map()).length > 3);
  assert.equal(top('bench')[0], 'seed:bench-press');
  // Bench Dip is not ahead of Bench Press (Barbell) / (Dumbbell)
  const bench = rankExercises(lib, 'bench', new Map()).map((e) => e.id);
  assert.ok(bench.indexOf('seed:dumbbell-bench-press') < bench.indexOf('seed:bench-dip'));
  // logged exercises still come first among equal matches
  const u = exerciseUsage([WO('a', '2026-11-18', 1, ['seed:bench-dip'])]);
  const b2 = rankExercises(lib, 'bench d', u).map((e) => e.id);
  assert.equal(b2[0], 'seed:bench-dip');
});

test('search: the translated name (altOf) matches too; the stored English name still matches', () => {
  const bench = { id: 'seed:bench-press', name: 'Bench Press (Barbell)', equipment: 'barbell', primary: ['chest'] };
  const curl = { id: 'seed:barbell-curl', name: 'Barbell Curl', equipment: 'barbell', primary: ['biceps'] };
  const alt = { 'seed:bench-press': { name: 'Bankdrücken (Langhantel)', terms: 'Langhantel Brust' }, 'seed:barbell-curl': { name: 'Langhantel-Curl', terms: 'Langhantel Bizeps' } };
  const altOf = (e) => alt[e.id];
  assert.equal(matchScore(bench, 'bankdr', altOf(bench)), 4);
  assert.equal(matchScore(bench, 'bench press (b', altOf(bench)), 4, 'English name prefix');
  assert.equal(matchScore(bench, 'brust', altOf(bench)), 1, 'translated muscle word');
  assert.equal(matchScore(bench, 'bankdr'), 0, 'without alt only English matches');
  assert.deepEqual(rankExercises([curl, bench], 'langhantel', new Map(), altOf).map((e) => e.id), ['seed:barbell-curl', 'seed:bench-press']);
  assert.deepEqual(recentExercises([curl, bench], new Map([['seed:bench-press', { count: 1, lastDate: '2026-01-01', lastAt: 0 }], ['seed:barbell-curl', { count: 1, lastDate: '2026-01-01', lastAt: 0 }]]), 12, altOf).map((e) => e.id),
    ['seed:bench-press', 'seed:barbell-curl'], 'ties ordered by the translated name');
});
