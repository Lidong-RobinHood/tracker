// Ranking of everyday foods on the real data files (generic-foods.json + de/zh names + the curated
// generic-foods-common.json), indexed the way src/food/generic.js does. Each case: [query, fdcId that must be
// within the top 3, true when it must be first].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeGenericFoods, indexItem, search, commonFoodsFromFile, forLanguage, langNames, TIER_BONUS } from '../src/core/food-search.js';

const readJson = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const doc = readJson('src/data/generic-foods.json');
const foods = decodeGenericFoods(doc);
const ids = doc.foods.map((row) => row[0]);
const de = readJson('src/data/generic-foods.de.json').names;
const zh = readJson('src/data/generic-foods.zh.json').names;
const commonDoc = readJson('src/data/generic-foods-common.json');
const common = commonFoodsFromFile(commonDoc);
const idOf = new Map(foods.map((f, i) => [f, ids[i]]));

/**
 * Index as the app builds it (src/food/generic.js): the app language's name first, then English, German,
 * Chinese, each ranked by language; aliases ranked the same way.
 */
function buildIndex(lang, withTiers = true) {
  return foods.map((f, i) => indexItem(f, langNames(lang, { en: f.name, de: de[i], zh: zh[i] }),
    withTiers ? forLanguage(common.get(ids[i]), lang) : undefined));
}

const CASES = {
  en: [
    ['egg', 171287, true], ['milk', 171265, true], ['chicken breast', 171077], ['rice', 168878], ['oats', 169705, true],
    ['potato', 170026, true], ['banana', 173944, true], ['salmon', 175167], ['tofu', 172475, true], ['bread', 172688],
    ['yogurt', 170886], ['ground beef', 174036], ['minced beef', 174036], ['olive oil', 171413, true], ['butter', 173410, true],
    ['apple', 171688], ['cheddar', 173414], ['mozzarella', 170845], ['parmesan', 170848], ['cottage cheese', 172179],
    ['greek yogurt', 171304], ['skim milk', 171269], ['boiled egg', 173424], ['fried egg', 173423], ['scrambled egg', 172187],
    ['egg white', 172183], ['chicken thigh', 173627], ['chicken drumstick', 173614], ['chicken wing', 172390],
    ['turkey breast', 171098], ['pork tenderloin', 168249], ['bacon', 168277], ['ham', 173864], ['tuna', 173709, true],
    ['shrimp', 175179], ['cod', 171955], ['brown rice', 169704], ['pasta', 169737], ['spaghetti', 169737], ['quinoa', 168917],
    ['oatmeal', 173905], ['rolled oats', 173904], ['sweet potato', 168482], ['broccoli', 170379, true], ['carrot', 170393],
    ['tomato', 170457, true], ['spinach', 168462], ['onion', 170000], ['avocado', 171705], ['strawberries', 167762],
    ['blueberries', 171711], ['orange', 169097], ['almonds', 170567], ['peanut butter', 172470], ['lentils', 172421],
    ['chickpeas', 173757], ['black beans', 173735], ['sugar', 169655], ['honey', 169640], ['coffee', 171890, true],
    ['green tea', 171917], ['orange juice', 169098], ['beer', 168746], ['red wine', 173190], ['whey protein', 173177],
  ],
  de: [
    ['ei', 171287], ['milch', 171265, true], ['hähnchenbrust', 171077, true], ['haehnchenbrust', 171077], ['reis', 168878, true],
    ['haferflocken', 173904, true], ['kartoffel', 170026], ['kartoffeln', 170026], ['banane', 173944, true], ['lachs', 175167],
    ['tofu', 172475], ['brot', 172688], ['joghurt', 170886], ['hackfleisch', 174036, true], ['rinderhackfleisch', 174036],
    ['olivenöl', 171413, true], ['butter', 173410, true], ['apfel', 171688], ['äpfel', 171688], ['gouda', 171241],
    ['mozzarella', 170845], ['parmesan', 170848], ['griechischer joghurt', 171304], ['magermilch', 171269],
    ['vollmilch', 171265, true], ['spiegelei', 173423], ['rührei', 172187], ['eiweiß', 172183], ['putenbrust', 171098],
    ['schinken', 173864], ['thunfisch', 173709], ['garnelen', 175179], ['kabeljau', 171955], ['nudeln', 169737],
    ['quinoa', 168917], ['süßkartoffel', 168482], ['brokkoli', 170379], ['karotte', 170393], ['möhre', 170393],
    ['tomate', 170457, true], ['spinat', 168462], ['zwiebel', 170000], ['avocado', 171705], ['erdbeeren', 167762],
    ['heidelbeeren', 171711], ['orange', 169097], ['mandeln', 170567], ['erdnussbutter', 172470], ['linsen', 172421],
    ['kichererbsen', 173757], ['zucker', 169655], ['honig', 169640], ['kaffee', 171890, true], ['orangensaft', 169098],
    ['bier', 168746], ['rotwein', 173190],
    ['eier', 171287, true], ['puderzucker', 169656, true], ['leinöl', 167702, true], ['champignons', 169251, true],
    ['wachsbohnen', 169320], ['hähnchenschenkel', 173627, true], ['speck', 168277, true], ['eiweißpulver', 173180, true],
    ['blaubeeren', 171711, true], ['körniger frischkäse', 172179, true], ['basmati', 168878, true],
    ['cola', 174852, true], ['wein', 173190, true], ['sahne', 170859, true], ['malzbier', 174863, true],
  ],
  zh: [
    ['鸡蛋', 171287], ['牛奶', 171265, true], ['鸡胸肉', 171077], ['米饭', 168878, true], ['燕麦', 173904], ['燕麦片', 173904],
    ['土豆', 170026], ['香蕉', 173944, true], ['三文鱼', 175167, true], ['豆腐', 172475], ['面包', 172688], ['酸奶', 170886],
    ['牛肉末', 174036, true], ['橄榄油', 171413, true], ['黄油', 173410], ['苹果', 171688, true], ['马苏里拉', 170845],
    ['希腊酸奶', 171304], ['脱脂牛奶', 171269], ['水煮蛋', 173424], ['炒蛋', 172187], ['鸡蛋清', 172183], ['蛋清', 172183],
    ['鸡腿', 173619], ['鸡腿肉', 173619], ['鸡翅', 172390], ['火鸡胸肉', 171098], ['培根', 168277], ['火腿', 173864],
    ['金枪鱼', 173709], ['金枪鱼罐头', 173709, true], ['虾', 175179], ['鳕鱼', 171955], ['糙米', 169704], ['意大利面', 169737],
    ['藜麦', 168917], ['红薯', 168482], ['西兰花', 170379], ['胡萝卜', 170393], ['西红柿', 170457, true], ['番茄', 170457],
    ['菠菜', 168462], ['洋葱', 170000], ['牛油果', 171705], ['草莓', 167762], ['蓝莓', 171711], ['橙子', 169097],
    ['杏仁', 170567], ['花生酱', 172470], ['鹰嘴豆', 173757], ['白糖', 169655], ['蜂蜜', 169640], ['咖啡', 171890, true],
    ['绿茶', 171917], ['橙汁', 169098], ['啤酒', 168746], ['乳清蛋白', 173177],
    ['芝士', 173414], ['煎蛋', 173423, true], ['鸡爪', 171119, true], ['吐司', 174924, true], ['意面', 169737, true],
    ['糙米饭', 169704, true], ['猪里脊', 168249, true],
  ],
};

/** Queries whose plain textual best match must stay first whatever the tiers. */
const GUARDS = [
  ['en', 'egg substitute', 173429], ['en', 'turkey leg', 171493], ['de', 'eiersatz', 173429],
  ['zh', '火鸡腿', 171136], ['zh', '鸡蛋替代品', 173429], ['en', 'milk chocolate', 167587],
];

for (const lang of Object.keys(CASES)) {
  test(`everyday foods rank in the top 3 (${lang}, ${CASES[lang].length} queries)`, () => {
    const index = buildIndex(lang);
    const fails = [];
    for (const [q, id, first] of CASES[lang]) {
      const top = search(q, index, { limit: 3 }).map((f) => idOf.get(f));
      if (first ? top[0] !== id : !top.includes(id)) fails.push(`${q}: want ${id}${first ? ' first' : ''}, got ${top.join(', ')}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('tiers never beat a clearly better textual match', () => {
  const idx = { en: buildIndex('en'), de: buildIndex('de'), zh: buildIndex('zh') };
  for (const [lang, q, id] of GUARDS) {
    assert.equal(idOf.get(search(q, idx[lang], { limit: 3 })[0]), id, q);
  }
});

test('without tiers (no third indexItem argument) the ranking is the plain textual one', () => {
  const plain = buildIndex('en', false);
  assert.ok(plain.every((e) => e.tier === undefined));
  // "Milk and cereal bar" style results stay where they were before tiers existed
  const top = search('milk', plain, { limit: 3 }).map((f) => f.name);
  assert.ok(!top.includes('Milk, whole, 3.25% milkfat, with added vitamin D'), top.join(' | '));
});

test('the curated list: known ids, tiers 1 or 2, sensible size, no duplicates', () => {
  const known = new Set(ids);
  const seen = new Set();
  let n = 0;
  for (const [group, entries] of Object.entries(commonDoc.groups)) {
    for (const [id, tier] of Object.entries(entries)) {
      assert.ok(known.has(Number(id)), `${group}: ${id} unknown`);
      assert.ok(!seen.has(id), `${id} listed twice`);
      assert.ok(tier === 1 || tier === 2, `${id}: tier ${tier}`);
      assert.ok(TIER_BONUS[tier] > 0);
      seen.add(id);
      n++;
    }
  }
  for (const [id, byLang] of Object.entries(commonDoc.aliases)) {
    assert.ok(known.has(Number(id)), `alias for unknown ${id}`);
    const langs = Object.keys(byLang);
    assert.ok(langs.length && langs.every((l) => ['en', 'de', 'zh'].includes(l)), `${id}: languages ${langs}`);
    for (const [l, names] of Object.entries(byLang)) {
      assert.ok(names.length && names.every((s) => typeof s === 'string' && s.trim()), id);
      assert.equal(names.some((s) => /\p{Script=Han}/u.test(s)), l === 'zh', `${id}: ${l} aliases ${names}`);
    }
  }
  assert.ok(n >= 300 && n <= 600, `${n} entries`);
  assert.equal(common.get(171287).tier, 1);
  assert.deepEqual(common.get(173904).aliases.find((a) => a.text === 'Haferflocken'), { text: 'Haferflocken', lang: 'de' });
});

test('search over the full three-language index with tiers stays fast', (t) => {
  const index = buildIndex('zh');
  const queries = ['e', 'egg', 'chicken breast', 'hähnchenbrust', 'haferflocken', 'kartoffel', '鸡', '鸡胸肉', '鸡腿肉', '金枪鱼罐头', 'xyzxyz'];
  let worst = 0;
  for (const q of queries) {
    let best = Infinity;
    for (let k = 0; k < 3; k++) {
      const t0 = performance.now();
      search(q, index, { limit: 25 });
      best = Math.min(best, performance.now() - t0);
    }
    worst = Math.max(worst, best);
  }
  t.diagnostic(`slowest query ${worst.toFixed(1)} ms`);
  assert.ok(worst < 1000, `slowest query took ${worst} ms`); // loose: test files run in parallel
});

// ---- cross-language traps: a match only in another language's name ranks below the app language's ----

/** Best (lowest) language rank of a name of item i that matches the query on its own: 0 app language, 1 English, 2 other. */
function matchRank(lang, i, q) {
  const names = langNames(lang, { en: foods[i].name, de: de[i], zh: zh[i] });
  const aliases = (forLanguage(common.get(ids[i]), lang) || {}).aliases || [];
  let best = Infinity;
  for (const n of [...names, ...aliases]) {
    if (search(q, [indexItem(n.text, n.text)]).length) best = Math.min(best, n.rank);
  }
  return best;
}

const TRAPS = {
  // English UI: German "Beeren" (berries), "Aubergine", "Rumpsteak"-style and "Bundesstaat" matches must not lead
  en: [['beer', 'Alcoholic beverage, beer, regular, all'], ['gin', null], ['rum', 'Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 80 proof'], ['bun', null]],
  // German UI: English "seeds", "barley", "ginger", "nuggets" (reh) must not lead
  de: [['see', null], ['bar', null], ['gin', null], ['reh', null]],
  // Chinese UI, Latin queries: English names before German ones ("beer" ≠ "Beeren", "gin" ≠ "Aubergine")
  zh: [['beer', null], ['pie', null], ['rum', null], ['bun', null]],
};

for (const lang of Object.keys(TRAPS)) {
  test(`cross-language traps (${lang}): results matching only another language's name come later`, () => {
    const index = buildIndex(lang);
    for (const [q, first] of TRAPS[lang]) {
      const top = search(q, index, { limit: 10 });
      const ranks = top.map((f) => matchRank(lang, foods.indexOf(f), q));
      assert.ok(top.length > 0, q);
      for (let k = 1; k < ranks.length; k++) {
        assert.ok(ranks[k] >= ranks[k - 1], `${lang} "${q}": #${k + 1} (rank ${ranks[k]}) after rank ${ranks[k - 1]}: ${top.map((f) => f.name).join(' | ')}`);
      }
      if (lang !== 'zh') assert.equal(ranks[0], 0, `${lang} "${q}" starts with an app-language match`);
      if (first) assert.equal(top[0].name, first, q);
    }
  });
}

test('cross-language traps (zh): "gin" lists gin before Virginia peanuts and never eggplant (German "Aubergine")', () => {
  const top = search('gin', buildIndex('zh'), { limit: 10 }).map((f) => idOf.get(f));
  assert.ok(!top.includes(169228), top.join(', '));
  assert.ok(top.slice(0, 2).some((id) => /\bgin\b/.test(foods[ids.indexOf(id)].name)), top.join(', '));
});

test('cross-language: exact words in another language still find the food', () => {
  const en = buildIndex('en');
  const deIdx = buildIndex('de');
  assert.equal(idOf.get(search('hähnchenbrust', en, { limit: 25 }).find((f) => idOf.get(f) === 171077)), 171077);
  assert.ok(search('Hähnchenbrust', en, { limit: 5 }).every((f) => /chicken/i.test(f.name)));
  assert.ok(search('鸡胸肉', en, { limit: 5 }).every((f) => /chicken/i.test(f.name)));
  assert.ok(search('鸡胸肉', deIdx, { limit: 5 }).every((f) => /chicken/i.test(f.name)));
  assert.ok(search('chicken breast', deIdx, { limit: 5 }).every((f) => /chicken/i.test(f.name)));
  // the tier bonus does not lift a staple matched only in German above English matches ("beer" ≠ Blaubeeren)
  const beer = search('beer', en, { limit: 40 });
  const blue = beer.findIndex((f) => idOf.get(f) === 171711);
  const lastBeer = beer.map((f) => /beer/i.test(f.name)).lastIndexOf(true);
  assert.ok(blue === -1 || blue > lastBeer, `Blueberries at ${blue}, last English beer at ${lastBeer}`);
});
