import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLITS, splitById } from '../src/data/splits.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';
import { MUSCLE_IDS } from '../src/core/muscles.js';
import {
  cleanCustomSplit, cleanCustomSplits, sessionsPerWeekOf, rotationState, customRoutineIds, routineAsSession, rotationCoverage,
  coverageNotes, customFromLibrary, activeForCustom, cleanActiveSplit, nextUp, rotationNext, resolveSessions, splitCoverage, perWeek,
  moveSession, duplicateSession, removeSession, replaceSession, isCustomSplitId, MAX_SKIPS,
} from '../src/core/splits.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const item = (exerciseId, targetSets) => ({ exerciseId, targetSets, targetReps: 8, targetRepsMax: null });

// ---------------------------------------------------------------- validation, shape, round trip

test('custom split validation: bad records dropped, fields fixed, duplicates keep the first', () => {
  assert.equal(cleanCustomSplit(null), null);
  assert.equal(cleanCustomSplit({ id: 'ul4-b', name: 'x', sessions: [] }), null, 'library ids are not custom ids');
  assert.equal(cleanCustomSplit({ id: 'custom:', sessions: [] }), null);
  assert.deepEqual(cleanCustomSplit({ id: 'custom:a', name: '  ', sessionsPerWeek: 9, sessions: ['r1', 3, '', 'r1'] }),
    { id: 'custom:a', name: 'My split', sessionsPerWeek: null, sessions: ['r1', 'r1'], createdAt: 0, updatedAt: 0 });
  assert.equal(cleanCustomSplit({ id: 'custom:a', name: 'x'.repeat(80), sessions: [] }).name.length, 60);
  assert.equal(cleanCustomSplit({ id: 'custom:a', sessionsPerWeek: 2.5, sessions: [] }).sessionsPerWeek, null);
  assert.equal(cleanCustomSplit({ id: 'custom:a', sourceSplitId: 'ul4-b', sessions: [] }).sourceSplitId, 'ul4-b');
  const list = cleanCustomSplits([{ id: 'custom:a', name: 'A', sessions: [] }, { id: 'custom:a', name: 'B', sessions: [] }, 'junk', { id: 'custom:b', sessions: [] }]);
  assert.deepEqual(list.map((c) => [c.id, c.name]), [['custom:a', 'A'], ['custom:b', 'My split']]);
  assert.deepEqual(cleanCustomSplits(undefined), []);
  assert.ok(isCustomSplitId('custom:x') && !isCustomSplitId('fb2'));
});

test('sessions per week: stored 1–7, else the rotation length capped at 7', () => {
  assert.equal(sessionsPerWeekOf({ sessions: ['a', 'b', 'c'], sessionsPerWeek: null }), 3);
  assert.equal(sessionsPerWeekOf({ sessions: ['a', 'b', 'c'], sessionsPerWeek: 4 }), 4);
  assert.equal(sessionsPerWeekOf({ sessions: [], sessionsPerWeek: null }), 1);
  assert.equal(sessionsPerWeekOf({ sessions: Array(9).fill('a'), sessionsPerWeek: null }), 7);
});

test('export → import round trip keeps custom splits and the followed custom split', () => {
  const stored = cleanCustomSplits([
    { id: 'custom:1', name: 'UL', sessionsPerWeek: 4, sessions: ['U', 'L', 'U', 'L'], createdAt: 5, updatedAt: 6 },
    { id: 'custom:2', name: 'Copy', sessionsPerWeek: null, sessions: ['X'], createdAt: 1, updatedAt: 2, sourceSplitId: 'fb2' },
  ]);
  const active = activeForCustom(stored[0], 99);
  // settings records as exportAll writes them, through JSON, back through the readers
  const file = JSON.parse(JSON.stringify({ stores: { settings: [{ key: 'customSplits', value: stored }, { key: 'activeSplit', value: { ...active, skips: [{ date: '2026-11-20', at: 7 }] } }] } }));
  const back = Object.fromEntries(file.stores.settings.map((r) => [r.key, r.value]));
  assert.deepEqual(cleanCustomSplits(back.customSplits), stored);
  assert.deepEqual(cleanActiveSplit(back.activeSplit), { splitId: 'custom:1', level: 'standard', routineIds: ['U', 'L', 'U', 'L'], adoptedAt: 99, kind: 'custom', skips: [{ date: '2026-11-20', at: 7 }] });
});

test('activeSplit: the 0.6.0 library shape still reads the same; skips are cleaned and capped', () => {
  const old = { splitId: 'ul4-b', level: 'high', routineIds: ['a', 'b'], adoptedAt: 3 };
  assert.deepEqual(cleanActiveSplit(old), old);
  const skips = Array.from({ length: MAX_SKIPS + 5 }, (_, i) => ({ date: '2026-11-01', at: i }));
  const c = cleanActiveSplit({ ...old, skips: [...skips, { date: 'bad', at: 1 }, { date: '2026-11-02' }] });
  assert.equal(c.skips.length, MAX_SKIPS);
  assert.equal(c.skips[0].at, 5);
  assert.equal(cleanActiveSplit({ ...old, skips: [] }).skips, undefined);
});

test('missing routines and routines used by custom splits', () => {
  const cs = { sessions: ['U', 'gone', 'L', 'U'] };
  assert.deepEqual(rotationState(cs, new Set(['U', 'L'])), { ids: ['U', 'L', 'U'], missing: [1], ok: true });
  assert.equal(rotationState({ sessions: ['gone'] }, new Set()).ok, false);
  assert.deepEqual([...customRoutineIds([{ sessions: ['a', 'b'] }, { sessions: ['b', 'c'] }])].sort(), ['a', 'b', 'c']);
});

test('rotation edits: move, duplicate, remove, replace (new arrays)', () => {
  const s = ['U', 'L'];
  assert.deepEqual(moveSession(s, 0, 1), ['L', 'U']);
  assert.deepEqual(moveSession(s, 0, -1), ['U', 'L']);
  assert.deepEqual(duplicateSession(s, 0), ['U', 'U', 'L']);
  assert.deepEqual(removeSession(['U', 'L', 'U'], 2), ['U', 'L']);
  assert.deepEqual(replaceSession(s, 1, 'P'), ['U', 'P']);
  assert.deepEqual(s, ['U', 'L']);
});

// ---------------------------------------------------------------- coverage

test('rotation coverage equals the library coverage for every split (days / sessions each)', () => {
  for (const s of SPLITS) {
    const ses = resolveSessions(s, { exercises: EX });
    assert.deepEqual(rotationCoverage(ses, s.days, EX, {}), splitCoverage(ses, perWeek(s), EX, {}), s.id);
  }
});

test('coverage by hand: 3-session rotation trained 4 days a week (each session 4/3 × a week)', () => {
  const A = routineAsSession({ id: 'A', name: 'A', items: [item('seed:bench-press', 3), item('seed:barbell-row', 3)] });
  const B = routineAsSession({ id: 'B', name: 'B', items: [item('seed:back-squat', 4)] });
  const C = routineAsSession({ id: 'C', name: 'C', items: [item('seed:overhead-press', 3), item('seed:romanian-deadlift', 3)] });
  const c = rotationCoverage([A, B, C], 4, EX, {});
  // chest: bench 3 direct × 4/3 = 4
  assert.deepEqual([c.chest.direct, c.chest.partial, c.chest.total, c.chest.daysHit], [4, 0, 4, 1.33]);
  // back: row 3 direct → 4; partial squat 4 × 0.5 + RDL 3 × 0.5 = 3.5 × 4/3 = 4.67; total 8.67
  assert.deepEqual([c.back.direct, c.back.partial, c.back.total], [4, 4.67, 8.67]);
  // shoulders: bench + row 3 partial sets each = 3 × 4/3 = 4 partial; OHP 3 direct × 4/3 = 4
  assert.deepEqual([c.shoulders.direct, c.shoulders.partial, c.shoulders.total], [4, 4, 8]);
  // glutes: squat 4 + RDL 3 direct = 7 × 4/3 = 9.33, primary in B and C → 2.67 days
  assert.deepEqual([c.glutes.total, c.glutes.daysHit], [9.33, 2.67]);
  assert.deepEqual([c.quads.total, c.hamstrings.total, c.triceps.total, c.forearms.total, c.biceps.total, c.traps.total], [5.33, 6.67, 4, 4, 2, 2]);
  assert.equal(c.calves.total + c.abs.total, 0);
  // the same routine twice in the rotation counts twice: U, L, U, L at 4 a week = U, L at 4 a week
  assert.deepEqual(rotationCoverage([A, B, A, B], 4, EX, {}), rotationCoverage([A, B], 4, EX, {}));
  assert.equal(rotationCoverage([A, A, B], 3, EX, {}).chest.total, 6);
  // the user's set weighting
  assert.equal(rotationCoverage([A, B, C], 4, EX, { primary: 1, secondary: 0 }).back.total, 4);
  // empty rotation
  assert.ok(MUSCLE_IDS.every((m) => rotationCoverage([], 4, EX, {})[m].total === 0));
});

test('coverage notes: no sets, and far above the rest (≥ 2.5 × median and ≥ 8 above it)', () => {
  const cov = (o) => Object.fromEntries(MUSCLE_IDS.map((m) => [m, { total: o[m] ?? 6 }]));
  assert.deepEqual(coverageNotes(cov({})), { none: [], high: [] });
  assert.deepEqual(coverageNotes(cov({ calves: 0, abs: 0 })), { none: ['abs', 'calves'], high: [] });
  assert.deepEqual(coverageNotes(cov({ chest: 15 })), { none: [], high: ['chest'] }); // 15 ≥ 2.5 × 6, 9 above
  assert.deepEqual(coverageNotes(cov({ chest: 14 })).high, []);
  // small weeks never trigger it (gap < 8)
  assert.deepEqual(coverageNotes(Object.fromEntries(MUSCLE_IDS.map((m) => [m, { total: m === 'chest' ? 6 : 1 }]))).high, []);
  assert.deepEqual(coverageNotes(Object.fromEntries(MUSCLE_IDS.map((m) => [m, { total: 0 }]))), { none: [], high: [] });
  // no library split triggers "far above"
  for (const s of SPLITS) assert.deepEqual(coverageNotes(splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, {})).high, [], s.id);
});

test('copy of a library split: rotation = its routines, days per week = its days, same coverage', () => {
  const s = splitById('ul4-b');
  const cs = customFromLibrary(s, { id: 'custom:x', routineIds: ['r1', 'r2'], now: 1 });
  assert.deepEqual(cs, { id: 'custom:x', name: 'Upper lower 4-day (custom)', sessionsPerWeek: 4, sessions: ['r1', 'r2'], createdAt: 1, updatedAt: 1, sourceSplitId: 'ul4-b' });
  const ses = resolveSessions(s, { exercises: EX });
  assert.deepEqual(rotationCoverage(ses, sessionsPerWeekOf(cs), EX, {}), splitCoverage(ses, 2, EX, {}));
});

// ---------------------------------------------------------------- next up

const W = (id, routineId, date, startedAt = 10, { done = true, finished = true, kind } = {}) => ({
  id, routineId, date, startedAt, finishedAt: finished ? startedAt + 1 : null, kind,
  exercises: [{ exerciseId: 'seed:bench-press', sets: [{ weight: 50, reps: 5, type: 'normal', done }] }],
});
const next = (ids, ws, opts) => rotationNext(ids, ws, opts);
const ULUL = ['U', 'L', 'U', 'L'];

test('repeated routine: Upper, Lower, Upper, Lower walks all four positions', () => {
  const ws = [];
  assert.deepEqual([next(ULUL, ws).routineId, next(ULUL, ws).index], ['U', 0]);
  ws.push(W('1', 'U', '2026-11-16'));
  assert.deepEqual([next(ULUL, ws).routineId, next(ULUL, ws).index], ['L', 1]);
  ws.push(W('2', 'L', '2026-11-17'));
  assert.deepEqual([next(ULUL, ws).routineId, next(ULUL, ws).index], ['U', 2]); // after Lower(2) comes Upper(3)
  ws.push(W('3', 'U', '2026-11-18'));
  assert.deepEqual([next(ULUL, ws).routineId, next(ULUL, ws).index], ['L', 3]); // after Upper(3) comes Lower(4)
  ws.push(W('4', 'L', '2026-11-19'));
  assert.deepEqual(next(ULUL, ws), { routineId: 'U', index: 0, count: 4, lastIndex: 3 });
});

test('out of order: the rotation continues after the session done (nearest occurrence ahead)', () => {
  // A B C: C done first → A next; B done when A expected → C next
  assert.equal(next(['A', 'B', 'C'], [W('1', 'C', '2026-11-16')]).routineId, 'A');
  assert.equal(next(['A', 'B', 'C'], [W('1', 'B', '2026-11-16')]).routineId, 'C');
  // U L U L, Upper expected at 1: Lower done → its nearest position ahead is 2 → Upper(3) next
  assert.deepEqual([next(ULUL, [W('1', 'L', '2026-11-16')]).index], [2]);
  // at Upper(3) a Lower is done → Lower(4) consumed → Upper(1) next
  const ws = [W('1', 'U', '2026-11-16'), W('2', 'L', '2026-11-17'), W('3', 'L', '2026-11-18')];
  assert.deepEqual([next(ULUL, ws).routineId, next(ULUL, ws).index], ['U', 0]);
  // U L U P: at Upper(1) a Push is done → Upper(1) again
  assert.deepEqual([next(['U', 'L', 'U', 'P'], [W('1', 'P', '2026-11-16')]).index], [0]);
});

test('dates decide: backdated insert, date change and delete of the latest workout', () => {
  const ABC = ['A', 'B', 'C'];
  const ws = [W('1', 'A', '2026-11-16'), W('2', 'B', '2026-11-18')];
  assert.equal(next(ABC, ws).routineId, 'C');
  // a past workout logged later, dated before the latest session, does not move it back
  const back = [...ws, { ...W('3', 'A', '2026-11-17'), createdAt: Date.now() }];
  assert.equal(next(ABC, back).routineId, 'C');
  // same day, earlier start time → also not the latest
  assert.equal(next(ABC, [...ws, W('4', 'A', '2026-11-18', 5)]).routineId, 'C');
  // repeated routines: an older Upper inserted before the latest keeps the next routine
  const ul = [W('1', 'U', '2026-11-16'), W('2', 'L', '2026-11-17'), W('3', 'U', '2026-11-18')];
  assert.equal(next(ULUL, ul).routineId, 'L');
  assert.equal(next(ULUL, [...ul, W('5', 'U', '2026-11-15')]).routineId, 'L');
  // the latest workout moved to an earlier date: history is now B, A → B next
  assert.equal(next(ABC, [W('1', 'A', '2026-11-16'), W('2', 'B', '2026-11-10')]).routineId, 'B');
  // the latest workout moved later stays the latest
  assert.equal(next(ABC, [W('1', 'A', '2026-11-16'), W('2', 'B', '2026-11-20')]).routineId, 'C');
  // the latest workout deleted: as if it never happened
  assert.equal(next(ABC, [W('1', 'A', '2026-11-16')]).routineId, 'B');
});

test('reordering the rotation takes effect at once, from the last session done', () => {
  const ws = [W('1', 'A', '2026-11-16'), W('2', 'B', '2026-11-17')];
  assert.equal(next(['A', 'B', 'C'], ws).routineId, 'C');
  assert.equal(next(['B', 'A', 'C'], ws).routineId, 'A'); // B was last; after B now comes A
  assert.equal(next(['C', 'A', 'B'], ws).routineId, 'C');
  // custom split followed: nextUp reads the rotation it is given (store.js passes the live one)
  assert.equal(nextUp({ kind: 'custom', routineIds: ['B', 'C', 'A'] }, ws).routineId, 'C');
});

test('skips move the position on by one, ordered with the workouts by date and time', () => {
  const ws = [W('1', 'A', '2026-11-16', 10)];
  assert.equal(next(['A', 'B', 'C'], ws).routineId, 'B');
  assert.equal(next(['A', 'B', 'C'], ws, { skips: [{ date: '2026-11-17', at: 5 }] }).routineId, 'C');
  assert.equal(next(['A', 'B', 'C'], ws, { skips: [{ date: '2026-11-17', at: 5 }, { date: '2026-11-17', at: 6 }] }).routineId, 'A');
  // a workout after the skip continues from the session done
  assert.equal(next(['A', 'B', 'C'], [...ws, W('2', 'B', '2026-11-18')], { skips: [{ date: '2026-11-17', at: 5 }] }).routineId, 'C');
  // via the setting
  assert.equal(nextUp(cleanActiveSplit({ splitId: 'fb2', routineIds: ['A', 'B', 'C'], skips: [{ date: '2026-11-17', at: 1 }] }), ws).routineId, 'C');
});

test('discarded, empty, unfinished workouts, the starting point and other routines never count; missing routines are skipped', () => {
  const ws = [W('1', 'U', '2026-11-16')];
  for (const extra of [W('2', 'L', '2026-11-17', 10, { done: false }), W('3', 'L', '2026-11-17', 10, { finished: false }),
    W('4', 'L', '2026-11-17', 10, { kind: 'baseline' }), W('5', 'other', '2026-11-17')]) {
    assert.equal(next(ULUL, [...ws, extra]).index, 1);
  }
  // a deleted routine leaves the rotation: U, (gone), U, L → positions U, U, L
  assert.deepEqual(next(['U', 'gone', 'U', 'L'], ws, { existing: new Set(['U', 'L']) }), { routineId: 'U', index: 1, count: 3, lastIndex: 0 });
  assert.equal(next(['gone'], ws, { existing: new Set(['U']) }), null);
});
