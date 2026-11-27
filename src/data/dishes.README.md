# dishes.json

Prepared dishes as eaten out (snack bar, bakery, canteen, restaurant) that the USDA list in
`generic-foods.json` lacks: Döner, Currywurst mit Pommes, Schnitzel, Käsespätzle, Brezel, whole pizzas,
Gyros-Teller, Chinese and other Asian restaurant dishes, …

| | |
|---|---|
| What | **Own estimates**, not measured or copied values. Each dish is a recipe of typical ingredient amounts (general cooking knowledge, restaurant-style use of fat and oil); the nutrition comes only from the USDA FoodData Central ingredients it lists (`fdcId`s of `generic-foods.json`, public domain) |
| Not used | Nutrition tables of websites, apps, restaurant chains, manufacturers or national databases (e.g. BLS); brand and chain names |
| Recipes | `tools/dishes/recipes.<group>.json` (`recipes.europe.json`: German/Austrian, Turkish/Greek as eaten in Germany, Italian, other European; `recipes.asia.json`: Chinese and other Asian) |
| Built by | `node tools/build-dishes.mjs` |
| Accuracy | Real dishes vary a lot (portion, fat, recipe): treat values as ±20–30 %. Each recipe lists its ingredients with notes, so a value can always be traced and corrected |
| In the app | Search section "Dishes" (badge "≈ Estimate"), portion sheet with Small / Normal / Large; a logged dish is stored as `source: 'dish'`, `sourceKey: 'dish:<id>'` with its English name, values and `sizes` (SPEC §3). Code: `src/core/dishes.js`, `src/food/dishes.js`. Credited on Settings › Licences |

## Format

```
{ source: "Own estimates from recipes of USDA FoodData Central ingredients", note, builtAt, count,
  fields: ["id","kitchen","names","aliases","kcal","protein","carbs","fat","sugars","satFat","fibre","salt","portions"],
  dishes: [ ["doner-kebab", "fastfood", {en, de, zh}, {en: […], de: […], zh: […]},
             kcal, protein, carbs, fat, sugars, satFat, fibre, salt, [small, normal, large]], … ] }
```

- One dish per line, sorted by `id`. `id` is a lowercase slug, unique across all recipe files and **stable forever**
  (stored diary entries will refer to it).
- `kitchen`: `german` | `european` | `fastfood` | `chinese` | `asian`.
- `names`: display names in English, German (as on a German menu) and Chinese (as a Chinese speaker in Germany would
  search; the original name in brackets where there is no real Chinese name). `aliases`: extra search words per
  language, never shown (may be empty).
- Values per 100 g of the finished dish, same units and rounding as `generic-foods.json` (kcal, g; salt = sodium × 2.5).
  A value is `null` when ingredients without that value make up more than 10 % of the recipe weight; smaller gaps
  count as 0.
- `portions`: grams of a small, normal and large serving as typically served (a whole pizza, one Döner, a plate with
  sides, one slice of cake).

## How the values are computed

per 100 g = Σ (ingredient value per 100 g × grams ÷ 100) ÷ `cookedWeight` × 100

`cookedWeight` is the weight of the finished recipe: water lost in cooking, frying and baking is subtracted;
absorbed frying fat, cooking water of pasta, rice and dumplings and soaked-up broth are listed as ingredients.

## Rebuild and check

```
node tools/build-dishes.mjs            # validate all recipe files, write src/data/dishes.json
node tools/build-dishes.mjs --check    # validate and compare with dishes.json, write nothing (exit 1 on problems)
node tools/build-dishes.mjs --list [kitchen|id-part]   # id, kitchen, kcal/100 g, kcal per normal portion, names
```

Validation (errors are reported per file; an invalid dish is left out, a file that does not parse is left out as a
whole, the other files are still built, and the exit code is 1):
unique ids across files, known `fdcId`s, names in en/de/zh, `cookedWeight` between 0.4 and 1.1 × the ingredient
sum, portions ascending, 20–600 kcal per 100 g (above 600 only with `"allowHigh": true`).
`tests/dishes.test.js` fails when `dishes.json` is out of date with the recipe files or malformed.

## Adding or fixing a dish

1. Find the ingredients: `node tools/food-common.mjs search en <query>` (or search `generic-foods.json` by name).
   Prefer ingredients with complete values (avoid ones with a missing sugars/fibre value for large amounts) and pick
   raw or cooked to match the weight you write. First check that USDA does not already have the dish.
2. Add it to the matching `tools/dishes/recipes.<group>.json`:

```
{ "id": "doner-kebab", "kitchen": "fastfood",
  "names": { "en": "Doner kebab", "de": "Döner Kebab", "zh": "土耳其烤肉夹饼 (Döner)" },
  "aliases": { "en": ["kebab"], "de": ["Döner", "Kebap"], "zh": ["土耳其烤肉"] },
  "ingredients": [ [174915, 100, "Turkish flatbread, quarter (as white pita)"],
                   [171799, 93.5, "doner meat, veal/beef (as cooked minced beef 20 % fat)"], … ],
  "cookedWeight": 365,
  "portions": { "small": 290, "normal": 370, "large": 480 } }
```

3. `node tools/build-dishes.mjs`, then check the result with `--list` against common sense (kcal per normal
   portion) and commit the recipe file together with `src/data/dishes.json`.

Never change or reuse an existing `id`; to retire a dish, keep it until the app can migrate stored entries (a stored
dish whose id is gone still works: it shows its stored English name and keeps its values and sizes).
Everyday classics get a search tier in `DISH_TIERS` (`src/core/dishes.js`); keep their ids valid
(`tests/dish-search.test.js` checks).
