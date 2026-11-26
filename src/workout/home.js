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
import {
  ensureCss, loadExercises, loadWorkouts, loadRoutines, unfinishedWorkouts, isLiveOpen, startWorkout, shortDate, navAction, exLabel,
  workoutTitle, joinList,
} from './data.js';
import { t } from '../i18n/index.js';
import { muscleName, routineName } from '../i18n/names.js';
import { dayRange } from '../i18n/dates.js';
import { parseDate } from '../core/dates.js';
import { nextUpCard } from '../splits/next-up.js';
import { loadActiveSplit, followedName } from '../splits/store.js';
import { routineGlyph } from './routines.js';

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
  const followed = followedName(activeSplit); // library or custom split name, null when none

  append(container, pageHeader({ title: t('workout.route.workout') }), workoutNav('train'));

  // Resume cards: the live workout first, then any unfinished past workout (see data.js rule).
  for (const open of openList) {
    const st = sessionStats(open);
    append(container, el('a', { class: 'card wk-resume', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'grow wk-min0' },
        el('div', { class: 't-cap wk-kicker' }, isLiveOpen(open) ? t('workout.home.inProgress') : t('workout.home.notFinished')),
        el('div', { class: 'strong truncate' }, workoutTitle(open)),
        el('div', { class: 't-sub muted' }, t('workout.home.resumeSub', { when: resumeWhen(open), count: st.setsDone }))),
      el('span', { class: 'btn btn-primary' }, icon('play'), t('workout.home.resume'))));
  }

  // Next up of the followed split: the first action when the user follows one. Its slot keeps the
  // order (the card arrives asynchronously); "Stop following" removes it and the split name below.
  const splitTrail = el('span', { class: 'li-trail muted' }, followed);
  const nextSlot = el('div', { class: 'wk-next-slot', hidden: true });
  append(container, nextSlot);
  const startSlot = el('div', { class: 'wk-start-slot' });
  append(container, startSlot);
  // Next up is the primary action; the Start list then holds the other routines (never the next one twice).
  let nextId = null;
  const nextCard = await nextUpCard({
    onChange: () => { replaceChildren(nextSlot); nextSlot.hidden = true; replaceChildren(splitTrail); nextId = null; paintStart(); },
  });
  if (nextCard) {
    replaceChildren(nextSlot, nextCard); nextSlot.hidden = false; nextId = nextCard.dataset.routineId || null;
    // The card repaints itself after Skip / Undo with another routine (data-routine-id): the Start list
    // then shows the routine that left Next up and hides the new one.
    new MutationObserver(() => {
      const id = nextCard.isConnected ? nextCard.dataset.routineId || null : null;
      if (id !== nextId) { nextId = id; paintStart(); }
    }).observe(nextCard, { attributes: true, attributeFilter: ['data-routine-id'] });
  }

  // Start: one row pattern. Routines and Empty workout: label + "Start"; other rows: label + chevron.
  const start = (r) => navAction(() => startWorkout(r));
  const startRow = (title, sub, onClick, lead = null) => el('button', { type: 'button', class: ['list-item', lead && 'wk-start-row'], onClick },
    lead,
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), sub ? el('div', { class: 'li-sub' }, sub) : null),
    el('span', { class: 'wk-go', 'aria-hidden': 'true' }, t('workout.start.start')));
  const navRow = (title, props) => el(props.href ? 'a' : 'button', { class: 'list-item', ...(props.href ? {} : { type: 'button' }), ...props },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    icon('chevron-right', { class: 'li-chevron' }));
  function paintStart() {
    const others = routines.filter((r) => r.id !== nextId);
    replaceChildren(startSlot, el('section', { class: 'section' },
      sectionHeader(t('workout.start.title')),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        ...others.map((r) => startRow(routineName(r), routineSub(r, exMap), start(r), routineGlyph(r, exMap, weights))),
        startRow(t('workout.start.empty'), null, start(null)),
        navRow(t('workout.start.logPast'), { onClick: () => logPastWorkout(routines) }),
        routines.length ? null : navRow(t('workout.start.createRoutine'), { href: href('workout/routines') }),
        routines.length ? null : navRow(t('workout.start.browseSplits'), { href: href('workout/splits') })))));
  }
  paintStart();

  // Starting point prompt while history is thin (always linked below as well)
  if (!baseline && finishedCount < THIN_HISTORY) {
    append(container, el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      el('a', { class: 'list-item', href: href('workout/starting-point') },
        icon('target', { class: 'li-lead' }),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, t('workout.home.enterStart')),
          el('div', { class: 'li-sub' }, t('workout.home.enterStartSub'))),
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
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, t('workout.home.splits'))),
      splitTrail,
      icon('chevron-right', { class: 'li-chevron' })),
    link('workout/routines', t('workout.route.routines'), `${routines.length}`),
    link('workout/exercises', t('workout.home.library'), `${activeEx}`),
    link('workout/starting-point', t('workout.startingPoint.title'), baseline ? shortDate(baseline.date) : t('workout.home.notSet')),
    link('workout/targets', t('workout.route.targets'), nTargets ? `${nTargets}` : t('workout.home.off')),
    link('workout/recovery', t('workout.route.recovery'), null))));
}

/**
 * "Sets this week": one bar per muscle against its target, or the body map shaded by sets. Tapping a
 * row (or a muscle on the map) opens one line with the direct / partial figures and last week.
 */
function setsCard(workouts, exMap, weights, targets) {
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const parts = weeklyBreakdown(workouts, exMap, weights, today());
  const byMuscle = new Map(cmp.rows.map((r) => [r.muscle, r]));
  // Rows carry the muscle name in the app language (the core rows' name is English).
  const rowOf = (m) => ({ ...(byMuscle.get(m.id) || { muscle: m.id, current: 0, previous: 0 }), name: muscleName(m.id) });
  const rowsData = MUSCLES.filter((m) => byMuscle.has(m.id) || targets[m.id]).map(rowOf);
  const hasTargets = Object.keys(targets).length > 0;
  const max = Math.max(1, ...rowsData.filter((r) => !targets[r.muscle]).map((r) => Math.max(r.current, r.previous)));
  const range = dayRange(parseDate(cmp.weekStart), parseDate(cmp.weekEnd));

  // Body map: 4 = at target, 3 = over 2/3, 2 = over 1/3, 1 = started (target, or this week's most-trained muscle)
  const weekMax = Math.max(0, ...rowsData.map((r) => r.current));
  const step = (r) => {
    if (!(r.current > 0)) return 0;
    const target = targets[r.muscle];
    const f = target ? r.current / target : r.current / weekMax;
    return f >= 1 ? 4 : f > 2 / 3 ? 3 : f > 1 / 3 ? 2 : 1;
  };
  const values = Object.fromEntries(rowsData.map((r) => [r.muscle, step(r)]));

  // One open muscle at a time, kept when switching Bars / Map.
  let open = null;
  const detailText = (r) => t('workout.home.detail', { breakdown: breakdownText(parts[r.muscle], weights), previous: fmtNum(r.previous, 2) });

  const body = el('div', { class: 'wk-sets-body' });
  const paint = () => {
    if (view.sets === 'map') {
      const all = new Map(MUSCLES.map((m) => [m.id, rowOf(m)]));
      const map = bodyMap({
        view: 'both',
        title: t('workout.home.mapTitle', {
          list: joinList(rowsData.filter((r) => r.current > 0).map((r) => (targets[r.muscle]
            ? t('workout.home.mapItemTarget', { name: r.name, n: fmtNum(r.current, 2), target: fmtNum(targets[r.muscle], 1) })
            : `${r.name} ${fmtNum(r.current, 2)}`))) || t('workout.muscles.none'),
        }),
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
        p.setAttribute('aria-label', t('workout.home.muscleAria', { name: r.name, sets: setsN(r.current) }));
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
          el('li', el('span', { class: 'swatch is-4' }), hasTargets ? t('workout.home.legendAtTarget') : t('workout.home.legendMost')),
          el('li', el('span', { class: 'swatch is-3' }), t('workout.band.over', { value: '2/3' })),
          el('li', el('span', { class: 'swatch is-2' }), t('workout.band.over', { value: '1/3' })),
          el('li', el('span', { class: 'swatch is-1' }), t('workout.home.legendStarted')),
          el('li', el('span', { class: 'swatch' }), t('workout.band.none')))),
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
        : el('p', { class: 't-sub muted' }, t('workout.home.noSets')));
  };
  paint();

  const toggle = segmented({
    small: true, ariaLabel: t('workout.sets.showAs'), value: view.sets,
    options: [{ value: 'bars', label: t('workout.sets.bars') }, { value: 'map', label: t('workout.sets.map') }],
    onChange: (v) => { view.sets = v; paint(); },
  });
  return el('section', { class: 'section' },
    withSetsInfo(sectionHeader(t('workout.home.setsThisWeek'), { trail: toggle }), weights),
    el('div', { class: 'card wk-sets-card' },
      body,
      el('div', { class: 'wk-card-links' },
        el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/targets') }, hasTargets ? t('workout.home.editTargets') : t('workout.home.setTargets')),
        el('a', { class: 'btn btn-ghost btn-sm', href: href('settings/sets') }, t('workout.home.setWeighting')))));
}

function link(path, title, trail) {
  return el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    trail ? el('span', { class: 'li-trail muted' }, trail) : null,
    icon('chevron-right', { class: 'li-chevron' }));
}

/** '1 set', '6.5 sets' */
function setsN(n) {
  return t('workout.home.nSets', { count: n, n: fmtNum(n, 2) });
}

function routineSub(r, exMap) {
  const names = r.items.map((i) => exMap.get(i.exerciseId)).filter(Boolean).map(exLabel);
  if (!names.length) return t('workout.routine.noExercises');
  return joinList(names);
}

/** '07:03' for a live session, 'Mon 9 Nov · past workout' for a back-dated one. */
function resumeWhen(w) {
  const now = Date.now();
  if (w.plannedDurationMs || now - w.startedAt > LIVE_WINDOW_MS || now < w.startedAt) return t('workout.home.pastWhen', { date: shortDate(w.date) });
  return w.date === today() ? fmtTime(w.startedAt) : shortDate(w.date);
}

/** One muscle as a 44 px button (the caller wires expand / collapse of its detail line). */
function volumeRow(r, target, max, b, weights) {
  const tp = targetProgress(r.current, target);
  const chev = icon('chevron-down', { size: 16, class: 'wk-vol-chev' });
  if (!tp) {
    return el('button', {
      type: 'button', class: 'wk-vol-row',
      'aria-label': t('workout.home.rowAria', { name: r.name, sets: setsN(r.current), breakdown: breakdownAria(b, weights), previous: fmtNum(r.previous, 2) }),
    },
    el('span', { class: 'wk-vol-name' }, r.name),
    setsBar(b, r.current / max),
    el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2))),
    chev);
  }
  return el('button', {
    type: 'button', class: ['wk-vol-row', tp.reached && 'is-reached'],
    'aria-label': t('workout.home.rowAriaTarget', { name: r.name, n: fmtNum(r.current, 2), target: fmtNum(tp.target, 1), breakdown: breakdownAria(b, weights), pct: tp.pct, previous: fmtNum(r.previous, 2) }),
  },
  el('span', { class: 'wk-vol-name' }, r.name),
  setsBar(b, tp.fraction, { target: true }),
  el('span', { class: 'wk-vol-num', 'aria-hidden': 'true' }, el('b', fmtNum(r.current, 2)), ` / ${fmtNum(tp.target, 1)}`),
  chev);
}
