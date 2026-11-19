// Analysis hub aggregates: records over the whole history, routines, most-trained exercises, a
// month comparison and weekly sets per muscle. Pure, no DOM / IndexedDB. Thin layer over
// workout-analytics.js, workout-progress.js and volume.js; no new definitions:
//   - Records are exactly the 'pr' statuses of workout-analytics metricStatuses: a metric of a
//     finished, real session that beats the all-time best before it. "First time" is never a record;
//     a starting point is earlier history for the set metrics but never sets a record itself.
//     Computed in ONE chronological pass (running scopeBests per exercise) instead of re-scanning
//     the history for every session.
//   - Sessions, tonnage and counts leave starting points and unfinished workouts out.
//   - Everything is as of the data's own dates: a session is only compared with sessions before it.
import { byRecent, isLoggedWorkout } from './workout.js';
import { isBaseline } from './baseline.js';
import { sessionBests, compareBest, deltaOf, modeOf, METRICS, SESSION_METRICS, LOAD_METRICS, REPS_METRICS, monthOf } from './workout-analytics.js';
import { doneEntries, sessionTotals, pctChange, exerciseSeries, routineSessions } from './workout-progress.js';
import { muscleVolumeBreakdown } from './volume.js';
import { addDays, weekStart } from './dates.js';
import { MUSCLES } from './muscles.js';
import { round } from './numbers.js';

/** Logged finished workouts (isLoggedWorkout; starting point included), oldest first. */
const chronoFinished = (workouts) => (workouts || []).filter(isLoggedWorkout).sort((a, b) => byRecent(b, a));

/**
 * One pass over the finished history.
 * @returns {{
 *   records: {workoutId: string, date: string, exerciseId: string, metric: string, cur: object, prev: object, delta: object|null}[],
 *   byWorkout: Map<string, number>,
 *   histories: Map<string, {workout: object, entry: object}[]>,
 *   sessions: object[]
 * }} records oldest first (within a session: exercise order, then metric order); byWorkout = record
 *   count per session; histories = every exercise's finished entries (starting point included), oldest
 *   first; sessions = real finished sessions with at least one done set, oldest first
 */
export function scanHistory(workouts) {
  const best = new Map(); // exerciseId -> running all-time bests (scopeBests shape)
  const records = [];
  const byWorkout = new Map();
  const histories = new Map();
  const sessions = [];
  for (const w of chronoFinished(workouts)) {
    const base = isBaseline(w);
    const entries = doneEntries(w);
    if (!base && entries.size) sessions.push(w);
    let n = 0;
    for (const [exerciseId, entry] of entries) {
      if (!histories.has(exerciseId)) histories.set(exerciseId, []);
      histories.get(exerciseId).push({ workout: w, entry });
      let prev = best.get(exerciseId);
      if (!prev) { prev = Object.fromEntries(Object.keys(METRICS).map((k) => [k, null])); best.set(exerciseId, prev); }
      const cur = sessionBests(entry);
      if (!base) {
        for (const metric of modeOf(entry) === 'reps' ? REPS_METRICS : LOAD_METRICS) {
          const c = cur[metric];
          const p = prev[metric];
          if (c && p && compareBest(metric, c, p) > 0) {
            records.push({ workoutId: w.id, date: w.date, exerciseId, metric, cur: c, prev: p, delta: deltaOf(metric, c, p) });
            n++;
          }
        }
      }
      for (const k of Object.keys(METRICS)) {
        if (base && SESSION_METRICS.includes(k)) continue;
        if (cur[k] && compareBest(k, cur[k], prev[k]) > 0) prev[k] = { ...cur[k], date: w.date, workoutId: w.id, ...(base ? { baseline: true } : {}) };
      }
    }
    if (!base) byWorkout.set(w.id, n);
  }
  return { records, byWorkout, histories, sessions };
}

/** Preferred metric to name first when one session sets several records for an exercise. */
const LEAD = ['e1rm', 'heaviest', 'bwReps', 'tonnageSet', 'tonnage', 'bwTotal'];

/**
 * The latest records, newest first, grouped per session × exercise.
 * @param {ReturnType<typeof scanHistory>['records']} records oldest first
 * @returns {{workoutId: string, date: string, exerciseId: string, lead: object, others: object[]}[]}
 */
export function recentRecords(records, limit = 8) {
  const key = (r) => `${r.workoutId}\u0000${r.exerciseId}`;
  const wanted = new Set();
  for (let i = records.length - 1; i >= 0 && wanted.size < limit; i--) wanted.add(key(records[i]));
  const groups = new Map();
  const lastOfWorkout = new Map();
  records.forEach((r, i) => {
    lastOfWorkout.set(r.workoutId, i);
    const k = key(r);
    if (!wanted.has(k)) return;
    if (!groups.has(k)) groups.set(k, { workoutId: r.workoutId, date: r.date, exerciseId: r.exerciseId, list: [], first: i });
    groups.get(k).list.push(r);
  });
  // newest session first; within a session, the order the exercises were done
  return [...groups.values()]
    .sort((a, b) => lastOfWorkout.get(b.workoutId) - lastOfWorkout.get(a.workoutId) || a.first - b.first)
    .map((g) => {
      const list = [...g.list].sort((a, b) => LEAD.indexOf(a.metric) - LEAD.indexOf(b.metric));
      return { workoutId: g.workoutId, date: g.date, exerciseId: g.exerciseId, lead: list[0], others: list.slice(1) };
    });
}

/**
 * Sessions, tonnage and all-time records of real finished sessions dated within [from, to].
 * @param {object[]} sessions from scanHistory
 * @param {Map<string, number>} byWorkout from scanHistory
 */
export function periodTotals(sessions, byWorkout, from, to) {
  let n = 0; let tonnage = 0; let records = 0;
  for (const w of sessions) {
    if (w.date < from || w.date > to) continue;
    n++;
    tonnage += sessionTotals(w).load;
    records += byWorkout.get(w.id) || 0;
  }
  return { sessions: n, tonnage: round(tonnage, 2), records };
}

const lastDayOfMonth = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/**
 * This calendar month up to `today` versus the same days of the month before (1st to the same day,
 * capped at that month's length), so a month in progress is not compared with a whole month.
 * @returns {{cur: object, prev: object, curRange: {from, to}, prevRange: {from, to},
 *   pct: {sessions: number|null, tonnage: number|null, records: number|null}}}
 */
export function monthComparison(sessions, byWorkout, todayStr) {
  const month = monthOf(todayStr);
  const day = Number(todayStr.slice(8, 10));
  const prevMonth = monthOf(addDays(`${month}-01`, -1));
  const prevDay = Math.min(day, lastDayOfMonth(prevMonth));
  const curRange = { from: `${month}-01`, to: todayStr };
  const prevRange = { from: `${prevMonth}-01`, to: `${prevMonth}-${String(prevDay).padStart(2, '0')}` };
  const cur = periodTotals(sessions, byWorkout, curRange.from, curRange.to);
  const prev = periodTotals(sessions, byWorkout, prevRange.from, prevRange.to);
  return {
    month, prevMonth, cur, prev, curRange, prevRange,
    pct: {
      sessions: pctChange(cur.sessions, prev.sessions),
      tonnage: pctChange(cur.tonnage, prev.tonnage),
      records: pctChange(cur.records, prev.records),
    },
  };
}

/**
 * Per routine: finished sessions, the last one and its tonnage versus the session before
 * (the same numbers as routine progress).
 * @returns {{routineId: string, sessions: number, last: {workoutId: string, date: string, tonnage: number}|null,
 *   prevTonnage: number|null, pct: number|null, history: {workoutId: string, date: string, tonnage: number}[]}[]}
 *   history = up to the last 8 sessions, oldest first
 */
export function routineOverview(workouts, routines) {
  return (routines || []).map((r) => {
    const list = routineSessions(workouts, r.id);
    const tons = list.slice(0, 8).map((w) => ({ workoutId: w.id, date: w.date, tonnage: sessionTotals(w).load }));
    const last = tons[0] || null;
    const prevTonnage = tons[1] ? tons[1].tonnage : null;
    return {
      routineId: r.id, sessions: list.length, last, prevTonnage,
      pct: last && tons[1] ? pctChange(last.tonnage, prevTonnage) : null,
      history: tons.reverse(),
    };
  });
}

/**
 * Exercises trained most in the `weeks` weeks up to `today` (most sessions, then most sets), with
 * the best est. 1RM per session (most reps in a set for bodyweight exercises) over that window.
 * value = the latest session's; change = latest vs the first session in the window.
 * @param {ReturnType<typeof scanHistory>['histories']} histories
 * @returns {{exerciseId: string, sessions: number, sets: number, metric: 'e1rm'|'bestReps',
 *   points: {date: string, workoutId: string, value: number}[], value: number|null, first: number|null, pct: number|null}[]}
 */
export function topExercises(histories, todayStr, { weeks = 8, limit = 6 } = {}) {
  const from = addDays(todayStr, -(weeks * 7 - 1));
  const rows = [];
  for (const [exerciseId, hist] of histories) {
    const series = exerciseSeries(hist);
    const inWin = series.filter((p) => p.date >= from && p.date <= todayStr);
    if (!inWin.length) continue;
    const bw = series.every((p) => p.bodyweight);
    const metric = bw ? 'bestReps' : 'e1rm';
    const points = inWin.filter((p) => (bw ? true : !p.bodyweight)).map((p) => ({ date: p.date, workoutId: p.workoutId, value: p[metric] }));
    const value = points.length ? points[points.length - 1].value : null;
    const first = points.length ? points[0].value : null;
    rows.push({
      exerciseId, sessions: inWin.length, sets: inWin.reduce((a, p) => a + p.sets, 0), metric, points, value, first,
      pct: points.length > 1 ? pctChange(value, first) : null,
    });
  }
  rows.sort((a, b) => b.sessions - a.sessions || b.sets - a.sets || a.exerciseId.localeCompare(b.exerciseId));
  return rows.slice(0, limit);
}

/**
 * Weighted sets per muscle for the last `weeks` Mon–Sun weeks (the current one last), with the
 * direct / partial / drop breakdown of volume.js.
 * @returns {{weeks: {from: string, to: string}[], rows: {muscle: string, name: string,
 *   values: {total: number, direct: number, partial: number, drop: number}[], max: number}[]}}
 *   rows in the fixed muscle order; only muscles with a value in any week or a target
 */
export function weeklyMuscleSets(workouts, exercises, weights, todayStr, { weeks = 6, targets = {} } = {}) {
  const start = weekStart(todayStr);
  const ranges = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const from = addDays(start, -7 * i);
    ranges.push({ from, to: addDays(from, 6) });
  }
  const per = ranges.map((r) => muscleVolumeBreakdown(workouts, exercises, weights, r));
  const rows = MUSCLES.map((m) => {
    const values = per.map((b) => {
      const x = b[m.id];
      return x ? { total: x.total, direct: x.direct.value, partial: x.partial.value, drop: x.drop.value } : { total: 0, direct: 0, partial: 0, drop: 0 };
    });
    return { muscle: m.id, name: m.name, values, max: Math.max(0, ...values.map((v) => v.total)) };
  }).filter((r) => r.max > 0 || targets[r.muscle]);
  return { weeks: ranges, rows };
}
