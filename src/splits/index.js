// Split library: browse training splits by days and style, adopt one as routines. Routes: workout/splits, workout/splits/:id
import { pageHeader, emptyState } from '../ui/index.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'workout/splits', title: 'Splits', tab: 'workout', mount(container) {
    container.append(pageHeader({ title: 'Splits', back: 'workout' }), emptyState('Coming soon.'));
  } },
];
