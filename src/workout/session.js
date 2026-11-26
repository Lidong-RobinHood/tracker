// Session screen: log sets fast, one-handed. Route: workout/session/:id
// Rendering rule: typing and ticking only touch the affected row (no re-render), so the page never
// jumps while the keyboard is open. Structural changes (add/delete/reorder) re-render one card.
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, numberInput, field, openSheet, openModal, toast, navigate, emptyState,
  fmtTime, fmtDuration, fmtNum, fmtDate, href, icon, iconButton, infoButton, setBadge, statTile, sectionHeader,
} from '../ui/index.js';
import {
  buildEntry, byRecent, lastEntryFor, normaliseTarget, fillDownTargets,
  sessionStats, routineItemsFromWorkout, finishTime, applySchedule, targetCheck, prefillSets, refreshAutoSets,
  LIVE_WINDOW_MS, MAX_TARGET_WEIGHT,
} from '../core/workout.js';
import { changeDateTime } from './datetime.js';
import { suggestProgression, setsForSuggestion } from '../core/progression.js';
import { workoutVolume, volumeWeights as volumeWeightsOf } from '../core/volume.js';
import { withSetsInfo } from './volume-ui.js';
import { MUSCLES } from '../core/muscles.js';
import {
  ensureCss, loadExercises, loadWorkouts, createSaver, exName, shortDate, newRoutine, nextRoutineOrder,
  confirmAction, exLabel, fmtTarget, fmtWeight, workoutTitle, DEFAULT_WORKOUT_NAME,
} from './data.js';
import { t } from '../i18n/index.js';
import { muscleName, nameForSave } from '../i18n/names.js';
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
    append(container, pageHeader({ title: t('workout.route.workout'), back: 'workout' }),
      emptyState(t('workout.session.notFound'), el('a', { class: 'btn', href: href('workout') }, t('workout.session.home'))));
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
    (err) => { console.error(err); toast(t('workout.error.save', { error: err && err.message }), { type: 'error' }); });
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
    const done = t('workout.session.setsDone', { count: n });
    if (finished()) subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · ${fmtDuration(workout.finishedAt - workout.startedAt)} · ${done}`;
    else if (workout.plannedDurationMs || now - workout.startedAt > LIVE_WINDOW_MS || now < workout.startedAt) {
      subtitle.textContent = `${fmtDate(workout.date)} · ${fmtTime(workout.startedAt)} · ${t('workout.session.past')} · ${done}`;
    } else subtitle.textContent = `${fmtTime(workout.startedAt)} · ${fmtDuration(now - workout.startedAt)} · ${done}`;
  };
  updateSubtitle();
  const timer = setInterval(updateSubtitle, 30000);

  const finishBtn = el('button', { type: 'button', class: 'btn btn-ghost wk-finish', onClick: () => finish() }, t('workout.session.finish'));
  const header = pageHeader({
    title: workoutTitle(workout),
    subtitle: ' ',
    back: 'workout',
    actions: [
      finished() ? null : finishBtn,
      iconButton('ellipsis', { label: t('workout.session.menu'), onClick: () => workoutMenu() }),
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
      append(cardsEl, el('div', { class: 'card wk-empty-card' }, el('p', { class: 'muted' }, t('workout.routine.noExercisesYet'))));
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

    const rowsEl = el('div', { class: 'wk-sets', role: 'group', 'aria-label': t('workout.session.setsAria', { name }) });
    const rowCtl = []; // per set index: { wIn, rIn, row }

    const targetBtn = el('button', {
      type: 'button', class: 'wk-target', 'aria-label': t('workout.target.editAria', { target: fmtTarget(entry) }),
      onClick: () => editTarget(entry),
    }, targetContent(entry));

    // Target progress: one line whose slot always exists while the card has a weight target, so
    // ticking the last required set changes its text only, never the layout below it.
    const hasWeightTarget = targetCheck(entry) !== null;
    const targetHit = hasWeightTarget ? el('div', { class: 'wk-tmet t-sub', 'aria-live': 'polite' }) : null;
    const updateTarget = () => {
      const tc = targetCheck(entry);
      rowCtl.forEach((c, i) => {
        const hit = !!(tc && tc.perSet[i]);
        c.row.classList.toggle('is-hit', hit);
        c.label.setAttribute('aria-label', hit ? t('workout.set.optionsHit', { set: c.name }) : t('workout.set.options', { set: c.name }));
      });
      if (!targetHit || !tc) return;
      const weight = fmtNum(entry.targetWeight, 2);
      targetHit.classList.toggle('is-met', tc.met);
      replaceChildren(targetHit, tc.met
        ? [icon('circle-check', { size: 16 }), t('workout.target.met', { count: tc.hits, weight })]
        : t('workout.target.progress', { hits: tc.hits, needed: tc.needed, weight }));
    };

    const updateCurrent = () => markCurrent();

    const fromStart = !!last && isBaseline(last.workout);
    // Previous values per row: normal sets against the previous normal sets, dropsets against dropsets.
    const prevNormal = !last ? [] : fromStart ? workingSets(last.entry) : last.entry.sets.filter((s) => s.done && s.type !== 'dropset');
    const prevDrop = !last || fromStart ? [] : last.entry.sets.filter((s) => s.done && s.type === 'dropset');
    const best = fromStart ? bestSetOf(last.entry) : null;
    // Each previous set is in its row (Previous column); this line says where they come from and, for
    // a starting point, its best set. It wraps instead of truncating.
    const lastText = !last ? t('workout.session.noPrevious')
      : fromStart ? (best
        ? t('workout.session.fromStartBest', { date: shortDate(last.workout.date), best: prevText(best) })
        : t('workout.records.startingPointAt', { date: shortDate(last.workout.date) }))
        : t('workout.session.previousAt', { date: shortDate(last.workout.date) });
    // Live "vs last time": fixed-width slot (reserved even while empty) so the row never reflows.
    const deltaEl = last ? el('div', { class: 'wk-delta t-sub', 'aria-live': 'polite' }) : null;
    const updateDelta = () => {
      if (!deltaEl) return;
      const c = liveComparison(entry, last.entry);
      if (!c) { replaceChildren(deltaEl); deltaEl.removeAttribute('aria-label'); deltaEl.title = ''; return; }
      const reps = c.basis === 'reps';
      const subKey = reps ? (fromStart ? 'workout.delta.repsVsStart' : 'workout.delta.repsVsLast') : (fromStart ? 'workout.delta.tonVsStart' : 'workout.delta.tonVsLast');
      replaceChildren(deltaEl, pctBadge(c.pct), el('span', { class: 'wk-delta-sub muted' }, t(subKey)));
      const descKey = reps ? (fromStart ? 'workout.delta.descRepsStart' : 'workout.delta.descRepsLast') : (fromStart ? 'workout.delta.descTonStart' : 'workout.delta.descTonLast');
      const desc = t(descKey, { change: pctWords(c.pct), cur: basisValue(c.basis, c.cur), prev: basisValue(c.basis, c.prev), count: c.compared });
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
        'aria-label': t('workout.prog.chipAria', { weight: fmtNum(suggestion.weight, 2), count: suggestion.sets, from: fmtNum(suggestion.from, 2) }),
        onClick: () => {
          if (chip.classList.contains('is-active')) return;
          const idx = setsForSuggestion(entry.sets, suggestion.from);
          for (const i of idx) {
            entry.sets[i].weight = suggestion.weight;
            touch(entry.sets[i]);
            rowCtl[i].wIn.setNumber(suggestion.weight);
          }
          chip.classList.add('is-active');
          chip.setAttribute('aria-label', t('workout.prog.applied', { weight: fmtNum(suggestion.weight, 2), count: idx.length }));
          replaceChildren(chip, icon('check', { size: 16 }), `${fmtNum(suggestion.weight, 2)} kg`);
          // Offer (never automatic) to raise a weight target that the new weight goes beyond.
          if (entry.targetWeight && suggestion.weight > entry.targetWeight) {
            const raise = el('button', {
              type: 'button', class: 'chip wk-raise',
              onClick: () => { raiseTarget(entry, suggestion.weight, targetBtn); raise.remove(); },
            }, t('workout.prog.makeTarget', { weight: fmtNum(suggestion.weight, 2) }));
            append(raiseRow, raise);
          }
          updateTarget();
          save();
        },
      }, icon('arrow-up', { size: 16 }), `${fmtNum(suggestion.weight, 2)} kg`);
      infoBtn = infoButton('progression', {
        label: t('workout.prog.why'),
        values: { reason: t('workout.prog.reason', {
          count: suggestion.sets, from: fmtNum(suggestion.from, 2), reps: suggestion.repsTarget,
          step: fmtNum(suggestion.increment, 2), weight: fmtNum(suggestion.weight, 2),
        }) },
      });
      stepBtn = iconButton('sliders-horizontal', {
        label: t('workout.prog.stepAria', { step: fmtNum(suggestion.increment, 2) }), class: 'wk-prog-step',
        onClick: () => editIncrement(entry),
      });
      raiseRow = el('div', { class: 'wk-raise-row' });
    }

    const noteArea = el('textarea', {
      class: 'textarea wk-note', rows: '2', placeholder: t('workout.note.placeholder'), value: entry.note || '', 'aria-label': t('workout.note.aria'),
      hidden: !entry.note,
      onInput: () => { entry.note = noteArea.value; save(); },
    });

    const renderRows = () => {
      rowCtl.length = 0;
      let n = 0;
      let d = 0;
      replaceChildren(rowsEl,
        el('div', { class: 'wk-set wk-set-head t-cap', 'aria-hidden': 'true' },
          el('span', t('workout.set.headShort')), el('span', t('workout.set.previous')), el('span', { class: 'no-caps' }, 'kg'), el('span', t('workout.target.reps')), el('span', icon('check', { size: 16 }))),
        ...entry.sets.map((s, i) => (s.type === 'dropset'
          ? renderRow(s, i, null, prevDrop[d++])
          : renderRow(s, i, ++n, prevNormal[n - 1]))));
    };

    function renderRow(set, i, number, prev) {
      const isDrop = set.type === 'dropset';
      const firstNormal = entry.sets.findIndex((s) => s.type === 'normal');
      const setName = number ? t('workout.set.name', { n: number }) : t('workout.set.dropName');
      const wIn = numberInput({
        value: set.weight, min: 0, max: 1000, decimals: 2, placeholder: 'kg',
        ariaLabel: t('workout.set.weightAria', { set: setName }), class: 'wk-in',
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
        value: set.reps, min: 0, max: 999, integer: true, placeholder: t('workout.set.repsPlaceholder'),
        ariaLabel: t('workout.set.repsAria', { set: setName }), class: 'wk-in',
        onInput: (v) => { set.reps = v; touch(set); if (set.done) { updateDelta(); updateTarget(); } save(); },
      });
      const doneBtn = el('button', {
        type: 'button', class: 'wk-done', 'aria-label': t('workout.set.doneAria', { set: setName }), 'aria-pressed': set.done ? 'true' : 'false',
        onClick: () => {
          if (!set.done && set.reps === null) { toast(t('workout.set.repsFirst')); rIn.focus(); return; }
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
        type: 'button', class: 'wk-set-label', 'aria-label': t('workout.set.options', { set: setName }),
        onClick: () => rowMenu(entry, i),
      }, isDrop ? setBadge(t('workout.set.dropBadge'), { title: t('workout.set.dropset') }) : el('span', { class: 'set-badge wk-set-num' }, String(number)));
      const prevEl = el('span', { class: 'wk-prev' }, prev ? prevText(prev) : '–');
      const row = el('div', { class: ['wk-set', isDrop && 'is-drop', set.done && 'is-done'] }, label, prevEl, wIn, rIn, doneBtn);
      // Long-press anywhere on the label also opens the menu (context menu on desktop).
      label.addEventListener('contextmenu', (e) => { e.preventDefault(); rowMenu(entry, i); });
      rowCtl[i] = { wIn, rIn, row, label, name: setName };
      return row;
    }
    renderRows();
    rowsOf.set(entry, rowCtl);
    updateDelta();
    updateTarget();

    const tut = tutorialFor(ex || { id: entry.exerciseId, name });
    const card = el('section', { class: ['card', 'wk-card'], 'aria-label': name },
      el('div', { class: ['wk-card-head', ex && 'has-mus'] },
        // Main muscle; opens the muscles of this exercise in a sheet (fixed size: nothing below moves).
        ex ? el('button', {
          type: 'button', class: 'btn btn-icon btn-ghost wk-mus-btn', 'aria-haspopup': 'dialog',
          'aria-label': t('workout.session.musclesAria', { muscles: musclesLabel(ex.primary, ex.secondary) }),
          onClick: () => openMusclesSheet(ex),
        }, rowMuscleIcon((ex.primary || [])[0], 32)) : null,
        el('h2', { class: 'wk-ex-name' }, name),
        el('a', {
          class: 'btn btn-icon btn-ghost', href: tut.url, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': t('workout.session.tutorialAria', { name }),
        }, icon('circle-play')),
        iconButton('ellipsis', { label: t('workout.session.exerciseMenu'), onClick: () => exerciseMenu(entry) })),
      // Target first, never truncated; the suggestion chip + weight step sit right-aligned on the same
      // line when there is room, else wrap to their own line (fixed per card, ticking never moves it).
      el('div', { class: 'wk-meta' }, targetBtn, chip ? el('div', { class: 'wk-prog-group' }, chip, infoBtn, stepBtn) : null),
      raiseRow,
      lastLine,
      targetHit,
      rowsEl,
      el('div', { class: 'wk-card-actions' },
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => addSet(entry, 'normal') }, icon('plus', { size: 16 }), t('workout.set.add')),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => addSet(entry, 'dropset') }, icon('plus', { size: 16 }), t('workout.set.addDrop')),
        el('span', { class: 'grow' }),
        iconButton('pencil', { label: t('workout.note.add'), onClick: () => { noteArea.hidden = false; noteArea.focus(); } })),
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
    const s = openSheet({ title: set.type === 'dropset' ? t('workout.set.dropset') : t('workout.set.head') });
    append(s.body, el('div', { class: 'list' },
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          set.type = set.type === 'dropset' ? 'normal' : 'dropset';
          s.close(); rerenderCard(entry); save();
        },
      }, el('div', { class: 'li-main' }, set.type === 'dropset' ? t('workout.set.makeNormal') : t('workout.set.makeDrop'))),
      el('button', {
        type: 'button', class: 'list-item', onClick: () => {
          const copy = { ...set, done: false };
          touch(copy);
          entry.sets.splice(i + 1, 0, copy);
          s.close(); rerenderCard(entry); save();
        },
      }, el('div', { class: 'li-main' }, t('workout.set.duplicate'))),
      el('button', {
        type: 'button', class: 'list-item text-danger', onClick: () => {
          const [removed] = entry.sets.splice(i, 1);
          s.close(); rerenderCard(entry); save();
          toast(t('workout.set.deleted'), {
            action: { label: t('workout.action.undo'), onClick: () => { entry.sets.splice(i, 0, removed); rerenderCard(entry); save(); } },
          });
        },
      }, el('div', { class: 'li-main' }, t('workout.set.delete')))));
  }

  function editTarget(entry) {
    const sets = numberInput({ value: entry.targetSets, min: 1, max: 20, integer: true, ariaLabel: t('workout.target.setsAria') });
    const reps = numberInput({ value: entry.targetReps, min: 1, max: 100, integer: true, ariaLabel: t('workout.target.repsAria') });
    const max = numberInput({ value: entry.targetRepsMax, min: 1, max: 100, integer: true, placeholder: t('workout.time.optional'), ariaLabel: t('workout.target.maxReps') });
    const wt = numberInput({ value: entry.targetWeight ?? null, min: 0, max: MAX_TARGET_WEIGHT, decimals: 2, placeholder: t('workout.time.optional'), ariaLabel: t('workout.target.weightAria') });
    const ex = exMap.get(entry.exerciseId);
    const inc = ex ? numberInput({ value: incrementOf(ex), min: 0, max: 50, decimals: 2, ariaLabel: t('workout.prog.stepInputAria') }) : null;
    const s = openSheet({
      title: t('workout.target.sheetTitle', { name: exName(exMap, entry.exerciseId) }),
      content: [
        el('div', { class: 'grid-3' }, field(t('workout.target.sets'), sets), field(t('workout.target.reps'), reps), field(t('workout.target.maxReps'), max)),
        el('div', { class: 'grid-2' },
          field(t('workout.target.weight'), wt, { unit: 'kg' }),
          inc ? field(t('workout.form.step'), inc, { unit: 'kg', info: 'progression' }) : null),
        inc ? el('p', { class: 'field-hint' }, t('workout.target.stepHint')) : null,
      ],
    });
    append(s.footer, 
      el('button', { type: 'button', class: 'btn', onClick: () => s.close() }, t('workout.action.cancel')),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          if (sets.getNumber() === null || reps.getNumber() === null) { toast(t('workout.target.errSetsReps'), { type: 'error' }); return; }
          if (wt.value.trim() && wt.getNumber() === null) { toast(t('workout.target.errWeight'), { type: 'error' }); return; }
          if (inc && inc.getNumber() === null) { toast(t('workout.prog.errStep'), { type: 'error' }); return; }
          Object.assign(entry, normaliseTarget({ targetSets: sets.getNumber(), targetReps: reps.getNumber(), targetRepsMax: max.getNumber(), targetWeight: wt.getNumber() }));
          // Rows the user has not touched follow the new target (edited / ticked rows stay).
          rederive(entry);
          if (inc && inc.getNumber() !== incrementOf(ex)) await saveIncrement(ex, inc.getNumber());
          s.close(); rerenderCard(entry); save();
        },
      }, t('workout.action.save')));
  }

  /** The exercise's weight step for suggestions (missing -> the SPEC default 2.5 kg). */
  function incrementOf(ex) {
    return typeof ex.increment === 'number' && Number.isFinite(ex.increment) ? ex.increment : 2.5;
  }

  /** Store a new weight step on the exercise (a user edit) and redraw every card of it. */
  async function saveIncrement(ex, value) {
    ex.increment = value;
    ex.updatedAt = Date.now();
    try { await db.put('exercises', ex); } catch (err) { console.error(err); toast(t('workout.error.save', { error: err && err.message }), { type: 'error' }); return; }
    for (const e of workout.exercises) if (e.exerciseId === ex.id) rerenderCard(e);
    toast(value > 0 ? t('workout.prog.stepSaved', { name: exLabel(ex), step: fmtNum(value, 2) }) : t('workout.prog.off', { name: exLabel(ex) }), { type: 'success' });
  }

  /** Weight-step button next to the progression chip: change the exercise's weight step. */
  function editIncrement(entry) {
    const ex = exMap.get(entry.exerciseId);
    if (!ex) return;
    const inc = numberInput({ value: incrementOf(ex), min: 0, max: 50, decimals: 2, ariaLabel: t('workout.prog.stepInputAria') });
    const s = openSheet({
      title: t('workout.prog.stepTitle', { name: exLabel(ex) }),
      content: [
        field(t('workout.form.step'), inc, { unit: 'kg', hint: t('workout.form.stepHint'), info: 'progression' }),
        el('div', { class: 'chips' }, [1, 1.25, 2, 2.5, 5].map((v) => el('button', {
          type: 'button', class: 'chip', onClick: () => inc.setNumber(v),
        }, `${fmtNum(v, 2)} kg`))),
      ],
    });
    append(s.footer,
      el('button', { type: 'button', class: 'btn', onClick: () => s.close() }, t('workout.action.cancel')),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const v = inc.getNumber();
          if (v === null) { toast(t('workout.prog.errStep'), { type: 'error' }); return; }
          s.close();
          if (v !== incrementOf(ex)) await saveIncrement(ex, v);
        },
      }, t('workout.action.save')));
  }

  /** Raise the weight target of this entry, and of the routine item it came from. */
  async function raiseTarget(entry, weight, targetBtn) {
    entry.targetWeight = weight;
    replaceChildren(targetBtn, targetContent(entry));
    targetBtn.setAttribute('aria-label', t('workout.target.editAria', { target: fmtTarget(entry) }));
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
    toast(t(routineDone ? 'workout.target.raisedRoutine' : 'workout.target.raised', { weight: fmtNum(weight, 2) }), { type: 'success' });
  }

  // ------------------------------------------------------------ exercise actions
  function exerciseMenu(entry) {
    const i = workout.exercises.indexOf(entry);
    const s = openSheet({ title: exName(exMap, entry.exerciseId) });
    const item = (label, fn, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick: () => { s.close(); fn(); } },
      el('div', { class: 'li-main' }, label));
    append(s.body, el('div', { class: 'list' },
      tutorialMenuItem(exMap.get(entry.exerciseId) || { id: entry.exerciseId, name: exName(exMap, entry.exerciseId) }, () => s.close()),
      item(t('workout.target.edit'), () => editTarget(entry)),
      item(t('workout.note.add'), () => { const c = cards.get(entry); const n = c && c.querySelector('.wk-note'); if (n) { n.hidden = false; n.focus(); } }),
      i > 0 ? item(t('workout.action.moveUp'), () => move(i, -1)) : null,
      i < workout.exercises.length - 1 ? item(t('workout.action.moveDown'), () => move(i, 1)) : null,
      item(t('workout.session.replaceExercise'), () => replace(entry)),
      item(t('workout.session.removeExercise'), () => removeExercise(entry), 'text-danger')));
  }

  function move(i, d) {
    const arr = workout.exercises;
    [arr[i], arr[i + d]] = [arr[i + d], arr[i]];
    renderAll(); save();
    const c = cards.get(arr[i + d]);
    if (c) c.scrollIntoView({ block: 'nearest' });
  }

  async function replace(entry) {
    const ex = await pickExercise({ title: t('workout.session.replaceWith'), exMap, workouts: allWorkouts() });
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
    toast(t('workout.toast.removed', { name: exName(exMap, entry.exerciseId) }), {
      action: { label: t('workout.action.undo'), onClick: () => { workout.exercises.splice(i, 0, entry); renderAll(); save(); } },
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
    const s = openSheet({ title: t('workout.route.workout') });
    const item = (label, fn, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick: () => { s.close(); fn(); } },
      el('div', { class: 'li-main' }, label));
    append(s.body, el('div', { class: 'list' },
      item(t('workout.session.rename'), rename),
      item(t('workout.time.changeTitle'), editDateTime),
      item(t('workout.session.saveAsRoutine'), saveAsRoutine),
      finished() ? null : item(t('workout.session.finishWorkout'), finish),
      item(finished() ? t('workout.session.delete') : t('workout.session.discard'), discard, 'text-danger')));
  }

  function rename() {
    const input = el('input', { class: 'input', type: 'text', value: workoutTitle(workout), maxlength: '60' });
    const s = openSheet({ title: t('workout.session.renameTitle'), content: field(t('workout.form.name'), input) });
    append(s.footer, el('button', {
      type: 'button', class: 'btn btn-primary', onClick: () => {
        const n = input.value.trim();
        if (!n) return;
        workout.name = nameForSave(workout.name, workoutTitle(workout), n); titleEl.textContent = n; s.close(); save();
      },
    }, t('workout.action.save')));
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
    toast(t('workout.toast.moved', { date: fmtDate(workout.date), time: fmtTime(workout.startedAt) }), { type: 'success' });
  }

  async function saveAsRoutine() {
    const items = routineItemsFromWorkout(workout).filter((it) => exMap.has(it.exerciseId));
    if (!items.length) { toast(t('workout.session.addFirst')); return; }
    const input = el('input', { class: 'input', type: 'text', value: !workout.name || workout.name === DEFAULT_WORKOUT_NAME ? '' : workoutTitle(workout), maxlength: '60', placeholder: t('workout.session.routinePlaceholder') });
    const s = openSheet({
      title: t('workout.session.saveAsRoutine'),
      content: [field(t('workout.routine.nameAria'), input), el('p', { class: 't-sub muted' }, t('workout.session.routineItems', { count: items.length }))],
    });
    append(s.footer, el('button', {
      type: 'button', class: 'btn btn-primary', onClick: async () => {
        const n = input.value.trim();
        if (!n) { input.focus(); return; }
        const r = newRoutine(n, items, await nextRoutineOrder());
        await db.put('routines', r);
        s.close();
        if (!workout.routineId) { workout.routineId = r.id; save(); }
        toast(t('workout.session.routineSaved', { name: n }), { type: 'success' });
      },
    }, t('workout.session.saveRoutine')));
    input.focus();
  }

  async function finish() {
    const undone = workout.exercises.reduce((n, e) => n + e.sets.filter((s) => !s.done).length, 0);
    const stats0 = sessionStats(workout);
    if (!stats0.setsDone) {
      // Never store a finished workout without a done set: offer to discard it instead.
      const ok = await confirmAction({
        title: t('workout.finish.nothingTitle'),
        message: t('workout.finish.nothingMessage'),
        confirmLabel: t('workout.session.discard'), cancelLabel: t('workout.finish.keepLogging'), danger: true,
      });
      if (!ok) return;
      await removeWorkout(t('workout.toast.discarded'));
      return;
    } else if (undone) {
      const ok = await confirmAction({
        title: t('workout.finish.title'),
        message: t('workout.finish.undone', { count: undone }),
        confirmLabel: t('workout.session.finish'),
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
      title: t('workout.finish.done'),
      dismissible: false,
      content: [
        // Tonnage once: in the comparison card, with its change beside it.
        el('div', { class: 'tiles wk-tiles-2' },
          statTile({ label: t('workout.time.duration'), ...durationParts(st.durationMs) }),
          // the muscles of this session at a glance (same numbers as Sets per muscle below)
          withGlyph(statTile({ label: t('workout.target.sets'), value: String(st.normalSets), sub: setsSub(st) }), workoutGlyph(workout, exMap, volumeWeights))),
        st.setsDone ? comparisonSection(cmp.prevSession ? t('workout.compare.lastRoutine') : t('workout.compare.last'), cmp, exMap) : null,
        muscles.length ? el('section', { class: 'section' },
          withSetsInfo(sectionHeader(t('workout.summary.setsPerMuscle')), volumeWeightsOf(volumeWeights), 'sets-workout'),
          el('div', { class: 'wk-hbars' }, muscles.map((mu) => el('div', { class: 'wk-hbar' },
            el('span', { class: 'wk-hbar-name' }, muscleName(mu.id)),
            el('span', { class: 'wk-hbar-track', 'aria-hidden': 'true' }, el('span', { class: 'wk-hbar-fill', style: { width: `${((vol[mu.id] / maxSets) * 100).toFixed(1)}%` } })),
            el('span', { class: 'wk-hbar-val' }, fmtNum(vol[mu.id], 2)))))) : null,
      ],
    });
    append(m.footer,
      el('a', { class: 'btn btn-block', href: href(`workout/summary/${encodeURIComponent(workout.id)}`) }, t('workout.summary.fullAnalysis')),
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => m.close('done') }, t('workout.action.done')));
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
      title: finished() ? t('workout.session.deleteTitle') : t('workout.session.discardTitle'),
      message: t('workout.session.discardMessage'),
      confirmLabel: finished() ? t('workout.action.delete') : t('workout.action.discard'), danger: true,
    });
    if (!ok) return;
    await removeWorkout(finished() ? t('workout.toast.deleted') : t('workout.toast.discarded'));
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
      el('button', { type: 'button', class: 'btn btn-block', onClick: addExercise }, icon('plus'), t('workout.picker.title')),
      finished()
        ? el('a', { class: 'btn btn-primary btn-block', href: href(`workout/history/${encodeURIComponent(workout.id)}`) }, t('workout.action.done'))
        : el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: finish }, t('workout.session.finishWorkout')),
      el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: discard }, finished() ? t('workout.session.delete') : t('workout.session.discard')));
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
  return st.dropsets
    ? t('workout.summary.exercisesDrop', { count: st.exercises, drop: st.dropsets })
    : t('workout.summary.exercises', { count: st.exercises });
}

/** One previous set: '100 × 6', 'BW × 10'. */
function prevText(s) {
  return `${fmtWeight(s.weight)} × ${Number.isFinite(s.reps) ? s.reps : '–'}`;
}

/** Content of a card's target button: 'Target 3 × 6–8 @ 100 kg' (the word styled apart). */
function targetContent(entry) {
  const target = fmtTarget(entry);
  const text = t('workout.target.line', { target });
  const at = text.indexOf(target);
  if (at < 0) return text;
  return [el('span', { class: 'wk-target-word' }, text.slice(0, at)), target, text.slice(at + target.length) || null];
}
