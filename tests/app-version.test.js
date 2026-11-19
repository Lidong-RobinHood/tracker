import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAppVersion, compareVersions, updateAvailable, checkDue } from '../src/core/app-version.js';
import { APP_VERSION } from '../src/version.js';

test('parseAppVersion reads the constant from version.js source text', () => {
  assert.equal(parseAppVersion("// x\nexport const APP_VERSION = '0.4.0';\n"), '0.4.0');
  assert.equal(parseAppVersion('export const APP_VERSION = "1.2.3-beta";'), '1.2.3-beta');
  assert.equal(parseAppVersion('<!doctype html><title>404</title>'), null);
  assert.equal(parseAppVersion(''), null);
  assert.equal(parseAppVersion(null), null);
});

test('compareVersions is numeric per part', () => {
  assert.equal(compareVersions('0.10.0', '0.9.3'), 1);
  assert.equal(compareVersions('0.4.0', '0.4.0'), 0);
  assert.equal(compareVersions('0.4', '0.4.0'), 0);
  assert.equal(compareVersions('0.3.1', '0.4.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-b'), -1);
});

test('updateAvailable on any difference, never for an unknown remote', () => {
  assert.equal(updateAvailable('0.4.1', '0.4.0'), true);
  assert.equal(updateAvailable('0.3.9', '0.4.0'), true, 'a rollback also reloads');
  assert.equal(updateAvailable('0.4.0', '0.4.0'), false);
  assert.equal(updateAvailable(null, '0.4.0'), false);
  assert.equal(updateAvailable('', '0.4.0'), false);
});

test('checkDue throttles background checks', () => {
  const now = 1_000_000_000;
  assert.equal(checkDue(null, now), true);
  assert.equal(checkDue(now - 60_000, now), false);
  assert.equal(checkDue(now - 11 * 60_000, now), true);
  assert.equal(checkDue(now + 60_000, now), true, 'clock moved back');
});

test('release constants are in step: sw.js CACHE_VERSION equals APP_VERSION', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const m = /const CACHE_VERSION = '([^']+)'/.exec(sw);
  assert.ok(m, 'CACHE_VERSION found in sw.js');
  assert.equal(m[1], APP_VERSION, 'bump CACHE_VERSION in sw.js together with APP_VERSION in src/version.js');
  const text = readFileSync(new URL('../src/version.js', import.meta.url), 'utf8');
  assert.equal(parseAppVersion(text), APP_VERSION, 'the update check can parse the deployed version.js');
});
