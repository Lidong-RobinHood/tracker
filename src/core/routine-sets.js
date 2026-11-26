// Sets per muscle for ONE session — a routine's plan (routineSets) or a logged workout (workoutSets) —
// the body-map band of a session total, and the tonnage band of the analysis map. Pure, no DOM / IndexedDB.
//
// Counting is the app's own rule (volume.js muscleVolumeBreakdown, via splits.js splitCoverage): every
// planned set is one done normal set; direct = sets × weights.primary for each primary muscle,
// partial = sets × weights.secondary for each secondary muscle. A routine plans no dropsets, so the
// dropset weight never applies here. Exercises missing from the lookup (deleted) count nothing.
import { MUSCLE_IDS } from './muscles.js';
import { splitCoverage } from './splits.js';
import { muscleVolumeBreakdown } from './volume.js';
import { bandStep, bandLegend, SESSION_BAND_EDGES } from './set-bands.js';

/**
 * @param {{items?: readonly {exerciseId: string, targetSets?: number}[]}} routine
 * @param {Map<string, object>|Record<string, object>} exercises by id
 * @param {{primary?: number, secondary?: number, dropset?: number}} weights settings.volume
 * @returns {Record<string, {total: number, direct: number, partial: number, directSets: number, partialSets: number}>}
 *   every muscle id (zeros included)
 */
export function routineSets(routine, exercises, weights) {
  const items = ((routine && routine.items) || [])
    .filter((it) => it && typeof it.exerciseId === 'string')
    .map((it) => ({ exerciseId: it.exerciseId, sets: Number.isFinite(it.targetSets) ? it.targetSets : 0 }));
  const cov = splitCoverage([{ items }], 1, exercises, weights);
  const out = {};
  for (const m of MUSCLE_IDS) {
    const { total, direct, partial, directSets, partialSets } = cov[m];
    out[m] = { total, direct, partial, directSets, partialSets };
  }
  return out;
}

/** Body-map step 0–4 for one session's total: ≥ 6 → 4, ≥ 4 → 3, ≥ 2 → 2, > 0 → 1, 0 → 0. */
export function sessionStep(total) {
  return bandStep(total, SESSION_BAND_EDGES);
}

/** Legend of sessionStep: '6+', '4–5.5', '2–3.5', 'Under 2', 'None' (default weights). */
export function sessionBands(weights) {
  return bandLegend(weights, SESSION_BAND_EDGES);
}

/**
 * Steps for the body map from a per-muscle result (routineSets or splitCoverage).
 * @param {Record<string, {total: number}>} sets
 * @param {(total: number) => number} [step] default sessionStep
 * @returns {Record<string, number>}
 */
export function mapSteps(sets, step = sessionStep) {
  return Object.fromEntries(MUSCLE_IDS.map((m) => [m, step(sets[m] ? sets[m].total : 0)]));
}

/**
 * Sets per muscle of one logged workout: done sets only, the app's rule (volume.js muscleVolumeBreakdown:
 * direct × primary weight, partial × secondary weight, dropset rows × dropset weight). The starting point
 * counts nothing (as everywhere). total = workoutVolume()[muscle] (0 when absent).
 * @returns {Record<string, {total: number, direct: number, partial: number, drop: number}>} every muscle id
 */
export function workoutSets(workout, exercises, weights) {
  const b = workout ? muscleVolumeBreakdown([workout], exercises, weights, { from: '0000-00-00', to: '9999-99-99' }) : {};
  return Object.fromEntries(MUSCLE_IDS.map((m) => {
    const r = b[m];
    return [m, r ? { total: r.total, direct: r.direct.value, partial: r.partial.value, drop: r.drop.value } : { total: 0, direct: 0, partial: 0, drop: 0 }];
  }));
}

/** Tonnage bands: share of the muscle with the most tonnage in that workout (over 3/4, 1/2, 1/4). */
export const TONNAGE_FRACTIONS = Object.freeze([0.75, 0.5, 0.25]);

/**
 * Body-map step 0–4 of a muscle's tonnage within one workout: > 3/4 of the largest → 4, > 1/2 → 3,
 * > 1/4 → 2, > 0 → 1, else 0. The largest muscle is always 4.
 * @param {number} t muscle tonnage (kg) @param {number} max largest muscle tonnage of the workout
 */
export function tonnageStep(t, max) {
  if (!(t > 0) || !(max > 0)) return 0;
  const f = t / max;
  const [a, b, c] = TONNAGE_FRACTIONS;
  return f > a ? 4 : f > b ? 3 : f > c ? 2 : 1;
}

/**
 * Legend of tonnageStep in kg for a workout whose largest muscle has `max`: 'Over 1 725 kg',
 * 'Over 1 150 kg', 'Over 575 kg', 'Up to 575 kg', 'None'. Labels are catalogue keys + params
 * (workout.band.over / workout.band.upTo {value}, workout.band.none); the UI translates them.
 * @param {number} max @param {(kg: number) => string} fmt display rule for kg (fmtTonnage in the UI)
 * @returns {{step: number, key: string, params?: {value: string}}[]}
 */
export function tonnageBands(max, fmt = (v) => `${Math.round(v)} kg`) {
  const [a, b, c] = TONNAGE_FRACTIONS.map((f) => fmt(f * max));
  return [
    { step: 4, key: 'workout.band.over', params: { value: a } },
    { step: 3, key: 'workout.band.over', params: { value: b } },
    { step: 2, key: 'workout.band.over', params: { value: c } },
    { step: 1, key: 'workout.band.upTo', params: { value: c } },
    { step: 0, key: 'workout.band.none' },
  ];
}
