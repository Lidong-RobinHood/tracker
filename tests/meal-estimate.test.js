// "Estimate a meal": hand-portion model (src/core/meal-estimate.js), stored default name, catalogue keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTIMATE_UNITS, ESTIMATE_GROUPS, ESTIMATE_MAX, PROTEIN_KINDS, CARB_KINDS, COOKING_METHODS, COOKING_FAT,
  ESTIMATE_MEAL_NAME, defaultPlate, autoThumbs, thumbs, amountOf, setAmount, step, setKind, setCooking,
  groupGrams, plateTotals, estimateName, halvesText, toHalves,
} from '../src/core/meal-estimate.js';
import { quickAddEntry, isEstimateEntry, copyEntries } from '../src/core/food-diary.js';
import { validateImport, DB_VERSION } from '../src/db/db.js';
import { macroKcal } from '../src/core/nutrition.js';
import { _setDictionary, _activate, EN_CATALOGUES } from '../src/i18n/index.js';
import deFood from '../src/i18n/de/food.js';
import zhFood from '../src/i18n/zh/food.js';
import { itemName } from '../src/food/names.js';

test('default plate: 1 palm meat, 1½ fists rice, 1 fist vegetables, pan-fried ≈ 735 kcal', () => {
  const p = defaultPlate();
  assert.equal(thumbs(p), 1.5); // 0.5 × (1 + 1.5) = 1.25 → 1.5
  assert.deepEqual(plateTotals(p), { kcal: 735, protein: 35.5, carbs: 70, fat: 33.6 });
  assert.deepEqual(ESTIMATE_GROUPS.map((g) => groupGrams(p, g)), [100, 225, 150, 23]);
});

test('the unit table matches the approved constants and is self-consistent', () => {
  assert.deepEqual({ ...ESTIMATE_UNITS.meat }, { g: 100, kcal: 200, protein: 27, carbs: 0, fat: 10 });
  assert.deepEqual({ ...ESTIMATE_UNITS.fish }, { g: 100, kcal: 140, protein: 24, carbs: 0, fat: 5 });
  assert.deepEqual({ ...ESTIMATE_UNITS.tofu }, { g: 100, kcal: 150, protein: 14, carbs: 2, fat: 10 });
  assert.deepEqual({ ...ESTIMATE_UNITS.rice }, { g: 150, kcal: 195, protein: 4, carbs: 42, fat: 0.5 });
  assert.deepEqual({ ...ESTIMATE_UNITS.noodles }, { g: 150, kcal: 210, protein: 7, carbs: 42, fat: 1.5 });
  assert.deepEqual({ ...ESTIMATE_UNITS.potato }, { g: 150, kcal: 130, protein: 3, carbs: 30, fat: 0.2 });
  assert.deepEqual({ ...ESTIMATE_UNITS.bread }, { g: 60, kcal: 160, protein: 5, carbs: 30, fat: 2 });
  assert.deepEqual({ ...ESTIMATE_UNITS.veg }, { g: 150, kcal: 40, protein: 2.5, carbs: 7, fat: 0.3 });
  assert.deepEqual({ ...ESTIMATE_UNITS.thumb }, { g: 15, kcal: 135, protein: 0, carbs: 0, fat: 15 });
  // kcal agrees with 4 / 4 / 9 kcal per g of the macros within 10 % (catches typos in the table)
  for (const [k, u] of Object.entries(ESTIMATE_UNITS)) {
    const m = macroKcal(u);
    assert.ok(Math.abs(m - u.kcal) / u.kcal <= 0.1, `${k}: ${u.kcal} kcal vs ${m} from macros`);
  }
  assert.ok(Object.isFrozen(ESTIMATE_UNITS) && Object.isFrozen(ESTIMATE_UNITS.meat));
  for (const k of [...PROTEIN_KINDS, ...CARB_KINDS]) assert.ok(ESTIMATE_UNITS[k], k);
  assert.deepEqual({ ...COOKING_FAT }, { grilled: 0, pan: 0.5, fried: 1, creamy: 0.75 });
  assert.deepEqual({ ...ESTIMATE_MAX }, { protein: 2, carbs: 3, veg: 3, fat: 4 });
});

test('cooking method sets the default thumbs: factor × (palms + carb fists), to halves, within range', () => {
  const p = defaultPlate(); // 1 palm + 1.5 fists = 2.5
  assert.equal(autoThumbs(setCooking(p, 'grilled')), 0);
  assert.equal(autoThumbs(setCooking(p, 'pan')), 1.5);   // 1.25
  assert.equal(autoThumbs(setCooking(p, 'fried')), 2.5);
  assert.equal(autoThumbs(setCooking(p, 'creamy')), 2);  // 1.875
  // vegetables do not count
  assert.equal(autoThumbs(setAmount(p, 'veg', 3)), 1.5);
  // follows the plate while untouched
  assert.equal(thumbs(setAmount(p, 'protein', 2)), 2); // 0.5 × 3.5 = 1.75 → 2
  // capped at the thumb range
  let big = setCooking(setAmount(setAmount(p, 'protein', 2), 'carbs', 3), 'fried');
  assert.equal(thumbs(big), 4);
  big = setAmount(big, 'carbs', 0);
  assert.equal(thumbs(big), 2);
});

test('a touched thumb stepper keeps its value until the cooking method changes', () => {
  let p = step(defaultPlate(), 'fat', -1); // 1.5 → 1, pinned
  assert.equal(p.thumbs, 1);
  p = setAmount(p, 'protein', 2);
  assert.equal(thumbs(p), 1, 'plate changes do not move pinned thumbs');
  p = setCooking(p, 'fried');
  assert.equal(p.thumbs, null);
  assert.equal(thumbs(p), 3.5); // 1 × (2 + 1.5)
  p = setCooking(p, 'pan');
  assert.equal(thumbs(p), 2); // 1.75 → 2
});

test('amounts move in halves and stay within range', () => {
  let p = defaultPlate();
  p = step(step(step(p, 'protein', 1), 'protein', 1), 'protein', 1);
  assert.equal(amountOf(p, 'protein'), 2, 'palms max 2');
  for (let i = 0; i < 10; i++) p = step(p, 'carbs', -1);
  assert.equal(amountOf(p, 'carbs'), 0, 'not below 0');
  for (let i = 0; i < 10; i++) p = step(p, 'veg', 1);
  assert.equal(amountOf(p, 'veg'), 3, 'fists max 3');
  for (let i = 0; i < 10; i++) p = step(p, 'fat', 1);
  assert.equal(amountOf(p, 'fat'), 4, 'thumbs max 4');
  assert.equal(amountOf(setAmount(p, 'veg', 1.3), 'veg'), 1.5);
  assert.equal(amountOf(setAmount(p, 'veg', Number.NaN), 'veg'), 0);
  assert.equal(toHalves(0.24, 3), 0);
  assert.equal(toHalves(-1, 3), 0);
  assert.equal(setAmount(p, 'nope', 1), p);
});

test('kinds change the values; unknown kinds and methods are ignored', () => {
  const p = setCooking(defaultPlate(), 'grilled');
  assert.deepEqual(plateTotals(setKind(p, 'protein', 'fish')), { kcal: 473, protein: 32.5, carbs: 70, fat: 6.1 });
  const bread = setKind(p, 'carbs', 'bread');
  assert.equal(groupGrams(bread, 'carbs'), 90);
  assert.equal(plateTotals(bread).kcal, 200 + 240 + 40);
  assert.equal(setKind(p, 'protein', 'rice'), p);
  assert.equal(setKind(p, 'veg', 'rice'), p);
  assert.equal(setCooking(p, 'boiled'), p);
  const empty = ESTIMATE_GROUPS.reduce((x, g) => setAmount(x, g, 0), defaultPlate());
  assert.deepEqual(plateTotals(empty), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  assert.ok(COOKING_METHODS.every((m) => m in COOKING_FAT));
});

test('totals are rounded once: kcal whole, macros to 0.1 g', () => {
  const p = setAmount(setKind(defaultPlate(), 'carbs', 'potato'), 'veg', 0.5); // potato fat 0.2 × 1.5 + veg 0.15 …
  const v = plateTotals(p);
  for (const k of ['protein', 'carbs', 'fat']) assert.equal(v[k], Math.round(v[k] * 10) / 10);
  assert.equal(v.kcal, Math.round(v.kcal));
});

test('logged as a quick-add entry; an empty name stores the language-neutral marker', () => {
  const v = plateTotals(defaultPlate());
  const e = quickAddEntry({ id: 'x', date: '2026-11-27', meal: 'lunch', name: estimateName('  '), ...v, now: 5 });
  assert.equal(e.name, ESTIMATE_MEAL_NAME);
  assert.equal(e.foodId, null);
  assert.equal(e.amount, 100);
  assert.deepEqual([e.per100.kcal, e.per100.protein, e.per100.carbs, e.per100.fat], [735, 35.5, 70, 33.6]);
  assert.equal(estimateName(' Curry '), 'Curry');
});

test('the stored marker is shown in the app language; typed names as typed', () => {
  assert.equal(itemName({ name: ESTIMATE_MEAL_NAME, foodId: null }), EN_CATALOGUES.food['food.estimate.defaultName']);
  for (const [lang, dict] of [['de', deFood], ['zh', zhFood]]) {
    _setDictionary(lang, dict);
    _activate(lang);
    try {
      assert.equal(itemName({ name: ESTIMATE_MEAL_NAME, foodId: null }), dict['food.estimate.defaultName']);
      assert.equal(itemName({ name: 'Curry', foodId: null }), 'Curry');
    } finally { _activate('en'); }
  }
  assert.equal(deFood['food.estimate.defaultName'], 'Geschätzte Mahlzeit');
  assert.equal(zhFood['food.estimate.defaultName'], '估算餐食');
  assert.equal(deFood['food.estimate.group.carbs'], 'Beilage');
  assert.equal(zhFood['food.estimate.group.carbs'], '主食');
});

test('every id the builder names has a catalogue key in en, de and zh', () => {
  const keys = [
    'food.estimate.title', 'food.estimate.add', 'food.estimate.defaultName',
    'food.estimate.about', 'food.estimate.announce', 'food.estimate.cooking', 'food.estimate.kindOf',
    ...ESTIMATE_GROUPS.flatMap((g) => [`food.estimate.group.${g}`, `food.estimate.less.${g}`, `food.estimate.more.${g}`]),
    ...[...PROTEIN_KINDS, ...CARB_KINDS].map((k) => `food.estimate.kind.${k}`),
    ...COOKING_METHODS.flatMap((m) => [`food.estimate.cook.${m}`, `food.estimate.cookLong.${m}`]),
    ...['palm', 'fist', 'thumb'].map((u) => `food.estimate.units.${u}_other`),
  ];
  for (const [lang, dict] of [['en', EN_CATALOGUES.food], ['de', deFood], ['zh', zhFood]]) {
    const missing = keys.filter((k) => typeof dict[k] !== 'string');
    assert.deepEqual(missing, [], lang);
  }
});

test('halves are written with ½', () => {
  assert.deepEqual([0, 0.5, 1, 1.5, 2, 3.5].map(halvesText), ['0', '½', '1', '1½', '2', '3½']);
});

test('an estimated meal is marked estimate: true (named or not); other quick adds are not', () => {
  const v = plateTotals(defaultPlate());
  const base = { id: 'x', date: '2026-11-27', meal: 'lunch', ...v, now: 5 };
  const unnamed = quickAddEntry({ ...base, name: estimateName(''), estimate: true });
  const named = quickAddEntry({ ...base, name: estimateName('Curry at Mei'), estimate: true });
  const plain = quickAddEntry({ ...base, name: 'Curry at Mei' });
  assert.equal(unnamed.estimate, true);
  assert.equal(named.estimate, true);
  assert.equal('estimate' in plain, false); // a plain quick add stores no new field
  assert.equal('estimate' in quickAddEntry({ ...base, name: '', estimate: 'yes' }), false);
  assert.ok(isEstimateEntry(unnamed));
  assert.ok(isEstimateEntry(named));
  assert.equal(isEstimateEntry(plain), false);
  // only a quick add with exactly true counts (a food entry or a garbage value does not)
  assert.equal(isEstimateEntry({ ...named, foodId: 'f1' }), false);
  for (const bad of ['true', 1, {}, null, false]) assert.equal(isEstimateEntry({ ...named, estimate: bad }), false, JSON.stringify(bad));
  assert.equal(isEstimateEntry(null), false);
  // copying a meal to another day keeps the marker
  const [copy] = copyEntries([named], { date: '2026-11-28', meal: 'dinner', now: 9, newId: () => 'y' });
  assert.equal(copy.estimate, true);
});

test('backup round trip carries estimate: true; garbage values are dropped on import', () => {
  const v = plateTotals(defaultPlate());
  const est = quickAddEntry({ id: 'a', date: '2026-11-27', meal: 'lunch', name: 'Curry', ...v, estimate: true, now: 5 });
  const plain = quickAddEntry({ id: 'b', date: '2026-11-27', meal: 'lunch', name: '', kcal: 300, now: 6 });
  const file = JSON.parse(JSON.stringify({ app: 'tracker', schemaVersion: DB_VERSION, exportedAt: 1, stores: { diary: [est, plain] } }));
  const ok = validateImport(file);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.data.stores.diary, [est, plain]);
  const odd = validateImport({ ...file, stores: { diary: [{ ...est, estimate: 'yes' }, { ...plain, estimate: { x: 1 } }, { ...plain, id: 'c', estimate: null }] } });
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.data.stores.diary.map((r) => 'estimate' in r), [false, false, false]);
  assert.equal(odd.data.stores.diary[0].name, 'Curry'); // the rest of the entry is kept
});

test('stepper labels: own sentences per group (lower case in English, German nouns capitalised)', () => {
  assert.equal(EN_CATALOGUES.food['food.estimate.less.protein'], 'Less protein');
  assert.equal(EN_CATALOGUES.food['food.estimate.more.protein'], 'More protein');
  assert.equal(deFood['food.estimate.less.protein'], 'Weniger Eiweiß');
  assert.equal(zhFood['food.estimate.more.protein'], '增加蛋白质');
  for (const g of ESTIMATE_GROUPS) {
    for (const k of [`food.estimate.less.${g}`, `food.estimate.more.${g}`]) {
      const en = EN_CATALOGUES.food[k];
      assert.match(en, /^(Less|Fewer|More) [a-z]/, k); // no "More Protein"
      assert.doesNotMatch(deFood[k], /\{/, k);
    }
  }
});
