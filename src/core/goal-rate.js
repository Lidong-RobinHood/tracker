// Goal rate as direction (lose / maintain / gain) + positive amount, so no minus key is needed.
// The stored value stays the signed settings.goal.rateKgPerWeek. Pure, no DOM.
import { GOAL_RATE_MIN, GOAL_RATE_MAX } from './adaptive.js';

/** Largest amount per direction, in kg a week (from the allowed goal range). */
export const GOAL_AMOUNT_MAX = Object.freeze({ lose: -GOAL_RATE_MIN, gain: GOAL_RATE_MAX });

/** Preset amounts (kg a week) offered as chips. */
export const GOAL_PRESETS = Object.freeze({ lose: [0.25, 0.5, 0.75, 1], gain: [0.25, 0.5] });

/** Amount filled in when switching to a direction with no usable amount yet. */
export const GOAL_DEFAULT_AMOUNT = Object.freeze({ lose: 0.5, gain: 0.25 });

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Stored signed rate -> {direction, amount}. 0, null or invalid -> maintain (amount null).
 * Values outside the allowed range are kept as they are (the form then marks them invalid).
 * @param {number|null|undefined} rate
 * @returns {{direction: 'lose'|'maintain'|'gain', amount: number|null}}
 */
export function rateToGoal(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || r2(rate) === 0) return { direction: 'maintain', amount: null };
  return rate < 0 ? { direction: 'lose', amount: r2(-rate) } : { direction: 'gain', amount: r2(rate) };
}

/** Whether `amount` is allowed for `direction` (lose: > 0 … 1, gain: > 0 … 0.5). */
export function amountValid(direction, amount) {
  const max = GOAL_AMOUNT_MAX[direction];
  return max !== undefined && typeof amount === 'number' && Number.isFinite(amount) && r2(amount) > 0 && amount <= max;
}

/**
 * {direction, amount} -> signed rate to store (kg a week, 2 decimals). Maintain -> 0.
 * @returns {number|null} null when the amount is missing or outside the limit for the direction
 */
export function goalToRate(direction, amount) {
  if (direction === 'maintain') return 0;
  if (!amountValid(direction, amount)) return null;
  return direction === 'lose' ? -r2(amount) : r2(amount);
}

/** Plain-language summary, e.g. 'Lose 0.5 kg a week'. */
export function goalSummary(direction, amount) {
  if (direction === 'maintain') return 'Maintain your weight';
  const verb = direction === 'lose' ? 'Lose' : 'Gain';
  return amountValid(direction, amount) ? `${verb} ${r2(amount)} kg a week` : `${verb}: enter more than 0 and at most ${GOAL_AMOUNT_MAX[direction]} kg a week`;
}
