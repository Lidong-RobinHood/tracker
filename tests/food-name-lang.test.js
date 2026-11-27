// "Show the name as I typed it": a generic (USDA) food found through another language's name is shown in that
// language (search result, portion, diary, saved meals, recents, Your foods) until the user renames it; stored as
// the optional `nameLang` on the food. Search: src/core/food-search.js searchMatches; storage:
// src/core/food-names.js, src/core/food-diary.js toFoodRecord; display: src/food/names.js, src/food/generic.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  indexItem, search, searchMatches, langNames, forLanguage, commonFoodsFromFile, decodeGenericFoods, foodIdsHash,
} from '../src/core/food-search.js';
import {
  namesFromFile, localFoodName, nameHash, shownNameLang, withNameLang, nameLangForRecord, isFoodNameLang,
} from '../src/core/food-names.js';
import { toFoodRecord, makeEntry } from '../src/core/food-diary.js';
import { validateImport, DB_VERSION } from '../src/db/db.js';

// ---- search: which language a result was found in ----

const FOODS = [
  { id: 'breast', en: 'Chicken, broilers or fryers, breast, meat only, raw', de: 'Hähnchen, Brust, nur Fleisch, roh', zh: '鸡肉，胸肉，仅肉，生' },
  { id: 'potato', en: 'Potatoes, flesh and skin, raw', de: 'Kartoffeln, Fleisch und Schale, roh', zh: '土豆，带皮，生' },
  { id: 'pizza', en: 'Pizza, cheese topping, regular crust', de: 'Pizza, Käsebelag, normaler Boden', zh: '披萨，奶酪馅料，普通饼底' },
  { id: 'tofu', en: 'Tofu, raw, firm', de: 'Tofu, roh, fest', zh: '豆腐，生，老豆腐' },
  { id: 'milk', en: 'Milk, whole', de: 'Milch, Vollmilch', zh: '牛奶，全脂' },
  { id: 'wagyu', en: 'Beef, Australian, Wagyu, raw', de: 'Rind, australisch, Wagyu, roh', zh: '牛肉，澳大利亚，Wagyu，生' },
  { id: 'oats', en: 'Cereals, oats, regular', de: 'Getreide, Hafer, normal', zh: '谷物，燕麦，普通' },
];
const ALIASES = { oats: [{ text: 'Haferflocken', lang: 'de' }, { text: 'rolled oats', lang: 'en' }, { text: '燕麦片', lang: 'zh' }] };

/** Index as src/food/generic.js builds it for app language `lang`. */
const indexFor = (lang) => FOODS.map((f) => indexItem(f.id, langNames(lang, f), forLanguage(ALIASES[f.id] ? { tier: 1, aliases: ALIASES[f.id] } : undefined, lang)));
/** Language the food `id` was found in by `q` (undefined: not found). */
function foundIn(lang, q, id, idx = indexFor(lang)) {
  const m = searchMatches(q, idx).find((x) => x.item === id);
  return m ? m.lang : undefined;
}

// [query, food id, expected language: null = the app language]
const TABLE = {
  en: [
    ['鸡胸肉', 'breast', 'zh'], ['土豆', 'potato', 'zh'], ['豆腐', 'tofu', 'zh'], ['牛奶', 'milk', 'zh'],
    ['Kartoffel', 'potato', 'de'], ['kartoffeln', 'potato', 'de'], ['hähnchen brust', 'breast', 'de'], ['haehnchen', 'breast', 'de'],
    ['Milch', 'milk', 'de'], ['Vollmilch', 'milk', 'de'], ['haferflocken', 'oats', 'de'], // German alias
    ['chicken breast', 'breast', null], ['potatoes', 'potato', null], ['rolled oats', 'oats', null],
    ['pizza', 'pizza', null], ['tofu', 'tofu', null], ['wagyu', 'wagyu', null], ['milk', 'milk', null], // shared words: app wins
  ],
  de: [
    ['鸡胸肉', 'breast', 'zh'], ['豆腐', 'tofu', 'zh'], ['燕麦片', 'oats', 'zh'], // Chinese alias
    ['chicken', 'breast', 'en'], ['potatoes', 'potato', 'en'], ['whole milk', 'milk', 'en'], ['rolled oats', 'oats', 'en'],
    ['Kartoffel', 'potato', null], ['Hähnchen', 'breast', null], ['Milch', 'milk', null], ['haferflocken', 'oats', null],
    ['pizza', 'pizza', null], ['tofu', 'tofu', null], ['wagyu', 'wagyu', null], ['roh', 'tofu', null],
  ],
  zh: [
    ['chicken breast', 'breast', 'en'], ['potatoes', 'potato', 'en'], ['milk', 'milk', 'en'], ['tofu', 'tofu', 'en'],
    ['Kartoffel', 'potato', 'de'], ['Hähnchen', 'breast', 'de'], ['Milch', 'milk', 'de'], ['haferflocken', 'oats', 'de'],
    ['鸡胸肉', 'breast', null], ['土豆', 'potato', null], ['豆腐', 'tofu', null], ['燕麦片', 'oats', null],
    ['wagyu', 'wagyu', null], // the Chinese name has the Latin word too: the app language wins
    ['pizza', 'pizza', 'en'], // English and German both say "Pizza": English first (rank order)
  ],
};

for (const [lang, rows] of Object.entries(TABLE)) {
  test(`searchMatches (${lang} app): the language each query found the food in`, () => {
    const idx = indexFor(lang);
    const wrong = rows.filter(([q, id, want]) => foundIn(lang, q, id, idx) !== want)
      .map(([q, id, want]) => `${q} → ${id}: ${foundIn(lang, q, id, idx)} (want ${want})`);
    assert.deepEqual(wrong, []);
  });
}

test('searchMatches ranks exactly like search() and returns [] for an empty query', () => {
  for (const lang of ['en', 'de', 'zh']) {
    const idx = indexFor(lang);
    for (const q of ['pizza', 'Kartoffel', '鸡胸肉', 'milk', 'roh']) {
      assert.deepEqual(searchMatches(q, idx).map((m) => m.item), search(q, idx));
    }
    assert.deepEqual(searchMatches('', idx), []);
  }
});

test('a Han query means Chinese, also mixed with Latin words', () => {
  const idx = indexFor('en');
  assert.equal(foundIn('en', 'wagyu 牛肉', 'wagyu', idx), 'zh');
  assert.equal(foundIn('de', 'wagyu 牛肉', 'wagyu'), 'zh');
  assert.equal(foundIn('zh', 'wagyu 牛肉', 'wagyu'), null);
});

test('names without a language (plain strings, a user\'s own names) never switch the language', () => {
  const idx = [indexItem('x', ['Kartoffelsalat', 'Potato salad'])];
  assert.deepEqual(searchMatches('kartoffel', idx), [{ item: 'x', lang: null }]);
  // the same text in two languages counts as the app language's
  const same = indexItem('tofu', [{ text: 'Tofu', rank: 0, lang: null }, { text: 'Tofu', rank: 2, lang: 'de' }]);
  assert.equal(same.lang, undefined);
  const both = indexItem('t', [{ text: 'Tofu, roh', rank: 2, lang: 'de' }, { text: 'Tofu, roh', rank: 1, lang: 'en' }]);
  assert.equal(both.lang, 'de'); // first language kept, best rank kept
  assert.equal(both.rank, 1);
});

test('langNames tags languages; the shown name of a food pinned to another language keeps its language', () => {
  const n = { en: 'Potatoes, raw', de: 'Kartoffeln, roh', zh: '土豆，生' };
  assert.deepEqual(langNames('en', n, 'Kartoffeln, roh', 'de'), [
    { text: 'Kartoffeln, roh', rank: 0, lang: 'de' }, { text: 'Potatoes, raw', rank: 0, lang: null },
    { text: 'Kartoffeln, roh', rank: 0, lang: 'de' }, { text: '土豆，生', rank: 2, lang: 'zh' }]);
  // Your foods (en app): a food pinned to German is found in German by German words, in English by English ones
  const idx = [indexItem('p', langNames('en', n, 'Kartoffeln, roh', 'de'))];
  assert.equal(searchMatches('kartoffeln', idx)[0].lang, 'de');
  assert.equal(searchMatches('potatoes', idx)[0].lang, null);
  assert.equal(searchMatches('土豆', idx)[0].lang, 'zh');
  // a missing app-language translation: English is shown and counts as the app language
  assert.equal(searchMatches('potatoes', [indexItem('p', langNames('de', { en: 'Potatoes, raw', zh: '土豆，生' }))])[0].lang, null);
});

test('forLanguage tags aliases with their language (none for the app language or untagged ones)', () => {
  const entry = commonFoodsFromFile({ aliases: { 1: { de: ['Haferflocken'], en: ['rolled oats'] }, 2: ['Porridge'] } });
  assert.deepEqual(forLanguage(entry.get(1), 'en').aliases, [{ text: 'Haferflocken', rank: 2, lang: 'de' }, { text: 'rolled oats', rank: 0, lang: null }]);
  assert.deepEqual(forLanguage(entry.get(2), 'zh').aliases, [{ text: 'Porridge', rank: 0, lang: null }]);
});

// Real data files, indexed with each names file's own ids (so a base file being rebuilt does not shift them).
test('real data: cross-language queries show the food in the language typed', (t) => {
  const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
  let foods; let maps; let common;
  try {
    foods = decodeGenericFoods(readJson('src/data/generic-foods.json'));
    common = commonFoodsFromFile(readJson('src/data/generic-foods-common.json'));
    maps = Object.fromEntries(['de', 'zh'].map((l) => {
      const r = namesFromFile(readJson(`src/data/generic-foods.${l}.json`), l);
      return [l, r.ok ? r.names : null];
    }));
  } catch (err) { t.skip(`data files not readable: ${err.message}`); return; }
  if (!maps.de || !maps.zh) { t.skip('a names file is broken'); return; }
  const idx = (lang) => foods.map((f) => indexItem(f, langNames(lang, { en: f.name, de: localFoodName(f, maps.de), zh: localFoodName(f, maps.zh) }),
    forLanguage(common.get(Number(f.sourceKey.slice(5))), lang)));
  // [app language, query, sourceKey, expected language]
  const cases = [
    ['en', '鸡胸肉', 'usda:171077', 'zh'], ['en', 'Kartoffel', 'usda:170026', 'de'], ['en', '牛奶', 'usda:171265', 'zh'],
    ['en', 'tofu', 'usda:172475', null], ['en', 'milk', 'usda:171265', null],
    ['de', 'chicken breast', 'usda:171077', 'en'], ['de', '豆腐', 'usda:172475', 'zh'], ['de', 'Milch', 'usda:171265', null], ['de', 'tofu', 'usda:172475', null],
    ['zh', 'Kartoffel', 'usda:170026', 'de'], ['zh', 'chicken breast', 'usda:171077', 'en'], ['zh', '牛奶', 'usda:171265', null],
  ];
  const built = {};
  const wrong = [];
  for (const [lang, q, key, want] of cases) {
    built[lang] ||= idx(lang);
    if (!foods.some((f) => f.sourceKey === key)) continue; // food dropped from the base file
    const m = searchMatches(q, built[lang], { limit: 25 }).find((x) => x.item.sourceKey === key);
    if (!m || m.lang !== want) wrong.push(`${lang} ${q} → ${key}: ${m ? m.lang : 'not in top 25'} (want ${want})`);
  }
  assert.deepEqual(wrong, []);
});

// ---- storing nameLang ----

const usda = { source: 'usda', sourceKey: 'usda:170026', barcode: null, name: 'Potatoes, flesh and skin, raw', brand: null, basis: 'g', per100: { kcal: 77, protein: 2, carbs: 17, fat: 0.1 }, servings: [] };

test('nameLang helpers: valid codes on generic foods only', () => {
  assert.deepEqual(['en', 'de', 'zh', 'fr', '', null, 1].map(isFoodNameLang), [true, true, true, false, false, false, false]);
  assert.equal(shownNameLang({ ...usda, nameLang: 'de' }, 'en'), 'de');
  assert.equal(shownNameLang({ ...usda, nameLang: 'xx' }, 'en'), 'en');
  assert.equal(shownNameLang(usda, 'zh'), 'zh');
  assert.equal(shownNameLang({ ...usda, source: 'off', nameLang: 'de' }, 'en'), 'en'); // OFF / custom: as they came
  assert.equal(shownNameLang(null, 'de'), 'de');
  assert.equal(withNameLang(usda, 'zh').nameLang, 'zh');
  assert.equal(withNameLang(usda, null).nameLang, null);
  assert.equal(withNameLang(usda, 'xx').nameLang, null);
  assert.equal('nameLang' in withNameLang({ ...usda, source: 'custom', nameLang: 'de' }, 'de'), false);
  assert.equal('nameLang' in usda, false); // a copy, the dataset item is unchanged
});

test('toFoodRecord: a search result sets nameLang, null clears it, a food without the field keeps the stored one', () => {
  const now = 1000;
  const first = toFoodRecord(withNameLang(usda, 'de'), { id: 'f1', now });
  assert.equal(first.nameLang, 'de');
  assert.equal(first.name, usda.name); // the canonical English name stays
  // found again through Chinese: the most recent add wins
  assert.equal(toFoodRecord(withNameLang(first, 'zh'), { id: 'x', now, existing: first }).nameLang, 'zh');
  // found through the app language: cleared (no field at all)
  const cleared = toFoodRecord(withNameLang(first, null), { id: 'x', now, existing: first });
  assert.equal('nameLang' in cleared, false);
  // no field on the incoming food (e.g. the dataset copy): keep the stored one
  assert.equal(toFoodRecord(usda, { id: 'x', now, existing: first }).nameLang, 'de');
  // the stored record itself (Recent, editor): unchanged
  assert.equal(toFoodRecord(first, { id: 'x', now, existing: first }).nameLang, 'de');
  // invalid values and other sources are dropped
  assert.equal('nameLang' in toFoodRecord({ ...usda, nameLang: 'fr' }, { id: 'x', now }), false);
  assert.equal('nameLang' in toFoodRecord({ ...usda, source: 'off', sourceKey: 'off:1', nameLang: 'de' }, { id: 'x', now }), false);
  assert.equal(nameLangForRecord({ ...usda, nameLang: undefined }, first), null); // own property wins, even undefined
});

// ---- display ----

const NAME_IDS = [170026, 171265];
const EN_NAMES = ['Potatoes, flesh and skin, raw', 'Milk, whole'];
const namesDoc = (lang, names) => ({ lang, count: 2, idsHash: foodIdsHash(NAME_IDS), ids: NAME_IDS, en: EN_NAMES.map(nameHash), names });
const FILES = {
  de: namesDoc('de', ['Kartoffeln, roh', 'Vollmilch']),
  zh: namesDoc('zh', ['土豆，生', '全脂牛奶']),
};

test('display: a stored food with nameLang is shown in that language in every app language until renamed', async () => {
  // names files from memory instead of the network (src/food/generic.js fetches them)
  globalThis.fetch = async (url) => {
    const m = /generic-foods\.(de|zh)\.json$/.exec(String(url));
    return m ? { ok: true, json: async () => FILES[m[1]] } : { ok: false, status: 404 };
  };
  const { _setDictionary, _activate } = await import('../src/i18n/index.js');
  const { ensureDisplayNames } = await import('../src/food/generic.js');
  const { foodName, itemName } = await import('../src/food/names.js');
  const deFood = (await import('../src/i18n/de/food.js')).default;
  const zhFood = (await import('../src/i18n/zh/food.js')).default;
  _setDictionary('de', deFood);
  _setDictionary('zh', zhFood);

  const food = { ...toFoodRecord(withNameLang(usda, 'zh'), { id: 'f1', now: 1 }) };
  const entry = makeEntry({ id: 'e1', date: '2026-11-27', meal: 'lunch', food, amount: 150, now: 1 });
  const plain = toFoodRecord(usda, { id: 'f2', now: 1 });
  const shown = {};
  for (const lang of ['en', 'de', 'zh']) {
    _activate(lang);
    await ensureDisplayNames([food, plain]);
    shown[lang] = [foodName(food), itemName(entry, food), foodName(plain), foodName({ ...food, name: 'My potatoes' })];
  }
  _activate('en');
  assert.deepEqual(shown, {
    en: ['土豆，生', '土豆，生', 'Potatoes, flesh and skin, raw', 'My potatoes'],
    de: ['土豆，生', '土豆，生', 'Kartoffeln, roh', 'My potatoes'],
    zh: ['土豆，生', '土豆，生', '土豆，生', 'My potatoes'],
  });
  // pinned to English: the stored English name in every language; an entry renamed in the editor stays as typed
  _activate('de');
  const en = { ...food, nameLang: 'en' };
  assert.equal(foodName(en), usda.name);
  assert.equal(itemName({ ...entry, name: 'Kartoffeln vom Markt' }, food), 'Kartoffeln vom Markt');
  // a search result copy (nameLang null) follows the app language
  assert.equal(foodName(withNameLang(usda, null)), 'Kartoffeln, roh');
  _activate('en');
});

// ---- backup ----

test('backup round trip carries nameLang; files without it import as before', () => {
  const pinned = toFoodRecord(withNameLang(usda, 'de'), { id: 'f1', now: 1 });
  const plain = toFoodRecord({ ...usda, sourceKey: 'usda:171265', name: 'Milk, whole' }, { id: 'f2', now: 1 });
  const file = JSON.parse(JSON.stringify({ app: 'tracker', schemaVersion: DB_VERSION, exportedAt: 1, stores: { foods: [pinned, plain] } }));
  const v = validateImport(file);
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.stores.foods, [pinned, plain]);
  assert.equal(v.data.stores.foods[0].nameLang, 'de');
  assert.equal('nameLang' in v.data.stores.foods[1], false);
  // an unknown value in a hand-edited file is accepted but ignored when shown (and dropped on the next save)
  const odd = validateImport({ ...file, stores: { foods: [{ ...pinned, nameLang: 'fr' }] } });
  assert.equal(odd.ok, true);
  assert.equal(shownNameLang(odd.data.stores.foods[0], 'en'), 'en');
  assert.equal('nameLang' in toFoodRecord(odd.data.stores.foods[0], { id: 'f1', now: 2 }), false);
});
