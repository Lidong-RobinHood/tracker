// Settings feature entry.
import { mountSettings } from './settings-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'settings', title: 'Settings', mount: mountSettings },
];
