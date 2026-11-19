import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backupReminder, snoozeUntil, lastExportText, userRecordCount, BACKUP_DUE_DAYS, SNOOZE_DAYS, MIN_RECORDS } from '../src/core/backup-reminder.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 19, 12, 0).getTime(); // 19 Nov 2026, local noon

test('userRecordCount counts only what the user created', () => {
  assert.equal(userRecordCount({ diary: 3, workouts: 1, weights: 2, meals: 0, routines: 1, exercises: 90, settings: 4, foods: 7 }), 7);
  assert.equal(userRecordCount({}), 0);
  assert.equal(userRecordCount(null), 0);
});

test('no reminder without meaningful data', () => {
  const r = backupReminder({ records: MIN_RECORDS - 1, oldestDataDate: '2026-01-01', now: NOW });
  assert.equal(r.due, false);
  assert.equal(r.banner, false);
});

test('never exported: due once the oldest logged day is 14+ days old', () => {
  assert.equal(backupReminder({ records: 20, oldestDataDate: '2026-11-06', now: NOW }).due, false); // 13 days
  const r = backupReminder({ records: 20, oldestDataDate: '2026-11-05', now: NOW }); // 14 days
  assert.equal(r.due, true);
  assert.equal(r.banner, true);
  assert.equal(r.never, true);
  assert.equal(r.daysSince, null);
  assert.equal(backupReminder({ records: 20, oldestDataDate: null, now: NOW }).due, false);
});

test('exported: due 14 calendar days after the last export', () => {
  const at13 = backupReminder({ records: 20, lastExportAt: NOW - 13 * DAY, oldestDataDate: '2025-01-01', now: NOW });
  assert.equal(at13.due, false);
  assert.equal(at13.daysSince, 13);
  const at14 = backupReminder({ records: 20, lastExportAt: NOW - BACKUP_DUE_DAYS * DAY, oldestDataDate: '2025-01-01', now: NOW });
  assert.equal(at14.due, true);
  assert.equal(at14.never, false);
});

test('snooze hides the banner for 7 days but not the Settings card', () => {
  const base = { records: 20, lastExportAt: NOW - 30 * DAY, now: NOW };
  const s = snoozeUntil(NOW - DAY);
  assert.equal(s, NOW - DAY + SNOOZE_DAYS * DAY);
  const r = backupReminder({ ...base, snoozedUntil: s });
  assert.equal(r.due, true);
  assert.equal(r.banner, false);
  assert.equal(backupReminder({ ...base, snoozedUntil: NOW - 1 }).banner, true, 'snooze expired');
});

test('never during a workout session', () => {
  const r = backupReminder({ records: 20, lastExportAt: NOW - 30 * DAY, now: NOW, inSession: true });
  assert.equal(r.due, true);
  assert.equal(r.banner, false);
});

test('lastExportText', () => {
  assert.equal(lastExportText(null, NOW), 'never');
  assert.equal(lastExportText(NOW - 60_000, NOW), 'today');
  assert.equal(lastExportText(NOW - DAY, NOW), 'yesterday');
  assert.equal(lastExportText(NOW - 5 * DAY, NOW), '5 days ago');
});
