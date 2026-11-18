import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDecimal, round } from '../src/core/numbers.js';

test('parseDecimal accepts , and .', () => {
  assert.equal(parseDecimal('102,5'), 102.5);
  assert.equal(parseDecimal('102.5'), 102.5);
  assert.equal(parseDecimal(' 80 '), 80);
  assert.equal(parseDecimal(',5'), 0.5);
  assert.equal(parseDecimal('5,'), 5);
  assert.equal(parseDecimal('-2.5'), -2.5);
  assert.equal(parseDecimal(7), 7);
  for (const bad of ['', '  ', 'abc', '1,2,3', '1.2.3', '1e3', null, undefined, NaN, Infinity, '--1']) {
    assert.equal(parseDecimal(bad), null, String(bad));
  }
});

test('round half away from zero', () => {
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(2.5), 3);
  assert.equal(round(-2.5), -3);
  assert.equal(round(102.456, 1), 102.5);
  assert.equal(round(1e-9, 2), 0);
});
