// Macro targets as a percentage split of calories. Pure, no DOM.
//
// settings.targets stays in grams for every reader: { kcal, protein, carbs, fat, source }.
// Percent mode adds { mode: 'percent', pct: { protein, carbs, fat } } (missing mode = 'grams').
//
// Energy per gram (Atwater): protein 4, carbs 4, fat 9 kcal.
//
// Rounding rule (percent → grams): each macro is rounded to the nearest whole gram on its own
// (half up). The calorie target is the user's number and is never changed to match, so the
// macros' energy may differ from it by the rounding drift: at most 0.5 g × (4 + 4 + 9) = 8.5 kcal.
// That is below what any food label resolves, so the drift is accepted rather than pushed into
// one macro (which would make e.g. 40 % carbs come out as 239 g for no visible reason).
//
// Grams → percent (switching mode): the shares of the macros' own energy, rounded to `decimals`
// with the largest-remainder method so they always add up to exactly 100.

export const KCAL_PER_GRAM = Object.freeze({ protein: 4, carbs: 4, fat: 9 });
export const MACROS = Object.freeze(['protein', 'carbs', 'fat']);
/** A split is valid when its sum is within this many percentage points of 100. */
export const SUM_TOLERANCE = 0.1;

export const SPLIT_PRESETS = Object.freeze([
  { label: '30/40/30', pct: { protein: 30, carbs: 40, fat: 30 } },
  { label: '40/40/20', pct: { protein: 40, carbs: 40, fat: 20 } },
  { label: '25/50/25', pct: { protein: 25, carbs: 50, fat: 25 } },
  { label: '30/35/35', pct: { protein: 30, carbs: 35, fat: 35 } },
]);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (n) => Math.round(n * 10) / 10;

/** 'percent' or 'grams' (anything else, including missing, is grams). */
export function targetMode(targets) {
  return targets && targets.mode === 'percent' ? 'percent' : 'grams';
}

/** Sum of the three percentages (missing/invalid count as 0), to one decimal. */
export function pctSum(pct) {
  if (!pct) return 0;
  return round1(MACROS.reduce((s, k) => s + (isNum(pct[k]) ? pct[k] : 0), 0));
}

/**
 * Is this a usable split? All three numbers 0–100 and the sum 100 ± SUM_TOLERANCE.
 * @returns {{ok: boolean, sum: number, diff: number}} diff = sum − 100 (negative = still to assign)
 */
export function validateSplit(pct) {
  const sum = pctSum(pct);
  const diff = round1(sum - 100);
  const complete = !!pct && MACROS.every((k) => isNum(pct[k]) && pct[k] >= 0 && pct[k] <= 100);
  return { ok: complete && Math.abs(diff) <= SUM_TOLERANCE + 1e-9, sum, diff };
}

/**
 * Grams of one macro for `pct` % of `kcal`. null when kcal or pct is not a usable number.
 * Not rounded (see gramsFromPct).
 */
export function macroGrams(kcal, pct, macro) {
  if (!isNum(kcal) || kcal < 0 || !isNum(pct) || !(macro in KCAL_PER_GRAM)) return null;
  return (kcal * pct) / 100 / KCAL_PER_GRAM[macro];
}

/**
 * Whole-gram targets for a percentage split of `kcal`. kcal 0 → all 0; missing/invalid kcal or a
 * missing percentage → that macro null (never NaN/Infinity).
 * @param {number} kcal
 * @param {{protein: number, carbs: number, fat: number}} pct
 * @returns {{protein: number|null, carbs: number|null, fat: number|null}}
 */
export function gramsFromPct(kcal, pct) {
  const out = {};
  for (const k of MACROS) {
    const g = macroGrams(kcal, pct ? pct[k] : null, k);
    out[k] = g === null ? null : Math.round(g);
  }
  return out;
}

/**
 * Percentage of the calorie target one macro's grams represent (for display in grams mode).
 * null when kcal is 0/missing or grams invalid.
 */
export function pctOfKcal(kcal, grams, macro) {
  if (!isNum(kcal) || kcal <= 0 || !isNum(grams) || grams < 0 || !(macro in KCAL_PER_GRAM)) return null;
  return (grams * KCAL_PER_GRAM[macro] * 100) / kcal;
}

/**
 * Split implied by gram targets: each macro's share of the macros' total energy, rounded to
 * `decimals` (0 or 1) by largest remainder so the result sums to exactly 100.
 * All zero / invalid grams → null (no split can be derived).
 * @returns {{protein: number, carbs: number, fat: number}|null}
 */
export function pctFromGrams(grams, decimals = 0) {
  if (!grams) return null;
  const kcal = {};
  let total = 0;
  for (const k of MACROS) {
    const g = grams[k];
    kcal[k] = isNum(g) && g > 0 ? g * KCAL_PER_GRAM[k] : 0;
    total += kcal[k];
  }
  if (!(total > 0)) return null;
  const scale = 10 ** (decimals > 0 ? 1 : 0);
  const units = 100 * scale;
  const raw = MACROS.map((k) => ({ k, v: (kcal[k] / total) * units }));
  const out = raw.map((r) => ({ ...r, f: Math.floor(r.v + 1e-9) }));
  let left = units - out.reduce((s, r) => s + r.f, 0);
  const byRemainder = [...out].sort((a, b) => (b.v - b.f) - (a.v - a.f) || MACROS.indexOf(a.k) - MACROS.indexOf(b.k));
  for (const r of byRemainder) { if (left <= 0) break; r.f += 1; left -= 1; }
  return Object.fromEntries(out.map((r) => [r.k, r.f / scale]));
}

/**
 * The carbs percentage that makes the split add up to 100 (protein and fat kept).
 * null if protein + fat are missing or already exceed 100.
 */
export function carbsRest(pct) {
  if (!pct || !isNum(pct.protein) || !isNum(pct.fat)) return null;
  const rest = round1(100 - pct.protein - pct.fat);
  return rest >= 0 ? rest : null;
}

/**
 * Macros to write for a new calorie target (used by the adaptive check-in).
 * Percent mode with a valid split: grams recomputed from the stored percentages.
 * Otherwise null: the caller keeps its own (gram-based) macros.
 * @returns {{protein: number, carbs: number, fat: number}|null}
 */
export function splitMacrosFor(targets, kcal) {
  if (targetMode(targets) !== 'percent' || !validateSplit(targets.pct).ok || !isNum(kcal) || kcal < 0) return null;
  return gramsFromPct(kcal, targets.pct);
}
