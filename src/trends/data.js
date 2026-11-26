// Data access and shared helpers for the Trends views. All reads/writes go through db.js;
// all numbers come from src/core.
import * as db from '../db/db.js';
import { signedRateValue } from '../core/goal-display.js';
import { t } from '../i18n/index.js';
import { el, icon, fmtGrouped, fmtSigned } from '../ui/index.js';
import { today, addDays } from '../core/dates.js';
import { sumEntries } from '../core/nutrition.js';
import { dailyIntake, ADAPTIVE_DEFAULTS, buildCheckIn, estimateExpenditure, checkInRecords, displayTdee, weeklyIntake, intakeHistoryRange, loggedDayCount } from '../core/adaptive.js';

let cssLoaded = false;
/** Load trends.css once. */
export function ensureCss() {
  if (cssLoaded || document.querySelector('link[data-tr-css]')) { cssLoaded = true; return; }
  cssLoaded = true;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./trends.css', import.meta.url).href, 'data-tr-css': '' }));
}

/** Diary days needed: estimator lookback + median context. */
const INTAKE_DAYS = ADAPTIVE_DEFAULTS.lookbackDays + ADAPTIVE_DEFAULTS.medianDays + 7;

/** User options for the adaptive maths, stored under settings key 'adaptive'. */
export const ADAPTIVE_SETTING_DEFAULTS = Object.freeze({ proteinPerKg: 2.0, fatPerKg: 0.8, kcalFloor: null });

export async function getAdaptiveSetting() {
  const v = await db.getSetting('adaptive');
  return { ...ADAPTIVE_SETTING_DEFAULTS, ...(v && typeof v === 'object' ? v : {}) };
}

/** Everything the trends screens need, loaded in parallel. */
export async function loadTrendsData(now = today()) {
  const [weights, entries, targets, goal, profile, adaptive, history] = await Promise.all([
    db.getAll('weights'),
    db.range('diary', 'date', { lower: addDays(now, -INTAKE_DAYS), upper: now }),
    db.getSetting('targets'),
    db.getSetting('goal'),
    db.getSetting('profile'),
    getAdaptiveSetting(),
    db.getAll('targetHistory'),
  ]);
  const intake = dailyIntake(entries, sumEntries);
  const config = adaptive;
  const estimate = estimateExpenditure({ weights, intake, asOf: now, profile, config });
  const checkIn = buildCheckIn({ today: now, weights, intake, goal, profile, targets, config });
  history.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1));
  const doneThisWeek = history.find((h) => h.weekStart === checkIn.weekStart) || null;
  return { today: now, weights, entries, intake, targets, goal, profile, adaptive, config, estimate, checkIn, history, doneThisWeek };
}

/**
 * Answer the check-in. 'accepted' writes settings.targets (source 'adaptive') and a targetHistory
 * record in one transaction; 'kept' writes only the history record so the check-in is marked done.
 */
export async function answerCheckIn(checkIn, decision) {
  const current = await db.getSetting('targets');
  const rec = checkInRecords(checkIn, decision, current, Date.now());
  await db.transaction(['settings', 'targetHistory'], 'readwrite', async (t) => {
    if (rec.targets) await t.put('settings', { key: 'targets', value: rec.targets });
    await t.put('targetHistory', rec.history);
  });
  return rec;
}

/**
 * Intake history window with its weekly rows and one exactly-labelled count, shared by the dashboard
 * card and the Intake history screen so both say the same.
 */
export function intakeHistory(d) {
  const { from, to } = intakeHistoryRange(d.today);
  const weeks = weeklyIntake(d.intake, d.today, from, d.config);
  const logged = loggedDayCount(weeks);
  const label = t('trends.intake.loggedLast4', { count: logged });
  return { from, to, weeks, logged, label };
}

/** Expenditure for display: nearest 10 kcal everywhere ('2 450'); '–' when unknown. */
export function tdeeText(kcal) {
  const v = displayTdee(kcal);
  return v === null ? '–' : fmtGrouped(v);
}

/**
 * Signed number with a true minus and thin-space thousands: '+0.3', '−0.25', '0'.
 * Rounding rules (one per quantity): body weight and weight changes 1 decimal, rates in kg / week
 * 2 decimals, kcal whole numbers, percentages 1 decimal.
 */
export function signed(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return padDecimals(fmtSigned(n, decimals), decimals);
}

/** Display number with a fixed number of decimals ('81.0', '1 310'), for figures shown side by side. */
export function fixed(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return padDecimals(fmtGrouped(n, decimals), decimals);
}
function padDecimals(s, decimals) {
  if (!decimals || s === '–') return s;
  const [i, d = ''] = s.split('.');
  return `${i}.${d.padEnd(decimals, '0')}`;
}

/** Weekly rate as shown everywhere: '−0.19 kg / week'. */
export const rateText = (rate) => (rate === null || rate === undefined || !Number.isFinite(rate) ? '–' : kgPerWeek(signed(rate, 2)));

/** '{value} kg / week' in the active language. */
export const kgPerWeek = (value) => t('trends.kgPerWeek', { value });

/** The goal in one form everywhere: 'Maintain' or '−0.5 kg / week'. */
export function goalText(rate) {
  if (!rate) return t('trends.goal.maintain');
  return kgPerWeek(signedRateValue(rate));
}

/** Expenditure confidence as a short tag: '± 120 kcal · from your data'. */
export const confidenceText = (e) => t('trends.exp.confidence', { se: fmtGrouped(Math.round(e.se / 10) * 10) });

/**
 * Card that links somewhere: 17 px title (+ optional tag), a chevron, then the content.
 * @param {string} hrefPath @param {string} title @param {{tag?: Node|null, label?: string}} opts
 */
export function linkCard(hrefPath, title, opts, ...children) {
  return el('a', { class: 'card tr-card', href: hrefPath, 'aria-label': opts.label || null },
    el('div', { class: 'tr-card-head' }, el('div', { class: 'tr-card-titles' }, el('h2', { class: 'card-title' }, title), opts.tag || null),
      icon('chevron-right', { class: 'li-chevron' })),
    children);
}
