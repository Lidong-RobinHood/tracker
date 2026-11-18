import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  targetMode, pctSum, validateSplit, macroGrams, gramsFromPct, pctOfKcal, pctFromGrams, carbsRest, splitMacrosFor,
  SPLIT_PRESETS,
} from '../src/core/macro-split.js';
import { checkInRecords } from '../src/core/adaptive.js';

test('targetMode: missing or unknown mode means grams', () => {
  assert.equal(targetMode(undefined), 'grams');
  assert.equal(targetMode({ kcal: 2000 }), 'grams');
  assert.equal(targetMode({ mode: 'grams' }), 'grams');
  assert.equal(targetMode({ mode: 'weird' }), 'grams');
  assert.equal(targetMode({ mode: 'percent' }), 'percent');
});

test('gramsFromPct: 2400 kcal at 30/40/30 → 180/240/80', () => {
  assert.deepEqual(gramsFromPct(2400, { protein: 30, carbs: 40, fat: 30 }), { protein: 180, carbs: 240, fat: 80 });
  assert.deepEqual(gramsFromPct(2000, { protein: 40, carbs: 40, fat: 20 }), { protein: 200, carbs: 200, fat: 44 });
});

test('gramsFromPct: rounds each macro to whole grams; drift stays within 8.5 kcal', () => {
  const g = gramsFromPct(2150, { protein: 27.5, carbs: 45.5, fat: 27 });
  for (const v of Object.values(g)) assert.ok(Number.isInteger(v));
  assert.deepEqual(g, { protein: 148, carbs: 245, fat: 65 }); // 147.8 → 148, 244.6 → 245, 64.5 → 65
  for (let kcal = 1200; kcal <= 4000; kcal += 37) {
    for (const p of SPLIT_PRESETS) {
      const r = gramsFromPct(kcal, p.pct);
      const drift = Math.abs(r.protein * 4 + r.carbs * 4 + r.fat * 9 - kcal);
      assert.ok(drift <= 8.5, `drift ${drift} at ${kcal}`);
    }
  }
});

test('gramsFromPct: kcal 0, missing or invalid → no NaN/Infinity', () => {
  assert.deepEqual(gramsFromPct(0, { protein: 30, carbs: 40, fat: 30 }), { protein: 0, carbs: 0, fat: 0 });
  assert.deepEqual(gramsFromPct(undefined, { protein: 30, carbs: 40, fat: 30 }), { protein: null, carbs: null, fat: null });
  assert.deepEqual(gramsFromPct(NaN, { protein: 30, carbs: 40, fat: 30 }), { protein: null, carbs: null, fat: null });
  assert.deepEqual(gramsFromPct(2000, null), { protein: null, carbs: null, fat: null });
  assert.deepEqual(gramsFromPct(2000, { protein: 30, fat: 30 }), { protein: 150, carbs: null, fat: 67 });
  assert.equal(macroGrams(2000, 30, 'alcohol'), null);
});

test('pctOfKcal: share of the calorie target, null without calories', () => {
  assert.equal(pctOfKcal(2400, 180, 'protein'), 30);
  assert.equal(pctOfKcal(2400, 80, 'fat'), 30);
  assert.equal(pctOfKcal(0, 80, 'fat'), null);
  assert.equal(pctOfKcal(null, 80, 'fat'), null);
  assert.equal(pctOfKcal(2000, null, 'fat'), null);
});

test('pctFromGrams: shares of macro energy, always summing to exactly 100', () => {
  assert.deepEqual(pctFromGrams({ protein: 180, carbs: 240, fat: 80 }), { protein: 30, carbs: 40, fat: 30 });
  const p = pctFromGrams({ protein: 120, carbs: 220, fat: 70 }); // 480 / 880 / 630 of 1990
  assert.deepEqual(p, { protein: 24, carbs: 44, fat: 32 });
  const thirds = pctFromGrams({ protein: 9, carbs: 9, fat: 4 }); // 36/36/36
  assert.equal(thirds.protein + thirds.carbs + thirds.fat, 100);
  const one = pctFromGrams({ protein: 9, carbs: 9, fat: 4 }, 1);
  assert.equal(Math.round((one.protein + one.carbs + one.fat) * 10), 1000);
  assert.deepEqual(one, { protein: 33.4, carbs: 33.3, fat: 33.3 });
  assert.equal(pctFromGrams({ protein: 0, carbs: 0, fat: 0 }), null);
  assert.equal(pctFromGrams(null), null);
  assert.deepEqual(pctFromGrams({ protein: 100, carbs: null, fat: 0 }), { protein: 100, carbs: 0, fat: 0 });
});

test('validateSplit: sum must be 100 ± 0.1, every part 0–100', () => {
  assert.equal(validateSplit({ protein: 30, carbs: 40, fat: 30 }).ok, true);
  assert.equal(validateSplit({ protein: 33.3, carbs: 33.3, fat: 33.3 }).ok, true); // 99.9
  assert.equal(validateSplit({ protein: 33.4, carbs: 33.4, fat: 33.4 }).ok, false); // 100.2
  const short = validateSplit({ protein: 30, carbs: 35, fat: 30 });
  assert.deepEqual(short, { ok: false, sum: 95, diff: -5 });
  assert.equal(validateSplit({ protein: 30, carbs: 50, fat: 30 }).diff, 10);
  assert.equal(validateSplit({ protein: 30, carbs: null, fat: 70 }).ok, false);
  assert.equal(validateSplit({ protein: -10, carbs: 80, fat: 30 }).ok, false);
  assert.equal(validateSplit(null).ok, false);
  assert.equal(pctSum({ protein: 0.1, carbs: 0.2, fat: 99.7 }), 100);
});

test('carbsRest: carbs that complete the split', () => {
  assert.equal(carbsRest({ protein: 30, carbs: 10, fat: 25 }), 45);
  assert.equal(carbsRest({ protein: 27.5, fat: 30 }), 42.5);
  assert.equal(carbsRest({ protein: 60, fat: 50 }), null);
  assert.equal(carbsRest({ protein: null, fat: 30 }), null);
});

test('splitMacrosFor: only in percent mode with a valid split', () => {
  const pct = { protein: 30, carbs: 40, fat: 30 };
  assert.deepEqual(splitMacrosFor({ mode: 'percent', pct }, 2400), { protein: 180, carbs: 240, fat: 80 });
  assert.equal(splitMacrosFor({ pct }, 2400), null);
  assert.equal(splitMacrosFor({ mode: 'percent', pct: { protein: 30, carbs: 30, fat: 30 } }, 2400), null);
  assert.equal(splitMacrosFor({ mode: 'percent', pct }, undefined), null);
});

test('checkInRecords: percent mode writes grams from the split and keeps mode/pct', () => {
  const pct = { protein: 30, carbs: 40, fat: 30 };
  const current = { kcal: 2400, protein: 180, carbs: 240, fat: 80, source: 'manual', mode: 'percent', pct };
  const checkIn = { weekStart: '2026-11-16', weightKg: 80, tdee: 2700, daysLogged: 7, basisKind: 'data',
    proposal: { kcal: 2200, protein: 160, carbs: 230, fat: 64, rawKcal: 2210, limitedBy: null } };
  const rec = checkInRecords(checkIn, 'accepted', current, 1);
  assert.deepEqual(rec.targets, { kcal: 2200, protein: 165, carbs: 220, fat: 73, source: 'adaptive', mode: 'percent', pct });
  assert.deepEqual(rec.history.proposal, { kcal: 2200, protein: 165, carbs: 220, fat: 73 });
  // grams mode: unchanged behaviour
  const g = checkInRecords(checkIn, 'accepted', { kcal: 2400, protein: 180, carbs: 240, fat: 80, source: 'manual' }, 1);
  assert.deepEqual(g.targets, { kcal: 2200, protein: 160, carbs: 230, fat: 64, source: 'adaptive' });
});

test('buildCheckIn: percent mode proposes grams from the split; grams mode unchanged', async () => {
  const { buildCheckIn } = await import('../src/core/adaptive.js');
  const { simulate, dayDate } = await import('./helpers/adaptive-sim.js');
  const sim = simulate({ seed: 3, days: 50, offset: -400 });
  const args = { today: dayDate(45), weights: sim.weights, intake: sim.intake.filter((r) => r.date < dayDate(45)), goal: { rateKgPerWeek: -0.5 } };
  const base = { kcal: 2000, protein: 120, carbs: 220, fat: 70, source: 'manual' };
  const pct = { protein: 35, carbs: 40, fat: 25 };
  const g = buildCheckIn({ ...args, targets: base }).proposal;
  const p = buildCheckIn({ ...args, targets: { ...base, mode: 'percent', pct } }).proposal;
  assert.equal(p.kcal, g.kcal);
  assert.equal(p.split, 'percent');
  assert.deepEqual({ protein: p.protein, carbs: p.carbs, fat: p.fat }, gramsFromPct(p.kcal, pct));
  assert.deepEqual(p.byWeight, { protein: g.protein, carbs: g.carbs, fat: g.fat });
  assert.equal(g.split, undefined);
  // built in percent mode, answered after switching to grams → per-kg macros
  const ci = buildCheckIn({ ...args, targets: { ...base, mode: 'percent', pct } });
  const rec = checkInRecords(ci, 'accepted', base, 1);
  assert.deepEqual([rec.targets.protein, rec.targets.carbs, rec.targets.fat], [g.protein, g.carbs, g.fat]);
});
