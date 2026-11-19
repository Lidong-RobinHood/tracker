// Backup reminder timing. Pure, no DOM.
// All data lives only in this browser, so the app reminds the user to export a backup file.
//
// Rules
//   - Only when there is meaningful data: at least MIN_RECORDS records the user created (diary entries,
//     workouts, weigh-ins, saved meals, routines). Seeded exercises and settings do not count.
//   - Due when the last export is BACKUP_DUE_DAYS or more days ago. Never exported: counted from the
//     oldest logged day (so freshly imported old data is reminded about at once, a new user after
//     two weeks of logging).
//   - Snooze hides the banner for SNOOZE_DAYS; the quiet card in Settings ignores the snooze.
//   - Never shown during a workout session.
import { daysBetween, isValidDate, fromTimestamp } from './dates.js';

export const BACKUP_DUE_DAYS = 14;
export const SNOOZE_DAYS = 7;
export const MIN_RECORDS = 5;
const DAY = 86400000;

/** Stores whose records the user created. */
export const USER_STORES = Object.freeze(['diary', 'workouts', 'weights', 'meals', 'routines']);

/** Sum of user-created records from db.countAll()-style counts. */
export function userRecordCount(counts) {
  return USER_STORES.reduce((s, k) => s + (counts && Number.isFinite(counts[k]) ? counts[k] : 0), 0);
}

/**
 * @param {{lastExportAt?: number|null, snoozedUntil?: number|null, oldestDataDate?: string|null,
 *          records: number, now: number, inSession?: boolean}} a
 *   oldestDataDate: earliest date of a diary entry, weigh-in or workout ('YYYY-MM-DD')
 * @returns {{due: boolean, banner: boolean, daysSince: number|null, never: boolean}}
 *   due: the Settings card shows; banner: the in-app banner shows (due, not snoozed, not in a session);
 *   daysSince: whole days since the last export (null when never exported)
 */
export function backupReminder({ lastExportAt = null, snoozedUntil = null, oldestDataDate = null, records, now, inSession = false }) {
  const never = !(typeof lastExportAt === 'number' && lastExportAt > 0);
  const nowDate = fromTimestamp(now);
  const daysSince = never ? null : Math.max(0, daysBetween(fromTimestamp(lastExportAt), nowDate));
  let due = false;
  if (records >= MIN_RECORDS) {
    if (!never) due = daysSince >= BACKUP_DUE_DAYS;
    else if (isValidDate(oldestDataDate)) due = daysBetween(oldestDataDate, nowDate) >= BACKUP_DUE_DAYS;
  }
  const snoozed = typeof snoozedUntil === 'number' && now < snoozedUntil;
  return { due, banner: due && !snoozed && !inSession, daysSince, never };
}

/** Timestamp until which a snoozed banner stays hidden. */
export function snoozeUntil(now) {
  return now + SNOOZE_DAYS * DAY;
}

/** 'today', 'yesterday', '5 days ago' for a past export timestamp; 'never' for none. */
export function lastExportText(lastExportAt, now) {
  if (!(typeof lastExportAt === 'number' && lastExportAt > 0)) return 'never';
  const d = Math.max(0, daysBetween(fromTimestamp(lastExportAt), fromTimestamp(now)));
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
