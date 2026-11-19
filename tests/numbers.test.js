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

test('item 8: round never returns -0', () => {
  assert.ok(Object.is(round(-0.001), 0));
  assert.ok(Object.is(round(-0.004, 2), 0));
  assert.equal(round(-0.6), -1);
});

test('item 4: percent() rounds exact halves away from zero despite floating-point noise', async () => {
  const { percent } = await import('../src/core/numbers.js');
  assert.equal(percent(2010, 2000), 101);
  assert.equal(percent(290, 2000), 15);
  assert.equal(percent(1130, 2000), 57);
  assert.equal(percent(103 - 80, 80, 1), 28.8);
  assert.equal(percent(66.8 - 64, 64, 2), 4.38);
  assert.equal(percent(-(66.8 - 64), 64, 2), -4.38);
  assert.equal(percent(5, 0), null);
  assert.equal(percent(NaN, 10), null);
});
