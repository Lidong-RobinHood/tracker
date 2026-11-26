// Starting point ("current bests"): one special finished workout record. Pure, no DOM / IndexedDB.
// Representation and semantics: docs/SPEC.md §3 (`workouts`, starting point).
//
//   { id, kind: 'baseline', date, routineId: null, name: 'Starting point',
//     startedAt = finishedAt = local midnight of `date`,
//     exercises: [ { exerciseId, targetSets: <sets>, targetReps: <reps>, targetRepsMax: null, targetWeight: null,
//                    sets: [ <sets> × {weight, reps, type: 'normal', done: true},
//                            optional {weight, reps, type: 'normal', done: true, best: true} ],
//                    note: '' } ],
//     createdAt, updatedAt }
//
// Bodyweight rows store weight null. The best set is appended last and only when it differs from
// the working set. `isBaseline` is the single predicate every consumer uses.
import { isValidDate, parseDate, addDays } from './dates.js';
import { round } from './numbers.js';

export const BASELINE_KIND = 'baseline';
/** Stored record name (data, not UI: screens show workout.startingPoint.title for isBaseline records). */
export const BASELINE_NAME = 'Starting point'; // i18n-ignore: stored sentinel name
export const DEFAULT_BASELINE_SETS = 3;
export const MAX_BASELINE_SETS = 10;
export const MAX_BASELINE_WEIGHT = 1000;
export const MAX_BASELINE_REPS = 100;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** true for the starting-point record. */
export function isBaseline(w) {
  return !!w && w.kind === BASELINE_KIND;
}

/** Workouts without starting points. */
export function realWorkouts(workouts) {
  return (workouts || []).filter((w) => w && !isBaseline(w));
}

/** The "best set" row of a starting point (never in real workouts). */
export function isBestSet(s) {
  return !!s && s.best === true;
}

/** Sets of an entry without the best-set row (the working sets). */
export function workingSets(entry) {
  return entry && Array.isArray(entry.sets) ? entry.sets.filter((s) => !isBestSet(s)) : [];
}

/** The entry without its best-set row; the same object when it has none. */
export function workingEntry(entry) {
  if (!entry || !Array.isArray(entry.sets) || !entry.sets.some(isBestSet)) return entry;
  return { ...entry, sets: workingSets(entry) };
}

/** The best-set row of an entry, or null. */
export function bestSetOf(entry) {
  return (entry && Array.isArray(entry.sets) && entry.sets.find(isBestSet)) || null;
}

/** The stored starting point (the most recently updated one if, unexpectedly, there are several). */
export function findBaseline(workouts) {
  let out = null;
  for (const w of workouts || []) {
    if (isBaseline(w) && (!out || (w.updatedAt || 0) > (out.updatedAt || 0))) out = w;
  }
  return out;
}

/** Default "as of" date: yesterday. */
export function defaultBaselineDate(todayStr) {
  return addDays(todayStr, -1);
}

/**
 * Editor rows from a stored starting point.
 * @returns {{exerciseId: string, weight: number|null, reps: number|null, sets: number, bestWeight: number|null, bestReps: number|null}[]}
 */
export function baselineRows(workout) {
  if (!workout) return [];
  return (workout.exercises || []).map((e) => {
    const work = workingSets(e).filter((s) => s && s.done);
    const first = work[0] || {};
    const best = bestSetOf(e);
    return {
      exerciseId: e.exerciseId,
      weight: isNum(first.weight) && first.weight > 0 ? first.weight : null,
      reps: isNum(first.reps) ? first.reps : null,
      sets: work.length || DEFAULT_BASELINE_SETS,
      bestWeight: best && isNum(best.weight) && best.weight > 0 ? best.weight : null,
      bestReps: best && isNum(best.reps) ? best.reps : null,
    };
  });
}

/**
 * Check editor input. Rows that are completely empty (no weight, reps or best) are dropped.
 * @param {{date: string, rows: object[]}} input
 * @param {{today: string, isBodyweight?: (exerciseId: string) => boolean}} ctx
 * @returns {{ok: true, value: {date: string, rows: object[]}} | {ok: false, error: string, params?: object, row?: number, field?: string}}
 *   row = index into input.rows; error = catalogue key (workout.baseline.err*) with optional params, translated by the UI
 */
export function validateBaseline({ date, rows }, { today, isBodyweight = () => false }) {
  if (!isValidDate(date)) return { ok: false, error: 'workout.baseline.errDate', field: 'date' };
  if (date > today) return { ok: false, error: 'workout.baseline.errFuture', field: 'date' };
  const out = [];
  const seen = new Set();
  for (let i = 0; i < (rows || []).length; i++) {
    const r = rows[i];
    if (!r || !r.exerciseId) continue;
    const bw = !!isBodyweight(r.exerciseId);
    const weight = bw ? null : r.weight;
    const bestWeight = bw ? null : r.bestWeight;
    const empty = [weight, r.reps, bestWeight, r.bestReps].every((v) => v === null || v === undefined);
    if (empty) continue;
    if (seen.has(r.exerciseId)) return { ok: false, error: 'workout.baseline.errTwice', row: i };
    seen.add(r.exerciseId);
    const bad = (v, max, int) => !isNum(v) || v <= 0 || v > max || (int && !Number.isInteger(v));
    if (!bw && bad(weight, MAX_BASELINE_WEIGHT)) return { ok: false, error: 'workout.baseline.errWeight', row: i, field: 'weight' };
    if (bad(r.reps, MAX_BASELINE_REPS, true)) return { ok: false, error: 'workout.baseline.errReps', row: i, field: 'reps' };
    const sets = r.sets === null || r.sets === undefined ? DEFAULT_BASELINE_SETS : r.sets;
    if (bad(sets, MAX_BASELINE_SETS, true)) return { ok: false, error: 'workout.baseline.errSets', params: { max: MAX_BASELINE_SETS }, row: i, field: 'sets' };
    let best = null;
    const hasBestW = bestWeight !== null && bestWeight !== undefined;
    const hasBestR = r.bestReps !== null && r.bestReps !== undefined;
    if (hasBestW || hasBestR) {
      if (!bw && bad(bestWeight, MAX_BASELINE_WEIGHT)) return { ok: false, error: 'workout.baseline.errBestWeight', row: i, field: 'bestWeight' };
      if (bad(r.bestReps, MAX_BASELINE_REPS, true)) return { ok: false, error: 'workout.baseline.errBestReps', row: i, field: 'bestReps' };
      const bwt = bw ? null : round(bestWeight, 2);
      if (!(bwt === (bw ? null : round(weight, 2)) && r.bestReps === r.reps)) best = { weight: bwt, reps: r.bestReps };
    }
    out.push({ exerciseId: r.exerciseId, weight: bw ? null : round(weight, 2), reps: r.reps, sets, best });
  }
  return { ok: true, value: { date, rows: out } };
}

/**
 * The record for validated input (validateBaseline().value).
 * @param {{date: string, rows: {exerciseId: string, weight: number|null, reps: number, sets: number, best: {weight: number|null, reps: number}|null}[]}} value
 * @param {{id: string, now: number, existing?: object|null}} opts existing: the stored record (keeps id/createdAt)
 */
export function buildBaseline({ date, rows }, { id, now, existing = null }) {
  const at = parseDate(date).getTime();
  return {
    id: existing ? existing.id : id,
    kind: BASELINE_KIND,
    date,
    routineId: null,
    name: BASELINE_NAME,
    startedAt: at,
    finishedAt: at,
    exercises: rows.map((r) => ({
      exerciseId: r.exerciseId,
      targetSets: r.sets,
      targetReps: r.reps,
      targetRepsMax: null,
      targetWeight: null,
      sets: [
        ...Array.from({ length: r.sets }, () => ({ weight: r.weight, reps: r.reps, type: 'normal', done: true })),
        ...(r.best ? [{ weight: r.best.weight, reps: r.best.reps, type: 'normal', done: true, best: true }] : []),
      ],
      note: '',
    })),
    createdAt: existing && isNum(existing.createdAt) ? existing.createdAt : now,
    updatedAt: now,
  };
}
