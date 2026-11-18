import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLES, MUSCLE_IDS, isMuscleId, muscleName } from '../src/core/muscles.js';

test('fixed muscle list matches the spec', () => {
  assert.deepEqual(MUSCLE_IDS, ['chest', 'back', 'traps', 'shoulders', 'biceps', 'triceps', 'forearms', 'abs', 'glutes', 'quads', 'hamstrings', 'calves']);
  assert.equal(new Set(MUSCLES.map((m) => m.name)).size, MUSCLES.length);
  assert.ok(Object.isFrozen(MUSCLES) && Object.isFrozen(MUSCLES[0]));
});

test('isMuscleId / muscleName', () => {
  assert.ok(isMuscleId('quads'));
  assert.ok(!isMuscleId('lats'));
  assert.equal(muscleName('hamstrings'), 'Hamstrings');
  assert.equal(muscleName('unknown'), 'unknown');
});
