// Hand-written inline SVG charts. Colours come from CSS classes in trends.css (shared tokens,
// light + dark). Each chart has a readout line above it that follows pointer/tap (hover layer).
import { el, fmtNum, fmtDate } from '../ui/index.js';
import { addDays, daysBetween, weekday } from '../core/dates.js';

const NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** SVG element helper: attributes set with setAttribute, children appended (text as textContent). */
function s(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, String(v));
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return n;
}

const shortDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** ~count nice ticks; the domain is widened to whole steps. @returns {{ticks: number[], step: number, lo: number, hi: number}} */
function niceTicks(lo, hi, count = 4) {
  const span = Math.max(hi - lo, 1e-6);
  const raw = span / count;
  const steps = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const step = steps.find((x) => x >= raw) || raw;
  const a = Math.floor(lo / step + 1e-9) * step;
  const b = Math.ceil(hi / step - 1e-9) * step;
  const ticks = [];
  for (let v = a; v <= b + 1e-9; v += step) ticks.push(Number(v.toFixed(3)));
  return { ticks, step, lo: a, hi: b };
}

/**
 * Pointer → nearest index along x. Mouse: the readout follows the hover and goes back to the default
 * when the pointer leaves. Touch/pen: a tap (or drag) selects the nearest point and it stays selected
 * after the finger lifts, until another point is tapped; a tap away from every point clears it.
 */
function attachHover(svg, W, xs, onPick) {
  let pinned = null;
  const gaps = xs.slice(1).map((v, i) => v - xs[i]);
  const reach = Math.max(14, gaps.length ? (Math.max(...gaps) * 0.6) : 40); // viewBox units
  const nearest = (ev) => {
    const r = svg.getBoundingClientRect();
    if (!r.width || !xs.length) return null;
    const x = ((ev.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    return Math.abs(xs[best] - x) <= reach ? best : null;
  };
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse') return;
    pinned = nearest(ev);
    onPick(pinned);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (ev.pointerType === 'mouse') { onPick(nearest(ev) ?? pinned); return; }
    if (!ev.buttons && ev.pressure === 0) return; // pen hovering
    const i = nearest(ev);
    if (i !== null) { pinned = i; onPick(i); }
  });
  svg.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse') onPick(pinned); });
}

/**
 * Weight chart: raw weigh-ins as dots, trend as a line.
 * @param {{date: string, kg: number, trend: number}[]} rows trend series (all of it, for continuity)
 * @param {string} from first date shown
 * @param {string} to last date shown
 */
export function weightChart(rows, from, to) {
  const W = 340; const H = 200; const L = 34; const R = 8; const T = 10; const B = 26;
  const vis = rows.filter((r) => r.date >= from && r.date <= to);
  const days = Math.max(1, daysBetween(from, to));
  const x = (d) => L + (daysBetween(from, d) / days) * (W - L - R);
  const vals = vis.flatMap((r) => [r.kg, r.trend]);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 1) { const m = (hi + lo) / 2; lo = m - 0.5; hi = m + 0.5; }
  const nt = niceTicks(lo, hi, 4);
  const { ticks, step } = nt;
  lo = nt.lo; hi = nt.hi;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

  const grid = ticks.map((v) => s('g', {},
    s('line', { class: 'tr-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }),
    s('text', { class: 'tr-axis', x: L - 4, y: y(v) + 3, 'text-anchor': 'end' }, fmtNum(v, step < 1 ? 1 : 0))));
  const xTicks = [];
  const nX = 4;
  for (let i = 0; i < nX; i++) {
    const d = addDays(from, Math.round((days * i) / (nX - 1)));
    xTicks.push(s('text', { class: 'tr-axis', x: x(d), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === nX - 1 ? 'end' : 'middle' }, shortDate(d)));
  }
  // include the trend point just before the range so the line enters from the left edge
  const before = rows.filter((r) => r.date < from).pop();
  const linePts = (before ? [{ ...before, date: from }] : []).concat(vis);
  const path = linePts.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)},${y(r.trend).toFixed(1)}`).join('');
  const dots = vis.map((r) => s('circle', { class: 'tr-dot', cx: x(r.date).toFixed(1), cy: y(r.kg).toFixed(1), r: vis.length > 60 ? 2.5 : 3.5 }));
  const cursor = s('line', { class: 'tr-cursor', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
  const ring = s('circle', { class: 'tr-ring', r: 5, visibility: 'hidden' });

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Weight from ${fmtDate(from)} to ${fmtDate(to)}: dots are weigh-ins, the line is the trend` },
    grid, xTicks, s('path', { class: 'tr-trend', d: path }), dots, cursor, ring);

  const last = vis[vis.length - 1];
  const readout = el('div', { class: 'tr-readout small num' });
  const show = (r, isDefault) => {
    readout.textContent = r ? `${isDefault ? 'Latest · ' : ''}${fmtDate(r.date)} · ${fmtNum(r.kg, 1)} kg · trend ${fmtNum(r.trend, 1)} kg` : '';
  };
  attachHover(svg, W, vis.map((r) => x(r.date)), (i) => {
    if (i === null) { cursor.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); show(last, true); return; }
    const r = vis[i];
    cursor.setAttribute('x1', x(r.date)); cursor.setAttribute('x2', x(r.date)); cursor.setAttribute('visibility', 'visible');
    ring.setAttribute('cx', x(r.date)); ring.setAttribute('cy', y(r.trend)); ring.setAttribute('visibility', 'visible');
    show(r, false);
  });
  show(last, true);
  const legend = el('div', { class: 'tr-legend small muted' },
    el('span', { class: 'tr-key tr-key-dot' }), 'Weigh-in', el('span', { class: 'tr-key tr-key-line' }), 'Trend');
  return el('div', { class: 'tr-chart' }, readout, svg, legend);
}

/**
 * Daily intake bars with the target line and Mon–Sun weekly averages.
 * @param {{date: string, kcal: number|null}[]} days consecutive dates (null = nothing logged)
 * @param {number|null} target daily kcal target
 * @param {{from: string, to: string, avg: number|null}[]} weeks weekly averages (complete days only)
 * @param {string} todayStr today's date (drawn lighter: the day is not over)
 */
export function intakeChart(days, target, weeks, todayStr) {
  const W = 340; const H = 200; const L = 38; const R = 6; const T = 10; const B = 22;
  const n = days.length;
  const slot = (W - L - R) / n;
  const x = (i) => L + i * slot;
  const max = Math.max(target || 0, ...days.map((d) => d.kcal || 0), ...weeks.map((w) => w.avg || 0), 1000);
  const { ticks, hi } = niceTicks(0, max * 1.02, 4);
  const y = (v) => T + (1 - v / hi) * (H - T - B);
  const idx = new Map(days.map((d, i) => [d.date, i]));

  const grid = ticks.map((v) => s('g', {},
    s('line', { class: 'tr-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }),
    s('text', { class: 'tr-axis', x: L - 4, y: y(v) + 3, 'text-anchor': 'end' }, fmtNum(v, 0))));
  const bars = days.map((d, i) => {
    if (!d.kcal) return null;
    const h = Math.max(1, y(0) - y(d.kcal));
    return s('rect', { class: d.date === todayStr ? 'tr-bar tr-bar-today' : 'tr-bar', x: (x(i) + 1).toFixed(1), y: y(d.kcal).toFixed(1), width: Math.max(1, slot - 2).toFixed(1), height: h.toFixed(1), rx: 2 });
  });
  const xLabels = days.map((d, i) => (weekday(d.date) === 0
    ? s('text', { class: 'tr-axis', x: x(i) + 1, y: H - 6, 'text-anchor': 'start' }, shortDate(d.date)) : null));
  const avgs = weeks.filter((w) => w.avg).map((w) => {
    const a = idx.has(w.from) ? idx.get(w.from) : 0;
    const b = idx.has(w.to) ? idx.get(w.to) : n - 1;
    return s('line', { class: 'tr-avg', x1: x(a) + 1, x2: x(b + 1) - 1, y1: y(w.avg), y2: y(w.avg) });
  });
  const targetLine = target ? s('line', { class: 'tr-target', x1: L, x2: W - R, y1: y(target), y2: y(target) }) : null;
  const cursor = s('rect', { class: 'tr-col', x: 0, y: T, width: slot, height: H - T - B, visibility: 'hidden' });

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Daily calories for the last ${n} days with target and weekly averages` },
    grid, cursor, bars, targetLine, avgs, xLabels);
  const readout = el('div', { class: 'tr-readout small num' });
  const def = () => { readout.textContent = target ? `Target ${fmtNum(target, 0)} kcal · tap a bar for the day` : 'Tap a bar for the day'; };
  attachHover(svg, W, days.map((_, i) => x(i) + slot / 2), (i) => {
    if (i === null) { cursor.setAttribute('visibility', 'hidden'); def(); return; }
    const d = days[i];
    cursor.setAttribute('x', x(i)); cursor.setAttribute('visibility', 'visible');
    const wk = weeks.find((w) => d.date >= w.from && d.date <= w.to);
    readout.textContent = `${fmtDate(d.date)} · ${d.kcal ? `${fmtNum(d.kcal, 0)} kcal` : 'not logged'}${d.date === todayStr ? ' (so far)' : ''}`
      + `${wk && wk.avg ? ` · week avg ${fmtNum(wk.avg, 0)}` : ''}`;
  });
  def();
  const legend = el('div', { class: 'tr-legend small muted' },
    el('span', { class: 'tr-key tr-key-bar' }), 'Day',
    el('span', { class: 'tr-key tr-key-avg' }), 'Week average',
    target ? [el('span', { class: 'tr-key tr-key-target' }), 'Target'] : null);
  return el('div', { class: 'tr-chart' }, readout, svg, legend);
}

/** Tiny trend sparkline for the dashboard (no axes). */
export function sparkline(rows) {
  const W = 120; const H = 36;
  if (rows.length < 2) return null;
  const vals = rows.map((r) => r.trend);
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  if (hi - lo < 0.5) { const m = (hi + lo) / 2; lo = m - 0.25; hi = m + 0.25; }
  const d0 = rows[0].date; const span = Math.max(1, daysBetween(d0, rows[rows.length - 1].date));
  const path = rows.map((r, i) => `${i ? 'L' : 'M'}${(2 + (daysBetween(d0, r.date) / span) * (W - 4)).toFixed(1)},${(3 + (1 - (r.trend - lo) / (hi - lo)) * (H - 6)).toFixed(1)}`).join('');
  return s('svg', { class: 'tr-spark', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, s('path', { class: 'tr-trend', d: path }));
}
