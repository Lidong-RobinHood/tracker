// Locale-aware weekday / month names and compact date labels. Pure (no DOM): take Date objects or
// indexes and an optional language code (default: the active app language).
//
// English keeps fixed abbreviations ('Wed 18 Nov', 'Sep' not ICU's 'Sept'), so English screens do not
// change with the browser's ICU version. Other languages use Intl.DateTimeFormat:
//   de  'Mi. 18. Nov.'   'Mi. 18. Nov. 2025'   '18. Nov.'   'November 2026'
//   zh  '11月18日周三'    '2025年11月18日周三'   '11月18日'   '2026年11月'
import { getLanguage, LOCALE_TAGS } from './index.js';

const EN_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const EN_DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EN_MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December'];

/** No-break space: keeps a day and its month (and year) on one line. */
const NBSP = '\u00a0';

const cache = new Map();
function fmt(lang, opts) {
  const id = `${lang}|${JSON.stringify(opts)}`;
  let f = cache.get(id);
  if (!f) { f = new Intl.DateTimeFormat(LOCALE_TAGS[lang] || lang, opts); cache.set(id, f); }
  return f;
}
const lg = (lang) => lang || getLanguage();
/** A Monday at noon (2024-01-01 was a Monday); + i days. */
const dayRef = (i) => new Date(2024, 0, 1 + i, 12);
const monthRef = (m) => new Date(2024, m, 15, 12);
const partsOf = (f, d) => Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));

/** Weekday, 0 = Monday … 6 = Sunday: en 'Mon', de 'Mo', zh '周一'. */
export function weekdayShort(i, lang) {
  const l = lg(lang);
  return l === 'en' ? EN_DAYS[i] : fmt(l, { weekday: 'short' }).format(dayRef(i));
}

/** One-letter weekday for compact week strips: en 'M', de 'M', zh '一'. */
export function weekdayNarrow(i, lang) {
  const l = lg(lang);
  return l === 'en' ? EN_DAYS[i][0] : fmt(l, { weekday: 'narrow' }).format(dayRef(i));
}

/** en 'Monday', de 'Montag', zh '星期一'. */
export function weekdayLong(i, lang) {
  const l = lg(lang);
  return l === 'en' ? EN_DAYS_LONG[i] : fmt(l, { weekday: 'long' }).format(dayRef(i));
}

/** Month 0–11: en 'Nov', de 'Nov.', zh '11月'. */
export function monthShort(m, lang) {
  const l = lg(lang);
  return l === 'en' ? EN_MONTHS[m] : fmt(l, { month: 'short' }).format(monthRef(m));
}

/** Month 0–11: en 'November', de 'November', zh '十一月'. */
export function monthLong(m, lang) {
  const l = lg(lang);
  return l === 'en' ? EN_MONTHS_LONG[m] : fmt(l, { month: 'long' }).format(monthRef(m));
}

/** en 'November 2026', de 'November 2026', zh '2026年11月'. @param {Date} d */
export function monthYear(d, lang) {
  const l = lg(lang);
  return l === 'en' ? `${EN_MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : fmt(l, { month: 'long', year: 'numeric' }).format(d);
}

/** en '18 Nov', de '18. Nov.', zh '11月18日'. @param {Date} d @param {{year?: boolean}} [o] */
export function dayMonth(d, { year = false } = {}, lang) {
  const l = lg(lang);
  if (l === 'en') return `${d.getDate()} ${EN_MONTHS[d.getMonth()]}${year ? ` ${d.getFullYear()}` : ''}`;
  return fmt(l, year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' }).format(d);
}

/**
 * Weekday + day + month (+ year): en 'Wed 18 Nov', de 'Mi. 18. Nov.', zh '11月18日周三'.
 * @param {Date} d @param {{year?: boolean}} [o]
 */
export function dateLabel(d, { year = false } = {}, lang) {
  const l = lg(lang);
  if (l === 'en') {
    const base = `${EN_DAYS[(d.getDay() + 6) % 7]} ${d.getDate()} ${EN_MONTHS[d.getMonth()]}`;
    return year ? `${base} ${d.getFullYear()}` : base;
  }
  const opts = year ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short' };
  if (l === 'de') {
    // Intl gives 'Mi., 18. Nov.'; the app's compact form drops the comma.
    const p = partsOf(fmt(l, opts), d);
    return `${p.weekday} ${p.day}. ${p.month}${year ? ` ${p.year}` : ''}`;
  }
  return fmt(l, opts).format(d);
}

/**
 * A span of days, e.g. a Mon–Sun week. The year is added when either end is not in `now`'s year.
 * Spaces inside a date are no-break spaces (U+00A0: '23–29 Nov' never wraps before 'Nov'); only the spaces
 * around ' – ' between two dates may break.
 *   en '16–22 Nov' · '30 Nov – 6 Dec' · '28 Dec 2026 – 3 Jan 2027'
 *   de '16.–22. Nov.' · '30. Nov. – 6. Dez.' · '28. Dez. 2026 – 3. Jan. 2027'
 *   zh '11月16日–22日' · '11月30日–12月6日' · '2026年12月28日–2027年1月3日'
 * @param {Date} a first day @param {Date} b last day @param {{now?: Date}} [o]
 */
export function dayRange(a, b, { now = new Date() } = {}, lang) {
  const l = lg(lang);
  const year = a.getFullYear() !== now.getFullYear() || b.getFullYear() !== now.getFullYear();
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  if (l === 'en') {
    const y = (d) => (year ? `${NBSP}${d.getFullYear()}` : '');
    if (sameMonth) return `${a.getDate()}–${b.getDate()}${NBSP}${EN_MONTHS[b.getMonth()]}${y(b)}`;
    return `${a.getDate()}${NBSP}${EN_MONTHS[a.getMonth()]}${sameYear ? '' : y(a)} – ${b.getDate()}${NBSP}${EN_MONTHS[b.getMonth()]}${y(b)}`;
  }
  if (l === 'zh') {
    const md = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;
    const y = (d) => (year ? `${d.getFullYear()}年` : '');
    if (sameMonth) return `${y(a)}${md(a)}–${b.getDate()}日`;
    return `${y(a)}${md(a)}–${sameYear ? '' : y(b)}${md(b)}`;
  }
  const f = fmt(l, year ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
  // ICU puts thin spaces around the dash; the app uses ordinary spaces there ('30. Nov. – 6. Dez.') and
  // no-break spaces inside each date.
  const text = typeof f.formatRange === 'function' ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
  return text.replace(/[ \u2009\u202f]/g, NBSP).replace(new RegExp(`${NBSP}–${NBSP}`, 'g'), ' – ');
}
