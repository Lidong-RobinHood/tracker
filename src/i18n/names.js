// Display names for built-in data (muscles, exercises, splits, split days), looked up by id in the 'data'
// namespace (keys: src/i18n/en/data.js). Stored records are never rewritten: custom exercises/splits and
// anything the user renamed keep their own text.
//
// "Built-in and not renamed" (exerciseName): the record's id is a seed id ('seed:<slug>' listed in
// src/data/exercises.js SEED_EXERCISES) AND its stored name is still exactly the English seed name
// (whitespace-trimmed; a record without a name counts as unchanged). Seeding writes the English seed
// name, and the exercise editor writes whatever the user typed, so any edit of the name — even only
// its case — makes the stored name win. Custom exercises never have a seed id. The same rule covers
// routines created from a library split (routineName: they store the English day name), workouts started
// from them (workoutSessionName), and the stored default names 'New routine', 'My split' and
// '<English split name> (custom)': the app stores the English text, the UI shows it in the app language
// while it is unchanged.
import { t, hasKey } from './index.js';
import { muscleName as muscleNameEn } from '../core/muscles.js';
import { SEED_EXERCISES } from '../data/exercises.js';
import { splitById, SPLITS, SHARED_BULLETS } from '../data/splits.js';
import { DEFAULT_SPLIT_NAME, copyNameOf } from '../core/splits.js';
import { NEW_ROUTINE_NAME } from '../core/workout.js';
import { dataKey } from './en/data.js';

export { dataKey };

const tr = (key, fallback) => (hasKey(key) ? t(key) : fallback);
const SEED_NAME = new Map(SEED_EXERCISES.map((e) => [e.id, e.name]));

/** @param {string} id muscle id (core/muscles.js) */
export function muscleName(id) {
  return tr(`data.muscle.${id}`, muscleNameEn(id));
}

/** True when the exercise is a seed exercise whose name the user never changed (see the header). */
export function isBuiltInName(exercise) {
  if (!exercise || typeof exercise.id !== 'string' || !SEED_NAME.has(exercise.id)) return false;
  if (exercise.isCustom === true) return false;
  return exercise.name == null || String(exercise.name).trim() === SEED_NAME.get(exercise.id);
}

/** @param {{id?: string, name?: string, isCustom?: boolean}|null|undefined} exercise */
export function exerciseName(exercise) {
  if (!exercise) return '';
  if (isBuiltInName(exercise)) return tr(`data.exercise.${dataKey(exercise.id)}`, SEED_NAME.get(exercise.id));
  return exercise.name ?? '';
}

/**
 * Name the exercise editor stores. The editor shows exerciseName (translated for a built-in, unrenamed
 * exercise); saved unchanged, the record keeps its stored English name so it stays built-in and keeps
 * following the app language. Any other text (trimmed) is stored as typed.
 * @param {{id?: string, name?: string, isCustom?: boolean}|null|undefined} exercise the stored record
 * @param {string} typed the editor's name field
 */
export function exerciseNameForSave(exercise, typed) {
  const n = String(typed ?? '').trim();
  if (exercise && isBuiltInName(exercise) && n === exerciseName(exercise)) return exercise.name ?? SEED_NAME.get(exercise.id);
  return n;
}

/**
 * Library split (src/data/splits.js) → translated name. Custom split ('custom:…') → its stored name,
 * except the stored default names: 'My split' and a copy's '<English library name> (custom)'.
 * @param {{id?: string, name?: string, sourceSplitId?: string}|null|undefined} split
 */
export function splitName(split) {
  if (!split) return '';
  const lib = typeof split.id === 'string' ? splitById(split.id) : null;
  if (lib) return tr(`data.split.${dataKey(lib.id)}.name`, lib.name);
  if (split.name === DEFAULT_SPLIT_NAME) return t('splits.custom.defaultName');
  const src = typeof split.sourceSplitId === 'string' ? splitById(split.sourceSplitId) : null;
  if (src && split.name === copyNameOf(src)) return t('splits.custom.copyName', { name: splitName(src) });
  return split.name ?? '';
}

/** Library split's one-line "suits" text. */
export function splitSuits(split) {
  return split ? tr(`data.split.${dataKey(split.id)}.suits`, split.suits) : '';
}

/** "How to run it": the shared lines, then the split's own. */
export function splitBullets(split) {
  const shared = SHARED_BULLETS.map((b, i) => tr(`data.splitGuide.bullet${i + 1}`, b));
  const own = split ? split.bullets.map((b, i) => tr(`data.split.${dataKey(split.id)}.bullet${i + 1}`, b)) : [];
  return [...shared, ...own];
}

/** Day name of a library split session ({ id, name }). */
export function sessionName(session) {
  if (!session) return '';
  return tr(`data.session.${dataKey(session.id)}`, session.name ?? '');
}

/**
 * A routine's display name: a routine created from a library split (it carries `splitId`) whose name is
 * still the English day name of that split shows the translated day name; the stored default 'New routine'
 * is translated; any other routine as stored.
 * @param {{name?: string, splitId?: string}|null|undefined} routine
 */
export function routineName(routine) {
  if (!routine) return '';
  if (routine.name === NEW_ROUTINE_NAME) return t('workout.routine.newName');
  const sp = typeof routine.splitId === 'string' ? splitById(routine.splitId) : null;
  const ses = sp && sp.sessions.find((s) => s.name === routine.name);
  return ses ? sessionName(ses) : routine.name ?? '';
}

/** English day name → its library session, only for names that belong to exactly one session id. */
let sessionsByName = null;
function sessionByEnglishName(name) {
  if (!sessionsByName) {
    const ids = new Map();
    for (const sp of SPLITS) for (const ses of sp.sessions) {
      if (!ids.has(ses.name)) ids.set(ses.name, new Map());
      ids.get(ses.name).set(ses.id, ses);
    }
    sessionsByName = new Map([...ids].filter(([, byId]) => byId.size === 1).map(([n, byId]) => [n, [...byId.values()][0]]));
  }
  return sessionsByName.get(name) || null;
}

/**
 * Translated name of a workout started from a routine, or null (then the stored name is shown). Workouts
 * store their routine's stored name: the English day name for a routine of a library split, or 'New routine'.
 *  - routine known: translated when the workout's name is an English day name of the routine's split
 *    (routine.splitId) or 'New routine'; a routine without splitId (made by the user) → null;
 *  - routine deleted (not in `routines`) or routines not given: translated when the name is the English
 *    name of exactly one library day ('Push', 'Legs', … are unique) or 'New routine'.
 * Workouts without routineId (empty workouts, imports) → null: their names are the user's.
 * @param {{name?: string, routineId?: string|null}|null|undefined} w
 * @param {Map<string, {splitId?: string}>|null} [routines] routines by id
 * @returns {string|null}
 */
export function workoutSessionName(w, routines = null) {
  if (!w || typeof w.routineId !== 'string' || !w.routineId || typeof w.name !== 'string' || !w.name) return null;
  if (w.name === NEW_ROUTINE_NAME) return t('workout.routine.newName');
  const r = routines ? routines.get(w.routineId) : null;
  let ses;
  if (r) {
    const sp = typeof r.splitId === 'string' ? splitById(r.splitId) : null;
    ses = sp ? sp.sessions.find((s) => s.name === w.name) : null;
  } else {
    ses = sessionByEnglishName(w.name);
  }
  return ses ? sessionName(ses) : null;
}

/**
 * Name an editor stores: `typed` (trimmed), except when it equals the name shown for the stored one (a
 * translated marker or day name saved unchanged keeps the stored, language-neutral text).
 * @param {string} stored @param {string} shown @param {string} typed
 */
export function nameForSave(stored, shown, typed) {
  const n = String(typed ?? '').trim();
  return n && n === shown ? stored : n;
}

/** Split library filters: style / level / place ('gym' | 'home') ids → label. */
export const styleLabel = (id) => tr(`data.style.${dataKey(id)}`, id);
export const levelLabel = (id) => tr(`data.level.${dataKey(id)}`, id);
export const placeLabel = (id) => tr(`data.place.${dataKey(id)}`, id);

/** Exercise equipment type (barbell, dumbbell, machine, cable, bodyweight, other) → label. */
export const equipmentName = (type) => tr(`data.equipment.${type}`, type);
