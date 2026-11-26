// Expenditure: the trend chart template (line = expenditure estimate per day, dots = complete-day
// intake), its data basis, the weekly check-in as one card (Accept / Keep current) and the target
// history. Route: trends/expenditure
import { el, replaceChildren, pageHeader, toast, fmtGrouped, fmtNum, fmtDate, href, cardHeader, sectionHeader, segmented, tag,
  infoButton, icon } from '../ui/index.js';
import { addDays } from '../core/dates.js';
import { adaptiveConfig, estimateExpenditure, classifyIntake, displayTdee } from '../core/adaptive.js';
import { trendChart, changeTable, figures } from './charts.js';
import { weekRange } from './week-view.js';
import { fixed, ensureCss, loadTrendsData, answerCheckIn, signed, goalText, tdeeText, confidenceText, kgPerWeek } from './data.js';
import { rangeLabel, rangeName } from './weight-view.js';
import { t } from '../i18n/index.js';

// Labels: trends.range.<id>; spoken names trends.range.<nameId>Name.
const RANGES = [{ id: '1m', days: 28, nameId: '4w' }, { id: '3m', days: 91 }];
let rangeId = '1m';

export async function mountExpenditure(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: t('trends.exp.title'), back: 'trends', info: 'expenditure' }));
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
          toast(decision === 'accepted' ? t('trends.checkin.newTarget', { kcal: fmtGrouped(rec.history.kcalTarget) }) : t('trends.checkin.keptToast'), { type: 'success' });
        } catch (err) {
          console.error(err);
          toast(t('trends.checkin.saveFailed', { error: err.message }), { type: 'error' });
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
    const kids = [cardHeader(t('trends.exp.estimate'), { tag: e.formula ? t('trends.exp.formulaEstimate') : null })];
    if (e.formula) {
      kids.push(figures({ label: t('trends.exp.notFromData'), value: tdeeText(e.formula.kcal), unit: t('trends.unit.kcalDay') }));
    }
    kids.push(el('p', { class: 't-sub strong tr-needed' }, t('trends.exp.stillNeeded')),
      el('ul', { class: 'tr-missing t-sub' }, e.missing.map((m) => el('li', null, t(m.key, m.params)))));
    if (!e.formula) kids.push(el('p', { class: 't-sub muted' }, profileHint('trends.exp.addProfile')));
    return el('section', { class: 'card tr-chart-card', 'aria-label': t('trends.exp.estimateAria') }, kids);
  }

  const parts = expenditureChart(d, series, { range: rangeId, onRange: (v) => { rangeId = v; rerender(); } });
  return el('section', { class: 'card tr-chart-card', 'aria-label': t('trends.exp.estimateAria') },
    cardHeader(t('trends.exp.estimate'), { trail: parts.seg }), parts.figures, parts.tag, parts.chart, parts.changes);
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
  const seg = segmented({ small: true, ariaLabel: t('trends.range.aria'), value: range.id,
    options: RANGES.map((r) => ({ value: r.id, label: rangeLabel(r), ariaLabel: rangeName(r) })), onChange: onRange });
  const from = addDays(d.today, -(range.days - 1));
  const valid = new Map(classifyIntake(d.intake, d.today, d.config).filter((r) => r.valid).map((r) => [r.date, r.kcal]));
  const est = new Map(series.map((r) => [r.date, r.tdee]));
  const dates = [...new Set([...est.keys(), ...valid.keys()])].filter((x) => x >= from && x <= d.today).sort();
  const items = dates.map((date) => ({ date, dot: valid.get(date) ?? null, line: est.has(date) ? displayTdee(est.get(date)) : null }));
  const now = displayTdee(e.tdee);
  const changes = [7, 14, 30, 90].map((n) => {
    const base = est.get(addDays(d.today, -n));
    return base === undefined ? null : { label: t('trends.chg.days', { n }), value: `${signed(now - displayTdee(base), 0)} kcal` };
  }).filter(Boolean);
  const intakeAvg = e.basis.meanIntake;
  return {
    seg,
    figures: figures(
      { label: t('trends.exp.title'), value: tdeeText(e.tdee), unit: t('trends.unit.kcalDay') },
      second || { label: t('trends.exp.intakeAvg'), value: intakeAvg === null ? '–' : fmtGrouped(intakeAvg), unit: t('trends.unit.kcalDay') }),
    tag: el('div', { class: 'tr-tagrow' }, tag(confidenceText(e), { tone: e.confidence === 'low' ? 'warn' : 'neutral' }),
      e.confidence === 'low' ? el('span', { class: 't-sub muted' }, t('trends.exp.lowConfidence')) : null),
    chart: items.some((r) => r.line !== null)
      ? trendChart({
        items, from, to: d.today, today: d.today, minSpan: 100, axisDecimals: 0,
        ariaLabel: t('trends.exp.chartAria', { from: fmtDate(from), to: fmtDate(d.today) }),
        readout: (r) => (r
          ? [fmtDate(r.date), r.line !== null ? t('trends.exp.readoutExp', { kcal: fmtGrouped(r.line) }) : null,
            r.dot !== null ? t('trends.exp.readoutIntake', { kcal: fmtGrouped(r.dot) }) : t('trends.exp.noCompleteDay')].filter(Boolean).join(' · ')
          : t('trends.exp.tapDay')),
        legend: [t('trends.exp.legendIntake'), t('trends.exp.title')],
      })
      : null,
    changes: changeTable(changes),
  };
}

/** A sentence with an inline 'Settings' link: the catalogue text holds the link as {link}. */
function profileHint(key) {
  const [before, after = ''] = t(key, { link: '\u0000' }).split('\u0000');
  return [before, el('a', { href: href('settings/goal') }, t('trends.settingsLink')), after];
}

function basisCard(d) {
  const b = d.estimate.basis;
  const row = (label, value, info) => el('div', { class: 'tr-row' },
    el('span', { class: 'tr-row-label' }, label, info || null), el('span', { class: 'tr-row-value' }, value));
  return el('section', { class: 'card tr-basis', 'aria-label': t('trends.basis.aria') },
    cardHeader(t('trends.basis.title'), { trail: el('span', { class: 't-sub muted' }, t('trends.basis.last28')) }),
    row(t('trends.basis.weighIns'), `${b.weighIns}`),
    row(t('trends.basis.completeDays'), b.incompleteDays
      ? t('trends.basis.completeWithIncomplete', { n: b.loggedDays, incomplete: b.incompleteDays }) : `${b.loggedDays}`, infoButton('complete')),
    row(t('trends.basis.avgIntake'), b.meanIntake === null ? '–' : `${fmtGrouped(b.meanIntake)} kcal`),
    row(t('trends.basis.trendWeight'), b.trendKg === null ? '–' : `${fixed(b.trendKg, 1)} kg`),
    row(t('trends.basis.weightChange'), b.rateKgPerWeek === null ? '–' : kgPerWeek(signed(b.rateKgPerWeek, 2))));
}

// ---------------------------------------------------------------- check-in

function checkInCard(d, answer) {
  const ci = d.checkIn;
  const done = d.doneThisWeek;
  const head = cardHeader(t('trends.dash.checkInKicker', { date: fmtDate(ci.weekStart) }), { info: 'checkin' });
  const fig = (label, v) => el('div', { class: 'tr-row' }, el('span', { class: 'tr-row-label' }, label), el('span', { class: 'tr-row-value' }, v));
  const review = el('div', { class: 'tr-review' },
    el('div', { class: 't-cap muted' }, t('trends.checkin.lastWeek', { range: weekRange(ci.reviewFrom) })),
    fig(t('trends.basis.avgIntake'), ci.avgIntake === null ? t('trends.checkin.nothingLogged')
      : t('trends.checkin.avgIntake', { count: ci.daysLogged, kcal: fmtGrouped(ci.avgIntake) })),
    // A change over one week, i.e. a rate: two decimals, like the goal next to it.
    fig(t('trends.checkin.trendChange'), ci.trendChange === null ? '–' : kgPerWeek(signed(ci.trendChange, 2))),
    fig(t(ci.basisKind === 'formula' ? 'trends.checkin.expFormula' : 'trends.exp.title'), ci.tdee === null ? t('trends.checkin.notAvailable') : `${tdeeText(ci.tdee)} kcal`),
    el('div', { class: 'tr-row' }, el('span', { class: 'tr-row-label' }, t('trends.checkin.goal')),
      el('span', { class: 'tr-row-value' }, goalText(d.goal.rateKgPerWeek)),
      el('a', { class: 'btn btn-sm btn-ghost tr-row-action', href: href('settings/goal'), 'aria-label': t('trends.checkin.changeGoalAria') }, t('trends.checkin.change'))));

  if (!ci.proposal) {
    return el('section', { class: 'card tr-checkin', id: 'checkin', 'aria-label': t('trends.checkin.aria') }, head, review,
      el('p', { class: 't-sub muted' }, ci.noProposal === 'no-weight'
        ? t('trends.checkin.needWeighIn')
        : profileHint('trends.checkin.noProposal')));
  }

  const p = ci.proposal;
  const cur = d.targets;
  const diff = p.kcal - cur.kcal;
  const hero = el('div', { class: 'tr-hero' },
    el('span', { class: 't-hero' }, fmtGrouped(p.kcal)), el('span', { class: 't-sub muted' }, t('trends.unit.kcalDay')),
    diff ? tag(`${signed(diff, 0)} kcal`) : tag(t('trends.checkin.noChange')));
  const cmp = el('table', { class: 'tr-table' },
    el('thead', el('tr', el('th', { scope: 'col' }, el('span', { class: 'vh' }, t('trends.checkin.target'))),
      el('th', { scope: 'col' }, t('trends.checkin.current')), el('th', { scope: 'col' }, t('trends.checkin.proposed')))),
    el('tbody',
      [['kcal', 'kcal'], ['protein', 'g'], ['carbs', 'g'], ['fat', 'g']].map(([k, unit]) => el('tr',
        el('th', { scope: 'row' }, t(`trends.macro.${k}`)),
        el('td', `${fmtGrouped(cur[k])} ${unit}`),
        el('td', { class: p[k] !== cur[k] ? 'tr-changed' : null }, `${fmtGrouped(p[k])} ${unit}`)))));
  const raw = fmtGrouped(Math.round(p.rawKcal / 10) * 10);
  const notes = [];
  if (ci.basisKind === 'formula') notes.push(t('trends.checkin.noteFormula'));
  if (p.limitedBy === 'change') notes.push(t('trends.checkin.noteCapped', { max: fmtGrouped(adaptiveConfig(d.config).maxWeeklyChange), raw }));
  if (p.limitedBy === 'floor') notes.push(t('trends.checkin.noteFloor', { raw }));
  if (p.proteinLimited && p.split !== 'percent') notes.push(t('trends.checkin.noteProtein', { protein: fmtGrouped(p.protein), wanted: fmtGrouped(p.proteinWanted) }));
  if (p.split === 'percent' && cur.pct) notes.push(t('trends.checkin.noteSplit', { protein: fmtNum(cur.pct.protein), carbs: fmtNum(cur.pct.carbs), fat: fmtNum(cur.pct.fat) }));
  if (cur.source !== 'adaptive') notes.push(t('trends.checkin.noteAdaptive'));

  const kids = [head, review, hero, cmp, notes.length ? el('div', { class: 'tr-notes t-sub muted' }, notes.map((n) => el('p', null, n))) : null];
  if (done) {
    kids.push(el('p', { class: 'tr-done t-sub', role: 'status' }, icon('check', { size: 18 }),
      el('span', null, done.decision === 'accepted' ? t('trends.checkin.acceptedKcal', { kcal: fmtGrouped(done.kcalTarget) }) : t('trends.checkin.keptDone'),
        ' ', t('trends.checkin.next', { date: fmtDate(addDays(ci.weekStart, 7)) }))));
    if (done.decision === 'kept') kids.push(el('button', { class: 'btn btn-block', type: 'button', onClick: () => answer('accepted') }, t('trends.checkin.acceptInstead')));
  } else {
    kids.push(el('div', { class: 'tr-actions' },
      el('button', { class: 'btn btn-primary', type: 'button', onClick: () => answer('accepted') }, t('trends.checkin.accept')),
      el('button', { class: 'btn', type: 'button', onClick: () => answer('kept') }, t('trends.checkin.keep'))));
  }
  return el('section', { class: 'card tr-checkin', id: 'checkin', 'aria-label': t('trends.checkin.aria') }, kids);
}

function historySection(history) {
  if (!history.length) return null;
  return el('section', { class: 'section' }, sectionHeader(t('trends.history.title')),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, history.slice(0, 26).map((h) => el('div', { class: 'list-item tr-week-row' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, t('trends.weekOf', { date: fmtDate(h.weekStart) })),
        el('div', { class: 'li-sub' }, [t(h.decision === 'kept' ? 'trends.history.kept' : 'trends.history.accepted'),
          t(h.basis === 'formula' ? 'trends.history.expFormula' : 'trends.history.exp', { kcal: tdeeText(h.tdee) }),
          Number.isFinite(h.daysLogged) ? t('trends.history.days', { count: h.daysLogged }) : null].filter(Boolean).join(' · '))),
      el('span', { class: 'li-trail' }, `${fmtGrouped(h.kcalTarget)} kcal`))))));
}
