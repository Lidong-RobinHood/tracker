// Settings feature entry.
import { mountSettings } from './settings-view.js';
import { mountLicences } from './licences-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'settings', title: 'Settings', mount: mountSettings },
  { path: 'licences', title: 'Licences', tab: 'settings', mount: mountLicences },
];
