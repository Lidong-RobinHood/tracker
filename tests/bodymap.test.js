// The body-map artwork covers exactly the app's muscle ids (src/core/muscles.js), each with an icon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MUSCLE_IDS } from '../src/core/muscles.js';
import { VIEW_PATHS, ICON_CROPS, BODY } from '../src/ui/bodymap-art.js';

test('body map muscles equal MUSCLE_IDS', () => {
  const drawn = new Set([...VIEW_PATHS.front, ...VIEW_PATHS.back].map(([m]) => m));
  assert.deepEqual([...drawn].sort(), [...MUSCLE_IDS].sort());
  assert.deepEqual(Object.keys(ICON_CROPS).sort(), [...MUSCLE_IDS].sort());
  for (const [m, c] of Object.entries(ICON_CROPS)) {
    assert.ok(c.muscles.includes(m), `${m} icon draws ${m}`);
    assert.ok(c.body.every((i) => typeof BODY[i] === 'string'));
  }
});
