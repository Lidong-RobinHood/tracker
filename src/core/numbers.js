// Number parsing and rounding. Pure, no DOM.

/**
 * Parse user-typed decimal text. Accepts ',' or '.' as decimal separator, surrounding spaces.
 * @param {string|number|null|undefined} input
 * @returns {number|null} null for empty or invalid input
 */
/**
 * A number text with the percent sign, the one form used for every percentage on screen (all languages,
 * like the catalogues' '{n} %'): '62 %' with a no-break space (U+00A0), so the sign never wraps alone.
 * @param {string|number} text already formatted number ('62', '+2.5', '−3.1')
 */
export const withPercent = (text) => `${text}\u00a0%`;

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
  return n < 0 && r !== 0 ? -r : r; // never -0
}

/**
 * part / whole × 100, rounded to `decimals` half away from zero. The quotient is snapped to 12
 * significant digits first, so exact halves that floating point lands just below
 * (2010 / 2000 × 100 = 100.49999999999999) still round up. null when whole ≤ 0 or not a number.
 * @param {number} part @param {number} whole @param {number} [decimals=0]
 * @returns {number|null}
 */
export function percent(part, whole, decimals = 0) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return round(Number(((part * 100) / whole).toPrecision(12)), decimals);
}
