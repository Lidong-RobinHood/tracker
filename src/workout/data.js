// Data access and small shared helpers for the workout views. All reads/writes go through db.js.
import * as db from '../db/db.js';
import { el, confirmDialog, navigate } from '../ui/index.js';
import { today } from '../core/dates.js';
import { buildEntry, byRecent } from '../core/workout.js';
import { muscleName } from '../core/muscles.js';
import { DEFAULT_INCREMENT } from '../data/exercises.js';

let cssLoaded = false;
/** Load workout.css once. */
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-wk-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./workout.css', import.meta.url).href, 'data-wk-css': '' }));
}

/** @returns {Promise<Map<string, object>>} all exercises by id (archived included) */
export async function loadExercises() {
  const list = await db.getAll('exercises');
  return new Map(list.map((e) => [e.id, e]));
}

/** Active (not archived) exercises, sorted by name. */
export function activeExercises(exMap) {
  return [...exMap.values()].filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
}

/** @returns {Promise<object[]>} all workouts, newest first */
export async function loadWorkouts() {
  return (await db.getAll('workouts')).sort(byRecent);
}

/** The newest unfinished workout, if any. */
export function findUnfinished(workouts) {
  return workouts.filter((w) => !w.finishedAt).sort(byRecent)[0] || null;
}

/** @returns {Promise<object[]>} routines sorted by order then name */
export async function loadRoutines() {
  return (await db.getAll('routines')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

/** Exercise display name, robust to deleted exercises. */
export function exName(exMap, id) {
  const e = exMap.get(id);
  return e ? e.name : 'Unknown exercise';
}

/** 'Chest · Triceps, Shoulders' */
export function musclesLine(ex) {
  if (!ex) return '';
  const p = (ex.primary || []).map(muscleName).join(', ');
  const s = (ex.secondary || []).map(muscleName).join(', ');
  return s ? `${p} · ${s}` : p;
}

/** '12 Nov' (year added when not current) from a YYYY-MM-DD date; non-breaking spaces */
export function shortDate(date) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = date.split('-').map(Number);
  return `${d}\u00a0${MONTHS[m - 1]}${y !== new Date().getFullYear() ? `\u00a0${y}` : ''}`;
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
 * Create a session (from a routine or empty) and open it. If another workout is unfinished, the
 * user is asked to finish it first (never discarded silently).
 * @param {object|null} routine
 * @returns {Promise<string|null>} new workout id, or null when cancelled
 */
export async function startWorkout(routine) {
  const [workouts, exMap] = await Promise.all([loadWorkouts(), loadExercises()]);
  const open = findUnfinished(workouts);
  if (open) {
    const ok = await confirmDialog({
      title: 'Workout in progress',
      message: `"${open.name}" is not finished yet. Finish it and start a new workout?`,
      confirmLabel: 'Finish it & start',
    });
    if (!ok) return null;
    open.finishedAt = Date.now();
    open.updatedAt = Date.now();
    await db.put('workouts', open);
  }
  const now = Date.now();
  const items = routine ? routine.items.filter((i) => exMap.has(i.exerciseId)) : [];
  const w = {
    id: crypto.randomUUID(),
    date: today(),
    routineId: routine ? routine.id : null,
    name: routine ? routine.name : 'Workout',
    startedAt: now,
    finishedAt: null,
    exercises: items.map((i) => buildEntry(i.exerciseId, i, workouts)),
    createdAt: now,
    updatedAt: now,
  };
  await db.put('workouts', w);
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

/** An existing exercise (archived included) with the same name, ignoring case and spaces. */
export function findByName(exMap, name, exceptId = null) {
  const key = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim();
  const k = key(name);
  return [...exMap.values()].find((e) => e.id !== exceptId && key(e.name) === k) || null;
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
