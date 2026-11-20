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

/** Signed rate from the stored number: −0.5 → '−0.5 kg / week'; 0/null → '0 kg / week'. */
export function signedRateText(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || r2(rate) === 0) return '0 kg / week';
  return `${rate < 0 ? MINUS : '+'}${r2(Math.abs(rate))} kg / week`;
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

/** For screen readers: 'minus 0.5 kilograms per week'. */
export function signedRateSpeech(direction, amount) {
  if (direction === 'maintain') return 'maintain, 0 kilograms per week';
  const n = typeof amount === 'number' && Number.isFinite(amount) ? r2(Math.abs(amount)) : null;
  const word = direction === 'lose' ? 'minus' : 'plus';
  return n === null ? `${word}, enter kilograms per week` : `${word} ${n} kilograms per week`;
}

/**
 * Why an amount cannot be saved, as a short line; null when it is fine (or for maintain).
 * Missing, 0 or below → 'Enter an amount above 0'; over the limit → 'Max 1 kg / week' (lose) or
 * 'Max 0.5 kg / week' (gain).
 * @param {'lose'|'maintain'|'gain'} direction
 * @param {number|null} amount positive amount as typed
 * @returns {string|null}
 */
export function goalAmountError(direction, amount) {
  if (direction === 'maintain' || amountValid(direction, amount)) return null;
  const max = GOAL_AMOUNT_MAX[direction];
  if (typeof amount === 'number' && Number.isFinite(amount) && r2(amount) > 0 && max !== undefined && amount > max) return `Max ${max} kg / week`;
  return 'Enter an amount above 0';
}

/**
 * Result line: '−0.5 kg / week · −550 kcal / day' (the kcal part is the daily gap to expenditure).
 * Maintain → '0 kg / week'. Invalid amount → the reason (goalAmountError), shown as an error.
 * @param {'lose'|'maintain'|'gain'} direction
 * @param {number|null} amount positive amount as typed
 * @param {{kcalDay?: number|null}} [opts]
 */
export function signedGoalSummary(direction, amount, { kcalDay = null } = {}) {
  if (direction === 'maintain') return '0 kg / week';
  const error = goalAmountError(direction, amount);
  if (error) return error;
  const kcal = typeof kcalDay === 'number' && kcalDay > 0 ? ` · ${goalSign(direction)}${grouped(kcalDay)} kcal / day` : '';
  return `${signedAmount(direction, amount)} kg / week${kcal}`;
}
