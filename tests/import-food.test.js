import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readTable, guessMapping, detectPreset, presetMapping, detectFormats, mealValues, guessMeal,
  parseAmount, buildFoodRows, summariseFood, toDiaryRecords, PRESETS,
} from '../src/core/import-food.js';
import { newRun, upsertRun, ownedBy, removableExercises, pruneMappings, MAX_RUNS } from '../src/core/import-runs.js';
import { totals } from '../src/core/food-diary.js';

const T = '2026-11-19';

// Samples in the documented layouts (header lines as found in real exports, see docs/IMPORT-FORMATS.md).
const MFP = [
  'Date,Meal,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note',
  '2026-11-12,Breakfast,512.4,18.2,6.1,2.0,7.3,0,210,640,410,61.5,7.2,14.8,27.9,10,4,15,12,',
  '2026-11-12,Lunch,780,25,8,3,10,0,95,1200,800,90.2,9,6,45.5,5,30,10,20,"Ate out, ""big"" portion"',
  '2026-11-12,Snacks,200,9,3,1,4,0,10,100,150,20,2,15,8,0,0,5,2,',
  '2026-11-13,Breakfast,450,15,5,2,6,0,190,500,400,55,6,12,25,10,4,15,12,',
  '2026-11-13,Dinner,900,35,12,4,14,0,120,1500,900,95,8,10,55,10,20,10,25,',
].join('\r\n');

const CRONO_SERVINGS = [
  'Day,Time,Group,Food Name,Amount,Energy (kcal),Alcohol (g),Caffeine (mg),Water (g),Sodium (mg),Carbs (g),Fiber (g),Starch (g),Sugars (g),Net Carbs (g),Fat (g),Cholesterol (mg),Protein (g),Category',
  '2026-11-12,8:05 AM,Breakfast,"Oats, rolled",58.00 g,220.4,0,0,5.1,1.2,38.5,5.9,30,0.6,32.6,3.9,0,7.7,Cereals',
  '2026-11-12,8:05 AM,Breakfast,Milk 1.5%,250.00 ml,117.5,0,0,225,110,12,0,0,12,12,3.8,15,8.5,Dairy',
  '2026-11-12,1:10 PM,Lunch,"Bread, whole wheat",2.00 x 1 slice,160,0,0,20,300,28,4,20,3,24,2,0,8,Baked',
  '2026-11-12,7:30 PM,Dinner,Salmon,150 g,312,,,,90,0,0,0,0,0,20,80,30,Fish',
  '2026-11-13,,Uncategorized,Apple,182 g,95,0,0,156,2,25,4.4,0,19,20.6,0.3,0,0.5,Fruit',
].join('\n');

const CRONO_DAILY = [
  'Date,Group,Energy (kcal),Alcohol (g),Caffeine (mg),Water (g),Sodium (mg),Net Carbs (g),Carbs (g),Fiber (g),Sugars (g),Fat (g),Protein (g),Completed',
  '2026-11-12,Breakfast,337.9,0,0,230,111.2,44.6,50.5,5.9,12.6,7.7,16.2,false',
  '2026-11-12,Total,1500,0,0,1200,1800,150,170,20,40,60,100,true',
  '2026-11-13,Breakfast,400,0,0,200,100,40,45,5,10,10,20,false',
].join('\n');

const FDDB = [
  '﻿datum_tag_monat_jahr_stunde_minute;bezeichnung;interne_id;kj;fett_g;kh_g;protein_g',
  '12.11.2026 07:45;Haferflocken;123;1557,9;3,5;29,4;6,8',
  '12.11.2026 12:30;"Brot; Vollkorn";456;836,8;1,2;35,0;6,0',
  '13.11.2026 19:00;Lachs;789;1305,4;20;0;30',
].join('\r\n');

test('presets are detected from the documented headers', () => {
  assert.equal(detectPreset(readTable(MFP).headers).id, 'mfp');
  assert.equal(detectPreset(readTable(CRONO_SERVINGS).headers).id, 'cronometer-servings');
  assert.equal(detectPreset(readTable(CRONO_DAILY).headers).id, 'cronometer-daily');
  assert.equal(detectPreset(readTable(FDDB).headers).id, 'fddb');
  assert.equal(detectPreset(['Datum', 'kcal']), null);
  for (const p of PRESETS) assert.ok(['sample', 'unconfirmed'].includes(p.status));
});

test('MyFitnessPal: one entry per meal row, sodium → salt, totals per day', () => {
  const table = readTable(MFP);
  assert.equal(table.delimiter, ',');
  assert.equal(table.hasHeader, true);
  const mapping = presetMapping(detectPreset(table.headers), table.headers);
  const f = detectFormats(table, mapping);
  assert.equal(f.decimal, 'dot');
  const { entries, skipped } = buildFoodRows(table, { mapping, dateOrder: f.dateOrder, decimal: f.decimal, defaultMeal: 'snack', today: T });
  assert.deepEqual(skipped, []);
  assert.equal(entries.length, 5);
  assert.deepEqual(entries.map((e) => e.meal), ['breakfast', 'lunch', 'snack', 'breakfast', 'dinner']);
  assert.equal(entries[0].name, 'Breakfast (imported)');
  assert.equal(entries[0].salt, 1.6);
  assert.equal(entries[1].line, 3);
  const s = summariseFood(entries, ['2026-11-13']);
  assert.deepEqual([s.days, s.entries, s.kcalMin, s.kcalMax, s.kcalMedian], [2, 5, 1350, 1492.4, 1421.2]);
  assert.deepEqual(s.conflictDays, ['2026-11-13']);
  let n = 0;
  const recs = toDiaryRecords(entries, { importId: 'run', now: 1000, newId: () => `d${++n}`, skipDays: new Set(['2026-11-13']) });
  assert.equal(recs.length, 3);
  assert.deepEqual(recs[0], {
    id: 'd1', date: '2026-11-12', meal: 'breakfast', foodId: null, name: 'Breakfast (imported)', brand: null,
    amount: 100, basis: 'g',
    per100: { kcal: 512.4, protein: 27.9, carbs: 61.5, fat: 18.2, sugars: 14.8, satFat: 6.1, fibre: 7.2, salt: 1.6 },
    createdAt: 1000, updatedAt: 1000, importId: 'run',
  });
  const day = totals(recs);
  assert.equal(Math.round(day.kcal * 10) / 10, 1492.4);
  assert.equal(Math.round(day.protein * 10) / 10, 81.4);
});

test('Cronometer servings: food names, amounts from free text, Uncategorized → snack', () => {
  const table = readTable(CRONO_SERVINGS);
  const mapping = presetMapping(detectPreset(table.headers), table.headers);
  assert.deepEqual(mealValues(table, mapping).map((m) => m.value), ['Breakfast', 'Lunch', 'Dinner', 'Uncategorized']);
  const { entries, skipped } = buildFoodRows(table, { mapping, dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'lunch', today: T });
  assert.deepEqual(skipped, []);
  assert.deepEqual(entries.map((e) => [e.meal, e.name, e.amount && e.amount.value]), [
    ['breakfast', 'Oats, rolled', 58], ['breakfast', 'Milk 1.5%', 250], ['lunch', 'Bread, whole wheat', null], ['dinner', 'Salmon', 150], ['snack', 'Apple', 182],
  ]);
  assert.equal(entries[1].amount.unit, 'ml');
  const recs = toDiaryRecords(entries, { importId: 'r', now: 0, newId: () => 'x' });
  assert.equal(recs[0].name, 'Oats, rolled · 58 g');
  assert.equal(recs[1].name, 'Milk 1.5% · 250 ml');
  assert.equal(recs[3].per100.sugars, 0);
});

test('Cronometer daily summary: Total group rows are skipped, the rest kept', () => {
  const table = readTable(CRONO_DAILY);
  const mapping = presetMapping(detectPreset(table.headers), table.headers);
  assert.equal(guessMeal('Total'), 'skip');
  const { entries, skipped } = buildFoodRows(table, { mapping, dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'snack', today: T });
  assert.equal(entries.length, 2);
  assert.deepEqual(skipped, [{ line: 3, reason: 'Meal "Total" is set to skip' }]);
});

test('FDDB (unconfirmed layout): semicolons, BOM, decimal comma, kJ → kcal, date with time', () => {
  const table = readTable(FDDB);
  assert.equal(table.delimiter, ';');
  const mapping = presetMapping(detectPreset(table.headers), table.headers);
  assert.equal(mapping.kj, 3);
  assert.equal(mapping.kcal, undefined);
  const f = detectFormats(table, mapping);
  assert.equal(f.decimal, 'comma');
  const { entries } = buildFoodRows(table, { mapping, dateOrder: f.dateOrder, decimal: f.decimal, defaultMeal: 'lunch', today: T });
  assert.deepEqual(entries.map((e) => [e.date, e.name, e.kcal, e.meal]), [
    ['2026-11-12', 'Haferflocken', 372.3, 'lunch'], ['2026-11-12', 'Brot; Vollkorn', 200, 'lunch'], ['2026-11-13', 'Lachs', 312, 'lunch'],
  ]);
  assert.equal(entries[0].fat, 3.5);
});

test('generic German CSV: guessed mapping, decimal comma, kcal, skipped rows with reasons', () => {
  const csv = [
    'Datum;Mahlzeit;Lebensmittel;Menge;kcal;Eiweiß;Kohlenhydrate;Fett;Zucker;Ballaststoffe;Salz;;',
    '12.11.2026;Frühstück;"Brot ""Vollkorn""; 2 Scheiben";80;"190,5";7,2;35;1,1;2;5;0,9;;',
    '12.11.2026;Mittagessen;Nudeln;250;"1.050,0";30;180;12;;;;;',
    '12.11.2026;Abendessen;Pizza;;800;30;90;35;;;;;',
    ';Snack;Apfel;150;80;;;;;;;;',
    '13.11.2026;Snack;Riegel;;abc;;;;;;;;',
    '31.11.2026;Snack;Bad date;;100;;;;;;;;',
    '01.12.2026;Snack;Future;;100;;;;;;;;',
    '14.11.2026;Snack;Huge;;"12.000";;;;;;;;',
    '14.11.2026;Mitternachtssnack;Toast;;120;4;20;2;;;;;',
  ].join('\n');
  const table = readTable(csv);
  assert.equal(table.delimiter, ';');
  const mapping = guessMapping(table.headers);
  assert.deepEqual(mapping, { date: 0, meal: 1, name: 2, amount: 3, kcal: 4, protein: 5, carbs: 6, fat: 7, sugars: 8, fibre: 9, salt: 10 });
  const f = detectFormats(table, mapping);
  assert.equal(f.decimal, 'comma');
  assert.deepEqual(mealValues(table, mapping).map((m) => [m.value, guessMeal(m.value)]), [
    ['Frühstück', 'breakfast'], ['Mittagessen', 'lunch'], ['Abendessen', 'dinner'], ['Snack', 'snack'], ['Mitternachtssnack', 'snack'],
  ]);
  const { entries, skipped } = buildFoodRows(table, { mapping, dateOrder: 'dmy', decimal: 'comma', mealMap: { Mitternachtssnack: 'dinner' }, defaultMeal: 'snack', today: T });
  assert.deepEqual(entries.map((e) => [e.date, e.meal, e.name, e.kcal]), [
    ['2026-11-12', 'breakfast', 'Brot "Vollkorn"; 2 Scheiben', 190.5], ['2026-11-12', 'lunch', 'Nudeln', 1050], ['2026-11-12', 'dinner', 'Pizza', 800], ['2026-11-14', 'dinner', 'Toast', 120],
  ]);
  assert.deepEqual(skipped.map((s) => s.line), [5, 6, 7, 8, 9]);
  assert.match(skipped[0].reason, /No date/);
  assert.match(skipped[1].reason, /not a number/);
  assert.match(skipped[2].reason, /not readable/);
  assert.match(skipped[3].reason, /future/);
  assert.match(skipped[4].reason, /implausible/);
});

test('no meal column: default meal; kJ column labelled; sodium conversion can be turned off', () => {
  const csv = 'Date\tEnergy (kJ)\tSodium (mg)\n2026-11-10\t8368\t2000\n2026-11-11\t4184\t1000\n';
  const table = readTable(csv);
  assert.equal(table.delimiter, '\t');
  const mapping = guessMapping(table.headers);
  assert.deepEqual(mapping, { date: 0, kj: 1, sodium: 2 });
  const a = buildFoodRows(table, { mapping, dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'dinner', today: T });
  assert.deepEqual(a.entries.map((e) => [e.meal, e.kcal, e.salt]), [['dinner', 2000, 5], ['dinner', 1000, 2.5]]);
  const b = buildFoodRows(table, { mapping, dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'dinner', sodiumToSalt: false, today: T });
  assert.equal(b.entries[0].salt, null);
});

test('US-style dates and thousands commas', () => {
  const csv = 'Date,Calories,Protein\n11/25/2026,"2,150",120\n11/12/2026,"1,980.5",110\n';
  const table = readTable(csv);
  const mapping = guessMapping(table.headers);
  const f = detectFormats(table, mapping);
  assert.deepEqual([f.dateOrder, f.decimal], ['mdy', 'dot']);
  const { entries, skipped } = buildFoodRows(table, { mapping, dateOrder: f.dateOrder, decimal: f.decimal, defaultMeal: 'snack', today: T });
  assert.deepEqual(entries.map((e) => [e.date, e.kcal]), [['2026-11-12', 1980.5]]);
  assert.match(skipped[0].reason, /future/);
});

test('a file without a header row', () => {
  const t = readTable('12.11.2026;500;30\n13.11.2026;600;35\n');
  assert.equal(t.hasHeader, false);
  assert.deepEqual(t.headers, ['Column 1', 'Column 2', 'Column 3']);
  assert.equal(t.rows.length, 2);
});

test('parseAmount', () => {
  assert.deepEqual(parseAmount('58.00 g', 'dot'), { value: 58, unit: 'g' });
  assert.deepEqual(parseAmount('250 ml', 'dot'), { value: 250, unit: 'ml' });
  assert.deepEqual(parseAmount('120', 'comma'), { value: 120, unit: 'g' });
  assert.equal(parseAmount('2.00 x 1 slice', 'dot'), null);
  assert.equal(parseAmount('', 'dot'), null);
});

test('a year of rows parses quickly', () => {
  const lines = ['Date,Meal,Calories,Protein (g)'];
  for (let i = 0; i < 365 * 4; i++) lines.push(`2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')},Lunch,${500 + (i % 50)},30`);
  const t0 = Date.now();
  const table = readTable(lines.join('\n'));
  const { entries } = buildFoodRows(table, { mapping: guessMapping(table.headers), dateOrder: 'dmy', decimal: 'dot', defaultMeal: 'snack', today: T });
  assert.equal(entries.length, 1460);
  assert.ok(Date.now() - t0 < 2000);
});

// ---------------------------------------------------------------- runs

test('import runs: newRun, upsertRun cap, ownership, removable exercises, pruned mappings', () => {
  const r = newRun({ id: 'a', type: 'weights', now: 1, summary: 's', counts: { weights: 2 }, keys: { weights: ['2026-11-12'] } });
  assert.equal(r.status, 'writing');
  let list = upsertRun([], r);
  list = upsertRun(list, { ...r, status: 'done' });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'done');
  for (let i = 0; i < MAX_RUNS + 5; i++) list = upsertRun(list, { id: `x${i}`, status: i < 3 ? 'undone' : 'done' });
  assert.equal(list.length, MAX_RUNS);
  assert.equal(list.some((x) => x.id === 'x0'), false);
  assert.equal(ownedBy({ importId: 'a' }, 'a'), true);
  assert.equal(ownedBy({ importId: 'b' }, 'a'), false);
  assert.equal(ownedBy(undefined, 'a'), false);
  assert.deepEqual(removableExercises(['c1', 'c2'], [{ exercises: [{ exerciseId: 'c2' }] }], [{ items: [] }]), { remove: ['c1'], keep: ['c2'] });
  assert.deepEqual(pruneMappings({ bench: 'c1', squat: 'seed:x' }, ['c1']), { squat: 'seed:x' });
});

test('item 1: German thousands separators in the energy column are not read as decimals', () => {
  const csv = 'Datum;Kalorien;Eiweiß\n12.11.2026;1.050;44\n13.11.2026;1.250;50\n14.11.2026;980;40\n';
  const table = readTable(csv);
  const mapping = guessMapping(table.headers);
  const f = detectFormats(table, mapping);
  assert.equal(f.decimal, 'comma');
  assert.ok(['high', 'medium', 'low'].includes(f.decimalConfidence));
  const { entries } = buildFoodRows(table, { mapping, dateOrder: f.dateOrder, decimal: f.decimal, defaultMeal: 'snack', today: T });
  assert.deepEqual(entries.map((e) => e.kcal), [1050, 1250, 980]);
  assert.deepEqual(summariseFood(entries).warnings, []);
});

test('item 1: mirror case — "1,050" in a dot-decimal file is thousands, not 1.05', () => {
  const csv = 'Date;Calories;Protein\n2026-11-12;1,050;44.5\n2026-11-13;1,250;50\n2026-11-14;980;40\n';
  const table = readTable(csv);
  const mapping = guessMapping(table.headers);
  const f = detectFormats(table, mapping);
  assert.equal(f.decimal, 'dot');
  const { entries } = buildFoodRows(table, { mapping, dateOrder: f.dateOrder, decimal: f.decimal, defaultMeal: 'snack', today: T });
  assert.deepEqual(entries.map((e) => [e.kcal, e.protein]), [[1050, 44.5], [1250, 50], [980, 40]]);
  // without other evidence the energy meaning decides too
  const t2 = readTable('Datum\tKalorien\n12.11.2026\t1,050\n13.11.2026\t1,250\n14.11.2026\t2,005\n');
  const f2 = detectFormats(t2, guessMapping(t2.headers));
  assert.equal(f2.decimal, 'dot');
});

test('item 1: decimal detection reports a confidence; three-digit groups alone are only a pattern', () => {
  // only an amount column with "1.000" style values: thousands by pattern, medium confidence
  const t = readTable('Datum;Menge;kcal\n12.11.2026;1.000;500\n13.11.2026;2.500;600\n');
  const f = detectFormats(t, { date: 0, amount: 1, kcal: 2 });
  assert.deepEqual([f.decimal, f.decimalConfidence], ['comma', 'medium']);
  // clear decimal commas: high
  const g = detectFormats(readTable('Datum;kcal\n12.11.2026;380,5\n13.11.2026;620\n'), { date: 0, kcal: 1 });
  assert.deepEqual([g.decimal, g.decimalConfidence], ['comma', 'high']);
  // conflicting evidence: low
  const h = detectFormats(readTable('Datum;kcal;Fett\n12.11.2026;380,5;9.5\n13.11.2026;620,5;12.5\n'), { date: 0, kcal: 1, fat: 2 });
  assert.equal(h.decimalConfidence, 'low');
  // no separators at all: style does not matter
  const k = detectFormats(readTable('Datum;kcal\n12.11.2026;380\n13.11.2026;620\n'), { date: 0, kcal: 1 });
  assert.deepEqual([k.decimal, k.decimalConfidence], ['dot', 'high']);
  // existing rule: a comma-separated file without commas in the values stays dot, "105.000" kcal would be implausible as thousands
  const m = detectFormats(readTable('Date,Calories\n2026-11-12,105.000\n2026-11-13,98.500\n'), { date: 0, kcal: 1 });
  assert.equal(m.decimal, 'dot');
});

test('item 1: plausibility warning when the median day energy looks wrong', () => {
  const low = summariseFood([{ date: '2026-11-12', kcal: 1.1 }, { date: '2026-11-13', kcal: 1.3 }, { date: '2026-11-14', kcal: 980 }]);
  assert.equal(low.warnings.length, 1);
  assert.match(low.warnings[0].message, /low/);
  assert.equal(low.warnings[0].code, 'median-low');
  const high = summariseFood([{ date: '2026-11-12', kcal: 9000 }, { date: '2026-11-12', kcal: 9000 }]);
  assert.equal(high.warnings[0].code, 'median-high');
  assert.deepEqual(summariseFood([]).warnings, []);
});
