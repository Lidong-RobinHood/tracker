// Import run bookkeeping (pure). How undo works:
//  - every created record carries `importId` = the run id;
//  - the settings key `importRuns` lists runs: { id, type, createdAt, status, summary, counts,
//    keys: { <store>: [primary keys created] }, replaced: { weights: [previous records] } };
//  - the run entry (with all planned keys) is saved BEFORE any data is written, so a run that
//    fails half way can still be undone;
//  - undo deletes each listed key only if the stored record still has this run's importId (a day
//    the user re-entered by hand afterwards is left alone), restores replaced weights, and removes
//    custom exercises the run created when nothing references them any more.

export const RUNS_KEY = 'importRuns';
export const EXERCISE_MAP_KEY = 'importExerciseMap';
export const MAX_RUNS = 50;

/**
 * A new run entry.
 * @param {{id: string, type: 'workouts'|'weights'|'food', now: number, summary: string,
 *   counts: Record<string, number>, keys: Record<string, string[]>, replaced?: Record<string, object[]>}} a
 */
export function newRun({ id, type, now, summary, counts, keys, replaced = {} }) {
  return { id, type, createdAt: now, status: 'writing', summary, counts, keys, replaced, undoneAt: null };
}

/** Runs list with `run` added at the front (or replaced by id), capped to MAX_RUNS (oldest undone first out). */
export function upsertRun(runs, run) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && r.id !== run.id);
  list.unshift(run);
  while (list.length > MAX_RUNS) {
    const i = list.map((r) => r.status).lastIndexOf('undone');
    list.splice(i >= 0 ? i : list.length - 1, 1);
  }
  return list;
}

/** Should this stored record be removed when undoing `runId`? */
export const ownedBy = (record, runId) => !!record && record.importId === runId;

/**
 * Custom exercises created by the run that can be deleted: not used by any remaining workout or routine.
 * @param {string[]} exerciseIds
 * @param {object[]} workouts remaining workouts (after the run's workouts are removed)
 * @param {object[]} routines
 * @returns {{remove: string[], keep: string[]}}
 */
export function removableExercises(exerciseIds, workouts, routines) {
  const used = new Set();
  for (const w of workouts) for (const e of w.exercises || []) used.add(e.exerciseId);
  for (const r of routines) for (const it of r.items || []) used.add(it.exerciseId);
  const remove = []; const keep = [];
  for (const id of exerciseIds) (used.has(id) ? keep : remove).push(id);
  return { remove, keep };
}

/** Saved name → exercise mappings without the given exercise ids. */
export function pruneMappings(map, removedIds) {
  const gone = new Set(removedIds);
  return Object.fromEntries(Object.entries(map || {}).filter(([, id]) => !gone.has(id)));
}
