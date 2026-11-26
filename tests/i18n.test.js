import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  t, detectLanguage, resolveLanguage, initI18n, setLanguage, getLanguage, getLanguageChoice, interpolate,
  placeholders, pluralBase, hasKey, NAMESPACES, EN_CATALOGUES, LANGUAGES, LANGUAGE_CODES, LANGUAGE_CHOICES,
  LOCALE_TAGS, STORAGE_KEY, _setDictionary, _activate, _resetWarnings,
} from '../src/i18n/index.js';
import { weekdayShort, weekdayNarrow, monthShort, monthYear, dayMonth, dateLabel, dayRange } from '../src/i18n/dates.js';
import { fmtDate, fmtDay } from '../src/ui/format.js';
import { scan, scanSource } from '../tools/i18n-scan.mjs';

const I18N = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'i18n');

/**
 * Namespaces whose de/zh catalogues may still be incomplete (keys missing) while features are being
 * converted and translated in parallel. Their files may also be missing. Stale keys (not in en) and
 * placeholder mismatches still fail. MUST BE EMPTY AT RELEASE.
 */
const PENDING = [];

/** Minimal localStorage for node. */
function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

/** Capture console.warn while fn runs. */
function warnings(fn) {
  const orig = console.warn;
  const out = [];
  console.warn = (...a) => out.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return out;
}

// ---------------------------------------------------------------- t()

test('t: English text, placeholders, unknown placeholders stay visible', () => {
  _activate('en');
  assert.equal(t('common.today'), 'Today');
  assert.equal(t('settings.update.available', { version: '0.8.0' }), 'Version 0.8.0 available');
  assert.equal(t('settings.update.available'), 'Version {version} available');
  assert.equal(interpolate('{a} and {b}', { a: 1, b: 0 }), '1 and 0');
  assert.equal(interpolate('{a}', { a: null }), '{a}');
});

test('t: plural forms by count (en one/other, de one/other, zh other only)', () => {
  _activate('en');
  assert.equal(t('settings.backup.days', { count: 1 }), 'Last backup 1 day ago.');
  assert.equal(t('settings.backup.days', { count: 5 }), 'Last backup 5 days ago.');
  assert.equal(t('settings.backup.days', { count: 0 }), 'Last backup 0 days ago.');
  _setDictionary('de', { 'x.n_one': '{count} Satz', 'x.n_other': '{count} Sätze' });
  _setDictionary('zh', { 'x.n_other': '{count} 组' });
  _activate('de');
  assert.equal(t('x.n', { count: 1 }), '1 Satz');
  assert.equal(t('x.n', { count: 2 }), '2 Sätze');
  _activate('zh');
  assert.equal(t('x.n', { count: 1 }), '1 组');
  assert.equal(t('x.n', { count: 7 }), '7 组');
  _setDictionary('de', null); _setDictionary('zh', null); _activate('en');
});

test('t: missing key falls back to English, then to the key with one warning', () => {
  _resetWarnings();
  _setDictionary('de', { 'common.today': 'Heute' });
  _activate('de');
  assert.equal(t('common.today'), 'Heute');
  assert.equal(t('common.yesterday'), 'Yesterday'); // not in de → en
  assert.equal(t('settings.backup.days', { count: 3 }), 'Last backup 3 days ago.'); // plural via en
  const w = warnings(() => { t('nope.key'); t('nope.key'); t('nope.other', { count: 2 }); });
  assert.equal(t('nope.key'), 'nope.key');
  assert.equal(w.length, 2, 'one warning per missing key');
  assert.match(w[0], /missing key "nope.key"/);
  _setDictionary('de', null); _activate('en');
});

test('hasKey, placeholders, pluralBase', () => {
  assert.ok(hasKey('common.today'));
  assert.ok(hasKey('settings.backup.days'));
  assert.ok(!hasKey('common.nope'));
  assert.deepEqual(placeholders('{b} {a} {b}'), ['a', 'b']);
  assert.equal(pluralBase('a.b_one'), 'a.b');
  assert.equal(pluralBase('a.b_other'), 'a.b');
  assert.equal(pluralBase('a.b'), null);
});

// ---------------------------------------------------------------- language choice

test('detectLanguage: first German or Chinese or English entry decides, else English', () => {
  assert.equal(detectLanguage(['de-AT', 'en']), 'de');
  assert.equal(detectLanguage(['zh-TW']), 'zh');
  assert.equal(detectLanguage(['zh-Hans-CN', 'de']), 'zh');
  assert.equal(detectLanguage(['fr-FR', 'de-DE']), 'de');
  assert.equal(detectLanguage(['en-GB', 'de-DE']), 'en');
  assert.equal(detectLanguage(['fr', 'es']), 'en');
  assert.equal(detectLanguage([]), 'en');
  assert.equal(detectLanguage(undefined), 'en');
  assert.equal(detectLanguage('DE_ch'), 'de');
  assert.equal(resolveLanguage('auto', ['zh-CN']), 'zh');
  assert.equal(resolveLanguage('de', ['zh-CN']), 'de');
  assert.equal(resolveLanguage('xx', ['de']), 'de');
});

test('languages: codes, native names, choices, locale tags', () => {
  assert.deepEqual(LANGUAGE_CODES, ['en', 'de', 'zh']);
  assert.deepEqual(LANGUAGES.map((l) => l.name), ['English', 'Deutsch', '中文']);
  assert.deepEqual(LANGUAGE_CHOICES, ['auto', 'en', 'de', 'zh']);
  assert.equal(LOCALE_TAGS.zh, 'zh-Hans');
});

test('setLanguage / initI18n: stored in localStorage, loads catalogues, auto follows the device', async () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = fakeStorage();
  try {
    assert.equal(getLanguageChoice(), 'auto');
    assert.equal(await initI18n({ languages: ['de-DE'] }), 'de');
    assert.equal(getLanguage(), 'de');
    assert.equal(t('settings.title'), 'Einstellungen');
    assert.equal(await setLanguage('zh', { languages: ['de-DE'] }), 'zh');
    assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), 'zh');
    assert.equal(getLanguageChoice(), 'zh');
    assert.equal(t('settings.title'), '设置');
    assert.equal(await initI18n({ languages: ['de-DE'] }), 'zh', 'stored choice wins over the device');
    await setLanguage('auto', { languages: ['en-US'] });
    assert.equal(globalThis.localStorage.getItem(STORAGE_KEY), null, "'auto' is the default: nothing stored");
    assert.equal(getLanguage(), 'en');
    await assert.rejects(setLanguage('fr'));
    globalThis.localStorage.setItem(STORAGE_KEY, 'garbage');
    assert.equal(getLanguageChoice(), 'auto');
  } finally {
    globalThis.localStorage = prev;
    _activate('en');
  }
});

test('blocked storage: choice reads as auto, setLanguage still switches', async () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try {
    assert.equal(getLanguageChoice(), 'auto');
    assert.equal(await setLanguage('de'), 'de');
  } finally {
    globalThis.localStorage = prev;
    _activate('en');
  }
});

// ---------------------------------------------------------------- dates

test('date names and labels per language', () => {
  const d = new Date(2026, 10, 18); // Wed
  assert.equal(dateLabel(d, {}, 'en'), 'Wed 18 Nov');
  assert.equal(dateLabel(new Date(2025, 8, 3), { year: true }, 'en'), 'Wed 3 Sep 2025');
  assert.equal(dateLabel(d, {}, 'de'), 'Mi. 18. Nov.');
  assert.equal(dateLabel(d, { year: true }, 'de'), 'Mi. 18. Nov. 2026');
  assert.equal(dateLabel(d, {}, 'zh'), '11月18日周三');
  assert.equal(dateLabel(d, { year: true }, 'zh'), '2026年11月18日周三');
  assert.equal(dayMonth(d, {}, 'en'), '18 Nov');
  assert.equal(dayMonth(d, {}, 'de'), '18. Nov.');
  assert.equal(dayMonth(d, {}, 'zh'), '11月18日');
  assert.equal(monthYear(d, 'en'), 'November 2026');
  assert.equal(monthYear(d, 'zh'), '2026年11月');
  assert.deepEqual([0, 6].map((i) => weekdayShort(i, 'en')), ['Mon', 'Sun']);
  assert.deepEqual([0, 6].map((i) => weekdayShort(i, 'zh')), ['周一', '周日']);
  assert.equal(weekdayNarrow(0, 'en'), 'M');
  assert.equal(monthShort(8, 'en'), 'Sep');
});

test('dayRange: same month, across months, across years', () => {
  const now = new Date(2026, 10, 26);
  const D = (y, m, d) => new Date(y, m - 1, d);
  const cases = {
    // no-break spaces (U+00A0, written _ here) inside a date: '22 Nov' never wraps; the spaces around ' – ' may
    en: ['16–22_Nov', '30_Nov – 6_Dec', '28_Dec_2026 – 3_Jan_2027'],
    de: ['16.–22._Nov.', '30._Nov. – 6._Dez.', '28._Dez._2026 – 3._Jan._2027'],
    zh: ['11月16日–22日', '11月30日–12月6日', '2026年12月28日–2027年1月3日'],
  };
  for (const [lang, want] of Object.entries(cases)) {
    assert.deepEqual([
      dayRange(D(2026, 11, 16), D(2026, 11, 22), { now }, lang),
      dayRange(D(2026, 11, 30), D(2026, 12, 6), { now }, lang),
      dayRange(D(2026, 12, 28), D(2027, 1, 3), { now }, lang),
    ], want.map((s) => s.replace(/_/g, '\u00a0')), lang);
  }
});

test('fmtDate / fmtDay follow the active language', () => {
  const now = new Date(2026, 10, 18, 9);
  _setDictionary('de', { 'common.today': 'Heute', 'common.yesterday': 'Gestern' });
  _activate('de');
  try {
    assert.equal(fmtDate('2026-11-20', now), 'Fr. 20. Nov.');
    assert.equal(fmtDay('2026-11-18', now), 'Heute');
    assert.equal(fmtDay('2026-11-17', now), 'Gestern');
    assert.equal(fmtDay('2026-11-19', now), 'Tomorrow'); // missing in this test dictionary → English
  } finally {
    _setDictionary('de', null);
    _activate('en');
  }
  assert.equal(fmtDate('2026-11-20', now), 'Fri 20 Nov');
});

// ---------------------------------------------------------------- catalogues

test('namespace files: one per namespace in en; keys prefixed with their namespace', () => {
  for (const ns of NAMESPACES) {
    assert.ok(existsSync(join(I18N, 'en', `${ns}.js`)), `src/i18n/en/${ns}.js exists`);
    for (const key of Object.keys(EN_CATALOGUES[ns])) {
      assert.ok(key.startsWith(`${ns}.`), `en/${ns}.js: key "${key}" must start with "${ns}."`);
      assert.match(key, /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+(_(zero|one|two|few|many|other))?$/, `key "${key}": dot-separated camelCase`);
      assert.equal(typeof EN_CATALOGUES[ns][key], 'string', `${key}: text is a string`);
    }
  }
  for (const lang of LANGUAGE_CODES) {
    for (const f of readdirSync(join(I18N, lang))) {
      assert.ok(NAMESPACES.includes(f.replace(/\.js$/, '')), `src/i18n/${lang}/${f}: not a known namespace (add it to namespaces.js)`);
    }
  }
});

/** { base: { forms: Set<category>, placeholders: Set } } plural groups; plain keys under their own name. */
function groups(dict) {
  const out = new Map();
  for (const [key, text] of Object.entries(dict)) {
    const base = pluralBase(key);
    const id = base ?? key;
    const g = out.get(id) || { plural: !!base, forms: new Set(), ph: new Set() };
    if (base) g.forms.add(key.slice(base.length + 1));
    for (const p of placeholders(text)) g.ph.add(p);
    out.set(id, g);
  }
  return out;
}

for (const lang of LANGUAGE_CODES.filter((l) => l !== 'en')) {
  test(`catalogue consistency: ${lang} has the keys and placeholders of en`, async () => {
    const categories = new Intl.PluralRules(LOCALE_TAGS[lang]).resolvedOptions().pluralCategories;
    const problems = [];
    for (const ns of NAMESPACES) {
      const file = join(I18N, lang, `${ns}.js`);
      const pending = PENDING.includes(ns);
      if (!existsSync(file)) {
        if (!pending) problems.push(`src/i18n/${lang}/${ns}.js is missing (namespace "${ns}" is not in PENDING)`);
        continue;
      }
      const dict = (await import(pathToFileURL(file).href)).default;
      const en = groups(EN_CATALOGUES[ns]);
      const xx = groups(dict);
      for (const [id, g] of xx) {
        const e = en.get(id);
        if (!e) { problems.push(`${lang}/${ns}.js: "${id}" is not in en (stale key?)`); continue; }
        if (e.plural !== g.plural) problems.push(`${lang}/${ns}.js: "${id}" plural in one language only`);
        const a = [...e.ph].sort().join(','); const b = [...g.ph].sort().join(',');
        if (a !== b) problems.push(`${lang}/${ns}.js: "${id}" placeholders {${b}} ≠ en {${a}}`);
        if (g.plural) {
          for (const c of categories) if (!g.forms.has(c)) problems.push(`${lang}/${ns}.js: "${id}_${c}" missing (${lang} needs ${categories.join('/')})`);
          for (const c of g.forms) if (!categories.includes(c)) problems.push(`${lang}/${ns}.js: "${id}_${c}" is not a ${lang} plural form`);
        }
      }
      for (const [k, text] of Object.entries(dict)) if (typeof text !== 'string' || !text.trim()) problems.push(`${lang}/${ns}.js: "${k}" is empty`);
      if (!pending) for (const id of en.keys()) if (!xx.has(id)) problems.push(`${lang}/${ns}.js: "${id}" missing`);
    }
    assert.deepEqual(problems, []);
  });
}

test('en plural groups have the English forms one and other', () => {
  for (const ns of NAMESPACES) {
    for (const [id, g] of groups(EN_CATALOGUES[ns])) {
      if (g.plural) assert.deepEqual([...g.forms].sort(), ['one', 'other'], `en/${ns}.js: "${id}" needs _one and _other`);
    }
  }
});

test('PENDING lists only known namespaces (must be empty at release)', () => {
  for (const ns of PENDING) assert.ok(NAMESPACES.includes(ns), ns);
  assert.deepEqual(PENDING, [], 'every namespace is complete in de and zh');
});

// ---------------------------------------------------------------- converted files stay converted

/**
 * Files that must stay free of hard-coded user-facing strings (tools/i18n-scan.mjs): all of src/ (the scanner
 * skips catalogues, data files, icon/art markup and types.js). Legit literals carry `// i18n-ignore`.
 */
const CONVERTED = ['src'];

test('converted files have no hard-coded user-facing strings (tools/i18n-scan.mjs)', () => {
  const results = scan(CONVERTED);
  assert.ok(results.length > 100, `scanner saw ${results.length} files under src/`);
  const left = results.flatMap((r) => r.findings.map((f) => `${r.file}:${f.line} ${JSON.stringify(f.text)}`));
  assert.deepEqual(left, []);
});

test('i18n-scan finds typical hard-coded strings and skips code', () => {
  const src = [
    "import { el } from '../ui/index.js';",
    "el('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Close sheet' }, 'Save');",
    "toast(`Saved ${n} items`, { type: 'success' });",
    "const s = x === 'Enter' ? 'adaptive' : 'manual';",
    "console.warn('Something failed');",
    "el('span', 'kg');",
    "el('span', 'Deutsch'); // i18n-ignore",
    "el('p', t('settings.title'));",
    "const re = /Don't match 'this'/;",
    "label: 'Weekly set targets',",
  ].join('\n');
  const found = scanSource(src).map((f) => f.text);
  assert.deepEqual(found, ['Close sheet', 'Save', 'Saved {} items', 'Weekly set targets']);
});
