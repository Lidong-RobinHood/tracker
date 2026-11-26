import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msgText as txt } from '../src/import/messages.js'; // importer messages are {key, params}; English text
import { parseWeightText, readWeightRest, analyseWeights, planWeights } from '../src/core/import-weights.js';

const T = '2026-11-19';
const parse = (text, o = {}) => parseWeightText(text, { today: T, ...o });
const rows = (text, o) => parse(text, o).rows.map((r) => [r.date, r.kg]);

test('date and kg in either order with every separator and decimal style', () => {
  const cases = [
    '82,5;12.11.2026', '12.11.2026,82,5', '12.11.2026;82,5', '12.11.2026\t82,5', '12.11.2026 82,5',
    '82.5,12.11.2026', '2026-11-12,82.5', '2026-11-12;82.5', '2026-11-12 82.5 kg', '82,5 kg\t12.11.2026',
    '12/11/26 82.5', 'Thu 12 Nov 2026: 82,5', '12.11.2026 07:30;82,5', '"12.11.2026";"82,5"', 'Do 12.11.2026\t82,5',
    '82,5;12.11.26',
  ];
  for (const c of cases) assert.deepEqual(rows(c.replace(/"/g, '')), [['2026-11-12', 82.5]], c);
});

test('readWeightRest: commas as decimal mark vs column separator', () => {
  assert.equal(readWeightRest(',82,5').kg, 82.5);
  assert.equal(readWeightRest('82,5;').kg, 82.5);
  const two = readWeightRest(',82.5,18.2');
  assert.deepEqual([two.kg, two.extra], [82.5, true]);
  assert.match(txt(readWeightRest(',82,18,5').error), /ambiguous/);
  assert.match(txt(readWeightRest('').error), /No weight/);
  assert.match(txt(readWeightRest('heavy').error), /weight|Unexpected/);
});

test('header rows are skipped, CRLF/BOM handled, blank lines ignored', () => {
  const r = parse('﻿Datum;Gewicht (kg)\r\n\r\n12.11.2026;82,5\r\n13.11.2026;82,1\r\n');
  assert.deepEqual(r.rows.map((x) => x.kg), [82.5, 82.1]);
  assert.equal(r.issues[0].level, 'info');
});

test('pounds are refused with the line numbers', () => {
  const r = parse('Date,Weight (lbs)\n2026-11-12,182');
  assert.match(txt(r.fatal), /pounds/);
  assert.deepEqual(r.rows, []);
  assert.match(txt(parse('12.11.2026 182 lb').fatal), /Line 1 mentions/);
});

test('line errors are numbered', () => {
  const r = parse('12.11.2026;82,5\nfoo;bar\n31.02.2026;80\n13.11.2026;\n14.11.2026;abc');
  assert.deepEqual(r.issues.map((i) => [i.line, i.level]), [[2, 'error'], [3, 'error'], [4, 'error'], [5, 'error']]);
  assert.equal(r.rows.length, 1);
});

test('slash dates use the detected order', () => {
  assert.deepEqual(rows('11/25/26 80\n11/12/26 81'), [['2026-11-25', 80], ['2026-11-12', 81]]);
  assert.deepEqual(rows('25/10/26 80\n12/11/26 81'), [['2026-10-25', 80], ['2026-11-12', 81]]);
  assert.equal(parse('05/06/26 80').dateOrderAmbiguous, true);
  assert.deepEqual(rows('05/06/26 80', { dateOrder: 'mdy' }), [['2026-05-06', 80]]);
});

test('analyseWeights: implausible, future, duplicates, conflicts, summary', () => {
  const r = parse('12.11.2026;82,5\n13.11.2026;8,25\n14.11.2026;82,1\n14.11.2026;82,0\n01.12.2026;80\n15.11.2026;81,8');
  const a = analyseWeights(r.rows, { today: T, existing: new Map([['2026-11-15', 81.0]]) });
  assert.equal(a.count, 3);
  assert.deepEqual(a.valid.map((x) => [x.date, x.kg]), [['2026-11-12', 82.5], ['2026-11-14', 82.0], ['2026-11-15', 81.8]]);
  assert.deepEqual(a.flagged.map((f) => f.line), [2, 3, 5]);
  assert.match(txt(a.flagged[0].reason), /outside 30–300/);
  assert.match(txt(a.flagged[1].reason), /line 4/);
  assert.match(txt(a.flagged[2].reason), /future/);
  assert.deepEqual(a.conflicts.map((c) => [c.date, c.existingKg]), [['2026-11-15', 81]]);
  assert.deepEqual([a.from, a.to, a.min, a.max], ['2026-11-12', '2026-11-15', 81.8, 82.5]);
});

test('planWeights: keep vs replace; replaced records kept for undo', () => {
  const valid = [{ date: '2026-11-12', kg: 82.5 }, { date: '2026-11-13', kg: 82 }];
  const existing = new Map([['2026-11-13', { date: '2026-11-13', kg: 81, updatedAt: 1 }]]);
  const keep = planWeights(valid, { policy: 'keep', existing, importId: 'r', now: 5 });
  assert.deepEqual(keep.records, [{ date: '2026-11-12', kg: 82.5, updatedAt: 5, importId: 'r' }]);
  assert.equal(keep.keptExisting, 1);
  assert.deepEqual(keep.replaced, []);
  const rep = planWeights(valid, { policy: 'replace', existing, importId: 'r', now: 5 });
  assert.equal(rep.records.length, 2);
  assert.deepEqual(rep.replaced, [{ date: '2026-11-13', kg: 81, updatedAt: 1 }]);
});

test('60 German lines (a typical paste) parse cleanly', () => {
  const lines = ['Datum\tGewicht'];
  for (let i = 0; i < 60; i++) {
    const day = new Date(2026, 8, 1 + i);
    lines.push(`${String(day.getDate()).padStart(2, '0')}.${String(day.getMonth() + 1).padStart(2, '0')}.${day.getFullYear()}\t${(84 - i * 0.05).toFixed(1).replace('.', ',')}`);
  }
  const r = parse(lines.join('\n'));
  assert.equal(r.rows.length, 60);
  assert.equal(r.rows[0].kg, 84);
  assert.equal(r.rows[0].date, '2026-09-01');
});

test('a year of daily weights stays fast', () => {
  const lines = [];
  for (let i = 0; i < 2000; i++) lines.push(`2026-0${(i % 9) + 1}-${String((i % 28) + 1).padStart(2, '0')};${80 + (i % 10) / 10}`);
  const t0 = Date.now();
  parse(lines.join('\n'));
  assert.ok(Date.now() - t0 < 1500);
});

test('item 2: comma file with an extra integer column is read by its header, never merged', () => {
  const r = parse('Date,Weight,BodyFat\n10.11.2026,82,18\n11.11.2026,81,17');
  assert.deepEqual(r.rows.map((x) => [x.date, x.kg]), [['2026-11-10', 82], ['2026-11-11', 81]]);
  assert.ok(r.notes.map(txt).some((n) => /column/i.test(n) && /BodyFat/.test(n)), JSON.stringify(r.notes));
  assert.ok(r.issues.some((i) => i.line === 2 && /ignored|first one/i.test(txt(i.message))));
  // a header with two columns: the comma inside the value is a decimal comma
  assert.deepEqual(rows('Datum,Gewicht\n12.11.2026,82,5\n13.11.2026,82,1'), [['2026-11-12', 82.5], ['2026-11-13', 82.1]]);
  // header says 3 columns but a line has 4 comma fields: explicit ambiguity, not a guess
  const m = parse('Date,Weight,BodyFat\n10.11.2026,82,5,18\n11.11.2026,81,17');
  assert.deepEqual(m.rows.map((x) => x.kg), [81]);
  assert.match(txt(m.issues.find((i) => i.line === 2).message), /ambiguous/);
});

test('item 2: without a header — documented single lines keep working, a two-digit decimal is a flagged guess', () => {
  assert.deepEqual(rows('82,5;12.11.2026'), [['2026-11-12', 82.5]]);
  assert.deepEqual(rows('12.11.2026,82,5'), [['2026-11-12', 82.5]]);
  const g = parse('12.11.2026,82,18');
  assert.deepEqual(g.rows.map((x) => x.kg), [82.18]);
  assert.ok(g.notes.map(txt).some((n) => /82,18/.test(n) && /guess/i.test(n)), JSON.stringify(g.notes));
  assert.deepEqual(parse('12.11.2026,82,5').notes, []);
});

test('item 8: ISO timestamps use the local date', () => {
  assert.deepEqual(rows('2026-11-12T07:30;82.5'), [['2026-11-12', 82.5]]);
  assert.deepEqual(rows('2026-11-12T07:30:15;82,5'), [['2026-11-12', 82.5]]);
  const z = new Date('2026-11-12T23:30:00Z');
  const local = `${z.getFullYear()}-${String(z.getMonth() + 1).padStart(2, '0')}-${String(z.getDate()).padStart(2, '0')}`;
  assert.deepEqual(rows('2026-11-12T23:30:00Z;82.5'), [[local, 82.5]]);
});
