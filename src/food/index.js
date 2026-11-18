// Food feature entry: diary + add-food routes. Contract: docs/CONTRACT.md. Spec: docs/SPEC.md §4.
import { el, pageHeader } from '../ui/index.js';
import { isValidDate, today } from '../core/dates.js';
import { isMeal, mealForTime } from '../core/food-diary.js';
import { mountDiary } from './diary-view.js';
import { mountAdd } from './add-view.js';
import { mountPhotoSettings } from './photo-settings-view.js';

/** food/add/:date/:meal with validation (bad links fall back to today / a meal for the time of day). */
function mountAddChecked(container, params, ctx) {
  const date = isValidDate(params.date) ? params.date : today();
  const meal = isMeal(params.meal) ? params.meal : mealForTime();
  return mountAdd(container, { date, meal }, ctx);
}

function mountBadDate(container, params) {
  container.append(pageHeader({ title: 'Diary', back: 'diary' }),
    el('div', { class: 'card' }, el('p', `“${params.date}” is not a valid date.`)));
}

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'diary', title: 'Diary', mount: mountDiary },
  { path: 'diary/:date', title: 'Diary', mount: (c, p, ctx) => (isValidDate(p.date) ? mountDiary(c, p, ctx) : mountBadDate(c, p)) },
  { path: 'food/add/:date/:meal', title: 'Add food', tab: 'diary', mount: mountAddChecked },
  { path: 'food/photo-settings', title: 'Meal photos', tab: 'settings', mount: mountPhotoSettings },
];
