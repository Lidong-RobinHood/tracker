# Import formats

Research date: **2026-11-19**. Re-check before relying on it: these apps change their exports.
Labels: **[official]** = stated on the vendor's own help page; **[sample]** = header line seen in real
export files that users committed to public GitHub repositories (third-party, not vendor docs);
**[unconfirmed]** = reported only, or reconstructed from a third-party importer.

None of the four vendors documents its column headers. Every header line below comes from real
files, not from the vendors. Presets therefore match columns **by name, not position**, and every
import shows a full preview before anything is saved.

## MyFitnessPal

- **[official]** Data export is for Premium and Premium+ only. Free accounts can only print a
  report. Path: Web → Reports → Export → date range; iOS: More/Profile → Nutrition → Export.
  You get a zip of CSV files by email and can only choose the date range.
  <https://support.myfitnesspal.com/hc/en-us/articles/360032273352>,
  <https://support.myfitnesspal.com/hc/en-us/articles/360032623371>
- **[official]** The zip holds three files: meal-level nutrition, progress (weight, measurements)
  and exercise. Nutrition is **summarised per meal per day**, not per food.
- **[sample]** Files are named `Nutrition-Summary-<from>-to-<to>.csv` etc. (the help page uses other
  names, so do not rely on file names). Nutrition header:
  `Date,Meal,Calories,Fat (g),Saturated Fat,Polyunsaturated Fat,Monounsaturated Fat,Trans Fat,Cholesterol,Sodium (mg),Potassium,Carbohydrates (g),Fiber,Sugar,Protein (g),Vitamin A,Vitamin C,Calcium,Iron,Note`.
  A newer sample has a `Time` column after `Meal`. Dates are `YYYY-MM-DD`, decimal dot, comma
  separated. Sources: github.com/subhanmahmood/experiments, github.com/sameervarma13/fitAI,
  github.com/pkeen/500-runs.
- **[sample]** Weight file header: `Date,Weight` (unit follows the user's settings; **[unconfirmed]**).
  Use the body-weight importer with it only if the values are in kg.
- **Preset shipped:** `MyFitnessPal – Nutrition Summary` (status `sample`). Uses Date, Meal, Calories,
  Fat (g), Saturated Fat, Carbohydrates (g), Fiber, Sugar, Protein (g), Sodium (mg) (sodium → salt).

## Cronometer

- **[official]** Export is free (the Basic plan lists "Ability to export ALL raw data"). Web only:
  More → Account → Account Data → Export Data, with a date range. Separate CSV files for diary
  entries (servings), exercises, biometrics, notes and daily nutrition. The daily nutrition export
  has an "Include diary group rows" option.
  <https://support.cronometer.com/hc/en-us/articles/360018760151-Account-Settings>,
  <https://support.cronometer.com/hc/en-us/articles/360028026971-Subscription-Types>
- **[unconfirmed]** Gold adds time stamps; long ranges reportedly time out
  (<https://forums.cronometer.com/discussion/460/exporting-data>).
- **[sample]** `servings.csv` (one row per food):
  `Day,Time,Group,Food Name,Amount,Energy (kcal),…,Sodium (mg),…,Carbs (g),Fiber (g),Starch (g),Sugars (g),Net Carbs (g),Fat (g),…,Protein (g),…,Category`.
  Another sample has no `Time` column. `Amount` is free text ("58.00 g", "2.00 x 1 slice").
  Source: github.com/leobugeja/leobugeja.github.io, github.com/wilyanse/dev_blog_notebooks.
- **[sample]** `dailysummary.csv`: `Date,Energy (kcal),…,Sodium (mg),…,Net Carbs (g),Carbs (g),Fiber (g),…,Fat (g),…,Protein (g),…,Completed`
  (github.com/cloudos-ca/app-sante). With group rows a `Group` column appears, including a
  "Total" row (seen in a parser fixture, github.com/rileybleeker/Onyx; **[unconfirmed]** as a raw file).
- **Presets shipped:** `Cronometer – Servings` and `Cronometer – Daily Nutrition` (status `sample`).
  Only columns visible in the samples are mapped; saturated fat is not mapped because its exact
  header was not visible. "Total" group rows are skipped by default.

## FDDB (fddb.info)

- **[official]** Export is free, **website only** ("The Fddb app doesn't have its own export"):
  My Fddb → Account → Manage content and data → Export food diary
  (<https://fddb.info/db/i18n/managecontent/?lang=en>). The diary export contains only energy and
  the three macronutrients, no micronutrients. The weight report can also be exported.
  <https://help.fddb.info/hc/en-us/articles/360019848940-Can-I-export-and-print-my-data>,
  <https://help.fddb.info/hc/en-us/articles/360020139979>
- **[unconfirmed]** Column layout, from a third-party importer only
  (github.com/EchoCodeGhost/Kyoro-HealthHub, `scripts/importers/import_fddb.py`): semicolon
  separated, UTF-8 with BOM, decimal comma; columns `datum_tag_monat_jahr_stunde_minute`
  (`DD.MM.YYYY HH:MM`), `bezeichnung`, `interne_id`, `kj`, `fett_g`, `kh_g`, `protein_g`. Energy in kJ.
  No raw sample file or header line was found.
- **Preset shipped, labelled unconfirmed:** `FDDB – Food diary (unconfirmed layout)`. kJ is converted
  to kcal (÷ 4.184); a `kcal` column is used if present. No meal column: the user picks the meal.

## Yazio

- **[official]** "Right now, Yazio doesn't offer an in-app data export on iOS, Android, or the web."
  The only route is a GDPR data request through support.
  <https://help.yazio.com/hc/en-us/articles/52664956728337-Can-I-export-my-data-from-Yazio>
- **[unconfirmed]** Third-party scrapers exist; they need the user's credentials. Not supported.
- **No preset.** The format of the GDPR files is unknown; if a CSV arrives, the generic column
  mapping handles it.

## What the importers accept

### Workouts (`src/core/import-workouts.js`)
One item per line; cells are tab separated (copied from a sheet) or space separated.
- date line: `12.11.2026`, `12.11.26`, `12.11.`, `2026-11-12`, `12/11/26` (day first unless the paste
  proves month first; the preview offers a switch when ambiguous), `Mon 12 Nov`, `12. November 2026`,
  `Nov 12, 2026`; may carry the workout name (`12.11.2026 Push`). A date line starts a new workout.
- workout name: a text line followed by another text line or a date (`Push`).
- exercise: a text line followed by a target, set or dropset line; `Benchpress 3x6` on one line works.
- target: `3 x 6`, `3x6`, `3 × 6`, `3 x 6-8` (first line of a block).
- set: `100  7` = weight kg then reps (switch "reps then weight" in the preview); `82,5 8`;
  `100 kg x 7`; one number = bodyweight reps; `BW 12`; `+10 6` (added weight). An explicit unit
  decides which number is the weight, also over the switch: `80 kg x 8`, `8 x 80 kg`, `8 reps 80kg`,
  `80kg 8` = 80 kg × 8 reps. One number after sets with an absolute weight in the same exercise
  (`100` after `100 7`) is listed as "weight without reps?" and left out (write `BW 12` for a
  bodyweight set); after added-weight sets (`+10 6`) it stays a bodyweight set.
- dropset: `Dropset 5x 80`, `Drop 5 x 80`, `DS 5x80`, `Dropset: 5 x 80 kg` = 5 reps at 80 kg.
- ignored: blank lines, header lines (`kg reps`, `Gewicht Wdh`).
- **rejected (whole paste):** several column groups side by side (two exercise names or dates in one
  row, more than two numbers in a row, two target cells in a row). The user is told to copy one
  column group at a time, so cells are never assigned to the wrong exercise.
- listed by line number and left out: numbers before any exercise name, reps that are not whole
  numbers or outside 1–200, weights outside 0–1000 kg, invalid or future dates, unreadable lines.

### Body weight (`src/core/import-weights.js`)
Date first found anywhere in the line, then the rest is the weight: `82,5;12.11.2026`,
`12.11.2026,82,5`, `2026-11-12 82.5 kg`, `Mo 12.11.2026<TAB>82,5`, `2026-11-12T07:30;82.5` (ISO
timestamp: its local date). Optional header row. Commas: a comma-separated header with 3 or more
columns (`Date,Weight,BodyFat`) makes commas column separators (`10.11.2026,82,18` = 82 kg, the
extra column is ignored with a note); a line with more comma fields than the header is an
"ambiguous" error. Without such a header a comma after the weight's digits is a decimal comma
(`12.11.2026,82,5` = 82.5); with two digits (`12.11.2026,82,18` = 82.18) the preview says it guessed. Lines that
mention lb/lbs/pounds stop the import (metric only). Values outside 30–300 kg, future dates and
repeated days (the later line wins) are flagged and left out.

### Food CSV (`src/core/import-food.js`)
Delimiter (`,` `;` tab `|`), Excel-style quotes (embedded separators, line breaks, `""`), BOM, CRLF,
header row, number style and day/month order are detected and can be changed. Number style
(`1.234,5` or `1,234.5`): decimal marks decide; a column whose values all have exactly three digits
after the separator (`1.050`, `1,250`) reads as thousands; an energy column must be plausible (median
row ≥ 20 kcal, no row above 10 000 kcal). The detection reports a confidence; when it is not high the
setup says "please check", and the preview has a switch that reads the file again. The preview warns
when the median day is below 300 or above 15 000 kcal. Columns are mapped to
date (required), meal, food name, amount (g/ml), kcal or kJ (required), protein, carbs, fat, sugars,
fibre, saturated fat, salt, sodium (mg → salt g × 2.5 ÷ 1000). Each row becomes one quick-add
diary entry (`amount: 100`, `per100` = the row's totals, `foodId: null`; an amount is appended to
the name). Rows are skipped with a reason: no/invalid/future date, missing or non-numeric energy,
negative values, more than 10 000 kcal in one row, meal set to "skip" ("Total" rows by default).

## How imports are recorded and undone

Both mechanisms are used together:
1. every record an import creates gets `importId: <run id>` (workouts, diary entries, weights,
   custom exercises created from the import screen);
2. the settings key `importRuns` lists runs (newest first, max 50):
   `{ id, type: 'workouts'|'weights'|'food', createdAt, status: 'writing'|'done'|'partial'|'undone',
   summary, counts, keys: { <store>: [primary keys] }, replaced: { weights: [previous records] }, undoneAt }`.

The run entry is written **before** the data (status `writing`), then the data in transactions of
200 records, then the status becomes `done`. "Undo this import" on `#/import` deletes each listed key
only when the stored record still carries this run's `importId` (so a day re-entered by hand later
is left alone), puts replaced weights back, and deletes custom exercises created by the run unless a
remaining workout or routine uses them. Exercise-name choices are remembered in the settings key
`importExerciseMap` (`nameKey → exercise id`); undo removes entries that point to deleted exercises.
Exercises created through the exercise picker's own "Create" button are saved immediately, like
everywhere else in the app, and are not removed by undo.
