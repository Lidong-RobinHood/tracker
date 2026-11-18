# generic-foods.json

Bundled generic foods for the food search (loaded lazily on first search, never at app start).

| | |
|---|---|
| Source | USDA FoodData Central, **SR Legacy** dataset (Agricultural Research Service, U.S. Department of Agriculture) |
| File used | `FoodData_Central_sr_legacy_food_json_2018-04.zip` from https://fdc.nal.usda.gov/download-datasets/ (no API key) |
| Version | SR Legacy, April 2018 release (records carry publication date 2019-04-01); downloaded and built 2026-11-18 |
| Licence | Public domain — CC0 1.0 Universal (FoodData Central data are in the public domain; citation requested: "U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.") |
| Foods | 6,790 (of 7,793; dropped: Baby Foods, Fast Foods, Restaurant Foods, American Indian/Alaska Native Foods categories and brand-name items whose description starts with an all-caps brand) |
| Size | about 876 KB raw, about 200 KB gzipped |

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

## Rebuild

```
node tools/build-generic-foods.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json
```
