// Workout home: resume banner, start, this week's sets per muscle, links. Route: workout
import * as db from '../db/db.js';
import { el, pageHeader, fmtTime, fmtNum, href } from '../ui/index.js';
import { today } from '../core/dates.js';
import { weeklyComparison } from '../core/volume.js';
import { sessionStats } from '../core/workout.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, findUnfinished, startWorkout, shortDate } from './data.js';

export async function mountHome(container) {
  ensureCss();
  const [workouts, exMap, routines, weights] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'),
  ]);
  const open = findUnfinished(workouts);

  container.append(pageHeader({ title: 'Workout' }));

  if (open) {
    const st = sessionStats(open);
    container.append(el('a', { class: 'card wk-resume', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'grow' },
        el('div', { class: 'small wk-resume-kicker' }, 'Workout in progress'),
        el('div', { class: 'li-title' }, open.name),
        el('div', { class: 'li-sub' }, `Started ${open.date === today() ? fmtTime(open.startedAt) : shortDate(open.date)} · ${st.setsDone} set${st.setsDone === 1 ? '' : 's'} done`)),
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
      routines.length ? null : el('a', { class: 'list-item', href: href('workout/routines') },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, 'Create a routine'),
          el('div', { class: 'li-sub' }, 'e.g. Bench Press 3 x 6')))))));

  // Weekly volume
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const max = Math.max(1, ...cmp.rows.map((r) => Math.max(r.current, r.previous)));
  container.append(el('section', { class: 'section' },
    el('div', { class: 'row-between' },
      el('h2', { class: 'section-title' }, `This week · ${shortDate(cmp.weekStart)} – ${shortDate(cmp.weekEnd)}`),
      el('span', { class: 'small muted' }, 'last wk')),
    el('div', { class: 'card wk-volume' },
      cmp.rows.length
        ? cmp.rows.map((r) => el('div', { class: 'wk-vol-row', 'aria-label': `${r.name}: ${fmtNum(r.current, 2)} sets this week, ${fmtNum(r.previous, 2)} last week` },
          el('span', { class: 'wk-vol-name' }, r.name),
          el('span', { class: 'wk-vol-bar', 'aria-hidden': 'true' },
            el('span', { class: 'wk-vol-fill', style: { width: `${(r.current / max) * 100}%` } }),
            r.previous ? el('span', { class: 'wk-vol-prev', style: { left: `${(r.previous / max) * 100}%` } }) : null),
          el('span', { class: 'wk-vol-num num' }, fmtNum(r.current, 2)),
          el('span', { class: 'wk-vol-last num muted small' }, fmtNum(r.previous, 2))))
        : el('p', { class: 'muted small' }, 'No sets this week or last week yet.'),
      el('p', { class: 'field-hint wk-vol-hint' }, `Primary ${fmtNum(weights.primary, 2)} · secondary ${fmtNum(weights.secondary, 2)} · dropset ${fmtNum(weights.dropset, 2)} per set. `,
        el('a', { href: href('settings') }, 'Change')))));

  // Links
  const finishedCount = workouts.filter((w) => w.finishedAt).length;
  const activeEx = [...exMap.values()].filter((e) => !e.archived).length;
  container.append(el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
    link('workout/routines', 'Routines', `${routines.length}`),
    link('workout/exercises', 'Exercise library', `${activeEx}`),
    link('workout/history', 'History', `${finishedCount}`))));
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
