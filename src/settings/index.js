// Settings feature entry.
import { mountSettings, mountSets } from './settings-view.js';
import { mountGoal } from './goal-view.js';
import { mountLicences } from './licences-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'settings', titleKey: 'settings.title', mount: mountSettings },
  { path: 'settings/goal', titleKey: 'settings.goal.title', mount: mountGoal },
  { path: 'settings/sets', titleKey: 'settings.sets.title', mount: mountSets },
  { path: 'licences', titleKey: 'settings.licences.title', tab: 'settings', mount: mountLicences },
];
