// The texts behind every info button (ⓘ), in one place. Edit wording here only.
// Source: the copy audit of 2026-11-19, section 5 (23 sheets). Pure data, no DOM (tests import it).
//
// Each sheet: { title, text(values) → paragraphs[] , defaults? }. Numbers that come from the code's own
// constants are rendered from them, so a sheet cannot drift from the logic. A caller may pass current
// user values, e.g. infoButton('sets', { values: { primary: 1, secondary: 0.5, dropset: 0 } }).
// Style: ≤ ~60 words, plain words, glossary terms (sets, direct / partial, tonnage, target, goal,
// expenditure, starting point, check-in, done, complete day, est. 1RM, weight step, calorie floor),
// units like kg / week and kcal / day, '−' for minus, thin space in thousands, no emojis.
import { RECOVERY_CONFIG } from '../core/recovery.js';
import { DEFAULT_VOLUME } from '../core/volume.js';
import { KCAL_PER_KG, GOAL_RATE_MIN, GOAL_RATE_MAX, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';
import { BACKUP_DUE_DAYS } from '../core/backup-reminder.js';

/** 7700 → '7 700' (narrow no-break space), 0.5 → '0.5'. */
export function fmtInfoNumber(n) {
  const [i, d] = String(n).split('.');
  return i.replace(/\B(?=(\d{3})+$)/g, ' ') + (d ? `.${d}` : '');
}
const n = fmtInfoNumber;
const R = RECOVERY_CONFIG;
const A = ADAPTIVE_DEFAULTS;
const doseAt = (sets) => Math.min(R.doseFactorMax, Math.max(R.doseFactorMin, Math.round((R.doseIntercept + R.doseSlope * sets) * 100) / 100));
const PHOTO_LONG_EDGE = 1568; // src/food/photo-image.js LONG_EDGE (not imported: that module is DOM code)

/**
 * @typedef {object} InfoSheet
 * @property {string} title
 * @property {(v: Record<string, any>) => string[]} text paragraphs
 * @property {Record<string, any>} [defaults] values used when the caller passes none
 */

/** @type {Readonly<Record<string, InfoSheet>>} */
export const INFO_SHEETS = Object.freeze({
  recovery: {
    title: 'Muscle recovery',
    defaults: { faster: R.paces.faster, slower: R.paces.slower },
    text: (v) => [
      'A rule of thumb, not a measurement. A hard-trained muscle usually gets 48–72 h; smaller muscles less, legs more. More sets lengthen the window. Sleep, food, effort and soreness change real recovery.',
      `Recovering = before the range · likely ready = inside · recovered = past it. Still sore or weak? Give it more time. Pace: faster × ${n(v.faster)}, slower × ${n(v.slower)}.`,
    ],
  },
  'recovery-math': {
    title: 'How sets scale the window',
    text: () => [
      `Sets count like weekly sets. Ranges are for ${R.referenceDose} hard sets: 1 set × ${n(doseAt(1))}, 8 sets × ${n(doseAt(8))}, 9 or more × ${n(R.doseFactorMax)}. Under ${R.minDose} counted set does not restart the clock.`,
      `If you train again inside the window, the leftover load carries over. Defaults stay within ${R.capMin}–${R.capMax} h; your own ranges within ${R.custom.min}–${R.custom.max} h. Only the last ${R.lookbackDays} days count.`,
    ],
  },
  sets: {
    title: 'Weekly sets',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      `Done normal sets per muscle, Monday to Sunday. Direct (the muscle is a main mover) counts × ${n(v.primary)}; partial (it assists) × ${n(v.secondary)}; dropsets × ${n(v.dropset)}.`,
      'Change the factors in Settings › Set weighting. With a target, a row shows done / target and the bar fills at 100 %.',
    ],
  },
  'sets-workout': {
    title: 'Sets per muscle',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      `Done normal sets of this workout per muscle. Direct (the muscle is a main mover) counts × ${n(v.primary)}; partial (it assists) × ${n(v.secondary)}; dropsets × ${n(v.dropset)}.`,
      'They add to the weekly sets of that week.',
    ],
  },
  tonnage: {
    title: 'Tonnage',
    text: () => [
      `Weight × reps of done normal sets, in kg; from ${n(10000)} kg in t (1 t = ${n(1000)} kg). Single sets and exercises always in kg. Dropsets are shown separately; bodyweight sets count 0 kg.`,
      'By muscle: each exercise’s tonnage goes to its direct muscles, split equally. Routine charts show the last 8 sessions; % = change vs the session before.',
    ],
  },
  records: {
    title: 'Records',
    text: () => [
      'A record beats every earlier session of that exercise: heaviest set, tonnage set, est. 1RM, session tonnage, or reps for bodyweight. Only done normal sets count. The first session sets the mark.',
      'This month compares with the same days last month; the starting point and unfinished workouts are not counted.',
    ],
  },
  metrics: {
    title: 'Progress metrics',
    text: () => [
      'Top set: heaviest done set; more reps wins a tie. Est. 1RM (Epley): weight × (1 + reps / 30). Tonnage: weight × reps of done sets.',
      'Best reps: most reps in one set. Total reps: all done sets. Dropsets never count. Bodyweight exercises progress by reps. Highlighted points are records.',
    ],
  },
  'top-exercises': {
    title: 'Top exercises',
    text: () => [
      'Exercises with the most sessions in the last 8 weeks. Value = latest session’s best est. 1RM, or most reps in a set for bodyweight. % = change vs the first session in those 8 weeks.',
    ],
  },
  progression: {
    title: 'Weight suggestions',
    // v.reason: the session's own reason (first line), e.g. from the chip's ⓘ in a workout
    text: (v) => [
      ...(v.reason ? [v.reason] : []),
      'All target sets at your top weight must reach the target reps (the top of a range like 3 × 6–8); then a chip suggests that weight + the weight step. Lighter warm-up and back-off sets are ignored, dropsets never count, and the starting point never triggers it.',
      'Nothing changes until you tap the chip. Weight step 0 = no suggestions.',
    ],
  },
  starting: {
    title: 'Starting point',
    text: () => [
      'Your current working weight × reps × sets per exercise, plus your best set if it differs. Pre-fills sessions and counts for records.',
      'It is never a workout and never triggers a weight suggestion; that needs a real session.',
    ],
  },
  photo: {
    title: 'Meal photo estimates',
    text: () => [
      'An AI model estimates foods, grams, calories and macros from the photo. These are estimates: check them before adding.',
      `Each analysis is billed to your own provider account; a cancelled request may still be billed. Only the photo (max ${n(PHOTO_LONG_EDGE)} px) and your hint are sent.`,
      'Some providers block browser calls; zero-data-retention organisations cannot call Anthropic from a browser.',
    ],
  },
  camera: {
    title: 'Allow the camera',
    text: () => [
      'iPhone: Settings › Safari › Camera, or the aA menu in the address bar. Android: lock icon in the address bar › Permissions. Then tap Scan again.',
    ],
  },
  expenditure: {
    title: 'Expenditure',
    text: () => [
      'Average kcal / day you burn, including training. From your data: estimated from logged food and the weight trend.',
      `It needs, in the last ${A.windowDays} days, ${A.minWeighIns} weigh-ins and ${A.minLoggedDays} complete days, plus ${A.minSpanDays} days of history and a weigh-in in the last ${A.maxStaleDays} days. Until then: formula (Mifflin-St Jeor × activity) from your profile. Skipped days make it too low.`,
    ],
  },
  checkin: {
    title: 'Weekly check-in',
    text: () => [
      'Each Monday, Trends proposes calorie targets for the week from your expenditure and goal. Accept applies them; Keep current changes nothing.',
      `Changes are capped at ${A.maxWeeklyChange} kcal / week and never go below the calorie floor.`,
    ],
  },
  complete: {
    title: 'Complete days',
    text: () => [
      `Today never counts. A logged day under half of your usual intake (median of logged days within ± ${A.medianDays / 7} weeks) is incomplete, probably not fully logged.`,
      'Incomplete days are left out of averages, on-target days, highest and lowest day, totals and the expenditure estimate. On target = a complete day within ± 10 % of the calorie target.',
    ],
  },
  trend: {
    title: 'Weight trend',
    text: () => [
      'A moving average that smooths out day-to-day water swings. Watch the trend, not single days. Weigh in each morning, after the toilet and before eating.',
      'The trend starts with the second weigh-in. Weekly change compares with the trend at the end of the previous Sunday.',
    ],
  },
  report: {
    title: 'Weekly report',
    text: () => [
      'Weeks run Monday to Sunday; only weeks with something logged are listed. Change = (this − last) / last; – when last week has no value.',
      'Targets come from that week’s check-in. Manual target changes are not recorded, so past weeks may show other targets than you used.',
    ],
  },
  macros: {
    title: 'Macro percentages',
    text: () => [
      'Protein and carbs 4 kcal / g, fat 9 kcal / g. Grams are rounded to whole numbers.',
      'Weekly report splits use complete days only.',
    ],
  },
  'adaptive-macros': {
    title: 'Adaptive macros',
    text: () => [
      'Protein and fat are set in g / kg of trend weight; carbs fill the rest.',
      `Calorie floor: the lowest target ever proposed. Empty = ${n(A.floors.female)} kcal female, ${n(A.floors.male)} male, ${n(A.floors.unknown)} otherwise.`,
      'With a percentage split, check-ins change calories only and these values are not used.',
    ],
  },
  goal: {
    title: 'Weight goal',
    text: () => [
      `Lose up to ${n(-GOAL_RATE_MIN)} kg or gain up to ${n(GOAL_RATE_MAX)} kg / week. The kcal figure is the daily gap to your expenditure this rate needs, at ${n(KCAL_PER_KG)} kcal / kg.`,
      'The weekly check-in uses it to propose targets.',
    ],
  },
  backup: {
    title: 'Backup',
    text: () => [
      'All data lives only in this browser on this device: no account, no cloud, no sync. Export backup regularly and keep the file elsewhere, such as a cloud drive or an e-mail to yourself.',
      `New phone: Export backup here, then Import backup there; it replaces everything. API keys are not in the backup. The app reminds you after ${BACKUP_DUE_DAYS} days.`,
    ],
  },
  storage: {
    title: 'Storage protection',
    text: () => [
      'Protected: the browser will not delete the data on its own; clearing site data or removing the app still does.',
      'Not protected: the browser may delete the data when space runs low. Installing the app and keeping backups help.',
    ],
  },
  'import-weights': {
    title: 'Weight file format',
    text: () => [
      'Dates like 12.11.2026, 2026-11-12, 12/11/26 or Mon 12 Nov. Weights like 82,5 or 82.5, in kg; pounds are not supported.',
      'Columns separated by tab, semicolon, comma or space, in either order. A header row is fine.',
    ],
  },
  'import-workouts': {
    title: 'Workout paste format',
    text: () => [
      'Exercise name on its own line, then 3 × 6 (sets × reps); 3 x 6 also works. Then one line per set: kg, reps. Dropset 5x 80 = 5 reps at 80 kg. A single number = bodyweight reps.',
      'A date line starts a new workout; a line like Push names it. Side-by-side sheets: copy one column group at a time.',
    ],
  },
  // Split library (src/splits/, docs/SPLITS.md): wording from the split-library research, 2026-11-19.
  'split-choose': {
    title: 'Choosing a split',
    text: () => [
      'Pick the number of days you can keep for months. With the same weekly sets, studies find full body, upper / lower and other splits give similar results.',
      'Fewer days: full body. Four: upper / lower. Five or six: hybrid or push / pull / legs. Each muscle about twice a week is a simple default.',
    ],
  },
  'split-run': {
    title: 'Running a split',
    text: () => [
      'Do the sessions in order; Next up shows the one due. Rest a day before training the same muscles again.',
      'All sets at the top of the rep range? Add weight next time; otherwise add a rep. Swap an exercise for one with the same main muscle. Stalled? Take an easy week with half the sets.',
    ],
  },
  'split-sets': {
    title: 'Weekly sets',
    defaults: { ...DEFAULT_VOLUME },
    text: (v) => [
      `Planned sets per muscle in a week. Direct (main mover) counts × ${n(v.primary)}, partial (assists) × ${n(v.secondary)}, as in your log.`,
      'Weekly sets matter most; more tends to add a little more, with shrinking returns. Ranges are general guides, not prescriptions. Add sets only if you recover and keep progressing.',
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
  return { title: s.title, paragraphs: s.text(v) };
}
