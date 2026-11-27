// Own dish estimates in the app (src/data/dishes.json): decoding, the search index in every app language (names and
// aliases in all three languages, same ranking rules as generic foods), "show the name as I typed it", storing a
// logged dish (source 'dish', sourceKey 'dish:<id>', English name, sizes), display names, backup round trip.
// Code: src/core/dishes.js, src/core/food-names.js, src/core/food-diary.js, src/food/dishes.js, src/food/names.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decodeDishes, dishSearchNames, dishesById, localDishName, localDishItemName, dishIdOf, dishKey, validSizes,
  isEstimateFood, normalKcal, dishKcalFor, DISH_TIERS, DISH_SOURCE,
} from '../src/core/dishes.js';
import { indexItem, search, searchMatches, searchesBundled } from '../src/core/food-search.js';
import { withNameLang, shownNameLang, nameLangForRecord } from '../src/core/food-names.js';
import { toFoodRecord, makeEntry, touchFood } from '../src/core/food-diary.js';
import { defaultAmount } from '../src/core/portion.js';
import { validateImport, DB_VERSION } from '../src/db/db.js';

const doc = JSON.parse(readFileSync(new URL('../src/data/dishes.json', import.meta.url), 'utf8'));
const dishes = decodeDishes(doc);
const byId = dishesById(dishes);
const dish = (id) => dishes.find((d) => d.dish.id === id);
const indexes = {};
const indexFor = (lang) => (indexes[lang] ||= dishes.map((d) => indexItem(d, ...dishSearchNames(d, lang))));

// ---- decoding ----

test('decodeDishes: every dish of dishes.json as a food-shaped item with sizes', () => {
  assert.equal(dishes.length, doc.count);
  const ids = new Set(dishes.map((d) => d.dish.id));
  assert.equal(ids.size, dishes.length);
  for (const d of dishes) {
    assert.equal(d.source, DISH_SOURCE);
    assert.equal(d.sourceKey, dishKey(d.dish.id));
    assert.equal(dishIdOf(d), d.dish.id);
    assert.equal(d.name, d.dish.names.en);
    assert.equal(d.basis, 'g');
    assert.ok(validSizes(d.sizes), `${d.dish.id} sizes`);
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) assert.equal(typeof d.per100[k], 'number', `${d.dish.id} ${k}`);
  }
  const m = dish('pizza-margherita');
  assert.deepEqual(m.sizes, doc.dishes.find((r) => r[0] === 'pizza-margherita')[12]);
  assert.equal(normalKcal(m), Math.round((m.per100.kcal * m.sizes[1]) / 100));
  assert.ok(isEstimateFood(m));
  assert.equal(isEstimateFood({ ...m, userEdited: true }), false);
  assert.equal(isEstimateFood({ ...m, source: 'usda' }), false);
  for (const id of Object.keys(DISH_TIERS)) assert.ok(byId.has(id), `DISH_TIERS: unknown dish ${id}`);
});

test('validSizes: three ascending positive grams, else null', () => {
  assert.deepEqual(validSizes([250, 350, 500]), [250, 350, 500]);
  assert.deepEqual(validSizes([300, 300, 400]), [300, 300, 400]);
  for (const bad of [null, undefined, [], [1, 2], [3, 2, 1], [0, 1, 2], [1, '2', 3], [1, 2, NaN], { 0: 1, 1: 2, 2: 3 }]) {
    assert.equal(validSizes(bad), null, JSON.stringify(bad));
  }
});

// ---- search: cross-language tables ----

// [query, dish id, true = must be first (else in the top 3), language the dish was found in (null = app language)]
const TABLE = {
  en: [
    ['döner', 'doner-kebab', true, null], ['Döner', 'doner-kebab', true, null], ['doener', 'doner-kebab', true, 'de'],
    ['kebab', 'doner-kebab', true, null], ['Currywurst', 'currywurst', true, null], ['currywurst pommes', 'currywurst-fries', true, 'de'],
    ['麻婆豆腐', 'mapo-tofu', true, 'zh'], ['兰州牛肉面', 'lanzhou-niuroumian', true, 'zh'], ['mapo', 'mapo-tofu', true, null],
    ['jiaozi', 'shuijiao', true, null], ['饺子', 'shuijiao', true, 'zh'], ['pizza margherita', 'pizza-margherita', true, null],
    ['pizza', 'pizza-margherita', true, null], ['Schnitzel', 'schnitzel', true, null], ['炒饭', 'dan-chaofan', true, 'zh'],
    ['dönerteller', 'doner-plate-fries', false, 'de'], ['hähnchendöner', 'doner-kebab-chicken', true, 'de'],
  ],
  de: [
    ['döner', 'doner-kebab', true, null], ['doener', 'doner-kebab', true, null], ['Currywurst', 'currywurst', true, null],
    ['麻婆豆腐', 'mapo-tofu', true, 'zh'], ['兰州牛肉面', 'lanzhou-niuroumian', true, 'zh'], ['mapo', 'mapo-tofu', true, null],
    ['jiaozi', 'shuijiao', true, null], ['pizza margherita', 'pizza-margherita', true, null], ['pizza', 'pizza-margherita', true, null],
    ['schnitzel', 'schnitzel', true, null], ['dönerteller', 'doner-plate-fries', false, null], ['doenerteller', 'doner-plate-fries', false, null],
    ['hähnchendöner', 'doner-kebab-chicken', true, null], ['haehnchen doener', 'doner-kebab-chicken', true, null],
    ['egg fried rice', 'dan-chaofan', true, 'en'],
  ],
  zh: [
    ['麻婆豆腐', 'mapo-tofu', true, null], ['兰州牛肉面', 'lanzhou-niuroumian', true, null], ['饺子', 'shuijiao', true, null],
    ['炒饭', 'dan-chaofan', true, null], ['döner', 'doner-kebab', true, null], ['currywurst', 'currywurst', true, null],
    ['schnitzel', 'schnitzel', true, null], ['mapo', 'mapo-tofu', true, 'en'], ['jiaozi', 'shuijiao', true, 'en'],
    ['pizza margherita', 'pizza-margherita', true, null], ['Schweinshaxe', 'schweinshaxe', true, null],
    ['披萨', 'pizza-margherita', true, null], ['pizza', 'pizza-margherita', true, null], ['汉堡', 'hamburger-fries', true, null],
    ['burger', 'hamburger-fries', true, 'en'], ['意面', 'spaghetti-bolognese', true, null],
  ],
};

for (const [lang, rows] of Object.entries(TABLE)) {
  test(`dishes are found in every language (${lang} app, ${rows.length} queries)`, () => {
    const fails = [];
    for (const [q, id, first, want] of rows) {
      const hits = searchMatches(q, indexFor(lang), { limit: 3 });
      const at = hits.findIndex((h) => h.item.dish.id === id);
      if (at < 0 || (first && at > 0)) { fails.push(`${q}: want ${id}${first ? ' first' : ''}, got ${hits.map((h) => h.item.dish.id).join(', ')}`); continue; }
      if (hits[at].lang !== want) fails.push(`${q}: ${id} found in ${hits[at].lang}, want ${want}`);
    }
    assert.deepEqual(fails, []);
  });
}

test('dish search ranks like generic foods: app language first, aliases searchable, no foreign prefix noise first', () => {
  // a German alias ("Pommes") finds dishes in the English app, after nothing in English matched
  assert.ok(search('pommes', indexFor('en'), { limit: 5 }).every((d) => /fries|pommes|chips/i.test(`${d.name} ${(d.dish.aliases.de || []).join(' ')}`)));
  // Chinese app, Latin query: Chinese names carrying the Latin word lead (app language), matches only in another
  // language's name come after the app language's whole-word matches
  const zh = searchMatches('schnitzel', indexFor('zh'), { limit: 10 });
  assert.ok(zh.slice(0, 5).every((h) => h.lang === null), zh.map((h) => `${h.item.dish.id}:${h.lang}`).join(' '));
  // empty or nonsense queries find nothing
  assert.deepEqual(search('', indexFor('en')), []);
  assert.deepEqual(search('xyzxyz', indexFor('de')), []);
});

// ---- storing ----

test('a logged dish is stored language-neutrally with its sizes; nameLang as for generic foods', () => {
  const found = withNameLang(dish('mapo-tofu'), 'zh'); // found through "麻婆豆腐" in the English app
  assert.equal(found.nameLang, 'zh');
  const rec = toFoodRecord(found, { id: 'f1', now: 5 });
  assert.equal(rec.source, 'dish');
  assert.equal(rec.sourceKey, 'dish:mapo-tofu');
  assert.equal(rec.name, 'Mapo tofu');
  assert.equal(rec.nameLang, 'zh');
  assert.deepEqual(rec.sizes, dish('mapo-tofu').sizes);
  assert.deepEqual(rec.per100, dish('mapo-tofu').per100);
  assert.equal('dish' in rec, false, 'the dish data (names, aliases) is not stored');
  assert.deepEqual(rec.servings, []);
  // found through the app language: nameLang cleared; a stored record without the field keeps its nameLang
  assert.equal('nameLang' in toFoodRecord(withNameLang(dish('mapo-tofu'), null), { id: 'f1', now: 6, existing: rec }), false);
  const { nameLang: _pinned, ...unpinned } = rec;
  assert.equal(toFoodRecord({ ...unpinned, userEdited: true }, { id: 'x', now: 7, existing: rec }).nameLang, 'zh');
  // edited values (no sizes on the edited copy) keep the stored sizes; invalid sizes are dropped
  const { sizes, ...noSizes } = rec;
  assert.deepEqual(toFoodRecord({ ...noSizes, userEdited: true }, { id: 'x', now: 8, existing: rec }).sizes, sizes);
  assert.equal('sizes' in toFoodRecord({ ...found, sizes: [3, 2, 1] }, { id: 'y', now: 1 }), false);
  // only dishes carry sizes
  assert.equal('sizes' in toFoodRecord({ ...found, source: 'custom', sourceKey: null }, { id: 'z', now: 1 }), false);
  assert.equal(nameLangForRecord({ source: 'dish', nameLang: 'de' }), 'de');
  assert.equal(shownNameLang({ source: 'dish', nameLang: 'de' }, 'en'), 'de');
  assert.equal(shownNameLang({ source: 'off', nameLang: 'de' }, 'en'), 'en');
});

test('portion: a dish opens at its normal size, later at the last amount', () => {
  const d = dish('pizza-margherita');
  assert.equal(defaultAmount(d), d.sizes[1]);
  const rec = touchFood(toFoodRecord(d, { id: 'f', now: 1 }), 333, 2);
  assert.equal(defaultAmount(rec), 333);
  assert.equal(defaultAmount({ ...rec, lastAmount: null }), d.sizes[1]);
});

// ---- display ----

test('display names: by id in the app language or nameLang; renamed or missing dish shows the stored name', () => {
  const rec = toFoodRecord(dish('doner-kebab'), { id: 'f1', now: 1 });
  assert.equal(localDishName(rec, byId, 'en'), 'Doner kebab');
  assert.equal(localDishName(rec, byId, 'de'), 'Döner Kebab');
  assert.equal(localDishName(rec, byId, 'zh'), dish('doner-kebab').dish.names.zh);
  assert.equal(localDishName({ ...rec, name: 'Mein Döner' }, byId, 'de'), null); // renamed: the user's name wins
  assert.equal(localDishName({ ...rec, sourceKey: 'dish:gone-dish', name: 'Gone' }, byId, 'de'), null); // left dishes.json
  assert.equal(localDishName({ ...rec, source: 'usda' }, byId, 'de'), null);
  assert.equal(localDishName(rec, null, 'de'), null); // not loaded
  const entry = makeEntry({ id: 'e1', date: '2026-11-27', meal: 'lunch', food: rec, amount: 370, now: 1 });
  assert.equal(localDishItemName(entry, rec, byId, 'de'), 'Döner Kebab');
  assert.equal(localDishItemName({ ...entry, name: 'Döner vom Eck' }, rec, byId, 'de'), null);
  assert.equal(localDishItemName(entry, { ...rec, id: 'other' }, byId, 'de'), null);
});

test('display in the app: foodName / itemName follow the language and nameLang (dishes.json loaded on demand)', async () => {
  let fetched = 0;
  globalThis.fetch = async (url) => {
    if (/dishes\.json$/.test(String(url))) { fetched++; return { ok: true, json: async () => doc }; }
    return { ok: false, status: 404 };
  };
  const { _setDictionary, _activate } = await import('../src/i18n/index.js');
  const { ensureDisplayNames } = await import('../src/food/generic.js');
  const { foodName, itemName } = await import('../src/food/names.js');
  const { searchDishes } = await import('../src/food/dishes.js');
  _setDictionary('de', (await import('../src/i18n/de/food.js')).default);
  _setDictionary('zh', (await import('../src/i18n/zh/food.js')).default);

  const plain = toFoodRecord(dish('currywurst'), { id: 'f1', now: 1 });
  const pinned = toFoodRecord(withNameLang(dish('mapo-tofu'), 'zh'), { id: 'f2', now: 1 });
  const entry = makeEntry({ id: 'e1', date: '2026-11-27', meal: 'lunch', food: pinned, amount: 250, now: 1 });
  // without a dish among the foods nothing is loaded
  await ensureDisplayNames([{ source: 'custom', name: 'x' }]);
  assert.equal(fetched, 0);
  const shown = {};
  for (const lang of ['en', 'de', 'zh']) {
    _activate(lang);
    await ensureDisplayNames([plain, pinned]);
    shown[lang] = [foodName(plain), foodName(pinned), itemName(entry, pinned), foodName({ ...plain, name: 'My wurst' })];
  }
  assert.equal(fetched, 1);
  assert.deepEqual(shown, {
    en: ['Currywurst', '麻婆豆腐', '麻婆豆腐', 'My wurst'],
    de: ['Currywurst', '麻婆豆腐', '麻婆豆腐', 'My wurst'],
    zh: [dish('currywurst').dish.names.zh, '麻婆豆腐', '麻婆豆腐', 'My wurst'],
  });
  // search in the English app: a Chinese query gives a copy pinned to Chinese, shown in Chinese
  _activate('en');
  const [hit] = await searchDishes('兰州牛肉面', 3);
  assert.equal(hit.sourceKey, 'dish:lanzhou-niuroumian');
  assert.equal(hit.nameLang, 'zh');
  assert.equal(foodName(hit), '兰州牛肉面');
  const [mapo] = await searchDishes('mapo', 3);
  assert.equal(mapo.nameLang, null);
  assert.equal(foodName(mapo), 'Mapo tofu');
  // a dish no longer in dishes.json: the stored English name
  assert.equal(foodName({ ...plain, sourceKey: 'dish:retired' }), 'Currywurst');
});

// ---- backup ----

test('backup round trip carries source dish, sizes and nameLang unchanged', () => {
  const a = touchFood(toFoodRecord(withNameLang(dish('pizza-margherita'), 'de'), { id: 'f1', now: 1 }), 405, 2);
  const b = toFoodRecord(dish('shuijiao'), { id: 'f2', now: 1 });
  const entry = makeEntry({ id: 'e1', date: '2026-11-27', meal: 'dinner', food: a, amount: 405, now: 2 });
  const meal = { id: 'm1', name: 'Pizza night', items: [{ foodId: a.id, name: a.name, brand: null, amount: 405, basis: 'g', per100: a.per100 }], createdAt: 3, updatedAt: 3 };
  const file = JSON.parse(JSON.stringify({ app: 'tracker', schemaVersion: DB_VERSION, exportedAt: 9, stores: { foods: [a, b], diary: [entry], meals: [meal] } }));
  const v = validateImport(file);
  assert.equal(v.ok, true);
  assert.deepEqual(v.data.stores.foods, [a, b]);
  assert.deepEqual(v.data.stores.diary, [entry]);
  assert.deepEqual(v.data.stores.meals, [meal]);
  assert.equal(v.data.stores.foods[0].source, 'dish');
  assert.deepEqual(v.data.stores.foods[0].sizes, dish('pizza-margherita').sizes);
  assert.equal(v.data.stores.foods[0].nameLang, 'de');
  // re-saving an imported record keeps everything (sizes, nameLang, counters)
  const again = toFoodRecord(v.data.stores.foods[0], { id: 'x', now: 10, existing: v.data.stores.foods[0] });
  assert.deepEqual({ ...again, updatedAt: a.updatedAt }, a);
  // sizes travel with the food: the portion sizes stay available when the dish later leaves dishes.json
  assert.equal(defaultAmount({ ...v.data.stores.foods[1], sourceKey: 'dish:retired' }), dish('shuijiao').sizes[1]);
});

test('dishKcalFor: kcal of a given amount of an unedited dish (Recent: the last amount), else null', () => {
  const m = dish('pizza-margherita');
  assert.equal(dishKcalFor(m, 450), Math.round((m.per100.kcal * 450) / 100));
  assert.equal(dishKcalFor(m, m.sizes[1]), normalKcal(m));
  for (const bad of [0, -5, null, undefined, NaN, '450']) assert.equal(dishKcalFor(m, bad), null, String(bad));
  assert.equal(dishKcalFor({ ...m, userEdited: true }, 450), null);
  assert.equal(dishKcalFor({ ...m, source: 'usda' }, 450), null);
  assert.equal(dishKcalFor({ ...m, per100: { ...m.per100, kcal: null } }, 450), null);
});

test('a single Han character searches the dishes: 粥 finds congee first, 饭 rice dishes, 鱼 fish', () => {
  for (const lang of ['zh', 'en']) {
    for (const [q, re] of [['粥', /粥/], ['饭', /饭|丼/], ['鱼', /鱼/]]) {
      assert.ok(searchesBundled(q));
      const top = search(q, indexFor(lang), { limit: 5 });
      assert.ok(top.length >= 3, `${lang} ${q}`);
      assert.match(top[0].dish.names.zh, re, `${lang} ${q}`);
    }
    assert.match(search('粥', indexFor(lang), { limit: 1 })[0].dish.names.en, /congee|porridge/i);
  }
});

// [character, ids that must fill the top 5 (in any order; the first must be first when `first`), ids that must
// rank below all of those]. A name starting with the character outranks one ending with it (面疙瘩 vs 炸酱面), so
// the dishes meant by the character carry it as a zh alias (and a few classics a tier, DISH_TIERS).
const SINGLE = [
  ['面', ['lanzhou-niuroumian', 'chaomian', 'huimian', 'liangmian', 'dandanmian', 'daoxiaomian', 'reganmian', 'zhajiangmian', 'chongqing-xiaomian', 'taiwan-niuroumian'],
    ['spaetzle', 'semmelknoedel', 'laugenbrezel', 'kaesespaetzle'], true],
  ['汤', ['hulatang', 'kimchi-jjigae', 'tom-yum-goong', 'paigu-lianou-tang', 'xihongshi-dantang', 'zicai-dantang'], ['tangyuan', 'xiaolongbao']],
  ['饭', ['dan-chaofan', 'baozai-fan', 'chashao-fan', 'lurou-fan', 'yangzhou-chaofan'], ['bai-zhou', 'onigiri-shake'], true],
  ['粉', ['chaohefen', 'luosifen', 'suanlafen', 'guilin-mifen'], ['kuanfen', 'fenzhengrou']],
  ['包', ['rou-baozi', 'su-baozi', 'chashao-bao', 'xiaolongbao'], ['kohlrouladen', 'laugenbrezel', 'hamburger-fries']],
  ['饼', ['shaobing', 'congyoubing', 'shouzhuabing', 'jianbing-guozi', 'jidan-guanbing'], ['pizza-margherita', 'laugenbrezel', 'doner-kebab']],
  ['肉', ['hongshaorou', 'huiguorou', 'dongpo-rou', 'nongjia-xiaochaorou', 'spaghetti-bolognese'], ['shuijiao', 'zongzi'], true],
  ['鸡', ['gongbao-jiding', 'dan-chaofan', 'baiqie-ji', 'dapanji', 'lazi-ji', 'huangmen-ji-mifan'], ['jiandan-jidangeng', 'jidan-guanbing'], true],
  ['鱼', ['shuizhu-yu', 'suancai-yu', 'qingzheng-yu', 'hongshao-yu', 'kaoyu'], ['yuxiang-qiezi', 'yuxiang-rousi', 'matjes-roll']],
  ['虾', ['baizhuo-xia', 'youmen-daxia', 'jiaoyan-xia', 'xiahua', 'xiajiao', 'xiapian'], ['changfen']],
  ['蛋', ['dan-chaofan', 'chaye-dan', 'jiandan-jidangeng', 'tomato-egg', 'danta'], ['yuwan', 'yuebing']],
  ['菜', ['chao-qingcai', 'haoyou-shengcai', 'shousi-baocai', 'suanrong-xilanhua', 'shuijiao'], ['malatang']],
  ['茶', ['dong-ningcha', 'gangshi-naicha'], ['chaye-dan']],
  ['锅', ['budae-jjigae', 'malaxiangguo'], ['kuanfen', 'maodu']],
];

test('a single Han character finds the dishes it means first (面 noodles, 汤 soups, 饭 rice plates, …)', () => {
  for (const lang of ['zh', 'en']) {
    const fails = [];
    for (const [q, top, later, first] of SINGLE) {
      const ids = search(q, indexFor(lang), { limit: 40 }).map((d) => d.dish.id);
      const head = ids.slice(0, Math.min(5, top.length));
      if (!head.every((id) => top.includes(id))) fails.push(`${q}: top ${head.join(', ')}`);
      if (first && ids[0] !== top[0]) fails.push(`${q}: want ${top[0]} first, got ${ids[0]}`);
      const lastTop = Math.max(...top.map((id) => ids.indexOf(id)));
      for (const id of later) if (ids.indexOf(id) >= 0 && ids.indexOf(id) < lastTop) fails.push(`${q}: ${id} above ${top.join('/')}`);
    }
    assert.deepEqual(fails, [], lang);
  }
});
