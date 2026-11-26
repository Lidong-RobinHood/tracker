import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDigitOk, upcEtoA, normaliseScan } from '../src/core/barcode.js';

test('check digits for EAN-13, EAN-8, UPC-A, GTIN-14', () => {
  assert.ok(checkDigitOk('3017620422003'));   // EAN-13 (Nutella)
  assert.ok(!checkDigitOk('3017620422004'));
  assert.ok(checkDigitOk('96385074'));        // EAN-8
  assert.ok(checkDigitOk('036000291452'));    // UPC-A
  assert.ok(checkDigitOk('10036000291459'));  // GTIN-14
  assert.ok(!checkDigitOk('12345'));
  assert.ok(!checkDigitOk('30176204220a3'));
  assert.ok(!checkDigitOk(''));
});

test('UPC-E expansion covers all last-digit rules', () => {
  assert.equal(upcEtoA('01234565'), '012345000065'); // last digit 5..9
  assert.equal(upcEtoA('01234505'), '012000003455'); // last 0
  assert.equal(upcEtoA('04252614'), '042100005264'); // last 0..2
  assert.equal(upcEtoA('01234133'), '012300000413'); // last 3
  assert.equal(upcEtoA('01234149'), '012340000019'); // last 4 (check digit carried through)
  assert.equal(upcEtoA('21234505'), null);           // number system must be 0/1
  assert.equal(upcEtoA('0123450'), null);
});

test('normaliseScan', () => {
  assert.deepEqual(normaliseScan(' 3017620422003 ', 'ean_13'), { code: '3017620422003', upcE: null });
  assert.equal(normaliseScan('3017620422004', 'ean_13'), null);
  assert.deepEqual(normaliseScan('04252614', 'upc_e'), { code: '042100005264', upcE: '04252614' });
  assert.equal(normaliseScan('04252615', 'upc_e'), null);
  assert.equal(normaliseScan(null), null);
});
