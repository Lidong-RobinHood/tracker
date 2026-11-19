// Import of existing data (workout sheet, body weights, food diary). Routes: import, import/...
import { el, pageHeader, emptyState } from '../ui/index.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'import', title: 'Import data', tab: 'settings', mount(container) {
    container.append(pageHeader({ title: 'Import data', back: 'settings' }), emptyState('Coming soon.'));
  } },
];
