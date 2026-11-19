// Post-workout analytics: per-exercise bests for three scopes, records as they stood on the
// workout's own date, muscle tonnage, routine and month context. Pure, no DOM / IndexedDB.
// Builds on workout-progress.js (volume load, top set, e1rm, % change, routine matching).
//
// Definitions (also stated in the UI):
//   - Only DONE NORMAL sets count for every best and record. Dropsets and undone sets are ignored
//     (dropsets are reported separately). Sets without reps are ignored.
//   - Heaviest set: highest weight (> 0); tie -> more reps; tie -> the earlier set / session.
//   - Highest-tonnage set: the single set with the largest weight × reps (kg); tie -> heavier, then earlier.
//   - Session tonnage: Σ weight × reps of the done normal sets (per exercise and per workout, kg).
//   - Best estimated 1RM: Epley via e1rm() of workout.js (1 rep = the weight), best set of a session.
//   - Bodyweight exercise (this workout's done normal sets carry no weight): reps instead —
//     most reps in one set and total reps of the session, counted over sets without weight only.
//   - Scopes: this workout; this calendar month (the workout's month, sessions up to and including
//     it); all time before it; all time including it. "Before" = earlier date, or same date and
//     earlier start time (workout-progress isOlder); creation order is never used. Only finished
//     workouts count as history; the analysed workout itself counts even when unfinished.
//   - Record holder: the first session that reached a value (a later equal value does not take it).
//   - Status of a metric in this workout:
//       first   no earlier value for this metric (first time; never called a record)
//       pr      beats the all-time best before this workout
//       matched equals the all-time best before this workout
//       month   below the all-time best, but beats the best earlier in the same calendar month
//       below   none of the above
//   - Starting point (baseline.js isBaseline): counts as earlier history for the set metrics
//     (heaviest set, tonnage set, est. 1RM, most reps in a set), so the first real session is compared
//     with it instead of being "first"; best values it holds carry `baseline: true`. It never counts
//     for session metrics (session tonnage, total reps), month scopes and statistics, session counts,
//     trend points or routine history.
import { byRecent, e1rm, isLoggedWorkout } from './workout.js';
import { isBaseline } from './baseline.js';
import { normalDone, dropDone, loadOf, doneEntries, sessionTotals, pctChange, previousRoutineSession, isOlder } from './workout-progress.js';
import { round } from './numbers.js';
import { muscleName } from './muscles.js';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const hasWeight = (s) => isNum(s.weight) && s.weight > 0;
const hasReps = (s) => isNum(s.reps) && s.reps > 0;

/** Metrics that describe a whole session; a starting point never holds them. */
export const SESSION_METRICS = Object.freeze(['tonnage', 'bwTotal']);

/** Metric keys and labels. `unit` is the unit of `value`. */
export const METRICS = Object.freeze({
  heaviest: Object.freeze({ label: 'Heaviest set', short: 'heaviest set', unit: 'kg', set: true }),
  tonnageSet: Object.freeze({ label: 'Highest-tonnage set', short: 'tonnage set', unit: 'kg', set: true }),
  e1rm: Object.freeze({ label: 'Est. 1RM', short: 'est. 1RM', unit: 'kg', set: true }),
  tonnage: Object.freeze({ label: 'Session tonnage', short: 'session tonnage', unit: 'kg', set: false }),
  bwReps: Object.freeze({ label: 'Most reps in a set', short: 'most reps in a set', unit: 'reps', set: false }),
  bwTotal: Object.freeze({ label: 'Total reps', short: 'total reps', unit: 'reps', set: false }),
});
export const LOAD_METRICS = Object.freeze(['heaviest', 'tonnageSet', 'e1rm', 'tonnage']);
export const REPS_METRICS = Object.freeze(['bwReps', 'bwTotal']);

/** 'YYYY-MM' of a date string. */
export const monthOf = (date) => String(date || '').slice(0, 7);

/** Chronological order (oldest first) of workouts, by byRecent (date, starting point first, start time). */
const chrono = (list) => [...list].sort((a, b) => byRecent(b, a));
/** The same order for {workout, entry} pairs (sorted by their workout, so `kind` is seen). */
const chronoHistory = (list) => [...list].sort((a, b) => byRecent(b.workout, a.workout));

// ---------------------------------------------------------------- per session

/**
 * Best values of one (merged) exercise entry. null for a metric without a qualifying set.
 * @returns {Record<string, {value: number, weight?: number, reps?: number}|null>}
 */
export function sessionBests(entry) {
  const sets = normalDone(entry).filter(hasReps);
  const weighted = sets.filter(hasWeight);
  const bw = sets.filter((s) => !hasWeight(s));
  let heaviest = null; let tonnageSet = null; let best = null;
  for (const s of weighted) {
    if (!heaviest || s.weight > heaviest.weight || (s.weight === heaviest.weight && s.reps > heaviest.reps)) {
      heaviest = { value: s.weight, weight: s.weight, reps: s.reps };
    }
    const t = round(s.weight * s.reps, 2);
    if (!tonnageSet || t > tonnageSet.value || (t === tonnageSet.value && s.weight > tonnageSet.weight)) {
      tonnageSet = { value: t, weight: s.weight, reps: s.reps };
    }
    const v = round(e1rm(s.weight, s.reps), 2);
    if (v > 0 && (!best || v > best.value || (v === best.value && s.weight > best.weight))) best = { value: v, weight: s.weight, reps: s.reps };
  }
  let bwReps = null;
  for (const s of bw) if (!bwReps || s.reps > bwReps.reps) bwReps = { value: s.reps, weight: 0, reps: s.reps };
  const tonnage = loadOf(weighted);
  const total = bw.reduce((a, s) => a + s.reps, 0);
  return {
    heaviest, tonnageSet, e1rm: best,
    tonnage: tonnage > 0 ? { value: tonnage } : null,
    bwReps, bwTotal: total > 0 ? { value: total } : null,
  };
}

/** >0 when a is better than b for the metric (heaviest: weight, then reps). */
export function compareBest(metric, a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (metric === 'heaviest') return a.weight !== b.weight ? a.weight - b.weight : a.reps - b.reps;
  return round(a.value - b.value, 2);
}

/**
 * Bests over a list of {workout, entry}; the first session reaching a value holds it.
 * @returns {Record<string, ({value: number, weight?: number, reps?: number, date: string, workoutId: string})|null>}
 */
export function scopeBests(history) {
  const out = Object.fromEntries(Object.keys(METRICS).map((k) => [k, null]));
  for (const { workout, entry } of chronoHistory(history)) {
    const b = sessionBests(entry);
    const base = isBaseline(workout);
    for (const k of Object.keys(METRICS)) {
      if (base && SESSION_METRICS.includes(k)) continue;
      if (b[k] && compareBest(k, b[k], out[k]) > 0) out[k] = { ...b[k], date: workout.date, workoutId: workout.id, ...(base ? { baseline: true } : {}) };
    }
  }
  return out;
}

// ---------------------------------------------------------------- timeline

/**
 * Finished workouts strictly before `workout` (oldest first) followed by the workout itself.
 * Later sessions are dropped, so everything is "as of" the workout's date and start time.
 */
export function timelineUpTo(workouts, workout) {
  const before = (workouts || []).filter((w) => isLoggedWorkout(w) && w.id !== workout.id && isOlder(w, workout));
  return [...chrono(before), workout];
}

/** {workout, entry} for each session of the timeline containing the exercise (done sets), oldest first. */
function exerciseTimeline(timeline, exerciseId) {
  const out = [];
  for (const w of timeline) {
    const e = doneEntries(w).get(exerciseId);
    if (e) out.push({ workout: w, entry: e });
  }
  return out;
}

/** 'reps' when the entry's done normal sets carry no weight, else 'load'. */
export function modeOf(entry) {
  const n = normalDone(entry);
  return n.length > 0 && !n.some(hasWeight) ? 'reps' : 'load';
}

/** Change from `ref` to `cur`: kg (or reps) and %; heaviest with equal weight -> reps, no %. */
export function deltaOf(metric, cur, ref) {
  if (!cur || !ref) return null;
  if (metric === 'heaviest' && cur.weight === ref.weight) {
    // Same weight, more reps: the change is in reps; a % of reps would overstate it, so none.
    return { abs: cur.reps - ref.reps, unit: 'reps', pct: null };
  }
  const key = metric === 'heaviest' ? 'weight' : 'value';
  return { abs: round(cur[key] - ref[key], 2), unit: METRICS[metric].unit, pct: pctChange(cur[key], ref[key]) };
}

/**
 * Status of each metric of the last session of `hist` against everything before it.
 * @param {{workout: object, entry: object}[]} hist oldest first; the last item is "this workout"
 * @returns {{metric: string, status: 'first'|'pr'|'matched'|'month'|'below', cur: object,
 *   prevAll: object|null, prevMonth: object|null, ref: object|null, delta: object|null}[]}
 */
export function metricStatuses(hist) {
  if (!hist.length) return [];
  const last = hist[hist.length - 1];
  const before = hist.slice(0, -1);
  const month = monthOf(last.workout.date);
  const all = scopeBests(before);
  const mon = scopeBests(before.filter((h) => monthOf(h.workout.date) === month && !isBaseline(h.workout)));
  const cur = sessionBests(last.entry);
  const keys = modeOf(last.entry) === 'reps' ? REPS_METRICS : LOAD_METRICS;
  const out = [];
  for (const metric of keys) {
    const c = cur[metric];
    if (!c) continue;
    const prevAll = all[metric];
    const prevMonth = mon[metric];
    let status; let ref = prevAll;
    if (!prevAll) { status = 'first'; ref = null; } else {
      const d = compareBest(metric, c, prevAll);
      if (d > 0) status = 'pr';
      else if (d === 0) status = 'matched';
      else if (prevMonth && compareBest(metric, c, prevMonth) > 0) { status = 'month'; ref = prevMonth; } else status = 'below';
    }
    out.push({ metric, status, cur: c, prevAll, prevMonth, ref, delta: ref ? deltaOf(metric, c, ref) : null });
  }
  return out;
}

/** All-time records (status 'pr') set by the last workout of `timeline`, counted per exercise × metric. */
function prCount(timeline) {
  const w = timeline[timeline.length - 1];
  let n = 0;
  for (const id of doneEntries(w).keys()) {
    n += metricStatuses(exerciseTimeline(timeline, id)).filter((s) => s.status === 'pr').length;
  }
  return n;
}

// ---------------------------------------------------------------- muscles

/**
 * Tonnage per primary muscle: each exercise's session tonnage (done normal sets with weight) is
 * split equally between its primary muscles. Secondary muscles get nothing. Unknown (deleted)
 * exercises go to 'unknown'.
 * @param {Map<string, object>|Record<string, object>} exercises
 * @returns {{muscle: string, name: string, tonnage: number}[]} largest first, only > 0
 */
export function muscleTonnage(workout, exercises) {
  const get = exercises instanceof Map ? (id) => exercises.get(id) : (id) => (exercises || {})[id];
  const acc = new Map();
  for (const [id, entry] of doneEntries(workout)) {
    const t = loadOf(normalDone(entry));
    if (!(t > 0)) continue;
    const ex = get(id);
    const prim = ex && Array.isArray(ex.primary) && ex.primary.length ? ex.primary : ['unknown'];
    for (const m of prim) acc.set(m, (acc.get(m) || 0) + t / prim.length);
  }
  return [...acc].map(([muscle, v]) => ({ muscle, name: muscle === 'unknown' ? 'Unknown exercise' : muscleName(muscle), tonnage: round(v, 2) }))
    .filter((r) => r.tonnage > 0)
    .sort((a, b) => b.tonnage - a.tonnage);
}

// ---------------------------------------------------------------- whole analysis

const STATUS_ORDER = { pr: 0, month: 1, matched: 2 };

/**
 * Everything the post-workout analytics screen shows.
 * @param {object[]} workouts all stored workouts (the analysed one may be included)
 * @param {object} workout the analysed workout (finished or not)
 * @param {Map<string, object>|Record<string, object>} exercises by id (for muscles)
 * @param {{trendSessions?: number, routineSessions?: number}} [opts]
 */
export function analyseWorkout(workouts, workout, exercises, { trendSessions = 10, routineSessions = 8 } = {}) {
  const timeline = timelineUpTo(workouts, workout);
  const month = monthOf(workout.date);
  const totals = sessionTotals(workout);

  // per exercise
  const rows = [];
  for (const [exerciseId, entry] of doneEntries(workout)) {
    const hist = exerciseTimeline(timeline, exerciseId);
    const before = hist.slice(0, -1);
    const inMonth = (h) => monthOf(h.workout.date) === month && !isBaseline(h.workout);
    const real = hist.filter((h) => !isBaseline(h.workout));
    const start = before.filter((h) => isBaseline(h.workout)).pop() || null;
    const mode = modeOf(entry);
    const trendMetric = mode === 'reps' ? 'bwReps' : 'e1rm';
    const all = scopeBests(hist);
    const trend = real.slice(-trendSessions)
      .map((h) => {
        const b = sessionBests(h.entry)[trendMetric];
        return b ? { date: h.workout.date, workoutId: h.workout.id, value: b.value, weight: b.weight, reps: b.reps, current: h.workout.id === workout.id } : null;
      })
      .filter(Boolean);
    const drops = [];
    for (const e of workout.exercises || []) if (e && e.exerciseId === exerciseId) drops.push(...dropDone(e));
    const allSets = [];
    let undone = 0;
    for (const e of workout.exercises || []) {
      if (!e || e.exerciseId !== exerciseId) continue;
      for (const s of e.sets || []) { allSets.push(s); if (!s || !s.done) undone++; }
    }
    rows.push({
      exerciseId, mode, sessions: real.length, firstTime: before.length === 0,
      startingPoint: start ? { date: start.workout.date, workoutId: start.workout.id } : null,
      sets: allSets, undone, dropsets: drops.length, dropTonnage: loadOf(drops),
      scopes: {
        workout: scopeBests([hist[hist.length - 1]]),
        month: scopeBests(hist.filter(inMonth)),
        all,
        allBefore: scopeBests(before),
        monthBefore: scopeBests(before.filter(inMonth)),
      },
      statuses: metricStatuses(hist),
      trend: { metric: trendMetric, points: trend, best: all[trendMetric] },
    });
  }

  // records (pr, month, matched), all-time first
  const records = [];
  rows.forEach((r, i) => {
    for (const s of r.statuses) if (s.status in STATUS_ORDER) records.push({ exerciseId: r.exerciseId, order: i, ...s });
  });
  records.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.order - b.order);

  // closest miss: the 'below' metric with the smallest relative gap to its all-time best
  let closestMiss = null;
  for (const r of rows) {
    for (const s of r.statuses) {
      if (s.status !== 'below' && s.status !== 'month') continue;
      const d = deltaOf(s.metric, s.cur, s.prevAll);
      if (!d || !isNum(d.pct)) continue;
      if (!closestMiss || d.pct > closestMiss.delta.pct) closestMiss = { exerciseId: r.exerciseId, metric: s.metric, cur: s.cur, best: s.prevAll, delta: d };
    }
  }

  // routine context
  const prev = previousRoutineSession(workouts, workout);
  const prevTonnage = prev ? sessionTotals(prev).load : null;
  const routineHistory = workout.routineId
    ? timeline.filter((w) => w.routineId === workout.routineId && !isBaseline(w)).slice(-routineSessions)
      .map((w) => ({ workoutId: w.id, date: w.date, tonnage: sessionTotals(w).load, current: w.id === workout.id }))
    : [];

  return {
    month,
    totals,
    routine: { prev, prevTonnage, pct: prev ? pctChange(totals.load, prevTonnage) : null, history: routineHistory },
    exercises: rows,
    records,
    closestMiss,
    muscles: muscleTonnage(workout, exercises),
    monthView: monthSummary(timeline, month),
  };
}

/**
 * The workout's month as of the workout: sessions, tonnage, all-time records set, and per exercise
 * the month's heaviest set, highest-tonnage set and (bodyweight) most reps.
 * @param {object[]} timeline from timelineUpTo (oldest first, analysed workout last)
 */
export function monthSummary(timeline, month) {
  const idx = [];
  timeline.forEach((w, i) => { if (monthOf(w.date) === month && !isBaseline(w)) idx.push(i); });
  let tonnage = 0; let records = 0; let sessions = 0;
  const order = [];
  for (const i of idx) {
    const w = timeline[i];
    if (!doneEntries(w).size) continue;
    sessions++;
    tonnage += sessionTotals(w).load;
    records += prCount(timeline.slice(0, i + 1));
    for (const id of doneEntries(w).keys()) if (!order.includes(id)) order.push(id);
  }
  const ws = idx.map((i) => timeline[i]);
  const exercises = order.map((exerciseId) => {
    const b = scopeBests(exerciseTimeline(ws, exerciseId));
    return { exerciseId, heaviest: b.heaviest, tonnageSet: b.tonnageSet, bwReps: b.bwReps };
  });
  return { month, sessions, tonnage: round(tonnage, 2), records, exercises };
}
