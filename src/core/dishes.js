// Own dish estimates (src/data/dishes.json, see src/data/dishes.README.md): decoding, search names, display
// names and the stored-food fields of a logged dish. Pure, no DOM / fetch.
//
// A logged dish is stored like a generic food, language-neutral: `source: 'dish'`, `sourceKey: 'dish:<id>'`, the
// canonical English name, per-100 g values and its three portion sizes (`sizes: [small, normal, large]` in g), so
// the sizes stay available from Recent, saved meals and Your foods, also when the dish later leaves dishes.json.
// The shown name comes from dishes.json by id in the app language (or the food's `nameLang`, "show the name as I
// typed it"); a renamed food (its name is no longer the dish's English name) shows its own name; a dish no
// longer in the file shows the stored English name.
import { emptyPer100 } from './nutrition.js';
import { langNames, nameRank } from './food-search.js';

/** `source` of a stored dish (an own estimate). */
export const DISH_SOURCE = 'dish';
/** sourceKey prefix of a dish: 'dish:<id>' (ids are stable forever, dishes.README.md). */
const PREFIX = 'dish:';

/** 'dish:<id>' @param {string} id */
export const dishKey = (id) => `${PREFIX}${id}`;

/** Dish id of a food (search item or stored record), or null when it is not a dish. */
export function dishIdOf(food) {
  if (!food || food.source !== DISH_SOURCE || typeof food.sourceKey !== 'string' || !food.sourceKey.startsWith(PREFIX)) return null;
  return food.sourceKey.slice(PREFIX.length) || null;
}

/** Labels of the three sizes, index = position in `sizes` (catalogue keys food.dish.<label>). */
export const SIZE_LABELS = Object.freeze(['small', 'normal', 'large']);

/**
 * The three portion sizes (grams, ascending) when valid, else null. Accepts the stored field and dishes.json's
 * `portions` column.
 * @param {any} v @returns {number[]|null}
 */
export function validSizes(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((g) => typeof g === 'number' && Number.isFinite(g) && g > 0 && g <= 5000)) return null;
  if (!(v[0] <= v[1] && v[1] <= v[2])) return null;
  return v.slice();
}

/**
 * True when a food's values are the app's own estimate (an unedited dish): shown with '≈'. A dish whose values
 * the user edited carries the user's numbers (and the "Edited" badge) instead.
 * @param {object|null|undefined} food
 */
export const isEstimateFood = (food) => Boolean(food && food.source === DISH_SOURCE && !food.userEdited);

/**
 * kcal of `amount` g of a dish's own estimate (rounded), e.g. its last logged amount in Recent; null when the food
 * is not an unedited dish, has no kcal or the amount is not a positive number.
 * @param {object|null|undefined} food @param {number|null|undefined} amount
 */
export function dishKcalFor(food, amount) {
  if (!isEstimateFood(food) || !Number.isFinite(amount) || amount <= 0) return null;
  const k = food.per100 ? food.per100.kcal : null;
  return typeof k === 'number' && Number.isFinite(k) ? Math.round((k * amount) / 100) : null;
}

/** kcal of a dish's normal portion (rounded), or null without sizes / kcal. @param {object} food */
export function normalKcal(food) {
  const s = validSizes(food && food.sizes);
  const k = food && food.per100 ? food.per100.kcal : null;
  return s && typeof k === 'number' ? Math.round((k * s[1]) / 100) : null;
}

/**
 * Decode src/data/dishes.json (tools/build-dishes.mjs) into food-shaped search items: source 'dish', the English
 * name, per-100 g values, `sizes`, and the dish's data under `dish` ({ id, kitchen, names, aliases }; not stored:
 * toFoodRecord keeps only food fields). Rows with an unexpected shape are skipped.
 * @param {{fields: string[], dishes: any[][]}} doc
 * @returns {Array<object>}
 */
export function decodeDishes(doc) {
  const f = doc && Array.isArray(doc.fields) ? doc.fields : [];
  const at = (k) => f.indexOf(k);
  if (at('id') < 0 || at('names') < 0) throw new Error('Dishes file has an unexpected format'); // i18n-ignore (console diagnostic)
  const out = [];
  for (const row of Array.isArray(doc.dishes) ? doc.dishes : []) {
    const id = row[at('id')];
    const names = row[at('names')];
    if (typeof id !== 'string' || !id || !names || typeof names.en !== 'string' || !names.en) continue;
    const per100 = emptyPer100();
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt']) {
      const v = at(k) >= 0 ? row[at(k)] : null;
      per100[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    const aliases = at('aliases') >= 0 && row[at('aliases')] && typeof row[at('aliases')] === 'object' ? row[at('aliases')] : {};
    out.push({
      source: DISH_SOURCE,
      sourceKey: dishKey(id),
      barcode: null,
      name: names.en,
      brand: null,
      basis: 'g',
      per100,
      servings: [],
      sizes: validSizes(at('portions') >= 0 ? row[at('portions')] : null),
      userEdited: false,
      lastAmount: null,
      dish: { id, kitchen: at('kitchen') >= 0 ? row[at('kitchen')] : null, names: { en: names.en, de: names.de || null, zh: names.zh || null }, aliases },
    });
  }
  return out;
}

/**
 * Everyday classics among the dishes (id → tier, as in generic-foods-common.json: 1 = staple, 2 = common), so a
 * plain query finds the plain dish first ("pizza" → Margherita, "schnitzel" → the schnitzel itself, "döner" →
 * the Döner, not a plate or box). Same TIER_BONUS as generic foods (core/food-search.js); it never lifts a
 * clearly worse textual match or another language's match above the app language's.
 */
export const DISH_TIERS = Object.freeze({
  'pizza-margherita': 1, 'pizza-salami': 2, 'doner-kebab': 1, 'schnitzel': 1, 'currywurst': 1, 'shuijiao': 1,
  'dan-chaofan': 1, 'laugenbrezel': 1, 'gyros-pita': 2, 'hamburger-fries': 2, 'spaghetti-bolognese': 2,
  'lanzhou-niuroumian': 2, 'hongshaorou': 2, 'gongbao-jiding': 1,
});

/**
 * indexItem() arguments of a decoded dish for app language `lang`: the names (app language's first, then English,
 * German, Chinese, ranked and tagged as for generic foods, see langNames) and the aliases of every language, ranked
 * by nameRank and tagged with their language when it is not the app language, and its tier (DISH_TIERS). Same
 * ranking rules as generic foods.
 * @param {{dish: {id: string, names: {en: string, de?: string|null, zh?: string|null}, aliases?: Record<string, string[]>}}} item
 * @param {string} lang
 * @returns {[Array<{text: string, rank: number, lang: string|null}>, {aliases: Array<{text: string, rank: number, lang: string|null}>, tier?: number}]}
 */
export function dishSearchNames(item, lang) {
  const { id, names, aliases = {} } = item.dish;
  const al = [];
  for (const l of ['en', 'de', 'zh']) {
    for (const text of Array.isArray(aliases[l]) ? aliases[l] : []) {
      if (typeof text === 'string' && text.trim()) al.push({ text, rank: nameRank(l, lang), lang: l === lang ? null : l });
    }
  }
  const tier = Object.prototype.hasOwnProperty.call(DISH_TIERS, id) ? DISH_TIERS[id] : undefined;
  return [langNames(lang, names), tier ? { aliases: al, tier } : { aliases: al }];
}

/** Map dish id → dish data ({ names, … }) of decoded dishes. @param {Array<{dish: {id: string}}>} items */
export const dishesById = (items) => new Map((items || []).map((d) => [d.dish.id, d.dish]));

/**
 * Shown name of a dish (search item or stored food) in language `lang` (the app language, or the food's nameLang:
 * pass shownNameLang(food, app)), or null: not a dish, the dish is not (or no longer) in dishes.json, or the food
 * was renamed (its name is not the dish's English name: the user's name wins).
 * @param {object|null|undefined} food @param {Map<string, {names: object}>|null|undefined} byId @param {string} lang
 */
export function localDishName(food, byId, lang) {
  const id = dishIdOf(food);
  if (!id || !byId) return null;
  const d = byId.get(id);
  if (!d || !d.names || food.name !== d.names.en) return null;
  return d.names[lang] || d.names.en;
}

/**
 * Shown name of a diary entry or saved-meal item of a dish (see localDishName), or null. Only while the snapshot
 * still carries the dish's English name: a name changed in the entry editor wins.
 * @param {{name?: string, foodId?: string|null}} item @param {object|null|undefined} food the stored food of item.foodId
 * @param {Map<string, {names: object}>|null|undefined} byId @param {string} lang
 */
export function localDishItemName(item, food, byId, lang) {
  if (!item || !food || !item.foodId || item.foodId !== food.id) return null;
  return localDishName({ source: food.source, sourceKey: food.sourceKey, name: item.name }, byId, lang);
}
