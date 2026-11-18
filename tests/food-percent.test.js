import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentOfTarget, targetPercents, shareOfDay, fmtPercent } from '../src/core/food-percent.js';

test('percent below, at and over target', () => {
  assert.equal(percentOfTarget(1240, 2000), 62);
  assert.equal(percentOfTarget(120, 120), 100);
  assert.equal(percentOfTarget(2240, 2000), 112);
  assert.equal(percentOfTarget(0, 2000), 0);
});

test('missing or zero target gives no percent, never NaN/Infinity', () => {
  for (const t of [0, -5, null, undefined, NaN, Infinity, '2000']) assert.equal(percentOfTarget(500, t), null);
  assert.equal(percentOfTarget(null, 100), 0);
  assert.equal(percentOfTarget(NaN, 100), 0);
  assert.equal(percentOfTarget(-20, 100), 0);
});

test('targetPercents flags over target only above 100 %', () => {
  const p = targetPercents({ kcal: 2240, protein: 120, carbs: 50, fat: 10 }, { kcal: 2000, protein: 120, carbs: 0, fat: 70 });
  assert.deepEqual(p.kcal, { pct: 112, over: true });
  assert.deepEqual(p.protein, { pct: 100, over: false });
  assert.deepEqual(p.carbs, { pct: null, over: false });
  assert.deepEqual(p.fat, { pct: 14, over: false });
  // 100.4 % rounds to 100 → not shown as over
  assert.equal(targetPercents({ kcal: 2008 }, { kcal: 2000 }).kcal.over, false);
  assert.deepEqual(targetPercents(null, null).kcal, { pct: null, over: false });
});

test('meal share of the day', () => {
  assert.equal(shareOfDay(500, 2000), 25);
  assert.equal(shareOfDay(0, 2000), 0);
  assert.equal(shareOfDay(500, 0), null);
  assert.equal(shareOfDay(500, null), null);
  const parts = [333, 333, 334];
  assert.deepEqual(parts.map((x) => shareOfDay(x, 1000)), [33, 33, 33]);
});

test('formatting', () => {
  assert.equal(fmtPercent(62), '62 %');
  assert.equal(fmtPercent(null), '');
});
