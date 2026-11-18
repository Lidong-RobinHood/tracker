// Searchable exercise picker sheet with inline "create new".
import * as db from '../db/db.js';
import { el, openSheet, toast } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { activeExercises, musclesLine, newExercise, findByName } from './data.js';
import { exerciseForm } from './exercise-form.js';

/** Case-insensitive match of every search word against name, equipment and primary muscles. */
export function matches(ex, q) {
  if (!q) return true;
  const hay = `${ex.name} ${ex.equipment} ${(ex.primary || []).join(' ')}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
}

/**
 * @param {{title?: string, exMap: Map<string, object>}} opts exMap is updated when a new exercise is created
 * @returns {Promise<object|null>} the chosen exercise
 */
export function pickExercise({ title = 'Add exercise', exMap }) {
  let query = '';
  let muscle = null;
  const list = el('div', { class: 'list' });
  const search = el('input', {
    class: 'input', type: 'search', placeholder: 'Search exercises', autocomplete: 'off', 'aria-label': 'Search exercises',
    onInput: () => { query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => chips.replaceChildren(
    el('button', { type: 'button', class: 'chip', 'aria-pressed': muscle ? 'false' : 'true', onClick: () => { muscle = null; renderChips(); render(); } }, 'All'),
    ...MUSCLES.map((m) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': muscle === m.id ? 'true' : 'false',
      onClick: () => { muscle = muscle === m.id ? null : m.id; renderChips(); render(); },
    }, m.name)));
  renderChips();

  const sheet = openSheet({ title, content: [search, chips, list], className: 'wk-picker' });

  function render() {
    const items = activeExercises(exMap)
      .filter((e) => matches(e, query))
      .filter((e) => !muscle || (e.primary || []).includes(muscle) || (e.secondary || []).includes(muscle));
    list.replaceChildren(
      el('button', { type: 'button', class: 'list-item wk-create', onClick: () => createNew() },
        el('span', { class: 'wk-plus', 'aria-hidden': 'true' }, '+'),
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, query ? `Create "${query}"` : 'Create new exercise'))),
      ...items.slice(0, 150).map((e) => el('button', { type: 'button', class: 'list-item', onClick: () => sheet.close(e) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, e.name),
          el('div', { class: 'li-sub' }, musclesLine(e))))),
      items.length ? null : el('p', { class: 'muted small wk-pad' }, 'No match. Create it above.'),
    );
  }
  render();

  function createNew() {
    const form = exerciseForm({ name: query }, { compact: true });
    const s2 = openSheet({ title: 'New exercise', content: form.node });
    s2.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => s2.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const r = form.read();
          if (!r.ok) { toast(r.error, { type: 'error' }); return; }
          const dup = findByName(exMap, r.value.name);
          if (dup) { toast(`"${dup.name}" already exists${dup.archived ? ' (archived)' : ''}`, { type: 'error' }); return; }
          const ex = newExercise(r.value);
          await db.put('exercises', ex);
          exMap.set(ex.id, ex);
          s2.close();
          sheet.close(ex);
        },
      }, 'Create & add'));
    if (!query) form.focusName();
  }

  return sheet.closed.then((r) => r || null);
}
