// Post-workout analytics: records beaten, per-exercise bests (workout · month · all time) with a
// trend, muscle tonnage, routine and month context. Route: workout/summary/:id
// Numbers come from core/workout-analytics.js; everything is "as of" the workout's own date.
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, href, emptyState, fmtDate, fmtTime, fmtNum, navigate, icon, sectionHeader, statTile, tag,
  segmented, infoButton, setBodyMapValues,
} from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { volumeWeights } from '../core/volume.js';
import { workoutSets, mapSteps, sessionBands, tonnageStep, tonnageBands } from '../core/routine-sets.js';
import { setsMap, setsMapRow, selectableMap } from './muscle-map.js';
import { analyseWorkout, roundToTotal } from '../core/workout-analytics.js';
import { trendOf } from '../core/workout-progress.js';
import {
  fmtTonnage, tonnageParts, pctText, durationParts, dateShort, exLabel, workoutTitle, metricLabel, metricShort, repsText,
} from './progress-ui.js';
import { ensureCss, loadExercises, loadWorkouts, fmtSets } from './data.js';
import { trendChart, hBars, vBars } from './analytics-charts.js';
import { isBaseline } from '../core/baseline.js';
import { t } from '../i18n/index.js';
import { monthLong, monthYear } from '../i18n/dates.js';
import { muscleName } from '../i18n/names.js';

/** Month name of 'YYYY-MM' ('November'), or with the year ('November 2026'). */
const monthOfKey = (ym) => monthLong(Number(ym.slice(5, 7)) - 1);
const monthYearOfKey = (ym) => monthYear(new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1));
/** Muscle of a tonnage row ('unknown' = exercises without a muscle). */
const tonMuscle = (id) => (id === 'unknown' ? t('analysis.unknownExercise') : muscleName(id));

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
    default: return repsText(b.value);
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

/** Unit shown after a metric's row label. */
const rowUnit = (k) => (k === 'heaviest' ? t('analysis.unit.kgReps') : k === 'e1rm' ? 'kg' : k === 'bwReps' || k === 'bwTotal' ? t('analysis.unit.reps') : '');

/** '+2.5 kg', '−1 rep', '±0 kg'. e1rm is shown with 1 decimal, so its change is too. */
function absText(d, metric) {
  if (!d) return '';
  const unit = d.unit === 'reps' ? t('analysis.unit.repsCount', { count: Math.abs(d.abs) }) : d.unit;
  if (d.abs === 0) return `±0 ${unit}`;
  return `${d.abs > 0 ? '+' : '−'}${metric === 'tonnage' || metric === 'tonnageSet' ? exKg(Math.abs(d.abs)) : `${fmtNum(Math.abs(d.abs), metric === 'e1rm' ? 1 : 2)} ${unit}`}`;
}

/** Coloured % with its sign; colour is never the only cue. */
const pctSpan = (p) => el('span', { class: ['wk-pct', `is-${trendOf(p)}`] }, p === null || p === undefined ? '–' : pctText(p));

/** When a best was set: '12 Nov', or 'starting point, 12 Nov' for the starting point. */
const when = (b) => (b.baseline ? t('analysis.an.whenStart', { date: dateShort(b.date) }) : dateShort(b.date));

// ---------------------------------------------------------------- mount

export async function mountAnalytics(container, { id }) {
  ensureCss();
  const [w, exMap, workouts, rawWeights] = await Promise.all([db.get('workouts', id), loadExercises(), loadWorkouts(), db.getSetting('volume')]);
  if (!w) {
    append(container, pageHeader({ title: t('analysis.an.title'), back: 'workout/history' }),
      emptyState(t('analysis.an.notFound'),
        el('a', { class: 'btn', href: href('workout/history') }, t('analysis.an.openHistory'))));
    return;
  }
  if (isBaseline(w)) { navigate('workout/starting-point', { replace: true }); return; }
  const res = analyseWorkout(workouts, w, exMap);
  const name = (exId) => exLabel(exMap, exId);

  container.classList.add('wk-an');
  append(container, pageHeader({
    title: workoutTitle(w),
    subtitle: [t('analysis.an.title'), fmtDate(w.date), Number.isFinite(w.startedAt) ? fmtTime(w.startedAt) : null,
      w.finishedAt ? null : t('analysis.inProgress')].filter(Boolean).join(' · '),
    back: `workout/history/${encodeURIComponent(w.id)}`,
  }));

  append(container, headerStrip(w, res));

  if (!res.exercises.length) {
    append(container, emptyState(t('analysis.an.noSets')));
    return;
  }

  append(container, recordsSection(res, name));
  append(container, el('section', { class: 'section' },
    sectionHeader(t('analysis.an.exercises'), { info: 'records' }),
    res.exercises.map((r) => exerciseBlock(r, w, res, name))));
  append(container, wholeWorkout(w, res, exMap, volumeWeights(rawWeights)));
  append(container, monthSection(w, res, name));
}

// ---------------------------------------------------------------- header

function headerStrip(w, res) {
  const tot = res.totals;
  const prev = res.routine.prev;
  const pct = res.routine.pct;
  const ton = tonnageParts(tot.load);
  return el('div', { class: 'stack' },
    el('div', { class: 'tiles' },
      statTile({ label: t('analysis.duration'), ...durationParts(tot.durationMs), sub: w.finishedAt ? null : t('analysis.inProgress') }),
      el('div', { class: 'tile', title: prev ? t('analysis.tonnageVsPrevTitle', { name: workoutTitle(w), date: fmtDate(prev.date), tonnage: tKg(res.routine.prevTonnage) }) : null },
        el('span', { class: 'tile-label' }, t('analysis.tonnage')),
        el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)),
        el('span', { class: 'tile-sub' }, prev ? [pct === null ? '–' : pctSpan(pct), ' ', t('analysis.vsDate', { date: dateShort(prev.date) })]
          : t(w.routineId ? 'analysis.firstOfRoutine' : 'analysis.noRoutine'))),
      statTile({ label: t('analysis.sets'), value: String(tot.sets), sub: tot.dropsets ? t('analysis.plusDrop', { n: tot.dropsets }) : null })),
    tot.dropLoad ? el('p', { class: 't-sub muted wk-pad-x' }, t('analysis.dropTonnage', { tonnage: tKg(tot.dropLoad) })) : null);
}

// ---------------------------------------------------------------- records

/** Record groups in display order; titles: analysis.an.group.<status>. */
const GROUPS = ['pr', 'month', 'matched'];

function recordsSection(res, name) {
  const sec = el('section', { class: 'section' }, sectionHeader(t('analysis.records'), { info: 'records' }));
  const beaten = res.records.filter((r) => r.status !== 'matched');
  if (!beaten.length) {
    const m = res.closestMiss;
    const allFirst = res.exercises.every((x) => x.firstTime);
    append(sec, el('div', { class: 'card stack' },
      el('p', null, t(allFirst ? 'analysis.an.noRecordsNew' : 'analysis.an.noRecords')),
      m ? el('p', { class: 't-sub muted' },
        t('analysis.an.closest', {
          name: name(m.exerciseId), metric: metricShort(m.metric), gap: absText({ ...m.delta, abs: -m.delta.abs }, m.metric).replace(/^\+/, ''),
          best: valueText(m.metric, m.best), when: when(m.best),
        }))
        : null));
  }
  for (const status of GROUPS) {
    const title = t(`analysis.an.group.${status}`);
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
        t('analysis.an.matched', {
          list: rs.map((r) => t('analysis.an.metricValue', { metric: metricShort(r.metric), value: valueText(r.metric, r.cur) })).join(t('analysis.listSep')),
          when: [...new Set(rs.map((r) => when(r.prevAll)))].join(t('analysis.listSep')),
        })))));
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
      el('div', { class: 't-sub muted' }, metricLabel(r.metric)),
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
  const monthName = monthOfKey(res.month);
  const holder = (b) => (!b ? '' : b.workoutId === w.id ? t('analysis.an.thisWorkout') : b.baseline ? t('analysis.an.startingPoint') : dateShort(b.date));

  const table = el('table', { class: 'wk-an-table' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, el('span', { class: 'wk-an-sr' }, t('analysis.an.metric'))),
      el('th', { scope: 'col' }, t('analysis.workout')),
      el('th', { scope: 'col' }, monthName),
      el('th', { scope: 'col' }, t('analysis.an.allTime')))),
    el('tbody', {}, keys.map((k) => {
      const cur = r.scopes.workout[k];
      const mon = r.scopes.month[k];
      const all = r.scopes.all[k];
      const st = status[k];
      const monRec = mon && mon.workoutId === w.id && (st === 'pr' || st === 'month');
      const allRec = all && all.workoutId === w.id && st === 'pr';
      return el('tr', {},
        el('th', { scope: 'row' }, metricLabel(k), el('span', { class: 'wk-an-unit' }, rowUnit(k))),
        el('td', {}, cellText(k, cur)),
        el('td', { class: monRec ? 'is-rec' : null }, cellText(k, mon), el('span', { class: 'wk-an-when' }, holder(mon))),
        el('td', { class: allRec ? 'is-rec' : null }, cellText(k, all), el('span', { class: 'wk-an-when' }, holder(all))));
    })));

  const notes = [
    r.dropsets ? t('analysis.an.dropsNotCounted', { count: r.dropsets, tonnage: exKg(r.dropTonnage) }) : null,
    r.undone ? t('analysis.an.notDone', { n: r.undone }) : null,
  ].filter(Boolean).join(' · ');

  const tagText = r.firstTime ? t('analysis.an.firstTime') : recs ? t('analysis.an.recordCount', { count: recs })
    : r.sessions === 1 && r.startingPoint ? t('analysis.an.vsStart') : t('analysis.sessionCount', { count: r.sessions });
  return el('article', { class: 'card wk-an-ex' },
    el('a', { class: 'wk-an-ex-head', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`) },
      el('h3', { class: 'wk-an-ex-name' }, name(r.exerciseId)),
      recs ? tag(tagText, { tone: 'accent', icon: 'trophy' }) : el('span', { class: 't-sub muted' }, tagText),
      icon('chevron-right', { class: 'li-chevron' })),
    el('p', { class: 't-sub wk-an-sets' }, el('span', { class: 'muted' }, `${t('analysis.unit.kgReps')}  `), fmtSets(r.sets) || '–'),
    notes ? el('p', { class: 't-sub muted' }, notes) : null,
    el('div', { class: 'wk-an-scroll' }, table),
    trendBlock(r, status));
}

function trendBlock(r, status) {
  const tr = r.trend;
  const reps = tr.metric === 'bwReps';
  const label = t(reps ? 'analysis.an.trendReps' : 'analysis.an.trendE1rm');
  if (tr.points.length < 2) {
    return el('p', { class: 't-sub muted' }, t('analysis.an.noTrend', { label }));
  }
  const format = reps ? (v) => repsText(v) : (v) => kg(v, 1);
  const cur = tr.points[tr.points.length - 1];
  return el('figure', { class: 'wk-an-fig' },
    el('figcaption', { class: 't-cap muted' }, t('analysis.an.trendCaption', { label, n: tr.points.length })),
    trendChart({
      points: tr.points,
      best: tr.best ? tr.best.value : null,
      format,
      record: status[tr.metric] === 'pr',
      ariaLabel: t('analysis.an.trendAria', { label, count: tr.points.length, value: format(cur.value), best: tr.best ? format(tr.best.value) : t('analysis.none') }),
    }));
}

// ---------------------------------------------------------------- whole workout

/** Tonnage by muscle with whole-kg rows that add up to the session total shown (largest remainder). */
function muscleRows(muscles) {
  const shown = roundToTotal(muscles.map((m) => m.tonnage));
  return muscles.map((m, i) => ({ label: tonMuscle(m.muscle), value: m.tonnage, text: tKg(shown[i]) }));
}

/** Sets / Tonnage of the muscle map, kept while the app runs. */
const muscleView = { mode: 'sets' };

/**
 * This workout on the body map, shaded by sets per muscle (session bands, the user's weighting) or by
 * tonnage per muscle (primary muscles, split equally: the bars' rule), with the matching bars under it.
 * Map, bars and the tapped muscle's line show the same numbers.
 */
function musclesSection(w, res, exMap, weights) {
  const sets = workoutSets(w, exMap, weights);
  const setRows = MUSCLES.filter((m) => sets[m.id].total > 0);
  const tonShown = roundToTotal(res.muscles.map((m) => m.tonnage));
  const ton = new Map(res.muscles.map((m, i) => [m.muscle, { value: m.tonnage, text: tKg(tonShown[i]) }]));
  const maxTon = Math.max(0, ...res.muscles.filter((m) => m.muscle !== 'unknown').map((m) => m.tonnage));
  const map = setsMap();
  const sel = selectableMap(map, (id) => {
    const s = sets[id];
    const tn = ton.get(id);
    return [el('span', { class: 'strong' }, muscleName(id)),
      ` · ${t('analysis.an.muscleLine', { count: s.total, n: fmtNum(s.total, 2), tonnage: tn ? tn.text : '0 kg' })}`];
  });
  const body = el('div');
  const toggle = segmented({
    small: true, ariaLabel: t('analysis.an.shadeBy'), value: muscleView.mode,
    options: [{ value: 'sets', label: t('analysis.sets') }, { value: 'tonnage', label: t('analysis.tonnage') }],
    onChange: (v) => { muscleView.mode = v; paint(); },
  });
  const header = sectionHeader(t('analysis.an.muscles'), { trail: toggle });
  const title = header.querySelector('.section-title');
  let info = null;
  const paint = () => {
    const bySets = muscleView.mode === 'sets';
    const fresh = bySets ? infoButton('sets-workout', { values: weights }) : infoButton('tonnage');
    if (info) info.replaceWith(fresh); else title.after(fresh);
    info = fresh;
    setBodyMapValues(map, bySets ? mapSteps(sets) : Object.fromEntries(MUSCLES.map((m) => [m.id, tonnageStep(ton.has(m.id) ? ton.get(m.id).value : 0, maxTon)])));
    map.setAttribute('aria-label', bySets
      ? t('analysis.an.setsAria', { list: setRows.map((m) => `${muscleName(m.id)} ${fmtNum(sets[m.id].total, 2)}`).join(t('analysis.listSep')) || t('analysis.none') })
      : t('analysis.an.tonnageAria', { list: res.muscles.map((m) => `${tonMuscle(m.muscle)} ${ton.get(m.muscle).text}`).join(t('analysis.listSep')) || t('analysis.none') }));
    const bars = bySets
      ? (setRows.length ? hBars(setRows.map((m) => ({ label: muscleName(m.id), value: sets[m.id].total, text: fmtNum(sets[m.id].total, 2) }))) : el('p', { class: 't-sub muted' }, t('analysis.an.noDoneSets')))
      : (res.muscles.length ? hBars(muscleRows(res.muscles)) : el('p', { class: 't-sub muted' }, t('analysis.an.noWeightSets')));
    replaceChildren(body,
      setsMapRow(map, bySets ? sessionBands(weights) : tonnageBands(maxTon, tKg), t(bySets ? 'analysis.an.setsPerMuscle' : 'analysis.an.tonnageByMuscle')),
      sel.line,
      el('div', { class: 'wk-an-mbars' }, bars));
    sel.refresh();
  };
  paint();
  return el('section', { class: 'section' }, header, el('div', { class: 'card' }, body));
}

function wholeWorkout(w, res, exMap, weights) {
  const out = [];
  out.push(musclesSection(w, res, exMap, weights));
  const h = res.routine.history;
  out.push(el('section', { class: 'section' },
    sectionHeader(h.length > 1 ? t('analysis.an.sessionTonnageLast', { n: h.length }) : t('analysis.an.sessionTonnage'), { info: 'tonnage' }),
    el('div', { class: 'card' }, h.length > 1
      ? vBars(h.map((s) => ({ date: s.date, value: s.tonnage, text: tKg(s.tonnage), current: s.current })),
        t('analysis.an.sessionTonnageAria', { count: h.length, name: workoutTitle(w), list: h.map((s) => `${fmtDate(s.date)} ${tKg(s.tonnage)}`).join(t('analysis.listSep')) }))
      : el('p', { class: 't-sub muted' }, t(w.routineId ? 'analysis.an.firstOfRoutine' : 'analysis.an.notFromRoutine')))));
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
  const monthName = monthYearOfKey(m.month);
  const holder = (b) => (!b ? '' : b.workoutId === w.id ? t('analysis.an.thisWorkout') : b.baseline ? t('analysis.an.startingPoint') : dateShort(b.date));
  const ton = tonnageParts(m.tonnage);
  return el('section', { class: 'section' },
    sectionHeader(t('analysis.an.monthUpTo', { month: monthName, date: dateShort(w.date) }), { info: 'records' }),
    el('div', { class: 'tiles' },
      statTile({ label: t('analysis.sessions'), value: String(m.sessions) }),
      statTile({ label: t('analysis.tonnage'), value: ton.value, unit: ton.unit }),
      statTile({ label: t('analysis.records'), value: String(m.records), sub: t('analysis.allTimeSub') })),
    el('div', { class: 'card wk-an-scroll' }, el('table', { class: 'wk-an-table wk-an-mtable' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, t('analysis.an.exercise')),
        el('th', { scope: 'col' }, metricLabel('heaviest'), el('span', { class: 'wk-an-unit' }, t('analysis.unit.kgReps'))),
        el('th', { scope: 'col' }, t('analysis.an.tonnageSetCol')))),
      el('tbody', {}, monthOrder(m.exercises, res).map((x) => el('tr', {},
        el('th', { scope: 'row' }, name(x.exerciseId)),
        x.heaviest
          ? el('td', {}, cellText('heaviest', x.heaviest), el('span', { class: 'wk-an-when' }, holder(x.heaviest)))
          : x.bwReps
            ? el('td', {}, t('analysis.an.bwReps', { reps: x.bwReps.reps }), el('span', { class: 'wk-an-when' }, holder(x.bwReps)))
            : el('td', {}, '–'),
        x.tonnageSet
          ? el('td', {}, exKg(x.tonnageSet.value), el('span', { class: 'wk-an-when' }, `${fmtNum(x.tonnageSet.weight, 2)} × ${x.tonnageSet.reps} · ${holder(x.tonnageSet)}`))
          : el('td', {}, '–')))))));
}
