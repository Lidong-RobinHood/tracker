// Split library: browse training splits by days, style, level and equipment, see weekly sets per muscle,
// swap exercises, follow one as routines ("Next up"). Routes: workout/splits, workout/splits/:id.
// Logic in src/core/splits.js, catalogue in src/data/splits.js, rationale in docs/SPLITS.md.
import { mountLibrary } from './library.js';
import { mountDetail } from './detail.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'workout/splits', title: 'Splits', tab: 'workout', mount: mountLibrary },
  { path: 'workout/splits/:id', title: 'Split', tab: 'workout', mount: mountDetail },
];
