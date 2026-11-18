// Exercise library: list (search, muscle filter, archived), detail/edit with history, new.
// Routes: workout/exercises, workout/exercises/new, workout/exercises/:id
import * as db from '../db/db.js';
import { el, pageHeader, toast, navigate, href, emptyState, confirmDialog } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { historyFor, bestSet, formatSets, formatSet, formatTarget } from '../core/workout.js';
import { ensureCss, loadExercises, loadWorkouts, musclesLine, newExercise, shortDate, findByName } from './data.js';
import { exerciseForm, EQUIPMENT } from './exercise-form.js';
import { matches } from './picker.js';

// Filter state survives navigating into a detail and back.
const state = { query: '', muscle: null, archived: false };

export async function mountLibrary(container) {
  ensureCss();
  const exMap = await loadExercises();
  const all = [...exMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const list = el('div', { class: 'list' });
  const count = el('div', { class: 'small muted wk-pad-x' });
  const search = el('input', {
    class: 'input', type: 'search', placeholder: 'Search', value: state.query, autocomplete: 'off', 'aria-label': 'Search exercises',
    onInput: () => { state.query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => chips.replaceChildren(
    el('button', { type: 'button', class: 'chip', 'aria-pressed': state.muscle ? 'false' : 'true', onClick: () => { state.muscle = null; renderChips(); render(); } }, 'All'),
    ...MUSCLES.map((m) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': state.muscle === m.id ? 'true' : 'false',
      onClick: () => { state.muscle = state.muscle === m.id ? null : m.id; renderChips(); render(); },
    }, m.name)),
    el('button', {
      type: 'button', class: 'chip', 'aria-pressed': state.archived ? 'true' : 'false',
      onClick: () => { state.archived = !state.archived; renderChips(); render(); },
    }, 'Archived'));
  renderChips();

  function render() {
    const items = all
      .filter((e) => (state.archived ? e.archived : !e.archived))
      .filter((e) => matches(e, state.query))
      .filter((e) => !state.muscle || e.primary.includes(state.muscle) || (e.secondary || []).includes(state.muscle));
    count.textContent = `${items.length} exercise${items.length === 1 ? '' : 's'}`;
    list.replaceChildren(...items.map((e) => el('a', { class: 'list-item', href: href(`workout/exercises/${encodeURIComponent(e.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, e.name, e.isCustom ? el('span', { class: 'badge wk-badge-gap' }, 'Custom') : null),
        el('div', { class: 'li-sub' }, `${musclesLine(e)} · ${equipmentName(e.equipment)}`)),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))));
    if (!items.length) list.append(el('p', { class: 'muted small wk-pad' }, state.archived ? 'No archived exercises.' : 'No match.'));
  }
  render();

  container.append(
    pageHeader({
      title: 'Exercises', back: 'workout',
      actions: [el('a', { class: 'btn btn-sm btn-primary', href: href('workout/exercises/new') }, '+ New')],
    }),
    search, chips, count,
    el('div', { class: 'card card-flush' }, list));
}

export async function mountNewExercise(container, _params, ctx) {
  ensureCss();
  const form = exerciseForm({ name: ctx.query.name || '' });
  const create = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    const dup = findByName(await loadExercises(), r.value.name);
    if (dup) { toast(`"${dup.name}" already exists${dup.archived ? ' (archived)' : ''}`, { type: 'error' }); return; }
    const ex = newExercise(r.value);
    await db.put('exercises', ex);
    toast('Exercise created', { type: 'success' });
    navigate(`workout/exercises/${encodeURIComponent(ex.id)}`, { replace: true });
  };
  container.append(pageHeader({ title: 'New exercise', back: 'workout/exercises' }),
    el('div', { class: 'card' }, form.node),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: create }, 'Create exercise'));
}

export async function mountExerciseDetail(container, { id }) {
  ensureCss();
  const [ex, workouts] = await Promise.all([db.get('exercises', id), loadWorkouts()]);
  if (!ex) {
    container.append(pageHeader({ title: 'Exercise', back: 'workout/exercises' }), emptyState('Exercise not found.'));
    return;
  }
  const form = exerciseForm(ex);
  const save = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    const dup = findByName(await loadExercises(), r.value.name, ex.id);
    if (dup) { toast(`"${dup.name}" already exists`, { type: 'error' }); return; }
    Object.assign(ex, r.value, { updatedAt: Date.now() });
    await db.put('exercises', ex);
    title.textContent = ex.name;
    toast('Saved', { type: 'success' });
  };
  const toggleArchive = async () => {
    if (!ex.archived) {
      const ok = await confirmDialog({
        title: 'Archive exercise?',
        message: 'It is hidden from pickers and the library. History is kept; you can unarchive it any time.',
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    ex.archived = !ex.archived;
    ex.updatedAt = Date.now();
    await db.put('exercises', ex);
    toast(ex.archived ? 'Archived' : 'Unarchived');
    archiveBtn.textContent = ex.archived ? 'Unarchive' : 'Archive';
    badge.hidden = !ex.archived;
  };

  const header = pageHeader({ title: ex.name, subtitle: ex.isCustom ? 'Custom exercise' : 'Library exercise', back: 'workout/exercises' });
  const title = header.querySelector('.page-title');
  const badge = el('span', { class: 'badge badge-warning wk-badge-gap', hidden: !ex.archived }, 'Archived');
  header.querySelector('.page-subtitle').append(badge);
  const archiveBtn = el('button', { type: 'button', class: 'btn btn-block', onClick: toggleArchive }, ex.archived ? 'Unarchive' : 'Archive');

  // History
  const hist = historyFor(workouts, ex.id);
  const best = bestSet(hist);
  const histSection = el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'History'),
    hist.length
      ? [
        best ? el('div', { class: 'card wk-best' },
          el('div', { class: 'small muted' }, 'Best set (estimated 1RM)'),
          el('div', { class: 'wk-best-value num' }, `${formatSet(best.set)} kg`),
          el('div', { class: 'small muted' }, `≈ ${Math.round(best.e1rm * 10) / 10} kg 1RM · ${shortDate(best.workout.date)}`)) : null,
        el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
          hist.map(({ workout, entry }) => el('a', { class: 'list-item', href: href(`workout/history/${encodeURIComponent(workout.id)}`) },
            el('div', { class: 'li-main' },
              el('div', { class: 'li-title' }, formatSets(entry.sets)),
              el('div', { class: 'li-sub' }, `${shortDate(workout.date)} · ${workout.name} · target ${formatTarget(entry)}`)),
            el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))))),
      ]
      : el('p', { class: 'muted small wk-pad-x' }, 'No finished sessions with this exercise yet.'));

  container.append(header,
    el('div', { class: 'card' }, form.node),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save }, 'Save changes'),
    histSection,
    archiveBtn);
}

function equipmentName(id) {
  const e = EQUIPMENT.find(([v]) => v === id);
  return e ? e[1] : id;
}
