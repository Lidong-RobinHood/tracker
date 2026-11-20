// History: finished sessions by month (each row: detail + direct link to its analysis), and a session detail (view, edit, delete).
// Routes: workout/history, workout/history/:id
import * as db from '../db/db.js';
import { el, replaceChildren, append, pageHeader, href, emptyState, toast, navigate, fmtDate, fmtDuration, fmtTime, fmtNum, icon, sectionHeader, setBadge } from '../ui/index.js';
import { sessionStats, formatTarget, formatWeight, doneSets, applySchedule, isLoggedWorkout } from '../core/workout.js';
import { workoutVolume, volumeWeights } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import { workoutGlyph } from './muscle-map.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, exName, confirmAction } from './data.js';
import { changeDateTime, logPastWorkout } from './datetime.js';
import { compareSession } from '../core/workout-progress.js';
import { comparisonSection } from './progress-ui.js';
import { withSetsInfo } from './volume-ui.js';
import { isBaseline, findBaseline } from '../core/baseline.js';
import { workoutNav } from './subnav.js';

export async function mountHistory(container) {
  ensureCss();
  const [workouts, exMap, routines] = await Promise.all([loadWorkouts(), loadExercises(), loadRoutines()]);
  // Real finished sessions, plus the starting point as one labelled item (not a workout).
  const baseline = findBaseline(workouts);
  // Finished workouts without a done set (left by older versions) are listed too, labelled
  // "no sets logged" with a delete action; no statistic counts them (isLoggedWorkout).
  const done = workouts.filter((w) => w.finishedAt && (!isBaseline(w) || w === baseline));
  append(container, pageHeader({
    title: 'Workout',
    actions: [el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => logPastWorkout(routines) }, icon('plus', { size: 16 }), 'Log past')],
  }), workoutNav('history'));
  if (!done.length) {
    append(container, emptyState('No finished workouts yet.',
      el('a', { class: 'btn', href: href('workout') }, 'Go to Train')));
    return;
  }

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
    append(container, el('section', { class: 'section' },
      sectionHeader(`${MONTHS[m - 1]} ${y}`, { trail: `${ws.length} ${ws.length === 1 ? 'entry' : 'entries'}` }),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, ws.map((w) => {
        if (isBaseline(w)) return baselineItem(w, exMap);
        if (!isLoggedWorkout(w)) return emptyItem(w);
        const st = sessionStats(w);
        const names = w.exercises.filter((e) => doneSets(e).length).map((e) => exName(exMap, e.exerciseId));
        // Two targets per row: the workout's detail (main area) and its analysis (trailing link).
        return el('div', { class: 'list-item wk-hrow' },
          el('a', { class: 'wk-hrow-main', href: href(`workout/history/${encodeURIComponent(w.id)}`) },
            el('div', { class: 'li-main' },
              el('div', { class: 'li-title' }, w.name),
              el('div', { class: 'li-sub' }, `${fmtDate(w.date)} · ${fmtDuration(st.durationMs)} · ${st.setsDone} set${st.setsDone === 1 ? '' : 's'}`),
              names.length ? el('div', { class: 'li-sub' }, names.join(', ')) : null)),
          el('a', {
            class: 'btn btn-icon btn-ghost wk-hrow-an', href: href(`workout/summary/${encodeURIComponent(w.id)}`),
            'aria-label': `Analysis of ${w.name}, ${fmtDate(w.date)}`,
          }, icon('file-chart-column')));
      })))));
  }
}

/** A finished workout without any done set: label + delete (never counted anywhere). */
function emptyItem(w) {
  const row = el('div', { class: 'list-item wk-hrow is-empty' },
    el('a', { class: 'wk-hrow-main', href: href(`workout/history/${encodeURIComponent(w.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, w.name),
        el('div', { class: 'li-sub' }, `${fmtDate(w.date)} · no sets logged · not counted`))),
    el('button', {
      type: 'button', class: 'btn btn-icon btn-ghost text-danger wk-hrow-del', 'aria-label': `Delete ${w.name}, ${fmtDate(w.date)} (no sets logged)`,
      onClick: async () => {
        const ok = await confirmAction({ title: 'Delete empty workout?', message: `“${w.name}” on ${fmtDate(w.date)} has no sets logged. Delete it?`, confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await db.remove('workouts', w.id);
        const section = row.closest('.section');
        const list = row.parentElement;
        row.remove();
        toast('Workout deleted');
        if (list && !list.children.length && section) section.remove();
      },
    }, icon('trash-2')));
  return row;
}

function baselineItem(w, exMap) {
  const names = w.exercises.map((e) => exName(exMap, e.exerciseId));
  return el('a', { class: 'list-item', href: href('workout/starting-point') },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, 'Starting point'),
      el('div', { class: 'li-sub' }, `As of ${fmtDate(w.date)} · ${names.length} exercise${names.length === 1 ? '' : 's'} · not a workout`),
      names.length ? el('div', { class: 'li-sub' }, names.join(', ')) : null),
    icon('chevron-right', { class: 'li-chevron' }));
}

export async function mountHistoryDetail(container, { id }) {
  ensureCss();
  const [w, exMap, weights, workouts] = await Promise.all([db.get('workouts', id), loadExercises(), db.getSetting('volume'), loadWorkouts()]);
  if (!w) {
    append(container, pageHeader({ title: 'Workout', back: 'workout/history' }), emptyState('Workout not found.'));
    return;
  }
  if (isBaseline(w)) { navigate('workout/starting-point', { replace: true }); return; }
  const st = sessionStats(w);
  const editHref = href(`workout/session/${encodeURIComponent(w.id)}`);
  append(container, pageHeader({
    title: w.name,
    subtitle: `${fmtDate(w.date)} · ${fmtTime(w.startedAt)}${w.finishedAt ? ` · ${fmtDuration(st.durationMs)}` : ' · in progress'}`,
    back: 'workout/history',
    actions: [workoutGlyph(w, exMap, weights), el('a', { class: 'btn btn-icon btn-ghost', href: editHref, 'aria-label': 'Edit workout' }, icon('pencil'))],
  }));

  for (const e of w.exercises) {
    let n = 0;
    append(container, el('section', { class: 'card wk-hcard' },
      el('div', { class: 'wk-card-head' },
        el('h2', { class: 'wk-ex-name' }, exName(exMap, e.exerciseId)),
        el('span', { class: 't-sub muted' }, `Target ${formatTarget(e)}`)),
      e.sets.length
        ? el('div', { class: 'wk-hsets' },
          el('div', { class: 'wk-hset wk-set-head t-cap', 'aria-hidden': 'true' }, el('span', 'Set'), el('span', 'kg'), el('span', 'Reps'), el('span')),
          e.sets.map((s) => {
            const drop = s.type === 'dropset';
            const bw = formatWeight(s.weight) === 'BW';
            return el('div', { class: ['wk-hset', drop && 'is-drop', s.done ? 'is-done' : 'is-undone'] },
              el('span', { class: 'wk-hset-n' }, drop ? setBadge('D', { title: 'Dropset' }) : String(++n)),
              el('span', bw ? 'BW' : formatWeight(s.weight)),
              el('span', `${s.reps ?? '–'}`),
              s.done ? icon('check', { size: 16, label: 'Done', class: 'wk-hset-ok' }) : el('span', { class: 't-sub muted' }, 'not done'));
          }))
        : el('p', { class: 't-sub muted' }, 'No sets.'),
      e.note ? el('p', { class: 't-sub wk-hnote' }, e.note) : null));
  }

  if (w.finishedAt && st.setsDone) {
    const cmp = compareSession(workouts, w);
    append(container, comparisonSection(cmp.prevSession ? 'vs the previous time of this routine' : 'vs last time', cmp, exMap));
    if (w.routineId) append(container, el('a', { class: 'btn btn-block', href: href(`workout/routines/${encodeURIComponent(w.routineId)}/progress`) }, 'Routine progress'));
  }

  const vol = workoutVolume(w, exMap, weights);
  const rows = MUSCLES.filter((m) => vol[m.id]);
  const maxSets = Math.max(1, ...rows.map((m) => vol[m.id]));
  append(container, el('section', { class: 'section' },
    withSetsInfo(sectionHeader('Sets per muscle', { trail: `${st.normalSets} sets${st.dropsets ? ` + ${st.dropsets} drop` : ''}` }), volumeWeights(weights), 'sets-workout'),
    el('div', { class: 'card' }, rows.length
      ? el('div', { class: 'wk-hbars' }, rows.map((m) => el('div', { class: 'wk-hbar' },
        el('span', { class: 'wk-hbar-name' }, m.name),
        el('span', { class: 'wk-hbar-track', 'aria-hidden': 'true' }, el('span', { class: 'wk-hbar-fill', style: { width: `${((vol[m.id] / maxSets) * 100).toFixed(1)}%` } })),
        el('span', { class: 'wk-hbar-val' }, fmtNum(vol[m.id], 2)))))
      : el('p', { class: 't-sub muted' }, 'No done sets.'))));

  const editTime = async () => {
    const v = await changeDateTime(w);
    if (!v) return;
    applySchedule(w, v);
    w.updatedAt = Date.now();
    await db.put('workouts', w);
    toast(`Moved to ${fmtDate(w.date)}, ${fmtTime(w.startedAt)}`, { type: 'success' });
    replaceChildren(container);
    await mountHistoryDetail(container, { id });
  };

  append(container, 
    w.finishedAt ? el('a', { class: 'btn btn-primary btn-block', href: href(`workout/summary/${encodeURIComponent(w.id)}`) }, 'Full analysis') : null,
    el('a', { class: 'btn btn-block', href: editHref }, 'Edit workout'),
    el('button', { type: 'button', class: 'btn btn-block', onClick: editTime }, icon('calendar'), 'Change date, time, duration'),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: async () => {
        const ok = await confirmAction({ title: 'Delete workout?', message: 'This cannot be undone.', confirmLabel: 'Delete', danger: true });
        if (!ok) return;
        await db.remove('workouts', w.id);
        toast('Workout deleted');
        navigate('workout/history', { replace: true });
      },
    }, 'Delete workout'));
}
