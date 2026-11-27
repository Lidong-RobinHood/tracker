// Own dish estimates (src/data/dishes.json, core/dishes.js), loaded lazily and kept in memory: on the first search
// (together with the generic foods) and when a logged dish is on screen (ensureDishNames, called by
// ensureDisplayNames), never at app start. A missing or broken file is skipped with a console warning: search
// then shows no dishes and logged dishes show their stored English name.
import { decodeDishes, dishesById, dishSearchNames, localDishName, localDishItemName, dishIdOf, DISH_SOURCE } from '../core/dishes.js';
import { indexItem, searchMatches } from '../core/food-search.js';
import { shownNameLang, withNameLang } from '../core/food-names.js';
import { getLanguage } from '../i18n/index.js';

let loading = null;
/** @type {Map<string, {id: string, names: object, aliases: object}>|null} dish id → data, once loaded */
let byId = null;
let indexLoading = null;

/**
 * The decoded dishes (cached). Rejects when the file cannot be loaded (a later call tries again).
 * @returns {Promise<object[]>}
 */
export function loadDishes() {
  if (!loading) {
    loading = (async () => {
      const res = await fetch(new URL('../data/dishes.json', import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = decodeDishes(await res.json());
      byId = dishesById(list);
      return list;
    })();
    loading.catch((err) => { console.warn(`Dishes not loaded: ${err && err.message}`); loading = null; });
  }
  return loading;
}

/** Dish data by id when loaded, else null. Synchronous. */
export const loadedDishes = () => byId;

/**
 * Load the dishes when `foods` contains a dish (without the argument: always), so their names show in the app
 * language. Never rejects.
 * @param {Array<object|null|undefined>} [foods]
 */
export async function ensureDishNames(foods) {
  if (foods && !foods.some((f) => f && f.source === DISH_SOURCE)) return;
  try { await loadDishes(); } catch { /* stored English names */ }
}

/** Search index of the dishes for the app language (built once). */
function loadIndex() {
  if (!indexLoading) {
    indexLoading = (async () => {
      const lang = getLanguage();
      return (await loadDishes()).map((d) => indexItem(d, ...dishSearchNames(d, lang)));
    })();
    indexLoading.catch(() => { indexLoading = null; });
  }
  return indexLoading;
}

/**
 * Search the dishes in every language (same ranking rules as generic foods). Each result is a copy carrying the
 * language it was found in (`nameLang`, "show the name as I typed it").
 * @param {string} query @param {number} [limit]
 */
export async function searchDishes(query, limit = 12) {
  return searchMatches(query, await loadIndex(), { limit }).map(({ item, lang }) => withNameLang(item, lang));
}

/** Shown name of a dish (search item or stored food) in the app language or its nameLang, or null (see core). */
export function dishName(food) {
  return localDishName(food, byId, shownNameLang(food, getLanguage()));
}

/** Shown name of a diary entry / saved-meal item of a dish, or null (see core localDishItemName). */
export function dishItemName(item, food) {
  return localDishItemName(item, food, byId, shownNameLang(food, getLanguage()));
}

/** All three names ({en, de, zh}) of a stored, unrenamed dish when loaded, else null (Your foods search). */
export function dishNames(food) {
  const id = dishIdOf(food);
  const d = id && byId ? byId.get(id) : null;
  return d && d.names.en === food.name ? d.names : null;
}
