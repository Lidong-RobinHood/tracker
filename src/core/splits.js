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
// Rotation ("next up"): nextUp(active, workouts) — the routine after the one of the most recent
//   logged workout (isLoggedWorkout: finished with ≥ 1 done set, never the starting point) whose
//   routineId is in the rotation, by date then start time (byRecent); wraps around; none yet → first.
//   Workouts of other routines do not move the rotation.
import { MUSCLE_IDS } from './muscles.js';
import { muscleVolumeBreakdown, volumeWeights, sanitiseTargets } from './volume.js';
import { isLoggedWorkout, byRecent } from './workout.js';
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
 * Body-map step 0–4 for a planned weekly total, fixed bands of weighted sets:
 * ≥ 12 → 4, ≥ 8 → 3, ≥ 4 → 2, > 0 → 1, 0 → 0. (The split is not the user's week, so the map shows
 * planned sets, not progress towards the user's targets; the Sets list shows those.)
 */
export function coverageStep(total) {
  if (!(total > 0)) return 0;
  return total >= BAND_EDGES[0] ? 4 : total >= BAND_EDGES[1] ? 3 : total >= BAND_EDGES[2] ? 2 : 1;
}

/** Lower edges of coverageStep's bands (steps 4, 3, 2). */
const BAND_EDGES = Object.freeze([12, 8, 4]);

/**
 * Legend of coverageStep (highest first), bands that do not overlap. Weekly totals move in steps of
 * the smallest set weight (0.5 with the default partial weight), so the upper end of a band is the
 * edge above minus that step: '12+', '8–11.5', '4–7.5', 'Under 4', 'None'. With weights that are
 * not multiples of 0.5 the upper ends read 'under 12' / 'under 8'.
 * @param {{primary?: number, secondary?: number}} [weights] settings.volume
 */
export function coverageBands(weights) {
  const w = volumeWeights(weights);
  const unit = [w.primary, w.secondary].filter((x) => x > 0)
    .every((x) => Number.isInteger(x)) ? 1 : [w.primary, w.secondary].filter((x) => x > 0).every((x) => Number.isInteger(x * 2)) ? 0.5 : null;
  const fmt = (n) => String(n);
  const upTo = (edge) => (unit ? fmt(edge - unit) : `under ${edge}`);
  const [e4, e3, e2] = BAND_EDGES;
  return [
    { step: 4, label: `${e4}+` },
    { step: 3, label: `${e3}–${upTo(e4)}` },
    { step: 2, label: `${e2}–${upTo(e3)}` },
    { step: 1, label: `Under ${e2}` },
    { step: 0, label: 'None' },
  ];
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

/**
 * Clean a stored activeSplit setting. @returns {{splitId: string, level: string, routineIds: string[], adoptedAt: number}|null}
 */
export function cleanActiveSplit(v) {
  if (!v || typeof v !== 'object' || typeof v.splitId !== 'string' || !Array.isArray(v.routineIds)) return null;
  const routineIds = v.routineIds.filter((id) => typeof id === 'string' && id);
  if (!routineIds.length) return null;
  return {
    splitId: v.splitId,
    level: VOLUME_LEVELS.includes(v.level) ? v.level : 'standard',
    routineIds,
    adoptedAt: typeof v.adoptedAt === 'number' ? v.adoptedAt : 0,
  };
}

/**
 * Next routine of the rotation.
 * @param {{routineIds: string[]}} active
 * @param {object[]} workouts
 * @param {Set<string>|null} [existing] routine ids that still exist; deleted ones leave the rotation
 * @returns {{routineId: string, index: number, count: number, lastIndex: number|null}|null}
 *   index within the (remaining) rotation; null when no routine is left
 */
export function nextUp(active, workouts, existing = null) {
  const ids = (active && active.routineIds ? active.routineIds : []).filter((id) => !existing || existing.has(id));
  if (!ids.length) return null;
  const last = (workouts || [])
    .filter((w) => w && !isBaseline(w) && isLoggedWorkout(w) && ids.includes(w.routineId))
    .sort(byRecent)[0];
  const lastIndex = last ? ids.indexOf(last.routineId) : null;
  const index = last ? (lastIndex + 1) % ids.length : 0;
  return { routineId: ids[index], index, count: ids.length, lastIndex };
}
