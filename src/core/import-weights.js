// Body-weight history: one weigh-in per line, date and kg in either order. Pure, no DOM.
//
// Tokenizer (deliberate, because "," is both a decimal mark and a column separator):
//   1. Find the date first, anywhere in the line (all formats of import-common.findDate, plus an
//      optional time after it). Remove it.
//   2. What is left holds the weight. Cut it into tokens at tabs, semicolons, pipes and spaces.
//      Commas only separate columns when the rest cannot be one number: "82,5" (from
//      "12.11.2026,82,5" or "82,5;12.11.2026") is 82.5; "82.5,18.2" is two columns.
//   3. The first number-token is the weight in kg; further numbers (body fat …) are ignored with a
//      note. "kg" is allowed; "lb"/"lbs"/"pounds" anywhere stops the import (metric only).
//   File-level evidence for commas (parseWeightText):
//   - A comma-separated header row with k ≥ 3 columns ("Date,Weight,BodyFat"): a data line with
//     exactly k comma fields is read as columns ("10.11.2026,82,18" = 82 kg, BodyFat ignored, with a
//     note); a line with more fields is an explicit "ambiguous" error (a decimal comma cannot be
//     told from a separator). A header with 2 columns ("Date,Weight") means a third comma field can
//     only be a decimal comma ("12.11.2026,82,5" = 82.5).
//   - No such header: a comma between two digit groups after the date is a decimal comma.
//     "12.11.2026,82,5" = 82.5 kg (documented). "12.11.2026,82,18" = 82.18 kg, but two digits could
//     also be a second column (body fat), so it is reported as a guess in the preview (notes +
//     a warning on the line).
//   ISO timestamps ("2026-11-12T07:30", optional seconds and zone) use their local date.
import { splitLines, findDate, detectDateOrder, parseNumber, stripWeekdays } from './import-common.js';

import { MIN_KG, MAX_KG, isPlausibleKg } from './body-weight.js';

export { MIN_KG, MAX_KG }; // shared range (src/core/body-weight.js)

const LB_RE = /\b(lbs?|pounds?|pfund)\b/i;

/**
 * Read the weight part of a line (date already removed).
 * @param {string} rest
 * @param {{commaColumns?: boolean}} [opts] commaColumns: commas are column separators (from the header)
 * @returns {{kg: number|null, extra: boolean, error: string|null, guess?: string|null}} guess: the text
 *   when a comma with two digits after it was read as a decimal comma ("82,18")
 */
export function readWeightRest(rest, { commaColumns = false } = {}) {
  let s = String(rest ?? '').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i, ' ').replace(/kg\b/gi, ' ').trim();
  s = s.replace(/^[\s,;|]+|[\s,;|]+$/g, '');
  if (!s) return { kg: null, extra: false, error: 'No weight on this line' };
  if (!commaColumns) {
    const one = parseNumber(s.replace(/\s+/g, ''), 'auto');
    if (one !== null && !/\s/.test(s)) return { kg: one, extra: false, error: null, guess: /^\d+,\d{2}$/.test(s) ? s : null };
  }
  let tokens = s.split(commaColumns ? /[\t;|,]+|\s+/ : /[\t;|]+|\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 1 && tokens[0].includes(',')) {
    // Only commas: "82,5" handled above; "82.5,18.2" / "82,18" are columns.
    tokens = tokens[0].split(',').filter(Boolean);
    if (tokens.length > 1 && tokens.every((t) => /^\d+$/.test(t))) return { kg: null, extra: false, error: `"${s}" is ambiguous. Use a semicolon or tab between columns, or a dot as decimal mark` };
  }
  const nums = tokens.map((t) => parseNumber(t, 'auto'));
  const firstIdx = nums.findIndex((n) => n !== null);
  if (firstIdx < 0) return { kg: null, extra: false, error: `Could not read a weight in "${s}"` };
  if (tokens.some((t, i) => nums[i] === null && /\p{L}/u.test(t))) return { kg: null, extra: false, error: `Unexpected text "${s}"` };
  return { kg: nums[firstIdx], extra: nums.filter((n) => n !== null).length > 1, error: null };
}

/**
 * Parse a weight paste or file.
 * @param {string} text
 * @param {{today: string, dateOrder?: 'auto'|'dmy'|'mdy'}} opts
 * @returns {{rows: {line: number, date: string, kg: number}[], issues: {line: number, text: string, message: string, level: 'error'|'warning'|'info'}[],
 *   fatal: string|null, dateOrder: 'dmy'|'mdy', dateOrderAmbiguous: boolean, notes: string[]}}
 *   notes: file-level remarks for the preview (how commas were read, guesses)
 */
export function parseWeightText(text, { today, dateOrder = 'auto' } = {}) {
  const lines = splitLines(text);
  const det = dateOrder === 'auto' ? detectDateOrder(lines) : { order: dateOrder, ambiguous: false };
  const rows = [];
  const issues = [];
  const issue = (i, message, level = 'error') => issues.push({ line: i + 1, text: lines[i], message, level });
  let seenData = false;
  const lbLines = [];
  const notes = [];
  // A comma-separated header row gives the column count (see header).
  const headerIdx = lines.findIndex((l) => l.trim() !== '');
  const headerLine = headerIdx >= 0 ? lines[headerIdx].trim() : '';
  const isHeader = headerLine && !findDate(headerLine, { order: det.order, today }) && /\p{L}/u.test(headerLine);
  const headerCols = isHeader && headerLine.includes(',') && !/[;\t|]/.test(headerLine)
    ? headerLine.split(',').map((c) => c.trim()) : null;
  const columnMode = headerCols && headerCols.length >= 3;
  let columnLines = 0;
  const guesses = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    if (LB_RE.test(line)) { lbLines.push(i + 1); return; }
    const d = findDate(line, { order: det.order, today });
    if (!d) {
      if (!seenData && /\p{L}/u.test(line)) { issue(i, 'Header row, ignored', 'info'); return; }
      issue(i, 'No date found on this line');
      return;
    }
    if (!d.date) { issue(i, d.error || 'Not a valid date'); return; }
    seenData = true;
    const iso = isoTime(line, d);
    const date = iso ? iso.date : d.date;
    const after = iso ? line.slice(iso.end) : line.slice(d.end);
    const rest = line.slice(0, d.start) + '\t' + after;
    let commaColumns = false;
    if (columnMode && !/[;\t|]/.test(line)) {
      const fields = (line.slice(0, d.start) + 'D' + after).split(',').length;
      if (fields > headerCols.length) {
        issue(i, `"${line}" is ambiguous: ${fields} comma-separated values but the header has ${headerCols.length} columns, so a decimal comma cannot be told from a column separator. Use a dot as decimal mark, or ; or a tab between columns`);
        return;
      }
      if (fields === headerCols.length) { commaColumns = true; columnLines++; }
    }
    const w = readWeightRest(stripWeekdays(rest), { commaColumns });
    if (w.error) { issue(i, w.error); return; }
    if (w.extra) issue(i, 'More than one number after the date; the first one is used as kg, the rest is ignored', 'warning');
    if (w.guess) { guesses.push(w.guess); issue(i, `"${w.guess}" read as ${parseNumber(w.guess, 'comma')} kg (decimal comma). If the part after the comma is a second column, add a header row`, 'warning'); }
    rows.push({ line: i + 1, date, kg: Math.round(w.kg * 100) / 100 });
  });
  if (columnLines) {
    const ignored = headerCols.filter((h) => !/date|datum|day|tag|time|zeit|uhr/i.test(h)).slice(1).filter(Boolean);
    notes.push(`Commas are read as column separators (the header has ${headerCols.length} columns: ${headerCols.join(', ')}). The first number after the date is the weight in kg${ignored.length ? `; ${ignored.map((h) => `"${h}"`).join(', ')} ${ignored.length === 1 ? 'is' : 'are'} ignored` : ''}.`);
  }
  if (guesses.length) {
    notes.push(`Guess: with no header row, ${guesses.length === 1 ? `"${guesses[0]}" was` : `${guesses.length} values like "${guesses[0]}" were`} read with a decimal comma (${parseNumber(guesses[0], 'comma')} kg). If the number after the comma is a second column (e.g. body fat), add a header row such as "Date,Weight,BodyFat", or separate the columns with ; or a tab.`);
  }
  const fatal = lbLines.length
    ? `Line${lbLines.length > 1 ? 's' : ''} ${lbLines.slice(0, 8).join(', ')} mention pounds (lb). Only kilograms are supported; convert the column to kg first (kg = lb × 0.4536).`
    : null;
  return { rows: fatal ? [] : rows, issues, fatal, dateOrder: det.order, dateOrderAmbiguous: det.ambiguous, notes };
}

/**
 * An ISO time right after a YYYY-MM-DD date ("T07:30", "T07:30:15.5", optional "Z" / "+01:00").
 * With a zone the local date of that instant is used; without one the written date is local already.
 * @returns {{date: string, end: number}|null} end = index after the time
 */
function isoTime(line, d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(line.slice(d.start, d.end))) return null;
  const m = /^T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/i.exec(line.slice(d.end));
  if (!m) return null;
  let date = d.date;
  if (m[4]) {
    const t = new Date(line.slice(d.start, d.end + m[0].length).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
    if (!Number.isNaN(t.getTime())) date = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  }
  return { date, end: d.end + m[0].length };
}

/**
 * Check parsed rows against plausibility and the existing data.
 * - implausible (outside 30–300 kg) and future dates are left out;
 * - the same day twice in the paste: the later line is used, the earlier one is left out;
 * - days that already have a weight are conflicts, resolved by the policy at write time.
 * @param {{line: number, date: string, kg: number}[]} rows
 * @param {{today: string, existing: Map<string, number>|Record<string, number>}} opts existing kg by date
 */
export function analyseWeights(rows, { today, existing }) {
  const ex = existing instanceof Map ? existing : new Map(Object.entries(existing || {}));
  const flagged = [];
  const byDate = new Map();
  for (const r of rows) {
    if (!isPlausibleKg(r.kg)) { flagged.push({ ...r, reason: `${r.kg} kg is outside ${MIN_KG}–${MAX_KG} kg` }); continue; }
    if (r.date > today) { flagged.push({ ...r, reason: 'Date is in the future' }); continue; }
    const prev = byDate.get(r.date);
    if (prev) flagged.push({ ...prev, reason: `Same day again on line ${r.line}; that line is used` });
    byDate.set(r.date, r);
  }
  const valid = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const conflicts = valid.filter((r) => ex.has(r.date)).map((r) => ({ ...r, existingKg: ex.get(r.date) }));
  const kgs = valid.map((r) => r.kg);
  flagged.sort((a, b) => a.line - b.line);
  return {
    valid, flagged, conflicts,
    count: valid.length,
    from: valid.length ? valid[0].date : null,
    to: valid.length ? valid[valid.length - 1].date : null,
    min: kgs.length ? Math.min(...kgs) : null,
    max: kgs.length ? Math.max(...kgs) : null,
  };
}

/**
 * Records to write.
 * @param {{date: string, kg: number}[]} valid from analyseWeights
 * @param {{policy: 'keep'|'replace', existing: Map<string, object>, importId: string, now: number}} opts
 *   existing: stored weight records by date
 * @returns {{records: object[], replaced: object[], keptExisting: number}} replaced = previous records
 *   (restored by undo)
 */
export function planWeights(valid, { policy, existing, importId, now }) {
  const records = [];
  const replaced = [];
  let keptExisting = 0;
  for (const r of valid) {
    const old = existing.get(r.date);
    if (old) {
      if (policy !== 'replace') { keptExisting++; continue; }
      replaced.push(old);
    }
    records.push({ date: r.date, kg: r.kg, updatedAt: now, importId });
  }
  return { records, replaced, keptExisting };
}
