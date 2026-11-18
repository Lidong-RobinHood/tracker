// Workout feature entry. PLACEHOLDER — the workout worker replaces this file (keep exporting `routes`).
// Contract: see docs/CONTRACT.md.
import { el, pageHeader } from '../ui/index.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  {
    path: 'workout',
    title: 'Workout',
    mount(container) {
      container.append(
        pageHeader({ title: 'Workout' }),
        el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Workouts — coming soon.')),
      );
    },
  },
  {
    path: 'workout/session/:id',
    title: 'Workout',
    mount(container, params) {
      container.append(
        pageHeader({ title: 'Session', back: 'workout' }),
        el('div', { class: 'card' }, el('p', { class: 'muted' }, `Session ${params.id} — coming soon.`)),
      );
    },
  },
];
