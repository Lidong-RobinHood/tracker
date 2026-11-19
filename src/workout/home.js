// Workout home: resume banner, start, muscle recovery, this week's sets per muscle, links. Route: workout
import * as db from '../db/db.js';
import { el, pageHeader, fmtTime, fmtNum, href } from '../ui/index.js';
import { today } from '../core/dates.js';
import { weeklyComparison, weeklyBreakdown, targetProgress, volumeWeights } from '../core/volume.js';
import { sessionStats, LIVE_WINDOW_MS } from '../core/workout.js';
import { breakdownText, breakdownAria, splitFill, breakdownCaption } from './volume-ui.js';
import { logPastWorkout } from './datetime.js';
import { MUSCLES } from '../core/muscles.js';
import { routineProgress } from '../core/workout-progress.js';
import { loadTargets } from './targets.js';
import { pctBadge, pctWords } from './progress-ui.js';
import { recoverySection, loadRecoverySetting } from './recovery.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, findUnfinished, startWorkout, shortDate } from './data.js';

export async function mountHome(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets, recovery] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(), loadRecoverySetting(),
  ]);
  const weights = volumeWeights(rawWeights);
  const open = findUnfinished(workouts);

  container.append(pageHeader({ title: 'Workout' }));

  if (open) {
    const st = sessionStats(open);
    container.append(el('a', { class: 'card wk-resume', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'grow' },
        el('div', { class: 'small wk-resume-kicker' }, 'Workout in progress'),
        el('div', { class: 'li-title' }, open.name),
        el('div', { class: 'li-sub' }, `${resumeWhen(open)} · ${st.setsDone} set${st.setsDone === 1 ? '' : 's'} done`)),
      el('span', { class: 'btn btn-primary' }, 'Resume')));
  }

  // Start
  const start = (r) => startWorkout(r);
  container.append(el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Start workout'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      ...routines.map((r) => el('button', { type: 'button', class: 'list-item', onClick: () => start(r) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, r.name),
          el('div', { class: 'li-sub' }, routineSub(r, exMap))),
        el('span', { class: 'wk-go', 'aria-hidden': 'true' }, 'Start'))),
      el('button', { type: 'button', class: 'list-item', onClick: () => start(null) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Empty workout'),
          el('div', { class: 'li-sub' }, 'Add exercises as you go'))),
      el('button', { type: 'button', class: 'list-item', onClick: () => logPastWorkout(routines) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Log a past workout'),
          el('div', { class: 'li-sub' }, 'Pick the day, then enter the sets'))),
      routines.length ? null : el('a', { class: 'list-item', href: href('workout/routines') },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, 'Create a routine'),
          el('div', { class: 'li-sub' }, 'e.g. Bench Press 3 x 6')))))));

  // Muscle recovery (general estimate; uses only the last 14 days of the already loaded workouts)
  container.append(recoverySection(workouts, exMap, weights, recovery));

  // Weekly volume (with optional targets: sets done / target and % reached)
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const parts = weeklyBreakdown(workouts, exMap, weights, today());
  const byMuscle = new Map(cmp.rows.map((r) => [r.muscle, r]));
  const rowsData = MUSCLES
    .filter((m) => byMuscle.has(m.id) || targets[m.id])
    .map((m) => byMuscle.get(m.id) || { muscle: m.id, name: m.name, current: 0, previous: 0 });
  const hasTargets = Object.keys(targets).length > 0;
  const max = Math.max(1, ...rowsData.filter((r) => !targets[r.muscle]).map((r) => Math.max(r.current, r.previous)));
  container.append(el('section', { class: 'section' },
    el('div', { class: 'row-between' },
      el('h2', { class: 'section-title' }, `This week · ${shortDate(cmp.weekStart)} – ${shortDate(cmp.weekEnd)}`),
      el('span', { class: 'small muted' }, hasTargets ? '% target · last wk' : 'last wk')),
    el('div', { class: 'card wk-volume' },
      rowsData.length
        ? rowsData.map((r) => volumeRow(r, targets[r.muscle], max, parts[r.muscle], weights))
        : el('p', { class: 'muted small' }, 'No sets this week or last week yet.'),
      el('p', { class: 'field-hint wk-vol-hint' }, breakdownCaption(weights),
        hasTargets ? 'Rows with a target show done / target; the bar is full at 100 %. ' : null,
        el('a', { href: href('settings') }, 'Change weights'), ' · ',
        el('a', { href: href('workout/targets') }, hasTargets ? 'Edit targets' : 'Set targets')))));

  // Routine progress
  if (routines.length) {
    container.append(el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Routine progress'),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, routines.map((r) => routineProgressItem(r, workouts))))));
  }

  // Links
  const finishedCount = workouts.filter((w) => w.finishedAt).length;
  const activeEx = [...exMap.values()].filter((e) => !e.archived).length;
  container.append(el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
    link('workout/routines', 'Routines', `${routines.length}`),
    link('workout/exercises', 'Exercise library', `${activeEx}`),
    link('workout/history', 'History', `${finishedCount}`),
    link('workout/targets', 'Weekly set targets', hasTargets ? `${Object.keys(targets).length}` : 'off'))));
}

function link(path, title, trail) {
  return el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    el('span', { class: 'li-trail muted' }, trail),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}

function routineSub(r, exMap) {
  const names = r.items.map((i) => exMap.get(i.exerciseId)).filter(Boolean).map((e) => e.name);
  if (!names.length) return 'No exercises';
  return names.join(', ');
}

/** 'Started 07:03' for a live session, 'Mon 9 Nov · past workout' for a back-dated one. */
function resumeWhen(w) {
  const now = Date.now();
  if (w.plannedDurationMs || now - w.startedAt > LIVE_WINDOW_MS || now < w.startedAt) return `${shortDate(w.date)} · past workout`;
  return `Started ${w.date === today() ? fmtTime(w.startedAt) : shortDate(w.date)}`;
}

function volumeRow(r, target, max, b, weights) {
  const tp = targetProgress(r.current, target);
  const parts = el('span', { class: 'wk-vol-parts small muted num', 'aria-hidden': 'true' }, breakdownText(b, weights));
  if (!tp) {
    return el('div', { class: 'wk-vol-row', role: 'group', 'aria-label': `${r.name}: ${fmtNum(r.current, 2)} sets this week (${breakdownAria(b, weights)}), ${fmtNum(r.previous, 2)} last week` },
      el('span', { class: 'wk-vol-name' }, r.name),
      el('span', { class: 'wk-vol-bar', 'aria-hidden': 'true' },
        splitFill(b, r.current / max),
        r.previous ? el('span', { class: 'wk-vol-prev', style: { left: `${(r.previous / max) * 100}%` } }) : null),
      el('span', { class: 'wk-vol-num num', 'aria-hidden': 'true' }, fmtNum(r.current, 2)),
      el('span', { class: 'wk-vol-last num muted small', 'aria-hidden': 'true' }, fmtNum(r.previous, 2)),
      parts);
  }
  const prevFrac = Math.min(1, r.previous / tp.target);
  return el('div', {
    class: 'wk-vol-row has-target', role: 'group',
    'aria-label': `${r.name}: ${fmtNum(r.current, 2)} of ${fmtNum(tp.target, 1)} target sets (${breakdownAria(b, weights)}), ${tp.pct} percent reached; ${fmtNum(r.previous, 2)} last week`,
  },
  el('span', { class: 'wk-vol-name' }, r.name),
  el('span', { class: 'wk-vol-bar is-target', 'aria-hidden': 'true' },
    splitFill(b, tp.fraction, tp.reached),
    r.previous ? el('span', { class: 'wk-vol-prev', style: { left: `${prevFrac * 100}%` } }) : null),
  el('span', { class: 'wk-vol-num num' }, `${fmtNum(r.current, 2)}/${fmtNum(tp.target, 1)}`),
  el('span', { class: ['wk-vol-last', 'num', 'small', tp.reached ? 'text-success' : 'muted'] }, `${tp.reached ? '✓' : ''}${tp.pct}%`),
  parts);
}

function routineProgressItem(r, workouts) {
  const rp = routineProgress(workouts, r);
  const last = rp.sessions[0];
  const sub = last
    ? `${rp.sessions.length} session${rp.sessions.length === 1 ? '' : 's'} · last ${shortDate(last.workout.date)}`
    : 'Not done yet';
  return el('a', {
    class: 'list-item', href: href(`workout/routines/${encodeURIComponent(r.id)}/progress`),
    'aria-label': `${r.name} progress: ${sub}${last && last.prev ? `, ${pctWords(last.pct)} volume versus the time before` : ''}`,
  },
  el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, r.name), el('div', { class: 'li-sub' }, sub)),
  last && last.prev ? el('span', { class: 'li-trail' }, pctBadge(last.pct)) : null,
  el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}
