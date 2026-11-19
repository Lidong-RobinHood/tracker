// First-run setup and help. Routes: welcome, help
import { el, pageHeader, emptyState } from '../ui/index.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'help', title: 'Help', tab: 'settings', mount(container) {
    container.append(pageHeader({ title: 'Help', back: 'settings' }), emptyState('Coming soon.'));
  } },
];
