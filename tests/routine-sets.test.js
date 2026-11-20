import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routineSets, sessionStep, sessionBands, mapSteps } from '../src/core/routine-sets.js';
import { bandStep, bandLegend, WEEK_BAND_EDGES, SESSION_BAND_EDGES } from '../src/core/set-bands.js';
import { coverageStep, coverageBands } from '../src/core/splits.js';
import { MUSCLE_IDS } from '../src/core/muscles.js';

const EX = new Map([
  ['bench', { id: 'bench', primary: ['chest'], secondary: ['triceps', 'shoulders'] }],
  ['ohp', { id: 'ohp', primary: ['shoulders'], secondary: ['triceps'] }],
  ['dip', { id: 'dip', primary: ['chest', 'triceps'], secondary: [] }],
]);

test('routineSets: direct = sets × primary weight, partial = sets × secondary weight, every muscle present', () => {
  const r = { items: [
    { exerciseId: 'bench', targetSets: 3 },
    { exerciseId: 'ohp', targetSets: 3 },
    { exerciseId: 'dip', targetSets: 2 },
  ] };
  const s = routineSets(r, EX, { primary: 1, secondary: 0.5, dropset: 0 });
  assert.deepEqual(Object.keys(s).sort(), [...MUSCLE_IDS].sort());
  assert.deepEqual(s.chest, { total: 5, direct: 5, partial: 0, directSets: 5, partialSets: 0 });
  // triceps: dip 2 direct; bench 3 + ohp 3 partial × 0.5
  assert.deepEqual(s.triceps, { total: 5, direct: 2, partial: 3, directSets: 2, partialSets: 6 });
  // shoulders: ohp 3 direct, bench 3 × 0.5
  assert.deepEqual(s.shoulders, { total: 4.5, direct: 3, partial: 1.5, directSets: 3, partialSets: 3 });
  assert.equal(s.quads.total, 0);
});

test('routineSets: user weights apply; dropset weight never does (no planned dropsets)', () => {
  const r = { items: [{ exerciseId: 'bench', targetSets: 4 }] };
  const s = routineSets(r, EX, { primary: 1, secondary: 0.25, dropset: 1 });
  assert.equal(s.chest.total, 4);
  assert.equal(s.triceps.total, 1);
  const z = routineSets(r, EX, { primary: 1, secondary: 0, dropset: 0 });
  assert.equal(z.triceps.total, 0);
});

test('routineSets: unknown exercises, bad or missing targets and empty routines count nothing', () => {
  assert.equal(routineSets({ items: [{ exerciseId: 'gone', targetSets: 3 }] }, EX, {}).chest.total, 0);
  assert.equal(routineSets({ items: [{ exerciseId: 'bench' }] }, EX, {}).chest.total, 0);
  assert.equal(routineSets({ items: [{ exerciseId: 'bench', targetSets: NaN }] }, EX, {}).chest.total, 0);
  assert.equal(routineSets({}, EX, {}).chest.total, 0);
  assert.equal(routineSets(null, EX, {}).back.total, 0);
  // the same exercise twice adds up
  assert.equal(routineSets({ items: [{ exerciseId: 'bench', targetSets: 3 }, { exerciseId: 'bench', targetSets: 2 }] }, EX, {}).chest.total, 5);
});

test('sessionStep / sessionBands: 6+, 4–5.5, 2–3.5, under 2, none', () => {
  assert.deepEqual([0, -1, NaN, 0.5, 1.5, 2, 3.5, 4, 5.5, 6, 20].map(sessionStep), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(sessionBands({}).map((b) => b.label), ['6+', '4–5.5', '2–3.5', 'Under 2', 'None']);
  assert.deepEqual(sessionBands({ primary: 1, secondary: 0 }).map((b) => b.label), ['6+', '4–5', '2–3', 'Under 2', 'None']);
  assert.deepEqual(sessionBands({ primary: 1, secondary: 0.3 }).map((b) => b.label), ['6+', '4–under 6', '2–under 4', 'Under 2', 'None']);
  assert.deepEqual(sessionBands({}).map((b) => b.step), [4, 3, 2, 1, 0]);
});

test('bandStep / bandLegend are the shared rule behind the weekly split bands', () => {
  assert.deepEqual(WEEK_BAND_EDGES, [12, 8, 4]);
  assert.deepEqual(SESSION_BAND_EDGES, [6, 4, 2]);
  for (const v of [0, 0.5, 3.5, 4, 7.5, 8, 11.5, 12, 30]) assert.equal(coverageStep(v), bandStep(v, WEEK_BAND_EDGES));
  assert.deepEqual(coverageBands({}), bandLegend({}, WEEK_BAND_EDGES));
  assert.equal(bandStep(5), 2); // default = week
});

test('mapSteps: one step per muscle id', () => {
  const s = routineSets({ items: [{ exerciseId: 'bench', targetSets: 3 }, { exerciseId: 'dip', targetSets: 3 }] }, EX, {});
  const steps = mapSteps(s);
  assert.equal(steps.chest, 4); // 6
  assert.equal(steps.triceps, 3); // 3 + 1.5
  assert.equal(steps.shoulders, 1); // 1.5
  assert.equal(steps.back, 0);
  assert.equal(Object.keys(steps).length, MUSCLE_IDS.length);
  assert.equal(mapSteps(s, coverageStep).chest, 2);
});

import { workoutSets, tonnageStep, tonnageBands } from '../src/core/routine-sets.js';
import { workoutVolume } from '../src/core/volume.js';
import { BASELINE_KIND } from '../src/core/baseline.js';

const done = (n, type = 'normal') => Array.from({ length: n }, () => ({ weight: 100, reps: 5, type, done: true }));

test('workoutSets: done sets per muscle, equals workoutVolume number for number (dropsets per the setting)', () => {
  const w = { date: '2026-11-20', exercises: [
    { exerciseId: 'bench', sets: [...done(3), ...done(1, 'dropset'), { weight: 100, reps: 5, type: 'normal', done: false }] },
    { exerciseId: 'ohp', sets: done(2) },
  ] };
  for (const weights of [{}, { primary: 1, secondary: 0.5, dropset: 0.5 }, { primary: 1, secondary: 0.25, dropset: 1 }]) {
    const s = workoutSets(w, EX, weights);
    const v = workoutVolume(w, EX, weights);
    for (const m of MUSCLE_IDS) assert.equal(s[m].total, v[m] || 0, m);
  }
  const s = workoutSets(w, EX, { primary: 1, secondary: 0.5, dropset: 0.5 });
  assert.deepEqual(s.chest, { total: 3.5, direct: 3, partial: 0, drop: 0.5 });
  // triceps: bench 3 partial (1.5) + ohp 2 partial (1) + drop 1 × 0.5 × 0.5
  assert.deepEqual(s.triceps, { total: 2.75, direct: 0, partial: 2.5, drop: 0.25 });
  assert.equal(s.quads.total, 0);
});

test('workoutSets: the starting point and empty input count nothing', () => {
  const base = { date: '2026-11-01', kind: BASELINE_KIND, exercises: [{ exerciseId: 'bench', sets: done(3) }] };
  assert.equal(workoutSets(base, EX, {}).chest.total, 0);
  assert.equal(workoutSets(null, EX, {}).chest.total, 0);
});

test('tonnageStep / tonnageBands: quarters of the largest muscle', () => {
  assert.deepEqual([0, -5, 100, 250, 251, 500, 501, 750, 751, 1000].map((t) => tonnageStep(t, 1000)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(tonnageStep(10, 0), 0);
  assert.deepEqual(tonnageBands(2300).map((b) => b.label), ['Over 1725 kg', 'Over 1150 kg', 'Over 575 kg', 'Up to 575 kg', 'None']);
  assert.deepEqual(tonnageBands(2300, (v) => `${v} x`)[0], { step: 4, label: 'Over 1725 x' });
});
