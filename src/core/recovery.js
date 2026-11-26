// Muscle recovery estimate per muscle. Pure, no DOM / IndexedDB.
//
// IMPORTANT: this is a general rule of thumb from common strength-training guidance (a hard-trained
// muscle is usually given roughly 48–72 h before it is trained hard again; small muscles a bit less,
// big leg muscles a bit more). It is NOT a measurement of the user's body and not based on any
// specific study. Sleep, nutrition, intensity (how close to failure), soreness, age and stress all
// change real recovery. The numbers below are deliberately shown as a range.
//
// Model (all parameters in RECOVERY_CONFIG):
//  1. Dose of a session for a muscle = the weighted sets the app already uses (src/core/volume.js):
//     done normal set → primary 1 / secondary 0.5 (settings.volume), dropset × the dropset weight.
//  2. A session only starts (or extends) a recovery window when its own dose ≥ minDose (1 weighted
//     set). So 1 secondary set (0.5) alone does not reset recovery; 2 secondary sets (1.0) do.
//  3. Window from the session time t: base[muscle] × doseFactor(dose) × personal factor, then
//     min ≥ capMin, max ≤ capMax, max ≥ min + minWidth, rounded to whole hours.
//       doseFactor(d) = clamp(doseIntercept + doseSlope × d, doseFactorMin, doseFactorMax)
//       (defaults: 0.6 + 0.1 × d in [0.7, 1.5] → 1 set 0.7, 4 sets 1.0, 8 sets 1.4, 9+ sets 1.5)
//  4. Two sessions close together: if a qualifying session happens before the previous window's
//     max, the remaining fatigue carries over. Effective dose = new dose + previous effective dose ×
//     (1 − hours between / previous max). The window restarts at the new session with that dose.
//     After the previous max has passed, the new session starts a fresh window.
//  5. Session time = finishedAt, else startedAt (in-progress sessions count with their done sets),
//     else the end of its `date` (local 23:59:59.999).
//  6. Status at `now` (hours h since the session): h < min → 'recovering'; min ≤ h < max →
//     'likely-ready'; h ≥ max or never trained → 'fresh'. progress = h / max (0–100 %).
//  7. Custom base ranges (settings 'recovery'.base = { [muscle]: [minH, maxH] }): replace the
//     default base range of that muscle BEFORE dose scaling. User values must be
//     whole hours, min ≥ 6, max ≤ 240, max ≥ min + 4 (validateRange). For a muscle with a custom
//     range the model's own caps (24–120 h, width ≥ 8 h) do NOT apply; the caps become the input
//     limits (6–240 h) and the minimum width becomes min(8, the user's width). So at the reference
//     dose (4 sets) the window is exactly the user's range; more or fewer sets still scale it, never
//     clipped back to the defaults' 24–120 h. The pace factor is NOT applied on top of a hand-set
//     range (changed in 0.7: it is the user's own hours already, so pace would count twice).
//  8. The starting point (baseline.js isBaseline) is not a training session and is ignored.
//  9. Check-ins (settings 'recoveryCheckins', see learnRange below): the user may say a trained muscle
//     is "recovered" or "still sore". Range precedence per muscle: hand-set > learned from check-ins
//     ("yours") > default (rule of thumb). Pace applies to the default only. The latest check-in of
//     the current bout (same last counted session) changes the shown status (applyCheckin).
import { MUSCLES } from './muscles.js';
import { isBaseline } from './baseline.js';
import { isLoggedWorkout } from './workout.js';
import { parseDate, isValidDate } from './dates.js';
import { workoutVolume } from './volume.js';
import { round, percent } from './numbers.js';

const H = 3600000;

export const RECOVERY_CONFIG = Object.freeze({
  /** Base range in hours for a "reference" session of `referenceDose` weighted sets. */
  base: Object.freeze({
    forearms: [24, 48], calves: [24, 48], abs: [24, 48],
    biceps: [36, 60], triceps: [36, 60], shoulders: [36, 60],
    chest: [48, 72], back: [48, 72], traps: [48, 72],
    quads: [60, 96], hamstrings: [60, 96], glutes: [60, 96],
  }),
  referenceDose: 4,
  doseIntercept: 0.6,
  doseSlope: 0.1,
  doseFactorMin: 0.7,
  doseFactorMax: 1.5,
  /** Below this weighted-set dose a session does not start or extend a window. */
  minDose: 1,
  capMin: 24,
  capMax: 120,
  /** max is at least min + this many hours (keeps a real range after capping). */
  minWidth: 8,
  /** Days of history that are looked at (windows are ≤ 5 days, so chains are covered). */
  lookbackDays: 14,
  /** Personal adjustment, settings key 'recovery' → { pace }. */
  paces: Object.freeze({ faster: 0.8, average: 1, slower: 1.25 }),
  /** Limits for a user's own base range (settings key 'recovery' → { base }). Also the caps then. */
  custom: Object.freeze({ min: 6, max: 240, minGap: 4 }),
});

/** Settings key used by the workout feature. */
export const RECOVERY_KEY = 'recovery';

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Check a user's base range for one muscle. Errors are codes (the UI words them):
 * 'missing' (enter both hours), 'whole' (whole hours), 'minLow' (shortest ≥ params.hours),
 * 'maxHigh' (longest ≤ params.hours), 'gap' (longest ≥ shortest + params.hours).
 * @param {any} min hours @param {any} max hours
 * @returns {{ok: true, value: [number, number]} | {ok: false, error: 'missing'|'whole'|'minLow'|'maxHigh'|'gap', params: {hours?: number}}}
 */
export function validateRange(min, max, cfg = RECOVERY_CONFIG) {
  // i18n-ignore-start: error codes, worded by the UI (src/workout/recovery.js)
  const c = cfg.custom;
  if (!isNum(min) || !isNum(max)) return { ok: false, error: 'missing', params: {} };
  if (!Number.isInteger(min) || !Number.isInteger(max)) return { ok: false, error: 'whole', params: {} };
  if (min < c.min) return { ok: false, error: 'minLow', params: { hours: c.min } };
  if (max > c.max) return { ok: false, error: 'maxHigh', params: { hours: c.max } };
  if (max < min + c.minGap) return { ok: false, error: 'gap', params: { hours: c.minGap } };
  // i18n-ignore-end
  return { ok: true, value: [min, max] };
}

/**
 * Valid custom base ranges only (unknown muscles and invalid ranges are dropped).
 * @param {any} value stored `base` object
 * @returns {Record<string, [number, number]>}
 */
export function sanitiseBase(value, cfg = RECOVERY_CONFIG) {
  const out = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const m of MUSCLES) {
    const r = value[m.id];
    if (!Array.isArray(r) || r.length !== 2) continue;
    const v = validateRange(r[0], r[1], cfg);
    if (v.ok) out[m.id] = v.value;
  }
  return out;
}

/**
 * @param {any} value stored setting (may be undefined)
 * @returns {{pace: 'faster'|'average'|'slower', base?: Record<string, [number, number]>, rule?: string[]}}
 *   `base` only when at least one muscle has a valid custom range; `rule` (muscles kept on the rule of
 *   thumb although a learned range exists) only when not empty
 */
export function recoverySettings(value) {
  const pace = value && typeof value === 'object' && Object.hasOwn(RECOVERY_CONFIG.paces, value.pace) ? value.pace : 'average';
  const base = sanitiseBase(value && value.base);
  const rule = value && Array.isArray(value.rule) ? MUSCLES.map((m) => m.id).filter((id) => value.rule.includes(id)) : [];
  const out = { pace };
  if (Object.keys(base).length) out.base = base;
  if (rule.length) out.rule = rule;
  return out;
}

/**
 * New setting value with one muscle's custom range set (range) or reset (null). Does not mutate.
 * @param {any} value stored setting @param {string} muscle @param {[number, number]|null} range
 */
export function withBase(value, muscle, range) {
  const s = recoverySettings(value);
  const base = { ...(s.base || {}) };
  if (range) {
    const v = validateRange(range[0], range[1]);
    if (!v.ok) throw new Error(`withBase: invalid range (${v.error})`);
    base[muscle] = v.value;
  } else delete base[muscle];
  return recoverySettings({ ...s, base });
}

/**
 * New setting value with one muscle kept on the rule of thumb (on) or allowed to use its learned
 * range (off). Does not mutate.
 */
export function withRule(value, muscle, on) {
  const s = recoverySettings(value);
  const rule = (s.rule || []).filter((id) => id !== muscle);
  if (on) rule.push(muscle);
  return recoverySettings({ ...s, rule });
}

/** The base range used for a muscle: the user's own, else the default. */
export function baseRange(muscle, base = null, cfg = RECOVERY_CONFIG) {
  const own = base && base[muscle];
  return own ? { range: own, custom: true } : { range: cfg.base[muscle] || [48, 72], custom: false };
}

/** @param {any} value stored setting @returns {number} multiplier (0.8 / 1 / 1.25) */
export function paceFactor(value) {
  return RECOVERY_CONFIG.paces[recoverySettings(value).pace];
}

/** @param {number} dose weighted sets @returns {number} */
export function doseFactor(dose, cfg = RECOVERY_CONFIG) {
  const d = isNum(dose) && dose > 0 ? dose : 0;
  return clamp(cfg.doseIntercept + cfg.doseSlope * d, cfg.doseFactorMin, cfg.doseFactorMax);
}

/**
 * Recovery window for one muscle after a session of `dose` weighted sets.
 * @param {[number, number]|null} [custom] the user's own base range for this muscle (see rule 7)
 * @returns {[number, number]} [minHours, maxHours], whole hours
 */
export function recoveryWindow(muscle, dose, factor = 1, cfg = RECOVERY_CONFIG, custom = null) {
  const base = custom || cfg.base[muscle] || [48, 72];
  const capMin = custom ? cfg.custom.min : cfg.capMin;
  const capMax = custom ? cfg.custom.max : cfg.capMax;
  const minWidth = custom ? Math.min(cfg.minWidth, custom[1] - custom[0]) : cfg.minWidth;
  const f = doseFactor(dose, cfg) * (isNum(factor) && factor > 0 ? factor : 1);
  let min = clamp(base[0] * f, capMin, capMax);
  let max = clamp(base[1] * f, capMin, capMax);
  min = Math.round(min);
  max = Math.round(Math.max(max, Math.min(capMax, min + minWidth)));
  if (max < min) max = min;
  return [min, max];
}

/**
 * When a workout counts as "trained": finishedAt, else startedAt, else end of its date.
 * @returns {number|null} epoch ms
 */
export function sessionTime(w) {
  if (!w) return null;
  if (isNum(w.finishedAt)) return w.finishedAt;
  if (isNum(w.startedAt)) return w.startedAt;
  if (isValidDate(w.date)) return parseDate(w.date).getTime() + 24 * H - 1;
  return null;
}

/** YYYY-MM-DD lower bound for the lookback query, from `now`. */
export function lookbackFrom(now, cfg = RECOVERY_CONFIG) {
  const d = new Date(now);
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - cfg.lookbackDays);
  const p = (n) => String(n).padStart(2, '0');
  return `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`;
}

/**
 * Recovery state of every muscle at `now`.
 * @param {object[]} workouts any order; older than lookbackDays are ignored
 * @param {Map<string, object>|Record<string, object>} exercises by id
 * @param {{primary?: number, secondary?: number, dropset?: number}} weights settings.volume
 * @param {{now: number, factor?: number, base?: Record<string, [number, number]>,
 *   learned?: Record<string, [number, number]>, checkins?: object[], cfg?: object}} opts
 *   base: the user's hand-set base ranges (recoverySettings(...).base); learned: base ranges learned
 *   from check-ins (learnedBase); checkins: the stored check-ins (only the current bout's latest counts).
 *   Every row also has source 'rule'|'yours'|'set', modelStatus and said (see applyCheckin).
 *   Session `name` is the workout's own name (null when it has none; the UI shows a generic word).
 * @returns {Array<{
 *   muscle: string, name: string, status: 'fresh'|'recovering'|'likely-ready', trained: boolean,
 *   lastAt: number|null, hoursSince: number|null, lastDose: number, dose: number,
 *   minHours: number|null, maxHours: number|null, readyAt: number|null, fullAt: number|null,
 *   progress: number, sessions: {workoutId: string, name: string, date: string, at: number, dose: number, finished: boolean, carried: number}[]
 * }>} in MUSCLES order
 */
export function muscleRecovery(workouts, exercises, weights, { now, factor = 1, base = null, learned = null, checkins = null, cfg = RECOVERY_CONFIG } = {}) {
  if (!isNum(now)) throw new Error('muscleRecovery: now is required');
  const lowerMs = now - cfg.lookbackDays * 24 * H;
  const sessions = [];
  for (const w of workouts || []) {
    if (!w || isBaseline(w) || (w.finishedAt && !isLoggedWorkout(w))) continue;
    const at = sessionTime(w);
    if (at === null || at < lowerMs) continue;
    sessions.push({ w, at, vol: workoutVolume(w, exercises, weights) });
  }
  sessions.sort((a, b) => a.at - b.at);

  return MUSCLES.map((m) => {
    const set = base && base[m.id] ? base[m.id] : null;
    const yours = !set && learned && learned[m.id] ? learned[m.id] : null;
    const own = set || yours;
    const source = set ? 'set' : yours ? 'yours' : 'rule';
    const f = own ? 1 : factor; // pace only on top of the rule of thumb (rule 7, 9)
    /** @type {null | {at: number, dose: number, lastDose: number, min: number, max: number, list: any[]}} */
    let ep = null;
    for (const s of sessions) {
      const d = s.vol[m.id] || 0;
      if (d < cfg.minDose) continue;
      let carried = 0;
      const gapH = (s.at - (ep ? ep.at : 0)) / H;
      if (ep && gapH < ep.max) carried = round(ep.dose * (1 - Math.max(0, gapH) / ep.max), 2);
      const dose = round(d + carried, 2);
      const [min, max] = recoveryWindow(m.id, dose, f, cfg, own);
      const item = { workoutId: s.w.id, name: s.w.name || null, routineId: s.w.routineId || null, date: s.w.date, at: s.at, dose: d, finished: isNum(s.w.finishedAt), carried };
      ep = { at: s.at, dose, lastDose: d, min, max, list: carried > 0 && ep ? [...ep.list, item] : [item] };
    }
    if (!ep) {
      return {
        muscle: m.id, name: m.name, custom: !!set, source, status: 'fresh', modelStatus: 'fresh', said: null, trained: false,
        lastAt: null, hoursSince: null, lastDose: 0, dose: 0,
        minHours: null, maxHours: null, readyAt: null, fullAt: null, progress: 100, sessions: [],
      };
    }
    const h = Math.max(0, (now - ep.at) / H);
    const status = h < ep.min ? 'recovering' : h < ep.max ? 'likely-ready' : 'fresh';
    const row = {
      muscle: m.id, name: m.name, custom: !!set, source, status, modelStatus: status, said: null, trained: true,
      lastAt: ep.at, hoursSince: round(h, 2),
      lastDose: ep.lastDose, dose: ep.dose, minHours: ep.min, maxHours: ep.max,
      readyAt: ep.at + ep.min * H, fullAt: ep.at + ep.max * H,
      progress: clamp(percent(h, ep.max), 0, 100), sessions: ep.list.slice().reverse(),
    };
    return checkins ? applyCheckin(row, checkins, now) : row;
  });
}

const STATUS_ORDER = { recovering: 0, 'likely-ready': 1, fresh: 2 };

/** Least recovered first: status, then progress, then most recent. Does not mutate. */
export function sortByRecovery(rows) {
  return rows.slice().sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || a.progress - b.progress || (b.lastAt || 0) - (a.lastAt || 0));
}

// Durations and status are returned as data; the UI words them per language (plural forms, word order).

/**
 * A duration for display: whole hours below 48 h (at least 1), else days to 0.5.
 * @param {number} hours @returns {{unit: 'h'|'days', value: number}}  10 → {h, 10}; 60 → {days, 2.5}
 */
export function span(hours) {
  const h = Math.max(0, hours);
  if (h < 48) return { unit: 'h', value: Math.max(1, Math.round(h)) };
  return { unit: 'days', value: round(Math.round((h / 24) * 2) / 2, 1) };
}

/**
 * A range of durations in one unit for both ends (hours while the upper end is below 48 h).
 * @returns {{unit: 'h'|'days', lo: number, hi: number}} lo === hi when both round the same
 *   (10, 34) → {h, 10, 34}; (24, 48) → {days, 1, 2}; (60, 96) → {days, 2.5, 4}
 */
export function spanRange(a, b) {
  const lo = Math.max(0, a);
  const hi = Math.max(lo, b);
  if (hi < 48) {
    const l = Math.max(1, Math.round(lo));
    return { unit: 'h', lo: l, hi: Math.max(l, Math.round(hi)) };
  }
  const l = Math.max(0.5, Math.round((lo / 24) * 2) / 2);
  return { unit: 'days', lo: l, hi: Math.max(l, Math.round((hi / 24) * 2) / 2) };
}

/** Time since something, for "… ago": null below 1 h ("just now"), else span(hours). */
export function agoSpan(hours) {
  if (!isNum(hours) || hours < 1) return null;
  return span(hours);
}

/**
 * What to say about a row, as data:
 *   {kind: 'untrained'}                                   no recent training
 *   {kind: 'said', answer: 'recovered'|'sore', ago}      the user's check-in decides (ago = agoSpan, null = just now)
 *   {kind: 'fresh'}                                       recovered
 *   {kind: 'recovering', range}                           ready in about range (spanRange)
 *   {kind: 'likely-ready', upTo}                          likely ready, full recovery in up to upTo (span)
 * @param {ReturnType<typeof muscleRecovery>[number]} r
 */
export function recoveryState(r) {
  if (!r.trained) return { kind: 'untrained' };
  if (r.said && r.said.shown) return { kind: 'said', answer: r.said.answer, ago: agoSpan(r.said.hoursAgo) };
  if (r.status === 'fresh') return { kind: 'fresh' };
  const h = r.hoursSince;
  if (r.status === 'recovering') return { kind: 'recovering', range: spanRange(r.minHours - h, r.maxHours - h) };
  return { kind: 'likely-ready', upTo: span(r.maxHours - h) };
}

// ------------------------------------------------------------------------------------------------
// Check-ins and personal ranges
//
// A check-in is the user's own answer for one trained muscle: 'recovered' or 'sore' (still sore).
// Stored in settings 'recoveryCheckins' as an array, newest last, at most CHECKIN_CONFIG.cap entries
// (the oldest are dropped). Shape (makeCheckin):
//   { id, muscle, answer: 'recovered'|'sore', at: epoch ms, boutAt: epoch ms of the last counted
//     session (the bout), hours: hours since boutAt, dose: effective weighted sets the model used
//     (carry-over included), sets: weighted sets of that session, range: [minH, maxH] window shown
//     then, source: 'rule'|'yours'|'set' }
// The record keeps the dose and range of that moment, so the history means the same after the
// settings change.
//
// Effect on the current estimate (applyCheckin; only the latest answer of the current bout counts):
//   recovered → 'fresh' for the rest of the bout.
//   sore at s hours → at least 'recovering' until s + w and at least 'likely-ready' until s + 2w,
//     w = max(12, maxHours − minHours). Shown as the user's answer ("still sore · 6 h ago"), never as a new time.
//
// Learning (learnRange), per muscle, an interval-censored estimate of the user's base range:
//   1. Normalise: u = hours / doseFactor(dose) — hours scaled to the reference dose (4 sets), the
//      quantity of a base range. Pace is not involved: an answer is about real hours.
//   2. Per bout (same boutAt): answers that contradict each other (still sore at ≥ the hours of a
//      "recovered" in the same bout, e.g. recovered at 40 h then still sore at 50 h) are BOTH left out
//      of learning — the bout says nothing reliable (the history keeps them; the shown status uses the
//      latest). The rest gives the bracket: L = most hours still sore, R = fewest hours recovered; the
//      recovery time is in (L, R]. Only L and R are informative; more answers of a bout add nothing.
//   3. Weight: the newest bout 1, halving every halfLifeBouts bouts; at most maxBouts bouts. A bout
//      gives at most two points (L, R), so one bout cannot dominate.
//   4. Distribution of the recovery time F: weighted isotonic regression (pool adjacent violators) of
//      recovered (1) / still sore (0) on u — the NPMLE for this current-status data. Piecewise linear
//      between block edges, flat outside the answers (no extrapolation).
//   5. Centre = median of F (robust: a wrong answer moves it by at most a local step). Width = the
//      25th–75th percentile spread, clamped to [floor, maxRel × centre], floor = max(minWidthH,
//      clamp(widthK / √bouts, minRel, maxRel) × centre): fewer bouts → wider, never narrower than
//      the data justify. Rounded, inside 6–240 h, max ≥ min + 4 (validateRange).
//   6. Used only with ≥ minPoints informative answers (step 2) from ≥ minBouts bouts, including at least
//      one recovered and one still sore (one kind alone gives a bound, not a range).

export const CHECKINS_KEY = 'recoveryCheckins';

export const CHECKIN_CONFIG = Object.freeze({
  cap: 2000,
  minPoints: 5,
  minBouts: 3,
  halfLifeBouts: 8,
  maxBouts: 40,
  quantiles: Object.freeze([0.25, 0.75]),
  minWidthH: 8,
  widthK: 1.5,
  minRel: 0.3,
  maxRel: 0.6,
  /** Hold of a "still sore" answer: at least this many hours per step. */
  soreMinHold: 12,
});

const ANSWERS = new Set(['recovered', 'sore']);
const isMuscle = (id) => MUSCLES.some((m) => m.id === id);

/** One stored check-in is usable. */
export function isCheckin(c) {
  return !!c && typeof c === 'object' && typeof c.id === 'string' && isMuscle(c.muscle) && ANSWERS.has(c.answer)
    && isNum(c.at) && isNum(c.boutAt) && isNum(c.hours) && c.hours >= 0 && isNum(c.dose) && c.dose >= 0;
}

/** Valid check-ins only, oldest first (by `at`), at most cap. */
export function sanitiseCheckins(value, cap = CHECKIN_CONFIG.cap) {
  if (!Array.isArray(value)) return [];
  const list = value.filter(isCheckin).slice().sort((a, b) => a.at - b.at);
  return list.length > cap ? list.slice(list.length - cap) : list;
}

/**
 * New check-in record for a row of muscleRecovery (must be trained).
 * @param {ReturnType<typeof muscleRecovery>[number]} row @param {'recovered'|'sore'} answer
 * @param {number} now @param {string} id
 */
export function makeCheckin(row, answer, now, id) {
  if (!row || !row.trained) throw new Error('makeCheckin: muscle has no counted session');
  if (!ANSWERS.has(answer)) throw new Error('makeCheckin: answer');
  return {
    id, muscle: row.muscle, answer, at: now, boutAt: row.lastAt, hours: round(Math.max(0, (now - row.lastAt) / H), 1),
    dose: row.dose, sets: row.lastDose, range: [row.minHours, row.maxHours], source: row.source || 'rule',
  };
}

/** Append (newest last) and drop the oldest beyond cap. Does not mutate. */
export function addCheckin(list, rec, cap = CHECKIN_CONFIG.cap) {
  const out = [...sanitiseCheckins(list, Infinity), rec];
  return out.length > cap ? out.slice(out.length - cap) : out;
}

/** Without the check-in `id`. Does not mutate. */
export function removeCheckin(list, id) {
  return sanitiseCheckins(list, Infinity).filter((c) => c.id !== id);
}

const SEVERITY = { recovering: 0, 'likely-ready': 1, fresh: 2 };

/**
 * Apply the latest check-in of the row's current bout (rule 9). Returns a new row; `said` =
 * { answer, at, hours, hoursAgo, shown } where shown = the answer decides the status (recoveryState
 * then reports kind 'said'). Rows without a matching check-in are returned unchanged.
 */
export function applyCheckin(row, checkins, now, ccfg = CHECKIN_CONFIG) {
  if (!row.trained || !Array.isArray(checkins)) return row;
  let last = null;
  for (const c of checkins) {
    if (!isCheckin(c) || c.muscle !== row.muscle || c.boutAt !== row.lastAt || c.at > now) continue;
    if (!last || c.at >= last.at) last = c;
  }
  if (!last) return row;
  const hoursAgo = round((now - last.at) / H, 2);
  let status = row.status;
  let shown;
  if (last.answer === 'recovered') {
    status = 'fresh';
    shown = true;
  } else {
    const w = Math.max(ccfg.soreMinHold, row.maxHours - row.minHours);
    const h = row.hoursSince;
    const held = h < last.hours + w ? 'recovering' : h < last.hours + 2 * w ? 'likely-ready' : 'fresh';
    if (SEVERITY[held] < SEVERITY[status]) status = held;
    // The answer is shown when it decides the status or the model's window has passed.
    shown = status !== row.status || last.hours >= row.minHours;
  }
  return {
    ...row, status, progress: status === 'fresh' && last.answer === 'recovered' ? 100 : row.progress,
    said: { answer: last.answer, at: last.at, hours: last.hours, hoursAgo, shown },
  };
}

/** Weighted isotonic (non-decreasing) regression, pool adjacent violators. pts sorted by x. */
function pav(pts) {
  const blocks = [];
  for (const p of pts) {
    blocks.push({ x0: p.x, x1: p.x, w: p.w, v: p.y });
    while (blocks.length > 1 && blocks[blocks.length - 2].v >= blocks[blocks.length - 1].v) {
      const b = blocks.pop();
      const a = blocks[blocks.length - 1];
      a.v = (a.v * a.w + b.v * b.w) / (a.w + b.w);
      a.w += b.w;
      a.x1 = b.x1;
    }
  }
  return blocks;
}

/** q-quantile of a non-decreasing piecewise-linear F through knots; flat stretches at q → their centre. */
function quantile(knots, q) {
  let lo = null;
  let hi = null;
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1];
    const [x1, y1] = knots[i];
    if (lo === null && y1 >= q) lo = y1 === y0 ? x0 : (y0 >= q ? x0 : x0 + ((q - y0) / (y1 - y0)) * (x1 - x0));
    if (y0 <= q) hi = y1 <= q ? x1 : (y1 === y0 ? x1 : x0 + ((q - y0) / (y1 - y0)) * (x1 - x0));
  }
  if (lo === null) lo = knots[knots.length - 1][0];
  if (hi === null) hi = knots[0][0];
  return (lo + Math.max(lo, hi)) / 2;
}

/**
 * Brackets per bout for one muscle (step 2): newest bout first.
 * @returns {{boutAt: number, lo: number|null, hi: number|null, kept: object[], ignored: object[]}[]}
 */
export function checkinBouts(checkins, muscle, cfg = RECOVERY_CONFIG) {
  const byBout = new Map();
  for (const c of checkins || []) {
    if (!isCheckin(c) || c.muscle !== muscle) continue;
    if (!byBout.has(c.boutAt)) byBout.set(c.boutAt, []);
    byBout.get(c.boutAt).push(c);
  }
  const out = [];
  for (const [boutAt, list] of byBout) {
    const f = doseFactor(list[0].dose, cfg);
    const kept = [];
    const ignored = [];
    let maxSore = -Infinity;
    let minRec = Infinity;
    // drop every answer that conflicts with another answer of the bout (still sore at ≥ the hours of a recovered)
    for (const c of list) {
      const bad = list.some((o) => o.answer !== c.answer && (c.answer === 'sore' ? c.hours >= o.hours : o.hours >= c.hours));
      (bad ? ignored : kept).push(c);
    }
    for (const c of kept) {
      if (c.answer === 'sore') maxSore = Math.max(maxSore, c.hours);
      else minRec = Math.min(minRec, c.hours);
    }
    out.push({
      boutAt, factor: f, dose: list[0].dose,
      lo: maxSore > -Infinity ? maxSore / f : null, hi: minRec < Infinity ? minRec / f : null, kept, ignored,
    });
  }
  return out.sort((a, b) => b.boutAt - a.boutAt);
}

/**
 * The user's own base range for one muscle from check-ins (see the block comment above).
 * @returns {{muscle: string, learned: boolean, points: number, bouts: number, recovered: number, sore: number,
 *   needPoints: number, needBouts: number, range: [number, number]|null, centre: number|null}}
 */
export function learnRange(checkins, muscle, cfg = RECOVERY_CONFIG, ccfg = CHECKIN_CONFIG) {
  const bouts = checkinBouts(checkins, muscle, cfg).filter((b) => b.lo !== null || b.hi !== null).slice(0, ccfg.maxBouts);
  const pts = [];
  let recovered = 0;
  let sore = 0;
  bouts.forEach((b, i) => {
    const w = 0.5 ** (i / ccfg.halfLifeBouts);
    if (b.lo !== null) { pts.push({ x: b.lo, y: 0, w }); sore++; }
    if (b.hi !== null) { pts.push({ x: b.hi, y: 1, w }); recovered++; }
  });
  const res = {
    muscle, learned: false, points: pts.length, bouts: bouts.length, recovered, sore,
    needPoints: ccfg.minPoints, needBouts: ccfg.minBouts, range: null, centre: null,
  };
  if (pts.length < ccfg.minPoints || bouts.length < ccfg.minBouts || !recovered || !sore) return res;

  // sort by x; at equal x put 'sore' first (recovery time > x and ≤ x' with x' = x is consistent only that way)
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const c = cfg.custom;
  const blocks = pav(pts);
  // F between block edges, flat outside the data (no extrapolation beyond the answers given)
  const knots = [];
  for (const k of blocks) knots.push([k.x0, k.v], [k.x1, k.v]);
  const q = (p) => quantile(knots, p);
  const centre = q(0.5);
  const spread = q(ccfg.quantiles[1]) - q(ccfg.quantiles[0]);
  const rel = clamp(ccfg.widthK / Math.sqrt(bouts.length), ccfg.minRel, ccfg.maxRel);
  const floor = Math.max(ccfg.minWidthH, rel * centre);
  const width = clamp(spread, floor, Math.max(floor, ccfg.maxRel * centre));
  let lo = centre - width / 2;
  let hi = centre + width / 2;
  if (lo < c.min) { hi += c.min - lo; lo = c.min; }
  if (hi > c.max) { lo -= hi - c.max; hi = c.max; }
  let a = Math.round(clamp(lo, c.min, c.max));
  let b = Math.round(clamp(hi, c.min, c.max));
  if (b < a + c.minGap) { b = Math.min(c.max, a + c.minGap); a = Math.min(a, b - c.minGap); }
  return { ...res, learned: true, range: [a, b], centre: round(centre, 1) };
}

/** learnRange for every muscle, by id. */
export function learnRanges(checkins, cfg = RECOVERY_CONFIG, ccfg = CHECKIN_CONFIG) {
  return Object.fromEntries(MUSCLES.map((m) => [m.id, learnRange(checkins, m.id, cfg, ccfg)]));
}

/**
 * Learned base ranges that are in force: learned and not switched back to the rule of thumb
 * (settings 'recovery'.rule = [muscle ids]). Hand-set ranges still win inside muscleRecovery.
 * @returns {Record<string, [number, number]>|null}
 */
export function learnedBase(learned, ruleList = []) {
  const out = {};
  for (const [id, r] of Object.entries(learned || {})) if (r && r.learned && !ruleList.includes(id)) out[id] = r.range;
  return Object.keys(out).length ? out : null;
}
