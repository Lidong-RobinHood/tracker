// Searchable exercise picker sheet with inline "create new".
import * as db from '../db/db.js';
import { el, append, replaceChildren, openSheet, toast, icon } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { activeExercises, musclesLine, newExercise, findByName, shortDate, navAction, swallowTaps } from './data.js';
import { exerciseUsage, recentExercises, rankExercises, RECENT_LIMIT } from '../core/exercise-usage.js';
import { exerciseForm } from './exercise-form.js';

/** Case-insensitive match of every search word against name, equipment and primary muscles. */
export function matches(ex, q) {
  if (!q) return true;
  const hay = `${ex.name} ${ex.equipment} ${(ex.primary || []).join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

/**
 * Empty search: "Recent" (exercises you logged, most recently used first) and then the whole
 * library by name. Search: best matches first; among equal matches, used exercises first.
 * @param {{title?: string, exMap: Map<string, object>, workouts?: object[]}} opts exMap is updated when a
 *   new exercise is created; workouts: for the usage (loaded once here when not given)
 * @returns {Promise<object|null>} the chosen exercise
 */
export function pickExercise({ title = 'Add exercise', exMap, workouts = null }) {
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
    type: 'search', placeholder: 'Search exercises', autocomplete: 'off', 'aria-label': 'Search exercises',
    onInput: () => { query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => replaceChildren(chips, 
    el('button', { type: 'button', class: 'chip', 'aria-pressed': muscle ? 'false' : 'true', onClick: () => { muscle = null; renderChips(); render(); } }, 'All'),
    ...MUSCLES.map((m) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': muscle === m.id ? 'true' : 'false',
      onClick: () => { muscle = muscle === m.id ? null : m.id; renderChips(); render(); },
    }, m.name)));
  renderChips();

  // Search + chips form a fixed header; only the list below them scrolls.
  const sheet = openSheet({ title, content: [el('div', { class: 'wk-pick-top' }, el('label', { class: 'search-field' }, icon('search'), search), chips), list], className: 'wk-picker' });

  const item = (e) => {
    const u = usage.get(e.id);
    return el('button', { type: 'button', class: 'list-item', onClick: () => sheet.close(e) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, e.name),
        el('div', { class: 'li-sub' }, musclesLine(e))),
      u ? el('span', { class: 'li-trail t-sub muted wk-last-used' }, `last ${shortDate(u.lastDate)}`) : null);
  };
  const head = (text) => el('div', { class: 'wk-pick-head t-cap', role: 'presentation' }, text);

  function render() {
    const pool = activeExercises(exMap)
      .filter((e) => !muscle || (e.primary || []).includes(muscle) || (e.secondary || []).includes(muscle));
    const create = el('button', { type: 'button', class: 'list-item wk-create', onClick: () => createNew() },
      icon('plus', { class: 'li-lead' }),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, query ? `Create “${query}”` : 'Create new exercise')));
    if (query) {
      const items = rankExercises(pool, query, usage);
      replaceChildren(list, create,
        ...items.slice(0, 150).map(item),
        ...(items.length ? [] : [el('p', { class: 't-sub muted wk-pad' }, 'No match. Create it above.')]));
      return;
    }
    const recent = recentExercises(pool, usage, RECENT_LIMIT);
    replaceChildren(list, create,
      recent.length ? head('Recent') : null,
      ...recent.map(item),
      recent.length ? head('All exercises') : null,
      ...pool.slice(0, 400).map(item),
      ...(pool.length ? [] : [el('p', { class: 't-sub muted wk-pad' }, 'No exercise for this muscle. Create it above.')]));
  }
  render();

  function createNew() {
    const form = exerciseForm({ name: query }, { compact: true });
    const s2 = openSheet({ title: 'New exercise', content: form.node });
    append(s2.footer, 
      el('button', { type: 'button', class: 'btn', onClick: () => s2.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: navAction(async () => {
          const r = form.read();
          if (!r.ok) { toast(r.error, { type: 'error' }); return false; }
          const dup = findByName(exMap, r.value.name);
          if (dup) { toast(`“${dup.name}” already exists${dup.archived ? ' (archived)' : ''}`, { type: 'error' }); return false; }
          const ex = newExercise(r.value);
          await db.put('exercises', ex);
          exMap.set(ex.id, ex);
          swallowTaps();
          s2.close();
          sheet.close(ex);
          return true;
        }),
      }, 'Create & add'));
    if (!query) form.focusName();
  }

  return sheet.closed.then((r) => r || null);
}
