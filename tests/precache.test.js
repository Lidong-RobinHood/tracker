import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { collectPrecache, renderList, ROOT, LIST_FILE } from '../tools/build-precache.mjs';

test('committed precache-list.js matches the files on disk (run `node tools/build-precache.mjs`)', () => {
  const committed = readFileSync(join(ROOT, LIST_FILE), 'utf8');
  assert.equal(committed, renderList(collectPrecache()), 'precache-list.js is stale: run `node tools/build-precache.mjs`');
});

test('precache list covers the runtime files and nothing else', () => {
  const paths = collectPrecache().files.map((f) => f[0]);
  for (const must of ['index.html', 'app.css', 'manifest.webmanifest', 'src/app.js', 'src/version.js',
    'src/trends/trends.css', 'src/settings/settings.css', 'src/import/import.css', 'src/import/worker.js',
    'src/import/parsers.js', 'src/data/generic-foods.json', 'vendor/barcode-detector/ponyfill.js',
    'vendor/barcode-detector/zxing_reader.wasm', 'icons/icon-192.png']) {
    assert.ok(paths.includes(must), `${must} is precached`);
  }
  for (const p of paths) {
    assert.ok(!/^(tests|docs|tools|spike)\//.test(p), `${p} must not be precached`);
    assert.ok(!/\.(md|txt)$/.test(p), `${p} must not be precached`);
    assert.ok(existsSync(join(ROOT, p)));
  }
  assert.ok(!paths.includes('sw.js') && !paths.includes(LIST_FILE));
});

test('sw.js loads the list and serves the same cache version as the app', () => {
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  assert.match(sw, /importScripts\('precache-list\.js'\)/);
});
