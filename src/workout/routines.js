// Routines: list (reorder, start, create) and editor (autosaved). Routes: workout/routines, workout/routines/:id
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, numberInput, toast, navigate, href, emptyState, icon, iconButton, sectionHeader,
  cardHeader, segmented, setBodyMapValues, fmtNum,
} from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { routineSets, sessionStep, sessionBands, mapSteps } from '../core/routine-sets.js';
import { setsGlyph, setsMap, setsMapRow, setsRow, setsList } from './muscle-map.js';
import { normaliseTarget, DEFAULT_TARGET, lastEntryFor, MAX_TARGET_WEIGHT, NEW_ROUTINE_NAME } from '../core/workout.js';
import {
  ensureCss, loadExercises, loadRoutines, loadWorkouts, startWorkout, newRoutine, nextRoutineOrder, createSaver, exName,
  navAction, swallowTaps, confirmAction, fmtTarget, joinList,
} from './data.js';
import { pickExercise } from './picker.js';
import { t } from '../i18n/index.js';
import { muscleName, routineName, nameForSave } from '../i18n/names.js';

/** "+ New" / "Create routine": a double tap creates one routine and never lands on the editor. */
const createRoutine = () => navAction(async () => {
  const r = newRoutine(NEW_ROUTINE_NAME, [], await nextRoutineOrder()); // stored marker, shown translated (routineName)
  await db.put('routines', r);
  swallowTaps();
  navigate(`workout/routines/${encodeURIComponent(r.id)}?new=1`);
  return true;
});

/** Small two-figure map of one session of a routine, shaded by its sets per muscle. */
export function routineGlyph(routine, exMap, weights) {
  return setsGlyph(mapSteps(routineSets(routine, exMap, weights)));
}

/**
 * Where the editor's Back goes: `?back=` when it is an in-app route path (e.g. 'workout/splits/custom:…'
 * from a split being edited), else the routines list. No scheme, no '//', no leading '/' or '#'.
 */
export function backPath(q) {
  const p = typeof q === 'string' ? q.trim() : '';
  if (!p || p.length > 300 || /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || /^(javascript|data):/i.test(p) || p.includes('//')
    || /^[/#\\]/.test(p) || /[\s<>"'`\\]/.test(p)) return 'workout/routines';
  return p;
}

/** Map / Sets of the routine editor, kept while the app runs. */
const view = { sets: 'map' };

export async function mountRoutines(container) {
  ensureCss();
  const [routines, exMap, weights] = await Promise.all([loadRoutines(), loadExercises(), db.getSetting('volume')]);
  const list = el('div', { class: 'list' });

  async function swap(i, d) {
    const a = routines[i];
    const b = routines[i + d];
    [routines[i], routines[i + d]] = [b, a];
    const now = Date.now();
    routines.forEach((r, k) => { r.order = k; r.updatedAt = now; });
    await db.putMany('routines', routines);
    render();
  }

  function render() {
    replaceChildren(list, ...routines.map((r, i) => el('div', { class: 'list-item wk-routine-row' },
      el('a', { class: 'li-main wk-routine-link', href: href(`workout/routines/${encodeURIComponent(r.id)}`) },
        routineGlyph(r, exMap, weights),
        el('div', { class: 'wk-routine-text' },
          el('div', { class: 'li-title' }, routineName(r)),
          el('div', { class: 'li-sub' }, r.items.length
            ? r.items.map((it) => `${exName(exMap, it.exerciseId)} ${fmtTarget(it).replace(/ /g, '\u00a0')}`).join(' · ')
            : t('workout.routine.noExercises')))),
      iconButton('arrow-up', { label: t('workout.routine.moveNamedUp', { name: routineName(r) }), class: 'wk-icon-sm', disabled: i === 0, onClick: () => swap(i, -1) }),
      iconButton('arrow-down', { label: t('workout.routine.moveNamedDown', { name: routineName(r) }), class: 'wk-icon-sm', disabled: i === routines.length - 1, onClick: () => swap(i, 1) }),
      el('button', { type: 'button', class: 'btn btn-sm', onClick: navAction(() => startWorkout(r)) }, t('workout.start.start')))));
  }
  render();

  append(container, 
    pageHeader({
      title: t('workout.route.routines'), back: 'workout',
      actions: [el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': t('workout.routine.new'), onClick: createRoutine() }, icon('plus'))],
    }),
    routines.length
      ? el('div', { class: 'card card-flush' }, list)
      : emptyState(t('workout.routine.noneYet'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: createRoutine() }, t('workout.routine.create'))));
}

export async function mountRoutineEdit(container, { id }, ctx) {
  ensureCss();
  const [routine, exMap, workouts, weights] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts(), db.getSetting('volume')]);
  if (!routine) {
    append(container, pageHeader({ title: t('workout.route.routine'), back: backPath(ctx.query.back) }), emptyState(t('workout.routine.notFound')));
    return undefined;
  }
  let gone = false;
  const saver = createSaver('routines', () => (gone ? null : routine),
    (err) => toast(t('workout.error.save', { error: err && err.message }), { type: 'error' }));
  const save = () => saver.save();

  const backTo = backPath(ctx.query.back);
  const header = pageHeader({
    title: routineName(routine), subtitle: t('workout.routine.autosaved'), back: backTo,
    actions: [el('a', { class: 'btn btn-icon btn-ghost', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`), 'aria-label': t('workout.route.routineProgress') }, icon('chart-line'))],
  });
  const titleEl = header.querySelector('.page-title');
  const stored = { name: routine.name, shown: routineName(routine) };
  const name = el('input', {
    class: 'input', type: 'text', value: stored.shown, maxlength: '60', 'aria-label': t('workout.routine.nameAria'),
    onInput: () => {
      const n = name.value.trim();
      if (!n) return;
      routine.name = nameForSave(stored.name, stored.shown, n); titleEl.textContent = n; save();
    },
  });
  const itemsEl = el('div', { class: 'stack' });

  // Muscles: sets per muscle of one session of this routine (map or list), live with every change.
  const map = setsMap();
  const musBody = el('div');
  const musToggle = segmented({
    small: true, ariaLabel: t('workout.sets.showAs'), value: view.sets,
    options: [{ value: 'map', label: t('workout.sets.map') }, { value: 'list', label: t('workout.sets.list') }],
    onChange: (v) => { view.sets = v; paintMuscles(); },
  });
  const musCard = el('section', { class: 'card wk-rmus' }, cardHeader(t('workout.exercise.muscles'), { trail: musToggle }), musBody);
  function paintMuscles() {
    musCard.hidden = !routine.items.length;
    const sets = routineSets(routine, exMap, weights);
    const trained = MUSCLES.filter((m) => sets[m.id].total > 0);
    map.setAttribute('aria-label', t('workout.routine.mapAria', { list: joinList(trained.map((m) => `${muscleName(m.id)} ${fmtNum(sets[m.id].total, 1)}`)) || t('workout.muscles.none') }));
    setBodyMapValues(map, mapSteps(sets));
    replaceChildren(musBody, view.sets === 'map'
      ? setsMapRow(map, sessionBands(weights), t('workout.routine.setsPerSession'), { caption: t('workout.routine.setsCaption') })
      : trained.length
        ? setsList(trained.map((m) => setsRow(muscleName(m.id), sets[m.id], { step: sessionStep(sets[m.id].total) })))
        : el('p', { class: 't-sub muted' }, t('workout.routine.noSets')));
  }

  function render() {
    replaceChildren(itemsEl, ...routine.items.map((it, i) => {
      const upd = () => {
        Object.assign(it, normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber(), targetWeight: wt.getNumber() }));
        paintMuscles();
        save();
      };
      const sets = numberInput({ value: it.targetSets, min: 1, max: 20, integer: true, ariaLabel: t('workout.target.setsAria'), onInput: upd });
      const reps = numberInput({ value: it.targetReps, min: 1, max: 100, integer: true, ariaLabel: t('workout.target.repsAria'), onInput: upd });
      const max = numberInput({ value: it.targetRepsMax, min: 1, max: 100, integer: true, placeholder: '–', ariaLabel: t('workout.target.maxAriaOptional'), onInput: upd });
      const wt = numberInput({ value: it.targetWeight ?? null, min: 0, max: MAX_TARGET_WEIGHT, decimals: 2, placeholder: '–', ariaLabel: t('workout.target.weightAriaOptional'), onInput: upd });
      // Show the normalised values when leaving a field (e.g. max ≤ reps is dropped).
      for (const f of [sets, reps, max, wt]) {
        f.addEventListener('change', () => {
          sets.setNumber(it.targetSets); reps.setNumber(it.targetReps); max.setNumber(it.targetRepsMax); wt.setNumber(it.targetWeight ?? null);
        });
      }
      return el('div', { class: 'card wk-ritem' },
        el('div', { class: 'row-between' },
          el('div', { class: 't-head grow wk-min0' }, exName(exMap, it.exerciseId)),
          iconButton('arrow-up', { label: t('workout.action.moveUp'), class: 'wk-icon-sm', disabled: i === 0, onClick: () => mv(i, -1) }),
          iconButton('arrow-down', { label: t('workout.action.moveDown'), class: 'wk-icon-sm', disabled: i === routine.items.length - 1, onClick: () => mv(i, 1) }),
          iconButton('trash-2', { label: t('workout.action.remove'), class: ['wk-icon-sm', 'text-danger'], onClick: () => rm(i) })),
        el('div', { class: 'wk-target-grid' },
          el('label', { class: 'field-label' }, t('workout.target.sets'), sets),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '×'),
          el('label', { class: 'field-label' }, t('workout.target.reps'), reps),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '–'),
          el('label', { class: 'field-label' }, t('workout.target.maxReps'), max),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '@'),
          el('label', { class: 'field-label' }, 'kg', wt)));
    }));
    if (!routine.items.length) append(itemsEl, el('p', { class: 't-sub muted wk-pad-x' }, t('workout.routine.noExercisesYet')));
    paintMuscles();
  }
  const mv = (i, d) => { const a = routine.items; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); save(); };
  const rm = (i) => {
    const [removed] = routine.items.splice(i, 1);
    render(); save();
    toast(t('workout.toast.removed', { name: exName(exMap, removed.exerciseId) }), { action: { label: t('workout.action.undo'), onClick: () => { routine.items.splice(i, 0, removed); render(); save(); } } });
  };
  const add = async () => {
    const ex = await pickExercise({ exMap, workouts });
    if (!ex) return;
    const last = lastEntryFor(workouts, ex.id);
    routine.items.push({ exerciseId: ex.id, ...normaliseTarget(last ? last.entry : DEFAULT_TARGET) });
    render(); save();
  };
  const del = async () => {
    const ok = await confirmAction({ title: t('workout.routine.deleteTitle'), message: t('workout.routine.deleteMessage', { name: routineName(routine) }), confirmLabel: t('workout.action.delete'), danger: true });
    if (!ok) return;
    gone = true;
    await saver.flush();
    await db.remove('routines', routine.id);
    navigate(backTo, { replace: true });
  };
  render();

  append(container, header,
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, t('workout.form.name')), name),
    musCard,
    el('div', { class: 'section' }, sectionHeader(t('workout.route.exercises')), itemsEl),
    el('button', { type: 'button', class: 'btn btn-block', onClick: add }, icon('plus'), t('workout.picker.title')),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: navAction(async () => { await saver.flush(); return startWorkout(routine); }) }, t('workout.routine.start')),
    el('a', { class: 'btn btn-block', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`) }, icon('chart-line'), t('workout.routine.seeProgress')),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: del }, t('workout.routine.delete')));

  if (ctx.query.new) {
    name.focus(); name.select();
    // Use the flag once: a reload must not focus the name (and open the keyboard) again.
    // ?back= stays, so Back still returns to where the editor was opened from after a reload.
    const keep = backTo !== 'workout/routines' ? `?back=${encodeURIComponent(backTo)}` : '';
    history.replaceState(history.state, '', `#/workout/routines/${encodeURIComponent(routine.id)}${keep}`);
  }
  return () => { saver.save(); };
}
