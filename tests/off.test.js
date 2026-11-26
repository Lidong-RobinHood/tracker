import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  offProductToFood, interpretProductResponse, parseSearchResponse, productUrl, searchUrl, rateLimitDelay,
} from '../src/core/off.js';

const NUTELLA = {
  code: '3017620422003', product_name: 'Nutella', brands: 'Ferrero, Nutella, Extra', quantity: '400 g',
  serving_size: '15 g', serving_quantity: 15,
  nutriments: {
    'energy-kcal_100g': 539, 'energy-kj_100g': 2252, proteins_100g: 6.3, carbohydrates_100g: 57.5, fat_100g: 30.9,
    sugars_100g: 56.3, 'saturated-fat_100g': 10.6, fiber_100g: 0, salt_100g: 0.107,
  },
};

test('maps a complete OFF product', () => {
  const { food, missing, kcalConverted } = offProductToFood(NUTELLA);
  assert.deepEqual(missing, []);
  assert.equal(kcalConverted, false);
  assert.equal(food.source, 'off');
  assert.equal(food.sourceKey, 'off:3017620422003');
  assert.equal(food.barcode, '3017620422003');
  assert.equal(food.name, 'Nutella');
  assert.equal(food.brand, 'Ferrero, Nutella');
  assert.equal(food.basis, 'g');
  assert.deepEqual(food.per100, { kcal: 539, protein: 6.3, carbs: 57.5, fat: 30.9, sugars: 56.3, satFat: 10.6, fibre: 0, salt: 0.11 });
  assert.deepEqual(food.servings, [{ label: 'Serving', amount: 15 }, { label: 'Whole pack', amount: 400 }]);
  assert.equal(food.userEdited, false);
});

test('kJ-only products are converted and flagged; liquids get ml basis', () => {
  const { food, kcalConverted, missing } = offProductToFood({
    code: '1', product_name_de: 'Saft', quantity: '1 l', serving_size: '1 Glas (250 ml)',
    nutriments: { energy_100g: 184, proteins_100g: '0,5', carbohydrates_100g: 10, fat_100g: 0, sodium_100g: 0.004 },
  });
  assert.equal(kcalConverted, true);
  assert.equal(food.per100.kcal, 44);
  assert.equal(food.per100.protein, 0.5);
  assert.equal(food.per100.salt, 0.01);
  assert.equal(food.basis, 'ml');
  assert.equal(food.name, 'Saft');
  assert.deepEqual(food.servings, [{ label: '1 Glas', amount: 250 }, { label: 'Whole pack', amount: 1000 }]);
  assert.deepEqual(missing, []);
});

test('missing required values are reported', () => {
  const { missing } = offProductToFood({ code: '2', nutriments: { 'energy-kcal_100g': 100, fat_100g: 1 } });
  assert.deepEqual(missing, ['name', 'protein', 'carbs']);
});

test('interprets product lookup responses', () => {
  assert.equal(interpretProductResponse(200, { status: 1, product: NUTELLA }).outcome, 'complete');
  assert.equal(interpretProductResponse(200, { status: 1, product: { code: '3', product_name: 'X' } }).outcome, 'incomplete');
  assert.equal(interpretProductResponse(404, { status: 0, status_verbose: 'product not found' }).outcome, 'not_found');
  assert.equal(interpretProductResponse(200, { status: 0 }).outcome, 'not_found');
  const rl = interpretProductResponse(429, null);
  assert.equal(rl.outcome, 'error');
  assert.deepEqual(rl.error, { key: 'food.off.busy', params: { status: 429 } });
  assert.deepEqual(interpretProductResponse(503, null).error, { key: 'food.off.busy', params: { status: 503 } });
  assert.deepEqual(interpretProductResponse(500, null).error, { key: 'food.off.httpError', params: { status: 500 } });
  assert.equal(interpretProductResponse(200, null).outcome, 'error');
  assert.deepEqual(interpretProductResponse(200, null).error, { key: 'food.off.unexpected', params: { status: 200 } });
});

test('product name: app language preferred for de/zh, unchanged order for en', () => {
  const p = { code: '1', product_name: 'Milk', product_name_de: 'Milch', product_name_zh: '牛奶', nutriments: {} };
  assert.equal(offProductToFood(p).food.name, 'Milk');
  assert.equal(offProductToFood(p, { lang: 'en' }).food.name, 'Milk');
  assert.equal(offProductToFood(p, { lang: 'de' }).food.name, 'Milch');
  assert.equal(offProductToFood(p, { lang: 'zh' }).food.name, '牛奶');
  assert.equal(offProductToFood({ ...p, product_name_zh: ' ' }, { lang: 'zh' }).food.name, 'Milk');
  assert.equal(parseSearchResponse({ products: [p] }, { lang: 'de' })[0].food.name, 'Milch');
  assert.equal(interpretProductResponse(200, { status: 1, product: p }, { lang: 'zh' }).food.name, '牛奶');
  assert.match(productUrl('1'), /product_name_zh/);
});

test('parses search responses, drops nameless and duplicate products', () => {
  const res = parseSearchResponse({ products: [NUTELLA, { code: '9' }, { ...NUTELLA }, { code: '5', product_name: 'Bread', nutriments: {} }] });
  assert.equal(res.length, 2);
  assert.equal(res[0].food.name, 'Nutella');
  assert.deepEqual(res[1].missing, ['kcal', 'protein', 'carbs', 'fat']);
  assert.deepEqual(parseSearchResponse(null), []);
});

test('URLs use fields and encode input', () => {
  assert.match(productUrl('3017620422003'), /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\.json\?fields=code,/);
  const u = new URL(searchUrl(' greek yogurt & honey '));
  assert.equal(u.pathname, '/cgi/search.pl');
  assert.equal(u.searchParams.get('search_terms'), 'greek yogurt & honey');
  assert.equal(u.searchParams.get('json'), '1');
  assert.ok(u.searchParams.get('fields').includes('nutriments'));
});

test('rate limit delay uses a sliding window', () => {
  assert.equal(rateLimitDelay([], 1000), 0);
  const times = [0, 1000, 2000];
  assert.equal(rateLimitDelay(times, 3000, { max: 4, windowMs: 60000 }), 0);
  assert.equal(rateLimitDelay(times, 3000, { max: 3, windowMs: 60000 }), 57000);
  assert.equal(rateLimitDelay(times, 61000, { max: 3, windowMs: 60000 }), 0);
});

test('item 8: a multipack quantity gives the whole pack and the single unit as servings', () => {
  const { food } = offProductToFood({ code: '9', product_name: 'Cola', quantity: '6 x 330 ml', nutriments: { 'energy-kcal_100g': 42 } });
  assert.equal(food.basis, 'ml');
  assert.deepEqual(food.servings, [{ label: '1 of 6', amount: 330 }, { label: 'Whole pack', amount: 1980 }]);
  const { food: f2 } = offProductToFood({ code: '8', product_name: 'Big', quantity: '1.234,5 g', nutriments: { 'energy-kcal_100g': 42 } });
  assert.deepEqual(f2.servings, [{ label: 'Whole pack', amount: 1234.5 }]);
});
