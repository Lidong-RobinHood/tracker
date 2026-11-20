# Split library

Browse training splits by days, style, level and equipment, see the planned weekly sets per muscle,
swap exercises, and follow one split as ordinary routines with a "Next up" rotation.

| Part | File |
|---|---|
| Catalogue (data) | `src/data/splits.js` |
| Logic (pure) | `src/core/splits.js` |
| Screens | `src/splits/` (`workout/splits`, `workout/splits/:id`), `next-up.js` (`nextUpCard()`) |
| Info sheets | `split-choose`, `split-sets`, `split-run` in `src/ui/info-sheets.js` |
| Movement patterns, gear | `EXERCISE_PATTERN`, `RELATED_PATTERNS`, `exerciseGear()`, `HOME_GEAR` in `src/data/exercises.js` |
| Sources (Licences screen) | `SPLIT_SOURCES`, `SPLIT_BASIS` in `src/data/splits.js` → `#/licences?section=split-sources` |
| Tests | `tests/splits.test.js`, `tests/splits-data.test.js` |

## Data added

- **`routines.splitId`** (optional string): set on routines created by adopting a split (the split id,
  e.g. `'ul4-b'`). Otherwise the record is the SPEC §3 shape and an ordinary, editable routine. Routines
  the user made never have it, so "replace" can only remove adopted ones.
- **Setting `activeSplit`**: `{ splitId, level: 'minimum'|'standard'|'high', routineIds: [ids in rotation
  order], adoptedAt }`. Absent = no split followed. "Stop following" removes it and keeps the routines.
  It lives in `settings`, so export / import carry it with no schema change.
- **Setting `activeSplit`, custom split**: `{ kind: 'custom', splitId: 'custom:<uuid>', level: 'standard',
  routineIds, adoptedAt }`; `routineIds` is a copy of the custom split's rotation at the last save (the app
  reads the live rotation from `customSplits`). Values without `kind` are library splits (the 0.6.0 shape,
  unchanged). Both kinds may carry `skips: [{ date: 'YYYY-MM-DD', at: ms }]` (Next up › Skip, at most 60).
- **Setting `customSplits`**: see Custom splits below.
- **`routines.splitCopy: true`**: routines made by Customise (copy of a library split); they also carry
  `splitId`, but "Replace" never deletes them.
- Unsaved choices on a split detail (volume level, swaps) are a 24 h draft in localStorage
  (`tracker.draft.split:<id>`), like other drafts; never in the backup.

## Catalogue

14 splits, 2–6 days, 7 styles, 3 levels, 2 home splits. Names are generic descriptions (style + days);
no authored or commercial program names (the test has a denylist). Ids are stable: never rename one.

| id | Name | Days | Style | Level | Equipment |
|---|---|---|---|---|---|
| `fb2` | Full body 2-day | 2 | Full body | Beginner | Gym |
| `fb3-b` | Full body 3-day | 3 | Full body | Beginner | Gym |
| `fb3-i` | Full body 3-day plus | 3 | Full body | Intermediate | Gym |
| `fb3-home` | Full body 3-day home | 3 | Full body | Beginner | Home |
| `ppl3` | Push pull legs 3-day | 3 | Push / pull / legs | Intermediate | Gym |
| `fb4` | Full body 4-day | 4 | Full body | Intermediate | Gym |
| `ul4-b` | Upper lower 4-day | 4 | Upper / lower | Beginner | Gym |
| `ul4-i` | Upper lower 4-day plus | 4 | Upper / lower | Intermediate | Gym |
| `ul4-home` | Upper lower 4-day home | 4 | Upper / lower | Beginner | Home |
| `tl4` | Torso limbs 4-day | 4 | Torso / limbs | Intermediate | Gym |
| `ulppl5` | Upper lower + PPL 5-day | 5 | Hybrid | Intermediate | Gym |
| `bp5` | Body part 5-day | 5 | Body part | Intermediate | Gym |
| `ppl6` | Push pull legs 6-day | 6 | Push / pull / legs | Advanced | Gym |
| `pair6` | Paired muscles 6-day | 6 | Paired muscles | Advanced | Gym |

**Rationale.** Each split has its sessions in rotation order; a session is done `days / sessions` times a
week (A, B, A, B). Main compound lifts use 5–10 reps, secondary compounds 8–12, isolation and small
muscles 10–20 (growth occurs across a wide range of loads). Sessions hold 5–8 exercises and 12–24 sets.
Home splits use only dumbbell and bodyweight exercises that dumbbells, a bench and a pull-up bar allow
(`HOME_GEAR`; `exerciseGear()` records what each seed exercise needs, e.g. dip bars, a low bar, a
back-extension bench). The selection, order and set/rep choices are this app's own and copy
no published program; exercise ids come only from `src/data/exercises.js`.

**Design check** (a test, by the app's own counting with default weights): every muscle stays within a
review band of weighted sets per week — chest, quads, glutes 6–22; back, shoulders 8–22; hamstrings,
biceps, triceps 6–20; calves, abs 4–16; traps, forearms 0–16 — every major muscle is a main mover at
least once a week, and splits with 4+ days give traps ≥ 2. The bands are a design check, not a target.

**Changes from the research draft (2026-11-19):**
- Sentence-case names ("Full body 3-day"); bullets "don't" → "do not".
- Traps: draft had 0–1 counted sets in most splits. Shrugs (2 sets) added to `fb3-home`, `ul4-b`,
  `ul4-i` (Lower B), `ul4-home`, `tl4`, `ulppl5` (Pull), `ppl6` (Pull A), `pair6` (Chest & back B).
- `fb2`: seated dumbbell press → overhead press (2 sets) for some trap work.
- `fb3-home`: hanging leg raise added (abs were 3.5, hit once a week).
- `ul4-home`: inverted row → pull-up (home has a bar; bullet says to swap back if too hard); step-up
  removed and dumbbell RDL 3 → 4 sets (hamstrings were 8 against glutes 20; now 10 / 18).
- Days with only 4 exercises filled: `bp5` Chest + machine crunch (moved from Arms, which kept 6),
  `ppl6` Push B + pec deck, `pair6` Shoulders & arms B + rope pushdown.
- The draft's fixed weekdays and "flexible" lines were dropped: the app runs splits in order.

**Changes after verification (2026-11-20):**
- `fb3-home`: inverted row → pull-up 3 × 5–10 (the same decision as `ul4-home`: an inverted row is awkward
  with only a pull-up bar). Both home splits now say "Pull-ups too hard? Start with slow lowering-only reps."
  (the swap list no longer offers inverted rows at home). Coverage stays in the bands (shoulders 13, forearms 8).
- Descriptions claimed frequencies the app's own count does not meet: `fb2` "two sessions still train
  everything twice" → "big muscles twice a week, arms and calves once"; `ulppl5` and `ppl6` "each muscle
  twice" → "major muscles twice" (traps are 1 day); `ppl3` "each muscle once a week" → "most muscles once a
  week" (shoulders and abs are 2 days). A test checks every frequency claim against `daysHit`.

Remaining data effects (not split design): shoulders read 15–22 because every press lists them as a
partial muscle; forearms get partial sets only; `ppl3` and `bp5` train most muscles once a week.

## Coverage

`splitCoverage()` turns the planned sessions into synthetic done sets and runs
`muscleVolumeBreakdown()` from `src/core/volume.js` with the user's `volume` setting: direct =
sets × primary weight for each primary muscle, partial = sets × secondary weight for each secondary
muscle. "Days" = sessions a week in which the muscle is a primary muscle. The map uses fixed bands of
weekly sets (≥ 12, 8 to under 12, 4 to under 8, under 4, none). The legend (`coverageBands(weights)`)
labels them without overlap in steps of the smallest set weight: `12+`, `8–11.5`, `4–7.5`, `Under 4`,
`None` with the default weights. The split screens use their own ramp (`--sp-heat-1..4` in `splits.css`,
`color-mix` of the tokens) so neighbouring steps differ ≥ 1.5:1 in light and dark and the lowest step is
clearly apart from "none". The Sets list shows direct, partial, days and the user's weekly target when one is set.

## Volume level

Applied per session item before coverage and routines (`applyLevel()`):

- **Standard**: the catalogue exactly.
- **Minimum**: −1 set on every exercise, never below 1.
- **High**: +1 set on the first exercise of the session for each of its primary muscles (an exercise gets
  at most +1; never above 5). A muscle trained n times a week gains about n direct sets a week.

## Alternatives

Candidates share at least one primary muscle, are not archived, not the exercise itself and not already
in that session; custom exercises take part; home splits offer only what `HOME_GEAR` allows (no dip
bars, cables, machines, barbell, back-extension bench, low bar).

Every seed exercise has a movement pattern (`EXERCISE_PATTERN`: horizontal / incline / vertical press,
fly, row, vertical pull, pullover, hinge, squat, lunge, leg extension, leg curl, hip thrust, glute
isolation, calf, lateral / front raise, upright row, rear delt, curl, triceps press / extension, forearm,
ab flexion / bracing, shrug, carry). The list shows the same pattern first, then related patterns
(`RELATED_PATTERNS`, e.g. squat ↔ lunge, row ↔ vertical pull); it never offers a pattern another
exercise of the session already has (the swapped exercise's own pattern stays open). "Show all" lists
every exercise with a shared primary muscle. A custom exercise has no pattern: as the exercise being
swapped it falls back to the muscle rule; as a candidate it counts as related when its primary muscles
are the same. Within a tier: same primary muscles (as a set) before partial overlap, then more shared
primary muscles; exercises the user has logged (`exercise-usage.js`: most recent, then most often) before
unused ones; same equipment; more shared partial muscles; common base lifts; name. Catalogue exercises the user
archived or deleted are swapped for the top alternative automatically. Swaps change the planned split
(and the routines on adopt), never a session already logged.

## Adopt and Next up

The adopt sheet says in one line each what the choices do: Replace deletes the routines of earlier
splits (history stays), Keep deletes nothing; weekly set targets stay unless the box is ticked (then
the new targets are listed). On the workout home Next up is the first action and the Start list holds
the other routines and Empty workout, not the next one again.

Adopt writes, in one transaction: one routine per session (`splitId` set, appended after existing
routines), `activeSplit`, and — only when ticked — `volumeTargets` = planned weekly totals rounded to
whole sets for muscles with ≥ 4 (replacing the previous targets). "Replace" deletes routines that carry a
`splitId` (earlier adopted ones); "Keep" deletes nothing. Routines the user made are never touched.

Next up (`nextUp()` → `rotationNext()`), recomputed from history every time (nothing is counted or
stored, so backdating, "Change date, time, duration", editing or deleting a workout gives the same result
as if history had always been that way). Events, oldest first by workout date, then start time: every
logged workout (`isLoggedWorkout`: finished, ≥ 1 done set; never the starting point, never empty,
unfinished or discarded ones) whose routine is in the rotation, and every Next up skip. From position 0:

- a workout of routine R moves to just after the occurrence of R **nearest at or after the current
  position** (wrapping). Done in order that is +1; done out of order, the rotation continues after the
  session actually done. With a repeated routine (Upper, Lower, Upper, Lower) the nearest occurrence
  ahead is the one meant: after Upper(1) comes Lower(2), after Upper(3) comes Lower(4); a Lower done
  while Upper(3) is due counts as Lower(4).
- a skip (Next up › Other session › Skip) moves on by one.

Workouts of other routines do not move it; deleted routines leave the rotation (positions count the
rest); the rotation is read as it is now, so reordering a followed custom split takes effect at once,
continuing after the last session done. A workout logged for a past date before the latest session
never becomes "the latest". Change from 0.6.0 for library splits: none for workouts (with distinct
routines "nearest occurrence ahead" is "the session after the most recent one"); skips are new.
Known limit: with a repeated routine, inserting an older workout can change which occurrence later
workouts resolve to (the step indicator may show "2 of 4" instead of "4 of 4"); in a rotation like
U, L, U, L the next routine stays the same.

**Other session.** The Next up card has "Other session": the rotation in order, tap one to start it
today (it then counts like any workout of that routine), and "Skip <session>" (Undo in the toast).

**Mounting.** `src/splits/next-up.js` exports `async nextUpCard({ onChange, showChange = true })` →
`HTMLElement | null` (null when no split is followed or all its routines are gone). The workout home can
`const card = await nextUpCard(); if (card) append(container, card);`. Start calls `startWorkout(routine)`
from `src/workout/data.js`. The workout home mounts it under the resume block; the library screen shows a compact "Following" card instead.

## Evidence (sources)

Listed in the app on Licences and data sources › Training guidance (`SPLIT_SOURCES`), linked from the
split detail ("Methods and sources"). Only sources the research verified (abstracts read via the Europe PMC API, 2026-11-19). The app states
them in few words: weekly sets matter most; with equal weekly sets, frequency and split type make little
measurable difference to growth; ranges are general guides, mostly from young adults, not per-muscle
prescriptions. No outcome promises.

- Schoenfeld, Grgic, Krieger 2019. How many times per week should a muscle be trained to maximize muscle
  hypertrophy? J Sports Sci 37:1286. PMID 30558493.
- Schoenfeld, Ogborn, Krieger 2016. Effects of resistance training frequency on measures of muscle
  hypertrophy. Sports Med 46:1689. PMID 27102172.
- Pelland et al. 2026. Sports Med 56:481. doi 10.1007/s40279-025-02344-w (weekly sets, frequency,
  fractional counting of indirect sets as 0.5).
- Ramos-Campo et al. 2024. J Strength Cond Res 38:1330. PMID 38595233 (split vs full body, volume equated).
- Evangelista et al. 2021. Einstein 19:eAO5781. PMID 34468591.
- Schoenfeld, Ogborn, Krieger 2017. J Sports Sci 35:1073. PMID 27433992 (dose-response of weekly sets).
- Baz-Valle et al. 2022. J Hum Kinet 81:199. PMID 35291645.
- ACSM 2009 position stand. Med Sci Sports Exerc 41:687. PMID 19204579.
- Schoenfeld et al. 2021. Sports 9:32. PMID 33671664 (loading range).
- Robinson et al. 2024. Sports Med 54:2209. PMID 38970765 (proximity to failure).
- Refalo et al. 2023. Sports Med 53:649. PMID 36334240.

Conventions, not findings: the deload bullets ("every 6–8 weeks, one week, half the sets") and
"stop sets 1–3 reps short of failure" are practical wording, consistent with but not prescribed by the
sources. Originality: exercise routines are methods / systems and not protected as such (17 USC 102(b);
US Copyright Office, Federal Register 22 June 2012, doc. 2012-15235); text and names are, so all wording is original and names are
generic. Not legal advice.

## Custom splits

The user's own fixed rotation of ordinary routines (screens `src/splits/custom.js`, creation
`src/splits/custom-new.js`, route `workout/splits/custom/:id`; logic in `src/core/splits.js` › custom splits,
tests `tests/custom-splits.test.js`). No weekly planning: Next up follows the rotation as above.

**Stored** in the setting `customSplits` (so export / import carry it, no schema change):

```
[ { id: 'custom:<uuid>', name, sessionsPerWeek: 1–7 | null, sessions: [routineId …],
    createdAt, updatedAt, sourceSplitId?: '<library id>' } ]
```

- `sessions`: rotation order; the same routine may appear several times; at most 21. An id whose routine
  was deleted stays until the user removes or replaces it: shown as "Missing routine", left out of coverage
  and Next up.
- `sessionsPerWeek`: null = the rotation length (capped at 7); a number when the user sets it (the rotation
  and the week need not match: 3 sessions trained 4 days a week).
- Routines stay ordinary routines; a routine may belong to several custom splits. Only routines made by
  copying a library split carry `splitId` (plus `splitCopy: true`).

**Create** (library › + / "New split"): From my routines (pick in order, repeats allowed), From scratch
(a new split named "My split"; "Add session › New routine" creates an ordinary routine and opens the
existing routine editor; the split is saved before leaving, so the round trip and a reload lose nothing),
Copy a library split (one routine per session at the level and swaps chosen on its screen, rotation = its
sessions, sessions per week = its days; also "Customise" on a library split). The editor saves every change.

**Coverage**: `rotationCoverage()`: each position is done sessionsPerWeek / rotation length times a week
(a routine twice in the rotation counts twice); per session the library rule (direct × primary weight,
partial × secondary weight). For a library split it equals `splitCoverage()`. Same card, bands and Sets list
as a library split ("days" may be fractional, e.g. 1.3). Quiet note (`coverageNotes()`): muscles with no
sets, and muscles at least 2.5 × the median of the trained muscles and at least 8 sets above it (no library
split triggers it).

**Follow**: writes `activeSplit` (custom shape) and, when ticked, the weekly set targets; copies and deletes
nothing. Adopting a library split later: "Replace" deletes only adopted routines, never routines used by a
custom split nor `splitCopy` routines. Deleting a custom split keeps its routines (and stops following it).
