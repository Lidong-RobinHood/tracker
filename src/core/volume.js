// Weekly volume per muscle (SPEC §5). Pure, no DOM / IndexedDB.
//
// For the workouts whose `date` falls in [from, to] (inclusive, YYYY-MM-DD) — finished or still in
// progress — every DONE set adds, per muscle of its exercise:
//   normal  set: weights.primary   to each primary muscle, weights.secondary to each secondary muscle
//   dropset row: weights.dropset × those same amounts
// Exercises missing from the lookup (deleted) are skipped. Results are rounded to 2 decimals.
import { MUSCLES } from './muscles.js';
import { weekStart, addDays } from './dates.js';
import { round } from './numbers.js';

export const DEFAULT_VOLUME = Object.freeze({ primary: 1, secondary: 0.5, dropset: 0 });

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);

/** Fill missing/invalid weights with defaults. */
export function volumeWeights(w = {}) {
  return {
    primary: num(w && w.primary, DEFAULT_VOLUME.primary),
    secondary: num(w && w.secondary, DEFAULT_VOLUME.secondary),
    dropset: num(w && w.dropset, DEFAULT_VOLUME.dropset),
  };
}

/**
 * Add one workout's done sets into `acc`.
 * @param {Record<string, number>} acc muscleId -> sets
 * @param {object} workout
 * @param {(id: string) => object|undefined} getExercise
 * @param {{primary: number, secondary: number, dropset: number}} w
 */
function addWorkout(acc, workout, getExercise, w) {
  for (const entry of workout.exercises || []) {
    const ex = getExercise(entry.exerciseId);
    if (!ex) continue;
    for (const s of entry.sets || []) {
      if (!s || !s.done) continue;
      const f = s.type === 'dropset' ? w.dropset : 1;
      if (f === 0) continue;
      for (const m of ex.primary || []) acc[m] = (acc[m] || 0) + f * w.primary;
      for (const m of ex.secondary || []) acc[m] = (acc[m] || 0) + f * w.secondary;
    }
  }
}

/** @param {Map<string, object>|Record<string, object>} exercises */
function lookup(exercises) {
  return exercises instanceof Map ? (id) => exercises.get(id) : (id) => exercises[id];
}

/**
 * Sets per muscle for workouts dated within [from, to].
 * @param {object[]} workouts
 * @param {Map<string, object>|Record<string, object>} exercises by id
 * @param {{primary?: number, secondary?: number, dropset?: number}} weights settings.volume
 * @param {{from: string, to: string}} range
 * @returns {Record<string, number>} only muscles with a non-zero value
 */
export function muscleVolume(workouts, exercises, weights, { from, to }) {
  const w = volumeWeights(weights);
  const get = lookup(exercises);
  const acc = {};
  for (const wo of workouts) {
    if (!wo || typeof wo.date !== 'string' || wo.date < from || wo.date > to) continue;
    addWorkout(acc, wo, get, w);
  }
  for (const k of Object.keys(acc)) {
    acc[k] = round(acc[k], 2);
    if (acc[k] === 0) delete acc[k];
  }
  return acc;
}

/** Volume for a single workout (finish summary). */
export function workoutVolume(workout, exercises, weights) {
  return muscleVolume([workout], exercises, weights, { from: '0000-00-00', to: '9999-99-99' });
}

/**
 * The Mon–Sun week containing `date` versus the week before.
 * @returns {{weekStart: string, weekEnd: string, rows: {muscle: string, name: string, current: number, previous: number}[]}}
 *   rows in the fixed muscle order, only muscles with a value in either week
 */
export function weeklyComparison(workouts, exercises, weights, date) {
  const start = weekStart(date);
  const end = addDays(start, 6);
  const cur = muscleVolume(workouts, exercises, weights, { from: start, to: end });
  const prev = muscleVolume(workouts, exercises, weights, { from: addDays(start, -7), to: addDays(start, -1) });
  const rows = MUSCLES
    .map((m) => ({ muscle: m.id, name: m.name, current: cur[m.id] || 0, previous: prev[m.id] || 0 }))
    .filter((r) => r.current || r.previous);
  return { weekStart: start, weekEnd: end, rows };
}
