// Hand-written inline SVG line chart for progress screens. Colours come from the shared CSS tokens
// (classes in workout.css), so it follows light and dark mode. No data ever goes through innerHTML.
import { daysBetween } from '../core/dates.js';
import { shortDate } from './data.js';

const NS = 'http://www.w3.org/2000/svg';

/** createElementNS with attributes and children. */
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

/** ~4 "nice" ticks covering [min, max]. */
function niceTicks(min, max) {
  if (min === max) { const d = Math.abs(min) * 0.1 || 1; min -= d; max += d; }
  const raw = (max - min) / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((x) => x >= raw) || 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/**
 * @param {{points: {date: string, value: number, mark?: boolean, label?: string}[], format: (v: number) => string,
 *   ariaLabel: string, zero?: boolean}} opts points chronological; mark = highlighted (e.g. PR);
 *   zero = include 0 on the y axis
 * @returns {SVGSVGElement}
 */
export function lineChart({ points, format, ariaLabel, zero = false }) {
  const W = 340; const H = 168;
  const L = 44; const R = 14; const T = 12; const B = 24;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(zero ? Math.min(0, ...vals) : Math.min(...vals), Math.max(...vals));
  const y0 = ticks[0]; const y1 = ticks[ticks.length - 1];
  const span = points.length > 1 ? Math.max(1, daysBetween(points[0].date, points[points.length - 1].date)) : 0;
  const x = (p) => (span ? L + (daysBetween(points[0].date, p.date) / span) * (W - L - R) : (L + W - R) / 2);
  const y = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);

  const grid = ticks.map((t) => s('g', {},
    s('line', { class: 'wk-ch-grid', x1: L, x2: W - R, y1: y(t), y2: y(t) }),
    s('text', { class: 'wk-ch-label', x: L - 6, y: y(t) + 3.5, 'text-anchor': 'end' }, format(t))));
  const xs = points.length
    ? [s('text', { class: 'wk-ch-label', x: L, y: H - 6, 'text-anchor': 'start' }, shortDate(points[0].date).replace(/ /g, ' ')),
      points.length > 1 ? s('text', { class: 'wk-ch-label', x: W - R, y: H - 6, 'text-anchor': 'end' }, shortDate(points[points.length - 1].date).replace(/ /g, ' ')) : null]
    : [];
  const path = points.length > 1
    ? s('polyline', { class: 'wk-ch-line', points: points.map((p) => `${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') })
    : null;
  const showDots = points.length <= 40;
  const dots = points.map((p, i) => {
    const last = i === points.length - 1;
    if (!showDots && !p.mark && !last) return null;
    return s('circle', { class: ['wk-ch-dot', p.mark && 'is-mark', last && 'is-last'].filter(Boolean).join(' '), cx: x(p).toFixed(1), cy: y(p.value).toFixed(1), r: p.mark || last ? 4 : 3 },
      s('title', {}, `${shortDate(p.date).replace(/ /g, ' ')}: ${p.label || format(p.value)}`));
  });
  return s('svg', { class: 'wk-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel, preserveAspectRatio: 'xMidYMid meet' },
    grid, xs, path, dots);
}
