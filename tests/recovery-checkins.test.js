// Recovery check-ins: storage helpers, effect on the current estimate, learning a personal base range,
// precedence (hand-set > learned > rule of thumb) and a seeded simulator of a person checking in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  muscleRecovery, recoveryWords, doseFactor, recoveryWindow, RECOVERY_CONFIG, CHECKIN_CONFIG,
  makeCheckin, addCheckin, removeCheckin, sanitiseCheckins, applyCheckin, checkinBouts, learnRange, learnRanges,
  learnedBase, recoverySettings, withBase, withRule, validateRange, fmtAgo,
} from '../src/core/recovery.js';

const H = 3600000;
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime();
const DEF = { primary: 1, secondary: 0.5, dropset: 0 };
const EX = new Map([
  ['bench', { id: 'bench', primary: ['chest'], secondary: ['triceps', 'shoulders'] }],
  ['squat', { id: 'squat', primary: ['quads', 'glutes'], secondary: ['hamstrings'] }],
]);
const S = (n) => Array.from({ length: n }, () => ({ weight: 50, reps: 8, type: 'normal', done: true }));
const W = (hoursAgo, exercises, id = `w${hoursAgo}`) => {
  const at = NOW - hoursAgo * H;
  const d = new Date(at);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { id, name: 'T', date, startedAt: at - H, finishedAt: at, exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({ exerciseId, sets })) };
};
const get = (rows, m) => rows.find((r) => r.muscle === m);
const run = (ws, opts = {}, now = NOW) => muscleRecovery(ws, EX, DEF, { now, ...opts });
let n = 0;
const ck = (muscle, answer, hours, { boutAt = 0, dose = 4, at } = {}) => ({
  id: `c${++n}`, muscle, answer, at: at ?? boutAt + hours * H, boutAt, hours, dose, sets: dose, range: [48, 72], source: 'rule',
});

// ---------------------------------------------------------------- storage helpers

test('makeCheckin stores answer, hours since the bout, dose and the range shown then', () => {
  const r = get(run([W(30, { bench: S(6) })]), 'chest');
  const c = makeCheckin(r, 'sore', NOW, 'x1');
  assert.deepEqual(c, {
    id: 'x1', muscle: 'chest', answer: 'sore', at: NOW, boutAt: NOW - 30 * H, hours: 30, dose: 6, sets: 6,
    range: [r.minHours, r.maxHours], source: 'rule',
  });
  assert.throws(() => makeCheckin(get(run([]), 'chest'), 'sore', NOW, 'x'));
  assert.throws(() => makeCheckin(r, 'maybe', NOW, 'x'));
});

test('add / remove / sanitise: newest last, capped, invalid dropped, no mutation', () => {
  const a = ck('chest', 'sore', 30);
  const list = addCheckin([], a);
  assert.deepEqual(list, [a]);
  const b = ck('chest', 'recovered', 50);
  const l2 = addCheckin(list, b);
  assert.deepEqual(l2.map((c) => c.id), [a.id, b.id]);
  assert.deepEqual(list, [a]);
  assert.deepEqual(removeCheckin(l2, a.id), [b]);
  const many = Array.from({ length: 5 }, (_, i) => ck('chest', 'sore', i + 1));
  assert.deepEqual(addCheckin(many, b, 3).map((c) => c.id), [many[3].id, many[4].id, b.id]);
  assert.deepEqual(sanitiseCheckins([null, { id: 'x' }, { ...a, muscle: 'nope' }, { ...a, answer: 'meh' }, a, 'x']), [a]);
  assert.deepEqual(sanitiseCheckins(undefined), []);
  assert.equal(CHECKIN_CONFIG.cap, 2000);
});

// ---------------------------------------------------------------- effect on the current estimate

test('"recovered" shows the muscle recovered for the rest of the bout, marked as the user\'s', () => {
  const ws = [W(30, { bench: S(4) })]; // chest 48–72 h, recovering at 30 h
  const bout = NOW - 30 * H;
  const c = ck('chest', 'recovered', 24, { boutAt: bout });
  const r = get(run(ws, { checkins: [c] }), 'chest');
  assert.equal(r.modelStatus, 'recovering');
  assert.equal(r.status, 'fresh');
  assert.equal(r.progress, 100);
  assert.equal(recoveryWords(r), 'you said recovered · 6 h ago');
  // Training again starts a new bout: the old answer no longer applies.
  const r2 = get(run([...ws, W(2, { bench: S(4) }, 'again')], { checkins: [c] }), 'chest');
  assert.equal(r2.said, null);
  assert.equal(r2.status, 'recovering');
});

test('"still sore" after the predicted max keeps the muscle recovering, labelled, then eases off', () => {
  const ws = [W(80, { bench: S(4) })]; // 48–72 h → fresh at 80 h
  const bout = NOW - 80 * H;
  const c = ck('chest', 'sore', 74, { boutAt: bout }); // 6 h ago
  const r = get(run(ws, { checkins: [c] }), 'chest');
  assert.equal(r.modelStatus, 'fresh');
  assert.equal(r.status, 'recovering');
  assert.equal(r.said.shown, true);
  assert.equal(recoveryWords(r), 'you said still sore · 6 h ago');
  assert.deepEqual([r.minHours, r.maxHours], [48, 72]); // the estimate itself is not rewritten
  // Held w = max(12, 72 − 48) = 24 h recovering, then 24 h likely ready, then the model again.
  const at = (h) => get(run(ws, { checkins: [c] }, bout + h * H), 'chest').status;
  assert.equal(at(97.9), 'recovering');
  assert.equal(at(98), 'likely-ready');
  assert.equal(at(121.9), 'likely-ready');
  assert.equal(at(122), 'fresh');
});

test('"still sore" inside the window turns likely ready into recovering; before it changes nothing', () => {
  const ws = [W(60, { bench: S(4) })]; // likely ready at 60 h
  const bout = NOW - 60 * H;
  const r = get(run(ws, { checkins: [ck('chest', 'sore', 58, { boutAt: bout })] }), 'chest');
  assert.equal(r.modelStatus, 'likely-ready');
  assert.equal(r.status, 'recovering');
  assert.match(recoveryWords(r), /^you said still sore · 2 h ago$/);
  const early = get(run([W(20, { bench: S(4) })], { checkins: [ck('chest', 'sore', 18, { boutAt: NOW - 20 * H })] }), 'chest');
  assert.equal(early.status, 'recovering');
  assert.equal(early.said.shown, false); // agrees with the model: the model's words stay
  assert.match(recoveryWords(early), /^ready in about/);
});

test('the latest answer of the bout wins; future check-ins are ignored', () => {
  const ws = [W(60, { bench: S(4) })];
  const bout = NOW - 60 * H;
  const list = [ck('chest', 'sore', 30, { boutAt: bout }), ck('chest', 'recovered', 55, { boutAt: bout })];
  assert.equal(get(run(ws, { checkins: list }), 'chest').status, 'fresh');
  const later = [...list, ck('chest', 'sore', 59, { boutAt: bout })];
  assert.equal(get(run(ws, { checkins: later }), 'chest').status, 'recovering');
  const future = [...list, ck('chest', 'sore', 70, { boutAt: bout })];
  assert.equal(get(run(ws, { checkins: future }), 'chest').status, 'fresh');
});

test('no check-ins: identical rows to the model without them (existing users)', () => {
  const ws = [W(30, { bench: S(5) }), W(70, { squat: S(6) })];
  const a = run(ws, { factor: 1.25 });
  const b = run(ws, { factor: 1.25, checkins: [], learned: null });
  assert.deepEqual(a, b);
  for (const r of a) assert.equal(r.source, 'rule');
  assert.equal(fmtAgo(0.2), 'just now');
  assert.equal(fmtAgo(50), '2 days ago');
});

// ---------------------------------------------------------------- learning

test('brackets: normalised by the dose factor; contradicting answers of a bout are both left out', () => {
  const list = [
    ck('chest', 'sore', 30, { boutAt: 1, dose: 8 }), ck('chest', 'sore', 40, { boutAt: 1, dose: 8 }),
    ck('chest', 'recovered', 70, { boutAt: 1, dose: 8 }),
    // bout 2: recovered at 40, then still sore at 50 → both ignored for learning; the sore at 20 stays
    ck('chest', 'sore', 20, { boutAt: 2 * H * 1000 }),
    ck('chest', 'recovered', 40, { boutAt: 2 * H * 1000 }), ck('chest', 'sore', 50, { boutAt: 2 * H * 1000 }),
  ];
  const [b2, b1] = checkinBouts(list, 'chest');
  const f8 = doseFactor(8); // 1.4
  assert.ok(Math.abs(b1.lo - 40 / f8) < 1e-9 && Math.abs(b1.hi - 70 / f8) < 1e-9);
  assert.equal(b1.kept.length, 3);
  assert.equal(b2.lo, 20);
  assert.equal(b2.hi, null);
  assert.deepEqual(b2.ignored.map((c) => c.hours).sort(), [40, 50]);
  // A bout with only contradicting answers adds no bout and no point.
  const only = [ck('chest', 'recovered', 40, { boutAt: 7 }), ck('chest', 'sore', 50, { boutAt: 7 })];
  assert.deepEqual([learnRange(only, 'chest').bouts, learnRange(only, 'chest').points], [0, 0]);
});

test('minimum: 5 informative answers from 3 bouts with both kinds; progress reported before', () => {
  const B = (i) => i * 100 * H;
  const four = [
    ck('back', 'sore', 40, { boutAt: B(1) }), ck('back', 'recovered', 60, { boutAt: B(1) }),
    ck('back', 'sore', 45, { boutAt: B(2) }), ck('back', 'recovered', 62, { boutAt: B(3) }),
  ];
  const r4 = learnRange(four, 'back');
  assert.equal(r4.learned, false);
  assert.deepEqual([r4.points, r4.bouts, r4.needPoints, r4.needBouts], [4, 3, 5, 3]);
  // Repeated "still sore" in one bout adds no information: still 4.
  assert.equal(learnRange([...four, ck('back', 'sore', 30, { boutAt: B(1) })], 'back').points, 4);
  const five = [...four, ck('back', 'sore', 44, { boutAt: B(3) })];
  const r5 = learnRange(five, 'back');
  assert.equal(r5.learned, true);
  assert.equal(validateRange(r5.range[0], r5.range[1]).ok, true);
  // Only one kind of answer: a bound, not a range → not learned.
  const onlyRec = [1, 2, 3, 4, 5].map((i) => ck('back', 'recovered', 50, { boutAt: B(i) }));
  assert.equal(learnRange(onlyRec, 'back').learned, false);
  // Two bouts only → not learned however many answers.
  const twoBouts = [ck('back', 'sore', 40, { boutAt: B(1) }), ck('back', 'recovered', 60, { boutAt: B(1) }),
    ck('back', 'sore', 41, { boutAt: B(2) }), ck('back', 'recovered', 61, { boutAt: B(2) })];
  assert.equal(learnRange(twoBouts, 'back').learned, false);
});

test('hand check: three clean brackets → median centre, widened to the minimum width for 3 bouts', () => {
  // brackets at 4 sets (factor 1): (50, 60], (52, 64], (56, 66] → points sore 50 52 56, recovered 60 64 66
  const B = (i) => i * 100 * H;
  const list = [
    ck('chest', 'sore', 50, { boutAt: B(1) }), ck('chest', 'recovered', 60, { boutAt: B(1) }),
    ck('chest', 'sore', 52, { boutAt: B(2) }), ck('chest', 'recovered', 64, { boutAt: B(2) }),
    ck('chest', 'sore', 56, { boutAt: B(3) }), ck('chest', 'recovered', 66, { boutAt: B(3) }),
  ];
  const r = learnRange(list, 'chest');
  // Isotonic F: 0 up to 56, 1 from 60; linear between → median 58, q25 57, q75 59 (spread 2 h).
  // Only 3 bouts: width floor = max(8, clamp(1.5 / √3, 0.3, 0.6) × 58) = 0.6 × 58 = 34.8 h
  // → 58 ± 17.4 → 40.6–75.4 → 41–75. With more bouts the floor shrinks to 0.3 × centre.
  assert.equal(r.centre, 58);
  assert.deepEqual(r.range, [41, 75]);
});

test('precedence: hand-set > learned > rule of thumb; pace only on the rule of thumb', () => {
  const ws = [W(20, { bench: S(4) })];
  const learned = { chest: [30, 44] };
  const rows = run(ws, { learned, factor: 1.25 });
  assert.equal(get(rows, 'chest').source, 'yours');
  assert.deepEqual([get(rows, 'chest').minHours, get(rows, 'chest').maxHours], [30, 44]); // no pace
  assert.equal(get(rows, 'chest').custom, false);
  const set = run(ws, { learned, base: { chest: [12, 16] }, factor: 1.25 });
  assert.equal(get(set, 'chest').source, 'set');
  assert.deepEqual([get(set, 'chest').minHours, get(set, 'chest').maxHours], [12, 16]);
  // learned scales with the dose like a hand-set range
  assert.deepEqual(recoveryWindow('chest', 8, 1, RECOVERY_CONFIG, [30, 44]), [42, 62]);
  // learnedBase honours the "keep rule of thumb" list
  const lr = { chest: { learned: true, range: [30, 44] }, back: { learned: false, range: null } };
  assert.deepEqual(learnedBase(lr), { chest: [30, 44] });
  assert.equal(learnedBase(lr, ['chest']), null);
});

test('settings: rule list kept, sanitised and toggled; withBase keeps it', () => {
  assert.deepEqual(recoverySettings({ pace: 'faster', rule: ['chest', 'nope', 'back'] }), { pace: 'faster', rule: ['chest', 'back'] });
  const v = withRule({ pace: 'slower' }, 'quads', true);
  assert.deepEqual(v, { pace: 'slower', rule: ['quads'] });
  assert.deepEqual(withBase(v, 'chest', [30, 40]), { pace: 'slower', base: { chest: [30, 40] }, rule: ['quads'] });
  assert.deepEqual(withRule(v, 'quads', false), { pace: 'slower' });
});

// ---------------------------------------------------------------- simulator

/** mulberry32 */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rand) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * A person with true base recovery time `truth` h (at 4 sets) for a muscle. Each bout: a random dose
 * of 2–9 sets, real recovery = truth × doseFactor × lognormal noise (σ 0.12); 1–2 check-ins at random
 * times across the default window × 0.5–1.5 (people do not know the truth). Answers are honest.
 */
function simulate({ seed, muscle = 'chest', truth, bouts, startBout = 0, truthAt = () => truth }) {
  const rand = prng(seed);
  const out = [];
  const def = RECOVERY_CONFIG.base[muscle];
  for (let i = 0; i < bouts; i++) {
    const b = startBout + i;
    const dose = 2 + Math.floor(rand() * 8);
    const f = doseFactor(dose);
    const real = truthAt(b) * f * Math.exp(0.12 * gauss(rand));
    const k = 1 + (rand() < 0.5 ? 1 : 0);
    const times = Array.from({ length: k }, () => (0.5 * def[0] + rand() * (1.5 * def[1] - 0.5 * def[0])) * f).sort((x, y) => x - y);
    for (const t of times) {
      const boutAt = b * 7 * 24 * H;
      out.push({
        id: `s${seed}-${b}-${t}`, muscle, answer: t >= real ? 'recovered' : 'sore', at: boutAt + t * H, boutAt,
        hours: Math.round(t * 10) / 10, dose, sets: dose, range: def, source: 'rule',
      });
    }
  }
  return out;
}
const mid = (r) => (r.range[0] + r.range[1]) / 2;
const pct = (xs, p) => { const v = xs.slice().sort((x, y) => x - y); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
const report = [];

// Figures over fixed seed ranges (deterministic). The person checks in at random times across the
// rule-of-thumb window (they do not know their own time), so for people far from the default many
// answers say little — the hard case.
test('simulator: with enough check-ins the range contains the truth, midpoint within 15 %', () => {
  const errs = [];
  let cover = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const truth = 35 + ((seed * 13) % 60); // 35–94 h at 4 sets
    const r = learnRange(simulate({ seed, truth, bouts: 20 }), 'chest');
    assert.equal(r.learned, true, `seed ${seed}`);
    errs.push(Math.abs(mid(r) - truth) / truth);
    if (r.range[0] <= truth && truth <= r.range[1]) cover++;
  }
  const within = errs.filter((e) => e <= 0.15).length / errs.length;
  report.push(`accuracy, 20 bouts (~30 check-ins), 120 people: median error ${(pct(errs, 0.5) * 100).toFixed(1)} %, `
    + `90th pct ${(pct(errs, 0.9) * 100).toFixed(1)} %, worst ${(pct(errs, 1) * 100).toFixed(1)} %, within 15 %: ${(within * 100).toFixed(0)} %, `
    + `range contains truth: ${((cover / errs.length) * 100).toFixed(0)} %`);
  assert.ok(pct(errs, 0.5) <= 0.08);
  assert.ok(within >= 0.88, `within 15 %: ${within}`);
  assert.ok(cover / errs.length >= 0.9);
  assert.ok(pct(errs, 1) <= 0.3); // never wild: no extrapolation beyond the answers
});

test('simulator: below the minimum nothing is learned (the default stays)', () => {
  for (let seed = 10; seed < 60; seed++) {
    assert.equal(learnRange(simulate({ seed, truth: 50, bouts: 2 }), 'chest').learned, false);
    assert.equal(learnRange(simulate({ seed, truth: 50, bouts: 8 }).slice(0, 4), 'chest').learned, false);
  }
});

test('simulator: five wrong answers among thirty shift the midpoint little', () => {
  const shifts = [];
  for (let seed = 1; seed <= 100; seed++) {
    const truth = 40 + ((seed * 13) % 50);
    const all = simulate({ seed, truth, bouts: 40 });
    const clean = all.slice(all.length - 30); // the 30 newest check-ins
    const rand = prng(seed * 7);
    const idx = new Set();
    while (idx.size < 5) idx.add(Math.floor(rand() * clean.length));
    const noisy = clean.map((c, i) => (idx.has(i) ? { ...c, answer: c.answer === 'sore' ? 'recovered' : 'sore' } : c));
    const a = learnRange(clean, 'chest');
    const b = learnRange(noisy, 'chest');
    if (!a.learned || !b.learned) continue;
    shifts.push(Math.abs(mid(b) - mid(a)) / mid(a));
  }
  const within = shifts.filter((x) => x <= 0.15).length / shifts.length;
  report.push(`5 wrong of 30, ${shifts.length} people: median shift ${(pct(shifts, 0.5) * 100).toFixed(1)} %, `
    + `75th pct ${(pct(shifts, 0.75) * 100).toFixed(1)} %, 90th pct ${(pct(shifts, 0.9) * 100).toFixed(1)} %, within 15 %: ${(within * 100).toFixed(0)} %`);
  assert.ok(shifts.length >= 95);
  assert.ok(pct(shifts, 0.5) <= 0.08);
  assert.ok(within >= 0.75, `within 15 %: ${within}`);
});

test('simulator: a change of the true value (70 → 50 h) is tracked', () => {
  const needed = [];
  for (let seed = 1; seed <= 60; seed++) {
    const old = simulate({ seed, truth: 70, bouts: 25 });
    const fresh = simulate({ seed: seed + 1000, truth: 50, bouts: 30, startBout: 25 });
    let k = 1;
    for (; k <= 30; k++) {
      const seen = new Set();
      const add = fresh.filter((c) => { seen.add(c.boutAt); return seen.size <= k; });
      const r = learnRange([...old, ...add], 'chest');
      if (Math.abs(mid(r) - 50) / 50 <= 0.15) break;
    }
    needed.push(k);
  }
  report.push(`70 → 50 h, 60 people: midpoint within 15 % of the new value after a median of ${pct(needed, 0.5)} new bouts, `
    + `90th pct ${pct(needed, 0.9)}`);
  assert.ok(pct(needed, 0.5) <= 10);
  assert.ok(pct(needed, 0.9) <= 20);
});

test('simulator: learned ranges stay valid inputs (6–240 h, whole hours, width ≥ 4)', () => {
  for (let seed = 100; seed < 160; seed++) {
    const truth = 10 + ((seed * 37) % 200);
    const r = learnRange(simulate({ seed, truth, bouts: 3 + (seed % 25), muscle: 'quads' }), 'quads');
    if (r.learned) assert.equal(validateRange(r.range[0], r.range[1]).ok, true, `${seed}: ${r.range}`);
  }
  const all = learnRanges([]);
  assert.equal(Object.keys(all).length, 12);
  if (process.env.SIM_REPORT) console.log(report.join('\n'));
});

test('applyCheckin leaves untrained rows alone', () => {
  const r = get(run([]), 'chest');
  assert.equal(applyCheckin(r, [ck('chest', 'sore', 3)], NOW), r);
});
