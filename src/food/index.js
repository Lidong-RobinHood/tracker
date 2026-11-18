// Food feature entry. PLACEHOLDER — the food worker replaces this file (keep exporting `routes`).
// Contract: see docs/CONTRACT.md.
import { el, pageHeader, fmtDay } from '../ui/index.js';
import { today, isValidDate } from '../core/dates.js';

function diaryPlaceholder(container, params) {
  const date = params.date && isValidDate(params.date) ? params.date : today();
  container.append(
    pageHeader({ title: 'Diary', subtitle: fmtDay(date) }),
    el('div', { class: 'card' }, el('p', { class: 'muted' }, `Food diary for ${date} — coming soon.`)),
  );
}

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'diary', title: 'Diary', mount: diaryPlaceholder },
  { path: 'diary/:date', title: 'Diary', mount: diaryPlaceholder },
];
