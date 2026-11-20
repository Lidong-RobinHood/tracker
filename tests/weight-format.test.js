import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownKg, shownKgChange, shownKgChangePct, shownKgDiff, shownRate } from '../src/core/weight-format.js';

test('weights are shown with one decimal', () => {
  assert.equal(shownKg(83.06), 83.1);
  assert.equal(shownKg(83), 83);
  assert.equal(shownKg(null), null);
  assert.equal(shownKg(NaN), null);
});

test('a change is the difference of the displayed weights', () => {
  // trend 83.06 vs 83.42: true −0.36, displayed 83.1 and 83.4 → −0.3
  assert.equal(shownKgChange(83.06, 83.42), -0.3);
  assert.equal(shownKgChange(83.04, 83.36), -0.4);
  assert.equal(shownKgChange(82.95, 82.95), 0);
  assert.equal(shownKgChange(80.25, 80.14), 0.2);
  assert.equal(shownKgChange(null, 80), null);
  assert.equal(shownKgChange(80, undefined), null);
});

test('displayed rows add up: prev + change = cur (all at 1 decimal)', () => {
  for (const [c, p] of [[83.06, 83.42], [71.449, 71.551], [99.95, 100.04], [60.01, 59.96]]) {
    assert.equal(shownKg(shownKg(p) + shownKgChange(c, p)), shownKg(c));
  }
});

test('percentage from displayed weights; rates keep two decimals', () => {
  assert.equal(shownKgChangePct(83.06, 83.42), -0.4);
  assert.equal(shownKgChangePct(1, 0), null);
  assert.equal(shownKgDiff(-0.36, -0.5), 0.1);
  assert.equal(shownRate(-0.364), -0.36);
  assert.equal(shownRate(null), null);
});
