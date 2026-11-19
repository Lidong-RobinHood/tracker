// Post-workout analytics: records beaten, per-exercise bests (workout · month · all time) with a
// trend, muscle tonnage, routine and month context. Route: workout/summary/:id
// Numbers come from core/workout-analytics.js; everything is "as of" the workout's own date.
import * as db from '../db/db.js';
import { el, pageHeader, href, emptyState, fmtDate, fmtTime, fmtNum, navigate } from '../ui/index.js';
import { analyseWorkout, METRICS } from '../core/workout-analytics.js';
import { formatPct } from '../core/workout-progress.js';
import { formatSets } from '../core/workout.js';
import { ensureCss, loadExercises, loadWorkouts, exName, shortDate } from './data.js';
import { trendChart, hBars, vBars } from './analytics-charts.js';
import { isBaseline } from '../core/baseline.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- formatting

const kg = (n, d = 2) => `${fmtNum(n, d)} kg`;

/** Tonnage number: thousands grouped with a narrow space, up to 1 decimal ('1 912.5'). */
function tNum(n) {
  if (!Number.isFinite(n)) return '–';
  const [i, f] = fmtNum(n, 1).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + (f ? `.${f}` : '');
}
const tKg = (n) => `${tNum(n)} kg`;

/** A best value with its unit, for prose: '102.5 kg × 6', '615 kg (102.5 × 6)', '128.3 kg', '12 reps'. */
function valueText(metric, b) {
  if (!b) return '–';
  switch (metric) {
    case 'heaviest': return `${kg(b.weight)} × ${b.reps}`;
    case 'tonnageSet': return `${fmtNum(b.weight, 2)} × ${b.reps} = ${tKg(b.value)}`;
    case 'e1rm': return kg(b.value, 1);
    case 'tonnage': return tKg(b.value);
    default: return `${fmtNum(b.value, 0)} reps`;
  }
}

/** Compact table cell value (unit in the row label): '102.5 × 6', '615', '128.3', '12'. */
function cellText(metric, b) {
  if (!b) return '–';
  switch (metric) {
    case 'heaviest': return `${fmtNum(b.weight, 2)} × ${b.reps}`;
    case 'tonnageSet': case 'tonnage': return tNum(b.value);
    case 'e1rm': return fmtNum(b.value, 1);
    default: return fmtNum(b.value, 0);
  }
}

const ROW_UNIT = { heaviest: 'kg × reps', tonnageSet: 'kg', e1rm: 'kg', tonnage: 'kg', bwReps: 'reps', bwTotal: 'reps' };

/** '+2.5 kg', '−1 rep', '±0 kg'. e1rm is shown with 1 decimal, so its change is too. */
function absText(d, metric) {
  if (!d) return '';
  const unit = d.unit === 'reps' ? (Math.abs(d.abs) === 1 ? 'rep' : 'reps') : d.unit;
  if (d.abs === 0) return `±0 ${unit}`;
  return `${d.abs > 0 ? '+' : '−'}${metric === 'tonnage' || metric === 'tonnageSet' ? tNum(Math.abs(d.abs)) : fmtNum(Math.abs(d.abs), metric === 'e1rm' ? 1 : 2)} ${unit}`;
}

const pctText = (p) => formatPct(p).replace(' ', ' ');

/** When a best was set: '12 Nov', or 'starting point, 12 Nov' for the starting point. */
const when = (b) => (b.baseline ? `starting point, ${shortDate(b.date)}` : shortDate(b.date));

// ---------------------------------------------------------------- mount

export async function mountAnalytics(container, { id }) {
  ensureCss();
  const [w, exMap, workouts] = await Promise.all([db.get('workouts', id), loadExercises(), loadWorkouts()]);
  if (!w) {
    container.append(pageHeader({ title: 'Analysis', back: 'workout/history' }),
      emptyState('Workout not found. It may have been deleted.',
        el('a', { class: 'btn', href: href('workout/history') }, 'Open history')));
    return;
  }
  if (isBaseline(w)) { navigate('workout/starting-point', { replace: true }); return; }
  const res = analyseWorkout(workouts, w, exMap);
  const name = (exId) => exName(exMap, exId);

  container.classList.add('wk-an');
  container.append(pageHeader({
    title: w.name || 'Workout',
    subtitle: `Analysis · ${fmtDate(w.date)}${Number.isFinite(w.startedAt) ? ` · ${fmtTime(w.startedAt)}` : ''}${w.finishedAt ? '' : ' · in progress'}`,
    back: `workout/history/${encodeURIComponent(w.id)}`,
  }));

  container.append(headerStrip(w, res));

  if (!res.exercises.length) {
    container.append(el('p', { class: 'wk-an-note' }, 'No done sets in this workout, so there is nothing to analyse yet.'));
    return;
  }

  container.append(recordsSection(res, name));
  container.append(el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Exercises'),
    el('p', { class: 'wk-an-note' }, 'Done normal sets only; dropsets and sets not ticked are left out of every best and record. Month = ', MONTHS[Number(res.month.slice(5, 7)) - 1], ' up to this workout. All time = up to and including this workout.'),
    res.exercises.map((r) => exerciseBlock(r, w, res, name))));
  container.append(wholeWorkout(w, res));
  container.append(monthSection(w, res, name));
}

// ---------------------------------------------------------------- header

function headerStrip(w, res) {
  const t = res.totals;
  const dur = t.durationMs === null ? '–' : `${Math.round(t.durationMs / 60000)} min`;
  const prev = res.routine.prev;
  const pct = res.routine.pct;
  return el('div', { class: 'wk-an-strip' },
    stat('Duration', dur, w.finishedAt ? null : 'in progress'),
    stat('Sets done', String(t.sets), t.dropsets ? `+ ${t.dropsets} drop` : null),
    stat('Tonnage', tKg(t.load), t.dropLoad ? `+ ${tKg(t.dropLoad)} drop` : null),
    prev
      ? stat(`vs ${shortDate(prev.date)}`, pct === null ? '–' : pctText(pct), tKg(res.routine.prevTonnage), `Tonnage versus the previous ${w.name} on ${fmtDate(prev.date)}`)
      : stat('vs last time', '–', w.routineId ? 'first of routine' : 'no routine'));
}

function stat(label, value, sub, title) {
  return el('div', { class: 'wk-an-stat', title: title || null },
    el('div', { class: 'wk-an-stat-label' }, label),
    el('div', { class: 'wk-an-stat-value num' }, value),
    sub ? el('div', { class: 'wk-an-stat-sub num' }, sub) : null);
}

// ---------------------------------------------------------------- records

const GROUPS = [['pr', 'All-time records'], ['month', 'Monthly bests'], ['matched', 'Matched your best']];

function recordsSection(res, name) {
  const sec = el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Records'));
  const beaten = res.records.filter((r) => r.status !== 'matched');
  if (!beaten.length) {
    const m = res.closestMiss;
    const allFirst = res.exercises.every((x) => x.firstTime);
    sec.append(el('div', { class: 'wk-an-rules' },
      el('p', { class: 'wk-an-line' }, allFirst ? 'No records: first session of every exercise in this workout.' : 'No records this workout.'),
      m ? el('p', { class: 'wk-an-line muted num' },
        `Closest: ${name(m.exerciseId)} · ${METRICS[m.metric].short} ${absText({ ...m.delta, abs: -m.delta.abs }, m.metric).replace(/^\+/, '')} under your best (${valueText(m.metric, m.best)}, ${when(m.best)})`)
        : null));
  }
  for (const [status, title] of GROUPS) {
    const list = res.records.filter((r) => r.status === status);
    if (!list.length) continue;
    sec.append(el('div', { class: 'wk-an-group' },
      el('div', { class: ['wk-an-group-head', status === 'pr' && 'is-rec'] }, status === 'matched' ? title : `${title} · ${list.length}`),
      status === 'matched' ? matchedRows(list, name) : [...byExercise(list)].map(([exId, rs]) => el('div', { class: 'wk-an-rx' },
        el('div', { class: 'wk-an-rec-title' }, name(exId)),
        rs.map(recordRow)))));
  }
  return sec;
}

/** Matched bests, one line per exercise: 'heaviest set, est. 1RM · best from 19 Oct'. */
function matchedRows(list, name) {
  return [...byExercise(list)].map(([exId, rs]) => el('div', { class: 'wk-an-rx is-matched' },
    el('div', { class: 'wk-an-rec-main' },
      el('div', { class: 'wk-an-rec-title' }, name(exId)),
      el('div', { class: 'wk-an-rec-sub num' },
        `${rs.map((r) => `${METRICS[r.metric].short} ${valueText(r.metric, r.cur)}`).join(', ')} · same as ${[...new Set(rs.map((r) => when(r.prevAll)))].join(', ')}`))));
}

/** Records grouped by exercise, in first-seen order. */
function byExercise(list) {
  const by = new Map();
  for (const r of list) {
    if (!by.has(r.exerciseId)) by.set(r.exerciseId, []);
    by.get(r.exerciseId).push(r);
  }
  return by;
}

function recordRow(r) {
  const ref = r.status === 'month' ? r.prevMonth : r.prevAll;
  return el('div', { class: ['wk-an-rec', `is-${r.status}`] },
    el('div', { class: 'wk-an-rec-main' },
      el('div', { class: 'wk-an-rec-metric' }, METRICS[r.metric].label),
      el('div', { class: 'wk-an-rec-sub num' }, `${valueText(r.metric, ref)} (${when(ref)}) → ${valueText(r.metric, r.cur)}`)),
    el('div', { class: 'wk-an-rec-delta num' },
      el('div', { class: 'wk-an-rec-abs' }, absText(r.delta, r.metric)),
      r.delta && r.delta.pct !== null && r.delta.abs !== 0 ? el('div', { class: 'wk-an-rec-pct' }, pctText(r.delta.pct)) : null));
}

// ---------------------------------------------------------------- per exercise

function exerciseBlock(r, w, res, name) {
  const keys = r.mode === 'reps' ? ['bwReps', 'bwTotal'] : ['heaviest', 'tonnageSet', 'e1rm', 'tonnage'];
  const status = Object.fromEntries(r.statuses.map((s) => [s.metric, s.status]));
  const recs = r.statuses.filter((s) => s.status === 'pr').length;
  const monthName = MONTHS[Number(res.month.slice(5, 7)) - 1];
  const holder = (b) => (!b ? '' : b.workoutId === w.id ? 'this workout' : b.baseline ? 'starting point' : shortDate(b.date));

  const table = el('table', { class: 'wk-an-table num' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'wk-an-sr' }, 'Metric')),
      el('th', { scope: 'col' }, 'Workout'),
      el('th', { scope: 'col' }, monthName),
      el('th', { scope: 'col' }, 'All time'))),
    el('tbody', {}, keys.map((k) => {
      const cur = r.scopes.workout[k];
      const mon = r.scopes.month[k];
      const all = r.scopes.all[k];
      const st = status[k];
      const monRec = mon && mon.workoutId === w.id && (st === 'pr' || st === 'month');
      const allRec = all && all.workoutId === w.id && st === 'pr';
      return el('tr', {},
        el('th', { scope: 'row' }, METRICS[k].label, el('span', { class: 'wk-an-unit' }, ROW_UNIT[k])),
        el('td', {}, cellText(k, cur)),
        el('td', { class: monRec ? 'is-rec' : null }, cellText(k, mon), el('span', { class: 'wk-an-when' }, holder(mon))),
        el('td', { class: allRec ? 'is-rec' : null }, cellText(k, all), el('span', { class: 'wk-an-when' }, holder(all))));
    })));

  const notes = [
    r.dropsets ? `${r.dropsets} dropset${r.dropsets === 1 ? '' : 's'} (${tKg(r.dropTonnage)}) not counted` : null,
    r.undone ? `${r.undone} set${r.undone === 1 ? '' : 's'} not ticked` : null,
  ].filter(Boolean).join(' · ');

  return el('article', { class: 'wk-an-ex' },
    el('a', { class: 'wk-an-ex-head', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`) },
      el('h3', { class: 'wk-an-ex-name' }, name(r.exerciseId)),
      el('span', { class: ['wk-an-ex-tag', recs && 'is-rec'] },
        r.firstTime ? 'first time' : recs ? `${recs} record${recs === 1 ? '' : 's'}`
          : r.sessions === 1 && r.startingPoint ? 'vs starting point' : `${r.sessions} session${r.sessions === 1 ? '' : 's'}`),
      el('span', { class: 'wk-an-chev', 'aria-hidden': 'true' }, '›')),
    el('p', { class: 'wk-an-sets num' }, el('span', { class: 'muted' }, 'Sets, kg × reps  '), formatSets(r.sets) || '–'),
    notes ? el('p', { class: 'wk-an-note' }, notes) : null,
    el('div', { class: 'wk-an-scroll' }, table),
    trendBlock(r, status));
}

function trendBlock(r, status) {
  const t = r.trend;
  const reps = t.metric === 'bwReps';
  const label = reps ? 'Most reps in a set, per session' : 'Best est. 1RM per session, kg';
  if (t.points.length < 2) {
    return el('p', { class: 'wk-an-note' }, `${label}: no trend yet (first session).`);
  }
  const format = reps ? (v) => `${fmtNum(v, 0)} reps` : (v) => kg(v, 1);
  const cur = t.points[t.points.length - 1];
  return el('figure', { class: 'wk-an-fig' },
    el('figcaption', { class: 'wk-an-cap' }, `${label} · last ${t.points.length}`),
    trendChart({
      points: t.points,
      best: t.best ? t.best.value : null,
      format,
      record: status[t.metric] === 'pr',
      ariaLabel: `${label} over ${t.points.length} sessions. This workout ${format(cur.value)}; all-time best ${t.best ? format(t.best.value) : 'none'}.`,
    }));
}

// ---------------------------------------------------------------- whole workout

function wholeWorkout(w, res) {
  const sec = el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Whole workout'));
  if (res.muscles.length) {
    sec.append(el('figure', { class: 'wk-an-fig' },
      el('figcaption', { class: 'wk-an-cap' }, 'Tonnage by muscle, kg'),
      hBars(res.muscles.map((m) => ({ label: m.name, value: m.tonnage, text: tKg(m.tonnage) }))),
      el('p', { class: 'wk-an-note' }, 'Each exercise’s tonnage goes to its primary muscles only, split equally when it has several. Secondary muscles, dropsets and bodyweight sets add nothing.')));
  } else {
    sec.append(el('p', { class: 'wk-an-note' }, 'No weighted sets, so no tonnage by muscle.'));
  }
  const h = res.routine.history;
  if (h.length > 1) {
    sec.append(el('figure', { class: 'wk-an-fig' },
      el('figcaption', { class: 'wk-an-cap' }, `Session tonnage, t (1 t = 1000 kg) · last ${h.length} × ${w.name}`),
      vBars(h.map((s) => ({ date: s.date, value: s.tonnage, text: (s.tonnage / 1000).toFixed(1), current: s.current })),
        `Session tonnage of the last ${h.length} ${w.name} sessions, ${h.map((s) => `${fmtDate(s.date)} ${tKg(s.tonnage)}`).join(', ')}`)));
  } else {
    sec.append(el('p', { class: 'wk-an-note' }, w.routineId ? 'First session of this routine: no session comparison yet.' : 'Not started from a routine: no session comparison.'));
  }
  return sec;
}

// ---------------------------------------------------------------- month

/** This workout's exercises first (in workout order), then the month's others in first-seen order. */
function monthOrder(list, res) {
  const here = res.exercises.map((r) => r.exerciseId);
  const rank = (x) => (here.includes(x.exerciseId) ? here.indexOf(x.exerciseId) : here.length);
  return list.map((x, i) => ({ x, i })).sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i).map((o) => o.x);
}

function monthSection(w, res, name) {
  const m = res.monthView;
  const monthName = `${MONTHS[Number(m.month.slice(5, 7)) - 1]} ${m.month.slice(0, 4)}`;
  const holder = (b) => (!b ? '' : b.workoutId === w.id ? 'this workout' : b.baseline ? 'starting point' : shortDate(b.date));
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, `${monthName} · up to ${shortDate(w.date)}`),
    el('div', { class: 'wk-an-strip is-3' },
      stat('Sessions', String(m.sessions)),
      stat('Tonnage', tKg(m.tonnage)),
      stat('All-time records', String(m.records))),
    el('div', { class: 'wk-an-scroll' }, el('table', { class: 'wk-an-table wk-an-mtable num' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Exercise'),
        el('th', { scope: 'col' }, 'Heaviest set', el('span', { class: 'wk-an-unit' }, 'kg × reps')),
        el('th', { scope: 'col' }, 'Tonnage set', el('span', { class: 'wk-an-unit' }, 'kg')))),
      el('tbody', {}, monthOrder(m.exercises, res).map((x) => el('tr', {},
        el('th', { scope: 'row' }, name(x.exerciseId)),
        x.heaviest
          ? el('td', {}, cellText('heaviest', x.heaviest), el('span', { class: 'wk-an-when' }, holder(x.heaviest)))
          : x.bwReps
            ? el('td', {}, `BW × ${x.bwReps.reps}`, el('span', { class: 'wk-an-when' }, holder(x.bwReps)))
            : el('td', {}, '–'),
        x.tonnageSet
          ? el('td', {}, tNum(x.tonnageSet.value), el('span', { class: 'wk-an-when' }, `${fmtNum(x.tonnageSet.weight, 2)} × ${x.tonnageSet.reps} · ${holder(x.tonnageSet)}`))
          : el('td', {}, '–')))))),
    el('p', { class: 'wk-an-note' }, 'All-time records = metrics (heaviest set, tonnage set, est. 1RM, session tonnage; reps for bodyweight) that beat every earlier session, counted per exercise. BW = bodyweight.'));
}
