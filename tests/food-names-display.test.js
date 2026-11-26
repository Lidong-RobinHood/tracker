// Translated generic food names: names-file validation and display lookup (src/core/food-names.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namesFromFile, localFoodName, localItemName, nameHash } from '../src/core/food-names.js';
import { foodIdsHash } from '../src/core/food-search.js';

const IDS = [167512, 171477, 168878];
const EN = ['Chicken, broilers or fryers, breast, meat only, raw', 'Rice, white, long-grain, regular, cooked', 'Milk, whole'];
const doc = (over = {}) => ({ lang: 'de', count: 3, idsHash: foodIdsHash(IDS), ids: IDS, en: EN.map(nameHash), names: ['Hähnchenbrust, roh', 'Reis, weiß, gekocht', 'Vollmilch'], ...over });

test('namesFromFile: a valid file alone (no base file) → sourceKey map with the English-name hash', () => {
  const r = namesFromFile(doc(), 'de');
  assert.equal(r.ok, true);
  assert.deepEqual(r.names.get('usda:168878'), { h: nameHash('Milk, whole'), name: 'Vollmilch' });
  assert.equal(r.names.size, 3);
  assert.equal(namesFromFile(doc(), 'de', IDS).ok, true); // matches the base file's order
  assert.match(nameHash('Milk, whole'), /^[0-9a-z]{1,7}$/);
  assert.notEqual(nameHash('Milk, whole'), nameHash('Milk, whole '));
});

test('namesFromFile: mismatching or broken files are rejected with a reason', () => {
  for (const [bad, why] of [
    [doc({ count: 2 }), /count/],
    [doc({ names: ['a', 'b'] }), /count/],
    [doc({ idsHash: 'deadbeef' }), /idsHash/],
    [doc({ ids: [IDS[1], IDS[0], IDS[2]] }), /idsHash/],
    [doc({ en: EN.slice(0, 2).map(nameHash) }), /count/],
    [doc({ ids: undefined }), /old format/],
    [doc({ lang: 'zh' }), /language/],
    [{ lang: 'de' }, /names/],
    [null, /names/],
  ]) {
    const r = namesFromFile(bad, 'de');
    assert.equal(r.ok, false);
    assert.match(r.reason, why);
  }
  // the base file (when loaded for search) has another order → rejected
  const r = namesFromFile(doc(), 'de', [IDS[1], IDS[0], IDS[2]]);
  assert.equal(r.ok, false);
  assert.match(r.reason, /base file/);
});

test('namesFromFile: empty names are left out (the English name stays)', () => {
  const r = namesFromFile(doc({ names: ['Hähnchenbrust, roh', ' ', 'Vollmilch'] }), 'de');
  assert.equal(r.names.has('usda:171477'), false);
});

test('localFoodName: generic foods only, renamed foods keep their name, edited values keep the translation', () => {
  const { names } = namesFromFile(doc(), 'de');
  const milk = { source: 'usda', sourceKey: 'usda:168878', name: 'Milk, whole', userEdited: false };
  assert.equal(localFoodName(milk, names), 'Vollmilch');
  assert.equal(localFoodName({ ...milk, userEdited: true }, names), 'Vollmilch');
  assert.equal(localFoodName({ ...milk, name: 'My milk' }, names), null);
  assert.equal(localFoodName({ ...milk, source: 'custom' }, names), null);
  assert.equal(localFoodName({ ...milk, sourceKey: 'usda:1' }, names), null);
  assert.equal(localFoodName(milk, null), null);
  assert.equal(localFoodName(null, names), null);
});

test('localItemName: diary entries / meal items by their stored food', () => {
  const { names } = namesFromFile(doc(), 'de');
  const food = { id: 'f1', source: 'usda', sourceKey: 'usda:171477', name: 'Rice, white, long-grain, regular, cooked' };
  const entry = { foodId: 'f1', name: 'Rice, white, long-grain, regular, cooked' };
  assert.equal(localItemName(entry, food, names), 'Reis, weiß, gekocht');
  // the food was renamed later: the entry's snapshot still has the USDA name → still translated
  assert.equal(localItemName(entry, { ...food, name: 'Rice' }, names), 'Reis, weiß, gekocht');
  // the entry itself was renamed in the entry editor
  assert.equal(localItemName({ ...entry, name: 'Rice (mine)' }, food, names), null);
  assert.equal(localItemName({ ...entry, foodId: 'f2' }, food, names), null);
  assert.equal(localItemName({ ...entry, foodId: null }, food, names), null);
  assert.equal(localItemName(entry, null, names), null);
});
