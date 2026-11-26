// Shared pieces of the import screens: CSS, worker-based parsing, file reading, batched writes,
// run bookkeeping and undo. Imported text is untrusted: it is only ever put into the DOM as text.
import * as db from '../db/db.js';
import { el, icon } from '../ui/index.js';
import { parseDate } from '../core/dates.js';
import { chunk } from '../core/import-common.js';
import { RUNS_KEY, EXERCISE_MAP_KEY, newRun, upsertRun, ownedBy, removableExercises, pruneMappings } from '../core/import-runs.js';
import { t } from '../i18n/index.js';
import { dateLabel } from '../i18n/dates.js';
import { msgText } from './messages.js';

export { msgText };

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


function fallback(fn, args) {
  // Main thread, after letting the UI paint the "Reading…" state.
  return new Promise((r) => setTimeout(r, 30))
    .then(() => import('./parsers.js').catch((err) => {
      console.error(err);
      throw new Error(t('import.parserLoad'));
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
  if (file.size > MAX_FILE_BYTES) throw new Error(t('import.fileTooLarge', { mb: MAX_FILE_BYTES / 1024 / 1024 }));
  const buf = await file.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) {
    try { text = new TextDecoder('windows-1252').decode(buf); } catch { /* keep utf-8 */ }
  }
  return text;
}

/** A file button (label + hidden input) that calls onText(text, file). */
export function filePicker({ label = t('import.chooseFile'), accept = '.txt,.csv,.tsv,text/plain,text/csv,text/tab-separated-values', onText, onError }) {
  const input = el('input', {
    type: 'file', accept, class: 'imp-file-input',
    onChange: async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      try { onText(await readFileText(f), f); } catch (err) { onError(err); }
      input.value = '';
    },
  });
  return el('label', { class: 'btn imp-file' }, icon('upload', { size: 18 }), label, input);
}

// ---------------------------------------------------------------- small UI pieces

/** "What to paste" example box. */
export function exampleBox(title, sample, note = null) {
  return el('details', { class: 'imp-example' },
    el('summary', null, el('span', null, title), icon('chevron-down', { size: 18, class: 'imp-chev' })),
    el('pre', { class: 'imp-pre' }, sample),
    note ? el('p', { class: 't-sub muted imp-example-note' }, note) : null);
}

/**
 * Line-numbered list of problems.
 * @param {{line: number, text?: string, message?: string|object, reason?: string|object, level?: string}[]} issues
 *   message / reason: text or an importer message ({key, params}, see messages.js)
 * @param {{title: string, limit?: number}} opts
 */
export function issueList(issues, { title, limit = 200 }) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.level !== 'info' && i.level !== 'warning').length;
  const shown = issues.slice(0, limit);
  return el('section', { class: ['card', 'imp-issues', errors ? 'has-errors' : null] },
    el('div', { class: 'imp-card-head' }, icon(errors ? 'triangle-exclamation-point' : 'info', { size: 18 }), el('h3', { class: 'card-title' }, title)),
    el('ul', { class: 'imp-issue-list' }, shown.map((i) => el('li', { class: ['imp-issue', `lvl-${i.level || 'error'}`] },
      el('div', { class: 'imp-issue-head' },
        el('span', { class: 'imp-line num' }, t('import.line', { n: i.line })),
        el('span', { class: 'imp-msg' }, msgText(i.message || i.reason || ''))),
      i.text !== undefined && i.text !== '' ? el('code', { class: 'imp-src' }, String(i.text).slice(0, 200)) : null))),
    issues.length > limit ? el('p', { class: 't-sub muted' }, t('import.more', { count: issues.length - limit })) : null);
}

/** <input type=date> limited to today. */
export function dateInput(value, max, onChange) {
  const i = el('input', { type: 'date', class: 'input imp-date', value: value || '', max, onChange: () => onChange(i.value) });
  return i;
}

/** 'Thu 12 Nov 2026' (de 'Do. 12. Nov. 2026', zh '2026年11月12日周四'): always with the year. */
export const dateY = (d) => (d ? dateLabel(parseDate(d), { year: true }) : '–');

/** '12 Nov 2026 – 19 Nov 2026', or one date when both are the same day. */
export const dateRangeY = (from, to) => (from === to ? dateY(from) : t('import.range', { from: dateY(from), to: dateY(to) }));

/** '3 workouts' in the app language: import.count.<noun>_one / _other. */
export const countOf = (noun, n) => t(`import.count.${noun}`, { count: n });

/**
 * Text of an import run's counts and dates, in the current language when the run carries `info`
 * (runs from this version on); older runs show their stored English `summary`.
 * @param {object} r run @param {{source?: boolean}} [opts] source: food runs start with "CSV: "
 */
export function runSummary(r, { source = true } = {}) {
  const i = r.info;
  if (!i) return legacySummary(r);
  const range = i.from ? dateRangeY(i.from, i.to) : '';
  if (r.type === 'workouts') {
    const p = { workouts: countOf('workouts', i.workouts), sets: countOf('sets', i.sets), newEx: countOf('newExercises', i.newExercises || 0), range };
    return t(i.newExercises ? 'import.run.workoutsNew' : 'import.run.workouts', p);
  }
  if (r.type === 'weights') {
    return t(i.replaced ? 'import.run.weightsReplaced' : 'import.run.weights', { weighIns: countOf('weighIns', i.weighIns), count: i.replaced || 0, range });
  }
  const body = t('import.run.food', { entries: countOf('entries', i.entries), days: countOf('days', i.days), range });
  return source && i.source ? t('import.run.withSource', { source: i.source, text: body }) : body;
}

/** Stored English summary of a run saved before 0.9 (0.5.0 and older can say "1 Dec 2025 2025"). */
function legacySummary(r) {
  return String(r.summary || '').replace(/ (\d{4}) \1\b/g, ' $1')
    // One day: '12 Nov 2026 – 12 Nov 2026' → '12 Nov 2026'.
    .replace(/(\w{3} \d{1,2} \w{3} \d{4}) – \1/g, '$1');
}

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
 * @param {{id: string, type: string, summary?: string, info?: object, counts: Record<string, number>,
 *   writes: {store: string, records: object[]}[], replaced?: Record<string, object[]>}} a
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function commitRun({ id, type, summary = null, info = null, counts, writes, replaced = {} }, onProgress = () => {}) {
  const keys = {};
  for (const w of writes) keys[w.store] = [...(keys[w.store] || []), ...w.records.map((r) => r[db.STORES[w.store]])];
  const run = newRun({ id, type, now: Date.now(), summary, info, counts, keys, replaced });
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
  if (!run) throw new Error(t('import.runMissing'));
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
