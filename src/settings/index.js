// Settings feature entry.
import { mountSettings, mountSets } from './settings-view.js';
import { mountGoal } from './goal-view.js';
import { mountLicences } from './licences-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'settings', title: 'Settings', mount: mountSettings },
  { path: 'settings/goal', title: 'Goal and targets', mount: mountGoal },
  { path: 'settings/sets', title: 'Set weighting', mount: mountSets },
  { path: 'licences', title: 'Licences', tab: 'settings', mount: mountLicences },
];
