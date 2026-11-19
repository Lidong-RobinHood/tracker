// Display formatting. Pure (no DOM), English, metric. '.' as decimal separator, no grouping.
import { parseDate, today, addDays } from '../core/dates.js';
import { round } from '../core/numbers.js';

/** 12.50 -> '12.5', 3 -> '3', null -> '–'. @param {number|null|undefined} n */
export function fmtNum(n, maxDecimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const r = round(n, maxDecimals);
  return String(Object.is(r, -0) ? 0 : r);
}

/** '523 kcal' (whole numbers) */
export const fmtKcal = (n) => `${fmtNum(n, 0)} kcal`;
/** '12.5 g' */
export const fmtGrams = (n, maxDecimals = 1) => `${fmtNum(n, maxDecimals)} g`;
/** '102.5 kg' */
export const fmtKg = (n, maxDecimals = 2) => `${fmtNum(n, maxDecimals)} kg`;
/** '150 g' or '250 ml' for an amount with its basis */
export const fmtAmount = (n, basis = 'g') => `${fmtNum(n, 1)} ${basis}`;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-11-18' -> 'Wed 18 Nov' (adds the year if not the current one) */
export function fmtDate(s, now = new Date()) {
  const d = parseDate(s);
  const base = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** 'Today', 'Yesterday', 'Tomorrow', else fmtDate() */
export function fmtDay(s, now = new Date()) {
  const t = today(now);
  if (s === t) return 'Today';
  if (s === addDays(t, -1)) return 'Yesterday';
  if (s === addDays(t, 1)) return 'Tomorrow';
  return fmtDate(s, now);
}

/** epoch ms -> '14:05' (local, 24 h) */
export function fmtTime(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** milliseconds -> '45 min' or '1 h 05 min' */
export function fmtDuration(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** bytes -> '1.2 MB' */
export function fmtBytes(b) {
  if (b === null || b === undefined) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (b >= 1000 && i < units.length - 1) { b /= 1000; i++; }
  return `${fmtNum(b, i ? 1 : 0)} ${units[i]}`;
}

const THIN = ' ';   // narrow no-break space: thousands separator
const MINUS = '−';  // typographic minus

/**
 * Grouped number for display: 1310 -> '1 310' (narrow no-break space), −0.5 -> '−0.5' (true minus),
 * null -> '–'. Up to `maxDecimals` places, trailing zeros dropped (like fmtNum).
 * @param {number|null|undefined} n @param {number} [maxDecimals]
 */
export function fmtGrouped(n, maxDecimals = 0) {
  const s = fmtNum(n, maxDecimals);
  if (s === '–') return s;
  const neg = s.startsWith('-');
  const [i, d] = (neg ? s.slice(1) : s).split('.');
  return (neg ? MINUS : '') + i.replace(/\B(?=(\d{3})+$)/g, THIN) + (d ? `.${d}` : '');
}

/** Signed delta: 50 -> '+50', -0.5 -> '−0.5', 0 -> '0'. Grouped like fmtGrouped. */
export function fmtSigned(n, maxDecimals = 0) {
  const s = fmtGrouped(n, maxDecimals);
  return s !== '–' && s !== '0' && !s.startsWith(MINUS) ? `+${s}` : s;
}
