// Bundled generic foods (USDA SR Legacy), loaded lazily on first search and kept in memory.
// Translated names (src/data/generic-foods.<lang>.json, German and Chinese) are loaded with them: search finds
// a food by its English, German or Chinese name in every app language (the app language's matches first), and
// the app language's names are shown wherever a generic food appears (src/food/names.js), except for a food the
// user found and added through another language's name (its `nameLang`, "show the name as I typed it"). For
// display only the app language's names file (plus the files of stored foods' nameLang) is loaded, and only
// when a generic food is on screen (ensureDisplayNames). A names file that is missing or broken is skipped
// with a console warning: those foods stay English.
import { decodeGenericFoods, indexItem, searchMatches, commonFoodsFromFile, forLanguage, langNames, foodIdsHash } from '../core/food-search.js';
import { namesFromFile, localFoodName, shownNameLang, withNameLang, hasBuiltInName } from '../core/food-names.js';
import { getLanguage } from '../i18n/index.js';
import { ensureDishNames, dishNames } from './dishes.js';

/** Languages with a translated names file. */
export const NAME_LANGS = Object.freeze(['de', 'zh']);

let baseLoading = null;
/** @type {Record<string, Promise<Map<string, {h: string, name: string}>|null>>} */
const namesLoading = {};
/** @type {Record<string, Map<string, {h: string, name: string}>>} names files loaded and valid */
const loadedNames = {};
/** idsHash of each loaded names file (checked against generic-foods.json once that is loaded for search). */
const namesHash = {};
let indexLoading = null;
let commonLoading = null;

/**
 * Curated everyday foods (src/data/generic-foods-common.json): fdcId → {tier, aliases} for search ranking.
 * Cached; a missing or broken file gives an empty map (search then ranks as before).
 * @returns {Promise<Map<number, {tier?: number, aliases?: string[]}>>}
 */
function loadCommon() {
  if (!commonLoading) {
    commonLoading = (async () => {
      try {
        const res = await fetch(new URL('../data/generic-foods-common.json', import.meta.url));
        if (!res.ok) { console.warn(`Common foods not loaded: HTTP ${res.status}`); return new Map(); }
        return commonFoodsFromFile(await res.json());
      } catch (err) {
        console.warn(`Common foods not loaded: ${err && err.message}`);
        commonLoading = null; // retry next time (offline)
        return new Map();
      }
    })();
  }
  return commonLoading;
}

/** generic-foods.json decoded, with the fdcId list. @returns {Promise<{foods: object[], ids: number[]}>} */
function loadBase() {
  if (!baseLoading) {
    baseLoading = (async () => {
      const res = await fetch(new URL('../data/generic-foods.json', import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const doc = await res.json();
      const foods = decodeGenericFoods(doc);
      const at = doc.fields.indexOf('fdcId');
      return { foods, ids: doc.foods.map((row) => row[at]) };
    })();
    baseLoading.catch(() => { baseLoading = null; }); // allow a retry (e.g. first use while offline)
  }
  return baseLoading;
}

/**
 * Translated names for a language (cached). The names file is self-contained (fdcIds and English-name hashes,
 * see core/food-names.js), so this never loads generic-foods.json: the diary shows stored generic foods
 * translated with this one file. null when there is no file, it is broken, or it could not be loaded (a
 * network failure is retried on the next call; a missing file is not).
 * @param {string} lang
 * @returns {Promise<Map<string, {h: string, name: string}>|null>} sourceKey → names
 */
export function loadNames(lang) {
  if (!NAME_LANGS.includes(lang)) return Promise.resolve(null);
  if (!namesLoading[lang]) {
    namesLoading[lang] = (async () => {
      let doc;
      try {
        const res = await fetch(new URL(`../data/generic-foods.${lang}.json`, import.meta.url));
        if (!res.ok) { console.warn(`Generic food names (${lang}) not loaded: HTTP ${res.status}; showing English names`); return null; }
        doc = await res.json();
      } catch (err) {
        console.warn(`Generic food names (${lang}) not loaded: ${err && err.message}; showing English names`);
        delete namesLoading[lang];
        return null;
      }
      const r = namesFromFile(doc, lang);
      if (!r.ok) { console.warn(`Generic food names (${lang}) skipped: ${r.reason}; showing English names`); return null; }
      namesHash[lang] = doc.idsHash;
      loadedNames[lang] = r.names;
      return r.names;
    })();
  }
  return namesLoading[lang];
}

/**
 * Load the app language's names for display (no-op in English), only when `foods` contains a generic food
 * (source 'usda'; without the argument: always), and the names of every other language a generic food among
 * `foods` is shown in (its nameLang); also the dishes (src/food/dishes.js) when `foods` contains one. Never
 * rejects. Await before rendering generic food names (diary, add food, saved meals) so they do not flash English
 * first.
 * @param {Array<object|null|undefined>} [foods] the stored foods about to be shown
 * @returns {Promise<Map<string, {h: string, name: string}>|null>} the app language's names
 */
export async function ensureDisplayNames(foods) {
  const dishes = ensureDishNames(foods);
  const names = await ensureGenericNames(foods);
  await dishes;
  return names;
}

/** ensureDisplayNames for the generic foods only. */
async function ensureGenericNames(foods) {
  if (foods && !foods.some((f) => f && f.source === 'usda')) return displayNames();
  const app = getLanguage();
  const langs = new Set([app]);
  for (const f of foods || []) if (f && f.source === 'usda') langs.add(shownNameLang(f, app));
  const loaded = await Promise.all([...langs].map((l) => loadNames(l).catch(() => null)));
  return loaded[0];
}

/** The app language's names if loaded (see ensureDisplayNames), else null. Synchronous. */
export const displayNames = () => loadedNames[getLanguage()] || null;

/**
 * Names map to show a food with (synchronous): the one of its nameLang when that is another language
 * (null for English: the stored English name is shown), else the app language's (displayNames). A nameLang
 * whose file is not loaded falls back to the app language.
 * @param {object|null|undefined} food @returns {Map<string, {h: string, name: string}>|null}
 */
export function namesFor(food) {
  const app = getLanguage();
  const lang = shownNameLang(food, app);
  if (lang === app) return displayNames();
  if (lang === 'en') return null;
  return loadedNames[lang] || displayNames();
}

/** @returns {Promise<Array<{item: object, words: string[], len: number}>>} search index */
export function loadGeneric() {
  if (!indexLoading) {
    indexLoading = (async () => {
      const { foods, ids } = await loadBase();
      const [common, ...loaded] = await Promise.all([loadCommon(), ...NAME_LANGS.map((l) => loadNames(l))]);
      // a names file built for another generic-foods.json order is not used for search (display checks the
      // English-name hash per food, so it stays safe there)
      const baseHash = foodIdsHash(ids);
      const maps = loaded.map((m, i) => {
        if (m && namesHash[NAME_LANGS[i]] !== baseHash) {
          console.warn(`Generic food names (${NAME_LANGS[i]}) do not match generic-foods.json; searching English names only`);
          return null;
        }
        return m;
      });
      const lang = getLanguage();
      // First name = the one shown (app language): it decides ties by length; all names (English, German,
      // Chinese) are searchable, each tagged with its language so a match only in another language's name
      // ranks below the app language's (core/food-search.js nameRank). Everyday staples get their tier and
      // aliases from the common-foods file.
      return foods.map((f, i) => indexItem(f, searchNames(f, lang, maps), forLanguage(common.get(Number(ids[i])), lang)));
    })();
    indexLoading.catch(() => { indexLoading = null; });
  }
  return indexLoading;
}

/** A generic food's names by language ({en, de, zh}) from the loaded names maps (in NAME_LANGS order). */
function namesOf(food, maps) {
  const out = { en: food.name };
  NAME_LANGS.forEach((l, i) => { out[l] = localFoodName(food, maps[i]); });
  return out;
}

/** Ranked search names of a generic food for the app language (indexItem's text). */
function searchNames(food, lang, maps) {
  return langNames(lang, namesOf(food, maps));
}

/**
 * Search names of a stored food for the local "Your foods" search: the shown name (rank 0) and, for an
 * unrenamed generic food or dish, its names in the other languages ranked by language (nameRank) and tagged with it
 * (the shown name with the food's nameLang). `suffix` (e.g. the brand) is appended to each. Only complete
 * after loadGeneric() / loadNames() (dishes: loadDishes()); missing files give fewer names.
 * @param {object} food @param {string} shown @param {string} [suffix]
 */
export function storedFoodNames(food, shown, suffix = '') {
  const names = dishNames(food) || (localFoodName(food, loadedNames.de || null) || localFoodName(food, loadedNames.zh || null)
    ? namesOf(food, NAME_LANGS.map((l) => loadedNames[l] || null)) : null);
  const app = getLanguage();
  const lang = shownNameLang(food, app);
  // without the names files: the shown name (in its nameLang) and the stored one
  const list = names ? langNames(app, names, shown, lang)
    : [{ text: shown, rank: 0, lang: lang !== app && shown !== food.name ? lang : null }, { text: food.name, rank: 0 }];
  return list.map((n) => ({ text: n.text + suffix, rank: n.rank, lang: n.lang || null }));
}

/**
 * Search results as foods to show and log: a generic food or dish carries the language it was found in
 * (`nameLang`: a code, or null for the app language; withNameLang), so the row, the portion sheet and the stored
 * food show the name as the user typed it. Other foods are returned unchanged.
 * @param {Array<{item: object, lang: string|null}>} matches from searchMatches()
 */
export const asFound = (matches) => matches.map(({ item, lang }) => (hasBuiltInName(item) ? withNameLang(item, lang) : item));

/**
 * Search generic foods (loads the dataset and the names files on first call). Each result carries the
 * language it was found in (asFound): copies, the dataset stays unchanged.
 */
export async function searchGeneric(query, limit = 25) {
  return asFound(searchMatches(query, await loadGeneric(), { limit }));
}
