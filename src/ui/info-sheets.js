// The texts behind every info button (ⓘ). Wording lives in the 'info' catalogues (src/i18n/<lang>/info.js);
// this file maps sheet ids to keys and fills in the values from the code's constants.
// Source: the copy audit of 2026-11-19, section 5 (23 sheets). Pure data, no DOM (tests import it).
//
// Each sheet: { titleKey, text(values) → paragraphs[] , defaults? }. Numbers that come from the code's own
// constants are rendered from them, so a sheet cannot drift from the logic. A caller may pass current
// user values, e.g. infoButton('sets', { values: { primary: 1, secondary: 0.5, dropset: 0 } }).
// Style: ≤ ~60 words, plain words, glossary terms (sets, direct / partial, tonnage, target, goal,
// expenditure, starting point, check-in, done, complete day, est. 1RM, weight step, calorie floor),
// units like kg / week and kcal / day, '−' for minus, thin space in thousands, no emojis.
import { RECOVERY_CONFIG, CHECKIN_CONFIG } from '../core/recovery.js';
import { DEFAULT_VOLUME } from '../core/volume.js';
import { KCAL_PER_KG, GOAL_RATE_MIN, GOAL_RATE_MAX, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';
import { BACKUP_DUE_DAYS } from '../core/backup-reminder.js';
import { t } from '../i18n/index.js';

/** 7700 → '7 700' (narrow no-break space), 0.5 → '0.5'. */
export function fmtInfoNumber(n) {
  const [i, d] = String(n).split('.');
  return i.replace(/\B(?=(\d{3})+$)/g, ' ') + (d ? `.${d}` : '');
}
const n = fmtInfoNumber;
const R = RECOVERY_CONFIG;
const C = CHECKIN_CONFIG;
const A = ADAPTIVE_DEFAULTS;
const doseAt = (sets) => Math.min(R.doseFactorMax, Math.max(R.doseFactorMin, Math.round((R.doseIntercept + R.doseSlope * sets) * 100) / 100));
const PHOTO_LONG_EDGE = 1568; // src/food/photo-image.js LONG_EDGE (not imported: that module is DOM code)

/**
 * @typedef {object} InfoSheet
 * @property {string} titleKey catalogue key of the title (namespace 'info')
 * @property {(v: Record<string, any>) => string[]} text paragraphs
 * @property {Record<string, any>} [defaults] values used when the caller passes none
 */

/** @type {Readonly<Record<string, InfoSheet>>} */
export const INFO_SHEETS = Object.freeze({
  recovery: {
    titleKey: 'info.recovery.title',
    text: () => [
      t('info.recovery.p1'),
      t('info.recovery.p2', { minPoints: C.minPoints }),
    ],
  },
  'recovery-math': {
    titleKey: 'info.recoveryMath.title',
    text: () => [
      t('info.recoveryMath.p1', { ref: R.referenceDose, f1: n(doseAt(1)), f8: n(doseAt(8)), fMax: n(R.doseFactorMax), minDose: R.minDose }),
      t('info.recoveryMath.p2', { capMin: R.capMin, capMax: R.capMax, customMin: R.custom.min, customMax: R.custom.max, days: R.lookbackDays }),
    ],
  },
  'recovery-yours': {
    titleKey: 'info.recoveryYours.title',
    text: () => [
      t('info.recoveryYours.p1', { ref: R.referenceDose }),
      t('info.recoveryYours.p2', { minPoints: C.minPoints, minBouts: C.minBouts }),
    ],
  },
  sets: {
    titleKey: 'info.sets.title',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      t('info.sets.p1', { primary: n(v.primary), secondary: n(v.secondary), dropset: n(v.dropset) }),
      t('info.sets.p2'),
    ],
  },
  'sets-workout': {
    titleKey: 'info.setsWorkout.title',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      t('info.setsWorkout.p1', { primary: n(v.primary), secondary: n(v.secondary), dropset: n(v.dropset) }),
      t('info.setsWorkout.p2'),
    ],
  },
  tonnage: {
    titleKey: 'info.tonnage.title',
    text: () => [
      t('info.tonnage.p1', { tFrom: n(10000), tKg: n(1000) }),
      t('info.tonnage.p2'),
    ],
  },
  records: {
    titleKey: 'info.records.title',
    text: () => [t('info.records.p1'), t('info.records.p2')],
  },
  metrics: {
    titleKey: 'info.metrics.title',
    text: () => [t('info.metrics.p1'), t('info.metrics.p2')],
  },
  'top-exercises': {
    titleKey: 'info.topExercises.title',
    text: () => [t('info.topExercises.p1')],
  },
  progression: {
    titleKey: 'info.progression.title',
    // v.reason: the session's own reason (first line, already translated), e.g. from the chip's ⓘ in a workout
    text: (v) => [
      ...(v.reason ? [v.reason] : []),
      t('info.progression.p1'),
      t('info.progression.p2'),
    ],
  },
  starting: {
    titleKey: 'info.starting.title',
    text: () => [t('info.starting.p1'), t('info.starting.p2')],
  },
  photo: {
    titleKey: 'info.photo.title',
    text: () => [
      t('info.photo.p1'),
      t('info.photo.p2', { px: n(PHOTO_LONG_EDGE) }),
      t('info.photo.p3'),
    ],
  },
  camera: {
    titleKey: 'info.camera.title',
    text: () => [t('info.camera.p1')],
  },
  expenditure: {
    titleKey: 'info.expenditure.title',
    text: () => [
      t('info.expenditure.p1'),
      t('info.expenditure.p2', { windowDays: A.windowDays, minWeighIns: A.minWeighIns, minLoggedDays: A.minLoggedDays, minSpanDays: A.minSpanDays, maxStaleDays: A.maxStaleDays }),
    ],
  },
  checkin: {
    titleKey: 'info.checkin.title',
    text: () => [
      t('info.checkin.p1'),
      t('info.checkin.p2', { maxChange: A.maxWeeklyChange }),
    ],
  },
  complete: {
    titleKey: 'info.complete.title',
    text: () => [
      t('info.complete.p1', { weeks: A.medianDays / 7 }),
      t('info.complete.p2'),
    ],
  },
  trend: {
    titleKey: 'info.trend.title',
    text: () => [t('info.trend.p1'), t('info.trend.p2')],
  },
  report: {
    titleKey: 'info.report.title',
    text: () => [t('info.report.p1'), t('info.report.p2')],
  },
  macros: {
    titleKey: 'info.macros.title',
    text: () => [t('info.macros.p1'), t('info.macros.p2')],
  },
  'adaptive-macros': {
    titleKey: 'info.adaptiveMacros.title',
    text: () => [
      t('info.adaptiveMacros.p1'),
      t('info.adaptiveMacros.p2', { female: n(A.floors.female), male: n(A.floors.male), unknown: n(A.floors.unknown) }),
      t('info.adaptiveMacros.p3'),
    ],
  },
  goal: {
    titleKey: 'info.goal.title',
    text: () => [
      t('info.goal.p1', { lose: n(-GOAL_RATE_MIN), gain: n(GOAL_RATE_MAX), kcalPerKg: n(KCAL_PER_KG) }),
      t('info.goal.p2'),
    ],
  },
  backup: {
    titleKey: 'info.backup.title',
    text: () => [
      t('info.backup.p1'),
      t('info.backup.p2', { days: BACKUP_DUE_DAYS }),
    ],
  },
  storage: {
    titleKey: 'info.storage.title',
    text: () => [t('info.storage.p1'), t('info.storage.p2')],
  },
  'import-weights': {
    titleKey: 'info.importWeights.title',
    text: () => [t('info.importWeights.p1'), t('info.importWeights.p2')],
  },
  'import-workouts': {
    titleKey: 'info.importWorkouts.title',
    text: () => [t('info.importWorkouts.p1'), t('info.importWorkouts.p2')],
  },
  // Split library (src/splits/, docs/SPLITS.md): wording from the split-library research, 2026-11-19.
  'split-choose': {
    titleKey: 'info.splitChoose.title',
    text: () => [t('info.splitChoose.p1'), t('info.splitChoose.p2')],
  },
  'split-run': {
    titleKey: 'info.splitRun.title',
    text: () => [t('info.splitRun.p1'), t('info.splitRun.p2')],
  },
  'split-sets': {
    titleKey: 'info.splitSets.title',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      t('info.splitSets.p1', { primary: n(v.primary), secondary: n(v.secondary) }),
      t('info.splitSets.p2'),
    ],
  },
});

/** @returns {string[]} all sheet ids */
export const INFO_SHEET_IDS = Object.freeze(Object.keys(INFO_SHEETS));

/**
 * Title and paragraphs of a sheet, with values filled in (caller values over defaults).
 * @param {string} id @param {Record<string, any>} [values]
 * @returns {{title: string, paragraphs: string[]}|null}
 */
export function infoSheet(id, values = {}) {
  const s = Object.prototype.hasOwnProperty.call(INFO_SHEETS, id) ? INFO_SHEETS[id] : null;
  if (!s) return null;
  const v = { ...(s.defaults || {}), ...values };
  return { title: t(s.titleKey), paragraphs: s.text(v) };
}
