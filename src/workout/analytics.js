// Post-workout analytics: records beaten, per-exercise bests (workout · month · all time) with a
// trend, muscle tonnage, routine and month context. Route: workout/summary/:id
// Numbers come from core/workout-analytics.js; everything is "as of" the workout's own date.
import * as db from '../db/db.js';
import { el, append, pageHeader, href, emptyState, fmtDate, fmtTime, fmtNum, navigate, icon, sectionHeader, statTile, tag } from '../ui/index.js';
import { analyseWorkout, METRICS } from '../core/workout-analytics.js';
import { trendOf } from '../core/workout-progress.js';
import { fmtTonnage, tonnageParts, pctText } from './progress-ui.js';
import { formatSets } from '../core/workout.js';
import { ensureCss, loadExercises, loadWorkouts, exName, shortDate } from './data.js';
import { trendChart, hBars, vBars } from './analytics-charts.js';
import { isBaseline } from '../core/baseline.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- formatting

const kg = (n, d = 2) => `${fmtNum(n, d)} kg`;

/** Tonnage with its unit, shared rule: '2 340 kg', '12.48 t'. */
const tKg = (n) => fmtTonnage(n);
/** Single-set and per-exercise tonnage: always kg ('12 480 kg'). */
const exKg = (n) => fmtTonnage(n, { kg: true });

/** A best value with its unit, for prose: '102.5 kg × 6', '615 kg (102.5 × 6)', '128.3 kg', '12 reps'. */
function valueText(metric, b) {
  if (!b) return '–';
  switch (metric) {
    case 'heaviest': return `${kg(b.weight)} × ${b.reps}`;
    case 'tonnageSet': return `${fmtNum(b.weight, 2)} × ${b.reps} = ${exKg(b.value)}`;
    case 'e1rm': return kg(b.value, 1);
    case 'tonnage': return exKg(b.value);
    default: return `${fmtNum(b.value, 0)} reps`;
  }
}

/** Compact table cell value (unit in the row label): '102.5 × 6', '615', '128.3', '12'. */
function cellText(metric, b) {
  if (!b) return '–';
  switch (metric) {
    case 'heaviest': return `${fmtNum(b.weight, 2)} × ${b.reps}`;
    case 'tonnageSet': case 'tonnage': return exKg(b.value);
    case 'e1rm': return fmtNum(b.value, 1);
    default: return fmtNum(b.value, 0);
  }
}

const ROW_UNIT = { heaviest: 'kg × reps', tonnageSet: '', e1rm: 'kg', tonnage: '', bwReps: 'reps', bwTotal: 'reps' };

/** '+2.5 kg', '−1 rep', '±0 kg'. e1rm is shown with 1 decimal, so its change is too. */
function absText(d, metric) {
  if (!d) return '';
  const unit = d.unit === 'reps' ? (Math.abs(d.abs) === 1 ? 'rep' : 'reps') : d.unit;
  if (d.abs === 0) return `±0 ${unit}`;
  return `${d.abs > 0 ? '+' : '−'}${metric === 'tonnage' || metric === 'tonnageSet' ? exKg(Math.abs(d.abs)) : `${fmtNum(Math.abs(d.abs), metric === 'e1rm' ? 1 : 2)} ${unit}`}`;
}

/** Coloured % with its sign; colour is never the only cue. */
const pctSpan = (p) => el('span', { class: ['wk-pct', `is-${trendOf(p)}`] }, p === null || p === undefined ? '–' : pctText(p));

/** When a best was set: '12 Nov', or 'starting point, 12 Nov' for the starting point. */
const when = (b) => (b.baseline ? `starting point, ${shortDate(b.date)}` : shortDate(b.date));

// ---------------------------------------------------------------- mount

export async function mountAnalytics(container, { id }) {
  ensureCss();
  const [w, exMap, workouts] = await Promise.all([db.get('workouts', id), loadExercises(), loadWorkouts()]);
  if (!w) {
    append(container, pageHeader({ title: 'Analysis', back: 'workout/history' }),
      emptyState('Workout not found.',
        el('a', { class: 'btn', href: href('workout/history') }, 'Open history')));
    return;
  }
  if (isBaseline(w)) { navigate('workout/starting-point', { replace: true }); return; }
  const res = analyseWorkout(workouts, w, exMap);
  const name = (exId) => exName(exMap, exId);

  container.classList.add('wk-an');
  append(container, pageHeader({
    title: w.name || 'Workout',
    subtitle: `Analysis · ${fmtDate(w.date)}${Number.isFinite(w.startedAt) ? ` · ${fmtTime(w.startedAt)}` : ''}${w.finishedAt ? '' : ' · in progress'}`,
    back: `workout/history/${encodeURIComponent(w.id)}`,
  }));

  append(container, headerStrip(w, res));

  if (!res.exercises.length) {
    append(container, emptyState('No done sets yet.'));
    return;
  }

  append(container, recordsSection(res, name));
  append(container, el('section', { class: 'section' },
    sectionHeader('Exercises', { info: 'records' }),
    res.exercises.map((r) => exerciseBlock(r, w, res, name))));
  append(container, wholeWorkout(w, res));
  append(container, monthSection(w, res, name));
}

// ---------------------------------------------------------------- header

function headerStrip(w, res) {
  const t = res.totals;
  const prev = res.routine.prev;
  const pct = res.routine.pct;
  const ton = tonnageParts(t.load);
  return el('div', { class: 'stack' },
    el('div', { class: 'tiles' },
      statTile({ label: 'Duration', value: t.durationMs === null ? '–' : String(Math.round(t.durationMs / 60000)), unit: t.durationMs === null ? null : 'min', sub: w.finishedAt ? null : 'in progress' }),
      el('div', { class: 'tile', title: prev ? `Tonnage versus the previous ${w.name} on ${fmtDate(prev.date)}: ${tKg(res.routine.prevTonnage)}` : null },
        el('span', { class: 'tile-label' }, 'Tonnage'),
        el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)),
        el('span', { class: 'tile-sub' }, prev ? [pct === null ? '–' : pctSpan(pct), ` vs ${shortDate(prev.date)}`] : w.routineId ? 'first of routine' : 'no routine')),
      statTile({ label: 'Sets', value: String(t.sets), sub: t.dropsets ? `+ ${t.dropsets} drop` : null })),
    t.dropLoad ? el('p', { class: 't-sub muted wk-pad-x' }, `+ ${tKg(t.dropLoad)} dropset tonnage`) : null);
}

// ---------------------------------------------------------------- records

const GROUPS = [['pr', 'All-time records'], ['month', 'Monthly bests'], ['matched', 'Matched your best']];

function recordsSection(res, name) {
  const sec = el('section', { class: 'section' }, sectionHeader('Records', { info: 'records' }));
  const beaten = res.records.filter((r) => r.status !== 'matched');
  if (!beaten.length) {
    const m = res.closestMiss;
    const allFirst = res.exercises.every((x) => x.firstTime);
    append(sec, el('div', { class: 'card stack' },
      el('p', null, allFirst ? 'No records: every exercise is new.' : 'No records this workout.'),
      m ? el('p', { class: 't-sub muted' },
        `Closest: ${name(m.exerciseId)} · ${METRICS[m.metric].short} ${absText({ ...m.delta, abs: -m.delta.abs }, m.metric).replace(/^\+/, '')} under your best (${valueText(m.metric, m.best)}, ${when(m.best)})`)
        : null));
  }
  for (const [status, title] of GROUPS) {
    const list = res.records.filter((r) => r.status === status);
    if (!list.length) continue;
    append(sec, el('div', { class: 'wk-an-group' },
      el('div', { class: ['t-cap', 'wk-an-group-head', status === 'pr' && 'is-rec'] }, status === 'matched' ? title : `${title} · ${list.length}`),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        status === 'matched' ? matchedRows(list, name) : [...byExercise(list)].map(([exId, rs]) => el('div', { class: 'list-item wk-an-rx' },
          status === 'pr' ? icon('trophy', { class: 'li-lead' }) : icon('star', { class: 'li-lead' }),
          el('div', { class: 'li-main' },
            el('div', { class: 'li-title' }, name(exId)),
            rs.map(recordRow))))))));
  }
  return sec;
}

/** Matched bests, one line per exercise: 'heaviest set, est. 1RM · best from 19 Oct'. */
function matchedRows(list, name) {
  return [...byExercise(list)].map(([exId, rs]) => el('div', { class: 'list-item wk-an-rx is-matched' },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, name(exId)),
      el('div', { class: 'li-sub wk-wrap' },
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
      el('div', { class: 't-sub muted' }, METRICS[r.metric].label),
      el('div', { class: 'wk-an-rec-sub' }, `${valueText(r.metric, ref)} (${when(ref)}) → ${valueText(r.metric, r.cur)}`)),
    el('div', { class: 'wk-an-rec-delta' },
      el('div', { class: 'wk-an-rec-abs' }, absText(r.delta, r.metric)),
      r.delta && r.delta.pct !== null && r.delta.abs !== 0 ? el('div', { class: 't-sub muted' }, pctText(r.delta.pct)) : null));
}

// ---------------------------------------------------------------- per exercise

function exerciseBlock(r, w, res, name) {
  const keys = r.mode === 'reps' ? ['bwReps', 'bwTotal'] : ['heaviest', 'tonnageSet', 'e1rm', 'tonnage'];
  const status = Object.fromEntries(r.statuses.map((s) => [s.metric, s.status]));
  const recs = r.statuses.filter((s) => s.status === 'pr').length;
  const monthName = MONTHS[Number(res.month.slice(5, 7)) - 1];
  const holder = (b) => (!b ? '' : b.workoutId === w.id ? 'this workout' : b.baseline ? 'starting point' : shortDate(b.date));

  const table = el('table', { class: 'wk-an-table' },
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
    r.dropsets ? `${r.dropsets} dropset${r.dropsets === 1 ? '' : 's'} (${exKg(r.dropTonnage)}) not counted` : null,
    r.undone ? `${r.undone} not done` : null,
  ].filter(Boolean).join(' · ');

  const tagText = r.firstTime ? 'first time' : recs ? `${recs} record${recs === 1 ? '' : 's'}`
    : r.sessions === 1 && r.startingPoint ? 'vs starting point' : `${r.sessions} session${r.sessions === 1 ? '' : 's'}`;
  return el('article', { class: 'card wk-an-ex' },
    el('a', { class: 'wk-an-ex-head', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`) },
      el('h3', { class: 'wk-an-ex-name' }, name(r.exerciseId)),
      recs ? tag(tagText, { tone: 'accent', icon: 'trophy' }) : el('span', { class: 't-sub muted' }, tagText),
      icon('chevron-right', { class: 'li-chevron' })),
    el('p', { class: 't-sub wk-an-sets' }, el('span', { class: 'muted' }, 'kg × reps  '), formatSets(r.sets) || '–'),
    notes ? el('p', { class: 't-sub muted' }, notes) : null,
    el('div', { class: 'wk-an-scroll' }, table),
    trendBlock(r, status));
}

function trendBlock(r, status) {
  const t = r.trend;
  const reps = t.metric === 'bwReps';
  const label = reps ? 'Most reps in a set, per session' : 'Best est. 1RM per session, kg';
  if (t.points.length < 2) {
    return el('p', { class: 't-sub muted' }, `${label}: no trend yet (first session).`);
  }
  const format = reps ? (v) => `${fmtNum(v, 0)} reps` : (v) => kg(v, 1);
  const cur = t.points[t.points.length - 1];
  return el('figure', { class: 'wk-an-fig' },
    el('figcaption', { class: 't-cap muted' }, `${label} · last ${t.points.length}`),
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
  const out = [];
  out.push(el('section', { class: 'section' },
    sectionHeader('Tonnage by muscle', { info: 'tonnage' }),
    res.muscles.length
      ? el('div', { class: 'card' }, hBars(res.muscles.map((m) => ({ label: m.name, value: m.tonnage, text: tKg(m.tonnage) }))))
      : el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, 'No sets with weight.'))));
  const h = res.routine.history;
  out.push(el('section', { class: 'section' },
    sectionHeader(h.length > 1 ? `Session tonnage · last ${h.length}` : 'Session tonnage', { info: 'tonnage' }),
    el('div', { class: 'card' }, h.length > 1
      ? vBars(h.map((s) => ({ date: s.date, value: s.tonnage, text: tKg(s.tonnage), current: s.current })),
        `Session tonnage of the last ${h.length} ${w.name} sessions, ${h.map((s) => `${fmtDate(s.date)} ${tKg(s.tonnage)}`).join(', ')}`)
      : el('p', { class: 't-sub muted' }, w.routineId ? 'First session of this routine.' : 'Not from a routine.'))));
  return out;
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
  const ton = tonnageParts(m.tonnage);
  return el('section', { class: 'section' },
    sectionHeader(`${monthName} · up to ${shortDate(w.date)}`, { info: 'records' }),
    el('div', { class: 'tiles' },
      statTile({ label: 'Sessions', value: String(m.sessions) }),
      statTile({ label: 'Tonnage', value: ton.value, unit: ton.unit }),
      statTile({ label: 'Records', value: String(m.records), sub: 'all-time' })),
    el('div', { class: 'card wk-an-scroll' }, el('table', { class: 'wk-an-table wk-an-mtable' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Exercise'),
        el('th', { scope: 'col' }, 'Heaviest set', el('span', { class: 'wk-an-unit' }, 'kg × reps')),
        el('th', { scope: 'col' }, 'Tonnage set'))),
      el('tbody', {}, monthOrder(m.exercises, res).map((x) => el('tr', {},
        el('th', { scope: 'row' }, name(x.exerciseId)),
        x.heaviest
          ? el('td', {}, cellText('heaviest', x.heaviest), el('span', { class: 'wk-an-when' }, holder(x.heaviest)))
          : x.bwReps
            ? el('td', {}, `BW × ${x.bwReps.reps}`, el('span', { class: 'wk-an-when' }, holder(x.bwReps)))
            : el('td', {}, '–'),
        x.tonnageSet
          ? el('td', {}, exKg(x.tonnageSet.value), el('span', { class: 'wk-an-when' }, `${fmtNum(x.tonnageSet.weight, 2)} × ${x.tonnageSet.reps} · ${holder(x.tonnageSet)}`))
          : el('td', {}, '–')))))));
}
