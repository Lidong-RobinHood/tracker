// Workout session helpers. Pure, no DOM / IndexedDB. Records follow SPEC §3 (`workouts`).
import { round } from './numbers.js';

/** Default target for an exercise added without a routine or previous target. */
export const DEFAULT_TARGET = Object.freeze({ targetSets: 3, targetReps: 8, targetRepsMax: null });

/** @param {any} n */
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/** @param {{done?: boolean}} s */
export const isDone = (s) => !!(s && s.done);

/** Done sets of an exercise entry, in order (normal and dropset). */
export function doneSets(entry) {
  return entry && Array.isArray(entry.sets) ? entry.sets.filter(isDone) : [];
}

/**
 * Sort key for "most recent": date, then start time. Works for unfinished sessions too.
 * @returns {number} negative when a is more recent than b
 */
export function byRecent(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.startedAt || 0) - (a.startedAt || 0);
}

/**
 * The most recent FINISHED workout that "contains" the exercise, i.e. has an entry for it with at
 * least one done set (an exercise left in a routine but skipped does not count as history).
 * @param {object[]} workouts
 * @param {string} exerciseId
 * @param {{excludeId?: string|null}} [opts] skip this workout (the one being edited)
 * @returns {{workout: object, entry: object}|null}
 */
export function lastEntryFor(workouts, exerciseId, { excludeId = null } = {}) {
  const sorted = workouts.filter((w) => w && w.finishedAt && w.id !== excludeId).sort(byRecent);
  for (const w of sorted) {
    const entry = (w.exercises || []).find((e) => e.exerciseId === exerciseId && doneSets(e).length > 0);
    if (entry) return { workout: w, entry };
  }
  return null;
}

/**
 * Every finished workout's entry for the exercise (with ≥ 1 done set), newest first.
 * @returns {{workout: object, entry: object}[]}
 */
export function historyFor(workouts, exerciseId) {
  const out = [];
  for (const w of workouts.filter((x) => x && x.finishedAt).sort(byRecent)) {
    for (const entry of w.exercises || []) {
      if (entry.exerciseId === exerciseId && doneSets(entry).length) out.push({ workout: w, entry });
    }
  }
  return out;
}

/**
 * Rows for a new session's exercise card.
 * From the last entry: its done sets, same weight/reps/type, not done. Else: `targetSets` normal
 * rows with empty weight and reps = targetReps.
 * @param {object|null} lastEntry
 * @param {{targetSets?: number, targetReps?: number|null}} target
 * @returns {{weight: number|null, reps: number|null, type: 'normal'|'dropset', done: boolean}[]}
 */
export function prefillSets(lastEntry, target) {
  const done = doneSets(lastEntry);
  if (done.length) {
    return done.map((s) => ({
      weight: isNum(s.weight) ? s.weight : null,
      reps: isNum(s.reps) ? s.reps : null,
      type: s.type === 'dropset' ? 'dropset' : 'normal',
      done: false,
    }));
  }
  const n = Math.max(1, Math.min(20, Math.round(target.targetSets || DEFAULT_TARGET.targetSets)));
  return Array.from({ length: n }, () => ({
    weight: null, reps: isNum(target.targetReps) ? target.targetReps : null, type: 'normal', done: false,
  }));
}

/**
 * Normalise a target: sets ≥ 1, reps ≥ 1 or null, max > reps or null.
 * @returns {{targetSets: number, targetReps: number|null, targetRepsMax: number|null}}
 */
export function normaliseTarget(t = {}) {
  const sets = isNum(t.targetSets) && t.targetSets >= 1 ? Math.round(t.targetSets) : DEFAULT_TARGET.targetSets;
  const reps = isNum(t.targetReps) && t.targetReps >= 1 ? Math.round(t.targetReps) : null;
  let max = isNum(t.targetRepsMax) ? Math.round(t.targetRepsMax) : null;
  if (max !== null && (reps === null || max <= reps)) max = null;
  return { targetSets: sets, targetReps: reps, targetRepsMax: max };
}

/**
 * A new workout entry for one exercise.
 * @param {string} exerciseId
 * @param {object|null} target routine item / explicit target; null = last session's target, else default
 * @param {object[]} workouts all workouts (for prefill)
 * @param {{excludeId?: string|null}} [opts]
 */
export function buildEntry(exerciseId, target, workouts, opts = {}) {
  const last = lastEntryFor(workouts, exerciseId, opts);
  const t = normaliseTarget(target || (last ? last.entry : DEFAULT_TARGET));
  return { exerciseId, ...t, sets: prefillSets(last ? last.entry : null, t), note: '' };
}

/** '3 x 6', '3 x 6–8', '3 sets' */
export function formatTarget(t) {
  if (!t) return '';
  const sets = t.targetSets || DEFAULT_TARGET.targetSets;
  if (!isNum(t.targetReps)) return `${sets} sets`;
  return isNum(t.targetRepsMax) && t.targetRepsMax > t.targetReps
    ? `${sets} x ${t.targetReps}–${t.targetRepsMax}`
    : `${sets} x ${t.targetReps}`;
}

/** Display a weight in kg without unit: 100, 102.5, 'BW' for 0/empty. */
export function formatWeight(w) {
  if (!isNum(w) || w === 0) return 'BW';
  return String(round(w, 2));
}

/** '100×8' (reps unknown shows '?') */
export function formatSet(s) {
  return `${formatWeight(s.weight)}×${isNum(s.reps) ? s.reps : '?'}`;
}

/**
 * One-line summary of done sets, in order: '100×7, 100×8, 100×8 + drop 80×5'.
 * @param {object[]} sets (undone sets are ignored)
 */
export function formatSets(sets) {
  let out = '';
  for (const s of (sets || []).filter(isDone)) {
    if (s.type === 'dropset') out += `${out ? ' + ' : ''}drop ${formatSet(s)}`;
    else out += `${out ? ', ' : ''}${formatSet(s)}`;
  }
  return out;
}

/** Epley estimated 1RM; reps 1 = the weight itself. */
export function e1rm(weight, reps) {
  if (!isNum(weight) || !isNum(reps) || weight <= 0 || reps <= 0) return 0;
  return reps === 1 ? weight : weight * (1 + reps / 30);
}

/**
 * Best normal done set across history entries: highest estimated 1RM, then heavier weight.
 * @param {{workout: object, entry: object}[]} history
 * @returns {{set: object, workout: object, e1rm: number}|null}
 */
export function bestSet(history) {
  let best = null;
  for (const { workout, entry } of history) {
    for (const s of doneSets(entry)) {
      if (s.type !== 'normal') continue;
      const v = e1rm(s.weight, s.reps);
      if (v <= 0) continue;
      if (!best || v > best.e1rm || (v === best.e1rm && s.weight > best.set.weight)) best = { set: s, workout, e1rm: v };
    }
  }
  return best;
}

/**
 * Indices of rows that should receive a weight typed into row `from`: the untouched,
 * not-done NORMAL rows after it. Dropsets keep their own (lower) weight.
 * @param {object[]} sets
 * @param {number} from
 * @param {(i: number) => boolean} isUntouched
 * @returns {number[]}
 */
export function fillDownTargets(sets, from, isUntouched) {
  const out = [];
  for (let i = from + 1; i < sets.length; i++) {
    const s = sets[i];
    if (s.type === 'normal' && !s.done && isUntouched(i)) out.push(i);
  }
  return out;
}

/** Indices of the not-done normal rows (where a progression weight is applied). */
export function pendingNormalSets(sets) {
  const out = [];
  sets.forEach((s, i) => { if (s.type === 'normal' && !s.done) out.push(i); });
  return out;
}

/**
 * Numbers for the finish summary.
 * @param {object} workout
 * @param {number} [now] used when the workout is not finished yet
 * @returns {{durationMs: number, setsDone: number, normalSets: number, dropsets: number, exercises: number}}
 */
export function sessionStats(workout, now = Date.now()) {
  let normalSets = 0;
  let dropsets = 0;
  let exercises = 0;
  for (const e of workout.exercises || []) {
    const d = doneSets(e);
    if (d.length) exercises++;
    for (const s of d) {
      if (s.type === 'dropset') dropsets++;
      else normalSets++;
    }
  }
  const end = isNum(workout.finishedAt) ? workout.finishedAt : now;
  return {
    durationMs: isNum(workout.startedAt) ? Math.max(0, end - workout.startedAt) : 0,
    setsDone: normalSets + dropsets, normalSets, dropsets, exercises,
  };
}

/** Routine items from a workout (for "save as routine"); duplicate exercises are kept once. */
export function routineItemsFromWorkout(workout) {
  const seen = new Set();
  const items = [];
  for (const e of workout.exercises || []) {
    if (seen.has(e.exerciseId)) continue;
    seen.add(e.exerciseId);
    items.push({ exerciseId: e.exerciseId, ...normaliseTarget(e) });
  }
  return items;
}
