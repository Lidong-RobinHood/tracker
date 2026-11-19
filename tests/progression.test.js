import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestProgression, evaluateEntry } from '../src/core/progression.js';

const bench = { id: 'seed:bench-press', increment: 2.5 };
const S = (weight, reps, type = 'normal', done = true) => ({ weight, reps, type, done });

let n = 0;
function wo(date, sets, { finished = true, target = { targetSets: 3, targetReps: 6, targetRepsMax: null }, exerciseId = bench.id } = {}) {
  n++;
  return {
    id: `w${n}`, date, routineId: null, name: 'W', startedAt: n * 1000, finishedAt: finished ? n * 1000 + 500 : null,
    exercises: [{ exerciseId, ...target, sets, note: '' }],
  };
}

test('the sheet example: 3 x 6, 100×7, 100×8, 100×8 + drop 80×5 -> 102.5', () => {
  const w = wo('2026-11-12', [S(100, 7), S(100, 8), S(100, 8), S(80, 5, 'dropset')]);
  const r = suggestProgression([w], bench);
  assert.equal(r.weight, 102.5);
  assert.equal(r.from, 100);
  assert.equal(r.workoutId, w.id);
});

test('one set misses the target -> no suggestion', () => {
  const w = wo('2026-11-12', [S(100, 7), S(100, 5), S(100, 8)]);
  assert.equal(suggestProgression([w], bench), null);
});

test('range target uses targetRepsMax', () => {
  const t = { targetSets: 3, targetReps: 6, targetRepsMax: 8 };
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 7), S(100, 8)], { target: t })], bench), null);
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 9), S(100, 8)], { target: t })], bench).weight, 102.5);
});

test('dropsets never count: a failed dropset does not block, a dropset cannot fill a missing set', () => {
  const ok = wo('2026-11-12', [S(100, 6), S(100, 6), S(100, 6), S(80, 2, 'dropset')]);
  assert.equal(suggestProgression([ok], bench).weight, 102.5);
  const short = wo('2026-11-12', [S(100, 6), S(100, 6), S(100, 9, 'dropset')]);
  assert.equal(suggestProgression([short], bench), null);
});

test('fewer done normal sets than target -> none; undone sets are ignored', () => {
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 8)])], bench), null);
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8, 'normal', false)])], bench), null);
  // An undone extra set does not spoil a complete one.
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8), S(100, 2, 'normal', false)])], bench).weight, 102.5);
});

test('more sets than target: all of them must hit', () => {
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8), S(100, 8)])], bench).weight, 102.5);
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8), S(100, 4)])], bench), null);
});

test('mixed weights -> no suggestion', () => {
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 8), S(102.5, 8), S(100, 8)])], bench), null);
});

test('bodyweight (weight 0 or empty) -> no suggestion', () => {
  assert.equal(suggestProgression([wo('2026-11-12', [S(0, 12), S(0, 12), S(0, 12)])], bench), null);
  assert.equal(suggestProgression([wo('2026-11-12', [S(null, 12), S(null, 12), S(null, 12)])], bench), null);
});

test('increment 0 -> none; missing increment -> 2.5; fractional increments are rounded', () => {
  const w = wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8)]);
  assert.equal(suggestProgression([w], { id: bench.id, increment: 0 }), null);
  assert.equal(suggestProgression([w], { id: bench.id }).weight, 102.5);
  const w2 = wo('2026-11-12', [S(10.1, 8), S(10.1, 8), S(10.1, 8)]);
  assert.equal(suggestProgression([w2], { id: bench.id, increment: 0.2 }).weight, 10.3);
});

test('no history -> null; only the most recent finished session counts', () => {
  assert.equal(suggestProgression([], bench), null);
  const old = wo('2026-11-05', [S(100, 8), S(100, 8), S(100, 8)]);
  const recentMiss = wo('2026-11-12', [S(100, 8), S(100, 4), S(100, 8)]);
  assert.equal(suggestProgression([old, recentMiss], bench), null);
  // An unfinished session is ignored; so is the session being logged (excludeId).
  const open = wo('2026-11-19', [S(105, 1)], { finished: false });
  const hit = wo('2026-11-13', [S(100, 8), S(100, 8), S(100, 8)]);
  assert.equal(suggestProgression([old, recentMiss, hit, open], bench).weight, 102.5);
  assert.equal(suggestProgression([old, recentMiss, hit], bench, { excludeId: hit.id }), null);
});

test('a session where the exercise was skipped (no done sets) is not "containing" it', () => {
  const hit = wo('2026-11-12', [S(100, 8), S(100, 8), S(100, 8)]);
  const skipped = wo('2026-11-14', [S(100, 6, 'normal', false)]);
  assert.equal(suggestProgression([hit, skipped], bench).weight, 102.5);
});

test('fallback target when the entry has none; no reps target -> null', () => {
  const entry = { sets: [S(50, 10), S(50, 10)] };
  assert.equal(evaluateEntry(entry, 2.5, { targetSets: 2, targetReps: 10 }).weight, 52.5);
  assert.equal(evaluateEntry(entry, 2.5, {}), null);
  assert.equal(evaluateEntry({ targetSets: 2, targetReps: null, sets: entry.sets }, 2.5), null);
});

test('item 9: top weight rule — warm-ups and back-off sets are ignored', () => {
  // warm-up logged as a normal set
  const warm = suggestProgression([wo('2026-11-12', [S(60, 10), S(100, 8), S(100, 8), S(100, 8)])], bench);
  assert.equal(warm.weight, 102.5);
  assert.equal(warm.from, 100);
  assert.equal(warm.sets, 3);
  // only 2 sets at the top weight and one of them missed
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 6), S(100, 5), S(90, 8)])], bench), null);
  // top weight 102.5 has a single set
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 6), S(100, 6), S(100, 6), S(102.5, 3)])], bench), null);
  // plain 3 × 6 at 100 as before
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 6), S(100, 6), S(100, 6)])], bench).weight, 102.5);
  // back-off set after the top sets does not block
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 6), S(100, 6), S(100, 6), S(80, 3)])], bench).weight, 102.5);
  // dropsets still never count
  assert.equal(suggestProgression([wo('2026-11-12', [S(100, 6), S(100, 6), S(110, 9, 'dropset')])], bench), null);
});

test('item 9: the starting point never triggers a suggestion, even with warm-up rows', () => {
  const base = { id: 'b', kind: 'baseline', date: '2026-11-12', routineId: null, name: 'Starting point', startedAt: 1, finishedAt: 1,
    exercises: [{ exerciseId: bench.id, targetSets: 3, targetReps: 6, targetRepsMax: null, sets: [S(60, 10), S(100, 8), S(100, 8), S(100, 8)], note: '' }] };
  assert.equal(suggestProgression([base], bench), null);
});

test('item 9: the chip applies the new weight to the pending top-weight sets, not to warm-ups', async () => {
  const { setsForSuggestion } = await import('../src/core/progression.js');
  const sets = [S(60, 10, 'normal', false), S(100, 6, 'normal', false), S(100, 6, 'normal', false), S(null, null, 'normal', false), S(80, 5, 'dropset', false), S(100, 6)];
  assert.deepEqual(setsForSuggestion(sets, 100), [1, 2, 3]);
  // no pending set at the old top weight → every pending normal set (previous behaviour)
  assert.deepEqual(setsForSuggestion([S(60, 10, 'normal', false), S(70, 10, 'normal', false)], 100), [0, 1]);
});
