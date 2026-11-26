// Searchable exercise picker sheet with inline "create new".
import * as db from '../db/db.js';
import { el, append, replaceChildren, openSheet, toast, icon } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { activeExercises, newExercise, findByName, shortDate, navAction, swallowTaps, exLabel, searchAlt } from './data.js';
import { exerciseUsage, recentExercises, rankExercises, matchScore, RECENT_LIMIT } from '../core/exercise-usage.js';
import { t, compareText } from '../i18n/index.js';
import { exerciseForm } from './exercise-form.js';
import { rowMuscleIcon, musclesText, muscleChip } from './muscle-map.js';

/**
 * Case-insensitive match of every search word against the stored and the displayed name, equipment
 * and muscles (English ids and the app language's words).
 */
export function matches(ex, q) {
  if (!q) return true;
  return matchScore(ex, q, searchAlt(ex)) > 0;
}

/**
 * Empty search: "Recent" (exercises you logged, most recently used first) and then the whole
 * library by name. Search: best matches first; among equal matches, used exercises first.
 * @param {{title?: string, exMap: Map<string, object>, workouts?: object[]}} opts exMap is updated when a
 *   new exercise is created; workouts: for the usage (loaded once here when not given)
 * @returns {Promise<object|null>} the chosen exercise
 */
export function pickExercise({ title = t('workout.picker.title'), exMap, workouts = null }) {
  let query = '';
  /** Usage per exercise id, computed once per picker (one pass over the workouts). */
  let usage = workouts ? exerciseUsage(workouts) : new Map();
  if (!workouts) {
    db.getAll('workouts').then((ws) => { usage = exerciseUsage(ws); render(); })
      .catch((err) => console.error(err));
  }
  let muscle = null;
  const list = el('div', { class: 'list' });
  const search = el('input', {
    type: 'search', placeholder: t('workout.picker.search'), autocomplete: 'off', 'aria-label': t('workout.picker.search'),
    onInput: () => { query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => replaceChildren(chips, 
    el('button', { type: 'button', class: 'chip', 'aria-pressed': muscle ? 'false' : 'true', onClick: () => { muscle = null; renderChips(); render(); } }, t('workout.filter.all')),
    ...MUSCLES.map((m) => muscleChip(m, muscle === m.id, () => { muscle = muscle === m.id ? null : m.id; renderChips(); render(); })));
  renderChips();

  // Search + chips form a fixed header; only the list below them scrolls.
  const sheet = openSheet({ title, content: [el('div', { class: 'wk-pick-top' }, el('label', { class: 'search-field' }, icon('search'), search), chips), list], className: 'wk-picker' });

  const item = (e) => {
    const u = usage.get(e.id);
    return el('button', { type: 'button', class: 'list-item wk-ex-row', onClick: () => sheet.close(e) },
      rowMuscleIcon((e.primary || [])[0]),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, exLabel(e)),
        el('div', { class: 'li-sub' }, musclesText(e))),
      u ? el('span', { class: 'li-trail t-sub muted wk-last-used' }, t('workout.picker.lastUsed', { date: shortDate(u.lastDate) })) : null);
  };
  const head = (text) => el('div', { class: 'wk-pick-head t-cap', role: 'presentation' }, text);

  function render() {
    const pool = activeExercises(exMap)
      .filter((e) => !muscle || (e.primary || []).includes(muscle) || (e.secondary || []).includes(muscle));
    const create = el('button', { type: 'button', class: 'list-item wk-create', onClick: () => createNew() },
      icon('plus', { class: 'li-lead' }),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, query ? t('workout.picker.createNamed', { name: query }) : t('workout.picker.createNew'))));
    if (query) {
      const items = rankExercises(pool, query, usage, searchAlt, compareText);
      replaceChildren(list, create,
        ...items.slice(0, 150).map(item),
        ...(items.length ? [] : [el('p', { class: 't-sub muted wk-pad' }, t('workout.picker.noMatch'))]));
      return;
    }
    const recent = recentExercises(pool, usage, RECENT_LIMIT, searchAlt, compareText);
    replaceChildren(list, create,
      recent.length ? head(t('workout.picker.recent')) : null,
      ...recent.map(item),
      recent.length ? head(t('workout.picker.all')) : null,
      ...pool.slice(0, 400).map(item),
      ...(pool.length ? [] : [el('p', { class: 't-sub muted wk-pad' }, t('workout.picker.noMuscle'))]));
  }
  render();

  function createNew() {
    const form = exerciseForm({ name: query }, { compact: true, preview: true });
    const s2 = openSheet({ title: t('workout.exercise.new'), content: form.node });
    append(s2.footer, 
      el('button', { type: 'button', class: 'btn', onClick: () => s2.close() }, t('workout.action.cancel')),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: navAction(async () => {
          const r = form.read();
          if (!r.ok) { toast(r.error, { type: 'error' }); return false; }
          const dup = findByName(exMap, r.value.name);
          if (dup) { toast(t(dup.archived ? 'workout.exercise.existsArchived' : 'workout.exercise.exists', { name: exLabel(dup) }), { type: 'error' }); return false; }
          const ex = newExercise(r.value);
          await db.put('exercises', ex);
          exMap.set(ex.id, ex);
          swallowTaps();
          s2.close();
          sheet.close(ex);
          return true;
        }),
      }, t('workout.picker.createAdd')));
    if (!query) form.focusName();
  }

  return sheet.closed.then((r) => r || null);
}
