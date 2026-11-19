import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentOfTarget, targetPercents, targetStatus, shareOfDay, fmtPercent } from '../src/core/food-percent.js';

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

test('targetStatus: shown eaten + shown left = target, always (rounding once)', () => {
  // seen in the app: "270 eaten + 1731 left" and "1120 + 881" with target 2000
  for (const raw of [270.4, 269.5, 1119.6, 1120.4, 0, 0.4, 1999.5, 1999.4, 12.5]) {
    const s = targetStatus(raw, 2000);
    assert.equal(s.eaten + s.left, 2000, `raw ${raw}`);
    assert.equal(s.isOver, false);
  }
  assert.deepEqual(targetStatus(270.4, 2000), { eaten: 270, target: 2000, left: 1730, over: 0, isOver: false, pct: 14, fraction: 270.4 / 2000 });
  assert.equal(targetStatus(1119.6, 2000).left, 880);
});

test('targetStatus: no "1 g left" or "0 g over" next to eaten = target', () => {
  // "220 / 220 g · 1 g left · 100 %"
  const a = targetStatus(219.6, 220);
  assert.equal(a.eaten, 220); assert.equal(a.left, 0); assert.equal(a.isOver, false); assert.equal(a.pct, 100);
  // "100 %", "0 g over" and a red bar
  const b = targetStatus(220.3, 220);
  assert.equal(b.eaten, 220); assert.equal(b.left, 0); assert.equal(b.over, 0); assert.equal(b.isOver, false);
  assert.equal(b.pct, 100);
  assert.ok(b.fraction > 1, 'bar is full, but not over');
});

test('targetStatus: over only from 1 displayed unit; percent from raw values', () => {
  const s = targetStatus(2000.6, 2000);
  assert.deepEqual([s.eaten, s.left, s.over, s.isOver, s.pct], [2001, 0, 1, true, 100]);
  const t = targetStatus(2240, 2000);
  assert.deepEqual([t.eaten, t.left, t.over, t.isOver, t.pct], [2240, 0, 240, true, 112]);
  assert.equal(targetStatus(2009, 2000).pct, 100); // raw 100.45 %
  // one decimal: the unit is 0.1
  assert.deepEqual([targetStatus(70.04, 70, { decimals: 1 }).isOver, targetStatus(70.06, 70, { decimals: 1 }).over], [false, 0.1]);
  // a non-whole target is shown rounded and left is computed from that
  const u = targetStatus(50.2, 71.4);
  assert.equal(u.target + 0, 71); assert.equal(u.eaten + u.left, 71);
});

test('targetStatus without a target', () => {
  for (const t of [null, undefined, 0, -1, NaN]) {
    assert.deepEqual(targetStatus(500.4, t), { eaten: 500, target: null, left: null, over: null, isOver: false, pct: null, fraction: 0 });
  }
  assert.equal(targetStatus(null, 2000).eaten, 0);
  assert.equal(targetStatus(-5, 2000).left, 2000);
});
