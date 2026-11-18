// Workout progress: per-session / per-exercise metrics, comparisons, personal records, chart series.
// Pure, no DOM / IndexedDB. Records follow SPEC §3 (`workouts`).
//
// Definitions (shown in the UI as well):
//   - Only DONE sets count. "Normal sets" = done sets with type 'normal'.
//   - Volume load = Σ weight × reps over done NORMAL sets with weight > 0 (kg).
//     Dropsets are NOT included; their load is reported separately as `dropLoad`.
//   - Top set = the heaviest done normal set; ties -> more reps; ties -> the earlier set.
//   - Estimated 1RM = Epley, weight × (1 + reps / 30); 1 rep = the weight itself (e1rm() in workout.js).
//   - Bodyweight entry = has done normal sets and none of them has a weight > 0. Bodyweight exercises
//     progress by reps: their comparison basis is total reps of done normal sets instead of load.
//     When either side of a comparison carries weight, the basis is load.
//   - Dropsets never count towards top set, estimated 1RM, personal records or comparisons.
//   - Percentage change = (current − previous) / previous × 100, rounded to 1 decimal (half away from
//     zero). Previous missing, 0 or negative, or any non-finite input -> null (shown as "–"), never
//     NaN/Infinity. -0 is returned as 0.
//   - Routine matching: a session belongs to a routine when its `routineId` equals the routine id
//     (renaming or editing the routine keeps the link). Only finished sessions count as history.
//     An exercise is compared with its entry in the most recent earlier session of the SAME routine
//     that contains it (done sets); if there is none (exercise added to the routine, or the session
//     was started empty / without routine) it falls back to the most recent earlier finished session
//     of any kind containing the exercise. Same exercise twice in one session -> merged.
import { doneSets, byRecent, e1rm } from './workout.js';
import { round } from './numbers.js';
import { addDays } from './dates.js';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const hasWeight = (s) => isNum(s.weight) && s.weight > 0;
const hasReps = (s) => isNum(s.reps) && s.reps > 0;

/** Done normal sets of an entry, in order. */
export function normalDone(entry) {
  return doneSets(entry).filter((s) => s.type !== 'dropset');
}

/** Done dropsets of an entry, in order. */
export function dropDone(entry) {
  return doneSets(entry).filter((s) => s.type === 'dropset');
}

/** weight × reps of one set; 0 for bodyweight / missing values. */
export function setLoad(s) {
  return s && hasWeight(s) && hasReps(s) ? s.weight * s.reps : 0;
}

/** Σ weight × reps of the given sets (no filtering), rounded to 2 decimals. */
export function loadOf(sets) {
  return round((sets || []).reduce((a, s) => a + setLoad(s), 0), 2);
}

/**
 * Top set of the given sets: heaviest weight (empty = 0), then more reps, then the earlier one.
 * Sets without reps are ignored.
 * @returns {{weight: number, reps: number}|null}
 */
export function topSet(sets) {
  let best = null;
  for (const s of sets || []) {
    if (!s || !hasReps(s)) continue;
    const w = hasWeight(s) ? s.weight : 0;
    if (!best || w > best.weight || (w === best.weight && s.reps > best.reps)) best = { weight: w, reps: s.reps };
  }
  return best;
}

/**
 * Numbers for one exercise entry.
 * @returns {{sets: number, dropsets: number, load: number, dropLoad: number, reps: number,
 *   top: {weight: number, reps: number}|null, e1rm: number, bodyweight: boolean}}
 */
export function entryMetrics(entry) {
  const normal = normalDone(entry);
  const drops = dropDone(entry);
  let best = 0;
  for (const s of normal) best = Math.max(best, e1rm(s.weight, s.reps));
  return {
    sets: normal.length,
    dropsets: drops.length,
    load: loadOf(normal),
    dropLoad: loadOf(drops),
    reps: normal.reduce((a, s) => a + (hasReps(s) ? s.reps : 0), 0),
    top: topSet(normal),
    e1rm: round(best, 2),
    bodyweight: normal.length > 0 && !normal.some(hasWeight),
  };
}

/**
 * Percentage change from `prev` to `cur`, 1 decimal. null when not computable.
 * @returns {number|null}
 */
export function pctChange(cur, prev) {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null;
  const p = round(((cur - prev) / prev) * 100, 1);
  return p === 0 ? 0 : p;
}

/** @returns {'up'|'down'|'flat'|'none'} */
export function trendOf(pct) {
  if (!isNum(pct)) return 'none';
  return pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
}

/** '+2.5 %', '−3.1 %' (minus sign), '±0 %', '–' for null. */
export function formatPct(pct) {
  if (!isNum(pct)) return '–';
  if (pct === 0) return '±0 %';
  const abs = String(round(Math.abs(pct), 1));
  return `${pct > 0 ? '+' : '−'}${abs} %`;
}

/**
 * Compare two metrics objects (entryMetrics). Basis: reps when both are bodyweight, else load.
 * @param {ReturnType<typeof entryMetrics>|null} cur
 * @param {ReturnType<typeof entryMetrics>|null} prev
 * @returns {{basis: 'load'|'reps', cur: number|null, prev: number|null, pct: number|null, trend: string}}
 */
export function compareMetrics(cur, prev) {
  const basis = cur && prev && cur.bodyweight && prev.bodyweight ? 'reps'
    : cur && !prev && cur.bodyweight ? 'reps' : 'load';
  const val = (m) => (m && m.sets ? m[basis] : null);
  const c = val(cur);
  const p = val(prev);
  const pct = pctChange(c, p);
  return { basis, cur: c, prev: p, pct, trend: trendOf(pct) };
}

// ---------------------------------------------------------------- matching

/** Finished workouts, newest first. */
export function finishedWorkouts(workouts) {
  return (workouts || []).filter((w) => w && w.finishedAt).sort(byRecent);
}

/** true when `a` happened before `b` (date, then start time). */
export function isOlder(a, b) {
  return byRecent(a, b) > 0;
}

/**
 * Exercises of a workout with ≥ 1 done set, same exercise merged into one entry, in first-seen order.
 * @returns {Map<string, {exerciseId: string, sets: object[]}>}
 */
export function doneEntries(workout) {
  const out = new Map();
  for (const e of (workout && workout.exercises) || []) {
    if (!e || !doneSets(e).length) continue;
    const m = out.get(e.exerciseId);
    if (m) m.sets = m.sets.concat(e.sets);
    else out.set(e.exerciseId, { ...e, sets: [...e.sets] });
  }
  return out;
}

/**
 * Every finished session's (merged) entry for the exercise, newest first.
 * @returns {{workout: object, entry: object}[]}
 */
export function exerciseHistory(workouts, exerciseId) {
  const out = [];
  for (const w of finishedWorkouts(workouts)) {
    const e = doneEntries(w).get(exerciseId);
    if (e) out.push({ workout: w, entry: e });
  }
  return out;
}

/** Finished sessions of a routine, newest first. */
export function routineSessions(workouts, routineId) {
  if (!routineId) return [];
  return finishedWorkouts(workouts).filter((w) => w.routineId === routineId);
}

/** The most recent finished session of the same routine before `workout`, or null. */
export function previousRoutineSession(workouts, workout) {
  if (!workout || !workout.routineId) return null;
  return routineSessions(workouts, workout.routineId).find((w) => w.id !== workout.id && isOlder(w, workout)) || null;
}

/**
 * Entry to compare an exercise of `workout` with (see header for the rule).
 * @returns {{workout: object, entry: object, sameRoutine: boolean}|null}
 */
export function previousEntry(workouts, workout, exerciseId) {
  const older = finishedWorkouts(workouts).filter((w) => w.id !== workout.id && isOlder(w, workout));
  if (workout.routineId) {
    for (const w of older) {
      if (w.routineId !== workout.routineId) continue;
      const e = doneEntries(w).get(exerciseId);
      if (e) return { workout: w, entry: e, sameRoutine: true };
    }
  }
  for (const w of older) {
    const e = doneEntries(w).get(exerciseId);
    if (e) return { workout: w, entry: e, sameRoutine: !!workout.routineId && w.routineId === workout.routineId };
  }
  return null;
}

// ---------------------------------------------------------------- sessions

/**
 * Totals of one session. Duration only for finished sessions with valid timestamps.
 * @returns {{load: number, dropLoad: number, sets: number, dropsets: number, reps: number, exercises: number, durationMs: number|null}}
 */
export function sessionTotals(workout) {
  let load = 0; let dropLoad = 0; let sets = 0; let dropsets = 0; let reps = 0; let exercises = 0;
  for (const e of doneEntries(workout).values()) {
    const m = entryMetrics(e);
    load += m.load; dropLoad += m.dropLoad; sets += m.sets; dropsets += m.dropsets; reps += m.reps;
    exercises++;
  }
  const ok = isNum(workout.startedAt) && isNum(workout.finishedAt) && workout.finishedAt >= workout.startedAt;
  return {
    load: round(load, 2), dropLoad: round(dropLoad, 2), sets, dropsets, reps, exercises,
    durationMs: ok ? workout.finishedAt - workout.startedAt : null,
  };
}

/**
 * Compare a session with what came before, exercise by exercise.
 * Total: for a routine session with an earlier session of the same routine, the session's volume
 * load vs that session's ('session' basis, what the routine progress list shows). Otherwise the sum
 * of the loads of the exercises that have a previous entry vs the sum of those previous loads
 * ('matched' basis). Bodyweight-only exercises do not move the total.
 * @param {object[]} workouts all workouts (the session itself may be included; it is skipped)
 * @param {object} workout
 * @returns {{prevSession: object|null, total: {basis: 'session'|'matched', cur: number, prev: number|null, pct: number|null, trend: string},
 *   rows: {exerciseId: string, status: 'up'|'down'|'flat'|'new'|'skipped', metrics: object|null, prevMetrics: object|null,
 *          cmp: object|null, prevWorkout: object|null, records: object[]}[]}}
 */
export function compareSession(workouts, workout) {
  const prevSession = previousRoutineSession(workouts, workout);
  const cur = doneEntries(workout);
  const rows = [];
  let mCur = 0; let mPrev = 0;
  for (const [exerciseId, entry] of cur) {
    const metrics = entryMetrics(entry);
    const prev = previousEntry(workouts, workout, exerciseId);
    const prevMetrics = prev ? entryMetrics(prev.entry) : null;
    const cmp = prev ? compareMetrics(metrics, prevMetrics) : null;
    if (cmp && cmp.basis === 'load' && cmp.prev !== null) { mCur += metrics.load; mPrev += prevMetrics.load; }
    const prior = exerciseHistory(workouts, exerciseId).filter((h) => h.workout.id !== workout.id && isOlder(h.workout, workout));
    rows.push({
      exerciseId, status: cmp ? (cmp.trend === 'none' ? 'flat' : cmp.trend) : 'new',
      metrics, prevMetrics, cmp, prevWorkout: prev ? prev.workout : null,
      records: newRecords(prior, entry),
    });
  }
  if (prevSession) {
    for (const [exerciseId, entry] of doneEntries(prevSession)) {
      if (cur.has(exerciseId)) continue;
      rows.push({ exerciseId, status: 'skipped', metrics: null, prevMetrics: entryMetrics(entry), cmp: null, prevWorkout: prevSession, records: [] });
    }
  }
  let total;
  if (prevSession) {
    const c = sessionTotals(workout).load;
    const p = sessionTotals(prevSession).load;
    const pct = pctChange(c, p);
    total = { basis: 'session', cur: c, prev: p, pct, trend: trendOf(pct) };
  } else {
    const pct = pctChange(round(mCur, 2), round(mPrev, 2));
    total = { basis: 'matched', cur: round(mCur, 2), prev: mPrev > 0 ? round(mPrev, 2) : null, pct, trend: trendOf(pct) };
  }
  return { prevSession, total, rows };
}

/**
 * Everything the routine progress screen needs.
 * @param {object[]} workouts
 * @param {{id: string, items?: {exerciseId: string}[]}} routine
 * @returns {{sessions: {workout: object, totals: object, prev: object|null, pct: number|null, trend: string,
 *            added: string[], returned: string[], skipped: string[]}[],
 *   exercises: {exerciseId: string, inRoutine: boolean, entries: {workout: object, metrics: object, cmp: object|null}[]}[]}}
 *   sessions and entries newest first
 */
export function routineProgress(workouts, routine) {
  const list = routineSessions(workouts, routine.id);
  const sessions = list.map((w, i) => {
    const prev = list[i + 1] || null;
    const totals = sessionTotals(w);
    const pct = prev ? pctChange(totals.load, sessionTotals(prev).load) : null;
    const now = new Set(doneEntries(w).keys());
    const before = prev ? new Set(doneEntries(prev).keys()) : null;
    const earlier = new Set();
    for (const o of list.slice(i + 1)) for (const id of doneEntries(o).keys()) earlier.add(id);
    const notLast = before ? [...now].filter((id) => !before.has(id)) : [];
    return {
      workout: w, totals, prev, pct, trend: trendOf(pct),
      // added: never done in an earlier session of this routine; returned: done before, but not last time
      added: notLast.filter((id) => !earlier.has(id)),
      returned: notLast.filter((id) => earlier.has(id)),
      skipped: before ? [...before].filter((id) => !now.has(id)) : [],
    };
  });

  const order = (routine.items || []).map((i) => i.exerciseId);
  const inRoutine = new Set(order);
  for (const w of list) for (const id of doneEntries(w).keys()) if (!order.includes(id)) order.push(id);
  const exercises = [...new Set(order)].map((exerciseId) => {
    const hist = [];
    for (const w of list) {
      const e = doneEntries(w).get(exerciseId);
      if (e) hist.push({ workout: w, metrics: entryMetrics(e) });
    }
    const entries = hist.map((h, i) => ({ ...h, cmp: hist[i + 1] ? compareMetrics(h.metrics, hist[i + 1].metrics) : null }));
    return { exerciseId, inRoutine: inRoutine.has(exerciseId), entries };
  });
  return { sessions, exercises };
}

// ---------------------------------------------------------------- personal records

const chrono = (history) => [...history].sort((a, b) => byRecent(b.workout, a.workout));

/**
 * Personal records from normal done sets. The first session that reached a value holds the record
 * (a later equal value does not replace it).
 * @param {{workout: object, entry: object}[]} history any order
 * @returns {{heaviest: {weight: number, reps: number, date: string, workoutId: string}|null,
 *   e1rm: {value: number, weight: number, reps: number, date: string, workoutId: string}|null,
 *   mostReps: {reps: number, weight: number, date: string, workoutId: string}|null,
 *   repsByWeight: {weight: number, reps: number, date: string, workoutId: string}[]}} repsByWeight heaviest first; weight 0 = bodyweight
 */
export function personalRecords(history) {
  let heaviest = null; let best = null; let mostReps = null;
  const byW = new Map();
  for (const { workout, entry } of chrono(history)) {
    const at = { date: workout.date, workoutId: workout.id };
    for (const s of normalDone(entry)) {
      if (!hasReps(s)) continue;
      const w = hasWeight(s) ? s.weight : 0;
      if (w > 0 && (!heaviest || w > heaviest.weight || (w === heaviest.weight && s.reps > heaviest.reps && heaviest.workoutId === at.workoutId))) {
        heaviest = { weight: w, reps: s.reps, ...at };
      }
      const v = round(e1rm(w, s.reps), 2);
      if (v > 0 && (!best || v > best.value)) best = { value: v, weight: w, reps: s.reps, ...at };
      if (!mostReps || s.reps > mostReps.reps) mostReps = { reps: s.reps, weight: w, ...at };
      const r = byW.get(w);
      if (!r || s.reps > r.reps) byW.set(w, { weight: w, reps: s.reps, ...at });
    }
  }
  return { heaviest, e1rm: best, mostReps, repsByWeight: [...byW.values()].sort((a, b) => b.weight - a.weight) };
}

/**
 * Records `entry` beats compared with `prior` history. Nothing on the first session ever.
 *   weight: top weight above every earlier weight;
 *   e1rm:   best estimated 1RM above every earlier one (weighted sets only);
 *   reps:   more reps at a weight than ever before at exactly that weight (heaviest such weight
 *           reported; bodyweight = weight 0). Not reported for the weight that is itself a new weight PR.
 * @returns {{kind: 'weight'|'e1rm'|'reps', weight: number, reps: number, value: number}[]}
 */
export function newRecords(prior, entry) {
  const pr = personalRecords(prior);
  if (!pr.mostReps) return [];
  const sets = normalDone(entry).filter(hasReps);
  if (!sets.length) return [];
  const out = [];
  const top = topSet(sets);
  if (top && top.weight > 0 && top.weight > (pr.heaviest ? pr.heaviest.weight : 0)) {
    out.push({ kind: 'weight', weight: top.weight, reps: top.reps, value: top.weight });
  }
  let bestSet = null;
  for (const s of sets) {
    const v = round(e1rm(s.weight, s.reps), 2);
    if (v > 0 && (!bestSet || v > bestSet.value)) bestSet = { value: v, weight: s.weight, reps: s.reps };
  }
  if (bestSet && pr.e1rm && bestSet.value > pr.e1rm.value) out.push({ kind: 'e1rm', ...bestSet });
  const prev = new Map(pr.repsByWeight.map((r) => [r.weight, r.reps]));
  let repPr = null;
  for (const s of sets) {
    const w = hasWeight(s) ? s.weight : 0;
    if (!prev.has(w) || s.reps <= prev.get(w)) continue;
    if (!repPr || w > repPr.weight || (w === repPr.weight && s.reps > repPr.reps)) repPr = { kind: 'reps', weight: w, reps: s.reps, value: s.reps };
  }
  if (repPr) out.push(repPr);
  return out;
}

/**
 * Sessions (ids) in which the exercise set at least one new record (first session excluded).
 * @returns {Map<string, ReturnType<typeof newRecords>>} workoutId -> records
 */
export function recordSessions(history) {
  const out = new Map();
  const list = chrono(history);
  for (let i = 1; i < list.length; i++) {
    const r = newRecords(list.slice(0, i), list[i].entry);
    if (r.length) out.set(list[i].workout.id, r);
  }
  return out;
}

// ---------------------------------------------------------------- charts

/**
 * Chronological points for an exercise's progress chart.
 * topWeight: top set weight (0 = bodyweight); topReps: reps of the top set; e1rm: best estimated 1RM;
 * load: volume load; reps: total normal reps; bestReps: most reps in one normal set.
 * @returns {{date: string, workoutId: string, topWeight: number, topReps: number, e1rm: number,
 *   load: number, reps: number, bestReps: number, sets: number, bodyweight: boolean}[]}
 */
export function exerciseSeries(history) {
  return chrono(history).map(({ workout, entry }) => {
    const m = entryMetrics(entry);
    const bestReps = normalDone(entry).reduce((a, s) => Math.max(a, hasReps(s) ? s.reps : 0), 0);
    return {
      date: workout.date, workoutId: workout.id,
      topWeight: m.top ? m.top.weight : 0, topReps: m.top ? m.top.reps : 0,
      e1rm: m.e1rm, load: m.load, reps: m.reps, bestReps, sets: m.sets, bodyweight: m.bodyweight,
    };
  }).filter((p) => p.sets > 0);
}

/** Range keys -> days back from today (inclusive). 'all' = no limit. */
export const RANGES = Object.freeze({ '3m': 91, '1y': 365, all: null });

/** Points with date >= today − days for the range. */
export function filterRange(points, range, todayStr) {
  const days = RANGES[range];
  if (!days) return [...points];
  const from = addDays(todayStr, -days);
  return points.filter((p) => p.date >= from);
}

/**
 * Change of `key` over chronological points: last vs first, and last vs the one before it.
 * @returns {{first: number|null, last: number|null, previous: number|null, rangePct: number|null, prevPct: number|null}}
 */
export function seriesChange(points, key) {
  const n = points.length;
  const v = (p) => (p && isNum(p[key]) ? p[key] : null);
  const first = n ? v(points[0]) : null;
  const last = n ? v(points[n - 1]) : null;
  const previous = n > 1 ? v(points[n - 2]) : null;
  return {
    first, last, previous,
    rangePct: n > 1 ? pctChange(last, first) : null,
    prevPct: n > 1 ? pctChange(last, previous) : null,
  };
}

// ---------------------------------------------------------------- live (session card)

/**
 * Live comparison while logging: the done normal sets so far vs the same number of sets last time
 * (the first k done normal sets of the last entry; all of them once you have done as many or more).
 * So ticking 1 of 3 sets compares set 1 with last time's set 1, and the value equals the full
 * comparison once every set is done.
 * @returns {{basis: 'load'|'reps', cur: number, prev: number, pct: number|null, trend: string, compared: number}|null}
 *   null when nothing is ticked yet or there is no last entry
 */
export function liveComparison(entry, lastEntry) {
  const cur = normalDone(entry);
  const last = normalDone(lastEntry);
  if (!cur.length || !last.length) return null;
  const slice = last.slice(0, cur.length);
  const bw = !cur.some(hasWeight) && !slice.some(hasWeight);
  const val = (sets) => (bw ? sets.reduce((a, s) => a + (hasReps(s) ? s.reps : 0), 0) : loadOf(sets));
  const c = val(cur);
  const p = val(slice);
  const pct = pctChange(c, p);
  return { basis: bw ? 'reps' : 'load', cur: c, prev: p, pct, trend: trendOf(pct), compared: slice.length };
}
