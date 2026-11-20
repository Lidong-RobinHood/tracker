// Display rounding for body weights, so figures shown side by side add up. Pure, no DOM.
// - Body weights: 1 decimal (83.1 kg).
// - A change between two weights: the difference of the two DISPLAYED (rounded) weights, so
//   "83.1 → 83.4 · −0.3 kg" is self-consistent (the unrounded difference may be −0.36).
// - Rates (kg / week): 2 decimals, never derived from rounded weights.
import { round } from './numbers.js';

const num = (n) => typeof n === 'number' && Number.isFinite(n);

/** Body weight as displayed: 1 decimal. null when not a number. */
export function shownKg(n) {
  return num(n) ? round(n, 1) : null;
}

/** cur − prev from the displayed weights (1 decimal each); null when either is missing. */
export function shownKgChange(cur, prev) {
  if (!num(cur) || !num(prev)) return null;
  return round(round(cur, 1) - round(prev, 1), 1);
}

/** Percentage change from the displayed weights (1 decimal); null when either is missing or prev is 0. */
export function shownKgChangePct(cur, prev) {
  const c = shownKgChange(cur, prev);
  const p = shownKg(prev);
  return c === null || !p ? null : round((c / p) * 100, 1);
}

/** Difference of two displayed changes (e.g. actual vs expected), 1 decimal. */
export function shownKgDiff(a, b) {
  if (!num(a) || !num(b)) return null;
  return round(round(a, 1) - round(b, 1), 1);
}

/** Rate in kg / week as displayed: 2 decimals. */
export function shownRate(n) {
  return num(n) ? round(n, 2) : null;
}
