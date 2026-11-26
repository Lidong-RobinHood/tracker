import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT, COMPLETE_LANGS, splitSegments, extractSegments, composeNames, baseNames, loadBase, loadDict, loadOverrides,
} from '../tools/build-food-names.mjs';
import { foodIdsHash } from '../src/core/food-search.js';
import { namesFromFile, nameHash } from '../src/core/food-names.js';

const base = loadBase();
const { ids } = baseNames(base);
const DATA = join(ROOT, 'src', 'data');
const composedLangs = readdirSync(DATA).map((f) => /^generic-foods\.([a-z]{2}(?:-[A-Za-z]+)?)\.json$/.exec(f)).filter(Boolean).map((m) => m[1]);

test('splitSegments splits at top-level commas only', () => {
  assert.deepEqual(splitSegments('Beef, chuck , arm pot roast, trimmed to 1/8" fat'), ['Beef', 'chuck', 'arm pot roast', 'trimmed to 1/8" fat']);
  assert.deepEqual(splitSegments('Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof'),
    ['Alcoholic beverage', 'distilled', 'all (gin, rum, vodka, whiskey) 80 proof']);
  assert.deepEqual(splitSegments('Game meat , bison,  ground'), ['Game meat', 'bison', 'ground']);
});

test('composeNames uses group keys, keeps untranslated segments and reports them', () => {
  const mini = { fields: ['fdcId', 'name'], foods: [[1, 'Nuts, almonds, roasted'], [2, 'Beef, roasted, raw'], [3, 'Beef, mystery'], [4, 'Fish, pike, northern']] };
  const dict = { Nuts: 'Nüsse', almonds: 'Mandeln', roasted: 'gebraten', 'Nuts|roasted': 'geröstet', Beef: 'Rind', raw: 'roh', Fish: 'Fisch', pike: 'Hecht', 'Fish|northern': '-' };
  const { doc, missing } = composeNames(mini, dict, { 3: 'Rind, Geheimnis' }, 'de');
  assert.deepEqual(doc.names, ['Nüsse, Mandeln, geröstet', 'Rind, gebraten, roh', 'Rind, Geheimnis', 'Fisch, Hecht']);
  assert.equal(doc.count, 4);
  assert.equal(doc.idsHash, foodIdsHash([1, 2, 3, 4]));
  assert.equal(missing.size, 0);
  const r = composeNames(mini, {}, {}, 'de');
  assert.equal(r.doc.names[0], 'Nuts, almonds, roasted');
  assert.equal(r.missing.get('roasted'), 2);
});

test('every segment of the base file is extracted', () => {
  const segs = extractSegments(base);
  const set = new Set(segs.map((s) => s.segment));
  for (const n of baseNames(base).names.slice(0, 500)) for (const s of splitSegments(n)) assert.ok(set.has(s));
  assert.ok(segs.every((s) => s.count >= 1 && s.examples.length >= 1));
});

test('complete languages have a composed names file', () => {
  for (const lang of COMPLETE_LANGS) assert.ok(composedLangs.includes(lang), `src/data/generic-foods.${lang}.json missing`);
});

for (const lang of composedLangs) {
  test(`generic-foods.${lang}.json is aligned with generic-foods.json and up to date (node tools/build-food-names.mjs compose ${lang})`, () => {
    const doc = JSON.parse(readFileSync(join(DATA, `generic-foods.${lang}.json`), 'utf8'));
    assert.equal(doc.lang, lang);
    assert.equal(doc.count, ids.length, 'food count differs from generic-foods.json');
    assert.equal(doc.idsHash, foodIdsHash(ids), 'fdcId order differs from generic-foods.json');
    assert.equal(doc.names.length, ids.length);
    // self-contained: its own fdcIds and English-name hashes (the diary reads it without generic-foods.json)
    assert.deepEqual(doc.ids, ids, 'ids differ from generic-foods.json');
    assert.deepEqual(doc.en, baseNames(base).names.map(nameHash), 'English-name hashes differ from generic-foods.json');
    assert.equal(namesFromFile(doc, lang, ids).ok, true);
    assert.ok(doc.names.every((n) => typeof n === 'string' && n.trim()));
    const fresh = composeNames(base, loadDict(lang), loadOverrides(lang), lang);
    const stale = doc.names.findIndex((n, i) => n !== fresh.doc.names[i]);
    assert.equal(stale, -1, stale < 0 ? '' : `stale name #${stale}: "${doc.names[stale]}" (expected "${fresh.doc.names[stale]}")`);
    if (COMPLETE_LANGS.includes(lang)) {
      assert.deepEqual([...fresh.missing.keys()].slice(0, 20), [], `untranslated ${lang} segments`);
    }
  });
}

test('translation dictionaries and overrides only use known segments and ids', () => {
  const segs = new Set(extractSegments(base).map((s) => s.segment));
  const firsts = new Set(baseNames(base).names.map((n) => splitSegments(n)[0]));
  const idSet = new Set(ids.map(String));
  for (const lang of composedLangs) {
    for (const key of Object.keys(loadDict(lang))) {
      const bar = key.indexOf('|');
      if (bar < 0) assert.ok(segs.has(key), `${lang}.json: unknown segment "${key}"`);
      else {
        assert.ok(firsts.has(key.slice(0, bar)), `${lang}.json: unknown group "${key}"`);
        assert.ok(segs.has(key.slice(bar + 1)), `${lang}.json: unknown segment in "${key}"`);
      }
    }
    if (existsSync(join(ROOT, 'tools', 'food-names', `overrides.${lang}.json`))) {
      for (const id of Object.keys(loadOverrides(lang))) assert.ok(idSet.has(id), `overrides.${lang}.json: unknown fdcId ${id}`);
    }
  }
});
