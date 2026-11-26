// Intake history: daily kcal bars for the last 4 weeks (Mon–Sun aligned), target line, weekly averages.
// Route: trends/intake
import { el, pageHeader, emptyState, fmtGrouped, fmtDate, href, sectionHeader, icon } from '../ui/index.js';
import { dateRange, weekStart } from '../core/dates.js';
import { intakeChart } from './charts.js';
import { weekRange } from './week-view.js';
import { t } from '../i18n/index.js';
import { ensureCss, loadTrendsData, signed, intakeHistory } from './data.js';

export async function mountIntake(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: t('trends.intake.title'), back: 'trends', info: 'complete' }));
  const d = await loadTrendsData();
  const h = intakeHistory(d);
  const from = h.from;
  const byDate = new Map(d.intake.map((r) => [r.date, r.kcal]));
  const days = dateRange(from, d.today).map((date) => ({ date, kcal: byDate.get(date) ?? null }));
  if (!days.some((x) => x.kcal)) {
    container.append(el('div', { class: 'card' }, emptyState(t('trends.intake.none'),
      el('a', { class: 'btn btn-primary', href: href('diary') }, t('trends.openDiary')))));
    return;
  }
  const weeks = h.weeks;
  const target = d.targets.kcal;
  const thisWeek = weekStart(d.today);
  container.append(
    el('section', { class: 'card tr-chart-card', 'aria-label': t('trends.intake.dailyAria') },
      el('p', { class: 't-sub muted' }, h.label), intakeChart(days, target, weeks, d.today)),
    el('section', { class: 'section' }, sectionHeader(t('trends.intake.weeklyAverages'), { trail: t('trends.intake.completeOnly') }),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, [...weeks].reverse().map((w) => el('a', {
        class: 'list-item tr-week-row', href: href(`diary/${w.from}`), 'aria-label': t('trends.intake.weekAria', { from: fmtDate(w.from), to: fmtDate(w.to) }),
      },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, weekRange(w.from)),
        el('div', { class: 'li-sub' }, [t('trends.intake.complete', { count: w.days }),
          w.incomplete ? t('trends.intake.incomplete', { count: w.incomplete }) : null,
          w.from === thisWeek ? t('trends.intake.todayExcluded') : null].filter(Boolean).join(' · '))),
      el('div', { class: 'li-trail' },
        el('div', null, w.avg === null ? '–' : `${fmtGrouped(w.avg)} kcal`),
        w.avg === null || !target ? null : el('div', { class: 't-sub muted' }, t('trends.intake.vsTarget', { diff: signed(w.avg - target, 0) }))),
      icon('chevron-right', { class: 'li-chevron' })))))),
  );
}
