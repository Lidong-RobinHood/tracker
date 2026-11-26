// History: finished sessions by month (each row: detail + direct link to its analysis), and a session detail (view, edit, delete).
// Routes: workout/history, workout/history/:id
import * as db from '../db/db.js';
import { el, replaceChildren, append, pageHeader, href, emptyState, toast, navigate, fmtDate, fmtDuration, fmtTime, fmtNum, icon, sectionHeader, setBadge } from '../ui/index.js';
import { sessionStats, doneSets, applySchedule, isLoggedWorkout, isBodyweightWeight } from '../core/workout.js';
import { workoutVolume, volumeWeights } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import { workoutGlyph } from './muscle-map.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, exName, confirmAction, fmtTarget, fmtWeight, workoutTitle, joinList } from './data.js';
import { t } from '../i18n/index.js';
import { muscleName } from '../i18n/names.js';
import { monthYear } from '../i18n/dates.js';
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
    title: t('workout.route.workout'),
    actions: [el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => logPastWorkout(routines) }, icon('plus', { size: 16 }), t('workout.history.logPast'))],
  }), workoutNav('history'));
  if (!done.length) {
    append(container, emptyState(t('workout.history.none'),
      el('a', { class: 'btn', href: href('workout') }, t('workout.history.goTrain'))));
    return;
  }

  // Group by month.
  const groups = new Map();
  for (const w of done) {
    const k = w.date.slice(0, 7);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(w);
  }
  for (const [k, ws] of groups) {
    const [y, m] = k.split('-').map(Number);
    append(container, el('section', { class: 'section' },
      sectionHeader(monthYear(new Date(y, m - 1, 1)), { trail: t('workout.history.entries', { count: ws.length }) }),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, ws.map((w) => {
        if (isBaseline(w)) return baselineItem(w, exMap);
        if (!isLoggedWorkout(w)) return emptyItem(w);
        const st = sessionStats(w);
        const names = w.exercises.filter((e) => doneSets(e).length).map((e) => exName(exMap, e.exerciseId));
        // Two targets per row: the workout's detail (main area) and its analysis (trailing link).
        return el('div', { class: 'list-item wk-hrow' },
          el('a', { class: 'wk-hrow-main', href: href(`workout/history/${encodeURIComponent(w.id)}`) },
            el('div', { class: 'li-main' },
              el('div', { class: 'li-title' }, workoutTitle(w)),
              el('div', { class: 'li-sub' }, t('workout.history.rowSub', { date: fmtDate(w.date), duration: fmtDuration(st.durationMs), count: st.setsDone })),
              names.length ? el('div', { class: 'li-sub' }, joinList(names)) : null)),
          el('a', {
            class: 'btn btn-icon btn-ghost wk-hrow-an', href: href(`workout/summary/${encodeURIComponent(w.id)}`),
            'aria-label': t('workout.history.analysisAria', { name: workoutTitle(w), date: fmtDate(w.date) }),
          }, icon('file-chart-column')));
      })))));
  }
}

/** A finished workout without any done set: label + delete (never counted anywhere). */
function emptyItem(w) {
  const row = el('div', { class: 'list-item wk-hrow is-empty' },
    el('a', { class: 'wk-hrow-main', href: href(`workout/history/${encodeURIComponent(w.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, workoutTitle(w)),
        el('div', { class: 'li-sub' }, t('workout.history.emptySub', { date: fmtDate(w.date) })))),
    el('button', {
      type: 'button', class: 'btn btn-icon btn-ghost text-danger wk-hrow-del', 'aria-label': t('workout.history.emptyDeleteAria', { name: workoutTitle(w), date: fmtDate(w.date) }),
      onClick: async () => {
        const ok = await confirmAction({ title: t('workout.history.emptyDeleteTitle'), message: t('workout.history.emptyDeleteMessage', { name: workoutTitle(w), date: fmtDate(w.date) }), confirmLabel: t('workout.action.delete'), danger: true });
        if (!ok) return;
        await db.remove('workouts', w.id);
        const section = row.closest('.section');
        const list = row.parentElement;
        row.remove();
        toast(t('workout.toast.deleted'));
        if (list && !list.children.length && section) section.remove();
      },
    }, icon('trash-2')));
  return row;
}

function baselineItem(w, exMap) {
  const names = w.exercises.map((e) => exName(exMap, e.exerciseId));
  return el('a', { class: 'list-item', href: href('workout/starting-point') },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, t('workout.startingPoint.title')),
      el('div', { class: 'li-sub' }, t('workout.history.baselineSub', { date: fmtDate(w.date), count: names.length })),
      names.length ? el('div', { class: 'li-sub' }, joinList(names)) : null),
    icon('chevron-right', { class: 'li-chevron' }));
}

export async function mountHistoryDetail(container, { id }) {
  ensureCss();
  const [w, exMap, weights, workouts] = await Promise.all([db.get('workouts', id), loadExercises(), db.getSetting('volume'), loadWorkouts()]);
  if (!w) {
    append(container, pageHeader({ title: t('workout.route.workout'), back: 'workout/history' }), emptyState(t('workout.session.notFound')));
    return;
  }
  if (isBaseline(w)) { navigate('workout/starting-point', { replace: true }); return; }
  const st = sessionStats(w);
  const editHref = href(`workout/session/${encodeURIComponent(w.id)}`);
  append(container, pageHeader({
    title: workoutTitle(w),
    subtitle: w.finishedAt
      ? `${fmtDate(w.date)} · ${fmtTime(w.startedAt)} · ${fmtDuration(st.durationMs)}`
      : t('workout.history.subInProgress', { date: fmtDate(w.date), time: fmtTime(w.startedAt) }),
    back: 'workout/history',
    actions: [workoutGlyph(w, exMap, weights), el('a', { class: 'btn btn-icon btn-ghost', href: editHref, 'aria-label': t('workout.history.edit') }, icon('pencil'))],
  }));

  for (const e of w.exercises) {
    let n = 0;
    append(container, el('section', { class: 'card wk-hcard' },
      el('div', { class: 'wk-card-head' },
        el('h2', { class: 'wk-ex-name' }, exName(exMap, e.exerciseId)),
        el('span', { class: 't-sub muted' }, t('workout.target.line', { target: fmtTarget(e) }))),
      e.sets.length
        ? el('div', { class: 'wk-hsets' },
          el('div', { class: 'wk-hset wk-set-head t-cap', 'aria-hidden': 'true' }, el('span', t('workout.set.head')), el('span', { class: 'no-caps' }, 'kg'), el('span', t('workout.target.reps')), el('span')),
          e.sets.map((s) => {
            const drop = s.type === 'dropset';
            return el('div', { class: ['wk-hset', drop && 'is-drop', s.done ? 'is-done' : 'is-undone'] },
              el('span', { class: 'wk-hset-n' }, drop ? setBadge(t('workout.set.dropBadge'), { title: t('workout.set.dropset') }) : String(++n)),
              el('span', isBodyweightWeight(s.weight) ? t('workout.format.bw') : fmtWeight(s.weight)),
              el('span', `${s.reps ?? '–'}`),
              s.done ? icon('check', { size: 16, label: t('workout.set.done'), class: 'wk-hset-ok' }) : el('span', { class: 't-sub muted' }, t('workout.set.notDone')));
          }))
        : el('p', { class: 't-sub muted' }, t('workout.routine.noSets')),
      e.note ? el('p', { class: 't-sub wk-hnote' }, e.note) : null));
  }

  if (w.finishedAt && st.setsDone) {
    const cmp = compareSession(workouts, w);
    append(container, comparisonSection(cmp.prevSession ? t('workout.compare.prevRoutine') : t('workout.compare.last'), cmp, exMap));
    if (w.routineId) append(container, el('a', { class: 'btn btn-block', href: href(`workout/routines/${encodeURIComponent(w.routineId)}/progress`) }, t('workout.route.routineProgress')));
  }

  const vol = workoutVolume(w, exMap, weights);
  const rows = MUSCLES.filter((m) => vol[m.id]);
  const maxSets = Math.max(1, ...rows.map((m) => vol[m.id]));
  append(container, el('section', { class: 'section' },
    withSetsInfo(sectionHeader(t('workout.summary.setsPerMuscle'), {
      trail: st.dropsets ? t('workout.summary.setsTrailDrop', { count: st.normalSets, drop: st.dropsets }) : t('workout.format.sets', { count: st.normalSets }),
    }), volumeWeights(weights), 'sets-workout'),
    el('div', { class: 'card' }, rows.length
      ? el('div', { class: 'wk-hbars' }, rows.map((m) => el('div', { class: 'wk-hbar' },
        el('span', { class: 'wk-hbar-name' }, muscleName(m.id)),
        el('span', { class: 'wk-hbar-track', 'aria-hidden': 'true' }, el('span', { class: 'wk-hbar-fill', style: { width: `${((vol[m.id] / maxSets) * 100).toFixed(1)}%` } })),
        el('span', { class: 'wk-hbar-val' }, fmtNum(vol[m.id], 2)))))
      : el('p', { class: 't-sub muted' }, t('workout.summary.noDoneSets')))));

  const editTime = async () => {
    const v = await changeDateTime(w);
    if (!v) return;
    applySchedule(w, v);
    w.updatedAt = Date.now();
    await db.put('workouts', w);
    toast(t('workout.toast.moved', { date: fmtDate(w.date), time: fmtTime(w.startedAt) }), { type: 'success' });
    replaceChildren(container);
    await mountHistoryDetail(container, { id });
  };

  append(container, 
    w.finishedAt ? el('a', { class: 'btn btn-primary btn-block', href: href(`workout/summary/${encodeURIComponent(w.id)}`) }, t('workout.summary.fullAnalysis')) : null,
    el('a', { class: 'btn btn-block', href: editHref }, t('workout.history.edit')),
    el('button', { type: 'button', class: 'btn btn-block', onClick: editTime }, icon('calendar'), t('workout.time.changeTitle')),
    el('button', {
      type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: async () => {
        const ok = await confirmAction({ title: t('workout.session.deleteTitle'), message: t('workout.history.deleteMessage'), confirmLabel: t('workout.action.delete'), danger: true });
        if (!ok) return;
        await db.remove('workouts', w.id);
        toast(t('workout.toast.deleted'));
        navigate('workout/history', { replace: true });
      },
    }, t('workout.session.delete')));
}
