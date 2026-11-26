// Split library: browse training splits by days, style, level and equipment, see weekly sets per muscle,
// swap exercises, follow one as routines ("Next up"); custom splits (the user's own rotation of routines). Routes: workout/splits, workout/splits/:id.
// Logic in src/core/splits.js, catalogue in src/data/splits.js, rationale in docs/SPLITS.md.
import { mountLibrary } from './library.js';
import { mountDetail } from './detail.js';
import { mountCustom } from './custom.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'workout/splits', titleKey: 'splits.title', tab: 'workout', mount: mountLibrary },
  { path: 'workout/splits/:id', titleKey: 'splits.split', tab: 'workout', mount: mountDetail },
  { path: 'workout/splits/custom/:id', titleKey: 'splits.custom.defaultName', tab: 'workout', mount: mountCustom },
];
