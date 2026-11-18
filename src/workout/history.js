// History: finished sessions by date, and a session detail (view, edit, delete).
// Routes: workout/history, workout/history/:id
import * as db from '../db/db.js';
import { el, pageHeader, href, emptyState, confirmDialog, toast, navigate, fmtDate, fmtDuration, fmtTime, fmtNum } from '../ui/index.js';
import { sessionStats, formatTarget, formatWeight, doneSets } from '../core/workout.js';
import { workoutVolume } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import { ensureCss, loadExercises, loadWorkouts, exName } from './data.js';

export async function mountHistory(container) {
  ensureCss();
  const [workouts, exMap] = await Promise.all([loadWorkouts(), loadExercises()]);
  const done = workouts.filter((w) => w.finishedAt);
  container.append(pageHeader({ title: 'History', back: 'workout' }));
  if (!done.length) { container.append(emptyState('No finished workouts yet.')); return; }

  // Group by month.
  const groups = new Map();
  for (const w of done) {
    const k = w.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  for (const [k, ws] of groups) {
    const [y, m] = k.split('-').map(Number);
    container.append(el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, `${MONTHS[m - 1]} ${y}`),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, ws.map((w) => {
        const st = sessionStats(w);
        const names = w.exercises.filter((e) => doneSets(e).length).map((e) => exName(exMap, e.exerciseId));
        return el('a', { class: 'list-item', href: href(`workout/history/${encodeURIComponent(w.id)}`) },
          el('div', { class: 'li-main' },
            el('div', { class: 'li-title' }, w.name),
            el('div', { class: 'li-sub' }, `${fmtDate(w.date)} · ${fmtDuration(st.durationMs)} · ${st.setsDone} sets`),
            names.length ? el('div', { class: 'li-sub' }, names.join(', ')) : null),
          el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
      })))));
  }
}

export async function mountHistoryDetail(container, { id }) {
  ensureCss();
  const [w, exMap, weights] = await Promise.all([db.get('workouts', id), loadExercises(), db.getSetting('volume')]);
  if (!w) {
    container.append(pageHeader({ title: 'Workout', back: 'workout/history' }), emptyState('Workout not found.'));
    return;
  }
  const st = sessionStats(w);
  const editHref = href(`workout/session/${encodeURIComponent(w.id)}`);
  container.append(pageHeader({
    title: w.name,
    subtitle: `${fmtDate(w.date)} · ${fmtTime(w.startedAt)} · ${fmtDuration(st.durationMs)}${w.finishedAt ? '' : ' · in progress'}`,
    back: 'workout/history',
    actions: [el('a', { class: 'btn btn-sm', href: editHref }, 'Edit')],
  }));

  for (const e of w.exercises) {
    let n = 0;
    container.append(el('section', { class: 'card wk-hcard' },
      el('div', { class: 'row-between' },
        el('h2', { class: 'wk-ex-name' }, exName(exMap, e.exerciseId)),
        el('span', { class: 'small muted' }, formatTarget(e))),
      e.sets.length
        ? el('div', { class: 'wk-hsets' }, e.sets.map((s) => {
          const drop = s.type === 'dropset';
          return el('div', { class: ['wk-hset', drop && 'is-drop', !s.done && 'is-undone'] },
            el('span', { class: 'wk-hset-n' }, drop ? el('span', { class: 'badge badge-dropset' }, 'Drop') : String(++n)),
            el('span', { class: 'num' }, `${formatWeight(s.weight)}${formatWeight(s.weight) === 'BW' ? '' : ' kg'}`),
            el('span', { class: 'num' }, `× ${s.reps ?? '–'}`),
            el('span', { class: 'small muted' }, s.done ? '' : 'not done'));
        }))
        : el('p', { class: 'muted small' }, 'No sets.'),
      e.note ? el('p', { class: 'small wk-hnote' }, e.note) : null));
  }

  const vol = workoutVolume(w, exMap, weights);
  const rows = MUSCLES.filter((m) => vol[m.id]);
  container.append(el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, `Sets per muscle · ${st.normalSets} sets${st.dropsets ? ` + ${st.dropsets} drop` : ''}`),
    el('div', { class: 'card' }, rows.length
      ? rows.map((m) => el('div', { class: 'row-between' }, el('span', m.name), el('span', { class: 'num' }, fmtNum(vol[m.id], 2))))
      : el('p', { class: 'muted small' }, 'No done sets.'))));

  container.append(
    el('a', { class: 'btn btn-block', href: editHref }, 'Edit workout'),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: async () => {
        const ok = await confirmDialog({ title: 'Delete workout?', message: 'This workout and its sets will be deleted. This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await db.remove('workouts', w.id);
        toast('Workout deleted');
        navigate('workout/history', { replace: true });
      },
    }, 'Delete workout'));
}
