// Analysis hub: "how am I doing" in one screen, leading to every detailed view.
// Route: workout/analysis. Numbers come from core/workout-overview.js (records, routines,
// exercises, month, weekly sets) and core/workout-analytics.js analyseWorkout (last workout), so they
// equal the screens they link to. All workouts are read once and scanned once.
import * as db from '../db/db.js';
import {
  el, append, pageHeader, href, fmtNum, fmtDate, icon, sectionHeader, statTile, emptyState,
} from '../ui/index.js';
import { today } from '../core/dates.js';
import { isBaseline } from '../core/baseline.js';
import { isLoggedWorkout } from '../core/workout.js';
import { analyseWorkout, METRICS } from '../core/workout-analytics.js';
import { volumeWeights } from '../core/volume.js';
import { scanHistory, recentRecords, monthComparison, routineOverview, topExercises, weeklyMuscleSets } from '../core/workout-overview.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, findUnfinished, exName, shortDate } from './data.js';
import { loadTargets } from './targets.js';
import { workoutNav } from './subnav.js';
import { withSetsInfo } from './volume-ui.js';
import { fmtTonnage, tonnageParts, pctText } from './progress-ui.js';
import { trendOf } from '../core/workout-progress.js';

const WEEKS = 8;
const SET_WEEKS = 6;

// ---------------------------------------------------------------- formatting (as on the analysis screen)

/** '102.5 kg × 6 → 105 kg × 6' style: previous → new, for one record (per exercise: tonnage in kg). */
function changeText(r) {
  const p = r.prev; const c = r.cur;
  switch (r.metric) {
    case 'heaviest': return `${fmtNum(p.weight, 2)} kg × ${p.reps} → ${fmtNum(c.weight, 2)} kg × ${c.reps}`;
    case 'e1rm': return `${fmtNum(p.value, 1)} → ${fmtNum(c.value, 1)} kg`;
    case 'tonnageSet': case 'tonnage': return `${fmtTonnage(p.value, { kg: true })} → ${fmtTonnage(c.value, { kg: true })}`;
    default: return `${fmtNum(p.value, 0)} → ${fmtNum(c.value, 0)} reps`;
  }
}

/** '+2.5 kg', '+1 rep' */
function absText(r) {
  const d = r.delta;
  if (!d) return '';
  const unit = d.unit === 'reps' ? (Math.abs(d.abs) === 1 ? 'rep' : 'reps') : d.unit;
  const v = r.metric === 'tonnage' || r.metric === 'tonnageSet' ? fmtTonnage(Math.abs(d.abs), { kg: true }) : `${fmtNum(Math.abs(d.abs), r.metric === 'e1rm' ? 1 : 2)} ${unit}`;
  return `${d.abs >= 0 ? '+' : '−'}${v}`;
}

const summaryHref = (id) => href(`workout/summary/${encodeURIComponent(id)}`);
const dayRange = (r) => `${Number(r.from.slice(8, 10))}–${shortDate(r.to)}`;
/** Coloured % (with its sign); colour is never the only cue. */
const pctSpan = (p) => el('span', { class: ['wk-pct', `is-${trendOf(p)}`] }, p === null || p === undefined ? '–' : pctText(p));

// ---------------------------------------------------------------- mount

export async function mountAnalysisHub(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(),
  ]);
  const now = today();
  const name = (id) => exName(exMap, id);
  const open = findUnfinished(workouts);
  const last = workouts.find((w) => isLoggedWorkout(w) && !isBaseline(w)) || null;
  const scan = scanHistory(workouts);
  const weights = volumeWeights(rawWeights);

  container.classList.add('wk-an', 'wk-hub');
  append(container, pageHeader({ title: 'Workout' }), workoutNav('analysis'));

  if (open) {
    append(container, el('div', { class: 'card card-flush' }, el('a', { class: 'list-item', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, open.name),
        el('div', { class: 'li-sub' }, `Not finished · ${shortDate(open.date)}`)),
      el('span', { class: 'wk-go' }, 'Resume'))));
  }

  if (!last) {
    append(container, el('section', { class: 'section' },
      sectionHeader('Last workout'),
      emptyState('No finished workout yet.',
        el('a', { class: 'btn btn-primary', href: href('workout') }, open ? 'Go to Train' : 'Start a workout'))));
    append(container, linksSection(targets, true));
    return;
  }

  append(container, lastSection(last, analyseWorkout(workouts, last, exMap)));
  append(container, monthSection(monthComparison(scan.sessions, scan.byWorkout, now)));
  append(container, recordsSection(recentRecords(scan.records, 8), name));
  if (routines.length) append(container, routinesSection(routines, routineOverview(workouts, routines)));
  append(container, exercisesSection(topExercises(scan.histories, now, { weeks: WEEKS, limit: 6 }), name));
  append(container, setsSection(weeklyMuscleSets(workouts, exMap, weights, now, { weeks: SET_WEEKS, targets }), targets, weights));
  append(container, linksSection(targets));
}

// ---------------------------------------------------------------- sections

function lastSection(w, res) {
  const t = res.totals;
  const prev = res.routine.prev;
  const prs = res.records.filter((r) => r.status === 'pr').length;
  const ton = tonnageParts(t.load);
  return el('section', { class: 'section' },
    sectionHeader('Last workout', { trail: el('a', { class: 'wk-trail-a', href: summaryHref(w.id) }, `${w.name || 'Workout'} · ${fmtDate(w.date)}`) }),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile', title: prev ? `Tonnage versus the previous ${w.name} on ${fmtDate(prev.date)}: ${fmtTonnage(res.routine.prevTonnage)}` : null },
        el('span', { class: 'tile-label' }, 'Tonnage'),
        el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)),
        el('span', { class: 'tile-sub' }, prev ? [pctSpan(res.routine.pct), ` vs ${shortDate(prev.date)}`] : w.routineId ? 'first of routine' : 'no routine')),
      statTile({ label: 'Sets', value: String(t.sets), sub: t.dropsets ? `+ ${t.dropsets} drop` : null }),
      el('div', { class: ['tile', prs && 'is-rec'] },
        el('span', { class: 'tile-label' }, 'Records'),
        el('span', { class: 'tile-value' }, String(prs)),
        el('span', { class: 'tile-sub' }, 'all-time'))),
    t.dropLoad ? el('p', { class: 't-sub muted wk-pad-x' }, `+ ${fmtTonnage(t.dropLoad)} dropset tonnage`) : null,
    el('a', { class: 'btn btn-block', href: summaryHref(w.id) }, 'Full analysis'));
}

function monthSection(m) {
  const vs = (key, text) => [`last ${text}`, m.pct[key] === null ? null : [' · ', pctSpan(m.pct[key])]];
  const ton = tonnageParts(m.cur.tonnage);
  return el('section', { class: 'section' },
    sectionHeader(`This month · ${dayRange(m.curRange)}`, { info: 'records', trail: `vs ${dayRange(m.prevRange)}` }),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, 'Sessions'), el('span', { class: 'tile-value' }, String(m.cur.sessions)), el('span', { class: 'tile-sub' }, vs('sessions', String(m.prev.sessions)))),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, 'Tonnage'), el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)), el('span', { class: 'tile-sub' }, vs('tonnage', fmtTonnage(m.prev.tonnage)))),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, 'Records'), el('span', { class: 'tile-value' }, String(m.cur.records)), el('span', { class: 'tile-sub' }, vs('records', String(m.prev.records))))));
}

function recordsSection(groups, name) {
  const sec = el('section', { class: 'section' }, sectionHeader('Recent records', { info: 'records' }));
  if (!groups.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, 'No records yet.')));
    return sec;
  }
  append(sec, el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, groups.map((g) => {
    const more = g.others.map((r) => METRICS[r.metric].short);
    return el('a', { class: 'list-item wk-rec-row', href: summaryHref(g.workoutId) },
      icon('trophy', { class: 'li-lead' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name(g.exerciseId)),
        el('div', { class: 'li-sub' }, `${METRICS[g.lead.metric].label} ${changeText(g.lead)}`),
        more.length ? el('div', { class: 'li-sub' }, `also ${more.join(', ')}`) : null),
      el('div', { class: 'li-trail' },
        el('div', { class: 'wk-rec-abs' }, absText(g.lead)),
        el('div', { class: 't-sub muted' }, shortDate(g.date))));
  }))));
  return sec;
}

function routinesSection(routines, rows) {
  const byId = new Map(rows.map((r) => [r.routineId, r]));
  return el('section', { class: 'section' },
    sectionHeader('Routines', { info: 'tonnage', trail: 'tonnage' }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, routines.map((r) => {
      const o = byId.get(r.id);
      const sub = o.last ? `${o.sessions} session${o.sessions === 1 ? '' : 's'} · last ${shortDate(o.last.date)}` : 'Not done yet';
      return el('a', { class: 'list-item wk-spark-row', href: href(`workout/routines/${encodeURIComponent(r.id)}/progress`) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, r.name),
          el('div', { class: 'li-sub' }, sub)),
        o.history.length > 1 ? spark(o.history.map((h) => h.tonnage), `Session tonnage of the last ${o.history.length} sessions`) : null,
        o.last ? el('div', { class: 'li-trail' },
          el('div', null, fmtTonnage(o.last.tonnage)),
          el('div', { class: 't-sub' }, o.pct === null ? el('span', { class: 'muted' }, 'first') : pctSpan(o.pct))) : null);
    }))));
}

function exercisesSection(rows, name) {
  const sec = el('section', { class: 'section' }, sectionHeader(`Exercises · ${WEEKS} weeks`, { info: 'top-exercises', trail: 'est. 1RM' }));
  if (!rows.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, `No sets in the last ${WEEKS} weeks.`)));
    return sec;
  }
  append(sec, el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, rows.map((x) => {
    const reps = x.metric === 'bestReps';
    const val = x.value === null ? '–' : reps ? [fmtNum(x.value, 0), el('small', { class: 'wk-unit' }, ' reps')] : [fmtNum(x.value, 1), el('small', { class: 'wk-unit' }, ' kg')];
    return el('a', { class: 'list-item wk-spark-row', href: href(`workout/exercises/${encodeURIComponent(x.exerciseId)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name(x.exerciseId)),
        el('div', { class: 'li-sub' }, `${x.sessions} session${x.sessions === 1 ? '' : 's'}${reps ? ' · best set reps' : ''}`)),
      x.points.length > 1 ? spark(x.points.map((p) => p.value), `${reps ? 'Most reps in a set' : 'Est. 1RM'} per session, ${x.points.length} sessions`) : null,
      el('div', { class: 'li-trail' },
        el('div', null, val),
        el('div', { class: 't-sub' }, x.pct === null ? el('span', { class: 'muted' }, x.points.length > 1 ? '–' : 'one session') : pctSpan(x.pct))));
  }))));
  return sec;
}

function setsSection(data, targets, weights) {
  const sec = el('section', { class: 'section' }, withSetsInfo(sectionHeader(`Weekly sets · ${SET_WEEKS} weeks`), weights));
  if (!data.rows.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, `No sets in the last ${SET_WEEKS} weeks.`)));
    return sec;
  }
  const max = Math.max(1, ...data.rows.map((r) => r.max), ...data.rows.map((r) => targets[r.muscle] || 0));
  const first = data.weeks[0];
  append(sec, el('div', { class: 'card wk-hub-sets' },
    el('ul', { class: 'legend legend-row wk-sets-legend' },
      el('li', el('span', { class: 'swatch is-accent' }), 'Direct'),
      el('li', el('span', { class: 'swatch is-partial' }), 'Partial'),
      el('li', el('span', { class: 'wk-dash-swatch' }), 'Target')),
    el('div', { class: 'wk-hub-set wk-hub-set-head t-cap', 'aria-hidden': 'true' },
      el('span'), el('span', { class: 'wk-hub-weeks' }, el('span', shortDate(first.from)), el('span', 'This week')),
      el('span', { class: 'wk-hub-setnum' }, 'Now')),
    data.rows.map((r) => {
      const t = targets[r.muscle];
      const cur = r.values[r.values.length - 1];
      return el('div', {
        class: 'wk-hub-set', role: 'img',
        'aria-label': `${r.name}: ${r.values.map((v, i) => `week of ${shortDate(data.weeks[i].from)} ${fmtNum(v.total, 2)}`).join(', ')} sets${t ? `; target ${fmtNum(t, 1)}` : ''}`,
      },
      el('span', { class: 'wk-hub-mname' }, r.name),
      el('span', { class: 'wk-hub-weeks', 'aria-hidden': 'true' },
        r.values.map((v, i) => el('span', { class: ['wk-hub-wk', i === r.values.length - 1 && 'is-cur'] },
          t ? el('span', { class: 'wk-hub-tgt', style: { bottom: `${Math.min(100, (t / max) * 100).toFixed(1)}%` } }) : null,
          v.total > 0 ? el('span', { class: 'wk-hub-stack', style: { height: `${Math.max(4, (v.total / max) * 100).toFixed(1)}%` } },
            v.drop > 0 ? el('span', { class: 'wk-hub-seg is-partial', style: { flexGrow: String(v.drop) } }) : null,
            v.partial > 0 ? el('span', { class: 'wk-hub-seg is-partial', style: { flexGrow: String(v.partial) } }) : null,
            v.direct > 0 ? el('span', { class: 'wk-hub-seg is-direct', style: { flexGrow: String(v.direct) } }) : null) : null))),
      el('span', { class: 'wk-hub-setnum', 'aria-hidden': 'true' }, el('b', fmtNum(cur.total, 2)), t ? ` / ${fmtNum(t, 1)}` : null));
    })));
  return sec;
}

function linksSection(targets, withStart = false) {
  const n = Object.keys(targets).length;
  const row = (path, title, trail) => el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title)),
    trail ? el('span', { class: 'li-trail muted' }, trail) : null,
    icon('chevron-right', { class: 'li-chevron' }));
  return el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
    withStart ? row('workout/starting-point', 'Starting point') : null,
    row('workout/targets', 'Weekly set targets', n ? String(n) : 'Off'),
    row('workout/recovery', 'Muscle recovery'),
    row('workout/exercises', 'All exercises'),
    row('workout/history', 'All workouts')));
}

// ---------------------------------------------------------------- sparkline

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  append(n, ...children);
  return n;
}

/** Tiny line of values (oldest left), last point as a dot. */
function spark(values, label) {
  const W = 84; const H = 28; const P = 3;
  let lo = Math.min(...values); let hi = Math.max(...values);
  if (hi === lo) { lo -= 1; hi += 1; }
  const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const i = values.length - 1;
  return svg('svg', { class: 'wk-spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label },
    svg('polyline', { class: 'wk-spark-line', points: pts }),
    svg('circle', { class: 'wk-spark-dot', cx: x(i).toFixed(1), cy: y(values[i]).toFixed(1), r: 2.5 }));
}
