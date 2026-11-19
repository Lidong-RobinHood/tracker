import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkoutText, classifyLine, exerciseNames, buildWorkoutRecords, plausibleTimes } from '../src/core/import-workouts.js';
import { matchExercise, nameKey, normaliseName, ALIASES, similarity } from '../src/core/import-exercise-match.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';
import { lastEntryFor, prefillSets } from '../src/core/workout.js';

const T = '2026-11-19';
const parse = (text, o = {}) => parseWorkoutText(text, { today: T, ...o });
const sets = (e) => e.sets.map((s) => [s.weight, s.reps, s.type]);

// The owner's sheet as copied from Google Sheets: tabs, trailing empty cells, CRLF, blank lines.
const SHEET = [
  '12.11.2026\t\t', 'Push\t\t', '', 'Benchpress\t\t', '3 x 6\t\t', '100\t7\t', '100\t8\t', '100\t8\t', 'Dropset 5x 80\t\t',
  '', '', 'Incline DB\t\t', '3x8-10', '32,5\t9', '32,5\t8', '30\t10', 'Dips', '3 × 10', '12', '10', 'BW 9',
  'Mon 16 Nov', 'Pull', 'Pullups', '3 x 6', '+10  6', '+10 kg x 5', '6', 'Gewicht\tWdh', 'RDL', '3 x 8', '120  8', 'DS 5x80',
].join('\r\n');

test('the owner sheet: two workouts with names, dates, targets, sets and dropsets', () => {
  const r = parse(SHEET);
  assert.equal(r.fatal, null);
  assert.equal(r.workouts.length, 2);
  const [push, pull] = r.workouts;
  assert.equal(push.date, '2026-11-12');
  assert.equal(push.name, 'Push');
  assert.deepEqual(push.exercises.map((e) => e.name), ['Benchpress', 'Incline DB', 'Dips']);
  assert.deepEqual(push.exercises[0].target, { sets: 3, reps: 6, repsMax: null });
  assert.deepEqual(sets(push.exercises[0]), [[100, 7, 'normal'], [100, 8, 'normal'], [100, 8, 'normal'], [80, 5, 'dropset']]);
  assert.deepEqual(push.exercises[1].target, { sets: 3, reps: 8, repsMax: 10 });
  assert.deepEqual(sets(push.exercises[1]), [[32.5, 9, 'normal'], [32.5, 8, 'normal'], [30, 10, 'normal']]);
  assert.deepEqual(sets(push.exercises[2]), [[null, 12, 'normal'], [null, 10, 'normal'], [null, 9, 'normal']]);
  assert.equal(pull.date, '2026-11-16');
  assert.equal(pull.name, 'Pull');
  assert.deepEqual(sets(pull.exercises[0]), [[10, 6, 'normal'], [10, 5, 'normal'], [null, 6, 'normal']]);
  assert.deepEqual(sets(pull.exercises[1]), [[120, 8, 'normal'], [80, 5, 'dropset']]);
  // the column header is reported, nothing is an error
  assert.deepEqual(r.issues.map((i) => [i.line, i.level]), [[29, 'info']]);
});

test('dropset spellings are all reps x weight', () => {
  for (const line of ['Dropset 5x 80', 'Drop 5 x 80', 'DS 5x80', 'Dropset: 5 x 80 kg', 'drop set 5x80', 'Drop 5 80', 'Dropset 5x 82,5']) {
    const c = classifyLine(line, { order: 'dmy', today: T });
    assert.equal(c.kind, 'dropset', line);
    assert.equal(c.reps, '5', line);
  }
  const r = parse('Bench\n3x6\n100 6\nDropset 5x 82,5');
  assert.deepEqual(r.workouts[0].exercises[0].sets[1], { weight: 82.5, reps: 5, type: 'dropset', line: 4 });
});

test('target spellings', () => {
  for (const [line, t] of [['3 x 6', [3, 6, null]], ['3x6', [3, 6, null]], ['3 × 6', [3, 6, null]], ['3 x 6-8', [3, 6, 8]], ['3x6–8', [3, 6, 8]], ['4*10', [4, 10, null]]]) {
    const c = classifyLine(line, { order: 'dmy', today: T });
    assert.equal(c.kind, 'target', line);
    assert.deepEqual([c.sets, c.reps, c.repsMax], t, line);
  }
});

test('name and target on one line; "a x b" after the target is a set', () => {
  const r = parse('Squat 3x5\n140 x 5\n140 x 5\n80 x 8');
  const e = r.workouts[0].exercises[0];
  assert.equal(e.name, 'Squat');
  assert.deepEqual(e.target, { sets: 3, reps: 5, repsMax: null });
  assert.deepEqual(sets(e), [[140, 5, 'normal'], [140, 5, 'normal'], [80, 8, 'normal']]);
});

test('without a target line, "80 x 8" (more than 10 "sets") is a set', () => {
  const r = parse('Curl\n20 x 10\n20 x 9');
  const e = r.workouts[0].exercises[0];
  assert.equal(e.target, null);
  assert.deepEqual(sets(e), [[20, 10, 'normal'], [20, 9, 'normal']]);
});

test('reps-then-weight switch swaps two-number rows but never dropsets', () => {
  const r = parse('Bench\n3x6\n7  100\n8 100\nDropset 5x 80', { repsFirst: true });
  assert.deepEqual(sets(r.workouts[0].exercises[0]), [[100, 7, 'normal'], [100, 8, 'normal'], [80, 5, 'dropset']]);
});

test('wrong column order shows up as line errors (decimal reps)', () => {
  const r = parse('Bench\n3x6\n82,5 8', { repsFirst: true });
  assert.equal(r.workouts.length, 0);
  const err = r.issues.find((i) => i.line === 3);
  assert.equal(err.level, 'error');
  assert.match(err.message, /whole number/);
});

test('date formats as workout separators, with names on the date line', () => {
  const text = ['2026-11-12 Push', 'Bench', '100 5', '12/11/26', 'Bench', '100 6', 'Push – 13.11.2026', 'Bench', '100 7', 'Do 12. Nov', 'Bench', '100 8'].join('\n');
  const r = parse(text);
  assert.deepEqual(r.workouts.map((w) => [w.date, w.name]), [['2026-11-12', 'Push'], ['2026-11-12', null], ['2026-11-13', 'Push'], ['2026-11-12', null]]);
});

test('workouts without dates: name lines split, date stays null (the default date is applied later)', () => {
  const r = parse('Push\nBench\n100 5\nPull\nRow\n80 8');
  assert.deepEqual(r.workouts.map((w) => [w.date, w.name, w.exercises.length]), [[null, 'Push', 1], [null, 'Pull', 1]]);
});

test('no date, no name: everything is one workout; mixed blank lines do not matter', () => {
  const r = parse('\n\nBench\n\n3x6\n100 6\n\n\n\nSquat\n3x5\n\n140 5\n\n');
  assert.equal(r.workouts.length, 1);
  assert.deepEqual(r.workouts[0].exercises.map((e) => e.name), ['Bench', 'Squat']);
});

test('side-by-side column groups are refused with line numbers and nothing is parsed', () => {
  const text = ['Benchpress\t\tSquat\t', '3 x 6\t\t3 x 5\t', '100\t7\t140\t5', '100\t8\t140\t5'].join('\n');
  const r = parse(text);
  assert.equal(r.workouts.length, 0);
  assert.match(r.fatal, /side by side.*lines 1, 2, 3, 4/);
  assert.deepEqual(r.issues.map((i) => i.line), [1, 2, 3, 4]);
});

test('two date columns side by side are refused too', () => {
  const r = parse('12.11.2026\t\t16.11.2026\nBench\t\tBench\n100\t7\t100\t8');
  assert.notEqual(r.fatal, null);
});

test('space-aligned columns (3+ spaces) with two exercise names are refused', () => {
  const r = parse('Bench        Squat\n100  7       140  5');
  assert.notEqual(r.fatal, null);
});

test('malformed lines are listed by line number and left out', () => {
  const r = parse('100 7\nBench\n3x6\n100 7 kg reps??\n100 0\n-\n100 8\nDropset 5\n31.02.2026\nfoo\n2026-12-01\nRow\n50 10');
  const byLine = Object.fromEntries(r.issues.map((i) => [i.line, i]));
  assert.match(byLine[1].message, /without an exercise/);
  assert.match(byLine[4].message, /Could not read/);
  assert.match(byLine[5].message, /Reps 0/);
  assert.match(byLine[6].message, /Could not read/);
  assert.match(byLine[8].message, /Dropset needs reps and weight/);
  assert.match(byLine[9].message, /not a valid date/);
  assert.match(byLine[11].message, /future/);
  assert.deepEqual(sets(r.workouts[0].exercises[0]), [[100, 8, 'normal']]);
});

test('a paste with nothing readable gives no workouts', () => {
  const r = parse('hello world\nthis is not a workout');
  assert.equal(r.workouts.length, 0);
  assert.equal(r.fatal, null);
});

test('exerciseNames are unique in order', () => {
  assert.deepEqual(exerciseNames(parse(SHEET)), ['Benchpress', 'Incline DB', 'Dips', 'Pullups', 'RDL']);
});

test('plausibleTimes: 18:00 for 60 min, second workout later, never in the future', () => {
  const now = new Date(2026, 10, 19, 12, 0).getTime();
  const a = plausibleTimes('2026-11-12', 0, now);
  assert.equal(new Date(a.startedAt).getHours(), 18);
  assert.equal(a.finishedAt - a.startedAt, 3600000);
  assert.equal(new Date(plausibleTimes('2026-11-12', 1, now).startedAt).getHours(), 20);
  const t = plausibleTimes('2026-11-19', 0, now);
  assert.ok(t.finishedAt <= now);
  assert.equal(new Date(t.startedAt).getDate(), 19);
  const early = plausibleTimes('2026-11-19', 0, new Date(2026, 10, 19, 0, 20).getTime());
  assert.equal(new Date(early.startedAt).getDate(), 19);
  assert.ok(early.finishedAt <= new Date(2026, 10, 19, 0, 20).getTime());
});

test('buildWorkoutRecords: finished, done sets, targets, importId; prefill uses them', () => {
  const r = parse(SHEET);
  let n = 0;
  const now = new Date(2026, 10, 19, 12).getTime();
  const ids = { Benchpress: 'seed:bench-press', 'Incline DB': 'seed:incline-dumbbell-press', Dips: 'seed:dip', Pullups: 'seed:pull-up', RDL: 'seed:romanian-deadlift' };
  const recs = buildWorkoutRecords(r.workouts, { dates: ['2026-11-12', '2026-11-16'], exerciseIds: ids, importId: 'run1', now, newId: () => `w${++n}` });
  assert.equal(recs.length, 2);
  const w = recs[0];
  assert.equal(w.id, 'w1');
  assert.equal(w.importId, 'run1');
  assert.equal(w.date, '2026-11-12');
  assert.ok(w.finishedAt > w.startedAt);
  assert.equal(w.routineId, null);
  assert.deepEqual(w.exercises[0], {
    exerciseId: 'seed:bench-press', targetSets: 3, targetReps: 6, targetRepsMax: null, targetWeight: null,
    sets: [{ weight: 100, reps: 7, type: 'normal', done: true }, { weight: 100, reps: 8, type: 'normal', done: true },
      { weight: 100, reps: 8, type: 'normal', done: true }, { weight: 80, reps: 5, type: 'dropset', done: true }],
    note: '',
  });
  assert.equal(w.exercises[1].targetRepsMax, 10);
  const last = lastEntryFor(recs, 'seed:bench-press');
  assert.equal(last.workout.id, 'w1');
  assert.deepEqual(prefillSets(last.entry, {}).map((s) => [s.weight, s.reps, s.type, s.done]),
    [[100, 7, 'normal', false], [100, 8, 'normal', false], [100, 8, 'normal', false], [80, 5, 'dropset', false]]);
  // without a target line: targetSets = normal sets, reps unknown
  const r2 = parse('Curl\n20 10\n20 9');
  const [c] = buildWorkoutRecords(r2.workouts, { dates: ['2026-11-01'], exerciseIds: { Curl: 'seed:barbell-curl' }, importId: 'x', now, newId: () => 'c' });
  assert.equal(c.exercises[0].targetSets, 2);
  assert.equal(c.exercises[0].targetReps, null);
  assert.throws(() => buildWorkoutRecords(r2.workouts, { dates: [''], exerciseIds: { Curl: 'x' }, importId: 'x', now, newId: () => 'c' }), /valid date/);
  assert.throws(() => buildWorkoutRecords(r2.workouts, { dates: ['2026-11-01'], exerciseIds: {}, importId: 'x', now, newId: () => 'c' }), /No exercise/);
});

test('a year of workouts parses quickly', () => {
  const lines = [];
  for (let i = 0; i < 150; i++) {
    lines.push(`${String((i % 28) + 1).padStart(2, '0')}.${String((i % 10) + 1).padStart(2, '0')}.2026`, 'Push');
    for (const ex of ['Benchpress', 'OHP', 'Dips']) lines.push(ex, '3 x 8', '80\t8', '80\t8', '80\t7', 'Dropset 6x 60', '');
  }
  const t0 = Date.now();
  const r = parse(lines.join('\n'));
  assert.equal(r.workouts.length, 150);
  assert.ok(Date.now() - t0 < 1500);
});

// ---------------------------------------------------------------- exercise matching

const LIB = SEED_EXERCISES.map((e) => ({ ...e, archived: false }));

test('normaliseName / nameKey ignore case, accents, spacing and punctuation', () => {
  assert.equal(normaliseName('  Bench-Press (Barbell) '), 'bench press barbell');
  assert.equal(nameKey('Bankdrücken'), 'bankdrucken');
  assert.equal(nameKey('Klimmzüge'), 'klimmzuge');
  assert.equal(nameKey('Straße'), 'strasse');
});

test('every alias points at a seed exercise', () => {
  const ids = new Set(SEED_EXERCISES.map((e) => e.id));
  for (const [k, id] of ALIASES) assert.ok(ids.has(id), `${k} → ${id}`);
});

test('matchExercise: aliases and common spellings', () => {
  const cases = {
    Benchpress: 'seed:bench-press', 'bench press': 'seed:bench-press', 'BENCH-PRESS': 'seed:bench-press',
    Pullups: 'seed:pull-up', 'Pull-ups': 'seed:pull-up', OHP: 'seed:overhead-press', RDL: 'seed:romanian-deadlift',
    Kniebeugen: 'seed:back-squat', Kreuzheben: 'seed:deadlift', 'Lat Pulldown': 'seed:lat-pulldown', Dips: 'seed:dip',
    'Incline DB': 'seed:incline-dumbbell-press', 'Face Pulls': 'seed:face-pull', 'Bankdrücken': 'seed:bench-press',
  };
  for (const [name, id] of Object.entries(cases)) assert.equal(matchExercise(name, LIB).exerciseId, id, name);
});

test('matchExercise: exact, base name (barbell preferred), plural, fuzzy, none', () => {
  assert.deepEqual([matchExercise('Bench Press (Barbell)', LIB).confidence], ['exact']);
  const deadlift = matchExercise('Deadlift (Barbell)', LIB);
  assert.equal(deadlift.confidence, 'exact');
  const base = matchExercise('Front Squat', LIB);
  assert.equal(base.exerciseId, 'seed:front-squat');
  assert.equal(base.confidence, 'high');
  const plural = matchExercise('Leg Extensions', LIB);
  assert.equal(plural.exerciseId, 'seed:leg-extension');
  const typo = matchExercise('Romanian Deadlif', LIB);
  assert.equal(typo.exerciseId, 'seed:romanian-deadlift');
  assert.ok(['medium', 'low', 'high'].includes(typo.confidence));
  const none = matchExercise('Zottman Flurb', LIB);
  assert.equal(none.exerciseId, null);
  assert.equal(none.confidence, 'none');
  assert.equal(none.candidates.length, 3);
});

test('matchExercise: saved mapping wins, archived exercises are not proposed by alias', () => {
  const lib = [...LIB, { id: 'custom:1', name: 'My Bench', equipment: 'barbell', archived: false }];
  assert.deepEqual([matchExercise('Benchpress', lib, { benchpress: 'custom:1' }).exerciseId, matchExercise('Benchpress', lib, { benchpress: 'custom:1' }).confidence], ['custom:1', 'saved']);
  assert.equal(matchExercise('Benchpress', lib, { benchpress: 'custom:gone' }).exerciseId, 'seed:bench-press');
  const archived = LIB.map((e) => (e.id === 'seed:overhead-press' ? { ...e, archived: true } : e));
  assert.notEqual(matchExercise('OHP', archived).exerciseId, 'seed:overhead-press');
});

test('similarity basics', () => {
  assert.equal(similarity('abc', 'abc'), 1);
  assert.equal(similarity('', 'abc'), 0);
  assert.ok(similarity('Benchpres', 'Bench Press') > 0.8);
});
