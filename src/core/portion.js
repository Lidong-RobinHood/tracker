// Portions and serving sizes. Pure, no DOM.
import { parseDecimal, round } from './numbers.js';
import { validSizes } from './dishes.js';

/** Label of the serving chip for a whole pack (never used as the default amount). Stored in food records. */
export const PACK_LABEL = 'Whole pack'; // i18n-ignore (stored marker, translated at display time)
/** Label of a serving without a name of its own. Stored in food records. */
export const SERVING_LABEL = 'Serving'; // i18n-ignore (stored marker, translated at display time)
/** Label of one unit of a multipack ('1 of 6'). Stored in food records; matched by MULTIPACK_RE for display. */
export const multipackLabel = (count) => `1 of ${count}`; // i18n-ignore (stored marker, translated at display time)
export const MULTIPACK_RE = /^1 of (\d+)$/;

/** Units we understand in serving/quantity text, converted to g or ml. */
const UNITS = {
  g: ['g', 1], gr: ['g', 1], gram: ['g', 1], grams: ['g', 1], gramm: ['g', 1], kg: ['g', 1000], mg: ['g', 0.001],
  ml: ['ml', 1], cl: ['ml', 10], dl: ['ml', 100], l: ['ml', 1000], lt: ['ml', 1000], liter: ['ml', 1000], litre: ['ml', 1000],
  oz: ['g', 28.3495],
};
// A number, optionally with thousands groups ("1.234,5", "1,234.5").
const NUM = String.raw`(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)`;
const UNIT_RE = new RegExp(String.raw`${NUM}\s*(kg|mg|gr|grams?|gramm|g|ml|cl|dl|l|lt|lit(?:er|re)|oz)\b`, 'gi');
const MULTI_RE = /(\d{1,2})\s*[x×*]\s*$/i; // "6 x " right before an amount: a multipack

/**
 * Number text of an amount. Both marks: the last one is the decimal mark ("1.234,5", "1,234.5").
 * One mark followed by exactly three digits ("1.500", "1,500"): thousands for the small units g / ml
 * / mg (milligram precision is implausible on a label), a decimal mark for kg, l, cl, dl and oz
 * ("1,250 kg" = 1.25 kg). Otherwise ',' or '.' is the decimal mark.
 */
function amountNumber(text, unit) {
  const s = String(text);
  const lc = s.lastIndexOf(','); const ld = s.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) {
    const at = Math.max(lc, ld);
    const int = s.slice(0, at);
    if (int.includes(s[at]) || !/^\d{1,3}([.,]\d{3})+$/.test(int)) return null;
    return Number(`${int.replace(/[.,]/g, '')}.${s.slice(at + 1)}`);
  }
  if ((s.match(/[.,]/g) || []).length > 1) return /^\d{1,3}([.,]\d{3})+$/.test(s) ? Number(s.replace(/[.,]/g, '')) : null;
  if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(s) && ['g', 'gr', 'gram', 'grams', 'gramm', 'ml', 'mg'].includes(unit)) return Number(s.replace(/[.,]/, ''));
  return parseDecimal(s);
}

/**
 * Find a metric amount in free text like "30 g", "1 slice (30 g)", "250ml", "1 cup (240 mL)", "0,5 l",
 * "1.234,5 g" (see amountNumber for thousands groups).
 * A value in parentheses wins (it is usually the metric equivalent of a household measure).
 * A multipack written as "6 x 330 ml" (and no value in parentheses) gives the total (1980 ml) plus
 * count and each (the single unit, 330 ml).
 * @param {string|null|undefined} text
 * @returns {{amount: number, unit: 'g'|'ml', count?: number, each?: number} | null}
 */
export function parseAmountText(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;
  const matches = [...s.matchAll(UNIT_RE)];
  if (!matches.length) return null;
  const inParens = matches.find((m) => {
    const before = s.slice(0, m.index);
    return before.lastIndexOf('(') > before.lastIndexOf(')');
  });
  const m = inParens || matches[0];
  const u = m[2].toLowerCase();
  const n = amountNumber(m[1], u);
  const def = UNITS[u];
  if (n === null || !Number.isFinite(n) || !def || n <= 0) return null;
  const each = round(n * def[1], 1);
  const multi = inParens ? null : MULTI_RE.exec(s.slice(0, m.index));
  const count = multi ? Number(multi[1]) : 1;
  if (count > 1) return { amount: round(each * count, 1), unit: /** @type {'g'|'ml'} */ (def[0]), count, each };
  return { amount: each, unit: /** @type {'g'|'ml'} */ (def[0]) };
}

/**
 * Turn an Open Food Facts style serving text into a serving chip, e.g.
 * "1 portion (15 g)" -> {label: '1 portion', amount: 15}; "30 g" -> {label: 'Serving', amount: 30}.
 * @param {string|null|undefined} text
 * @param {number|null} [quantity] numeric serving quantity if the source gives one (g/ml)
 * @returns {{label: string, amount: number} | null}
 */
export function servingFromText(text, quantity = null) {
  const parsed = parseAmountText(text);
  const amount = parsed ? parsed.amount : (Number.isFinite(quantity) && quantity > 0 ? round(quantity, 1) : null);
  if (amount === null) return null;
  let label = String(text ?? '').replace(/\([^)]*\)/g, '').replace(UNIT_RE, '').replace(/\s+/g, ' ').trim();
  label = label.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, '');
  if (!label || /^\d+([.,]\d+)?$/.test(label)) label = SERVING_LABEL;
  if (label.length > 28) label = `${label.slice(0, 27).trim()}…`;
  return { label, amount };
}

/**
 * Remove duplicates (same amount) and nonsense from a serving list. Keeps order.
 * @param {Array<{label: string, amount: number}>} servings
 */
export function cleanServings(servings) {
  const out = [];
  const seen = new Set();
  for (const s of servings || []) {
    if (!s || !Number.isFinite(s.amount) || s.amount <= 0) continue;
    const key = round(s.amount, 1);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: String(s.label || SERVING_LABEL).trim() || SERVING_LABEL, amount: key });
  }
  return out;
}

/**
 * Default amount on the portion screen: last logged amount, else a dish's normal portion, else first serving (not
 * the whole pack), else 100.
 * @param {{lastAmount?: number|null, sizes?: number[], servings?: Array<{amount: number}>}} food
 */
export function defaultAmount(food) {
  if (food && Number.isFinite(food.lastAmount) && food.lastAmount > 0) return food.lastAmount;
  const sizes = food && validSizes(food.sizes);
  if (sizes) return sizes[1]; // a dish: its normal portion
  const s = food && food.servings && food.servings.find((x) => Number.isFinite(x.amount) && x.amount > 0 && x.label !== PACK_LABEL);
  if (s) return s.amount;
  return 100;
}

/**
 * Multiply an amount for the ×½ / ×2 chips, rounded sensibly (whole numbers above 10).
 * @param {number} amount @param {number} factor
 */
export function multiplyAmount(amount, factor) {
  const n = amount * factor;
  return n >= 10 ? Math.round(n) : round(n, 1);
}

/** 'g' or 'ml' from a pack quantity such as "1 l", "330 ml", "500 g". Defaults to 'g'. */
export function basisFromQuantity(text) {
  const p = parseAmountText(text);
  return p ? p.unit : 'g';
}
