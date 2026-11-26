// Import workouts pasted from a spreadsheet: paste → dates → preview → exercise matching → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, openSheet, href, fmtDate, sectionHeader, tag, icon, setBadge } from '../ui/index.js';
import { t } from '../i18n/index.js';
import { exerciseName } from '../i18n/names.js';
import { today } from '../core/dates.js';
import { exerciseNames, buildWorkoutRecords } from '../core/import-workouts.js';
import { matchExercise, nameKey, confidenceKey } from '../core/import-exercise-match.js';
import { EXERCISE_MAP_KEY } from '../core/import-runs.js';
import { pickExercise } from '../workout/picker.js';
import { exerciseForm } from '../workout/exercise-form.js';
import { newExercise, findByName, fmtTarget, fmtWeight, DEFAULT_WORKOUT_NAME } from '../workout/data.js';
import { dateBox } from '../food/widgets.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, dateInput, commitRun, dateY, msgText, countOf } from './shared.js';

// i18n-ignore-start (sample sheet content)
const EXAMPLE = `12.11.2026
Push
Benchpress
3 × 6
100\t7
100\t8
100\t8
Dropset 5 × 80

Dips
3 × 10
12
10
9`;
// i18n-ignore-end

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
    'aria-label': t('import.workouts.textLabel'), placeholder: t('import.workouts.placeholder'),
  });
  const defaultDate = dateInput(state.defaultDate, now, (v) => { state.defaultDate = v; renderPreview(); });
  const readBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => read() }, t('import.showPreview'));
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.classList.add('imp-view');
  container.append(
    pageHeader({ title: t('import.workouts.title'), back: 'import', info: 'import-workouts' }),
    el('section', { class: 'section' }, sectionHeader(t('import.step1Paste')),
      el('div', { class: 'card stack' },
        el('p', { class: 't-sub' }, t('import.workouts.lead')),
        exampleBox(t('import.exampleTitle'), EXAMPLE, t('import.workouts.exampleNote')),
        textarea,
        el('div', { class: 'field' },
          el('label', { class: 'field-label', htmlFor: 'imp-default-date' }, t('import.workouts.defaultDate')),
          dateBox(Object.assign(defaultDate, { id: 'imp-default-date' }))),
        el('div', { class: 'imp-actions' },
          filePicker({ label: t('import.pickFile'), onText: (text) => { textarea.value = text; read(); }, onError: (e) => toast(e.message, { type: 'error' }) }),
          readBtn))),
    preview);

  async function read() {
    state.text = textarea.value;
    if (!state.text.trim()) { toast(t('import.workouts.pasteFirst'), { type: 'error' }); return; }
    state.done = null;
    readBtn.disabled = true;
    readBtn.textContent = t('import.reading');
    try {
      state.parsed = await runParser('parseWorkoutText', state.text, { today: now, repsFirst: state.repsFirst, dateOrder: state.dateOrder });
      state.dates = state.parsed.workouts.map((w) => w.date);
      matchAll();
      renderPreview();
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast(t('import.readFailed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      readBtn.disabled = false;
      readBtn.textContent = t('import.showPreview');
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

  const exerciseLabel = (c) => (c.pendingNew ? c.pendingNew.name : c.exerciseId && exMap.has(c.exerciseId) ? exerciseName(exMap.get(c.exerciseId)) : null);
  const workoutDate = (i) => state.dates[i] || state.defaultDate;

  function problems() {
    const out = [];
    if (!state.parsed || state.parsed.fatal) return [t('import.workouts.nothing')];
    if (!state.parsed.workouts.length) out.push(t('import.workouts.noWorkout'));
    state.parsed.workouts.forEach((w, i) => {
      const d = workoutDate(i);
      if (!d) out.push(t('import.workouts.pickDate', { n: i + 1 }));
      else if (d > now) out.push(t('import.workouts.futureDate', { n: i + 1, date: fmtDate(d) }));
    });
    for (const [name, c] of state.choice) if (!exerciseLabel(c)) out.push(t('import.workouts.chooseExercise', { name }));
    return out;
  }

  function renderPreview() {
    const p = state.parsed;
    if (!p) { preview.replaceChildren(); return; }
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    const nodes = [];
    if (p.fatal) {
      nodes.push(el('section', { class: 'card imp-fatal', role: 'alert' }, el('div', { class: 'imp-card-head' }, icon('triangle-exclamation-point', { size: 18 }), el('h3', { class: 'card-title' }, t('import.workouts.cannotImport'))), el('p', { class: 't-sub' }, msgText(p.fatal))));
      nodes.push(issueList(p.issues, { title: t('import.workouts.lines') }));
      preview.replaceChildren(...nodes.filter(Boolean));
      return;
    }
    const setCount = p.workouts.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
    nodes.push(sectionHeader(t('import.step2Preview'), { trail: t('import.workouts.trail', { workouts: countOf('workouts', p.workouts.length), exercises: countOf('exercises', state.choice.size), sets: countOf('sets', setCount) }) }));

    const errors = p.issues.filter((i) => i.level === 'error' || i.level === 'warning');
    nodes.push(issueList(p.issues, { title: errors.length ? t('import.issues.unusable', { count: errors.length }) : t('import.issues.notes') }));

    // Options
    const swap = el('input', { type: 'checkbox', checked: state.repsFirst, onChange: () => { state.repsFirst = swap.checked; read(); } });
    const opts = [el('label', { class: 'imp-check' }, swap, el('span', null, t('import.workouts.repsFirst')))];
    if (p.dateOrderAmbiguous || state.dateOrder !== 'auto') {
      const sel = el('select', { class: 'select', onChange: () => { state.dateOrder = sel.value; read(); } },
        el('option', { value: 'dmy', selected: p.dateOrder === 'dmy' }, t('import.workouts.dmy')),
        el('option', { value: 'mdy', selected: p.dateOrder === 'mdy' }, t('import.workouts.mdy')));
      sel.setAttribute('aria-label', t('import.dateOrderLabel'));
      opts.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.dateOrderLabel')), sel));
    }
    nodes.push(el('section', { class: 'card stack' }, ...opts));

    // Exercise matching
    nodes.push(sectionHeader(t('import.workouts.exercises')));
    nodes.push(el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, [...state.choice.entries()].map(([name, c]) => matchRow(name, c)))));

    // Workouts
    nodes.push(sectionHeader(t('import.workouts.workouts')));
    p.workouts.forEach((w, i) => nodes.push(workoutCard(w, i)));

    const probs = problems();
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: probs.length > 0 || state.busy, onClick: () => confirm(btn) },
      t('import.workouts.importBtn', { count: p.workouts.length }));
    nodes.push(sectionHeader(t('import.step3Import')), el('section', { class: 'card stack imp-confirm' },
      probs.length ? el('ul', { class: 'imp-problems text-danger t-sub' }, probs.map((x) => el('li', null, x))) : el('p', { class: 't-sub muted' }, t('import.undoHint')),
      btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  function matchRow(name, c) {
    const label = exerciseLabel(c);
    const conf = c.pendingNew ? t('import.match.new') : c.userChosen ? t('import.match.userChosen') : t(confidenceKey(c.confidence));
    const warn = !label || (!c.userChosen && ['medium', 'low', 'none'].includes(c.confidence));
    return el('div', { class: 'list-item imp-match' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name),
        el('div', { class: 'li-sub imp-wrap' }, label ? t('import.workouts.matched', { name: label }) : t('import.workouts.notMatched')),
        tag(conf, { tone: warn ? 'warn' : 'neutral' })),
      el('div', { class: 'imp-match-actions' },
        el('button', { type: 'button', class: 'btn btn-sm', 'aria-label': t('import.workouts.changeLabel', { name }), onClick: () => change(name) }, t('import.workouts.change')),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-label': t('import.workouts.newLabel', { name }), onClick: () => createNew(name) }, icon('plus', { size: 18 }), t('import.workouts.new'))));
  }

  async function change(name) {
    const ex = await pickExercise({ title: t('import.workouts.pickTitle', { name }), exMap });
    if (!ex) return;
    state.choice.set(name, { exerciseId: ex.id, confidence: 'saved', userChosen: true });
    renderPreview();
  }

  function createNew(name) {
    const form = exerciseForm({ name }, { compact: true });
    const sheet = openSheet({ title: t('import.workouts.newTitle'), content: [el('p', { class: 't-sub muted' }, t('import.workouts.newHint')), form.node] });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => sheet.close() }, t('common.cancel')),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: () => {
          const r = form.read();
          if (!r.ok) { toast(r.error, { type: 'error' }); return; }
          const dup = findByName(exMap, r.value.name);
          if (dup) { toast(t('import.workouts.exists', { name: exerciseName(dup) }), { type: 'error' }); return; }
          const pendingNames = [...state.choice.values()].filter((c) => c.pendingNew).map((c) => c.pendingNew);
          const same = pendingNames.find((x) => x.name.toLowerCase() === r.value.name.toLowerCase());
          const rec = same || newExercise(r.value);
          state.choice.set(name, { exerciseId: rec.id, confidence: 'new', userChosen: true, pendingNew: rec });
          sheet.close();
          renderPreview();
        },
      }, t('import.workouts.useThis')));
  }

  function workoutCard(w, i) {
    const d = dateInput(workoutDate(i), now, (v) => { state.dates[i] = v; renderPreview(); });
    d.setAttribute('aria-label', t('import.workouts.dateLabel', { n: i + 1 }));
    const fromLine = w.dateLine && w.date ? t('import.workouts.dateFromFile', { date: dateY(w.date), line: w.dateLine }) : t('import.workouts.noDateLine');
    return el('section', { class: 'card stack imp-workout', dataset: { index: String(i) } },
      el('div', { class: 'row-between imp-row-wrap' },
        el('div', { class: 'li-main' },
          el('h3', { class: 'card-title' }, w.name || t('import.workouts.defaultName')),
          el('div', { class: 't-sub muted' }, t('import.workouts.cardSub', { n: i + 1, from: fromLine }))),
        dateBox(d)),
      ...w.exercises.map((e) => {
        const c = state.choice.get(e.name) || {};
        const label = exerciseLabel(c);
        const target = e.target ? fmtTarget({ targetSets: e.target.sets, targetReps: e.target.reps, targetRepsMax: e.target.repsMax }) : t('import.workouts.noTarget', { count: e.sets.filter((s) => s.type === 'normal').length });
        return el('div', { class: 'imp-ex' },
          el('div', { class: 'imp-ex-head' },
            el('span', { class: 'imp-ex-name' }, label || e.name),
            label && label !== e.name ? el('span', { class: 't-sub muted' }, ` (${e.name})`) : null),
          el('div', { class: 't-sub muted' }, t('import.workouts.targetLine', { target, line: e.line })),
          el('ol', { class: 'imp-sets' }, e.sets.map((s) => el('li', { class: ['imp-set', s.type === 'dropset' ? 'is-drop' : null] },
            s.type === 'dropset' ? setBadge(t('import.workouts.dropsetLetter'), { title: t('import.workouts.dropset') }) : null,
            el('span', null, s.weight === null ? t('import.workouts.bwSet', { reps: s.reps }) : t('import.workouts.set', { weight: fmtWeight(s.weight), reps: s.reps })),
            el('span', { class: 't-sub muted imp-ln' }, t('import.workouts.setLine', { line: s.line }))))));
      }));
  }

  async function confirm(btn) {
    if (problems().length || state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = t('import.saving');
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
        defaultName: DEFAULT_WORKOUT_NAME, // stored sentinel, shown translated (workoutTitle)
      });
      const exRecords = newExercises.map((x) => ({ ...x, importId: runId }));
      const sets = records.reduce((n, w) => n + w.exercises.reduce((m, e) => m + e.sets.length, 0), 0);
      const datesList = records.map((r) => r.date).sort();
      const info = { workouts: records.length, sets, newExercises: exRecords.length, from: datesList[0] || null, to: datesList[datesList.length - 1] || null };
      await commitRun({
        id: runId, type: 'workouts', info,
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
      toast(t('import.workouts.importedToast', { count: records.length }), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('import.workouts.failed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      renderPreview();
    }
  }

  function doneCard() {
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'imp-card-head imp-ok' }, icon('circle-check', { size: 18 }), el('h3', { class: 'card-title' }, t('import.finished'))),
      el('p', { class: 't-sub' }, t('import.workouts.doneText', { workouts: countOf('workouts', state.done.count), sets: countOf('sets', state.done.sets) })),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href('workout/history') }, t('import.workouts.openHistory')),
        el('a', { class: 'btn', href: href('import') }, t('import.undoPage'))),
      el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { state.parsed = null; state.done = null; textarea.value = ''; renderPreview(); textarea.focus(); } }, t('import.workouts.another')));
  }
}
