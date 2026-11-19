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
  // item 4: over is decided from the raw values (2008 > 2000), even though 100.4 % displays as 100 %
  assert.equal(targetPercents({ kcal: 2008 }, { kcal: 2000 }).kcal.over, true);
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

test('item 4: percent of target and meal share round exact halves up; over from raw values', () => {
  assert.equal(percentOfTarget(2010, 2000), 101);
  assert.deepEqual(targetPercents({ kcal: 2010 }, { kcal: 2000 }).kcal, { pct: 101, over: true });
  assert.equal(percentOfTarget(290, 2000), 15);
  assert.equal(percentOfTarget(1130, 2000), 57);
  assert.equal(shareOfDay(290, 2000), 15);
  assert.equal(shareOfDay(1130, 2000), 57);
  // over is decided from eaten > target, not from the rounded percentage
  assert.deepEqual(targetPercents({ kcal: 2008 }, { kcal: 2000 }).kcal, { pct: 100, over: true });
  assert.deepEqual(targetPercents({ kcal: 2000 }, { kcal: 2000 }).kcal, { pct: 100, over: false });
});
