// Import of existing data (workout sheet, body weights, food diary). Routes: import, import/...
import { mountHub } from './hub.js';
import { mountWorkoutImport } from './workouts-view.js';
import { mountWeightImport } from './weights-view.js';
import { mountFoodImport } from './food-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'import', titleKey: 'import.title', tab: 'settings', mount: mountHub },
  { path: 'import/workouts', titleKey: 'import.workouts.title', tab: 'settings', mount: mountWorkoutImport },
  { path: 'import/weights', titleKey: 'import.weights.title', tab: 'settings', mount: mountWeightImport },
  { path: 'import/food', titleKey: 'import.food.title', tab: 'settings', mount: mountFoodImport },
];
