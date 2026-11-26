#!/usr/bin/env node
// Translated names for the bundled generic foods (src/data/generic-foods.json).
//
// USDA names are comma-separated segments ("Beef, chuck, arm pot roast, separable lean only, ...") and
// heavily templated, so we translate each unique SEGMENT once and compose the names from them.
//
// Usage (repo root):
//   node tools/build-food-names.mjs extract             -> tools/food-names/segments.en.json
//   node tools/build-food-names.mjs compose <lang>      -> src/data/generic-foods.<lang>.json
//   node tools/build-food-names.mjs compose <lang> --strict   (exit 1 if any segment is untranslated)
//   node tools/build-food-names.mjs missing <lang>      -> list untranslated segments (with counts)
//
// Inputs:
//   tools/food-names/<lang>.json            { "<english segment>": "<translation>",
//                                             "<first segment>|<segment>": "<translation in that group>" }
//                                           a translation of "-" drops the segment (use sparingly).
//   tools/food-names/overrides.<lang>.json  { "<fdcId>": "<full translated name>" }  (optional)
// tests/food-names.test.js fails when a composed file is stale or misaligned, and (for COMPLETE_LANGS)
// when a segment has no translation.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { foodIdsHash } from '../src/core/food-search.js';
import { nameHash } from '../src/core/food-names.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const NAMES_DIR = join(ROOT, 'tools', 'food-names');
export const BASE_FILE = join(ROOT, 'src', 'data', 'generic-foods.json');
/** English names that compose to the same translated name (information lost in translation). */
export function collisions(base, names) {
  const en = baseNames(base).names;
  const seen = new Map();
  const out = [];
  names.forEach((n, i) => {
    const j = seen.get(n);
    if (j === undefined) seen.set(n, i);
    else if (en[j] !== en[i]) out.push([n, en[j], en[i]]);
  });
  return out;
}

/** Languages whose segment dictionary must cover every segment (checked by tests/food-names.test.js). */
export const COMPLETE_LANGS = ['de', 'zh'];
export const SOURCE_NOTE = 'Translated from USDA FoodData Central names';

/**
 * Split a USDA name into trimmed segments at top-level commas. Commas inside parentheses stay
 * ("all (gin, rum, vodka, whiskey) 100 proof" is one segment). `"` in the data means inches, not quotes.
 * @param {string} name @returns {string[]}
 */
export function splitSegments(name) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(name)) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter((s) => s !== '');
}

/** @param {{fields: string[], foods: any[][]}} base @returns {{ids: number[], names: string[]}} */
export function baseNames(base) {
  const iId = base.fields.indexOf('fdcId');
  const iName = base.fields.indexOf('name');
  return { ids: base.foods.map((r) => r[iId]), names: base.foods.map((r) => String(r[iName])) };
}

/** Unique segments with counts and up to two example names, most frequent first. */
export function extractSegments(base) {
  const { names } = baseNames(base);
  const map = new Map();
  for (const name of names) {
    for (const seg of splitSegments(name)) {
      let e = map.get(seg);
      if (!e) map.set(seg, e = { segment: seg, count: 0, examples: [] });
      e.count++;
      if (e.examples.length < 2 && !e.examples.includes(name)) e.examples.push(name);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment));
}

const capFirst = (s) => s.charAt(0).toLocaleUpperCase('de') + s.slice(1);

/**
 * Compose translated names in base order.
 * @param {object} base generic-foods.json
 * @param {Record<string,string>} dict segment translations
 * @param {Record<string,string>} [overrides] fdcId -> full name
 * @param {string} lang
 * @returns {{doc: object, missing: Map<string, number>, overridden: number}}
 */
export function composeNames(base, dict, overrides = {}, lang) {
  const { ids, names } = baseNames(base);
  const missing = new Map();
  let overridden = 0;
  const out = names.map((name, i) => {
    const o = overrides[String(ids[i])];
    if (o) { overridden++; return o; }
    const segs = splitSegments(name);
    const parts = segs.map((seg, j) => {
      // "<first segment>|<segment>" wins over "<segment>": the same English word can need a different
      // translation per food group ("Nuts|roasted" -> geröstet, "roasted" -> gebraten).
      const t = (j > 0 ? dict[`${segs[0]}|${seg}`] : undefined) ?? dict[seg];
      if (typeof t === 'string' && t.trim()) return t.trim();
      missing.set(seg, (missing.get(seg) || 0) + 1);
      return seg;
    }).filter((p) => p !== '-'); // "-" = segment intentionally dropped (e.g. merged into the previous one)
    // German: a list continued in the next segment ("…, Calcium, und Kalium") takes no comma before und/oder.
    const joined = parts.reduce((acc, p) => (!acc ? p : lang === 'de' && /^(und|oder) /.test(p) ? `${acc} ${p}` : `${acc}, ${p}`), '');
    return lang === 'zh' ? joined.replace(/, /g, '，') : capFirst(joined);
  });
  return {
    // ids + en (hashes of the English names) make the file self-contained: the app shows stored generic
    // foods translated without loading generic-foods.json (src/core/food-names.js namesFromFile).
    doc: { lang, source: SOURCE_NOTE, builtAt: null, count: ids.length, idsHash: foodIdsHash(ids), ids, en: names.map(nameHash), names: out },
    missing,
    overridden,
  };
}

const readJson = (p, fallback) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback);
export const dictFile = (lang) => join(NAMES_DIR, `${lang}.json`);
export const overridesFile = (lang) => join(NAMES_DIR, `overrides.${lang}.json`);
export const outFile = (lang) => join(ROOT, 'src', 'data', `generic-foods.${lang}.json`);
export const loadBase = () => JSON.parse(readFileSync(BASE_FILE, 'utf8'));
export const loadDict = (lang) => readJson(dictFile(lang), {});
export const loadOverrides = (lang) => readJson(overridesFile(lang), {});

function main(argv) {
  const [cmd, lang] = argv;
  const strict = argv.includes('--strict');
  const base = loadBase();
  if (cmd === 'extract') {
    const segs = extractSegments(base);
    const p = join(NAMES_DIR, 'segments.en.json');
    writeFileSync(p, `${JSON.stringify(segs, null, 1)}\n`);
    console.log(`${segs.length} unique segments, ${segs.reduce((n, s) => n + s.segment.length, 0)} characters -> ${p}`);
    return 0;
  }
  if ((cmd === 'compose' || cmd === 'missing') && /^[a-z]{2}(-[A-Za-z]+)?$/.test(lang || '')) {
    const { doc, missing, overridden } = composeNames(base, loadDict(lang), loadOverrides(lang), lang);
    const list = [...missing].sort((a, b) => b[1] - a[1]);
    if (cmd === 'missing') {
      for (const [seg, n] of list) console.log(`${n}\t${seg}`);
      console.error(`${list.length} untranslated segments`);
      return 0;
    }
    doc.builtAt = new Date().toISOString().slice(0, 10);
    writeFileSync(outFile(lang), `${JSON.stringify(doc)}\n`);
    console.log(`${doc.names.length} names -> ${outFile(lang)} (${overridden} overrides)`);
    const dup = collisions(base, doc.names);
    if (dup.length) {
      console.warn(`${dup.length} translated names are shared by different English names:`);
      for (const [n, a, b] of dup.slice(0, 40)) console.warn(`  ${n}\n    <- ${a}\n    <- ${b}`);
    }
    if (list.length) {
      console.warn(`${list.length} segments without translation (kept in English):`);
      for (const [seg, n] of list.slice(0, 50)) console.warn(`  ${n}\t${seg}`);
      if (list.length > 50) console.warn(`  … ${list.length - 50} more (run: missing ${lang})`);
      if (strict) return 1;
    }
    return 0;
  }
  console.error('Usage: node tools/build-food-names.mjs extract | compose <lang> [--strict] | missing <lang>');
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
