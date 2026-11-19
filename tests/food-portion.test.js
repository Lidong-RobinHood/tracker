import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountText, servingFromText, cleanServings, defaultAmount, multiplyAmount, basisFromQuantity } from '../src/core/portion.js';

test('parses metric amounts from free text', () => {
  assert.deepEqual(parseAmountText('30 g'), { amount: 30, unit: 'g' });
  assert.deepEqual(parseAmountText('250ml'), { amount: 250, unit: 'ml' });
  assert.deepEqual(parseAmountText('0,5 l'), { amount: 500, unit: 'ml' });
  assert.deepEqual(parseAmountText('33 cl'), { amount: 330, unit: 'ml' });
  assert.deepEqual(parseAmountText('1 cup (240 mL)'), { amount: 240, unit: 'ml' });
  assert.deepEqual(parseAmountText('2 x 125 g (250 g)'), { amount: 250, unit: 'g' });
  assert.deepEqual(parseAmountText('1 kg'), { amount: 1000, unit: 'g' });
  assert.deepEqual(parseAmountText('1 oz'), { amount: 28.3, unit: 'g' });
  assert.equal(parseAmountText('1 slice'), null);
  assert.equal(parseAmountText(''), null);
  assert.equal(parseAmountText(null), null);
  assert.equal(parseAmountText('12 eggs'), null);
});

test('serving chips from serving text', () => {
  assert.deepEqual(servingFromText('1 portion (15 g)'), { label: '1 portion', amount: 15 });
  assert.deepEqual(servingFromText('30 g'), { label: 'Serving', amount: 30 });
  assert.deepEqual(servingFromText('2 biscuits', 25), { label: '2 biscuits', amount: 25 });
  assert.deepEqual(servingFromText(null, 40), { label: 'Serving', amount: 40 });
  assert.equal(servingFromText('1 slice'), null);
});

test('cleanServings removes duplicates and invalid amounts', () => {
  assert.deepEqual(cleanServings([{ label: 'a', amount: 30 }, { label: 'b', amount: 30 }, { label: '', amount: 0 }, { label: '', amount: 12 }]),
    [{ label: 'a', amount: 30 }, { label: 'Serving', amount: 12 }]);
});

test('default amount: last amount, else serving, else 100', () => {
  assert.equal(defaultAmount({ lastAmount: 42, servings: [{ amount: 30 }] }), 42);
  assert.equal(defaultAmount({ lastAmount: null, servings: [{ amount: 30 }] }), 30);
  assert.equal(defaultAmount({ servings: [] }), 100);
  assert.equal(defaultAmount(null), 100);
  assert.equal(defaultAmount({ servings: [{ label: 'Whole pack', amount: 400 }] }), 100);
});

test('multiplyAmount rounds sensibly', () => {
  assert.equal(multiplyAmount(125, 0.5), 63);
  assert.equal(multiplyAmount(15, 2), 30);
  assert.equal(multiplyAmount(7, 0.5), 3.5);
});

test('basis from pack quantity', () => {
  assert.equal(basisFromQuantity('1,5 l'), 'ml');
  assert.equal(basisFromQuantity('400 g'), 'g');
  assert.equal(basisFromQuantity(''), 'g');
});

test('item 8: parseAmountText — thousands groups and multipacks', () => {
  assert.deepEqual(parseAmountText('1.234,5 g'), { amount: 1234.5, unit: 'g' });
  assert.deepEqual(parseAmountText('1,234.5 g'), { amount: 1234.5, unit: 'g' });
  assert.deepEqual(parseAmountText('1.500 g'), { amount: 1500, unit: 'g' }); // three digits after the mark in grams: thousands
  assert.deepEqual(parseAmountText('1,5 kg'), { amount: 1500, unit: 'g' });
  assert.deepEqual(parseAmountText('1,250 kg'), { amount: 1250, unit: 'g' }); // in kg / l a decimal mark
  assert.deepEqual(parseAmountText('6 x 330 ml'), { amount: 1980, unit: 'ml', count: 6, each: 330 });
  assert.deepEqual(parseAmountText('4×125g'), { amount: 500, unit: 'g', count: 4, each: 125 });
  assert.deepEqual(parseAmountText('2 x 125 g (250 g)'), { amount: 250, unit: 'g' });
});
