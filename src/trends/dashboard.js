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

// Chart ranges on the dashboard (kept while the app is open).
const WEIGHT_RANGES = [{ id: '1m', label: '1M', days: 30, name: '1 month' }, { id: '3m', label: '3M', days: 91, name: '3 months' },
  { id: '1y', label: '1Y', days: 365, name: '1 year' }];
let weightRange = '1m';
let expRange = '1m';

export async function mountDashboard(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: 'Trends' }));
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
  return el('a', { class: 'card tr-banner', href: href('trends/expenditure'), 'aria-label': `Check-in ready: ${fmtGrouped(p.kcal)} kcal proposed. Review` },
    el('div', { class: 'grow' },
      el('div', { class: 't-cap tr-kicker' }, `Check-in · ${fmtDate(d.checkIn.weekStart)}`),
      el('div', { class: 'tr-banner-main' }, `${fmtGrouped(p.kcal)} kcal / day proposed`),
      el('div', { class: 't-sub muted' }, `Now ${fmtGrouped(d.targets.kcal)} kcal`)),
    el('span', { class: 'btn btn-primary btn-sm' }, 'Review'));
}

function todayCard(d) {
  const entries = d.entries.filter((e) => e.date === d.today);
  if (!entries.length) {
    return linkCard(href('diary'), 'Today', {}, line('Nothing logged yet'),
      line(`Target ${fmtGrouped(d.targets.kcal)} kcal · protein ${fmtGrouped(d.targets.protein)} g`));
  }
  const t = totals(entries);
  // Same rule as the diary: eaten rounded once, left/over from the rounded value (they add up).
  const kcal = targetStatus(t.kcal, d.targets.kcal);
  const protein = targetStatus(t.protein, d.targets.protein);
  const rest = kcal.isOver ? `${fmtGrouped(kcal.over)} over` : `${fmtGrouped(kcal.left ?? 0)} left`;
  return linkCard(href('diary'), 'Today', {},
    value(fmtGrouped(kcal.eaten), `/ ${fmtGrouped(kcal.target)} kcal`),
    progressBar({ value: kcal.eaten, max: kcal.target || 1, tone: kcal.isOver ? 'warn' : 'accent', label: 'Calories eaten of target' }),
    line(el('span', { class: kcal.isOver ? 'text-warning' : null }, rest), ` · protein ${fmtGrouped(protein.eaten)} / ${fmtGrouped(protein.target)} g`));
}

function weekCard(d, workouts, exMap, volume) {
  const ws = weekStart(d.today);
  const [week] = weeklyIntake(d.intake, d.today, ws, d.config);
  const loggedDays = new Set(d.entries.filter((e) => e.date >= ws).map((e) => e.date)).size;
  const done = workouts.filter((w) => w.date >= ws && isLoggedWorkout(w) && !isBaseline(w)).length;
  const cmp = weeklyComparison(workouts, exMap, volume, d.today);
  const sets = cmp.rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current);
  const top = sets.slice(0, 4).map((r) => `${r.name} ${fmtNum(r.current, 1)}`).join(' · ');
  return linkCard(href('trends/intake'), 'This week', { tag: el('span', { class: 't-sub muted' }, `from ${fmtDate(ws)}`) },
    value(week.avg === null ? '–' : fmtGrouped(week.avg), 'kcal / day avg'),
    line(`${loggedDays} of 7 days logged · ${done} workout${done === 1 ? '' : 's'}${week.avg === null ? ' · no complete day yet' : ''}`),
    sets.length ? el('p', { class: 't-sub muted tr-sets' }, `Sets: ${top}${sets.length > 4 ? ` · +${sets.length - 4} more` : ''}`) : null);
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
  if (!series.length) return linkCard(href('trends/weight'), 'Weight', {}, line('No weigh-ins yet. Tap to log one.'));
  const weights = [...d.weights].sort((a, b) => (a.date < b.date ? -1 : 1));
  const rate = weightRate(d.weights, d.today);
  const noToday = series[series.length - 1].date !== d.today;
  const build = () => {
    const parts = weightChart({ weights, series, now: d.today, range: weightRange, ranges: WEIGHT_RANGES,
      onRange: (v) => { weightRange = v; const next = build(); card.replaceWith(next); card = next; } });
    return chartCard('trends/weight', 'Weight', 'Weight trend', parts.seg, parts.figures, parts.chart,
      line(rate === null ? 'Rate after 1 week' : rateText(rate), noToday ? ' · no weigh-in today' : ''));
  };
  let card = build();
  return card;
}

function expenditureCard(d) {
  const e = d.estimate;
  const source = d.targets.source === 'adaptive' ? 'adaptive' : 'manual';
  const target = `Target ${fmtGrouped(d.targets.kcal)} kcal · ${source}`;
  if (e.status === 'ok') {
    const cache = new Map(); // range days → estimates per day
    const build = () => {
      const days = expRange === '3m' ? 91 : 28;
      if (!cache.has(days)) cache.set(days, estimateSeries(d, days));
      const parts = expenditureChart(d, cache.get(days), {
        range: expRange,
        onRange: (v) => { expRange = v; const next = build(); card.replaceWith(next); card = next; },
        second: { label: `Target · ${source}`, value: fmtGrouped(d.targets.kcal), unit: 'kcal / day' },
      });
      return chartCard('trends/expenditure', 'Expenditure', 'Expenditure estimate', parts.seg, parts.figures, parts.tag, parts.chart);
    };
    let card = build();
    return card;
  }
  if (e.formula) {
    return linkCard(href('trends/expenditure'), 'Expenditure', { tag: tag('formula') },
      value(tdeeText(e.formula.kcal), 'kcal / day'), line(target));
  }
  return linkCard(href('trends/expenditure'), 'Expenditure', {}, line('Needs about 2 weeks of weight and food.'));
}

function reportsCard(d) {
  const ws = weekStart(d.today);
  // Not a linkCard: it holds several links, which must not be nested inside one <a>.
  const go = (path, label) => el('a', { class: 'btn btn-sm', href: href(path) }, label);
  return el('section', { class: 'card tr-card', 'aria-labelledby': 'tr-reports-title' },
    el('a', { class: 'tr-card-head tr-head-link', href: href('trends/weeks') },
      el('h2', { class: 'card-title', id: 'tr-reports-title' }, 'Weekly reports'), el('span', { class: 'grow' }),
      icon('chevron-right', { class: 'li-chevron' })),
    el('div', { class: 'tr-report-links' },
      go(`trends/week/${ws}`, 'This week'),
      go(`trends/week/${addDays(ws, -7)}`, 'Last week'),
      go('trends/weeks', 'All weeks')));
}

function intakeCard(d) {
  const h = intakeHistory(d);
  if (!h.logged) return linkCard(href('trends/intake'), 'Intake history', {}, line('No food logged in 4 weeks.'));
  return linkCard(href('trends/intake'), 'Intake history', {},
    value(String(h.logged), `day${h.logged === 1 ? '' : 's'} logged`),
    line('Last 4 weeks · today excluded'));
}
