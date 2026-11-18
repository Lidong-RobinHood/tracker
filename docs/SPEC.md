# Tracker — data model and spec (v1)

Personal food + workout tracker for one user. Metric units only. This web app is a
prototype for a later native iOS/Android app, so the data model is plain JSON and
all calculation logic is pure and free of browser APIs.

## 1. Architecture

- Static site on GitHub Pages under a sub-path (`/tracker/`). **All URLs relative.**
- No build step, no framework, no runtime CDN. Plain ES modules (`<script type="module">`),
  JSDoc types. Third-party code only in `vendor/`, with version + licence recorded.
- Hash routing (`#/diary`, `#/workout`, `#/trends`, `#/settings`), so deep links work on Pages.
- All user data in IndexedDB on the device. No backend, no accounts, no analytics.
- Installable PWA: `manifest.webmanifest` + `sw.js`. Service worker is **network-first
  with cache fallback** for same-origin files (updates must never be stuck behind a cache);
  it never caches API responses.
- UI language: English. Mobile-first, designed for 375 px width, light and dark mode,
  tap targets ≥ 44 px, numeric keypads (`inputmode="decimal"`) for all number entry.
- Decimal input accepts both `,` and `.`.

### Layout

```
index.html  app.css  manifest.webmanifest  sw.js  icons/
src/app.js            boot, router, tab bar
src/ui/               shared DOM helpers (el(), sheet/modal, toast, number input)
src/db/db.js          IndexedDB wrapper, schema, migrations, export/import
src/core/             PURE logic, no DOM/IndexedDB/fetch. Runs in Node. Portable.
src/data/             static seed data (exercise library, generic foods)
src/food/             food feature (views + API clients)
src/workout/          workout feature (views)
src/trends/           weight, adaptive targets, dashboard (step 4)
src/settings/         settings, export/import
tests/                node --test, covers everything in src/core
vendor/               third-party
spike/                the step-1 barcode spike, kept for reference
```

Rule: anything that computes a number lives in `src/core` and has tests. Views only
read/write through `src/db/db.js` and call `src/core`.

## 2. Conventions

- `id`: string from `crypto.randomUUID()`.
- `date`: local calendar day, string `YYYY-MM-DD`. Never derive it from UTC.
- `createdAt` / `updatedAt`: epoch milliseconds (number).
- Mass in g, volume in ml, body weight and load in kg, energy in kcal.
- Weeks run Monday–Sunday.
- Every record is a plain JSON object; no class instances, no Dates, no Blobs.

## 3. Data model (IndexedDB database `tracker`, schema version 1)

### `foods` (key `id`; indexes `barcode`, `sourceKey` unique, `lastUsedAt`)
Only foods the user has logged, saved or edited are stored (a local library/cache).

```
{ id, source: 'off' | 'usda' | 'custom',
  sourceKey,            // 'off:<barcode>' | 'usda:<fdcId>' | 'custom:<id>'
  barcode: string|null,
  name, brand: string|null,
  basis: 'g' | 'ml',    // nutrients are per 100 of this unit
  per100: { kcal, protein, carbs, fat,            // required numbers
            sugars, satFat, fibre, salt },        // number|null
  servings: [ { label, amount } ],   // e.g. {label:'1 slice', amount:30}; may be empty
  userEdited: boolean,  // user corrected name/values; never overwrite from the API
  lastAmount: number|null,           // last logged amount, used as default next time
  useCount, lastUsedAt, createdAt, updatedAt }
```

### `diary` (key `id`; index `date`)
One logged item. **Stores a snapshot** so later edits to a food never change history.

```
{ id, date, meal: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  foodId: string|null,       // null for quick-add
  name, brand: string|null,
  amount, basis: 'g' | 'ml',
  per100: { ...same shape as foods.per100 },   // snapshot at logging time
  createdAt, updatedAt }
```
Totals are always computed: `value = per100.x * amount / 100`. Quick-add (calories/macros
without a food) is stored as `amount: 100` with `per100` = the entered totals and
`foodId: null`.

### `meals` (saved meals; key `id`)
```
{ id, name, items: [ { foodId, name, brand, amount, basis, per100 } ], createdAt, updatedAt }
```
Logging a saved meal creates one diary entry per item (amounts editable before confirming).

### `exercises` (key `id`; index `name`)
```
{ id, name,
  primary:   [muscleId],     // each counts settings.volume.primary   (default 1)
  secondary: [muscleId],     // each counts settings.volume.secondary (default 0.5)
  equipment: 'barbell'|'dumbbell'|'machine'|'cable'|'bodyweight'|'other',
  increment: number,         // kg step for progression suggestions, default 2.5
  isCustom: boolean, archived: boolean, notes: string, createdAt, updatedAt }
```
Muscle ids (fixed list in `src/core/muscles.js`): `chest, back, traps, shoulders, biceps,
triceps, forearms, abs, glutes, quads, hamstrings, calves`.
Seed library ships in `src/data/exercises.js` with stable ids (`seed:<slug>`); seeded on
first run; user edits to seeded exercises are kept.

### `routines` (workout templates; key `id`)
```
{ id, name, order,
  items: [ { exerciseId, targetSets, targetReps, targetRepsMax: number|null } ],
  createdAt, updatedAt }
```
`3 x 6` = `targetSets 3, targetReps 6`. Optional range `3 x 6–8` uses `targetRepsMax 8`.

### `workouts` (sessions; key `id`; index `date`)
```
{ id, date, routineId: string|null, name, startedAt, finishedAt: number|null,
  exercises: [ { exerciseId, targetSets, targetReps, targetRepsMax,
                 sets: [ { weight, reps, type: 'normal' | 'dropset', done: boolean } ],
                 note: string } ],
  createdAt, updatedAt }
```

### `weights` (key `date`)
`{ date, kg, updatedAt }` — one body-weight value per day.

### `settings` (key `key`)
`{ key, value }`. Keys: `profile` (heightCm, birthYear, sex), `goal` (rateKgPerWeek,
negative = lose), `targets` (kcal, protein, carbs, fat; source 'manual'|'adaptive'),
`volume` ({primary:1, secondary:0.5, dropset:0}), `meta` (schemaVersion, seededAt).

### `targetHistory` (key `weekStart`) — step 4
`{ weekStart, trendKg, tdee, kcalTarget, daysLogged, createdAt }`

### Export / import
Export = one JSON file `{ app:'tracker', schemaVersion, exportedAt, stores:{ <store>: [records] } }`
with every store. Import validates `app` + `schemaVersion`, shows record counts, asks for
confirmation, then **replaces** all data in one transaction.

## 4. Food

**Add-food flow** (from a meal section in the diary): one sheet with tabs
Search · Scan · Recent · Meals · Quick add.

- **Scan:** camera barcode scan as in the spike (native `BarcodeDetector`, vendored ZXing
  fallback). Look the barcode up in the local `foods` store first (so the user's corrected
  values win), then Open Food Facts.
- **Search:** local library first (instant), then generic foods (bundled dataset, no API
  key), then Open Food Facts text search (debounced, respects rate limits, clearly labelled
  by source).
- **Not found / incomplete:** goes straight to the food editor, barcode pre-filled, so the
  product is created once and found next time.
- **Portion screen** (every path ends here):
  - amount field in g/ml, pre-filled with last amount for this food, else serving size, else 100;
  - quick chips for known servings and ×½ ×2;
  - live calories and macros for the entered amount;
  - **"Edit values"** opens the food editor: name, brand, basis and all per-100 values are
    editable. Saving stores the food locally with `userEdited: true`; these values are used
    from then on and are never overwritten by the API.
- **Diary:** day view with four meals, per-meal and day totals, remaining vs target for
  kcal/protein/carbs/fat, previous/next day, tap entry to edit amount/values or delete,
  copy a meal to another day, save a meal's entries as a saved meal.
- Completeness: a food needs name + kcal + protein + carbs + fat to be logged; the editor
  highlights what is missing. kJ-only products are converted (÷ 4.184) and marked.

## 5. Workout

Must be as fast as the user's sheet:
```
Benchpress
3 x 6            target sets x reps
100  7           weight kg, reps
100  8
100  8
Dropset 5x 80    5 reps at 80 kg
```

- **Start:** pick a routine (or empty workout). One card per exercise.
- **Card:** name; target `3 x 6` (tap to edit); last session summary line; one row per set
  with two number fields (kg, reps) and a done toggle. Rows are **pre-filled from the last
  session of that exercise** (same weight, same reps), so an unchanged set is one tap.
  Add set, add dropset, delete set (swipe or long-press menu), per-exercise note.
  Entering a weight in set 1 offers to copy it down to the untouched sets below.
- **Dropset:** a set row tagged `dropset`, visually distinct. Excluded from progression.
- **Progression** (`src/core/progression.js`): look at the most recent finished session
  containing the exercise; take its `normal`, `done` sets. If there are at least
  `targetSets` of them and every one has `reps >= (targetRepsMax ?? targetReps)` at the
  same top weight, suggest `weight + exercise.increment`. Shown as a chip
  ("↑ 102.5 kg — all sets hit target"); applying it is one tap, never automatic.
- **Autosave** on every change; an unfinished workout survives reload and is resumed.
- **Weekly volume** (`src/core/volume.js`): for the Mon–Sun week, each done `normal` set
  adds `volume.primary` to every primary muscle and `volume.secondary` to every secondary
  muscle; dropset rows add `volume.dropset` × the same weights (default 0). Shown as a
  per-muscle list for the current week with last week for comparison.
- **Library:** searchable list, edit muscles/equipment/increment, add custom, archive.
- **Routines:** create/edit/reorder; "save this workout as routine".
- **History:** past sessions by date; per-exercise history.

## 6. Adaptive targets (step 4, outline)

- Trend weight: exponential moving average over daily weights, gap-tolerant.
- Expenditure: `TDEE = mean intake − (Δtrend × 7700 kcal/kg) / days` over a rolling window,
  only counting days with a complete diary; smoothed.
- Weekly target: `TDEE + goal.rateKgPerWeek × 7700 / 7`, with a floor and a per-week change limit.
- All in `src/core/adaptive.js`, tested against synthetic data with known true TDEE.

## 7. Out of scope for now
Meal-photo logging (needs a paid/keyed AI service — to be proposed separately), accounts,
sync, micronutrients, imperial units.
