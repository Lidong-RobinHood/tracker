import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEED_EXERCISES, SEED_VERSION } from '../src/data/exercises.js';
import { isMuscleId } from '../src/core/muscles.js';

const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'other'];

test('seed library is well-formed', () => {
  assert.ok(Number.isInteger(SEED_VERSION) && SEED_VERSION >= 1);
  assert.ok(SEED_EXERCISES.length >= 80 && SEED_EXERCISES.length <= 110, `count ${SEED_EXERCISES.length}`);
  const ids = new Set();
  const names = new Set();
  for (const e of SEED_EXERCISES) {
    assert.match(e.id, /^seed:[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
    assert.ok(!names.has(e.name), `duplicate name ${e.name}`);
    ids.add(e.id); names.add(e.name);
    assert.ok(e.primary.length >= 1, e.id);
    for (const m of [...e.primary, ...e.secondary]) assert.ok(isMuscleId(m), `${e.id}: ${m}`);
    assert.ok(!e.primary.some((m) => e.secondary.includes(m)), `${e.id}: muscle both primary and secondary`);
    assert.ok(EQUIPMENT.includes(e.equipment), e.id);
    assert.ok(e.increment > 0, `${e.id}: increment`);
  }
});

test('neutral-grip pull-up: primary back, secondary biceps + forearms', () => {
  const e = SEED_EXERCISES.find((x) => x.id === 'seed:neutral-grip-pull-up');
  assert.ok(e);
  assert.deepEqual(e.primary, ['back']);
  assert.deepEqual([...e.secondary].sort(), ['biceps', 'forearms']);
});

test('every muscle has at least one primary exercise', async () => {
  const { MUSCLE_IDS } = await import('../src/core/muscles.js');
  for (const m of MUSCLE_IDS) assert.ok(SEED_EXERCISES.some((e) => e.primary.includes(m)), m);
});
