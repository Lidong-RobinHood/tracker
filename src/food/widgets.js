// Small food-specific UI pieces shared by the diary, add-food and portion screens.
import { el, fmtGrouped, fmtDate, icon } from '../ui/index.js';
import { MEALS } from '../core/food-diary.js';
import { isValidDate } from '../core/dates.js';
import { isEstimateFood, normalKcal, dishKcalFor } from '../core/dishes.js';
import { badgeSource } from '../core/food-diary.js';
import { t } from '../i18n/index.js';
import { foodName, mealName } from './names.js';

export { mealName };

let cssLoaded = false;
/** Load food.css once. */
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-food-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./food.css', import.meta.url).href, dataset: { foodCss: '1' } }));
}

/** <select> with the four meals. */
export function mealSelect(value, { ariaLabel = t('food.meal.label'), onChange } = {}) {
  const s = el('select', { class: 'select', 'aria-label': ariaLabel, onChange: onChange ? () => onChange(s.value) : null },
    MEALS.map((m) => el('option', { value: m.id, selected: m.id === value }, t(m.labelKey))));
  s.value = value;
  return s;
}

/** Native date picker. getValue() returns a valid YYYY-MM-DD or null. */
export function dateInput(value, { ariaLabel = t('food.date.label'), onChange } = {}) {
  const i = el('input', { type: 'date', class: 'input', value, 'aria-label': ariaLabel, required: true });
  i.getValue = () => (isValidDate(i.value) ? i.value : null);
  if (onChange) i.addEventListener('change', () => { if (i.getValue()) onChange(i.getValue()); });
  return i;
}

/**
 * A native date input shown as the app's date ('Thu 19 Nov'): the formatted date is the visible value,
 * the native input lies transparent over it (it keeps focus, keyboard and the system picker, and is what
 * screen readers read). The text follows every change. Used by Food, Trends and Import.
 * @param {HTMLInputElement} input an <input type=date>
 * @param {{placeholder?: string}} [opts]
 */
export function dateBox(input, { placeholder = t('food.date.pick') } = {}) {
  ensureCss();
  input.classList.add('date-box-input');
  const text = el('span', { class: 'date-box-text', 'aria-hidden': 'true' });
  const sync = () => {
    text.textContent = isValidDate(input.value) ? fmtDate(input.value) : placeholder;
    text.classList.toggle('faint', !isValidDate(input.value));
    box.classList.toggle('is-disabled', input.disabled);
  };
  const box = el('label', { class: 'input date-box' }, text, icon('calendar', { size: 18, class: 'date-box-ic' }), input);
  // Chrome only opens its picker from the calendar glyph; open it from anywhere in the box.
  input.addEventListener('click', () => { try { if (!input.disabled && input.showPicker) input.showPicker(); } catch { /* not allowed here */ } });
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  sync();
  return box;
}

/** Meal + date selects side by side (portion, entry, saved-meal and copy sheets). */
export function mealDateRow(mealSel, dateIn, { dateLabel = t('food.date.label'), mealFirst = true } = {}) {
  const meal = el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('food.meal.label')), mealSel);
  const date = el('div', { class: 'field' }, el('span', { class: 'field-label' }, dateLabel), dateBox(dateIn));
  return el('div', { class: 'grid-2 meal-date-row' }, mealFirst ? [meal, date] : [date, meal]);
}

/** Catalogue keys of the source badges (long: portion sheet, short: lists). */
const SOURCE_LABEL = { off: 'food.source.off', usda: 'food.source.usda', custom: 'food.source.custom' };
const SOURCE_SHORT = { off: 'food.source.offShort', usda: 'food.source.usdaShort', custom: 'food.source.customShort' };

/**
 * '≈' before an estimated kcal figure (read as 'About' by screen readers); `cls` adds classes (e.g. 't-title'
 * on the portion sheet's big number).
 */
export function approxMark(cls = '') {
  return [el('span', { class: ['approx', cls || null], 'aria-hidden': 'true' }, '≈'), el('span', { class: 'vh' }, `${t('food.estimate.about')} `)];
}

/** Badge naming where a food's values come from. A dish: the quiet '≈ Estimate' (own estimate, core/dishes.js). */
export function sourceBadge(food, { long = false } = {}) {
  if (food.userEdited) return el('span', { class: 'badge badge-edited' }, t(long ? 'food.source.editedLong' : 'food.source.edited'));
  if (isEstimateFood(food)) return el('span', { class: 'badge badge-src-dish' }, el('span', { 'aria-hidden': 'true' }, '≈'), t('food.source.dish'));
  const src = badgeSource(food); // an unknown source (e.g. from an imported backup) shows no badge
  if (!src) return null;
  return el('span', { class: ['badge', `badge-src-${src}`] }, t((long ? SOURCE_LABEL : SOURCE_SHORT)[src]));
}

/** Attribution required by Open Food Facts wherever its data is shown: 'Data: Open Food Facts · ODbL'. */
export function offCredit() {
  const a = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return el('p', { class: 'small muted off-credit' }, t('food.off.creditPrefix'), ' ', a('https://world.openfoodfacts.org', 'Open Food Facts'), // i18n-ignore (brand)
    ' · ', a('https://opendatacommons.org/licenses/odbl/1-0/', 'ODbL')); // i18n-ignore (licence name)
}

/** 'kcal, protein': translated, comma-separated list of missing fields (missingFields() ids: name, kcal, protein …). */
export function missingText(ids) {
  return ids.map((k) => t(`food.missing.${k}`)).join(t('food.list.separator'));
}

/** '539 kcal / 100 g' */
export function per100Text(food) {
  return `${fmtGrouped(food.per100 && food.per100.kcal, 0)} kcal / 100 ${food.basis || 'g'}`;
}

/** 'P 6.3 · C 57.5 · F 30.9' for a values object (letters per language). */
export function macroText(v) {
  return t('food.macros.short', { p: fmtGrouped(v.protein, 1), c: fmtGrouped(v.carbs, 1), f: fmtGrouped(v.fat, 1) });
}

/**
 * '≈ 1 012 kcal': kcal of a dish's normal portion (search, Your foods) or, with `amount`, of that amount (Recent:
 * the last logged amount); null when not a dish or without sizes.
 */
export function dishTrail(food, amount) {
  const k = amount ? dishKcalFor(food, amount) : isEstimateFood(food) ? normalKcal(food) : null;
  return k === null ? null : [...approxMark(), `${fmtGrouped(k, 0)} kcal`]; // i18n-ignore (unit)
}

/**
 * One search/recent result row: name, source badge + brand, on the right kcal per 100 (a dish: ≈ kcal of its
 * normal portion).
 */
export function foodRow(food, { onClick, sub, trail } = {}) {
  const subParts = [food.brand, sub].filter(Boolean).join(' · ');
  return el('button', { type: 'button', class: 'list-item food-row', onClick },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, foodName(food)),
      el('div', { class: 'li-sub' }, sourceBadge(food), subParts ? ` ${subParts}` : '')),
    el('div', { class: 'li-trail t-sub muted' }, trail ?? dishTrail(food) ?? per100Text(food)));
}

/**
 * Big kcal + protein / carbs / fat trio (portion and entry sheets); `extra`: optional node under it.
 * `approx`: an estimate, led by '≈' (read as 'About').
 */
export function portionValues(v, extra, { approx = false } = {}) {
  const cell = (label, key, x) => el('div', { class: 'macro-cell' },
    el('span', { class: 't-cap muted macro-cap' }, el('i', { class: `swatch is-${key}`, 'aria-hidden': 'true' }), label),
    el('span', { class: 'num macro-val' }, fmtGrouped(x, 1), el('span', { class: 't-sub muted' }, ' g')));
  return [
    el('div', { class: 'portion-kcal num' },
      approx ? approxMark('t-title') : null,
      el('span', { class: 't-hero' },fmtGrouped(v.kcal, 0)), el('span', { class: 't-sub muted' }, ' kcal')),
    el('div', { class: 'portion-macros' }, cell(t('food.nutrient.protein'), 'protein', v.protein), cell(t('food.nutrient.carbs'), 'carbs', v.carbs), cell(t('food.nutrient.fat'), 'fat', v.fat)),
    extra || null,
  ];
}
