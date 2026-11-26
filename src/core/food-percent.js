// Percent of daily targets and each meal's share of the day. Pure, no DOM.

import { percent, round, withPercent } from './numbers.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Whole-number percent of a target that has been reached (half away from zero, see numbers.percent).
 * Target missing, 0 or negative (or consumed not a number) → null. Never NaN/Infinity.
 * @param {number|null|undefined} consumed @param {number|null|undefined} target
 * @returns {number|null} e.g. 62, 112
 */
export function percentOfTarget(consumed, target) {
  if (!isNum(target) || target <= 0) return null;
  const c = isNum(consumed) ? Math.max(0, consumed) : 0;
  return percent(c, target);
}

/**
 * Percent reached for kcal/protein/carbs/fat.
 * @param {Record<string, number|null>} consumed day totals
 * @param {Record<string, number|null>} targets
 * @returns {Record<'kcal'|'protein'|'carbs'|'fat', {pct: number|null, over: boolean}>}
 *   over = eaten strictly more than the target (raw values, not the rounded percentage)
 */
export function targetPercents(consumed, targets) {
  const out = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const c = consumed ? consumed[k] : null;
    const t = targets ? targets[k] : null;
    const pct = percentOfTarget(c, t);
    out[k] = { pct, over: pct !== null && isNum(c) && c > t };
  }
  return out;
}

/**
 * Eaten vs target exactly as displayed, so the numbers never contradict each other:
 *  - eaten is rounded once (to `decimals`); left/over are computed from that ROUNDED value and the
 *    (rounded) target, so shown eaten + shown left = shown target, always;
 *  - over (warning colour, red bar, "x over") only when the shown excess is at least 1 displayed unit,
 *    so "0 g over" or "1 g left" never appear next to eaten = target;
 *  - pct comes from the raw values (percentOfTarget), fraction = raw consumed / target for bar width.
 * @param {number|null|undefined} consumed raw total
 * @param {number|null|undefined} target
 * @param {{decimals?: number}} [opts] display decimals (0 for kcal and grams)
 * @returns {{eaten: number, target: number|null, left: number|null, over: number|null, isOver: boolean,
 *   pct: number|null, fraction: number}} left/over null without a target; one of them is 0
 */
export function targetStatus(consumed, target, { decimals = 0 } = {}) {
  const c = isNum(consumed) ? Math.max(0, consumed) : 0;
  const eaten = round(c, decimals);
  if (!isNum(target) || target <= 0) return { eaten, target: null, left: null, over: null, isOver: false, pct: null, fraction: 0 };
  const t = round(target, decimals);
  const diff = round(t - eaten, decimals); // ≥ 0: left; < 0: over (a whole number of display units)
  const isOver = diff <= -(10 ** -decimals) + 1e-9;
  return {
    eaten, target: t,
    left: isOver ? 0 : Math.max(0, diff),
    over: isOver ? -diff : 0,
    isOver,
    pct: percentOfTarget(c, target),
    fraction: c / target,
  };
}

/**
 * A meal's share of the day's calories, whole percent. Day total 0 / missing → null.
 * @param {number|null|undefined} part @param {number|null|undefined} whole
 * @returns {number|null}
 */
export function shareOfDay(part, whole) {
  if (!isNum(whole) || whole <= 0) return null;
  const p = isNum(part) ? Math.max(0, part) : 0;
  return percent(p, whole);
}

/** 62 → '62 %' (no-break space), null → ''. */
export function fmtPercent(pct) {
  return isNum(pct) ? withPercent(pct) : '';
}
