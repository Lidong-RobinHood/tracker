// Small food-specific UI pieces shared by the diary, add-food and portion screens.
import { el, fmtNum } from '../ui/index.js';
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
  return `${fmtNum(food.per100 && food.per100.kcal, 0)} kcal / 100 ${food.basis || 'g'}`;
}

/** 'P 6.3 · C 57.5 · F 30.9' for a values object. */
export function macroText(v) {
  return `P ${fmtNum(v.protein)} · C ${fmtNum(v.carbs)} · F ${fmtNum(v.fat)}`;
}

/** One search/recent result row. */
export function foodRow(food, { onClick, sub, trail } = {}) {
  const subParts = [food.brand, sub].filter(Boolean).join(' · ');
  return el('button', { type: 'button', class: 'list-item food-row', onClick },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, food.name || 'Unnamed'),
      el('div', { class: 'li-sub' }, sourceBadge(food), subParts ? ` ${subParts}` : '')),
    el('div', { class: 'li-trail small' }, trail ?? per100Text(food)));
}

/** Toggle group (segmented control) built on the shared .tabs class. */
export function segmented(options, value, onChange, ariaLabel) {
  const wrap = el('div', { class: 'tabs', role: 'tablist', 'aria-label': ariaLabel });
  const set = (v) => {
    for (const b of wrap.children) b.setAttribute('aria-selected', String(b.dataset.value === v));
  };
  for (const o of options) {
    wrap.append(el('button', { type: 'button', role: 'tab', dataset: { value: o.value }, onClick: () => { set(o.value); onChange(o.value); } }, o.label));
  }
  set(value);
  wrap.setValue = set;
  return wrap;
}
