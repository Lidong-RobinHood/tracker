// Weight: quick entry for today, the trend chart (dots = weigh-ins, line = trend) with a range switch
// and the change over 7 / 14 / 30 / 90 days, past entries (edit/delete). Route: trends/weight
import * as db from '../db/db.js';
import { el, append, pageHeader, numberInput, field, toast, openSheet, confirmDialog, emptyState, fmtNum, fmtDate, fmtDay,
  cardHeader, segmented, icon, sectionHeader } from '../ui/index.js';
import { today, addDays, isValidDate } from '../core/dates.js';
import { trendSeries, trendAt, weightRate } from '../core/adaptive.js';
import { trendChart, changeTable, figures } from './charts.js';
import { fixed, ensureCss, signed, rateText } from './data.js';
import { MIN_KG, MAX_KG } from '../core/body-weight.js';
import { shownKgChange } from '../core/weight-format.js';
import { dateBox } from '../food/widgets.js';

const RANGES = [{ id: '1m', label: '1M', days: 30, name: '1 month' }, { id: '3m', label: '3M', days: 91, name: '3 months' },
  { id: '1y', label: '1Y', days: 365, name: '1 year' }, { id: 'all', label: 'All', days: null, name: 'All weigh-ins' }];
let rangeId = '1m'; // remembered while the app is open

export async function mountWeight(container) {
  ensureCss();
  container.classList.add('tr-view');
  const header = el('div');
  const body = el('div', { class: 'tr-stack' });
  container.append(header, body);
  let showAll = false;

  async function render() {
    const now = today();
    const weights = (await db.getAll('weights')).sort((a, b) => (a.date < b.date ? -1 : 1));
    const series = trendSeries(weights);
    const todays = weights.find((w) => w.date === now);
    const rate = weights.length ? weightRate(weights, now) : null;
    header.replaceChildren(pageHeader({ title: 'Weight', back: 'trends', info: 'trend',
      subtitle: !weights.length ? null : rate === null ? 'Rate after 1 week' : rateText(rate) }));

    // quick entry
    const input = numberInput({ value: todays ? todays.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2, ariaLabel: "Today's weight", placeholder: '0.0' });
    const save = async () => {
      const kg = input.getNumber();
      if (kg === null) { input.focus(); toast(`Enter a weight between ${MIN_KG} and ${MAX_KG} kg.`, { type: 'error' }); return; }
      await saveWeight(now, kg);
      toast(todays ? 'Weight updated' : 'Weight saved', { type: 'success' });
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const entry = el('section', { class: 'card stack', 'aria-label': "Today's weight" },
      el('div', { class: 'tr-entry' },
        el('div', { class: 'grow' }, field(todays ? 'Today · saved' : 'Today', input, { unit: 'kg' })),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, todays ? 'Update' : 'Save')),
      el('button', { class: 'btn btn-sm btn-ghost tr-left', type: 'button', onClick: () => editSheet(null, render) }, icon('plus', { size: 18 }), 'Add a past day'));

    if (!weights.length) {
      body.replaceChildren(entry, el('div', { class: 'card' }, emptyState('No weigh-ins yet. Weigh in each morning before eating.')));
      return;
    }

    // chart card
    const parts = weightChart({ weights, series, now, range: rangeId, onRange: (v) => { rangeId = v; render(); } });
    const chartCard = el('section', { class: 'card tr-chart-card', 'aria-label': 'Weight trend' },
      cardHeader('Trend', { trail: parts.seg }), parts.figures, parts.chart, parts.changes);

    // list
    const desc = [...series].reverse();
    const shown = showAll ? desc : desc.slice(0, 14);
    const list = el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      shown.map((r) => el('button', { type: 'button', class: 'list-item', 'aria-label': `${fmtDate(r.date)}, ${fixed(r.kg, 1)} kg. Edit`, onClick: () => editSheet(r, render) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, fmtDay(r.date)), el('div', { class: 'li-sub' }, `trend ${fixed(r.trend, 1)} kg`)),
        el('span', { class: 'li-trail' }, `${fixed(r.kg, 1)} kg`),
        icon('chevron-right', { class: 'li-chevron' }))),
      !showAll && desc.length > shown.length
        ? el('button', { type: 'button', class: 'list-item tr-more', onClick: () => { showAll = true; render(); } }, `Show all ${desc.length}`)
        : null));

    body.replaceChildren(entry, chartCard,
      el('section', { class: 'section' }, sectionHeader('Weigh-ins', { trail: `${desc.length}` }), list));
  }

  await render();
}

/**
 * The weight chart with its range switch, the two header figures (trend, change over the range) and the
 * 7 / 14 / 30 / 90-day changes. Used here and, compact, on the Trends dashboard.
 * Changes are computed from the displayed (1-decimal) trend values (core/weight-format.js).
 * @param {{weights: object[], series: object[], now: string, range: string, onRange: (id: string) => void, ranges?: object[]}} o
 */
export function weightChart({ weights, series, now, range: id, onRange, ranges = RANGES }) {
  const range = ranges.find((r) => r.id === id) || ranges[0];
  const from = range.days ? addDays(now, -(range.days - 1)) : (weights[0].date < addDays(now, -6) ? weights[0].date : addDays(now, -6));
  const inRange = series.filter((r) => r.date >= from);
  const trendNow = trendAt(series, now);
  const before = series.filter((r) => r.date < from).pop();
  const startTrend = before ? before.trend : inRange.length ? inRange[0].trend : null;
  const seg = segmented({ small: true, ariaLabel: 'Chart range', value: range.id,
    options: ranges.map((r) => ({ value: r.id, label: r.label, ariaLabel: r.name })), onChange: onRange });
  const last = series[series.length - 1];
  const chart = inRange.length
    ? trendChart({
      items: inRange.map((r) => ({ date: r.date, dot: r.kg, line: r.trend })),
      lead: before ? before.trend : null, from, to: now, today: now, minSpan: 1,
      ariaLabel: `Weight from ${fmtDate(from)} to ${fmtDate(now)}: dots are weigh-ins, the line is the trend`,
      readout: (r) => (r ? `${fmtDate(r.date)} · ${fixed(r.dot, 1)} kg · trend ${fixed(r.line, 1)} kg`
        : `Latest ${fmtDay(last.date)} · ${fixed(last.kg, 1)} kg · trend ${fixed(last.trend, 1)} kg`),
      legend: ['Weigh-in', 'Trend'],
    })
    : el('p', { class: 't-sub muted' }, 'No weigh-ins in this range.');
  const changes = trendNow === null ? [] : [7, 14, 30, 90].map((n) => {
    const base = trendAt(series, addDays(now, -n));
    return base === null || series[0].date > addDays(now, -n) ? null : { label: `${n} d`, value: `${signed(shownKgChange(trendNow, base), 1)} kg` };
  }).filter(Boolean);
  const change = shownKgChange(trendNow, startTrend);
  return {
    seg,
    figures: figures(
      { label: 'Trend', value: trendNow === null ? '–' : fixed(trendNow, 1), unit: 'kg' },
      { label: `Change · ${range.label}`, value: change === null ? '–' : signed(change, 1), unit: 'kg' }),
    chart,
    changes: changeTable(changes),
  };
}

async function saveWeight(date, kg) {
  await db.put('weights', { date, kg: Math.round(kg * 100) / 100, updatedAt: Date.now() });
}

/** Add (row null) or edit/delete a weigh-in. */
function editSheet(row, onDone) {
  const isNew = !row;
  const date = el('input', { class: 'input', type: 'date', value: row ? row.date : addDays(today(), -1), max: today(), 'aria-label': 'Date' });
  if (!isNew) date.disabled = true;
  const kg = numberInput({ value: row ? row.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2, ariaLabel: 'Weight' });
  const sheet = openSheet({ title: isNew ? 'Add weigh-in' : `Weigh-in · ${fmtDate(row.date)}` });
  append(sheet.body, isNew ? field('Date', dateBox(date)) : null, field('Weight', kg, { unit: 'kg' }));
  let busy = false;
  const save = async () => {
    if (busy) return;
    busy = true;
    try { await doSave(); } finally { busy = false; }
  };
  const doSave = async () => {
    const d = date.value;
    const v = kg.getNumber();
    if (!isValidDate(d) || d > today()) { toast('Pick a valid date (not in the future).', { type: 'error' }); return; }
    if (v === null) { kg.focus(); toast(`Enter a weight between ${MIN_KG} and ${MAX_KG} kg.`, { type: 'error' }); return; }
    if (isNew && await db.get('weights', d)) {
      const ok = await confirmDialog({ title: 'Replace weigh-in?', message: `${fmtDate(d)} already has a weight. Replace it?`, confirmLabel: 'Replace' });
      if (!ok) return;
    }
    await saveWeight(d, v);
    sheet.close();
    toast('Weight saved', { type: 'success' });
    onDone();
  };
  const del = async () => {
    const old = await db.get('weights', row.date);
    await db.remove('weights', row.date);
    sheet.close();
    onDone();
    toast('Weigh-in deleted', { action: { label: 'Undo', onClick: async () => { if (old) await db.put('weights', old); onDone(); } } });
  };
  append(sheet.footer,
    isNew ? null : el('button', { class: 'btn btn-danger', type: 'button', onClick: del }, icon('trash-2', { size: 18 }), 'Delete'),
    el('div', { class: 'grow' }),
    el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save'));
  setTimeout(() => kg.focus(), 50);
}
