// Routines: list (reorder, start, create) and editor (autosaved). Routes: workout/routines, workout/routines/:id
import * as db from '../db/db.js';
import { el, pageHeader, numberInput, toast, navigate, href, emptyState, confirmDialog } from '../ui/index.js';
import { normaliseTarget, formatTarget, DEFAULT_TARGET, lastEntryFor } from '../core/workout.js';
import {
  ensureCss, loadExercises, loadRoutines, loadWorkouts, startWorkout, newRoutine, nextRoutineOrder, createSaver, exName,
} from './data.js';
import { pickExercise } from './picker.js';

async function createRoutine() {
  const r = newRoutine('New routine', [], await nextRoutineOrder());
  await db.put('routines', r);
  navigate(`workout/routines/${encodeURIComponent(r.id)}?new=1`);
}

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
    list.replaceChildren(...routines.map((r, i) => el('div', { class: 'list-item wk-routine-row' },
      el('a', { class: 'li-main wk-routine-link', href: href(`workout/routines/${encodeURIComponent(r.id)}`) },
        el('div', { class: 'li-title' }, r.name),
        el('div', { class: 'li-sub' }, r.items.length
          ? r.items.map((it) => `${exName(exMap, it.exerciseId)} ${formatTarget(it).replace(/ /g, '\u00a0')}`).join(' · ')
          : 'No exercises')),
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost wk-icon-sm', 'aria-label': `Move ${r.name} up`, disabled: i === 0, onClick: () => swap(i, -1) }, '↑'),
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost wk-icon-sm', 'aria-label': `Move ${r.name} down`, disabled: i === routines.length - 1, onClick: () => swap(i, 1) }, '↓'),
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => startWorkout(r) }, 'Start'))));
  }
  render();

  container.append(
    pageHeader({
      title: 'Routines', back: 'workout',
      actions: [el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: createRoutine }, '+ New')],
    }),
    routines.length
      ? el('div', { class: 'card card-flush' }, list)
      : emptyState('No routines yet. A routine is a list of exercises with targets, e.g. Bench Press 3 x 6.',
        el('button', { type: 'button', class: 'btn btn-primary', onClick: createRoutine }, 'Create routine')));
}

export async function mountRoutineEdit(container, { id }, ctx) {
  ensureCss();
  const [routine, exMap, workouts] = await Promise.all([db.get('routines', id), loadExercises(), loadWorkouts()]);
  if (!routine) {
    container.append(pageHeader({ title: 'Routine', back: 'workout/routines' }), emptyState('Routine not found.'));
    return undefined;
  }
  let gone = false;
  const saver = createSaver('routines', () => (gone ? null : routine),
    (err) => toast(`Could not save: ${err && err.message}`, { type: 'error' }));
  const save = () => saver.save();

  const header = pageHeader({
    title: routine.name, subtitle: 'Saved automatically', back: 'workout/routines',
    actions: [el('a', { class: 'btn btn-sm', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`) }, 'Progress')],
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
    itemsEl.replaceChildren(...routine.items.map((it, i) => {
      const upd = () => {
        const t = normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber() });
        Object.assign(it, t);
        save();
      };
      const sets = numberInput({ value: it.targetSets, min: 1, max: 20, integer: true, ariaLabel: 'Target sets', onInput: upd });
      const reps = numberInput({ value: it.targetReps, min: 1, max: 100, integer: true, ariaLabel: 'Target reps', onInput: upd });
      const max = numberInput({ value: it.targetRepsMax, min: 1, max: 100, integer: true, placeholder: '–', ariaLabel: 'Max reps (optional)', onInput: upd });
      // Show the normalised values when leaving a field (e.g. max ≤ reps is dropped).
      for (const f of [sets, reps, max]) f.addEventListener('change', () => { sets.setNumber(it.targetSets); reps.setNumber(it.targetReps); max.setNumber(it.targetRepsMax); });
      return el('div', { class: 'card wk-ritem' },
        el('div', { class: 'row-between' },
          el('div', { class: 'li-title grow' }, exName(exMap, it.exerciseId)),
          el('button', { type: 'button', class: 'btn btn-icon btn-ghost wk-icon-sm', 'aria-label': 'Move up', disabled: i === 0, onClick: () => mv(i, -1) }, '↑'),
          el('button', { type: 'button', class: 'btn btn-icon btn-ghost wk-icon-sm', 'aria-label': 'Move down', disabled: i === routine.items.length - 1, onClick: () => mv(i, 1) }, '↓'),
          el('button', { type: 'button', class: 'btn btn-icon btn-ghost wk-icon-sm text-danger', 'aria-label': 'Remove', onClick: () => rm(i) }, '×')),
        el('div', { class: 'wk-target-grid' },
          el('label', { class: 'field-label' }, 'Sets', sets),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, 'x'),
          el('label', { class: 'field-label' }, 'Reps', reps),
          el('span', { class: 'wk-x', 'aria-hidden': 'true' }, '–'),
          el('label', { class: 'field-label' }, 'Max reps', max)));
    }));
    if (!routine.items.length) itemsEl.append(el('p', { class: 'muted small wk-pad-x' }, 'No exercises yet.'));
  }
  const mv = (i, d) => { const a = routine.items; [a[i], a[i + d]] = [a[i + d], a[i]]; render(); save(); };
  const rm = (i) => {
    const [removed] = routine.items.splice(i, 1);
    render(); save();
    toast(`Removed ${exName(exMap, removed.exerciseId)}`, { action: { label: 'Undo', onClick: () => { routine.items.splice(i, 0, removed); render(); save(); } } });
  };
  const add = async () => {
    const ex = await pickExercise({ exMap });
    if (!ex) return;
    const last = lastEntryFor(workouts, ex.id);
    routine.items.push({ exerciseId: ex.id, ...normaliseTarget(last ? last.entry : DEFAULT_TARGET) });
    render(); save();
  };
  const del = async () => {
    const ok = await confirmDialog({ title: 'Delete routine?', message: `"${routine.name}" will be deleted. Past workouts are kept.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    gone = true;
    await saver.flush();
    await db.remove('routines', routine.id);
    navigate('workout/routines', { replace: true });
  };
  render();

  container.append(header,
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), name),
    el('div', { class: 'section' }, el('h2', { class: 'section-title' }, 'Exercises'), itemsEl),
    el('button', { type: 'button', class: 'btn btn-block', onClick: add }, '+ Add exercise'),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: async () => { await saver.flush(); startWorkout(routine); } }, 'Start this routine'),
    el('a', { class: 'btn btn-block', href: href(`workout/routines/${encodeURIComponent(routine.id)}/progress`) }, 'See progress'),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: del }, 'Delete routine'));

  if (ctx.query.new) { name.focus(); name.select(); }
  return () => { saver.save(); };
}
