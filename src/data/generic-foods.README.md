# generic-foods.json

Bundled generic foods for the food search (loaded lazily on first search, never at app start).

| | |
|---|---|
| Sources | USDA FoodData Central (Agricultural Research Service, U.S. Department of Agriculture): **SR Legacy** and **Survey (FNDDS)** |
| Files used | `FoodData_Central_sr_legacy_food_json_2018-04.zip` and `FoodData_Central_survey_food_json_2024-10-31.zip` (contains `surveyDownload.json`) from https://fdc.nal.usda.gov/download-datasets/ (no API key) |
| Versions | SR Legacy, April 2018 release (records carry publication date 2019-04-01). FNDDS 2021-2023 (the newest Survey download, publication date 2024-10-31). Both downloaded 2026-11-27, rebuilt 2026-11-27 |
| Licence | Public domain — CC0 1.0 Universal (FoodData Central data are in the public domain). Citations requested: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov." and "U.S. Department of Agriculture, Agricultural Research Service. 2024. USDA Food and Nutrient Database for Dietary Studies 2021-2023. Food Surveys Research Group Home Page, http://www.ars.usda.gov/nea/bhnrc/fsrg" |
| Foods | 8,904 = 6,272 SR Legacy basic foods + 170 SR Legacy fast-food / restaurant dishes + 2,462 FNDDS dishes and drinks |
| Size | about 1,131 KB raw (1,158,625 bytes), about 245 KB gzipped |

## Format

```
{ source, dataset, version, publicationDate, fnddsPublicationDate, licence, builtAt,
  fields: ["fdcId","name","kcal","protein","carbs","fat","sugars","satFat","fibre","salt","portions"],
  foods: [ [fdcId, name, kcal, protein, carbs, fat, sugars, satFat, fibre, salt, [[label, grams], ...]], ... ] }
```

- All values per 100 g. kcal = FDC nutrient 1008 (kJ ÷ 4.184 as fallback). Protein 1003, fat 1004,
  carbohydrate by difference 1005, total sugars 2000, saturated fat 1258, fibre 1079 (the same ids in both datasets).
- salt (g) = sodium (FDC 1093, mg) × 2.5 / 1000.
- `null` = not reported. Up to three household portions with gram weights; piece-like portions
  ("1 medium", "1 slice", "1 sandwich", "1 piece, medium pizza", "1 order") first, then cups and spoons, then ounces;
  parenthetical size notes removed from labels. FNDDS portions without a number ("Quantity not specified",
  "Guideline amount ...") or per unit of surface/volume ("1 surface inch", "1 oz yields") are skipped.
- Decoded by `decodeGenericFoods()` in `src/core/food-search.js` into foods with `source: 'usda'`,
  `sourceKey: 'usda:<fdcId>'`.

## Order and ids

Ids are FDC ids: SR Legacy 167512–175304, FNDDS 2021-2023 2705444–2710705 (separate ranges; the build stops on a
duplicate id). The names files (`generic-foods.<lang>.json`) are aligned by position, so the order is fixed:

1. SR Legacy foods outside the dropped categories, sorted by name: exactly the 6,272 foods of the file before
   2026-11-27 (same ids, names, values and positions);
2. SR Legacy "Fast Foods" and "Restaurant Foods" (generic only), sorted by name — added 2026-11-27;
3. FNDDS foods, sorted by name — added 2026-11-27.

## Selection

**SR Legacy** (7,793 foods): dropped are the categories Baby Foods and American Indian/Alaska Native Foods, foods
without energy or macros, brand-name items (below) and the "School Lunch" items of the fast-food category. The
Fast Foods and Restaurant Foods categories were dropped until 2026-11-19 and are kept since 2026-11-27 for their
generic dishes ("Restaurant, Chinese, kung pao chicken", "Fast foods, hamburger; single, regular patty; plain").

**FNDDS** (5,432 foods): selected by WWEIA food category (`FNDDS_CATEGORIES` in `tools/build-generic-foods.mjs`):

- whole category: mixed dishes (meat, poultry, seafood, bean, vegetable, rice, pasta, mac and cheese, turnovers),
  Asian (fried rice / lo mein, stir-fry, egg rolls / dumplings / sushi, ramen and Asian soups), Mexican (burritos,
  tacos, nachos, other), pizza, burgers and all sandwich categories, soups, eggs and omelets, chicken nuggets and
  tenders, biscuits / muffins / quick breads, pancakes / waffles / French toast, cakes, pies, cookies, pastries,
  ice cream, pudding, gelatin, fried vegetables, coleslaw and other salads, french fries, mashed potatoes and potato
  dishes, smoothies, milk shakes, liquor and cocktails, dips / gravies / sauces;
- only dish-like names: chicken pieces (coated, wings, rotisserie, with sauce), fish and shellfish (fried, coated,
  sticks, smoked, scampi, cocktail), breads (garlic bread, naan, roti, paratha, focaccia), breadsticks, fruit and
  lettuce salads, baked potato with toppings, hot chocolate, coffee drinks (latte, cappuccino, mocha, iced, frozen,
  espresso, ready-to-drink) and tea drinks (with milk, bubble tea, iced, kombucha);
- not taken: plain single foods that SR Legacy covers (meat cuts, fish, vegetables, fruit, rice, pasta, bread,
  milk, cheese, cereals, snacks, candy, soft drinks, juices, condiments), baby food and formula, nutrition drinks,
  bars and powders, the uncategorised recipe ingredients; also names with "raw", "as ingredient", school versions,
  and names that SR Legacy already has: the same name, or the same name with singular and plural ignored (a
  trailing "s" of every word: "Cookie, fortune" = "Cookies, fortune", "Ice cream, vanilla" = "Ice creams,
  vanilla") and kcal within 5 % (FNDDS took the SR values; `sameNameKey`, `SAME_FOOD_KCAL`). A different food
  with the same name stays: "Potato pancake" (FNDDS, 196 kcal) next to "Potato pancakes" (SR, 268 kcal). 33
  foods dropped as SR duplicates (2026-11-27: 19 more than by the exact name alone).
- Near-duplicates: FNDDS lists many variants nobody can tell apart on the plate. Name segments for the fat used
  ("NS as to fat", "fat added", "made with oil / butter / margarine / animal fat / cooking spray", "no added fat"),
  "decaffeinated", "reduced sodium", "from raw / pre-cooked / frozen / other sources" and "on white / wheat
  bread / bun" are ignored to group the variants (within a category); of each group only the most generic one is
  kept: NFS / "NS as to fat" first, then "fat added", oil, no added fat, butter, margarine; white before wheat;
  plain before decaffeinated or reduced sodium (`variantKey`, `variantRank`). Where the food was bought
  ("from fast food", "from restaurant") is kept as a separate food. 274 foods dropped this way.

## Brand names

SR Legacy writes brand names in capitals, at the start or anywhere in the description
("Yogurt, Greek, nonfat, vanilla, CHOBANI", "Alcoholic beverage, beer, light, BUD LIGHT", "McDONALD'S, Big Mac"). The
build drops every food whose name contains a word in capitals with at least two capital letters in a row (a trailing
's is ignored), except the ordinary abbreviations USDA, NFS, NS, NFSMI (a recipe reference), UHT and BBQ, or a word
that mixes lower case with three capitals in a row ("McDONALD'S", "McNUGGETS").
Until 2026-11-18 only names that started with such a word were dropped; the rebuild of 2026-11-19 removed
518 more foods (6,790 → 6,272). Brand names written in mixed case (e.g. "Archway Home Style Cookies",
"Nabisco, ...") are not detected and remain.
FNDDS puts brand names in parentheses ("Whopper (Burger King)", "Crackers, cheese (Cheez-It)"): a parenthetical
with a capitalised word drops the food, and a short list of brands written in the name (Nesquik, Easy Mac,
Hamburger Helper, Hot Pocket, Nutella, Popsicle, Creamsicle, Fudgesicle, "Seven and Seven", Spam, Frito,
Jagerbomb ...) drops it too. Portion labels with a
brand ("1 Weight Watchers pizza", "1 Bagel Bite") are skipped.

## Rebuild

```
# download and unzip both files from https://fdc.nal.usda.gov/download-datasets/ (JSON format), then:
node tools/build-generic-foods.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json path/to/surveyDownload.json
```

Set `LIST_DROPPED=path/to/file.txt` to also write every dropped food with its reason (category, brand, plain,
variant with the food kept instead, same name in SR) for review.

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

USDA names are comma-separated segments and heavily templated (6,272 names had 3,652 unique segments), so segments
are translated once and the names are composed from them (`tools/build-food-names.mjs`):

```
node tools/build-food-names.mjs extract              # tools/food-names/segments.en.json: segments, counts, examples
# translate: tools/food-names/<lang>.json  { "<segment>": "…", "<first segment>|<segment>": "…" }
#            tools/food-names/overrides.<lang>.json  { "<fdcId>": "full name" }  (optional)
node tools/build-food-names.mjs missing <lang>       # untranslated segments
node tools/build-food-names.mjs compose <lang> [--strict]   # writes src/data/generic-foods.<lang>.json
```

Segments without a translation stay English (`--strict` exits non-zero). The 2,632 foods added on 2026-11-27
(fast food / restaurant, FNDDS) are translated like the others; the names files hold all 8,904 foods.
Rebuilding `generic-foods.json` requires
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
  sweets_snacks, prepared, drinks) only organise the file; search uses the tier. `prepared` (2026-11-27): FNDDS
  dishes a plain query means ("pizza" → restaurant cheese pizza, "burger", "fries", "fried rice", "sushi", "ramen",
  "burrito"); latte and cappuccino have aliases only (a tier would lift them above plain coffee). The app's own dish
  estimates (`dishes.json`) have their own tiers (`DISH_TIERS` in `src/core/dishes.js`).
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
