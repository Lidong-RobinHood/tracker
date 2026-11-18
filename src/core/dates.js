// Local calendar dates as 'YYYY-MM-DD' strings. Pure, no DOM.
// Never use toISOString()/UTC getters to derive a day: that shifts the date near midnight.
// All arithmetic builds Dates from local components (new Date(y, m, d)), which is DST-safe.

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n) => String(n).padStart(2, '0');

/** @param {Date} d @returns {string} local YYYY-MM-DD */
export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** @param {number} ms epoch milliseconds @returns {string} local YYYY-MM-DD */
export function fromTimestamp(ms) {
  return toDateStr(new Date(ms));
}

/** @param {Date} [now] @returns {string} today's local date */
export function today(now = new Date()) {
  return toDateStr(now);
}

/** @param {string} s @returns {boolean} true for a real calendar date like '2026-02-28' */
export function isValidDate(s) {
  const m = RE.exec(String(s));
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

/** @param {string} s YYYY-MM-DD @returns {Date} local midnight of that day */
export function parseDate(s) {
  if (!isValidDate(s)) throw new Error(`Invalid date: ${s}`);
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string} s @param {number} n days (may be negative) @returns {string} */
export function addDays(s, n) {
  const d = parseDate(s);
  return toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** @returns {number} 0 = Monday ... 6 = Sunday */
export function weekday(s) {
  return (parseDate(s).getDay() + 6) % 7;
}

/** @returns {string} Monday of the week containing s */
export function weekStart(s) {
  return addDays(s, -weekday(s));
}

/** @returns {string} Sunday of the week containing s */
export function weekEnd(s) {
  return addDays(weekStart(s), 6);
}

/** Whole days from a to b (b - a). Uses calendar components, so DST does not matter. */
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** @returns {string[]} every date from a to b inclusive (empty if b < a) */
export function dateRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}
