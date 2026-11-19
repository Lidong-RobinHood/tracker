// Every icon referenced in src/ must exist in src/ui/icons.js, so a typo cannot ship a blank icon.
// Checked forms (use literal names): icon('name' …), iconButton('name' …), and `icon: 'name'` in
// option objects (tab bar, segmented(), iconTabs(), tag()).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_NAMES, hasIcon } from '../src/ui/icons.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function jsFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const PATTERNS = [
  /\bicon\(\s*['"`]([^'"`]+)['"`]/g,
  /\biconButton\(\s*['"`]([^'"`]+)['"`]/g,
  /\bicon:\s*['"`]([^'"`]+)['"`]/g,
];

test('every icon referenced in src/ exists', () => {
  const missing = [];
  let count = 0;
  for (const f of jsFiles(SRC)) {
    if (f.endsWith(path.join('ui', 'icons.js'))) continue;
    const src = fs.readFileSync(f, 'utf8');
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        count++;
        if (!hasIcon(m[1])) missing.push(`${path.relative(SRC, f)}: ${m[1]}`);
      }
    }
  }
  assert.deepEqual(missing, [], `unknown icons:\n${missing.join('\n')}`);
  assert.ok(count >= 5, 'the scan finds the shell icons');
});

test('the icon set covers the design and the feature screens', () => {
  const needed = ['utensils', 'barbell', 'chart-line', 'settings', 'search', 'scan-barcode', 'rotate-ccw-clock',
    'bookmark', 'pencil', 'camera', 'info', 'x', 'check', 'chevron-left', 'chevron-right', 'chevron-down',
    'chevron-up', 'plus', 'minus', 'play', 'trophy', 'circle-play', 'file-chart-column', 'arrow-up', 'arrow-down',
    'ellipsis', 'timer', 'trash-2', 'undo-2', 'download', 'upload', 'cloud-off', 'refresh-cw', 'calendar', 'clock',
    'target', 'flame', 'scale', 'link', 'external-link', 'image', 'copy', 'repeat', 'list', 'history',
    'alert-triangle', 'check-circle', 'circle', 'droplet', 'sliders-horizontal', 'user', 'book-open', 'help-circle',
    'shield', 'log-in', 'arrow-right', 'grip-vertical', 'star', 'filter', 'heart-pulse', 'activity', 'zap'];
  const missing = needed.filter((n) => !hasIcon(n));
  assert.deepEqual(missing, []);
  assert.equal(new Set(ICON_NAMES).size, ICON_NAMES.length, 'no duplicate names');
});

test('icons.js holds only static SVG element markup', () => {
  const src = fs.readFileSync(path.join(SRC, 'ui', 'icons.js'), 'utf8');
  const body = src.slice(src.indexOf('const ICONS'), src.indexOf('/** Older or alternative names'));
  for (const m of body.matchAll(/^\s+'[a-z0-9-]+': '([^']*)',$/gm)) {
    assert.match(m[1], /^(<(path|circle|rect|line|polyline|polygon|ellipse)( [a-z][a-z0-9-]*="[^"<>]*")+ \/>)+$/, m[1]);
  }
});
