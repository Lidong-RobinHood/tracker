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

**Starting point** ("current bests", `#/workout/starting-point`, logic in `src/core/baseline.js`):
one ordinary record in `workouts` with `kind: 'baseline'`, so export/import and every history
reader see plain data and no new store is needed. At most one exists (the editor updates it in place).
```
{ id, kind: 'baseline', date /* "as of", not in the future */, routineId: null, name: 'Starting point',
  startedAt = finishedAt = local midnight of date,
  exercises: [ { exerciseId, targetSets: <sets>, targetReps: <reps>, targetRepsMax: null, targetWeight: null,
                 sets: [ <sets> × { weight, reps, type: 'normal', done: true },        // working sets
                         { weight, reps, type: 'normal', done: true, best: true } ],  // optional best set, last
                 note: '' } ],
  createdAt, updatedAt }
```
Bodyweight exercises store `weight: null`. The best set is stored only when it differs from the
working set. Every consumer decides via `isBaseline(workout)`; real workouts never have `kind`.
- **Used:** session pre-fill (working sets only) and the "Last:" line (shown as "Starting point");
  progression (working sets, judged against the session card's target); "vs last time"
  (working sets); personal records on the exercise screen, in the post-workout analysis and in the
  weekly report (best set included), labelled "starting point" with its date; picker "Recent".
- **Ignored:** weekly sets per muscle (+ direct/partial breakdown, set targets), muscle recovery,
  workout counts and tonnage totals, routine sessions and their % changes, session tonnage / total
  reps records, month statistics, trend and progress charts, weekly report training section and week
  summaries. It is never a record-setting session itself.
- On the same date a real session counts as newer than the starting point (`byRecent`), so a real
  session on or after its date always wins for pre-fill, "Last:" and progression.
- History shows it as one "Starting point" item; opening it (or its id in session/history/analysis
  routes) goes to the editor.

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

## 6. Adaptive targets and Trends (step 4)

All maths in `src/core/adaptive.js` (pure, one config object `ADAPTIVE_DEFAULTS`, overrides via
`adaptiveConfig()`); tested in `tests/adaptive.test.js` against a seeded simulator
(`tests/helpers/adaptive-sim.js`: true TDEE, intake noise, mass by energy balance at 7700 kcal/kg,
scale noise sd 0.5 kg, missing/under-logged days, step changes, outliers).

- **Trend weight** (display, macros): EMA over calendar days, α = 0.1/day; a gap of n days uses
  `1 − (1 − α)^n`; between weigh-ins the last trend value holds.
- **Weight change rate**: least-squares slope through raw weights of the last 28 days (kg/week).
- **Intake days**: today never counts. A logged day below 0.5 × the median logged day (±28 days)
  is *incomplete* and treated as not logged.
- **Expenditure (TDEE)**: 2-state Kalman filter over days, state = (true mass, TDEE):
  `mass[d+1] = mass[d] + (intake[d] − TDEE) / 7700`, `weight[d] = mass[d] + noise (sd 0.5 kg)`,
  TDEE a random walk (sd 18 kcal/day), mass process noise 0.02 kg/day. This is the recursive form
  of `TDEE = mean intake − weight slope × 7700` over an exponentially fading window: smooth by
  construction, gap-tolerant, uses each day's intake exactly. Missing/incomplete days are imputed
  with the mean valid intake of ±14 days (extra uncertainty 400 kcal). Weigh-ins whose innovation
  exceeds 2 sd are clipped (Huber) so a water spike cannot drag it. Runs over the last 120 days.
  Standard error = √P(TDEE): ≤ 100 high, ≤ 175 medium, else low confidence.
- **Sufficiency** (else `status: 'insufficient'`, `tdee: null`, `missing: [reasons]`): in the last
  28 days ≥ 8 weigh-ins and ≥ 10 complete logged days; ≥ 14 days since the later of first weigh-in
  and first logged day; a weigh-in within the last 7 days.
- **Formula fallback**: Mifflin-St Jeor (`10·kg + 6.25·cm − 5·age + 5 | −161 | −78 other`) × activity
  factor (1.2 / 1.375 / 1.55 / 1.725 / 1.9), trend weight; reported separately as `formula`, labelled
  "not based on your data"; `null` if the profile is incomplete.
- **Weekly target**: `kcal = TDEE + goal.rateKgPerWeek × 7700 / 7`, rounded to 10; clamped to the
  previous adaptive target ± 150 kcal (only when `targets.source === 'adaptive'`); never below the
  floor (`adaptive.kcalFloor`, else 1500 male / 1200 female / 1350 other). Protein = 2.0 g/kg trend
  weight, fat = 0.8 g/kg (lowered only if kcal cannot fit it), carbs = the rest.
- **Weekly check-in** (`buildCheckIn`): available from Monday for the week starting that Monday,
  reviews the previous Mon–Sun week (average complete intake, trend change, TDEE as of Monday) and
  proposes kcal/protein/carbs/fat; uses the formula estimate (labelled) while data are insufficient.
  Targets change only on **Accept**: one transaction writes `settings.targets` (`source:'adaptive'`)
  and `targetHistory`. **Keep current** changes no targets; it writes a `targetHistory` record with
  `decision:'kept'` so the check-in counts as done (it can still be accepted later that week).

### Settings keys added
`profile.activity` (`sedentary|light|moderate|active|extra`), `profile.sex` may be `'other'`;
`adaptive { proteinPerKg: 2.0, fatPerKg: 0.8, kcalFloor: null }`; goal range −1 … +0.5 kg/week.
`targetHistory` records: `{ weekStart, trendKg, tdee, kcalTarget, daysLogged, decision:
'accepted'|'kept', basis: 'data'|'formula'|null, proposal:{kcal,protein,carbs,fat}|null, createdAt }`.

### Screens (`src/trends/`)
- `#/trends` dashboard: check-in banner when due; Today (eaten/target/left, protein → diary);
  This week (average complete intake vs target, days logged, finished workouts, sets per muscle from
  `weeklyComparison`); Weight trend (+ sparkline); Expenditure & target; Intake history.
- `#/trends/weight`: today's weight (`,` or `.`), add a past day, chart (dots = weigh-ins, line =
  trend, 1 M / 3 M / All, tap for values), list with edit/delete (+ undo).
- `#/trends/expenditure`: estimate with confidence and data basis or what is missing + formula
  estimate; goal; weekly check-in (current vs proposed, Accept / Keep current); target history.
- `#/trends/intake`: daily kcal bars (4 Mon–Sun weeks, today lighter), target line, weekly averages.

### Known limits
Accuracy depends on honest, complete logging: days that are skipped *because* they were big are
imputed as average days and bias TDEE low. A logged-but-not-eaten 5000 kcal typo shifts the
estimate by ~90 kcal for a few weeks. Real TDEE changes take ~5 weeks to be tracked (by design).

## 7. Out of scope for now
Meal-photo logging (needs a paid/keyed AI service — to be proposed separately), accounts,
sync, micronutrients, imperial units.
