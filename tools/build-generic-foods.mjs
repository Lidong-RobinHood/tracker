#!/usr/bin/env node
// Build src/data/generic-foods.json from the USDA FoodData Central "SR Legacy" JSON download.
//
// Usage:
//   1. Download https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
//      (linked from https://fdc.nal.usda.gov/download-datasets/ — no API key needed) and unzip it.
//   2. node tools/build-generic-foods.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json
//
// Output (compact, one array per food so the file stays small):
//   { source, dataset, version, licence, builtAt, fields: [...], foods: [[id, name, kcal, protein, carbs,
//     fat, sugars, satFat, fibre, salt, portions], ...] }
//   All nutrients per 100 g. salt = sodium (mg) × 2.5 / 1000. portions = [[label, grams], ...] (max 3).
// The app reads it with src/core/food-search.js (decodeGenericFoods).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: node tools/build-generic-foods.mjs <FoodData_Central_sr_legacy_food_json_*.json>');
  process.exit(1);
}
const out = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'generic-foods.json');

// Categories that are branded, restaurant-style, baby food or very niche: dropped to keep the file lean.
const DROP_CATEGORIES = new Set([
  'Baby Foods', 'Fast Foods', 'Restaurant Foods', 'American Indian/Alaska Native Foods',
]);
// Brand-name items in SR Legacy start with an all-caps word ("KELLOGG'S, ...", "HORMEL ...").
const BRANDED = /^[A-Z][A-Z'&.\-]{2,}(\s|,|$)/;

// FDC nutrient ids
const N = { kcal: 1008, kj: 1062, protein: 1003, fat: 1004, carbs: 1005, sugars: 2000, satFat: 1258, fibre: 1079, sodiumMg: 1093 };
const MAX_PORTIONS = 3;

const r1 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

function portionLabel(p) {
  const unit = p.measureUnit && p.measureUnit.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
  const amount = p.amount ?? p.value ?? 1;
  // Drop parentheticals ('1 medium (7" to 7-7/8" long)' -> '1 medium') so chips stay short.
  const mod = (p.modifier || '').replace(/\([^)]*\)/g, '').replace(/\s+,/g, ',').trim().replace(/,$/, '');
  let label = [fmtAmount(amount), unit, mod].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (label.length > 40) label = `${label.slice(0, 39).trim()}…`;
  return label;
}
function fmtAmount(a) {
  if (!Number.isFinite(a)) return '1';
  return String(Math.round(a * 100) / 100);
}

const raw = JSON.parse(readFileSync(input, 'utf8'));
const list = raw.SRLegacyFoods || raw.FoundationFoods;
if (!Array.isArray(list)) throw new Error('Unexpected file: no SRLegacyFoods / FoundationFoods array');

let dropped = 0;
const foods = [];
let pubDate = null;
for (const f of list) {
  const cat = f.foodCategory && f.foodCategory.description;
  const name = String(f.description || '').trim();
  if (!name || DROP_CATEGORIES.has(cat) || BRANDED.test(name)) { dropped++; continue; }
  const v = {};
  for (const n of f.foodNutrients || []) {
    if (n.amount === undefined || n.amount === null) continue;
    v[n.nutrient && n.nutrient.id] = n.amount;
  }
  let kcal = v[N.kcal];
  if (kcal === undefined && v[N.kj] !== undefined) kcal = v[N.kj] / 4.184;
  if (kcal === undefined || v[N.protein] === undefined || v[N.fat] === undefined || v[N.carbs] === undefined) { dropped++; continue; }
  const portions = [];
  const seen = new Set();
  // Piece-like portions ('1 medium', '1 slice') first — most useful as chips — then cups/spoons.
  const rank = (p) => {
    const piece = !p.measureUnit || p.measureUnit.name === 'undetermined';
    return (piece ? 0 : 100) + (/\bmedium\b/.test(p.modifier || '') ? 0 : 10) + (p.sequenceNumber ?? 0) / 100;
  };
  for (const p of (f.foodPortions || []).slice().sort((a, b) => rank(a) - rank(b))) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const label = portionLabel(p);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    portions.push([label, r1(p.gramWeight)]);
    if (portions.length >= MAX_PORTIONS) break;
  }
  if (f.publicationDate) pubDate = f.publicationDate;
  foods.push([
    f.fdcId, name,
    Math.round(kcal), r1(v[N.protein]), r1(v[N.carbs]), r1(v[N.fat]),
    r1(v[N.sugars]), r1(v[N.satFat]), r1(v[N.fibre]),
    v[N.sodiumMg] === undefined ? null : r2((v[N.sodiumMg] * 2.5) / 1000),
    portions,
  ]);
}
foods.sort((a, b) => a[1].localeCompare(b[1]));

const doc = {
  source: 'USDA FoodData Central',
  dataset: 'SR Legacy',
  version: 'April 2018 release (FoodData_Central_sr_legacy_food_json_2018-04)',
  publicationDate: pubDate,
  licence: 'Public domain (CC0 1.0), U.S. Department of Agriculture, Agricultural Research Service',
  builtAt: new Date().toISOString().slice(0, 10),
  fields: ['fdcId', 'name', 'kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt', 'portions'],
  foods,
};
// One food per line: small diffs, still compact.
const text = `{${Object.entries(doc).filter(([k]) => k !== 'foods').map(([k, val]) => `${JSON.stringify(k)}:${JSON.stringify(val)}`).join(',')},\n"foods":[\n${foods.map((x) => JSON.stringify(x)).join(',\n')}\n]}\n`;
writeFileSync(out, text);
console.log(`Wrote ${foods.length} foods (${dropped} dropped) to ${out}: ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
