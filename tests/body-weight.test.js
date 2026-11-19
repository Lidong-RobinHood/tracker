import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_KG, MAX_KG, isPlausibleKg } from '../src/core/body-weight.js';
import * as importWeights from '../src/core/import-weights.js';
import { cleanWeights } from '../src/core/adaptive.js';

test('one body-weight range for the weight screen, setup, import and trend maths', () => {
  assert.equal(importWeights.MIN_KG, MIN_KG);
  assert.equal(importWeights.MAX_KG, MAX_KG);
  assert.ok(isPlausibleKg(MIN_KG) && isPlausibleKg(MAX_KG) && isPlausibleKg(82.5));
  assert.ok(!isPlausibleKg(MIN_KG - 0.1) && !isPlausibleKg(MAX_KG + 0.1) && !isPlausibleKg(NaN) && !isPlausibleKg('80'));
  // what the import accepts is also what the trend uses
  const w = [{ date: '2026-01-01', kg: MIN_KG }, { date: '2026-01-02', kg: MAX_KG }, { date: '2026-01-03', kg: MIN_KG - 1 }];
  assert.deepEqual(cleanWeights(w).map((x) => x.kg), [MIN_KG, MAX_KG]);
});
