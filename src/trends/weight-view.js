// Weight: quick entry for today, chart (raw + trend) with range switch, past entries (edit/delete).
// Route: trends/weight
import * as db from '../db/db.js';
import { el, append, pageHeader, numberInput, field, toast, openSheet, confirmDialog, emptyState, fmtNum, fmtDate, fmtDay } from '../ui/index.js';
import { today, addDays, isValidDate } from '../core/dates.js';
import { trendSeries, trendAt, weightRate } from '../core/adaptive.js';
import { weightChart } from './charts.js';
import { ensureCss, signed } from './data.js';

const RANGES = [{ id: '1m', label: '1 M', days: 30 }, { id: '3m', label: '3 M', days: 91 }, { id: 'all', label: 'All', days: null }];
let rangeId = '1m'; // remembered while the app is open
import { MIN_KG, MAX_KG } from '../core/body-weight.js';

export async function mountWeight(container) {
  ensureCss();
  container.append(pageHeader({ title: 'Weight', back: 'trends' }));
  const body = el('div', { class: 'stack' });
  container.append(body);
  let showAll = false;

  async function render() {
    const now = today();
    const weights = (await db.getAll('weights')).sort((a, b) => (a.date < b.date ? -1 : 1));
    const series = trendSeries(weights);
    const todays = weights.find((w) => w.date === now);

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
        el('div', { class: 'grow' }, field(todays ? 'Today (saved)' : 'Today', input, { unit: 'kg' })),
        el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, todays ? 'Update' : 'Save')),
      el('button', { class: 'btn btn-sm btn-ghost tr-left', type: 'button', onClick: () => editSheet(null, render) }, '+ Add a past day'));

    if (!weights.length) {
      body.replaceChildren(entry, el('div', { class: 'card' }, emptyState('No weigh-ins yet. Weigh yourself in the morning, after the toilet and before eating, and log it here. The trend appears from the second weigh-in.')));
      return;
    }

    // stats
    const trendNow = trendAt(series, now);
    const rate = weightRate(weights, now);
    const stats = el('div', { class: 'grid-3 tr-stats' },
      stat('Trend', trendNow === null ? '–' : `${fmtNum(trendNow, 1)}`, 'kg'),
      stat('Per week', rate === null ? '–' : signed(rate, 2), rate === null ? 'needs 1 wk' : 'kg'),
      stat('Latest', fmtNum(weights[weights.length - 1].kg, 1), fmtDay(weights[weights.length - 1].date)));

    // chart
    const range = RANGES.find((r) => r.id === rangeId);
    const from = range.days ? addDays(now, -(range.days - 1)) : (weights[0].date < addDays(now, -6) ? weights[0].date : addDays(now, -6));
    const inRange = series.filter((r) => r.date >= from);
    const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Range' },
      RANGES.map((r) => el('button', { type: 'button', role: 'tab', 'aria-selected': r.id === rangeId ? 'true' : 'false',
        onClick: () => { rangeId = r.id; render(); } }, r.label)));
    const chart = inRange.length
      ? weightChart(series, from, now)
      : el('p', { class: 'muted small' }, 'No weigh-ins in this range.');

    // list
    const desc = [...series].reverse();
    const shown = showAll ? desc : desc.slice(0, 14);
    const list = el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      shown.map((r) => el('button', { type: 'button', class: 'list-item', onClick: () => editSheet(r, render) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, fmtDay(r.date)), el('div', { class: 'li-sub num' }, `trend ${fmtNum(r.trend, 1)} kg`)),
        el('span', { class: 'li-trail num' }, `${fmtNum(r.kg, 1)} kg`),
        el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))),
      !showAll && desc.length > shown.length
        ? el('button', { type: 'button', class: 'list-item tr-more', onClick: () => { showAll = true; render(); } }, `Show all ${desc.length}`)
        : null));

    body.replaceChildren(entry, stats,
      el('section', { class: 'card stack' }, tabs, chart),
      el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Weigh-ins'), list),
      el('p', { class: 'muted small tr-note' }, 'The trend is a moving average that smooths out day-to-day water swings. Watch the trend, not single days.'));
  }

  await render();
}

function stat(label, value, sub) {
  return el('div', { class: 'card tr-stat' },
    el('div', { class: 'small muted' }, label),
    el('div', { class: 'tr-stat-val num' }, value),
    el('div', { class: 'small muted truncate' }, sub));
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
  const sheet = openSheet({ title: isNew ? 'Add weigh-in' : `Weigh-in ${fmtDate(row.date)}` });
  append(sheet.body, isNew ? field('Date', date) : null, field('Weight', kg, { unit: 'kg' }));
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
    isNew ? null : el('button', { class: 'btn btn-danger', type: 'button', onClick: del }, 'Delete'),
    el('div', { class: 'grow' }),
    el('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save'));
  setTimeout(() => kg.focus(), 50);
}
