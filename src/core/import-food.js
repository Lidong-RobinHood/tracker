// Food diary history from another app's CSV/TSV export (or any spreadsheet). Pure, no DOM.
// The user maps columns; presets pre-fill the mapping for exports whose layout is documented in
// docs/IMPORT-FORMATS.md. Each row becomes one quick-add style diary entry (amount 100, per100 =
// the row's totals, foodId null), exactly like the app's Quick add.
import {
  stripBom, parseDelimited, detectDelimiter, detectHeader, detectNumberStyle, detectDateOrder,
  parseDateOnly, findDate, parseNumber, normHeader, median, trimTrailingEmpty,
} from './import-common.js';
import { quickAddEntry, isMeal } from './food-diary.js';
import { kjToKcal } from './nutrition.js';
import { round } from './numbers.js';

/** Fields the user can map. */
export const FOOD_FIELDS = Object.freeze([
  { id: 'date', label: 'Date', required: true },
  { id: 'meal', label: 'Meal' },
  { id: 'name', label: 'Food name' },
  { id: 'amount', label: 'Amount (g or ml)' },
  { id: 'kcal', label: 'Energy (kcal)', required: true },
  { id: 'kj', label: 'Energy (kJ)' },
  { id: 'protein', label: 'Protein (g)' },
  { id: 'carbs', label: 'Carbs (g)' },
  { id: 'fat', label: 'Fat (g)' },
  { id: 'sugars', label: 'Sugars (g)' },
  { id: 'fibre', label: 'Fibre (g)' },
  { id: 'satFat', label: 'Saturated fat (g)' },
  { id: 'salt', label: 'Salt (g)' },
  { id: 'sodium', label: 'Sodium (mg)' },
]);

/** Header words per field (normalised, lower case). First match wins, exact before contains. */
const GUESS = {
  date: ['date', 'day', 'datum', 'tag', 'datum_tag_monat_jahr_stunde_minute', 'datum_tag_monat_jahr'],
  meal: ['meal', 'group', 'mahlzeit', 'meal name', 'diary group'],
  name: ['food name', 'food', 'name', 'description', 'bezeichnung', 'lebensmittel', 'item', 'produkt'],
  amount: ['amount', 'quantity', 'menge', 'amount (g)', 'gramm', 'grams', 'weight (g)'],
  kcal: ['energy (kcal)', 'calories', 'kcal', 'calories (kcal)', 'kalorien', 'energie (kcal)', 'energy', 'brennwert (kcal)'],
  kj: ['energy (kj)', 'kj', 'kilojoule', 'energie (kj)', 'brennwert (kj)'],
  protein: ['protein (g)', 'protein', 'eiweiß', 'eiweiss', 'protein_g', 'eiweiß (g)'],
  carbs: ['carbohydrates (g)', 'carbs (g)', 'carbohydrates', 'carbs', 'kohlenhydrate', 'kh_g', 'kohlenhydrate (g)', 'net carbs (g)'],
  fat: ['fat (g)', 'fat', 'fett', 'fett_g', 'total fat', 'fett (g)'],
  sugars: ['sugars (g)', 'sugar', 'sugars', 'zucker', 'sugar (g)', 'zucker (g)'],
  fibre: ['fiber (g)', 'fibre (g)', 'fiber', 'fibre', 'ballaststoffe', 'ballaststoffe (g)'],
  satFat: ['saturated fat', 'saturated fat (g)', 'saturated (g)', 'sat fat', 'gesättigte fettsäuren', 'gesaettigte fettsaeuren'],
  salt: ['salt', 'salt (g)', 'salz', 'salz (g)'],
  sodium: ['sodium (mg)', 'sodium', 'natrium (mg)', 'natrium'],
};

/**
 * Guess a mapping from header names.
 * @param {string[]} headers
 * @returns {Record<string, number>} field id → column index (only guessed fields)
 */
export function guessMapping(headers) {
  const h = headers.map(normHeader);
  const used = new Set();
  const out = {};
  for (const f of FOOD_FIELDS) {
    const words = GUESS[f.id] || [];
    let idx = -1;
    for (const w of words) { idx = h.findIndex((x, i) => !used.has(i) && x === w); if (idx >= 0) break; }
    if (idx < 0 && f.id !== 'date' && f.id !== 'kcal') {
      for (const w of words) { if (w.length < 4) continue; idx = h.findIndex((x, i) => !used.has(i) && x.startsWith(w)); if (idx >= 0) break; }
    }
    if (idx >= 0) { out[f.id] = idx; used.add(idx); }
  }
  if (out.kcal === undefined && out.kj === undefined) {
    const e = h.findIndex((x, i) => !used.has(i) && /kcal|calorie|kalorie/.test(x));
    if (e >= 0) out.kcal = e;
  }
  return out;
}

/**
 * Presets: column header names for each documented export. `status` says how sure we are:
 * 'sample' = header line confirmed from real export files (third-party samples, see docs);
 * 'unconfirmed' = reconstructed from a third-party importer only.
 */
export const PRESETS = Object.freeze([
  {
    id: 'mfp', label: 'MyFitnessPal – Nutrition Summary', status: 'sample',
    note: 'One row per meal per day.',
    required: ['date', 'meal', 'calories', 'protein (g)'],
    columns: { date: 'Date', meal: 'Meal', kcal: 'Calories', fat: 'Fat (g)', satFat: 'Saturated Fat', carbs: 'Carbohydrates (g)', fibre: 'Fiber', sugars: 'Sugar', protein: 'Protein (g)', sodium: 'Sodium (mg)' },
    dateFormat: 'ymd', decimal: 'dot',
  },
  {
    id: 'cronometer-servings', label: 'Cronometer – Servings (servings.csv)', status: 'sample',
    note: 'One row per food. "Group" is the diary group (Breakfast, Lunch, …).',
    required: ['day', 'food name', 'energy (kcal)'],
    columns: { date: 'Day', meal: 'Group', name: 'Food Name', amount: 'Amount', kcal: 'Energy (kcal)', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)', fibre: 'Fiber (g)', sugars: 'Sugars (g)', sodium: 'Sodium (mg)' },
    dateFormat: 'ymd', decimal: 'dot',
  },
  {
    id: 'cronometer-daily', label: 'Cronometer – Daily Nutrition (dailysummary.csv)', status: 'sample',
    note: 'One row per day or diary group. Total rows skipped.',
    required: ['date', 'energy (kcal)', 'protein (g)'],
    columns: { date: 'Date', meal: 'Group', kcal: 'Energy (kcal)', protein: 'Protein (g)', carbs: 'Carbs (g)', fat: 'Fat (g)', fibre: 'Fiber (g)', sugars: 'Sugars (g)', sodium: 'Sodium (mg)' },
    dateFormat: 'ymd', decimal: 'dot',
  },
  {
    id: 'fddb', label: 'FDDB – Food diary (unconfirmed layout)', status: 'unconfirmed',
    note: 'Unconfirmed layout. Check the preview.',
    required: ['bezeichnung', 'kj'],
    anyOf: [['datum_tag_monat_jahr_stunde_minute', 'datum_tag_monat_jahr']],
    columns: { date: ['datum_tag_monat_jahr_stunde_minute', 'datum_tag_monat_jahr'], name: 'bezeichnung', kj: 'kj', kcal: 'kcal', fat: 'fett_g', carbs: 'kh_g', protein: 'protein_g' },
    dateFormat: 'dmy', decimal: 'comma',
  },
]);

/** The preset whose required headers are all present, or null. */
export function detectPreset(headers) {
  const h = new Set(headers.map(normHeader));
  return PRESETS.find((p) => p.required.every((r) => h.has(r)) && (p.anyOf || []).every((alts) => alts.some((a) => h.has(a)))) || null;
}

/** Mapping for a preset against the actual headers (missing columns are left out). */
export function presetMapping(preset, headers) {
  const h = headers.map(normHeader);
  const out = {};
  for (const [field, names] of Object.entries(preset.columns)) {
    for (const n of [].concat(names)) {
      const i = h.indexOf(normHeader(n));
      if (i >= 0) { out[field] = i; break; }
    }
  }
  return out;
}

/**
 * Read a file's text into a table and detect its shape.
 * @param {string} text
 * @param {{delimiter?: string|null, hasHeader?: boolean|null}} [opts] overrides
 * @returns {{delimiter: string, hasHeader: boolean, headers: string[], rows: {cells: string[], line: number}[],
 *   columnCount: number}}
 */
export function readTable(text, { delimiter = null, hasHeader = null } = {}) {
  const t = stripBom(text);
  const d = delimiter || detectDelimiter(t);
  const recs = parseDelimited(t, { delimiter: d });
  const header = hasHeader === null ? detectHeader(recs) : hasHeader;
  const columnCount = recs.reduce((m, r) => Math.max(m, trimTrailingEmpty(r.cells).length), 0);
  const headers = header && recs.length
    ? Array.from({ length: columnCount }, (_, i) => recs[0].cells[i] || `Column ${i + 1}`)
    : Array.from({ length: columnCount }, (_, i) => `Column ${i + 1}`);
  return { delimiter: d, hasHeader: header, headers, rows: header ? recs.slice(1) : recs, columnCount };
}

/**
 * Detect the date order and the number style for a mapping (import-common.detectNumberStyle: decimal
 * marks, columns of three-digit groups read as thousands, and the energy column's plausibility).
 * @returns {{dateOrder: 'dmy'|'mdy', dateOrderAmbiguous: boolean, decimal: 'comma'|'dot',
 *   decimalConfidence: 'high'|'medium'|'low', decimalReason: string}}
 */
export function detectFormats(table, mapping) {
  const dates = mapping.date === undefined ? [] : table.rows.map((r) => r.cells[mapping.date] || '');
  const order = detectDateOrder(dates);
  const rows = table.rows.slice(0, 500);
  const columns = ['kcal', 'kj', 'protein', 'carbs', 'fat', 'sugars', 'fibre', 'satFat', 'salt', 'sodium', 'amount']
    .filter((f) => mapping[f] !== undefined)
    .map((f) => ({
      values: rows.map((r) => r.cells[mapping[f]] || ''),
      kcalPerUnit: f === 'kcal' ? 1 : f === 'kj' ? 1 / 4.184 : undefined,
    }));
  const style = detectNumberStyle(columns, { delimiter: table.delimiter });
  return {
    dateOrder: order.order, dateOrderAmbiguous: order.ambiguous,
    decimal: style.decimal, decimalConfidence: style.confidence, decimalReason: style.reason,
  };
}

/** Distinct non-empty values of the meal column, with counts, in order of appearance. */
export function mealValues(table, mapping) {
  if (mapping.meal === undefined) return [];
  const m = new Map();
  for (const r of table.rows) {
    const v = (r.cells[mapping.meal] || '').trim();
    m.set(v, (m.get(v) || 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count }));
}

/**
 * Guess the app meal for a file's meal name.
 * @returns {'breakfast'|'lunch'|'dinner'|'snack'|'skip'|null} null = use the default meal
 */
export function guessMeal(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (/^(total|totals|gesamt|summe|day total|tagessumme)$/.test(v)) return 'skip';
  if (/breakfast|frühstück|fruehstueck|morning|morgen/.test(v)) return 'breakfast';
  if (/lunch|mittag/.test(v)) return 'lunch';
  if (/dinner|supper|abend/.test(v)) return 'dinner';
  if (/snack|zwischen|uncategori|other|sonstig/.test(v)) return 'snack';
  if (isMeal(v)) return v;
  return null;
}

/** A gram/ml amount from free text ("58.00 g", "250 ml", "120"); null for "2 slices". */
export function parseAmount(text, decimal) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const m = /^(\d[\d.,]*)\s*(g|gr|gramm|grams?|ml)?$/i.exec(s);
  if (!m) return null;
  const n = parseNumber(m[1], decimal);
  return n !== null && n > 0 ? { value: n, unit: m[2] && /ml/i.test(m[2]) ? 'ml' : 'g' } : null;
}

export const MAX_ROW_KCAL = 10000;

/**
 * Turn mapped rows into entries.
 * @param {{rows: {cells: string[], line: number}[]}} table
 * @param {{mapping: Record<string, number>, dateOrder: 'dmy'|'mdy', decimal: 'comma'|'dot',
 *   mealMap?: Record<string, string>, defaultMeal: string, energy?: 'kcal'|'kj', sodiumToSalt?: boolean, today: string}} opts
 *   energy: which column provides energy when both are mapped (kJ is converted ÷ 4.184)
 * @returns {{entries: object[], skipped: {line: number, reason: string}[]}}
 */
export function buildFoodRows(table, { mapping, dateOrder, decimal, mealMap = {}, defaultMeal, energy = null, sodiumToSalt = true, today }) {
  const entries = [];
  const skipped = [];
  const useKj = energy === 'kj' || (energy === null && mapping.kcal === undefined && mapping.kj !== undefined);
  const cell = (r, f) => (mapping[f] === undefined ? '' : (r.cells[mapping[f]] ?? '').trim());
  const num = (r, f) => {
    const s = cell(r, f);
    if (s === '') return { v: null, bad: false };
    const n = parseNumber(s.replace(/\s*(kcal|kj|g|mg)$/i, ''), decimal);
    return n === null ? { v: null, bad: true, s } : { v: n, bad: false };
  };
  for (const r of table.rows) {
    if (r.cells.every((c) => !c)) continue;
    const dText = cell(r, 'date');
    if (!dText) { skipped.push({ line: r.line, reason: 'No date' }); continue; }
    const d = parseDateOnly(dText, { order: dateOrder, today }) || findDate(dText, { order: dateOrder, today });
    if (!d || !d.date) { skipped.push({ line: r.line, reason: `Date "${dText}" not readable` }); continue; }
    if (d.date > today) { skipped.push({ line: r.line, reason: `Date ${d.date} is in the future` }); continue; }

    let meal = defaultMeal;
    if (mapping.meal !== undefined) {
      const mv = cell(r, 'meal');
      const chosen = Object.prototype.hasOwnProperty.call(mealMap, mv) ? mealMap[mv] : (guessMeal(mv) ?? defaultMeal);
      if (chosen === 'skip') { skipped.push({ line: r.line, reason: `Meal "${mv}" is set to skip` }); continue; }
      meal = isMeal(chosen) ? chosen : defaultMeal;
    }

    const e = useKj ? num(r, 'kj') : num(r, 'kcal');
    if (e.bad) { skipped.push({ line: r.line, reason: `Energy "${e.s}" is not a number` }); continue; }
    if (e.v === null) { skipped.push({ line: r.line, reason: 'No energy value' }); continue; }
    const kcal = useKj ? kjToKcal(e.v) : e.v;
    if (kcal < 0) { skipped.push({ line: r.line, reason: 'Negative energy' }); continue; }
    if (kcal > MAX_ROW_KCAL) { skipped.push({ line: r.line, reason: `${Math.round(kcal)} kcal in one row is implausible` }); continue; }

    const vals = {};
    let bad = null;
    for (const f of ['protein', 'carbs', 'fat', 'sugars', 'fibre', 'satFat', 'salt', 'sodium']) {
      const x = num(r, f);
      if (x.bad) { bad = `${f} "${x.s}" is not a number`; break; }
      if (x.v !== null && x.v < 0) { bad = `Negative ${f}`; break; }
      vals[f] = x.v;
    }
    if (bad) { skipped.push({ line: r.line, reason: bad }); continue; }
    if (kcal === 0 && !vals.protein && !vals.carbs && !vals.fat) { skipped.push({ line: r.line, reason: 'Empty row (0 kcal)' }); continue; }
    let salt = vals.salt;
    if ((salt === null || salt === undefined) && sodiumToSalt && vals.sodium !== null && vals.sodium !== undefined) salt = (vals.sodium * 2.5) / 1000;

    const amount = mapping.amount !== undefined ? parseAmount(cell(r, 'amount'), decimal) : null;
    const name = cell(r, 'name').replace(/\s+/g, ' ');
    entries.push({
      line: r.line, date: d.date, meal,
      name: name || (mapping.meal !== undefined && cell(r, 'meal') ? `${cell(r, 'meal')} (imported)` : 'Imported'),
      amount, kcal: round(kcal, 1),
      protein: vals.protein ?? null, carbs: vals.carbs ?? null, fat: vals.fat ?? null,
      sugars: vals.sugars ?? null, fibre: vals.fibre ?? null, satFat: vals.satFat ?? null,
      salt: salt === null || salt === undefined ? null : round(salt, 2),
    });
  }
  return { entries, skipped };
}

/**
 * Preview numbers. `warnings` flags an implausible median day (below PLAUSIBLE_DAY_KCAL.min or above .max).
 * @param {object[]} entries from buildFoodRows
 * @param {Set<string>|string[]} [existingDays] days that already have diary entries
 */
export function summariseFood(entries, existingDays = []) {
  const ex = existingDays instanceof Set ? existingDays : new Set(existingDays);
  const perDay = new Map();
  for (const e of entries) perDay.set(e.date, (perDay.get(e.date) || 0) + e.kcal);
  const days = [...perDay.keys()].sort();
  const kcals = [...perDay.values()];
  return {
    days: days.length, entries: entries.length,
    from: days[0] || null, to: days[days.length - 1] || null,
    kcalMin: kcals.length ? Math.min(...kcals) : null,
    kcalMedian: median(kcals),
    kcalMax: kcals.length ? Math.max(...kcals) : null,
    conflictDays: days.filter((d) => ex.has(d)),
    perDay,
    warnings: plausibilityWarnings(median(kcals)),
  };
}

/** Median day energy outside this range (kcal) gets a warning in the preview. */
export const PLAUSIBLE_DAY_KCAL = Object.freeze({ min: 300, max: 15000 });

/** Warnings for an implausible median day (wrong column, kJ as kcal, or the wrong number style). */
function plausibilityWarnings(med) {
  if (med === null) return [];
  if (med < PLAUSIBLE_DAY_KCAL.min) {
    return [{ code: 'median-low', message: `Median day only ${Math.round(med)} kcal. Check the energy column and number style.` }];
  }
  if (med > PLAUSIBLE_DAY_KCAL.max) {
    return [{ code: 'median-high', message: `Median day ${Math.round(med)} kcal is very high. kJ instead of kcal? Check the number style.` }];
  }
  return [];
}

/**
 * Diary records in the Quick add form (amount 100, per100 = totals, foodId null), tagged with importId.
 * @param {object[]} entries from buildFoodRows
 * @param {{importId: string, now: number, newId: () => string, skipDays?: Set<string>}} opts
 */
export function toDiaryRecords(entries, { importId, now, newId, skipDays = new Set() }) {
  const out = [];
  for (const e of entries) {
    if (skipDays.has(e.date)) continue;
    const amountText = e.amount ? ` · ${round(e.amount.value, 1)} ${e.amount.unit}` : '';
    const rec = quickAddEntry({
      id: newId(), date: e.date, meal: e.meal, name: `${e.name}${amountText}`.slice(0, 200),
      kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, now: now + out.length,
    });
    rec.per100.sugars = e.sugars;
    rec.per100.fibre = e.fibre;
    rec.per100.satFat = e.satFat;
    rec.per100.salt = e.salt;
    rec.importId = importId;
    out.push(rec);
  }
  return out;
}
