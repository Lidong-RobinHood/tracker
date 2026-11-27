// "Estimate a meal" (Quick add): a plate built from hand portions, turned into kcal and macros.
// Pure, no DOM, no t(): the UI names groups, kinds and cooking methods by id (catalogue keys food.estimate.*).
//
// Hand portions: palm = cooked protein food, fist = cooked carbs or vegetables, thumb = added fat
// (oil, butter, creamy sauce). Amounts move in halves within ESTIMATE_MAX.
import { round } from './numbers.js';

/**
 * Values per hand unit, cooked, as eaten. Rounded typical values (our own rounding from USDA generic foods in
 * src/data/generic-foods.json; checked 2026-11-27, every constant within 15 % of its reference):
 * - meat: average of cooked chicken breast / thigh (165 / 179 kcal per 100 g) and ground beef 85–90 % lean (204–232)
 * - fish: average of cooked salmon (Atlantic farmed / wild 206 / 182) and cod (105)
 * - tofu: average of firm tofu (144) and hard-boiled egg (155)
 * - rice: white rice, long-grain, cooked (130 per 100 g)
 * - noodles: pasta cooked (158) and egg noodles cooked (138)
 * - potato: potatoes, boiled (87)
 * - bread: white bread (266)
 * - veg: non-starchy cooked vegetables (broccoli, green beans, carrots, cabbage, cauliflower, spinach, peppers,
 *   mushrooms, zucchini, pak choi: about 26 per 100 g); starchy ones (corn, peas, potato) belong to carbs
 * - thumb: cooking oil (884 per 100 g)
 * `g` is the weight one unit stands for; kcal / protein / carbs / fat are per unit.
 */
export const ESTIMATE_UNITS = Object.freeze({
  meat: Object.freeze({ g: 100, kcal: 200, protein: 27, carbs: 0, fat: 10 }),     // palm, meat / poultry
  fish: Object.freeze({ g: 100, kcal: 140, protein: 24, carbs: 0, fat: 5 }),      // palm, fish / seafood
  tofu: Object.freeze({ g: 100, kcal: 150, protein: 14, carbs: 2, fat: 10 }),     // palm, tofu / egg
  rice: Object.freeze({ g: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.5 }),    // fist
  noodles: Object.freeze({ g: 150, kcal: 210, protein: 7, carbs: 42, fat: 1.5 }), // fist, noodles / pasta
  potato: Object.freeze({ g: 150, kcal: 130, protein: 3, carbs: 30, fat: 0.2 }),  // fist
  bread: Object.freeze({ g: 60, kcal: 160, protein: 5, carbs: 30, fat: 2 }),      // fist
  veg: Object.freeze({ g: 150, kcal: 40, protein: 2.5, carbs: 7, fat: 0.3 }),     // fist, vegetables
  thumb: Object.freeze({ g: 15, kcal: 135, protein: 0, carbs: 0, fat: 15 }),      // thumb, added fat
});

/** Groups in display order (rows of the builder). */
export const ESTIMATE_GROUPS = Object.freeze(['protein', 'carbs', 'veg', 'fat']);
/** Hand unit of each group. */
export const ESTIMATE_GROUP_UNIT = Object.freeze({ protein: 'palm', carbs: 'fist', veg: 'fist', fat: 'thumb' });
/** Kinds of the protein and carbs groups (keys of ESTIMATE_UNITS). */
export const PROTEIN_KINDS = Object.freeze(['meat', 'fish', 'tofu']);
export const CARB_KINDS = Object.freeze(['rice', 'noodles', 'potato', 'bread']);
/** Cooking methods and their added fat: thumbs per palm + carb fist (vegetables do not count). */
export const COOKING_METHODS = Object.freeze(['grilled', 'pan', 'fried', 'creamy']);
export const COOKING_FAT = Object.freeze({ grilled: 0, pan: 0.5, fried: 1, creamy: 0.75 });
/** Highest amount per group, in units. */
export const ESTIMATE_MAX = Object.freeze({ protein: 2, carbs: 3, veg: 3, fat: 4 });
export const ESTIMATE_STEP = 0.5;

/**
 * Stored name of an estimate logged without a name: an English marker, shown translated
 * (src/food/names.js itemName → food.estimate.defaultName). Never store translated text.
 */
export const ESTIMATE_MEAL_NAME = 'Estimated meal'; // i18n-ignore: stored marker

/**
 * A plate. `thumbs` null = follow the cooking method (autoThumbs); a number = set by the user.
 * @typedef {{protein: {kind: string, n: number}, carbs: {kind: string, n: number}, veg: {n: number},
 *            cooking: string, thumbs: number|null}} Plate
 */

/** Default plate: 1 palm meat, 1½ fists rice, 1 fist vegetables, pan-fried (≈ 735 kcal). @returns {Plate} */
export function defaultPlate() {
  return { protein: { kind: 'meat', n: 1 }, carbs: { kind: 'rice', n: 1.5 }, veg: { n: 1 }, cooking: 'pan', thumbs: null };
}

/** Nearest half, clamped to 0 … max. Non-numbers → 0. */
export function toHalves(n, max) {
  const x = Number.isFinite(n) ? Math.round(n * 2) / 2 : 0;
  return Math.min(max, Math.max(0, x));
}

/** Thumbs of added fat the cooking method suggests: factor × (palms + carb fists), to halves, within range. */
export function autoThumbs(plate) {
  const f = COOKING_FAT[plate.cooking] ?? 0;
  return toHalves(f * (plate.protein.n + plate.carbs.n), ESTIMATE_MAX.fat);
}

/** Thumbs in effect: the user's value once they touched the stepper, else the cooking method's. */
export function thumbs(plate) {
  return plate.thumbs === null || plate.thumbs === undefined ? autoThumbs(plate) : plate.thumbs;
}

/** Units of a group. @param {Plate} plate @param {string} group */
export function amountOf(plate, group) {
  return group === 'fat' ? thumbs(plate) : plate[group].n;
}

/**
 * New plate with a group's amount set (clamped to halves within range). Setting fat pins the thumbs
 * (the cooking method no longer changes them, until the method itself is changed).
 * @param {Plate} plate @param {string} group @param {number} n
 * @returns {Plate}
 */
export function setAmount(plate, group, n) {
  if (!ESTIMATE_GROUPS.includes(group)) return plate;
  const v = toHalves(n, ESTIMATE_MAX[group]);
  if (group === 'fat') return { ...plate, thumbs: v };
  return { ...plate, [group]: { ...plate[group], n: v } };
}

/** New plate one step up (+1) or down (−1) in a group. */
export function step(plate, group, dir) {
  return setAmount(plate, group, amountOf(plate, group) + (dir < 0 ? -ESTIMATE_STEP : ESTIMATE_STEP));
}

/** New plate with the protein or carbs kind changed (unknown kinds ignored). */
export function setKind(plate, group, kind) {
  const kinds = group === 'protein' ? PROTEIN_KINDS : group === 'carbs' ? CARB_KINDS : null;
  if (!kinds || !kinds.includes(kind)) return plate;
  return { ...plate, [group]: { ...plate[group], kind } };
}

/** New plate with the cooking method changed: the thumbs follow the method again. */
export function setCooking(plate, cooking) {
  if (!COOKING_METHODS.includes(cooking)) return plate;
  return { ...plate, cooking, thumbs: null };
}

/** [unit values, units] of each group. */
function parts(plate) {
  return [
    [ESTIMATE_UNITS[plate.protein.kind], plate.protein.n],
    [ESTIMATE_UNITS[plate.carbs.kind], plate.carbs.n],
    [ESTIMATE_UNITS.veg, plate.veg.n],
    [ESTIMATE_UNITS.thumb, thumbs(plate)],
  ];
}

/** Weight a group stands for, in g (rounded to whole grams). */
export function groupGrams(plate, group) {
  const i = ESTIMATE_GROUPS.indexOf(group);
  if (i < 0) return 0;
  const [u, n] = parts(plate)[i];
  return Math.round(u.g * n);
}

/**
 * Totals of the plate: kcal whole, macros to 0.1 g (what is shown and what is logged).
 * @param {Plate} plate
 * @returns {{kcal: number, protein: number, carbs: number, fat: number}}
 */
export function plateTotals(plate) {
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const [u, n] of parts(plate)) for (const k of Object.keys(sum)) sum[k] += u[k] * n;
  // snap float noise (33.55 summed as 33.549999…) before rounding half away from zero
  const snap = (x, d) => round(Number(x.toPrecision(12)), d);
  return { kcal: snap(sum.kcal, 0), protein: snap(sum.protein, 1), carbs: snap(sum.carbs, 1), fat: snap(sum.fat, 1) };
}

/** Name to store: what the user typed, else the language-neutral marker. */
export function estimateName(typed) {
  return String(typed ?? '').trim() || ESTIMATE_MEAL_NAME;
}

/** '0', '½', '1', '1½' … for a number of halves (language-neutral). */
export function halvesText(n) {
  const whole = Math.floor(n + 1e-9);
  const half = n - whole >= 0.5 - 1e-9;
  if (!half) return String(whole);
  return whole === 0 ? '½' : `${whole}½`;
}
