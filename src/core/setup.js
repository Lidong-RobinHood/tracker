// First-run setup: when to show it, what it proposes and what it writes. Pure, no DOM.
// The setup writes exactly what the Settings screen writes (profile, goal, targets) plus today's
// weigh-in in the shape of the Trends weight screen; completion is recorded in settings.meta.
import { formulaTdee, weeklyTarget } from './adaptive.js';
import { MACROS, validateSplit, gramsFromPct } from './macro-split.js';

export const SETUP_VERSION = 1;

/** Stores that hold something the user created or imported. */
const DATA_STORES = ['diary', 'workouts', 'weights', 'meals', 'routines', 'foods', 'targetHistory'];

/** Setup finished or skipped on this device. @param {object|null|undefined} meta settings.meta */
export function isSetupDone(meta) {
  return !!meta && typeof meta.setupCompletedAt === 'number';
}

/**
 * Does this device already hold the user's data (an existing user from before the setup existed)?
 * @param {Record<string, number>} counts records per store (db.countAll())
 * @param {string[]} settingKeys keys present in the settings store
 */
export function hasUserData(counts, settingKeys = []) {
  if (DATA_STORES.some((s) => counts && counts[s] > 0)) return true;
  return settingKeys.some((k) => ['profile', 'goal', 'targets'].includes(k));
}

/**
 * Show the optional "New here? Set up" card (the setup is never opened automatically)?
 * Hidden for good once setup was finished or skipped, or the card was dismissed ("Not now"), and on
 * devices whose profile or targets were already saved in Settings (an existing user).
 * @param {{meta: object, settingKeys: string[]}} a
 */
export function showSetupCard({ meta, settingKeys = [] }) {
  if (isSetupDone(meta) || (meta && typeof meta.setupCardDismissedAt === 'number')) return false;
  return !settingKeys.some((k) => k === 'profile' || k === 'targets');
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Daily targets as the Settings screen saves them.
 * Grams: { ...current without pct, kcal, protein, carbs, fat, source: 'manual', mode: 'grams' }.
 * Percent: { ...current, kcal, grams from the split, source: 'manual', mode: 'percent', pct }.
 * @param {object} current stored settings.targets
 * @param {{mode: 'grams', kcal: number, protein: number, carbs: number, fat: number}
 *        | {mode: 'percent', kcal: number, pct: {protein: number, carbs: number, fat: number}}} input
 * @returns {{ok: true, targets: object} | {ok: false, error: string, field?: string}}
 */
export function buildTargets(current, input) {
  const kcal = input && input.kcal;
  if (!isNum(kcal) || kcal < 0) return { ok: false, error: 'Enter a valid calories target.', field: 'kcal' };
  if (input.mode === 'percent') {
    if (!validateSplit(input.pct).ok) return { ok: false, error: 'The three percentages must add up to 100.', field: 'pct' };
    const pct = Object.fromEntries(MACROS.map((k) => [k, input.pct[k]]));
    return { ok: true, targets: { ...current, kcal, ...gramsFromPct(kcal, pct), source: 'manual', mode: 'percent', pct } };
  }
  for (const k of MACROS) {
    if (!isNum(input[k]) || input[k] < 0) return { ok: false, error: `Enter a valid ${k} target.`, field: k };
  }
  const { pct: _drop, ...rest } = current || {};
  return { ok: true, targets: { ...rest, kcal, protein: input.protein, carbs: input.carbs, fat: input.fat, source: 'manual', mode: 'grams' } };
}

/**
 * Formula estimate (Mifflin-St Jeor × activity) and the targets the weekly check-in would propose
 * from it. Both null while the profile or weight is incomplete.
 * @param {{profile: object, weightKg: number|null, rateKgPerWeek: number, adaptive?: object, asOf: string}} a
 * @returns {{tdee: number|null, target: {kcal: number, protein: number, carbs: number, fat: number, limitedBy: string|null,
 *   proteinLimited: boolean, proteinWanted: number}|null}}
 */
export function proposeTargets({ profile, weightKg, rateKgPerWeek, adaptive = {}, asOf }) {
  const f = formulaTdee(profile, weightKg, asOf);
  if (!f) return { tdee: null, target: null };
  const t = weeklyTarget({ tdee: f.kcal, rateKgPerWeek: isNum(rateKgPerWeek) ? rateKgPerWeek : 0, weightKg, sex: profile.sex, config: adaptive || {} });
  return { tdee: Math.round(f.kcal / 10) * 10, target: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, limitedBy: t.limitedBy, proteinLimited: t.proteinLimited, proteinWanted: t.proteinWanted } };
}

/**
 * Everything the finished (or skipped) setup writes. Steps the user skipped are left out.
 * @param {{
 *   about?: {sex: string|null, birthYear: number|null, heightCm: number|null, weightKg: number|null, activity: string|null},
 *   rateKgPerWeek?: number|null,
 *   targets?: object|null,          // input for buildTargets
 * }} answers
 * @param {{profile: object, goal: object, targets: object}} current stored settings
 * @param {{today: string, now: number, skipped?: boolean}} when
 * @returns {{settings: Record<string, object>, weight: {date: string, kg: number, updatedAt: number}|null,
 *            metaPatch: {setupCompletedAt: number, setupSkipped: boolean, setupVersion: number}|null, error?: string}}
 *   metaPatch is merged into settings.meta by the caller (read-modify-write in one transaction).
 */
export function setupWrites(answers, current, { today, now, skipped = false }) {
  const settings = {};
  let weight = null;
  const a = answers || {};
  if (a.about) {
    const { sex, birthYear, heightCm, activity, weightKg } = a.about;
    settings.profile = { ...current.profile, sex: sex || null, birthYear: isNum(birthYear) ? birthYear : null,
      heightCm: isNum(heightCm) ? heightCm : null, activity: activity || null };
    if (isNum(weightKg) && weightKg > 0) weight = { date: today, kg: Math.round(weightKg * 100) / 100, updatedAt: now };
  }
  if (isNum(a.rateKgPerWeek)) settings.goal = { ...current.goal, rateKgPerWeek: a.rateKgPerWeek };
  if (a.targets) {
    const r = buildTargets(current.targets, a.targets);
    if (!r.ok) return { settings: {}, weight: null, metaPatch: null, error: r.error };
    settings.targets = r.targets;
  }
  return { settings, weight, metaPatch: { setupCompletedAt: now, setupSkipped: !!skipped, setupVersion: SETUP_VERSION } };
}
