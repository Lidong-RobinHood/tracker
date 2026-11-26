import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, tokenize, indexItem, search, decodeGenericFoods, preferMatches, nameRank, langNames } from '../src/core/food-search.js';

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

// ---- multilingual search ----

test('normalize keeps Han, folds full-width ASCII and keeps kana voicing marks', () => {
  assert.equal(normalize('鸡胸肉，生'), '鸡胸肉 生');
  assert.equal(normalize('ＡＢＣ　１２３％'), 'abc 123');
  assert.equal(normalize('Hähnchenbrust'), 'hahnchenbrust');
  assert.equal(normalize('ギョーザ'), 'ギョーザ');
  assert.deepEqual(tokenize('全脂牛奶 3.25%'), ['全脂牛奶', '3', '25']);
});

const multi = [
  { id: 'breast', en: 'Chicken, broilers or fryers, breast, meat only, raw', de: 'Hähnchen, Brathähnchen, Brust, nur Fleisch, roh', zh: '鸡肉，肉鸡，胸肉，仅肉，生' },
  { id: 'hbrust', en: 'Chicken breast, oven-roasted, fat-free, sliced', de: 'Hähnchenbrust, im Ofen gebraten, fettfrei, in Scheiben', zh: '鸡胸肉，烤制，无脂，切片' },
  { id: 'milk', en: 'Milk, whole, 3.25% milkfat', de: 'Milch, Vollmilch, 3,25 % Fett', zh: '牛奶，全脂，乳脂 3.25%' },
  { id: 'skim', en: 'Milk, nonfat, fluid', de: 'Milch, entrahmt, flüssig', zh: '牛奶，脱脂，液态' },
  { id: 'cheese', en: 'Cheese, cheddar', de: 'Käse, Cheddar', zh: '奶酪，切达' },
  { id: 'wagyu', en: 'Beef, Australian, Wagyu, raw', de: 'Rind, australisch, Wagyu, roh', zh: '牛肉，澳大利亚，Wagyu，生' },
  { id: 'blue', en: 'Blueberries, raw', de: 'Heidelbeeren, roh', zh: '蓝莓，生' },
  { id: 'oel', en: 'Oil, olive, salad or cooking', de: 'Öl, Oliven, Salat- oder Speiseöl', zh: '油，橄榄，色拉或烹饪用' },
];
const mIndex = multi.map((f) => indexItem(f.id, [f.en, f.de, f.zh]));

test('an item is found by any of its names, once, ranked by the best name', () => {
  assert.deepEqual(search('milk', mIndex).slice(0, 2).sort(), ['milk', 'skim']);
  assert.equal(search('vollmilch', mIndex)[0], 'milk');
  assert.equal(search('käse', mIndex)[0], 'cheese');
  const r = search('chicken', mIndex);
  assert.equal(new Set(r).size, r.length);
  assert.deepEqual([...r].sort(), ['breast', 'hbrust']);
  assert.deepEqual(search('', mIndex), []);
  // duplicates in the name list are ignored
  assert.equal(indexItem('x', ['Milk', 'Milk', null, '']).alt, undefined);
});

test('German umlauts: hähnchen, haehnchen and hahnchen all find Hähnchen; ö/ü too', () => {
  for (const q of ['hähnchen', 'haehnchen', 'hahnchen', 'Hähnchen', 'HAEHNCHEN']) {
    assert.deepEqual([...search(q, mIndex)].sort(), ['breast', 'hbrust'], q);
  }
  assert.equal(search('oel', mIndex)[0], 'oel');
  assert.equal(search('öl', mIndex)[0], 'oel');
  assert.equal(search('kaese', mIndex)[0], 'cheese');
  // English matching is untouched by the umlaut handling
  assert.equal(search('blue', mIndex)[0], 'blue');
  assert.deepEqual(search('blueberries', mIndex), ['blue']);
});

test('German compounds: prefix and inside matches', () => {
  assert.ok(search('hähnchen', mIndex).includes('hbrust'));
  assert.ok(search('brust', mIndex).includes('hbrust'));          // inside "hähnchenbrust" (≥3 chars)
  assert.equal(search('brust', mIndex)[0], 'breast');             // a whole word "Brust" ranks first
  // the whole word first; then the compound split "hähnchen" + "brust" across segments
  assert.deepEqual(search('hähnchenbrust', mIndex), ['hbrust', 'breast']);
  assert.equal(search('ru', mIndex).includes('hbrust'), false); // 2 chars: prefix only
  assert.ok(search('rust', mIndex).includes('hbrust'));
});

test('Chinese: Han runs match by substring, earlier and shorter names first', () => {
  assert.deepEqual([...search('牛奶', mIndex)].sort(), ['milk', 'skim']);
  assert.equal(search('脱脂', mIndex)[0], 'skim');
  assert.deepEqual(search('鸡胸', mIndex), ['hbrust']);           // not across "鸡，胸" punctuation
  assert.deepEqual([...search('鸡', mIndex)].sort(), ['breast', 'hbrust']);
  assert.deepEqual(search('牛奶 全脂', mIndex), ['milk']);          // every run must occur
  assert.deepEqual(search('牛奶 奶酪', mIndex), []);
  assert.deepEqual(search('蓝莓', mIndex), ['blue']);
  // earlier position ranks higher: 牛 starts 牛奶/牛肉 names
  assert.ok(search('肉', mIndex).indexOf('wagyu') >= 0);
  // a whole segment (胸肉) outranks the same characters inside a longer word (鸡胸肉)
  assert.equal(search('胸肉', mIndex)[0], 'breast');
  assert.equal(search('鸡胸', mIndex)[0], 'hbrust');
});

test('Chinese: mixed Latin + Han queries and full-width input', () => {
  assert.deepEqual(search('Wagyu 牛肉', mIndex), ['wagyu']);
  assert.deepEqual(search('牛肉wagyu', mIndex), ['wagyu']);
  assert.deepEqual(search('牛奶 3', mIndex), ['milk']);
  assert.deepEqual(search('牛奶 ３．２５', mIndex), ['milk']);
  assert.deepEqual(search('chicken 胸', mIndex).sort(), ['breast', 'hbrust']);
  assert.deepEqual(search('ｍｉｌｋ', mIndex).sort(), ['milk', 'skim']);
  assert.deepEqual(search('牛奶 beef', mIndex), []);
});

test('multilingual index on the real dataset stays fast', (t) => {
  const doc = JSON.parse(readFileSync(new URL('../src/data/generic-foods.json', import.meta.url), 'utf8'));
  const foods = decodeGenericFoods(doc);
  const de = JSON.parse(readFileSync(new URL('../src/data/generic-foods.de.json', import.meta.url), 'utf8')).names;
  // stand-in Chinese names (the real file comes later): deterministic Han strings of realistic length
  const zh = foods.map((f, i) => Array.from({ length: 8 + (i % 14) }, (_, k) => String.fromCharCode(0x4e00 + ((i * 31 + k * 7919) % 20000))).join(''));
  const t0 = performance.now();
  const idx = foods.map((f, i) => indexItem(f, [f.name, de[i], zh[i]]));
  const buildMs = performance.now() - t0;
  const queries = ['b', 'ba', 'ban', 'banana', 'chicken breast', 'hähnchen', 'haehnchenbrust', 'rind hack', 'milch', zh[100].slice(2, 4), `${zh[7].slice(0, 2)} x`];
  // best of 3 runs per query: the suite runs test files in parallel, so single timings are noisy
  let worst = 0;
  for (const q of queries) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const t = performance.now();
      search(q, idx, { limit: 25 });
      best = Math.min(best, performance.now() - t);
    }
    worst = Math.max(worst, best);
  }
  assert.equal(search('banana', idx, { limit: 5 })[0].name, 'Bananas, raw');
  assert.equal(search('Bananen', idx, { limit: 5 })[0].name, 'Bananas, raw');
  assert.ok(search('hähnchenbrust', idx).length > 0);
  assert.equal(search(zh[100], idx)[0], foods[100]);
  t.diagnostic(`index build ${buildMs.toFixed(0)} ms, slowest query ${worst.toFixed(1)} ms`);
  // Loose bounds that only catch pathological regressions: test files run in parallel and other work on the
  // machine makes timings noisy (typical on a laptop: build ~80 ms, query ~2 ms; see bench in the PR notes).
  assert.ok(buildMs < 20000, `index build took ${buildMs} ms`);
  assert.ok(worst < 1000, `slowest query took ${worst} ms`);
});

// ---- common-food tiers, aliases, segments, compounds ----

test('a tier lifts a staple among equally good matches but not above a clearly better one', () => {
  const items = ['Milk and cereal bar', 'Milk, sheep, fluid', 'Milk, whole, 3.25% milkfat, with added vitamin D', 'Egg substitute, powder', 'Egg, whole, raw, fresh'];
  const plain = items.map((n) => indexItem(n, n));
  const tiered = items.map((n) => indexItem(n, n, n.startsWith('Milk, whole') || n.startsWith('Egg, whole') ? { tier: 1 } : undefined));
  assert.notEqual(search('milk', plain)[0], items[2]);
  assert.equal(search('milk', tiered)[0], items[2]);
  assert.equal(search('egg', tiered)[0], items[4]);
  assert.deepEqual(search('egg substitute', tiered), [items[3]]);       // every query word must match
  assert.equal(indexItem('x', 'x', { tier: 0 }).tier, undefined);
  assert.equal(indexItem('x', 'x', null).tier, undefined);
});

test('aliases are searchable names but never the primary one', () => {
  const e = indexItem('oats', ['Cereals, oats, regular and quick, dry'], { tier: 1, aliases: ['Haferflocken', '燕麦片'] });
  assert.deepEqual(e.words, ['cereals', 'oats', 'regular', 'and', 'quick', 'dry']);
  assert.equal(e.alt.length, 2);
  assert.deepEqual(search('haferflocken', [e]), ['oats']);
  assert.deepEqual(search('燕麦片', [e]), ['oats']);
});

test('short tokens are not plurals ("ei" is not "eis"); German plurals and inflections match', () => {
  const idx = ['Eis-Keks-Sandwich', 'Ei, Vollei, roh', 'Kartoffelmehl', 'Kartoffeln, roh', 'Joghurt, griechisch, natur', 'Oliven, reif']
    .map((n) => indexItem(n, n));
  assert.equal(search('ei', idx)[0], 'Ei, Vollei, roh');
  assert.equal(search('kartoffel', idx)[0], 'Kartoffeln, roh');
  assert.deepEqual(search('griechischer joghurt', idx), ['Joghurt, griechisch, natur']);
  assert.deepEqual(search('olivenöl', idx), []);                    // "öl" is not an ending of "oliven"
});

test('German compounds match across words: "olivenöl" finds "Öl, Oliven"', () => {
  const idx = ['Öl, Oliven, Speiseöl', 'Mayonnaise, mit Olivenöl', 'Pute, Brust, roh', 'Putenbrust, in Scheiben'].map((n) => indexItem(n, n));
  assert.deepEqual(search('olivenöl', idx), ['Mayonnaise, mit Olivenöl', 'Öl, Oliven, Speiseöl']);
  assert.deepEqual(search('putenbrust', idx), ['Putenbrust, in Scheiben', 'Pute, Brust, roh']);
  assert.deepEqual(search('putenbrust', idx.slice(0, 3)), ['Pute, Brust, roh']);
});

test('Chinese: whole segments and parenthesised synonyms beat matches inside a longer word', () => {
  const idx = [
    ['turkey', '火鸡，火鸡腿（琵琶腿），仅肉，生'], ['chicken', '鸡肉，肉鸡，鸡腿（全腿），仅肉，生'],
    ['potato', '土豆（马铃薯），生'], ['flour', '土豆粉（马铃薯粉）'], ['rice', '大米，白米，熟（米饭）'], ['mix', '调味黄米饭，干粉料包'],
  ].map(([id, zh]) => indexItem(id, zh));
  assert.equal(search('鸡腿', idx)[0], 'chicken');
  assert.equal(search('火鸡腿', idx)[0], 'turkey');
  assert.equal(search('马铃薯', idx)[0], 'potato');
  assert.equal(search('米饭', idx)[0], 'rice');
});

test('Chinese: a query spanning two segments matches when both parts occur (鸡腿肉 → 鸡腿 … 肉)', () => {
  const idx = [['leg', '鸡肉，肉鸡，鸡腿（全腿），仅肉，生'], ['white', '鸡蛋，蛋清（蛋白），生'], ['milk', '牛奶，全脂']]
    .map(([id, zh]) => indexItem(id, zh));
  assert.deepEqual(search('鸡腿肉', idx), ['leg']);
  assert.deepEqual(search('鸡蛋清', idx), ['white']);
  assert.deepEqual(search('牛奶清', idx), []);
  assert.deepEqual(search('蛋清', idx), ['white']);
  assert.deepEqual(search('鸡奶', idx), []);                          // two-character runs are not split
});

test('language ranks: a match only in another language ranks below the app language, loose ones last', () => {
  const berries = indexItem('berries', [{ text: 'Berries, mixed', rank: 0 }, { text: 'Beeren, gemischt', rank: 2 }], { tier: 1 });
  const beer = indexItem('beer', [{ text: 'Beverages, beer, regular', rank: 0 }, { text: 'Getränke, Bier', rank: 2 }]);
  const ginger = indexItem('ginger', ['Ginger root, raw']);
  const eggplant = indexItem('eggplant', ['Eggplant, raw', { text: 'Aubergine, roh', rank: 2 }], { tier: 1 });
  assert.deepEqual(search('beer', [berries, beer]), ['beer', 'berries']);           // tier bonus does not undo it
  assert.deepEqual(search('gin', [eggplant, ginger]), ['ginger', 'eggplant']);      // inside a German word: last
  assert.deepEqual(search('beeren', [beer, berries]), ['berries']);                 // other-language words still work
  assert.equal(nameRank('de', 'en'), 2);
  assert.equal(nameRank('en', 'de'), 1);
  assert.equal(nameRank('zh', 'zh'), 0);
  assert.equal(nameRank(null, 'de'), 0);
  assert.deepEqual(langNames('de', { en: 'Beer', de: 'Bier', zh: '啤酒' }),
    [{ text: 'Bier', rank: 0 }, { text: 'Beer', rank: 1 }, { text: 'Bier', rank: 0 }, { text: '啤酒', rank: 2 }]);
  // the same text in two languages counts in the better one
  const same = indexItem('tofu', [{ text: 'Tofu', rank: 0 }, { text: 'Tofu', rank: 2 }]);
  assert.equal(same.rank, undefined);
});
