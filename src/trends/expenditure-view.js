// Expenditure: the trend chart template (line = expenditure estimate per day, dots = complete-day
// intake), its data basis, the weekly check-in as one card (Accept / Keep current) and the target
// history. Route: trends/expenditure
import { el, replaceChildren, pageHeader, toast, fmtGrouped, fmtNum, fmtDate, href, cardHeader, sectionHeader, segmented, tag,
  infoButton, icon } from '../ui/index.js';
import { addDays } from '../core/dates.js';
import { adaptiveConfig, estimateExpenditure, classifyIntake, displayTdee } from '../core/adaptive.js';
import { trendChart, changeTable, figures } from './charts.js';
import { weekRange } from './week-view.js';
import { fixed, ensureCss, loadTrendsData, answerCheckIn, signed, goalText, tdeeText, confidenceText } from './data.js';

const RANGES = [{ id: '1m', label: '1M', days: 28, name: '4 weeks' }, { id: '3m', label: '3M', days: 91, name: '3 months' }];
let rangeId = '1m';

export async function mountExpenditure(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: 'Expenditure', back: 'trends', info: 'expenditure' }));
  const body = el('div', { class: 'tr-stack' });
  container.append(body);
  let series = null; // estimates per day, computed once per mount (same function as today's estimate)

  async function render() {
    const d = await loadTrendsData();
    if (!series) series = estimateSeries(d);
    replaceChildren(body,
      estimateCard(d, series, render),
      basisCard(d),
      checkInCard(d, async (decision) => {
        try {
          const rec = await answerCheckIn(d.checkIn, decision);
          toast(decision === 'accepted' ? `New target: ${fmtGrouped(rec.history.kcalTarget)} kcal / day` : 'Kept your current targets', { type: 'success' });
        } catch (err) {
          console.error(err);
          toast(`Could not save: ${err.message}`, { type: 'error' });
        }
        render();
      }),
      historySection(d.history));
  }
  await render();
}

/** Expenditure estimate for each of the last 91 days (display only: the same estimate as on that day). */
export function estimateSeries(d, days = 91) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const asOf = addDays(d.today, -i);
    const e = i === 0 ? d.estimate : estimateExpenditure({ weights: d.weights, intake: d.intake, asOf, profile: d.profile, config: d.config });
    if (e.status === 'ok') out.push({ date: asOf, tdee: e.tdee });
  }
  return out;
}

// ---------------------------------------------------------------- estimate

function estimateCard(d, series, rerender) {
  const e = d.estimate;
  if (e.status !== 'ok') {
    const kids = [cardHeader('Estimate', { tag: e.formula ? 'Formula estimate' : null })];
    if (e.formula) {
      kids.push(figures({ label: 'Expenditure · not from your data', value: tdeeText(e.formula.kcal), unit: 'kcal / day' }));
    }
    kids.push(el('p', { class: 't-sub strong tr-needed' }, 'Still needed:'),
      el('ul', { class: 'tr-missing t-sub' }, e.missing.map((m) => el('li', null, m))));
    if (!e.formula) {
      kids.push(el('p', { class: 't-sub muted' }, 'Add your profile in ', el('a', { href: href('settings/goal') }, 'Settings'), ' for a formula estimate.'));
    }
    return el('section', { class: 'card tr-chart-card', 'aria-label': 'Expenditure estimate' }, kids);
  }

  const parts = expenditureChart(d, series, { range: rangeId, onRange: (v) => { rangeId = v; rerender(); } });
  return el('section', { class: 'card tr-chart-card', 'aria-label': 'Expenditure estimate' },
    cardHeader('Estimate', { trail: parts.seg }), parts.figures, parts.tag, parts.chart, parts.changes);
}

/**
 * The expenditure chart (line = estimate per day, dots = complete-day intake) with its range switch, two
 * header figures and the 7 / 14 / 30 / 90-day changes. Used here and, compact, on the Trends dashboard
 * (`second`: the figure next to expenditure, intake average here, the target there). Needs d.estimate ok.
 * @param {object} d loadTrendsData() @param {{date: string, tdee: number}[]} series estimateSeries()
 * @param {{range: string, onRange: (id: string) => void, second?: {label: string, value: string, unit: string}}} o
 */
export function expenditureChart(d, series, { range: id, onRange, second = null }) {
  const e = d.estimate;
  const range = RANGES.find((r) => r.id === id) || RANGES[0];
  const seg = segmented({ small: true, ariaLabel: 'Chart range', value: range.id,
    options: RANGES.map((r) => ({ value: r.id, label: r.label, ariaLabel: r.name })), onChange: onRange });
  const from = addDays(d.today, -(range.days - 1));
  const valid = new Map(classifyIntake(d.intake, d.today, d.config).filter((r) => r.valid).map((r) => [r.date, r.kcal]));
  const est = new Map(series.map((r) => [r.date, r.tdee]));
  const dates = [...new Set([...est.keys(), ...valid.keys()])].filter((x) => x >= from && x <= d.today).sort();
  const items = dates.map((date) => ({ date, dot: valid.get(date) ?? null, line: est.has(date) ? displayTdee(est.get(date)) : null }));
  const now = displayTdee(e.tdee);
  const changes = [7, 14, 30, 90].map((n) => {
    const base = est.get(addDays(d.today, -n));
    return base === undefined ? null : { label: `${n} d`, value: `${signed(now - displayTdee(base), 0)} kcal` };
  }).filter(Boolean);
  const intakeAvg = e.basis.meanIntake;
  return {
    seg,
    figures: figures(
      { label: 'Expenditure', value: tdeeText(e.tdee), unit: 'kcal / day' },
      second || { label: 'Intake avg', value: intakeAvg === null ? '–' : fmtGrouped(intakeAvg), unit: 'kcal / day' }),
    tag: el('div', { class: 'tr-tagrow' }, tag(confidenceText(e), { tone: e.confidence === 'low' ? 'warn' : 'neutral' }),
      e.confidence === 'low' ? el('span', { class: 't-sub muted' }, 'low confidence') : null),
    chart: items.some((r) => r.line !== null)
      ? trendChart({
        items, from, to: d.today, today: d.today, minSpan: 100, axisDecimals: 0,
        ariaLabel: `Expenditure from ${fmtDate(from)} to ${fmtDate(d.today)}: the line is the estimate, dots are complete-day intake`,
        readout: (r) => (r
          ? [fmtDate(r.date), r.line !== null ? `expenditure ${fmtGrouped(r.line)} kcal` : null, r.dot !== null ? `intake ${fmtGrouped(r.dot)} kcal` : 'no complete day'].filter(Boolean).join(' · ')
          : 'Tap a day'),
        legend: ['Intake, complete days', 'Expenditure'],
      })
      : null,
    changes: changeTable(changes),
  };
}

function basisCard(d) {
  const b = d.estimate.basis;
  const row = (label, value, info) => el('div', { class: 'tr-row' },
    el('span', { class: 'tr-row-label' }, label, info || null), el('span', { class: 'tr-row-value' }, value));
  return el('section', { class: 'card tr-basis', 'aria-label': 'Data basis, last 28 days' },
    cardHeader('Basis', { trail: el('span', { class: 't-sub muted' }, 'last 28 days') }),
    row('Weigh-ins', `${b.weighIns}`),
    row('Complete days', `${b.loggedDays}${b.incompleteDays ? ` (+${b.incompleteDays} incomplete)` : ''}`, infoButton('complete')),
    row('Average intake', b.meanIntake === null ? '–' : `${fmtGrouped(b.meanIntake)} kcal`),
    row('Trend weight', b.trendKg === null ? '–' : `${fixed(b.trendKg, 1)} kg`),
    row('Weight change', b.rateKgPerWeek === null ? '–' : `${signed(b.rateKgPerWeek, 2)} kg / week`));
}

// ---------------------------------------------------------------- check-in

function checkInCard(d, answer) {
  const ci = d.checkIn;
  const done = d.doneThisWeek;
  const head = cardHeader(`Check-in · ${fmtDate(ci.weekStart)}`, { info: 'checkin' });
  const fig = (label, v) => el('div', { class: 'tr-row' }, el('span', { class: 'tr-row-label' }, label), el('span', { class: 'tr-row-value' }, v));
  const review = el('div', { class: 'tr-review' },
    el('div', { class: 't-cap muted' }, `Last week · ${weekRange(ci.reviewFrom)}`),
    fig('Average intake', ci.avgIntake === null ? 'nothing logged' : `${fmtGrouped(ci.avgIntake)} kcal · ${ci.daysLogged} day${ci.daysLogged === 1 ? '' : 's'}`),
    // A change over one week, i.e. a rate: two decimals, like the goal next to it.
    fig('Trend change', ci.trendChange === null ? '–' : `${signed(ci.trendChange, 2)} kg / week`),
    fig(ci.basisKind === 'formula' ? 'Expenditure (formula)' : 'Expenditure', ci.tdee === null ? 'not available' : `${tdeeText(ci.tdee)} kcal`),
    el('div', { class: 'tr-row' }, el('span', { class: 'tr-row-label' }, 'Goal'),
      el('span', { class: 'tr-row-value' }, goalText(d.goal.rateKgPerWeek)),
      el('a', { class: 'btn btn-sm btn-ghost tr-row-action', href: href('settings/goal'), 'aria-label': 'Change goal in Settings' }, 'Change')));

  if (!ci.proposal) {
    return el('section', { class: 'card tr-checkin', id: 'checkin', 'aria-label': 'Weekly check-in' }, head, review,
      el('p', { class: 't-sub muted' }, ci.noProposal === 'no-weight'
        ? 'Log a weigh-in to get a proposal.'
        : ['No proposal yet. Add your profile in ', el('a', { href: href('settings/goal') }, 'Settings'), ' for a formula-based one.']));
  }

  const p = ci.proposal;
  const t = d.targets;
  const diff = p.kcal - t.kcal;
  const hero = el('div', { class: 'tr-hero' },
    el('span', { class: 't-hero' }, fmtGrouped(p.kcal)), el('span', { class: 't-sub muted' }, 'kcal / day'),
    diff ? tag(`${signed(diff, 0)} kcal`) : tag('no change'));
  const cmp = el('table', { class: 'tr-table' },
    el('thead', el('tr', el('th', { scope: 'col' }, el('span', { class: 'vh' }, 'Target')), el('th', { scope: 'col' }, 'Current'), el('th', { scope: 'col' }, 'Proposed'))),
    el('tbody',
      [['Calories', 'kcal', 'kcal'], ['Protein', 'protein', 'g'], ['Carbs', 'carbs', 'g'], ['Fat', 'fat', 'g']].map(([label, k, unit]) => el('tr',
        el('th', { scope: 'row' }, label),
        el('td', `${fmtGrouped(t[k])} ${unit}`),
        el('td', { class: p[k] !== t[k] ? 'tr-changed' : null }, `${fmtGrouped(p[k])} ${unit}`)))));
  const raw = fmtGrouped(Math.round(p.rawKcal / 10) * 10);
  const notes = [];
  if (ci.basisKind === 'formula') notes.push('Formula-based, not from your data.');
  if (p.limitedBy === 'change') notes.push(`Capped at ±${fmtGrouped(adaptiveConfig(d.config).maxWeeklyChange)} kcal / week (uncapped ${raw} kcal).`);
  if (p.limitedBy === 'floor') notes.push(`Raised to calorie floor (uncapped ${raw} kcal).`);
  if (p.proteinLimited && p.split !== 'percent') notes.push(`Protein capped at ${fmtGrouped(p.protein)} g to fit calories (setting: ${fmtGrouped(p.proteinWanted)} g).`);
  if (p.split === 'percent' && t.pct) notes.push(`Split ${fmtNum(t.pct.protein)} / ${fmtNum(t.pct.carbs)} / ${fmtNum(t.pct.fat)} % kept; only calories change.`);
  if (t.source !== 'adaptive') notes.push('Accepting switches targets to adaptive.');

  const kids = [head, review, hero, cmp, notes.length ? el('div', { class: 'tr-notes t-sub muted' }, notes.map((n) => el('p', null, n))) : null];
  if (done) {
    kids.push(el('p', { class: 'tr-done t-sub', role: 'status' }, icon('check', { size: 18 }),
      el('span', null, done.decision === 'accepted' ? `Accepted ${fmtGrouped(done.kcalTarget)} kcal.` : 'Kept current targets.',
        ` Next check-in ${fmtDate(addDays(ci.weekStart, 7))}.`)));
    if (done.decision === 'kept') kids.push(el('button', { class: 'btn btn-block', type: 'button', onClick: () => answer('accepted') }, 'Accept the proposal instead'));
  } else {
    kids.push(el('div', { class: 'tr-actions' },
      el('button', { class: 'btn btn-primary', type: 'button', onClick: () => answer('accepted') }, 'Accept'),
      el('button', { class: 'btn', type: 'button', onClick: () => answer('kept') }, 'Keep current')));
  }
  return el('section', { class: 'card tr-checkin', id: 'checkin', 'aria-label': 'Weekly check-in' }, kids);
}

function historySection(history) {
  if (!history.length) return null;
  return el('section', { class: 'section' }, sectionHeader('Target history'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, history.slice(0, 26).map((h) => el('div', { class: 'list-item tr-week-row' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, `Week of ${fmtDate(h.weekStart)}`),
        el('div', { class: 'li-sub' }, `${h.decision === 'kept' ? 'Kept' : 'Accepted'} · expenditure ${tdeeText(h.tdee)} kcal${h.basis === 'formula' ? ' (formula)' : ''} · ${h.daysLogged} days`)),
      el('span', { class: 'li-trail' }, `${fmtGrouped(h.kcalTarget)} kcal`))))));
}
