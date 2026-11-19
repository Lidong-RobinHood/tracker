// Intake history: daily kcal bars for the last 4 weeks (Mon–Sun aligned), target line, weekly averages.
// Route: trends/intake
import { el, pageHeader, emptyState, fmtGrouped, fmtDate, href, sectionHeader, icon } from '../ui/index.js';
import { dateRange, weekStart } from '../core/dates.js';
import { intakeChart } from './charts.js';
import { weekRange } from './week-view.js';
import { ensureCss, loadTrendsData, signed, intakeHistory } from './data.js';

export async function mountIntake(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: 'Intake history', back: 'trends', info: 'complete' }));
  const d = await loadTrendsData();
  const h = intakeHistory(d);
  const from = h.from;
  const byDate = new Map(d.intake.map((r) => [r.date, r.kcal]));
  const days = dateRange(from, d.today).map((date) => ({ date, kcal: byDate.get(date) ?? null }));
  if (!days.some((x) => x.kcal)) {
    container.append(el('div', { class: 'card' }, emptyState('No food logged in 4 weeks.',
      el('a', { class: 'btn btn-primary', href: href('diary') }, 'Open diary'))));
    return;
  }
  const weeks = h.weeks;
  const target = d.targets.kcal;
  const thisWeek = weekStart(d.today);
  container.append(
    el('section', { class: 'card tr-chart-card', 'aria-label': 'Daily calories' },
      el('p', { class: 't-sub muted' }, h.label), intakeChart(days, target, weeks, d.today)),
    el('section', { class: 'section' }, sectionHeader('Weekly averages', { trail: 'Complete days only' }),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, [...weeks].reverse().map((w) => el('a', {
        class: 'list-item tr-week-row', href: href(`diary/${w.from}`), 'aria-label': `Week ${fmtDate(w.from)} to ${fmtDate(w.to)}. Open in diary`,
      },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, weekRange(w.from)),
        el('div', { class: 'li-sub' }, `${w.days} complete${w.incomplete ? ` · ${w.incomplete} incomplete` : ''}${w.from === thisWeek ? ' · today excluded' : ''}`)),
      el('div', { class: 'li-trail' },
        el('div', null, w.avg === null ? '–' : `${fmtGrouped(w.avg)} kcal`),
        w.avg === null || !target ? null : el('div', { class: 't-sub muted' }, `${signed(w.avg - target, 0)} vs target`)),
      icon('chevron-right', { class: 'li-chevron' })))))),
  );
}
