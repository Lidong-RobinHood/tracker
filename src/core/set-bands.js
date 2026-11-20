// Body-map bands for weighted sets per muscle (the four-step ramp, is-1..is-4). Pure, no DOM.
//
//   bandStep(total, edges)      0–4: ≥ edges[0] → 4, ≥ edges[1] → 3, ≥ edges[2] → 2, > 0 → 1, else 0
//   bandLegend(weights, edges)  the legend of those bands, highest first, labels that do not overlap
//
// Two scales: a planned WEEK (split library, edges 12 / 8 / 4) and ONE SESSION (a routine, 6 / 4 / 2).
import { volumeWeights } from './volume.js';

/** Lower edges of the weekly bands (steps 4, 3, 2). */
export const WEEK_BAND_EDGES = Object.freeze([12, 8, 4]);
/** Lower edges of the bands for one session (steps 4, 3, 2). */
export const SESSION_BAND_EDGES = Object.freeze([6, 4, 2]);

/**
 * @param {number} total weighted sets
 * @param {readonly number[]} [edges] three descending lower edges
 * @returns {0|1|2|3|4}
 */
export function bandStep(total, edges = WEEK_BAND_EDGES) {
  if (!(total > 0)) return 0;
  return total >= edges[0] ? 4 : total >= edges[1] ? 3 : total >= edges[2] ? 2 : 1;
}

/**
 * Legend of bandStep (highest first). Totals move in steps of the smallest set weight (0.5 with the
 * default partial weight), so a band's upper end is the edge above minus that step: '12+', '8–11.5',
 * '4–7.5', 'Under 4', 'None'. With weights that are not multiples of 0.5: '8–under 12'.
 * @param {{primary?: number, secondary?: number}} [weights] settings.volume
 * @param {readonly number[]} [edges]
 * @returns {{step: number, label: string}[]}
 */
export function bandLegend(weights, edges = WEEK_BAND_EDGES) {
  const w = volumeWeights(weights);
  const used = [w.primary, w.secondary].filter((x) => x > 0);
  const unit = used.every((x) => Number.isInteger(x)) ? 1 : used.every((x) => Number.isInteger(x * 2)) ? 0.5 : null;
  const upTo = (edge) => (unit ? String(edge - unit) : `under ${edge}`);
  const [e4, e3, e2] = edges;
  return [
    { step: 4, label: `${e4}+` },
    { step: 3, label: `${e3}–${upTo(e4)}` },
    { step: 2, label: `${e2}–${upTo(e3)}` },
    { step: 1, label: `Under ${e2}` },
    { step: 0, label: 'None' },
  ];
}
