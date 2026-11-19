// Data access and small shared helpers for the workout views. All reads/writes go through db.js.
import * as db from '../db/db.js';
import { el, append, openModal, navigate } from '../ui/index.js';
import { today } from '../core/dates.js';
import { buildEntry, byRecent, finishTime, rescheduleWorkout, applySchedule, sessionStats } from '../core/workout.js';
import { muscleName } from '../core/muscles.js';
import { isBaseline } from '../core/baseline.js';
import { DEFAULT_INCREMENT, SEED_EXERCISES } from '../data/exercises.js';

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
export async function confirmAction({ title, message, confirmLabel, cancelLabel = 'Cancel', danger = false }) {
  return (await askChoice({ title, message, choices: [
    { label: cancelLabel, value: false }, { label: confirmLabel, value: true, kind: danger ? 'danger' : 'primary' },
  ] })) === true;
}

/** Active (not archived) exercises, sorted by name. */
export function activeExercises(exMap) {
  return [...exMap.values()].filter((e) => !e.archived).sort((a, b) => a.name.localeCompare(b.name));
}

/** @returns {Promise<object[]>} all workouts, newest first */
export async function loadWorkouts() {
  return (await db.getAll('workouts')).sort(byRecent);
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
 *  - done sets: "Finish it & start" (default), "Discard it & start" (warns how many sets are lost), "Cancel".
 * Never finishes a workout without a done set.
 * @returns {Promise<boolean>} true when the new workout may start
 */
async function settleOpenWorkout(open) {
  const n = sessionStats(open).setsDone;
  const name = open.name || 'Workout';
  if (!n) {
    const c = await askChoice({
      title: 'Workout in progress',
      message: `"${name}" has no sets ticked yet. Discard it and start the new workout?`,
      choices: [{ label: 'Keep it open', value: 'keep' }, { label: 'Discard it & start', value: 'discard', kind: 'primary' }],
    });
    if (c !== 'discard') return false;
    await db.remove('workouts', open.id);
    return true;
  }
  const c = await askChoice({
    title: 'Workout in progress',
    message: `"${name}" is not finished yet (${n} set${n === 1 ? '' : 's'} done). Finish it, or discard it and lose ${n === 1 ? 'that set' : `those ${n} sets`}?`,
    choices: [
      { label: 'Finish it & start', value: 'finish', kind: 'primary' },
      { label: `Discard it (${n} set${n === 1 ? '' : 's'} lost) & start`, value: 'discard', kind: 'danger' },
      { label: 'Cancel', value: 'cancel' },
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
    name: routine ? routine.name : 'Workout',
    startedAt: now,
    finishedAt: null,
    exercises: [],
    createdAt: now,
    updatedAt: now,
  };
  if (past) {
    const r = rescheduleWorkout(w, past, now);
    if (!r.ok) throw new Error(r.error);
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
