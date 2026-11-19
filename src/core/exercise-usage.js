// Which exercises the user has logged, for the exercise picker. Pure, no DOM / IndexedDB.
//
// Usage of an exercise = the workouts (finished or in progress) with an entry for it that has at
// least one DONE set. `lastDate`/`lastAt` come from the most recent such workout by date, then start
// time (the same order as byRecent), so a back-dated workout never counts as "most recent".
// The starting point (baseline.js) counts like any workout here on purpose: exercises entered there
// show up under "Recent" in the picker.
//
// Picker order:
//  - empty search: a "Recent" group (used exercises, most recently used first, then most often used,
//    then name; up to RECENT_LIMIT), followed by the full library by name.
//  - search: match quality first (see matchScore); among equally good matches, used exercises
//    before unused ones (recent first, then count), then name.
import { doneSets } from './workout.js';

export const RECENT_LIMIT = 12;

/**
 * One pass over the workouts.
 * @param {object[]} workouts
 * @returns {Map<string, {count: number, lastDate: string, lastAt: number}>}
 */
export function exerciseUsage(workouts) {
  const out = new Map();
  for (const w of workouts || []) {
    if (!w || typeof w.date !== 'string') continue;
    const at = typeof w.startedAt === 'number' ? w.startedAt : 0;
    const seen = new Set();
    for (const e of w.exercises || []) {
      if (!e || seen.has(e.exerciseId) || !doneSets(e).length) continue;
      seen.add(e.exerciseId);
      const u = out.get(e.exerciseId);
      if (!u) out.set(e.exerciseId, { count: 1, lastDate: w.date, lastAt: at });
      else {
        u.count++;
        if (w.date > u.lastDate || (w.date === u.lastDate && at > u.lastAt)) { u.lastDate = w.date; u.lastAt = at; }
      }
    }
  }
  return out;
}

/** Compare two usage records: more recent first, then more often; unused last. 0 when equal. */
export function compareUsage(a, b) {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? 1 : -1;
  return (b.lastAt - a.lastAt) || (b.count - a.count);
}

/**
 * Used exercises from `list`, most recent first, at most `limit`.
 * @param {{id: string, name: string}[]} list candidates (e.g. active exercises after the muscle filter)
 */
export function recentExercises(list, usage, limit = RECENT_LIMIT) {
  return list.filter((e) => usage.has(e.id))
    .sort((a, b) => compareUsage(usage.get(a.id), usage.get(b.id)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const norm = (s) => String(s || '').toLowerCase();

/**
 * Match quality of an exercise for a search (0 = no match). Every word must occur in the name,
 * equipment or primary muscles (the picker's existing rule). Then:
 *   4 the name starts with the whole query · 3 every word starts a word of the name ·
 *   2 every word is in the name · 1 matched via equipment/muscles too.
 */
export function matchScore(ex, query) {
  const q = norm(query).trim();
  if (!q) return 1;
  const terms = q.split(/\s+/).filter(Boolean);
  const name = norm(ex.name);
  const hay = `${name} ${norm(ex.equipment)} ${(ex.primary || []).join(' ').toLowerCase()}`;
  if (!terms.every((t) => hay.includes(t))) return 0;
  if (name.startsWith(q)) return 4;
  const words = name.split(/[\s\-–(),/]+/).filter(Boolean);
  if (terms.every((t) => words.some((w) => w.startsWith(t)))) return 3;
  if (terms.every((t) => name.includes(t))) return 2;
  return 1;
}

/**
 * Search results, best first (see header). Non-matching exercises are dropped.
 * @param {{id: string, name: string}[]} list
 * @param {string} query
 * @param {Map<string, object>} usage
 */
export function rankExercises(list, query, usage) {
  return list.map((e) => ({ e, s: matchScore(e, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || compareUsage(usage.get(a.e.id), usage.get(b.e.id)) || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);
}
