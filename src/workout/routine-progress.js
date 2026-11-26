// Routine progress: every time a routine was performed, as a chart and a list, per-exercise trend and
// "this time vs last time". Route: workout/routines/:id/progress
import * as db from '../db/db.js';
import { el, replaceChildren, append, pageHeader, href, emptyState, fmtDate, fmtDuration, icon, sectionHeader, statTile } from '../ui/index.js';
import { routineProgress, compareSession } from '../core/workout-progress.js';
import { ensureCss, loadExercises, loadWorkouts, startWorkout } from './data.js';
import { t } from '../i18n/index.js';
import { routineName } from '../i18n/names.js';
import { lineChart } from './chart.js';
import { workoutGlyph } from './muscle-map.js';
import { pctBadge, pctWords, fmtTonnage, topText, comparisonBlock, durationParts, dateShort, exLabel } from './progress-ui.js';

/** Sessions shown side by side per exercise. */
const COLS = 4;
/** Sessions listed before "Show all". */
const PAGE = 15;

export async function mountRoutineProgress(container, { id }) {
  ensureCss();
  const [routine, exMap, workouts, weights] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts(), db.getSetting('volume')]);
  if (!routine) {
    append(container, pageHeader({ title: t('analysis.rp.title'), back: 'workout' }), emptyState(t('analysis.rp.notFound')));
    return;
  }
  const rp = routineProgress(workouts, routine);
  const n = rp.sessions.length;
  append(container, pageHeader({
    // the latest session's muscles at a glance
    title: routineName(routine),
    subtitle: t('analysis.rp.subtitle', { count: n }),
    back: `workout/routines/${encodeURIComponent(routine.id)}`,
    actions: [n ? workoutGlyph(rp.sessions[0].workout, exMap, weights) : null,
      el('a', { class: 'btn btn-icon btn-ghost', href: href(`workout/routines/${encodeURIComponent(routine.id)}`), 'aria-label': t('analysis.rp.edit') }, icon('pencil'))].filter(Boolean),
  }));

  if (!n) {
    append(container, emptyState(t('analysis.rp.empty'),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => startWorkout(routine) }, t('analysis.rp.start'))));
    return;
  }

  // ---------------------------------------------------------- this time vs last time
  const latest = rp.sessions[0];
  const cmp = compareSession(workouts, latest.workout);
  append(container, el('section', { class: 'section' },
    sectionHeader(t(n > 1 ? 'analysis.rp.latestVsBefore' : 'analysis.rp.firstSession', { date: dateShort(latest.workout.date) }), { info: 'tonnage' }),
    // Tonnage once: in the comparison card below, with its change beside it.
    el('div', { class: 'tiles wk-tiles-2' },
      statTile({ label: t('analysis.duration'), ...durationParts(latest.totals.durationMs) }),
      statTile({ label: t('analysis.sets'), value: String(latest.totals.sets), sub: latest.totals.dropsets ? t('analysis.plusDrop', { n: latest.totals.dropsets }) : null })),
    el('div', { class: 'card' }, comparisonBlock(cmp, exMap))));

  // ---------------------------------------------------------- chart
  const chrono = [...rp.sessions].reverse();
  append(container, el('section', { class: 'section' },
    sectionHeader(t('analysis.rp.tonnagePerSession'), { info: 'tonnage' }),
    el('div', { class: 'card wk-chart-card' },
      lineChart({
        points: chrono.map((s) => ({ date: s.workout.date, value: s.totals.load, label: fmtTonnage(s.totals.load) })),
        // axis: the shared rule without the kg unit ('2 340', '12.48 t')
        format: (v) => fmtTonnage(v).replace(/ kg$/, ''),
        ariaLabel: t('analysis.rp.chartAria', { count: n, name: routineName(routine), from: fmtTonnage(chrono[0].totals.load), to: fmtTonnage(latest.totals.load) }),
        zero: false,
      }))));

  // ---------------------------------------------------------- per exercise
  append(container, el('section', { class: 'section' },
    sectionHeader(t('analysis.rp.exercises', { count: COLS })),
    el('div', { class: 'stack' }, rp.exercises.map((x) => exerciseRow(x, exMap)))));

  // ---------------------------------------------------------- sessions
  const list = el('div', { class: 'list' });
  const renderList = (all) => {
    replaceChildren(list, ...rp.sessions.slice(0, all ? undefined : PAGE).map((s) => sessionItem(s, exMap)));
    if (!all && n > PAGE) {
      append(list, el('button', { type: 'button', class: 'list-item wk-more', onClick: () => renderList(true) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, t('analysis.rp.showAll', { count: n })))));
    }
  };
  renderList(false);
  append(container, el('section', { class: 'section' },
    sectionHeader(t('analysis.rp.every'), { trail: t('analysis.rp.everyTrail') }),
    el('div', { class: 'card card-flush' }, list)));
}

function exerciseRow(x, exMap) {
  const name = exLabel(exMap, x.exerciseId);
  const cols = x.entries.slice(0, COLS).reverse(); // oldest -> newest, left to right
  const last = x.entries[0];
  const label = last
    ? t('analysis.rp.exAria', { name, top: topText(last.metrics.top), date: dateShort(last.workout.date), change: pctWords(last.cmp && last.cmp.pct) })
    : t('analysis.rp.exAriaNone', { name });
  return el('a', { class: 'card wk-xrow', href: href(`workout/exercises/${encodeURIComponent(x.exerciseId)}`), 'aria-label': label },
    el('div', { class: 'row-between' },
      el('div', { class: 'li-title truncate' }, name, x.inRoutine ? null : el('span', { class: 'tag wk-badge-gap' }, t('analysis.rp.notInRoutine'))),
      icon('chevron-right', { class: 'li-chevron' })),
    cols.length
      ? el('div', { class: 'wk-xcols', 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` } }, // i18n-ignore: CSS
        cols.map((c, i) => el('div', { class: ['wk-xcol', i === cols.length - 1 && 'is-latest'] },
          el('div', { class: 't-sub muted' }, dateShort(c.workout.date)),
          el('div', { class: 'wk-xtop' }, topText(c.metrics.top)),
          el('div', { class: 't-sub muted' }, c.metrics.dropsets ? t('analysis.rp.colSetsDrop', { count: c.metrics.sets, drop: c.metrics.dropsets }) : t('analysis.rp.colSets', { count: c.metrics.sets })),
          c.cmp ? pctBadge(c.cmp.pct, { title: t(c.cmp.basis === 'reps' ? 'analysis.rp.repsVsPrev' : 'analysis.rp.tonnageVsPrev') }) : el('span', { class: 'wk-pct is-none' }, t('analysis.first')))))
      : el('p', { class: 't-sub muted' }, t('analysis.rp.notDone')),
    last && last.metrics.bodyweight ? el('div', { class: 'field-hint' }, t('analysis.rp.bwHint')) : null);
}

function sessionItem(s, exMap) {
  const tot = s.totals;
  const names = (ids) => ids.map((id) => exLabel(exMap, id)).join(t('analysis.nameSep'));
  const notes = [
    s.skipped.length ? t('analysis.rp.skipped', { names: names(s.skipped) }) : null,
    s.added.length ? t('analysis.rp.added', { names: names(s.added) }) : null,
    s.returned.length ? t('analysis.rp.back', { names: names(s.returned) }) : null,
  ].filter(Boolean).join(' · ');
  return el('a', {
    class: 'list-item', href: href(`workout/history/${encodeURIComponent(s.workout.id)}`),
    'aria-label': t('analysis.rp.sessionAria', { date: fmtDate(s.workout.date), tonnage: fmtTonnage(tot.load), change: pctWords(s.pct) }),
  },
  el('div', { class: 'li-main' },
    el('div', { class: 'li-title' }, fmtDate(s.workout.date)),
    el('div', { class: 'li-sub num wk-wrap' }, [
      tot.durationMs === null ? null : fmtDuration(tot.durationMs),
      tot.dropsets ? t('analysis.rp.colSetsDrop', { count: tot.sets, drop: tot.dropsets }) : t('analysis.rp.colSets', { count: tot.sets }),
      tot.dropLoad ? t('analysis.rp.tonnageDrop', { tonnage: fmtTonnage(tot.load), drop: fmtTonnage(tot.dropLoad) }) : fmtTonnage(tot.load),
    ].filter(Boolean).join(' · ')),
    notes ? el('div', { class: 'li-sub wk-wrap' }, notes) : null),
  el('span', { class: 'li-trail' }, s.prev ? pctBadge(s.pct) : el('span', { class: 't-sub muted' }, t('analysis.first'))),
  icon('chevron-right', { class: 'li-chevron' }));
}
