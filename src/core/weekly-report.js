// Weekly report: one Monday–Sunday week of eating, body weight and training. Pure, no DOM / IndexedDB.
//
// Definitions (the report view repeats them in its footnotes):
//   - Week = Monday–Sunday (dates.js). Any date normalises to the Monday of its week.
//   - Counted days: every day of a past week; in the current ("in progress") week only the days
//     before today. Today's intake is never counted (it is not over yet), as everywhere in Trends.
//   - Logged day: a counted day with diary entries totalling more than 0 kcal.
//   - Complete day: a logged day that classifyIntake() (adaptive.js) does not call incomplete, i.e.
//     kcal ≥ 0.5 × the median logged day within ± 28 days. Incomplete days are shown but excluded
//     from averages, highest/lowest, on-target days and the weekly total.
//   - On-target day: a complete day whose kcal is within ± 10 % of the daily kcal target.
//   - Averages: kcal and macros averaged over complete days.
//   - Percent of target: whole percent via food-percent.percentOfTarget (null without a target).
//   - Macro split eaten: each macro's share of the energy of protein + carbs + fat (4/4/9 kcal/g),
//     whole percent by largest remainder so the three add up to 100.
//   - Targets for a past week: if targetHistory has a check-in record with weekStart ≤ the week, its
//     kcalTarget applies (macros from that record's proposal when it was accepted); otherwise the
//     current targets are used and labelled as such. Manual target changes are not recorded anywhere,
//     so a history-derived target can be wrong if targets were edited by hand in between.
//   - Weight: trend = EMA trend (adaptive.trendSeries) at the week's last counted date (today for the
//     current week, so it includes today's weigh-in), compared with the trend at the previous Sunday.
//   - Training: workouts dated in the week. Done = finished. Sets = done normal sets; volume load =
//     Σ weight × reps of done normal sets (workout-progress.js). Sets per muscle = volume.muscleVolume
//     (weighted, counts unfinished sessions too, as on the Workout screens).
//     The starting point (baseline.js isBaseline) is not a workout: it is never listed or counted
//     here; it only serves as earlier history for personal records.
//   - Percentage change = workout-progress.pctChange: previous missing / 0 → null ("–"), never NaN.
import { isBaseline } from './baseline.js';
import { isLoggedWorkout } from './workout.js';
import { addDays, weekStart, weekday, isValidDate, dateRange, daysBetween } from './dates.js';
import { sumEntries } from './nutrition.js';
import { percentOfTarget } from './food-percent.js';
import { classifyIntake, trendSeries, trendAt } from './adaptive.js';
import { muscleVolume, sanitiseTargets, targetProgress } from './volume.js';
import { sessionTotals, pctChange, exerciseHistory, recordSessions, doneEntries } from './workout-progress.js';
import { MUSCLES } from './muscles.js';
import { round, percent } from './numbers.js';

export const ON_TARGET_TOLERANCE = 0.1;
const MACRO_KCAL = { protein: 4, carbs: 4, fat: 9 };
const MACROS = ['protein', 'carbs', 'fat'];
const KEYS = ['kcal', 'protein', 'carbs', 'fat'];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const finite = (v) => (isNum(v) ? v : null);

/** Monday of the week containing `s`, or null for an invalid date. */
export function normaliseWeek(s) {
  return isValidDate(s) ? weekStart(s) : null;
}

/** 'past' | 'current' | 'future' relative to today. */
export function weekStatus(ws, today) {
  const cur = weekStart(today);
  return ws === cur ? 'current' : ws < cur ? 'past' : 'future';
}

/** The 7 dates Monday → Sunday. */
export function weekDates(ws) {
  return dateRange(ws, addDays(ws, 6));
}

/** Days of the week that count for intake: 7 for a past week, days before today for the current one. */
export function countedDays(ws, today) {
  const st = weekStatus(ws, today);
  return st === 'past' ? 7 : st === 'current' ? weekday(today) : 0;
}

/**
 * Whole-percent split (sums to 100) of macro energy. null when there is no macro energy.
 * @param {{protein?: number|null, carbs?: number|null, fat?: number|null}} grams
 */
export function macroSplit(grams) {
  if (!grams) return null;
  const kcal = MACROS.map((k) => (isNum(grams[k]) && grams[k] > 0 ? grams[k] * MACRO_KCAL[k] : 0));
  const total = kcal.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return null;
  const raw = kcal.map((v) => (v / total) * 100);
  const fl = raw.map((v) => Math.floor(v + 1e-9));
  let left = 100 - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => i).sort((a, b) => (raw[b] - fl[b]) - (raw[a] - fl[a]) || a - b);
  for (const i of order) { if (left <= 0) break; fl[i] += 1; left -= 1; }
  return { protein: fl[0], carbs: fl[1], fat: fl[2] };
}

/**
 * Targets in force for a week (see header).
 * @param {string} ws Monday
 * @param {string} today
 * @param {{kcal: number, protein: number, carbs: number, fat: number}} current settings.targets
 * @param {object[]} history targetHistory records (any order)
 * @returns {{kcal: number|null, protein: number|null, carbs: number|null, fat: number|null,
 *   source: 'current'|'history', macroSource: 'current'|'history', fromWeek: string|null}}
 */
export function targetsForWeek(ws, today, current, history) {
  const cur = {
    kcal: finite(current && current.kcal), protein: finite(current && current.protein),
    carbs: finite(current && current.carbs), fat: finite(current && current.fat),
  };
  const base = { ...cur, source: 'current', macroSource: 'current', fromWeek: null };
  if (weekStatus(ws, today) !== 'past') return base;
  const recs = (history || []).filter((h) => h && isValidDate(h.weekStart) && h.weekStart <= ws && isNum(h.kcalTarget))
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : (b.createdAt || 0) - (a.createdAt || 0)));
  const r = recs[0];
  if (!r) return base;
  const out = { ...cur, kcal: r.kcalTarget, source: 'history', macroSource: 'current', fromWeek: r.weekStart };
  // Macros: from the newest accepted proposal that set exactly this kcal target, at or before r.
  const acc = recs.find((h) => h.decision === 'accepted' && h.proposal && h.proposal.kcal === r.kcalTarget
    && MACROS.every((k) => isNum(h.proposal[k])));
  if (acc) {
    for (const k of MACROS) out[k] = acc.proposal[k];
    out.macroSource = 'history';
  }
  return out;
}

/** Group diary entries by date → per-day totals of kcal/protein/carbs/fat. */
function dayTotals(entries) {
  const byDate = new Map();
  for (const e of entries || []) {
    if (!e || !isValidDate(e.date)) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  const out = new Map();
  for (const [d, list] of byDate) {
    const t = sumEntries(list);
    out.set(d, { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
  }
  return out;
}

/** Map date → valid (complete) flag for logged days before today. */
function completeness(totals, today, config) {
  const intake = [...totals.entries()].map(([date, t]) => ({ date, kcal: t.kcal }));
  return new Map(classifyIntake(intake, today, config).map((r) => [r.date, r.valid]));
}

/**
 * Nutrition for one week.
 * @param {{ws: string, today: string, totals: Map<string, object>, valid: Map<string, boolean>, targets: object}} a
 */
function nutritionFor({ ws, today, totals, valid, targets }) {
  const counted = countedDays(ws, today);
  const kcalT = isNum(targets.kcal) && targets.kcal > 0 ? targets.kcal : null;
  const days = weekDates(ws).map((date) => {
    const t = totals.get(date) || null;
    const isToday = date === today;
    const isFuture = date > today;
    const logged = !!t && t.kcal > 0 && date < today;
    const complete = logged ? valid.get(date) === true : false;
    const onTarget = complete && kcalT !== null ? Math.abs(t.kcal - kcalT) <= ON_TARGET_TOLERANCE * kcalT : null;
    return {
      date, isToday, isFuture, logged, complete, incomplete: logged && !complete, onTarget: onTarget === null ? false : onTarget,
      kcal: t ? t.kcal : null, protein: t ? t.protein : null, carbs: t ? t.carbs : null, fat: t ? t.fat : null,
      pct: t ? percentOfTarget(t.kcal, kcalT) : null,
    };
  });
  const ok = days.filter((d) => d.complete);
  const avg = {};
  for (const k of KEYS) avg[k] = ok.length ? ok.reduce((s, d) => s + (d[k] || 0), 0) / ok.length : null;
  const pct = {}; const diff = {};
  for (const k of KEYS) {
    pct[k] = avg[k] === null ? null : percentOfTarget(avg[k], targets[k]);
    diff[k] = avg[k] !== null && isNum(targets[k]) ? avg[k] - targets[k] : null;
  }
  let highest = null; let lowest = null;
  for (const d of ok) {
    if (!highest || d.kcal > highest.kcal) highest = { date: d.date, kcal: d.kcal };
    if (!lowest || d.kcal < lowest.kcal) lowest = { date: d.date, kcal: d.kcal };
  }
  const totalKcal = ok.reduce((s, d) => s + d.kcal, 0);
  const totalTarget = kcalT !== null ? kcalT * ok.length : null;
  return {
    days, countedDays: counted,
    loggedDays: days.filter((d) => d.logged).length,
    completeDays: ok.length,
    incompleteDays: days.filter((d) => d.incomplete).length,
    onTargetDays: days.filter((d) => d.onTarget).length,
    avg, pct, diff, highest, lowest,
    total: {
      kcal: totalKcal, target: totalTarget, pct: totalTarget ? percentOfTarget(totalKcal, totalTarget) : null,
      weekTarget: kcalT !== null ? kcalT * 7 : null,
    },
    split: macroSplit(avg),
    targetSplit: macroSplit(targets),
    todaySoFar: days.find((d) => d.isToday && d.kcal) || null,
  };
}

/** Body weight for one week. */
function weightFor({ ws, today, weights, series, goalRate }) {
  const we = addDays(ws, 6);
  const end = we < today ? we : today;
  const ins = (weights || []).filter((w) => w && isValidDate(w.date) && isNum(w.kg) && w.date >= ws && w.date <= we)
    .map((w) => ({ date: w.date, kg: w.kg })).sort((a, b) => (a.date < b.date ? -1 : 1));
  const avg = ins.length ? ins.reduce((s, w) => s + w.kg, 0) / ins.length : null;
  const trendEnd = end >= ws ? trendAt(series, end) : null;
  const prevTrend = trendAt(series, addDays(ws, -1));
  const change = trendEnd !== null && prevTrend !== null ? trendEnd - prevTrend : null;
  const changePct = change !== null && prevTrend > 0 ? percent(change, prevTrend, 2) : null;
  const rate = isNum(goalRate) && goalRate !== 0 ? goalRate : null;
  const spanDays = end >= ws ? daysBetween(addDays(ws, -1), end) : 0;
  const expected = rate !== null ? (rate * spanDays) / 7 : null;
  return {
    weighIns: ins, count: ins.length, avg, trendEnd, trendEndDate: end >= ws ? end : null, prevTrend,
    change, changePct, goalRate: rate, expected,
    vsGoal: change !== null && expected !== null ? change - expected : null,
  };
}

/** A finished workout without any done set (isLoggedWorkout false): never counted. */
const emptyFinished = (w) => !!w.finishedAt && !isLoggedWorkout(w);

/** Workouts dated in [ws, we] with their totals. */
function weekWorkouts(workouts, ws) {
  const we = addDays(ws, 6);
  return (workouts || []).filter((w) => w && !isBaseline(w) && !emptyFinished(w) && typeof w.date === 'string' && w.date >= ws && w.date <= we)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : (a.startedAt || 0) - (b.startedAt || 0)));
}

function trainingTotals(list) {
  let sets = 0; let dropsets = 0; let load = 0;
  const rows = list.map((w) => {
    const t = sessionTotals(w);
    sets += t.sets; dropsets += t.dropsets; load += t.load;
    return { id: w.id, date: w.date, name: w.name || '', routineId: w.routineId || null, finished: !!w.finishedAt,
      sets: t.sets, dropsets: t.dropsets, load: t.load, exercises: t.exercises };
  });
  return { rows, sets, dropsets, load: round(load, 2), done: rows.filter((r) => r.finished).length };
}

/** Training for one week (+ previous for comparison). */
function trainingFor({ ws, workouts, exercises, volumeWeights, setTargets }) {
  const cur = trainingTotals(weekWorkouts(workouts, ws));
  const prev = trainingTotals(weekWorkouts(workouts, addDays(ws, -7)));
  const we = addDays(ws, 6);
  const vol = muscleVolume(workouts || [], exercises, volumeWeights, { from: ws, to: we });
  const pvol = muscleVolume(workouts || [], exercises, volumeWeights, { from: addDays(ws, -7), to: addDays(ws, -1) });
  const tg = sanitiseTargets(setTargets);
  const muscles = MUSCLES.map((m) => {
    const sets = vol[m.id] || 0;
    const tp = targetProgress(sets, tg[m.id]);
    return { muscle: m.id, name: m.name, sets, prev: pvol[m.id] || 0, target: tp ? tp.target : null, pct: tp ? tp.pct : null, reached: tp ? tp.reached : false };
  }).filter((r) => r.sets || r.prev || r.target);
  // Personal records set in this week's finished sessions.
  const get = exercises instanceof Map ? (id) => exercises.get(id) : (id) => (exercises || {})[id];
  const weekIds = new Set(cur.rows.map((r) => r.id));
  const exIds = new Set();
  for (const w of weekWorkouts(workouts, ws)) if (w.finishedAt) for (const id of doneEntries(w).keys()) exIds.add(id);
  const records = [];
  for (const exId of exIds) {
    const recs = recordSessions(exerciseHistory(workouts || [], exId));
    for (const [wid, list] of recs) {
      if (!weekIds.has(wid)) continue;
      const w = cur.rows.find((r) => r.id === wid);
      const ex = get(exId);
      records.push({ exerciseId: exId, name: ex ? ex.name : 'Deleted exercise', workoutId: wid, date: w.date, records: list });
    }
  }
  records.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  return {
    workouts: cur.rows, done: cur.done, sets: cur.sets, dropsets: cur.dropsets, load: cur.load,
    prev: { done: prev.done, sets: prev.sets, load: prev.load, count: prev.rows.length },
    loadPct: pctChange(cur.load, prev.load), setsPct: pctChange(cur.sets, prev.sets),
    muscles, hasTargets: Object.keys(tg).length > 0, records,
  };
}

/**
 * Week-over-week table rows. pct = pctChange (null-safe), diff = cur − prev (null if either missing).
 * @returns {{key: string, label: string, unit: string, cur: number|null, prev: number|null, diff: number|null, pct: number|null}[]}
 */
export function compareWeeks(cur, prev) {
  const row = (key, label, unit, c, p) => {
    const cc = finite(c); const pp = finite(p);
    return { key, label, unit, cur: cc, prev: pp, diff: cc !== null && pp !== null ? cc - pp : null, pct: pctChange(cc, pp) };
  };
  const n = (r) => (r ? r.nutrition : null);
  const w = (r) => (r ? r.weight : null);
  const t = (r) => (r ? r.training : null);
  const g = (r, f) => (r ? f(r) : null);
  return [
    row('kcal', 'Avg calories', 'kcal', g(n(cur), (x) => x.avg.kcal), g(n(prev), (x) => x.avg.kcal)),
    row('protein', 'Avg protein', 'g', g(n(cur), (x) => x.avg.protein), g(n(prev), (x) => x.avg.protein)),
    row('carbs', 'Avg carbs', 'g', g(n(cur), (x) => x.avg.carbs), g(n(prev), (x) => x.avg.carbs)),
    row('fat', 'Avg fat', 'g', g(n(cur), (x) => x.avg.fat), g(n(prev), (x) => x.avg.fat)),
    row('completeDays', 'Complete days', '', g(n(cur), (x) => x.completeDays), g(n(prev), (x) => x.completeDays)),
    row('onTarget', 'On-target days', '', g(n(cur), (x) => x.onTargetDays), g(n(prev), (x) => x.onTargetDays)),
    row('avgWeight', 'Avg weight', 'kg', g(w(cur), (x) => x.avg), g(w(prev), (x) => x.avg)),
    row('trend', 'Trend weight', 'kg', g(w(cur), (x) => x.trendEnd), g(w(prev), (x) => x.trendEnd)),
    row('workouts', 'Workouts', '', g(t(cur), (x) => x.done), g(t(prev), (x) => x.done)),
    row('sets', 'Sets', '', g(t(cur), (x) => x.sets), g(t(prev), (x) => x.sets)),
    row('load', 'Tonnage', 'kg', g(t(cur), (x) => x.load), g(t(prev), (x) => x.load)),
  ];
}

/**
 * Report for one week, with the previous week computed the same way for comparison.
 * Pass diary entries from at least 5 weeks before to 5 weeks after the week (median context for
 * classifyIntake), all weights, and all workouts (records need the whole history).
 * @param {{weekStart: string, today: string, entries: object[], weights: object[], workouts: object[],
 *   exercises: Map<string, object>|Record<string, object>, targets: object, history?: object[],
 *   goal?: {rateKgPerWeek?: number}, volumeWeights?: object, setTargets?: any, config?: object}} a
 */
export function buildWeeklyReport(a) {
  const ws = normaliseWeek(a.weekStart);
  if (!ws) throw new Error(`Invalid week: ${a.weekStart}`);
  const totals = dayTotals(a.entries);
  const valid = completeness(totals, a.today, a.config);
  const series = trendSeries(a.weights || [], a.config);
  const goalRate = a.goal ? a.goal.rateKgPerWeek : null;
  const one = (w) => {
    const targets = targetsForWeek(w, a.today, a.targets, a.history);
    return {
      weekStart: w, weekEnd: addDays(w, 6), status: weekStatus(w, a.today), targets,
      nutrition: nutritionFor({ ws: w, today: a.today, totals, valid, targets }),
      weight: weightFor({ ws: w, today: a.today, weights: a.weights, series, goalRate }),
    };
  };
  const cur = one(ws);
  const prevWs = addDays(ws, -7);
  const prev = one(prevWs);
  cur.training = trainingFor({ ws, workouts: a.workouts, exercises: a.exercises, volumeWeights: a.volumeWeights, setTargets: a.setTargets });
  prev.training = trainingFor({ ws: prevWs, workouts: a.workouts, exercises: a.exercises, volumeWeights: a.volumeWeights, setTargets: a.setTargets });
  const prevHasData = hasData(prev);
  const checkIn = (a.history || []).filter((h) => h && h.weekStart === ws)
    .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0))[0] || null;
  return {
    ...cur,
    hasData: hasData(cur),
    previous: prevHasData ? prev : null,
    comparison: compareWeeks(cur, prevHasData ? prev : null),
    checkIn,
  };
}

/** Anything logged in the week: a diary day (today included), a weigh-in or a workout. */
function hasData(r) {
  return r.nutrition.days.some((d) => d.kcal) || r.weight.count > 0 || r.training.workouts.length > 0;
}

/**
 * One-line summaries for every week that has any data, plus the current week, newest first.
 * @param {{today: string, entries: object[], weights: object[], workouts: object[], config?: object}} a
 * @returns {{weekStart: string, weekEnd: string, status: string, loggedDays: number, completeDays: number,
 *   countedDays: number, avgKcal: number|null, workouts: number, weighIns: number, avgWeight: number|null, hasData: boolean}[]}
 */
export function weekSummaries({ today, entries, weights, workouts, config }) {
  const totals = dayTotals(entries);
  const valid = completeness(totals, today, config);
  const weeks = new Map();
  const touch = (date) => {
    if (!isValidDate(date) || date > today && weekStart(date) > weekStart(today)) return null;
    const ws = weekStart(date);
    if (!weeks.has(ws)) weeks.set(ws, { logged: 0, complete: 0, kcal: 0, workouts: 0, sessions: 0, weighIns: 0, kg: 0, any: false });
    return weeks.get(ws);
  };
  for (const [date, t] of totals) {
    const w = touch(date);
    if (!w || !(t.kcal > 0)) continue;
    w.any = true;
    if (date >= today) continue;
    w.logged++;
    if (valid.get(date)) { w.complete++; w.kcal += t.kcal; }
  }
  for (const r of weights || []) {
    if (!r || !isNum(r.kg)) continue;
    const w = touch(r.date);
    if (!w) continue;
    w.any = true; w.weighIns++; w.kg += r.kg;
  }
  for (const r of workouts || []) {
    const w = r && !isBaseline(r) && !emptyFinished(r) && touch(r.date);
    if (!w) continue;
    w.any = true; w.sessions++;
    if (r.finishedAt) w.workouts++;
  }
  touch(today);
  return [...weeks.entries()].filter(([ws, w]) => w.any || ws === weekStart(today))
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([ws, w]) => ({
      weekStart: ws, weekEnd: addDays(ws, 6), status: weekStatus(ws, today),
      loggedDays: w.logged, completeDays: w.complete, countedDays: countedDays(ws, today),
      avgKcal: w.complete ? w.kcal / w.complete : null, workouts: w.workouts, sessions: w.sessions,
      weighIns: w.weighIns, avgWeight: w.weighIns ? w.kg / w.weighIns : null, hasData: w.any,
    }));
}

