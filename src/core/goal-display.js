// Signed display of the goal rate: Lose shows "−", Gain "+" (typographic minus U+2212), so a typed
// positive amount is never misread. Storage is unchanged (signed settings.goal.rateKgPerWeek). Pure.
import { amountValid } from './goal-rate.js';

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

/** Signed rate from the stored number: −0.5 → '−0.5 kg per week'; 0/null → '0 kg per week'. */
export function signedRateText(rate) {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || r2(rate) === 0) return '0 kg per week';
  return `${rate < 0 ? MINUS : '+'}${r2(Math.abs(rate))} kg per week`;
}

/** For screen readers: 'minus 0.5 kilograms per week'. */
export function signedRateSpeech(direction, amount) {
  if (direction === 'maintain') return 'maintain, 0 kilograms per week';
  const n = typeof amount === 'number' && Number.isFinite(amount) ? r2(Math.abs(amount)) : null;
  const word = direction === 'lose' ? 'minus' : 'plus';
  return n === null ? `${word}, enter kilograms per week` : `${word} ${n} kilograms per week`;
}

/**
 * Summary line: '−0.5 kg per week (lose about 0.5 kg a week, about 550 kcal a day below what you burn)'.
 * Invalid amount → an instruction.
 * @param {'lose'|'maintain'|'gain'} direction
 * @param {number|null} amount positive amount as typed
 * @param {{max?: number, kcalDay?: number|null}} [opts]
 */
export function signedGoalSummary(direction, amount, { max, kcalDay = null } = {}) {
  if (direction === 'maintain') return 'Maintain: 0 kg per week';
  const verb = direction === 'lose' ? 'lose' : 'gain';
  if (!amountValid(direction, amount)) {
    return `${direction === 'lose' ? 'Lose' : 'Gain'}: enter more than 0${max ? ` and at most ${max}` : ''} kg a week`;
  }
  const kcal = typeof kcalDay === 'number' && kcalDay > 0
    ? `, about ${kcalDay} kcal a day ${direction === 'lose' ? 'below' : 'above'} what you burn` : '';
  return `${signedAmount(direction, amount)} kg per week (${verb} about ${r2(amount)} kg a week${kcal})`;
}
