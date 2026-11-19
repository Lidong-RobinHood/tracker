// Import workouts pasted from a spreadsheet: paste → dates → preview → exercise matching → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, openSheet, href, fmtDate } from '../ui/index.js';
import { today } from '../core/dates.js';
import { exerciseNames, buildWorkoutRecords } from '../core/import-workouts.js';
import { matchExercise, nameKey, confidenceLabel } from '../core/import-exercise-match.js';
import { formatTarget, formatWeight } from '../core/workout.js';
import { EXERCISE_MAP_KEY } from '../core/import-runs.js';
import { pickExercise } from '../workout/picker.js';
import { exerciseForm } from '../workout/exercise-form.js';
import { newExercise, findByName } from '../workout/data.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, dateInput, plural, commitRun, dateY } from './shared.js';

const EXAMPLE = `12.11.2026
Push
Benchpress
3 x 6
100\t7
100\t8
100\t8
Dropset 5x 80

Dips
3 x 10
12
10
9`;

export async function mountWorkoutImport(container) {
  ensureCss();
  const now = today();
  const exMap = new Map((await db.getAll('exercises')).map((e) => [e.id, e]));
  const saved = (await db.getSetting(EXERCISE_MAP_KEY)) || {};

  const state = {
    text: '', repsFirst: false, dateOrder: 'auto', defaultDate: now,
    parsed: null, dates: [], choice: new Map(), // name → {exerciseId, confidence, pendingNew?: object}
    busy: false, done: null,
  };

  const textarea = el('textarea', {
    class: 'textarea imp-text', rows: '10', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off',
    'aria-label': 'Workout sheet text', placeholder: 'Paste your sheet here',
  });
  const defaultDate = dateInput(state.defaultDate, now, (v) => { state.defaultDate = v; renderPreview(); });
  const readBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => read() }, 'Show preview');
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.append(
    pageHeader({ title: 'Import workouts', back: 'import' }),
    el('section', { class: 'card stack' },
      el('p', null, 'In your spreadsheet, select the cells of one column group (exercise names, targets, weights and reps) and copy them. Paste them below, or pick a .txt, .csv or .tsv file.'),
      el('ul', { class: 'small muted imp-help' },
        el('li', null, 'Exercise name on its own line, then "3 x 6" (sets x reps), then one line per set: weight in kg, then reps.'),
        el('li', null, 'Dropsets: "Dropset 5x 80" means 5 reps at 80 kg. One number alone is a bodyweight set (reps).'),
        el('li', null, 'A date line (12.11.2026, 2026-11-12, Mon 12 Nov) starts a new workout. A name line like "Push" names it.'),
        el('li', null, 'Sheets with several exercises or dates side by side: copy one column group at a time.')),
      exampleBox('Example of the expected shape', EXAMPLE),
      textarea,
      el('div', { class: 'row imp-row-wrap' },
        filePicker({ label: 'Pick a file', onText: (t) => { textarea.value = t; read(); }, onError: (e) => toast(e.message, { type: 'error' }) })),
      el('div', { class: 'field' },
        el('label', { class: 'field-label', htmlFor: 'imp-default-date' }, 'Date for workouts without a date line'),
        Object.assign(defaultDate, { id: 'imp-default-date' })),
      readBtn),
    preview);

  async function read() {
    state.text = textarea.value;
    if (!state.text.trim()) { toast('Paste your sheet first', { type: 'error' }); return; }
    state.done = null;
    readBtn.disabled = true;
    readBtn.textContent = 'Reading…';
    try {
      state.parsed = await runParser('parseWorkoutText', state.text, { today: now, repsFirst: state.repsFirst, dateOrder: state.dateOrder });
      state.dates = state.parsed.workouts.map((w) => w.date);
      matchAll();
      renderPreview();
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast(`Could not read the text: ${err.message}`, { type: 'error' });
    } finally {
      readBtn.disabled = false;
      readBtn.textContent = 'Show preview';
    }
  }

  function matchAll() {
    const lib = [...exMap.values()];
    const next = new Map();
    for (const name of exerciseNames(state.parsed)) {
      const prev = state.choice.get(name);
      if (prev && prev.userChosen && (prev.pendingNew || exMap.has(prev.exerciseId))) { next.set(name, prev); continue; }
      const m = matchExercise(name, lib, saved);
      next.set(name, { exerciseId: m.exerciseId, confidence: m.confidence, candidates: m.candidates });
    }
    state.choice = next;
  }

  const exerciseLabel = (c) => (c.pendingNew ? c.pendingNew.name : c.exerciseId && exMap.has(c.exerciseId) ? exMap.get(c.exerciseId).name : null);
  const workoutDate = (i) => state.dates[i] || state.defaultDate;

  function problems() {
    const out = [];
    if (!state.parsed || state.parsed.fatal) return ['Nothing to import.'];
    if (!state.parsed.workouts.length) out.push('No workout with readable sets was found.');
    state.parsed.workouts.forEach((w, i) => {
      const d = workoutDate(i);
      if (!d) out.push(`Workout ${i + 1}: pick a date.`);
      else if (d > now) out.push(`Workout ${i + 1}: the date ${fmtDate(d)} is in the future.`);
    });
    for (const [name, c] of state.choice) if (!exerciseLabel(c)) out.push(`Choose an exercise for "${name}".`);
    return out;
  }

  function renderPreview() {
    const p = state.parsed;
    if (!p) { preview.replaceChildren(); return; }
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    const nodes = [];
    if (p.fatal) {
      nodes.push(el('section', { class: 'card imp-fatal', role: 'alert' }, el('div', { class: 'card-title' }, 'This paste cannot be imported'), el('p', null, p.fatal)));
      nodes.push(issueList(p.issues, { title: 'Lines' }));
      preview.replaceChildren(...nodes.filter(Boolean));
      return;
    }
    const setCount = p.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
    nodes.push(el('h2', { class: 'section-title' }, 'Preview'));
    nodes.push(el('p', { class: 'muted' }, `${plural(p.workouts.length, 'workout')}, ${plural(state.choice.size, 'different exercise')}, ${plural(setCount, 'set')}. This is exactly what will be saved.`));

    const errors = p.issues.filter((i) => i.level === 'error' || i.level === 'warning');
    nodes.push(issueList(p.issues, { title: errors.length ? `${plural(errors.length, 'line')} could not be used` : 'Notes' }));

    // Options
    const swap = el('input', { type: 'checkbox', checked: state.repsFirst, onChange: () => { state.repsFirst = swap.checked; read(); } });
    const opts = [el('label', { class: 'imp-check' }, swap, el('span', null, 'Columns are reps, then weight (default: weight, then reps)'))];
    if (p.dateOrderAmbiguous || state.dateOrder !== 'auto') {
      const sel = el('select', { class: 'select', onChange: () => { state.dateOrder = sel.value; read(); } },
        el('option', { value: 'dmy', selected: p.dateOrder === 'dmy' }, 'Day/month (12/11 = 12 Nov)'),
        el('option', { value: 'mdy', selected: p.dateOrder === 'mdy' }, 'Month/day (11/12 = 12 Nov)'));
      opts.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Dates like 05/06/26 are'), sel));
    }
    nodes.push(el('section', { class: 'card stack' }, ...opts));

    // Exercise matching
    nodes.push(el('h2', { class: 'section-title' }, 'Exercises'));
    nodes.push(el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, [...state.choice.entries()].map(([name, c]) => matchRow(name, c)))));

    // Workouts
    nodes.push(el('h2', { class: 'section-title' }, 'Workouts'));
    p.workouts.forEach((w, i) => nodes.push(workoutCard(w, i)));

    const probs = problems();
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: probs.length > 0 || state.busy, onClick: () => confirm(btn) },
      `Import ${plural(p.workouts.length, 'workout')}`);
    nodes.push(el('section', { class: 'card stack imp-confirm' },
      probs.length ? el('ul', { class: 'imp-problems text-danger small' }, probs.map((x) => el('li', null, x))) : el('p', { class: 'small muted' }, 'Saved as finished workouts on these dates. You can undo the whole import from the Import page.'),
      btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  function matchRow(name, c) {
    const label = exerciseLabel(c);
    const conf = c.pendingNew ? 'New exercise (created on import)' : c.userChosen ? 'Your choice' : confidenceLabel(c.confidence);
    const warn = !label || (!c.userChosen && ['medium', 'low', 'none'].includes(c.confidence));
    return el('div', { class: 'list-item imp-match' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name),
        el('div', { class: 'li-sub' }, label ? `→ ${label}` : '→ not matched yet'),
        el('span', { class: ['badge', warn ? 'badge-warning' : null] }, conf)),
      el('div', { class: 'imp-match-actions' },
        el('button', { type: 'button', class: 'btn btn-sm', onClick: () => change(name) }, 'Change'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => createNew(name) }, 'New')));
  }

  async function change(name) {
    const ex = await pickExercise({ title: `Exercise for "${name}"`, exMap });
    if (!ex) return;
    state.choice.set(name, { exerciseId: ex.id, confidence: 'saved', userChosen: true });
    renderPreview();
  }

  function createNew(name) {
    const form = exerciseForm({ name }, { compact: true });
    const sheet = openSheet({ title: 'New exercise', content: [el('p', { class: 'small muted' }, 'Created when you confirm the import, and removed again if you undo it.'), form.node] });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => sheet.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: () => {
          const r = form.read();
          if (!r.ok) { toast(r.error, { type: 'error' }); return; }
          const dup = findByName(exMap, r.value.name);
          if (dup) { toast(`"${dup.name}" already exists. Use Change to pick it.`, { type: 'error' }); return; }
          const pendingNames = [...state.choice.values()].filter((c) => c.pendingNew).map((c) => c.pendingNew);
          const same = pendingNames.find((x) => x.name.toLowerCase() === r.value.name.toLowerCase());
          const rec = same || newExercise(r.value);
          state.choice.set(name, { exerciseId: rec.id, confidence: 'new', userChosen: true, pendingNew: rec });
          sheet.close();
          renderPreview();
        },
      }, 'Use this'));
  }

  function workoutCard(w, i) {
    const d = dateInput(workoutDate(i), now, (v) => { state.dates[i] = v; renderPreview(); });
    d.setAttribute('aria-label', `Date of workout ${i + 1}`);
    const fromLine = w.dateLine ? `date from line ${w.dateLine}` : 'no date line: default date';
    return el('section', { class: 'card stack imp-workout', dataset: { index: String(i) } },
      el('div', { class: 'row-between imp-row-wrap' },
        el('div', { class: 'li-main' },
          el('div', { class: 'card-title' }, w.name || 'Workout'),
          el('div', { class: 'small muted' }, `Workout ${i + 1} · ${fromLine}`)),
        d),
      ...w.exercises.map((e) => {
        const c = state.choice.get(e.name) || {};
        const label = exerciseLabel(c);
        const target = e.target ? formatTarget({ targetSets: e.target.sets, targetReps: e.target.reps, targetRepsMax: e.target.repsMax }) : `${e.sets.filter((s) => s.type === 'normal').length} sets, no target line`;
        return el('div', { class: 'imp-ex' },
          el('div', { class: 'imp-ex-head' },
            el('span', { class: 'imp-ex-name' }, label || e.name),
            label && label !== e.name ? el('span', { class: 'small muted' }, ` (${e.name})`) : null),
          el('div', { class: 'small muted' }, `Target ${target} · line ${e.line}`),
          el('ol', { class: 'imp-sets' }, e.sets.map((s) => el('li', { class: ['imp-set', s.type === 'dropset' ? 'is-drop' : null] },
            s.type === 'dropset' ? el('span', { class: 'badge badge-dropset' }, 'Drop') : null,
            el('span', { class: 'num' }, s.weight === null ? `BW × ${s.reps}` : `${formatWeight(s.weight)} kg × ${s.reps}`),
            el('span', { class: 'small muted imp-ln' }, `line ${s.line}`)))));
      }));
  }

  async function confirm(btn) {
    if (problems().length || state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const runId = crypto.randomUUID();
      const nowMs = Date.now();
      const exerciseIds = {};
      const newExercises = [];
      for (const [name, c] of state.choice) {
        exerciseIds[name] = c.exerciseId;
        if (c.pendingNew && !newExercises.includes(c.pendingNew)) newExercises.push(c.pendingNew);
      }
      const p = state.parsed;
      const records = buildWorkoutRecords(p.workouts, {
        dates: p.workouts.map((_, i) => workoutDate(i)), exerciseIds, importId: runId, now: nowMs, newId: () => crypto.randomUUID(),
      });
      const exRecords = newExercises.map((x) => ({ ...x, importId: runId }));
      const sets = records.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
      const datesList = records.map((r) => r.date).sort();
      await commitRun({
        id: runId, type: 'workouts',
        summary: `${plural(records.length, 'workout')}, ${plural(sets, 'set')}${exRecords.length ? `, ${plural(exRecords.length, 'new exercise')}` : ''} (${dateY(datesList[0])} – ${dateY(datesList[datesList.length - 1])})`,
        counts: { workouts: records.length, sets, exercises: exRecords.length },
        writes: [{ store: 'exercises', records: exRecords }, { store: 'workouts', records }],
      });
      for (const x of exRecords) exMap.set(x.id, x);
      // Remember the mappings for the next import.
      const map = { ...((await db.getSetting(EXERCISE_MAP_KEY)) || {}) };
      for (const [name, id] of Object.entries(exerciseIds)) map[nameKey(name)] = id;
      await db.setSetting(EXERCISE_MAP_KEY, map);
      Object.assign(saved, map);
      state.done = { count: records.length, sets, runId };
      toast(`Imported ${plural(records.length, 'workout')}`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Import failed: ${err.message}. Anything written can be removed with Undo on the Import page.`, { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      renderPreview();
    }
  }

  function doneCard() {
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'card-title' }, 'Import finished'),
      el('p', null, `${plural(state.done.count, 'workout')} with ${plural(state.done.sets, 'set')} saved as finished workouts.`),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href('workout/history') }, 'Open history'),
        el('a', { class: 'btn', href: href('import') }, 'Import page (undo)')),
      el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { state.parsed = null; state.done = null; textarea.value = ''; renderPreview(); textarea.focus(); } }, 'Import another paste'));
  }
}
