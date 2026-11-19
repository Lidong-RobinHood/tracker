import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as f from '../src/ui/format.js';

test('number formatting', () => {
  assert.equal(f.fmtNum(12.5), '12.5');
  assert.equal(f.fmtNum(12.04), '12');
  assert.equal(f.fmtNum(-0.01), '0');
  assert.equal(f.fmtNum(null), '–');
  assert.equal(f.fmtKcal(523.6), '524 kcal');
  assert.equal(f.fmtKg(102.5), '102.5 kg');
  assert.equal(f.fmtAmount(250, 'ml'), '250 ml');
  assert.equal(f.fmtBytes(1234567), '1.2 MB');
});

test('date formatting', () => {
  const now = new Date(2026, 10, 18, 9);
  assert.equal(f.fmtDate('2026-11-18', now), 'Wed 18 Nov');
  assert.equal(f.fmtDate('2025-12-31', now), 'Wed 31 Dec 2025');
  assert.equal(f.fmtDay('2026-11-18', now), 'Today');
  assert.equal(f.fmtDay('2026-11-17', now), 'Yesterday');
  assert.equal(f.fmtDay('2026-11-19', now), 'Tomorrow');
  assert.equal(f.fmtDuration(65 * 60000), '1 h 05 min');
  assert.equal(f.fmtDuration(45 * 60000), '45 min');
  assert.equal(f.fmtTime(new Date(2026, 0, 1, 7, 3).getTime()), '07:03');
});

test('grouped and signed numbers (thin-space thousands, true minus)', () => {
  assert.equal(f.fmtGrouped(1310), '1 310');
  assert.equal(f.fmtGrouped(12345.67, 1), '12 345.7');
  assert.equal(f.fmtGrouped(-1300), '−1 300');
  assert.equal(f.fmtGrouped(999), '999');
  assert.equal(f.fmtGrouped(null), '–');
  assert.equal(f.fmtSigned(50), '+50');
  assert.equal(f.fmtSigned(-0.5, 1), '−0.5');
  assert.equal(f.fmtSigned(0), '0');
});
