// Nutrition maths on per-100 values. Pure, no DOM.
// per100 shape: { kcal, protein, carbs, fat, sugars, satFat, fibre, salt } (numbers or null)

export const REQUIRED_NUTRIENTS = Object.freeze(['kcal', 'protein', 'carbs', 'fat']);
export const OPTIONAL_NUTRIENTS = Object.freeze(['sugars', 'satFat', 'fibre', 'salt']);
export const NUTRIENTS = Object.freeze([...REQUIRED_NUTRIENTS, ...OPTIONAL_NUTRIENTS]);

export const KJ_PER_KCAL = 4.184;

/** @param {number} kj @returns {number} kcal */
export function kjToKcal(kj) {
  return kj / KJ_PER_KCAL;
}

/** Energy implied by macros (Atwater 4/4/9). @param {{protein?: number, carbs?: number, fat?: number}} m */
export function macroKcal({ protein = 0, carbs = 0, fat = 0 } = {}) {
  return (protein || 0) * 4 + (carbs || 0) * 4 + (fat || 0) * 9;
}

/** @returns {Record<string, number|null>} per100 with every nutrient null */
export function emptyPer100() {
  return Object.fromEntries(NUTRIENTS.map((k) => [k, null]));
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Values for `amount` g/ml of a food given per 100 g/ml. Missing (null) values stay null.
 * @param {Record<string, number|null>} per100
 * @param {number} amount
 */
export function scale(per100, amount) {
  const out = {};
  for (const k of NUTRIENTS) {
    const v = per100 ? per100[k] : null;
    out[k] = isNum(v) && isNum(amount) ? (v * amount) / 100 : null;
  }
  return out;
}

/**
 * Totals over entries shaped like diary records ({ per100, amount }).
 * Required nutrients: null counts as 0, result is always a number.
 * Optional nutrients: sum of known values, or null if no entry has a value.
 * @param {Array<{per100: Record<string, number|null>, amount: number}>} entries
 */
export function sumEntries(entries) {
  const out = {};
  for (const k of NUTRIENTS) out[k] = REQUIRED_NUTRIENTS.includes(k) ? 0 : null;
  for (const e of entries || []) {
    const s = scale(e.per100, e.amount);
    for (const k of NUTRIENTS) {
      if (s[k] === null) continue;
      out[k] = (out[k] ?? 0) + s[k];
    }
  }
  return out;
}

/**
 * Which of name + kcal/protein/carbs/fat are missing. A food needs all of them to be logged.
 * @param {{name?: string, per100?: Record<string, number|null>}} food
 * @returns {string[]} e.g. ['name', 'protein']
 */
export function missingFields(food) {
  const missing = [];
  if (!food || !String(food.name ?? '').trim()) missing.push('name');
  for (const k of REQUIRED_NUTRIENTS) {
    const v = food && food.per100 ? food.per100[k] : null;
    if (!isNum(v) || v < 0) missing.push(k);
  }
  return missing;
}

/** @returns {boolean} true if the food can be logged */
export function isComplete(food) {
  return missingFields(food).length === 0;
}
