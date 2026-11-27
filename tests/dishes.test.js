import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDishes, serialize, OUT_FILE, FIELDS, KITCHENS, NUTRIENTS, SOURCE, KCAL_MIN, KCAL_MAX,
} from '../tools/build-dishes.mjs';

const text = readFileSync(OUT_FILE, 'utf8');
const doc = JSON.parse(text);
const col = Object.fromEntries(FIELDS.map((f, i) => [f, i]));

test('dishes.json is in step with tools/dishes/recipes.*.json (rebuild: node tools/build-dishes.mjs)', () => {
  const { dishes, errors } = buildDishes();
  assert.deepEqual(errors, [], errors.map((e) => `${e.file}: ${e.messages.join('; ')}`).join('\n'));
  const expected = serialize(dishes, doc.builtAt);
  if (text !== expected) {
    const a = text.split('\n'), b = expected.split('\n');
    const i = a.findIndex((line, k) => line !== b[k]);
    assert.fail(`src/data/dishes.json is out of date (first difference at line ${i + 1}: ${(b[i] ?? '(end)').slice(0, 120)}); run node tools/build-dishes.mjs`);
  }
});

test('dishes.json format', () => {
  assert.equal(doc.source, SOURCE);
  assert.match(doc.builtAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(doc.fields, FIELDS);
  assert.equal(doc.count, doc.dishes.length);
  assert.ok(doc.count >= 150, `count ${doc.count}`);
  const ids = new Set();
  for (const row of doc.dishes) {
    const id = row[col.id];
    assert.equal(row.length, FIELDS.length, id);
    assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
    assert.ok(KITCHENS.includes(row[col.kitchen]), id);
    for (const l of ['en', 'de', 'zh']) assert.ok(typeof row[col.names][l] === 'string' && row[col.names][l].length, `${id} names.${l}`);
    for (const [l, list] of Object.entries(row[col.aliases])) {
      assert.ok(['en', 'de', 'zh'].includes(l) && Array.isArray(list) && list.every((s) => typeof s === 'string' && s), `${id} aliases`);
    }
    for (const n of NUTRIENTS) {
      const v = row[col[n]];
      assert.ok(v === null || (typeof v === 'number' && v >= 0), `${id} ${n}`);
    }
    const kcal = row[col.kcal];
    assert.ok(kcal >= KCAL_MIN && kcal <= 900, `${id} kcal ${kcal}`);
    const [s, n, l] = row[col.portions];
    assert.ok(s > 0 && s < n && n < l, `${id} portions`);
    // energy roughly matches the macros (4/4/9 kcal per g, alcohol and fibre allow some slack)
    const macro = 4 * row[col.protein] + 4 * row[col.carbs] + 9 * row[col.fat];
    assert.ok(Math.abs(macro - kcal) <= Math.max(25, kcal * 0.15) || row[col.names].en.toLowerCase().includes('wine'), `${id}: ${kcal} kcal vs ${Math.round(macro)} from macros`);
  }
  assert.ok(doc.dishes.every((r, i, a) => i === 0 || a[i - 1][col.id] < r[col.id]), 'sorted by id');
});

test('European file: expected snack-bar dishes in a plausible range', () => {
  const byId = new Map(doc.dishes.map((r) => [r[col.id], r]));
  const perNormal = (id) => { const r = byId.get(id); assert.ok(r, id); return (r[col.kcal] * r[col.portions][1]) / 100; };
  const range = (id, lo, hi) => { const k = perNormal(id); assert.ok(k >= lo && k <= hi, `${id}: ${Math.round(k)} kcal per normal portion`); };
  range('doner-kebab', 550, 750);
  range('currywurst-fries', 800, 1000);
  range('pizza-margherita', 800, 950);
  range('laugenbrezel', 180, 300);
});

test('build reports errors per file and keeps the valid files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dishes-'));
  try {
    const good = { id: 'test-roll', kitchen: 'german', names: { en: 'Roll', de: 'Brötchen', zh: '面包' },
      ingredients: [[175031, 60, 'roll'], [173410, 10, 'butter']], cookedWeight: 70, portions: { small: 50, normal: 70, large: 100 } };
    writeFileSync(join(dir, 'recipes.a.json'), JSON.stringify({ dishes: [good] }));
    writeFileSync(join(dir, 'recipes.b.json'), '{ "dishes": [ broken');
    writeFileSync(join(dir, 'recipes.c.json'), JSON.stringify({ dishes: [
      { ...good }, // duplicate id
      { ...good, id: 'bad-food', ingredients: [[1, 10]] },
      { ...good, id: 'bad-weight', cookedWeight: 500 },
      { ...good, id: 'bad-portions', portions: { small: 80, normal: 70, large: 100 } },
      { ...good, id: 'no-zh', names: { en: 'x', de: 'y' } },
      { ...good, id: 'too-fat', ingredients: [[173410, 100, 'butter']], cookedWeight: 100 },
      { ...good, id: 'fat-ok', ingredients: [[173410, 100, 'butter']], cookedWeight: 100, allowHigh: true },
    ] }));
    const { dishes, errors, perFile } = buildDishes({ dir });
    assert.deepEqual(dishes.map((d) => d.id), ['fat-ok', 'test-roll']);
    assert.deepEqual(perFile, [{ file: 'recipes.a.json', count: 1 }, { file: 'recipes.b.json', count: 0 }, { file: 'recipes.c.json', count: 1 }]);
    assert.deepEqual(errors.map((e) => e.file), ['recipes.b.json', 'recipes.c.json']);
    const msgs = errors[1].messages.join('\n');
    for (const s of ['duplicate id', 'unknown fdcId', 'cookedWeight', 'portions not ascending', 'missing names.zh', 'allowHigh']) assert.ok(msgs.includes(s), s);
    const d = dishes.find((x) => x.id === 'test-roll');
    // 60 g roll (293 kcal) + 10 g butter (717 kcal) → 70 g
    assert.equal(d.values.kcal, Math.round((60 * 2.93 + 10 * 7.17) / 0.7));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
