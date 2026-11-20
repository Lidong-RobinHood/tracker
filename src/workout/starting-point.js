// Starting point: current working sets (and optional best set) per exercise, stored as one special
// finished workout (core/baseline.js, SPEC §3). Route: workout/starting-point
// Rendering rule: typing never re-renders (nothing jumps); only add/remove rebuild the list.
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, numberInput, toast, navigate, fmtDate, icon, iconButton } from '../ui/index.js';
import { today } from '../core/dates.js';
import {
  findBaseline, baselineRows, validateBaseline, buildBaseline, defaultBaselineDate,
  DEFAULT_BASELINE_SETS, MAX_BASELINE_SETS, MAX_BASELINE_WEIGHT, MAX_BASELINE_REPS,
} from '../core/baseline.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, exName, confirmAction } from './data.js';
import { pickExercise } from './picker.js';

/** Unsaved, invalid edits kept while the app stays open (restored on the next visit). */
let draft = null;

export async function mountStartingPoint(container) {
  ensureCss();
  const [workouts, exMap, routines] = await Promise.all([loadWorkouts(), loadExercises(), loadRoutines()]);
  const stored = findBaseline(workouts);
  const now = today();
  const isBw = (id) => (exMap.get(id) || {}).equipment === 'bodyweight';

  const restored = draft && draft.storedId === (stored ? stored.id : null) ? draft : null;
  draft = null;
  /** @type {{exerciseId: string, weight: number|null, reps: number|null, sets: number|null, bestWeight: number|null, bestReps: number|null}[]} */
  const rows = restored ? restored.rows : stored ? baselineRows(stored) : [];
  let date = restored ? restored.date : stored ? stored.date : defaultBaselineDate(now);
  let dirty = !!restored;
  let saved = false;

  const header = pageHeader({
    title: 'Starting point',
    subtitle: stored ? `Saved · as of ${fmtDate(stored.date)}` : 'Current working sets',
    back: 'workout',
    info: 'starting',
  });

  const dateIn = el('input', {
    class: 'input', type: 'date', value: date, max: now, 'aria-label': 'As of date',
    onChange: () => { date = dateIn.value; dirty = true; dateIn.removeAttribute('aria-invalid'); },
  });

  const listEl = el('div', { class: 'card card-flush wk-sp-list' });
  const errorEl = el('p', { class: 'field-error wk-sp-error', role: 'alert', hidden: true });
  /** Input controls per row, in DOM order (for Next and error focus). */
  let ctls = [];

  const read = (input) => (input.value.trim() === '' ? null : input.getNumber() ?? NaN);

  function render() {
    ctls = [];
    if (!rows.length) {
      replaceChildren(listEl, el('p', { class: 't-sub muted wk-pad' }, 'No exercises yet.'));
      return;
    }
    replaceChildren(listEl, ...rows.map((r, i) => renderRow(r, i)));
    wireNext();
  }

  function renderRow(r, i) {
    const bw = isBw(r.exerciseId);
    const name = exName(exMap, r.exerciseId);
    const upd = (key) => (v, input) => { r[key] = read(input); dirty = true; };
    const mk = (key, o) => numberInput({ value: r[key], class: 'wk-sp-in', onInput: upd(key), ...o });
    const c = {
      weight: bw ? null : mk('weight', { min: 0, max: MAX_BASELINE_WEIGHT, decimals: 2, placeholder: 'kg', ariaLabel: `${name}: working weight in kg` }),
      reps: mk('reps', { min: 1, max: MAX_BASELINE_REPS, integer: true, placeholder: 'reps', ariaLabel: `${name}: reps` }),
      sets: mk('sets', { min: 1, max: MAX_BASELINE_SETS, integer: true, placeholder: String(DEFAULT_BASELINE_SETS), ariaLabel: `${name}: sets` }),
      bestWeight: bw ? null : mk('bestWeight', { min: 0, max: MAX_BASELINE_WEIGHT, decimals: 2, placeholder: 'kg', ariaLabel: `${name}: best set weight in kg (optional)` }),
      bestReps: mk('bestReps', { min: 1, max: MAX_BASELINE_REPS, integer: true, placeholder: 'reps', ariaLabel: `${name}: best set reps (optional)` }),
    };
    ctls[i] = c;
    const bwCell = () => el('span', { class: 'wk-sp-bw t-sub muted', 'aria-hidden': 'true' }, 'BW');
    return el('div', { class: 'wk-sp-item', role: 'group', 'aria-label': name },
      el('div', { class: 'wk-sp-name' },
        el('span', { class: 'grow truncate' }, name),
        iconButton('x', { label: `Remove ${name}`, onClick: () => remove(i) })),
      // Column headings sit right above the first exercise's fields (the rows below share the columns).
      i === 0 ? el('div', { class: 'wk-sp-row wk-sp-head t-cap', 'aria-hidden': 'true' },
        el('span', 'kg'), el('span', 'reps'), el('span', 'sets'), el('span', 'Best set')) : null,
      el('div', { class: 'wk-sp-row' },
        c.weight || bwCell(), c.reps, c.sets, c.bestWeight || bwCell(), c.bestReps));
  }

  /** Enter / keyboard "Next" moves to the next field; the last one closes the keyboard. */
  function wireNext() {
    const all = ctls.flatMap((c) => [c.weight, c.reps, c.sets, c.bestWeight, c.bestReps].filter(Boolean));
    all.forEach((input, k) => {
      const next = all[k + 1];
      input.setAttribute('enterkeyhint', next ? 'next' : 'done');
      if (next) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); next.focus(); } });
    });
  }

  function remove(i) {
    const [removed] = rows.splice(i, 1);
    dirty = true;
    render();
    toast(`Removed ${exName(exMap, removed.exerciseId)}`, {
      action: { label: 'Undo', onClick: () => { rows.splice(i, 0, removed); render(); } },
    });
  }

  const newRow = (exerciseId) => ({ exerciseId, weight: null, reps: null, sets: DEFAULT_BASELINE_SETS, bestWeight: null, bestReps: null });
  const has = (id) => rows.some((r) => r.exerciseId === id);

  /** Pick exercises one after another until the picker is dismissed. */
  async function addExercises() {
    const first = rows.length;
    for (let k = 0; k < 50; k++) {
      const added = rows.length - first;
      const ex = await pickExercise({ title: added ? `Add exercise · ${added} added` : 'Add exercise', exMap, workouts });
      if (!ex) break;
      if (has(ex.id)) { toast(`${ex.name} is already in the list`); continue; }
      rows.push(newRow(ex.id));
      dirty = true;
      render();
    }
    focusRow(first);
  }

  function addFromRoutines() {
    const first = rows.length;
    for (const r of routines) {
      for (const it of r.items || []) {
        const ex = exMap.get(it.exerciseId);
        if (!ex || ex.archived || has(ex.id)) continue;
        rows.push(newRow(ex.id));
      }
    }
    const n = rows.length - first;
    if (!n) { toast('All routine exercises are already in the list'); return; }
    dirty = true;
    render();
    toast(`Added ${n} exercise${n === 1 ? '' : 's'}`);
    focusRow(first);
  }

  function focusRow(i) {
    const c = ctls[i];
    if (!c) return;
    const input = c.weight || c.reps;
    input.scrollIntoView({ block: 'center' });
    input.focus();
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  }

  async function save({ leaving = false } = {}) {
    const v = validateBaseline({ date, rows }, { today: today(), isBodyweight: isBw });
    if (!v.ok) {
      if (leaving) return false;
      showError(v.error);
      if (v.field === 'date') { dateIn.setAttribute('aria-invalid', 'true'); dateIn.focus(); return false; }
      const c = ctls[v.row];
      const input = c && (c[v.field] || c.reps);
      if (input) { input.setAttribute('aria-invalid', 'true'); input.scrollIntoView({ block: 'center' }); input.focus(); }
      return false;
    }
    showError('');
    if (!v.value.rows.length) {
      if (leaving) return true;
      if (stored) { await del(); return true; }
      toast('Add at least one exercise with weight and reps', { type: 'error' });
      return false;
    }
    const rec = buildBaseline(v.value, { id: crypto.randomUUID(), now: Date.now(), existing: stored });
    await db.put('workouts', rec);
    dirty = false;
    saved = true;
    toast(`Starting point saved · ${v.value.rows.length} exercise${v.value.rows.length === 1 ? '' : 's'}`, { type: 'success' });
    if (!leaving) navigate('workout', { replace: true });
    return true;
  }

  async function del() {
    const ok = await confirmAction({
      title: 'Delete starting point?',
      message: 'Sessions are then pre-filled only from real workouts.',
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
    await db.remove('workouts', stored.id);
    dirty = false;
    saved = true;
    toast('Starting point deleted', {
      action: { label: 'Undo', onClick: () => db.put('workouts', stored).then(() => toast('Starting point restored', { type: 'success' })) },
    });
    navigate('workout', { replace: true });
  }

  render();
  const routineCount = new Set(routines.flatMap((r) => (r.items || []).map((i) => i.exerciseId))).size;
  append(container, ...[header,
    el('p', { class: 'field-hint wk-pad-x' }, 'Pre-fills sessions. Never counted as a workout.'),
    restored ? el('p', { class: 't-sub text-warning wk-pad-x' }, 'Unsaved changes restored.') : null,
    el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'As of'), dateIn),
    listEl,
    errorEl,
    el('div', { class: ['wk-sp-add', routineCount && 'has-2'] },
      el('button', { type: 'button', class: 'btn', onClick: addExercises }, icon('plus'), 'Add exercises'),
      routineCount ? el('button', { type: 'button', class: 'btn', onClick: addFromRoutines }, 'From routines') : null),
    // the one Save: sticky above the tab bar
    el('div', { class: 'wk-sp-save' }, el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => save() }, 'Save')),
    stored ? el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: del }, 'Delete starting point') : null,
  ].filter(Boolean));

  // Leaving with valid changes saves them; invalid ones stay as a draft for this app session.
  return () => {
    if (saved || !dirty) return;
    const snapshot = { storedId: stored ? stored.id : null, date, rows: rows.map((r) => ({ ...r })) };
    save({ leaving: true }).then((ok) => { if (!ok) draft = snapshot; }).catch((err) => { console.error(err); draft = snapshot; });
  };
}
