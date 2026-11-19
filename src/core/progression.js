// Progression suggestion (SPEC §5). Pure, no DOM / IndexedDB.
//
// Rule: take the most recent FINISHED session containing the exercise (an entry with at least one
// done set; see lastEntryFor). Consider only its sets with type 'normal' and done: true. Suggest
// `weight + increment` when
//   - there are at least `targetSets` such sets,
//   - they ALL share the same weight (mixed weights -> no suggestion, we do not guess a "top" weight),
//   - every one has reps >= (targetRepsMax ?? targetReps).
// Dropsets never count, neither for nor against.
//
// Edge cases (decided here, covered by tests/progression.test.js):
//   - no history / no done normal sets            -> null
//   - fewer done normal sets than targetSets      -> null
//   - target: the target stored on that last session's entry (what the user was aiming at then);
//     falls back to the `target` passed in when the entry has none. No reps target -> null.
//   - weight 0 or empty (bodyweight)              -> null. Progress is by reps; we do not suggest
//     strapping on weight.
//   - increment 0 or negative                     -> null (the user switched suggestions off).
//     Missing/invalid increment                    -> 2.5 kg (the SPEC default).
//   - more done normal sets than targetSets       -> all of them must hit the target at one weight.
//   - result rounded to 2 decimals (avoids 102.49999).
//   - starting point (baseline.js) as the most recent "session": never a suggestion. It only
//     describes where the user starts; only a real logged session can trigger the chip.
import { lastEntryFor } from './workout.js';
import { isBaseline } from './baseline.js';
import { round } from './numbers.js';

export const DEFAULT_INCREMENT = 2.5;

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Evaluate one exercise entry (pure rule, no history lookup).
 * @param {{targetSets?: number, targetReps?: number|null, targetRepsMax?: number|null, sets: object[]}} entry
 * @param {number|null|undefined} increment exercise.increment
 * @param {{targetSets?: number, targetReps?: number|null, targetRepsMax?: number|null}} [fallbackTarget]
 * @returns {{weight: number, from: number, increment: number, sets: number, repsTarget: number}|null}
 */
export function evaluateEntry(entry, increment, fallbackTarget = {}) {
  if (!entry || !Array.isArray(entry.sets)) return null;
  const inc = isNum(increment) ? increment : DEFAULT_INCREMENT;
  if (inc <= 0) return null;

  const hasTarget = isNum(entry.targetReps) && isNum(entry.targetSets);
  const t = hasTarget ? entry : fallbackTarget;
  if (!isNum(t.targetSets) || t.targetSets < 1 || !isNum(t.targetReps)) return null;
  const repsTarget = isNum(t.targetRepsMax) && t.targetRepsMax > t.targetReps ? t.targetRepsMax : t.targetReps;

  const sets = entry.sets.filter((s) => s && s.done && s.type === 'normal');
  if (sets.length < t.targetSets) return null;

  const w = sets[0].weight;
  if (!isNum(w) || w <= 0) return null;
  if (!sets.every((s) => s.weight === w)) return null;
  if (!sets.every((s) => isNum(s.reps) && s.reps >= repsTarget)) return null;

  return { weight: round(w + inc, 2), from: w, increment: inc, sets: sets.length, repsTarget };
}

/**
 * Suggestion for an exercise based on its most recent finished session.
 * @param {object[]} workouts all workouts
 * @param {{id: string, increment?: number}} exercise
 * @param {{excludeId?: string|null, target?: object}} [opts] excludeId: the session being logged;
 *   target: fallback target (the current card's) if the last entry has none
 * @returns {{weight: number, from: number, increment: number, sets: number, repsTarget: number,
 *            workoutId: string, date: string}|null}
 */
export function suggestProgression(workouts, exercise, { excludeId = null, target = {} } = {}) {
  if (!exercise) return null;
  const last = lastEntryFor(workouts, exercise.id, { excludeId });
  if (!last) return null;
  if (isBaseline(last.workout)) return null;
  const r = evaluateEntry(last.entry, exercise.increment, target);
  if (!r) return null;
  return { ...r, workoutId: last.workout.id, date: last.workout.date };
}
