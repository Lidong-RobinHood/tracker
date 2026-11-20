// Routine progress: every time a routine was performed, as a chart and a list, per-exercise trend and
// "this time vs last time". Route: workout/routines/:id/progress
import * as db from '../db/db.js';
import { el, replaceChildren, append, pageHeader, href, emptyState, fmtDate, fmtDuration, icon, sectionHeader, statTile } from '../ui/index.js';
import { routineProgress, compareSession } from '../core/workout-progress.js';
import { ensureCss, loadExercises, loadWorkouts, exName, shortDate, startWorkout } from './data.js';
import { lineChart } from './chart.js';
import { workoutGlyph } from './muscle-map.js';
import { pctBadge, pctWords, fmtTonnage, topText, comparisonBlock, durationParts } from './progress-ui.js';

/** Sessions shown side by side per exercise. */
const COLS = 4;
/** Sessions listed before "Show all". */
const PAGE = 15;

export async function mountRoutineProgress(container, { id }) {
  ensureCss();
  const [routine, exMap, workouts, weights] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts(), db.getSetting('volume')]);
  if (!routine) {
    append(container, pageHeader({ title: 'Progress', back: 'workout' }), emptyState('Routine not found.'));
    return;
  }
  const rp = routineProgress(workouts, routine);
  const n = rp.sessions.length;
  append(container, pageHeader({
    // the latest session's muscles at a glance
    title: routine.name,
    subtitle: `Progress · ${n} session${n === 1 ? '' : 's'}`,
    back: `workout/routines/${encodeURIComponent(routine.id)}`,
    actions: [n ? workoutGlyph(rp.sessions[0].workout, exMap, weights) : null,
      el('a', { class: 'btn btn-icon btn-ghost', href: href(`workout/routines/${encodeURIComponent(routine.id)}`), 'aria-label': 'Edit routine' }, icon('pencil'))].filter(Boolean),
  }));

  if (!n) {
    append(container, emptyState('No sessions yet.',
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => startWorkout(routine) }, 'Start this routine')));
    return;
  }

  // ---------------------------------------------------------- this time vs last time
  const latest = rp.sessions[0];
  const cmp = compareSession(workouts, latest.workout);
  append(container, el('section', { class: 'section' },
    sectionHeader(n > 1 ? `Latest vs the one before · ${shortDate(latest.workout.date)}` : `First session · ${shortDate(latest.workout.date)}`, { info: 'tonnage' }),
    // Tonnage once: in the comparison card below, with its change beside it.
    el('div', { class: 'tiles wk-tiles-2' },
      statTile({ label: 'Duration', ...durationParts(latest.totals.durationMs) }),
      statTile({ label: 'Sets', value: String(latest.totals.sets), sub: latest.totals.dropsets ? `+ ${latest.totals.dropsets} drop` : null })),
    el('div', { class: 'card' }, comparisonBlock(cmp, exMap))));

  // ---------------------------------------------------------- chart
  const chrono = [...rp.sessions].reverse();
  append(container, el('section', { class: 'section' },
    sectionHeader('Tonnage per session', { info: 'tonnage' }),
    el('div', { class: 'card wk-chart-card' },
      lineChart({
        points: chrono.map((s) => ({ date: s.workout.date, value: s.totals.load, label: fmtTonnage(s.totals.load) })),
        // axis: the shared rule without the kg unit ('2 340', '12.48 t')
        format: (v) => fmtTonnage(v).replace(/ kg$/, ''),
        ariaLabel: `Tonnage of ${routine.name} over ${n} sessions, from ${fmtTonnage(chrono[0].totals.load)} to ${fmtTonnage(latest.totals.load)}`,
        zero: false,
      }))));

  // ---------------------------------------------------------- per exercise
  append(container, el('section', { class: 'section' },
    sectionHeader(`Exercises · last ${COLS} times`),
    el('div', { class: 'stack' }, rp.exercises.map((x) => exerciseRow(x, exMap)))));

  // ---------------------------------------------------------- sessions
  const list = el('div', { class: 'list' });
  const renderList = (all) => {
    replaceChildren(list, ...rp.sessions.slice(0, all ? undefined : PAGE).map((s) => sessionItem(s, exMap)));
    if (!all && n > PAGE) {
      append(list, el('button', { type: 'button', class: 'list-item wk-more', onClick: () => renderList(true) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, `Show all ${n} sessions`))));
    }
  };
  renderList(false);
  append(container, el('section', { class: 'section' },
    sectionHeader('Every session', { trail: '% vs previous' }),
    el('div', { class: 'card card-flush' }, list)));
}

function exerciseRow(x, exMap) {
  const name = exName(exMap, x.exerciseId);
  const cols = x.entries.slice(0, COLS).reverse(); // oldest -> newest, left to right
  const last = x.entries[0];
  const label = last
    ? `${name}: last ${topText(last.metrics.top)} on ${shortDate(last.workout.date)}, ${pctWords(last.cmp && last.cmp.pct)} versus the previous time. Open exercise progress.`
    : `${name}: not done yet. Open exercise.`;
  return el('a', { class: 'card wk-xrow', href: href(`workout/exercises/${encodeURIComponent(x.exerciseId)}`), 'aria-label': label },
    el('div', { class: 'row-between' },
      el('div', { class: 'li-title truncate' }, name, x.inRoutine ? null : el('span', { class: 'tag wk-badge-gap' }, 'Not in routine')),
      icon('chevron-right', { class: 'li-chevron' })),
    cols.length
      ? el('div', { class: 'wk-xcols', 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` } },
        cols.map((c, i) => el('div', { class: ['wk-xcol', i === cols.length - 1 && 'is-latest'] },
          el('div', { class: 't-sub muted' }, shortDate(c.workout.date)),
          el('div', { class: 'wk-xtop' }, topText(c.metrics.top)),
          el('div', { class: 't-sub muted' }, `${c.metrics.sets} set${c.metrics.sets === 1 ? '' : 's'}${c.metrics.dropsets ? ` + ${c.metrics.dropsets} drop` : ''}`),
          c.cmp ? pctBadge(c.cmp.pct, { title: c.cmp.basis === 'reps' ? 'Reps vs previous' : 'Tonnage vs previous' }) : el('span', { class: 'wk-pct is-none' }, 'first'))))
      : el('p', { class: 't-sub muted' }, 'Not done in this routine yet.'),
    last && last.metrics.bodyweight ? el('div', { class: 'field-hint' }, 'Bodyweight: % is total reps.') : null);
}

function sessionItem(s, exMap) {
  const t = s.totals;
  const notes = [
    s.skipped.length ? `skipped ${s.skipped.map((id) => exName(exMap, id)).join(', ')}` : null,
    s.added.length ? `added ${s.added.map((id) => exName(exMap, id)).join(', ')}` : null,
    s.returned.length ? `back: ${s.returned.map((id) => exName(exMap, id)).join(', ')}` : null,
  ].filter(Boolean).join(' · ');
  return el('a', {
    class: 'list-item', href: href(`workout/history/${encodeURIComponent(s.workout.id)}`),
    'aria-label': `${fmtDate(s.workout.date)}: ${fmtTonnage(t.load)}, ${pctWords(s.pct)} versus the previous session`,
  },
  el('div', { class: 'li-main' },
    el('div', { class: 'li-title' }, fmtDate(s.workout.date)),
    el('div', { class: 'li-sub num wk-wrap' }, [
      t.durationMs === null ? null : fmtDuration(t.durationMs),
      `${t.sets} sets${t.dropsets ? ` + ${t.dropsets} drop` : ''}`,
      fmtTonnage(t.load) + (t.dropLoad ? ` (+ ${fmtTonnage(t.dropLoad)} drop)` : ''),
    ].filter(Boolean).join(' · ')),
    notes ? el('div', { class: 'li-sub wk-wrap' }, notes) : null),
  el('span', { class: 'li-trail' }, s.prev ? pctBadge(s.pct) : el('span', { class: 't-sub muted' }, 'first')),
  icon('chevron-right', { class: 'li-chevron' }));
}
