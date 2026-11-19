// Routine progress: every time a routine was performed, as a chart and a list, per-exercise trend and
// "this time vs last time". Route: workout/routines/:id/progress
import * as db from '../db/db.js';
import { el, replaceChildren, append, pageHeader, href, emptyState, fmtDate, fmtDuration } from '../ui/index.js';
import { routineProgress, compareSession } from '../core/workout-progress.js';
import { ensureCss, loadExercises, loadWorkouts, exName, shortDate, startWorkout } from './data.js';
import { lineChart } from './chart.js';
import { pctBadge, pctWords, fmtLoad, fmtLoadNum, topText, comparisonBlock } from './progress-ui.js';

/** Sessions shown side by side per exercise. */
const COLS = 4;
/** Sessions listed before "Show all". */
const PAGE = 15;

export async function mountRoutineProgress(container, { id }) {
  ensureCss();
  const [routine, exMap, workouts] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts()]);
  if (!routine) {
    append(container, pageHeader({ title: 'Progress', back: 'workout' }), emptyState('Routine not found.'));
    return;
  }
  const rp = routineProgress(workouts, routine);
  const n = rp.sessions.length;
  append(container, pageHeader({
    title: routine.name,
    subtitle: `Progress · ${n} session${n === 1 ? '' : 's'}`,
    back: `workout/routines/${encodeURIComponent(routine.id)}`,
    actions: [el('a', { class: 'btn btn-sm', href: href(`workout/routines/${encodeURIComponent(routine.id)}`) }, 'Edit')],
  }));

  if (!n) {
    append(container, emptyState('No finished sessions of this routine yet. Progress appears after the first one.',
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => startWorkout(routine) }, 'Start this routine')));
    return;
  }

  // ---------------------------------------------------------- this time vs last time
  const latest = rp.sessions[0];
  const cmp = compareSession(workouts, latest.workout);
  append(container, el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, n > 1 ? `Latest session vs the one before · ${shortDate(latest.workout.date)}` : `First session · ${shortDate(latest.workout.date)}`),
    el('div', { class: 'card' },
      el('div', { class: 'grid-3 wk-stats' },
        stat(latest.totals.durationMs === null ? '–' : `${Math.round(latest.totals.durationMs / 60000)}`, 'min'),
        stat(String(latest.totals.sets), latest.totals.dropsets ? `Sets + ${latest.totals.dropsets} drop` : 'Sets'),
        stat(`${fmtLoadNum(latest.totals.load)}`, 'kg volume')),
      n > 1 ? null : el('p', { class: 'small muted' }, 'Do this routine again to see what went up, stalled or went down.'),
      comparisonBlock(cmp, exMap))));

  // ---------------------------------------------------------- chart
  const chrono = [...rp.sessions].reverse();
  append(container, el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Volume load per session'),
    el('div', { class: 'card wk-chart-card' },
      lineChart({
        points: chrono.map((s) => ({ date: s.workout.date, value: s.totals.load })),
        format: (v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : fmtLoadNum(v)),
        ariaLabel: `Volume load of ${routine.name} over ${n} sessions, from ${fmtLoad(chrono[0].totals.load)} to ${fmtLoad(latest.totals.load)}`,
        zero: false,
      }),
      el('p', { class: 'field-hint' }, 'Volume load = weight × reps of every ticked normal set. Dropsets are not included (shown separately). Bodyweight sets count 0 kg.'))));

  // ---------------------------------------------------------- per exercise
  append(container, el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, `Exercises · last ${COLS} times`),
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
    el('h2', { class: 'section-title' }, 'Every session · % vs the previous one'),
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
      el('div', { class: 'li-title truncate' }, name, x.inRoutine ? null : el('span', { class: 'badge wk-badge-gap' }, 'Not in routine')),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›')),
    cols.length
      ? el('div', { class: 'wk-xcols', 'aria-hidden': 'true', style: { gridTemplateColumns: `repeat(${COLS}, minmax(0, 1fr))` } },
        cols.map((c, i) => el('div', { class: ['wk-xcol', i === cols.length - 1 && 'is-latest'] },
          el('div', { class: 'small muted' }, shortDate(c.workout.date)),
          el('div', { class: 'wk-xtop num' }, topText(c.metrics.top)),
          el('div', { class: 'small muted num' }, `${c.metrics.sets} set${c.metrics.sets === 1 ? '' : 's'}${c.metrics.dropsets ? ` +${c.metrics.dropsets}d` : ''}`),
          c.cmp ? pctBadge(c.cmp.pct, { title: c.cmp.basis === 'reps' ? 'Total reps vs previous time' : 'Volume load vs previous time' }) : el('span', { class: 'wk-pct is-none small' }, 'first'))))
      : el('p', { class: 'small muted' }, 'Not done in this routine yet.'),
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
    'aria-label': `${fmtDate(s.workout.date)}: ${fmtLoad(t.load)}, ${pctWords(s.pct)} versus the previous session`,
  },
  el('div', { class: 'li-main' },
    el('div', { class: 'li-title' }, fmtDate(s.workout.date)),
    el('div', { class: 'li-sub num wk-wrap' }, [
      t.durationMs === null ? null : fmtDuration(t.durationMs),
      `${t.sets} sets${t.dropsets ? ` + ${t.dropsets} drop` : ''}`,
      fmtLoad(t.load) + (t.dropLoad ? ` (+${fmtLoadNum(t.dropLoad)} drop)` : ''),
    ].filter(Boolean).join(' · ')),
    notes ? el('div', { class: 'li-sub wk-wrap' }, notes) : null),
  el('span', { class: 'li-trail' }, s.prev ? pctBadge(s.pct) : el('span', { class: 'small muted' }, 'first')),
  el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}

function stat(value, label) {
  return el('div', { class: 'wk-stat' }, el('div', { class: 'wk-stat-value num' }, value), el('div', { class: 'small muted' }, label));
}
