// Weekly volume per muscle (SPEC §5). Pure, no DOM / IndexedDB.
//
// For the workouts whose `date` falls in [from, to] (inclusive, YYYY-MM-DD) — finished or still in
// progress — every DONE set adds, per muscle of its exercise:
//   normal  set: weights.primary   to each primary muscle, weights.secondary to each secondary muscle
//   dropset row: weights.dropset × those same amounts
// Exercises missing from the lookup (deleted) are skipped. Results are rounded to 2 decimals.
// The starting point (baseline.js isBaseline) is not training and never counts (here, in the
// breakdown, in weekly targets and in recovery, which builds on workoutVolume).
import { MUSCLES } from './muscles.js';
import { isBaseline } from './baseline.js';
import { weekStart, addDays } from './dates.js';
import { round, percent } from './numbers.js';

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
    if (!wo || isBaseline(wo) || typeof wo.date !== 'string' || wo.date < from || wo.date > to) continue;
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

// ---------------------------------------------------------------- breakdown: direct vs partial
// How a muscle's weighted total is made up. Same counting rules as muscleVolume:
//   direct  = done NORMAL sets of exercises where the muscle is primary   (value = sets × primary)
//   partial = done NORMAL sets of exercises where the muscle is secondary (value = sets × secondary)
//   drop    = done DROPSET rows, either role (value = rows × dropset × primary/secondary weight);
//             dropDirect / dropPartial are the raw rows per role. Rows are counted even when the
//             dropset weight is 0 (value 0 then).
// total = direct.value + partial.value + drop.value, rounded to 2 decimals = muscleVolume()[muscle].

/**
 * @param {object[]} workouts
 * @param {Map<string, object>|Record<string, object>} exercises by id
 * @param {{primary?: number, secondary?: number, dropset?: number}} weights settings.volume
 * @param {{from: string, to: string}} range inclusive YYYY-MM-DD
 * @returns {Record<string, {total: number, direct: {sets: number, value: number}, partial: {sets: number, value: number},
 *   drop: {sets: number, value: number, direct: number, partial: number}}>} only muscles with at least one counted row
 */
export function muscleVolumeBreakdown(workouts, exercises, weights, { from, to }) {
  const w = volumeWeights(weights);
  const get = lookup(exercises);
  const acc = {};
  const row = (m) => (acc[m] ||= { total: 0, direct: { sets: 0, value: 0 }, partial: { sets: 0, value: 0 }, drop: { sets: 0, value: 0, direct: 0, partial: 0 } });
  for (const wo of workouts || []) {
    if (!wo || isBaseline(wo) || typeof wo.date !== 'string' || wo.date < from || wo.date > to) continue;
    for (const entry of wo.exercises || []) {
      const ex = get(entry.exerciseId);
      if (!ex) continue;
      for (const s of entry.sets || []) {
        if (!s || !s.done) continue;
        const drop = s.type === 'dropset';
        for (const [list, role, wt] of [[ex.primary, 'direct', w.primary], [ex.secondary, 'partial', w.secondary]]) {
          for (const m of list || []) {
            const r = row(m);
            if (drop) { r.drop.sets++; r.drop[role]++; r.drop.value += w.dropset * wt; } else { r[role].sets++; r[role].value += wt; }
          }
        }
      }
    }
  }
  for (const r of Object.values(acc)) {
    r.total = round(r.direct.value + r.partial.value + r.drop.value, 2);
    r.direct.value = round(r.direct.value, 2);
    r.partial.value = round(r.partial.value, 2);
    r.drop.value = round(r.drop.value, 2);
  }
  return acc;
}

/** Breakdown for the Mon–Sun week containing `date`. */
export function weeklyBreakdown(workouts, exercises, weights, date) {
  const start = weekStart(date);
  return muscleVolumeBreakdown(workouts, exercises, weights, { from: start, to: addDays(start, 6) });
}

// ---------------------------------------------------------------- weekly set targets
// Stored by the workout feature as setting 'volumeTargets': { [muscleId]: sets per week }.
// Missing setting (undefined), unknown muscles, non-numbers, ≤ 0 and > 100 are dropped.

/** Upper bound for a weekly set target per muscle. */
export const MAX_WEEKLY_TARGET = 100;

/**
 * Clean a stored targets object.
 * @param {any} value
 * @returns {Record<string, number>} muscleId -> target (rounded to 1 decimal)
 */
export function sanitiseTargets(value) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const m of MUSCLES) {
    const v = value[m.id];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const r = round(v, 1);
    if (r > 0 && r <= MAX_WEEKLY_TARGET) out[m.id] = r;
  }
  return out;
}

/**
 * Progress towards a weekly target.
 * pct = done / target × 100 rounded to a whole number (may exceed 100); fraction is capped at 1 for bars.
 * @param {number} done weighted sets done
 * @param {number|null|undefined} target
 * @returns {{done: number, target: number, pct: number, fraction: number, reached: boolean}|null} null without a valid target
 */
export function targetProgress(done, target) {
  if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) return null;
  const d = typeof done === 'number' && Number.isFinite(done) && done > 0 ? done : 0;
  return { done: d, target, pct: percent(d, target), fraction: Math.min(1, d / target), reached: d >= target };
}
