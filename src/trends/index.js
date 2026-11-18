// Trends feature entry (step 4). PLACEHOLDER — keep exporting `routes`.
// Contract: see docs/CONTRACT.md.
import { el, pageHeader } from '../ui/index.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  {
    path: 'trends',
    title: 'Trends',
    mount(container) {
      container.append(
        pageHeader({ title: 'Trends' }),
        el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Weight trend and adaptive targets — coming in step 4.')),
      );
    },
  },
];
