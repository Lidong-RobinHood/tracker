// Food diary logic: entry snapshots, totals per meal/day, targets, saved meals, food library updates.
// Pure, no DOM / IndexedDB. ids and timestamps are passed in so everything is deterministic in tests.
import { NUTRIENTS, REQUIRED_NUTRIENTS, sumEntries, emptyPer100 } from './nutrition.js';

// Meals in display order; the UI shows t(labelKey) (src/food/names.js mealName).
export const MEALS = Object.freeze([
  { id: 'breakfast', labelKey: 'food.meal.breakfast' },
  { id: 'lunch', labelKey: 'food.meal.lunch' },
  { id: 'dinner', labelKey: 'food.meal.dinner' },
  { id: 'snack', labelKey: 'food.meal.snack' },
]);
export const MEAL_IDS = Object.freeze(MEALS.map((m) => m.id));

/** @param {string} id */
export const isMeal = (id) => MEAL_IDS.includes(id);
/**
 * Suggest a meal for the current time of day (used when no meal is given).
 * @param {Date} [now]
 */
export function mealForTime(now = new Date()) {
  const h = now.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h >= 17 && h < 22) return 'dinner';
  return 'snack';
}

/** Copy of a per100 object with exactly the known nutrient keys. */
export function copyPer100(per100) {
  const out = emptyPer100();
  for (const k of NUTRIENTS) {
    const v = per100 ? per100[k] : null;
    out[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/**
 * Diary entry snapshotting the food's current values.
 * @param {{id: string, date: string, meal: string, food: object, amount: number, now: number}} a
 */
export function makeEntry({ id, date, meal, food, amount, now }) {
  return {
    id, date, meal,
    foodId: food.id ?? null,
    name: String(food.name || '').trim(),
    brand: food.brand || null,
    amount,
    basis: food.basis === 'ml' ? 'ml' : 'g',
    per100: copyPer100(food.per100),
    createdAt: now, updatedAt: now,
  };
}

/**
 * Stored names of entries / saved meals created without a name. They are data markers (kept in English in
 * records and backups); the UI shows them translated (src/food/names.js).
 */
export const QUICK_ADD_NAME = 'Quick add'; // i18n-ignore (stored marker, translated at display time)
export const DEFAULT_MEAL_NAME = 'Meal'; // i18n-ignore (stored marker, translated at display time)

/**
 * Quick add: calories/macros without a food. Stored as amount 100 with per100 = the totals.
 * @param {{id: string, date: string, meal: string, name?: string, kcal: number, protein?: number|null,
 *          carbs?: number|null, fat?: number|null, now: number}} a
 */
export function quickAddEntry({ id, date, meal, name, kcal, protein = null, carbs = null, fat = null, now }) {
  const per100 = emptyPer100();
  per100.kcal = kcal;
  per100.protein = protein ?? 0;
  per100.carbs = carbs ?? 0;
  per100.fat = fat ?? 0;
  return {
    id, date, meal, foodId: null,
    name: String(name || '').trim() || QUICK_ADD_NAME,
    brand: null, amount: 100, basis: 'g', per100,
    createdAt: now, updatedAt: now,
  };
}

/** @returns {boolean} true for quick-add entries (no food behind them) */
export const isQuickAdd = (entry) => entry.foodId === null || entry.foodId === undefined;

/**
 * Entries grouped by meal, each list in logging order.
 * @param {object[]} entries
 * @returns {Record<string, object[]>}
 */
export function groupByMeal(entries) {
  const out = Object.fromEntries(MEAL_IDS.map((m) => [m, []]));
  for (const e of entries || []) (out[isMeal(e.meal) ? e.meal : 'snack']).push(e);
  for (const m of MEAL_IDS) out[m].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}

/** Totals for a list of entries (see nutrition.sumEntries). */
export const totals = (entries) => sumEntries(entries);

/**
 * Consumed vs target for kcal/protein/carbs/fat.
 * @param {Record<string, number|null>} consumed
 * @param {{kcal: number, protein: number, carbs: number, fat: number}} targets
 * @returns {Array<{key: string, consumed: number, target: number|null, remaining: number|null, fraction: number}>}
 */
export function progress(consumed, targets) {
  return REQUIRED_NUTRIENTS.map((key) => {
    const c = consumed[key] ?? 0;
    const t = targets && Number.isFinite(targets[key]) && targets[key] > 0 ? targets[key] : null;
    return { key, consumed: c, target: t, remaining: t === null ? null : t - c, fraction: t === null ? 0 : c / t };
  });
}

/**
 * Copy entries to another day (and optionally another meal). New ids, same snapshot values.
 * @param {object[]} entries
 * @param {{date: string, meal?: string, now: number, newId: () => string}} opts
 */
export function copyEntries(entries, { date, meal, now, newId }) {
  return entries.map((e, i) => ({
    ...e, per100: copyPer100(e.per100), id: newId(), date, meal: meal || e.meal,
    createdAt: now + i, updatedAt: now + i,
  }));
}

/**
 * Saved meal from diary entries (quick-add entries are kept with foodId null).
 * @param {{id: string, name: string, entries: object[], now: number}} a
 */
export function mealFromEntries({ id, name, entries, now }) {
  return {
    id, name: String(name || '').trim() || DEFAULT_MEAL_NAME,
    items: entries.map((e) => ({
      foodId: e.foodId ?? null, name: e.name, brand: e.brand ?? null,
      amount: e.amount, basis: e.basis, per100: copyPer100(e.per100),
    })),
    createdAt: now, updatedAt: now,
  };
}

/**
 * Diary entries for logging a saved meal. `amounts[i]` overrides item i's amount; null/0 skips the item.
 * @param {object} meal saved meal
 * @param {{date: string, meal: string, amounts?: Array<number|null>, now: number, newId: () => string}} opts
 */
export function entriesFromMeal(meal, { date, meal: mealId, amounts, now, newId }) {
  const out = [];
  meal.items.forEach((item, i) => {
    const amount = amounts ? amounts[i] : item.amount;
    if (!Number.isFinite(amount) || amount <= 0) return;
    out.push({
      id: newId(), date, meal: mealId, foodId: item.foodId ?? null, name: item.name, brand: item.brand ?? null,
      amount, basis: item.basis === 'ml' ? 'ml' : 'g', per100: copyPer100(item.per100),
      createdAt: now + out.length, updatedAt: now + out.length,
    });
  });
  return out;
}

/**
 * Food record after logging it: usage counters and default amount updated.
 * @param {object} food @param {number} amount @param {number} now
 */
export function touchFood(food, amount, now) {
  return { ...food, useCount: (food.useCount || 0) + 1, lastUsedAt: now, lastAmount: amount, updatedAt: now };
}

/**
 * A complete, storable food record from a food-shaped object (fills ids, counters, timestamps).
 * Existing fields win; `existing` (the stored record with the same sourceKey) keeps its id and counters.
 * @param {object} food
 * @param {{id: string, now: number, existing?: object|null}} opts
 */
export function toFoodRecord(food, { id, now, existing = null }) {
  const recId = existing ? existing.id : (food.id || id);
  const source = food.source || 'custom';
  return {
    id: recId,
    source,
    sourceKey: food.sourceKey || (existing && existing.sourceKey) || `custom:${recId}`,
    barcode: food.barcode || null,
    name: String(food.name || '').trim(),
    brand: food.brand ? String(food.brand).trim() || null : null,
    basis: food.basis === 'ml' ? 'ml' : 'g',
    per100: copyPer100(food.per100),
    servings: Array.isArray(food.servings) ? food.servings.map((s) => ({ label: String(s.label), amount: Number(s.amount) })) : [],
    userEdited: Boolean(food.userEdited || (existing && existing.userEdited)),
    lastAmount: food.lastAmount ?? (existing ? existing.lastAmount : null) ?? null,
    useCount: existing ? existing.useCount || 0 : food.useCount || 0,
    lastUsedAt: existing ? existing.lastUsedAt ?? null : food.lastUsedAt ?? null,
    createdAt: existing ? existing.createdAt : food.createdAt || now,
    updatedAt: now,
  };
}

/**
 * Pick the stored food to use for a barcode: user-edited first, then most recently updated.
 * @param {object[]} candidates foods with that barcode
 */
export function pickByBarcode(candidates) {
  if (!candidates || !candidates.length) return null;
  return [...candidates].sort((a, b) => Number(b.userEdited) - Number(a.userEdited) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

/**
 * Recently or frequently used foods.
 * @param {object[]} foods @param {{by?: 'recent'|'frequent', limit?: number}} [opts]
 */
export function usedFoods(foods, { by = 'recent', limit = 50 } = {}) {
  const used = foods.filter((f) => f.lastUsedAt);
  used.sort(by === 'frequent'
    ? (a, b) => (b.useCount || 0) - (a.useCount || 0) || b.lastUsedAt - a.lastUsedAt
    : (a, b) => b.lastUsedAt - a.lastUsedAt);
  return used.slice(0, limit);
}
