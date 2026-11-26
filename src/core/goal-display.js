// Signed display of the goal rate: Lose shows "−", Gain "+" (typographic minus U+2212), so a typed
// positive amount is never misread. Storage is unchanged (signed settings.goal.rateKgPerWeek). Pure.
import { amountValid, GOAL_AMOUNT_MAX } from './goal-rate.js';
import { parseSigned } from './signed-number.js';

export const MINUS = '−';

const r2 = (n) => Math.round(n * 100) / 100;

/** Sign shown in front of the typed amount: '−' lose, '+' gain, '' maintain. */
export function goalSign(direction) {
  return direction === 'lose' ? MINUS : direction === 'gain' ? '+' : '';
}

/** '−0.5', '+0.25'; '0' for maintain. */
export function signedAmount(direction, amount) {
  if (direction === 'maintain') return '0';
  return `${goalSign(direction)}${r2(Math.abs(amount))}`;
}

/**
 * Signed rate from the stored number, without unit: −0.5 → '−0.5', 0.25 → '+0.25', 0/null → '0'.
 * The UI adds the unit ('{value} kg / week', translated).
 */
export function signedRateValue(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || r2(rate) === 0) return '0';
  return `${rate < 0 ? MINUS : '+'}${r2(Math.abs(rate))}`;
}

/**
 * Typed amount → positive kg / week. The sign comes from Lose / Gain, so a typed '−', '-' or '+' is ignored
 * ('−0,5' → 0.5). Empty or not a number → null.
 */
export function parseGoalAmount(text) {
  const t = String(text ?? '').trim().replace(/^\+/, '');
  const n = parseSigned(t);
  return n === null ? null : Math.abs(n);
}

/** 1100 → '1 100' (narrow no-break space, as fmtGrouped in src/ui/format.js). */
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, '\u202f');

/**
 * A text for the UI as a catalogue key with values; the UI calls t(msg.key, msg.params).
 * @typedef {{key: string, params?: Record<string, string|number>, error?: boolean}} GoalMessage
 */

/**
 * For screen readers: 'minus 0.5 kilograms per week' (core.goal.speech*).
 * @returns {GoalMessage}
 */
export function signedRateSpeech(direction, amount) {
  if (direction === 'maintain') return { key: 'core.goal.speechMaintain' };
  const n = typeof amount === 'number' && Number.isFinite(amount) ? r2(Math.abs(amount)) : null;
  const key = direction === 'lose' ? 'core.goal.speechLose' : 'core.goal.speechGain';
  return n === null ? { key: `${key}Empty` } : { key, params: { n } };
}

/**
 * Why an amount cannot be saved; null when it is fine (or for maintain).
 * Missing, 0 or below → core.goal.errorAmount ('Enter an amount above 0'); over the limit →
 * core.goal.errorMax {max} ('Max 1 kg / week' lose, 'Max 0.5 kg / week' gain).
 * @param {'lose'|'maintain'|'gain'} direction
 * @param {number|null} amount positive amount as typed
 * @returns {GoalMessage|null}
 */
export function goalAmountError(direction, amount) {
  if (direction === 'maintain' || amountValid(direction, amount)) return null;
  const max = GOAL_AMOUNT_MAX[direction];
  if (typeof amount === 'number' && Number.isFinite(amount) && r2(amount) > 0 && max !== undefined && amount > max) {
    return { key: 'core.goal.errorMax', params: { max }, error: true };
  }
  return { key: 'core.goal.errorAmount', error: true };
}

/**
 * Result line: '−0.5 kg / week · −550 kcal / day' (core.goal.summaryKcal; the kcal part is the daily
 * gap to expenditure), '+0.25 kg / week' (core.goal.summary). Maintain → rate '0'. Invalid amount →
 * the reason (goalAmountError, error: true), shown as an error.
 * @param {'lose'|'maintain'|'gain'} direction
 * @param {number|null} amount positive amount as typed
 * @param {{kcalDay?: number|null}} [opts]
 * @returns {GoalMessage}
 */
export function signedGoalSummary(direction, amount, { kcalDay = null } = {}) {
  if (direction === 'maintain') return { key: 'core.goal.summary', params: { rate: '0' } };
  const error = goalAmountError(direction, amount);
  if (error) return error;
  const rate = signedAmount(direction, amount);
  if (typeof kcalDay === 'number' && kcalDay > 0) {
    return { key: 'core.goal.summaryKcal', params: { rate, kcal: `${goalSign(direction)}${grouped(kcalDay)}` } };
  }
  return { key: 'core.goal.summary', params: { rate } };
}
