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
- UI language: English, German, Simplified Chinese (Settings › General › Language; section 9, docs/I18N.md). Mobile-first, designed for 375 px width, light and dark mode,
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
(the step-1 barcode spike page was removed in 0.5.2; it is in git history)
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
{ id, source: 'off' | 'usda' | 'dish' | 'custom',
  sourceKey,            // 'off:<barcode>' | 'usda:<fdcId>' | 'dish:<id>' | 'custom:<id>'
  barcode: string|null,
  name, brand: string|null,
  basis: 'g' | 'ml',    // nutrients are per 100 of this unit
  per100: { kcal, protein, carbs, fat,            // required numbers
            sugars, satFat, fibre, salt },        // number|null
  servings: [ { label, amount } ],   // e.g. {label:'1 slice', amount:30}; may be empty
  userEdited: boolean,  // user corrected name/values; never overwrite from the API
  lastAmount: number|null,           // last logged amount, used as default next time
  useCount, lastUsedAt, createdAt, updatedAt,
  nameLang?: 'en' | 'de' | 'zh',     // optional, generic ('usda') foods and dishes only: shown in this language
                                     // instead of the app language (found through its name, §9); absent =
                                     // follow the app language. `name` stays the English USDA / dish name.
  sizes?: [small, normal, large] }   // optional, dishes only: portion sizes in g (from dishes.json)
```
`source: 'dish'` is one of the app's own dish estimates (`src/data/dishes.json`, `src/data/dishes.README.md`), logged
like a generic food: `sourceKey: 'dish:<id>'` (ids are stable), the dish's English name, per-100 g values and its
three portion `sizes`, so the sizes stay available from Recent, saved meals and Your foods, also when the dish later
leaves dishes.json (it is then shown with the stored English name). All new fields are optional; no schema change.

### `diary` (key `id`; index `date`)
One logged item. **Stores a snapshot** so later edits to a food never change history.

```
{ id, date, meal: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  foodId: string|null,       // null for quick-add
  name, brand: string|null,
  amount, basis: 'g' | 'ml',
  per100: { ...same shape as foods.per100 },   // snapshot at logging time
  createdAt, updatedAt,
  estimate?: true }          // optional, quick-add only: logged by "Estimate a meal" (§4), shown with '≈'
```
Totals are always computed: `value = per100.x * amount / 100`. Quick-add (calories/macros
without a food) is stored as `amount: 100` with `per100` = the entered totals and
`foodId: null`. `estimate: true` (language-neutral; absent on every other entry) marks a quick add logged by
"Estimate a meal", named or not; any other value counts as absent. Copying the entry keeps it; editing its kcal in
the entry sheet drops it; a saved meal does not carry it. Optional field, no schema change.

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
  increment: number,         // kg step for progression suggestions, default 2.5 (also dumbbells;
                             // seeded dumbbells shipped with 2 are moved to 2.5 while never edited)
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
  splitId?: string,
  createdAt, updatedAt }
```
`3 x 6` = `targetSets 3, targetReps 6`. Optional range `3 x 6–8` uses `targetRepsMax 8`.
`splitId` (optional string): set on routines created by adopting a split (the split id, e.g.
`'ul4-b'`). Otherwise the record has the shape above and is an ordinary, editable routine. Routines
the user made never have it, so "replace" can only remove adopted ones. `splitCopy: true` (optional) marks routines made by
copying a library split into a custom split (Customise); they keep `splitId` but "replace" never removes them.

### `workouts` (sessions; key `id`; index `date`)
```
{ id, date, routineId: string|null, name, startedAt, finishedAt: number|null,
  exercises: [ { exerciseId, targetSets, targetReps, targetRepsMax,
                 sets: [ { weight, reps, type: 'normal' | 'dropset', done: boolean, auto?: true } ],
                 note: string } ],
  createdAt, updatedAt }
```
`auto: true` marks a pre-filled row the user has not edited or ticked yet (plain JSON flag; every
reader ignores it, rows without it count as touched). It is removed on any edit, tick, fill-down or
applied progression; untouched rows are re-derived when the session's date or the card's target
changes (`refreshAutoSets`).
A **finished** workout counts for statistics only when it has at least one done set
(`isLoggedWorkout` in `src/core/workout.js`, the one shared predicate): history counts, routine
progress and its % changes, "vs last time", analysis hub, month counts, weekly report, recovery.
Such empty records (left by older versions) are not deleted automatically; History lists them as
"no sets logged" with a delete action. The app no longer creates them.

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
  "vs last time" (working sets); personal records on the exercise screen, in the post-workout analysis and in the
  weekly report (best set included), labelled "starting point" with its date; picker "Recent".
- **Ignored:** weekly sets per muscle (+ direct/partial breakdown, set targets), muscle recovery,
  workout counts and tonnage totals, routine sessions and their % changes, session tonnage / total
  reps records, month statistics, trend and progress charts, weekly report training section and week
  summaries; the **progression suggestion** (only a real logged session can trigger it: when the
  starting point is the most recent entry for an exercise, no chip is shown). It is never a
  record-setting session itself.
- On the same date a real session counts as newer than the starting point (`byRecent`), so a real
  session on or after its date always wins for pre-fill, "Last:" and records (`byRecent` is the
  only chronological order used by the workout modules).
- History shows it as one "Starting point" item; opening it (or its id in session/history/analysis
  routes) goes to the editor.

### `weights` (key `date`)
`{ date, kg, updatedAt }` — one body-weight value per day.

### `settings` (key `key`)
`{ key, value }`. Keys: `profile` (heightCm, birthYear, sex), `goal` (rateKgPerWeek,
negative = lose), `targets` (kcal, protein, carbs, fat; source 'manual'|'adaptive'),
`volume` ({primary:1, secondary:0.5, dropset:0}), `meta` (schemaVersion, seededAt).
`activeSplit` (optional): `{ splitId, level: 'minimum'|'standard'|'high', routineIds: [ids in rotation
order], adoptedAt }`. Absent = no split followed. "Stop following" removes it and keeps the routines.
It lives in `settings`, so export / import carry it with no schema change.
`language` (optional): `'auto'|'en'|'de'|'zh'`, mirrored from localStorage `tracker.language` (read at boot);
after an import the settings value wins (`docs/I18N.md`).
A followed **custom split** is `{ kind: 'custom', splitId: 'custom:<uuid>', level: 'standard', routineIds,
adoptedAt }` (values without `kind` keep the shape above); either kind may carry `skips: [{ date, at }]`
(Next up › Skip). `customSplits` (optional): the user's own splits, `[{ id: 'custom:<uuid>', name,
sessionsPerWeek: 1–7|null, sessions: [routineId…] (rotation order, repeats allowed), createdAt, updatedAt,
sourceSplitId? }]`; routines stay ordinary routines (a routine may be in several splits; routines copied from
a library split carry `splitId` and `splitCopy: true`). Rules: `docs/SPLITS.md` › Custom splits.
`recovery` (optional): `{ pace: 'faster'|'average'|'slower', base?: { [muscleId]: [minH, maxH] },
rule?: [muscleIds] }` — pace scales rule-of-thumb ranges only; `base` = ranges set by hand (whole hours,
6–240 h, max ≥ min + 4); `rule` = muscles kept on the rule of thumb although a range was learned.
`recoveryCheckins` (optional): array of recovery check-ins, oldest first (newest last), at most 2 000
(the oldest are dropped): `{ id, muscle, answer: 'recovered'|'sore', at, boutAt, hours, dose, sets,
range: [minH, maxH], source: 'rule'|'yours'|'set' }` — `boutAt` = time of the muscle's last counted
session, `hours` since then, `dose` = effective weighted sets the model used (carry-over included),
`sets` = that session's weighted sets, `range` / `source` = the window shown at that moment. User data:
in backups, no schema change. Learned ranges are derived from it on every render, never stored.

**Split library.** Training splits are a catalogue in code (`src/data/splits.js`), not a store.
Adopting one writes ordinary `routines` (with `splitId`) and the `activeSplit` setting, and may
replace the `volumeTargets` setting; "Next up" is derived from `activeSplit.routineIds` and the
logged workouts, never stored. Catalogue, adopt / replace rules, volume levels, alternatives and
the Next up rotation are documented in `docs/SPLITS.md`.

### `targetHistory` (key `weekStart`) — step 4
`{ weekStart, trendKg, tdee, kcalTarget, daysLogged, createdAt }`

### Export / import
Export = one JSON file `{ app:'tracker', schemaVersion, exportedAt, stores:{ <store>: [records] } }`
with every store. Import validates `app` + `schemaVersion`, shows record counts, asks for
confirmation, then **replaces** all data in one transaction.
Records are exported and imported as stored, optional fields included (e.g. `foods.nameLang`); a file without
an optional field imports as before, and an unknown `nameLang` value is ignored when shown (and dropped the
next time the food is saved). A diary entry's `estimate` is kept only when it is `true`: any other value is dropped
on import.

## 4. Food

**Add-food flow** (from a meal section in the diary): one sheet with tabs
Search · Scan · Recent · Meals · Quick add.

- **Scan:** camera barcode scan as in the spike (native `BarcodeDetector`, vendored ZXing
  fallback). Look the barcode up in the local `foods` store first (so the user's corrected
  values win), then Open Food Facts.
- **Search:** local library first (instant), then dishes (the app's own estimates, `src/data/dishes.json`), then
  generic foods (bundled dataset, no API key), then Open Food Facts text search (debounced, respects rate limits,
  clearly labelled by source). Dishes and generic foods are searched from 2 characters, or from 1 Han character
  (粥, 面, 鱼); a single Latin letter searches only the user's foods. Dishes and generic foods load lazily on the first search (dishes.json also when a
  logged dish is on screen), never at app start. The "Dishes" section shows up to 8 rows (up to 12 when the generic
  section has fewer than 5), each with the quiet "≈ Estimate" badge and ≈ kcal of its normal portion on the right.
  Dishes are ranked like generic foods (names and aliases in all three languages, app language first, Han matching,
  umlaut folding, German compounds); a few everyday classics carry a tier (`DISH_TIERS`, `src/core/dishes.js`) so
  "pizza" finds the Margherita first. A dish and a near-identical USDA food may both show (different sections).
- **Not found / incomplete:** goes straight to the food editor, barcode pre-filled, so the
  product is created once and found next time.
- **Estimate a meal** (Quick add, top row; `src/food/estimate.js`, model `src/core/meal-estimate.js`): a sheet that
  builds a plate from hand portions, for meals eaten out: protein in palms (meat / fish / tofu · egg), carbs in fists
  (rice / noodles / potato / bread), vegetables in fists, fat · sauce in thumbs, each in halves (palms 0–2, fists 0–3,
  thumbs 0–4). The cooking method (grilled / pan-fried / deep-fried / creamy) sets the default thumbs
  (0 / 0.5 / 1 / 0.75 × (palms + carb fists), to halves) until the user moves the thumb stepper; changing the
  method again resets it. Per-unit values: `ESTIMATE_UNITS` (rounded typical cooked values from the USDA generic
  foods). Live ≈ kcal and macros; logged as one quick-add entry (kcal + macros, `estimate: true`, §3) to the chosen meal on
  the Add screen's date. No name → stored marker 'Estimated meal', shown translated.
- **Portion screen** (every path ends here):
  - amount field in g/ml, pre-filled with last amount for this food, else serving size, else 100;
  - quick chips for known servings and ×½ ×2;
  - a dish: Small / Normal / Large (plate icon + grams) above the amount, Normal preselected on the first add; picking
    one fills the grams, typing another amount deselects it; "≈ Estimate" under the name and "≈" before the kcal;
  - live calories and macros for the entered amount;
  - **"Edit values"** opens the food editor: name, brand, basis and all per-100 values are
    editable. Saving stores the food locally with `userEdited: true`; these values are used
    from then on and are never overwritten by the API.
- **Diary:** day view with four meals, per-meal and day totals, remaining vs target for
  kcal/protein/carbs/fat, previous/next day, tap entry to edit amount/values or delete,
  copy a meal to another day, save a meal's entries as a saved meal.
- **Estimates in lists:** a dish's kcal (unedited dish, values unchanged) is led by "≈" in its food row (search and
  Your foods: ≈ kcal of the normal portion; Recent: ≈ kcal of the last amount shown under the name, the normal portion
  without one), diary entry and saved-meal item; an entry from "Estimate a meal" (`estimate: true`) also gets "≈" in
  its diary row and entry sheet; meal and day totals have no mark. A food whose `source` is not a known value (e.g. from
  a hand-edited backup) shows no source badge.
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
- **Unfinished workouts:** at most one *live* workout (started now; no `plannedDurationMs`) is open.
  Starting another live one asks: no done set → "Discard it & start" (default) / "Keep it open";
  done sets → "Finish it & start" (default) / "Discard (n sets) & start" / "Cancel".
  A *past* workout ("Log a past workout", has `plannedDurationMs`) is a separate record: logging one
  never finishes or blocks the live session, and it is entered and saved on its own session screen.
  The resume banner points at the live workout; an unfinished past workout gets its own banner.
- **Finish** with no done set never stores a finished workout: it offers to discard it instead.
- **Card:** name; target `3 x 6` (tap to edit); last session summary line; one row per set
  with two number fields (kg, reps) and a done toggle. Rows are **pre-filled from the last
  session of that exercise** (same weight, same reps), so an unchanged set is one tap. There are
  always at least `targetSets` normal rows: missing ones copy the last done normal set (else the
  target), placed before the dropsets.
  Add set, add dropset, delete set (swipe or long-press menu), per-exercise note.
  Entering a weight in set 1 offers to copy it down to the untouched sets below.
- **Dropset:** a set row tagged `dropset`, visually distinct. Excluded from progression.
- **Progression** (`src/core/progression.js`): look at the most recent finished real session
  containing the exercise (never the starting point); take its `normal`, `done` sets and the
  HIGHEST weight among them (the top weight). If at least `targetSets` sets were done at the top
  weight and every set at that weight has `reps >= (targetRepsMax ?? targetReps)`, suggest
  `top weight + exercise.increment`. Lighter sets (warm-ups, back-off sets) are ignored; dropsets
  never count. Example for 3 x 6: 60×10, 100×8, 100×8, 100×8 → 102.5; 100×6, 100×6, 100×6, 102.5×3
  → none (one set at 102.5). Shown as a chip ("↑ 102.5 kg — 3 sets at 100 kg hit target"); applying
  it (to the pending sets at the old top weight) is one tap, never automatic. Once a normal row of
  the session carries the suggested weight (applied, also after a reload) the chip is not offered
  again. "Step 2.5 kg" next to it (and "Weight step" in the target editor) changes the exercise's
  increment.
- **Autosave** on every change; an unfinished workout survives reload and is resumed.
- **Weekly volume** (`src/core/volume.js`): for the Mon–Sun week, each done `normal` set
  adds `volume.primary` to every primary muscle and `volume.secondary` to every secondary
  muscle; dropset rows add `volume.dropset` × the same weights (default 0). Shown as a
  per-muscle list for the current week with last week for comparison.
- **Library:** searchable list, edit muscles/equipment/increment, add custom, archive.
- **Routines:** create/edit/reorder; "save this workout as routine".
- **History:** past sessions by date; per-exercise history.
- **Muscle recovery** (`src/core/recovery.js`): a rule-of-thumb window (hours) per muscle after a
  session, scaled by the session's weighted sets and a personal pace, with carry-over between close
  sessions; shown as recovering / likely ready / recovered with a range, never as a measurement. The
  model, its parameters and edge cases are documented in the module's header comment.
  **Check-ins:** tapping a trained muscle (map, chip, list row) lets the user say *Recovered* or *Still
  sore* (no prompts). The latest answer of the current bout changes the shown status ("you said … ·
  6 h ago"). After ≥ 5 informative answers from ≥ 3 bouts, with both kinds, the muscle's base range
  becomes the user's own, learned per muscle (dose-normalised, interval-censored, isotonic median,
  recency-weighted; rules in `src/core/recovery.js`). Precedence: hand-set > learned ("yours") > rule of
  thumb; pace applies to the rule of thumb only (also no longer on hand-set ranges). The detail screen
  shows each range's source, progress to the minimum, Use / Reset to rule of thumb, and the check-in
  history (filter, delete, per-muscle chart).

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
- **Weekly target**: `kcal = TDEE + goal.rateKgPerWeek × 7700 / 7`, rounded to 10; then clamped to
  the previous adaptive target ± 150 kcal (only when `targets.source === 'adaptive'`), rounding
  toward the previous target so the change never exceeds 150 (previous 2005 → at most 2150; the
  exact limit when no multiple of 10 fits); never below the floor (`adaptive.kcalFloor`, else 1500
  male / 1200 female / 1350 other; the floor wins over the change limit). Protein = 2.0 g/kg trend
  weight, fat = 0.8 g/kg (lowered only if kcal cannot fit it), carbs = the rest. If protein plus a
  small fat floor (`minFatG`, 20 g) would exceed the calories, protein is capped to fit and the
  result says so (`proteinLimited`, `proteinWanted`), so macros never add up to more than the
  calorie target (apart from a few kcal of rounding).
- **Weekly check-in** (`buildCheckIn`): available from Monday for the week starting that Monday,
  reviews the previous Mon–Sun week (average complete intake, trend change, TDEE as of Monday) and
  proposes kcal/protein/carbs/fat; uses the formula estimate (labelled) while data are insufficient.
  Targets change only on **Accept**: one transaction writes `settings.targets` (`source:'adaptive'`)
  and `targetHistory`. **Keep current** changes no targets; it writes a `targetHistory` record with
  `decision:'kept'` so the check-in counts as done (it can still be accepted later that week).

- **Weekly report** (`src/core/weekly-report.js`): one Monday–Sunday week of eating (complete days,
  averages, percent of target, macro split, on-target days), body weight (trend change vs the
  previous Sunday) and training (workouts, sets, volume load, sets per muscle, records). Definitions
  are in the module's header comment and repeated in the report's footnotes.

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
imputed as average days and bias TDEE low. A logged-but-not-eaten 5000 kcal typo (one day) raises
the estimate by about +105 kcal after 7 days, about +145 kcal after 14–21 days, +118 after 28, +60
after 42 and +19 after 56 days (measured with the simulator); fix such entries in the diary. Real TDEE changes take ~5 weeks to be tracked (by design).

## 7. History import
`#/import` reads workout history pasted from a sheet, body-weight lines and food-diary CSV exports
(MyFitnessPal, Cronometer, FDDB presets or a column mapping), always with a full preview and
plausibility checks before anything is saved, and every run can be undone. Accepted formats,
ambiguity rules (decimal commas vs column separators, thousands groups, units deciding weight vs
reps) and the run bookkeeping are in docs/IMPORT-FORMATS.md and the header comments of
`src/core/import-*.js`.

## 8. Meal-photo logging
Built (Quick add → "Scan meal photo", `src/core/meal-photo.js`, `src/core/photo-*.js`). The user
brings their own API key and chooses the provider (Anthropic, Gemini, OpenAI or an OpenAI-compatible
endpoint); the key stays in this browser's localStorage, never in the export. The model's estimate
(items, amounts, per-100 values, confidence) is sanitised and shown for review and editing; nothing
is logged until the user confirms.

## 9. Languages

- English, German, Simplified Chinese; Settings › General › Language: Automatic (default), English, Deutsch, 中文.
  Automatic follows the device (`navigator.languages`: first German or Chinese entry, else English). Choosing a
  language reloads the app; the choice is kept in localStorage and in settings key `language` (so backups carry it).
- Everything the app names is stored language-neutrally (an id or the canonical English text) and translated
  when shown, so switching the language re-labels everything and backups are language-independent: built-in
  exercises, splits, muscles, equipment, meal names, generic (USDA) foods, dishes, the day names of routines adopted or
  copied from a built-in split and of workouts started from them, and the stored default names: 'Workout',
  'New routine', 'My split', '<split> (custom)', saved meals 'Meal', 'Breakfast Thu 26 Nov', 'Breakfast photo',
  diary entries 'Quick add', 'Imported', '<meal> (imported)', 'Meal photo', '… + 2 more', 'Estimated meal', serving
  'Whole pack'.
  Past imports store their counts and dates and are described in the current language (imports saved by 0.7.1
  keep their English text). A name saved unchanged in an editor keeps its stored form. Only what the user typed
  (and Open Food Facts products, imported text) is stored and shown as typed. No exceptions (a generic food may
  also carry a language code, `nameLang`, see below; never translated text).
- Search finds generic foods and dishes by their English, German or Chinese name (and aliases) in every language; a match only in another
  language's name ranks below the app language's matches of the same quality (a prefix or inside-word match
  there below all of them). The exercise picker and library search the shown name, equipment and muscles.
  Alphabetical lists sort with the app language's collation (German umlauts, Chinese by pinyin).
- "Show the name as I typed it": a generic food or dish found through another language's name, and not through the app
  language's, is shown in that language: in the search result and, once added, everywhere (diary, saved meals,
  Recent, Your foods, portion, editor) in every app language. Which language: a query with Chinese characters
  means Chinese; any matching app-language name (or alias) means the app language (shared words such as
  "pizza", "tofu"); otherwise the matching name's language, English before German before Chinese. Stored as
  `foods.nameLang` (no value = the app language); the stored `name` stays English. Dishes follow the same rules; their
  names come from dishes.json by id.
  Rule for later adds: **the most recent add decides**. Logging the food from a search (generic results or
  Your foods) sets `nameLang` to the language that search matched, and a match through the app language
  clears it (saving edited values of a food opened from a search does the same); logging it from Recent or
  a saved meal keeps it. Your foods search treats the pinned name as that language's (typing it keeps the
  pin). A name the user typed (renamed food or entry) always wins. Open Food Facts products and custom foods
  keep the name they came with.
- Percentages are written `62 %` (no-break space) in every language.
- Numbers keep the decimal point (`82.5`) and narrow-space grouping in every language; input accepts `,` or `.`.
  Dates and weekdays follow the language (`Mi. 18. Nov.`, `11月18日周三`), times stay 24 h.

## 10. Out of scope for now
Accounts, sync, micronutrients, imperial units.
