// Workout home ("Train"): resume card, Next up of the followed split, start, starting point, muscle
// recovery body map, this week's sets per muscle (bars or body map), links. Looking back (history, routine progress, records) lives in
// Analysis / History. Route: workout
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, fmtTime, fmtNum, href, icon, sectionHeader, segmented,
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
import { nextUpCard } from '../splits/next-up.js';
import { splitById } from '../data/splits.js';
import { loadActiveSplit } from '../splits/store.js';

/** Below this many finished workouts the home screen suggests entering a starting point. */
const THIN_HISTORY = 3;

/** Bars or map, kept while the app is open. */
const view = { sets: 'bars' };

export async function mountHome(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets, recovery, activeSplit] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(), loadRecoverySetting(),
    loadActiveSplit(),
  ]);
  const weights = volumeWeights(rawWeights);
  const openList = unfinishedWorkouts(workouts);
  const baseline = findBaseline(workouts);
  const finishedCount = workouts.filter((w) => isLoggedWorkout(w) && !isBaseline(w)).length;
  const followed = activeSplit && activeSplit.splitId ? splitById(activeSplit.splitId) : null;

  append(container, pageHeader({ title: 'Workout' }), workoutNav('train'));

  // Resume cards: the live workout first, then any unfinished past workout (see data.js rule).
  for (const open of openList) {
    const st = sessionStats(open);
    append(container, el('a', { class: 'card wk-resume', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'grow wk-min0' },
        el('div', { class: 't-cap wk-kicker' }, isLiveOpen(open) ? 'In progress' : 'Not finished'),
        el('div', { class: 'strong truncate' }, open.name),
        el('div', { class: 't-sub muted' }, `${resumeWhen(open)} · ${st.setsDone} set${st.setsDone === 1 ? '' : 's'} done`)),
      el('span', { class: 'btn btn-primary' }, icon('play'), 'Resume')));
  }

  // Next up of the followed split: the first action when the user follows one. Its slot keeps the
  // order (the card arrives asynchronously); "Stop following" removes it and the split name below.
  const splitTrail = el('span', { class: 'li-trail muted' }, followed ? followed.name : null);
  const nextSlot = el('div', { class: 'wk-next-slot', hidden: true });
  append(container, nextSlot);
  const startSlot = el('div', { class: 'wk-start-slot' });
  append(container, startSlot);
  // Next up is the primary action; the Start list then holds the other routines (never the next one twice).
  let nextId = null;
  const nextCard = await nextUpCard({
    onChange: () => { replaceChildren(nextSlot); nextSlot.hidden = true; replaceChildren(splitTrail); nextId = null; paintStart(); },
  });
  if (nextCard) { replaceChildren(nextSlot, nextCard); nextSlot.hidden = false; nextId = nextCard.dataset.routineId || null; }

  // Start: one row pattern. Routines and Empty workout: label + "Start"; other rows: label + chevron.
  const start = (r) => navAction(() => startWorkout(r));
  const startRow = (title, sub, onClick) => el('button', { type: 'button', class: 'list-item', onClick },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), sub ? el('div', { class: 'li-sub' }, sub) : null),
    el('span', { class: 'wk-go', 'aria-hidden': 'true' }, 'Start'));
  const navRow = (title, props) => el(props.href ? 'a' : 'button', { class: 'list-item', ...(props.href ? {} : { type: 'button' }), ...props },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    icon('chevron-right', { class: 'li-chevron' }));
  function paintStart() {
    const others = routines.filter((r) => r.id !== nextId);
    replaceChildren(startSlot, el('section', { class: 'section' },
      sectionHeader('Start'),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        ...others.map((r) => startRow(r.name, routineSub(r, exMap), start(r))),
        startRow('Empty workout', null, start(null)),
        navRow('Log a past workout', { onClick: () => logPastWorkout(routines) }),
        routines.length ? null : navRow('Create a routine', { href: href('workout/routines') }),
        routines.length ? null : navRow('Browse splits', { href: href('workout/splits') })))));
  }
  paintStart();

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

  // Muscle recovery (estimate; uses only the last 14 days of the already loaded workouts)
  append(container, recoverySection(workouts, exMap, weights, recovery));

  // Sets this week (with optional targets: done / target)
  append(container, setsCard(workouts, exMap, weights, targets));

  // Links
  const activeEx = [...exMap.values()].filter((e) => !e.archived).length;
  const nTargets = Object.keys(targets).length;
  append(container, el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
    el('a', { class: 'list-item', href: href('workout/splits') },
      icon('repeat', { class: 'li-lead' }),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Splits')),
      splitTrail,
      icon('chevron-right', { class: 'li-chevron' })),
    link('workout/routines', 'Routines', `${routines.length}`),
    link('workout/exercises', 'Exercise library', `${activeEx}`),
    link('workout/starting-point', 'Starting point', baseline ? shortDate(baseline.date) : 'Not set'),
    link('workout/targets', 'Weekly set targets', nTargets ? `${nTargets}` : 'Off'),
    link('workout/recovery', 'Muscle recovery', null))));
}

/**
 * "Sets this week": one bar per muscle against its target, or the body map shaded by sets. Tapping a
 * row (or a muscle on the map) opens one line with the direct / partial figures and last week.
 */
function setsCard(workouts, exMap, weights, targets) {
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const parts = weeklyBreakdown(workouts, exMap, weights, today());
  const byMuscle = new Map(cmp.rows.map((r) => [r.muscle, r]));
  const rowOf = (m) => byMuscle.get(m.id) || { muscle: m.id, name: m.name, current: 0, previous: 0 };
  const rowsData = MUSCLES.filter((m) => byMuscle.has(m.id) || targets[m.id]).map(rowOf);
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

  // One open muscle at a time, kept when switching Bars / Map.
  let open = null;
  const detailText = (r) => `${breakdownText(parts[r.muscle], weights)} · last week ${fmtNum(r.previous, 2)}`;

  const body = el('div', { class: 'wk-sets-body' });
  const paint = () => {
    if (view.sets === 'map') {
      const all = new Map(MUSCLES.map((m) => [m.id, rowOf(m)]));
      const map = bodyMap({
        view: 'both', title: `Sets this week: ${rowsData.filter((r) => r.current > 0).map((r) => `${r.name} ${fmtNum(r.current, 2)}${targets[r.muscle] ? ` of ${fmtNum(targets[r.muscle], 1)}` : ''}`).join(', ') || 'none'}`,
      });
      setBodyMapValues(map, values);
      map.classList.add('wk-rc-map');
      const line = el('p', { class: 't-sub wk-vol-detail wk-map-detail', 'aria-live': 'polite', hidden: true });
      const select = (id) => {
        open = open === id ? null : id;
        for (const p of map.querySelectorAll('.bm-muscle')) {
          const on = p.getAttribute('data-muscle') === open;
          p.classList.toggle('is-sel', on);
          p.setAttribute('aria-pressed', String(on));
        }
        const r = open ? all.get(open) : null;
        line.hidden = !r;
        replaceChildren(line, r ? [el('span', { class: 'strong' }, `${r.name} ${fmtNum(r.current, 2)}`), ` · ${detailText(r)}`] : null);
      };
      // Muscles are buttons (keyboard: Tab, Enter / Space); the map itself is the group.
      map.setAttribute('role', 'group');
      for (const p of map.querySelectorAll('.bm-muscle')) {
        const r = all.get(p.getAttribute('data-muscle'));
        if (!r) continue;
        p.setAttribute('tabindex', '0');
        p.setAttribute('role', 'button');
        p.setAttribute('aria-label', `${r.name}: ${setsN(r.current)}`);
        p.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r.muscle); }
        });
      }
      map.addEventListener('click', (e) => {
        const p = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('[data-muscle]');
        if (p) select(p.getAttribute('data-muscle'));
      });
      replaceChildren(body, el('div', { class: 'wk-map-row' }, map,
        el('ul', { class: 'legend wk-map-legend' },
          el('li', el('span', { class: 'swatch is-4' }), hasTargets ? 'At target' : 'Most'),
          el('li', el('span', { class: 'swatch is-3' }), 'Over 2/3'),
          el('li', el('span', { class: 'swatch is-2' }), 'Over 1/3'),
          el('li', el('span', { class: 'swatch is-1' }), 'Started'),
          el('li', el('span', { class: 'swatch' }), 'None'))),
      line);
      if (open) { const keep = open; open = null; select(keep); }
      return;
    }
    const rows = [];
    const toggle = (id) => {
      open = open === id ? null : id;
      for (const x of rows) {
        const on = x.muscle === open;
        x.btn.setAttribute('aria-expanded', String(on));
        x.detail.hidden = !on;
      }
    };
    for (const r of rowsData) {
      const id = `wk-vol-d-${r.muscle}`;
      const btn = volumeRow(r, targets[r.muscle], max, parts[r.muscle], weights);
      btn.setAttribute('aria-expanded', String(open === r.muscle));
      btn.setAttribute('aria-controls', id);
      btn.addEventListener('click', () => toggle(r.muscle));
      const detail = el('p', { class: 't-sub wk-vol-detail', id, hidden: open !== r.muscle }, detailText(r));
      rows.push({ muscle: r.muscle, btn, detail });
    }
    replaceChildren(body,
      el('div', { class: 'wk-sets-legend-row' }, setsLegend({ target: hasTargets }), el('span', { class: 't-sub muted' }, range)),
      rows.length
        ? el('div', { class: 'wk-vol' }, rows.map((x) => [x.btn, x.detail]))
        : el('p', { class: 't-sub muted' }, 'No sets yet.'));
  };
  paint();

  const toggle = segmented({
    small: true, ariaLabel: 'Show sets as', value: view.sets,
    options: [{ value: 'bars', label: 'Bars' }, { value: 'map', label: 'Map' }],
    onChange: (v) => { view.sets = v; paint(); },
  });
  return el('section', { class: 'section' },
    withSetsInfo(sectionHeader('Sets this week', { trail: toggle }), weights),
    el('div', { class: 'card wk-sets-card' },
      body,
      el('div', { class: 'wk-card-links' },
        el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/targets') }, hasTargets ? 'Edit targets' : 'Set targets'),
        el('a', { class: 'btn btn-ghost btn-sm', href: href('settings/sets') }, 'Set weighting'))));
}

function link(path, title, trail) {
  return el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    trail ? el('span', { class: 'li-trail muted' }, trail) : null,
    icon('chevron-right', { class: 'li-chevron' }));
}

/** '1 set', '6.5 sets' */
function setsN(n) {
  return `${fmtNum(n, 2)} ${n === 1 ? 'set' : 'sets'}`;
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

/** One muscle as a 44 px button (the caller wires expand / collapse of its detail line). */
function volumeRow(r, target, max, b, weights) {
  const tp = targetProgress(r.current, target);
  const chev = icon('chevron-down', { size: 16, class: 'wk-vol-chev' });
  if (!tp) {
    return el('button', {
      type: 'button', class: 'wk-vol-row',
      'aria-label': `${r.name}: ${setsN(r.current)} this week (${breakdownAria(b, weights)}), ${fmtNum(r.previous, 2)} last week`,
    },
    el('span', { class: 'wk-vol-name' }, r.name),
    setsBar(b, r.current / max),
    el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2))),
    chev);
  }
  return el('button', {
    type: 'button', class: ['wk-vol-row', tp.reached && 'is-reached'],
    'aria-label': `${r.name}: ${fmtNum(r.current, 2)} of ${fmtNum(tp.target, 1)} target sets (${breakdownAria(b, weights)}), ${tp.pct} percent reached; ${fmtNum(r.previous, 2)} last week`,
  },
  el('span', { class: 'wk-vol-name' }, r.name),
  setsBar(b, tp.fraction, { target: true }),
  el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2)), ` / ${fmtNum(tp.target, 1)}`),
  chev);
}
