// Trends home = dashboard: check-in, today, this week, weight and expenditure charts, weekly reports, intake.
// One card per topic; the weight and expenditure cards show the real chart (compact: range switch, two
// figures, tap to pin a day) and their title links to the detail screen.
// Route: trends
import * as db from '../db/db.js';
import { el, pageHeader, fmtGrouped, fmtNum, fmtDate, href, tag, progressBar, icon } from '../ui/index.js';
import { addDays, weekStart } from '../core/dates.js';
import { totals } from '../core/food-diary.js';
import { targetStatus } from '../core/food-percent.js';
import { weeklyComparison } from '../core/volume.js';
import { trendSeries, weightRate, weeklyIntake } from '../core/adaptive.js';
import { weightChart } from './weight-view.js';
import { expenditureChart, estimateSeries } from './expenditure-view.js';
import { isBaseline } from '../core/baseline.js';
import { isLoggedWorkout } from '../core/workout.js';
import { ensureCss, loadTrendsData, linkCard, rateText, tdeeText, intakeHistory } from './data.js';
import { t } from '../i18n/index.js';
import { muscleName } from '../i18n/names.js';

// Chart ranges on the dashboard (kept while the app is open). Labels: trends.range.<id> / <id>Name.
const WEIGHT_RANGES = [{ id: '1m', days: 30 }, { id: '3m', days: 91 }, { id: '1y', days: 365 }];
let weightRange = '1m';
let expRange = '1m';

export async function mountDashboard(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: t('trends.title') }));
  const d = await loadTrendsData();
  const ws = weekStart(d.today);
  const [workouts, exList, volume] = await Promise.all([
    db.range('workouts', 'date', { lower: addDays(ws, -7), upper: addDays(ws, 6) }),
    db.getAll('exercises'),
    db.getSetting('volume'),
  ]);
  const exMap = new Map(exList.map((e) => [e.id, e]));

  container.append(...[
    checkInBanner(d),
    todayCard(d),
    weekCard(d, workouts, exMap, volume),
    weightCard(d),
    expenditureCard(d),
    reportsCard(d),
    intakeCard(d),
  ].filter(Boolean));
}

/** Big number + small unit (+ something on the right). */
function value(v, unit, side = null) {
  return el('div', { class: 'tr-value-row' },
    el('span', { class: 'tr-value' }, v, unit ? el('small', { class: 'tr-unit' }, unit) : null),
    side);
}
const line = (...c) => el('p', { class: 't-sub muted tr-line' }, ...c);

function checkInBanner(d) {
  if (d.doneThisWeek || !d.checkIn.proposal) return null;
  const p = d.checkIn.proposal;
  return el('a', { class: 'card tr-banner', href: href('trends/expenditure'), 'aria-label': t('trends.dash.checkInAria', { kcal: fmtGrouped(p.kcal) }) },
    el('div', { class: 'grow' },
      el('div', { class: 't-cap tr-kicker' }, t('trends.dash.checkInKicker', { date: fmtDate(d.checkIn.weekStart) })),
      el('div', { class: 'tr-banner-main' }, t('trends.dash.proposed', { kcal: fmtGrouped(p.kcal) })),
      el('div', { class: 't-sub muted' }, t('trends.dash.now', { kcal: fmtGrouped(d.targets.kcal) }))),
    el('span', { class: 'btn btn-primary btn-sm' }, t('trends.dash.review')));
}

function todayCard(d) {
  const entries = d.entries.filter((e) => e.date === d.today);
  if (!entries.length) {
    return linkCard(href('diary'), t('trends.dash.today'), {}, line(t('trends.dash.nothingLogged')),
      line(t('trends.dash.targetLine', { kcal: fmtGrouped(d.targets.kcal), protein: fmtGrouped(d.targets.protein) })));
  }
  const sum = totals(entries);
  // Same rule as the diary: eaten rounded once, left/over from the rounded value (they add up).
  const kcal = targetStatus(sum.kcal, d.targets.kcal);
  const protein = targetStatus(sum.protein, d.targets.protein);
  const rest = kcal.isOver ? t('trends.dash.over', { kcal: fmtGrouped(kcal.over) }) : t('trends.dash.left', { kcal: fmtGrouped(kcal.left ?? 0) });
  return linkCard(href('diary'), t('trends.dash.today'), {},
    value(fmtGrouped(kcal.eaten), `/ ${fmtGrouped(kcal.target)} kcal`),
    progressBar({ value: kcal.eaten, max: kcal.target || 1, tone: kcal.isOver ? 'warn' : 'accent', label: t('trends.dash.caloriesAria') }),
    line(el('span', { class: kcal.isOver ? 'text-warning' : null }, rest), ' · ',
      t('trends.dash.proteinLine', { eaten: fmtGrouped(protein.eaten), target: fmtGrouped(protein.target) })));
}

function weekCard(d, workouts, exMap, volume) {
  const ws = weekStart(d.today);
  const [week] = weeklyIntake(d.intake, d.today, ws, d.config);
  const loggedDays = new Set(d.entries.filter((e) => e.date >= ws).map((e) => e.date)).size;
  const done = workouts.filter((w) => w.date >= ws && isLoggedWorkout(w) && !isBaseline(w)).length;
  const cmp = weeklyComparison(workouts, exMap, volume, d.today);
  const sets = cmp.rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current);
  const top = sets.slice(0, 4).map((r) => `${muscleName(r.muscle)} ${fmtNum(r.current, 1)}`).join(' · ');
  return linkCard(href('trends/intake'), t('trends.dash.thisWeek'), { tag: el('span', { class: 't-sub muted' }, t('trends.dash.from', { date: fmtDate(ws) })) },
    value(week.avg === null ? '–' : fmtGrouped(week.avg), t('trends.dash.kcalDayAvg')),
    line([t('trends.dash.daysLogged', { count: loggedDays }), t('trends.dash.workouts', { count: done }),
      week.avg === null ? t('trends.dash.noCompleteDay') : null].filter(Boolean).join(' · ')),
    sets.length ? el('p', { class: 't-sub muted tr-sets' }, sets.length > 4
      ? t('trends.dash.setsMore', { list: top, more: sets.length - 4 }) : t('trends.dash.sets', { list: top })) : null);
}

/** Card whose title row links to a detail screen and holds a control on the right (not nested in the link). */
function chartCard(path, title, label, trail, ...children) {
  return el('section', { class: 'card tr-chart-card tr-dash-chart', 'aria-label': label },
    el('div', { class: 'tr-dash-head' },
      el('a', { class: 'tr-head-link tr-dash-link', href: href(path) }, el('h2', { class: 'card-title' }, title), icon('chevron-right', { class: 'li-chevron' })),
      trail),
    children);
}

function weightCard(d) {
  const series = trendSeries(d.weights);
  if (!series.length) return linkCard(href('trends/weight'), t('trends.weight.title'), {}, line(t('trends.dash.noWeighIns')));
  const weights = [...d.weights].sort((a, b) => (a.date < b.date ? -1 : 1));
  const rate = weightRate(d.weights, d.today);
  const noToday = series[series.length - 1].date !== d.today;
  const build = () => {
    const parts = weightChart({ weights, series, now: d.today, range: weightRange, ranges: WEIGHT_RANGES,
      onRange: (v) => { weightRange = v; const next = build(); card.replaceWith(next); card = next; } });
    return chartCard('trends/weight', t('trends.weight.title'), t('trends.weight.trendAria'), parts.seg, parts.figures, parts.chart,
      line(rate === null ? t('trends.weight.rateAfterWeek') : rateText(rate), noToday ? ` · ${t('trends.dash.noWeighInToday')}` : ''));
  };
  let card = build();
  return card;
}

function expenditureCard(d) {
  const e = d.estimate;
  const source = t(d.targets.source === 'adaptive' ? 'trends.dash.sourceAdaptive' : 'trends.dash.sourceManual');
  const target = t('trends.dash.targetSource', { kcal: fmtGrouped(d.targets.kcal), source });
  if (e.status === 'ok') {
    const cache = new Map(); // range days → estimates per day
    const build = () => {
      const days = expRange === '3m' ? 91 : 28;
      if (!cache.has(days)) cache.set(days, estimateSeries(d, days));
      const parts = expenditureChart(d, cache.get(days), {
        range: expRange,
        onRange: (v) => { expRange = v; const next = build(); card.replaceWith(next); card = next; },
        second: { label: t('trends.dash.targetFig', { source }), value: fmtGrouped(d.targets.kcal), unit: t('trends.unit.kcalDay') },
      });
      return chartCard('trends/expenditure', t('trends.exp.title'), t('trends.exp.estimateAria'), parts.seg, parts.figures, parts.tag, parts.chart);
    };
    let card = build();
    return card;
  }
  if (e.formula) {
    return linkCard(href('trends/expenditure'), t('trends.exp.title'), { tag: tag(t('trends.dash.formulaTag')) },
      value(tdeeText(e.formula.kcal), t('trends.unit.kcalDay')), line(target));
  }
  return linkCard(href('trends/expenditure'), t('trends.exp.title'), {}, line(t('trends.dash.expNeeds')));
}

function reportsCard(d) {
  const ws = weekStart(d.today);
  // Not a linkCard: it holds several links, which must not be nested inside one <a>.
  const go = (path, label) => el('a', { class: 'btn btn-sm', href: href(path) }, label);
  return el('section', { class: 'card tr-card', 'aria-labelledby': 'tr-reports-title' },
    el('a', { class: 'tr-card-head tr-head-link', href: href('trends/weeks') },
      el('h2', { class: 'card-title', id: 'tr-reports-title' }, t('trends.weeks.title')), el('span', { class: 'grow' }),
      icon('chevron-right', { class: 'li-chevron' })),
    el('div', { class: 'tr-report-links' },
      go(`trends/week/${ws}`, t('trends.dash.thisWeek')), // i18n-ignore (route path)
      go(`trends/week/${addDays(ws, -7)}`, t('trends.dash.lastWeek')), // i18n-ignore (route path)
      go('trends/weeks', t('trends.dash.allWeeks'))));
}

function intakeCard(d) {
  const h = intakeHistory(d);
  if (!h.logged) return linkCard(href('trends/intake'), t('trends.intake.title'), {}, line(t('trends.intake.none')));
  return linkCard(href('trends/intake'), t('trends.intake.title'), {},
    value(String(h.logged), t('trends.dash.daysLoggedUnit', { count: h.logged })),
    line(t('trends.dash.last4Weeks')));
}
