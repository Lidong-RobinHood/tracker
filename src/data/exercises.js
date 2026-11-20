// Seed exercise library. Ids are stable ('seed:<slug>') and must never change once shipped.
// Seeded into the `exercises` store by db.seedExercises(); existing records are never overwritten.
// Bump SEED_VERSION when adding exercises so existing installs pick up the new ones.

export const SEED_VERSION = 1;

/**
 * Default kg step per equipment type. Dumbbells: 2.5 (was 2 until Nov 2026; 32.5 + 2 = 34.5 is not a
 * real dumbbell). Existing installs: src/workout/data.js migrates seeded dumbbell exercises the user
 * never edited; user-edited increments are kept.
 */
export const DEFAULT_INCREMENT = Object.freeze({
  barbell: 2.5, dumbbell: 2.5, machine: 5, cable: 2.5, bodyweight: 2.5, other: 2.5,
});

/**
 * The common base lifts: among equally good search matches (and equal usage) the picker lists
 * these first, e.g. "bench" → Bench Press before Bench Dip.
 */
export const BASE_LIFTS = Object.freeze(new Set([
  'seed:bench-press', 'seed:incline-bench-press', 'seed:dumbbell-bench-press', 'seed:incline-dumbbell-press',
  'seed:overhead-press', 'seed:back-squat', 'seed:front-squat', 'seed:deadlift', 'seed:romanian-deadlift',
  'seed:barbell-row', 'seed:dumbbell-row', 'seed:pull-up', 'seed:chin-up', 'seed:lat-pulldown', 'seed:dip',
  'seed:leg-press', 'seed:hip-thrust', 'seed:barbell-curl', 'seed:lateral-raise', 'seed:seated-cable-row',
]));

/**
 * @param {string} slug @param {string} name @param {string} equipment
 * @param {string[]} primary @param {string[]} [secondary] @param {number} [increment]
 */
const ex = (slug, name, equipment, primary, secondary = [], increment = DEFAULT_INCREMENT[equipment]) =>
  Object.freeze({ id: `seed:${slug}`, name, primary, secondary, equipment, increment });

/** @type {ReadonlyArray<{id: string, name: string, primary: string[], secondary: string[], equipment: string, increment: number}>} */
export const SEED_EXERCISES = Object.freeze([
  // Chest
  ex('bench-press', 'Bench Press (Barbell)', 'barbell', ['chest'], ['triceps', 'shoulders']),
  ex('incline-bench-press', 'Incline Bench Press (Barbell)', 'barbell', ['chest'], ['shoulders', 'triceps']),
  ex('decline-bench-press', 'Decline Bench Press (Barbell)', 'barbell', ['chest'], ['triceps']),
  ex('dumbbell-bench-press', 'Bench Press (Dumbbell)', 'dumbbell', ['chest'], ['triceps', 'shoulders']),
  ex('incline-dumbbell-press', 'Incline Press (Dumbbell)', 'dumbbell', ['chest'], ['shoulders', 'triceps']),
  ex('dumbbell-fly', 'Chest Fly (Dumbbell)', 'dumbbell', ['chest']),
  ex('incline-dumbbell-fly', 'Incline Fly (Dumbbell)', 'dumbbell', ['chest'], ['shoulders']),
  ex('machine-chest-press', 'Chest Press (Machine)', 'machine', ['chest'], ['triceps', 'shoulders']),
  ex('incline-machine-press', 'Incline Chest Press (Machine)', 'machine', ['chest'], ['shoulders', 'triceps']),
  ex('smith-incline-press', 'Incline Press (Smith Machine)', 'machine', ['chest'], ['shoulders', 'triceps'], 2.5),
  ex('pec-deck', 'Pec Deck (Machine Fly)', 'machine', ['chest']),
  ex('cable-crossover', 'Cable Crossover', 'cable', ['chest']),
  ex('low-to-high-cable-fly', 'Low-to-High Cable Fly', 'cable', ['chest'], ['shoulders']),
  ex('push-up', 'Push-Up', 'bodyweight', ['chest'], ['triceps', 'shoulders']),
  ex('dip', 'Dip (Chest)', 'bodyweight', ['chest'], ['triceps', 'shoulders']),

  // Back
  ex('pull-up', 'Pull-Up', 'bodyweight', ['back'], ['biceps', 'forearms']),
  ex('neutral-grip-pull-up', 'Neutral-Grip Pull-Up', 'bodyweight', ['back'], ['biceps', 'forearms']),
  ex('chin-up', 'Chin-Up', 'bodyweight', ['back'], ['biceps', 'forearms']),
  ex('assisted-pull-up', 'Assisted Pull-Up (Machine)', 'machine', ['back'], ['biceps']),
  ex('lat-pulldown', 'Lat Pulldown (Wide Grip)', 'cable', ['back'], ['biceps']),
  ex('close-grip-lat-pulldown', 'Lat Pulldown (Close Neutral Grip)', 'cable', ['back'], ['biceps']),
  ex('single-arm-lat-pulldown', 'Single-Arm Lat Pulldown', 'cable', ['back'], ['biceps']),
  ex('straight-arm-pulldown', 'Straight-Arm Pulldown', 'cable', ['back']),
  ex('barbell-row', 'Bent-Over Row (Barbell)', 'barbell', ['back'], ['biceps', 'shoulders', 'forearms']),
  ex('pendlay-row', 'Pendlay Row', 'barbell', ['back'], ['biceps', 'shoulders']),
  ex('t-bar-row', 'T-Bar Row', 'barbell', ['back'], ['biceps', 'shoulders']),
  ex('dumbbell-row', 'One-Arm Row (Dumbbell)', 'dumbbell', ['back'], ['biceps', 'shoulders']),
  ex('chest-supported-dumbbell-row', 'Chest-Supported Row (Dumbbell)', 'dumbbell', ['back'], ['biceps', 'shoulders']),
  ex('seated-cable-row', 'Seated Cable Row', 'cable', ['back'], ['biceps', 'shoulders']),
  ex('machine-row', 'Seated Row (Machine)', 'machine', ['back'], ['biceps', 'shoulders']),
  ex('meadows-row', 'Meadows Row', 'barbell', ['back'], ['biceps', 'shoulders']),
  ex('inverted-row', 'Inverted Row', 'bodyweight', ['back'], ['biceps', 'shoulders']),
  ex('deadlift', 'Deadlift (Barbell)', 'barbell', ['back', 'glutes', 'hamstrings'], ['quads', 'traps', 'forearms']),
  ex('trap-bar-deadlift', 'Trap Bar Deadlift', 'barbell', ['quads', 'glutes', 'back'], ['hamstrings', 'traps', 'forearms']),
  ex('rack-pull', 'Rack Pull', 'barbell', ['back', 'traps'], ['glutes', 'hamstrings', 'forearms']),
  ex('back-extension', 'Back Extension', 'bodyweight', ['back'], ['glutes', 'hamstrings']),

  // Traps
  ex('barbell-shrug', 'Shrug (Barbell)', 'barbell', ['traps'], ['forearms']),
  ex('dumbbell-shrug', 'Shrug (Dumbbell)', 'dumbbell', ['traps'], ['forearms']),
  ex('farmers-carry', "Farmer's Carry", 'dumbbell', ['forearms', 'traps'], ['abs']),

  // Shoulders
  ex('overhead-press', 'Overhead Press (Barbell)', 'barbell', ['shoulders'], ['triceps', 'traps']),
  ex('seated-dumbbell-press', 'Seated Shoulder Press (Dumbbell)', 'dumbbell', ['shoulders'], ['triceps']),
  ex('arnold-press', 'Arnold Press', 'dumbbell', ['shoulders'], ['triceps']),
  ex('machine-shoulder-press', 'Shoulder Press (Machine)', 'machine', ['shoulders'], ['triceps']),
  ex('landmine-press', 'Landmine Press', 'barbell', ['shoulders'], ['chest', 'triceps']),
  ex('lateral-raise', 'Lateral Raise (Dumbbell)', 'dumbbell', ['shoulders'], [], 1),
  ex('cable-lateral-raise', 'Lateral Raise (Cable)', 'cable', ['shoulders'], [], 1.25),
  ex('machine-lateral-raise', 'Lateral Raise (Machine)', 'machine', ['shoulders'], [], 2.5),
  ex('front-raise', 'Front Raise (Dumbbell)', 'dumbbell', ['shoulders'], [], 1),
  ex('rear-delt-fly', 'Rear Delt Fly (Dumbbell)', 'dumbbell', ['shoulders'], ['traps'], 1),
  ex('reverse-pec-deck', 'Reverse Pec Deck', 'machine', ['shoulders'], ['traps'], 2.5),
  ex('face-pull', 'Face Pull', 'cable', ['shoulders'], ['traps']),
  ex('upright-row', 'Upright Row (Cable)', 'cable', ['shoulders', 'traps'], ['biceps']),

  // Biceps
  ex('barbell-curl', 'Curl (Barbell)', 'barbell', ['biceps'], ['forearms'], 1.25),
  ex('ez-bar-curl', 'Curl (EZ Bar)', 'barbell', ['biceps'], ['forearms'], 1.25),
  ex('dumbbell-curl', 'Curl (Dumbbell)', 'dumbbell', ['biceps'], ['forearms']),
  ex('hammer-curl', 'Hammer Curl (Dumbbell)', 'dumbbell', ['biceps'], ['forearms']),
  ex('incline-dumbbell-curl', 'Incline Curl (Dumbbell)', 'dumbbell', ['biceps']),
  ex('preacher-curl', 'Preacher Curl (EZ Bar)', 'barbell', ['biceps'], [], 1.25),
  ex('machine-preacher-curl', 'Preacher Curl (Machine)', 'machine', ['biceps'], [], 2.5),
  ex('cable-curl', 'Curl (Cable)', 'cable', ['biceps'], ['forearms']),
  ex('bayesian-cable-curl', 'Bayesian Curl (Cable)', 'cable', ['biceps'], [], 1.25),
  ex('concentration-curl', 'Concentration Curl', 'dumbbell', ['biceps'], [], 1),
  ex('spider-curl', 'Spider Curl', 'dumbbell', ['biceps'], [], 1),

  // Triceps
  ex('close-grip-bench-press', 'Close-Grip Bench Press', 'barbell', ['triceps'], ['chest', 'shoulders']),
  ex('triceps-pushdown', 'Triceps Pushdown (Bar)', 'cable', ['triceps']),
  ex('rope-pushdown', 'Triceps Pushdown (Rope)', 'cable', ['triceps']),
  ex('overhead-cable-extension', 'Overhead Triceps Extension (Cable)', 'cable', ['triceps']),
  ex('overhead-dumbbell-extension', 'Overhead Triceps Extension (Dumbbell)', 'dumbbell', ['triceps']),
  ex('skull-crusher', 'Skull Crusher (EZ Bar)', 'barbell', ['triceps'], [], 1.25),
  ex('dumbbell-kickback', 'Triceps Kickback (Dumbbell)', 'dumbbell', ['triceps'], [], 1),
  ex('machine-dip', 'Seated Dip (Machine)', 'machine', ['triceps'], ['chest']),
  ex('bench-dip', 'Bench Dip', 'bodyweight', ['triceps'], ['chest', 'shoulders']),

  // Forearms
  ex('wrist-curl', 'Wrist Curl (Barbell)', 'barbell', ['forearms'], [], 1.25),
  ex('reverse-wrist-curl', 'Reverse Wrist Curl (Barbell)', 'barbell', ['forearms'], [], 1.25),
  ex('reverse-curl', 'Reverse Curl (EZ Bar)', 'barbell', ['forearms'], ['biceps'], 1.25),

  // Abs
  ex('crunch', 'Crunch', 'bodyweight', ['abs']),
  ex('cable-crunch', 'Cable Crunch', 'cable', ['abs']),
  ex('machine-crunch', 'Crunch (Machine)', 'machine', ['abs']),
  ex('hanging-leg-raise', 'Hanging Leg Raise', 'bodyweight', ['abs'], ['forearms']),
  ex('ab-wheel-rollout', 'Ab Wheel Rollout', 'other', ['abs'], ['back']),
  ex('decline-sit-up', 'Decline Sit-Up', 'bodyweight', ['abs']),
  ex('plank', 'Plank', 'bodyweight', ['abs']),

  // Quads / glutes
  ex('back-squat', 'Squat (Barbell)', 'barbell', ['quads', 'glutes'], ['hamstrings', 'back']),
  ex('front-squat', 'Front Squat (Barbell)', 'barbell', ['quads'], ['glutes', 'back', 'abs']),
  ex('smith-squat', 'Squat (Smith Machine)', 'machine', ['quads', 'glutes'], ['hamstrings'], 2.5),
  ex('hack-squat', 'Hack Squat (Machine)', 'machine', ['quads'], ['glutes']),
  ex('pendulum-squat', 'Pendulum Squat (Machine)', 'machine', ['quads'], ['glutes']),
  ex('leg-press', 'Leg Press', 'machine', ['quads', 'glutes'], ['hamstrings']),
  ex('goblet-squat', 'Goblet Squat', 'dumbbell', ['quads', 'glutes'], ['abs']),
  ex('bulgarian-split-squat', 'Bulgarian Split Squat (Dumbbell)', 'dumbbell', ['quads', 'glutes'], ['hamstrings']),
  ex('walking-lunge', 'Walking Lunge (Dumbbell)', 'dumbbell', ['quads', 'glutes'], ['hamstrings']),
  ex('step-up', 'Step-Up (Dumbbell)', 'dumbbell', ['quads', 'glutes']),
  ex('leg-extension', 'Leg Extension', 'machine', ['quads']),
  ex('hip-thrust', 'Hip Thrust (Barbell)', 'barbell', ['glutes'], ['hamstrings']),
  ex('glute-bridge', 'Glute Bridge (Barbell)', 'barbell', ['glutes'], ['hamstrings']),
  ex('cable-kickback', 'Glute Kickback (Cable)', 'cable', ['glutes'], ['hamstrings'], 1.25),
  ex('hip-abduction', 'Hip Abduction (Machine)', 'machine', ['glutes']),

  // Hamstrings
  ex('romanian-deadlift', 'Romanian Deadlift (Barbell)', 'barbell', ['hamstrings', 'glutes'], ['back', 'forearms']),
  ex('dumbbell-romanian-deadlift', 'Romanian Deadlift (Dumbbell)', 'dumbbell', ['hamstrings', 'glutes'], ['back', 'forearms']),
  ex('good-morning', 'Good Morning', 'barbell', ['hamstrings'], ['glutes', 'back']),
  ex('lying-leg-curl', 'Lying Leg Curl', 'machine', ['hamstrings'], ['calves']),
  ex('seated-leg-curl', 'Seated Leg Curl', 'machine', ['hamstrings']),
  ex('nordic-curl', 'Nordic Hamstring Curl', 'bodyweight', ['hamstrings']),

  // Calves
  ex('standing-calf-raise', 'Standing Calf Raise (Machine)', 'machine', ['calves']),
  ex('seated-calf-raise', 'Seated Calf Raise (Machine)', 'machine', ['calves']),
  ex('leg-press-calf-raise', 'Calf Raise (Leg Press)', 'machine', ['calves']),
  ex('single-leg-calf-raise', 'Single-Leg Calf Raise (Dumbbell)', 'dumbbell', ['calves']),
]);

// ---------------------------------------------------------------- movement patterns and gear
// Used by the split library's swap list (src/core/splits.js alternatives()). Kept apart from the seed
// records on purpose: nothing here is stored in the database; custom exercises have no entry and fall
// back to the muscle rule.

/** Movement pattern of every seed exercise (id → pattern). */
export const EXERCISE_PATTERN = Object.freeze(Object.fromEntries(Object.entries({
  'press-horizontal': ['bench-press', 'decline-bench-press', 'dumbbell-bench-press', 'machine-chest-press', 'push-up', 'dip'],
  'press-incline': ['incline-bench-press', 'incline-dumbbell-press', 'incline-machine-press', 'smith-incline-press'],
  fly: ['dumbbell-fly', 'incline-dumbbell-fly', 'pec-deck', 'cable-crossover', 'low-to-high-cable-fly'],
  'pull-vertical': ['pull-up', 'neutral-grip-pull-up', 'chin-up', 'assisted-pull-up', 'lat-pulldown', 'close-grip-lat-pulldown', 'single-arm-lat-pulldown'],
  pullover: ['straight-arm-pulldown'],
  row: ['barbell-row', 'pendlay-row', 't-bar-row', 'dumbbell-row', 'chest-supported-dumbbell-row', 'seated-cable-row', 'machine-row', 'meadows-row', 'inverted-row'],
  hinge: ['deadlift', 'trap-bar-deadlift', 'rack-pull', 'romanian-deadlift', 'dumbbell-romanian-deadlift', 'good-morning', 'back-extension'],
  shrug: ['barbell-shrug', 'dumbbell-shrug'],
  carry: ['farmers-carry'],
  'press-vertical': ['overhead-press', 'seated-dumbbell-press', 'arnold-press', 'machine-shoulder-press', 'landmine-press'],
  'raise-lateral': ['lateral-raise', 'cable-lateral-raise', 'machine-lateral-raise'],
  'upright-row': ['upright-row'],
  'raise-front': ['front-raise'],
  'rear-delt': ['rear-delt-fly', 'reverse-pec-deck', 'face-pull'],
  curl: ['barbell-curl', 'ez-bar-curl', 'dumbbell-curl', 'hammer-curl', 'incline-dumbbell-curl', 'preacher-curl', 'machine-preacher-curl', 'cable-curl', 'bayesian-cable-curl', 'concentration-curl', 'spider-curl'],
  'triceps-press': ['close-grip-bench-press', 'machine-dip', 'bench-dip'],
  'triceps-extension': ['triceps-pushdown', 'rope-pushdown', 'overhead-cable-extension', 'overhead-dumbbell-extension', 'skull-crusher', 'dumbbell-kickback'],
  forearm: ['wrist-curl', 'reverse-wrist-curl', 'reverse-curl'],
  'ab-flexion': ['crunch', 'cable-crunch', 'machine-crunch', 'hanging-leg-raise', 'decline-sit-up'],
  'ab-brace': ['ab-wheel-rollout', 'plank'],
  squat: ['back-squat', 'front-squat', 'smith-squat', 'hack-squat', 'pendulum-squat', 'leg-press', 'goblet-squat'],
  lunge: ['bulgarian-split-squat', 'walking-lunge', 'step-up'],
  'leg-extension': ['leg-extension'],
  'hip-thrust': ['hip-thrust', 'glute-bridge'],
  'glute-isolation': ['cable-kickback', 'hip-abduction'],
  'leg-curl': ['lying-leg-curl', 'seated-leg-curl', 'nordic-curl'],
  calf: ['standing-calf-raise', 'seated-calf-raise', 'leg-press-calf-raise', 'single-leg-calf-raise'],
}).flatMap(([pattern, slugs]) => slugs.map((slug) => [`seed:${slug}`, pattern]))));

/** Patterns a lifter accepts as a second choice for a pattern (shown after the same pattern). */
export const RELATED_PATTERNS = Object.freeze({
  'press-horizontal': ['press-incline'], 'press-incline': ['press-horizontal'], fly: [],
  'pull-vertical': ['pullover', 'row'], pullover: ['pull-vertical'], row: ['pull-vertical'],
  hinge: ['hip-thrust'], shrug: ['carry'], carry: ['shrug'],
  'press-vertical': [], 'raise-lateral': ['upright-row'], 'upright-row': ['raise-lateral', 'shrug'], 'raise-front': [],
  'rear-delt': [], curl: [], 'triceps-press': ['triceps-extension'], 'triceps-extension': ['triceps-press'], forearm: ['curl'],
  'ab-flexion': ['ab-brace'], 'ab-brace': ['ab-flexion'], squat: ['lunge'], lunge: ['squat'], 'leg-extension': [],
  'hip-thrust': ['hinge', 'glute-isolation'], 'glute-isolation': ['hip-thrust'], 'leg-curl': [], calf: [],
});

/**
 * Gear a seed exercise needs beyond the floor, when it differs from its equipment type
 * (barbell → barbell, dumbbell → dumbbells, machine → machine, cable → cable, bodyweight → nothing,
 * other → other). See exerciseGear().
 */
const GEAR_OVERRIDE = Object.freeze({
  'seed:dumbbell-bench-press': ['dumbbells', 'bench'], 'seed:incline-dumbbell-press': ['dumbbells', 'bench'],
  'seed:dumbbell-fly': ['dumbbells', 'bench'], 'seed:incline-dumbbell-fly': ['dumbbells', 'bench'],
  'seed:chest-supported-dumbbell-row': ['dumbbells', 'bench'], 'seed:dumbbell-row': ['dumbbells', 'bench'],
  'seed:seated-dumbbell-press': ['dumbbells', 'bench'], 'seed:incline-dumbbell-curl': ['dumbbells', 'bench'],
  'seed:spider-curl': ['dumbbells', 'bench'], 'seed:bulgarian-split-squat': ['dumbbells', 'bench'], 'seed:step-up': ['dumbbells', 'bench'],
  'seed:dip': ['dip-bars'], 'seed:pull-up': ['pull-up-bar'], 'seed:neutral-grip-pull-up': ['pull-up-bar'], 'seed:chin-up': ['pull-up-bar'],
  'seed:hanging-leg-raise': ['pull-up-bar'], 'seed:inverted-row': ['low-bar'], 'seed:back-extension': ['back-extension-bench'],
  'seed:bench-dip': ['bench'], 'seed:decline-sit-up': ['decline-bench'], 'seed:nordic-curl': ['anchor'], 'seed:ab-wheel-rollout': ['ab-wheel'],
});
const GEAR_BY_EQUIPMENT = Object.freeze({ barbell: ['barbell'], dumbbell: ['dumbbells'], machine: ['machine'], cable: ['cable'], bodyweight: [], other: ['other'] });

/** What a home split assumes: dumbbells, a bench and a pull-up bar. */
export const HOME_GEAR = Object.freeze(['dumbbells', 'bench', 'pull-up-bar']);

/** Gear an exercise needs (seed override, else from its equipment type). @returns {readonly string[]} */
export function exerciseGear(ex) {
  if (!ex) return ['other'];
  return GEAR_OVERRIDE[ex.id] || GEAR_BY_EQUIPMENT[ex.equipment] || ['other'];
}

/** True when the exercise needs nothing beyond HOME_GEAR. */
export function fitsHome(ex) {
  return exerciseGear(ex).every((g) => HOME_GEAR.includes(g));
}
