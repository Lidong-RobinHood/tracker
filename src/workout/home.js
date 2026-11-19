// Workout home ("Train"): resume card, muscle recovery body map, this week's sets per muscle (bars or
// body map), start, starting point, links. Looking back (history, routine progress, records) lives in
// Analysis / History. Route: workout
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, fmtTime, fmtNum, href, icon, cardHeader, sectionHeader, segmented,
  bodyMap, setBodyMapValues,
} from '../ui/index.js';
import { today } from '../core/dates.js';
import { weeklyComparison, weeklyBreakdown, targetProgress, volumeWeights } from '../core/volume.js';
import { sessionStats, isLoggedWorkout, LIVE_WINDOW_MS } from '../core/workout.js';
import { breakdownAria, breakdownText, setsBar, setsLegend, withSetsInfo } from './volume-ui.js';
import { logPastWorkout } from './datetime.js';
import { MUSCLES } from '../core/muscles.js';
import { isBaseline, findBaseline } from '../core/baseline.js';
import { loadTargets } from './targets.js';
import { workoutNav } from './subnav.js';
import { recoverySection, loadRecoverySetting } from './recovery.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, unfinishedWorkouts, isLiveOpen, startWorkout, shortDate, navAction } from './data.js';

/** Below this many finished workouts the home screen suggests entering a starting point. */
const THIN_HISTORY = 3;

/** Bars or map, kept while the app is open. */
const view = { sets: 'bars' };

export async function mountHome(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets, recovery] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(), loadRecoverySetting(),
  ]);
  const weights = volumeWeights(rawWeights);
  const openList = unfinishedWorkouts(workouts);
  const baseline = findBaseline(workouts);
  const finishedCount = workouts.filter((w) => isLoggedWorkout(w) && !isBaseline(w)).length;

  append(container, pageHeader({ title: 'Workout' }), workoutNav('train'));

  // Resume cards: the live workout first, then any unfinished past workout (see data.js rule).
  for (const open of openList) {
    const st = sessionStats(open);
    append(container, el('a', { class: 'card wk-resume', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'grow wk-min0' },
        el('div', { class: 't-cap wk-kicker' }, isLiveOpen(open) ? 'In progress' : 'Not finished'),
        el('div', { class: 't-head truncate' }, open.name),
        el('div', { class: 't-sub muted' }, `${resumeWhen(open)} · ${st.setsDone} set${st.setsDone === 1 ? '' : 's'} done`)),
      el('span', { class: 'btn btn-primary' }, icon('play'), 'Resume')));
  }

  // Muscle recovery (estimate; uses only the last 14 days of the already loaded workouts)
  append(container, recoverySection(workouts, exMap, weights, recovery));

  // Sets this week (with optional targets: done / target)
  append(container, setsCard(workouts, exMap, weights, targets));

  // Start
  const start = (r) => navAction(() => startWorkout(r));
  const startRow = (title, sub, onClick) => el('button', { type: 'button', class: 'list-item', onClick },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), sub ? el('div', { class: 'li-sub' }, sub) : null),
    el('span', { class: 'wk-go', 'aria-hidden': 'true' }, 'Start'));
  append(container, el('section', { class: 'section' },
    sectionHeader('Start'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      ...routines.map((r) => startRow(r.name, routineSub(r, exMap), start(r))),
      startRow('Empty workout', null, start(null)),
      el('button', { type: 'button', class: 'list-item', onClick: () => logPastWorkout(routines) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Log a past workout')),
        icon('calendar', { class: 'li-chevron' })),
      routines.length ? null : el('a', { class: 'list-item', href: href('workout/routines') },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, 'Create a routine')),
        icon('chevron-right', { class: 'li-chevron' }))))));

  // Starting point prompt while history is thin (always linked below as well)
  if (!baseline && finishedCount < THIN_HISTORY) {
    append(container, el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      el('a', { class: 'list-item', href: href('workout/starting-point') },
        icon('target', { class: 'li-lead' }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, 'Enter your starting point'),
          el('div', { class: 'li-sub' }, 'Pre-fills your sessions')),
        icon('chevron-right', { class: 'li-chevron' })))));
  }

  // Links
  const activeEx = [...exMap.values()].filter((e) => !e.archived).length;
  const nTargets = Object.keys(targets).length;
  append(container, el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
    link('workout/routines', 'Routines', `${routines.length}`),
    link('workout/exercises', 'Exercise library', `${activeEx}`),
    link('workout/starting-point', 'Starting point', baseline ? shortDate(baseline.date) : 'Not set'),
    link('workout/targets', 'Weekly set targets', nTargets ? `${nTargets}` : 'Off'),
    link('workout/recovery', 'Muscle recovery', null))));
}

/** "Sets this week": one bar per muscle against its target, or the body map shaded by sets. */
function setsCard(workouts, exMap, weights, targets) {
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const parts = weeklyBreakdown(workouts, exMap, weights, today());
  const byMuscle = new Map(cmp.rows.map((r) => [r.muscle, r]));
  const rowsData = MUSCLES
    .filter((m) => byMuscle.has(m.id) || targets[m.id])
    .map((m) => byMuscle.get(m.id) || { muscle: m.id, name: m.name, current: 0, previous: 0 });
  const hasTargets = Object.keys(targets).length > 0;
  const max = Math.max(1, ...rowsData.filter((r) => !targets[r.muscle]).map((r) => Math.max(r.current, r.previous)));
  const range = cmp.weekStart.slice(0, 7) === cmp.weekEnd.slice(0, 7)
    ? `${Number(cmp.weekStart.slice(8, 10))}–${shortDate(cmp.weekEnd)}`
    : `${shortDate(cmp.weekStart)} – ${shortDate(cmp.weekEnd)}`;

  // Body map: 4 = at target, 3 = over 2/3, 2 = over 1/3, 1 = started (target, or this week's most-trained muscle)
  const weekMax = Math.max(0, ...rowsData.map((r) => r.current));
  const step = (r) => {
    if (!(r.current > 0)) return 0;
    const t = targets[r.muscle];
    const f = t ? r.current / t : r.current / weekMax;
    return f >= 1 ? 4 : f > 2 / 3 ? 3 : f > 1 / 3 ? 2 : 1;
  };
  const values = Object.fromEntries(rowsData.map((r) => [r.muscle, step(r)]));

  const body = el('div', { class: 'wk-sets-body' });
  const paint = () => {
    if (view.sets === 'map') {
      const map = bodyMap({
        view: 'both', title: `Sets this week: ${rowsData.filter((r) => r.current > 0).map((r) => `${r.name} ${fmtNum(r.current, 2)}${targets[r.muscle] ? ` of ${fmtNum(targets[r.muscle], 1)}` : ''}`).join(', ') || 'none'}`,
      });
      setBodyMapValues(map, values);
      map.classList.add('wk-rc-map');
      replaceChildren(body, el('div', { class: 'wk-map-row' }, map,
        el('ul', { class: 'legend wk-map-legend' },
          el('li', el('span', { class: 'swatch is-4' }), hasTargets ? 'At target' : 'Most'),
          el('li', el('span', { class: 'swatch is-3' }), 'Over 2/3'),
          el('li', el('span', { class: 'swatch is-2' }), 'Over 1/3'),
          el('li', el('span', { class: 'swatch is-1' }), 'Started'),
          el('li', el('span', { class: 'swatch' }), 'None'))));
      return;
    }
    replaceChildren(body,
      el('div', { class: 'wk-sets-legend-row' }, setsLegend({ target: hasTargets }), el('span', { class: 't-sub muted' }, range)),
      rowsData.length
        ? el('div', { class: 'wk-vol' }, rowsData.map((r) => volumeRow(r, targets[r.muscle], max, parts[r.muscle], weights)))
        : el('p', { class: 't-sub muted' }, 'No sets yet.'));
  };
  paint();

  const toggle = segmented({
    small: true, ariaLabel: 'Show sets as', value: view.sets,
    options: [{ value: 'bars', label: 'Bars' }, { value: 'map', label: 'Map' }],
    onChange: (v) => { view.sets = v; paint(); },
  });
  return el('section', { class: 'card wk-sets-card' },
    withSetsInfo(cardHeader('Sets this week', { trail: toggle }), weights),
    body,
    el('div', { class: 'wk-card-links' },
      el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/targets') }, hasTargets ? 'Edit targets' : 'Set targets'),
      el('a', { class: 'btn btn-ghost btn-sm', href: href('settings') }, 'Set weighting')));
}

function link(path, title, trail) {
  return el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    trail ? el('span', { class: 'li-trail muted' }, trail) : null,
    icon('chevron-right', { class: 'li-chevron' }));
}

function routineSub(r, exMap) {
  const names = r.items.map((i) => exMap.get(i.exerciseId)).filter(Boolean).map((e) => e.name);
  if (!names.length) return 'No exercises';
  return names.join(', ');
}

/** '07:03' for a live session, 'Mon 9 Nov · past workout' for a back-dated one. */
function resumeWhen(w) {
  const now = Date.now();
  if (w.plannedDurationMs || now - w.startedAt > LIVE_WINDOW_MS || now < w.startedAt) return `${shortDate(w.date)} · past workout`;
  return w.date === today() ? fmtTime(w.startedAt) : shortDate(w.date);
}

function volumeRow(r, target, max, b, weights) {
  const tp = targetProgress(r.current, target);
  const title = breakdownText(b, weights);
  if (!tp) {
    return el('div', {
      class: 'wk-vol-row', role: 'group', title,
      'aria-label': `${r.name}: ${fmtNum(r.current, 2)} sets this week (${breakdownAria(b, weights)}), ${fmtNum(r.previous, 2)} last week`,
    },
    el('span', { class: 'wk-vol-name' }, r.name),
    setsBar(b, r.current / max),
    el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2))));
  }
  return el('div', {
    class: ['wk-vol-row', tp.reached && 'is-reached'], role: 'group', title,
    'aria-label': `${r.name}: ${fmtNum(r.current, 2)} of ${fmtNum(tp.target, 1)} target sets (${breakdownAria(b, weights)}), ${tp.pct} percent reached; ${fmtNum(r.previous, 2)} last week`,
  },
  el('span', { class: 'wk-vol-name' }, r.name),
  setsBar(b, tp.fraction, { target: true }),
  el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2)), ` / ${fmtNum(tp.target, 1)}`));
}
