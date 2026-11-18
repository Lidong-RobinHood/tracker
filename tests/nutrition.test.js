import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as n from '../src/core/nutrition.js';

const per100 = { kcal: 250, protein: 10, carbs: 30, fat: 9, sugars: 5, satFat: null, fibre: 2, salt: null };

test('scale by amount keeps nulls', () => {
  assert.deepEqual(n.scale(per100, 50), { kcal: 125, protein: 5, carbs: 15, fat: 4.5, sugars: 2.5, satFat: null, fibre: 1, salt: null });
  assert.equal(n.scale(per100, 0).kcal, 0);
  assert.equal(n.scale(per100, null).kcal, null);
  assert.equal(n.scale(null, 100).kcal, null);
});

test('sumEntries: required always numbers, optional null if unknown everywhere', () => {
  const quickAdd = { amount: 100, per100: { kcal: 300, protein: 20, carbs: null, fat: 10, sugars: null, satFat: null, fibre: null, salt: null } };
  const t = n.sumEntries([{ per100, amount: 200 }, quickAdd]);
  assert.equal(t.kcal, 800);
  assert.equal(t.protein, 40);
  assert.equal(t.carbs, 60);
  assert.equal(t.fat, 28);
  assert.equal(t.sugars, 10);
  assert.equal(t.satFat, null);
  assert.equal(t.salt, null);
  assert.deepEqual(n.sumEntries([]), { kcal: 0, protein: 0, carbs: 0, fat: 0, sugars: null, satFat: null, fibre: null, salt: null });
});

test('completeness: name + kcal/protein/carbs/fat', () => {
  assert.deepEqual(n.missingFields({ name: 'Oats', per100 }), []);
  assert.ok(n.isComplete({ name: 'Oats', per100 }));
  assert.deepEqual(n.missingFields({ name: '  ', per100: { ...per100, protein: null } }), ['name', 'protein']);
  assert.deepEqual(n.missingFields({ name: 'X', per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 } }), []);
  assert.deepEqual(n.missingFields({ name: 'X', per100: { kcal: NaN, protein: '1', carbs: -1, fat: 0 } }), ['kcal', 'protein', 'carbs']);
  assert.deepEqual(n.missingFields(null), ['name', 'kcal', 'protein', 'carbs', 'fat']);
});

test('kJ to kcal and macro kcal', () => {
  assert.equal(n.kjToKcal(4.184), 1);
  assert.ok(Math.abs(n.kjToKcal(1000) - 239.006) < 0.001);
  assert.equal(n.macroKcal({ protein: 120, carbs: 220, fat: 70 }), 1990);
  assert.equal(n.macroKcal({ protein: null }), 0);
  assert.deepEqual(Object.keys(n.emptyPer100()), n.NUTRIENTS);
});
