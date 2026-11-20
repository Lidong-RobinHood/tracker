// Every infoButton('…') / openInfo('…') / pageHeader({ info: '…' }) id used in src/ exists in
// src/ui/info-sheets.js, and the sheets stay short (title + ≤ ~60 words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INFO_SHEETS, INFO_SHEET_IDS, infoSheet, fmtInfoNumber } from '../src/ui/info-sheets.js';

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
  /\binfoButton\(\s*['"`]([^'"`]+)['"`]/g,
  /\bopenInfo\(\s*['"`]([^'"`]+)['"`]/g,
  /\binfo:\s*['"`]([^'"`]+)['"`]/g,
];

test('every info-sheet id used in src/ exists', () => {
  const missing = [];
  for (const f of jsFiles(SRC)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of PATTERNS) for (const m of src.matchAll(re)) if (!INFO_SHEETS[m[1]]) missing.push(`${path.relative(SRC, f)}: ${m[1]}`);
  }
  assert.deepEqual(missing, [], `unknown info sheets:\n${missing.join('\n')}`);
});

test('the 23 sheets of the copy audit and the split / workout sheets exist and are short', () => {
  const ids = ['recovery', 'recovery-math', 'sets', 'tonnage', 'records', 'metrics', 'top-exercises', 'progression',
    'starting', 'photo', 'camera', 'expenditure', 'checkin', 'complete', 'trend', 'report', 'macros',
    'adaptive-macros', 'goal', 'backup', 'storage', 'import-weights', 'import-workouts'];
  ids.push('split-choose', 'split-sets', 'split-run'); // split library (docs/SPLITS.md)
  ids.push('sets-workout'); // sets per muscle of one workout
  assert.deepEqual([...INFO_SHEET_IDS].sort(), [...ids].sort());
  for (const id of ids) {
    const s = infoSheet(id);
    assert.ok(s.title && s.paragraphs.length >= 1, id);
    const words = s.paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 66, `${id}: ${words} words`);
    for (const p of s.paragraphs) {
      assert.doesNotMatch(p, /undefined|NaN|\$\{/, `${id}: unfilled value`);
      assert.doesNotMatch(p, /\p{Extended_Pictographic}/u, `${id}: no emojis`);
    }
  }
});

test('sheet values come from the code constants and can be overridden', () => {
  assert.match(infoSheet('sets').paragraphs[0], /× 1; partial \(it assists\) × 0\.5; dropsets × 0\./);
  assert.match(infoSheet('sets', { primary: 1, secondary: 0.25, dropset: 0.5 }).paragraphs[0], /× 0\.25; dropsets × 0\.5\./);
  assert.match(infoSheet('goal').paragraphs[0], /Lose up to 1 kg or gain up to 0\.5 kg \/ week.*7 700 kcal \/ kg/);
  assert.match(infoSheet('recovery-math').paragraphs[0], /1 set × 0\.7, 8 sets × 1\.4, 9 or more × 1\.5/);
  assert.match(infoSheet('checkin').paragraphs[1], /capped at 150 kcal \/ week/);
  assert.equal(fmtInfoNumber(1568), '1 568');
  assert.equal(infoSheet('nope'), null);
});

test('split sheets use the user\'s set weighting and make no promises', () => {
  assert.match(infoSheet('split-sets').paragraphs[0], /× 1, partial \(assists\) × 0\.5/);
  assert.match(infoSheet('split-sets', { primary: 1, secondary: 0.25 }).paragraphs[0], /× 0\.25/);
  for (const id of ['split-choose', 'split-sets', 'split-run']) {
    const t = infoSheet(id).paragraphs.join(' ');
    assert.ok(t.split(/\s+/).length <= 60, id);
    assert.doesNotMatch(t, /optimal|guarantee|will build|best results/i, id);
  }
});

test('progression sheet states the rule and can lead with the session reason', () => {
  const t = infoSheet('progression').paragraphs.join(' ');
  assert.match(t, /All target sets at your top weight must reach the target reps/);
  assert.match(t, /warm-up and back-off sets are ignored/);
  assert.match(t, /dropsets never count/);
  assert.match(t, /starting point never triggers it/);
  const r = infoSheet('progression', { reason: '3 sets at 100 kg reached 6 reps.' });
  assert.equal(r.paragraphs[0], '3 sets at 100 kg reached 6 reps.');
});

test('units in sheets use the glossary form (kg / week, kcal / day), not "per"', () => {
  for (const id of INFO_SHEET_IDS) {
    const t = infoSheet(id).paragraphs.join(' ');
    assert.doesNotMatch(t, /\b(kg|kcal|g) per (week|day|kg|g)\b/, id);
  }
});
