// Built-in names in three languages (namespace 'data', src/i18n/names.js): every muscle, seed exercise,
// library split, split day and filter label has an en, de and zh entry, so adding one without
// translations fails here. Also the "built-in and not renamed" rule of exerciseName / splitName.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES } from '../src/core/muscles.js';
import { SEED_EXERCISES, DEFAULT_INCREMENT } from '../src/data/exercises.js';
import { SPLITS, STYLES, LEVELS, EQUIPMENT, SHARED_BULLETS, SPLIT_BASIS } from '../src/data/splits.js';
import en, { dataKey } from '../src/i18n/en/data.js';
import de from '../src/i18n/de/data.js';
import zh from '../src/i18n/zh/data.js';
import { _setDictionary, _activate, EN_CATALOGUES } from '../src/i18n/index.js';
import {
  muscleName, exerciseName, isBuiltInName, splitName, splitSuits, splitBullets, sessionName, routineName,
  styleLabel, levelLabel, placeLabel, equipmentName, exerciseNameForSave,
} from '../src/i18n/names.js';

const LANGS = { en, de, zh };

function required() {
  const keys = [];
  for (const m of MUSCLES) keys.push(`data.muscle.${m.id}`);
  for (const e of SEED_EXERCISES) keys.push(`data.exercise.${dataKey(e.id)}`);
  for (const type of Object.keys(DEFAULT_INCREMENT)) keys.push(`data.equipment.${type}`);
  for (const s of STYLES) keys.push(`data.style.${dataKey(s.id)}`);
  for (const l of LEVELS) keys.push(`data.level.${dataKey(l.id)}`);
  for (const q of EQUIPMENT) keys.push(`data.place.${dataKey(q.id)}`);
  for (const sp of SPLITS) {
    const k = `data.split.${dataKey(sp.id)}`;
    keys.push(`${k}.name`, `${k}.suits`, ...sp.bullets.map((_, i) => `${k}.bullet${i + 1}`));
    for (const ses of sp.sessions) keys.push(`data.session.${dataKey(ses.id)}`);
  }
  SHARED_BULLETS.forEach((_, i) => keys.push(`data.splitGuide.bullet${i + 1}`));
  SPLIT_BASIS.forEach((_, i) => keys.push(`data.splitGuide.basis${i + 1}`));
  keys.push('data.splitGuide.disclaimer');
  return [...new Set(keys)];
}

test('every built-in muscle, exercise, split, day and filter label has en, de and zh text', () => {
  const missing = [];
  for (const [lang, dict] of Object.entries(LANGS)) {
    for (const k of required()) if (typeof dict[k] !== 'string' || !dict[k].trim()) missing.push(`${lang}: ${k}`);
  }
  assert.deepEqual(missing, []);
  assert.equal(SEED_EXERCISES.length, 107);
  assert.equal(SPLITS.length, 14);
});

test('de and zh have exactly the en keys of the data namespace', () => {
  for (const [lang, dict] of Object.entries({ de, zh })) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), lang);
  }
  assert.equal(EN_CATALOGUES.data, en);
});

test('en data catalogue is the English of the data files; key segments are unique', () => {
  for (const e of SEED_EXERCISES) assert.equal(en[`data.exercise.${dataKey(e.id)}`], e.name);
  assert.equal(new Set(SEED_EXERCISES.map((e) => dataKey(e.id))).size, SEED_EXERCISES.length);
  assert.equal(new Set(SPLITS.map((s) => dataKey(s.id))).size, SPLITS.length);
  // a session id means the same day name in every split (one key per id)
  const byId = new Map();
  for (const sp of SPLITS) for (const ses of sp.sessions) {
    if (byId.has(ses.id)) assert.equal(byId.get(ses.id), ses.name, `${sp.id}: session ${ses.id}`);
    byId.set(ses.id, ses.name);
  }
  assert.equal(dataKey('seed:low-to-high-cable-fly'), 'lowToHighCableFly');
  assert.equal(dataKey('fb3-home'), 'fb3Home');
});

test('exercise editor: the translated name saved unchanged keeps the stored English name', () => {
  _setDictionary('de', de);
  _activate('de');
  try {
    const bench = { id: 'seed:bench-press', name: 'Bench Press (Barbell)', isCustom: false };
    assert.equal(exerciseNameForSave(bench, 'Bankdrücken (Langhantel)'), 'Bench Press (Barbell)');
    assert.equal(exerciseNameForSave(bench, '  Bankdrücken (Langhantel) '), 'Bench Press (Barbell)');
    assert.equal(exerciseNameForSave({ id: 'seed:bench-press' }, 'Bankdrücken (Langhantel)'), 'Bench Press (Barbell)');
    assert.equal(exerciseNameForSave(bench, 'Bankdrücken eng'), 'Bankdrücken eng');
    assert.equal(exerciseNameForSave(bench, 'Bench Press (Barbell)'), 'Bench Press (Barbell)');
    // renamed or custom: whatever is typed
    assert.equal(exerciseNameForSave({ ...bench, name: 'Bankdrücken' }, 'Bankdrücken'), 'Bankdrücken');
    assert.equal(exerciseNameForSave({ id: 'x1', name: 'Mein Curl', isCustom: true }, ' Mein Curl '), 'Mein Curl');
    assert.equal(exerciseNameForSave(null, ' Neu '), 'Neu');
    _setDictionary('zh', zh);
    _activate('zh');
    const zhName = zh['data.exercise.benchPress'];
    assert.equal(exerciseNameForSave(bench, zhName), 'Bench Press (Barbell)');
  } finally {
    _activate('en');
  }
});

test('names: built-in and unchanged → translated; renamed, custom and unknown → as stored', () => {
  _setDictionary('de', de);
  _activate('de');
  try {
    const bench = { id: 'seed:bench-press', name: 'Bench Press (Barbell)', isCustom: false };
    assert.equal(exerciseName(bench), 'Bankdrücken (Langhantel)');
    assert.equal(exerciseName({ id: 'seed:bench-press' }), 'Bankdrücken (Langhantel)');
    assert.equal(exerciseName({ ...bench, name: ' Bench Press (Barbell) ' }), 'Bankdrücken (Langhantel)');
    assert.ok(isBuiltInName(bench));
    assert.equal(exerciseName({ ...bench, name: 'Bench' }), 'Bench');
    assert.equal(exerciseName({ ...bench, name: 'bench press (barbell)' }), 'bench press (barbell)');
    assert.equal(exerciseName({ ...bench, isCustom: true }), 'Bench Press (Barbell)');
    assert.equal(exerciseName({ id: 'x1', name: 'Bench Press (Barbell)', isCustom: true }), 'Bench Press (Barbell)');
    assert.equal(exerciseName(null), '');
    assert.equal(muscleName('quads'), 'Quadrizeps');
    assert.equal(muscleName('nope'), 'nope');

    const ul = SPLITS.find((s) => s.id === 'ul4-b');
    assert.equal(splitName(ul), 'Ober-/Unterkörper 4 Tage');
    assert.equal(splitName({ id: 'custom:1', name: 'Mein Plan' }), 'Mein Plan');
    assert.equal(splitSuits(ul), de['data.split.ul4B.suits']);
    assert.equal(splitBullets(ul).length, SHARED_BULLETS.length + ul.bullets.length);
    assert.equal(sessionName(ul.sessions[0]), 'Oberkörper');
    assert.equal(routineName({ name: 'Upper', splitId: 'ul4-b' }), 'Oberkörper');
    assert.equal(routineName({ name: 'Upper', splitId: null }), 'Upper');
    assert.equal(routineName({ name: 'Mein Oberkörper', splitId: 'ul4-b' }), 'Mein Oberkörper');
    assert.equal(styleLabel('full-body'), 'Ganzkörper');
    assert.equal(levelLabel('advanced'), 'Fortgeschritten');
    assert.equal(levelLabel('intermediate'), 'Mittelstufe');
    assert.equal(placeLabel('home'), 'Zuhause');
    assert.equal(equipmentName('dumbbell'), 'Kurzhantel');
  } finally {
    _activate('en');
  }
  assert.equal(exerciseName({ id: 'seed:bench-press', name: 'Bench Press (Barbell)' }), 'Bench Press (Barbell)');
  assert.equal(splitName(SPLITS[0]), SPLITS[0].name);
});
