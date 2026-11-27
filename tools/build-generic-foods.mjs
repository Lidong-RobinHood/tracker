#!/usr/bin/env node
// Build src/data/generic-foods.json from two USDA FoodData Central downloads (public domain, CC0):
//   - "SR Legacy" (FoodData_Central_sr_legacy_food_json_2018-04.zip): basic foods, plus its generic fast-food
//     and restaurant dishes;
//   - "Survey (FNDDS)" (FoodData_Central_survey_food_json_2024-10-31.zip, FNDDS 2021-2023): prepared and mixed
//     dishes, sandwiches, pizza, soups, desserts, coffee drinks, cocktails ... selected by WWEIA food category.
//
// Usage:
//   1. Download both zips from https://fdc.nal.usda.gov/download-datasets/ (no API key needed) and unzip them.
//   2. node tools/build-generic-foods.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json \
//        path/to/surveyDownload.json [out.json]
//   LIST_DROPPED=file.txt  also writes every dropped food with the reason (brand, category, variant ...) for review.
//
// Output (compact, one array per food so the file stays small):
//   { source, dataset, version, licence, builtAt, fields: [...], foods: [[id, name, kcal, protein, carbs,
//     fat, sugars, satFat, fibre, salt, portions], ...] }
//   All nutrients per 100 g. salt = sodium (mg) × 2.5 / 1000. portions = [[label, grams], ...] (max 3).
// The app reads it with src/core/food-search.js (decodeGenericFoods).
//
// Order (stable ids AND stable positions: the names files generic-foods.<lang>.json are aligned by position):
//   1. SR Legacy foods outside the dropped categories, sorted by name (the file as it was until 2026-11-27),
//   2. SR Legacy "Fast Foods" and "Restaurant Foods" (generic ones only), sorted by name (added 2026-11-27),
//   3. FNDDS foods, sorted by name (added 2026-11-27).
// Ids are FDC ids. SR Legacy ids are 167512-175304 (6 digits), FNDDS 2021-2023 ids 2705383-2710814: the build
// stops if an id occurs twice.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [srPath, fnddsPath, outArg] = process.argv.slice(2);
if (!srPath || !fnddsPath) {
  console.error('Usage: node tools/build-generic-foods.mjs <FoodData_Central_sr_legacy_food_json_*.json> <surveyDownload.json (FNDDS)> [out.json]');
  process.exit(1);
}
const out = outArg || join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'generic-foods.json');

// ---------------------------------------------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------------------------------------------

// FDC nutrient ids (the same in SR Legacy and FNDDS)
const N = { kcal: 1008, kj: 1062, protein: 1003, fat: 1004, carbs: 1005, sugars: 2000, satFat: 1258, fibre: 1079, sodiumMg: 1093 };
const MAX_PORTIONS = 3;

const r1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** Brand names are written in capitals in SR Legacy and in parentheses in FNDDS, see brandToken / fnddsBrand. */
const KEEP_CAPS = new Set([
  'USDA', // "(Includes foods for USDA's Food Distribution Program)"
  'NFS', // "not further specified"
  'NS', // FNDDS "NS as to ..." (not specified)
  'NFSMI', // "NFSMI Recipe No. ..." (National Food Service Management Institute recipe reference)
  'UHT', // ultra-high temperature (not present in this release; kept for safety)
  'BBQ', // "Chicken, broiler, rotisserie, BBQ, ..."
]);
/**
 * A name is dropped when any word is all capitals (letters, digits, ' & . - !; a trailing 's is ignored) with at
 * least two capital letters in a row, unless it is an ordinary abbreviation in KEEP_CAPS, or when a word mixes a
 * lower-case letter with three capitals in a row ("McDONALD'S", "McNUGGETS": SR Legacy fast-food chain items).
 * @param {string} name @returns {string|null} the first capitalised brand-like word, or null
 */
function brandToken(name) {
  for (const raw of name.split(/[\s,()/;:"]+/)) {
    const w = raw.replace(/'s$/, '').replace(/[.!]+$/, '');
    if (/^[A-Z0-9'&.!\-]+$/.test(w) && /[A-Z]{2}/.test(w) && !KEEP_CAPS.has(w)) return w;
    if (/^Mc[A-Z]{2}|[a-z][A-Z]{3}/.test(w)) return w; // "McDONALD'S", "Egg McMUFFIN", "McCHICKEN"
  }
  return null;
}

/** [kcal, protein, carbs, fat, sugars, satFat, fibre, salt] per 100 g, or null without energy or macros. */
function nutrients(f) {
  const v = {};
  for (const n of f.foodNutrients || []) {
    if (n.amount === undefined || n.amount === null) continue;
    v[n.nutrient && n.nutrient.id] = n.amount;
  }
  let kcal = v[N.kcal];
  if (kcal === undefined && v[N.kj] !== undefined) kcal = v[N.kj] / 4.184;
  if (kcal === undefined || v[N.protein] === undefined || v[N.fat] === undefined || v[N.carbs] === undefined) return null;
  return [
    Math.round(kcal), r1(v[N.protein]), r1(v[N.carbs]), r1(v[N.fat]),
    r1(v[N.sugars]), r1(v[N.satFat]), r1(v[N.fibre]),
    v[N.sodiumMg] === undefined ? null : r2((v[N.sodiumMg] * 2.5) / 1000),
  ];
}

function fmtAmount(a) {
  if (!Number.isFinite(a)) return '1';
  return String(Math.round(a * 100) / 100);
}
const shorten = (label) => (label.length > 40 ? `${label.slice(0, 39).trim()}…` : label);

/** Up to MAX_PORTIONS distinct [label, grams], in the order of `ranked` (already sorted, labels may be ''). */
function pickPortions(ranked) {
  const portions = [];
  const seen = new Set();
  for (const [label, grams] of ranked) {
    if (!grams || grams <= 0 || !label || seen.has(label)) continue;
    seen.add(label);
    portions.push([label, r1(grams)]);
    if (portions.length >= MAX_PORTIONS) break;
  }
  return portions;
}

const dropped = []; // [reason, source, name]

// ---------------------------------------------------------------------------------------------------------------
// SR Legacy
// ---------------------------------------------------------------------------------------------------------------

// Categories that are baby food or very niche: dropped.
const SR_DROP_CATEGORIES = new Set(['Baby Foods', 'American Indian/Alaska Native Foods']);
// Fast-food and restaurant dishes: kept since 2026-11-27 (generic ones only: brand-name items are dropped by
// brandToken, e.g. "McDONALD'S, Big Mac"), appended after the rest so existing positions do not change.
const SR_EATING_OUT = new Set(['Fast Foods', 'Restaurant Foods']);

function srPortionLabel(p) {
  const unit = p.measureUnit && p.measureUnit.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
  const amount = p.amount ?? p.value ?? 1;
  // Drop parentheticals ('1 medium (7" to 7-7/8" long)' -> '1 medium') so chips stay short.
  const mod = (p.modifier || '').replace(/\([^)]*\)/g, '').replace(/\s+,/g, ',').trim().replace(/,$/, '');
  return shorten([fmtAmount(amount), unit, mod].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim());
}

function buildSr(list) {
  const base = [];
  const eatingOut = [];
  let pubDate = null;
  for (const f of list) {
    const cat = f.foodCategory && f.foodCategory.description;
    const name = String(f.description || '').trim();
    if (!name || SR_DROP_CATEGORIES.has(cat)) { dropped.push(['category', 'SR', name]); continue; }
    if (brandToken(name)) { dropped.push(['brand', 'SR', name]); continue; }
    const nut = nutrients(f);
    if (!nut) { dropped.push(['no macros', 'SR', name]); continue; }
    // Piece-like portions ('1 medium', '1 slice') first — most useful as chips — then cups/spoons.
    const rank = (p) => {
      const piece = !p.measureUnit || p.measureUnit.name === 'undetermined';
      return (piece ? 0 : 100) + (/\bmedium\b/.test(p.modifier || '') ? 0 : 10) + (p.sequenceNumber ?? 0) / 100;
    };
    const ranked = (f.foodPortions || []).slice().sort((a, b) => rank(a) - rank(b)).map((p) => [srPortionLabel(p), p.gramWeight]);
    if (f.publicationDate) pubDate = f.publicationDate;
    if (SR_EATING_OUT.has(cat) && /^School Lunch\b/i.test(name)) { dropped.push(['plain', 'SR', name]); continue; }
    (SR_EATING_OUT.has(cat) ? eatingOut : base).push([f.fdcId, name, ...nut, pickPortions(ranked)]);
  }
  return { base, eatingOut, pubDate };
}

// ---------------------------------------------------------------------------------------------------------------
// FNDDS (Survey foods)
// ---------------------------------------------------------------------------------------------------------------
//
// Selection by WWEIA food category (number from the food's attributes): prepared dishes and drinks that SR Legacy
// lacks. Plain single foods (meat cuts, fish, vegetables, fruit, rice, pasta, bread, milk, cheese, cereals, snacks,
// candy, soft drinks, condiments), baby food and formula, nutrition drinks/bars/powders and the "not in a category"
// ingredients are not taken. `true` = the whole category, a RegExp = only names matching it.
const FNDDS_CATEGORIES = new Map([
  // Dairy drinks
  [1402, true], // milk shakes, eggnog, ice cream soda
  [1204, /^Hot chocolate/], [1206, /^Hot chocolate/], [1208, /^Hot chocolate/],
  // Protein foods: only prepared forms (fried/coated chicken, wings, fried fish and seafood dishes)
  [2202, /coated|wing|rotisserie|with sauce/i],
  [2204, true], // chicken patties, nuggets, tenders
  [2402, /fried|coated|stick|smoked/i],
  [2404, /fried|scampi|cocktail|coated/i],
  [2502, true], // eggs and omelets (egg dishes; raw eggs are dropped below)
  // Mixed dishes
  [3002, true], [3004, true], [3006, true], // meat, poultry, seafood mixed dishes
  [3102, true], [3104, true], // bean and vegetable dishes
  [3202, true], [3204, true], [3206, true], [3208, true], // rice, pasta, mac and cheese, turnovers
  [3402, true], [3404, true], [3406, true], // fried rice / lo mein, stir-fry, egg rolls / dumplings / sushi
  [3502, true], [3504, true], [3506, true], // burritos, tacos, nachos, other Mexican
  [3602, true], // pizza
  [3702, true], [3703, true], [3704, true], [3706, true], [3720, true], [3722, true], // burgers, sandwiches
  [3730, true], [3740, true], [3742, true], [3744, true],
  [3804, true], [3806, true], [3808, true], // soups, ramen and Asian soups
  // Grain-based: breakfast and bakery dishes; from breads only the dish-like items
  [4202, /garlic bread|naan|chappatti|roti|puri|paratha|focaccia|dough, fried/i],
  [4204, /breadsticks|garlic/i],
  [4402, true], [4404, true], // biscuits, muffins, quick breads; pancakes, waffles, French toast
  // Sweets
  [5502, true], [5504, true], [5506, true], // cakes, pies, cookies, brownies, doughnuts, pastries
  [5802, true], [5804, true], [5806, true], // ice cream, pudding, gelatin, sorbet
  // Fruit and vegetable dishes
  [6018, /salad|ambrosia/i],
  [6410, /salad/i],
  [6430, true], [6432, true], // fried vegetables, coleslaw and other salads
  [6802, /, with /], // baked potato with toppings
  [6804, true], [6806, true], // french fries, mashed potatoes and potato dishes
  // Drinks
  [7220, true], // smoothies and grain drinks
  [7302, /latte|cappuccino|mocha|macchiato|frozen|iced|con leche|espresso|turkish|cuban|pre-lightened|pre-sweetened|bottled/i],
  [7304, /with milk|bubble|kombucha|iced, brewed|bottled|lemonade/i],
  [7506, true], // liquor and cocktails
  // Sauces and dips eaten as part of a meal (hummus, guacamole, queso, gravy, Alfredo)
  [8412, true],
]);

// Brand names in FNDDS are mostly in parentheses ("Whopper (Burger King)", "Big Mac (McDonalds)"); a parenthetical
// with a capitalised word drops the food. A few are in the name itself.
// Creamsicle and Fudgesicle are frozen-pop brands, "Seven and Seven" a cocktail named after Seagram's 7 and 7 Up
// (dropped 2026-11-27).
const FNDDS_BRAND_WORDS = /\b(Nesquik|Easy Mac|Hamburger Helper|Jagerbomb|Spaghettio|Lunchable|Bagel Bite|Weight Watchers|Hot Pocket|Nutella|Popsicle|Creamsicle|Fudgesicle|Seven and Seven|Spam|Frito)\b/i;
function fnddsBrand(name) {
  for (const m of name.matchAll(/\(([^)]*)\)/g)) if (/\b[A-Z][a-z]/.test(m[1]) || brandToken(m[1])) return m[1];
  const w = FNDDS_BRAND_WORDS.exec(name);
  return w ? w[1] : brandToken(name);
}

// Near-duplicates: variants nobody can tell apart on the plate. Their name segments are removed to build a
// variant key; of the foods sharing a key (in one category) only the most generic one is kept (variantRank).
const VARIANT_SEGMENT = new RegExp(`^(${[
  'ns as to fat( type)?', 'no added fat', 'no fat added', 'fat added', 'with fat added',
  'made with (margarine|oil|butter|animal fat or meat drippings|cooking spray|vegetable oil|lard|shortening|butter or margarine)',
  'cooked with (oil|butter or margarine|animal fat or meat drippings)',
  'decaffeinated', 'reduced sodium', 'from raw', 'from pre-?cooked', 'from frozen', 'from school lunch', 'school',
  'from other sources', 'other sources', 'on (white|wheat) (bread|bun)', 'ns as to type of bread',
].join('|')})$`, 'i');
const VARIANT_INLINE = [
  [/\b(fried|baked|cooked) (with|in) (margarine|oil|butter|animal fat or meat drippings|cooking spray)\b/gi, '$1'],
  [/\bfried,? no added fat\b/gi, 'fried'],
  [/\s+/g, ' '],
];
function variantKey(name) {
  let s = name;
  for (const [re, by] of VARIANT_INLINE) s = s.replace(re, by);
  return s.split(',').map((x) => x.trim()).filter((x) => x && !VARIANT_SEGMENT.test(x)).join(', ').toLowerCase();
}
/** Lower = more generic: NFS / "NS as to fat" first, then fat added, oil, white bread, ...; decaf and the like last. */
function variantRank(name) {
  const n = name.toLowerCase();
  let r = 0;
  if (/\bnfs\b|ns as to fat(?! type)/.test(n)) r += 0;
  else if (/fat added|ns as to fat type/.test(n)) r += 1;
  else if (/(made|cooked|fried) with oil/.test(n)) r += 2;
  else if (/no added fat|no fat added|fried no added fat/.test(n)) r += 3;
  else if (/butter|margarine/.test(n)) r += 4;
  else if (/animal fat|cooking spray|lard|shortening/.test(n)) r += 5;
  if (/on wheat (bread|bun)/.test(n)) r += 1;
  if (/from pre-?cooked|from frozen/.test(n)) r += 1;
  if (/school|other sources/.test(n)) r += 3;
  if (/decaffeinated|reduced sodium/.test(n)) r += 10;
  return r + name.length / 1000;
}

// Portion descriptions: "1 piece, NFS", '1 personal size pizza (5-7" diameter)', "1 cup", "Quantity not specified".
// Kept: a number followed by a short household measure, without brand words; piece-like first, then cups and
// spoons, then ounces.
function fnddsPortionLabel(p) {
  let s = String(p.portionDescription || '').trim();
  if (!/^\d/.test(s)) return ''; // "Quantity not specified", "Guideline amount ...", "Topping from 1 piece"
  s = s.replace(/\([^)]*\)/g, ' ').replace(/,\s*(NFS|any size|NS as to [a-z ]+)$/gi, '').replace(/,\s*(NFS|any size|NS as to size)\b/gi, '')
    .replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim().replace(/,$/, '');
  if (/\b(yields|per|surface inch|cubic inch|calorie package)\b/i.test(s)) return '';
  if (/\s[A-Z][a-z]/.test(s.replace(/\b(French|English|Italian|Mexican|Cuban)\b/g, ''))) return ''; // brand
  return shorten(s);
}
function fnddsPortionRank(label, p) {
  const l = label.toLowerCase();
  let r;
  if (/\b(cup|tablespoon|teaspoon|tbsp|tsp)\b/.test(l)) r = 100;
  else if (/\b(oz|fl oz|ml|gram|g)\b/.test(l)) r = 200;
  else r = p.gramWeight < 10 ? 150 : 0; // piece-like: slice, piece, sandwich, order, drink; tiny ones ("1 fry") after cups
  return r + (p.sequenceNumber ?? 0) / 100;
}

function wweiaNumber(f) {
  const a = (f.foodAttributes || []).find((x) => x.name === 'WWEIA Category number');
  return a ? Number(a.value) : null;
}

/**
 * Duplicates of SR Legacy foods: FNDDS copies many SR foods with the head word in the singular ("Cookie, fortune"
 * = "Cookies, fortune", "Ice cream, vanilla" = "Ice creams, vanilla"). Key: lower case, a trailing "s" removed from
 * every word, segments trimmed. An FNDDS food is a duplicate when an SR food has the same key and its kcal differ by
 * at most SAME_FOOD_KCAL (FNDDS took the SR values; "Cookie, oatmeal, with raisins" 450 vs 441 kcal). A different
 * food with the same name stays ("Potato pancake" 196 kcal, a different recipe from SR "Potato pancakes" 268 kcal).
 */
const SAME_FOOD_KCAL = 0.05;
const sameNameKey = (name) => name.toLowerCase().split(',').map((seg) => seg.trim().split(/\s+/).map((w) => w.replace(/s$/, '')).join(' ')).join(', ');

/**
 * @param {Set<string>} srExact lower-case SR Legacy names: an FNDDS food with exactly the same name is never added.
 * @param {Map<string, number[]>} srNames sameNameKey of each SR Legacy name -> its kcal values.
 */
function buildFndds(list, srExact, srNames) {
  const candidates = [];
  let pubDate = null;
  for (const f of list) {
    const name = String(f.description || '').trim();
    const cat = wweiaNumber(f);
    const rule = FNDDS_CATEGORIES.get(cat);
    if (!name || !rule || (rule instanceof RegExp && !rule.test(name))) { dropped.push(['category', 'FNDDS', `${cat} ${name}`]); continue; }
    // Raw single foods and recipe ingredients; school-cafeteria versions (not eaten by the app's adult users).
    if (/(^|, )raw(,|$)|as ingredient|for use (with|on)|\bschool\b/i.test(name)) { dropped.push(['plain', 'FNDDS', name]); continue; }
    const brand = fnddsBrand(name);
    if (brand) { dropped.push(['brand', 'FNDDS', name]); continue; }
    const nut = nutrients(f);
    if (!nut) { dropped.push(['no macros', 'FNDDS', name]); continue; }
    const srKcal = srNames.get(sameNameKey(name)) || [];
    if (srExact.has(name.toLowerCase()) || srKcal.some((k) => Math.abs(k - nut[0]) <= SAME_FOOD_KCAL * Math.max(k, nut[0]))) { dropped.push(['same name in SR', 'FNDDS', name]); continue; }
    const ranked = (f.foodPortions || [])
      .map((p) => [fnddsPortionLabel(p), p.gramWeight, p])
      .filter(([label]) => label)
      .sort((a, b) => fnddsPortionRank(a[0], a[2]) - fnddsPortionRank(b[0], b[2]));
    if (f.publicationDate) pubDate = f.publicationDate;
    candidates.push({ key: `${cat}|${variantKey(name)}`, rank: variantRank(name), row: [f.fdcId, name, ...nut, pickPortions(ranked)] });
  }
  const best = new Map();
  for (const c of candidates) {
    const b = best.get(c.key);
    if (!b || c.rank < b.rank || (c.rank === b.rank && c.row[0] < b.row[0])) best.set(c.key, c);
  }
  const kept = new Set([...best.values()]);
  for (const c of candidates) if (!kept.has(c)) dropped.push(['variant', 'FNDDS', `${c.row[1]}  =>  ${best.get(c.key).row[1]}`]);
  return { foods: [...kept].map((c) => c.row), pubDate };
}

// ---------------------------------------------------------------------------------------------------------------

const srRaw = JSON.parse(readFileSync(srPath, 'utf8'));
const srList = srRaw.SRLegacyFoods;
if (!Array.isArray(srList)) throw new Error(`${srPath}: no SRLegacyFoods array (is this the SR Legacy JSON?)`);
const fnRaw = JSON.parse(readFileSync(fnddsPath, 'utf8'));
const fnList = fnRaw.SurveyFoods;
if (!Array.isArray(fnList)) throw new Error(`${fnddsPath}: no SurveyFoods array (is this the FNDDS JSON?)`);

const byName = (a, b) => a[1].localeCompare(b[1]);
const sr = buildSr(srList);
const srNames = new Map();
for (const row of [...sr.base, ...sr.eatingOut]) {
  const key = sameNameKey(row[1]);
  srNames.set(key, [...(srNames.get(key) || []), row[2]]);
}
const fn = buildFndds(fnList, new Set([...sr.base, ...sr.eatingOut].map((row) => row[1].toLowerCase())), srNames);
sr.base.sort(byName);
sr.eatingOut.sort(byName);
fn.foods.sort(byName);
const foods = [...sr.base, ...sr.eatingOut, ...fn.foods];

const ids = new Set();
for (const row of foods) {
  if (ids.has(row[0])) throw new Error(`Duplicate fdcId ${row[0]} (${row[1]})`);
  ids.add(row[0]);
}

const doc = {
  source: 'USDA FoodData Central',
  dataset: 'SR Legacy; Survey (FNDDS)',
  version: 'SR Legacy April 2018 release (FoodData_Central_sr_legacy_food_json_2018-04); FNDDS 2021-2023 (FoodData_Central_survey_food_json_2024-10-31)',
  publicationDate: sr.pubDate,
  fnddsPublicationDate: fn.pubDate,
  licence: 'Public domain (CC0 1.0), U.S. Department of Agriculture, Agricultural Research Service',
  builtAt: new Date().toISOString().slice(0, 10),
  fields: ['fdcId', 'name', 'kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt', 'portions'],
  foods,
};
// One food per line: small diffs, still compact.
const text = `{${Object.entries(doc).filter(([k]) => k !== 'foods').map(([k, val]) => `${JSON.stringify(k)}:${JSON.stringify(val)}`).join(',')},\n"foods":[\n${foods.map((x) => JSON.stringify(x)).join(',\n')}\n]}\n`;
writeFileSync(out, text);
const count = (reason) => dropped.filter((d) => d[0] === reason).length;
console.log(`Wrote ${foods.length} foods to ${out}: ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
console.log(`  SR Legacy ${sr.base.length} + fast food / restaurant ${sr.eatingOut.length} + FNDDS ${fn.foods.length}`);
console.log(`  dropped: category ${count('category')}, brand ${count('brand')}, plain ${count('plain')}, variant ${count('variant')}, same name in SR ${count('same name in SR')}, no macros ${count('no macros')}`);
if (process.env.LIST_DROPPED) writeFileSync(process.env.LIST_DROPPED, `${dropped.map((d) => d.join('\t')).join('\n')}\n`);
