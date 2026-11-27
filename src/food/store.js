// Food feature data access. Views call these; they go through src/db/db.js only.
import * as db from '../db/db.js';
import { toFoodRecord, touchFood, makeEntry, pickByBarcode, copyPer100 } from '../core/food-diary.js';

const uuid = () => crypto.randomUUID();

/** Stored food with this barcode (user-edited wins), or null. */
export async function findByBarcode(code) {
  return pickByBarcode(await db.byIndex('foods', 'barcode', code));
}

/** Stored food with this sourceKey ('off:…', 'usda:…'), or null. */
export async function findBySourceKey(key) {
  if (!key) return null;
  const r = await db.byIndex('foods', 'sourceKey', key);
  return r[0] || null;
}

/** If the user already has this food stored (maybe corrected), use that instead of the API/dataset copy. */
export async function preferStored(food) {
  if (food.id) return food;
  const stored = await findBySourceKey(food.sourceKey);
  return stored || food;
}

/**
 * Store (insert or update) a food. Matches an existing record by id or sourceKey.
 * @param {object} food @param {{userEdited?: boolean}} [opts]
 * @returns {Promise<object>} the stored record
 */
export async function saveFood(food, { userEdited } = {}) {
  const now = Date.now();
  return db.transaction(['foods'], 'readwrite', async (t) => {
    let existing = food.id ? await t.get('foods', food.id) : null;
    if (!existing && food.sourceKey) existing = (await t.byIndex('foods', 'sourceKey', food.sourceKey))[0] || null;
    const rec = toFoodRecord({ ...food, ...(userEdited === undefined ? {} : { userEdited }) }, { id: uuid(), now, existing });
    if (userEdited) rec.userEdited = true;
    await t.put('foods', rec);
    return rec;
  });
}

/**
 * Log a food: store/refresh it in the library, update usage, add a diary snapshot. One transaction.
 * @returns {Promise<{food: object, entry: object}>}
 */
export async function logFood(food, { date, meal, amount }) {
  const now = Date.now();
  return db.transaction(['foods', 'diary'], 'readwrite', async (t) => {
    let existing = food.id ? await t.get('foods', food.id) : null;
    if (!existing && food.sourceKey) existing = (await t.byIndex('foods', 'sourceKey', food.sourceKey))[0] || null;
    // Never overwrite user-corrected values with API/dataset data. The language a generic food was found in
    // (search result's nameLang, null = the app language) applies either way: the most recent add sets it.
    const kept = existing && existing.userEdited && !food.userEdited ? existing : food;
    const base = kept !== food && Object.prototype.hasOwnProperty.call(food, 'nameLang') ? { ...kept, nameLang: food.nameLang } : kept;
    const rec = touchFood(toFoodRecord(base, { id: uuid(), now, existing }), amount, now);
    t.put('foods', rec);
    const entry = makeEntry({ id: uuid(), date, meal, food: rec, amount, now });
    t.put('diary', entry);
    return { food: rec, entry };
  });
}

/** Update usage counters for foods logged via a saved meal. */
export async function touchFoods(items) {
  const now = Date.now();
  await db.transaction(['foods'], 'readwrite', async (t) => {
    for (const it of items) {
      if (!it.foodId) continue;
      const f = await t.get('foods', it.foodId);
      if (f) t.put('foods', touchFood(f, it.amount, now));
    }
  });
}

export const dayEntries = (date) => db.byIndex('diary', 'date', date);
export const putEntry = (e) => db.put('diary', { ...e, updatedAt: Date.now() });
export const putEntries = (list) => db.putMany('diary', list);
export const removeEntry = (id) => db.remove('diary', id);

export async function removeEntries(ids) {
  await db.transaction(['diary'], 'readwrite', async (t) => { for (const id of ids) t.delete('diary', id); });
}

export const allFoods = () => db.getAll('foods');
export const getFood = (id) => db.get('foods', id);
export const allMeals = async () => (await db.getAll('meals')).sort((a, b) => a.name.localeCompare(b.name));
export const putMeal = (m) => db.put('meals', { ...m, updatedAt: Date.now() });
export const removeMeal = (id) => db.remove('meals', id);
export const getTargets = () => db.getSetting('targets');

/** Also apply an entry's edited values to its stored food (from the entry editor's checkbox). */
export async function updateFoodFromEntry(entry) {
  if (!entry.foodId) return null;
  const f = await getFood(entry.foodId);
  if (!f) return null;
  return saveFood({ ...f, name: entry.name, brand: entry.brand, basis: entry.basis, per100: copyPer100(entry.per100) }, { userEdited: true });
}

/**
 * Log reviewed photo items to one meal in one transaction.
 * Items with `remember: true` are stored in the library as `source: 'custom'` foods (and the entry links to them);
 * the others become diary snapshots only (foodId null), so the library is not filled with AI guesses.
 * @param {Array<{name: string, amount: number, basis: 'g'|'ml', per100: object, remember?: boolean}>} items
 * @param {{date: string, meal: string}} where
 * @returns {Promise<object[]>} the diary entries
 */
export async function logPhotoItems(items, { date, meal }) {
  const now = Date.now();
  return db.transaction(['foods', 'diary'], 'readwrite', async (t) => {
    const entries = [];
    items.forEach((it, i) => {
      const at = now + i; // keeps the review order in the diary
      let food = { id: null, name: it.name, brand: null, basis: it.basis, per100: it.per100 };
      if (it.remember) {
        const id = uuid();
        food = touchFood(toFoodRecord({ source: 'custom', name: it.name, brand: null, basis: it.basis, per100: it.per100, servings: [] }, { id, now: at }), it.amount, at);
        t.put('foods', food);
      }
      const entry = makeEntry({ id: uuid(), date, meal, food, amount: it.amount, now: at });
      t.put('diary', entry);
      entries.push(entry);
    });
    return entries;
  });
}
