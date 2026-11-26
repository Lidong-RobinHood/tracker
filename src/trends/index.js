// Trends feature entry: dashboard, weight, expenditure & adaptive target, intake history.
// Contract: see docs/CONTRACT.md. Maths in src/core/adaptive.js.
import { mountDashboard } from './dashboard.js';
import { mountWeight } from './weight-view.js';
import { mountExpenditure } from './expenditure-view.js';
import { mountIntake } from './intake-view.js';
import { mountWeeks, mountWeek } from './week-view.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'trends', titleKey: 'trends.title', mount: mountDashboard },
  { path: 'trends/weight', titleKey: 'trends.weight.title', mount: mountWeight },
  { path: 'trends/expenditure', titleKey: 'trends.exp.routeTitle', mount: mountExpenditure },
  { path: 'trends/intake', titleKey: 'trends.intake.title', mount: mountIntake },
  { path: 'trends/weeks', titleKey: 'trends.weeks.title', mount: mountWeeks },
  { path: 'trends/week/:weekStart', titleKey: 'trends.week.title', mount: mountWeek },
];
