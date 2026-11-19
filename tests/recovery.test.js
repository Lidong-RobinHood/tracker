import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  muscleRecovery, recoveryWindow, doseFactor, sortByRecovery, recoveryWords, paceFactor, recoverySettings,
  sessionTime, fmtSpanRange, RECOVERY_CONFIG, lookbackFrom,
} from '../src/core/recovery.js';

const H = 3600000;
const NOW = new Date(2026, 10, 18, 12, 0, 0).getTime(); // Wed 18 Nov 2026 12:00 local
const DEF = { primary: 1, secondary: 0.5, dropset: 0 };
const EX = new Map([
  ['bench', { id: 'bench', primary: ['chest'], secondary: ['triceps', 'shoulders'] }],
  ['curl', { id: 'curl', primary: ['biceps'], secondary: ['forearms'] }],
  ['squat', { id: 'squat', primary: ['quads', 'glutes'], secondary: ['hamstrings'] }],
  ['calf', { id: 'calf', primary: ['calves'], secondary: [] }],
]);
const S = (n, type = 'normal', done = true) => Array.from({ length: n }, () => ({ weight: 50, reps: 8, type, done }));
let seq = 0;
const W = (hoursAgo, exercises, { finished = true } = {}) => {
  const at = NOW - hoursAgo * H;
  const d = new Date(at);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    id: `w${++seq}`, name: 'Test', date, startedAt: at - H, finishedAt: finished ? at : null,
    exercises: Object.entries(exercises).map(([exerciseId, sets]) => ({ exerciseId, sets })),
  };
};
const get = (rows, m) => rows.find((r) => r.muscle === m);
const run = (ws, opts = {}) => muscleRecovery(ws, EX, opts.weights || DEF, { now: NOW, ...opts });

test('never trained: every muscle fresh, no NaN', () => {
  const rows = run([]);
  assert.equal(rows.length, 12);
  for (const r of rows) {
    assert.equal(r.status, 'fresh');
    assert.equal(r.trained, false);
    assert.equal(r.progress, 100);
    assert.equal(recoveryWords(r), 'no recent training');
  }
});

test('now is required (no reliance on the real clock)', () => {
  assert.throws(() => muscleRecovery([], EX, DEF, {}));
});

test('dose factor: 1 set 0.7, 4 sets 1.0, 8 sets 1.4, capped at 1.5', () => {
  assert.equal(doseFactor(1), 0.7);
  assert.equal(doseFactor(4), 1);
  assert.ok(Math.abs(doseFactor(8) - 1.4) < 1e-9);
  assert.equal(doseFactor(30), 1.5);
  assert.equal(doseFactor(NaN), 0.7);
});

test('windows: reference dose gives base; caps 24..120; small vs large muscle', () => {
  assert.deepEqual(recoveryWindow('chest', 4), [48, 72]);
  assert.deepEqual(recoveryWindow('quads', 4), [60, 96]);
  assert.deepEqual(recoveryWindow('calves', 4), [24, 48]);
  assert.deepEqual(recoveryWindow('calves', 1), [24, 34]); // 16.8 → 24, 33.6
  assert.deepEqual(recoveryWindow('quads', 20), [90, 120]); // 144 capped
  assert.deepEqual(recoveryWindow('quads', 20, 1.25), [113, 120]); // 112.5 → 113; max ≥ min ok
  assert.deepEqual(recoveryWindow('calves', 1, 0.8), [24, 32]); // min 24, width ≥ 8
  for (const m of Object.keys(RECOVERY_CONFIG.base)) {
    for (const d of [0, 1, 3, 6, 12, 50]) {
      for (const f of [0.8, 1, 1.25]) {
        const [a, b] = recoveryWindow(m, d, f);
        assert.ok(a >= 24 && b <= 120 && b >= a, `${m} ${d} ${f}`);
      }
    }
  }
});

test('just trained: small dose shorter than large dose; small muscle shorter than large', () => {
  const light = get(run([W(0, { bench: S(2) })]), 'chest');
  const heavy = get(run([W(0, { bench: S(8) })]), 'chest');
  assert.equal(light.status, 'recovering');
  assert.deepEqual([light.minHours, light.maxHours], [38, 58]); // 0.8
  assert.deepEqual([heavy.minHours, heavy.maxHours], [67, 101]); // 1.4 → 67.2, 100.8
  assert.ok(heavy.maxHours > light.maxHours);
  const rows = run([W(0, { squat: S(4), calf: S(4) })]);
  assert.ok(get(rows, 'quads').maxHours > get(rows, 'calves').maxHours);
  assert.equal(get(rows, 'quads').hoursSince, 0);
  assert.equal(get(rows, 'quads').progress, 0);
});

test('secondary-only work: below threshold ignored, at/above threshold counts', () => {
  // 1 bench set → triceps 0.5: ignored
  let r = get(run([W(2, { bench: S(1) })]), 'triceps');
  assert.equal(r.trained, false);
  assert.equal(r.status, 'fresh');
  // 2 bench sets → triceps 1.0: counts, dose factor 0.7 → [25, 42]
  r = get(run([W(2, { bench: S(2) })]), 'triceps');
  assert.equal(r.trained, true);
  assert.equal(r.lastDose, 1);
  assert.deepEqual([r.minHours, r.maxHours], [25, 42]);
  // a sub-threshold session after a real one does not reset the window
  const rows = run([W(30, { bench: S(4) }), W(1, { bench: S(1) })]);
  const tri = get(rows, 'triceps'); // 4 bench → triceps 2 → 0.8 → [29, 48]
  assert.equal(tri.lastAt, NOW - 30 * H);
  assert.equal(tri.sessions.length, 1);
});

test('dropsets: weight 0 adds nothing, 0.5 adds half a set', () => {
  const w = W(0, { calf: [...S(2), ...S(2, 'dropset')] });
  assert.equal(get(run([w]), 'calves').lastDose, 2);
  assert.equal(get(run([w], { weights: { ...DEF, dropset: 0.5 } }), 'calves').lastDose, 3);
  // undone sets never count
  assert.equal(get(run([W(0, { calf: [...S(2), ...S(3, 'normal', false)] })]), 'calves').lastDose, 2);
});

test('two sessions close together: remaining fatigue carries over', () => {
  // chest 4 sets 24 h before a second 4-set session (now - 0 h): carry 4 × (1 − 24/72) = 2.67
  const a = W(24, { bench: S(4) });
  const b = W(0, { bench: S(4) });
  const r = get(run([b, a]), 'chest');
  assert.equal(r.dose, 6.67);
  assert.equal(r.lastDose, 4);
  assert.deepEqual([r.minHours, r.maxHours], [61, 91]); // factor 1.267
  assert.equal(r.sessions.length, 2);
  assert.equal(r.sessions[0].workoutId, b.id);
  assert.equal(r.sessions[0].carried, 2.67);
  // after the previous max has passed: fresh window, no carry
  const r2 = get(run([W(80, { bench: S(4) }), W(0, { bench: S(4) })]), 'chest');
  assert.equal(r2.dose, 4);
  assert.equal(r2.sessions.length, 1);
});

test('exact boundaries: at min → likely ready, at max → fresh', () => {
  // chest 4 sets → [48, 72]
  const at = (h) => get(run([W(h, { bench: S(4) })]), 'chest');
  assert.equal(at(47.99).status, 'recovering');
  assert.equal(at(48).status, 'likely-ready');
  assert.equal(at(71.99).status, 'likely-ready');
  assert.equal(at(72).status, 'fresh');
  assert.equal(at(72).progress, 100);
  assert.equal(at(36).progress, 50);
  assert.equal(at(48).readyAt, NOW);
  assert.equal(recoveryWords(at(72)), 'recovered');
  assert.equal(recoveryWords(at(60)), 'likely ready — full recovery in up to 12 h');
  assert.equal(recoveryWords(at(24)), 'ready in about 1–2 days');
});

test('words: hours below 48, days above', () => {
  assert.equal(fmtSpanRange(10, 34), '10–34 h');
  assert.equal(fmtSpanRange(24, 48), '1–2 days');
  assert.equal(fmtSpanRange(60, 96), '2.5–4 days');
  const r = get(run([W(14, { bench: S(4) })]), 'chest'); // 34–58 h left
  assert.equal(recoveryWords(r), 'ready in about 1.5–2.5 days');
  const c = get(run([W(14, { calf: S(4) })]), 'calves'); // [24, 48] → 10–34 h
  assert.equal(recoveryWords(c), 'ready in about 10–34 h');
});

test('personal factor scales the window', () => {
  assert.equal(paceFactor(undefined), 1);
  assert.equal(paceFactor({ pace: 'faster' }), 0.8);
  assert.equal(paceFactor({ pace: 'slower' }), 1.25);
  assert.deepEqual(recoverySettings({ pace: 'bogus' }), { pace: 'average' });
  const w = [W(0, { bench: S(4) })];
  assert.deepEqual([get(run(w, { factor: 0.8 }), 'chest').minHours, get(run(w, { factor: 0.8 }), 'chest').maxHours], [38, 58]);
  assert.deepEqual([get(run(w, { factor: 1.25 }), 'chest').minHours, get(run(w, { factor: 1.25 }), 'chest').maxHours], [60, 90]);
});

test('in-progress session counts its done sets at startedAt', () => {
  const w = W(0, { curl: [...S(3), ...S(2, 'normal', false)] }, { finished: false });
  assert.equal(sessionTime(w), NOW - H);
  const r = get(run([w]), 'biceps');
  assert.equal(r.lastDose, 3);
  assert.equal(r.hoursSince, 1);
  assert.equal(r.sessions[0].finished, false);
});

test('session time falls back to end of date; future sessions give 0 h, never negative', () => {
  assert.equal(sessionTime({ date: '2026-11-18' }), new Date(2026, 10, 19).getTime() - 1);
  const r = get(muscleRecovery([{ id: 'x', date: '2026-11-18', exercises: [{ exerciseId: 'calf', sets: S(4) }] }], EX, DEF, { now: NOW }), 'calves');
  assert.equal(r.hoursSince, 0);
  assert.equal(r.status, 'recovering');
  for (const row of run([W(5, { bench: S(3), squat: S(5), curl: S(2) })])) {
    for (const k of ['hoursSince', 'minHours', 'maxHours', 'progress', 'dose']) {
      if (row[k] !== null) assert.ok(Number.isFinite(row[k]) && row[k] >= 0, `${row.muscle}.${k}`);
    }
  }
});

test('lookback: sessions older than 14 days are ignored; lookbackFrom date', () => {
  assert.equal(get(run([W(15 * 24, { bench: S(4) })]), 'chest').trained, false);
  assert.equal(lookbackFrom(NOW), '2026-11-04');
});

test('sort: least recovered first, fresh last', () => {
  const rows = sortByRecovery(run([W(60, { bench: S(4) }), W(2, { calf: S(4) }), W(30, { squat: S(4) })]));
  assert.deepEqual(rows.slice(0, 5).map((r) => r.muscle), ['calves', 'glutes', 'quads', 'hamstrings', 'chest']);
  assert.equal(rows.at(-1).status, 'fresh');
});

// ---------------------------------------------------------------- custom base ranges
import { validateRange, sanitiseBase, withBase, baseRange } from '../src/core/recovery.js';

test('validateRange: whole hours, min ≥ 6, max ≤ 240, max ≥ min + 4', () => {
  assert.deepEqual(validateRange(12, 20), { ok: true, value: [12, 20] });
  assert.deepEqual(validateRange(6, 10), { ok: true, value: [6, 10] });
  assert.deepEqual(validateRange(236, 240), { ok: true, value: [236, 240] });
  for (const [a, b] of [[5, 20], [12, 241], [12, 15], [12.5, 20], [12, null], [NaN, 20], ['12', 20]]) {
    assert.equal(validateRange(a, b).ok, false, `${a}-${b}`);
  }
});

test('recoverySettings keeps pace and only valid overrides; withBase sets and resets', () => {
  assert.deepEqual(recoverySettings({ pace: 'slower' }), { pace: 'slower' });
  assert.deepEqual(recoverySettings({ pace: 'faster', base: { chest: [12, 20], nope: [10, 20], back: [3, 9], quads: [100, 'x'] } }),
    { pace: 'faster', base: { chest: [12, 20] } });
  assert.deepEqual(sanitiseBase(null), {});
  const v1 = withBase({ pace: 'slower' }, 'chest', [30, 40]);
  assert.deepEqual(v1, { pace: 'slower', base: { chest: [30, 40] } });
  const v2 = withBase(v1, 'quads', [100, 200]);
  assert.deepEqual(v2.base, { chest: [30, 40], quads: [100, 200] });
  assert.deepEqual(withBase(v2, 'chest', null), { pace: 'slower', base: { quads: [100, 200] } });
  assert.deepEqual(withBase(withBase(v2, 'chest', null), 'quads', null), { pace: 'slower' });
  assert.throws(() => withBase(v1, 'chest', [10, 12]));
  assert.deepEqual(v1, { pace: 'slower', base: { chest: [30, 40] } }); // not mutated
  assert.deepEqual(baseRange('chest', v2.base), { range: [30, 40], custom: true });
  assert.deepEqual(baseRange('back', v2.base), { range: [48, 72], custom: false });
});

test('custom range: exact at the reference dose, default caps do not clip it', () => {
  // Below the default 24 h cap and narrower than the default 8 h width.
  assert.deepEqual(recoveryWindow('chest', 4, 1, RECOVERY_CONFIG, [12, 16]), [12, 16]);
  // Above the default 120 h cap.
  assert.deepEqual(recoveryWindow('quads', 4, 1, RECOVERY_CONFIG, [100, 200]), [100, 200]);
  // Dose and pace still scale it; the input limits 6–240 h are the caps then.
  assert.deepEqual(recoveryWindow('quads', 9, 1, RECOVERY_CONFIG, [100, 200]), [150, 240]);
  assert.deepEqual(recoveryWindow('chest', 1, 1, RECOVERY_CONFIG, [12, 16]), [8, 12]); // 8.4, 11.2 → width 4 kept
  assert.deepEqual(recoveryWindow('chest', 1, 0.8, RECOVERY_CONFIG, [6, 10]), [6, 10]); // 3.4 → 6 floor; width 4
  assert.deepEqual(recoveryWindow('chest', 4, 1.25, RECOVERY_CONFIG, [30, 40]), [38, 50]); // 37.5 → 38
  // Without a custom range nothing changed.
  assert.deepEqual(recoveryWindow('chest', 4), [48, 72]);
});

test('muscleRecovery uses overrides for that muscle only and marks it custom', () => {
  const w = [W(20, { bench: S(4) })]; // chest 4 sets, triceps/shoulders 2
  const def = run(w);
  const own = run(w, { base: { chest: [12, 16] } });
  assert.deepEqual([get(def, 'chest').minHours, get(def, 'chest').maxHours], [48, 72]);
  assert.equal(get(def, 'chest').status, 'recovering');
  assert.deepEqual([get(own, 'chest').minHours, get(own, 'chest').maxHours], [12, 16]);
  assert.equal(get(own, 'chest').status, 'fresh'); // 20 h ≥ 16 h
  assert.equal(get(own, 'chest').custom, true);
  assert.equal(get(own, 'triceps').custom, false);
  assert.deepEqual([get(own, 'triceps').minHours, get(own, 'triceps').maxHours], [get(def, 'triceps').minHours, get(def, 'triceps').maxHours]);
  // Pace applies after the override.
  const slow = run(w, { base: { chest: [12, 16] }, factor: 1.25 });
  assert.deepEqual([get(slow, 'chest').minHours, get(slow, 'chest').maxHours], [15, 20]);
});
