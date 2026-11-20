// Session screen: log sets fast, one-handed. Route: workout/session/:id
// Rendering rule: typing and ticking only touch the affected row (no re-render), so the page never
// jumps while the keyboard is open. Structural changes (add/delete/reorder) re-render one card.
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, numberInput, field, openSheet, openModal, toast, navigate, emptyState,
  fmtTime, fmtDuration, fmtNum, fmtDate, href, icon, iconButton, infoButton, setBadge, statTile, sectionHeader,
} from '../ui/index.js';
import {
  buildEntry, byRecent, lastEntryFor, formatTarget, normaliseTarget, fillDownTargets,
  sessionStats, routineItemsFromWorkout, finishTime, applySchedule, targetCheck, prefillSets, refreshAutoSets,
  formatWeight, LIVE_WINDOW_MS, MAX_TARGET_WEIGHT,
} from '../core/workout.js';
import { changeDateTime } from './datetime.js';
import { suggestProgression, setsForSuggestion } from '../core/progression.js';
import { workoutVolume, volumeWeights as volumeWeightsOf } from '../core/volume.js';
import { withSetsInfo } from './volume-ui.js';
import { MUSCLES } from '../core/muscles.js';
import {
  ensureCss, loadExercises, loadWorkouts, createSaver, exName, shortDate, newRoutine, nextRoutineOrder,
  confirmAction,
} from './data.js';
import { pickExercise } from './picker.js';
import { tutorialMenuItem, tutorialFor } from './tutorial.js';
import { rowMuscleIcon, openMusclesSheet, musclesLabel, withGlyph, workoutGlyph } from './muscle-map.js';
import { liveComparison, compareSession } from '../core/workout-progress.js';
import { pctBadge, pctWords, basisValue, comparisonSection, durationParts } from './progress-ui.js';
import { isBaseline, workingSets, bestSetOf } from '../core/baseline.js';

export async function mountSession(container, { id }) {
  ensureCss();
  const [workout, exMap, workouts, volumeWeights] = await Promise.all([
    db.get('workouts', id), loadExercises(), loadWorkouts(), db.getSetting('volume'),
  ]);
  if (!workout) {
    append(container, pageHeader({ title: 'Workout', back: 'workout' }),
      emptyState('Workout not found.', el('a', { class: 'btn', href: href('workout') }, 'Workout home')));
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
  // A row the user has not edited or ticked carries `auto: true` (set by prefillSets, persisted with
  // the workout, so it survives a reload). Any edit, tick, fill-down or applied suggestion removes
  // it. Auto rows are re-derived when the session's date or the card's target changes.
  const touch = (s) => { delete s.auto; };
  /** Re-derive the untouched rows of an entry from the history before this session and its target. */
  const rederive = (entry) => {
    const last = lastEntryFor(older, entry.exerciseId);
    entry.sets = refreshAutoSets(entry.sets, prefillSets(last ? last.entry : null, entry));
  };

  // ------------------------------------------------------------ header
  const subtitle = el('span');
  const updateSubtitle = () => {
    const now = Date.now();
    const n = sessionStats(workout).setsDone;
    const done = ` · ${n} set${n === 1 ? '' : 's'} done`;
    if (finished()) subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · ${fmtDuration(workout.finishedAt - workout.startedAt)}${done}`;
    else if (workout.plannedDurationMs || now - workout.startedAt > LIVE_WINDOW_MS || now < workout.startedAt) {
      subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · past workout${done}`;
    } else subtitle.textContent = `${fmtTime(workout.startedAt)} · ${fmtDuration(now - workout.startedAt)}${done}`;
  };
  updateSubtitle();
  const timer = setInterval(updateSubtitle, 30000);

  const finishBtn = el('button', { type: 'button', class: 'btn btn-ghost wk-finish', onClick: () => finish() }, 'Finish');
  const header = pageHeader({
    title: workout.name,
    subtitle: ' ',
    back: 'workout',
    actions: [
      finished() ? null : finishBtn,
      iconButton('ellipsis', { label: 'Workout menu', onClick: () => workoutMenu() }),
    ].filter(Boolean),
  });
  replaceChildren(header.querySelector('.page-subtitle'), subtitle);
  const titleEl = header.querySelector('.page-title');

  // ------------------------------------------------------------ cards
  const cardsEl = el('div', { class: 'wk-cards' });
  /** @type {Map<object, HTMLElement>} entry -> card */
  const cards = new Map();

  function renderAll() {
    cards.clear();
    rowsOf.clear();
    replaceChildren(cardsEl, ...workout.exercises.map((entry) => {
      const c = renderCard(entry);
      cards.set(entry, c);
      return c;
    }));
    if (!workout.exercises.length) {
      append(cardsEl, el('div', { class: 'card wk-empty-card' }, el('p', { class: 'muted' }, 'No exercises yet.')));
    }
    markCurrent();
  }
  function rerenderCard(entry) {
    const old = cards.get(entry);
    const c = renderCard(entry);
    cards.set(entry, c);
    if (old) old.replaceWith(c);
    markCurrent();
    return c;
  }

  // The current row is outlined (done rows are tinted): the next set not done in the exercise of the
  // last ticked set, else the first set not done in the workout. Classes only; nothing moves.
  /** @type {Map<object, {row: HTMLElement}[]>} */
  const rowsOf = new Map();
  let lastTicked = null;
  function markCurrent() {
    let target = null;
    if (!finished()) {
      const order = lastTicked && workout.exercises.includes(lastTicked) ? [lastTicked, ...workout.exercises] : workout.exercises;
      for (const e of order) {
        const i = e.sets.findIndex((x) => !x.done);
        if (i >= 0) { target = (rowsOf.get(e) || [])[i] || null; break; }
      }
    }
    for (const list of rowsOf.values()) for (const c of list) if (c) c.row.classList.toggle('is-current', c === target);
  }

  function renderCard(entry) {
    const ex = exMap.get(entry.exerciseId);
    const name = exName(exMap, entry.exerciseId);
    const last = lastEntryFor(older, entry.exerciseId);
    const suggestion = finished() ? null : suggestProgression(older, ex || { id: entry.exerciseId }, { target: entry });

    const rowsEl = el('div', { class: 'wk-sets', role: 'group', 'aria-label': `${name} sets` });
    const rowCtl = []; // per set index: { wIn, rIn, row }

    const targetText = () => [el('span', { class: 'wk-target-word' }, 'Target '), formatTarget(entry)];
    const targetBtn = el('button', {
      type: 'button', class: 'wk-target', 'aria-label': `Target ${formatTarget(entry)}, edit`,
      onClick: () => editTarget(entry),
    }, targetText());

    // Target progress: one line whose slot always exists while the card has a weight target, so
    // ticking the last required set changes its text only, never the layout below it.
    const hasWeightTarget = targetCheck(entry) !== null;
    const targetHit = hasWeightTarget ? el('div', { class: 'wk-tmet t-sub', 'aria-live': 'polite' }) : null;
    const updateTarget = () => {
      const tc = targetCheck(entry);
      rowCtl.forEach((c, i) => {
        const hit = !!(tc && tc.perSet[i]);
        c.row.classList.toggle('is-hit', hit);
        c.label.setAttribute('aria-label', `${c.name} options${hit ? ', meets the target' : ''}`);
      });
      if (!targetHit || !tc) return;
      const at = `≥ ${fmtNum(entry.targetWeight, 2)} kg`;
      targetHit.classList.toggle('is-met', tc.met);
      replaceChildren(targetHit, tc.met
        ? [icon('circle-check', { size: 16 }), `Target met · ${tc.hits} set${tc.hits === 1 ? '' : 's'} ${at}`]
        : `${tc.hits} / ${tc.needed} sets ${at}`);
    };

    const updateCurrent = () => markCurrent();

    const fromStart = !!last && isBaseline(last.workout);
    // Previous values per row: normal sets against the previous normal sets, dropsets against dropsets.
    const prevNormal = !last ? [] : fromStart ? workingSets(last.entry) : last.entry.sets.filter((s) => s.done && s.type !== 'dropset');
    const prevDrop = !last || fromStart ? [] : last.entry.sets.filter((s) => s.done && s.type === 'dropset');
    const best = fromStart ? bestSetOf(last.entry) : null;
    // Each previous set is in its row (Previous column); this line says where they come from and, for
    // a starting point, its best set. It wraps instead of truncating.
    const lastText = !last ? 'No previous session'
      : fromStart ? `Starting point · ${shortDate(last.workout.date)}${best ? ` · best ${prevText(best)}` : ''}`
        : `Previous · ${shortDate(last.workout.date)}`;
    // Live "vs last time": fixed-width slot (reserved even while empty) so the row never reflows.
    const deltaEl = last ? el('div', { class: 'wk-delta t-sub', 'aria-live': 'polite' }) : null;
    const updateDelta = () => {
      if (!deltaEl) return;
      const c = liveComparison(entry, last.entry);
      if (!c) { replaceChildren(deltaEl); deltaEl.removeAttribute('aria-label'); deltaEl.title = ''; return; }
      const what = c.basis === 'reps' ? 'reps' : 'tonnage';
      replaceChildren(deltaEl, pctBadge(c.pct), el('span', { class: 'wk-delta-sub muted' }, `${what} vs ${fromStart ? 'start' : 'last'}`));
      const desc = `${what} ${pctWords(c.pct)} versus ${fromStart ? 'the starting point' : 'last time'} (${basisValue(c.basis, c.cur)} vs ${basisValue(c.basis, c.prev)}, first ${c.compared} set${c.compared === 1 ? '' : 's'})`;
      deltaEl.setAttribute('aria-label', desc);
      deltaEl.title = desc;
    };
    const lastLine = el('div', { class: 'wk-last' },
      el('span', { class: 't-sub muted wk-last-text' }, lastText),
      deltaEl);

    let chip = null;
    let stepBtn = null;
    let infoBtn = null;
    let raiseRow = null;
    // Already applied (now or before a reload): some normal row already carries the suggested
    // weight, so the chip is not offered again for this session.
    const applied = !!suggestion && entry.sets.some((s) => s.type === 'normal' && s.weight === suggestion.weight);
    if (suggestion && !applied) {
      chip = el('button', {
        type: 'button', class: 'chip wk-prog',
        'aria-label': `Suggestion ${fmtNum(suggestion.weight, 2)} kg: ${suggestion.sets} set${suggestion.sets === 1 ? '' : 's'} at ${fmtNum(suggestion.from, 2)} kg hit the target. Apply`,
        onClick: () => {
          if (chip.classList.contains('is-active')) return;
          const idx = setsForSuggestion(entry.sets, suggestion.from);
          for (const i of idx) {
            entry.sets[i].weight = suggestion.weight;
            touch(entry.sets[i]);
            rowCtl[i].wIn.setNumber(suggestion.weight);
          }
          chip.classList.add('is-active');
          chip.setAttribute('aria-label', `${fmtNum(suggestion.weight, 2)} kg applied to ${idx.length} set${idx.length === 1 ? '' : 's'}`);
          replaceChildren(chip, icon('check', { size: 16 }), `${fmtNum(suggestion.weight, 2)} kg`);
          // Offer (never automatic) to raise a weight target that the new weight goes beyond.
          if (entry.targetWeight && suggestion.weight > entry.targetWeight) {
            const raise = el('button', {
              type: 'button', class: 'chip wk-raise',
              onClick: () => { raiseTarget(entry, suggestion.weight, targetBtn); raise.remove(); },
            }, `Make ${fmtNum(suggestion.weight, 2)} kg the target`);
            append(raiseRow, raise);
          }
          updateTarget();
          save();
        },
      }, icon('arrow-up', { size: 16 }), `${fmtNum(suggestion.weight, 2)} kg`);
      infoBtn = infoButton('progression', {
        label: 'Why this suggestion',
        values: { reason: `${suggestion.sets} set${suggestion.sets === 1 ? '' : 's'} at ${fmtNum(suggestion.from, 2)} kg reached ${suggestion.repsTarget} reps last time: ${fmtNum(suggestion.from, 2)} + ${fmtNum(suggestion.increment, 2)} kg weight step = ${fmtNum(suggestion.weight, 2)} kg.` },
      });
      stepBtn = iconButton('sliders-horizontal', {
        label: `Weight step ${fmtNum(suggestion.increment, 2)} kg, change`, class: 'wk-prog-step',
        onClick: () => editIncrement(entry),
      });
      raiseRow = el('div', { class: 'wk-raise-row' });
    }

    const noteArea = el('textarea', {
      class: 'textarea wk-note', rows: '2', placeholder: 'Note', value: entry.note || '', 'aria-label': 'Exercise note',
      hidden: !entry.note,
      onInput: () => { entry.note = noteArea.value; save(); },
    });

    const renderRows = () => {
      rowCtl.length = 0;
      let n = 0;
      let d = 0;
      replaceChildren(rowsEl,
        el('div', { class: 'wk-set wk-set-head t-cap', 'aria-hidden': 'true' },
          el('span', 'Set'), el('span', 'Previous'), el('span', 'kg'), el('span', 'Reps'), el('span', icon('check', { size: 16 }))),
        ...entry.sets.map((s, i) => (s.type === 'dropset'
          ? renderRow(s, i, null, prevDrop[d++])
          : renderRow(s, i, ++n, prevNormal[n - 1]))));
    };

    function renderRow(set, i, number, prev) {
      const isDrop = set.type === 'dropset';
      const firstNormal = entry.sets.findIndex((s) => s.type === 'normal');
      const wIn = numberInput({
        value: set.weight, min: 0, max: 1000, decimals: 2, placeholder: 'kg',
        ariaLabel: `Set ${number ?? 'drop'} weight in kg`, class: 'wk-in',
        onInput: (v) => {
          set.weight = v;
          touch(set);
          if (set.done) { updateDelta(); updateTarget(); }
          for (const j of fillDown) {
            entry.sets[j].weight = v;
            touch(entry.sets[j]);
            rowCtl[j].wIn.setNumber(v);
          }
          save();
        },
      });
      // Typing a weight into an untouched first row copies it to the untouched rows below; the rows
      // are chosen when the field gets focus, so every keystroke ("1", "10", "100") reaches them.
      let fillDown = [];
      wIn.addEventListener('focus', () => {
        fillDown = i === firstNormal && !set.done && set.auto ? fillDownTargets(entry.sets, i, (k) => !!entry.sets[k].auto) : [];
      });
      const rIn = numberInput({
        value: set.reps, min: 0, max: 999, integer: true, placeholder: 'reps',
        ariaLabel: `Set ${number ?? 'drop'} reps`, class: 'wk-in',
        onInput: (v) => { set.reps = v; touch(set); if (set.done) { updateDelta(); updateTarget(); } save(); },
      });
      const doneBtn = el('button', {
        type: 'button', class: 'wk-done', 'aria-label': `Set ${number ?? 'drop'} done`, 'aria-pressed': set.done ? 'true' : 'false',
        onClick: () => {
          if (!set.done && set.reps === null) { toast('Enter reps first'); rIn.focus(); return; }
          set.done = !set.done;
          touch(set);
          lastTicked = entry;
          doneBtn.setAttribute('aria-pressed', set.done ? 'true' : 'false');
          row.classList.toggle('is-done', set.done);
          updateDelta();
          updateTarget();
          updateCurrent();
          updateSubtitle();
          save();
        },
      }, el('span', { class: 'wk-done-box check-box' }, icon('check', { size: 18 })));
      const label = el('button', {
        type: 'button', class: 'wk-set-label', 'aria-label': `Set ${number ?? 'drop'} options`,
        onClick: () => rowMenu(entry, i),
      }, isDrop ? setBadge('D', { title: 'Dropset' }) : el('span', { class: 'set-badge wk-set-num' }, String(number)));
      const prevEl = el('span', { class: 'wk-prev' }, prev ? prevText(prev) : '–');
      const row = el('div', { class: ['wk-set', isDrop && 'is-drop', set.done && 'is-done'] }, label, prevEl, wIn, rIn, doneBtn);
      // Long-press anywhere on the label also opens the menu (context menu on desktop).
      label.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(entry, i); });
      rowCtl[i] = { wIn, rIn, row, label, name: `Set ${number ?? 'drop'}` };
      return row;
    }
    renderRows();
    rowsOf.set(entry, rowCtl);
    updateDelta();
    updateTarget();

    const t = tutorialFor(ex || { id: entry.exerciseId, name });
    const card = el('section', { class: ['card', 'wk-card'], 'aria-label': name },
      el('div', { class: ['wk-card-head', ex && 'has-mus'] },
        // Main muscle; opens the muscles of this exercise in a sheet (fixed size: nothing below moves).
        ex ? el('button', {
          type: 'button', class: 'btn btn-icon btn-ghost wk-mus-btn', 'aria-haspopup': 'dialog',
          'aria-label': `${musclesLabel(ex.primary, ex.secondary)}. Show on body map`,
          onClick: () => openMusclesSheet(ex),
        }, rowMuscleIcon((ex.primary || [])[0], 32)) : null,
        el('h2', { class: 'wk-ex-name' }, name),
        el('a', {
          class: 'btn btn-icon btn-ghost', href: t.url, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `${name} tutorial (opens in a new tab)`,
        }, icon('circle-play')),
        iconButton('ellipsis', { label: 'Exercise menu', onClick: () => exerciseMenu(entry) })),
      // Target first, never truncated; the suggestion chip + weight step sit right-aligned on the same
      // line when there is room, else wrap to their own line (fixed per card, ticking never moves it).
      el('div', { class: 'wk-meta' }, targetBtn, chip ? el('div', { class: 'wk-prog-group' }, chip, infoBtn, stepBtn) : null),
      raiseRow,
      lastLine,
      targetHit,
      rowsEl,
      el('div', { class: 'wk-card-actions' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => addSet(entry, 'normal') }, icon('plus', { size: 16 }), 'Add set'),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => addSet(entry, 'dropset') }, icon('plus', { size: 16 }), 'Add dropset'),
        el('span', { class: 'grow' }),
        iconButton('pencil', { label: 'Add note', onClick: () => { noteArea.hidden = false; noteArea.focus(); } })),
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
    append(s.body, el('div', { class: 'list' },
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          set.type = set.type === 'dropset' ? 'normal' : 'dropset';
          s.close(); rerenderCard(entry); save();
        },
      }, el('div', { class: 'li-main' }, set.type === 'dropset' ? 'Make normal set' : 'Make dropset')),
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          const copy = { ...set, done: false };
          touch(copy);
          entry.sets.splice(i + 1, 0, copy);
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
    const ex = exMap.get(entry.exerciseId);
    const inc = ex ? numberInput({ value: incrementOf(ex), min: 0, max: 50, decimals: 2, ariaLabel: 'Weight step in kg' }) : null;
    const s = openSheet({
      title: `Target · ${exName(exMap, entry.exerciseId)}`,
      content: [
        el('div', { class: 'grid-3' }, field('Sets', sets), field('Reps', reps), field('Max reps', max)),
        el('div', { class: 'grid-2' },
          field('Weight', wt, { unit: 'kg' }),
          inc ? field('Weight step', inc, { unit: 'kg', info: 'progression' }) : null),
        inc ? el('p', { class: 'field-hint' }, 'Weight step applies to this exercise everywhere. 0 = no suggestions.') : null,
      ],
    });
    append(s.footer, 
      el('button', { type: 'button', class: 'btn', onClick: () => s.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          if (sets.getNumber() === null || reps.getNumber() === null) { toast('Enter sets and reps', { type: 'error' }); return; }
          if (wt.value.trim() && wt.getNumber() === null) { toast('Enter a weight in kg or leave it empty', { type: 'error' }); return; }
          if (inc && inc.getNumber() === null) { toast('Enter a weight step from 0 to 50 kg', { type: 'error' }); return; }
          Object.assign(entry, normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber(), targetWeight: wt.getNumber() }));
          // Rows the user has not touched follow the new target (edited / ticked rows stay).
          rederive(entry);
          if (inc && inc.getNumber() !== incrementOf(ex)) await saveIncrement(ex, inc.getNumber());
          s.close(); rerenderCard(entry); save();
        },
      }, 'Save'));
  }

  /** The exercise's weight step for suggestions (missing -> the SPEC default 2.5 kg). */
  function incrementOf(ex) {
    return typeof ex.increment === 'number' && Number.isFinite(ex.increment) ? ex.increment : 2.5;
  }

  /** Store a new weight step on the exercise (a user edit) and redraw every card of it. */
  async function saveIncrement(ex, value) {
    ex.increment = value;
    ex.updatedAt = Date.now();
    try { await db.put('exercises', ex); } catch (err) { console.error(err); toast(`Could not save: ${err && err.message}`, { type: 'error' }); return; }
    for (const e of workout.exercises) if (e.exerciseId === ex.id) rerenderCard(e);
    toast(value > 0 ? `Weight step for ${ex.name}: ${fmtNum(value, 2)} kg` : `No suggestions for ${ex.name}`, { type: 'success' });
  }

  /** Weight-step button next to the progression chip: change the exercise's weight step. */
  function editIncrement(entry) {
    const ex = exMap.get(entry.exerciseId);
    if (!ex) return;
    const inc = numberInput({ value: incrementOf(ex), min: 0, max: 50, decimals: 2, ariaLabel: 'Weight step in kg' });
    const s = openSheet({
      title: `Weight step · ${ex.name}`,
      content: [
        field('Weight step', inc, { unit: 'kg', hint: '0 = no suggestions', info: 'progression' }),
        el('div', { class: 'chips' }, [1, 1.25, 2, 2.5, 5].map((v) => el('button', {
          type: 'button', class: 'chip', onClick: () => inc.setNumber(v),
        }, `${fmtNum(v, 2)} kg`))),
      ],
    });
    append(s.footer,
      el('button', { type: 'button', class: 'btn', onClick: () => s.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const v = inc.getNumber();
          if (v === null) { toast('Enter a weight step from 0 to 50 kg', { type: 'error' }); return; }
          s.close();
          if (v !== incrementOf(ex)) await saveIncrement(ex, v);
        },
      }, 'Save'));
  }

  /** Raise the weight target of this entry, and of the routine item it came from. */
  async function raiseTarget(entry, weight, targetBtn) {
    entry.targetWeight = weight;
    replaceChildren(targetBtn, el('span', { class: 'wk-target-word' }, 'Target '), formatTarget(entry));
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
    append(s.body, el('div', { class: 'list' },
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
    append(s.body, el('div', { class: 'list' },
      item('Rename', rename),
      item('Change date, time, duration', editDateTime),
      item('Save as routine', saveAsRoutine),
      finished() ? null : item('Finish workout', finish),
      item(finished() ? 'Delete workout' : 'Discard workout', discard, 'text-danger')));
  }

  function rename() {
    const input = el('input', { class: 'input', type: 'text', value: workout.name, maxlength: '60' });
    const s = openSheet({ title: 'Rename workout', content: field('Name', input) });
    append(s.footer, el('button', {
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
    // Untouched rows follow the new date (pre-filled from the sessions before it).
    if (!finished()) for (const e of workout.exercises) rederive(e);
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
      content: [field('Routine name', input), el('p', { class: 't-sub muted' }, `${items.length} exercise${items.length === 1 ? '' : 's'} with their targets.`)],
    });
    append(s.footer, el('button', {
      type: 'button', class: 'btn btn-primary', onClick: async () => {
        const n = input.value.trim();
        if (!n) { input.focus(); return; }
        const r = newRoutine(n, items, await nextRoutineOrder());
        await db.put('routines', r);
        s.close();
        if (!workout.routineId) { workout.routineId = r.id; save(); }
        toast(`Routine “${n}” saved`, { type: 'success' });
      },
    }, 'Save routine'));
    input.focus();
  }

  async function finish() {
    const undone = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const stats0 = sessionStats(workout);
    if (!stats0.setsDone) {
      // Never store a finished workout without a done set: offer to discard it instead.
      const ok = await confirmAction({
        title: 'Nothing logged',
        message: 'No sets done. Discard this workout?',
        confirmLabel: 'Discard workout', cancelLabel: 'Keep logging', danger: true,
      });
      if (!ok) return;
      await removeWorkout('Workout discarded');
      return;
    } else if (undone) {
      const ok = await confirmAction({
        title: 'Finish workout?',
        message: `${undone} set${undone === 1 ? '' : 's'} not done; will not count.`,
        confirmLabel: 'Finish',
      });
      if (!ok) return;
    }
    // A live session ends now; a past one (logged later or forgotten) ends start + its duration.
    workout.finishedAt = finishTime(workout, Date.now());
    delete workout.plannedDurationMs;
    clearInterval(timer);
    updateSubtitle();
    finishBtn.remove();
    renderAll();
    renderFooter();
    await save();
    showSummary();
  }

  function showSummary() {
    const st = sessionStats(workout);
    const vol = workoutVolume(workout, exMap, volumeWeights);
    const cmp = compareSession([...older, workout], workout);
    const muscles = MUSCLES.filter((m) => vol[m.id]);
    const maxSets = Math.max(1, ...muscles.map((m) => vol[m.id]));
    const m = openModal({
      title: 'Workout finished',
      dismissible: false,
      content: [
        // Tonnage once: in the comparison card, with its change beside it.
        el('div', { class: 'tiles wk-tiles-2' },
          statTile({ label: 'Duration', ...durationParts(st.durationMs) }),
          // the muscles of this session at a glance (same numbers as Sets per muscle below)
          withGlyph(statTile({ label: 'Sets', value: String(st.normalSets), sub: setsSub(st) }), workoutGlyph(workout, exMap, volumeWeights))),
        st.setsDone ? comparisonSection(cmp.prevSession ? 'vs last time of this routine' : 'vs last time', cmp, exMap) : null,
        muscles.length ? el('section', { class: 'section' },
          withSetsInfo(sectionHeader('Sets per muscle'), volumeWeightsOf(volumeWeights), 'sets-workout'),
          el('div', { class: 'wk-hbars' }, muscles.map((mu) => el('div', { class: 'wk-hbar' },
            el('span', { class: 'wk-hbar-name' }, mu.name),
            el('span', { class: 'wk-hbar-track', 'aria-hidden': 'true' }, el('span', { class: 'wk-hbar-fill', style: { width: `${((vol[mu.id] / maxSets) * 100).toFixed(1)}%` } })),
            el('span', { class: 'wk-hbar-val' }, fmtNum(vol[mu.id], 2)))))) : null,
      ],
    });
    append(m.footer,
      el('a', { class: 'btn btn-block', href: href(`workout/summary/${encodeURIComponent(workout.id)}`) }, 'Full analysis'),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => m.close('done') }, 'Done'));
    m.el.classList.add('wk-summary');
    // One "Done" while the summary is open: the screen's own footer (with its Done link) waits behind it.
    footer.hidden = true;
    m.closed.then((r) => {
      footer.hidden = false;
      if (r === 'done') navigate('workout', { replace: true });
    });
  }

  async function discard() {
    const ok = await confirmAction({
      title: finished() ? 'Delete workout?' : 'Discard workout?',
      message: 'All sets are deleted. This cannot be undone.',
      confirmLabel: finished() ? 'Delete' : 'Discard', danger: true,
    });
    if (!ok) return;
    await removeWorkout(finished() ? 'Workout deleted' : 'Workout discarded');
  }

  async function removeWorkout(message) {
    gone = true;
    clearInterval(timer);
    await saver.flush();
    await db.remove('workouts', workout.id);
    toast(message);
    navigate('workout', { replace: true });
  }

  // ------------------------------------------------------------ layout
  renderAll();
  const footer = el('div', { class: 'stack wk-session-footer' });
  function renderFooter() {
    replaceChildren(footer,
      el('button', { type: 'button', class: 'btn btn-block', onClick: addExercise }, icon('plus'), 'Add exercise'),
      finished()
        ? el('a', { class: 'btn btn-primary btn-block', href: href(`workout/history/${encodeURIComponent(workout.id)}`) }, 'Done')
        : el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: finish }, 'Finish workout'),
      el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: discard }, finished() ? 'Delete workout' : 'Discard workout'));
  }
  renderFooter();
  append(container, header, cardsEl, footer);

  // Never lose a keystroke: write pending changes when the page is hidden.
  const onHide = () => { if (document.visibilityState === 'hidden') saver.save(); };
  document.addEventListener('visibilitychange', onHide);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    saver.save();
  };
}

/** Sub line of the Sets tile: '2 exercises', '2 exercises · + 1 drop'. */
function setsSub(st) {
  return `${st.exercises} exercise${st.exercises === 1 ? '' : 's'}${st.dropsets ? ` · + ${st.dropsets} drop` : ''}`;
}

/** One previous set: '100 × 6', 'BW × 10'. */
function prevText(s) {
  return `${formatWeight(s.weight)} × ${Number.isFinite(s.reps) ? s.reps : '–'}`;
}
