// The split catalogue (src/data/splits.js) as shipped: ids, equipment, set/rep ranges, wording, coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPLITS, STYLES, LEVELS, EQUIPMENT, HOME_EQUIPMENT, SHARED_BULLETS, SPLIT_DISCLAIMER, splitById } from '../src/data/splits.js';
import { SEED_EXERCISES, fitsHome, exerciseGear } from '../src/data/exercises.js';
import { MUSCLE_IDS } from '../src/core/muscles.js';
import { splitCoverage, perWeek, resolveSessions } from '../src/core/splits.js';

const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const words = (s) => s.trim().split(/\s+/).length;

// Authored / commercial program names and informal labels that must never appear (docs/SPLITS.md).
const DENYLIST = [/starting strength/i, /stronglifts/i, /5\s*\/\s*3\s*\/\s*1/, /wendler/i, /\bphat\b/i, /\bphul\b/i, /gzcl/i,
  /nsuns/i, /madcow/i, /texas method/i, /greyskull/i, /reddit/i, /arnold/i, /\bbro\b/i, /5\s*x\s*5/i];

test('14 splits, unique stable ids, 2–6 days, known style / level / equipment', () => {
  assert.equal(SPLITS.length, 14);
  assert.equal(new Set(SPLITS.map((s) => s.id)).size, SPLITS.length);
  for (const s of SPLITS) {
    assert.match(s.id, /^[a-z0-9-]+$/);
    assert.ok(Number.isInteger(s.days) && s.days >= 2 && s.days <= 6, s.id);
    assert.ok(STYLES.some((x) => x.id === s.style), s.id);
    assert.ok(LEVELS.some((x) => x.id === s.level), s.id);
    assert.ok(EQUIPMENT.some((x) => x.id === s.equipment), s.id);
    assert.equal(splitById(s.id), s);
  }
  for (const d of [2, 3, 4, 5, 6]) assert.ok(SPLITS.some((s) => s.days === d), `${d} days`);
  for (const st of STYLES) assert.ok(SPLITS.some((s) => s.style === st.id), st.id);
  assert.equal(SPLITS.filter((s) => s.equipment === 'home').length, 2);
});

test('sessions: rotation divides the week, 5–8 exercises, unique ids', () => {
  for (const s of SPLITS) {
    assert.ok(s.sessions.length >= 2 && s.days % s.sessions.length === 0, `${s.id}: ${s.days} days / ${s.sessions.length} sessions`);
    assert.equal(new Set(s.sessions.map((x) => x.id)).size, s.sessions.length, s.id);
    for (const ses of s.sessions) {
      assert.ok(ses.items.length >= 5 && ses.items.length <= 8, `${s.id} ${ses.name}: ${ses.items.length} exercises`);
      const sets = ses.items.reduce((a, i) => a + i.sets, 0);
      assert.ok(sets >= 12 && sets <= 24, `${s.id} ${ses.name}: ${sets} sets`);
      assert.equal(new Set(ses.items.map((i) => i.exerciseId)).size, ses.items.length, `${s.id} ${ses.name}: duplicate exercise`);
    }
  }
});

test('every exercise id exists; sets and reps in sane ranges', () => {
  for (const s of SPLITS) for (const ses of s.sessions) for (const it of ses.items) {
    const where = `${s.id} ${ses.name} ${it.exerciseId}`;
    assert.ok(EX.has(it.exerciseId), `unknown exercise ${where}`);
    assert.ok(Number.isInteger(it.sets) && it.sets >= 2 && it.sets <= 4, `sets ${where}`);
    assert.ok(Number.isInteger(it.reps) && it.reps >= 5 && it.reps <= 12, `reps ${where}`);
    assert.ok(Number.isInteger(it.repsMax) && it.repsMax > it.reps && it.repsMax <= 20, `repsMax ${where}`);
  }
});

test('home splits use only dumbbell / bodyweight exercises that dumbbells, a bench and a pull-up bar allow', () => {
  for (const s of SPLITS.filter((x) => x.equipment === 'home')) for (const ses of s.sessions) for (const it of ses.items) {
    assert.ok(HOME_EQUIPMENT.includes(EX.get(it.exerciseId).equipment), `${s.id}: ${it.exerciseId} is ${EX.get(it.exerciseId).equipment}`);
    assert.ok(fitsHome(EX.get(it.exerciseId)), `${s.id}: ${it.exerciseId} needs ${exerciseGear(EX.get(it.exerciseId))}`);
  }
});

test('no split text claims a training frequency its coverage does not meet', () => {
  // "days" = sessions a week in which the muscle is a main mover (splitCoverage daysHit)
  const MAJOR = ['chest', 'back', 'shoulders', 'quads', 'glutes', 'hamstrings', 'biceps', 'triceps', 'calves', 'abs'];
  const BIG = ['chest', 'back', 'shoulders', 'quads', 'glutes', 'hamstrings'];
  const CLAIMS = [
    [/\b(each muscle|every muscle|everything) twice/i, (d) => MUSCLE_IDS.every((m) => d[m] >= 2)],
    [/\bmajor muscles twice/i, (d) => MAJOR.every((m) => d[m] >= 2)],
    [/\bbig muscles twice/i, (d) => BIG.every((m) => d[m] >= 2)],
    [/\barms and calves once/i, (d) => ['biceps', 'triceps', 'calves'].every((m) => d[m] >= 1)],
    [/\b(each|every) muscle once/i, (d) => MUSCLE_IDS.every((m) => d[m] === 1)],
    [/\bmost muscles once/i, (d) => MAJOR.filter((m) => d[m] === 1).length > MAJOR.length / 2],
    [/\bup to four times/i, (d) => Math.max(...Object.values(d)) === 4],
  ];
  for (const s of SPLITS) {
    const cov = splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, {});
    const days = Object.fromEntries(MUSCLE_IDS.map((m) => [m, cov[m].daysHit]));
    for (const t of [s.suits, ...s.bullets]) {
      const known = CLAIMS.filter(([re]) => re.test(t));
      if (/\b(once|twice|three times|four times)\b/i.test(t)) assert.ok(known.length, `${s.id}: unchecked frequency claim "${t}"`);
      for (const [re, ok] of known) assert.ok(ok(days), `${s.id}: "${t}" (${re}) does not match ${JSON.stringify(days)}`);
    }
  }
});

test('wording: short, generic, no program names, no promises', () => {
  const texts = [...SHARED_BULLETS, SPLIT_DISCLAIMER];
  for (const s of SPLITS) {
    assert.ok(words(s.suits) <= 12, `${s.id} suits: ${words(s.suits)} words`);
    assert.ok(s.bullets.length >= 1 && s.bullets.length <= 2, s.id);
    for (const b of s.bullets) assert.ok(words(b) <= 12, `${s.id}: "${b}"`);
    texts.push(s.name, s.suits, ...s.bullets, ...s.sessions.map((x) => x.name));
  }
  for (const b of SHARED_BULLETS) assert.ok(words(b) <= 12, b);
  for (const t of texts) {
    for (const re of DENYLIST) assert.doesNotMatch(t, re, t);
    assert.doesNotMatch(t, /optimal|guarantee|best program|build \d|prevent injur/i, t);
    assert.doesNotMatch(t, /\p{Extended_Pictographic}/u, t);
  }
});

test('coverage: no major muscle neglected or overloaded (app counting, default weights)', () => {
  // Design bands in weighted sets / week (docs/SPLITS.md), not prescriptions.
  const BAND = { chest: [6, 22], back: [8, 22], shoulders: [8, 22], quads: [6, 22], glutes: [6, 22], hamstrings: [6, 20],
    biceps: [6, 20], triceps: [6, 20], calves: [4, 16], abs: [4, 16], traps: [0, 16], forearms: [0, 16] };
  for (const s of SPLITS) {
    const cov = splitCoverage(resolveSessions(s, { exercises: EX }), perWeek(s), EX, {});
    for (const m of MUSCLE_IDS) {
      const [lo, hi] = BAND[m];
      assert.ok(cov[m].total >= lo && cov[m].total <= hi, `${s.id} ${m}: ${cov[m].total} not in ${lo}–${hi}`);
    }
    // every major muscle is a main mover at least once a week
    for (const m of ['chest', 'back', 'shoulders', 'quads', 'glutes', 'hamstrings', 'biceps', 'triceps', 'calves', 'abs']) {
      assert.ok(cov[m].daysHit >= 1, `${s.id} ${m} never direct`);
    }
    // splits with 4+ days hit traps at least a little
    if (s.days >= 4) assert.ok(cov.traps.total >= 2, `${s.id} traps ${cov.traps.total}`);
  }
});
