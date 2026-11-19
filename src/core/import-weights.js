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
import { splitLines, findDate, detectDateOrder, parseNumber, stripWeekdays } from './import-common.js';

export const MIN_KG = 30;
export const MAX_KG = 300;

const LB_RE = /\b(lbs?|pounds?|pfund)\b/i;

/**
 * Read the weight part of a line (date already removed).
 * @returns {{kg: number|null, extra: boolean, error: string|null}}
 */
export function readWeightRest(rest) {
  let s = String(rest ?? '').replace(/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i, ' ').replace(/kg\b/gi, ' ').trim();
  s = s.replace(/^[\s,;|]+|[\s,;|]+$/g, '');
  if (!s) return { kg: null, extra: false, error: 'No weight on this line' };
  const one = parseNumber(s.replace(/\s+/g, ''), 'auto');
  if (one !== null && !/\s/.test(s)) return { kg: one, extra: false, error: null };
  let tokens = s.split(/[\t;|]+|\s+/).map((t) => t.trim()).filter(Boolean);
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
 *   fatal: string|null, dateOrder: 'dmy'|'mdy', dateOrderAmbiguous: boolean}}
 */
export function parseWeightText(text, { today, dateOrder = 'auto' } = {}) {
  const lines = splitLines(text);
  const det = dateOrder === 'auto' ? detectDateOrder(lines) : { order: dateOrder, ambiguous: false };
  const rows = [];
  const issues = [];
  const issue = (i, message, level = 'error') => issues.push({ line: i + 1, text: lines[i], message, level });
  let seenData = false;
  const lbLines = [];
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
    const rest = line.slice(0, d.start) + '\t' + line.slice(d.end);
    const w = readWeightRest(stripWeekdays(rest));
    if (w.error) { issue(i, w.error); return; }
    if (w.extra) issue(i, 'More than one number after the date; the first one is used as kg', 'warning');
    rows.push({ line: i + 1, date: d.date, kg: Math.round(w.kg * 100) / 100 });
  });
  const fatal = lbLines.length
    ? `Line${lbLines.length > 1 ? 's' : ''} ${lbLines.slice(0, 8).join(', ')} mention pounds (lb). Only kilograms are supported; convert the column to kg first (kg = lb × 0.4536).`
    : null;
  return { rows: fatal ? [] : rows, issues, fatal, dateOrder: det.order, dateOrderAmbiguous: det.ambiguous };
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
    if (r.kg < MIN_KG || r.kg > MAX_KG) { flagged.push({ ...r, reason: `${r.kg} kg is outside ${MIN_KG}–${MAX_KG} kg` }); continue; }
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
