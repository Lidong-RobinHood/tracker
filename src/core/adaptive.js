// Adaptive targets (SPEC §6): trend weight, expenditure (TDEE) estimate, formula fallback, weekly
// calorie/macro target and the weekly check-in. Pure, no DOM / IndexedDB, deterministic.
//
// Inputs
//   weights: [{ date: 'YYYY-MM-DD', kg }]   morning body weights, gaps allowed (invalid values ignored)
//   intake:  [{ date, kcal }]               daily totals, only days that have diary entries
//   asOf:    'YYYY-MM-DD'                   "today": its weight counts, its intake does NOT (incomplete day)
//
// Expenditure model (a 2-state Kalman filter, the energy-balance idea behind MacroFactor):
//   state  m = true body mass (kg), T = expenditure (kcal/day)
//   day d → d+1:  m ← m + (intake_d − T) / 7700      T ← T            (+ process noise qMass, qTdee)
//   observation:  weight_d = m + noise (sd weightNoiseKg)
// Each weigh-in nudges m and, through their covariance, T. This is the recursive form of
// "TDEE = mean intake − weight change rate × 7700" over an exponentially fading window, but it
// uses every day's intake exactly (a big but real cheat day is explained by the weight it adds),
// tolerates gaps in both series, and its variance gives a standard error for the confidence.
//   - Robust: a weigh-in whose innovation exceeds huberK standard deviations is clipped (Huber), so a
//     one-off water spike cannot drag the estimate.
//   - Incomplete intake days: a logged day below incompleteRatio × the median logged day (±28 days)
//     is treated as not logged. Days without a (valid) log are imputed with the mean valid intake of
//     the surrounding ±14 days, with extra uncertainty (missingIntakeSdKcal).
//   - Today's intake is never used.
import { addDays, daysBetween, weekStart, isValidDate } from './dates.js';
import { splitMacrosFor } from './macro-split.js';

export const KCAL_PER_KG = 7700;

export const ACTIVITY_LEVELS = Object.freeze([
  { id: 'sedentary', label: 'Sedentary', hint: 'desk job, little exercise', factor: 1.2 },
  { id: 'light', label: 'Lightly active', hint: 'exercise 1–3 days a week', factor: 1.375 },
  { id: 'moderate', label: 'Moderately active', hint: 'exercise 3–5 days a week', factor: 1.55 },
  { id: 'active', label: 'Very active', hint: 'hard exercise 6–7 days a week', factor: 1.725 },
  { id: 'extra', label: 'Extremely active', hint: 'physical job plus training', factor: 1.9 },
]);

/** Allowed goal range (kg per week). */
export const GOAL_RATE_MIN = -1;
export const GOAL_RATE_MAX = 0.5;

/** Every tunable number, with its default. Pass overrides to any function as `config`. */
export const ADAPTIVE_DEFAULTS = Object.freeze({
  kcalPerKg: KCAL_PER_KG,
  // trend weight (display)
  trendAlpha: 0.1,               // EMA smoothing per day; a gap of n days uses 1 − (1 − α)^n
  // expenditure filter
  weightNoiseKg: 0.5,            // sd of day-to-day scale noise / water
  massNoiseKg: 0.02,             // sd per day of real mass changes the model does not explain
  tdeeDriftKcal: 18,             // sd per day of the random walk of expenditure (adaptivity vs. stability)
  initialTdeeSdKcal: 800,        // prior sd of expenditure at the start of the lookback (≈ uninformative)
  huberK: 2,                     // weigh-ins further than this many sd from the prediction are clipped
  missingIntakeSdKcal: 400,      // uncertainty added on a day whose intake was imputed
  imputeDays: 14,                // imputation uses valid logged days within ± this many days
  incompleteRatio: 0.5,          // logged day < ratio × median logged day → treated as incomplete
  medianDays: 28,                // ± days for that median
  lookbackDays: 120,             // the filter starts at most this many days before asOf
  // sufficiency
  windowDays: 28,                // counts below are taken over the last windowDays
  minWeighIns: 8,
  minLoggedDays: 10,
  minSpanDays: 14,               // days from the first weigh-in/log to asOf
  maxStaleDays: 7,               // a weigh-in is needed within this many days
  confidenceHighSe: 100,         // standard error (kcal) at or below → 'high'
  confidenceMediumSe: 175,       // … at or below → 'medium', else 'low'
  // targets
  proteinPerKg: 2.0,             // g protein per kg trend weight
  fatPerKg: 0.8,                 // minimum g fat per kg trend weight
  minFatG: 20,                   // fat never goes below this when protein has to be capped to fit the kcal
  kcalFloor: null,               // null = by sex (floors below)
  floors: { male: 1500, female: 1200, unknown: 1350 },
  maxWeeklyChange: 150,          // kcal change vs the previous adaptive target
  roundTo: 10,
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Defaults merged with overrides (null/undefined/invalid overrides are ignored, except kcalFloor). */
export function adaptiveConfig(overrides = {}) {
  const cfg = { ...ADAPTIVE_DEFAULTS, floors: { ...ADAPTIVE_DEFAULTS.floors } };
  for (const [k, v] of Object.entries(overrides || {})) {
    if (k === 'floors' && v && typeof v === 'object') Object.assign(cfg.floors, v);
    else if (k in ADAPTIVE_DEFAULTS && isNum(v)) cfg[k] = v;
  }
  return cfg;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Valid weights sorted by date, one per date (the last one given wins). */
export function cleanWeights(weights) {
  const byDate = new Map();
  for (const w of weights || []) {
    if (w && isValidDate(w.date) && isNum(w.kg) && w.kg > 20 && w.kg < 400) byDate.set(w.date, w.kg);
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, kg]) => ({ date, kg }));
}

/** Daily kcal per date (duplicates summed, invalid ignored). @returns {Map<string, number>} */
function intakeMap(intake) {
  const m = new Map();
  for (const r of intake || []) {
    if (r && isValidDate(r.date) && isNum(r.kcal) && r.kcal >= 0) m.set(r.date, (m.get(r.date) || 0) + r.kcal);
  }
  return m;
}

// ---------------------------------------------------------------- trend weight

/**
 * Exponential moving average over calendar days.
 * @returns {{date: string, kg: number, trend: number}[]} one row per weighed day
 */
export function trendSeries(weights, config) {
  const { trendAlpha } = adaptiveConfig(config);
  const out = [];
  let prev = null;
  for (const w of cleanWeights(weights)) {
    if (!prev) prev = { date: w.date, trend: w.kg };
    else {
      const n = daysBetween(prev.date, w.date);
      const a = 1 - (1 - trendAlpha) ** n;
      prev = { date: w.date, trend: prev.trend + a * (w.kg - prev.trend) };
    }
    out.push({ date: w.date, kg: w.kg, trend: prev.trend });
  }
  return out;
}

/** Trend value on any date: that of the last weighed day on or before it (null before the first). */
export function trendAt(series, date) {
  let v = null;
  for (const r of series) {
    if (r.date > date) break;
    v = r.trend;
  }
  return v;
}

/**
 * Weight change rate in kg/week: least-squares slope through the raw weights of the last `days`
 * days (default 28) up to asOf. null with fewer than 4 weigh-ins or a span under 7 days.
 */
export function weightRate(weights, asOf, days = 28) {
  const from = addDays(asOf, -(days - 1));
  const pts = cleanWeights(weights).filter((w) => w.date >= from && w.date <= asOf)
    .map((w) => ({ x: daysBetween(from, w.date), y: w.kg }));
  if (pts.length < 4 || pts[pts.length - 1].x - pts[0].x < 7) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  let sxy = 0; let sxx = 0;
  for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  return (sxy / sxx) * 7;
}

// ---------------------------------------------------------------- intake classification

/**
 * Which logged days (before asOf) count. A day is 'incomplete' when its kcal is below
 * incompleteRatio × the median of logged days within ± medianDays (all before asOf).
 * @returns {{date: string, kcal: number, valid: boolean}[]} sorted by date
 */
export function classifyIntake(intake, asOf, config) {
  const cfg = adaptiveConfig(config);
  const rows = [...intakeMap(intake).entries()].filter(([d, k]) => d < asOf && k > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return rows.map(([date, kcal]) => {
    const lo = addDays(date, -cfg.medianDays);
    const hi = addDays(date, cfg.medianDays);
    const med = median(rows.filter(([d]) => d >= lo && d <= hi).map((r) => r[1]));
    return { date, kcal, valid: kcal >= cfg.incompleteRatio * med };
  });
}

/**
 * Mon–Sun weeks from the week containing `from` up to the week containing `today`, each with the
 * average of its complete logged days (today excluded, incomplete days left out).
 * @returns {{from: string, to: string, avg: number|null, days: number, incomplete: number}[]}
 */
export function weeklyIntake(intake, today, from, config) {
  const byDate = new Map(classifyIntake(intake, today, config).map((r) => [r.date, r]));
  const weeks = [];
  for (let ws = weekStart(from); ws <= today; ws = addDays(ws, 7)) {
    const rows = [];
    for (let i = 0; i < 7; i++) { const r = byDate.get(addDays(ws, i)); if (r) rows.push(r); }
    const ok = rows.filter((r) => r.valid);
    weeks.push({ from: ws, to: addDays(ws, 6), avg: ok.length ? ok.reduce((s, r) => s + r.kcal, 0) / ok.length : null,
      days: ok.length, incomplete: rows.length - ok.length });
  }
  return weeks;
}

// ---------------------------------------------------------------- formula fallback

/**
 * Mifflin-St Jeor BMR × activity factor. Needs sex, birthYear, heightCm, activity and a weight.
 * Unknown/other sex uses the midpoint of the male and female constants.
 * @returns {{kcal: number, bmr: number, factor: number, age: number}|null}
 */
export function formulaTdee(profile, weightKg, asOf) {
  const p = profile || {};
  const act = ACTIVITY_LEVELS.find((a) => a.id === p.activity);
  if (!act || !isNum(p.heightCm) || !isNum(p.birthYear) || !isNum(weightKg) || !p.sex || !isValidDate(asOf)) return null;
  const age = Number(asOf.slice(0, 4)) - p.birthYear;
  if (age < 10 || age > 110 || p.heightCm < 100 || p.heightCm > 250) return null;
  const s = p.sex === 'male' ? 5 : p.sex === 'female' ? -161 : -78;
  const bmr = 10 * weightKg + 6.25 * p.heightCm - 5 * age + s;
  return { kcal: bmr * act.factor, bmr, factor: act.factor, age };
}

// ---------------------------------------------------------------- expenditure

/**
 * Estimate expenditure as of `asOf` (uses weights up to and including asOf, intake up to asOf − 1).
 * @param {{weights: object[], intake: object[], asOf: string, profile?: object, config?: object}} a
 * @returns {{
 *   status: 'ok'|'insufficient', tdee: number|null, se: number|null, confidence: 'high'|'medium'|'low'|null,
 *   missing: string[],
 *   basis: { from: string, to: string, weighIns: number, loggedDays: number, incompleteDays: number,
 *            spanDays: number, meanIntake: number|null, trendKg: number|null, rateKgPerWeek: number|null },
 *   formula: {kcal: number, bmr: number, factor: number, age: number}|null
 * }}
 */
export function estimateExpenditure({ weights, intake, asOf, profile = null, config }) {
  const cfg = adaptiveConfig(config);
  const lookFrom = addDays(asOf, -cfg.lookbackDays);
  const ws = cleanWeights(weights).filter((w) => w.date >= lookFrom && w.date <= asOf);
  const ctxFrom = addDays(lookFrom, -cfg.medianDays);
  const recent = (intake || []).filter((r) => r && typeof r.date === 'string' && r.date >= ctxFrom);
  const days = classifyIntake(recent, asOf, cfg).filter((r) => r.date >= lookFrom);
  const valid = days.filter((r) => r.valid);

  const winFrom = addDays(asOf, -(cfg.windowDays - 1));
  const intakeFrom = addDays(asOf, -cfg.windowDays);
  const weighIns = ws.filter((w) => w.date >= winFrom).length;
  const loggedWin = days.filter((r) => r.date >= intakeFrom);
  const loggedDays = loggedWin.filter((r) => r.valid).length;
  const incompleteDays = loggedWin.length - loggedDays;
  const firstW = ws.length ? ws[0].date : null;
  const firstI = valid.length ? valid[0].date : null;
  const spanDays = firstW && firstI ? daysBetween(firstW > firstI ? firstW : firstI, asOf) : 0;
  const lastW = ws.length ? ws[ws.length - 1].date : null;

  const series = trendSeries(ws, cfg);
  const trendKg = trendAt(series, asOf);
  const meanIntake = loggedDays ? loggedWin.filter((r) => r.valid).reduce((s, r) => s + r.kcal, 0) / loggedDays : null;
  const basis = {
    from: winFrom, to: asOf, weighIns, loggedDays, incompleteDays, spanDays, meanIntake, trendKg,
    rateKgPerWeek: weightRate(ws, asOf),
  };
  const formula = formulaTdee(profile, trendKg, asOf);

  const missing = [];
  const plural = (n, word) => `${n} more ${word}${n === 1 ? '' : 's'}`;
  if (weighIns < cfg.minWeighIns) missing.push(`Need ${plural(cfg.minWeighIns - weighIns, 'weigh-in')} in the last ${cfg.windowDays} days.`);
  if (loggedDays < cfg.minLoggedDays) missing.push(`Need ${plural(cfg.minLoggedDays - loggedDays, 'fully logged day')} in the last ${cfg.windowDays} days.`);
  if (spanDays < cfg.minSpanDays) missing.push(`Need ${plural(cfg.minSpanDays - spanDays, 'day')} of history (at least ${cfg.minSpanDays} days of weights and food).`);
  else if (lastW && daysBetween(lastW, asOf) > cfg.maxStaleDays) missing.push(`No weigh-in in the last ${cfg.maxStaleDays} days.`);

  if (missing.length) {
    return { status: 'insufficient', tdee: null, se: null, confidence: null, missing, basis, formula };
  }

  const { T, se } = runFilter(ws, days, asOf, cfg, formula);
  const confidence = se <= cfg.confidenceHighSe ? 'high' : se <= cfg.confidenceMediumSe ? 'medium' : 'low';
  return { status: 'ok', tdee: T, se, confidence, missing, basis, formula };
}

/** The Kalman filter described at the top of the file. */
function runFilter(ws, days, asOf, cfg, formula) {
  const rho = cfg.kcalPerKg;
  const start = ws[0].date < days[0].date ? ws[0].date : days[0].date;
  const n = daysBetween(start, asOf);              // index of asOf
  const wAt = new Array(n + 1).fill(null);
  for (const w of ws) wAt[daysBetween(start, w.date)] = w.kg;
  // prefix sums of valid intake for the imputation mean
  const vk = new Array(n).fill(0); const vc = new Array(n).fill(0);
  const kcalAt = new Array(n).fill(null);
  for (const r of days) {
    const i = daysBetween(start, r.date);
    if (i < 0 || i >= n || !r.valid) continue;
    vk[i] = r.kcal; vc[i] = 1; kcalAt[i] = r.kcal;
  }
  const ps = [0]; const pc = [0];
  for (let i = 0; i < n; i++) { ps.push(ps[i] + vk[i]); pc.push(pc[i] + vc[i]); }
  const meanAround = (i) => {
    const a = Math.max(0, i - cfg.imputeDays); const b = Math.min(n - 1, i + cfg.imputeDays);
    const c = pc[b + 1] - pc[a];
    return c >= 3 ? (ps[b + 1] - ps[a]) / c : null;
  };

  // prior for T: mean valid intake over the first two weeks, else the formula, else 2200
  const first = meanAround(Math.min(cfg.imputeDays, n - 1));
  let T = first ?? (formula ? formula.kcal : 2200);
  let m = ws[0].kg;
  const R = cfg.weightNoiseKg ** 2;
  let P00 = R + (daysBetween(start, ws[0].date) * cfg.massNoiseKg) ** 2;
  let P01 = 0;
  let P11 = cfg.initialTdeeSdKcal ** 2;
  const qm = cfg.massNoiseKg ** 2; const qT = cfg.tdeeDriftKcal ** 2;
  const a = -1 / rho;
  const startW = daysBetween(start, ws[0].date);

  for (let i = startW; i <= n; i++) {
    const w = i === startW ? null : wAt[i];
    if (w !== null) {
      const S = P00 + R;
      const lim = cfg.huberK * Math.sqrt(S);
      const nu = Math.max(-lim, Math.min(lim, w - m));
      const K0 = P00 / S; const K1 = P01 / S;
      m += K0 * nu; T += K1 * nu;
      const p00 = P00 - K0 * P00; const p01 = P01 - K0 * P01; const p11 = P11 - K1 * P01;
      P00 = p00; P01 = p01; P11 = p11;
    }
    if (i === n) break;
    let I = kcalAt[i]; let extra = 0;
    if (I === null) {
      I = meanAround(i) ?? T;
      extra = (cfg.missingIntakeSdKcal / rho) ** 2;
    }
    m += (I - T) / rho;
    const n00 = P00 + 2 * a * P01 + a * a * P11 + qm + extra;
    const n01 = P01 + a * P11;
    P00 = n00; P01 = n01; P11 += qT;
  }
  return { T, se: Math.sqrt(P11) };
}

// ---------------------------------------------------------------- targets

/** Calorie floor for the user's sex unless config.kcalFloor is set. */
export function kcalFloor(sex, config) {
  const cfg = adaptiveConfig(config);
  if (isNum(cfg.kcalFloor) && cfg.kcalFloor > 0) return cfg.kcalFloor;
  return sex === 'male' ? cfg.floors.male : sex === 'female' ? cfg.floors.female : cfg.floors.unknown;
}

/**
 * Daily target for the coming week.
 *   kcal = TDEE + rate × 7700 / 7, rounded to roundTo; then limited to previousKcal ± maxWeeklyChange
 *   (when there is a previous adaptive target). The limited value is rounded toward the previous
 *   target so it never moves more than the limit (2005 → at most 2150, not 2160); when that is
 *   impossible it is the exact limit (not a multiple of roundTo). Never below the floor (the floor
 *   wins over the change limit).
 *   protein = proteinPerKg × weight; fat = fatPerKg × weight (lowered only if kcal cannot fit it);
 *   carbs = the rest (≥ 0). If protein plus minFatG would exceed the kcal, protein is capped so that
 *   protein + minFatG fit and proteinLimited is true (proteinWanted = the per-kg amount). Macros
 *   therefore never add up to more than kcal + a few kcal of rounding drift.
 * @param {{tdee: number, rateKgPerWeek: number, weightKg: number, sex?: string|null,
 *          previousKcal?: number|null, config?: object}} a
 * @returns {{kcal: number, protein: number, carbs: number, fat: number, rawKcal: number,
 *            limitedBy: 'floor'|'change'|null, proteinLimited: boolean, proteinWanted: number}}
 */
export function weeklyTarget({ tdee, rateKgPerWeek = 0, weightKg, sex = null, previousKcal = null, config }) {
  const cfg = adaptiveConfig(config);
  const step = cfg.roundTo;
  const rnd = (v) => Math.round(v / step) * step;
  const rawKcal = tdee + (rateKgPerWeek * cfg.kcalPerKg) / 7;
  let kcal = rnd(rawKcal);
  let limitedBy = null;
  if (isNum(previousKcal) && previousKcal > 0) {
    const lo = previousKcal - cfg.maxWeeklyChange; const hi = previousKcal + cfg.maxWeeklyChange;
    if (kcal < lo || kcal > hi) {
      const edge = kcal > hi ? hi : lo;
      const towardPrev = kcal > hi ? Math.floor(edge / step) * step : Math.ceil(edge / step) * step;
      kcal = towardPrev >= lo && towardPrev <= hi ? towardPrev : edge;
      limitedBy = 'change';
    }
  }
  const floor = kcalFloor(sex, cfg);
  if (kcal < floor) { kcal = floor; limitedBy = 'floor'; }
  const proteinWanted = Math.round(cfg.proteinPerKg * weightKg);
  const fatFloor = Math.max(0, Math.min(Math.round(cfg.fatPerKg * weightKg), cfg.minFatG));
  let protein = proteinWanted;
  let proteinLimited = false;
  if (protein * 4 + fatFloor * 9 > kcal) {
    protein = Math.max(0, Math.floor((kcal - fatFloor * 9) / 4));
    proteinLimited = true;
  }
  const fat = Math.max(0, Math.min(Math.round(cfg.fatPerKg * weightKg), Math.floor((kcal - protein * 4) / 9)));
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, rawKcal, limitedBy, proteinLimited, proteinWanted };
}

// ---------------------------------------------------------------- weekly check-in

/**
 * Daily kcal totals from diary entries. `sum` is nutrition.sumEntries (passed in to keep this
 * module free of feature imports in tests; any function returning {kcal} works).
 * @returns {{date: string, kcal: number}[]} sorted by date
 */
export function dailyIntake(entries, sum) {
  const byDate = new Map();
  for (const e of entries || []) {
    if (!e || !isValidDate(e.date)) continue;
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, list]) => ({ date, kcal: sum(list).kcal }));
}

/**
 * The weekly check-in for the week containing `today`: reviews the previous Mon–Sun week and
 * proposes the target for this week. Expenditure is estimated as of this Monday (intake up to Sunday).
 * @param {{today: string, weights: object[], intake: object[], goal: {rateKgPerWeek?: number},
 *          profile?: object, targets: {kcal: number, source?: string}, config?: object}} a
 */
export function buildCheckIn({ today, weights, intake, goal, profile = null, targets, config }) {
  const cfg = adaptiveConfig(config);
  const thisWeek = weekStart(today);
  const reviewFrom = addDays(thisWeek, -7);
  const reviewTo = addDays(thisWeek, -1);
  const week = classifyIntake(intake, thisWeek, cfg).filter((r) => r.date >= reviewFrom && r.date <= reviewTo);
  const validWeek = week.filter((r) => r.valid);
  const avgIntake = validWeek.length ? validWeek.reduce((s, r) => s + r.kcal, 0) / validWeek.length : null;
  const series = trendSeries(weights, cfg);
  const trendEnd = trendAt(series, reviewTo);
  const trendStart = trendAt(series, addDays(reviewFrom, -1));
  const estimate = estimateExpenditure({ weights, intake, asOf: thisWeek, profile, config: cfg });
  const rate = isNum(goal && goal.rateKgPerWeek) ? goal.rateKgPerWeek : 0;
  const weightKg = trendAt(series, thisWeek);
  const basisKind = estimate.status === 'ok' ? 'data' : estimate.formula ? 'formula' : null;
  const tdee = basisKind === 'data' ? estimate.tdee : basisKind === 'formula' ? estimate.formula.kcal : null;
  const previousKcal = targets && targets.source === 'adaptive' ? targets.kcal : null;
  let proposal = tdee !== null && weightKg !== null
    ? weeklyTarget({ tdee, rateKgPerWeek: rate, weightKg, sex: profile && profile.sex, previousKcal, config: cfg })
    : null;
  // Percent mode: the macro split is the user's explicit choice, so only the calories adapt and
  // the grams follow the stored percentages (macro-split.js).
  const split = proposal ? splitMacrosFor(targets, proposal.kcal) : null;
  if (split) {
    const { protein, carbs, fat } = proposal;
    proposal = { ...proposal, ...split, split: 'percent', byWeight: { protein, carbs, fat } };
  }
  return {
    weekStart: thisWeek, reviewFrom, reviewTo,
    avgIntake, daysLogged: validWeek.length, incompleteDays: week.length - validWeek.length,
    trendStart, trendEnd, trendChange: trendStart !== null && trendEnd !== null ? trendEnd - trendStart : null,
    estimate, basisKind, tdee, rateKgPerWeek: rate, weightKg, proposal,
  };
}

/**
 * Records written when the user answers a check-in.
 * @returns {{targets: object|null, history: object}} targets is null for 'kept' (nothing changes)
 */
export function checkInRecords(checkIn, decision, currentTargets, now) {
  let p = checkIn.proposal;
  // Follow the split stored at answer time (it may differ from when the check-in was built).
  const split = p ? splitMacrosFor(currentTargets, p.kcal) : null;
  if (split) p = { ...p, ...split };
  else if (p && p.byWeight) p = { ...p, ...p.byWeight };   // built in percent mode, now grams
  const accepted = decision === 'accepted' && p;
  return {
    targets: accepted ? { ...currentTargets, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, source: 'adaptive' } : null,
    history: {
      weekStart: checkIn.weekStart,
      trendKg: checkIn.weightKg,
      tdee: checkIn.tdee === null ? null : Math.round(checkIn.tdee),
      kcalTarget: accepted ? p.kcal : currentTargets.kcal,
      daysLogged: checkIn.daysLogged,
      decision: accepted ? 'accepted' : 'kept',
      basis: checkIn.basisKind,
      proposal: p ? { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat } : null,
      createdAt: now,
    },
  };
}
