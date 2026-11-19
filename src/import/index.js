// Import of existing data (workout sheet, body weights, food diary). Routes: import, import/...
import { mountHub } from './hub.js';
import { mountWorkoutImport } from './workouts-view.js';
import { mountWeightImport } from './weights-view.js';
import { mountFoodImport } from './food-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'import', title: 'Import data', tab: 'settings', mount: mountHub },
  { path: 'import/workouts', title: 'Import workouts', tab: 'settings', mount: mountWorkoutImport },
  { path: 'import/weights', title: 'Import body weight', tab: 'settings', mount: mountWeightImport },
  { path: 'import/food', title: 'Import food diary', tab: 'settings', mount: mountFoodImport },
];
