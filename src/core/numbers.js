// Number parsing and rounding. Pure, no DOM.

/**
 * Parse user-typed decimal text. Accepts ',' or '.' as decimal separator, surrounding spaces.
 * @param {string|number|null|undefined} input
 * @returns {number|null} null for empty or invalid input
 */
export function parseDecimal(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const s = String(input ?? '').trim().replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Round to `decimals` places, half away from zero (1.005 -> 1.01 with 2 decimals). */
export function round(n, decimals = 0) {
  if (!Number.isFinite(n)) return n;
  if (String(n).includes('e')) return Math.round(n * 10 ** decimals) / 10 ** decimals;
  const r = Number(Math.round(Number(`${Math.abs(n)}e${decimals}`)) + `e-${decimals}`);
  return n < 0 ? -r : r;
}
