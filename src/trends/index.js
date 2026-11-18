// Trends feature entry: dashboard, weight, expenditure & adaptive target, intake history.
// Contract: see docs/CONTRACT.md. Maths in src/core/adaptive.js.
import { mountDashboard } from './dashboard.js';
import { mountWeight } from './weight-view.js';
import { mountExpenditure } from './expenditure-view.js';
import { mountIntake } from './intake-view.js';
import { mountWeeks, mountWeek } from './week-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'trends', title: 'Trends', mount: mountDashboard },
  { path: 'trends/weight', title: 'Weight', mount: mountWeight },
  { path: 'trends/expenditure', title: 'Expenditure & target', mount: mountExpenditure },
  { path: 'trends/intake', title: 'Intake history', mount: mountIntake },
  { path: 'trends/weeks', title: 'Weekly reports', mount: mountWeeks },
  { path: 'trends/week/:weekStart', title: 'Weekly report', mount: mountWeek },
];
