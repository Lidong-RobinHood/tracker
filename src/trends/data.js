// Data access and shared helpers for the Trends views. All reads/writes go through db.js;
// all numbers come from src/core.
import * as db from '../db/db.js';
import { signedRateText } from '../core/goal-display.js';
import { el } from '../ui/index.js';
import { today, addDays } from '../core/dates.js';
import { sumEntries } from '../core/nutrition.js';
import { dailyIntake, ADAPTIVE_DEFAULTS, buildCheckIn, estimateExpenditure, checkInRecords } from '../core/adaptive.js';

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

/** Signed number with a real minus sign: '+0.3', '−0.25'. */
export function signed(n, decimals = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const r = Number(n.toFixed(decimals));
  if (r === 0) return (0).toFixed(decimals).replace(/\.?0+$/, '') || '0';
  const s = Math.abs(r).toFixed(decimals).replace(/\.?0+$/, '');
  return `${r > 0 ? '+' : '−'}${s}`;
}

/** Plain-language goal: 'Lose 0.5 kg a week' */
export function goalText(rate) {
  if (!rate) return 'Maintain weight';
  return `${rate < 0 ? 'Lose' : 'Gain'} · ${signedRateText(rate)}`;
}

export const CONFIDENCE_LABEL = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/** Small "card that links somewhere" with a title row. */
export function linkCard(hrefPath, title, ...children) {
  return el('a', { class: 'card tr-card', href: hrefPath },
    el('div', { class: 'tr-card-head' }, el('span', { class: 'tr-card-title' }, title), el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›')),
    children);
}
