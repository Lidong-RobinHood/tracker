// Backup bookkeeping in settings.meta (lastExportAt, backupSnoozedUntil, setup flags) and the data
// the reminder needs. Rules live in src/core/backup-reminder.js.
import * as db from '../db/db.js';
import { today, addDays } from '../core/dates.js';
import { backupReminder, userRecordCount, snoozeUntil } from '../core/backup-reminder.js';

/** An unfinished workout started this recently counts as live (same 12 h as LIVE_WINDOW_MS in core/workout.js). */
const LIVE_MS = 12 * 3600000;

/** Merge `patch` into settings.meta in one read-modify-write transaction (no lost updates). */
export function updateMeta(patch) {
  return db.transaction(['settings'], 'readwrite', async (t) => {
    const rec = await t.get('settings', 'meta');
    const value = { ...db.SETTINGS_DEFAULTS.meta, ...(rec && rec.value), ...patch };
    t.put('settings', { key: 'meta', value });
    return value;
  });
}

/** Record a finished export. */
export function markExported(at = Date.now()) {
  return updateMeta({ lastExportAt: at, backupSnoozedUntil: null });
}

/** Hide the backup banner for a week. */
export function snoozeBackup(now = Date.now()) {
  return updateMeta({ backupSnoozedUntil: snoozeUntil(now) });
}

/**
 * After a backup file was restored: the data on this device now equals that file, so it counts as
 * backed up at the file's export time; setup counts as done (it is an existing user's data).
 * Also asks the browser to keep the data (a sensible moment: the user just moved real data in).
 * @param {{exportedAt?: number}} file the imported export object
 */
export async function noteRestored(file) {
  const at = file && Number.isFinite(file.exportedAt) ? file.exportedAt : null;
  const meta = await db.getSetting('meta');
  await updateMeta({
    ...(at ? { lastExportAt: at, backupSnoozedUntil: null } : {}),
    ...(typeof meta.setupCompletedAt === 'number' ? {} : { setupCompletedAt: Date.now(), setupSkipped: true }),
  });
  await requestPersistence();
}

/** Ask the browser to keep this site's data (best effort; never throws). @returns {Promise<boolean|null>} */
export async function requestPersistence() {
  try {
    const s = await db.storageStatus();
    if (s.persisted === true) return true;
    return await db.requestPersist();
  } catch {
    return null;
  }
}

/** Is a workout being recorded right now (on the session screen or unfinished and recent)? */
async function workoutInProgress(path) {
  if (path.startsWith('workout/session/')) return true;
  const recent = await db.range('workouts', 'date', { lower: addDays(today(), -1) });
  const now = Date.now();
  return recent.some((w) => !w.finishedAt && !w.plannedDurationMs && now - w.startedAt >= 0 && now - w.startedAt <= LIVE_MS);
}

/** Earliest diary, weigh-in or workout date, or null. */
async function oldestDataDate() {
  const [d, w, k] = await Promise.all([
    db.range('diary', 'date', { limit: 1 }),
    db.range('workouts', 'date', { limit: 1 }),
    db.range('weights', null, { limit: 1 }),
  ]);
  const dates = [d[0] && d[0].date, w[0] && w[0].date, k[0] && k[0].date].filter(Boolean).sort();
  return dates[0] || null;
}

/**
 * Everything the reminder needs, evaluated now.
 * @param {string} [path] current route path ('' when unknown)
 */
export async function backupState(path = '') {
  const [meta, counts, oldest, inSession] = await Promise.all([
    db.getSetting('meta'), db.countAll(), oldestDataDate(), workoutInProgress(path),
  ]);
  const now = Date.now();
  const r = backupReminder({
    lastExportAt: meta.lastExportAt ?? null, snoozedUntil: meta.backupSnoozedUntil ?? null,
    oldestDataDate: oldest, records: userRecordCount(counts), now, inSession,
  });
  return { ...r, meta, counts, lastExportAt: meta.lastExportAt ?? null, now };
}
