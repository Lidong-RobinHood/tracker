import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSetupDone, hasUserData, showSetupCard, buildTargets, proposeTargets, setupWrites, SETUP_VERSION } from '../src/core/setup.js';

const EMPTY = { foods: 0, diary: 0, meals: 0, exercises: 90, routines: 0, workouts: 0, weights: 0, settings: 1, targetHistory: 0 };
const DEFAULT_TARGETS = { kcal: 2000, protein: 120, carbs: 220, fat: 70, source: 'manual' };

test('isSetupDone needs a completion timestamp in meta', () => {
  assert.equal(isSetupDone(undefined), false);
  assert.equal(isSetupDone({ schemaVersion: 1, seedVersion: 3 }), false);
  assert.equal(isSetupDone({ setupCompletedAt: 1 }), true);
});

test('hasUserData ignores seeded exercises and the meta record', () => {
  assert.equal(hasUserData(EMPTY, ['meta']), false);
  assert.equal(hasUserData({ ...EMPTY, diary: 1 }, ['meta']), true);
  assert.equal(hasUserData({ ...EMPTY, weights: 1 }, ['meta']), true);
  assert.equal(hasUserData({ ...EMPTY, foods: 1 }, ['meta']), true);
  assert.equal(hasUserData(EMPTY, ['meta', 'targets']), true, 'targets saved in Settings = existing user');
  assert.equal(hasUserData(EMPTY, ['meta', 'recovery']), false);
});

test('showSetupCard: optional card until done, dismissed, or already configured', () => {
  assert.equal(showSetupCard({ meta: {}, settingKeys: ['meta'] }), true, 'fresh device');
  assert.equal(showSetupCard({ meta: { setupCompletedAt: 5 }, settingKeys: ['meta'] }), false, 'finished or skipped');
  assert.equal(showSetupCard({ meta: { setupCardDismissedAt: 5 }, settingKeys: ['meta'] }), false, 'Not now = for good');
  assert.equal(showSetupCard({ meta: {}, settingKeys: ['meta', 'targets'] }), false, 'targets already set');
  assert.equal(showSetupCard({ meta: {}, settingKeys: ['meta', 'profile'] }), false, 'profile already set');
  assert.equal(showSetupCard({ meta: {}, settingKeys: ['meta', 'recovery'] }), true, 'data but nothing configured');
});

test('buildTargets grams: same record as the Settings screen', () => {
  const r = buildTargets({ ...DEFAULT_TARGETS, mode: 'percent', pct: { protein: 30, carbs: 40, fat: 30 } },
    { mode: 'grams', kcal: 2300, protein: 160, carbs: 250, fat: 70 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.targets, { kcal: 2300, protein: 160, carbs: 250, fat: 70, source: 'manual', mode: 'grams' });
});

test('buildTargets percent: grams from the split, split stored', () => {
  const r = buildTargets(DEFAULT_TARGETS, { mode: 'percent', kcal: 2000, pct: { protein: 30, carbs: 40, fat: 30 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.targets, { kcal: 2000, protein: 150, carbs: 200, fat: 67, source: 'manual', mode: 'percent', pct: { protein: 30, carbs: 40, fat: 30 } });
});

test('buildTargets rejects invalid input', () => {
  assert.equal(buildTargets(DEFAULT_TARGETS, { mode: 'grams', kcal: null, protein: 1, carbs: 1, fat: 1 }).ok, false);
  assert.equal(buildTargets(DEFAULT_TARGETS, { mode: 'grams', kcal: 2000, protein: 1, carbs: null, fat: 1 }).field, 'carbs');
  assert.equal(buildTargets(DEFAULT_TARGETS, { mode: 'percent', kcal: 2000, pct: { protein: 30, carbs: 30, fat: 30 } }).ok, false);
});

test('proposeTargets: formula estimate and check-in style targets', () => {
  const profile = { sex: 'male', birthYear: 1990, heightCm: 180, activity: 'moderate' };
  const p = proposeTargets({ profile, weightKg: 80, rateKgPerWeek: -0.5, asOf: '2026-11-19' });
  // BMR = 800 + 1125 - 180 + 5 = 1750; × 1.55 = 2712.5
  assert.equal(p.tdee, 2710);
  // 2712.5 - 550 = 2162.5 → 2160
  assert.equal(p.target.kcal, 2160);
  assert.equal(p.target.protein, 160);
  assert.equal(p.target.fat, 64);
  assert.equal(p.target.carbs, Math.round((2160 - 160 * 4 - 64 * 9) / 4));
  assert.deepEqual(proposeTargets({ profile: { ...profile, activity: null }, weightKg: 80, rateKgPerWeek: 0, asOf: '2026-11-19' }), { tdee: null, target: null });
  assert.deepEqual(proposeTargets({ profile, weightKg: null, rateKgPerWeek: 0, asOf: '2026-11-19' }), { tdee: null, target: null });
});

test('proposeTargets respects the floor and the user\'s per-kg settings', () => {
  const profile = { sex: 'female', birthYear: 1960, heightCm: 155, activity: 'sedentary' };
  const p = proposeTargets({ profile, weightKg: 50, rateKgPerWeek: -1, asOf: '2026-11-19' });
  assert.equal(p.target.kcal, 1200);
  assert.equal(p.target.limitedBy, 'floor');
  const q = proposeTargets({ profile: { ...profile, activity: 'active' }, weightKg: 50, rateKgPerWeek: 0, adaptive: { proteinPerKg: 1.6 }, asOf: '2026-11-19' });
  assert.equal(q.target.protein, 80);
});

test('setupWrites: everything answered', () => {
  const current = { profile: { heightCm: null, birthYear: null, sex: null }, goal: { rateKgPerWeek: 0 }, targets: DEFAULT_TARGETS };
  const w = setupWrites({
    about: { sex: 'female', birthYear: 1992, heightCm: 168, weightKg: 64.333, activity: 'light' },
    rateKgPerWeek: -0.25,
    targets: { mode: 'grams', kcal: 1800, protein: 130, carbs: 180, fat: 60 },
  }, current, { today: '2026-11-19', now: 42 });
  assert.deepEqual(w.settings.profile, { heightCm: 168, birthYear: 1992, sex: 'female', activity: 'light' });
  assert.deepEqual(w.settings.goal, { rateKgPerWeek: -0.25 });
  assert.deepEqual(w.settings.targets, { kcal: 1800, protein: 130, carbs: 180, fat: 60, source: 'manual', mode: 'grams' });
  assert.deepEqual(w.weight, { date: '2026-11-19', kg: 64.33, updatedAt: 42 });
  assert.deepEqual(w.metaPatch, { setupCompletedAt: 42, setupSkipped: false, setupVersion: SETUP_VERSION });
});

test('setupWrites: skipped steps write nothing for them', () => {
  const current = { profile: { sex: 'male', heightCm: 180 }, goal: { rateKgPerWeek: 0.25 }, targets: DEFAULT_TARGETS };
  const w = setupWrites({}, current, { today: '2026-11-19', now: 7, skipped: true });
  assert.deepEqual(w.settings, {});
  assert.equal(w.weight, null);
  assert.deepEqual(w.metaPatch, { setupCompletedAt: 7, setupSkipped: true, setupVersion: SETUP_VERSION });
  const maintain = setupWrites({ rateKgPerWeek: 0 }, current, { today: '2026-11-19', now: 7 });
  assert.deepEqual(maintain.settings.goal, { rateKgPerWeek: 0 });
});

test('setupWrites: invalid targets abort without writes', () => {
  const current = { profile: {}, goal: {}, targets: DEFAULT_TARGETS };
  const w = setupWrites({ targets: { mode: 'percent', kcal: 2000, pct: { protein: 10, carbs: 10, fat: 10 } } }, current, { today: '2026-11-19', now: 1 });
  assert.ok(w.error);
  assert.deepEqual(w.settings, {});
  assert.equal(w.metaPatch, null);
});
