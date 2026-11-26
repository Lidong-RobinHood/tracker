// Display names in the app language for food data. Records are never rewritten: generic (USDA) foods keep
// their English name and are shown translated by sourceKey (src/food/generic.js loads the names); stored
// markers such as 'Quick add', 'Meal', 'Whole pack' are shown translated; everything the user typed or an
// Open Food Facts product name is shown as stored.
import { t, EN_CATALOGUES } from '../i18n/index.js';
import { dateLabel, weekdayShort, monthShort } from '../i18n/dates.js';
import { parseDate } from '../core/dates.js';
import { localFoodName, localItemName } from '../core/food-names.js';
import { MEALS, QUICK_ADD_NAME, DEFAULT_MEAL_NAME } from '../core/food-diary.js';
import { PACK_LABEL, SERVING_LABEL, MULTIPACK_RE } from '../core/portion.js';
import { UNNAMED_ITEM, PHOTO_MEAL_NAME } from '../core/meal-photo.js';
import { IMPORTED_NAME, IMPORTED_SUFFIX } from '../core/import-food.js';
import { displayNames } from './generic.js';

/** 'Breakfast' / 'Frühstück' / '早餐' for a meal id (unknown ids as given). */
export function mealName(id) {
  const m = MEALS.find((x) => x.id === id);
  return m ? t(m.labelKey) : String(id ?? '');
}

/** Name of a food record or search item (generic foods translated unless the user edited them). */
export function foodName(food) {
  return localFoodName(food, displayNames()) || (food && food.name) || t('food.unnamedFood');
}

/**
 * Name of a diary entry or saved-meal item. `food`: its stored food (by foodId) when known, so an unedited
 * generic food is shown translated.
 * @param {{name?: string, foodId?: string|null}} item @param {object|null} [food]
 */
export function itemName(item, food = null) {
  if (!item) return '';
  if (item.name === QUICK_ADD_NAME && !item.foodId) return t('food.quickAdd.title');
  if (item.name === UNNAMED_ITEM) return t('food.photo.unnamedItem');
  if (!item.foodId && typeof item.name === 'string') {
    const generated = generatedEntryName(item.name);
    if (generated) return generated;
  }
  return localItemName(item, food, displayNames()) || item.name || t('food.unnamedFood');
}

const MORE_RE = /^(.+) \+ (\d+) more$/;
/**
 * Entry names the app generates and stores in English (language-neutral), shown in the app language:
 * 'Imported' / '<file meal> (imported)' (food import), 'Meal photo' and '<items> + 2 more' (a photo logged as
 * one entry; the item names are the model's and stay). null for any other name.
 * @param {string} name
 */
function generatedEntryName(name) {
  if (name === IMPORTED_NAME) return t('food.entry.imported');
  if (name.endsWith(IMPORTED_SUFFIX) && name.length > IMPORTED_SUFFIX.length) {
    return t('food.entry.mealImported', { meal: name.slice(0, -IMPORTED_SUFFIX.length) });
  }
  if (name === PHOTO_MEAL_NAME) return t('food.photo.mealPhoto');
  const m = MORE_RE.exec(name);
  if (m) return `${m[1]}${t('food.photo.more', { count: Number(m[2]) })}`;
  return null;
}

/** True when a quick-add entry has no name of its own. */
export const isUnnamedQuickAdd = (entry) => entry.name === QUICK_ADD_NAME && !entry.foodId;

/** English meal label ('Breakfast') of a meal id: the stored form of generated default names. */
const enMeal = (id) => {
  const m = MEALS.find((x) => x.id === id);
  return m ? EN_CATALOGUES.food[m.labelKey] : String(id ?? '');
};
const mealIdOfEnglish = (label) => (MEALS.find((m) => EN_CATALOGUES.food[m.labelKey] === label) || {}).id || null;

/** English weekday / month abbreviations ('Mon', 'Jan') of src/i18n/dates.js, for reading stored default names. */
let enNames = null;
function englishDateNames() {
  if (!enNames) {
    const days = Array.from({ length: 7 }, (_, i) => weekdayShort(i, 'en'));
    const months = Array.from({ length: 12 }, (_, m) => monthShort(m, 'en'));
    // 'Breakfast Thu 26 Nov' / 'Breakfast Thu 26 Nov 2025' (also what 0.7.1 stored)
    enNames = { days, months, re: new RegExp(`^(\\S+) (${days.join('|')}) (\\d{1,2}) (${months.join('|')})(?: (\\d{4}))?$`) };
  }
  return enNames;
}
const PHOTO_RE = /^(\S+) photo$/; // i18n-ignore: stored English default 'Breakfast photo'

/**
 * Default name of a meal saved from a diary meal: stored in English ('Breakfast Thu 26 Nov', the year added
 * when it is not the current one), shown in the app language (savedMealName).
 * @param {string} mealId @param {string} date YYYY-MM-DD @param {Date} [now]
 * @returns {{stored: string, shown: string}}
 */
export function savedMealDefault(mealId, date, now = new Date()) {
  const d = parseDate(date);
  const year = d.getFullYear() !== now.getFullYear();
  return {
    stored: `${enMeal(mealId)} ${dateLabel(d, { year }, 'en')}`,
    shown: t('food.diary.savedMealName', { meal: mealName(mealId), date: dateLabel(d, { year }) }),
  };
}

/** Default name of a meal saved from a photo estimate: stored 'Breakfast photo', shown translated. */
export function photoMealDefault(mealId) {
  return { stored: `${enMeal(mealId)} photo`, shown: t('food.photo.savedMealName', { meal: mealName(mealId) }) }; // i18n-ignore: stored English default
}

/** The date of a stored 'Breakfast Thu 26 Nov' name: the year given, else the one (around `year`) whose weekday matches. */
function datedName(m, year) {
  const { days, months } = englishDateNames();
  const day = Number(m[3]);
  const month = months.indexOf(m[4]);
  const wd = days.indexOf(m[2]);
  const years = m[5] ? [Number(m[5])] : [year, year - 1, year + 1];
  for (const y of years) {
    const d = new Date(y, month, day, 12);
    if (d.getMonth() === month && (d.getDay() + 6) % 7 === wd) return d;
  }
  return null;
}

/**
 * Name of a saved meal: the stored default names ('Meal', 'Breakfast Thu 26 Nov', 'Breakfast photo', stored
 * in English) in the app language; any other name as stored.
 * @param {{name?: string, createdAt?: number}|null|undefined} meal
 */
export function savedMealName(meal) {
  if (!meal) return '';
  const name = meal.name || '';
  if (name === DEFAULT_MEAL_NAME) return t('food.meals.defaultName');
  let m = englishDateNames().re.exec(name);
  if (m && mealIdOfEnglish(m[1])) {
    const d = datedName(m, new Date(typeof meal.createdAt === 'number' ? meal.createdAt : Date.now()).getFullYear());
    if (d) return t('food.diary.savedMealName', { meal: mealName(mealIdOfEnglish(m[1])), date: dateLabel(d, { year: !!m[5] }) });
  }
  m = PHOTO_RE.exec(name);
  if (m && mealIdOfEnglish(m[1])) return t('food.photo.savedMealName', { meal: mealName(mealIdOfEnglish(m[1])) });
  return name;
}

/** Serving chip label: stored markers ('Whole pack', 'Serving', '1 of 6') translated, others as stored. */
export function servingLabel(label) {
  if (label === PACK_LABEL) return t('food.serving.wholePack');
  if (label === SERVING_LABEL) return t('food.serving.serving');
  const m = MULTIPACK_RE.exec(String(label ?? ''));
  if (m) return t('food.serving.oneOf', { n: Number(m[1]) });
  return label;
}

/** Map of food records by id (for itemName). @param {object[]} foods */
export const foodsById = (foods) => new Map((foods || []).filter(Boolean).map((f) => [f.id, f]));
