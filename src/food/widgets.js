// Small food-specific UI pieces shared by the diary, add-food and portion screens.
import { el, fmtGrouped } from '../ui/index.js';
import { MEALS } from '../core/food-diary.js';
import { isValidDate } from '../core/dates.js';

let cssLoaded = false;
/** Load food.css once. */
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-food-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./food.css', import.meta.url).href, dataset: { foodCss: '1' } }));
}

/** <select> with the four meals. */
export function mealSelect(value, { ariaLabel = 'Meal', onChange } = {}) {
  const s = el('select', { class: 'select', 'aria-label': ariaLabel, onChange: onChange ? () => onChange(s.value) : null },
    MEALS.map((m) => el('option', { value: m.id, selected: m.id === value }, m.label)));
  s.value = value;
  return s;
}

/** Native date picker. getValue() returns a valid YYYY-MM-DD or null. */
export function dateInput(value, { ariaLabel = 'Date', onChange } = {}) {
  const i = el('input', { type: 'date', class: 'input', value, 'aria-label': ariaLabel, required: true });
  i.getValue = () => (isValidDate(i.value) ? i.value : null);
  if (onChange) i.addEventListener('change', () => { if (i.getValue()) onChange(i.getValue()); });
  return i;
}

/** Meal + date selects side by side (portion, entry, saved-meal and copy sheets). */
export function mealDateRow(mealSel, dateIn, { dateLabel = 'Date', mealFirst = true } = {}) {
  const meal = el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel);
  const date = el('div', { class: 'field' }, el('span', { class: 'field-label' }, dateLabel), dateIn);
  return el('div', { class: 'grid-2 meal-date-row' }, mealFirst ? [meal, date] : [date, meal]);
}

const SOURCE_LABEL = { off: 'Open Food Facts', usda: 'Generic · USDA', custom: 'My food' };
const SOURCE_SHORT = { off: 'OFF', usda: 'USDA', custom: 'Mine' };

/** Badge naming where a food's values come from. */
export function sourceBadge(food, { long = false } = {}) {
  if (food.userEdited) return el('span', { class: 'badge badge-edited' }, long ? 'Edited by you' : 'Edited');
  const src = food.source || 'custom';
  return el('span', { class: ['badge', `badge-src-${src}`] }, (long ? SOURCE_LABEL : SOURCE_SHORT)[src] || src);
}

/** Attribution required by Open Food Facts wherever its data is shown: 'Data: Open Food Facts · ODbL'. */
export function offCredit() {
  const a = (href, text) => el('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return el('p', { class: 'small muted off-credit' }, 'Data: ', a('https://world.openfoodfacts.org', 'Open Food Facts'),
    ' · ', a('https://opendatacommons.org/licenses/odbl/1-0/', 'ODbL'));
}

/** '539 kcal / 100 g' */
export function per100Text(food) {
  return `${fmtGrouped(food.per100 && food.per100.kcal, 0)} kcal / 100 ${food.basis || 'g'}`;
}

/** 'P 6.3 · C 57.5 · F 30.9' for a values object. */
export function macroText(v) {
  return `P ${fmtGrouped(v.protein, 1)} · C ${fmtGrouped(v.carbs, 1)} · F ${fmtGrouped(v.fat, 1)}`;
}

/** One search/recent result row: name, source badge + brand, kcal per 100 on the right. */
export function foodRow(food, { onClick, sub, trail } = {}) {
  const subParts = [food.brand, sub].filter(Boolean).join(' · ');
  return el('button', { type: 'button', class: 'list-item food-row', onClick },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, food.name || 'Unnamed'),
      el('div', { class: 'li-sub' }, sourceBadge(food), subParts ? ` ${subParts}` : '')),
    el('div', { class: 'li-trail t-sub muted' }, trail ?? per100Text(food)));
}

/** Big kcal + protein / carbs / fat trio (portion and entry sheets); `extra`: optional node under it. */
export function portionValues(v, extra) {
  const cell = (label, key, x) => el('div', { class: 'macro-cell' },
    el('span', { class: 't-cap muted macro-cap' }, el('i', { class: `swatch is-${key}`, 'aria-hidden': 'true' }), label),
    el('span', { class: 'num macro-val' }, fmtGrouped(x, 1), el('span', { class: 't-sub muted' }, ' g')));
  return [
    el('div', { class: 'portion-kcal num' }, el('span', { class: 't-hero' }, fmtGrouped(v.kcal, 0)), el('span', { class: 't-sub muted' }, ' kcal')),
    el('div', { class: 'portion-macros' }, cell('Protein', 'protein', v.protein), cell('Carbs', 'carbs', v.carbs), cell('Fat', 'fat', v.fat)),
    extra || null,
  ];
}
