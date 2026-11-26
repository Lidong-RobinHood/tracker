// Analysis hub: "how am I doing" in one screen, leading to every detailed view.
// Route: workout/analysis. Numbers come from core/workout-overview.js (records, routines,
// exercises, month, weekly sets) and core/workout-analytics.js analyseWorkout (last workout), so they
// equal the screens they link to. All workouts are read once and scanned once.
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, href, fmtNum, fmtDate, icon, iconButton, sectionHeader, statTile, emptyState, segmented,
  setBodyMapValues,
} from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { bandStep, bandLegend, WEEK_BAND_EDGES } from '../core/set-bands.js';
import { setsMap, setsMapRow, selectableMap, withGlyph, workoutGlyph } from './muscle-map.js';
import { routineGlyph } from './routines.js';
import { today } from '../core/dates.js';
import { isBaseline } from '../core/baseline.js';
import { isLoggedWorkout } from '../core/workout.js';
import { analyseWorkout } from '../core/workout-analytics.js';
import { volumeWeights } from '../core/volume.js';
import { scanHistory, recentRecords, monthComparison, routineOverview, topExercises, weeklyMuscleSets } from '../core/workout-overview.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, findUnfinished } from './data.js';
import { loadTargets } from './targets.js';
import { workoutNav } from './subnav.js';
import { withSetsInfo } from './volume-ui.js';
import {
  fmtTonnage, tonnageParts, pctText, dateShort, exLabel, workoutTitle, metricLabel, metricShort, repsText,
} from './progress-ui.js';
import { trendOf } from '../core/workout-progress.js';
import { parseDate } from '../core/dates.js';
import { t } from '../i18n/index.js';
import { dayRange as dayRangeLabel } from '../i18n/dates.js';
import { muscleName, routineName } from '../i18n/names.js';

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
    default: return `${fmtNum(p.value, 0)} → ${repsText(c.value)}`;
  }
}

/** '+2.5 kg', '+1 rep' */
function absText(r) {
  const d = r.delta;
  if (!d) return '';
  const unit = d.unit === 'reps' ? t('analysis.unit.repsCount', { count: Math.abs(d.abs) }) : d.unit;
  const v = r.metric === 'tonnage' || r.metric === 'tonnageSet' ? fmtTonnage(Math.abs(d.abs), { kg: true }) : `${fmtNum(Math.abs(d.abs), r.metric === 'e1rm' ? 1 : 2)} ${unit}`;
  return `${d.abs >= 0 ? '+' : '−'}${v}`;
}

const summaryHref = (id) => href(`workout/summary/${encodeURIComponent(id)}`);
/** '1–18 Nov' (localised, year only when not this year). */
const dayRange = (r) => dayRangeLabel(parseDate(r.from), parseDate(r.to));
/** Coloured % (with its sign); colour is never the only cue. */
const pctSpan = (p) => el('span', { class: ['wk-pct', `is-${trendOf(p)}`] }, p === null || p === undefined ? '–' : pctText(p));

// ---------------------------------------------------------------- mount

export async function mountAnalysisHub(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(),
  ]);
  const now = today();
  const name = (id) => exLabel(exMap, id);
  const open = findUnfinished(workouts);
  const last = workouts.find((w) => isLoggedWorkout(w) && !isBaseline(w)) || null;
  const scan = scanHistory(workouts);
  const weights = volumeWeights(rawWeights);

  container.classList.add('wk-an', 'wk-hub');
  append(container, pageHeader({ title: t('analysis.hub.pageTitle') }), workoutNav('analysis'));

  if (open) {
    append(container, el('div', { class: 'card card-flush' }, el('a', { class: 'list-item', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, workoutTitle(open)),
        el('div', { class: 'li-sub' }, t('analysis.hub.notFinished', { date: dateShort(open.date) }))),
      el('span', { class: 'wk-go' }, t('analysis.hub.resume')))));
  }

  if (!last) {
    append(container, el('section', { class: 'section' },
      sectionHeader(t('analysis.hub.last')),
      emptyState(t('analysis.hub.noFinished'),
        el('a', { class: 'btn btn-primary', href: href('workout') }, t(open ? 'analysis.hub.goTrain' : 'analysis.hub.startWorkout')))));
    append(container, linksSection(targets, true));
    return;
  }

  append(container, lastSection(last, analyseWorkout(workouts, last, exMap), workoutGlyph(last, exMap, weights)));
  append(container, monthSection(monthComparison(scan.sessions, scan.byWorkout, now)));
  append(container, recordsSection(recentRecords(scan.records, 8), name));
  if (routines.length) append(container, routinesSection(routines, routineOverview(workouts, routines), exMap, weights));
  append(container, exercisesSection(topExercises(scan.histories, now, { weeks: WEEKS, limit: 6 }), name));
  append(container, setsSection(weeklyMuscleSets(workouts, exMap, weights, now, { weeks: SET_WEEKS, targets }), targets, weights));
  append(container, linksSection(targets));
}

// ---------------------------------------------------------------- sections

function lastSection(w, res, glyph) {
  const tot = res.totals;
  const prev = res.routine.prev;
  const prs = res.records.filter((r) => r.status === 'pr').length;
  const ton = tonnageParts(tot.load);
  return el('section', { class: 'section' },
    sectionHeader(t('analysis.hub.last'), { trail: el('a', { class: 'wk-trail-a', href: summaryHref(w.id) }, `${workoutTitle(w)} · ${fmtDate(w.date)}`) }),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile', title: prev ? t('analysis.tonnageVsPrevTitle', { name: workoutTitle(w), date: fmtDate(prev.date), tonnage: fmtTonnage(res.routine.prevTonnage) }) : null },
        el('span', { class: 'tile-label' }, t('analysis.tonnage')),
        el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)),
        el('span', { class: 'tile-sub' }, prev ? [pctSpan(res.routine.pct), ' ', t('analysis.vsDate', { date: dateShort(prev.date) })]
          : t(w.routineId ? 'analysis.firstOfRoutine' : 'analysis.noRoutine'))),
      withGlyph(statTile({ label: t('analysis.sets'), value: String(tot.sets), sub: tot.dropsets ? t('analysis.plusDrop', { n: tot.dropsets }) : null }), glyph),
      el('div', { class: ['tile', prs && 'is-rec'] },
        el('span', { class: 'tile-label' }, t('analysis.records')),
        el('span', { class: 'tile-value' }, String(prs)),
        el('span', { class: 'tile-sub' }, t('analysis.allTimeSub')))),
    tot.dropLoad ? el('p', { class: 't-sub muted wk-pad-x' }, t('analysis.dropTonnage', { tonnage: fmtTonnage(tot.dropLoad) })) : null,
    el('a', { class: 'btn btn-block', href: summaryHref(w.id) }, t('analysis.hub.fullAnalysis')));
}

function monthSection(m) {
  const vs = (key, text) => [t('analysis.hub.lastMonth', { value: text }), m.pct[key] === null ? null : [' · ', pctSpan(m.pct[key])]];
  const ton = tonnageParts(m.cur.tonnage);
  return el('section', { class: 'section' },
    sectionHeader(t('analysis.hub.thisMonth', { range: dayRange(m.curRange) }), { info: 'records', trail: t('analysis.vsDate', { date: dayRange(m.prevRange) }) }),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, t('analysis.sessions')), el('span', { class: 'tile-value' }, String(m.cur.sessions)), el('span', { class: 'tile-sub' }, vs('sessions', String(m.prev.sessions)))),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, t('analysis.tonnage')), el('span', { class: 'tile-value' }, ton.value, el('small', { class: 'tile-unit' }, ton.unit)), el('span', { class: 'tile-sub' }, vs('tonnage', fmtTonnage(m.prev.tonnage)))),
      el('div', { class: 'tile' }, el('span', { class: 'tile-label' }, t('analysis.records')), el('span', { class: 'tile-value' }, String(m.cur.records)), el('span', { class: 'tile-sub' }, vs('records', String(m.prev.records))))));
}

function recordsSection(groups, name) {
  const sec = el('section', { class: 'section' }, sectionHeader(t('analysis.hub.recentRecords'), { info: 'records' }));
  if (!groups.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, t('analysis.hub.noRecords'))));
    return sec;
  }
  append(sec, el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, groups.map((g) => {
    const more = g.others.map((r) => metricShort(r.metric));
    return el('a', { class: 'list-item wk-rec-row', href: summaryHref(g.workoutId) },
      icon('trophy', { class: 'li-lead' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name(g.exerciseId)),
        el('div', { class: 'li-sub' }, t('analysis.an.metricValue', { metric: metricLabel(g.lead.metric), value: changeText(g.lead) })),
        more.length ? el('div', { class: 'li-sub' }, t('analysis.hub.also', { list: more.join(t('analysis.listSep')) })) : null),
      el('div', { class: 'li-trail' },
        el('div', { class: 'wk-rec-abs' }, absText(g.lead)),
        el('div', { class: 't-sub muted' }, dateShort(g.date))));
  }))));
  return sec;
}

function routinesSection(routines, rows, exMap, weights) {
  const byId = new Map(rows.map((r) => [r.routineId, r]));
  return el('section', { class: 'section' },
    sectionHeader(t('analysis.hub.routines'), { info: 'tonnage', trail: t('analysis.hub.tonnageTrail') }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, routines.map((r) => {
      const o = byId.get(r.id);
      const sub = o.last ? t('analysis.hub.routineSub', { count: o.sessions, date: dateShort(o.last.date) }) : t('analysis.hub.notDoneYet');
      return el('a', { class: 'list-item wk-spark-row', href: href(`workout/routines/${encodeURIComponent(r.id)}/progress`) },
        routineGlyph(r, exMap, weights),
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, routineName(r)),
          el('div', { class: 'li-sub' }, sub)),
        o.history.length > 1 ? spark(o.history.map((h) => h.tonnage), t('analysis.hub.sparkTonnage', { count: o.history.length })) : null,
        o.last ? el('div', { class: 'li-trail' },
          el('div', null, fmtTonnage(o.last.tonnage)),
          el('div', { class: 't-sub' }, o.pct === null ? el('span', { class: 'muted' }, t('analysis.first')) : pctSpan(o.pct))) : null);
    }))));
}

function exercisesSection(rows, name) {
  const sec = el('section', { class: 'section' }, sectionHeader(t('analysis.hub.exercises', { count: WEEKS }), { info: 'top-exercises', trail: metricShort('e1rm') }));
  if (!rows.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, t('analysis.hub.noSetsWeeks', { count: WEEKS }))));
    return sec;
  }
  append(sec, el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, rows.map((x) => {
    const reps = x.metric === 'bestReps';
    const val = x.value === null ? '–' : reps ? [fmtNum(x.value, 0), el('small', { class: 'wk-unit' }, ` ${t('analysis.unit.reps')}`)] : [fmtNum(x.value, 1), el('small', { class: 'wk-unit' }, ' kg')];
    return el('a', { class: 'list-item wk-spark-row', href: href(`workout/exercises/${encodeURIComponent(x.exerciseId)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, name(x.exerciseId)),
        el('div', { class: 'li-sub' }, t(reps ? 'analysis.hub.exSubReps' : 'analysis.sessionCount', { count: x.sessions }))),
      x.points.length > 1 ? spark(x.points.map((p) => p.value), t('analysis.hub.sparkMetric', { metric: metricLabel(reps ? 'bwReps' : 'e1rm'), count: x.points.length })) : null,
      el('div', { class: 'li-trail' },
        el('div', null, val),
        el('div', { class: 't-sub' }, x.pct === null ? el('span', { class: 'muted' }, x.points.length > 1 ? '–' : t('analysis.hub.oneSession')) : pctSpan(x.pct))));
  }))));
  return sec;
}

function setsSection(data, targets, weights) {
  const host = el('div');
  const toggle = data.rows.length ? segmented({
    small: true, ariaLabel: t('analysis.hub.setsViewAria'), value: hubView.sets,
    options: [{ value: 'chart', label: t('analysis.hub.chart') }, { value: 'map', label: t('analysis.hub.map') }],
    onChange: (v) => { hubView.sets = v; paint(); },
  }) : null;
  const sec = el('section', { class: 'section' }, withSetsInfo(sectionHeader(t('analysis.hub.weeklySets', { count: SET_WEEKS }), { trail: toggle }), weights), host);
  const chart = setsChart(data, targets);
  const map = data.rows.length ? setsWeekMap(data, targets, weights) : null;
  const paint = () => replaceChildren(host, hubView.sets === 'map' ? map : chart);
  if (data.rows.length) paint(); else append(host, chart);
  return sec;
}

/** Map / Chart of the weekly sets and the week shown on the map, kept while the app runs. */
const hubView = { sets: 'chart', week: null };

/**
 * One week of the six on the body map (weekly bands, as the split screens), a stepper for the week and
 * the tapped muscle's figures: sets (direct · partial), and the weekly target when set. The same
 * numbers as the chart's columns.
 */
function setsWeekMap(data, targets, weights) {
  const last = data.weeks.length - 1;
  if (hubView.week === null || hubView.week > last) hubView.week = last;
  const byMuscle = new Map(data.rows.map((r) => [r.muscle, r]));
  const val = (id) => { const r = byMuscle.get(id); return r ? r.values[hubView.week] : { total: 0, direct: 0, partial: 0, drop: 0 }; };
  const map = setsMap();
  const sel = selectableMap(map, (id) => {
    const v = val(id);
    const tg = targets[id];
    return [el('span', { class: 'strong' }, `${muscleName(id)} ${fmtNum(v.total, 2)}${tg ? ` / ${fmtNum(tg, 1)}` : ''}`),
      ` · ${t(v.drop ? 'analysis.hub.mapLineDrop' : 'analysis.hub.mapLine', { direct: fmtNum(v.direct, 2), partial: fmtNum(v.partial, 2), drop: fmtNum(v.drop, 2) })}`];
  });
  const label = el('span', { class: 'wk-week-label', 'aria-live': 'polite' });
  const prev = iconButton('chevron-left', { label: t('analysis.hub.prevWeek'), onClick: () => go(-1) });
  const next = iconButton('chevron-right', { label: t('analysis.hub.nextWeek'), onClick: () => go(1) });
  const weekText = (i) => (i === last ? t('analysis.hub.thisWeek') : dayRange(data.weeks[i]));
  const paint = () => {
    const i = hubView.week;
    label.textContent = weekText(i);
    prev.disabled = i === 0;
    next.disabled = i === last;
    setBodyMapValues(map, Object.fromEntries(MUSCLES.map((m) => [m.id, bandStep(val(m.id).total, WEEK_BAND_EDGES)])));
    const items = MUSCLES.filter((m) => val(m.id).total > 0).map((m) => (targets[m.id]
      ? t('analysis.hub.mapAriaTarget', { muscle: muscleName(m.id), n: fmtNum(val(m.id).total, 2), target: fmtNum(targets[m.id], 1) })
      : `${muscleName(m.id)} ${fmtNum(val(m.id).total, 2)}`));
    map.setAttribute('aria-label', t('analysis.hub.mapAria', { week: weekText(i), list: items.join(t('analysis.listSep')) || t('analysis.none') }));
    sel.refresh();
  };
  const go = (d) => { hubView.week = Math.max(0, Math.min(last, hubView.week + d)); paint(); };
  paint();
  return el('div', { class: 'card' },
    el('div', { class: 'wk-week-step' }, prev, label, next),
    setsMapRow(map, bandLegend(weights, WEEK_BAND_EDGES), t('analysis.hub.weeklySetsTitle')),
    sel.line);
}

/** The existing small-multiples chart: six weeks per muscle, direct / partial, target line. */
function setsChart(data, targets) {
  const sec = el('div');
  if (!data.rows.length) {
    append(sec, el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, t('analysis.hub.noSetsWeeks', { count: SET_WEEKS }))));
    return sec;
  }
  const max = Math.max(1, ...data.rows.map((r) => r.max), ...data.rows.map((r) => targets[r.muscle] || 0));
  const first = data.weeks[0];
  append(sec, el('div', { class: 'card wk-hub-sets' },
    el('ul', { class: 'legend legend-row wk-sets-legend' },
      el('li', el('span', { class: 'swatch is-accent' }), t('analysis.legend.direct')),
      el('li', el('span', { class: 'swatch is-partial' }), t('analysis.legend.partial')),
      el('li', el('span', { class: 'wk-dash-swatch' }), t('analysis.legend.target'))),
    el('div', { class: 'wk-hub-set wk-hub-set-head t-cap', 'aria-hidden': 'true' },
      el('span'), el('span', { class: 'wk-hub-weeks' }, el('span', dateShort(first.from)), el('span', t('analysis.hub.thisWeekCol'))),
      el('span', { class: 'wk-hub-setnum' }, t('analysis.hub.now'))),
    data.rows.map((r) => {
      const tg = targets[r.muscle];
      const cur = r.values[r.values.length - 1];
      const weeks = r.values.map((v, i) => t('analysis.hub.chartAriaWeek', { date: dateShort(data.weeks[i].from), n: fmtNum(v.total, 2) })).join(t('analysis.listSep'));
      return el('div', {
        class: 'wk-hub-set', role: 'img',
        'aria-label': tg ? t('analysis.hub.chartAriaTarget', { muscle: muscleName(r.muscle), list: weeks, target: fmtNum(tg, 1) })
          : t('analysis.hub.chartAria', { muscle: muscleName(r.muscle), list: weeks }),
      },
      el('span', { class: 'wk-hub-mname' }, muscleName(r.muscle)),
      el('span', { class: 'wk-hub-weeks', 'aria-hidden': 'true' },
        r.values.map((v, i) => el('span', { class: ['wk-hub-wk', i === r.values.length - 1 && 'is-cur'] },
          tg ? el('span', { class: 'wk-hub-tgt', style: { bottom: `${Math.min(100, (tg / max) * 100).toFixed(1)}%` } }) : null,
          v.total > 0 ? el('span', { class: 'wk-hub-stack', style: { height: `${Math.max(4, (v.total / max) * 100).toFixed(1)}%` } },
            v.drop > 0 ? el('span', { class: 'wk-hub-seg is-partial', style: { flexGrow: String(v.drop) } }) : null,
            v.partial > 0 ? el('span', { class: 'wk-hub-seg is-partial', style: { flexGrow: String(v.partial) } }) : null,
            v.direct > 0 ? el('span', { class: 'wk-hub-seg is-direct', style: { flexGrow: String(v.direct) } }) : null) : null))),
      el('span', { class: 'wk-hub-setnum', 'aria-hidden': 'true' }, el('b', fmtNum(cur.total, 2)), tg ? ` / ${fmtNum(tg, 1)}` : null));
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
    withStart ? row('workout/starting-point', t('analysis.hub.startingPoint')) : null,
    row('workout/targets', t('analysis.targets.title'), n ? String(n) : t('analysis.hub.off')),
    row('workout/recovery', t('analysis.rc.title')),
    row('workout/exercises', t('analysis.hub.allExercises')),
    row('workout/history', t('analysis.hub.allWorkouts'))));
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
