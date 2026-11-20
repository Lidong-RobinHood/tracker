// Split library catalogue (docs/SPLITS.md). Plain data, no DOM. Original selection and wording made for
// this app; names are generic descriptions (style + days), never names of published or commercial programs.
//
// Ids are stable and stored in settings.activeSplit / routines.splitId: never rename one once shipped.
// Exercise ids are seed ids from ./exercises.js (tests/splits-data.test.js checks every one).
//
// A split: { id, name, days, style, level, equipment, suits, bullets, sessions }
//   days      sessions per week (2–6)
//   style     one of STYLES
//   level     one of LEVELS
//   equipment 'gym' | 'home' (home = dumbbells, a bench and a pull-up bar: HOME_GEAR in ./exercises.js)
//   suits     one line, ≤ 12 words
//   bullets   1–2 split-specific "how to run it" lines, ≤ 12 words each
//   sessions  the distinct days in rotation order; each is done days / sessions.length times a week
//             (A, B, A, B for a 4-day split with two sessions). Items: { exerciseId, sets, reps, repsMax }
//             = targetSets, targetReps, targetRepsMax of a routine item ("3 × 8–12").

/** @type {ReadonlyArray<{id: string, label: string}>} */
export const STYLES = Object.freeze([
  { id: 'full-body', label: 'Full body' },
  { id: 'upper-lower', label: 'Upper / lower' },
  { id: 'ppl', label: 'Push / pull / legs' },
  { id: 'torso-limbs', label: 'Torso / limbs' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'body-part', label: 'Body part' },
  { id: 'paired', label: 'Paired muscles' },
].map(Object.freeze));

/** @type {ReadonlyArray<{id: string, label: string}>} */
export const LEVELS = Object.freeze([
  { id: 'beginner', label: 'Beginner' },
  { id: 'intermediate', label: 'Intermediate' },
  { id: 'advanced', label: 'Advanced' },
].map(Object.freeze));

/** @type {ReadonlyArray<{id: string, label: string}>} */
export const EQUIPMENT = Object.freeze([
  { id: 'gym', label: 'Gym' },
  { id: 'home', label: 'Home' },
].map(Object.freeze));

/** Exercise equipment types a home split may use (dumbbells, bench, pull-up bar). */
export const HOME_EQUIPMENT = Object.freeze(['dumbbell', 'bodyweight']);

/** "How to run it": shown for every split, before the split's own bullets. ≤ 12 words each. */
export const SHARED_BULLETS = Object.freeze([
  'All sets at the top of the range? Add weight next time.',
  'Otherwise keep the weight and add a rep where you can.',
  'Swap an exercise for one with the same main muscle.',
]);

/**
 * Sources of the split library, exactly as docs/SPLITS.md › Evidence lists them (verified 2026-11-19).
 * Shown on the Licences and data sources screen (#/licences, section "Training guidance").
 * { cite: authors + year, title (only where recorded), ref: journal reference, id: PMID or doi, url }
 */
export const SPLIT_SOURCES = Object.freeze([
  { cite: 'Schoenfeld, Grgic, Krieger 2019', title: 'How many times per week should a muscle be trained to maximize muscle hypertrophy?', ref: 'J Sports Sci 37:1286', id: 'PMID 30558493', url: 'https://pubmed.ncbi.nlm.nih.gov/30558493/' },
  { cite: 'Schoenfeld, Ogborn, Krieger 2016', title: 'Effects of resistance training frequency on measures of muscle hypertrophy.', ref: 'Sports Med 46:1689', id: 'PMID 27102172', url: 'https://pubmed.ncbi.nlm.nih.gov/27102172/' },
  { cite: 'Pelland et al. 2026', ref: 'Sports Med 56:481', id: 'doi 10.1007/s40279-025-02344-w', url: 'https://doi.org/10.1007/s40279-025-02344-w' },
  { cite: 'Ramos-Campo et al. 2024', ref: 'J Strength Cond Res 38:1330', id: 'PMID 38595233', url: 'https://pubmed.ncbi.nlm.nih.gov/38595233/' },
  { cite: 'Evangelista et al. 2021', ref: 'Einstein 19:eAO5781', id: 'PMID 34468591', url: 'https://pubmed.ncbi.nlm.nih.gov/34468591/' },
  { cite: 'Schoenfeld, Ogborn, Krieger 2017', ref: 'J Sports Sci 35:1073', id: 'PMID 27433992', url: 'https://pubmed.ncbi.nlm.nih.gov/27433992/' },
  { cite: 'Baz-Valle et al. 2022', ref: 'J Hum Kinet 81:199', id: 'PMID 35291645', url: 'https://pubmed.ncbi.nlm.nih.gov/35291645/' },
  { cite: 'ACSM 2009 position stand', ref: 'Med Sci Sports Exerc 41:687', id: 'PMID 19204579', url: 'https://pubmed.ncbi.nlm.nih.gov/19204579/' },
  { cite: 'Schoenfeld et al. 2021', ref: 'Sports 9:32', id: 'PMID 33671664', url: 'https://pubmed.ncbi.nlm.nih.gov/33671664/' },
  { cite: 'Robinson et al. 2024', ref: 'Sports Med 54:2209', id: 'PMID 38970765', url: 'https://pubmed.ncbi.nlm.nih.gov/38970765/' },
  { cite: 'Refalo et al. 2023', ref: 'Sports Med 53:649', id: 'PMID 36334240', url: 'https://pubmed.ncbi.nlm.nih.gov/36334240/' },
].map(Object.freeze));

/** What the split library rests on, in the words of docs/SPLITS.md › Evidence (Licences screen). */
export const SPLIT_BASIS = Object.freeze([
  'The splits are this app’s own selection. Weekly sets matter most; with equal weekly sets, frequency and split type make little measurable difference to growth.',
  'Ranges are general guides, mostly from young adults, not per-muscle prescriptions.',
]);

/** One-line disclaimer under the split detail. */
export const SPLIT_DISCLAIMER = 'General fitness information, not medical advice.';

const x = (slug, sets, reps, repsMax) => Object.freeze({ exerciseId: `seed:${slug}`, sets, reps, repsMax });
const s = (id, name, items) => Object.freeze({ id, name, items: Object.freeze(items) });
const DELOAD = 'Every 6–8 weeks, or when stalled: one week, half the sets.';
const DELOAD_6 = 'Every 5–6 weeks, or when stalled: one week, half the sets.';

export const SPLITS = Object.freeze([
  {
    id: 'fb2', name: 'Full body 2-day', days: 2, style: 'full-body', level: 'beginner', equipment: 'gym',
    suits: 'Busy weeks; big muscles twice a week, arms and calves once.',
    bullets: ['Keep at least two rest days between sessions.', 'Stalled for three sessions? Take an easy week, half the sets.'],
    sessions: [
      s('a', 'Full body A', [x('back-squat', 3, 6, 10), x('bench-press', 3, 6, 10), x('lat-pulldown', 3, 8, 12), x('romanian-deadlift', 3, 8, 12),
        x('lateral-raise', 2, 12, 20), x('dumbbell-curl', 3, 10, 15), x('rope-pushdown', 2, 10, 15), x('crunch', 2, 10, 20)]),
      s('b', 'Full body B', [x('leg-press', 3, 8, 12), x('incline-dumbbell-press', 3, 8, 12), x('seated-cable-row', 3, 8, 12), x('lying-leg-curl', 3, 10, 15),
        x('overhead-press', 2, 6, 10), x('standing-calf-raise', 3, 10, 15), x('cable-crunch', 2, 10, 15)]),
    ],
  },
  {
    id: 'fb3-b', name: 'Full body 3-day', days: 3, style: 'full-body', level: 'beginner', equipment: 'gym',
    suits: 'First program; learn the main lifts in three short sessions.',
    bullets: ['Rest a day between sessions.', 'Learn each lift; stop sets 1–3 reps short of failure.'],
    sessions: [
      s('a', 'Full body A', [x('back-squat', 3, 6, 10), x('bench-press', 3, 6, 10), x('barbell-row', 3, 8, 12), x('lateral-raise', 2, 12, 20),
        x('dumbbell-curl', 2, 10, 15), x('crunch', 2, 10, 20)]),
      s('b', 'Full body B', [x('romanian-deadlift', 3, 8, 12), x('overhead-press', 3, 6, 10), x('lat-pulldown', 3, 8, 12), x('push-up', 2, 8, 15),
        x('leg-extension', 2, 10, 15), x('rope-pushdown', 2, 10, 15), x('standing-calf-raise', 2, 10, 15)]),
      s('c', 'Full body C', [x('leg-press', 3, 8, 12), x('incline-dumbbell-press', 3, 8, 12), x('seated-cable-row', 3, 8, 12), x('lying-leg-curl', 2, 10, 15),
        x('cable-crunch', 2, 10, 15), x('hammer-curl', 2, 10, 15), x('leg-press-calf-raise', 2, 10, 15)]),
    ],
  },
  {
    id: 'fb3-i', name: 'Full body 3-day plus', days: 3, style: 'full-body', level: 'intermediate', equipment: 'gym',
    suits: 'Three days with more sets and heavier main lifts.',
    bullets: ['Rest a day between sessions.', DELOAD],
    sessions: [
      s('a', 'Full body A', [x('back-squat', 3, 5, 8), x('bench-press', 4, 5, 8), x('chest-supported-dumbbell-row', 3, 8, 12), x('lying-leg-curl', 2, 10, 15),
        x('lateral-raise', 3, 12, 20), x('overhead-cable-extension', 2, 10, 15), x('hanging-leg-raise', 2, 8, 15)]),
      s('b', 'Full body B', [x('romanian-deadlift', 3, 6, 10), x('incline-dumbbell-press', 3, 8, 12), x('pull-up', 3, 6, 10), x('bulgarian-split-squat', 2, 8, 12),
        x('face-pull', 2, 12, 20), x('dumbbell-curl', 3, 10, 15), x('standing-calf-raise', 3, 10, 15)]),
      s('c', 'Full body C', [x('hack-squat', 3, 8, 12), x('seated-dumbbell-press', 3, 8, 12), x('lat-pulldown', 3, 8, 12), x('seated-leg-curl', 2, 10, 15),
        x('cable-crossover', 2, 12, 15), x('rope-pushdown', 2, 10, 15), x('cable-crunch', 3, 10, 15)]),
    ],
  },
  {
    id: 'fb3-home', name: 'Full body 3-day home', days: 3, style: 'full-body', level: 'beginner', equipment: 'home',
    suits: 'Home training with dumbbells, a bench and a pull-up bar.',
    bullets: ['Rest a day between sessions.', 'Pull-ups too hard? Start with slow lowering-only reps.'],
    sessions: [
      s('a', 'Full body A', [x('goblet-squat', 3, 8, 15), x('dumbbell-bench-press', 3, 8, 12), x('dumbbell-row', 3, 8, 12), x('lateral-raise', 3, 12, 20),
        x('dumbbell-curl', 2, 10, 15), x('dumbbell-shrug', 2, 10, 15), x('hanging-leg-raise', 2, 8, 15)]),
      s('b', 'Full body B', [x('dumbbell-romanian-deadlift', 3, 8, 12), x('seated-dumbbell-press', 3, 8, 12), x('pull-up', 3, 5, 10), x('step-up', 2, 8, 12),
        x('push-up', 2, 8, 20), x('overhead-dumbbell-extension', 2, 10, 15), x('single-leg-calf-raise', 3, 10, 15)]),
      s('c', 'Full body C', [x('bulgarian-split-squat', 3, 8, 12), x('push-up', 3, 8, 20), x('chest-supported-dumbbell-row', 3, 8, 12),
        x('dumbbell-romanian-deadlift', 2, 10, 15), x('hammer-curl', 2, 10, 15), x('single-leg-calf-raise', 2, 10, 15), x('crunch', 2, 10, 20)]),
    ],
  },
  {
    id: 'ppl3', name: 'Push pull legs 3-day', days: 3, style: 'ppl', level: 'intermediate', equipment: 'gym',
    suits: 'Three longer sessions; most muscles once a week.',
    bullets: ['Most muscles once a week: keep every set hard.', 'Missed a day? Do the next session, do not skip it.'],
    sessions: [
      s('push', 'Push', [x('bench-press', 4, 6, 10), x('incline-dumbbell-press', 3, 8, 12), x('seated-dumbbell-press', 3, 8, 12), x('cable-crossover', 2, 12, 15),
        x('lateral-raise', 4, 12, 20), x('rope-pushdown', 3, 10, 15), x('overhead-cable-extension', 2, 10, 15)]),
      s('pull', 'Pull', [x('pull-up', 4, 6, 10), x('seated-cable-row', 3, 8, 12), x('chest-supported-dumbbell-row', 3, 8, 12), x('face-pull', 3, 12, 20),
        x('dumbbell-curl', 3, 10, 15), x('hammer-curl', 2, 10, 15), x('cable-crunch', 3, 10, 15)]),
      s('legs', 'Legs', [x('back-squat', 4, 6, 10), x('romanian-deadlift', 3, 8, 12), x('leg-press', 3, 10, 15), x('leg-extension', 2, 10, 15),
        x('lying-leg-curl', 3, 10, 15), x('standing-calf-raise', 4, 10, 15), x('hanging-leg-raise', 2, 8, 15)]),
    ],
  },
  {
    id: 'fb4', name: 'Full body 4-day', days: 4, style: 'full-body', level: 'intermediate', equipment: 'gym',
    suits: 'Four shorter sessions; most muscles trained up to four times.',
    bullets: ['Alternate A and B; rest after every second day.', DELOAD],
    sessions: [
      s('a', 'Full body A', [x('back-squat', 3, 6, 10), x('bench-press', 3, 6, 10), x('chest-supported-dumbbell-row', 3, 8, 12), x('lying-leg-curl', 2, 10, 15),
        x('lateral-raise', 2, 12, 20), x('rope-pushdown', 2, 10, 15)]),
      s('b', 'Full body B', [x('romanian-deadlift', 3, 6, 10), x('overhead-press', 3, 6, 10), x('lat-pulldown', 3, 8, 12), x('incline-dumbbell-press', 2, 8, 12),
        x('leg-press', 2, 10, 15), x('dumbbell-curl', 2, 10, 15), x('standing-calf-raise', 2, 10, 15), x('cable-crunch', 2, 10, 15)]),
    ],
  },
  {
    id: 'ul4-b', name: 'Upper lower 4-day', days: 4, style: 'upper-lower', level: 'beginner', equipment: 'gym',
    suits: 'The usual next step after full body.',
    bullets: ['Alternate Upper and Lower; rest after two days.', 'Stalled for three sessions? Take an easy week, half the sets.'],
    sessions: [
      s('upper', 'Upper', [x('bench-press', 3, 6, 10), x('lat-pulldown', 3, 8, 12), x('incline-dumbbell-press', 2, 8, 12), x('seated-cable-row', 2, 8, 12),
        x('seated-dumbbell-press', 2, 8, 12), x('lateral-raise', 2, 12, 20), x('dumbbell-curl', 2, 10, 15), x('rope-pushdown', 2, 10, 15)]),
      s('lower', 'Lower', [x('back-squat', 3, 6, 10), x('romanian-deadlift', 3, 8, 12), x('leg-extension', 2, 10, 15), x('lying-leg-curl', 2, 10, 15),
        x('standing-calf-raise', 3, 10, 15), x('dumbbell-shrug', 2, 10, 15), x('cable-crunch', 2, 10, 15)]),
    ],
  },
  {
    id: 'ul4-i', name: 'Upper lower 4-day plus', days: 4, style: 'upper-lower', level: 'intermediate', equipment: 'gym',
    suits: 'Two different upper and lower days, more volume.',
    bullets: ['Run the four days in order; rest after two.', DELOAD],
    sessions: [
      s('upper-a', 'Upper A', [x('bench-press', 4, 5, 8), x('barbell-row', 4, 6, 10), x('seated-dumbbell-press', 3, 8, 12), x('lat-pulldown', 3, 8, 12),
        x('lateral-raise', 3, 12, 20), x('ez-bar-curl', 2, 8, 12), x('skull-crusher', 2, 8, 12)]),
      s('lower-a', 'Lower A', [x('back-squat', 4, 5, 8), x('romanian-deadlift', 3, 6, 10), x('leg-extension', 3, 10, 15), x('lying-leg-curl', 3, 10, 15),
        x('standing-calf-raise', 4, 10, 15), x('cable-crunch', 3, 10, 15)]),
      s('upper-b', 'Upper B', [x('incline-dumbbell-press', 4, 8, 12), x('pull-up', 3, 6, 10), x('cable-crossover', 2, 12, 15), x('chest-supported-dumbbell-row', 3, 8, 12),
        x('cable-lateral-raise', 3, 12, 20), x('face-pull', 2, 12, 20), x('incline-dumbbell-curl', 2, 10, 15), x('overhead-cable-extension', 2, 10, 15)]),
      s('lower-b', 'Lower B', [x('hack-squat', 3, 8, 12), x('hip-thrust', 3, 8, 12), x('seated-leg-curl', 3, 10, 15), x('bulgarian-split-squat', 2, 8, 12),
        x('seated-calf-raise', 3, 12, 20), x('barbell-shrug', 2, 10, 15), x('hanging-leg-raise', 3, 10, 15)]),
    ],
  },
  {
    id: 'ul4-home', name: 'Upper lower 4-day home', days: 4, style: 'upper-lower', level: 'beginner', equipment: 'home',
    suits: 'Four home days with dumbbells, a bench and a pull-up bar.',
    bullets: ['Alternate Upper and Lower; rest after two days.', 'Pull-ups too hard? Start with slow lowering-only reps.'],
    sessions: [
      s('upper', 'Upper', [x('dumbbell-bench-press', 3, 8, 12), x('dumbbell-row', 3, 8, 12), x('seated-dumbbell-press', 2, 8, 12), x('pull-up', 2, 5, 10),
        x('push-up', 2, 8, 20), x('lateral-raise', 2, 12, 20), x('dumbbell-curl', 2, 10, 15), x('overhead-dumbbell-extension', 2, 10, 15)]),
      s('lower', 'Lower', [x('goblet-squat', 3, 8, 15), x('dumbbell-romanian-deadlift', 4, 8, 12), x('bulgarian-split-squat', 2, 8, 12),
        x('single-leg-calf-raise', 3, 10, 15), x('dumbbell-shrug', 2, 10, 15), x('crunch', 2, 10, 20)]),
    ],
  },
  {
    id: 'tl4', name: 'Torso limbs 4-day', days: 4, style: 'torso-limbs', level: 'intermediate', equipment: 'gym',
    suits: 'Arms trained with legs; shorter upper-body days.',
    bullets: ['Alternate Torso and Limbs; rest after two days.', DELOAD],
    sessions: [
      s('torso', 'Torso', [x('bench-press', 3, 6, 10), x('barbell-row', 3, 6, 10), x('incline-dumbbell-press', 2, 8, 12), x('lat-pulldown', 3, 8, 12),
        x('seated-dumbbell-press', 2, 8, 12), x('face-pull', 2, 12, 20), x('dumbbell-shrug', 2, 10, 15), x('cable-crunch', 2, 10, 15)]),
      s('limbs', 'Limbs', [x('back-squat', 3, 6, 10), x('romanian-deadlift', 3, 8, 12), x('leg-extension', 2, 10, 15), x('lying-leg-curl', 2, 10, 15),
        x('dumbbell-curl', 3, 10, 15), x('rope-pushdown', 3, 10, 15), x('lateral-raise', 2, 12, 20), x('standing-calf-raise', 3, 10, 15)]),
    ],
  },
  {
    id: 'ulppl5', name: 'Upper lower + PPL 5-day', days: 5, style: 'hybrid', level: 'intermediate', equipment: 'gym',
    suits: 'Five days; major muscles twice, sessions stay moderate.',
    bullets: ['Rest after Lower, then Push, Pull, Legs.', DELOAD],
    sessions: [
      s('upper', 'Upper', [x('bench-press', 3, 5, 8), x('barbell-row', 3, 6, 10), x('overhead-press', 3, 6, 10), x('lat-pulldown', 3, 8, 12),
        x('ez-bar-curl', 2, 8, 12), x('skull-crusher', 2, 8, 12)]),
      s('lower', 'Lower', [x('back-squat', 3, 5, 8), x('romanian-deadlift', 3, 6, 10), x('leg-extension', 3, 10, 15), x('lying-leg-curl', 2, 10, 15),
        x('standing-calf-raise', 3, 10, 15), x('cable-crunch', 2, 10, 15)]),
      s('push', 'Push', [x('incline-dumbbell-press', 3, 8, 12), x('machine-chest-press', 3, 8, 12), x('cable-lateral-raise', 4, 12, 20),
        x('rope-pushdown', 3, 10, 15), x('overhead-cable-extension', 2, 10, 15)]),
      s('pull', 'Pull', [x('pull-up', 3, 6, 10), x('seated-cable-row', 3, 8, 12), x('reverse-pec-deck', 3, 12, 20), x('dumbbell-shrug', 2, 10, 15),
        x('dumbbell-curl', 3, 10, 15), x('hammer-curl', 2, 10, 15)]),
      s('legs', 'Legs', [x('hack-squat', 3, 8, 12), x('hip-thrust', 3, 8, 12), x('seated-leg-curl', 3, 10, 15), x('seated-calf-raise', 3, 12, 20),
        x('hanging-leg-raise', 3, 10, 15)]),
    ],
  },
  {
    id: 'bp5', name: 'Body part 5-day', days: 5, style: 'body-part', level: 'intermediate', equipment: 'gym',
    suits: 'One muscle group per day; long, focused sessions.',
    bullets: ['Keep Legs and Back apart; both load the lower back.', 'Missed a day? Do the next session, do not skip it.'],
    sessions: [
      s('legs', 'Legs', [x('back-squat', 4, 6, 10), x('romanian-deadlift', 4, 8, 12), x('leg-press', 3, 10, 15), x('leg-extension', 3, 10, 15),
        x('lying-leg-curl', 3, 10, 15), x('standing-calf-raise', 4, 10, 15)]),
      s('chest', 'Chest', [x('bench-press', 4, 6, 10), x('incline-dumbbell-press', 4, 8, 12), x('dip', 3, 8, 12), x('cable-crossover', 3, 12, 15),
        x('machine-crunch', 3, 10, 15)]),
      s('back', 'Back', [x('pull-up', 4, 6, 10), x('barbell-row', 4, 6, 10), x('seated-cable-row', 3, 8, 12), x('straight-arm-pulldown', 3, 12, 15),
        x('dumbbell-shrug', 3, 10, 15)]),
      s('shoulders', 'Shoulders', [x('overhead-press', 4, 6, 10), x('lateral-raise', 4, 12, 20), x('reverse-pec-deck', 3, 12, 20), x('cable-crunch', 3, 10, 15),
        x('seated-calf-raise', 3, 12, 20)]),
      s('arms', 'Arms', [x('ez-bar-curl', 3, 8, 12), x('close-grip-bench-press', 3, 6, 10), x('incline-dumbbell-curl', 3, 10, 15), x('overhead-cable-extension', 3, 10, 15),
        x('hammer-curl', 2, 10, 15), x('rope-pushdown', 2, 10, 15)]),
    ],
  },
  {
    id: 'ppl6', name: 'Push pull legs 6-day', days: 6, style: 'ppl', level: 'advanced', equipment: 'gym',
    suits: 'Six days, major muscles twice, high weekly volume.',
    bullets: ['Rest one day a week; the order matters, not the weekday.', DELOAD_6],
    sessions: [
      s('push-a', 'Push A', [x('bench-press', 3, 5, 8), x('seated-dumbbell-press', 3, 8, 12), x('cable-crossover', 3, 12, 15), x('lateral-raise', 3, 12, 20),
        x('rope-pushdown', 3, 10, 15)]),
      s('pull-a', 'Pull A', [x('barbell-row', 3, 6, 10), x('lat-pulldown', 3, 8, 12), x('face-pull', 2, 12, 20), x('dumbbell-shrug', 2, 10, 15),
        x('ez-bar-curl', 3, 8, 12), x('hammer-curl', 2, 10, 15)]),
      s('legs-a', 'Legs A', [x('back-squat', 3, 5, 8), x('romanian-deadlift', 3, 8, 12), x('leg-extension', 3, 10, 15), x('lying-leg-curl', 2, 10, 15),
        x('standing-calf-raise', 3, 10, 15), x('cable-crunch', 3, 10, 15)]),
      s('push-b', 'Push B', [x('incline-dumbbell-press', 3, 8, 12), x('machine-chest-press', 3, 10, 15), x('pec-deck', 2, 12, 15), x('cable-lateral-raise', 3, 12, 20),
        x('overhead-cable-extension', 3, 10, 15)]),
      s('pull-b', 'Pull B', [x('pull-up', 3, 6, 10), x('chest-supported-dumbbell-row', 3, 8, 12), x('seated-cable-row', 3, 8, 12), x('reverse-pec-deck', 2, 12, 20),
        x('incline-dumbbell-curl', 3, 10, 15)]),
      s('legs-b', 'Legs B', [x('hack-squat', 4, 8, 12), x('hip-thrust', 3, 8, 12), x('seated-leg-curl', 3, 10, 15), x('seated-calf-raise', 3, 12, 20),
        x('hanging-leg-raise', 3, 10, 15)]),
    ],
  },
  {
    id: 'pair6', name: 'Paired muscles 6-day', days: 6, style: 'paired', level: 'advanced', equipment: 'gym',
    suits: 'Chest with back, shoulders with arms, then legs; six days.',
    bullets: ['Rest one day a week; the order matters, not the weekday.', DELOAD_6],
    sessions: [
      s('chest-back-a', 'Chest & back A', [x('bench-press', 3, 6, 10), x('pull-up', 3, 6, 10), x('incline-dumbbell-press', 3, 8, 12), x('barbell-row', 3, 6, 10),
        x('cable-crossover', 2, 12, 15)]),
      s('shoulders-arms-a', 'Shoulders & arms A', [x('overhead-press', 3, 6, 10), x('lateral-raise', 3, 12, 20), x('ez-bar-curl', 3, 8, 12), x('skull-crusher', 3, 8, 12),
        x('hammer-curl', 2, 10, 15)]),
      s('legs-a', 'Legs A', [x('back-squat', 3, 6, 10), x('romanian-deadlift', 3, 8, 12), x('leg-extension', 3, 10, 15), x('lying-leg-curl', 2, 10, 15),
        x('standing-calf-raise', 3, 10, 15), x('cable-crunch', 3, 10, 15)]),
      s('chest-back-b', 'Chest & back B', [x('dumbbell-bench-press', 3, 8, 12), x('lat-pulldown', 3, 8, 12), x('pec-deck', 2, 12, 15), x('seated-cable-row', 3, 8, 12),
        x('dumbbell-shrug', 2, 10, 15)]),
      s('shoulders-arms-b', 'Shoulders & arms B', [x('cable-lateral-raise', 3, 12, 20), x('reverse-pec-deck', 3, 12, 20), x('incline-dumbbell-curl', 3, 10, 15),
        x('overhead-cable-extension', 3, 10, 15), x('rope-pushdown', 2, 10, 15)]),
      s('legs-b', 'Legs B', [x('hack-squat', 4, 8, 12), x('hip-thrust', 3, 8, 12), x('seated-leg-curl', 3, 10, 15), x('seated-calf-raise', 3, 12, 20),
        x('hanging-leg-raise', 3, 10, 15)]),
    ],
  },
].map((sp) => Object.freeze({ ...sp, bullets: Object.freeze(sp.bullets), sessions: Object.freeze(sp.sessions) })));

/** @param {string} id @returns {object|null} */
export function splitById(id) {
  return SPLITS.find((sp) => sp.id === id) || null;
}
