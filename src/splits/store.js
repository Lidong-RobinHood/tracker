// Split library data access: the followed split (setting 'activeSplit') and adopting a split as routines.
// Routines are written directly through db.js in the SPEC §3 shape plus the optional `splitId` (docs/SPLITS.md),
// so adopted routines stay ordinary, editable routines.
import * as db from '../db/db.js';
import { el, append } from '../ui/index.js';
import { loadDraft, saveDraft } from '../ui/draft.js';
import { ACTIVE_SPLIT_KEY, cleanActiveSplit, resolveSessions, splitRoutines, splitCoverage, perWeek, targetsFromCoverage } from '../core/splits.js';
import { volumeWeights } from '../core/volume.js';

export const TARGETS_KEY = 'volumeTargets'; // same key as src/workout/targets.js

let cssLoaded = false;
/** Load splits.css once. */
export function ensureSplitsCss() {
  if (cssLoaded || document.querySelector('link[data-sp-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  append(document.head, el('link', { rel: 'stylesheet', href: new URL('./splits.css', import.meta.url).href, 'data-sp-css': '' }));
}

/** @returns {Promise<ReturnType<typeof cleanActiveSplit>>} */
export async function loadActiveSplit() {
  return cleanActiveSplit(await db.getSetting(ACTIVE_SPLIT_KEY));
}

/** Stop following: the setting goes, the routines stay. */
export function stopFollowing() {
  return db.remove('settings', ACTIVE_SPLIT_KEY);
}

/** Routines created by adopting a split (they carry `splitId`). */
export function adoptedRoutines(routines) {
  return routines.filter((r) => r && typeof r.splitId === 'string' && r.splitId);
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
  const existing = await db.getAll('routines');
  const remove = replace ? adoptedRoutines(existing) : [];
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
