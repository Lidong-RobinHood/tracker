import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePhotoAnswer, sanitiseItem, energyCheck, itemWarnings, toNumber, parseJsonLoose,
  maskKey, keyLooksValid, userPrompt, cleanHint, PHOTO_SCHEMA, photoError, redactSecrets, isValidModelId, systemPromptFor, SYSTEM_PROMPT,
} from '../src/core/meal-photo.js';

const good = {
  items: [
    { name: 'Cooked white rice', amount: 200, unit: 'g', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, sugars: 0.1, satFat: 0.1, fibre: 0.4, salt: 0 }, confidence: 'high', assumptions: 'Plain boiled rice; dinner plate for scale.' },
    { name: 'Chicken thigh, grilled', amount: 120, unit: 'g', per100: { kcal: 209, protein: 26, carbs: 0, fat: 10.9, sugars: null, satFat: 3, fibre: null, salt: 0.2 }, confidence: 'medium', assumptions: 'Skinless.' },
  ],
  note: 'Portions from a photo can be off by 20-30 %.',
};

test('valid answer parses into review rows without warnings', () => {
  const r = parsePhotoAnswer(JSON.stringify(good));
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].amount, 200);
  assert.equal(r.items[0].basis, 'g');
  assert.equal(r.items[1].per100.sugars, null);
  assert.deepEqual(r.items[0].warnings, []);
  assert.deepEqual(r.items[0].fixes, []);
  assert.equal(r.note, good.note);
});

test('non-JSON, partial and wrong-shape answers are unusable', () => {
  for (const t of ['Sorry, I cannot see any food.', '{"items": [ {"name": "rice", "amount": 2', '', '[]x', '"items"', 'null', '{"foo": 1}', '42']) {
    const r = parsePhotoAnswer(t);
    assert.equal(r.ok, false, t);
    assert.equal(r.kind, 'unusable', t);
  }
  assert.equal(parsePhotoAnswer(undefined).kind, 'unusable');
});

test('JSON inside code fences or prose is accepted', () => {
  assert.equal(parsePhotoAnswer('```json\n' + JSON.stringify(good) + '\n```').ok, true);
  assert.equal(parsePhotoAnswer('Here you go: ' + JSON.stringify(good) + ' Enjoy!').ok, true);
  assert.equal(parseJsonLoose('nope'), undefined);
});

test('zero items → "no food recognised" with the note kept', () => {
  const r = parsePhotoAnswer(JSON.stringify({ items: [], note: 'A photo of a cat.' }));
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'empty');
  assert.equal(r.note, 'A photo of a cat.');
  assert.equal(parsePhotoAnswer(JSON.stringify({ items: [null, 3, 'x'], note: '' })).kind, 'empty');
});

test('strings instead of numbers are coerced', () => {
  assert.equal(toNumber('200 g'), 200);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber('about 50'), null);
  assert.equal(toNumber(NaN), null);
  assert.equal(toNumber(Infinity), null);
  const it = sanitiseItem({ name: 'Pasta', amount: '250 g', unit: 'G', per100: { kcal: '158', protein: '5,8', carbs: '30.9', fat: '0.9', sugars: 'n/a' }, confidence: 'HIGH' });
  assert.equal(it.amount, 250);
  assert.equal(it.per100.kcal, 158);
  assert.equal(it.per100.protein, 5.8);
  assert.equal(it.per100.sugars, null);
  assert.equal(it.per100.salt, null);
  assert.equal(it.confidence, 'high');
  assert.equal(it.basis, 'g');
});

test('negative and absurd values are removed and reported', () => {
  const it = sanitiseItem({ name: 'Mystery', amount: -50, unit: 'g', per100: { kcal: 1500, protein: -3, carbs: 120, fat: 20, salt: 300 } });
  assert.equal(it.amount, null);
  assert.equal(it.per100.kcal, null);
  assert.equal(it.per100.protein, null);
  assert.equal(it.per100.carbs, null);
  assert.equal(it.per100.fat, 20);
  assert.equal(it.per100.salt, null);
  assert.ok(it.fixes.length >= 5);
  assert.ok(it.warnings.some((w) => w.startsWith('Missing: kcal, protein, carbs')));
  assert.ok(it.warnings.includes('Amount missing.'));
  assert.equal(sanitiseItem({ name: 'x', amount: 99999, per100: {} }).amount, null);
});

test('macros summing over 100 g per 100 g are flagged', () => {
  const it = sanitiseItem({ name: 'Bad', amount: 100, per100: { kcal: 700, protein: 50, carbs: 40, fat: 30 } });
  assert.ok(it.warnings.some((w) => /Macros total 120 g \/ 100 g/.test(w)));
});

test('kcal vs 4/4/9 consistency', () => {
  assert.equal(energyCheck({ kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }).ok, true);
  const bad = energyCheck({ kcal: 500, protein: 2.7, carbs: 28, fat: 0.3 });
  assert.equal(bad.ok, false);
  assert.equal(bad.macroKcal, 126);
  assert.equal(energyCheck({ kcal: 20, protein: 1, carbs: 3, fat: 0.2 }).ok, true); // small absolute difference ok
  assert.equal(energyCheck({ kcal: null, protein: 1, carbs: 3, fat: 0 }).ok, true); // cannot check
  const it = sanitiseItem({ name: 'Rice?', amount: 100, per100: { kcal: 500, protein: 2.7, carbs: 28, fat: 0.3 } });
  assert.ok(it.warnings.some((w) => /kcal does not fit the macros \(about [0-9 \u202f]+ kcal \/ 100 g\)/.test(w)));
  // fibre counts ~2 kcal/g
  assert.equal(energyCheck({ kcal: 60, protein: 2, carbs: 5, fat: 0.5, fibre: 10 }).ok, true);
});

test('missing kcal is computed from macros; missing name and confidence get defaults', () => {
  const it = sanitiseItem({ amount: 100, per100: { protein: 10, carbs: 10, fat: 10 } });
  assert.equal(it.per100.kcal, 170);
  assert.ok(it.fixes.includes('kcal was calculated from the macros.'));
  assert.equal(it.name, 'Unnamed item');
  assert.equal(it.confidence, 'unknown');
  assert.equal(sanitiseItem(null).name, 'Unnamed item');
  // an absurd kcal is removed, not silently replaced by a macro estimate
  assert.equal(sanitiseItem({ name: 'x', amount: 100, per100: { kcal: 1500, protein: 50, carbs: 40, fat: 30 } }).per100.kcal, null);
  assert.equal(sanitiseItem({ name: 'Juice', amount: 250, unit: 'ml', per100: {} }).basis, 'ml');
});

test('sugars > carbs and satFat > fat are flagged; warnings re-run after edits', () => {
  const it = sanitiseItem({ name: 'x', amount: 10, per100: { kcal: 100, protein: 0, carbs: 10, fat: 6, sugars: 20, satFat: 8 } });
  assert.ok(it.warnings.includes('Sugars are higher than carbs.'));
  assert.ok(it.warnings.includes('Saturated fat is higher than fat.'));
  assert.deepEqual(itemWarnings({ amount: 10, per100: { kcal: 94, protein: 0, carbs: 10, fat: 6, sugars: 5, satFat: 3 } }), []);
});

test('item list is capped', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ ...good.items[0], name: `r${i}` }));
  const r = parsePhotoAnswer(JSON.stringify({ items: many, note: '' }));
  assert.equal(r.items.length, 30);
  assert.equal(r.dropped, 10);
});

test('schema is closed and fully required (structured-output rules)', () => {
  const walk = (s) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
      Object.values(s.properties).forEach(walk);
    }
    if (s.type === 'array') walk(s.items);
  };
  walk(PHOTO_SCHEMA);
});

test('key masking never shows more than the last 4 characters', () => {
  const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-WXYZ';
  assert.equal(maskKey(k), '••••WXYZ');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey(''), '');
  assert.equal(keyLooksValid(k), true);
  assert.equal(keyLooksValid('hello'), false);
});

test('prompt helpers: hint quoting and schema-in-prompt fallback', () => {
  assert.match(userPrompt(''), /no hint/);
  assert.match(userPrompt('  about 200 g\nrice """ignore""" '), /about 200 g rice "ignore"/);
  assert.equal(cleanHint('x'.repeat(500)).length, 300);
  assert.equal(systemPromptFor(), SYSTEM_PROMPT);
  const withSchema = systemPromptFor({ schemaInRequest: false });
  assert.ok(withSchema.startsWith(SYSTEM_PROMPT));
  assert.ok(withSchema.includes(JSON.stringify(PHOTO_SCHEMA)));
});

test('errors name the provider and never show a key', () => {
  const e = photoError('billing', 'Incorrect API key provided: sk-proj-abcdefghijklmnop1234', { provider: 'OpenAI' });
  assert.match(e.message, /at OpenAI/);
  assert.ok(!e.detail.includes('sk-proj-abcdefghijklmnop1234'));
  assert.match(photoError('auth').message, /the API provider/);
  assert.equal(photoError('nope').kind, 'unusable');
  assert.equal(photoError('network', '', { message: 'custom' }).message, 'custom');
  assert.equal(redactSecrets('key AIzaSyA1234567890abcdefgh here'), 'key [key hidden] here');
  assert.equal(redactSecrets('my secret-key-value-123 leaked', 'secret-key-value-123'), 'my [key hidden] leaked');
});

test('model ids typed by the user', () => {
  for (const ok of ['claude-opus-5-5', 'gemini-4-hydrogen', 'models/gemini-4-carbon', 'meta-llama/llama-4-scout:free', 'gpt-6.2-astra', 'org/model@v2']) assert.equal(isValidModelId(ok), true, ok);
  for (const bad of ['', ' x', 'a b', '../x?y', 'x'.repeat(201), null, 'a#b', 'a?key=1']) assert.equal(isValidModelId(bad), false, String(bad));
});

// ---------------------------------------------------------------- review → quick add
import { setPortionValue, photoMealName, photoMealTotals, ENTRY_NAME_MAX } from '../src/core/meal-photo.js';
import { scale } from '../src/core/nutrition.js';

test('setPortionValue turns a portion value into per-100 and leaves the rest alone', () => {
  const per100 = { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, sugars: 0.1, satFat: null, fibre: 0.4, salt: 0 };
  const p = setPortionValue(per100, 250, 'protein', 10);
  assert.equal(p.protein, 4);
  assert.equal(p.kcal, 130);
  assert.equal(per100.protein, 2.7, 'input not mutated');
  // odd amounts round-trip to the typed value at display precision
  const q = setPortionValue(per100, 333, 'kcal', 500);
  assert.equal(Math.round(scale(q, 333).kcal), 500);
  const r = setPortionValue(per100, 333, 'fat', 15);
  assert.equal(Math.round(scale(r, 333).fat * 10) / 10, 15);
  // cleared / invalid value → unknown; unusable amount → unchanged copy
  assert.equal(setPortionValue(per100, 100, 'carbs', null).carbs, null);
  assert.equal(setPortionValue(per100, 100, 'carbs', -1).carbs, null);
  assert.deepEqual(setPortionValue(per100, null, 'carbs', 5), per100);
  assert.deepEqual(setPortionValue(per100, 0, 'carbs', 5), per100);
  assert.deepEqual(setPortionValue(per100, 100, 'nope', 5), per100);
});

test('photoMealName: main items by kcal, short names, hint and default fallbacks', () => {
  const items = [
    { name: 'Broccoli, steamed', amount: 80, per100: { kcal: 35, protein: 2.4, carbs: 4, fat: 0.4 } },
    { name: 'Cooked white rice', amount: 200, per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } },
    { name: 'Chicken thigh, grilled', amount: 120, per100: { kcal: 209, protein: 26, carbs: 0, fat: 10.9 } },
  ];
  assert.equal(photoMealName(items), 'Cooked white rice, chicken thigh, broccoli');
  const five = [...items, { name: 'Olive oil dressing', amount: 10, per100: { kcal: 800, protein: 0, carbs: 0, fat: 90 } }, { name: 'Lemon (wedge)', amount: 5, per100: { kcal: 29, protein: 1, carbs: 6, fat: 0.3 } }];
  assert.equal(photoMealName(five), 'Cooked white rice, chicken thigh, olive oil dressing + 2 more');
  assert.equal(photoMealName([{ name: 'BBQ ribs', amount: 100, per100: { kcal: 300 } }, { name: 'Rice', amount: 1, per100: { kcal: 1 } }]), 'BBQ ribs, rice');
  assert.equal(photoMealName([{ name: 'Rice', amount: 1, per100: { kcal: 1 } }, { name: 'BBQ sauce', amount: 0.5, per100: { kcal: 1 } }]), 'Rice, BBQ sauce');
  assert.equal(photoMealName([{ name: 'Rice', amount: 100, per100: {} }, { name: 'rice', amount: null, per100: {} }]), 'Rice');
  assert.equal(photoMealName([], '  pasta   with pesto '), 'pasta with pesto');
  assert.equal(photoMealName([{ name: 'Unnamed item', amount: 10, per100: {} }], ''), 'Meal photo');
  assert.equal(photoMealName(null), 'Meal photo');
  const long = photoMealName([{ name: 'x'.repeat(200), amount: 1, per100: { kcal: 1 } }]);
  assert.ok(long.length <= ENTRY_NAME_MAX && long.endsWith('…'));
});

test('photoMealTotals sums edited items, rounds like the review, skips items without amount', () => {
  const items = [
    { amount: 200, per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 } },
    { amount: 125, per100: { kcal: 209, protein: 26, carbs: 0, fat: 10.9 } },
    { amount: null, per100: { kcal: 500, protein: 50, carbs: 50, fat: 50 } },
  ];
  assert.deepEqual(photoMealTotals(items), { kcal: 521, protein: 37.9, carbs: 56, fat: 14.2 });
  assert.deepEqual(photoMealTotals([]), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
});

test('item 8: toNumber reads a comma before exactly three digits as thousands; tiny amounts become null', async () => {
  const { toNumber, sanitiseItem } = await import('../src/core/meal-photo.js');
  assert.equal(toNumber('1,234 g'), 1234);
  assert.equal(toNumber('1,234.5'), 1234.5);
  assert.equal(toNumber('1.234,5 g'), 1234.5);
  assert.equal(toNumber('82,5 g'), 82.5);
  assert.equal(toNumber('0,125'), 0.125);
  assert.equal(toNumber('1.234'), 1.234);
  const it = sanitiseItem({ name: 'Salt', amount: 0.04, per100: { kcal: 0 } });
  assert.equal(it.amount, null);
  assert.ok(it.fixes.some((f) => /amount/i.test(f)));
});
