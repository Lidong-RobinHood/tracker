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

test('tonnage: whole kg below 10 000 kg, t with two decimals from 10 000 kg', () => {
  const N = ' ';
  assert.equal(f.fmtTonnage(0), '0 kg');
  assert.equal(f.fmtTonnage(615.4), '615 kg');
  assert.equal(f.fmtTonnage(2300), `2${N}300 kg`);
  assert.equal(f.fmtTonnage(2340), `2${N}340 kg`);
  assert.equal(f.fmtTonnage(2550), `2${N}550 kg`);
  assert.equal(f.fmtTonnage(9999), `9${N}999 kg`);
  assert.equal(f.fmtTonnage(9999.6), '10.00 t', 'rounds to 10 000 kg first');
  assert.equal(f.fmtTonnage(10000), '10.00 t');
  assert.equal(f.fmtTonnage(12480), '12.48 t');
  assert.equal(f.fmtTonnage(12484.9), '12.48 t');
  assert.equal(f.fmtTonnage(1234567), `1${N}234.57 t`);
  assert.equal(f.fmtTonnage(-2340), `−2${N}340 kg`);
  assert.equal(f.fmtTonnage(-12480), '−12.48 t');
  assert.equal(f.fmtTonnage(12480, { kg: true }), `12${N}480 kg`, 'single set / per exercise: always kg');
  assert.equal(f.fmtTonnage(null), '–');
  assert.equal(f.fmtTonnage(Number.NaN), '–');
});

test('fmtError: message of a caught error, else the value as text; never throws', () => {
  assert.equal(f.fmtError(new Error('Quota exceeded')), 'Quota exceeded');
  assert.equal(f.fmtError(null), 'null');
  assert.equal(f.fmtError(undefined), 'undefined');
  assert.equal(f.fmtError('boom'), 'boom');
  assert.equal(f.fmtError({ message: '' }), '[object Object]');
  assert.equal(f.fmtError(Object.create(null)), '?');
  assert.equal(f.fmtError({ get message() { throw new Error('x'); } }), '?');
});
