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
//    before unused ones (recent first, then count), then the common base lifts (BASE_LIFTS in the
//    seed data), then name.
// Display names: the picker shows built-in exercises in the app language. The UI passes `altOf(ex)` →
// { name, terms } (the translated name, and translated equipment / muscle words); a search matches
// the stored (English) name or the translated one, whichever scores better.
// Abbreviations: a whole query that is a known name alias ("ohp", "rdl", "incline db", "bench"; the
// import's alias table) puts that exercise first; single words "db", "bb", "bw" (WORD_ABBREVIATIONS)
// also match "dumbbell", "barbell", "bodyweight".
import { doneSets } from './workout.js';
import { ALIASES, WORD_ABBREVIATIONS, nameKey } from './import-exercise-match.js';
import { BASE_LIFTS } from '../data/exercises.js';

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

/** Default alphabetical comparison (the UI passes the app language's collator, i18n compareText). */
const defaultCompare = (a, b) => a.localeCompare(b);

/** Name used for alphabetical order: the translated one when given. */
const sortName = (e, altOf) => {
  const alt = altOf ? altOf(e) : null;
  return (alt && alt.name) || e.name || '';
};

/**
 * Used exercises from `list`, most recent first, at most `limit`.
 * @param {{id: string, name: string}[]} list candidates (e.g. active exercises after the muscle filter)
 * @param {(ex: object) => {name?: string, terms?: string}|null} [altOf] display name for the order
 * @param {(a: string, b: string) => number} [compare] alphabetical order of names (ties of usage)
 */
export function recentExercises(list, usage, limit = RECENT_LIMIT, altOf = null, compare = defaultCompare) {
  return list.filter((e) => usage.has(e.id))
    .sort((a, b) => compareUsage(usage.get(a.id), usage.get(b.id)) || compare(sortName(a, altOf), sortName(b, altOf)))
    .slice(0, limit);
}

const norm = (s) => String(s || '').toLowerCase();

/**
 * Match quality of an exercise for a search (0 = no match). Every word must occur in the name,
 * equipment or primary muscles (the picker's existing rule; a word abbreviation such as "db" may
 * occur as its full word). Then:
 *   5 the whole query is a known alias of this exercise ·
 *   4 the name starts with the whole query · 3 every word starts a word of the name ·
 *   2 every word is in the name · 1 matched via equipment/muscles too.
 * With `alt` (translated name and words) the stored and the translated name both count; the better
 * score wins.
 * @param {{id: string, name: string, equipment?: string, primary?: string[]}} ex
 * @param {string} query
 * @param {{name?: string, terms?: string}|null} [alt]
 */
export function matchScore(ex, query, alt = null) {
  const q = norm(query).trim();
  if (!q) return 1;
  if (ALIASES.get(nameKey(q)) === ex.id) return 5;
  // an abbreviation stands for its word only ("bb" must not match inside "dumbbell")
  const terms = q.split(/\s+/).filter(Boolean).map((t) => [WORD_ABBREVIATIONS[t] || t]);
  const names = [norm(ex.name)];
  if (alt && alt.name && norm(alt.name) !== names[0]) names.push(norm(alt.name));
  const hay = `${names.join(' ')} ${norm(ex.equipment)} ${(ex.primary || []).join(' ').toLowerCase()} ${norm(alt && alt.terms)}`;
  const every = (test) => terms.every((forms) => forms.some(test));
  if (!every((t) => hay.includes(t))) return 0;
  let best = 1;
  for (const name of names) {
    if (name.startsWith(q)) return 4;
    const words = name.split(/[\s\-–(),/]+/).filter(Boolean);
    if (every((t) => words.some((w) => w.startsWith(t)))) best = Math.max(best, 3);
    else if (every((t) => name.includes(t))) best = Math.max(best, 2);
  }
  return best;
}

/**
 * Search results, best first (see header). Non-matching exercises are dropped.
 * @param {{id: string, name: string}[]} list
 * @param {string} query
 * @param {Map<string, object>} usage
 * @param {(ex: object) => {name?: string, terms?: string}|null} [altOf] translated name / words per exercise
 * @param {(a: string, b: string) => number} [compare] alphabetical order of names (last tie-break)
 */
export function rankExercises(list, query, usage, altOf = null, compare = defaultCompare) {
  return list.map((e) => ({ e, s: matchScore(e, query, altOf ? altOf(e) : null) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => (b.s - a.s) || compareUsage(usage.get(a.e.id), usage.get(b.e.id))
      || (BASE_LIFTS.has(b.e.id) - BASE_LIFTS.has(a.e.id)) || compare(sortName(a.e, altOf), sortName(b.e, altOf)))
    .map((x) => x.e);
}
