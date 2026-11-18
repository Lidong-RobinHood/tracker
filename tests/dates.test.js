import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as d from '../src/core/dates.js';

test('toDateStr uses local components, not UTC', () => {
  // 23:30 local on 18 Nov is still 18 Nov whatever the timezone.
  assert.equal(d.toDateStr(new Date(2026, 10, 18, 23, 30)), '2026-11-18');
  assert.equal(d.toDateStr(new Date(2026, 10, 18, 0, 5)), '2026-11-18');
  assert.equal(d.fromTimestamp(new Date(2026, 0, 1, 0, 1).getTime()), '2026-01-01');
  assert.equal(d.today(new Date(2026, 1, 3, 12)), '2026-02-03');
});

test('isValidDate / parseDate', () => {
  assert.ok(d.isValidDate('2028-02-29'));
  assert.ok(!d.isValidDate('2026-02-29'));
  assert.ok(!d.isValidDate('2026-13-01'));
  assert.ok(!d.isValidDate('2026-1-01'));
  assert.ok(!d.isValidDate(null));
  assert.throws(() => d.parseDate('nope'));
  const p = d.parseDate('2026-11-18');
  assert.deepEqual([p.getFullYear(), p.getMonth(), p.getDate(), p.getHours()], [2026, 10, 18, 0]);
});

test('addDays across month, year, leap day and DST changes', () => {
  assert.equal(d.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(d.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(d.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(d.addDays('2026-03-01', -1), '2026-02-28');
  // EU DST 2026: 29 Mar and 25 Oct; US: 8 Mar and 1 Nov
  assert.equal(d.addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(d.addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(d.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(d.addDays('2026-10-31', 2), '2026-11-02');
  assert.equal(d.addDays('2026-11-18', 0), '2026-11-18');
  assert.equal(d.addDays('2026-01-01', 365), '2027-01-01');
});

test('weeks run Monday to Sunday', () => {
  assert.equal(d.weekday('2026-11-16'), 0); // Monday
  assert.equal(d.weekday('2026-11-22'), 6); // Sunday
  assert.equal(d.weekStart('2026-11-18'), '2026-11-16');
  assert.equal(d.weekEnd('2026-11-18'), '2026-11-22');
  assert.equal(d.weekStart('2026-11-16'), '2026-11-16');
  assert.equal(d.weekStart('2026-11-22'), '2026-11-16');
  assert.equal(d.weekStart('2027-01-01'), '2026-12-28');
  assert.equal(d.weekEnd('2026-12-28'), '2027-01-03');
});

test('daysBetween and dateRange', () => {
  assert.equal(d.daysBetween('2026-11-16', '2026-11-22'), 6);
  assert.equal(d.daysBetween('2026-11-22', '2026-11-16'), -6);
  assert.equal(d.daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.deepEqual(d.dateRange('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  assert.deepEqual(d.dateRange('2026-11-02', '2026-11-01'), []);
});
