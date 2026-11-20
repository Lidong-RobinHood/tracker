// Routines: list (reorder, start, create) and editor (autosaved). Routes: workout/routines, workout/routines/:id
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, numberInput, toast, navigate, href, emptyState, icon, iconButton, sectionHeader } from '../ui/index.js';
import { normaliseTarget, formatTarget, DEFAULT_TARGET, lastEntryFor, MAX_TARGET_WEIGHT } from '../core/workout.js';
import {
  ensureCss, loadExercises, loadRoutines, loadWorkouts, startWorkout, newRoutine, nextRoutineOrder, createSaver, exName,
  navAction, swallowTaps, confirmAction,
} from './data.js';
import { pickExercise } from './picker.js';

/** "+ New" / "Create routine": a double tap creates one routine and never lands on the editor. */
const createRoutine = () => navAction(async () => {
  const r = newRoutine('New routine', [], await nextRoutineOrder());
  await db.put('routines', r);
  swallowTaps();
  navigate(`workout/routines/${encodeURIComponent(r.id)}?new=1`);
  return true;
});

export async function mountRoutines(container) {
  ensureCss();
  const [routines, exMap] = await Promise.all([loadRoutines(), loadExercises()]);
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
        el('div', { class: 'li-title' }, r.name),
        el('div', { class: 'li-sub' }, r.items.length
          ? r.items.map((it) => `${exName(exMap, it.exerciseId)} ${formatTarget(it).replace(/ /g, '\u00a0')}`).join(' · ')
          : 'No exercises')),
      iconButton('arrow-up', { label: `Move ${r.name} up`, class: 'wk-icon-sm', disabled: i === 0, onClick: () => swap(i, -1) }),
      iconButton('arrow-down', { label: `Move ${r.name} down`, class: 'wk-icon-sm', disabled: i === routines.length - 1, onClick: () => swap(i, 1) }),
      el('button', { type: 'button', class: 'btn btn-sm', onClick: navAction(() => startWorkout(r)) }, 'Start'))));
  }
  render();

  append(container, 
    pageHeader({
      title: 'Routines', back: 'workout',
      actions: [el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'New routine', onClick: createRoutine() }, icon('plus'))],
    }),
    routines.length
      ? el('div', { class: 'card card-flush' }, list)
      : emptyState('No routines yet.',
        el('button', { type: 'button', class: 'btn btn-primary', onClick: createRoutine() }, 'Create routine')));
}

export async function mountRoutineEdit(container, { id }, ctx) {
  ensureCss();
  const [routine, exMap, workouts] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts()]);
  if (!routine) {
    append(container, pageHeader({ title: 'Routine', back: 'workout/routines' }), emptyState('Routine not found.'));
    return undefined;
  }
  let gone = false;
  const saver = createSaver('routines', () => (gone ? null : routine),
    (err) => toast(`Could not save: ${err && err.message}`, { type: 'error' }));
  const save = () => saver.save();

  const header = pageHeader({
    title: routine.name, subtitle: 'Saved automatically', back: 'workout/routines',
    actions: [el('a', { class: 'btn btn-icon btn-ghost', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`), 'aria-label': 'Routine progress' }, icon('chart-line'))],
  });
  const titleEl = header.querySelector('.page-title');
  const name = el('input', {
    class: 'input', type: 'text', value: routine.name, maxlength: '60', 'aria-label': 'Routine name',
    onInput: () => {
      const n = name.value.trim();
      if (!n) return;
      routine.name = n; titleEl.textContent = n; save();
    },
  });
  const itemsEl = el('div', { class: 'stack' });

  function render() {
    replaceChildren(itemsEl, ...routine.items.map((it, i) => {
      const upd = () => {
        const t = normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber(), targetWeight: wt.getNumber() });
        Object.assign(it, t);
        save();
      };
      const sets = numberInput({ value: it.targetSets, min: 1, max: 20, integer: true, ariaLabel: 'Target sets', onInput: upd });
      const reps = numberInput({ value: it.targetReps, min: 1, max: 100, integer: true, ariaLabel: 'Target reps', onInput: upd });
      const max = numberInput({ value: it.targetRepsMax, min: 1, max: 100, integer: true, placeholder: '–', ariaLabel: 'Max reps (optional)', onInput: upd });
      const wt = numberInput({ value: it.targetWeight ?? null, min: 0, max: MAX_TARGET_WEIGHT, decimals: 2, placeholder: '–', ariaLabel: 'Target weight in kg (optional)', onInput: upd });
      // Show the normalised values when leaving a field (e.g. max ≤ reps is dropped).
      for (const f of [sets, reps, max, wt]) {
        f.addEventListener('change', () => {
          sets.setNumber(it.targetSets); reps.setNumber(it.targetReps); max.setNumber(it.targetRepsMax); wt.setNumber(it.targetWeight ?? null);
        });
      }
      return el('div', { class: 'card wk-ritem' },
        el('div', { class: 'row-between' },
          el('div', { class: 't-head grow wk-min0' }, exName(exMap, it.exerciseId)),
          iconButton('arrow-up', { label: 'Move up', class: 'wk-icon-sm', disabled: i === 0, onClick: () => mv(i, -1) }),
          iconButton('arrow-down', { label: 'Move down', class: 'wk-icon-sm', disabled: i === routine.items.length - 1, onClick: () => mv(i, 1) }),
          iconButton('trash-2', { label: 'Remove', class: ['wk-icon-sm', 'text-danger'], onClick: () => rm(i) })),
        el('div', { class: 'wk-target-grid' },
          el('label', { class: 'field-label' }, 'Sets', sets),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '×'),
          el('label', { class: 'field-label' }, 'Reps', reps),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '–'),
          el('label', { class: 'field-label' }, 'Max reps', max),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '@'),
          el('label', { class: 'field-label' }, 'kg', wt)));
    }));
    if (!routine.items.length) append(itemsEl, el('p', { class: 't-sub muted wk-pad-x' }, 'No exercises yet.'));
  }
  const mv = (i, d) => { const a = routine.items; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); save(); };
  const rm = (i) => {
    const [removed] = routine.items.splice(i, 1);
    render(); save();
    toast(`Removed ${exName(exMap, removed.exerciseId)}`, { action: { label: 'Undo', onClick: () => { routine.items.splice(i, 0, removed); render(); save(); } } });
  };
  const add = async () => {
    const ex = await pickExercise({ exMap, workouts });
    if (!ex) return;
    const last = lastEntryFor(workouts, ex.id);
    routine.items.push({ exerciseId: ex.id, ...normaliseTarget(last ? last.entry : DEFAULT_TARGET) });
    render(); save();
  };
  const del = async () => {
    const ok = await confirmAction({ title: 'Delete routine?', message: `“${routine.name}” will be deleted. Past workouts are kept.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    gone = true;
    await saver.flush();
    await db.remove('routines', routine.id);
    navigate('workout/routines', { replace: true });
  };
  render();

  append(container, header,
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), name),
    el('div', { class: 'section' }, sectionHeader('Exercises'), itemsEl),
    el('button', { type: 'button', class: 'btn btn-block', onClick: add }, icon('plus'), 'Add exercise'),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: navAction(async () => { await saver.flush(); return startWorkout(routine); }) }, 'Start this routine'),
    el('a', { class: 'btn btn-block', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`) }, icon('chart-line'), 'See progress'),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: del }, 'Delete routine'));

  if (ctx.query.new) {
    name.focus(); name.select();
    // Use the flag once: a reload must not focus the name (and open the keyboard) again.
    history.replaceState(history.state, '', `#/workout/routines/${encodeURIComponent(routine.id)}`);
  }
  return () => { saver.save(); };
}
