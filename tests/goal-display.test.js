import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUS, goalSign, signedAmount, signedRateValue, signedRateSpeech, signedGoalSummary, goalAmountError, parseGoalAmount } from '../src/core/goal-display.js';
import en from '../src/i18n/en/core.js';

/** Core returns {key, params}; render it with the English catalogue as the UI would. */
const say = (m) => (m === null ? null : en[m.key].replace(/\{(\w+)\}/g, (_, k) => String(m.params[k])));

test('sign per direction uses the typographic minus', () => {
  assert.equal(MINUS, '−');
  assert.equal(goalSign('lose'), '−');
  assert.equal(goalSign('gain'), '+');
  assert.equal(goalSign('maintain'), '');
});

test('signedAmount and signedRateValue', () => {
  assert.equal(signedAmount('lose', 0.5), '−0.5');
  assert.equal(signedAmount('gain', 0.25), '+0.25');
  assert.equal(signedAmount('maintain', null), '0');
  assert.equal(signedRateValue(-0.75), '−0.75');
  assert.equal(signedRateValue(0.25), '+0.25');
  assert.equal(signedRateValue(0), '0');
  assert.equal(signedRateValue(null), '0');
});

test('screen-reader text', () => {
  assert.equal(say(signedRateSpeech('lose', 0.5)), 'minus 0.5 kilograms per week');
  assert.equal(say(signedRateSpeech('gain', 0.25)), 'plus 0.25 kilograms per week');
  assert.equal(say(signedRateSpeech('lose', null)), 'minus, enter kilograms per week');
  assert.equal(say(signedRateSpeech('maintain', null)), 'maintain, 0 kilograms per week');
});

test('summary line shows the signed rate first', () => {
  assert.equal(say(signedGoalSummary('lose', 0.5, { kcalDay: 550 })), '−0.5 kg / week · −550 kcal / day');
  assert.equal(say(signedGoalSummary('lose', 1, { kcalDay: 1100 })), '−1 kg / week · −1\u202f100 kcal / day');
  assert.equal(say(signedGoalSummary('gain', 0.25)), '+0.25 kg / week');
  assert.equal(say(signedGoalSummary('maintain', null)), '0 kg / week');
  assert.equal(say(signedGoalSummary('lose', 2, { max: 1 })), 'Max 1 kg / week');
});

test('amount errors: above 0 and over the limit are different messages', () => {
  assert.equal(goalAmountError('lose', 0).error, true);
  assert.deepEqual(goalAmountError('lose', 1.2), { key: 'core.goal.errorMax', params: { max: 1 }, error: true });
  assert.equal(say(goalAmountError('lose', 0)), 'Enter an amount above 0');
  assert.equal(say(goalAmountError('gain', 0)), 'Enter an amount above 0');
  assert.equal(say(goalAmountError('lose', null)), 'Enter an amount above 0');
  assert.equal(say(goalAmountError('lose', 0.001)), 'Enter an amount above 0');
  assert.equal(say(goalAmountError('lose', 1.2)), 'Max 1 kg / week');
  assert.equal(say(goalAmountError('gain', 0.8)), 'Max 0.5 kg / week');
  assert.equal(say(goalAmountError('lose', 1)), null);
  assert.equal(say(goalAmountError('gain', 0.5)), null);
  assert.equal(say(goalAmountError('maintain', null)), null);
  assert.equal(say(signedGoalSummary('lose', 0)), 'Enter an amount above 0');
  assert.equal(say(signedGoalSummary('gain', 0)), 'Enter an amount above 0');
  assert.equal(say(signedGoalSummary('gain', 0.8)), 'Max 0.5 kg / week');
});

test('typed amount: sign comes from the direction', () => {
  assert.equal(parseGoalAmount('0,5'), 0.5);
  assert.equal(parseGoalAmount('−0.5'), 0.5);
  assert.equal(parseGoalAmount('-0.25'), 0.25);
  assert.equal(parseGoalAmount('+0.25'), 0.25);
  assert.equal(parseGoalAmount('0'), 0);
  assert.equal(parseGoalAmount(''), null);
  assert.equal(parseGoalAmount('-'), null);
  assert.equal(parseGoalAmount('abc'), null);
});
