// Data access and small shared helpers for the workout views. All reads/writes go through db.js.
import * as db from '../db/db.js';
import { el, append, openModal, navigate } from '../ui/index.js';
import { today, parseDate } from '../core/dates.js';
import {
  buildEntry, byRecent, finishTime, rescheduleWorkout, applySchedule, sessionStats, formatTarget, formatSets, formatWeight,
} from '../core/workout.js';
import { isBaseline } from '../core/baseline.js';
import { DEFAULT_INCREMENT, SEED_EXERCISES } from '../data/exercises.js';
import { t, compareText } from '../i18n/index.js';
import { exerciseName, muscleName, routineName, workoutSessionName, equipmentName as equipmentLabel } from '../i18n/names.js';
import { dayMonth } from '../i18n/dates.js';

let cssLoaded = false;
/** Load workout.css once. */
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-wk-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  append(document.head, el('link', { rel: 'stylesheet', href: new URL('./workout.css', import.meta.url).href, 'data-wk-css': '' }));
}

/** @returns {Promise<Map<string, object>>} all exercises by id (archived included) */
export async function loadExercises() {
  const list = await db.getAll('exercises');
  await migrateIncrements(list);
  return new Map(list.map((e) => [e.id, e]));
}

const SEED_INCREMENT = new Map(SEED_EXERCISES.map((s) => [s.id, s.increment]));
/**
 * Seed dumbbell exercises shipped with a 2 kg step (32.5 → 34.5 kg is not a real dumbbell) get the
 * current seed step (2.5 kg), but only while the user never edited the exercise
 * (createdAt === updatedAt, as seeded). Idempotent; runs on every load and writes only what changes.
 */
async function migrateIncrements(list) {
  const fix = list.filter((e) => e && typeof e.id === 'string' && e.id.startsWith('seed:') && e.equipment === 'dumbbell'
    && e.increment === 2 && e.createdAt === e.updatedAt && SEED_INCREMENT.get(e.id) === 2.5);
  if (!fix.length) return;
  for (const e of fix) e.increment = 2.5;
  try { await db.putMany('exercises', fix); } catch (err) { console.error(err); }
}

// ---------------------------------------------------------------- double-tap guards

/** Swallow taps for `ms` (the second tap of a double tap must not land on the next screen). */
export function swallowTaps(ms = 450) {
  const until = performance.now() + ms;
  const stop = (e) => {
    if (performance.now() >= until) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  window.addEventListener('click', stop, true);
  window.addEventListener('touchend', stop, { capture: true, passive: false });
  setTimeout(() => {
    window.removeEventListener('click', stop, true);
    window.removeEventListener('touchend', stop, { capture: true });
  }, ms + 50);
}

/**
 * Click handler for a button that navigates to a new screen: the button is disabled on the first
 * activation and stays disabled when `fn` resolves to something truthy (it navigated); it is
 * enabled again when `fn` resolves falsy (cancelled) or throws.
 * @param {(e: Event) => any} fn
 */
export function navAction(fn) {
  let busy = false;
  return async function onActivate(e) {
    const btn = e && e.currentTarget;
    if (busy) { if (e) e.preventDefault(); return; }
    busy = true;
    if (btn && 'disabled' in btn) btn.disabled = true;
    let ok = false;
    try { ok = !!(await fn(e)); } finally {
      if (!ok) { busy = false; if (btn && 'disabled' in btn) btn.disabled = false; }
    }
  };
}

/**
 * A dialog with several answers. For a moment after it opens, taps on it (backdrop or buttons) are
 * ignored, so the second tap of the double tap that opened it cannot dismiss or answer it.
 * @param {{title: string, message: string|Node, choices: {label: string, value: any, kind?: 'primary'|'danger'}[]}} opts
 *   choices in display order; with more than two they are stacked full width
 * @returns {Promise<any>} the chosen value, null when dismissed
 */
export function askChoice({ title, message, choices }) {
  const m = openModal({ title, content: typeof message === 'string' ? el('p', message) : message, className: ['confirm', 'wk-choice', choices.length > 2 ? 'is-stack' : ''].join(' ') });
  const backdrop = m.el.parentElement;
  const until = performance.now() + 450;
  const stop = (e) => { if (performance.now() < until) { e.preventDefault(); e.stopImmediatePropagation(); } };
  if (backdrop) {
    backdrop.addEventListener('click', stop, true);
    backdrop.addEventListener('touchend', stop, { capture: true, passive: false });
  }
  const buttons = choices.map((c) => el('button', {
    type: 'button', class: ['btn', c.kind === 'primary' && 'btn-primary', c.kind === 'danger' && 'btn-danger'],
    onClick: () => m.close({ value: c.value }),
  }, c.label));
  append(m.footer, buttons);
  const main = buttons.find((b, i) => choices[i].kind) || buttons[buttons.length - 1];
  requestAnimationFrame(() => main.focus());
  return m.closed.then((r) => (r && typeof r === 'object' && 'value' in r ? r.value : null));
}

/** Yes/no with the same tap protection as askChoice. @returns {Promise<boolean>} */
export async function confirmAction({ title, message, confirmLabel, cancelLabel = t('workout.action.cancel'), danger = false }) {
  return (await askChoice({ title, message, choices: [
    { label: cancelLabel, value: false }, { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
  ] })) === true;
}

// ---------------------------------------------------------------- display names and formats

/**
 * Display name of an exercise: built-in and not renamed → the app language (names.js exerciseName);
 * custom exercises and renamed built-in ones as stored.
 * @param {{id?: string, name?: string}|null|undefined} ex
 */
export const exLabel = (ex) => exerciseName(ex);

/** Equipment ids in display order (labels: equipmentName). */
export const EQUIPMENT_IDS = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];
/** 'Barbell' in the app language (names.js; unknown ids as they are). */
export function equipmentName(id) {
  return equipmentLabel(id ?? '');
}

/** Translated name and search words of an exercise for the picker / library search (exercise-usage.js). */
export function searchAlt(ex) {
  const muscles = [...(ex.primary || []), ...(ex.secondary || [])].map(muscleName).join(' ');
  return { name: exLabel(ex), terms: `${equipmentName(ex.equipment)} ${muscles}` };
}

/** Active (not archived) exercises, sorted by display name. */
export function activeExercises(exMap) {
  return [...exMap.values()].filter((e) => !e.archived).sort((a, b) => compareText(exLabel(a), exLabel(b)));
}

/** A list of names in the app language: 'A, B' (zh 'A、B'). @param {string[]} items */
export const joinList = (items) => items.join(t('workout.listSep'));

/** Labels for the core format helpers (core/workout.js formatTarget / formatSets / formatWeight). */
const formatLabels = () => ({
  sets: (n) => t('workout.format.sets', { count: n }),
  bw: t('workout.format.bw'),
  drop: t('workout.format.drop'),
});
/** '3 × 6–8 @ 100 kg', '4 sets' in the app language. */
export const fmtTarget = (target) => formatTarget(target, formatLabels());
/** '100 × 7, 100 × 8 + drop 80 × 5' in the app language. */
export const fmtSets = (sets) => formatSets(sets, formatLabels());
/** '102.5', bodyweight label for 0 / empty. */
export const fmtWeight = (w) => formatWeight(w, formatLabels());

/** Stored default workout name (data, not UI: a session started without a routine). */
export const DEFAULT_WORKOUT_NAME = 'Workout'; // i18n-ignore: stored sentinel name
/** Routines by id, kept by loadWorkouts / loadRoutines / loadRoutineIndex for workoutTitle (null = not loaded yet). */
let routineIndex = null;
const setRoutineIndex = (list) => { routineIndex = new Map(list.filter((r) => r && r.id).map((r) => [r.id, r])); return list; };

/** Load the routines workoutTitle needs (views that read workouts from db directly call this first). */
export async function loadRoutineIndex() {
  setRoutineIndex(await db.getAll('routines'));
}

/**
 * Display title of a workout: the starting point, the default name 'Workout' and the day name of a routine
 * from a built-in split (stored in English, see names.js workoutSessionName) in the app language; every
 * other name as stored.
 * @param {{name?: string, routineId?: string|null}} w
 * @param {Map<string, object>|null} [routines] routines by id (default: the ones loaded last)
 */
export function workoutTitle(w, routines = routineIndex) {
  if (!w) return '';
  if (isBaseline(w)) return t('workout.startingPoint.title');
  if (!w.name || w.name === DEFAULT_WORKOUT_NAME) return t('workout.session.defaultName');
  return workoutSessionName(w, routines) ?? w.name;
}

/** @returns {Promise<object[]>} all workouts, newest first */
export async function loadWorkouts() {
  const [workouts, routines] = await Promise.all([db.getAll('workouts'), db.getAll('routines')]);
  setRoutineIndex(routines);
  return workouts.sort(byRecent);
}

// Unfinished workouts. Rule: at most one LIVE workout (started with Start / Empty workout, no
// `plannedDurationMs`) is open at a time; starting another asks what to do with it. A past workout
// ("Log a past workout", has `plannedDurationMs`) is a separate record: logging one never finishes or
// blocks the live session, and starting a live one never touches an unfinished past one. The resume
// banner points at the live workout first; an unfinished past workout gets its own banner.

/** true for an unfinished live workout (see the rule above). */
export const isLiveOpen = (w) => !!w && !w.finishedAt && !isBaseline(w) && !w.plannedDurationMs;

/** Unfinished workouts, the live one first, then the others newest first. */
export function unfinishedWorkouts(workouts) {
  const open = workouts.filter((w) => w && !w.finishedAt && !isBaseline(w)).sort(byRecent);
  return [...open.filter(isLiveOpen), ...open.filter((w) => !isLiveOpen(w))];
}

/** The workout the resume banner points at: the live one, else the newest unfinished. */
export function findUnfinished(workouts) {
  return unfinishedWorkouts(workouts)[0] || null;
}

/**
 * Before a new live workout starts while `open` (live, unfinished) exists: ask.
 *  - no done set: "Discard it & start" (default) or "Keep it open" (nothing is started);
 *  - done sets: "Finish it & start" (default), "Discard (2 sets) & start" (names the loss), "Cancel".
 * Never finishes a workout without a done set.
 * @returns {Promise<boolean>} true when the new workout may start
 */
async function settleOpenWorkout(open) {
  const n = sessionStats(open).setsDone;
  const name = workoutTitle(open);
  if (!n) {
    const c = await askChoice({
      title: t('workout.open.title'),
      message: t('workout.open.emptyMessage', { name }),
      choices: [{ label: t('workout.open.keep'), value: 'keep' }, { label: t('workout.open.discardStart'), value: 'discard', kind: 'primary' }],
    });
    if (c !== 'discard') return false;
    await db.remove('workouts', open.id);
    return true;
  }
  const c = await askChoice({
    title: t('workout.open.title'),
    message: t('workout.open.doneMessage', { name, count: n }),
    choices: [
      { label: t('workout.open.finishStart'), value: 'finish', kind: 'primary' },
      { label: t('workout.open.discardSetsStart', { count: n }), value: 'discard', kind: 'danger' },
      { label: t('workout.action.cancel'), value: 'cancel' },
    ],
  });
  if (c === 'finish') {
    open.finishedAt = finishTime(open, Date.now());
    delete open.plannedDurationMs;
    open.updatedAt = Date.now();
    await db.put('workouts', open);
    return true;
  }
  if (c === 'discard') { await db.remove('workouts', open.id); return true; }
  return false;
}

/** @returns {Promise<object[]>} routines sorted by order then name */
export async function loadRoutines() {
  return setRoutineIndex(await db.getAll('routines')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || compareText(routineName(a), routineName(b)));
}

/** Exercise display name (exLabel), robust to deleted exercises. */
export function exName(exMap, id) {
  const e = exMap.get(id);
  return e ? exLabel(e) : t('workout.exercise.unknown');
}

/** 'Chest · Triceps, Shoulders' */
export function musclesLine(ex) {
  if (!ex) return '';
  const p = joinList((ex.primary || []).map(muscleName));
  const s = joinList((ex.secondary || []).map(muscleName));
  return s ? `${p} · ${s}` : p;
}

/** '12 Nov' (year added when not current) from a YYYY-MM-DD date, in the app language; non-breaking spaces */
export function shortDate(date) {
  const d = parseDate(date);
  return dayMonth(d, { year: d.getFullYear() !== new Date().getFullYear() }).replace(/ /g, '\u00a0');
}

/**
 * Serialised autosave: every save() writes the latest state of the record; calls made while a
 * write is queued are coalesced, calls made during a write queue exactly one more write.
 * @param {string} store
 * @param {() => object|null} getRecord return null to skip (e.g. after discard)
 * @param {(err: any) => void} onError
 */
export function createSaver(store, getRecord, onError) {
  let chain = Promise.resolve();
  let queued = false;
  return {
    save() {
      if (queued) return chain;
      queued = true;
      chain = chain.then(async () => {
        queued = false;
        const rec = getRecord();
        if (!rec) return;
        rec.updatedAt = Date.now();
        await db.put(store, rec);
      }).catch(onError);
      return chain;
    },
    flush() { return chain; },
  };
}

/**
 * Create a session (from a routine or empty) and open it. A live start with another live workout
 * open asks first (settleOpenWorkout; never discarded silently, never finished empty). A past
 * workout (`past` given) is a separate record and never asks (see the rule above unfinishedWorkouts).
 * @param {object|null} routine
 * @param {{date: string, time: string, durationMin?: number|null}|null} [past] log a past workout:
 *   its date and start time; Finish then uses this duration (see finishTime), not the current time.
 *   Prefill / "Last:" come from the sessions before that time.
 * @returns {Promise<string|null>} new workout id, or null when cancelled
 */
export async function startWorkout(routine, past = null) {
  const [workouts, exMap] = await Promise.all([loadWorkouts(), loadExercises()]);
  const open = past ? null : workouts.filter(isLiveOpen).sort(byRecent)[0];
  if (open && !(await settleOpenWorkout(open))) return null;
  const now = Date.now();
  const items = routine ? routine.items.filter((i) => exMap.has(i.exerciseId)) : [];
  const w = {
    id: crypto.randomUUID(),
    date: today(),
    routineId: routine ? routine.id : null,
    name: routine ? routine.name : DEFAULT_WORKOUT_NAME, // stored name (language-neutral), shown by workoutTitle
    startedAt: now,
    finishedAt: null,
    exercises: [],
    createdAt: now,
    updatedAt: now,
  };
  if (past) {
    const r = rescheduleWorkout(w, past, now);
    if (!r.ok) throw new Error(t(r.error, r.params));
    applySchedule(w, r.value);
  }
  const before = past ? workouts.filter((x) => byRecent(x, w) > 0) : workouts;
  w.exercises = items.map((i) => buildEntry(i.exerciseId, i, before));
  await db.put('workouts', w);
  swallowTaps();
  navigate(`workout/session/${encodeURIComponent(w.id)}`);
  return w.id;
}

/** Create a routine record (not saved). */
export function newRoutine(name, items, order) {
  const now = Date.now();
  return { id: crypto.randomUUID(), name, order, items, createdAt: now, updatedAt: now };
}

/** Next routine order value. */
export async function nextRoutineOrder() {
  const rs = await db.getAll('routines');
  return rs.reduce((m, r) => Math.max(m, (r.order ?? 0) + 1), 0);
}

/** An existing exercise (archived included) with the same stored or displayed name, ignoring case and spaces. */
export function findByName(exMap, name, exceptId = null) {
  const key = (n) => String(n ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const k = key(name);
  return [...exMap.values()].find((e) => e.id !== exceptId && (key(e.name) === k || key(exLabel(e)) === k)) || null;
}

/** A new custom exercise record from form values. */
export function newExercise(v) {
  const now = Date.now();
  return {
    id: `custom:${crypto.randomUUID()}`,
    name: v.name,
    primary: v.primary,
    secondary: v.secondary,
    equipment: v.equipment,
    increment: v.increment ?? DEFAULT_INCREMENT[v.equipment] ?? 2.5,
    isCustom: true,
    archived: false,
    notes: v.notes || '',
    videoUrl: v.videoUrl || '',
    createdAt: now,
    updatedAt: now,
  };
}
