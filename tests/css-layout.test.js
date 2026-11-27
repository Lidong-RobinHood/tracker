// Static CSS checks for layout bugs that only show in a real browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

/** Declarations of the first rule whose selector is exactly `selector`. */
function rule(selector) {
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = re.exec(css);
  return m ? m[2] : null;
}

test('.chips-scroll never shrinks to 0 height in a column (portion sheet ×½/×2 row on a 568 px screen)', () => {
  const body = rule('.chips-scroll');
  assert.ok(body, '.chips-scroll rule missing');
  assert.match(body, /flex-shrink:\s*0|flex:\s*none/);
});
