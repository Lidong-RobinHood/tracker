// Dev-time guard: the workout views must not call the native Node.append / replaceChildren /
// prepend, which turn null/false/undefined children into the text "null" (the picker showed
// "nullnull" twice). Use append / replaceChildren from src/ui/index.js, which skip them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../src/workout/', import.meta.url);
// Owned elsewhere; both filter their children before the native call.
const SKIP = new Set(['chart.js', 'analytics-charts.js']);

test('src/workout uses the null-safe append/replaceChildren helpers', () => {
  const bad = [];
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.js') && !SKIP.has(n))) {
    const src = fs.readFileSync(path.join(DIR.pathname, f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\.(append|replaceChildren|prepend)\(/.test(line)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `native DOM calls found:\n${bad.join('\n')}`);
});
