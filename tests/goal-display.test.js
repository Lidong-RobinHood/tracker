import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUS, goalSign, signedAmount, signedRateText, signedRateSpeech, signedGoalSummary } from '../src/core/goal-display.js';

test('sign per direction uses the typographic minus', () => {
  assert.equal(MINUS, '−');
  assert.equal(goalSign('lose'), '−');
  assert.equal(goalSign('gain'), '+');
  assert.equal(goalSign('maintain'), '');
});

test('signedAmount and signedRateText', () => {
  assert.equal(signedAmount('lose', 0.5), '−0.5');
  assert.equal(signedAmount('gain', 0.25), '+0.25');
  assert.equal(signedAmount('maintain', null), '0');
  assert.equal(signedRateText(-0.75), '−0.75 kg per week');
  assert.equal(signedRateText(0.25), '+0.25 kg per week');
  assert.equal(signedRateText(0), '0 kg per week');
  assert.equal(signedRateText(null), '0 kg per week');
});

test('screen-reader text', () => {
  assert.equal(signedRateSpeech('lose', 0.5), 'minus 0.5 kilograms per week');
  assert.equal(signedRateSpeech('gain', 0.25), 'plus 0.25 kilograms per week');
  assert.equal(signedRateSpeech('lose', null), 'minus, enter kilograms per week');
  assert.equal(signedRateSpeech('maintain', null), 'maintain, 0 kilograms per week');
});

test('summary line shows the signed rate first', () => {
  assert.equal(signedGoalSummary('lose', 0.5, { kcalDay: 550 }), '−0.5 kg per week (lose about 0.5 kg a week, about 550 kcal a day below what you burn)');
  assert.equal(signedGoalSummary('gain', 0.25), '+0.25 kg per week (gain about 0.25 kg a week)');
  assert.equal(signedGoalSummary('maintain', null), 'Maintain: 0 kg per week');
  assert.equal(signedGoalSummary('lose', 2, { max: 1 }), 'Lose: enter more than 0 and at most 1 kg a week');
});
