// Shared, pure helpers for the data importers: text cleanup, lines, dates and numbers in the many
// shapes people paste (German and English), and a quote-aware CSV/TSV reader. No DOM, runs in Node.
import { isValidDate, today as todayStr } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

/** Remove a UTF-8 byte order mark. */
export function stripBom(text) {
  const s = String(text ?? '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** Split text into lines (CRLF, CR or LF). A trailing newline does not add an empty last line. */
export function splitLines(text) {
  const lines = stripBom(text).split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------- months and weekdays

/** Month names and abbreviations (English and German), normalised to lower case without dots. */
const MONTH_NAMES = {
  jan: 1, january: 1, januar: 1, jän: 1, jaen: 1,
  feb: 2, february: 2, februar: 2,
  mar: 3, march: 3, mär: 3, maer: 3, märz: 3, maerz: 3, mrz: 3,
  apr: 4, april: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, juli: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, okt: 10, oktober: 10,
  nov: 11, november: 11,
  dec: 12, december: 12, dez: 12, dezember: 12,
};
/** Weekday words → 0 = Monday … 6 = Sunday. */
const WEEKDAYS = {
  mon: 0, monday: 0, mo: 0, montag: 0,
  tue: 1, tues: 1, tuesday: 1, di: 1, dienstag: 1,
  wed: 2, wednesday: 2, mi: 2, mittwoch: 2,
  thu: 3, thur: 3, thurs: 3, thursday: 3, do: 3, donnerstag: 3,
  fri: 4, friday: 4, fr: 4, freitag: 4,
  sat: 5, saturday: 5, sa: 5, samstag: 5, sonnabend: 5,
  sun: 6, sunday: 6, so: 6, sonntag: 6,
};
const MONTH_RE = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');
const WEEKDAY_RE = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|');

/** Remove weekday words ("Mon", "Montag,", "Di.") from a text. */
export function stripWeekdays(text) {
  return String(text ?? '').replace(new RegExp(`(?<![\\p{L}])(?:${WEEKDAY_RE})\\.?,?(?![\\p{L}])`, 'giu'), ' ');
}

const NB = '(?<![\\d./-])'; // not preceded by part of another number
const NA = '(?![\\d])'; // not followed by a digit

/**
 * Date patterns, most specific first. Each returns {y|null, m, d} from a match; order-dependent
 * numeric forms are resolved by the caller.
 */
const DATE_PATTERNS = [
  // 2026-11-12, 2026/11/12, 2026.11.12 (optionally followed by a time)
  { re: new RegExp(`${NB}(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${NA}`), get: (m) => ({ y: +m[1], a: +m[2], b: +m[3], fixed: 'ymd' }) },
  // 12.11.2026, 12.11.26 (German, always day first)
  { re: new RegExp(`${NB}(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})${NA}`), get: (m) => ({ y: year2(m[3]), a: +m[1], b: +m[2], fixed: 'dmy' }) },
  // 12/11/2026, 12/11/26, 12-11-2026 (day/month order depends on the setting)
  { re: new RegExp(`${NB}(\\d{1,2})[/-](\\d{1,2})[/-](\\d{4}|\\d{2})${NA}`), get: (m) => ({ y: year2(m[3]), a: +m[1], b: +m[2], fixed: null }) },
  // [Mon[,]] 12[.] Nov[ember][.] [2026]
  { re: new RegExp(`(?:\\b(?:${WEEKDAY_RE})\\.?,?\\s+)?(?<![\\d.])(\\d{1,2})\\.?\\s*(${MONTH_RE})\\.?(?:,?\\s+(\\d{4}))?(?![a-zäöü])`, 'i'),
    get: (m) => ({ y: m[3] ? +m[3] : null, a: +m[1], b: MONTH_NAMES[m[2].toLowerCase()], fixed: 'dmy', wd: weekdayIn(m[0]) }) },
  // [Mon[,]] Nov 12[,] [2026]
  { re: new RegExp(`(?:\\b(?:${WEEKDAY_RE})\\.?,?\\s+)?\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?${NA}(?:,?\\s+(\\d{4}))?`, 'i'),
    get: (m) => ({ y: m[3] ? +m[3] : null, a: +m[2], b: MONTH_NAMES[m[1].toLowerCase()], fixed: 'dmy', wd: weekdayIn(m[0]) }) },
  // 12.11. (German, no year)
  { re: new RegExp(`${NB}(\\d{1,2})\\.(\\d{1,2})\\.(?![\\d])`), get: (m) => ({ y: null, a: +m[1], b: +m[2], fixed: 'dmy' }) },
];

function year2(s) {
  const n = +s;
  return s.length === 2 ? 2000 + n : n;
}

function weekdayIn(text) {
  const m = new RegExp(`^\\s*(${WEEKDAY_RE})\\b`, 'i').exec(text);
  return m ? WEEKDAYS[m[1].toLowerCase()] : null;
}

/**
 * Find the first date anywhere in a line.
 * @param {string} text
 * @param {{order?: 'dmy'|'mdy', today?: string}} [opts] order for 12/11/26 style dates (default dmy);
 *   today (YYYY-MM-DD) picks the year for dates written without one (the most recent such day).
 * @returns {{date: string|null, start: number, end: number, ambiguous: boolean, weekdayMismatch: boolean,
 *   error: string|null}|null} null when no date-like text is present; date null + error when it is
 *   date-shaped but not a real day (e.g. 31.02.2026)
 */
export function findDate(text, { order = 'dmy', today = todayStr() } = {}) {
  const s = String(text ?? '');
  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(s);
    if (!m) continue;
    const g = p.get(m);
    let d; let mo;
    if (g.fixed === 'ymd') { mo = g.a; d = g.b; } else if (g.fixed === 'dmy') { d = g.a; mo = g.b; } else if (order === 'mdy') { mo = g.a; d = g.b; } else { d = g.a; mo = g.b; }
    const ambiguous = g.fixed === null && g.a <= 12 && g.b <= 12 && g.a !== g.b;
    let y = g.y;
    if (y === null) {
      // The most recent such day on or before today (29.02. goes back to the last leap year).
      const ty = +today.slice(0, 4);
      y = `${ty}-${pad(mo)}-${pad(d)}` > today ? ty - 1 : ty;
      for (let k = 0; k < 8 && !isValidDate(`${y}-${pad(mo)}-${pad(d)}`); k++) y--;
      if (!isValidDate(`${y}-${pad(mo)}-${pad(d)}`)) y = ty;
    }
    const date = `${y}-${pad(mo)}-${pad(d)}`;
    const base = { start: m.index, end: m.index + m[0].length, ambiguous };
    if (!isValidDate(date) || y < 1900 || y > 2100) return { ...base, date: null, weekdayMismatch: false, error: `"${m[0].trim()}" is not a valid date` };
    let weekdayMismatch = false;
    if (g.wd !== null && g.wd !== undefined) {
      const [yy, mm, dd] = date.split('-').map(Number);
      weekdayMismatch = (new Date(yy, mm - 1, dd).getDay() + 6) % 7 !== g.wd;
    }
    return { ...base, date, weekdayMismatch, error: null };
  }
  return null;
}

/**
 * A cell/line that is ONLY a date (optionally followed by a time like 08:15 or 08:15:00).
 * @returns {ReturnType<typeof findDate>} null when the text holds anything else
 */
export function parseDateOnly(text, opts) {
  const s = String(text ?? '').trim();
  const r = findDate(s, opts);
  if (!r) return null;
  const rest = (s.slice(0, r.start) + s.slice(r.end)).replace(/^[\s,T]+|[\s,]+$/g, '');
  if (rest && !/^(\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?|\d{1,2}(\s*(am|pm)))$/i.test(rest)) return null;
  return r;
}

/**
 * Decide the day/month order of slash dates from a list of date texts.
 * @returns {{order: 'dmy'|'mdy', ambiguous: boolean}} ambiguous when both orders read every value
 */
export function detectDateOrder(texts) {
  let dmyOk = true; let mdyOk = true; let any = false;
  for (const t of texts) {
    const m = /(?<![\d.])(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})(?!\d)/.exec(String(t ?? ''));
    if (!m) continue;
    any = true;
    if (+m[1] > 12) mdyOk = false;
    if (+m[2] > 12) dmyOk = false;
  }
  if (!any) return { order: 'dmy', ambiguous: false };
  if (dmyOk && !mdyOk) return { order: 'dmy', ambiguous: false };
  if (mdyOk && !dmyOk) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: dmyOk && mdyOk };
}

// ---------------------------------------------------------------- numbers

/**
 * Parse a number as written in a file or paste.
 * @param {string|number|null|undefined} text e.g. '82,5', '82.5', '1.234,5', '1,234.5', '2 100'. Units are
 *   not part of a number ('82,5 kg' → null); callers strip the units they accept first
 * @param {'auto'|'comma'|'dot'} [decimal] 'auto': a lone ',' is a decimal comma (German); with both
 *   separators the last one is the decimal mark
 * @returns {number|null}
 */
export function parseNumber(text, decimal = 'auto') {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  let s = String(text ?? '').trim().replace(/[  ']/g, '').replace(/\s+/g, '');
  s = s.replace(/^\+/, '').replace(/−/g, '-');
  if (!s) return null;
  if (!/^-?[\d.,]+$/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let dec = null;
  if (decimal === 'comma') dec = ',';
  else if (decimal === 'dot') dec = '.';
  else if (lastComma >= 0 && lastDot >= 0) dec = lastComma > lastDot ? ',' : '.';
  else if (lastComma >= 0) dec = ',';
  else dec = '.';
  const thou = dec === ',' ? '.' : ',';
  if (s.includes(thou)) {
    // Thousands separators must sit in groups of three before the decimal mark.
    const intPart = s.split(dec)[0].replace(/^-/, '');
    if (!/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return null;
    s = s.split(thou).join('');
  }
  if (s.split(dec).length > 2) return null;
  s = s.replace(dec, '.');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- CSV / TSV

/**
 * Read delimited text (RFC 4180 style, as Excel and Google Sheets write it): quoted fields may hold
 * the delimiter, line breaks and doubled quotes. BOM and CRLF are handled.
 * @param {string} text
 * @param {{delimiter: string, quote?: string}} opts
 * @returns {{cells: string[], line: number}[]} records with the 1-based line where each starts;
 *   completely empty lines are skipped
 */
export function parseDelimited(text, { delimiter, quote = '"' }) {
  const s = stripBom(text);
  const out = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let cellQuoted = false;
  const endRow = () => {
    row.push(cell);
    if (!(row.length === 1 && row[0] === '' && !cellQuoted)) out.push({ cells: row, line: rowLine });
    row = []; cell = ''; cellQuoted = false;
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === quote) {
        if (s[i + 1] === quote) { cell += quote; i++; } else inQuotes = false;
      } else {
        if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++;
        if (c === '\r' && s[i + 1] === '\n') { cell += '\n'; i++; line++; continue; }
        cell += c;
      }
      continue;
    }
    if (c === quote && cell.trim() === '') { inQuotes = true; cellQuoted = true; cell = ''; continue; }
    if (c === delimiter) { row.push(cell); cell = ''; cellQuoted = false; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length || cellQuoted) endRow();
  return out.map((r) => ({ cells: r.cells.map((x) => x.trim()), line: r.line }));
}

/**
 * Guess the delimiter: the candidate that splits the first records into the most consistent
 * number of fields (> 1). Ties prefer tab, then semicolon, then comma.
 * @returns {string} '\t' | ';' | ',' | '|'
 */
export function detectDelimiter(text) {
  const sample = stripBom(text).slice(0, 20000);
  let best = { d: ',', score: -1 };
  for (const d of ['\t', ';', ',', '|']) {
    const recs = parseDelimited(sample, { delimiter: d }).slice(0, 40);
    if (recs.length > 1) recs.pop(); // the last sampled record may be cut off
    if (!recs.length) continue;
    const counts = new Map();
    for (const r of recs) {
      const n = trimTrailingEmpty(r.cells).length;
      counts.set(n, (counts.get(n) || 0) + 1);
    }
    let mode = 1; let freq = 0;
    for (const [n, f] of counts) if (f > freq || (f === freq && n > mode)) { mode = n; freq = f; }
    if (mode < 2) continue;
    const score = freq / recs.length + Math.min(mode, 30) / 1000;
    if (score > best.score + 1e-9) best = { d, score };
  }
  return best.d;
}

/** Cells without trailing empty ones (spreadsheet exports often pad rows). */
export function trimTrailingEmpty(cells) {
  let n = cells.length;
  while (n > 0 && cells[n - 1] === '') n--;
  return cells.slice(0, n);
}

const looksNumeric = (s) => parseNumber(s) !== null;
const looksDate = (s) => parseDateOnly(s) !== null;

/**
 * True when the first record looks like a header row: most of its non-empty cells are text while
 * the following records have numbers or dates in those columns.
 * @param {{cells: string[]}[]} records
 */
export function detectHeader(records) {
  if (!records.length) return false;
  const first = records[0].cells;
  const filled = first.filter((c) => c !== '');
  if (!filled.length) return false;
  const textCells = filled.filter((c) => !looksNumeric(c) && !looksDate(c));
  if (textCells.length / filled.length < 0.6) return false;
  if (records.length === 1) return true;
  // In at least one column the header is text but the data below is numeric/date.
  const rest = records.slice(1, 21);
  for (let i = 0; i < first.length; i++) {
    const h = first[i];
    if (!h || looksNumeric(h) || looksDate(h)) continue;
    const vals = rest.map((r) => r.cells[i] ?? '').filter(Boolean);
    if (vals.length && vals.filter((v) => looksNumeric(v) || looksDate(v)).length / vals.length >= 0.6) return true;
  }
  return false;
}

/**
 * Classify one cell for decimal-style detection.
 *   'comma' / 'dot'   the separator can only be a decimal mark ("82,5", "1.234,5", "0,125", "1234,567")
 *   'comma3' / 'dot3' every separator is followed by exactly three digits and the first group is
 *                     1–3 digits without a leading 0 ("1,050", "1.250", "12.345.678"): thousands or decimal
 *   null              no separator / not a number
 */
function decimalClass(v) {
  const s = String(v ?? '').trim().replace(/\s*(kcal|kj|g|mg|ml)$/i, '').replace(/^[+-]/, '');
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) return 'comma';
  if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s)) return 'dot';
  if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) return 'comma3';
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) return 'dot3';
  if (/^\d+,\d+$/.test(s)) return 'comma';
  if (/^\d+\.\d+$/.test(s)) return 'dot';
  return null;
}

/** Plausible energy per row (one food or one day), kcal. Used as evidence for the number style. */
export const PLAUSIBLE_ROW_KCAL = Object.freeze({ min: 20, max: 10000 });

/**
 * Decide the number style ("1.234,5" = 'comma', "1,234.5" = 'dot') of a file's numeric columns.
 * Per column:
 *   - values whose separator can only be a decimal mark vote for that style (decimal evidence);
 *     a column with both kinds is a conflict;
 *   - a column whose separated values ALL have exactly three digits after the separator (and none
 *     has another pattern) reads as thousands-grouped: "1.050" votes 'comma', "1,050" votes 'dot'
 *     (pattern evidence; ignored in a comma-separated file without commas in the values, where the
 *     dot can hardly be a thousands separator);
 *   - an energy column (kcalPerUnit given) is checked under both styles: a median below
 *     PLAUSIBLE_ROW_KCAL.min or a value above .max is implausible, and the plausible reading wins
 *     (meaning evidence, counts like decimal evidence).
 * Confidence: 'high' = decimal/meaning evidence for one style only, or no separators at all (the
 * style does not matter); 'medium' = only pattern evidence, or strong evidence with a weak
 * counter-vote; 'low' = strong evidence for both styles or contradictory patterns.
 * @param {{values: string[], kcalPerUnit?: number}[]} columns
 * @param {{delimiter?: string}} [opts]
 * @returns {{decimal: 'comma'|'dot', confidence: 'high'|'medium'|'low', reason: string}}
 */
export function detectNumberStyle(columns, { delimiter = null } = {}) {
  const strong = { comma: 0, dot: 0 };
  const weak = { comma: 0, dot: 0 };
  const reasons = [];
  let anySeparator = false;
  let undecided = false;
  const anyCommaValue = columns.some((c) => c.values.some((v) => /,/.test(String(v ?? ''))));
  const ignoreDotGroups = delimiter === ',' && !anyCommaValue;
  for (const col of columns) {
    const n = { comma: 0, dot: 0, comma3: 0, dot3: 0 };
    for (const v of col.values) { const k = decimalClass(v); if (k) n[k]++; }
    if (n.comma + n.dot + n.comma3 + n.dot3 === 0) continue;
    anySeparator = true;
    let vote = null; let kind = null; let weight = 0;
    if (n.comma && n.dot) { strong.comma += n.comma; strong.dot += n.dot; reasons.push('a column has both decimal commas and decimal dots'); continue; }
    if (n.comma) { vote = 'comma'; kind = 'strong'; weight = n.comma; } else if (n.dot) { vote = 'dot'; kind = 'strong'; weight = n.dot; } else if (n.dot3 && !n.comma3) {
      if (!ignoreDotGroups) { vote = 'comma'; kind = 'weak'; weight = n.dot3; }
    } else if (n.comma3 && !n.dot3) { vote = 'dot'; kind = 'weak'; weight = n.comma3; } else undecided = true;
    if (kind !== 'strong' && col.kcalPerUnit > 0) {
      const ok = (style) => {
        const nums = col.values.map((v) => parseNumber(String(v ?? '').replace(/\s*(kcal|kj)$/i, ''), style)).filter((x) => x !== null).map((x) => x * col.kcalPerUnit);
        if (!nums.length) return false;
        return median(nums) >= PLAUSIBLE_ROW_KCAL.min && Math.max(...nums) <= PLAUSIBLE_ROW_KCAL.max;
      };
      const okComma = ok('comma'); const okDot = ok('dot');
      if (okComma !== okDot) {
        vote = okComma ? 'comma' : 'dot'; kind = 'strong'; weight = Math.max(weight, 1);
        reasons.push(`the energy column is only plausible read as ${okComma ? '1.234,5' : '1,234.5'}`);
      }
    }
    if (!vote) continue;
    if (kind === 'strong') strong[vote] += weight; else weak[vote] += weight;
    if (kind === 'weak') reasons.push(`a column has only three-digit groups (${vote === 'comma' ? '1.050' : '1,050'}), read as thousands`);
  }
  const pick = (a) => (a.comma > a.dot ? 'comma' : 'dot');
  if (!anySeparator) return { decimal: 'dot', confidence: 'high', reason: 'no decimal or thousands separators' };
  if (strong.comma && strong.dot) return { decimal: pick(strong), confidence: 'low', reason: 'the file has numbers in both styles' };
  if (strong.comma || strong.dot) {
    const d = pick(strong);
    const other = d === 'comma' ? 'dot' : 'comma';
    return { decimal: d, confidence: weak[other] || undecided ? 'medium' : 'high', reason: reasons.join('; ') || 'decimal marks in the values' };
  }
  if (weak.comma && weak.dot) return { decimal: pick(weak), confidence: 'low', reason: 'three-digit groups with both separators' };
  if (weak.comma || weak.dot) return { decimal: pick(weak), confidence: 'medium', reason: reasons.join('; ') };
  return { decimal: 'dot', confidence: 'low', reason: 'separators could not be told apart' };
}

/**
 * Guess the decimal style of numeric values (one column; see detectNumberStyle for the rules).
 * @param {string[]} values cells from numeric columns
 * @returns {'comma'|'dot'}
 */
export function detectDecimal(values) {
  return detectNumberStyle([{ values }]).decimal;
}

/** Normalised header text for matching: lower case, no BOM/quotes, single spaces. */
export function normHeader(h) {
  return String(h ?? '').replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Median of numbers (null for an empty list). */
export function median(nums) {
  if (!nums.length) return null;
  const a = [...nums].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Split an array into chunks of `size`. */
export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
