// Workout session helpers. Pure, no DOM / IndexedDB. Records follow SPEC §3 (`workouts`).
import { round } from './numbers.js';
import { isValidDate, parseDate, fromTimestamp, today } from './dates.js';

/** Default target for an exercise added without a routine or previous target. */
export const DEFAULT_TARGET = Object.freeze({ targetSets: 3, targetReps: 8, targetRepsMax: null, targetWeight: null });
/** Largest target weight accepted (kg). */
export const MAX_TARGET_WEIGHT = 1000;

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
  return (b.startedAt || 0) - (a.startedAt || 0) || (b.finishedAt || 0) - (a.finishedAt || 0);
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
 * rows with weight = targetWeight (empty when there is none) and reps = targetReps.
 * @param {object|null} lastEntry
 * @param {{targetSets?: number, targetReps?: number|null, targetWeight?: number|null}} target
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
  const tw = cleanTargetWeight(target.targetWeight);
  return Array.from({ length: n }, () => ({
    weight: tw, reps: isNum(target.targetReps) ? target.targetReps : null, type: 'normal', done: false,
  }));
}

/** A target weight in kg: > 0 and ≤ 1000, 2 decimals; anything else (missing, 0 = bodyweight) → null. */
export function cleanTargetWeight(w) {
  return isNum(w) && w > 0 && w <= MAX_TARGET_WEIGHT ? round(w, 2) : null;
}

/**
 * Normalise a target: sets ≥ 1, reps ≥ 1 or null, max > reps or null, weight (kg) > 0 or null.
 * Stored data without `targetWeight` reads as null (no weight target).
 * @returns {{targetSets: number, targetReps: number|null, targetRepsMax: number|null, targetWeight: number|null}}
 */
export function normaliseTarget(t = {}) {
  const sets = isNum(t.targetSets) && t.targetSets >= 1 ? Math.round(t.targetSets) : DEFAULT_TARGET.targetSets;
  const reps = isNum(t.targetReps) && t.targetReps >= 1 ? Math.round(t.targetReps) : null;
  let max = isNum(t.targetRepsMax) ? Math.round(t.targetRepsMax) : null;
  if (max !== null && (reps === null || max <= reps)) max = null;
  return { targetSets: sets, targetReps: reps, targetRepsMax: max, targetWeight: cleanTargetWeight(t.targetWeight) };
}

/**
 * Compare the done sets of an entry with its target weight. null when the entry has no target
 * weight (or no reps target): nothing is shown then.
 * A done NORMAL set meets the target when weight ≥ targetWeight and reps ≥ targetReps (the low end
 * of a range). `met` = at least targetSets such sets. Dropsets are ignored.
 * @returns {{perSet: boolean[], hits: number, needed: number, met: boolean}|null} perSet by set index
 */
export function targetCheck(entry) {
  const tw = entry ? cleanTargetWeight(entry.targetWeight) : null;
  if (tw === null || !isNum(entry.targetReps)) return null;
  const perSet = (entry.sets || []).map((s) => !!(s && s.done && s.type !== 'dropset'
    && isNum(s.weight) && s.weight >= tw && isNum(s.reps) && s.reps >= entry.targetReps));
  const hits = perSet.filter(Boolean).length;
  const needed = isNum(entry.targetSets) && entry.targetSets >= 1 ? entry.targetSets : DEFAULT_TARGET.targetSets;
  return { perSet, hits, needed, met: hits >= needed };
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

/** '3 x 6', '3 x 6–8', '3 sets', with a weight target '3 x 6 @ 100 kg' */
export function formatTarget(t) {
  if (!t) return '';
  const sets = t.targetSets || DEFAULT_TARGET.targetSets;
  const tw = cleanTargetWeight(t.targetWeight);
  const at = tw === null ? '' : ` @ ${tw} kg`;
  if (!isNum(t.targetReps)) return `${sets} sets${at}`;
  return isNum(t.targetRepsMax) && t.targetRepsMax > t.targetReps
    ? `${sets} x ${t.targetReps}–${t.targetRepsMax}${at}`
    : `${sets} x ${t.targetReps}${at}`;
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

// ---------------------------------------------------------------- dates and times of a workout
// A workout's `date` (local YYYY-MM-DD) is what weekly volume, history and progress group by;
// startedAt/finishedAt (epoch ms) are what recovery and durations use. They are kept consistent:
// the local day of startedAt is always `date` when the user sets them here.
//
// Past workouts ("Log a past workout", or a date changed before finishing) may carry
// `plannedDurationMs`: the length used when they are finished, instead of the time Finish is tapped.

const HOUR = 3600000;
/** Default length of a past workout when none was given. */
export const DEFAULT_PAST_DURATION_MS = 60 * 60000;
/** An unfinished workout started longer ago than this is "past": Finish does not stamp `now`. */
export const LIVE_WINDOW_MS = 12 * HOUR;
/** Longest duration accepted in the date/time sheet (minutes). */
export const MAX_DURATION_MIN = 600;

const pad2 = (n) => String(n).padStart(2, '0');

/** 'HH:MM' (local) of an epoch ms. */
export function timeOfDay(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Epoch ms of a local date and 'HH:MM' time; null when either is invalid.
 * Built from local components, so DST days work.
 */
export function atLocal(date, time) {
  if (!isValidDate(date)) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = parseDate(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2]).getTime();
}

/**
 * When Finish is tapped at `now`: the finishedAt to store. `date` is never changed.
 *  - plannedDurationMs set (a past workout) → startedAt + planned, but not after now
 *  - started within the last 12 h (a live session)  → now
 *  - otherwise (started long ago, e.g. a forgotten or back-dated session) → startedAt + 60 min, not after now
 * @returns {number}
 */
export function finishTime(workout, now) {
  const start = isNum(workout.startedAt) ? workout.startedAt : null;
  if (start === null) return now;
  if (isNum(workout.plannedDurationMs) && workout.plannedDurationMs > 0) return Math.max(start, Math.min(now, start + workout.plannedDurationMs));
  if (now >= start && now - start <= LIVE_WINDOW_MS) return now;
  return Math.max(start, Math.min(now, start + DEFAULT_PAST_DURATION_MS));
}

/**
 * New date/time fields for a workout (change date/time, or a new past workout).
 * Finished: finishedAt = new start + duration (durationMin, else the old duration is kept).
 * Unfinished: finishedAt stays null; durationMin (if given) becomes plannedDurationMs, null removes it.
 * Rules: valid date not after today, valid time, start not in the future, a finished workout may not
 * end in the future, duration 1–600 min.
 * @param {object} workout current record (not changed)
 * @param {{date: string, time: string, durationMin?: number|null}} input
 * @param {number} now epoch ms
 * @returns {{ok: true, value: {date: string, startedAt: number, finishedAt: number|null, plannedDurationMs: number|null}}
 *   | {ok: false, error: string}}
 */
export function rescheduleWorkout(workout, { date, time, durationMin = null }, now) {
  if (!isValidDate(date)) return { ok: false, error: 'Pick a date.' };
  if (date > today(new Date(now))) return { ok: false, error: 'The date cannot be in the future.' };
  const start = atLocal(date, time);
  if (start === null) return { ok: false, error: 'Pick a start time.' };
  if (start > now) return { ok: false, error: 'The start time is in the future.' };
  let dur = null;
  if (durationMin !== null && durationMin !== undefined) {
    if (!isNum(durationMin) || durationMin < 1 || durationMin > MAX_DURATION_MIN) return { ok: false, error: `Duration must be 1–${MAX_DURATION_MIN} min.` };
    dur = Math.round(durationMin) * 60000;
  }
  const finished = isNum(workout.finishedAt);
  if (finished) {
    const keep = isNum(workout.startedAt) ? Math.max(0, workout.finishedAt - workout.startedAt) : DEFAULT_PAST_DURATION_MS;
    const end = start + (dur ?? keep);
    if (end > now) return { ok: false, error: 'That would end in the future. Pick an earlier start or a shorter duration.' };
    return { ok: true, value: { date: fromTimestamp(start), startedAt: start, finishedAt: end, plannedDurationMs: null } };
  }
  return { ok: true, value: { date: fromTimestamp(start), startedAt: start, finishedAt: null, plannedDurationMs: dur } };
}

/**
 * Apply rescheduleWorkout's value to a record in place (removes plannedDurationMs when null).
 * @returns {object} the same record
 */
export function applySchedule(workout, value) {
  workout.date = value.date;
  workout.startedAt = value.startedAt;
  workout.finishedAt = value.finishedAt;
  if (value.plannedDurationMs) workout.plannedDurationMs = value.plannedDurationMs;
  else delete workout.plannedDurationMs;
  return workout;
}
