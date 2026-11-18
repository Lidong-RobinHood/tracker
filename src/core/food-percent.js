// Percent of daily targets and each meal's share of the day. Pure, no DOM.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Whole-number percent of a target that has been reached.
 * Target missing, 0 or negative (or consumed not a number) → null. Never NaN/Infinity.
 * @param {number|null|undefined} consumed @param {number|null|undefined} target
 * @returns {number|null} e.g. 62, 112
 */
export function percentOfTarget(consumed, target) {
  if (!isNum(target) || target <= 0) return null;
  const c = isNum(consumed) ? Math.max(0, consumed) : 0;
  return Math.round((c / target) * 100);
}

/**
 * Percent reached for kcal/protein/carbs/fat.
 * @param {Record<string, number|null>} consumed day totals
 * @param {Record<string, number|null>} targets
 * @returns {Record<'kcal'|'protein'|'carbs'|'fat', {pct: number|null, over: boolean}>}
 *   over = strictly more than 100 % (rounded value)
 */
export function targetPercents(consumed, targets) {
  const out = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const pct = percentOfTarget(consumed ? consumed[k] : null, targets ? targets[k] : null);
    out[k] = { pct, over: pct !== null && pct > 100 };
  }
  return out;
}

/**
 * A meal's share of the day's calories, whole percent. Day total 0 / missing → null.
 * @param {number|null|undefined} part @param {number|null|undefined} whole
 * @returns {number|null}
 */
export function shareOfDay(part, whole) {
  if (!isNum(whole) || whole <= 0) return null;
  const p = isNum(part) ? Math.max(0, part) : 0;
  return Math.round((p / whole) * 100);
}

/** 62 → '62 %' (no-break space), null → ''. */
export function fmtPercent(pct) {
  return isNum(pct) ? `${pct} %` : '';
}
