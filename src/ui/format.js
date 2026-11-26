// Display formatting. Pure (no DOM), metric. Numbers: '.' as decimal separator in every language
// (see docs/I18N.md › Numbers); dates and day words follow the app language (src/i18n).
import { parseDate, today, addDays } from '../core/dates.js';
import { round } from '../core/numbers.js';
import { t } from '../i18n/index.js';
import { dateLabel } from '../i18n/dates.js';

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

/**
 * '2026-11-18' -> 'Wed 18 Nov' (adds the year if not the current one), in the app language:
 * de 'Mi. 18. Nov.', zh '11月18日周三' (src/i18n/dates.js).
 */
export function fmtDate(s, now = new Date()) {
  const d = parseDate(s);
  return dateLabel(d, { year: d.getFullYear() !== now.getFullYear() });
}

/** 'Today', 'Yesterday', 'Tomorrow' (translated), else fmtDate() */
export function fmtDay(s, now = new Date()) {
  const t0 = today(now);
  if (s === t0) return t('common.today');
  if (s === addDays(t0, -1)) return t('common.yesterday');
  if (s === addDays(t0, 1)) return t('common.tomorrow');
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

/**
 * Tonnage (weight × reps): whole kg below 10 000 kg ('2 340 kg'), tonnes with two decimals from
 * 10 000 kg ('12.48 t'); grouped with a narrow no-break space, true minus; null -> '–'.
 * `{ kg: true }` always gives kg (single-set and per-exercise tonnage).
 * @param {number|null|undefined} kg @param {{kg?: boolean}} [opts]
 */
export function fmtTonnage(kg, { kg: kgOnly = false } = {}) {
  if (kg === null || kg === undefined || !Number.isFinite(kg)) return '–';
  const whole = Math.round(kg);
  if (kgOnly || Math.abs(whole) < 10000) return `${fmtGrouped(whole, 0)} kg`;
  const [i, d] = (Math.abs(kg) / 1000).toFixed(2).split('.');
  return `${kg < 0 ? MINUS : ''}${fmtGrouped(Number(i), 0)}.${d} t`;
}

/**
 * Join translated sentences: one space between them, none after a full-width stop (Chinese "。", "？", "！").
 * @param {Array<string|null|undefined|false>} parts falsy parts are skipped
 * @returns {string}
 */
export function joinSentences(parts) {
  return parts.filter(Boolean).reduce((acc, p) => (!acc ? p : `${acc}${/[。！？]$/.test(acc) ? '' : ' '}${p}`), '');
}
