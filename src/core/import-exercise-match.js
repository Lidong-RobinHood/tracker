// Match exercise names from a pasted sheet to the exercise library. Pure, no DOM.
//
// Order: remembered mapping (from earlier imports) → exact name → alias table → same name without
// the "(Barbell)" style suffix / plural → fuzzy similarity. Names are compared case-, accent-,
// spacing- and punctuation-insensitively ("Bench-Press", "bench press", "BENCHPRESS" are equal).

/** Lower case, no accents (ß → ss), "&" → and, punctuation → space, single spaces. */
export function normaliseName(s) {
  return String(s ?? '').toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Key without spaces: "Bench Press" → "benchpress". Used for saved mappings and aliases. */
export function nameKey(s) {
  return normaliseName(s).replace(/ /g, '');
}

/** Without a trailing "(…)" qualifier: "Bench Press (Barbell)" → "Bench Press". */
const baseName = (n) => String(n).replace(/\s*\([^)]*\)\s*$/, '');
/** Singular-ish key: drop a plural "s"/"es" at the end of each word. */
const singularKey = (s) => normaliseName(s).split(' ').map((w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w)).join('');

/**
 * Common names, abbreviations and German gym terms → seed exercise id (slug without "seed:").
 * Written as people type them; keys are normalised with nameKey() at load.
 */
const ALIAS_LIST = {
  'bench-press': ['Benchpress', 'Bench', 'BP', 'Flat Bench', 'Barbell Bench', 'BB Bench', 'Bankdrücken', 'Flachbank', 'Flachbankdrücken', 'LH Bankdrücken'],
  'incline-bench-press': ['Incline Bench', 'Incline Benchpress', 'Incline BB Press', 'Schrägbank', 'Schrägbankdrücken', 'LH Schrägbank'],
  'dumbbell-bench-press': ['DB Bench', 'DB Bench Press', 'Dumbbell Bench', 'KH Bankdrücken', 'Kurzhantel Bankdrücken'],
  'incline-dumbbell-press': ['Incline DB', 'Incline DB Press', 'Incline Dumbbell Press', 'KH Schrägbank', 'Kurzhantel Schrägbankdrücken', 'Schrägbank KH'],
  'dumbbell-fly': ['Flys', 'Flyes', 'DB Fly', 'Fliegende', 'KH Fliegende'],
  'pec-deck': ['Butterfly', 'Pec Deck', 'Peck Deck', 'Machine Fly'],
  'cable-crossover': ['Cable Cross', 'Crossover', 'Kabelzug Crossover', 'Cable Fly'],
  'push-up': ['Pushups', 'Push ups', 'Liegestütz', 'Liegestütze'],
  dip: ['Dips', 'Barrendips', 'Chest Dips'],
  'pull-up': ['Pullups', 'Pull ups', 'Klimmzug', 'Klimmzüge'],
  'chin-up': ['Chinups', 'Chin ups'],
  'lat-pulldown': ['Lat Pulldown', 'Pulldown', 'Latzug', 'Lat Pull'],
  'barbell-row': ['Barbell Row', 'BB Row', 'Bent Over Row', 'Langhantelrudern', 'LH Rudern', 'Vorgebeugtes Rudern'],
  'dumbbell-row': ['DB Row', 'One Arm Row', 'Kurzhantelrudern', 'KH Rudern', 'Einarmiges Rudern'],
  't-bar-row': ['T Bar', 'TBar Row', 'T-Bar Rudern'],
  'seated-cable-row': ['Cable Row', 'Seated Row', 'Kabelrudern', 'Rudern am Kabel'],
  deadlift: ['Deadlift', 'DL', 'Kreuzheben', 'Conventional Deadlift'],
  'romanian-deadlift': ['RDL', 'RDLs', 'Romanian DL', 'Rumänisches Kreuzheben', 'Stiff Leg Deadlift', 'SLDL'],
  'overhead-press': ['OHP', 'Overhead Press', 'Military Press', 'Shoulder Press', 'Schulterdrücken', 'LH Schulterdrücken', 'Military'],
  'seated-dumbbell-press': ['DB Shoulder Press', 'KH Schulterdrücken', 'Seated DB Press'],
  'machine-shoulder-press': ['Schulterpresse', 'Shoulder Press Machine'],
  'arnold-press': ['Arnold'],
  'lateral-raise': ['Lateral Raises', 'Lat Raise', 'Lat Raises', 'Side Raise', 'Side Raises', 'Seitheben', 'Seitliches Heben'],
  'cable-lateral-raise': ['Cable Lateral', 'Seitheben Kabel'],
  'face-pull': ['Facepull', 'Facepulls', 'Face Pulls'],
  'rear-delt-fly': ['Rear Delt', 'Rear Delts', 'Reverse Fly', 'Reverse Flys'],
  'barbell-curl': ['Curl', 'Curls', 'Biceps Curl', 'Bicep Curl', 'Bizepscurl', 'Bizeps Curls', 'BB Curl', 'Langhantelcurl', 'LH Curl'],
  'dumbbell-curl': ['DB Curl', 'DB Curls', 'Kurzhantelcurl', 'KH Curl', 'KH Curls'],
  'ez-bar-curl': ['EZ Curl', 'SZ Curl', 'SZ Curls'],
  'hammer-curl': ['Hammer Curls', 'Hammer', 'Hammercurls'],
  'preacher-curl': ['Preacher', 'Scott Curl', 'Scottcurls', 'Scott Curls'],
  'triceps-pushdown': ['Pushdown', 'Pushdowns', 'Triceps Pushdown', 'Tricep Pushdown', 'Trizepsdrücken', 'Trizeps Pushdown', 'Trizepsdrücken am Kabel'],
  'rope-pushdown': ['Rope Pushdown', 'Rope Pushdowns', 'Seil Trizepsdrücken'],
  'skull-crusher': ['Skullcrusher', 'Skullcrushers', 'Skull Crushers', 'French Press', 'Stirndrücken', 'Frenchpress'],
  'close-grip-bench-press': ['CGBP', 'Close Grip Bench', 'Enges Bankdrücken'],
  'back-squat': ['Squat', 'Squats', 'Back Squat', 'BB Squat', 'Kniebeuge', 'Kniebeugen', 'LH Kniebeuge'],
  'front-squat': ['Front Squats', 'Frontkniebeuge', 'Frontkniebeugen'],
  'hack-squat': ['Hacksquat', 'Hackenschmidt'],
  'goblet-squat': ['Goblet', 'Goblet Squats'],
  'leg-press': ['Legpress', 'Beinpresse'],
  'leg-extension': ['Leg Extensions', 'Leg Ext', 'Beinstrecker', 'Beinstrecken'],
  'lying-leg-curl': ['Leg Curl', 'Leg Curls', 'Lying Curl', 'Beinbeuger', 'Beinbeuger liegend', 'Liegender Beinbeuger'],
  'seated-leg-curl': ['Seated Leg Curls', 'Beinbeuger sitzend', 'Sitzender Beinbeuger'],
  'hip-thrust': ['Hip Thrusts', 'Hipthrust', 'Hipthrusts'],
  'bulgarian-split-squat': ['BSS', 'Bulgarian', 'Bulgarians', 'Bulgarian Split Squats', 'Bulgarische Kniebeuge'],
  'walking-lunge': ['Lunges', 'Lunge', 'Walking Lunges', 'Ausfallschritte', 'Ausfallschritt'],
  'standing-calf-raise': ['Calf Raise', 'Calf Raises', 'Calves', 'Wadenheben', 'Waden'],
  'seated-calf-raise': ['Seated Calf Raises', 'Wadenheben sitzend'],
  'hanging-leg-raise': ['Leg Raise', 'Leg Raises', 'Hanging Leg Raises', 'Beinheben'],
  crunch: ['Crunches'],
  plank: ['Planks', 'Unterarmstütz'],
  'barbell-shrug': ['Shrug', 'Shrugs', 'Schulterheben'],
  'trap-bar-deadlift': ['Trap Bar', 'Hex Bar', 'Hexbar Deadlift'],
  'hip-abduction': ['Abductor', 'Abduction', 'Abduktor', 'Abduktoren'],
  'back-extension': ['Hyperextension', 'Hyperextensions', 'Rückenstrecker'],
  'machine-chest-press': ['Chest Press', 'Brustpresse'],
};

/** nameKey → seed id */
export const ALIASES = (() => {
  const m = new Map();
  for (const [slug, names] of Object.entries(ALIAS_LIST)) for (const n of names) m.set(nameKey(n), `seed:${slug}`);
  return m;
})();

const EQUIPMENT_RANK = { barbell: 0, machine: 1, dumbbell: 2, cable: 3, bodyweight: 4, other: 5 };

/** Sørensen–Dice similarity of character bigrams (0…1). */
export function similarity(a, b) {
  const A = nameKey(a); const B = nameKey(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const ga = grams(A); const gb = grams(B);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) || 0);
  return (2 * hit) / (A.length - 1 + B.length - 1);
}

/**
 * Propose a library exercise for a pasted name.
 * @param {string} name
 * @param {object[]} exercises library records ({id, name, equipment, archived})
 * @param {Record<string, string>} [saved] remembered mappings: nameKey → exercise id
 * @returns {{exerciseId: string|null, confidence: 'saved'|'exact'|'alias'|'high'|'medium'|'low'|'none',
 *   score: number, candidates: {id: string, name: string, score: number}[]}}
 */
export function matchExercise(name, exercises, saved = {}) {
  const key = nameKey(name);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const active = exercises.filter((e) => !e.archived);
  const result = (ex, confidence, score) => ({ exerciseId: ex ? ex.id : null, confidence, score, candidates: candidates() });
  function candidates() {
    return active.map((e) => ({ id: e.id, name: e.name, score: Math.max(similarity(name, e.name), similarity(name, baseName(e.name))) }))
      .sort((a, b) => b.score - a.score).slice(0, 3);
  }
  const savedId = saved && saved[key];
  if (savedId && byId.has(savedId)) return result(byId.get(savedId), 'saved', 1);

  const exact = exercises.find((e) => nameKey(e.name) === key && !e.archived) || exercises.find((e) => nameKey(e.name) === key);
  if (exact) return result(exact, 'exact', 1);

  const aliasId = ALIASES.get(key) || ALIASES.get(singularKey(name));
  if (aliasId && byId.has(aliasId) && !byId.get(aliasId).archived) return result(byId.get(aliasId), 'alias', 0.95);

  const rank = (list) => list.sort((a, b) => (EQUIPMENT_RANK[a.equipment] ?? 9) - (EQUIPMENT_RANK[b.equipment] ?? 9) || a.name.localeCompare(b.name))[0];
  const sk = singularKey(name);
  const base = active.filter((e) => nameKey(baseName(e.name)) === key || singularKey(baseName(e.name)) === sk || singularKey(e.name) === sk);
  if (base.length) return result(rank(base), 'high', 0.9);

  let best = null; let bestScore = 0;
  for (const e of active) {
    const sc = Math.max(similarity(name, e.name), similarity(name, baseName(e.name)));
    if (sc > bestScore) { best = e; bestScore = sc; }
  }
  if (best && bestScore >= 0.8) return result(best, 'medium', bestScore);
  if (best && bestScore >= 0.6) return result(best, 'low', bestScore);
  return result(null, 'none', bestScore);
}

/** Human label for a confidence value. */
export function confidenceLabel(c) {
  return {
    saved: 'Your earlier choice', exact: 'Exact name', alias: 'Known name', high: 'Very likely',
    medium: 'Likely – please check', low: 'Unsure – please check', none: 'No match',
  }[c] || c;
}
