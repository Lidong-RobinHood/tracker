// Session screen: log sets fast, one-handed. Route: workout/session/:id
// Rendering rule: typing and ticking only touch the affected row (no re-render), so the page never
// jumps while the keyboard is open. Structural changes (add/delete/reorder) re-render one card.
import * as db from '../db/db.js';
import {
  el, pageHeader, numberInput, field, openSheet, openModal, confirmDialog, toast, navigate, emptyState,
  fmtTime, fmtDuration, fmtNum, fmtDate, href,
} from '../ui/index.js';
import {
  buildEntry, byRecent, lastEntryFor, formatSets, formatTarget, normaliseTarget, fillDownTargets,
  sessionStats, routineItemsFromWorkout, finishTime, applySchedule, targetCheck,
  LIVE_WINDOW_MS, MAX_TARGET_WEIGHT,
} from '../core/workout.js';
import { changeDateTime } from './datetime.js';
import { suggestProgression, setsForSuggestion } from '../core/progression.js';
import { workoutVolume } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import {
  ensureCss, loadExercises, loadWorkouts, createSaver, exName, shortDate, newRoutine, nextRoutineOrder,
} from './data.js';
import { pickExercise } from './picker.js';
import { tutorialMenuItem } from './tutorial.js';
import { liveComparison, compareSession } from '../core/workout-progress.js';
import { pctBadge, pctWords, basisValue, comparisonBlock } from './progress-ui.js';
import { isBaseline, workingSets, bestSetOf } from '../core/baseline.js';

export async function mountSession(container, { id }) {
  ensureCss();
  const [workout, exMap, workouts, volumeWeights] = await Promise.all([
    db.get('workouts', id), loadExercises(), loadWorkouts(), db.getSetting('volume'),
  ]);
  if (!workout) {
    container.append(pageHeader({ title: 'Workout', back: 'workout' }),
      emptyState('This workout does not exist (deleted?).', el('a', { class: 'btn', href: '#/workout' }, 'Workout home')));
    return undefined;
  }
  if (isBaseline(workout)) { navigate('workout/starting-point', { replace: true }); return undefined; }
  // History for "Last:" / prefill / progression = sessions older than this one by date and start
  // time (not by creation), so a back-dated session only sees what came before it.
  const others = workouts.filter((w) => w.id !== workout.id);
  let older = others.filter((w) => byRecent(w, workout) > 0);
  /** All workouts with this session's live state (for the exercise picker's "Recent"). */
  const allWorkouts = () => [...others, workout];
  const finished = () => !!workout.finishedAt;

  let gone = false; // discarded/deleted: stop saving
  const saver = createSaver('workouts', () => (gone ? null : workout),
    (err) => { console.error(err); toast(`Could not save: ${err && err.message}`, { type: 'error' }); });
  const save = () => saver.save();
  /** Set objects the user edited on this screen (pre-filled rows are "untouched"). */
  const touched = new WeakSet();

  // ------------------------------------------------------------ header
  const subtitle = el('span');
  const updateSubtitle = () => {
    const now = Date.now();
    if (finished()) subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · ${fmtDuration(workout.finishedAt - workout.startedAt)}`;
    else if (workout.plannedDurationMs || now - workout.startedAt > LIVE_WINDOW_MS || now < workout.startedAt) {
      subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · past workout`;
    } else subtitle.textContent = `Started ${fmtTime(workout.startedAt)} · ${fmtDuration(now - workout.startedAt)}`;
  };
  updateSubtitle();
  const timer = setInterval(updateSubtitle, 30000);

  const header = pageHeader({
    title: workout.name,
    subtitle: ' ',
    back: 'workout',
    actions: [
      finished() ? null : el('button', { type: 'button', class: 'btn btn-primary btn-sm', onClick: () => finish() }, 'Finish'),
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'Workout menu', onClick: () => workoutMenu() }, '⋯'),
    ].filter(Boolean),
  });
  header.querySelector('.page-subtitle').replaceChildren(subtitle);
  const titleEl = header.querySelector('.page-title');

  // ------------------------------------------------------------ cards
  const cardsEl = el('div', { class: 'wk-cards' });
  /** @type {Map<object, HTMLElement>} entry -> card */
  const cards = new Map();

  function renderAll() {
    cards.clear();
    cardsEl.replaceChildren(...workout.exercises.map((entry) => {
      const c = renderCard(entry);
      cards.set(entry, c);
      return c;
    }));
    if (!workout.exercises.length) {
      cardsEl.append(el('div', { class: 'card wk-empty-card' }, el('p', { class: 'muted' }, 'No exercises yet. Add one below.')));
    }
  }
  function rerenderCard(entry) {
    const old = cards.get(entry);
    const c = renderCard(entry);
    cards.set(entry, c);
    if (old) old.replaceWith(c);
    return c;
  }

  function renderCard(entry) {
    const ex = exMap.get(entry.exerciseId);
    const last = lastEntryFor(older, entry.exerciseId);
    const suggestion = finished() ? null : suggestProgression(older, ex || { id: entry.exerciseId }, { target: entry });

    const rowsEl = el('div', { class: 'wk-sets' });
    const rowCtl = []; // per set index: { wIn, rIn, row }

    const targetBtn = el('button', {
      type: 'button', class: 'wk-target', 'aria-label': `Target ${formatTarget(entry)}, edit`,
      onClick: () => editTarget(entry),
    }, formatTarget(entry));

    const targetHit = el('div', { class: 'wk-tmet small', hidden: true });
    const updateTarget = () => {
      const tc = targetCheck(entry);
      rowCtl.forEach((c, i) => {
        const hit = !!(tc && tc.perSet[i]);
        c.row.classList.toggle('is-hit', hit);
        c.label.setAttribute('aria-label', `${c.name} options${hit ? ', meets the target' : ''}`);
      });
      targetHit.hidden = !(tc && tc.met);
      targetHit.textContent = tc && tc.met ? `Target met: ${tc.hits} set${tc.hits === 1 ? '' : 's'} at ${fmtNum(entry.targetWeight, 2)} kg or more` : '';
    };

    const fromStart = !!last && isBaseline(last.workout);
    const lastLine = el('div', { class: 'wk-last small muted' }, !last ? 'No previous session' : fromStart ? startingPointLine(last) : `Last: ${formatSets(last.entry.sets)} · ${shortDate(last.workout.date)}`);
    // Live "vs last time": fixed-width slot (reserved even while empty) so the row never reflows.
    const deltaEl = last ? el('div', { class: 'wk-delta small', 'aria-live': 'polite' }) : null;
    const updateDelta = () => {
      if (!deltaEl) return;
      const c = liveComparison(entry, last.entry);
      if (!c) { deltaEl.replaceChildren(); deltaEl.removeAttribute('aria-label'); deltaEl.title = ''; return; }
      const what = c.basis === 'reps' ? 'reps' : 'volume';
      deltaEl.replaceChildren(pctBadge(c.pct), el('span', { class: 'wk-delta-sub muted' }, `${what} vs ${fromStart ? 'start' : 'last'}`));
      const desc = `${what} ${pctWords(c.pct)} versus ${fromStart ? 'the starting point' : 'last time'} (${basisValue(c.basis, c.cur)} vs ${basisValue(c.basis, c.prev)}, first ${c.compared} set${c.compared === 1 ? '' : 's'})`;
      deltaEl.setAttribute('aria-label', desc);
      deltaEl.title = desc;
    };

    let chip = null;
    let progRow = null;
    if (suggestion) {
      chip = el('button', {
        type: 'button', class: 'chip wk-prog',
        onClick: () => {
          if (chip.classList.contains('is-active')) return;
          const idx = setsForSuggestion(entry.sets, suggestion.from);
          for (const i of idx) {
            entry.sets[i].weight = suggestion.weight;
            touched.add(entry.sets[i]);
            rowCtl[i].wIn.setNumber(suggestion.weight);
          }
          chip.classList.add('is-active');
          chip.textContent = `✓ ${fmtNum(suggestion.weight, 2)} kg applied to ${idx.length} set${idx.length === 1 ? '' : 's'}`;
          // Offer (never automatic) to raise a weight target that the new weight goes beyond.
          if (entry.targetWeight && suggestion.weight > entry.targetWeight) {
            const raise = el('button', {
              type: 'button', class: 'chip wk-raise',
              onClick: () => { raiseTarget(entry, suggestion.weight, targetBtn); raise.remove(); },
            }, `Make ${fmtNum(suggestion.weight, 2)} kg the target`);
            progRow.append(raise);
          }
          updateTarget();
          save();
        },
      }, `↑ ${fmtNum(suggestion.weight, 2)} kg — ${suggestion.sets} set${suggestion.sets === 1 ? '' : 's'} at ${fmtNum(suggestion.from, 2)} kg hit target`);
      progRow = el('div', { class: 'wk-prog-row' }, chip);
    }

    const noteArea = el('textarea', {
      class: 'textarea wk-note', rows: '2', placeholder: 'Note', value: entry.note || '', 'aria-label': 'Exercise note',
      hidden: !entry.note,
      onInput: () => { entry.note = noteArea.value; save(); },
    });

    const renderRows = () => {
      rowCtl.length = 0;
      let n = 0;
      rowsEl.replaceChildren(
        el('div', { class: 'wk-set wk-set-head small muted', 'aria-hidden': 'true' },
          el('span', 'Set'), el('span', 'kg'), el('span', 'Reps'), el('span', '')),
        ...entry.sets.map((s, i) => renderRow(s, i, s.type === 'dropset' ? null : ++n)));
    };

    function renderRow(set, i, number) {
      const isDrop = set.type === 'dropset';
      const firstNormal = entry.sets.findIndex((s) => s.type === 'normal');
      let freshFirst = false;
      const wIn = numberInput({
        value: set.weight, min: 0, max: 1000, decimals: 2, placeholder: 'kg', ariaLabel: `Set ${number ?? 'drop'} weight in kg`, class: 'wk-in',
        onInput: (v) => {
          set.weight = v;
          touched.add(set);
          if (set.done) { updateDelta(); updateTarget(); }
          if (freshFirst) {
            for (const j of fillDownTargets(entry.sets, i, (k) => !touched.has(entry.sets[k]))) {
              entry.sets[j].weight = v;
              rowCtl[j].wIn.setNumber(v);
            }
          }
          save();
        },
      });
      wIn.addEventListener('focus', () => { freshFirst = i === firstNormal && !set.done && !touched.has(set); });
      const rIn = numberInput({
        value: set.reps, min: 0, max: 999, integer: true, placeholder: 'reps', ariaLabel: `Set ${number ?? 'drop'} reps`, class: 'wk-in',
        onInput: (v) => { set.reps = v; touched.add(set); if (set.done) { updateDelta(); updateTarget(); } save(); },
      });
      const doneBtn = el('button', {
        type: 'button', class: 'wk-done', 'aria-label': `Set ${number ?? 'drop'} done`, 'aria-pressed': set.done ? 'true' : 'false',
        onClick: () => {
          if (!set.done && set.reps === null) { toast('Enter reps first'); rIn.focus(); return; }
          set.done = !set.done;
          touched.add(set);
          doneBtn.setAttribute('aria-pressed', set.done ? 'true' : 'false');
          row.classList.toggle('is-done', set.done);
          updateDelta();
          updateTarget();
          save();
        },
      }, el('span', { 'aria-hidden': 'true' }, '✓'));
      const label = el('button', {
        type: 'button', class: 'wk-set-label', 'aria-label': `Set ${number ?? 'drop'} options`,
        onClick: () => rowMenu(entry, i),
      }, isDrop ? el('span', { class: 'badge badge-dropset' }, 'Drop') : String(number));
      const row = el('div', { class: ['wk-set', isDrop && 'is-drop', set.done && 'is-done'] }, label, wIn, rIn, doneBtn);
      // Long-press anywhere on the label also opens the menu (context menu on desktop).
      label.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(entry, i); });
      rowCtl[i] = { wIn, rIn, row, label, name: `Set ${number ?? 'drop'}` };
      return row;
    }
    renderRows();
    updateDelta();
    updateTarget();

    const card = el('section', { class: ['card', 'wk-card'], 'aria-label': exName(exMap, entry.exerciseId) },
      el('div', { class: 'wk-card-head' },
        el('h2', { class: 'wk-ex-name' }, exName(exMap, entry.exerciseId)),
        el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'Exercise menu', onClick: () => exerciseMenu(entry) }, '⋯')),
      el('div', { class: 'wk-meta' }, targetBtn, lastLine, deltaEl),
      targetHit,
      progRow,
      rowsEl,
      el('div', { class: 'wk-card-actions' },
        el('button', { type: 'button', class: 'btn btn-sm', onClick: () => addSet(entry, 'normal') }, '+ Set'),
        el('button', { type: 'button', class: 'btn btn-sm wk-btn-drop', onClick: () => addSet(entry, 'dropset') }, '+ Dropset'),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { noteArea.hidden = false; noteArea.focus(); },
        }, 'Note')),
      noteArea);
    card._focusLastWeight = () => { const c = rowCtl[rowCtl.length - 1]; if (c) c.wIn.focus(); };
    return card;
  }

  // ------------------------------------------------------------ set actions
  function addSet(entry, type) {
    const sets = entry.sets;
    const lastNormal = [...sets].reverse().find((s) => s.type === 'normal');
    if (type === 'normal') {
      const s = { weight: lastNormal ? lastNormal.weight : null, reps: lastNormal ? lastNormal.reps : entry.targetReps ?? null, type, done: false };
      // Insert after the last normal set so trailing dropsets stay at the end.
      const at = lastNormal ? sets.lastIndexOf(lastNormal) + 1 : sets.length;
      sets.splice(at, 0, s);
      rerenderCard(entry);
    } else {
      const lastDrop = [...sets].reverse().find((s) => s.type === 'dropset');
      const base = lastDrop || null;
      sets.push({ weight: base ? base.weight : null, reps: base ? base.reps : null, type, done: false });
      const c = rerenderCard(entry);
      if (!base) c._focusLastWeight();
    }
    save();
  }

  function rowMenu(entry, i) {
    const set = entry.sets[i];
    if (!set) return;
    const s = openSheet({ title: set.type === 'dropset' ? 'Dropset' : 'Set' });
    s.body.append(el('div', { class: 'list' },
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          set.type = set.type === 'dropset' ? 'normal' : 'dropset';
          s.close(); rerenderCard(entry); save();
        },
      }, el('div', { class: 'li-main' }, set.type === 'dropset' ? 'Make normal set' : 'Make dropset')),
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          entry.sets.splice(i + 1, 0, { ...set, done: false });
          s.close(); rerenderCard(entry); save();
        },
      }, el('div', { class: 'li-main' }, 'Duplicate set')),
      el('button', {
        type: 'button', class: 'list-item text-danger', onClick: () => {
          const [removed] = entry.sets.splice(i, 1);
          s.close(); rerenderCard(entry); save();
          toast('Set deleted', {
            action: { label: 'Undo', onClick: () => { entry.sets.splice(i, 0, removed); rerenderCard(entry); save(); } },
          });
        },
      }, el('div', { class: 'li-main' }, 'Delete set'))));
  }

  function editTarget(entry) {
    const sets = numberInput({ value: entry.targetSets, min: 1, max: 20, integer: true, ariaLabel: 'Target sets' });
    const reps = numberInput({ value: entry.targetReps, min: 1, max: 100, integer: true, ariaLabel: 'Target reps' });
    const max = numberInput({ value: entry.targetRepsMax, min: 1, max: 100, integer: true, placeholder: 'optional', ariaLabel: 'Max reps' });
    const wt = numberInput({ value: entry.targetWeight ?? null, min: 0, max: MAX_TARGET_WEIGHT, decimals: 2, placeholder: 'optional', ariaLabel: 'Target weight in kg' });
    const s = openSheet({
      title: `Target · ${exName(exMap, entry.exerciseId)}`,
      content: [
        el('div', { class: 'grid-3' }, field('Sets', sets), field('Reps', reps), field('Max reps', max)),
        field('Weight', wt, { unit: 'kg', hint: 'Optional. Leave empty for bodyweight or no weight target.' }),
        el('p', { class: 'field-hint' }, 'A range like 3 x 6–8 progresses once every set at the top weight reaches the max.'),
      ],
    });
    s.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => s.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: () => {
          if (sets.getNumber() === null || reps.getNumber() === null) { toast('Enter sets and reps', { type: 'error' }); return; }
          if (wt.value.trim() && wt.getNumber() === null) { toast('Enter a weight in kg or leave it empty', { type: 'error' }); return; }
          Object.assign(entry, normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber(), targetWeight: wt.getNumber() }));
          s.close(); rerenderCard(entry); save();
        },
      }, 'Save'));
  }

  /** Raise the weight target of this entry, and of the routine item it came from. */
  async function raiseTarget(entry, weight, targetBtn) {
    entry.targetWeight = weight;
    targetBtn.textContent = formatTarget(entry);
    targetBtn.setAttribute('aria-label', `Target ${formatTarget(entry)}, edit`);
    save();
    let routineDone = false;
    try {
      const r = workout.routineId ? await db.get('routines', workout.routineId) : null;
      const items = r ? r.items.filter((it) => it.exerciseId === entry.exerciseId) : [];
      if (items.length) {
        for (const it of items) it.targetWeight = weight;
        r.updatedAt = Date.now();
        await db.put('routines', r);
        routineDone = true;
      }
    } catch (err) { console.error(err); }
    toast(`Target is now ${fmtNum(weight, 2)} kg${routineDone ? ' (routine updated)' : ''}`, { type: 'success' });
  }

  // ------------------------------------------------------------ exercise actions
  function exerciseMenu(entry) {
    const i = workout.exercises.indexOf(entry);
    const s = openSheet({ title: exName(exMap, entry.exerciseId) });
    const item = (label, fn, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick: () => { s.close(); fn(); } },
      el('div', { class: 'li-main' }, label));
    s.body.append(el('div', { class: 'list' },
      tutorialMenuItem(exMap.get(entry.exerciseId) || { id: entry.exerciseId, name: exName(exMap, entry.exerciseId) }, () => s.close()),
      item('Edit target', () => editTarget(entry)),
      item('Add note', () => { const c = cards.get(entry); const t = c && c.querySelector('.wk-note'); if (t) { t.hidden = false; t.focus(); } }),
      i > 0 ? item('Move up', () => move(i, -1)) : null,
      i < workout.exercises.length - 1 ? item('Move down', () => move(i, 1)) : null,
      item('Replace exercise', () => replace(entry)),
      item('Remove exercise', () => removeExercise(entry), 'text-danger')));
  }

  function move(i, d) {
    const arr = workout.exercises;
    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
    renderAll(); save();
    const c = cards.get(arr[i + d]);
    if (c) c.scrollIntoView({ block: 'nearest' });
  }

  async function replace(entry) {
    const ex = await pickExercise({ title: 'Replace with', exMap, workouts: allWorkouts() });
    if (!ex || ex.id === entry.exerciseId) return;
    const anyDone = entry.sets.some((s) => s.done);
    entry.exerciseId = ex.id;
    // Nothing logged yet: re-fill rows from the new exercise's history.
    if (!anyDone) entry.sets = buildEntry(ex.id, entry, older).sets;
    rerenderCard(entry); save();
  }

  function removeExercise(entry) {
    const i = workout.exercises.indexOf(entry);
    if (i < 0) return;
    workout.exercises.splice(i, 1);
    renderAll(); save();
    toast(`Removed ${exName(exMap, entry.exerciseId)}`, {
      action: { label: 'Undo', onClick: () => { workout.exercises.splice(i, 0, entry); renderAll(); save(); } },
    });
  }

  async function addExercise() {
    const ex = await pickExercise({ exMap, workouts: allWorkouts() });
    if (!ex) return;
    const entry = buildEntry(ex.id, null, older);
    workout.exercises.push(entry);
    renderAll(); save();
    const c = cards.get(entry);
    if (c) c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ------------------------------------------------------------ workout actions
  function workoutMenu() {
    const s = openSheet({ title: 'Workout' });
    const item = (label, fn, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick: () => { s.close(); fn(); } },
      el('div', { class: 'li-main' }, label));
    s.body.append(el('div', { class: 'list' },
      item('Rename', rename),
      item('Change date, time, duration', editDateTime),
      item('Save as routine', saveAsRoutine),
      finished() ? null : item('Finish workout', finish),
      item(finished() ? 'Delete workout' : 'Discard workout', discard, 'text-danger')));
  }

  function rename() {
    const input = el('input', { class: 'input', type: 'text', value: workout.name, maxlength: '60' });
    const s = openSheet({ title: 'Rename workout', content: field('Name', input) });
    s.footer.append(el('button', {
      type: 'button', class: 'btn btn-primary', onClick: () => {
        const n = input.value.trim();
        if (!n) return;
        workout.name = n; titleEl.textContent = n; s.close(); save();
      },
    }, 'Save'));
    input.focus();
  }

  async function editDateTime() {
    const v = await changeDateTime(workout);
    if (!v) return;
    applySchedule(workout, v);
    older = others.filter((w) => byRecent(w, workout) > 0);
    updateSubtitle();
    renderAll();
    await save();
    toast(`Moved to ${fmtDate(workout.date)}, ${fmtTime(workout.startedAt)}`, { type: 'success' });
  }

  async function saveAsRoutine() {
    const items = routineItemsFromWorkout(workout).filter((it) => exMap.has(it.exerciseId));
    if (!items.length) { toast('Add an exercise first'); return; }
    const input = el('input', { class: 'input', type: 'text', value: workout.name === 'Workout' ? '' : workout.name, maxlength: '60', placeholder: 'e.g. Push day' });
    const s = openSheet({
      title: 'Save as routine',
      content: [field('Routine name', input), el('p', { class: 'muted small' }, `${items.length} exercise${items.length === 1 ? '' : 's'} with their targets.`)],
    });
    s.footer.append(el('button', {
      type: 'button', class: 'btn btn-primary', onClick: async () => {
        const n = input.value.trim();
        if (!n) { input.focus(); return; }
        const r = newRoutine(n, items, await nextRoutineOrder());
        await db.put('routines', r);
        s.close();
        if (!workout.routineId) { workout.routineId = r.id; save(); }
        toast(`Routine "${n}" saved`, { type: 'success' });
      },
    }, 'Save routine'));
    input.focus();
  }

  async function finish() {
    const undone = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const stats0 = sessionStats(workout);
    if (!stats0.setsDone) {
      const ok = await confirmDialog({ title: 'No sets ticked', message: 'Nothing is marked done. Finish anyway?', confirmLabel: 'Finish' });
      if (!ok) return;
    } else if (undone) {
      const ok = await confirmDialog({
        title: 'Finish workout?',
        message: `${undone} set${undone === 1 ? ' is' : 's are'} not ticked and will not count.`,
        confirmLabel: 'Finish',
      });
      if (!ok) return;
    }
    // A live session ends now; a past one (logged later or forgotten) ends start + its duration.
    workout.finishedAt = finishTime(workout, Date.now());
    delete workout.plannedDurationMs;
    clearInterval(timer);
    updateSubtitle();
    await save();
    showSummary();
  }

  function showSummary() {
    const st = sessionStats(workout);
    const vol = workoutVolume(workout, exMap, volumeWeights);
    const cmp = compareSession([...older, workout], workout);
    const rows = MUSCLES.filter((m) => vol[m.id]).map((m) =>
      el('div', { class: 'row-between' }, el('span', m.name), el('span', { class: 'num' }, fmtNum(vol[m.id], 2))));
    const m = openModal({
      title: 'Workout finished',
      dismissible: false,
      content: [
        el('div', { class: 'grid-3 wk-stats' },
          stat(fmtDuration(st.durationMs), 'Duration'),
          stat(String(st.normalSets), 'Sets'),
          stat(String(st.exercises), 'Exercises')),
        st.dropsets ? el('p', { class: 'muted small' }, `+ ${st.dropsets} dropset${st.dropsets === 1 ? '' : 's'}`) : null,
        st.setsDone ? el('div', { class: 'stack' },
          el('div', { class: 'section-title' }, cmp.prevSession ? 'vs last time you did this routine' : 'vs last time (each exercise)'),
          comparisonBlock(cmp, exMap)) : null,
        rows.length ? el('div', { class: 'stack wk-summary-muscles' }, el('div', { class: 'section-title' }, 'Sets per muscle'), ...rows) : null,
      ],
    });
    m.footer.append(
      el('a', { class: 'btn btn-block', href: href(`workout/summary/${encodeURIComponent(workout.id)}`) }, 'Full analysis'),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => m.close('done') }, 'Done'));
    m.closed.then((r) => { if (r === 'done') navigate('workout', { replace: true }); });
  }

  async function discard() {
    const ok = await confirmDialog({
      title: finished() ? 'Delete workout?' : 'Discard workout?',
      message: 'All sets of this workout will be deleted. This cannot be undone.',
      confirmLabel: finished() ? 'Delete' : 'Discard', danger: true,
    });
    if (!ok) return;
    gone = true;
    await saver.flush();
    await db.remove('workouts', workout.id);
    toast(finished() ? 'Workout deleted' : 'Workout discarded');
    navigate('workout', { replace: true });
  }

  // ------------------------------------------------------------ layout
  renderAll();
  const footer = el('div', { class: 'stack wk-session-footer' },
    el('button', { type: 'button', class: 'btn btn-block', onClick: addExercise }, '+ Add exercise'),
    finished()
      ? el('a', { class: 'btn btn-primary btn-block', href: `#/workout/history/${encodeURIComponent(workout.id)}` }, 'Done')
      : el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: finish }, 'Finish workout'),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: discard }, finished() ? 'Delete workout' : 'Discard workout'));
  container.append(header, cardsEl, footer);

  // Never lose a keystroke: write pending changes when the page is hidden.
  const onHide = () => { if (document.visibilityState === 'hidden') saver.save(); };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    saver.save();
  };
}

/** 'Starting point: 100×6, 100×6, 100×6 · best 105×3 · 18 Nov' */
function startingPointLine(last) {
  const best = bestSetOf(last.entry);
  return `Starting point: ${formatSets(workingSets(last.entry))}${best ? ` · best ${formatSets([best])}` : ''} · ${shortDate(last.workout.date)}`;
}

function stat(value, label) {
  return el('div', { class: 'wk-stat' }, el('div', { class: 'wk-stat-value num' }, value), el('div', { class: 'small muted' }, label));
}
