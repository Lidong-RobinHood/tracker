import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muscleVolume, weeklyComparison, workoutVolume, volumeWeights } from '../src/core/volume.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const DEF = { primary: 1, secondary: 0.5, dropset: 0 };
const S = (type = 'normal', done = true) => ({ weight: 50, reps: 8, type, done });
const W = (date, exerciseId, sets, finished = true) => ({
  id: `${date}-${exerciseId}`, date, startedAt: 1, finishedAt: finished ? 2 : null,
  exercises: [{ exerciseId, targetSets: 3, targetReps: 8, targetRepsMax: null, sets, note: '' }],
});

test('neutral-grip pull-up, 3 done normal sets -> back 3, biceps 1.5, forearms 1.5', () => {
  const v = muscleVolume([W('2026-11-17', 'seed:neutral-grip-pull-up', [S(), S(), S()])], EX, DEF,
    { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(v, { back: 3, biceps: 1.5, forearms: 1.5 });
});

test('undone sets do not count; dropsets count only with a dropset weight', () => {
  const w = W('2026-11-17', 'seed:neutral-grip-pull-up', [S(), S('normal', false), S('dropset')]);
  const r = { from: '2026-11-16', to: '2026-11-22' };
  assert.deepEqual(muscleVolume([w], EX, DEF, r), { back: 1, biceps: 0.5, forearms: 0.5 });
  assert.deepEqual(muscleVolume([w], EX, { ...DEF, dropset: 0.5 }, r), { back: 1.5, biceps: 0.75, forearms: 0.75 });
});

test('weights from settings change the result', () => {
  const w = W('2026-11-17', 'seed:neutral-grip-pull-up', [S(), S(), S()]);
  const v = muscleVolume([w], EX, { primary: 1, secondary: 1, dropset: 0 }, { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(v, { back: 3, biceps: 3, forearms: 3 });
});

test('week boundaries are inclusive Mon–Sun; in-progress sessions count; unknown exercises skipped', () => {
  const ws = [
    W('2026-11-15', 'seed:bench-press', [S()]),          // Sun of previous week
    W('2026-11-16', 'seed:bench-press', [S()]),          // Mon
    W('2026-11-22', 'seed:bench-press', [S()], false),   // Sun, unfinished
    W('2026-11-23', 'seed:bench-press', [S()]),          // next Mon
    W('2026-11-18', 'custom:deleted', [S()]),
  ];
  const cmp = weeklyComparison(ws, EX, DEF, '2026-11-18');
  assert.equal(cmp.weekStart, '2026-11-16');
  assert.equal(cmp.weekEnd, '2026-11-22');
  const chest = cmp.rows.find((r) => r.muscle === 'chest');
  assert.deepEqual(chest, { muscle: 'chest', name: 'Chest', current: 2, previous: 1 });
  const tri = cmp.rows.find((r) => r.muscle === 'triceps');
  assert.equal(tri.current, 1);
  assert.equal(tri.previous, 0.5);
  assert.ok(!cmp.rows.some((r) => r.muscle === 'quads'));
  // rows follow the fixed muscle order
  assert.deepEqual(cmp.rows.map((r) => r.muscle), ['chest', 'shoulders', 'triceps']);
});

test('works with a plain object lookup and invalid weights fall back to defaults', () => {
  const ex = { a: { id: 'a', primary: ['quads'], secondary: ['glutes'] } };
  const w = W('2026-11-18', 'a', [S(), S()]);
  assert.deepEqual(workoutVolume(w, ex, { primary: -1, secondary: 'x' }), { quads: 2, glutes: 1 });
  assert.deepEqual(volumeWeights(null), DEF);
});
