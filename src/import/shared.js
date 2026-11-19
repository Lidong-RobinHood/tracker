// Shared pieces of the import screens: CSS, worker-based parsing, file reading, batched writes,
// run bookkeeping and undo. Imported text is untrusted: it is only ever put into the DOM as text.
import * as db from '../db/db.js';
import { el, fmtDate } from '../ui/index.js';
import { parseDate } from '../core/dates.js';
import { chunk } from '../core/import-common.js';
import { RUNS_KEY, EXERCISE_MAP_KEY, newRun, upsertRun, ownedBy, removableExercises, pruneMappings } from '../core/import-runs.js';

export const BATCH = 200;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

let cssLoaded = false;
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-import-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./import.css', import.meta.url).href, 'data-import-css': '' }));
}

// ---------------------------------------------------------------- parsing off the UI thread

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

const PARSER_LOAD_ERROR = 'The import tool could not be loaded (offline, or the connection dropped). Reload the app while online and try again.';

function fallback(fn, args) {
  // Main thread, after letting the UI paint the "Reading…" state.
  return new Promise((r) => setTimeout(r, 30))
    .then(() => import('./parsers.js').catch((err) => {
      console.error(err);
      throw new Error(PARSER_LOAD_ERROR);
    }))
    .then(({ PARSERS }) => PARSERS[fn](...args));
}

function getWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  } catch {
    workerBroken = true;
    return null;
  }
  const w = worker;
  // A worker whose module graph never loads (e.g. offline) may stay silent: give up on it after 6 s
  // without its "ready" message and parse on the main thread instead, so the button never just hangs.
  const giveUp = () => {
    if (worker !== w) return;
    workerBroken = true;
    try { w.terminate(); } catch { /* gone */ }
    worker = null;
    for (const [, p] of pending) fallback(p.fn, p.args).then(p.resolve, p.reject);
    pending.clear();
  };
  const readyTimer = setTimeout(giveUp, 6000);
  w.onmessage = (e) => {
    const { id, result, error, ready } = e.data || {};
    if (ready) { clearTimeout(readyTimer); return; }
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
  };
  w.onerror = (e) => {
    e.preventDefault();
    clearTimeout(readyTimer);
    giveUp();
  };
  return worker;
}

/**
 * Run a parser from parsers.js in the worker (falls back to the main thread).
 * @param {'parseWorkoutText'|'parseWeightText'|'readTable'|'buildFoodRows'} fn
 * @returns {Promise<any>}
 */
export function runParser(fn, ...args) {
  const w = getWorker();
  if (!w) return fallback(fn, args);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, fn, args });
    try { w.postMessage({ id, fn, args }); } catch (err) { pending.delete(id); fallback(fn, args).then(resolve, reject); }
  });
}

// ---------------------------------------------------------------- files

/** Text of a picked file: UTF-8, or Windows-1252 when UTF-8 does not fit (old Excel CSVs). */
export async function readFileText(file) {
  if (file.size > MAX_FILE_BYTES) throw new Error('This file is larger than 20 MB. Export a shorter date range.');
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try { text = new TextDecoder('windows-1252').decode(buf); } catch { /* keep utf-8 */ }
  }
  return text;
}

/** A file button (label + hidden input) that calls onText(text, file). */
export function filePicker({ label = 'Choose a file', accept = '.txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values', onText, onError }) {
  const input = el('input', {
    type: 'file', accept, class: 'imp-file-input',
    onChange: async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { onText(await readFileText(f), f); } catch (err) { onError(err); }
      input.value = '';
    },
  });
  return el('label', { class: 'btn imp-file' }, label, input);
}

// ---------------------------------------------------------------- small UI pieces

/** "What to paste" example box. */
export function exampleBox(title, sample) {
  return el('details', { class: 'imp-example' },
    el('summary', title),
    el('pre', { class: 'imp-pre' }, sample));
}

/**
 * Line-numbered list of problems.
 * @param {{line: number, text?: string, message: string, level?: string}[]} issues
 * @param {{title: string, limit?: number}} opts
 */
export function issueList(issues, { title, limit = 200 }) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level !== 'info' && i.level !== 'warning').length;
  const shown = issues.slice(0, limit);
  return el('section', { class: ['card', 'imp-issues', errors ? 'has-errors' : null] },
    el('div', { class: 'card-title' }, title),
    el('ul', { class: 'imp-issue-list' }, shown.map((i) => el('li', { class: ['imp-issue', `lvl-${i.level || 'error'}`] },
      el('div', { class: 'imp-issue-head' },
        el('span', { class: 'imp-line num' }, `Line ${i.line}`),
        el('span', { class: 'imp-msg' }, i.message || i.reason || '')),
      i.text !== undefined && i.text !== '' ? el('code', { class: 'imp-src' }, String(i.text).slice(0, 200)) : null))),
    issues.length > limit ? el('p', { class: 'small muted' }, `…and ${issues.length - limit} more.`) : null);
}

/** <input type=date> limited to today. */
export function dateInput(value, max, onChange) {
  const i = el('input', { type: 'date', class: 'input imp-date', value: value || '', max, onChange: () => onChange(i.value) });
  return i;
}

/** 'Thu 12 Nov 2026': always with the year, exactly once (fmtDate adds it only for other years). */
export const dateY = (d) => (d ? `${fmtDate(d, parseDate(d))} ${d.slice(0, 4)}` : '–');

/** Summary of an earlier import run. Runs saved by 0.5.0 and older can say "1 Dec 2025 2025". */
export const runSummary = (r) => String(r.summary || '').replace(/ (\d{4}) \1\b/g, ' $1');

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// ---------------------------------------------------------------- runs

/** @returns {Promise<object[]>} recorded import runs, newest first */
export async function loadRuns() {
  const v = await db.getSetting(RUNS_KEY);
  return Array.isArray(v) ? v : [];
}

async function saveRunState(run) {
  await db.transaction(['settings'], 'readwrite', async (t) => {
    const rec = await t.get('settings', RUNS_KEY);
    t.put('settings', { key: RUNS_KEY, value: upsertRun(rec && Array.isArray(rec.value) ? rec.value : [], run) });
  });
}

/**
 * Write an import: first the run entry (so even a half-finished write can be undone), then the
 * records in batched transactions, then mark the run done.
 * @param {{id: string, type: string, summary: string, counts: Record<string, number>,
 *   writes: {store: string, records: object[]}[], replaced?: Record<string, object[]>}} a
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function commitRun({ id, type, summary, counts, writes, replaced = {} }, onProgress = () => {}) {
  const keys = {};
  for (const w of writes) keys[w.store] = [...(keys[w.store] || []), ...w.records.map((r) => r[db.STORES[w.store]])];
  const run = newRun({ id, type, now: Date.now(), summary, counts, keys, replaced });
  await saveRunState(run);
  const total = writes.reduce((n, w) => n + w.records.length, 0);
  let done = 0;
  try {
    for (const w of writes) {
      for (const part of chunk(w.records, BATCH)) {
        await db.transaction([w.store], 'readwrite', async (t) => { for (const r of part) t.put(w.store, r); });
        done += part.length;
        onProgress(done, total);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } catch (err) {
    await saveRunState({ ...run, status: 'partial' }).catch(() => {});
    throw err;
  }
  await saveRunState({ ...run, status: 'done' });
  return run;
}

/**
 * Undo a run: remove exactly the records it created (still tagged with its importId), restore
 * weights it replaced, delete custom exercises it created when nothing uses them any more.
 * @returns {Promise<{removed: Record<string, number>, restored: number, keptExercises: number}>}
 */
export async function undoRun(runId) {
  const runs = await loadRuns();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw new Error('This import is not recorded any more.');
  if (run.status === 'undone') return { removed: {}, restored: 0, keptExercises: 0 };
  const removed = {};
  let restored = 0;
  const replacedWeights = new Map(((run.replaced && run.replaced.weights) || []).map((r) => [r.date, r]));
  for (const store of ['workouts', 'diary', 'weights']) {
    const keys = (run.keys && run.keys[store]) || [];
    removed[store] = 0;
    for (const part of chunk(keys, BATCH)) {
      const r = await db.transaction([store], 'readwrite', async (t) => {
        let n = 0; let back = 0;
        for (const key of part) {
          const rec = await t.get(store, key);
          if (!ownedBy(rec, run.id)) continue;
          const old = store === 'weights' ? replacedWeights.get(key) : null;
          if (old) { t.put(store, old); back++; } else { t.delete(store, key); n++; }
        }
        return { n, back };
      });
      removed[store] += r.n;
      restored += r.back;
    }
  }
  let keptExercises = 0;
  const exIds = (run.keys && run.keys.exercises) || [];
  if (exIds.length) {
    const [workouts, routines] = await Promise.all([db.getAll('workouts'), db.getAll('routines')]);
    const { remove, keep } = removableExercises(exIds, workouts, routines);
    keptExercises = keep.length;
    removed.exercises = await db.transaction(['exercises'], 'readwrite', async (t) => {
      let n = 0;
      for (const id of remove) {
        const rec = await t.get('exercises', id);
        if (ownedBy(rec, run.id)) { t.delete('exercises', id); n++; }
      }
      return n;
    });
    const map = await db.getSetting(EXERCISE_MAP_KEY);
    if (map) await db.setSetting(EXERCISE_MAP_KEY, pruneMappings(map, remove));
  }
  await saveRunState({ ...run, status: 'undone', undoneAt: Date.now(), undoResult: { removed, restored, keptExercises } });
  return { removed, restored, keptExercises };
}
