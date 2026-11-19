import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADAPTIVE_DEFAULTS, adaptiveConfig, trendSeries, trendAt, weightRate, classifyIntake, formulaTdee,
  estimateExpenditure, weeklyTarget, weeklyIntake, kcalFloor, buildCheckIn, checkInRecords, dailyIntake,
} from '../src/core/adaptive.js';
import { sumEntries } from '../src/core/nutrition.js';
import { simulate, dayDate, mean, prng } from './helpers/adaptive-sim.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const est = (sim, d, extra = {}) => estimateExpenditure({ weights: sim.weights, intake: sim.intake, asOf: dayDate(d), ...extra });
const fmt = (n) => Math.round(n);

// ---------------------------------------------------------------- trend weight

test('trend: first value = first weight, EMA with alpha per day', () => {
  const s = trendSeries([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-02', kg: 81 }]);
  assert.equal(s[0].trend, 80);
  assert.ok(Math.abs(s[1].trend - 80.1) < 1e-9);
});

test('trend: a gap of n days uses 1-(1-a)^n, so a gap equals n daily steps toward the same value', () => {
  const a = ADAPTIVE_DEFAULTS.trendAlpha;
  const s = trendSeries([{ date: '2026-01-01', kg: 80 }, { date: '2026-01-04', kg: 83 }]);
  assert.ok(Math.abs(s[1].trend - (80 + (1 - (1 - a) ** 3) * 3)) < 1e-9);
  assert.equal(trendAt(s, '2026-01-03'), 80);          // between weigh-ins: last value holds
  assert.equal(trendAt(s, '2025-12-31'), null);
});

test('trend: invalid, duplicate and unsorted weights are cleaned', () => {
  const s = trendSeries([{ date: '2026-01-02', kg: 81 }, { date: 'x', kg: 80 }, { date: '2026-01-01', kg: NaN },
    { date: '2026-01-01', kg: 80 }, { date: '2026-01-02', kg: 82 }]);
  assert.deepEqual(s.map((r) => [r.date, r.kg]), [['2026-01-01', 80], ['2026-01-02', 82]]);
});

test('weightRate: least-squares slope in kg/week', () => {
  const w = Array.from({ length: 21 }, (_, i) => ({ date: dayDate(i), kg: 90 - i * 0.1 }));
  assert.ok(Math.abs(weightRate(w, dayDate(20), 21) + 0.7) < 1e-9);
  assert.ok(Math.abs(weightRate(w, dayDate(20)) + 0.7) < 1e-9);
  assert.equal(weightRate(w.slice(0, 3), dayDate(20)), null);
});

// ---------------------------------------------------------------- intake classification

test('classifyIntake: below half the median is incomplete; today is excluded', () => {
  const intake = [2400, 2500, 2600, 900, 2450, 2550].map((kcal, i) => ({ date: dayDate(i), kcal }));
  intake.push({ date: dayDate(6), kcal: 3000 });
  const c = classifyIntake(intake, dayDate(6));
  assert.equal(c.length, 6);
  assert.deepEqual(c.map((r) => r.valid), [true, true, true, false, true, true]);
});

// ---------------------------------------------------------------- formula

test('formulaTdee: Mifflin-St Jeor × activity; incomplete profile → null', () => {
  const p = { sex: 'male', birthYear: 1990, heightCm: 180, activity: 'moderate' };
  const f = formulaTdee(p, 80, '2026-06-01');
  assert.equal(f.age, 36);
  assert.equal(f.bmr, 10 * 80 + 6.25 * 180 - 5 * 36 + 5);
  assert.ok(Math.abs(f.kcal - f.bmr * 1.55) < 1e-9);
  assert.equal(formulaTdee({ ...p, sex: 'female' }, 80, '2026-06-01').bmr, 10 * 80 + 6.25 * 180 - 5 * 36 - 161);
  assert.equal(formulaTdee({ ...p, activity: undefined }, 80, '2026-06-01'), null);
  assert.equal(formulaTdee({ ...p, heightCm: null }, 80, '2026-06-01'), null);
  assert.equal(formulaTdee(p, null, '2026-06-01'), null);
});

// ---------------------------------------------------------------- sufficiency

test('insufficient data returns insufficient with reasons, never a number', () => {
  const sim = simulate({ seed: 1, days: 60 });
  const cases = [
    { weights: [], intake: [] },
    { weights: sim.weights.slice(0, 10), intake: sim.intake.slice(0, 10) },        // 10 days only
    { weights: sim.weights.slice(0, 40).filter((_, i) => i % 6 === 0), intake: sim.intake.slice(0, 40) }, // few weigh-ins
    { weights: sim.weights.slice(0, 40), intake: sim.intake.slice(0, 40).filter((_, i) => i % 5 === 0) }, // few logs
    { weights: sim.weights.slice(0, 25), intake: sim.intake.slice(0, 40) },        // last weigh-in stale
  ];
  for (const c of cases) {
    const e = estimateExpenditure({ ...c, asOf: dayDate(40) });
    assert.equal(e.status, 'insufficient');
    assert.equal(e.tdee, null);
    assert.equal(e.confidence, null);
    assert.ok(e.missing.length >= 1, 'explains what is missing');
  }
  const few = estimateExpenditure({ weights: sim.weights.slice(0, 40).filter((_, i) => i % 6 === 0), intake: sim.intake.slice(0, 40), asOf: dayDate(40) });
  assert.match(few.missing.join(' '), /more weigh-ins/);
  const ok = estimateExpenditure({ weights: sim.weights.slice(0, 41), intake: sim.intake.slice(0, 41), asOf: dayDate(40) });
  assert.equal(ok.status, 'ok');
  assert.equal(typeof ok.tdee, 'number');
});

test('formula fallback is reported (labelled) alongside an insufficient estimate', () => {
  const e = estimateExpenditure({ weights: [{ date: '2026-01-05', kg: 80 }], intake: [], asOf: '2026-01-06',
    profile: { sex: 'female', birthYear: 1995, heightCm: 168, activity: 'light' } });
  assert.equal(e.status, 'insufficient');
  assert.equal(e.tdee, null);
  assert.ok(e.formula && e.formula.kcal > 1500 && e.formula.kcal < 2600);
});

// ---------------------------------------------------------------- accuracy against synthetic data

function steadyErrors(offset, extra = {}) {
  return SEEDS.map((seed) => {
    const sim = simulate({ seed, days: 29, offset, ...extra });
    const e = est(sim, 28);
    assert.equal(e.status, 'ok', `seed ${seed}: ${e.missing.join(' ')}`);
    return Math.abs(e.tdee - sim.trueTdee[27]);
  });
}

for (const [name, offset] of [['maintenance', 0], ['deficit -500', -500], ['surplus +300', 300]]) {
  test(`steady state, ${name}: MAE after 4 weeks <= 100 kcal, worst seed <= 250`, () => {
    const errs = steadyErrors(offset);
    console.log(`  # ${name}: MAE ${fmt(mean(errs))} kcal, worst ${fmt(Math.max(...errs))} kcal (20 seeds, day 28)`);
    assert.ok(mean(errs) <= 100, `MAE ${mean(errs)}`);
    assert.ok(Math.max(...errs) <= 250, `worst ${Math.max(...errs)}`);
  });
}

test('steady state over longer runs gets more accurate (8 weeks)', () => {
  const errs = SEEDS.map((seed) => {
    const sim = simulate({ seed, days: 57, offset: -500 });
    return Math.abs(est(sim, 56).tdee - sim.trueTdee[55]);
  });
  console.log(`  # deficit -500 at 8 weeks: MAE ${fmt(mean(errs))}, worst ${fmt(Math.max(...errs))}`);
  assert.ok(mean(errs) <= 80);
});

test('30 % of weigh-ins and 20 % of diary days missing: MAE <= 150 kcal', () => {
  const errs = steadyErrors(-500, { missWeigh: 0.3, missLog: 0.2 });
  console.log(`  # missing data: MAE ${fmt(mean(errs))} kcal, worst ${fmt(Math.max(...errs))} kcal`);
  assert.ok(mean(errs) <= 150, `MAE ${mean(errs)}`);
});

test('under-logged days (10 % logged at 30 %) are excluded: MAE stays <= 150 kcal', () => {
  const errs = steadyErrors(0, { missWeigh: 0.3, missLog: 0.2, underLog: 0.1 });
  console.log(`  # missing + under-logged: MAE ${fmt(mean(errs))} kcal, worst ${fmt(Math.max(...errs))} kcal`);
  assert.ok(mean(errs) <= 150, `MAE ${mean(errs)}`);
});

test('step change of -300 kcal in true TDEE: >= 2/3 tracked within 5 weeks, no wild overshoot', () => {
  const S = 42;
  const moves = []; const overs = [];
  for (const seed of SEEDS) {
    const sim = simulate({ seed, days: S + 57, offset: 0, stepDay: S, stepKcal: -300 });
    const before = est(sim, S).tdee;
    moves.push(before - est(sim, S + 35).tdee);
    let lowest = Infinity;
    for (let d = S; d <= S + 56; d++) lowest = Math.min(lowest, est(sim, d).tdee);
    overs.push(2200 - lowest);
  }
  console.log(`  # step -300: mean move after 5 wk ${fmt(mean(moves))} kcal (min seed ${fmt(Math.min(...moves))}), `
    + `overshoot below new truth mean ${fmt(mean(overs))}, worst ${fmt(Math.max(...overs))}`);
  assert.ok(mean(moves) >= 200, `mean move ${mean(moves)}`);
  assert.ok(mean(overs) <= 75, `mean overshoot ${mean(overs)}`);
  assert.ok(Math.max(...overs) <= 200, `worst overshoot ${Math.max(...overs)}`);
});

function outlierShift(extra) {
  return SEEDS.map((seed) => {
    const a = simulate({ seed, days: 64, offset: -300 });
    const b = simulate({ seed, days: 64, offset: -300, ...extra });
    let mx = 0;
    for (let d = 35; d <= 63; d++) mx = Math.max(mx, Math.abs(est(a, d).tdee - est(b, d).tdee));
    return mx;
  });
}

test('one-off 2 kg water spike moves the estimate by < 100 kcal', () => {
  const s = outlierShift({ weightSpikes: { 35: 2 } });
  console.log(`  # 2 kg spike: largest shift mean ${fmt(mean(s))}, worst seed ${fmt(Math.max(...s))} kcal`);
  assert.ok(Math.max(...s) < 100);
});

test('one 5000 kcal day (eaten and logged) moves the estimate by < 100 kcal', () => {
  const s = outlierShift({ eatOverride: { 35: 5000 } });
  console.log(`  # 5000 kcal day: largest shift mean ${fmt(mean(s))}, worst seed ${fmt(Math.max(...s))} kcal`);
  assert.ok(Math.max(...s) < 100);
});

test('one 5000 kcal day logged but NOT eaten (typo) stays around 100 kcal', () => {
  const s = outlierShift({ logOverride: { 35: 5000 } });
  console.log(`  # 5000 kcal typo: largest shift mean ${fmt(mean(s))}, worst seed ${fmt(Math.max(...s))} kcal`);
  assert.ok(mean(s) < 100);
  assert.ok(Math.max(...s) < 125);
});

// ---------------------------------------------------------------- targets

test('weeklyTarget: formula, rounding and macros', () => {
  const t = weeklyTarget({ tdee: 2600, rateKgPerWeek: -0.5, weightKg: 80, sex: 'male' });
  assert.equal(t.kcal, 2050);                     // 2600 - 550
  assert.equal(t.protein, 160);
  assert.equal(t.fat, 64);
  assert.equal(t.carbs, Math.round((2050 - 640 - 576) / 4));
  assert.equal(t.limitedBy, null);
});

test('weeklyTarget: floor by sex and configured floor', () => {
  assert.equal(weeklyTarget({ tdee: 1500, rateKgPerWeek: -1, weightKg: 60, sex: 'female' }).kcal, 1200);
  assert.equal(weeklyTarget({ tdee: 1500, rateKgPerWeek: -1, weightKg: 60, sex: 'male' }).kcal, 1500);
  assert.equal(weeklyTarget({ tdee: 1500, rateKgPerWeek: -1, weightKg: 60, sex: null }).kcal, 1350);
  const t = weeklyTarget({ tdee: 1500, rateKgPerWeek: -1, weightKg: 60, sex: 'female', config: { kcalFloor: 1400 } });
  assert.equal(t.kcal, 1400);
  assert.equal(t.limitedBy, 'floor');
  assert.equal(kcalFloor('female', { kcalFloor: null }), 1200);
});

test('weeklyTarget: change limit vs previous adaptive target, floor still wins', () => {
  assert.equal(weeklyTarget({ tdee: 2600, rateKgPerWeek: -0.5, weightKg: 80, previousKcal: 2400 }).kcal, 2250);
  assert.equal(weeklyTarget({ tdee: 2600, rateKgPerWeek: 0, weightKg: 80, previousKcal: 2000 }).kcal, 2150);
  assert.equal(weeklyTarget({ tdee: 2600, rateKgPerWeek: 0, weightKg: 80, previousKcal: 2000 }).limitedBy, 'change');
  assert.equal(weeklyTarget({ tdee: 2600, rateKgPerWeek: 0, weightKg: 80, previousKcal: 2000, config: { maxWeeklyChange: 300 } }).kcal, 2300);
  assert.equal(weeklyTarget({ tdee: 1300, rateKgPerWeek: 0, weightKg: 60, sex: 'male', previousKcal: 1300 }).kcal, 1500);
});

test('weeklyTarget: macros never exceed the calories (fat lowered, carbs >= 0)', () => {
  const t = weeklyTarget({ tdee: 1200, rateKgPerWeek: 0, weightKg: 140, sex: 'female', config: { kcalFloor: 1200 } });
  assert.ok(t.protein * 4 + t.fat * 9 + t.carbs * 4 <= t.kcal + 2);
  assert.ok(t.carbs >= 0);
  assert.ok(t.fat < Math.round(0.8 * 140), 'fat lowered to fit');
});

test('adaptiveConfig ignores invalid overrides', () => {
  const c = adaptiveConfig({ proteinPerKg: 'x', fatPerKg: 1, nonsense: 5 });
  assert.equal(c.proteinPerKg, 2);
  assert.equal(c.fatPerKg, 1);
  assert.equal('nonsense' in c, false);
});

// ---------------------------------------------------------------- following the targets

test('following the weekly targets for 8 weeks hits the goal rate within 0.1 kg/week', () => {
  const rates = [];
  for (const goal of [-0.5, 0.25]) {
    for (const seed of SEEDS) {
      let targets = { kcal: 2500, protein: 150, carbs: 300, fat: 70, source: 'manual' };
      const kcals = [];
      const profile = { sex: 'male', birthYear: 1990, heightCm: 180, activity: 'moderate' };
      const noise = prng(seed * 31 + 7);
      // weeks 0–3 eat around maintenance from a manual target, from day 28 follow each accepted check-in
      const sim = simulate({
        seed, days: 28 + 56 + 1, tdee: 2600, kcalPerKgMass: 20, intakeSd: 300,
        eat(d, s) {
          if (d >= 28 && d % 7 === 0) {
            const ci = buildCheckIn({ today: dayDate(d), weights: s.weights, intake: s.intake, goal: { rateKgPerWeek: goal }, profile, targets });
            assert.equal(ci.basisKind, 'data');
            const rec = checkInRecords(ci, 'accepted', targets, 0);
            if (kcals.length) assert.ok(Math.abs(rec.targets.kcal - kcals[kcals.length - 1]) <= 150);
            assert.ok(rec.targets.kcal >= 1500);
            targets = rec.targets;
            kcals.push(targets.kcal);
          }
          return d < 28 ? 2600 + (noise() - 0.5) * 200 : targets.kcal;
        },
      });
      // true mass slope over the 8 followed weeks
      const xs = []; const ys = [];
      for (let d = 28; d <= 84; d++) { xs.push(d); ys.push(sim.mass[d]); }
      const mx = mean(xs); const my = mean(ys);
      let sxy = 0; let sxx = 0;
      xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
      rates.push({ goal, rate: (sxy / sxx) * 7 });
    }
  }
  for (const goal of [-0.5, 0.25]) {
    const r = rates.filter((x) => x.goal === goal).map((x) => x.rate);
    const dev = r.map((x) => Math.abs(x - goal));
    console.log(`  # goal ${goal} kg/wk: achieved mean ${mean(r).toFixed(3)}, mean |dev| ${mean(dev).toFixed(3)}, worst |dev| ${Math.max(...dev).toFixed(3)}`);
    assert.ok(Math.abs(mean(r) - goal) <= 0.1);
    assert.ok(mean(dev) <= 0.1);
  }
});

// ---------------------------------------------------------------- check-in records

test('check-in: reviews the previous Mon-Sun week, accept writes adaptive targets, keep changes nothing', () => {
  const sim = simulate({ seed: 3, days: 50, offset: -400 });
  const today = dayDate(45); // a Wednesday (day 42 is a Monday)
  const targets = { kcal: 2000, protein: 120, carbs: 220, fat: 70, source: 'manual' };
  const ci = buildCheckIn({ today, weights: sim.weights, intake: sim.intake.filter((r) => r.date < today), goal: { rateKgPerWeek: -0.5 }, targets });
  assert.equal(ci.weekStart, dayDate(42));
  assert.equal(ci.reviewFrom, dayDate(35));
  assert.equal(ci.reviewTo, dayDate(41));
  assert.equal(ci.daysLogged, 7);
  assert.equal(ci.basisKind, 'data');
  const expectedAvg = mean(sim.intake.slice(35, 42).map((r) => r.kcal));
  assert.ok(Math.abs(ci.avgIntake - expectedAvg) < 1e-9);
  assert.ok(ci.trendChange < 0);
  const acc = checkInRecords(ci, 'accepted', targets, 123);
  assert.equal(acc.targets.source, 'adaptive');
  assert.equal(acc.targets.kcal, ci.proposal.kcal);
  assert.equal(acc.history.weekStart, dayDate(42));
  assert.equal(acc.history.decision, 'accepted');
  assert.equal(acc.history.createdAt, 123);
  const keep = checkInRecords(ci, 'kept', targets, 123);
  assert.equal(keep.targets, null);
  assert.equal(keep.history.kcalTarget, 2000);
  assert.equal(keep.history.decision, 'kept');
});

test('check-in falls back to the formula (labelled) when data are insufficient, none without profile', () => {
  const w = [{ date: '2026-01-05', kg: 80 }];
  const base = { today: '2026-01-12', weights: w, intake: [], goal: { rateKgPerWeek: 0 }, targets: { kcal: 2000, source: 'manual' } };
  const f = buildCheckIn({ ...base, profile: { sex: 'male', birthYear: 1990, heightCm: 180, activity: 'light' } });
  assert.equal(f.basisKind, 'formula');
  assert.ok(f.proposal.kcal > 2000);
  const none = buildCheckIn({ ...base, profile: { sex: 'male' } });
  assert.equal(none.basisKind, null);
  assert.equal(none.proposal, null);
});

test('dailyIntake uses nutrition.sumEntries per date', () => {
  const e = (date, kcal, amount = 100) => ({ date, amount, per100: { kcal, protein: 0, carbs: 0, fat: 0 } });
  assert.deepEqual(dailyIntake([e('2026-01-02', 500), e('2026-01-01', 200, 50), e('2026-01-02', 300)], sumEntries),
    [{ date: '2026-01-01', kcal: 100 }, { date: '2026-01-02', kcal: 800 }]);
});

test('weeklyIntake: Mon-Sun averages of complete days, today and incomplete days excluded', () => {
  // day 0 is a Monday
  const intake = [2000, 2200, 600, 2400, null, null, null, 1800, 2000].map((kcal, i) => (kcal === null ? null : { date: dayDate(i), kcal })).filter(Boolean);
  const w = weeklyIntake(intake, dayDate(8), dayDate(3));
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { from: dayDate(0), to: dayDate(6), avg: 2200, days: 3, incomplete: 1 });
  assert.deepEqual(w[1], { from: dayDate(7), to: dayDate(13), avg: 1800, days: 1, incomplete: 0 });
});

test('item 5: weekly target never moves more than the change limit from the previous target', () => {
  const t = weeklyTarget({ tdee: 2500, rateKgPerWeek: 0, weightKg: 80, previousKcal: 2005 });
  assert.ok(Math.abs(t.kcal - 2005) <= 150, `got ${t.kcal}`);
  assert.equal(t.kcal, 2150); // rounded toward the previous target
  assert.equal(t.limitedBy, 'change');
  const d = weeklyTarget({ tdee: 1500, rateKgPerWeek: 0, weightKg: 80, sex: 'male', previousKcal: 2005, config: { floors: { male: 1000 } } });
  assert.equal(d.kcal, 1860); // 1855 rounded toward 2005
  for (let prev = 1500; prev <= 3000; prev += 7) {
    for (const tdee of [1000, 2000, 2500, 4000]) {
      const r = weeklyTarget({ tdee, rateKgPerWeek: 0, weightKg: 80, sex: 'male', previousKcal: prev, config: { floors: { male: 1000 } } });
      assert.ok(Math.abs(r.kcal - prev) <= 150 || r.limitedBy === 'floor', `prev ${prev} tdee ${tdee} → ${r.kcal}`);
    }
  }
  // the floor still wins over the change limit
  assert.equal(weeklyTarget({ tdee: 1000, rateKgPerWeek: 0, weightKg: 60, sex: 'male', previousKcal: 1900 }).kcal, 1750);
  assert.equal(weeklyTarget({ tdee: 1000, rateKgPerWeek: 0, weightKg: 60, sex: 'male', previousKcal: 1600 }).kcal, 1500);
});

test('item 6: macros never exceed the calorie target; protein is capped and flagged', () => {
  const t = weeklyTarget({ tdee: 1300, rateKgPerWeek: -1, weightKg: 160, sex: 'female' });
  assert.equal(t.kcal, 1200);
  assert.ok(t.protein * 4 + t.fat * 9 + t.carbs * 4 <= t.kcal + 5, JSON.stringify(t));
  assert.ok(t.fat > 0, 'a small fat floor is kept');
  assert.equal(t.proteinLimited, true);
  assert.equal(t.proteinWanted, 320);
  assert.ok(t.protein < 320);
  // normal case: no flag
  const n = weeklyTarget({ tdee: 2600, rateKgPerWeek: -0.5, weightKg: 80, sex: 'male' });
  assert.equal(n.proteinLimited, false);
  assert.equal(n.protein, 160);
});
