// Split detail: weekly sets on the body map (or as a list), volume level, the sessions with swaps,
// "How to run it", and Follow (adopt). Route: workout/splits/:id
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, sectionHeader, cardHeader, segmented, tag, icon, infoButton, href,
  bodyMap, setBodyMapValues, openSheet, toast, fmtNum, navigate, emptyState, confirmDialog,
} from '../ui/index.js';
import { splitById, SHARED_BULLETS, SPLIT_DISCLAIMER } from '../data/splits.js';
import { MUSCLES } from '../core/muscles.js';
import { sanitiseTargets, volumeWeights } from '../core/volume.js';
import { formatTarget } from '../core/workout.js';
import { exerciseUsage } from '../core/exercise-usage.js';
import { coverageStep, coverageBands, alternatives, autoSwaps, targetsFromCoverage, VOLUME_LEVELS } from '../core/splits.js';
import { loadExercises, loadWorkouts, musclesLine } from '../workout/data.js';
import { tutorialFor } from '../workout/tutorial.js';
import {
  ensureSplitsCss, coverageFor, loadChoices, saveChoices, loadActiveSplit, adoptedRoutines, adoptSplit, stopFollowing, TARGETS_KEY,
} from './store.js';
import { styleLabel, levelLabel, equipmentLabel } from './library.js';

const LEVEL_LABEL = { minimum: 'Minimum', standard: 'Standard', high: 'High' };
const EQUIP_NAME = { barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', other: 'Other' };
const view = { sets: 'map' }; // Map / List toggle, kept while the app runs

export async function mountDetail(container, params) {
  ensureSplitsCss();
  const split = splitById(params.id);
  if (!split) {
    append(container, pageHeader({ title: 'Split', back: 'workout/splits' }), emptyState('Split not found.',
      el('a', { class: 'btn', href: href('workout/splits') }, 'All splits')));
    return;
  }
  const [exMap, workouts, weights, rawTargets, active] = await Promise.all([
    loadExercises(), loadWorkouts(), db.getSetting('volume'), db.getSetting(TARGETS_KEY), loadActiveSplit(),
  ]);
  const usage = exerciseUsage(workouts);
  const targets = sanitiseTargets(rawTargets);
  const following = !!(active && active.splitId === split.id);
  const saved = loadChoices(split.id);
  const state = {
    level: VOLUME_LEVELS.includes(saved.level) ? saved.level : (following ? active.level : 'standard'),
    swaps: autoSwaps(split, { exercises: exMap, usage, swaps: saved.swaps }),
  };
  const persist = () => saveChoices(split.id, { level: state.level, swaps: state.swaps });
  let current = coverageFor(split, { ...state, exMap, weights });

  // ------------------------------------------------ coverage card
  const map = bodyMap({ view: 'both', class: 'sp-map' });
  const setsBody = el('div', { class: 'sp-sets-body' });
  const paintSets = () => {
    const cov = current.coverage;
    map.setAttribute('aria-label', `Planned weekly sets: ${MUSCLES.map((m) => `${m.name} ${fmtNum(cov[m.id].total, 1)}`).join(', ')}`);
    setBodyMapValues(map, Object.fromEntries(MUSCLES.map((m) => [m.id, coverageStep(cov[m.id].total)])));
    if (view.sets === 'map') {
      replaceChildren(setsBody, el('div', { class: 'sp-map-row' }, map,
        el('ul', { class: 'legend sp-legend', 'aria-label': 'Weekly sets' },
          coverageBands(weights).map((b) => el('li', el('span', { class: ['swatch', b.step ? `is-${b.step}` : null] }), b.label)))));
    } else {
      replaceChildren(setsBody, el('div', { class: 'list sp-muscles' }, MUSCLES.map((m) => muscleRow(m, cov[m.id], targets[m.id]))));
    }
  };
  const levelSeg = segmented({
    ariaLabel: 'Volume', value: state.level,
    options: VOLUME_LEVELS.map((v) => ({ value: v, label: LEVEL_LABEL[v] })),
    onChange: (v) => { state.level = v; persist(); recompute(); },
  });
  const setsToggle = segmented({
    small: true, ariaLabel: 'Show weekly sets as', value: view.sets,
    options: [{ value: 'map', label: 'Map' }, { value: 'list', label: 'Sets' }],
    onChange: (v) => { view.sets = v; paintSets(); },
  });
  const setsHeader = cardHeader('Weekly sets', { trail: setsToggle });
  // the sheet text uses the user's own set weighting
  setsHeader.querySelector('.card-title').after(infoButton('split-sets', { values: volumeWeights(weights) }));
  const setsCard = el('section', { class: 'card sp-sets-card' },
    setsHeader,
    setsBody,
    el('div', { class: 'sp-level' }, el('span', { class: 't-cap muted' }, 'Volume'), levelSeg));

  // ------------------------------------------------ week
  const weekBox = el('div', { class: 'stack' });
  const paintWeek = () => {
    const per = split.days / split.sessions.length;
    const totals = current.sessions.map((s) => s.items.reduce((a, i) => a + i.sets, 0));
    const lo = Math.min(...totals); const hi = Math.max(...totals);
    replaceChildren(weekBox,
      sectionHeader('Week', { trail: `${lo === hi ? lo : `${lo}–${hi}`} sets / session` }),
      current.sessions.map((s, si) => el('section', { class: 'card card-flush sp-day' },
        el('div', { class: 'sp-day-head' },
          el('span', { class: 'sp-day-n', 'aria-hidden': 'true' }, String(si + 1)),
          el('h3', { class: 'card-title grow' }, s.name),
          per > 1 ? tag(`× ${per} / week`) : null),
        el('div', { class: 'list' }, s.items.map((it, i) => exerciseRow(s, it, i))))));
  };
  const exerciseRow = (s, it, i) => {
    const ex = exMap.get(it.exerciseId);
    const swapped = it.exerciseId !== it.original;
    return el('button', {
      type: 'button', class: 'list-item sp-ex', 'aria-haspopup': 'dialog',
      onClick: () => openAlternatives(s, it, i),
    },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, ex ? ex.name : 'Unknown exercise'),
      swapped ? el('div', { class: 'li-sub sp-swapped' }, icon('repeat', { size: 14 }), 'Swapped') : null),
    el('span', { class: 'li-trail sp-target' }, formatTarget({ targetSets: it.sets, targetReps: it.reps, targetRepsMax: it.repsMax })),
    icon('chevron-right', { class: 'li-chevron' }));
  };

  function recompute() {
    current = coverageFor(split, { ...state, exMap, weights });
    paintSets();
    paintWeek();
  }

  // ------------------------------------------------ alternatives sheet
  function openAlternatives(s, it, i) {
    const key = `${s.id}:${i}`;
    const inDay = s.items.map((x) => x.exerciseId);
    const cur = exMap.get(it.exerciseId);
    const opts = { exercises: exMap, usage, exclude: inDay, homeOnly: split.equipment === 'home', limit: 12 };
    const alts = alternatives(it.exerciseId, opts);
    const all = alternatives(it.exerciseId, { ...opts, showAll: true, limit: 60 });
    const orig = exMap.get(it.original);
    const sheet = openSheet({ title: 'Swap exercise', className: 'sp-alt-sheet' });
    const listBox = el('div');
    const choose = (id) => {
      if (id === it.original) delete state.swaps[key]; else state.swaps[key] = id;
      persist();
      recompute();
      sheet.close();
    };
    const altRow = (ex, { current: isCur = false } = {}) => {
      const t = tutorialFor(ex);
      const sub = [musclesLine(ex), EQUIP_NAME[ex.equipment] || ex.equipment].filter(Boolean).join(' · ');
      return el('div', { class: 'list-item sp-alt' },
        isCur
          ? el('div', { class: 'li-main sp-alt-main' }, el('div', { class: 'li-title' }, ex.name), el('div', { class: 'li-sub' }, sub))
          : el('button', { type: 'button', class: 'li-main sp-alt-main', onClick: () => choose(ex.id), 'aria-label': `Swap to ${ex.name}` },
            el('div', { class: 'li-title' }, ex.name), el('div', { class: 'li-sub' }, sub)),
        usage.has(ex.id) && !isCur ? tag('Logged') : null,
        el('a', {
          class: 'btn btn-icon btn-ghost', href: t.url, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': `Tutorial: ${ex.name} (opens in a new tab)`,
        }, icon('circle-play', { size: 20 })));
    };
    replaceChildren(listBox, alts.length ? el('div', { class: 'list' }, alts.map((ex) => altRow(ex))) : el('p', { class: 't-sub muted' }, 'No similar exercise.'));
    append(sheet.body,
      cur ? el('div', { class: 'list sp-alt-current' }, altRow(cur, { current: true })) : null,
      it.exerciseId !== it.original && orig
        ? el('button', { type: 'button', class: 'btn btn-secondary btn-block sp-alt-reset', onClick: () => choose(it.original) },
          icon('undo-2', { size: 18 }), `Back to ${orig.name}`)
        : null,
      sectionHeader('Same movement'),
      listBox);
    // "Show all": every exercise with the same main muscle, also movements the day already has.
    const more = all.length > alts.length ? el('button', {
      type: 'button', class: 'btn btn-ghost btn-block sp-alt-all',
      onClick: () => { replaceChildren(listBox, el('div', { class: 'list' }, all.map((ex) => altRow(ex)))); more.remove(); },
    }, `Show all ${all.length}`) : null;
    append(sheet.body, more);
  }

  // ------------------------------------------------ how to run it + disclaimer
  const howTo = el('section', { class: 'section' },
    sectionHeader('How to run it', { info: 'split-run' }),
    el('div', { class: 'card' }, el('ul', { class: 'sp-bullets' }, [...SHARED_BULLETS, ...split.bullets].map((b) => el('li', b)))));
  const disclaimer = el('p', { class: 't-sub muted sp-disclaimer' }, SPLIT_DISCLAIMER, ' ',
    el('a', { class: 'sp-src-link', href: href('licences?section=split-sources') }, 'Methods and sources'));

  // ------------------------------------------------ follow
  const actions = el('div', { class: 'stack sp-actions' });
  const paintActions = () => {
    if (following) {
      replaceChildren(actions,
        el('button', { type: 'button', class: 'btn btn-secondary btn-block', onClick: openAdopt }, 'Create the routines again'),
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onClick: async () => {
            if (!(await confirmDialog({ title: 'Stop following?', message: 'Your routines stay.', confirmLabel: 'Stop following' }))) return;
            await stopFollowing();
            navigate('workout/splits');
          },
        }, 'Stop following'));
    } else {
      replaceChildren(actions, el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: openAdopt }, 'Follow this split'));
    }
  };

  async function openAdopt() {
    const routines = await db.getAll('routines');
    const previous = adoptedRoutines(routines);
    const n = split.sessions.length;
    const newTargets = targetsFromCoverage(current.coverage);
    const opts = { replace: previous.length > 0, setTargets: false };
    const sheet = openSheet({ title: `Follow ${split.name}`, className: 'sp-adopt' });
    // One short line under each choice says what it does.
    const newTargetsText = MUSCLES.filter((m) => newTargets[m.id]).map((m) => `${m.name} ${fmtNum(newTargets[m.id], 0)}`).join(' · ');
    const targetsLine = el('p', { class: 'field-hint sp-targets-line' });
    const paintTargets = () => { targetsLine.textContent = opts.setTargets ? `Replaces your targets: ${newTargetsText}` : 'Your weekly set targets stay.'; };
    paintTargets();
    const replaceLine = el('p', { class: 'field-hint' });
    const paintReplace = () => {
      replaceLine.textContent = opts.replace
        ? `Deletes the ${previous.length} routine${previous.length === 1 ? '' : 's'} of earlier splits. History stays.`
        : 'Nothing is deleted.';
    };
    paintReplace();
    const tick = el('input', {
      type: 'checkbox', class: 'switch', id: 'sp-set-targets',
      onChange: () => { opts.setTargets = tick.checked; paintTargets(); },
    });
    append(sheet.body,
      el('div', { class: 'list sp-adopt-list' }, current.sessions.map((s, i) => el('div', { class: 'list-item' },
        el('span', { class: 'sp-day-n', 'aria-hidden': 'true' }, String(i + 1)),
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, s.name)),
        el('span', { class: 'li-trail t-sub muted' }, `${s.items.length} exercises`)))),
      el('div', { class: 'sp-adopt-meta t-sub muted' }, `${LEVEL_LABEL[state.level]} volume`),
      previous.length ? el('div', { class: 'field' },
        el('div', { class: 'field-label-row' }, el('span', { class: 'field-label' }, `Earlier split routines (${previous.length})`)),
        segmented({
          ariaLabel: `Earlier split routines (${previous.length})`, value: 'replace',
          options: [{ value: 'replace', label: 'Replace' }, { value: 'keep', label: 'Keep' }],
          onChange: (v) => { opts.replace = v === 'replace'; paintReplace(); },
        }), replaceLine) : null,
      el('label', { class: 'sp-tick', htmlFor: 'sp-set-targets' },
        el('span', { class: 'grow' }, 'Set weekly set targets'), tick),
      targetsLine);
    append(sheet.footer, el('button', {
      type: 'button', class: 'btn btn-primary btn-block',
      onClick: async () => {
        try {
          const r = await adoptSplit(split, { level: state.level, swaps: state.swaps, exMap, weights, replace: opts.replace, setTargets: opts.setTargets });
          sheet.close();
          toast(`${r.routines.length} routines created`, { type: 'success' });
          navigate('workout');
        } catch (err) {
          console.error(err);
          toast(`Could not create routines: ${err && err.message}`, { type: 'error' });
        }
      },
    }, `Create ${n} routines`));
  }

  append(container,
    pageHeader({ title: split.name, back: 'workout/splits' }),
    el('div', { class: 'sp-head' },
      el('div', { class: 'sp-tags' },
        tag(`${split.days} days`, { tone: 'accent' }), tag(styleLabel(split.style)), tag(levelLabel(split.level)),
        tag(equipmentLabel(split.equipment)), following ? tag('Following', { tone: 'ok', icon: 'check' }) : null),
      el('p', { class: 't-sub muted' }, split.suits)),
    setsCard, weekBox, howTo, actions, disclaimer);
  paintSets();
  paintWeek();
  paintActions();
}

function muscleRow(m, c, target) {
  const parts = [`${fmtNum(c.direct, 1)} direct`, `${fmtNum(c.partial, 1)} partial`, `${c.daysHit} ${c.daysHit === 1 ? 'day' : 'days'}`];
  return el('div', { class: 'list-item sp-muscle' },
    el('span', { class: ['swatch', `is-${coverageStep(c.total)}`] }),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, m.name),
      el('div', { class: 'li-sub' }, parts.join(' · '))),
    el('span', { class: 'li-trail' },
      el('span', { class: 'sp-total' }, fmtNum(c.total, 1)),
      target ? el('span', { class: 'muted' }, ` / ${fmtNum(target, 1)}`) : null));
}

