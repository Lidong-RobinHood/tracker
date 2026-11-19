// Small hand-written charts for the post-workout analytics screen. Inline SVG / plain elements,
// colours from shared tokens via wk-an-* classes (light + dark). Labelled directly, no gridlines,
// no legends. No data ever goes through innerHTML.
import { el } from '../ui/index.js';
import { shortDate } from './data.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

/**
 * Session trend: one point per session (evenly spaced, oldest left), this workout highlighted,
 * the all-time best as a dashed reference line. Labels: this workout's value and the best, at the
 * right; first and last date below.
 * @param {{points: {date: string, value: number, current: boolean}[], best: number|null,
 *   format: (v: number) => string, record: boolean, ariaLabel: string}} opts
 */
export function trendChart({ points, best, format, record, ariaLabel }) {
  const W = 340; const H = 96;
  const L = 6; const R = 92; const T = 12; const B = 20;
  const n = points.length;
  const vals = points.map((p) => p.value).concat(Number.isFinite(best) ? [best] : []);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi === lo) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;
  const x = (i) => (n > 1 ? L + (i / (n - 1)) * (W - L - R) : (W - R) / 2);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const cur = points.find((p) => p.current) || points[n - 1];
  const ci = points.indexOf(cur);
  const cy = y(cur.value);
  const labels = [];
  const lx = x(ci) + 10;
  if (Number.isFinite(best)) {
    const by = y(best);
    if (best === cur.value) {
      labels.push(s('text', { class: ['wk-an-ch-val', record && 'is-rec'].filter(Boolean).join(' '), x: lx, y: cy + 4 }, `${format(cur.value)} · best`));
    } else {
      let ty = by; let vy = cy;
      if (Math.abs(vy - ty) < 13) { ty = Math.min(ty, vy) - 3; vy = ty + 13; }
      labels.push(s('text', { class: 'wk-an-ch-lab', x: lx, y: ty + 4 }, `best ${format(best)}`));
      labels.push(s('text', { class: 'wk-an-ch-val', x: lx, y: vy + 4 }, format(cur.value)));
    }
  } else {
    labels.push(s('text', { class: 'wk-an-ch-val', x: lx, y: cy + 4 }, format(cur.value)));
  }

  return s('svg', { class: 'wk-an-chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': ariaLabel, preserveAspectRatio: 'xMidYMid meet' },
    Number.isFinite(best) ? s('line', { class: 'wk-an-ch-ref', x1: L, x2: x(n - 1), y1: y(best), y2: y(best) }) : null,
    n > 1 ? s('polyline', { class: 'wk-an-ch-line', points: points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ') }) : null,
    points.map((p, i) => s('circle', {
      class: ['wk-an-ch-dot', p.current && 'is-cur', p.current && record && 'is-rec'].filter(Boolean).join(' '),
      cx: x(i).toFixed(1), cy: y(p.value).toFixed(1), r: p.current ? 4 : 2.5,
    }, s('title', {}, `${shortDate(p.date)}: ${format(p.value)}`))),
    labels,
    s('text', { class: 'wk-an-ch-lab', x: L, y: H - 4, 'text-anchor': 'start' }, shortDate(points[0].date)),
    n > 1 ? s('text', { class: 'wk-an-ch-lab', x: x(n - 1), y: H - 4, 'text-anchor': 'end' }, shortDate(points[n - 1].date)) : null);
}

/**
 * Horizontal bars, labelled at both ends.
 * @param {{label: string, value: number, text: string}[]} rows
 */
export function hBars(rows) {
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return el('div', { class: 'wk-an-hbars' }, rows.map((r) => el('div', { class: 'wk-an-hbar' },
    el('span', { class: 'wk-an-hbar-name' }, r.label),
    el('span', { class: 'wk-an-hbar-track', 'aria-hidden': 'true' },
      el('span', { class: 'wk-an-hbar-fill', style: { width: `${Math.max(1, (r.value / max) * 100).toFixed(1)}%` } })),
    el('span', { class: 'wk-an-hbar-val num' }, r.text))));
}

/**
 * Vertical bars per session, value above each bar, date below; the current one in full contrast.
 * @param {{date: string, value: number, text: string, current: boolean}[]} bars oldest first
 * @param {string} ariaLabel
 */
export function vBars(bars, ariaLabel) {
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  return el('div', { class: 'wk-an-vbars', role: 'img', 'aria-label': ariaLabel },
    bars.map((b) => el('div', { class: ['wk-an-vbar', b.current && 'is-cur'], 'aria-hidden': 'true' },
      el('span', { class: 'wk-an-vbar-val num' }, b.text),
      el('span', { class: 'wk-an-vbar-col' },
        el('span', { class: 'wk-an-vbar-fill', style: { height: `${Math.max(2, (b.value / max) * 100).toFixed(1)}%` } })),
      el('span', { class: 'wk-an-vbar-date' }, shortDate(b.date).replace(/ \d{4}$/, '')))));
}
