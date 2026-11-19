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
//     default base range of that muscle BEFORE dose scaling and the pace factor. User values must be
//     whole hours, min ≥ 6, max ≤ 240, max ≥ min + 4 (validateRange). For a muscle with a custom
//     range the model's own caps (24–120 h, width ≥ 8 h) do NOT apply; the caps become the input
//     limits (6–240 h) and the minimum width becomes min(8, the user's width). So at the reference
//     dose (4 sets) and average pace the window is exactly the user's range; more or fewer sets and
//     the pace still scale it, never clipped back to the defaults' 24–120 h.
//  8. The starting point (baseline.js isBaseline) is not a training session and is ignored.
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
 * Check a user's base range for one muscle.
 * @param {any} min hours @param {any} max hours
 * @returns {{ok: true, value: [number, number]} | {ok: false, error: string}}
 */
export function validateRange(min, max, cfg = RECOVERY_CONFIG) {
  const c = cfg.custom;
  if (!isNum(min) || !isNum(max)) return { ok: false, error: 'Enter both hours.' };
  if (!Number.isInteger(min) || !Number.isInteger(max)) return { ok: false, error: 'Use whole hours.' };
  if (min < c.min) return { ok: false, error: `Shortest is at least ${c.min} h.` };
  if (max > c.max) return { ok: false, error: `Longest is at most ${c.max} h.` };
  if (max < min + c.minGap) return { ok: false, error: `Longest must be at least ${c.minGap} h more than shortest.` };
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
 * @returns {{pace: 'faster'|'average'|'slower', base?: Record<string, [number, number]>}} `base` only when
 *   at least one muscle has a valid custom range
 */
export function recoverySettings(value) {
  const pace = value && typeof value === 'object' && Object.hasOwn(RECOVERY_CONFIG.paces, value.pace) ? value.pace : 'average';
  const base = sanitiseBase(value && value.base);
  return Object.keys(base).length ? { pace, base } : { pace };
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
    if (!v.ok) throw new Error(v.error);
    base[muscle] = v.value;
  } else delete base[muscle];
  return Object.keys(base).length ? { pace: s.pace, base } : { pace: s.pace };
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
 * @param {{now: number, factor?: number, base?: Record<string, [number, number]>, cfg?: object}} opts
 *   base: the user's custom base ranges (recoverySettings(...).base)
 * @returns {Array<{
 *   muscle: string, name: string, status: 'fresh'|'recovering'|'likely-ready', trained: boolean,
 *   lastAt: number|null, hoursSince: number|null, lastDose: number, dose: number,
 *   minHours: number|null, maxHours: number|null, readyAt: number|null, fullAt: number|null,
 *   progress: number, sessions: {workoutId: string, name: string, date: string, at: number, dose: number, finished: boolean, carried: number}[]
 * }>} in MUSCLES order
 */
export function muscleRecovery(workouts, exercises, weights, { now, factor = 1, base = null, cfg = RECOVERY_CONFIG } = {}) {
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
    const own = base && base[m.id] ? base[m.id] : null;
    /** @type {null | {at: number, dose: number, lastDose: number, min: number, max: number, list: any[]}} */
    let ep = null;
    for (const s of sessions) {
      const d = s.vol[m.id] || 0;
      if (d < cfg.minDose) continue;
      let carried = 0;
      const gapH = (s.at - (ep ? ep.at : 0)) / H;
      if (ep && gapH < ep.max) carried = round(ep.dose * (1 - Math.max(0, gapH) / ep.max), 2);
      const dose = round(d + carried, 2);
      const [min, max] = recoveryWindow(m.id, dose, factor, cfg, own);
      const item = { workoutId: s.w.id, name: s.w.name || 'Workout', date: s.w.date, at: s.at, dose: d, finished: isNum(s.w.finishedAt), carried };
      ep = { at: s.at, dose, lastDose: d, min, max, list: carried > 0 && ep ? [...ep.list, item] : [item] };
    }
    if (!ep) {
      return {
        muscle: m.id, name: m.name, custom: !!own, status: 'fresh', trained: false, lastAt: null, hoursSince: null, lastDose: 0, dose: 0,
        minHours: null, maxHours: null, readyAt: null, fullAt: null, progress: 100, sessions: [],
      };
    }
    const h = Math.max(0, (now - ep.at) / H);
    const status = h < ep.min ? 'recovering' : h < ep.max ? 'likely-ready' : 'fresh';
    return {
      muscle: m.id, name: m.name, custom: !!own, status, trained: true, lastAt: ep.at, hoursSince: round(h, 2),
      lastDose: ep.lastDose, dose: ep.dose, minHours: ep.min, maxHours: ep.max,
      readyAt: ep.at + ep.min * H, fullAt: ep.at + ep.max * H,
      progress: clamp(percent(h, ep.max), 0, 100), sessions: ep.list.slice().reverse(),
    };
  });
}

const STATUS_ORDER = { recovering: 0, 'likely-ready': 1, fresh: 2 };

/** Least recovered first: status, then progress, then most recent. Does not mutate. */
export function sortByRecovery(rows) {
  return rows.slice().sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    || a.progress - b.progress || (b.lastAt || 0) - (a.lastAt || 0));
}

/** '10 h', '1.5 days' (hours below 48 h, else days to 0.5) */
export function fmtSpan(hours) {
  const h = Math.max(0, hours);
  if (h < 48) return `${Math.max(1, Math.round(h))} h`;
  return `${round(Math.round((h / 24) * 2) / 2, 1)} days`;
}

/** '10–34 h' or '2–3.5 days' (one unit for both ends) */
export function fmtSpanRange(a, b) {
  const lo = Math.max(0, a);
  const hi = Math.max(lo, b);
  if (hi < 48) {
    const l = Math.max(1, Math.round(lo));
    const r = Math.max(l, Math.round(hi));
    return l === r ? `${r} h` : `${l}–${r} h`;
  }
  const l = Math.max(0.5, Math.round((lo / 24) * 2) / 2);
  const r = Math.max(l, Math.round((hi / 24) * 2) / 2);
  return l === r ? `${r} days` : `${l}–${r} days`;
}

/**
 * Plain-words range for a row: 'ready in about 10–34 h', 'likely ready — full recovery in up to 12 h', 'recovered'.
 * @param {ReturnType<typeof muscleRecovery>[number]} r
 */
export function recoveryWords(r) {
  if (!r.trained) return 'no recent training';
  if (r.status === 'fresh') return 'recovered';
  const h = r.hoursSince;
  if (r.status === 'recovering') return `ready in about ${fmtSpanRange(r.minHours - h, r.maxHours - h)}`;
  return `likely ready — full recovery in up to ${fmtSpan(r.maxHours - h)}`;
}

export const STATUS_LABEL = Object.freeze({ recovering: 'Recovering', 'likely-ready': 'Likely ready', fresh: 'Recovered' });
