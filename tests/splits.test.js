import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLITS, splitById } from '../src/data/splits.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';
import {
  filterSplits, perWeek, applyLevel, splitCoverage, coverageStep, coverageBands, COVERAGE_BANDS, targetsFromCoverage, resolveSessions, splitRoutines,
  alternatives, autoSwaps, nextUp, cleanActiveSplit, MAX_SETS,
} from '../src/core/splits.js';
import { exerciseUsage } from '../src/core/exercise-usage.js';
import { EXERCISE_PATTERN, fitsHome, exerciseGear } from '../src/data/exercises.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const sum = (sessions) => sessions.reduce((a, s) => a + s.items.reduce((b, i) => b + i.sets, 0), 0);

test('filter by days, style, level, equipment; null = any', () => {
  assert.equal(filterSplits(SPLITS).length, SPLITS.length);
  assert.deepEqual(filterSplits(SPLITS, { days: 4 }).map((s) => s.id), ['fb4', 'ul4-b', 'ul4-i', 'ul4-home', 'tl4']);
  assert.deepEqual(filterSplits(SPLITS, { days: 4, style: 'upper-lower', level: 'beginner' }).map((s) => s.id), ['ul4-b', 'ul4-home']);
  assert.deepEqual(filterSplits(SPLITS, { equipment: 'home' }).map((s) => s.id), ['fb3-home', 'ul4-home']);
  assert.deepEqual(filterSplits(SPLITS, { days: 6, level: 'beginner' }), []);
  assert.deepEqual(filterSplits(SPLITS, { days: null, style: 'ppl', level: null }).map((s) => s.id), ['ppl3', 'ppl6']);
});

test('coverage of ul4-b by hand: chest 10 direct, back 12 + 4 partial, 2 days each', () => {
  const s = splitById('ul4-b');
  assert.equal(perWeek(s), 2);
  const c = splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, {});
  // Upper ×2: bench 3 + incline 2 → chest 5 / session → 10
  assert.deepEqual(c.chest, { total: 10, direct: 10, partial: 0, directSets: 10, partialSets: 0, daysHit: 2 });
  // back: pulldown 3 + cable row 2 = 5 direct / Upper → 10; partial: RDL 3 + squat 3 = 6 sets × 0.5 → 3 per Lower → 6
  assert.equal(c.back.direct, 10);
  assert.equal(c.back.partial, 6);
  assert.equal(c.back.total, 16);
  assert.equal(c.back.daysHit, 2);
  // triceps: pushdown 2 direct; bench 3 + incline 2 + shoulder press 2 = 7 partial sets → 3.5 per Upper
  assert.deepEqual([c.triceps.direct, c.triceps.partial, c.triceps.total], [4, 7, 11]);
  // traps: 2 shrug sets per Lower → 4 direct
  assert.equal(c.traps.total, 4);
});

test('coverage follows the user set weighting', () => {
  const s = splitById('ul4-b');
  const c = splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, { primary: 1, secondary: 0 });
  assert.equal(c.back.total, 10);
  assert.equal(c.triceps.total, 4);
  const c2 = splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, { primary: 1, secondary: 1 });
  assert.equal(c2.triceps.total, 18);
});

test('volume level: standard = catalogue, minimum −1 (floor 1), high +1 on each muscle\'s first exercise (cap 5)', () => {
  for (const s of SPLITS) {
    assert.deepEqual(applyLevel(s.sessions, 'standard', EX).map((x) => x.items.map((i) => i.sets)), s.sessions.map((x) => x.items.map((i) => i.sets)));
    const min = applyLevel(s.sessions, 'minimum', EX);
    s.sessions.forEach((x, i) => x.items.forEach((it, j) => assert.equal(min[i].items[j].sets, Math.max(1, it.sets - 1))));
  }
  const ul = splitById('ul4-b');
  const high = applyLevel(ul.sessions, 'high', EX);
  // Upper: bench +1 (chest), pulldown +1 (back), incline no (chest seen), cable row no, shoulder press +1, lateral raise no,
  // curl +1, pushdown +1
  assert.deepEqual(high[0].items.map((i) => i.sets), [4, 4, 2, 2, 3, 2, 3, 3]);
  // Lower: squat +1 (quads, glutes), RDL +1 (hamstrings new), extension no, leg curl no, calf +1, shrug +1, crunch +1
  assert.deepEqual(high[1].items.map((i) => i.sets), [4, 4, 2, 2, 4, 3, 3]);
  assert.equal(applyLevel([{ items: [{ exerciseId: 'seed:bench-press', sets: 5 }] }], 'high', EX)[0].items[0].sets, MAX_SETS);
  assert.equal(applyLevel([{ items: [{ exerciseId: 'seed:bench-press', sets: 1 }] }], 'minimum', EX)[0].items[0].sets, 1);
  // coverage moves with it: chest direct per Upper 5 → 6 (high), 3 (minimum)
  const cov = (lvl) => splitCoverage(resolveSessions(ul, { level: lvl, exercises: EX }), 2, EX, {}).chest.total;
  assert.deepEqual([cov('minimum'), cov('standard'), cov('high')], [6, 10, 12]);
  assert.ok(sum(applyLevel(ul.sessions, 'high', EX)) > sum(ul.sessions));
});

test('coverage step: fixed bands of weekly sets; legend bands do not overlap', () => {
  assert.deepEqual([0, -1, NaN, 0.5, 3.5, 4, 7.5, 8, 11.5, 12, 30].map((v) => coverageStep(v)), [0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  // legend entries are catalogue keys + params (src/core/set-bands.js bandLegend); written here as English
  const text = (b) => ({
    'workout.band.atLeast': () => `${b.params.n}+`, 'workout.band.range': () => `${b.params.from}–${b.params.to}`,
    'workout.band.rangeUnder': () => `${b.params.from}–under ${b.params.to}`, 'workout.band.under': () => `Under ${b.params.n}`,
    'workout.band.none': () => 'None',
  })[b.key]();
  assert.deepEqual(coverageBands({}).map(text), ['12+', '8–11.5', '4–7.5', 'Under 4', 'None']);
  assert.deepEqual(COVERAGE_BANDS.map(text), ['12+', '8–11.5', '4–7.5', 'Under 4', 'None']);
  assert.deepEqual(coverageBands({ primary: 1, secondary: 0 }).map(text), ['12+', '8–11', '4–7', 'Under 4', 'None']);
  assert.deepEqual(coverageBands({ primary: 1, secondary: 0.3 }).map(text), ['12+', '8–under 12', '4–under 8', 'Under 4', 'None']);
  // each label's ends fall in its own step
  assert.equal(coverageStep(11.5), 3); assert.equal(coverageStep(7.5), 2); assert.equal(coverageStep(3.5), 1);
});

test('targets from coverage: muscles ≥ 4 sets, rounded', () => {
  const s = splitById('ul4-b');
  const t = targetsFromCoverage(splitCoverage(resolveSessions(s, { exercises: EX }), 2, EX, {}));
  assert.deepEqual(t, { chest: 10, back: 16, traps: 4, shoulders: 15, biceps: 9, triceps: 11, forearms: 7, abs: 4, glutes: 12, quads: 10, hamstrings: 13, calves: 8 });
  const fb2 = targetsFromCoverage(splitCoverage(resolveSessions(splitById('fb2'), { exercises: EX }), 1, EX, {}));
  assert.equal(fb2.traps, undefined);
  assert.equal(fb2.calves, 5); // 4.5 rounds up
});

test('swaps and routine records', () => {
  const s = splitById('ul4-b');
  const ses = resolveSessions(s, { swaps: { 'upper:0': 'seed:dumbbell-bench-press' }, exercises: EX });
  assert.equal(ses[0].items[0].exerciseId, 'seed:dumbbell-bench-press');
  assert.equal(ses[0].items[0].original, 'seed:bench-press');
  const rs = splitRoutines(s, ses, { ids: ['r1', 'r2'], now: 5, firstOrder: 3 });
  assert.equal(rs.length, 2);
  assert.deepEqual(rs[0].items[0], { exerciseId: 'seed:dumbbell-bench-press', targetSets: 3, targetReps: 6, targetRepsMax: 10 });
  assert.deepEqual(Object.keys(rs[1]).sort(), ['createdAt', 'id', 'items', 'name', 'order', 'splitId', 'updatedAt']);
  assert.deepEqual([rs[0].name, rs[0].order, rs[1].order, rs[1].splitId, rs[1].createdAt], ['Upper', 3, 4, 'ul4-b', 5]);
});

test('alternatives: same primary first, logged first, same equipment, no archived, no duplicates in the day', () => {
  const ex = new Map(EX);
  ex.set('seed:dumbbell-bench-press', { ...EX.get('seed:dumbbell-bench-press'), archived: true });
  ex.set('custom:x', { id: 'custom:x', name: 'Floor Press', primary: ['chest'], secondary: ['triceps'], equipment: 'barbell', isCustom: true, archived: false });
  let alts = alternatives('seed:bench-press', { exercises: ex, exclude: ['seed:incline-dumbbell-press'], limit: 50 });
  const ids = alts.map((e) => e.id);
  assert.ok(!ids.includes('seed:bench-press'));
  assert.ok(!ids.includes('seed:dumbbell-bench-press'), 'archived');
  assert.ok(!ids.includes('seed:incline-dumbbell-press'), 'already in the day');
  assert.ok(ids.includes('custom:x'), 'custom exercises take part');
  assert.ok(alts.every((e) => e.primary.includes('chest')));
  // same equipment (barbell) first among unused
  assert.equal(alts[0].equipment, 'barbell');
  // a logged exercise comes first within its tier
  const usage = exerciseUsage([{ date: '2026-11-10', startedAt: 1, exercises: [{ exerciseId: 'seed:push-up', sets: [{ done: true }] }] }]);
  alts = alternatives('seed:bench-press', { exercises: ex, usage });
  assert.equal(alts[0].id, 'seed:push-up');
  // exact primary set before partial overlap: squat → leg press / goblet before leg extension
  const sq = alternatives('seed:back-squat', { exercises: EX, limit: 50, showAll: true }).map((e) => e.id);
  assert.ok(sq.indexOf('seed:leg-press') < sq.indexOf('seed:leg-extension'));
  // home: only dumbbells, a bench, a pull-up bar
  assert.ok(alternatives('seed:back-squat', { exercises: EX, homeOnly: true, limit: 50, showAll: true }).every((e) => fitsHome(e)));
  assert.deepEqual(alternatives('seed:nope', { exercises: EX }), []);
});

test('alternatives by movement pattern: what a lifter would accept', () => {
  const ids = (id, o = {}) => alternatives(id, { exercises: EX, limit: 50, ...o }).map((e) => e.id);
  const pat = (id) => EXERCISE_PATTERN[id];
  // every seed exercise has a pattern
  for (const e of SEED_EXERCISES) assert.ok(pat(e.id), e.id);
  // lateral raise: the other lateral raises first, then the upright row; no presses, front raise, rear delt
  const lat = ids('seed:lateral-raise');
  assert.deepEqual(lat.slice(0, 2).sort(), ['seed:cable-lateral-raise', 'seed:machine-lateral-raise']);
  for (const no of ['seed:arnold-press', 'seed:front-raise', 'seed:rear-delt-fly', 'seed:overhead-press', 'seed:face-pull', 'seed:landmine-press']) assert.ok(!lat.includes(no), no);
  // goblet squat: squats, then lunges; never a hinge
  const gob = ids('seed:goblet-squat');
  assert.ok(gob.every((id) => ['squat', 'lunge'].includes(pat(id))), gob.join());
  assert.ok(!gob.includes('seed:romanian-deadlift'));
  assert.equal(pat(gob[0]), 'squat');
  // inverted row: rows, then vertical pulls; no back extension
  const inv = ids('seed:inverted-row');
  assert.ok(!inv.includes('seed:back-extension'));
  assert.ok(inv.every((id) => ['row', 'pull-vertical', 'pullover'].includes(pat(id))));
  assert.equal(pat(inv[0]), 'row');
  // home: no dip bars, cables, machines, barbell, back-extension bench
  for (const s of SPLITS.filter((x) => x.equipment === 'home')) for (const ses of s.sessions) for (const it of ses.items) {
    const all = alternatives(it.exerciseId, { exercises: EX, homeOnly: true, limit: 50, showAll: true });
    assert.ok(all.every((e) => fitsHome(e)), `${s.id} ${it.exerciseId}: ${all.filter((e) => !fitsHome(e)).map((e) => e.id)}`);
    assert.ok(!all.some((e) => e.id === 'seed:dip'), 'dip needs dip bars');
  }
  assert.deepEqual([...exerciseGear(EX.get('seed:dip'))], ['dip-bars']);
  // five more patterns: curl, leg curl, calf, triceps extension, vertical press
  assert.ok(ids('seed:dumbbell-curl').slice(0, 8).every((id) => pat(id) === 'curl'));
  assert.ok(ids('seed:lying-leg-curl').every((id) => pat(id) === 'leg-curl'));
  assert.ok(ids('seed:standing-calf-raise').every((id) => pat(id) === 'calf'));
  assert.ok(ids('seed:rope-pushdown').slice(0, 5).every((id) => pat(id) === 'triceps-extension'));
  assert.ok(ids('seed:overhead-press').every((id) => pat(id) === 'press-vertical'));
  // a pattern another exercise of the session has is not offered (bench: incline is in the day)
  const day = ['seed:bench-press', 'seed:incline-dumbbell-press', 'seed:lat-pulldown'];
  const b = ids('seed:bench-press', { exclude: day });
  assert.ok(b.every((id) => pat(id) === 'press-horizontal'), b.join());
  // ... but the own pattern stays open when another exercise shares it (two rows in one day)
  assert.ok(ids('seed:seated-cable-row', { exclude: ['seed:seated-cable-row', 'seed:chest-supported-dumbbell-row'] }).some((id) => pat(id) === 'row'));
  // show all: every exercise with a shared primary muscle, other patterns last
  const all = ids('seed:lateral-raise', { showAll: true });
  assert.ok(all.includes('seed:arnold-press') && all.indexOf('seed:arnold-press') > all.indexOf('seed:machine-lateral-raise'));
  // custom original without a pattern: the muscle rule
  const ex = new Map(EX);
  ex.set('custom:y', { id: 'custom:y', name: 'Band Raise', primary: ['shoulders'], secondary: [], equipment: 'other' });
  assert.ok(alternatives('custom:y', { exercises: ex, limit: 50 }).some((e) => e.id === 'seed:arnold-press'));
});

test('auto swaps replace archived catalogue exercises', () => {
  const ex = new Map(EX);
  ex.set('seed:lat-pulldown', { ...EX.get('seed:lat-pulldown'), archived: true });
  const sw = autoSwaps(splitById('ul4-b'), { exercises: ex, usage: new Map() });
  assert.ok(sw['upper:1'] && sw['upper:1'] !== 'seed:lat-pulldown' && ex.get(sw['upper:1']).primary.includes('back'));
  assert.notEqual(sw['upper:1'], 'seed:seated-cable-row', 'not a duplicate of the day');
  assert.equal(Object.keys(sw).length, 1);
});

test('next up: rotation after the last finished workout, ignores others, wraps', () => {
  const active = cleanActiveSplit({ splitId: 'ul4-i', level: 'standard', routineIds: ['A', 'B', 'C', 'D'], adoptedAt: 1 });
  const W = (id, routineId, date, startedAt, { done = true, finished = true, kind } = {}) => ({
    id, routineId, date, startedAt, finishedAt: finished ? startedAt + 1 : null, kind,
    exercises: [{ exerciseId: 'seed:bench-press', sets: [{ weight: 50, reps: 5, type: 'normal', done }] }],
  });
  assert.equal(nextUp(active, []).routineId, 'A');
  assert.equal(nextUp(active, [W('1', 'A', '2026-11-16', 10)]).routineId, 'B');
  const ws = [W('1', 'A', '2026-11-16', 10), W('2', 'B', '2026-11-17', 10)];
  assert.equal(nextUp(active, ws).routineId, 'C');
  // another routine in between does not move it
  assert.equal(nextUp(active, [...ws, W('3', 'other', '2026-11-18', 10)]).routineId, 'C');
  // empty finished workout and an unfinished one are ignored; the starting point too
  assert.equal(nextUp(active, [...ws, W('4', 'C', '2026-11-18', 10, { done: false })]).routineId, 'C');
  assert.equal(nextUp(active, [...ws, W('5', 'C', '2026-11-18', 10, { finished: false })]).routineId, 'C');
  assert.equal(nextUp(active, [...ws, W('6', 'C', '2026-11-19', 0, { kind: 'baseline' })]).routineId, 'C');
  // date, then start time decide "last"; a back-dated workout does not count as last
  assert.equal(nextUp(active, [...ws, W('7', 'D', '2026-11-17', 20)]).routineId, 'A');
  assert.equal(nextUp(active, [...ws, W('8', 'A', '2026-11-10', 99)]).routineId, 'C');
  // wraps around
  const r = nextUp(active, [...ws, W('9', 'C', '2026-11-19', 10), W('10', 'D', '2026-11-20', 10)]);
  assert.deepEqual(r, { routineId: 'A', index: 0, count: 4, lastIndex: 3 });
  // deleted routines leave the rotation
  assert.equal(nextUp(active, ws, new Set(['A', 'B', 'D'])).routineId, 'D');
  assert.equal(nextUp(active, ws, new Set()), null);
});

test('active split setting is cleaned', () => {
  assert.equal(cleanActiveSplit(null), null);
  assert.equal(cleanActiveSplit({ splitId: 'x', routineIds: [] }), null);
  assert.deepEqual(cleanActiveSplit({ splitId: 'x', routineIds: ['a', 3, ''], level: 'bogus' }), { splitId: 'x', level: 'standard', routineIds: ['a'], adoptedAt: 0 });
});
