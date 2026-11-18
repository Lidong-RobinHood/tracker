import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeEntry, quickAddEntry, groupByMeal, totals, progress, copyEntries, mealFromEntries, entriesFromMeal,
  touchFood, toFoodRecord, pickByBarcode, usedFoods, isQuickAdd, mealForTime,
} from '../src/core/food-diary.js';

const food = {
  id: 'f1', name: 'Oats', brand: 'Brand', basis: 'g', servings: [],
  per100: { kcal: 370, protein: 13, carbs: 60, fat: 7, sugars: 1, satFat: null, fibre: 10, salt: 0 },
};

test('entries snapshot the food values', () => {
  const e = makeEntry({ id: 'e1', date: '2026-11-18', meal: 'breakfast', food, amount: 50, now: 5 });
  assert.equal(e.foodId, 'f1');
  assert.deepEqual(e.per100, food.per100);
  food.per100.kcal = 999; // later edit of the food
  assert.equal(e.per100.kcal, 370);
  food.per100.kcal = 370;
  assert.equal(totals([e]).kcal, 185);
});

test('quick add is stored as amount 100 with per100 = totals', () => {
  const q = quickAddEntry({ id: 'q', date: '2026-11-18', meal: 'snack', kcal: 250, protein: 20, now: 1 });
  assert.equal(q.amount, 100);
  assert.equal(q.foodId, null);
  assert.equal(q.name, 'Quick add');
  assert.deepEqual(totals([q]), { kcal: 250, protein: 20, carbs: 0, fat: 0, sugars: null, satFat: null, fibre: null, salt: null });
  assert.ok(isQuickAdd(q));
});

test('groups by meal in logging order', () => {
  const g = groupByMeal([
    { id: 'b', meal: 'lunch', createdAt: 2 }, { id: 'a', meal: 'lunch', createdAt: 1 }, { id: 'x', meal: '???', createdAt: 3 },
  ]);
  assert.deepEqual(g.lunch.map((e) => e.id), ['a', 'b']);
  assert.deepEqual(g.snack.map((e) => e.id), ['x']);
  assert.deepEqual(g.breakfast, []);
});

test('progress against targets', () => {
  const p = progress({ kcal: 1500, protein: 130, carbs: 100, fat: 50 }, { kcal: 2000, protein: 120, carbs: 0, fat: 70 });
  assert.deepEqual(p[0], { key: 'kcal', consumed: 1500, target: 2000, remaining: 500, fraction: 0.75 });
  assert.equal(p[1].remaining, -10);
  assert.equal(p[2].target, null);
});

test('copy entries to another day keeps values, new ids', () => {
  let n = 0;
  const src = [makeEntry({ id: 'e1', date: '2026-11-18', meal: 'lunch', food, amount: 80, now: 1 })];
  const c = copyEntries(src, { date: '2026-11-19', meal: 'dinner', now: 10, newId: () => `n${++n}` });
  assert.equal(c[0].id, 'n1');
  assert.equal(c[0].date, '2026-11-19');
  assert.equal(c[0].meal, 'dinner');
  assert.equal(c[0].amount, 80);
  assert.notEqual(c[0].per100, src[0].per100);
  assert.equal(src[0].date, '2026-11-18');
});

test('saved meals round-trip with amount overrides', () => {
  const src = [
    makeEntry({ id: 'e1', date: 'd', meal: 'lunch', food, amount: 80, now: 1 }),
    quickAddEntry({ id: 'q', date: 'd', meal: 'lunch', kcal: 100, now: 2 }),
  ];
  const meal = mealFromEntries({ id: 'm', name: ' Lunch box ', entries: src, now: 3 });
  assert.equal(meal.name, 'Lunch box');
  assert.equal(meal.items.length, 2);
  let n = 0;
  const logged = entriesFromMeal(meal, { date: '2026-11-20', meal: 'dinner', amounts: [40, null], now: 9, newId: () => `x${++n}` });
  assert.equal(logged.length, 1);
  assert.equal(logged[0].amount, 40);
  assert.equal(logged[0].meal, 'dinner');
  assert.equal(entriesFromMeal(meal, { date: 'd', meal: 'lunch', now: 1, newId: () => 'y' }).length, 2);
});

test('touchFood updates usage', () => {
  const t = touchFood({ ...food, useCount: 2 }, 55, 100);
  assert.equal(t.useCount, 3);
  assert.equal(t.lastAmount, 55);
  assert.equal(t.lastUsedAt, 100);
});

test('toFoodRecord keeps id and counters of an existing record', () => {
  const existing = { id: 'old', sourceKey: 'off:1', useCount: 4, lastUsedAt: 50, lastAmount: 30, createdAt: 1, userEdited: false };
  const r = toFoodRecord({ source: 'off', sourceKey: 'off:1', barcode: '1', name: ' X ', per100: food.per100, userEdited: true }, { id: 'new', now: 99, existing });
  assert.equal(r.id, 'old');
  assert.equal(r.useCount, 4);
  assert.equal(r.lastAmount, 30);
  assert.equal(r.name, 'X');
  assert.equal(r.userEdited, true);
  assert.equal(r.createdAt, 1);
  const c = toFoodRecord({ name: 'Mine', per100: food.per100 }, { id: 'c1', now: 5 });
  assert.equal(c.sourceKey, 'custom:c1');
  assert.equal(c.source, 'custom');
});

test('pickByBarcode prefers user-edited records', () => {
  assert.equal(pickByBarcode([]), null);
  assert.equal(pickByBarcode([{ id: 'a', userEdited: false, updatedAt: 9 }, { id: 'b', userEdited: true, updatedAt: 1 }]).id, 'b');
});

test('usedFoods sorts by recency or frequency', () => {
  const fs = [{ id: 'a', lastUsedAt: 3, useCount: 1 }, { id: 'b', lastUsedAt: 1, useCount: 9 }, { id: 'c', lastUsedAt: null }];
  assert.deepEqual(usedFoods(fs).map((f) => f.id), ['a', 'b']);
  assert.deepEqual(usedFoods(fs, { by: 'frequent' }).map((f) => f.id), ['b', 'a']);
});

test('mealForTime', () => {
  assert.equal(mealForTime(new Date(2026, 0, 1, 8)), 'breakfast');
  assert.equal(mealForTime(new Date(2026, 0, 1, 12)), 'lunch');
  assert.equal(mealForTime(new Date(2026, 0, 1, 19)), 'dinner');
  assert.equal(mealForTime(new Date(2026, 0, 1, 16)), 'snack');
});
