# generic-foods.json

Bundled generic foods for the food search (loaded lazily on first search, never at app start).

| | |
|---|---|
| Source | USDA FoodData Central, **SR Legacy** dataset (Agricultural Research Service, U.S. Department of Agriculture) |
| File used | `FoodData_Central_sr_legacy_food_json_2018-04.zip` from https://fdc.nal.usda.gov/download-datasets/ (no API key) |
| Version | SR Legacy, April 2018 release (records carry publication date 2019-04-01); downloaded 2026-11-18, rebuilt 2026-11-19 |
| Licence | Public domain — CC0 1.0 Universal (FoodData Central data are in the public domain; citation requested: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.") |
| Foods | 6,272 (of 7,793; dropped: Baby Foods, Fast Foods, Restaurant Foods, American Indian/Alaska Native Foods categories, foods without energy or macros, and 590 brand-name items, see below) |
| Size | about 813 KB raw, about 175 KB gzipped |

## Format

```
{ source, dataset, version, publicationDate, licence, builtAt,
  fields: ["fdcId","name","kcal","protein","carbs","fat","sugars","satFat","fibre","salt","portions"],
  foods: [ [fdcId, name, kcal, protein, carbs, fat, sugars, satFat, fibre, salt, [[label, grams], ...]], ... ] }
```

- All values per 100 g. kcal = FDC nutrient 1008 (kJ ÷ 4.184 as fallback). Protein 1003, fat 1004,
  carbohydrate by difference 1005, total sugars 2000, saturated fat 1258, fibre 1079.
- salt (g) = sodium (FDC 1093, mg) × 2.5 / 1000.
- `null` = not reported. Up to three household portions with gram weights; piece-like portions
  ("1 medium", "1 slice") first; parenthetical size notes removed from labels.
- Decoded by `decodeGenericFoods()` in `src/core/food-search.js` into foods with `source: 'usda'`,
  `sourceKey: 'usda:<fdcId>'`.

## Brand names

SR Legacy writes brand names in capitals, at the start or anywhere in the description
("Yogurt, Greek, nonfat, vanilla, CHOBANI", "Alcoholic beverage, beer, light, BUD LIGHT"). The build drops
every food whose name contains a word in capitals with at least two capital letters in a row (a trailing
's is ignored), except the ordinary abbreviations USDA, NFS, NFSMI (a recipe reference), UHT and BBQ.
Until 2026-11-18 only names that started with such a word were dropped; the rebuild of 2026-11-19 removed
518 more foods (6,790 → 6,272). Brand names written in mixed case (e.g. "Archway Home Style Cookies",
"Nabisco, ...") are not detected and remain.

## Rebuild

```
node tools/build-generic-foods.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json
```

Set `LIST_DROPPED=path/to/file.txt` to also write the dropped brand-name foods to a file for review.

## Translated names (German, Chinese)

`generic-foods.<lang>.json` (e.g. `generic-foods.de.json`) holds the food names in another language, in exactly
the order of `foods` above. It is loaded only when that language is used: for display only when a generic food is
on screen (without this file), for search together with this file.

```
{ lang, source: "Translated from USDA FoodData Central names", builtAt, count, idsHash,
  ids: [fdcId, …], en: ["<nameHash of the English name>", …], names: ["…", …] }
```

`ids` and `en` (FNV-1a hash of each English name in base 36, `nameHash()` in `src/core/food-names.js`) make the
file self-contained: a stored food is shown translated when its sourceKey is listed and its stored name still
hashes to the English one (not renamed). `count` and `idsHash` (FNV-1a of the fdcId list, `foodIdsHash()` in
`src/core/food-search.js`) detect a broken file and, once this file is loaded for search, a names file that no
longer matches it; the app then falls back to the English names.

USDA names are comma-separated segments and heavily templated (6,272 names, 3,652 unique segments), so segments
are translated once and the names are composed from them (`tools/build-food-names.mjs`):

```
node tools/build-food-names.mjs extract              # tools/food-names/segments.en.json: segments, counts, examples
# translate: tools/food-names/<lang>.json  { "<segment>": "…", "<first segment>|<segment>": "…" }
#            tools/food-names/overrides.<lang>.json  { "<fdcId>": "full name" }  (optional)
node tools/build-food-names.mjs missing <lang>       # untranslated segments
node tools/build-food-names.mjs compose <lang> [--strict]   # writes src/data/generic-foods.<lang>.json
```

Segments without a translation stay English (`--strict` exits non-zero). Rebuilding `generic-foods.json` requires
`extract` + translating new segments + `compose` for every language. `tests/food-names.test.js` fails when a
composed file is stale or misaligned, or (for `COMPLETE_LANGS` in the tool) has untranslated segments.
Translation decisions: `tools/food-names/GLOSSARY.de.md`, `tools/food-names/GLOSSARY.zh.md`.
German: complete (machine-assisted translation, spot-checked; US-specific meat cuts are kept in English or given
with the US name in parentheses).
Chinese (Simplified): complete (machine-assisted translation, spot-checked; mainland vocabulary, segments in the
USDA order joined by "，", food-group heads use the word people type; brand names stay in Latin script unless an
official Chinese name is widely used).

## Common foods (search ranking)

`generic-foods-common.json` lists the everyday foods a person tracking meals most likely means by a short query
("egg", "Milch", "米饭"), so search ranks them above odd variants that match the words just as well
("Egg substitute", "Milch-Getreide-Riegel", "调味黄米饭"). Curated by hand from this file (545 foods, 2026-11-26):
the plain generic form over brand, restaurant, baby-food or ration variants, the standard variety over exotic
ones, raw plus the usual cooked form.

```
{ about,
  groups:  { "<group>": { "<fdcId>": tier, … }, … },    // tier 1 = everyday staple, 2 = common
  aliases: { "<fdcId>": { "en": ["…"], "de": ["…"], "zh": ["…"] }, … } }   // by language
```

- Groups (eggs, dairy, poultry, meat, fish, grains, bread, vegetables, fruit, legumes, nuts, fats, basics,
  sweets_snacks, drinks) only organise the file; search uses the tier.
- Aliases cover everyday words the USDA-based names lack in some language ("Haferflocken", "牛肉末", "金枪鱼罐头",
  "Toast"). They are searchable in every app language but never shown, and ranked by their language like the
  names (a German alias counts as another language in the English UI). A word used in two languages ("Toast",
  "Bacon") is listed under both. Use them sparingly, for real gaps only.
- `commonFoodsFromFile()` (src/core/food-search.js) reads the file into fdcId → `{tier, aliases}`; `forLanguage()`
  ranks the aliases for the app language and is passed as the third argument of `indexItem()`. `TIER_BONUS` there sets how much a tier lifts a food: enough to beat
  equally good textual matches, not enough to beat a clearly better one ("egg substitute" still finds egg
  substitute first). Without the file every food ranks as before.
- `node tools/food-common.mjs` checks the file (ids exist, no duplicates) and counts per group;
  `node tools/food-common.mjs list [group]` prints the entries in three languages;
  `node tools/food-common.mjs search <en|de|zh> [--plain] <query> …` shows the ranking with (or without) tiers.
  `tests/food-search-common.test.js` holds 40+ queries per language whose staple must rank in the top 3.
- After rebuilding `generic-foods.json`, run the check: dropped or renumbered foods are reported.
