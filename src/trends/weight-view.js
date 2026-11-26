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
import { t } from '../i18n/index.js';

// Labels: trends.range.<id> (short) and trends.range.<id>Name (spoken).
const RANGES = [{ id: '1m', days: 30 }, { id: '3m', days: 91 }, { id: '1y', days: 365 }, { id: 'all', days: null }];
export const rangeLabel = (r) => t(`trends.range.${r.id}`);
export const rangeName = (r) => t(`trends.range.${r.nameId || r.id}Name`);
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
    header.replaceChildren(pageHeader({ title: t('trends.weight.title'), back: 'trends', info: 'trend',
      subtitle: !weights.length ? null : rate === null ? t('trends.weight.rateAfterWeek') : rateText(rate) }));

    // quick entry
    const input = numberInput({ value: todays ? todays.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2, ariaLabel: t('trends.weight.todayAria'), placeholder: '0.0' });
    const save = async () => {
      const kg = input.getNumber();
      if (kg === null) { input.focus(); toast(t('trends.weight.errorRange', { min: MIN_KG, max: MAX_KG }), { type: 'error' }); return; }
      await saveWeight(now, kg);
      toast(t(todays ? 'trends.weight.updated' : 'trends.weight.saved'), { type: 'success' });
      render();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    const entry = el('section', { class: 'card stack', 'aria-label': t('trends.weight.todayAria') },
      el('div', { class: 'tr-entry' },
        el('div', { class: 'grow' }, field(t(todays ? 'trends.weight.todaySaved' : 'trends.weight.today'), input, { unit: 'kg' })),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, t(todays ? 'trends.weight.update' : 'trends.weight.save'))),
      el('button', { class: 'btn btn-sm btn-ghost tr-left', type: 'button', onClick: () => editSheet(null, render) }, icon('plus', { size: 18 }), t('trends.weight.addPast')));

    if (!weights.length) {
      body.replaceChildren(entry, el('div', { class: 'card' }, emptyState(t('trends.weight.empty'))));
      return;
    }

    // chart card
    const parts = weightChart({ weights, series, now, range: rangeId, onRange: (v) => { rangeId = v; render(); } });
    const chartCard = el('section', { class: 'card tr-chart-card', 'aria-label': t('trends.weight.trendAria') },
      cardHeader(t('trends.weight.trend'), { trail: parts.seg }), parts.figures, parts.chart, parts.changes);

    // list
    const desc = [...series].reverse();
    const shown = showAll ? desc : desc.slice(0, 14);
    const list = el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      shown.map((r) => el('button', { type: 'button', class: 'list-item', 'aria-label': t('trends.weight.rowAria', { date: fmtDate(r.date), kg: fixed(r.kg, 1) }), onClick: () => editSheet(r, render) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, fmtDay(r.date)), el('div', { class: 'li-sub' }, t('trends.weight.rowTrend', { kg: fixed(r.trend, 1) }))),
        el('span', { class: 'li-trail' }, `${fixed(r.kg, 1)} kg`),
        icon('chevron-right', { class: 'li-chevron' }))),
      !showAll && desc.length > shown.length
        ? el('button', { type: 'button', class: 'list-item tr-more', onClick: () => { showAll = true; render(); } }, t('trends.weight.showAll', { count: desc.length }))
        : null));

    body.replaceChildren(entry, chartCard,
      el('section', { class: 'section' }, sectionHeader(t('trends.weight.weighIns'), { trail: `${desc.length}` }), list));
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
  const seg = segmented({ small: true, ariaLabel: t('trends.range.aria'), value: range.id,
    options: ranges.map((r) => ({ value: r.id, label: rangeLabel(r), ariaLabel: rangeName(r) })), onChange: onRange });
  const last = series[series.length - 1];
  const chart = inRange.length
    ? trendChart({
      items: inRange.map((r) => ({ date: r.date, dot: r.kg, line: r.trend })),
      lead: before ? before.trend : null, from, to: now, today: now, minSpan: 1,
      ariaLabel: t('trends.weight.chartAria', { from: fmtDate(from), to: fmtDate(now) }),
      readout: (r) => (r ? t('trends.weight.readout', { date: fmtDate(r.date), kg: fixed(r.dot, 1), trend: fixed(r.line, 1) })
        : t('trends.weight.readoutLatest', { date: fmtDay(last.date), kg: fixed(last.kg, 1), trend: fixed(last.trend, 1) })),
      legend: [t('trends.weight.legendWeighIn'), t('trends.weight.legendTrend')],
    })
    : el('p', { class: 't-sub muted' }, t('trends.weight.noneInRange'));
  const changes = trendNow === null ? [] : [7, 14, 30, 90].map((n) => {
    const base = trendAt(series, addDays(now, -n));
    return base === null || series[0].date > addDays(now, -n) ? null : { label: t('trends.chg.days', { n }), value: `${signed(shownKgChange(trendNow, base), 1)} kg` };
  }).filter(Boolean);
  const change = shownKgChange(trendNow, startTrend);
  return {
    seg,
    figures: figures(
      { label: t('trends.weight.trend'), value: trendNow === null ? '–' : fixed(trendNow, 1), unit: 'kg' },
      { label: t('trends.weight.changeRange', { range: rangeLabel(range) }), value: change === null ? '–' : signed(change, 1), unit: 'kg' }),
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
  const date = el('input', { class: 'input', type: 'date', value: row ? row.date : addDays(today(), -1), max: today(), 'aria-label': t('trends.weight.date') });
  if (!isNew) date.disabled = true;
  const kg = numberInput({ value: row ? row.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2, ariaLabel: t('trends.weight.weight') });
  const sheet = openSheet({ title: isNew ? t('trends.weight.addTitle') : t('trends.weight.editTitle', { date: fmtDate(row.date) }) });
  append(sheet.body, isNew ? field(t('trends.weight.date'), dateBox(date)) : null, field(t('trends.weight.weight'), kg, { unit: 'kg' }));
  let busy = false;
  const save = async () => {
    if (busy) return;
    busy = true;
    try { await doSave(); } finally { busy = false; }
  };
  const doSave = async () => {
    const d = date.value;
    const v = kg.getNumber();
    if (!isValidDate(d) || d > today()) { toast(t('trends.weight.errorDate'), { type: 'error' }); return; }
    if (v === null) { kg.focus(); toast(t('trends.weight.errorRange', { min: MIN_KG, max: MAX_KG }), { type: 'error' }); return; }
    if (isNew && await db.get('weights', d)) {
      const ok = await confirmDialog({ title: t('trends.weight.replaceTitle'), message: t('trends.weight.replaceMessage', { date: fmtDate(d) }), confirmLabel: t('trends.weight.replace') });
      if (!ok) return;
    }
    await saveWeight(d, v);
    sheet.close();
    toast(t('trends.weight.saved'), { type: 'success' });
    onDone();
  };
  const del = async () => {
    const old = await db.get('weights', row.date);
    await db.remove('weights', row.date);
    sheet.close();
    onDone();
    toast(t('trends.weight.deleted'), { action: { label: t('trends.weight.undo'), onClick: async () => { if (old) await db.put('weights', old); onDone(); } } });
  };
  append(sheet.footer,
    isNew ? null : el('button', { class: 'btn btn-danger', type: 'button', onClick: del }, icon('trash-2', { size: 18 }), t('trends.weight.delete')),
    el('div', { class: 'grow' }),
    el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, t('trends.weight.save')));
  setTimeout(() => kg.focus(), 50);
}
