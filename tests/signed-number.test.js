import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMinus, parseSigned, flipSignText } from '../src/core/signed-number.js';
import { rateToGoal, goalToRate, amountValid, goalSummary, GOAL_AMOUNT_MAX, GOAL_PRESETS } from '../src/core/goal-rate.js';

test('parseSigned accepts ASCII and typographic minus, comma and dot', () => {
  assert.equal(parseSigned('-0.5'), -0.5);
  assert.equal(parseSigned('\u22120,5'), -0.5);
  assert.equal(parseSigned('\u20130.25'), -0.25);
  assert.equal(parseSigned('0,5'), 0.5);
  assert.equal(parseSigned('0.5'), 0.5);
  assert.equal(parseSigned('+0,25'), 0.25);
  assert.equal(parseSigned(-1), -1);
  for (const bad of ['', '-', '\u2212', '--1', '\u2212-1', 'abc', null, undefined]) assert.equal(parseSigned(bad), null, String(bad));
  assert.equal(normalizeMinus('\u2212\uFF0D\uFE63'), '---');
});

test('flipSignText keeps the typed text', () => {
  assert.equal(flipSignText('0,5'), '-0,5');
  assert.equal(flipSignText('-0,5'), '0,5');
  assert.equal(flipSignText('\u22122'), '2');
  assert.equal(flipSignText('+3'), '-3');
  assert.equal(flipSignText(''), '-');
  assert.equal(flipSignText('-'), '');
  assert.equal(flipSignText(' 1.5 '), '-1.5');
});

test('rateToGoal splits a stored signed rate', () => {
  assert.deepEqual(rateToGoal(-0.75), { direction: 'lose', amount: 0.75 });
  assert.deepEqual(rateToGoal(-0.5), { direction: 'lose', amount: 0.5 });
  assert.deepEqual(rateToGoal(0.25), { direction: 'gain', amount: 0.25 });
  assert.deepEqual(rateToGoal(0), { direction: 'maintain', amount: null });
  assert.deepEqual(rateToGoal(-0), { direction: 'maintain', amount: null });
  assert.deepEqual(rateToGoal(0.001), { direction: 'maintain', amount: null });
  for (const v of [null, undefined, NaN, '0.5']) assert.deepEqual(rateToGoal(v), { direction: 'maintain', amount: null });
  assert.deepEqual(rateToGoal(-1.5), { direction: 'lose', amount: 1.5 }, 'out of range is kept, not clamped');
});

test('goalToRate builds the signed rate and enforces limits per direction', () => {
  assert.equal(goalToRate('lose', 0.5), -0.5);
  assert.equal(goalToRate('lose', 1), -1);
  assert.equal(goalToRate('gain', 0.25), 0.25);
  assert.equal(goalToRate('gain', 0.5), 0.5);
  assert.equal(goalToRate('maintain', null), 0);
  assert.equal(goalToRate('maintain', 0.7), 0);
  assert.equal(goalToRate('lose', 1.01), null);
  assert.equal(goalToRate('gain', 0.75), null);
  assert.equal(goalToRate('lose', 0), null);
  assert.equal(goalToRate('lose', -0.5), null);
  assert.equal(goalToRate('lose', null), null);
  assert.equal(goalToRate('sideways', 0.5), null);
  assert.equal(goalToRate('lose', 0.333), -0.33);
  assert.ok(!Object.is(goalToRate('maintain'), -0));
});

test('round trip for every preset', () => {
  for (const dir of ['lose', 'gain']) {
    for (const a of GOAL_PRESETS[dir]) {
      assert.ok(amountValid(dir, a));
      assert.ok(a <= GOAL_AMOUNT_MAX[dir]);
      assert.deepEqual(rateToGoal(goalToRate(dir, a)), { direction: dir, amount: a });
    }
  }
  assert.deepEqual(GOAL_AMOUNT_MAX, { lose: 1, gain: 0.5 });
});

test('goalSummary is plain language (catalogue key + values)', () => {
  assert.deepEqual(goalSummary('lose', 0.5), { key: 'core.goal.lose', params: { amount: 0.5 } });
  assert.deepEqual(goalSummary('gain', 0.25), { key: 'core.goal.gain', params: { amount: 0.25 } });
  assert.deepEqual(goalSummary('maintain', null), { key: 'core.goal.maintain' });
  assert.deepEqual(goalSummary('gain', 0.75), { key: 'core.goal.gainMax', params: { max: 0.5 } });
});
