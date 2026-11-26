// Hand-written inline SVG charts. Colours come from CSS classes in trends.css (shared tokens,
// light + dark). One template for weight and expenditure (faint dots + an accent line, axis on the
// right) and the daily intake bars. Each chart has a readout line above it: mouse hover follows the
// pointer; a tap pins the nearest point until another point is tapped.
import { el, fmtGrouped, fmtDate } from '../ui/index.js';
import { daysBetween, weekday, parseDate } from '../core/dates.js';
import { t } from '../i18n/index.js';
import { dayMonth } from '../i18n/dates.js';

const NS = 'http://www.w3.org/2000/svg';

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

/** Axis date: '20 Oct' (de '20. Okt.', zh '10月20日'). */
export const shortDate = (d) => dayMonth(parseDate(d));

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
 * The trend chart template (weight and expenditure): faint dots, an accent line, gridlines with the
 * axis on the right, the first date and "Today" (or the last date) under it.
 * @param {{
 *   items: {date: string, dot?: number|null, line?: number|null}[],  // by date, ascending (only the range)
 *   lead?: number|null,          // line value just before `from`, so the line enters from the left edge
 *   from: string, to: string, today?: string,
 *   minSpan?: number,            // smallest y span (1 kg, 100 kcal)
 *   axisDecimals?: number,
 *   ariaLabel: string,
 *   readout: (item: object|null) => string,  // null = the default line (nothing picked)
 *   legend?: [string, string],   // [dots, line]
 * }} o
 */
export function trendChart(o) {
  const W = 340; const H = 168; const L = 4; const R = 40; const T = 8; const B = 24;
  const { items, from, to } = o;
  const days = Math.max(1, daysBetween(from, to));
  const x = (d) => L + (daysBetween(from, d) / days) * (W - L - R);
  const vals = items.flatMap((r) => [r.dot, r.line]).concat(o.lead ?? []).filter((v) => typeof v === 'number' && Number.isFinite(v));
  let lo = Math.min(...vals); let hi = Math.max(...vals);
  const minSpan = o.minSpan ?? 1;
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; }
  const nt = niceTicks(lo, hi, 3);
  lo = nt.lo; hi = nt.hi;
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const axisDec = o.axisDecimals ?? (nt.step < 1 ? 1 : 0);

  const grid = nt.ticks.map((v) => s('g', {},
    s('line', { class: 'tr-grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }),
    s('text', { class: 'tr-axis', x: W - R + 6, y: y(v) + 4, 'text-anchor': 'start' }, fmtGrouped(v, axisDec))));
  const xLabels = [
    s('text', { class: 'tr-axis', x: L, y: H - 6, 'text-anchor': 'start' }, shortDate(from)),
    s('text', { class: 'tr-axis', x: W - R, y: H - 6, 'text-anchor': 'end' }, to === o.today ? t('trends.chart.today') : shortDate(to)),
  ];
  const linePts = (o.lead != null ? [{ date: from, line: o.lead }] : []).concat(items.filter((r) => r.line != null));
  const path = linePts.length > 1 ? linePts.map((r, i) => `${i ? 'L' : 'M'}${x(r.date).toFixed(1)},${y(r.line).toFixed(1)}`).join('') : null;
  const dotItems = items.filter((r) => r.dot != null);
  const dots = dotItems.map((r) => s('circle', { class: 'tr-dot', cx: x(r.date).toFixed(1), cy: y(r.dot).toFixed(1), r: dotItems.length > 60 ? 2.25 : 3 }));
  const single = linePts.length === 1 ? s('circle', { class: 'tr-ring', cx: x(linePts[0].date), cy: y(linePts[0].line), r: 4 }) : null;
  const cursor = s('line', { class: 'tr-cursor', x1: 0, x2: 0, y1: T, y2: H - B, visibility: 'hidden' });
  const ring = s('circle', { class: 'tr-ring', r: 5, visibility: 'hidden' });
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.ariaLabel },
    grid, xLabels, dots, path ? s('path', { class: 'tr-trend', d: path }) : null, single, cursor, ring);

  const readout = el('div', { class: 't-sub tr-readout', 'aria-live': 'polite' });
  readout.textContent = o.readout(null);
  attachHover(svg, W, items.map((r) => x(r.date)), (i) => {
    if (i === null) { cursor.setAttribute('visibility', 'hidden'); ring.setAttribute('visibility', 'hidden'); readout.textContent = o.readout(null); return; }
    const r = items[i];
    const cx = x(r.date);
    cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
    const v = r.line ?? r.dot;
    if (v != null) { ring.setAttribute('cx', cx); ring.setAttribute('cy', y(v)); ring.setAttribute('visibility', 'visible'); } else ring.setAttribute('visibility', 'hidden');
    readout.textContent = o.readout(r);
  });
  const legend = o.legend ? el('ul', { class: 'legend legend-row tr-legend' },
    el('li', null, el('span', { class: 'tr-key tr-key-dot', 'aria-hidden': 'true' }), o.legend[0]),
    el('li', null, el('span', { class: 'tr-key tr-key-line', 'aria-hidden': 'true' }), o.legend[1])) : null;
  return el('div', { class: 'tr-chart' }, readout, svg, legend);
}

/**
 * Change of a value over the last 7 / 14 / 30 / 90 days. Cells without data are left out.
 * @param {{label: string, value: string}[]} cells
 */
export function changeTable(cells) {
  if (!cells.length) return null;
  return el('dl', { class: 'tr-chg', style: { '--n': String(cells.length) } }, cells.map((c) => el('div', null,
    el('dt', { class: 't-cap' }, c.label), el('dd', { class: 'tr-chg-val' }, c.value))));
}

/** Two header figures (caps label, number, small unit), the second one optional. */
export function figures(...figs) {
  return el('div', { class: 'tr-figs' }, figs.filter(Boolean).map((f) => el('div', { class: 'tr-fig' },
    el('span', { class: 't-cap muted' }, f.label),
    el('span', { class: 'tr-fig-val' }, f.value, f.unit ? el('small', { class: 'tr-fig-unit' }, f.unit) : null))));
}

/**
 * Daily intake bars with the target line and Mon–Sun weekly averages.
 * @param {{date: string, kcal: number|null}[]} days consecutive dates (null = nothing logged)
 * @param {number|null} target daily kcal target
 * @param {{from: string, to: string, avg: number|null}[]} weeks weekly averages (complete days only)
 * @param {string} todayStr today's date (drawn lighter: the day is not over)
 */
export function intakeChart(days, target, weeks, todayStr) {
  // Geometry is also used by week-view.js (tap a bar → that day): W 340, L 38, R 6.
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
    s('text', { class: 'tr-axis', x: L - 4, y: y(v) + 4, 'text-anchor': 'end' }, fmtGrouped(v))));
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

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': t('trends.chart.intakeAria', { days: n }) },
    grid, cursor, bars, targetLine, avgs, xLabels);
  const readout = el('div', { class: 't-sub tr-readout', 'aria-live': 'polite' });
  const def = () => { readout.textContent = target ? t('trends.chart.intakeDefault', { kcal: fmtGrouped(target) }) : t('trends.chart.tapBar'); };
  attachHover(svg, W, days.map((_, i) => x(i) + slot / 2), (i) => {
    if (i === null) { cursor.setAttribute('visibility', 'hidden'); def(); return; }
    const d = days[i];
    cursor.setAttribute('x', x(i)); cursor.setAttribute('visibility', 'visible');
    const wk = weeks.find((w) => d.date >= w.from && d.date <= w.to);
    const kcal = !d.kcal ? t('trends.chart.notLogged')
      : t(d.date === todayStr ? 'trends.chart.kcalSoFar' : 'trends.chart.kcal', { kcal: fmtGrouped(d.kcal) });
    readout.textContent = [fmtDate(d.date), kcal, wk && wk.avg ? t('trends.chart.weekAvg', { kcal: fmtGrouped(wk.avg) }) : null]
      .filter(Boolean).join(' · ');
  });
  def();
  const legend = el('ul', { class: 'legend legend-row tr-legend' },
    el('li', null, el('span', { class: 'tr-key tr-key-bar', 'aria-hidden': 'true' }), t('trends.chart.legendDay')),
    el('li', null, el('span', { class: 'tr-key tr-key-avg', 'aria-hidden': 'true' }), t('trends.chart.legendWeekAvg')),
    target ? el('li', null, el('span', { class: 'tr-key tr-key-target', 'aria-hidden': 'true' }), t('trends.chart.legendTarget')) : null);
  return el('div', { class: 'tr-chart' }, readout, svg, legend);
}
