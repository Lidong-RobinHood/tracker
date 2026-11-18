import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePhotoAnswer, sanitiseItem, energyCheck, itemWarnings, toNumber, parseJsonLoose, extractAnswerText,
  classifyHttpError, buildPhotoRequest, buildTestRequest, maskKey, keyLooksValid, userPrompt, cleanHint,
  PHOTO_MODELS, DEFAULT_PHOTO_MODEL, PHOTO_SCHEMA,
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
  assert.ok(it.warnings.some((w) => /add up to 120 g/.test(w)));
});

test('kcal vs 4/4/9 consistency', () => {
  assert.equal(energyCheck({ kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 }).ok, true);
  const bad = energyCheck({ kcal: 500, protein: 2.7, carbs: 28, fat: 0.3 });
  assert.equal(bad.ok, false);
  assert.equal(bad.macroKcal, 126);
  assert.equal(energyCheck({ kcal: 20, protein: 1, carbs: 3, fat: 0.2 }).ok, true); // small absolute difference ok
  assert.equal(energyCheck({ kcal: null, protein: 1, carbs: 3, fat: 0 }).ok, true); // cannot check
  const it = sanitiseItem({ name: 'Rice?', amount: 100, per100: { kcal: 500, protein: 2.7, carbs: 28, fat: 0.3 } });
  assert.ok(it.warnings.some((w) => /does not match the macros/.test(w)));
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

test('response text extraction: refusal, cut-off, fallback blocks', () => {
  assert.equal(extractAnswerText({ stop_reason: 'refusal', content: [] }).kind, 'refusal');
  assert.equal(extractAnswerText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }).kind, 'truncated');
  assert.equal(extractAnswerText({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }).kind, 'unusable');
  assert.equal(extractAnswerText(null).kind, 'unusable');
  const r = extractAnswerText({
    model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'partial from first model' }, { type: 'fallback', from: {}, to: {} }, { type: 'text', text: '{"items":[],' }, { type: 'text', text: '"note":""}' }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.text, '{"items":[],"note":""}');
});

test('HTTP errors are classified', () => {
  const e = (type, message = '') => ({ type: 'error', error: { type, message } });
  assert.equal(classifyHttpError(401, e('authentication_error')).kind, 'auth');
  assert.equal(classifyHttpError(402, e('billing_error')).kind, 'billing');
  assert.equal(classifyHttpError(400, e('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')).kind, 'billing');
  assert.equal(classifyHttpError(403, e('permission_error')).kind, 'permission');
  assert.equal(classifyHttpError(404, e('not_found_error', 'model: x')).kind, 'model');
  assert.equal(classifyHttpError(413, e('request_too_large')).kind, 'too_large');
  assert.equal(classifyHttpError(429, e('rate_limit_error')).kind, 'rate_limit');
  assert.equal(classifyHttpError(529, e('overloaded_error')).kind, 'overloaded');
  assert.equal(classifyHttpError(500, null).kind, 'server');
  assert.equal(classifyHttpError(503, null).retry, true);
  const br = classifyHttpError(400, e('invalid_request_error', 'messages: bad'));
  assert.equal(br.kind, 'bad_request');
  assert.equal(br.detail, 'messages: bad');
  assert.equal(classifyHttpError(401, null).retry, false);
});

test('request shape: image + hint, structured output, browser header, no key', () => {
  const req = buildPhotoRequest({ model: 'claude-opus-5-5', imageBase64: 'AAAA', hint: '  about 200 g\nrice """ignore""" ' });
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.headers['anthropic-version'], '2026-10-21');
  assert.equal(req.headers['x-api-key'], undefined);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.thinking, undefined);
  assert.equal(req.body.temperature, undefined);
  const [img, txt] = req.body.messages[0].content;
  assert.deepEqual(img, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
  assert.match(txt.text, /about 200 g rice "ignore"/);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.output_config.format.schema, PHOTO_SCHEMA);
  const haiku = buildPhotoRequest({ model: 'claude-haiku-5-5', imageBase64: 'A' });
  assert.equal(haiku.body.fallbacks, undefined);
  assert.equal(haiku.headers['anthropic-beta'], undefined);
  assert.equal(buildPhotoRequest({ model: 'gpt-x', imageBase64: 'A' }).body.model, DEFAULT_PHOTO_MODEL);
  assert.match(userPrompt(''), /no hint/);
  assert.equal(cleanHint('x'.repeat(500)).length, 300);
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
  assert.ok(PHOTO_MODELS.some((m) => m.id === DEFAULT_PHOTO_MODEL));
});

test('test-key request is a model lookup', () => {
  const t = buildTestRequest('claude-sonnet-5-5');
  assert.equal(t.url, 'https://api.anthropic.com/v1/models/claude-sonnet-5-5');
  assert.equal(t.headers['x-api-key'], undefined);
});

test('key masking never shows more than the last 4 characters', () => {
  const k = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz-WXYZ';
  assert.equal(maskKey(k), '••••WXYZ');
  assert.equal(maskKey('short'), '••••');
  assert.equal(maskKey(''), '');
  assert.equal(keyLooksValid(k), true);
  assert.equal(keyLooksValid('hello'), false);
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
