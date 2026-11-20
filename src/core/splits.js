// Split library logic (docs/SPLITS.md). Pure, no DOM / IndexedDB.
//
// Filter:   filterSplits(splits, { days, style, level, equipment }) — every given (non-null) field must match.
//
// Coverage: splitCoverage(sessions, perWeek, exercises, weights) counts the planned week with the app's
//           own rule (src/core/volume.js muscleVolumeBreakdown): each planned set is a done normal set;
//           direct = sets × weights.primary for every primary muscle, partial = sets × weights.secondary
//           for every secondary muscle; each session counts perWeek = days / sessions.length times.
//           daysHit = sessions per week in which the muscle is a primary muscle of at least one exercise.
//
// Volume level (applied per session item, before coverage and routines):
//   standard  the catalogue as written.
//   minimum   −1 set on every exercise, never below 1.
//   high      +1 set on the first exercise of the session for each of its primary muscles (an exercise
//             gets at most +1), never above MAX_SETS. A muscle trained n times a week thus gets about
//             +n direct sets a week, and no session gets more than one extra set per muscle.
//
// Alternatives: candidates for swapping an exercise, by movement pattern first (see alternatives()).
//
// Rotation ("next up"): nextUp(active, workouts) → rotationNext(), recomputed from history every time:
//   logged workouts of rotation routines and Next up skips, oldest first by date then time; a workout
//   moves the position to just after the nearest occurrence of its routine at or after the current
//   position (in order: +1; out of order: continue after the session done), a skip moves it on by one.
//   Wraps; none yet → first. Workouts of other routines do not move the rotation.
//
// Custom splits (the user's own rotation of routines): cleanCustomSplits, rotationCoverage,
//   coverageNotes, rotationState — see the section at the end.
import { MUSCLE_IDS } from './muscles.js';
import { muscleVolumeBreakdown, volumeWeights, sanitiseTargets } from './volume.js';
import { bandStep, bandLegend, WEEK_BAND_EDGES } from './set-bands.js';
import { isLoggedWorkout } from './workout.js';
import { round } from './numbers.js';
import { isBaseline } from './baseline.js';
import { compareUsage } from './exercise-usage.js';
import { BASE_LIFTS, EXERCISE_PATTERN, RELATED_PATTERNS, fitsHome } from '../data/exercises.js';
import { HOME_EQUIPMENT } from '../data/splits.js';

export const VOLUME_LEVELS = Object.freeze(['minimum', 'standard', 'high']);
export const MIN_SETS = 1;
export const MAX_SETS = 5;
/** Muscles with fewer planned weekly sets than this get no weekly target on adopt. */
export const TARGET_MIN_SETS = 4;
/** Settings key of the followed split. */
export const ACTIVE_SPLIT_KEY = 'activeSplit';

// ---------------------------------------------------------------- filter

/**
 * @param {readonly object[]} splits
 * @param {{days?: number|null, style?: string|null, level?: string|null, equipment?: string|null}} [f]
 */
export function filterSplits(splits, f = {}) {
  return splits.filter((sp) => (f.days == null || sp.days === f.days)
    && (f.style == null || sp.style === f.style)
    && (f.level == null || sp.level === f.level)
    && (f.equipment == null || sp.equipment === f.equipment));
}

/** Sessions of a split per week each distinct session is done (2 for A/B in a 4-day split). */
export function perWeek(split) {
  return split.sessions.length ? split.days / split.sessions.length : 0;
}

// ---------------------------------------------------------------- volume level

/**
 * The sessions with the volume level applied (new arrays; items keep every other field).
 * @param {readonly {items: readonly {exerciseId: string, sets: number}[]}[]} sessions
 * @param {'minimum'|'standard'|'high'} level
 * @param {Map<string, object>|Record<string, object>} exercises needed for 'high' (primary muscles)
 */
export function applyLevel(sessions, level, exercises) {
  const get = lookup(exercises);
  return sessions.map((s) => {
    const seen = new Set();
    const items = s.items.map((it) => {
      let sets = it.sets;
      if (level === 'minimum') sets = Math.max(MIN_SETS, sets - 1);
      else if (level === 'high') {
        const prim = (get(it.exerciseId) || {}).primary || [];
        const first = prim.some((m) => !seen.has(m));
        for (const m of prim) seen.add(m);
        if (first) sets = Math.min(MAX_SETS, sets + 1);
      }
      return { ...it, sets };
    });
    return { ...s, items };
  });
}

// ---------------------------------------------------------------- coverage

function lookup(exercises) {
  if (!exercises) return () => undefined;
  return exercises instanceof Map ? (id) => exercises.get(id) : (id) => exercises[id];
}

/**
 * Weekly sets per muscle for planned sessions (see the header).
 * @param {readonly {items: readonly {exerciseId: string, sets: number}[]}[]} sessions
 * @param {number} times how often each session is done per week
 * @param {Map<string, object>|Record<string, object>} exercises
 * @param {{primary?: number, secondary?: number, dropset?: number}} weights settings.volume
 * @returns {Record<string, {total: number, direct: number, partial: number, directSets: number, partialSets: number, daysHit: number}>}
 *   every muscle id (zeros included)
 */
export function splitCoverage(sessions, times, exercises, weights) {
  const get = lookup(exercises);
  const workouts = [];
  for (const s of sessions) {
    for (let k = 0; k < times; k++) {
      workouts.push({
        date: '2000-01-01',
        exercises: s.items.map((it) => ({
          exerciseId: it.exerciseId,
          sets: Array.from({ length: Math.max(0, it.sets | 0) }, () => ({ type: 'normal', done: true })),
        })),
      });
    }
  }
  const b = muscleVolumeBreakdown(workouts, exercises, volumeWeights(weights), { from: '2000-01-01', to: '2000-01-01' });
  const out = {};
  for (const m of MUSCLE_IDS) {
    const r = b[m];
    let daysHit = 0;
    for (const s of sessions) if (s.items.some((it) => ((get(it.exerciseId) || {}).primary || []).includes(m))) daysHit += times;
    out[m] = {
      total: r ? r.total : 0,
      direct: r ? r.direct.value : 0,
      partial: r ? r.partial.value : 0,
      directSets: r ? r.direct.sets : 0,
      partialSets: r ? r.partial.sets : 0,
      daysHit,
    };
  }
  return out;
}

/**
 * Body-map step 0–4 for a planned weekly total, fixed bands of weighted sets (set-bands.js, week):
 * ≥ 12 → 4, ≥ 8 → 3, ≥ 4 → 2, > 0 → 1, 0 → 0. (The split is not the user's week, so the map shows
 * planned sets, not progress towards the user's targets; the Sets list shows those.)
 */
export function coverageStep(total) {
  return bandStep(total, WEEK_BAND_EDGES);
}

/**
 * Legend of coverageStep (highest first): '12+', '8–11.5', '4–7.5', 'Under 4', 'None' (see bandLegend).
 * @param {{primary?: number, secondary?: number}} [weights] settings.volume
 */
export function coverageBands(weights) {
  return bandLegend(weights, WEEK_BAND_EDGES);
}

/** Bands with the default set weighting (kept for callers without weights). */
export const COVERAGE_BANDS = Object.freeze(coverageBands({}).map(Object.freeze));

/**
 * Weekly set targets from a coverage: every muscle with total ≥ TARGET_MIN_SETS, rounded to whole sets.
 * @returns {Record<string, number>} (sanitised like the stored setting)
 */
export function targetsFromCoverage(coverage) {
  const out = {};
  for (const m of MUSCLE_IDS) {
    const t = coverage[m] ? coverage[m].total : 0;
    if (t >= TARGET_MIN_SETS) out[m] = Math.round(t);
  }
  return sanitiseTargets(out);
}

// ---------------------------------------------------------------- resolve (level + swaps)

/**
 * The split as it would be adopted: volume level applied, swaps applied.
 * swaps: { '<sessionId>:<index>': exerciseId }.
 * @returns {{id: string, name: string, items: {exerciseId: string, sets: number, reps: number, repsMax: number|null, original: string}[]}[]}
 */
export function resolveSessions(split, { level = 'standard', swaps = {}, exercises } = {}) {
  const swapped = split.sessions.map((s) => ({
    ...s,
    items: s.items.map((it, i) => {
      const to = swaps && swaps[`${s.id}:${i}`];
      return { ...it, original: it.exerciseId, exerciseId: typeof to === 'string' && to ? to : it.exerciseId };
    }),
  }));
  return applyLevel(swapped, VOLUME_LEVELS.includes(level) ? level : 'standard', exercises);
}

/**
 * Routine records (SPEC §3 shape + splitId) for the resolved sessions. Ids/timestamps are passed in.
 * @param {object} split
 * @param {ReturnType<typeof resolveSessions>} sessions
 * @param {{ids: string[], now: number, firstOrder: number}} opts
 */
export function splitRoutines(split, sessions, { ids, now, firstOrder }) {
  return sessions.map((s, i) => ({
    id: ids[i],
    name: s.name,
    order: firstOrder + i,
    splitId: split.id,
    items: s.items.map((it) => ({
      exerciseId: it.exerciseId,
      targetSets: it.sets,
      targetReps: it.reps,
      targetRepsMax: typeof it.repsMax === 'number' && it.repsMax > it.reps ? it.repsMax : null,
    })),
    createdAt: now,
    updatedAt: now,
  }));
}

// ---------------------------------------------------------------- alternatives

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const overlap = (a, b) => a.filter((x) => b.includes(x)).length;

/** Movement pattern of an exercise (seed classification; custom exercises: null). */
export function patternOf(ex) {
  return (ex && EXERCISE_PATTERN[ex.id]) || null;
}

/** Home splits: seed exercises by the gear they need; custom exercises by equipment type. */
function homeOk(e) {
  return EXERCISE_PATTERN[e.id] ? fitsHome(e) : HOME_EQUIPMENT.includes(e.equipment);
}

/**
 * Swap candidates for `exerciseId`, best first. Candidates: not archived, not the exercise itself,
 * not already in the session (`exclude`), at least one primary muscle in common; with `homeOnly`
 * only what dumbbells, a bench and a pull-up bar allow (exerciseGear in src/data/exercises.js).
 * Custom exercises take part like seeded ones.
 *
 * Movement pattern (src/data/exercises.js EXERCISE_PATTERN): tier 2 = same pattern, tier 1 = a related
 * pattern (RELATED_PATTERNS) or a custom exercise (no pattern) with the same primary muscles, tier 0 =
 * any other exercise sharing a primary muscle. The default list holds tiers 2 and 1 and never an
 * exercise whose pattern another exercise of the session already has; `showAll` lists every tier and
 * pattern. An exercise without a pattern (custom) falls back to the muscle rule: every candidate.
 * Order:
 *   0. higher tier first;
 *   1. same primary muscles (as a set) before partial overlap, then more shared primary muscles;
 *   2. exercises the user has logged before unused ones (most recent first, then most often);
 *   3. same equipment first;
 *   4. more shared secondary muscles;
 *   5. common base lifts; 6. name.
 * @param {string} exerciseId
 * @param {{exercises: Map<string, object>, usage?: Map<string, object>, exclude?: Iterable<string>, homeOnly?: boolean, limit?: number, showAll?: boolean}} opts
 * @returns {object[]} exercise records
 */
export function alternatives(exerciseId, { exercises, usage = new Map(), exclude = [], homeOnly = false, limit = 12, showAll = false }) {
  const orig = exercises.get(exerciseId);
  if (!orig) return [];
  const prim = orig.primary || [];
  const sec = orig.secondary || [];
  const own = patternOf(orig);
  const related = own ? RELATED_PATTERNS[own] || [] : [];
  const skip = new Set(exclude);
  skip.add(exerciseId);
  // patterns the rest of the session already trains (the swapped exercise's own pattern stays open)
  const taken = new Set();
  for (const id of skip) {
    const p = id === exerciseId ? null : patternOf(exercises.get(id));
    if (p && p !== own) taken.add(p);
  }
  const rows = [];
  for (const e of exercises.values()) {
    if (!e || e.archived || skip.has(e.id)) continue;
    if (homeOnly && !homeOk(e)) continue;
    const p = overlap(e.primary || [], prim);
    if (!p) continue;
    const exact = sameSet(e.primary || [], prim) ? 1 : 0;
    const pat = patternOf(e);
    let tier;
    if (!own) tier = 1; // custom original: the muscle rule
    else if (pat === own) tier = 2;
    else if (pat ? related.includes(pat) : exact) tier = 1;
    else tier = 0;
    if (!showAll && (tier === 0 || (pat && taken.has(pat)))) continue;
    rows.push({ e, tier, exact, p, used: usage.get(e.id),
      eq: e.equipment === orig.equipment ? 1 : 0, s: overlap(e.secondary || [], sec) });
  }
  rows.sort((a, b) => (b.tier - a.tier) || (b.exact - a.exact) || (b.p - a.p) || compareUsage(a.used, b.used) || (b.eq - a.eq) || (b.s - a.s)
    || (BASE_LIFTS.has(b.e.id) - BASE_LIFTS.has(a.e.id)) || a.e.name.localeCompare(b.e.name));
  return rows.slice(0, limit).map((r) => r.e);
}

/**
 * Swaps for catalogue exercises the user archived or deleted: the best alternative (gym splits
 * prefer the same equipment through the ranking; home splits stay home). Existing swaps are kept.
 * @returns {Record<string, string>} new swaps object
 */
export function autoSwaps(split, { exercises, usage, swaps = {} }) {
  const out = { ...swaps };
  for (const s of split.sessions) {
    s.items.forEach((it, i) => {
      const key = `${s.id}:${i}`;
      const cur = out[key] || it.exerciseId;
      const ex = exercises.get(cur);
      if (ex && !ex.archived) return;
      const exclude = s.items.map((x, j) => out[`${s.id}:${j}`] || x.exerciseId);
      const o = { exercises, usage, exclude, homeOnly: split.equipment === 'home', limit: 1 };
      const alt = ex ? alternatives(cur, o)[0] || alternatives(cur, { ...o, showAll: true })[0] : null;
      if (alt) out[key] = alt.id;
    });
  }
  return out;
}

// ---------------------------------------------------------------- rotation

/** Most skips kept in activeSplit (older ones are dropped; they no longer change the position much). */
export const MAX_SKIPS = 60;

/**
 * Clean a stored activeSplit setting.
 * Library split (the shape since 0.6.0, no `kind`): { splitId, level, routineIds, adoptedAt }.
 * Custom split: { kind: 'custom', splitId: 'custom:…', level: 'standard', routineIds, adoptedAt } —
 * routineIds is a copy of the custom split's rotation at the last save (readers that know custom splits
 * use the live rotation, see store.js loadActiveSplit).
 * Both may carry `skips: [{ date: 'YYYY-MM-DD', at: ms }]` (Next up › Skip; see rotationNext). Old values
 * without `kind` / `skips` stay valid; the keys are only present when used.
 * @returns {{splitId: string, level: string, routineIds: string[], adoptedAt: number, kind?: 'custom', skips?: {date: string, at: number}[]}|null}
 */
export function cleanActiveSplit(v) {
  if (!v || typeof v !== 'object' || typeof v.splitId !== 'string' || !Array.isArray(v.routineIds)) return null;
  const routineIds = v.routineIds.filter((id) => typeof id === 'string' && id);
  if (!routineIds.length) return null;
  const out = {
    splitId: v.splitId,
    level: VOLUME_LEVELS.includes(v.level) ? v.level : 'standard',
    routineIds,
    adoptedAt: typeof v.adoptedAt === 'number' ? v.adoptedAt : 0,
  };
  if (v.kind === 'custom' || isCustomSplitId(v.splitId)) out.kind = 'custom';
  const skips = cleanSkips(v.skips);
  if (skips.length) out.skips = skips;
  return out;
}

/** Valid skips, oldest first, at most MAX_SKIPS (the newest). */
export function cleanSkips(v) {
  return (Array.isArray(v) ? v : [])
    .filter((x) => x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.at))
    .map((x) => ({ date: x.date, at: x.at }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at - b.at))
    .slice(-MAX_SKIPS);
}

/**
 * Next routine of the followed split (see rotationNext for the rule).
 * @param {{routineIds: string[], skips?: {date: string, at: number}[]}} active
 * @param {object[]} workouts
 * @param {Set<string>|null} [existing] routine ids that still exist; deleted ones leave the rotation
 * @returns {{routineId: string, index: number, count: number, lastIndex: number|null}|null}
 *   index within the (remaining) rotation; null when no routine is left
 */
export function nextUp(active, workouts, existing = null) {
  return rotationNext(active && active.routineIds ? active.routineIds : [], workouts, { existing, skips: active && active.skips });
}

/**
 * Position in a fixed rotation, always recomputed from history (nothing is counted or stored, so
 * backdating, changing a workout's date, editing or deleting a workout gives the same result as if
 * history had always been that way).
 *
 * Events, oldest first by workout date, then start time (finish time breaks ties):
 *   - every logged workout (isLoggedWorkout: finished with ≥ 1 done set; never the starting point,
 *     never empty, unfinished or discarded ones) whose routine is in the rotation, and
 *   - every Next up skip ({ date, at }: the day and moment the user skipped).
 * Starting at position 0:
 *   - a workout of routine R moves the position to just after the occurrence of R nearest at or after
 *     the current position (wrapping). Done in order, that is the expected session (+1); done out of
 *     order, the rotation continues after the session actually done. With a routine that appears several
 *     times (Upper, Lower, Upper, Lower) the nearest occurrence ahead is the one meant;
 *   - a skip moves the position on by one.
 * Wraps around. Workouts of other routines never move it. Deleted routines leave the rotation first
 * (positions count the remaining ones). The rotation order is read as it is now, so reordering takes
 * effect at once. Without repeated routines the result is "the session after the most recent one"
 * (the 0.6.0 rule), plus skips after it.
 * @param {readonly string[]} routineIds rotation order
 * @param {object[]} workouts
 * @param {{existing?: Set<string>|null, skips?: {date: string, at: number}[]|null}} [opts]
 * @returns {{routineId: string, index: number, count: number, lastIndex: number|null}|null}
 */
export function rotationNext(routineIds, workouts, { existing = null, skips = null } = {}) {
  const ids = (routineIds || []).filter((id) => typeof id === 'string' && id && (!existing || existing.has(id)));
  if (!ids.length) return null;
  const n = ids.length;
  const inRotation = new Set(ids);
  const events = [];
  for (const w of workouts || []) {
    if (!w || isBaseline(w) || !isLoggedWorkout(w) || !inRotation.has(w.routineId) || typeof w.date !== 'string') continue;
    events.push({ date: w.date, t: w.startedAt || 0, t2: w.finishedAt || 0, routineId: w.routineId });
  }
  for (const s of cleanSkips(skips)) events.push({ date: s.date, t: s.at, t2: s.at, routineId: null });
  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.t - b.t) || (a.t2 - b.t2)));
  let p = 0;
  let lastIndex = null;
  for (const e of events) {
    if (e.routineId === null) { p = (p + 1) % n; continue; }
    let d = 0;
    while (ids[(p + d) % n] !== e.routineId) d++;
    lastIndex = (p + d) % n;
    p = (lastIndex + 1) % n;
  }
  return { routineId: ids[p], index: p, count: n, lastIndex };
}

// ---------------------------------------------------------------- custom splits
//
// A custom split is the user's own fixed rotation of ordinary routines (docs/SPLITS.md › Custom splits),
// stored in the setting CUSTOM_SPLITS_KEY as an array of
//   { id: 'custom:<uuid>', name, sessionsPerWeek: 1–7 | null, sessions: [routineId …], createdAt, updatedAt,
//     sourceSplitId?: library split id it was copied from }
// sessions: rotation order; a routine may appear several times; ids of deleted routines stay until the
// user removes or replaces them (they show as missing, coverage and Next up skip them).
// sessionsPerWeek: null = the rotation length (capped at 7); a number = how many sessions a week the user
// trains, which need not match the rotation (3 sessions trained 4 days a week).

export const CUSTOM_SPLITS_KEY = 'customSplits';
export const CUSTOM_PREFIX = 'custom:';
export const MIN_PER_WEEK = 1;
export const MAX_PER_WEEK = 7;
export const MAX_ROTATION = 21;
export const MAX_NAME = 60;

/** true for ids of custom splits ('custom:…'); library ids never have the prefix. */
export function isCustomSplitId(id) {
  return typeof id === 'string' && id.startsWith(CUSTOM_PREFIX) && id.length > CUSTOM_PREFIX.length;
}

const isPerWeek = (n) => Number.isInteger(n) && n >= MIN_PER_WEEK && n <= MAX_PER_WEEK;

/**
 * Validate one stored custom split. Invalid records → null; fixable fields are fixed: name trimmed (empty →
 * 'My split', ≤ MAX_NAME), sessionsPerWeek outside 1–7 → null, non-string session ids dropped, rotation
 * capped at MAX_ROTATION, timestamps default 0.
 * @returns {{id: string, name: string, sessionsPerWeek: number|null, sessions: string[], createdAt: number, updatedAt: number, sourceSplitId?: string}|null}
 */
export function cleanCustomSplit(v) {
  if (!v || typeof v !== 'object' || !isCustomSplitId(v.id)) return null;
  const name = (typeof v.name === 'string' ? v.name.trim() : '').slice(0, MAX_NAME) || 'My split';
  const sessions = (Array.isArray(v.sessions) ? v.sessions : []).filter((id) => typeof id === 'string' && id).slice(0, MAX_ROTATION);
  const out = {
    id: v.id,
    name,
    sessionsPerWeek: isPerWeek(v.sessionsPerWeek) ? v.sessionsPerWeek : null,
    sessions,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : 0,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : 0,
  };
  if (typeof v.sourceSplitId === 'string' && v.sourceSplitId) out.sourceSplitId = v.sourceSplitId;
  return out;
}

/** The stored list, cleaned; duplicates of an id keep the first. @returns {ReturnType<typeof cleanCustomSplit>[]} */
export function cleanCustomSplits(v) {
  const seen = new Set();
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    const c = cleanCustomSplit(x);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Sessions trained per week: the stored number, else the rotation length (1–7). */
export function sessionsPerWeekOf(cs) {
  if (cs && isPerWeek(cs.sessionsPerWeek)) return cs.sessionsPerWeek;
  const n = cs && Array.isArray(cs.sessions) ? cs.sessions.length : 0;
  return Math.min(MAX_PER_WEEK, Math.max(MIN_PER_WEEK, n));
}

/**
 * Rotation state against the routines that exist.
 * @param {{sessions: string[]}} cs
 * @param {Set<string>|Map<string, any>} existing routine ids
 * @returns {{ids: string[], missing: number[], ok: boolean}} ids = present ones in order; missing = positions
 *   (0-based) of deleted routines; ok = at least one session can be trained
 */
export function rotationState(cs, existing) {
  const ids = [];
  const missing = [];
  (cs && cs.sessions ? cs.sessions : []).forEach((id, i) => { if (existing.has(id)) ids.push(id); else missing.push(i); });
  return { ids, missing, ok: ids.length > 0 };
}

/** All routine ids used by custom splits (never deleted by "Replace" when a library split is adopted). */
export function customRoutineIds(customSplits) {
  const out = new Set();
  for (const cs of customSplits || []) for (const id of cs.sessions || []) out.add(id);
  return out;
}

/** A routine as a planned session for coverage: { id, name, items: [{ exerciseId, sets }] }. */
export function routineAsSession(routine) {
  return {
    id: routine.id,
    name: routine.name,
    items: (routine.items || []).filter((it) => it && typeof it.exerciseId === 'string')
      .map((it) => ({ exerciseId: it.exerciseId, sets: Number.isInteger(it.targetSets) && it.targetSets > 0 ? it.targetSets : 0 })),
  };
}

/**
 * Weekly sets per muscle of a rotation trained `sessionsPerWeek` times a week. Each position is done
 * sessionsPerWeek / rotation length times a week, so a session's weekly frequency is that times its
 * occurrences in the rotation. Counting per session is splitCoverage's (direct = sets × primary weight,
 * partial = sets × secondary weight); results are summed and rounded to 2 decimals. daysHit = sessions per
 * week in which the muscle is a primary muscle (may be fractional, e.g. 1.33).
 * For a library split (distinct sessions, days per week) this equals splitCoverage(sessions, days / n).
 * @param {readonly {id?: string, items: readonly {exerciseId: string, sets: number}[]}[]} rotation positions in order
 * @param {number} sessionsPerWeek
 * @returns same shape as splitCoverage
 */
export function rotationCoverage(rotation, sessionsPerWeek, exercises, weights) {
  const out = Object.fromEntries(MUSCLE_IDS.map((m) => [m, { total: 0, direct: 0, partial: 0, directSets: 0, partialSets: 0, daysHit: 0 }]));
  const n = rotation.length;
  if (!n || !(sessionsPerWeek > 0)) return out;
  const f = sessionsPerWeek / n;
  for (const s of rotation) {
    const c = splitCoverage([s], 1, exercises, weights);
    for (const m of MUSCLE_IDS) for (const k of Object.keys(out[m])) out[m][k] += c[m][k] * f;
  }
  for (const m of MUSCLE_IDS) for (const k of Object.keys(out[m])) out[m][k] = round(out[m][k], 2);
  return out;
}

/** "Far more than the others": at least NOTE_HIGH_RATIO × the median of the trained muscles and at least NOTE_HIGH_GAP sets above it. */
export const NOTE_HIGH_RATIO = 2.5;
export const NOTE_HIGH_GAP = 8;

/**
 * Quiet notes for a planned week (custom split editor). Rule:
 *   none = muscles with 0 weekly sets;
 *   high = muscles whose total is ≥ NOTE_HIGH_RATIO × the median total of the muscles that get sets AND
 *          ≥ NOTE_HIGH_GAP sets above that median (both, so small weeks and even spreads never trigger it).
 * Nothing when no muscle gets any set (an empty rotation).
 * @returns {{none: string[], high: string[]}} muscle ids in MUSCLE_IDS order
 */
export function coverageNotes(coverage) {
  const totals = MUSCLE_IDS.map((m) => (coverage[m] ? coverage[m].total : 0));
  const trained = totals.filter((t) => t > 0).sort((a, b) => a - b);
  if (!trained.length) return { none: [], high: [] };
  const mid = trained.length >> 1;
  const median = trained.length % 2 ? trained[mid] : (trained[mid - 1] + trained[mid]) / 2;
  return {
    none: MUSCLE_IDS.filter((m, i) => totals[i] === 0),
    high: MUSCLE_IDS.filter((m, i) => totals[i] >= NOTE_HIGH_RATIO * median && totals[i] - median >= NOTE_HIGH_GAP),
  };
}

/**
 * A custom split copied from a library split: rotation = its sessions (the routines created for them,
 * in order), sessions per week = its days, so the coverage is the library split's.
 * @param {{id: string, name: string, days: number}} split
 * @param {{id: string, routineIds: string[], now: number, name?: string}} opts
 */
export function customFromLibrary(split, { id, routineIds, now, name }) {
  return cleanCustomSplit({
    id, name: name || `${split.name} (custom)`, sessionsPerWeek: split.days,
    sessions: routineIds, createdAt: now, updatedAt: now, sourceSplitId: split.id,
  });
}

/** activeSplit value for following a custom split (rotation copied, see cleanActiveSplit). */
export function activeForCustom(cs, now) {
  return { kind: 'custom', splitId: cs.id, level: 'standard', routineIds: [...cs.sessions], adoptedAt: now };
}

/** Rotation edits (new arrays). */
export function moveSession(sessions, i, d) {
  const a = [...sessions];
  const j = i + d;
  if (i < 0 || i >= a.length || j < 0 || j >= a.length) return a;
  [a[i], a[j]] = [a[j], a[i]];
  return a;
}
export function duplicateSession(sessions, i) {
  const a = [...sessions];
  if (i >= 0 && i < a.length && a.length < MAX_ROTATION) a.splice(i + 1, 0, a[i]);
  return a;
}
export function removeSession(sessions, i) {
  return sessions.filter((_, k) => k !== i);
}
export function replaceSession(sessions, i, routineId) {
  return sessions.map((id, k) => (k === i ? routineId : id));
}
