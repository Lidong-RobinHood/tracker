#!/usr/bin/env node
// Curated everyday foods (src/data/generic-foods-common.json): check, list and try out the search ranking.
//
// Usage (repo root):
//   node tools/food-common.mjs                    check the file (ids exist, no duplicates) and count per group
//   node tools/food-common.mjs list [group]       list the entries with tier and English / German / Chinese name
//   node tools/food-common.mjs search <en|de|zh> [--plain] [--n=5] <query> [<query> …]
//                                                 top results as the app ranks them (--plain: without tiers)
//   node tools/food-common.mjs bench              time a set of queries on the full three-language index

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodeGenericFoods, indexItem, search, commonFoodsFromFile, forLanguage, langNames } from '../src/core/food-search.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

/**
 * Load the data files and build the search index the way src/food/generic.js does (app language's name
 * first, then English, German, Chinese, ranked by language; aliases ranked the same way).
 * @param {'en'|'de'|'zh'} lang @param {{tiers?: boolean}} [opts]
 */
export function loadIndex(lang, { tiers = true } = {}) {
  const doc = readJson('src/data/generic-foods.json');
  const foods = decodeGenericFoods(doc);
  const ids = doc.foods.map((row) => row[0]);
  const de = readJson('src/data/generic-foods.de.json').names;
  const zh = readJson('src/data/generic-foods.zh.json').names;
  const common = tiers ? commonFoodsFromFile(readJson('src/data/generic-foods-common.json')) : new Map();
  const index = foods.map((f, i) => {
    f.fdcId = ids[i];
    f.names = { en: f.name, de: de[i], zh: zh[i] };
    return indexItem(f, langNames(lang, f.names), forLanguage(common.get(ids[i]), lang));
  });
  return { index, foods, ids, de, zh, common };
}

function check() {
  const doc = readJson('src/data/generic-foods-common.json');
  const base = readJson('src/data/generic-foods.json');
  const known = new Set(base.foods.map((row) => row[0]));
  const seen = new Map();
  const problems = [];
  let total = 0;
  const rows = [];
  for (const [group, entries] of Object.entries(doc.groups)) {
    let t1 = 0;
    let t2 = 0;
    for (const [id, tier] of Object.entries(entries)) {
      if (!known.has(Number(id))) problems.push(`${group}: ${id} is not in generic-foods.json`);
      if (seen.has(id)) problems.push(`${group}: ${id} also in ${seen.get(id)}`);
      seen.set(id, group);
      if (tier === 1) t1++; else if (tier === 2) t2++; else problems.push(`${group}: ${id} has tier ${tier}`);
    }
    total += t1 + t2;
    rows.push(`${group.padEnd(14)} ${String(t1 + t2).padStart(4)}  (tier 1: ${t1}, tier 2: ${t2})`);
  }
  for (const id of Object.keys(doc.aliases || {})) {
    if (!known.has(Number(id))) problems.push(`aliases: ${id} is not in generic-foods.json`);
  }
  console.log(rows.join('\n'));
  console.log(`${'total'.padEnd(14)} ${String(total).padStart(4)}; aliases for ${Object.keys(doc.aliases || {}).length} foods`);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
}

function list(group) {
  const doc = readJson('src/data/generic-foods-common.json');
  const base = readJson('src/data/generic-foods.json');
  const de = readJson('src/data/generic-foods.de.json').names;
  const zh = readJson('src/data/generic-foods.zh.json').names;
  const at = new Map(base.foods.map((row, i) => [row[0], i]));
  for (const [g, entries] of Object.entries(doc.groups)) {
    if (group && g !== group) continue;
    console.log(`== ${g}`);
    for (const [id, tier] of Object.entries(entries)) {
      const i = at.get(Number(id));
      console.log(`  ${id} T${tier}  ${i === undefined ? '??' : `${base.foods[i][1]} | ${de[i]} | ${zh[i]}`}`);
    }
  }
}

function searchCmd(args) {
  const lang = args.shift();
  const plain = args.includes('--plain');
  const n = Number((args.find((a) => a.startsWith('--n=')) || '--n=5').slice(4));
  const queries = args.filter((a) => !a.startsWith('--'));
  const { index } = loadIndex(lang, { tiers: !plain });
  const tierOf = new Map(index.map((e) => [e.item, e.tier]));
  for (const q of queries) {
    console.log(`== ${q}`);
    for (const f of search(q, index, { limit: n })) {
      const t = tierOf.get(f);
      console.log(`  ${f.fdcId} ${t ? `T${t}` : '  '} ${f.names[lang] || f.name}${lang === 'en' ? '' : `  [${f.name}]`}`);
    }
  }
}

function bench() {
  const { index } = loadIndex('zh');
  const queries = ['e', 'eg', 'egg', 'milk', 'chicken breast', 'hähnchenbrust', 'haferflocken', 'rind hack', 'kartoffel',
    '鸡', '鸡蛋', '鸡胸肉', '鸡腿肉', '金枪鱼罐头', '牛奶 全脂', 'xyzxyz', '火鸡腿'];
  let worst = 0;
  let sum = 0;
  for (const q of queries) {
    let best = Infinity;
    for (let k = 0; k < 5; k++) {
      const t = performance.now();
      search(q, index, { limit: 25 });
      best = Math.min(best, performance.now() - t);
    }
    sum += best;
    worst = Math.max(worst, best);
    console.log(`${q.padEnd(16)} ${best.toFixed(2)} ms`);
  }
  console.log(`mean ${(sum / queries.length).toFixed(2)} ms, slowest ${worst.toFixed(2)} ms`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'check') check();
  else if (cmd === 'list') list(args[0]);
  else if (cmd === 'search') searchCmd(args);
  else if (cmd === 'bench') bench();
  else { console.error(`unknown command ${cmd}`); process.exitCode = 2; }
}
