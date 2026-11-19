// Trends home = dashboard: today, this week, weight trend, expenditure/target, intake. Each card links
// to its detail screen. Route: trends
import * as db from '../db/db.js';
import { el, pageHeader, fmtNum, fmtDate, href } from '../ui/index.js';
import { addDays, weekStart } from '../core/dates.js';
import { totals, progress } from '../core/food-diary.js';
import { weeklyComparison } from '../core/volume.js';
import { trendSeries, trendAt, weightRate, weeklyIntake } from '../core/adaptive.js';
import { sparkline } from './charts.js';
import { isBaseline } from '../core/baseline.js';
import { ensureCss, loadTrendsData, linkCard, signed, goalText, CONFIDENCE_LABEL } from './data.js';

export async function mountDashboard(container) {
  ensureCss();
  container.append(pageHeader({ title: 'Trends' }));
  const d = await loadTrendsData();
  const ws = weekStart(d.today);
  const [workouts, exList, volume] = await Promise.all([
    db.range('workouts', 'date', { lower: addDays(ws, -7), upper: addDays(ws, 6) }),
    db.getAll('exercises'),
    db.getSetting('volume'),
  ]);
  const exMap = new Map(exList.map((e) => [e.id, e]));

  const banner = checkInBanner(d);
  container.append(...[
    banner,
    todayCard(d),
    weekCard(d, workouts, exMap, volume),
    weightCard(d),
    expenditureCard(d),
    reportsCard(d),
    intakeCard(d),
  ].filter(Boolean));
}

function checkInBanner(d) {
  if (d.doneThisWeek || !d.checkIn.proposal) return null;
  const p = d.checkIn.proposal;
  return el('a', { class: 'card tr-banner', href: href('trends/expenditure') },
    el('div', { class: 'grow' },
      el('div', { class: 'small tr-kicker' }, 'Weekly check-in ready'),
      el('div', { class: 'tr-strong' }, `Proposed ${fmtNum(p.kcal, 0)} kcal (now ${fmtNum(d.targets.kcal, 0)})`),
      el('div', { class: 'small muted' }, `Review last week (${fmtDate(d.checkIn.reviewFrom)} – ${fmtDate(d.checkIn.reviewTo)})`)),
    el('span', { class: 'btn btn-primary btn-sm' }, 'Review'));
}

function todayCard(d) {
  const entries = d.entries.filter((e) => e.date === d.today);
  const [kcal, protein] = progress(totals(entries), d.targets);
  const over = kcal.remaining !== null && kcal.remaining < 0;
  return linkCard(href('diary'), 'Today',
    entries.length
      ? [el('div', { class: 'grid-3 tr-figs' },
        fig('Eaten', fmtNum(kcal.consumed, 0), 'kcal'),
        fig('Target', fmtNum(kcal.target, 0), 'kcal'),
        fig(over ? 'Over' : 'Left', fmtNum(Math.abs(kcal.remaining ?? 0), 0), 'kcal', over ? 'text-warning' : null)),
      meter(kcal.fraction),
      el('div', { class: 'small muted num' }, `Protein ${fmtNum(protein.consumed, 0)} / ${fmtNum(protein.target, 0)} g`)]
      : el('p', { class: 'muted small' }, `Nothing logged yet today. Target ${fmtNum(d.targets.kcal, 0)} kcal, ${fmtNum(d.targets.protein, 0)} g protein.`));
}

function weekCard(d, workouts, exMap, volume) {
  const ws = weekStart(d.today);
  const [week] = weeklyIntake(d.intake, d.today, ws, d.config);
  const loggedDays = new Set(d.entries.filter((e) => e.date >= ws).map((e) => e.date)).size;
  const done = workouts.filter((w) => w.date >= ws && w.finishedAt && !isBaseline(w)).length;
  const cmp = weeklyComparison(workouts, exMap, volume, d.today);
  const sets = cmp.rows.filter((r) => r.current > 0).sort((a, b) => b.current - a.current);
  return linkCard(href('trends/intake'), `This week · from ${fmtDate(ws)}`,
    el('div', { class: 'grid-3 tr-figs' },
      fig('Avg intake', week.avg === null ? '–' : fmtNum(week.avg, 0), week.avg === null ? 'no full day yet' : `vs ${fmtNum(d.targets.kcal, 0)}`),
      fig('Days logged', `${loggedDays}`, 'of 7'),
      fig('Workouts', `${done}`, 'finished')),
    sets.length
      ? el('div', { class: 'tr-sets small' }, el('span', { class: 'muted' }, 'Sets: '),
        sets.map((r, i) => el('span', { class: 'tr-set num' }, `${i ? ' · ' : ''}${r.name} ${fmtNum(r.current, 1)}`)))
      : el('p', { class: 'small muted' }, 'No sets this week yet.'));
}

function weightCard(d) {
  const series = trendSeries(d.weights);
  if (!series.length) {
    return linkCard(href('trends/weight'), 'Weight',
      el('p', { class: 'muted small' }, 'No weigh-ins yet. Log your morning weight to see your trend. Tap to add today’s weight.'));
  }
  const trend = trendAt(series, d.today);
  const rate = weightRate(d.weights, d.today);
  const recent = series.filter((r) => r.date >= addDays(d.today, -29));
  return linkCard(href('trends/weight'), 'Weight trend',
    el('div', { class: 'row-between' },
      el('div', { class: 'grid-2 grow tr-figs' },
        fig('Trend', fmtNum(trend, 1), 'kg'),
        fig('Per week', rate === null ? '–' : signed(rate, 2), rate === null ? 'needs 1 wk of data' : 'kg')),
      sparkline(recent)),
    series[series.length - 1].date === d.today ? null : el('p', { class: 'small muted' }, 'No weigh-in today yet.'));
}

function expenditureCard(d) {
  const e = d.estimate;
  const p = d.checkIn.proposal;
  const kids = [];
  if (e.status === 'ok') {
    kids.push(el('div', { class: 'grid-2 tr-figs' },
      fig('Expenditure', fmtNum(Math.round(e.tdee / 10) * 10, 0), CONFIDENCE_LABEL[e.confidence].replace(' confidence', '') + ' confidence'),
      fig('Proposed target', p ? fmtNum(p.kcal, 0) : '–', `${goalText(d.goal.rateKgPerWeek).toLowerCase()}`)));
  } else {
    kids.push(el('p', { class: 'small' }, e.missing[0]));
    if (e.formula) {
      kids.push(el('div', { class: 'grid-2 tr-figs' },
        fig('Formula estimate', fmtNum(Math.round(e.formula.kcal / 10) * 10, 0), 'not from your data'),
        fig('Proposed target', p ? fmtNum(p.kcal, 0) : '–', goalText(d.goal.rateKgPerWeek).toLowerCase())));
    } else {
      kids.push(el('p', { class: 'small muted' }, 'Log weight and food daily to unlock your expenditure estimate (about 2 weeks). Fill in your profile in Settings for a formula estimate meanwhile.'));
    }
  }
  kids.push(el('div', { class: 'small muted' }, `Current target ${fmtNum(d.targets.kcal, 0)} kcal · ${d.targets.source === 'adaptive' ? 'adaptive' : 'set manually'}`));
  return linkCard(href('trends/expenditure'), 'Expenditure & target', kids);
}

function reportsCard(d) {
  const ws = weekStart(d.today);
  // Not a linkCard: it holds several links, which must not be nested inside one <a>.
  return el('section', { class: 'card tr-card', 'aria-label': 'Weekly reports' },
    el('a', { class: 'tr-card-head tr-head-link', href: href('trends/weeks') },
      el('span', { class: 'tr-card-title' }, 'Weekly reports'), el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›')),
    el('p', { class: 'small muted' }, 'Each Monday–Sunday week summed up: eating vs target, weight change and training, compared with the week before.'),
    el('div', { class: 'grid-3 tr-report-links' },
      el('a', { class: 'btn', href: href(`trends/week/${ws}`) }, 'This week'),
      el('a', { class: 'btn', href: href(`trends/week/${addDays(ws, -7)}`) }, 'Last week'),
      el('a', { class: 'btn', href: href('trends/weeks') }, 'All weeks')));
}

function intakeCard(d) {
  const from = addDays(d.today, -27);
  const days = d.intake.filter((r) => r.date >= from && r.date < d.today);
  return linkCard(href('trends/intake'), 'Intake history',
    days.length
      ? el('p', { class: 'small muted' }, `${days.length} logged day${days.length === 1 ? '' : 's'} in the last 4 weeks. Daily calories against your target and weekly averages.`)
      : el('p', { class: 'small muted' }, 'Log food in the diary to see your daily calories here.'));
}

function fig(label, value, sub, cls) {
  return el('div', { class: 'tr-fig' },
    el('div', { class: 'small muted' }, label),
    el('div', { class: ['tr-fig-val num', cls] }, value),
    sub ? el('div', { class: 'small muted truncate' }, sub) : null);
}

function meter(fraction) {
  const pct = Math.max(0, Math.min(1, fraction || 0)) * 100;
  return el('div', { class: ['tr-meter', fraction > 1 ? 'is-over' : null], 'aria-hidden': 'true' }, el('div', { class: 'tr-meter-fill', style: { width: `${pct}%` } }));
}
