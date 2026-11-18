// Promise-based IndexedDB wrapper: schema, migrations, generic helpers, settings, export/import.
// Views read and write data ONLY through this module. All records are plain JSON objects.

export const DB_NAME = 'tracker';
export const DB_VERSION = 1;

/** Store name -> key path. Order is the export order. */
export const STORES = Object.freeze({
  foods: 'id',
  diary: 'id',
  meals: 'id',
  exercises: 'id',
  routines: 'id',
  workouts: 'id',
  weights: 'date',
  settings: 'key',
  targetHistory: 'weekStart',
});
export const STORE_NAMES = Object.freeze(Object.keys(STORES));

/**
 * Migrations: MIGRATIONS[v] upgrades a database from version v-1 to v.
 * Each receives (db, tx) from onupgradeneeded; tx is the versionchange transaction.
 * To change the schema later: bump DB_VERSION, add MIGRATIONS[DB_VERSION], and add a matching
 * entry to EXPORT_MIGRATIONS if exported files from the old version need reshaping.
 */
const MIGRATIONS = {
  1(db) {
    const foods = db.createObjectStore('foods', { keyPath: 'id' });
    foods.createIndex('barcode', 'barcode');
    foods.createIndex('sourceKey', 'sourceKey', { unique: true });
    foods.createIndex('lastUsedAt', 'lastUsedAt');

    db.createObjectStore('diary', { keyPath: 'id' }).createIndex('date', 'date');
    db.createObjectStore('meals', { keyPath: 'id' });
    db.createObjectStore('exercises', { keyPath: 'id' }).createIndex('name', 'name');
    db.createObjectStore('routines', { keyPath: 'id' });
    db.createObjectStore('workouts', { keyPath: 'id' }).createIndex('date', 'date');
    db.createObjectStore('weights', { keyPath: 'date' });
    db.createObjectStore('settings', { keyPath: 'key' });
    db.createObjectStore('targetHistory', { keyPath: 'weekStart' });
  },
};

/** EXPORT_MIGRATIONS[v] reshapes an export file of version v-1 to v. None needed yet. */
const EXPORT_MIGRATIONS = {};

// ---------------------------------------------------------------- connection

let dbPromise = null;

/** @returns {Promise<IDBDatabase>} the shared connection (opened once) */
export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (let v = e.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v](db, req.transaction);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab wants a newer version: let it, this tab will reopen on next access.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => console.warn('IndexedDB upgrade blocked by another open tab');
  });
  return dbPromise;
}

/** Wrap an IDBRequest in a promise. Marked handled: a failed request also fails its transaction,
 *  which is what callers see, so un-awaited puts inside transaction() do not log twice. */
function reqP(req) {
  const p = new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  p.catch(() => {});
  return p;
}

/** Resolve when a transaction completes, reject on error/abort. */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new DOMException('Transaction aborted', 'AbortError'));
  });
}

// ---------------------------------------------------------------- persistent storage

let persistRequested = false;

/** Best effort: ask the browser not to evict our data. Called automatically on first write. */
function requestPersistOnce() {
  if (persistRequested) return;
  persistRequested = true;
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted()
        .then((p) => (p ? true : navigator.storage.persist()))
        .catch(() => {});
    }
  } catch { /* not available */ }
}

/** @returns {Promise<{persisted: boolean|null, usage: number|null, quota: number|null}>} */
export async function storageStatus() {
  const s = typeof navigator !== 'undefined' ? navigator.storage : null;
  const persisted = s && s.persisted ? await s.persisted().catch(() => null) : null;
  const est = s && s.estimate ? await s.estimate().catch(() => null) : null;
  return { persisted, usage: est ? est.usage ?? null : null, quota: est ? est.quota ?? null : null };
}

/** Explicitly request persistence (e.g. from a button). @returns {Promise<boolean|null>} */
export async function requestPersist() {
  const s = navigator.storage;
  return s && s.persist ? s.persist().catch(() => null) : null;
}

// ---------------------------------------------------------------- transactions

/**
 * Run several operations in ONE transaction (atomic: all or nothing).
 * Inside `fn`, only await the helpers on `t` — awaiting anything else (fetch, timers, other db.*
 * functions) lets the transaction auto-commit early. Throwing inside `fn` aborts the transaction.
 * @template T
 * @param {string[]} storeNames
 * @param {'readonly'|'readwrite'} mode
 * @param {(t: TxHelpers) => Promise<T>|T} fn
 * @returns {Promise<T>} fn's result, after the transaction has committed
 *
 * @typedef {object} TxHelpers
 * @property {IDBTransaction} tx
 * @property {(store: string, key: IDBValidKey) => Promise<any>} get
 * @property {(store: string) => Promise<any[]>} getAll
 * @property {(store: string, record: object) => Promise<IDBValidKey>} put
 * @property {(store: string, key: IDBValidKey) => Promise<void>} delete
 * @property {(store: string) => Promise<void>} clear
 * @property {(store: string, index: string, value: IDBValidKey) => Promise<any[]>} byIndex
 */
export async function transaction(storeNames, mode, fn) {
  const db = await openDb();
  if (mode === 'readwrite') requestPersistOnce();
  const tx = db.transaction(storeNames, mode);
  const done = txDone(tx);
  const os = (s) => tx.objectStore(s);
  const t = {
    tx,
    get: (s, key) => reqP(os(s).get(key)),
    getAll: (s) => reqP(os(s).getAll()),
    put: (s, rec) => reqP(os(s).put(rec)),
    delete: (s, key) => reqP(os(s).delete(key)).then(() => undefined),
    clear: (s) => reqP(os(s).clear()).then(() => undefined),
    byIndex: (s, index, value) => reqP(os(s).index(index).getAll(value)),
  };
  let result;
  try {
    result = await fn(t);
  } catch (err) {
    try { tx.abort(); } catch { /* already finished */ }
    done.catch(() => {});
    throw err;
  }
  await done;
  return result;
}

// ---------------------------------------------------------------- generic helpers

/** @returns {Promise<any|undefined>} */
export function get(store, key) {
  return transaction([store], 'readonly', (t) => t.get(store, key));
}

/** @returns {Promise<any[]>} all records, in key order */
export function getAll(store) {
  return transaction([store], 'readonly', (t) => t.getAll(store));
}

/** Insert or replace one record. @returns {Promise<IDBValidKey>} its key */
export function put(store, record) {
  return transaction([store], 'readwrite', (t) => t.put(store, record));
}

/** Insert or replace many records in one transaction. */
export function putMany(store, records) {
  return transaction([store], 'readwrite', async (t) => {
    for (const r of records) t.put(store, r);
  });
}

/** Delete by key (no error if missing). Named `remove` because `delete` is a keyword. */
export function remove(store, key) {
  return transaction([store], 'readwrite', (t) => t.delete(store, key));
}

/** @returns {Promise<number>} */
export async function count(store) {
  const db = await openDb();
  return reqP(db.transaction([store], 'readonly').objectStore(store).count());
}

/** All records whose index equals `value`, e.g. byIndex('diary', 'date', '2026-11-18'). */
export function byIndex(store, index, value) {
  return transaction([store], 'readonly', (t) => t.byIndex(store, index, value));
}

/**
 * Range query on the primary key (index = null) or an index.
 * @param {string} store
 * @param {string|null} index
 * @param {{lower?: IDBValidKey, upper?: IDBValidKey, lowerOpen?: boolean, upperOpen?: boolean,
 *          direction?: 'next'|'prev', limit?: number}} [opts]
 *   Bounds are inclusive by default; omit one for an open-ended range.
 *   direction 'prev' returns newest/highest first; limit stops early.
 * @returns {Promise<any[]>}
 * @example range('workouts', 'date', { lower: '2026-11-16', upper: '2026-11-22' })
 * @example range('foods', 'lastUsedAt', { direction: 'prev', limit: 20 })   // recent foods
 */
export async function range(store, index, opts = {}) {
  const { lower, upper, lowerOpen = false, upperOpen = false, direction = 'next', limit = Infinity } = opts;
  let keyRange = null;
  if (lower !== undefined && upper !== undefined) keyRange = IDBKeyRange.bound(lower, upper, lowerOpen, upperOpen);
  else if (lower !== undefined) keyRange = IDBKeyRange.lowerBound(lower, lowerOpen);
  else if (upper !== undefined) keyRange = IDBKeyRange.upperBound(upper, upperOpen);

  const db = await openDb();
  const tx = db.transaction([store], 'readonly');
  const src = index ? tx.objectStore(store).index(index) : tx.objectStore(store);
  return new Promise((resolve, reject) => {
    const out = [];
    const req = src.openCursor(keyRange, direction);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) return resolve(out);
      out.push(cur.value);
      cur.continue();
    };
  });
}

// ---------------------------------------------------------------- settings

/** Defaults for every settings key. getSetting() merges stored values over these. */
export const SETTINGS_DEFAULTS = Object.freeze({
  profile: { heightCm: null, birthYear: null, sex: null },
  goal: { rateKgPerWeek: 0 },
  targets: { kcal: 2000, protein: 120, carbs: 220, fat: 70, source: 'manual' },
  volume: { primary: 1, secondary: 0.5, dropset: 0 },
  meta: { schemaVersion: DB_VERSION, seededAt: null, seedVersion: 0 },
});

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * @param {string} key one of SETTINGS_DEFAULTS' keys (others allowed, default undefined)
 * @returns {Promise<any>} stored value shallow-merged over the default (a fresh copy)
 */
export async function getSetting(key) {
  const rec = await get('settings', key);
  const def = clone(SETTINGS_DEFAULTS[key]);
  if (!rec) return def;
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  return isObj(def) && isObj(rec.value) ? { ...def, ...rec.value } : rec.value;
}

/** Replace a setting's value. Pass the full object (use getSetting + spread to change one field). */
export function setSetting(key, value) {
  return put('settings', { key, value });
}

// ---------------------------------------------------------------- seeding

/**
 * Add seed exercises that are not in the store yet. Never overwrites existing records
 * (user edits to seeded exercises are kept). Runs only when meta.seedVersion < seedVersion,
 * so a deleted seed exercise does not come back on every start.
 * @param {ReadonlyArray<object>} seeds from src/data/exercises.js
 * @param {number} seedVersion SEED_VERSION from the same file
 * @returns {Promise<number>} number of exercises added
 */
export async function seedExercises(seeds, seedVersion) {
  const meta = await getSetting('meta');
  if ((meta.seedVersion || 0) >= seedVersion) return 0;
  const now = Date.now();
  return transaction(['exercises', 'settings'], 'readwrite', async (t) => {
    const existing = new Set((await t.getAll('exercises')).map((e) => e.id));
    let added = 0;
    for (const s of seeds) {
      if (existing.has(s.id)) continue;
      t.put('exercises', {
        id: s.id, name: s.name, primary: [...s.primary], secondary: [...s.secondary],
        equipment: s.equipment, increment: s.increment,
        isCustom: false, archived: false, notes: '', createdAt: now, updatedAt: now,
      });
      added++;
    }
    t.put('settings', { key: 'meta', value: { ...meta, schemaVersion: DB_VERSION, seededAt: meta.seededAt ?? now, seedVersion } });
    return added;
  });
}

// ---------------------------------------------------------------- export / import

/** @returns {Promise<{app: 'tracker', schemaVersion: number, exportedAt: number, stores: Record<string, any[]>}>} */
export async function exportAll() {
  const stores = await transaction(STORE_NAMES, 'readonly', async (t) => {
    const out = {};
    for (const s of STORE_NAMES) out[s] = await t.getAll(s);
    return out;
  });
  return { app: 'tracker', schemaVersion: DB_VERSION, exportedAt: Date.now(), stores };
}

/**
 * Check an export object before importing. Does not touch the database.
 * Older schema versions are upgraded via EXPORT_MIGRATIONS; newer ones are rejected.
 * Stores missing from the file count as empty (import replaces everything); unknown stores are ignored.
 * @param {any} data parsed JSON
 * @returns {{ok: true, data: object, counts: Record<string, number>, ignored: string[]}
 *          | {ok: false, error: string}}
 */
export function validateImport(data) {
  if (!data || typeof data !== 'object') return { ok: false, error: 'Not a JSON object.' };
  if (data.app !== 'tracker') return { ok: false, error: 'This file is not a Tracker export.' };
  const v = data.schemaVersion;
  if (!Number.isInteger(v) || v < 1) return { ok: false, error: 'Missing or invalid schemaVersion.' };
  if (v > DB_VERSION) return { ok: false, error: `File is from a newer app version (schema ${v}, this app supports ${DB_VERSION}). Update the app first.` };
  if (!data.stores || typeof data.stores !== 'object') return { ok: false, error: 'File has no stores.' };

  let d = clone(data);
  for (let n = v + 1; n <= DB_VERSION; n++) if (EXPORT_MIGRATIONS[n]) d = EXPORT_MIGRATIONS[n](d);

  const counts = {};
  for (const s of STORE_NAMES) {
    const recs = d.stores[s] ?? [];
    if (!Array.isArray(recs)) return { ok: false, error: `Store "${s}" is not a list.` };
    const keyPath = STORES[s];
    const bad = recs.findIndex((r) => !r || typeof r !== 'object' || r[keyPath] === undefined || r[keyPath] === null);
    if (bad >= 0) return { ok: false, error: `Store "${s}", record ${bad + 1}: missing "${keyPath}".` };
    counts[s] = recs.length;
  }
  const ignored = Object.keys(d.stores).filter((s) => !STORE_NAMES.includes(s));
  d.schemaVersion = DB_VERSION;
  return { ok: true, data: d, counts, ignored };
}

/**
 * REPLACE all data with the file's contents, in one transaction (nothing changes on failure).
 * Call validateImport() first and confirm with the user.
 * @returns {Promise<Record<string, number>>} records written per store
 */
export async function importAll(data) {
  const v = validateImport(data);
  if (!v.ok) throw new Error(v.error);
  await transaction(STORE_NAMES, 'readwrite', async (t) => {
    for (const s of STORE_NAMES) {
      t.clear(s);
      for (const r of v.data.stores[s] ?? []) t.put(s, r);
    }
  });
  return v.counts;
}

/** Delete every record in every store (same transaction semantics as import). */
export function clearAll() {
  return transaction(STORE_NAMES, 'readwrite', async (t) => {
    for (const s of STORE_NAMES) t.clear(s);
  });
}

/** Record counts per store. @returns {Promise<Record<string, number>>} */
export async function countAll() {
  const out = {};
  for (const s of STORE_NAMES) out[s] = await count(s);
  return out;
}
