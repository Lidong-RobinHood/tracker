import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, tokenize, indexItem, search, decodeGenericFoods, preferMatches } from '../src/core/food-search.js';

test('normalize strips accents, case and punctuation', () => {
  assert.equal(normalize('  Crème Brûlée, Straße!  '), 'creme brulee strasse');
  assert.deepEqual(tokenize('Greek-yogurt 2%'), ['greek', 'yogurt', '2']);
  assert.deepEqual(tokenize(''), []);
});

const names = [
  'Banana bread, homemade', 'Bananas, raw', 'Yogurt, banana flavoured', 'Bananas, dehydrated, or banana powder',
  'Milk, whole', 'Apple juice, canned or bottled, unsweetened', 'Apples, raw, with skin', 'Chicken, breast, roasted',
];
const index = names.map((n) => indexItem(n, n));

test('all query words must match', () => {
  assert.deepEqual(search('banana milk', index), []);
  assert.deepEqual(search('chick breast', index), ['Chicken, breast, roasted']);
  assert.deepEqual(search('', index), []);
});

test('prefers names starting with the query and shorter names', () => {
  assert.equal(search('banana', index)[0], 'Bananas, raw');
  assert.equal(search('apple', index)[0], 'Apples, raw, with skin');
  const r = search('banana', index);
  assert.ok(r.indexOf('Yogurt, banana flavoured') > r.indexOf('Bananas, raw'));
});

test('respects limit', () => {
  assert.equal(search('a', index, { limit: 2 }).length, 2);
});

test('decodes the bundled generic foods and ranks real queries sensibly', () => {
  const doc = JSON.parse(readFileSync(new URL('../src/data/generic-foods.json', import.meta.url), 'utf8'));
  const foods = decodeGenericFoods(doc);
  assert.ok(foods.length > 5000);
  const banana = foods.find((f) => f.name === 'Bananas, raw');
  assert.equal(banana.source, 'usda');
  assert.match(banana.sourceKey, /^usda:\d+$/);
  assert.equal(banana.per100.kcal, 89);
  assert.ok(banana.servings.some((s) => s.label === '1 medium' && s.amount === 118));
  const idx = foods.map((f) => indexItem(f, f.name));
  const t0 = performance.now();
  const top = search('banana', idx, { limit: 5 }).map((f) => f.name);
  const ms = performance.now() - t0;
  assert.equal(top[0], 'Bananas, raw');
  assert.equal(search('egg', idx)[0].name.startsWith('Egg'), true);
  assert.ok(search('chicken breast', idx).length > 0);
  assert.ok(ms < 100, `search took ${ms} ms`);
});

test('preferMatches moves matching remote results first and keeps the rest', () => {
  const items = ['Fromage blanc nature', 'Skyr nature 0%', 'Petit Yoplait', 'Skyr'];
  assert.deepEqual(preferMatches('skyr', items, (x) => x), ['Skyr', 'Skyr nature 0%', 'Fromage blanc nature', 'Petit Yoplait']);
  assert.deepEqual(preferMatches('', items, (x) => x), items);
});
