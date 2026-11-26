// Names the app generates are stored language-neutrally (English text / markers) and shown in the app language:
// routines and workouts from built-in splits, default routine / split / saved-meal names, generated entry names,
// import runs. Switching the language re-labels them; anything the user typed is shown as typed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLITS } from '../src/data/splits.js';
import { _setDictionary, _activate, EN_CATALOGUES, compareText } from '../src/i18n/index.js';
import de from '../src/i18n/de/data.js';
import zh from '../src/i18n/zh/data.js';
import deFood from '../src/i18n/de/food.js';
import zhFood from '../src/i18n/zh/food.js';
import deSplits from '../src/i18n/de/splits.js';
import deWorkout from '../src/i18n/de/workout.js';
import zhWorkout from '../src/i18n/zh/workout.js';
import { routineName, splitName, workoutSessionName, nameForSave } from '../src/i18n/names.js';
import { savedMealName, savedMealDefault, photoMealDefault, itemName } from '../src/food/names.js';
import { customFromLibrary, cleanCustomSplit, splitRoutines, resolveSessions, DEFAULT_SPLIT_NAME, copyNameOf } from '../src/core/splits.js';
import { NEW_ROUTINE_NAME } from '../src/core/workout.js';
import { buildFoodRows, IMPORTED_NAME } from '../src/core/import-food.js';
import { photoMealName, PHOTO_MEAL_NAME } from '../src/core/meal-photo.js';
import { newRun } from '../src/core/import-runs.js';

const ppl = SPLITS.find((s) => s.sessions.some((x) => x.name === 'Push') && s.sessions.some((x) => x.name === 'Legs'));
const ul = SPLITS.find((s) => s.id === 'ul4-b');

function inLang(lang, fn) {
  const dicts = {
    de: { ...de, ...deFood, ...deSplits, ...deWorkout },
    zh: { ...zh, ...zhFood, ...zhWorkout },
  };
  _setDictionary(lang, dicts[lang]);
  _activate(lang);
  try { return fn(); } finally { _activate('en'); }
}

test('routines adopted from a split store the English day name and follow the language', () => {
  const sessions = resolveSessions(ppl, { level: 'standard', swaps: {}, exercises: new Map() });
  const rs = splitRoutines(ppl, sessions, { ids: sessions.map((_, i) => `r${i}`), now: 1, firstOrder: 0 });
  assert.deepEqual(rs.map((r) => r.name), ppl.sessions.map((s) => s.name)); // English, whatever the language
  const push = rs.find((r) => r.name === 'Push');
  assert.equal(routineName(push), 'Push');
  inLang('de', () => assert.equal(routineName(push), de[`data.session.${'push'}`]));
  inLang('zh', () => assert.equal(routineName(push), zh['data.session.push']));
  // renamed by the user: as typed
  inLang('de', () => assert.equal(routineName({ ...push, name: 'Brust & Trizeps' }), 'Brust & Trizeps'));
  // default name of an empty routine
  assert.equal(routineName({ name: NEW_ROUTINE_NAME }), 'New routine');
  inLang('de', () => assert.equal(routineName({ name: NEW_ROUTINE_NAME }), deWorkout['workout.routine.newName']));
});

test('workouts: the English day name of the routine\'s split is translated; user names, other routines stay', () => {
  const routines = new Map([
    ['r-push', { id: 'r-push', name: 'Push', splitId: ppl.id }],
    ['r-renamed', { id: 'r-renamed', name: 'Montag', splitId: ppl.id }],
    ['r-own', { id: 'r-own', name: 'Push', splitId: undefined }],
    ['r-ul', { id: 'r-ul', name: 'Upper', splitId: ul.id }],
  ]);
  inLang('de', () => {
    const push = de['data.session.push'];
    const legs = de['data.session.legs'];
    assert.equal(workoutSessionName({ name: 'Push', routineId: 'r-push' }, routines), push);
    // the routine was renamed later: the workout keeps the day name it was logged with, still translated
    assert.equal(workoutSessionName({ name: 'Push', routineId: 'r-renamed' }, routines), push);
    // the user renamed the workout to another day of the same split: still a built-in name
    assert.equal(workoutSessionName({ name: 'Legs', routineId: 'r-push' }, routines), legs);
    // a routine the user made and named "Push" (no splitId): as typed
    assert.equal(workoutSessionName({ name: 'Push', routineId: 'r-own' }, routines), null);
    // a name that is not a day of that routine's split
    assert.equal(workoutSessionName({ name: 'Push', routineId: 'r-ul' }, routines), null);
    // routine deleted: resolved when the name is exactly one library day
    assert.equal(workoutSessionName({ name: 'Legs', routineId: 'gone' }, routines), legs);
    assert.equal(workoutSessionName({ name: 'Legs', routineId: 'gone' }, null), legs);
    assert.equal(workoutSessionName({ name: 'Leg day', routineId: 'gone' }, routines), null);
    // no routine (empty workout, import): the user's name
    assert.equal(workoutSessionName({ name: 'Push', routineId: null }, routines), null);
    assert.equal(workoutSessionName({ name: NEW_ROUTINE_NAME, routineId: 'gone' }, routines), deWorkout['workout.routine.newName']);
  });
  inLang('zh', () => assert.equal(workoutSessionName({ name: 'Legs', routineId: 'r-push' }, routines), zh['data.session.legs']));
  assert.equal(workoutSessionName({ name: 'Legs', routineId: 'r-push' }, routines), 'Legs');
});

test('custom split default names are stored in English and shown translated', () => {
  const copy = customFromLibrary(ul, { id: 'custom:1', routineIds: ['a'], now: 1 });
  assert.equal(copy.name, copyNameOf(ul));
  assert.equal(copy.name, `${ul.name} (custom)`);
  assert.equal(cleanCustomSplit({ id: 'custom:2', name: '' }).name, DEFAULT_SPLIT_NAME);
  inLang('de', () => {
    assert.equal(splitName(copy), deSplits['splits.custom.copyName'].replace('{name}', de['data.split.ul4B.name']));
    assert.equal(splitName({ id: 'custom:2', name: DEFAULT_SPLIT_NAME }), deSplits['splits.custom.defaultName']);
    assert.equal(splitName({ id: 'custom:3', name: 'Mein Split' }), 'Mein Split');
  });
});

test('editors keep the stored name when the shown (translated) one is saved unchanged', () => {
  assert.equal(nameForSave('Push', 'Drücken', 'Drücken'), 'Push');
  assert.equal(nameForSave('Push', 'Drücken', ' Drücken '), 'Push');
  assert.equal(nameForSave('Push', 'Drücken', 'Drücken schwer'), 'Drücken schwer');
  assert.equal(nameForSave('Push', 'Drücken', ''), '');
});

test('saved-meal default names: stored in English (as 0.7.1 did), shown in the app language', () => {
  const now = new Date(2026, 10, 26, 12);
  const d = savedMealDefault('breakfast', '2026-11-26', now);
  assert.equal(d.stored, 'Breakfast Thu 26 Nov');
  assert.equal(d.shown, 'Breakfast Thu 26 Nov');
  assert.equal(savedMealDefault('dinner', '2025-12-31', now).stored, 'Dinner Wed 31 Dec 2025');
  assert.equal(photoMealDefault('lunch').stored, 'Lunch photo');
  const meal = { name: 'Breakfast Thu 26 Nov', createdAt: now.getTime() };
  inLang('de', () => {
    const shown = savedMealDefault('breakfast', '2026-11-26', now).shown;
    assert.equal(savedMealDefault('breakfast', '2026-11-26', now).stored, 'Breakfast Thu 26 Nov');
    assert.equal(savedMealName(meal), shown);
    assert.match(shown, /^Frühstück Do\. 26\. Nov\.$/);
    assert.equal(savedMealName({ name: 'Dinner Wed 31 Dec 2025', createdAt: now.getTime() }), 'Abendessen Mi. 31. Dez. 2025');
    assert.equal(savedMealName({ name: 'Lunch photo' }), deFood['food.photo.savedMealName'].replace('{meal}', deFood['food.meal.lunch']));
    assert.equal(savedMealName({ name: 'Meal' }), deFood['food.meals.defaultName']);
    // typed by the user, or not a real date: as stored
    assert.equal(savedMealName({ name: 'Breakfast Mon 26 Nov', createdAt: now.getTime() }), 'Breakfast Mon 26 Nov');
    assert.equal(savedMealName({ name: 'Porridge Thu 26 Nov', createdAt: now.getTime() }), 'Porridge Thu 26 Nov');
    assert.equal(savedMealName({ name: 'Mein Frühstück' }), 'Mein Frühstück');
  });
  inLang('zh', () => assert.equal(savedMealName(meal), '11月26日周四早餐'));
});

test('generated entry names: import markers and photo names stored in English, shown translated', () => {
  const table = { rows: [{ cells: ['2026-11-20', '', '500', 'Frühstück'], line: 2 }, { cells: ['2026-11-21', '', '300', ''], line: 3 }] };
  const r = buildFoodRows(table, { mapping: { date: 0, name: 1, kcal: 2, meal: 3 }, dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'snack', today: '2026-11-26' });
  assert.deepEqual(r.entries.map((e) => e.name), ['Frühstück (imported)', IMPORTED_NAME]);
  const items = [{ name: 'Rice, white', amount: 200, per100: { kcal: 130 } }, { name: 'Chicken thigh', amount: 150, per100: { kcal: 200 } },
    { name: 'Broccoli', amount: 80, per100: { kcal: 50 } }, { name: 'Sauce', amount: 30, per100: { kcal: 100 } }];
  const photo = photoMealName(items);
  assert.equal(photo, 'Chicken thigh, rice, broccoli + 1 more');
  assert.equal(photoMealName([]), PHOTO_MEAL_NAME);
  inLang('de', () => {
    assert.equal(itemName({ name: 'Frühstück (imported)', foodId: null }), deFood['food.entry.mealImported'].replace('{meal}', 'Frühstück'));
    assert.equal(itemName({ name: IMPORTED_NAME, foodId: null }), deFood['food.entry.imported']);
    assert.equal(itemName({ name: PHOTO_MEAL_NAME, foodId: null }), deFood['food.photo.mealPhoto']);
    assert.equal(itemName({ name: photo, foodId: null }), `Chicken thigh, rice, broccoli${deFood['food.photo.more_one'].replace('{count}', '1')}`);
    assert.equal(itemName({ name: 'Müsli', foodId: null }), 'Müsli');
  });
  inLang('zh', () => assert.equal(itemName({ name: IMPORTED_NAME, foodId: null }), zhFood['food.entry.imported']));
  assert.equal(itemName({ name: IMPORTED_NAME, foodId: null }), EN_CATALOGUES.food['food.entry.imported']);
});

test('import runs store data, not a summary in the language of the moment', () => {
  const run = newRun({ id: 'a', type: 'weights', now: 1, info: { weighIns: 2 }, counts: { weights: 2 }, keys: { weights: [] } });
  assert.equal('summary' in run, false);
  assert.equal(newRun({ id: 'b', type: 'weights', now: 1, summary: 'old', counts: {}, keys: {} }).summary, 'old');
});

test('alphabetical lists use the app language\'s collation', () => {
  inLang('de', () => assert.deepEqual(['Zug', 'Übung', 'Apfel', 'Ober'].sort(compareText), ['Apfel', 'Ober', 'Übung', 'Zug']));
  inLang('zh', () => assert.deepEqual(['深蹲', '卧推', '杠铃划船', '哑铃飞鸟'].sort(compareText), ['杠铃划船', '深蹲', '卧推', '哑铃飞鸟']));
});
