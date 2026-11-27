#!/usr/bin/env node
// Prepared dishes (src/data/dishes.json): own per-100 g estimates computed from recipes of USDA ingredients.
//
// Usage (repo root):
//   node tools/build-dishes.mjs            validate every tools/dishes/recipes.*.json and write src/data/dishes.json
//   node tools/build-dishes.mjs --check    validate and compare with src/data/dishes.json, write nothing
//                                          (exit 1 on any error or when the file is out of date)
//   node tools/build-dishes.mjs --list [kitchen|id-substring]
//                                          id, kitchen, kcal/100 g, kcal per normal portion, names
//
// Recipe format: see src/data/dishes.README.md. Ingredients are FDC ids from src/data/generic-foods.json.
// Errors are reported per recipe file. A dish with an error is left out, a file that does not parse is left out
// as a whole, the other files are still built; the exit code is 1 whenever anything was left out.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RECIPES_DIR = join(ROOT, 'tools', 'dishes');
export const FOODS_FILE = join(ROOT, 'src', 'data', 'generic-foods.json');
export const OUT_FILE = join(ROOT, 'src', 'data', 'dishes.json');

export const SOURCE = 'Own estimates from recipes of USDA FoodData Central ingredients';
export const KITCHENS = ['german', 'european', 'fastfood', 'chinese', 'asian'];
export const LANGS = ['en', 'de', 'zh'];
/** Nutrient columns, in the order of generic-foods.json (after fdcId and name). */
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt'];
export const FIELDS = ['id', 'kitchen', 'names', 'aliases', ...NUTRIENTS, 'portions'];
const DECIMALS = { kcal: 0, protein: 1, carbs: 1, fat: 1, sugars: 1, satFat: 1, fibre: 1, salt: 2 };

/** A nutrient is null when ingredients without a value for it make up more than this share of the dish. */
export const MISSING_SHARE = 0.1;
/** kcal per 100 g outside this range is an error unless the recipe has "allowHigh": true (upper bound only). */
export const KCAL_MIN = 20;
export const KCAL_MAX = 600;
/** cookedWeight / sum of ingredient weights must lie in this range (water lost in cooking, never gained:
 *  absorbed water or broth is listed as an ingredient). */
export const COOKED_RATIO_MIN = 0.4;
export const COOKED_RATIO_MAX = 1.1;

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const round = (v, d) => { const f = 10 ** d; return Math.round(v * f) / f; };

/** fdcId → { name, values: {kcal, …} } from generic-foods.json. */
export function loadFoods(file = FOODS_FILE) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const col = Object.fromEntries(doc.fields.map((f, i) => [f, i]));
  const foods = new Map();
  for (const row of doc.foods) {
    foods.set(row[col.fdcId], { name: row[col.name], values: Object.fromEntries(NUTRIENTS.map((n) => [n, row[col[n]]])) });
  }
  return foods;
}

/** The recipe files present, sorted by name: [{ name, path }]. */
export function recipeFiles(dir = RECIPES_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^recipes\.[a-z0-9-]+\.json$/.test(f)).sort()
    .map((name) => ({ name, path: join(dir, name) }));
}

/**
 * Per-100 g values of one recipe. A nutrient is null when ingredients lacking it weigh more than MISSING_SHARE
 * of the ingredient total; smaller gaps count as 0.
 * @returns {{ values: Record<string, number|null>, rawSum: number }}
 */
export function computeValues(recipe, foods) {
  const totals = Object.fromEntries(NUTRIENTS.map((n) => [n, 0]));
  const missing = Object.fromEntries(NUTRIENTS.map((n) => [n, 0]));
  let rawSum = 0;
  for (const [id, grams] of recipe.ingredients) {
    const food = foods.get(id);
    rawSum += grams;
    for (const n of NUTRIENTS) {
      const v = food.values[n];
      if (v == null) missing[n] += grams; else totals[n] += (v * grams) / 100;
    }
  }
  const values = {};
  for (const n of NUTRIENTS) {
    values[n] = missing[n] > MISSING_SHARE * rawSum ? null : round((totals[n] / recipe.cookedWeight) * 100, DECIMALS[n]);
  }
  return { values, rawSum };
}

function isStringList(v) { return Array.isArray(v) && v.every((s) => typeof s === 'string' && s.trim() !== ''); }

/** Errors of one recipe (empty array = valid). Does not check id uniqueness (done across files). */
export function validateRecipe(r, foods) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['not an object'];
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) errs.push(`bad id ${JSON.stringify(r.id)}`);
  if (!KITCHENS.includes(r.kitchen)) errs.push(`bad kitchen ${JSON.stringify(r.kitchen)} (${KITCHENS.join(' | ')})`);
  for (const l of LANGS) {
    if (typeof r.names?.[l] !== 'string' || !r.names[l].trim()) errs.push(`missing names.${l}`);
  }
  if (r.aliases !== undefined) {
    if (!r.aliases || typeof r.aliases !== 'object' || Array.isArray(r.aliases)) errs.push('aliases must be an object');
    else for (const [l, list] of Object.entries(r.aliases)) {
      if (!LANGS.includes(l)) errs.push(`aliases: unknown language ${l}`);
      else if (!isStringList(list)) errs.push(`aliases.${l} must be a list of non-empty strings`);
    }
  }
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) errs.push('no ingredients');
  else r.ingredients.forEach((ing, i) => {
    if (!Array.isArray(ing) || ing.length < 2 || ing.length > 3) { errs.push(`ingredient ${i + 1}: expected [fdcId, grams, "note"]`); return; }
    const [id, grams, note] = ing;
    if (!Number.isInteger(id) || !foods.has(id)) errs.push(`ingredient ${i + 1}: unknown fdcId ${JSON.stringify(id)}`);
    if (typeof grams !== 'number' || !(grams > 0)) errs.push(`ingredient ${i + 1}: grams must be > 0`);
    if (note !== undefined && typeof note !== 'string') errs.push(`ingredient ${i + 1}: note must be a string`);
  });
  if (typeof r.cookedWeight !== 'number' || !(r.cookedWeight > 0)) errs.push('cookedWeight must be > 0');
  const p = r.portions;
  if (!p || ![p.small, p.normal, p.large].every((g) => typeof g === 'number' && g > 0)) errs.push('portions need small, normal, large > 0');
  else if (!(p.small < p.normal && p.normal < p.large)) errs.push(`portions not ascending (${p.small} / ${p.normal} / ${p.large})`);
  if (r.allowHigh !== undefined && typeof r.allowHigh !== 'boolean') errs.push('allowHigh must be true or false');
  if (errs.length) return errs;

  const { values, rawSum } = computeValues(r, foods);
  const ratio = r.cookedWeight / rawSum;
  if (ratio < COOKED_RATIO_MIN || ratio > COOKED_RATIO_MAX) {
    errs.push(`cookedWeight ${r.cookedWeight} g implausible for ${round(rawSum, 0)} g of ingredients (ratio ${round(ratio, 2)}, allowed ${COOKED_RATIO_MIN}–${COOKED_RATIO_MAX})`);
  }
  if (values.kcal < KCAL_MIN || (values.kcal > KCAL_MAX && !r.allowHigh)) {
    errs.push(`${values.kcal} kcal/100 g outside ${KCAL_MIN}–${KCAL_MAX}${values.kcal > KCAL_MAX ? ' (set "allowHigh": true if intended)' : ''}`);
  }
  return errs;
}

/**
 * Read and validate every recipe file and compute the dishes.
 * @returns {{ dishes: object[], errors: {file: string, messages: string[]}[], perFile: {file: string, count: number}[] }}
 *   dishes sorted by id; each { id, kitchen, names, aliases, values, portions, file }
 */
export function buildDishes({ dir = RECIPES_DIR, foodsFile = FOODS_FILE } = {}) {
  const foods = loadFoods(foodsFile);
  const errors = [];
  const perFile = [];
  const seen = new Map();
  const dishes = [];
  for (const { name, path } of recipeFiles(dir)) {
    const messages = [];
    let doc;
    try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
      errors.push({ file: name, messages: [`cannot read: ${e.message}`] });
      perFile.push({ file: name, count: 0 });
      continue;
    }
    if (!doc || !Array.isArray(doc.dishes)) {
      errors.push({ file: name, messages: ['expected { "dishes": [ … ] }'] });
      perFile.push({ file: name, count: 0 });
      continue;
    }
    let count = 0;
    doc.dishes.forEach((r, i) => {
      const label = typeof r?.id === 'string' ? r.id : `#${i + 1}`;
      const errs = validateRecipe(r, foods);
      if (!errs.length && seen.has(r.id)) errs.push(`duplicate id (also in ${seen.get(r.id)})`);
      if (errs.length) { for (const e of errs) messages.push(`${label}: ${e}`); return; }
      seen.set(r.id, name);
      const { values } = computeValues(r, foods);
      dishes.push({
        id: r.id, kitchen: r.kitchen,
        names: Object.fromEntries(LANGS.map((l) => [l, r.names[l].trim()])),
        aliases: Object.fromEntries(LANGS.filter((l) => r.aliases?.[l]?.length).map((l) => [l, r.aliases[l].map((s) => s.trim())])),
        values, portions: [r.portions.small, r.portions.normal, r.portions.large], file: name,
      });
      count++;
    });
    if (messages.length) errors.push({ file: name, messages });
    perFile.push({ file: name, count });
  }
  dishes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { dishes, errors, perFile };
}

/** Compact row: [id, kitchen, names, aliases, kcal, protein, carbs, fat, sugars, satFat, fibre, salt, [small, normal, large]]. */
export function dishRow(d) {
  return [d.id, d.kitchen, d.names, d.aliases, ...NUTRIENTS.map((n) => d.values[n]), d.portions];
}

/** The text of src/data/dishes.json (one dish per line, like generic-foods.json). */
export function serialize(dishes, builtAt) {
  const head = { source: SOURCE, note: 'Estimates per 100 g of the finished dish; portions in g (small, normal, large) as typically served', builtAt, count: dishes.length, fields: FIELDS };
  const h = JSON.stringify(head);
  return `${h.slice(0, -1)},\n"dishes":[\n${dishes.map((d) => JSON.stringify(dishRow(d))).join(',\n')}\n]}\n`;
}

function printErrors(errors) {
  for (const { file, messages } of errors) {
    console.error(`${file}: ${messages.length} error(s)`);
    for (const m of messages) console.error(`  ${m}`);
  }
}

function list(dishes, filter) {
  const KO = Object.fromEntries(KITCHENS.map((k, i) => [k, i]));
  const rows = dishes
    .filter((d) => !filter || d.kitchen === filter || d.id.includes(filter))
    .sort((a, b) => KO[a.kitchen] - KO[b.kitchen] || (a.id < b.id ? -1 : 1));
  const pad = (s, n) => String(s).padEnd(n);
  const lpad = (s, n) => String(s).padStart(n);
  console.log(`${pad('id', 34)}${pad('kitchen', 10)}${lpad('kcal/100g', 10)}${lpad('kcal/normal', 16)}  names (en | de | zh)`);
  for (const d of rows) {
    const k = d.values.kcal;
    console.log(`${pad(d.id, 34)}${pad(d.kitchen, 10)}${lpad(k, 10)}${lpad(`${Math.round((k * d.portions[1]) / 100)} (${d.portions[1]} g)`, 16)}  ${d.names.en} | ${d.names.de} | ${d.names.zh}`);
  }
  console.log(`${rows.length} dishes`);
}

function main(argv) {
  const mode = argv.includes('--check') ? 'check' : argv.includes('--list') ? 'list' : 'build';
  const { dishes, errors, perFile } = buildDishes();
  if (!perFile.length) console.error(`no recipe files in ${RECIPES_DIR}`);
  printErrors(errors);
  const failed = errors.length > 0 || !perFile.length;

  if (mode === 'list') {
    list(dishes, argv[argv.indexOf('--list') + 1]);
    return failed ? 1 : 0;
  }
  const summary = perFile.map((f) => `${f.file}: ${f.count}`).join(', ');
  if (mode === 'check') {
    let stale = true;
    if (existsSync(OUT_FILE)) {
      const current = readFileSync(OUT_FILE, 'utf8');
      const builtAt = JSON.parse(current).builtAt;
      stale = current !== serialize(dishes, builtAt);
    }
    if (stale) console.error(`${OUT_FILE} is out of date: run node tools/build-dishes.mjs`);
    console.log(`${dishes.length} dishes valid (${summary})${failed || stale ? ' — check FAILED' : ''}`);
    return failed || stale ? 1 : 0;
  }
  const text = serialize(dishes, new Date().toISOString().slice(0, 10));
  writeFileSync(OUT_FILE, text);
  console.log(`wrote ${OUT_FILE}: ${dishes.length} dishes (${summary}), ${Buffer.byteLength(text).toLocaleString('en')} bytes`);
  if (failed) console.error('some dishes or files were left out because of errors (see above)');
  return failed ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
