// Split library data access: the followed split (setting 'activeSplit') and adopting a split as routines.
// Routines are written directly through db.js in the SPEC §3 shape plus the optional `splitId` (docs/SPLITS.md),
// so adopted routines stay ordinary, editable routines.
import * as db from '../db/db.js';
import { el, append } from '../ui/index.js';
import { loadDraft, saveDraft } from '../ui/draft.js';
import {
  ACTIVE_SPLIT_KEY, cleanActiveSplit, resolveSessions, splitRoutines, splitCoverage, perWeek, targetsFromCoverage,
  CUSTOM_SPLITS_KEY, CUSTOM_PREFIX, cleanCustomSplits, cleanCustomSplit, customRoutineIds, customFromLibrary, activeForCustom,
  rotationState, routineAsSession, rotationCoverage, sessionsPerWeekOf, cleanSkips,
} from '../core/splits.js';
import { today } from '../core/dates.js';
import { splitById } from '../data/splits.js';
import { volumeWeights } from '../core/volume.js';

export const TARGETS_KEY = 'volumeTargets'; // same key as src/workout/targets.js

let cssLoaded = false;
/** Load splits.css once. */
export function ensureSplitsCss() {
  if (cssLoaded || document.querySelector('link[data-sp-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  append(document.head, el('link', { rel: 'stylesheet', href: new URL('./splits.css', import.meta.url).href, 'data-sp-css': '' }));
}

/**
 * The followed split. A custom split comes with its live rotation (`routineIds` = its sessions now) and
 * `name`; a followed custom split that no longer exists counts as none.
 * @returns {Promise<(ReturnType<typeof cleanActiveSplit> & {name?: string})|null>}
 */
export async function loadActiveSplit() {
  const active = cleanActiveSplit(await db.getSetting(ACTIVE_SPLIT_KEY));
  if (!active || active.kind !== 'custom') return active;
  const cs = (await loadCustomSplits()).find((x) => x.id === active.splitId);
  return cs ? { ...active, routineIds: [...cs.sessions], name: cs.name } : null;
}

/** Display name of the followed split (library or custom), or null. */
export function followedName(active) {
  if (!active) return null;
  if (active.kind === 'custom') return active.name || null;
  const s = splitById(active.splitId);
  return s ? s.name : null;
}

/** Route of a split's screen (library detail or custom editor). */
export function splitPath(id) {
  return id && id.startsWith(CUSTOM_PREFIX) ? `workout/splits/custom/${encodeURIComponent(id)}` : `workout/splits/${encodeURIComponent(id)}`;
}

/** Stop following: the setting goes, the routines stay. */
export function stopFollowing() {
  return db.remove('settings', ACTIVE_SPLIT_KEY);
}

/**
 * Routines created by adopting a split (they carry `splitId`), the ones "Replace" may delete. Routines made
 * by copying a library split (`splitCopy: true`) and routines a custom split uses (`keep`, e.g.
 * customRoutineIds) are never among them.
 * @param {object[]} routines @param {Set<string>} [keep]
 */
export function adoptedRoutines(routines, keep = new Set()) {
  return routines.filter((r) => r && typeof r.splitId === 'string' && r.splitId && !r.splitCopy && !keep.has(r.id));
}

/** Unsaved choices on a split detail (level, swaps), kept for 24 h like other drafts. */
export function loadChoices(splitId) {
  const d = loadDraft(`split:${splitId}`);
  return {
    level: d && typeof d.level === 'string' ? d.level : null,
    swaps: d && d.swaps && typeof d.swaps === 'object' ? d.swaps : {},
  };
}
export function saveChoices(splitId, value) { saveDraft(`split:${splitId}`, value); }

/** Planned weekly coverage with the user's set weighting. */
export function coverageFor(split, { level, swaps, exMap, weights }) {
  const sessions = resolveSessions(split, { level, swaps, exercises: exMap });
  return { sessions, coverage: splitCoverage(sessions, perWeek(split), exMap, volumeWeights(weights)) };
}

/**
 * Create one routine per session, follow the split, optionally replace earlier adopted routines and
 * set weekly set targets. One transaction: nothing is written if any step fails.
 * @param {object} split
 * @param {{level: string, swaps: Record<string, string>, exMap: Map<string, object>, weights: object,
 *   replace: boolean, setTargets: boolean}} opts
 * @returns {Promise<{routines: object[], removed: number, targets: Record<string, number>|null}>}
 */
export async function adoptSplit(split, { level, swaps, exMap, weights, replace, setTargets }) {
  const [existing, custom] = await Promise.all([db.getAll('routines'), loadCustomSplits()]);
  const remove = replace ? adoptedRoutines(existing, customRoutineIds(custom)) : [];
  const keep = existing.filter((r) => !remove.includes(r));
  const firstOrder = keep.reduce((m, r) => Math.max(m, (r.order ?? 0) + 1), 0);
  const { sessions, coverage } = coverageFor(split, { level, swaps, exMap, weights });
  const now = Date.now();
  const routines = splitRoutines(split, sessions, { ids: sessions.map(() => crypto.randomUUID()), now, firstOrder });
  const targets = setTargets ? targetsFromCoverage(coverage) : null;
  const active = { splitId: split.id, level, routineIds: routines.map((r) => r.id), adoptedAt: now };
  await db.transaction(['routines', 'settings'], 'readwrite', async (t) => {
    for (const r of remove) await t.delete('routines', r.id);
    for (const r of routines) await t.put('routines', r);
    await t.put('settings', { key: ACTIVE_SPLIT_KEY, value: active });
    if (targets) await t.put('settings', { key: TARGETS_KEY, value: targets });
  });
  return { routines, removed: remove.length, targets };
}

// ---------------------------------------------------------------- custom splits
// Setting CUSTOM_SPLITS_KEY: array of custom splits (shape in src/core/splits.js and docs/SPLITS.md). They
// live in `settings`, so export / import carry them; their routines are ordinary routines.

/** @returns {Promise<ReturnType<typeof cleanCustomSplits>>} */
export async function loadCustomSplits() {
  return cleanCustomSplits(await db.getSetting(CUSTOM_SPLITS_KEY));
}

/** One custom split by id, or null. */
export async function loadCustomSplit(id) {
  return (await loadCustomSplits()).find((x) => x.id === id) || null;
}

/** A new custom split record (not saved). */
export function newCustomSplit({ name = 'My split', sessions = [], sessionsPerWeek = null } = {}) {
  const now = Date.now();
  return cleanCustomSplit({ id: `${CUSTOM_PREFIX}${crypto.randomUUID()}`, name, sessions, sessionsPerWeek, createdAt: now, updatedAt: now });
}

/**
 * Insert or replace a custom split (updatedAt = now). When it is the followed split, the copy of its
 * rotation in activeSplit is updated too (one transaction).
 * @returns {Promise<object>} the saved record
 */
export async function saveCustomSplit(cs) {
  const rec = cleanCustomSplit({ ...cs, updatedAt: Date.now() });
  if (!rec) throw new Error('Invalid split');
  await db.transaction(['settings'], 'readwrite', async (t) => {
    const cur = await t.get('settings', CUSTOM_SPLITS_KEY);
    const list = cleanCustomSplits(cur && cur.value);
    const i = list.findIndex((x) => x.id === rec.id);
    if (i >= 0) list[i] = rec; else list.push(rec);
    await t.put('settings', { key: CUSTOM_SPLITS_KEY, value: list });
    const act = await t.get('settings', ACTIVE_SPLIT_KEY);
    if (act && act.value && act.value.splitId === rec.id && rec.sessions.length) {
      await t.put('settings', { key: ACTIVE_SPLIT_KEY, value: { ...act.value, routineIds: [...rec.sessions] } });
    }
  });
  return rec;
}

/** Delete a custom split; its routines stay. Stops following it when it is the followed split. */
export async function deleteCustomSplit(id) {
  await db.transaction(['settings'], 'readwrite', async (t) => {
    const cur = await t.get('settings', CUSTOM_SPLITS_KEY);
    const list = cleanCustomSplits(cur && cur.value).filter((x) => x.id !== id);
    await t.put('settings', { key: CUSTOM_SPLITS_KEY, value: list });
    const act = await t.get('settings', ACTIVE_SPLIT_KEY);
    if (act && act.value && act.value.splitId === id) await t.delete('settings', ACTIVE_SPLIT_KEY);
  });
}

/**
 * Planned week of a custom split: the present routines of its rotation as sessions, and their coverage.
 * @param {object} cs @param {Map<string, object>} routinesById
 */
export function customCoverage(cs, routinesById, exMap, weights) {
  const state = rotationState(cs, routinesById);
  const rotation = state.ids.map((id) => routineAsSession(routinesById.get(id)));
  const perWeek = sessionsPerWeekOf(cs);
  return { state, rotation, perWeek, coverage: rotationCoverage(rotation, perWeek, exMap, volumeWeights(weights)) };
}

/**
 * Copy a library split (volume level and swaps applied) as a custom split: one routine per session
 * (ordinary routines with `splitId`, appended after the others) and the custom split, one transaction.
 * Nothing is followed and nothing is deleted.
 * @returns {Promise<{cs: object, routines: object[]}>}
 */
export async function copyLibrarySplit(split, { level, swaps, exMap }) {
  const existing = await db.getAll('routines');
  const firstOrder = existing.reduce((m, r) => Math.max(m, (r.order ?? 0) + 1), 0);
  const sessions = resolveSessions(split, { level, swaps, exercises: exMap });
  const now = Date.now();
  // splitCopy: made by Customise, so "Replace" on a later adopt never deletes them (adoptedRoutines)
  const routines = splitRoutines(split, sessions, { ids: sessions.map(() => crypto.randomUUID()), now, firstOrder })
    .map((r) => ({ ...r, splitCopy: true }));
  const cs = customFromLibrary(split, { id: `${CUSTOM_PREFIX}${crypto.randomUUID()}`, routineIds: routines.map((r) => r.id), now });
  await db.transaction(['routines', 'settings'], 'readwrite', async (t) => {
    for (const r of routines) await t.put('routines', r);
    const cur = await t.get('settings', CUSTOM_SPLITS_KEY);
    await t.put('settings', { key: CUSTOM_SPLITS_KEY, value: [...cleanCustomSplits(cur && cur.value), cs] });
  });
  return { cs, routines };
}

/** Undo copyLibrarySplit (routines and split removed again). */
export async function undoCopy({ cs, routines }) {
  await db.transaction(['routines', 'settings'], 'readwrite', async (t) => {
    for (const r of routines) await t.delete('routines', r.id);
    const cur = await t.get('settings', CUSTOM_SPLITS_KEY);
    await t.put('settings', { key: CUSTOM_SPLITS_KEY, value: cleanCustomSplits(cur && cur.value).filter((x) => x.id !== cs.id) });
  });
}

/**
 * Follow a custom split: its routines are used in place (nothing copied or deleted). Optionally sets the
 * weekly set targets from its coverage.
 * @returns {Promise<Record<string, number>|null>} the targets written, if any
 */
export async function followCustom(cs, { setTargets = false, coverage = null } = {}) {
  const targets = setTargets && coverage ? targetsFromCoverage(coverage) : null;
  await db.transaction(['settings'], 'readwrite', async (t) => {
    await t.put('settings', { key: ACTIVE_SPLIT_KEY, value: activeForCustom(cs, Date.now()) });
    if (targets) await t.put('settings', { key: TARGETS_KEY, value: targets });
  });
  return targets;
}

/**
 * Next up › Skip: the suggested session is passed over without doing it (the position moves on by one).
 * Stored as { date, at } in activeSplit.skips so the position stays a pure function of history.
 */
export async function skipNext() {
  await db.transaction(['settings'], 'readwrite', async (t) => {
    const act = await t.get('settings', ACTIVE_SPLIT_KEY);
    if (!act || !act.value) return;
    const now = Date.now();
    const skips = cleanSkips([...(Array.isArray(act.value.skips) ? act.value.skips : []), { date: today(), at: now }]);
    await t.put('settings', { key: ACTIVE_SPLIT_KEY, value: { ...act.value, skips } });
  });
}

/** Undo the most recent skip. */
export async function unskipNext() {
  await db.transaction(['settings'], 'readwrite', async (t) => {
    const act = await t.get('settings', ACTIVE_SPLIT_KEY);
    if (!act || !act.value || !Array.isArray(act.value.skips)) return;
    const skips = cleanSkips(act.value.skips).slice(0, -1);
    const value = { ...act.value, skips };
    if (!skips.length) delete value.skips;
    await t.put('settings', { key: ACTIVE_SPLIT_KEY, value });
  });
}
