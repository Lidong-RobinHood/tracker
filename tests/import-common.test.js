import { test } from 'node:test';
import assert from 'node:assert/strict';
import { msgText as txt } from '../src/import/messages.js'; // importer messages are {key, params}; English text
import {
  stripBom, splitLines, findDate, parseDateOnly, detectDateOrder, parseNumber, parseDelimited,
  detectDelimiter, detectHeader, detectDecimal, trimTrailingEmpty, median, chunk, stripWeekdays,
} from '../src/core/import-common.js';

const T = '2026-11-19';
const d = (s, o = {}) => (findDate(s, { today: T, ...o }) || {}).date ?? null;

test('stripBom and splitLines handle BOM, CRLF, CR and a trailing newline', () => {
  assert.equal(stripBom('﻿abc'), 'abc');
  assert.deepEqual(splitLines('﻿a\r\nb\rc\n'), ['a', 'b', 'c']);
  assert.deepEqual(splitLines('a\n\n\nb'), ['a', '', '', 'b']);
  assert.deepEqual(splitLines(''), ['']);
});

test('findDate: German, ISO, slash, textual English and German', () => {
  assert.equal(d('12.11.2026'), '2026-11-12');
  assert.equal(d('1.2.2026'), '2026-02-01');
  assert.equal(d('12.11.26'), '2026-11-12');
  assert.equal(d('2026-11-12'), '2026-11-12');
  assert.equal(d('2026/11/12'), '2026-11-12');
  assert.equal(d('12/11/26'), '2026-11-12');
  assert.equal(d('11/12/26', { order: 'mdy' }), '2026-11-12');
  assert.equal(d('12-11-2026'), '2026-11-12');
  assert.equal(d('Mon 12 Nov'), '2026-11-12');
  assert.equal(d('Thursday, 12 November 2026'), '2026-11-12');
  assert.equal(d('Do 12. Nov'), '2026-11-12');
  assert.equal(d('12. Dezember 2025'), '2025-12-12');
  assert.equal(d('3. März 2026'), '2026-03-03');
  assert.equal(d('Nov 12, 2026'), '2026-11-12');
  assert.equal(d('November 3rd'), '2026-11-03');
  assert.equal(d('12.11.'), '2026-11-12');
  assert.equal(d('2026-11-12 07:30:00'), '2026-11-12');
});

test('findDate: year-less dates pick the most recent past day', () => {
  assert.equal(d('Mon 12 Nov'), '2026-11-12');
  assert.equal(d('24 Dec'), '2025-12-24');
  assert.equal(d('20.11.'), '2025-11-20');
  assert.equal(d('19.11.'), '2026-11-19');
});

test('findDate: invalid days, weekday mismatch, ambiguity, no date', () => {
  const bad = findDate('31.02.2026', { today: T });
  assert.equal(bad.date, null);
  assert.equal(bad.error.key, 'import.date.invalid');
  assert.match(txt(bad.error), /not a valid date/);
  assert.equal(findDate('Tue 12 Nov 2026', { today: T }).weekdayMismatch, true);
  assert.equal(findDate('Thu 12 Nov 2026', { today: T }).weekdayMismatch, false);
  assert.equal(findDate('05/06/26', { today: T }).ambiguous, true);
  assert.equal(findDate('25/06/26', { today: T }).ambiguous, false);
  assert.equal(findDate('Benchpress', { today: T }), null);
  assert.equal(findDate('100 7', { today: T }), null);
  assert.equal(findDate('82,5', { today: T }), null);
  assert.equal(findDate('3 x 6', { today: T }), null);
});

test('findDate finds the date inside a line with a weight on either side', () => {
  const a = findDate('82,5;12.11.2026', { today: T });
  assert.equal(a.date, '2026-11-12');
  assert.equal('82,5;12.11.2026'.slice(0, a.start), '82,5;');
  const b = findDate('12.11.2026,82,5', { today: T });
  assert.equal(b.date, '2026-11-12');
  assert.equal('12.11.2026,82,5'.slice(b.end), ',82,5');
});

test('parseDateOnly allows a trailing time but nothing else', () => {
  assert.equal(parseDateOnly('12.11.2026 08:15', { today: T }).date, '2026-11-12');
  assert.equal(parseDateOnly('2026-11-12T08:15:00', { today: T }).date, '2026-11-12');
  assert.equal(parseDateOnly('11/12/2026 9:15 AM', { today: T, order: 'mdy' }).date, '2026-11-12');
  assert.equal(parseDateOnly('12.11.2026 Push', { today: T }), null);
});

test('detectDateOrder', () => {
  assert.deepEqual(detectDateOrder(['12/11/26', '25/11/26']), { order: 'dmy', ambiguous: false });
  assert.deepEqual(detectDateOrder(['11/12/26', '11/25/26']), { order: 'mdy', ambiguous: false });
  assert.deepEqual(detectDateOrder(['01/02/26', '03/04/26']), { order: 'dmy', ambiguous: true });
  assert.deepEqual(detectDateOrder(['12.11.2026']), { order: 'dmy', ambiguous: false });
});

test('parseNumber: decimal comma/dot, thousands, units are not numbers', () => {
  assert.equal(parseNumber('82,5'), 82.5);
  assert.equal(parseNumber('82.5'), 82.5);
  assert.equal(parseNumber(' 100 '), 100);
  assert.equal(parseNumber('1.234,5'), 1234.5);
  assert.equal(parseNumber('1,234.5'), 1234.5);
  assert.equal(parseNumber('2 100'), 2100);
  assert.equal(parseNumber('2 100,5'), 2100.5);
  assert.equal(parseNumber('1,234', 'dot'), 1234);
  assert.equal(parseNumber('1,234', 'comma'), 1.234);
  assert.equal(parseNumber('1.234', 'comma'), 1234);
  assert.equal(parseNumber('+10'), 10);
  assert.equal(parseNumber('-3,5'), -3.5);
  assert.equal(parseNumber('82,5,1'), null);
  assert.equal(parseNumber('12.34.5'), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('82 kg'), null);
});

test('parseDelimited: Excel-style quotes with separators, line breaks and doubled quotes', () => {
  const csv = '﻿Date;Food;kcal\r\n12.11.2026;"Müsli; mit ""Nüssen""";"350,5"\r\n13.11.2026;"Two\r\nlines";200\r\n\r\n14.11.2026;Apple;52;;\r\n';
  const r = parseDelimited(csv, { delimiter: ';' });
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], { cells: ['Date', 'Food', 'kcal'], line: 1 });
  assert.deepEqual(r[1].cells, ['12.11.2026', 'Müsli; mit "Nüssen"', '350,5']);
  assert.deepEqual(r[2], { cells: ['13.11.2026', 'Two\nlines', '200'], line: 3 });
  assert.deepEqual(r[3], { cells: ['14.11.2026', 'Apple', '52', '', ''], line: 6 });
});

test('parseDelimited: no trailing newline, empty quoted field, comma delimiter', () => {
  const r = parseDelimited('a,"",c\n1,2,3', { delimiter: ',' });
  assert.deepEqual(r.map((x) => x.cells), [['a', '', 'c'], ['1', '2', '3']]);
});

test('detectDelimiter picks the consistent splitter', () => {
  assert.equal(detectDelimiter('Date;Food;kcal\n12.11.2026;Apple;52,5\n13.11.2026;Pear;60\n'), ';');
  assert.equal(detectDelimiter('Date,Meal,Calories\n2026-11-12,Breakfast,500\n2026-11-13,Lunch,700\n'), ',');
  assert.equal(detectDelimiter('Date\tkcal\n12.11.2026\t52,5\n13.11.2026\t60\n'), '\t');
  assert.equal(detectDelimiter('Date,Food,kcal\n2026-11-12,"Apple, red",52\n2026-11-13,"Pear",60\n'), ',');
  // semicolon file with decimal commas: commas are not the delimiter
  assert.equal(detectDelimiter('12.11.2026;82,5;12,1\n13.11.2026;82,1;12,0\n14.11.2026;81,9;11,8\n'), ';');
});

test('detectHeader', () => {
  const recs = (rows) => rows.map((cells) => ({ cells }));
  assert.equal(detectHeader(recs([['Date', 'kcal'], ['12.11.2026', '500']])), true);
  assert.equal(detectHeader(recs([['12.11.2026', '500'], ['13.11.2026', '600']])), false);
  assert.equal(detectHeader(recs([['Datum', 'Bezeichnung', 'kJ'], ['12.11.2026 08:15', 'Brot', '1200']])), true);
});

test('detectDecimal', () => {
  assert.equal(detectDecimal(['82,5', '12,1', '300']), 'comma');
  assert.equal(detectDecimal(['82.5', '12.1', '300']), 'dot');
  assert.equal(detectDecimal(['1.234,5']), 'comma');
  assert.equal(detectDecimal(['1,234.5']), 'dot');
});

test('small helpers', () => {
  assert.deepEqual(trimTrailingEmpty(['a', '', 'b', '', '']), ['a', '', 'b']);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.equal(stripWeekdays('Mo 82,5').trim(), '82,5');
  assert.equal(stripWeekdays('Montag, 82,5').trim(), '82,5');
});

test('item 1: detectDecimal treats columns of exactly-three-digit groups as thousands', () => {
  assert.equal(detectDecimal(['1.050', '1.250', '980']), 'comma');
  assert.equal(detectDecimal(['1,050', '1,250', '980']), 'dot');
  assert.equal(detectDecimal(['1.050', '980.5']), 'dot'); // another pattern in the column: decimal dot
  assert.equal(detectDecimal(['0.125', '0.250']), 'dot'); // a leading 0 is never a thousands group
});

test('item 8: findDate "29.02." without a year is the most recent 29 February', () => {
  const r = findDate('29.02.', { today: '2026-11-19' });
  assert.equal(r.error, null);
  assert.equal(r.date, '2024-02-29');
  assert.equal(findDate('29.02.', { today: '2028-03-01' }).date, '2028-02-29');
  assert.equal(findDate('12.11.', { today: '2026-11-19' }).date, '2026-11-12');
  assert.equal(findDate('31.02.', { today: '2026-11-19' }).date, null);
});

test('item 8: parseNumber and its doc agree — units are not part of a number', () => {
  assert.equal(parseNumber('82,5 kg'), null);
  assert.equal(parseNumber('82,5'), 82.5);
});
