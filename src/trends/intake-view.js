// Intake history: daily kcal bars for the last 4 weeks (Mon–Sun aligned), target line, weekly averages.
// Route: trends/intake
import { el, pageHeader, emptyState, fmtNum, fmtDate, href } from '../ui/index.js';
import { addDays, dateRange, weekStart } from '../core/dates.js';
import { weeklyIntake } from '../core/adaptive.js';
import { intakeChart } from './charts.js';
import { ensureCss, loadTrendsData, signed } from './data.js';

export async function mountIntake(container) {
  ensureCss();
  container.append(pageHeader({ title: 'Intake history', back: 'trends' }));
  const d = await loadTrendsData();
  const from = addDays(weekStart(d.today), -21);
  const byDate = new Map(d.intake.map((r) => [r.date, r.kcal]));
  const days = dateRange(from, d.today).map((date) => ({ date, kcal: byDate.get(date) ?? null }));
  if (!days.some((x) => x.kcal)) {
    container.append(el('div', { class: 'card' }, emptyState('Nothing logged in the last 4 weeks. Log your food in the diary and your daily calories show up here.',
      el('a', { class: 'btn btn-primary', href: href('diary') }, 'Open diary'))));
    return;
  }
  const weeks = weeklyIntake(d.intake, d.today, from, d.config);
  const target = d.targets.kcal;
  container.append(
    el('section', { class: 'card stack' }, intakeChart(days, target, weeks, d.today)),
    el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Weekly averages'),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, [...weeks].reverse().map((w) => el('a', { class: 'list-item', href: href(`diary/${w.from}`) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, `${fmtDate(w.from)} – ${fmtDate(w.to)}`),
          el('div', { class: 'li-sub' }, `${w.days} complete day${w.days === 1 ? '' : 's'}${w.incomplete ? `, ${w.incomplete} incomplete` : ''}${w.from === weekStart(d.today) ? ' · this week, today excluded' : ''}`)),
        el('div', { class: 'li-trail' },
          el('div', { class: 'num' }, w.avg === null ? '–' : `${fmtNum(w.avg, 0)} kcal`),
          w.avg === null || !target ? null : el('div', { class: 'small muted num' }, `${signed(w.avg - target, 0)} vs target`)),
        el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›')))))),
    el('p', { class: 'muted small tr-note' }, `Averages count complete days only. A day under half of your usual intake counts as incomplete. Current target: ${fmtNum(target, 0)} kcal.`));
}
