// Workout history pasted from a spreadsheet (the owner's sheet layout). Pure, no DOM.
//
// Grammar, one item per line (cells copied from a sheet are tab separated; spaces work too):
//   date line      12.11.2026 | 12.11.26 | 12.11. | 2026-11-12 | 12/11/26 | Mon 12 Nov | 12. November 2026
//                  (may carry the workout name: "12.11.2026 Push", "Push – 12.11.2026")
//   workout name   a text line followed by another text line or a date line ("Push")
//   exercise name  a text line followed by a target, set or dropset line ("Benchpress")
//                  (may carry the target: "Benchpress 3x6")
//   target         3 x 6 | 3x6 | 3 × 6 | 3 x 6-8  (sets x reps, optional rep range) – first line of a block
//   set            "100  7" = weight kg, reps (or reps then weight with the switch); "100 kg x 7";
//                  "82,5 8"; one number = reps of a bodyweight set ("12", "BW 12")
//                  an explicit unit decides which number is the weight, also over the switch:
//                  "80 kg x 8", "8 x 80 kg", "8 reps 80kg", "80kg 8" = 80 kg × 8 reps
//                  one number after sets with an absolute weight in the same exercise ("100" after
//                  "100 7") is listed as "weight without reps?" and left out; after added-weight sets
//                  ("+10 6") or with no weighted sets it stays a bodyweight set
//                  after the target or a set, "80 x 8" is a set (weight x reps), never a second target
//   dropset        Dropset 5x 80 | Drop 5 x 80 | DS 5x80 | Dropset: 5 x 80 kg  (reps x weight, always)
//   header         "kg  reps", "Gewicht Wdh" … ignored
//   blank lines    ignored (they never decide anything)
// Rejected: side-by-side column groups (several exercises or dates next to each other). The whole
// paste is refused with the line numbers, because cells cannot be assigned to the right exercise
// safely; the user pastes one column group at a time. Any other unreadable line is listed with its
// line number and left out.
import { splitLines, findDate, detectDateOrder, parseNumber } from './import-common.js';
import { normaliseTarget } from './workout.js';
import { isValidDate } from './dates.js';

export const MAX_REPS = 200;
export const MAX_WEIGHT = 1000;

const TARGET_RE = /^(\d{1,2})\s*[x×*]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?\s*(?:reps?|wdh\.?)?$/i;
const NAME_TARGET_RE = /^(.*?\p{L}.*?)[\s:–-]+(\d{1,2}\s*[x×*]\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)$/u;
const DROPSET_RE = /^(?:drop\s*-?\s*set|dropsatz|drop|ds)\b\.?\s*[:\-–]?\s*(\d+(?:[.,]\d+)?)\s*(?:reps?|wdh\.?)?\s*(?:[x×*@]|\s)\s*(\+?\d+(?:[.,]\d+)?)\s*(?:kg)?$/i;
const HEADER_WORDS = new Set(['kg', 'weight', 'gewicht', 'reps', 'rep', 'wdh', 'wdh.', 'wiederholungen', 'sets', 'set', 'sätze', 'satz', 'saetze', 'x', 'load', 'last', '/']);

/** Split a raw line into cells: tabs, or runs of 3+ spaces (typed column gaps). */
function cellsOf(raw) {
  return raw.split(/\t| {3,}/).map((c) => c.trim()).filter((c) => c !== '');
}

/**
 * Classify a set-like text: 1 or 2 numbers, optional kg / reps / x / bw words.
 * kg / reps record which number (index into nums) a unit word directly follows.
 * @returns {{nums: string[], bw: boolean, hasX: boolean, kg: number[], reps: number[]}|null}
 */
function setTokens(text) {
  const t = text.toLowerCase().replace(/(\d)\s*(kg|reps?|wdh\.?)(?![a-z])/g, '$1 $2').replace(/[x×*]/g, ' x ').split(/\s+/).filter(Boolean);
  const nums = [];
  const kg = []; const reps = [];
  let bw = false; let hasX = false;
  let prevNum = -1;
  for (const tok of t) {
    if (/^\+?\d+([.,]\d+)?$/.test(tok)) { nums.push(tok); prevNum = nums.length - 1; continue; }
    if (tok === 'x') hasX = true;
    else if (tok === 'kg') { if (prevNum >= 0) kg.push(prevNum); } else if (tok === 'reps' || tok === 'rep' || tok === 'wdh' || tok === 'wdh.') { if (prevNum >= 0) reps.push(prevNum); } else if (tok === '@') { /* unit word */ } else if (tok === 'bw' || tok === 'kg-bw' || tok === 'körpergewicht' || tok === 'bodyweight') bw = true;
    else return null;
    prevNum = -1;
  }
  if (!nums.length || nums.length > 2) return null;
  return { nums, bw, hasX, kg, reps };
}

/**
 * Classify one line on its own (context is applied later).
 * @param {string} raw
 * @param {{order: 'dmy'|'mdy', today: string}} dateOpts
 */
export function classifyLine(raw, dateOpts) {
  const cells = cellsOf(String(raw ?? ''));
  if (!cells.length) return { kind: 'blank' };
  const text = cells.join(' ');

  // Several column groups side by side?
  const letterCells = cells.filter((c) => /\p{L}/u.test(c) && !DROPSET_RE.test(c) && !findDate(c, dateOpts) && !HEADER_WORDS.has(c.toLowerCase()));
  const numberCount = (text.match(/\d+(?:[.,]\d+)?/g) || []).length;

  if (HEADER_WORDS.has(text.toLowerCase()) || text.toLowerCase().split(/[\s/]+/).every((w) => HEADER_WORDS.has(w))) return { kind: 'header', text };

  const drop = DROPSET_RE.exec(text);
  if (drop) return { kind: 'dropset', text, reps: drop[1], weight: drop[2] };
  if (/^(?:drop\s*-?\s*set|dropsatz|drop|ds)\b/i.test(text) && /\d/.test(text)) return { kind: 'unknown', text, message: 'Dropset needs reps and weight, e.g. "Dropset 5x 80"' };

  const tgt = TARGET_RE.exec(text);
  if (tgt) return { kind: 'target', text, sets: +tgt[1], reps: +tgt[2], repsMax: tgt[3] ? +tgt[3] : null, setLike: !tgt[3] ? { a: tgt[1], b: tgt[2] } : null };

  const st = setTokens(text);
  if (st) return { kind: 'set', text, nums: st.nums, bw: st.bw, kg: st.kg, reps: st.reps };

  const d = findDate(text, dateOpts);
  if (d) {
    const rest = (text.slice(0, d.start) + ' ' + text.slice(d.end)).replace(/^[\s,;:|–—-]+|[\s,;:|–—-]+$/g, '').replace(/\s+/g, ' ');
    if (!rest || (/\p{L}/u.test(rest) && !/\d/.test(rest))) {
      if (letterCells.length > 1) return { kind: 'multi', text };
      return { kind: 'date', text, date: d.date, error: d.error, ambiguous: d.ambiguous, weekdayMismatch: d.weekdayMismatch, name: rest || null };
    }
    if (d.date && cells.length > 2) return { kind: 'multi', text };
  }

  if (letterCells.length >= 2) return { kind: 'multi', text };
  if (numberCount >= 3 && !/\p{L}/u.test(text)) return { kind: 'multi', text };
  if (cells.length >= 2 && cells.some((c) => TARGET_RE.test(c)) && cells.filter((c) => TARGET_RE.test(c) || DROPSET_RE.test(c)).length >= 2) return { kind: 'multi', text };

  if (/^[+\d]/.test(text) && numberCount >= 2) return { kind: 'unknown', text };
  if (/\p{L}/u.test(text)) {
    const nt = NAME_TARGET_RE.exec(text);
    if (nt && !/\d/.test(nt[1].replace(/\d+(?=\s*\p{L})/gu, ''))) {
      const t2 = TARGET_RE.exec(nt[2]);
      if (t2) return { kind: 'name', text, name: nt[1].trim(), target: { sets: +t2[1], reps: +t2[2], repsMax: t2[3] ? +t2[3] : null } };
    }
    if (cells.length >= 2 && cells.slice(1).some((c) => /\d/.test(c))) return { kind: 'unknown', text };
    return { kind: 'name', text, name: text.replace(/[:]+$/, '').trim(), target: null };
  }
  return { kind: 'unknown', text };
}

/**
 * Read a set from numbers.
 * @returns {{ok: true, set: {weight: number|null, reps: number}}|{ok: false, error: string}}
 */
function readSet(nums, bw, repsFirst, units = {}) {
  const kg = units.kg || []; const reps = units.reps || [];
  if (nums.length === 1 || bw) {
    if (nums.length !== 1) return { ok: false, error: 'Bodyweight set with two numbers' };
    if (kg.length && !bw) return { ok: false, error: `Weight without reps? "${nums[0]} kg" has no reps. Write weight and reps, e.g. "${nums[0]} kg x 8"` };
    return checkSet(null, parseNumber(nums[0]));
  }
  const a = parseNumber(nums[0]);
  const b = parseNumber(nums[1]);
  if (kg.length > 1 || reps.length > 1 || (kg.length && reps.length && kg[0] === reps[0])) return { ok: false, error: 'Both numbers carry the same unit (kg or reps); which one is the weight?' };
  // An explicit unit decides; without one the column order (and the switch) does.
  const weightIdx = kg.length ? kg[0] : reps.length ? 1 - reps[0] : repsFirst ? 1 : 0;
  return weightIdx === 0 ? checkSet(a, b) : checkSet(b, a);
}

function checkSet(weight, reps) {
  if (reps === null || !Number.isInteger(reps)) return { ok: false, error: `Reps must be a whole number${reps !== null ? ` (got ${reps})` : ''}. Is the column order right?` };
  if (reps < 1 || reps > MAX_REPS) return { ok: false, error: `Reps ${reps} is outside 1–${MAX_REPS}` };
  if (weight !== null && (weight < 0 || weight > MAX_WEIGHT)) return { ok: false, error: `Weight ${weight} kg is outside 0–${MAX_WEIGHT} kg` };
  return { ok: true, set: { weight: weight === 0 ? null : weight, reps } };
}

/**
 * Parse a pasted workout sheet.
 * @param {string} text
 * @param {{today: string, repsFirst?: boolean, dateOrder?: 'auto'|'dmy'|'mdy'}} opts
 *   repsFirst: two-number rows are "reps weight" instead of "weight reps"
 * @returns {{workouts: ParsedWorkout[], issues: Issue[], fatal: string|null, dateOrder: 'dmy'|'mdy',
 *   dateOrderAmbiguous: boolean, lineCount: number}}
 *
 * @typedef {{line: number, text: string, message: string, level: 'error'|'warning'|'info'}} Issue
 * @typedef {{index: number, line: number, date: string|null, dateLine: number|null, name: string|null,
 *   exercises: ParsedExercise[]}} ParsedWorkout
 * @typedef {{name: string, line: number, target: {sets: number, reps: number, repsMax: number|null}|null,
 *   sets: {weight: number|null, reps: number, type: 'normal'|'dropset', line: number}[]}} ParsedExercise
 */
export function parseWorkoutText(text, { today, repsFirst = false, dateOrder = 'auto' } = {}) {
  const lines = splitLines(text);
  const det = dateOrder === 'auto' ? detectDateOrder(lines) : { order: dateOrder, ambiguous: false };
  const dateOpts = { order: det.order, today };
  const cls = lines.map((l) => classifyLine(l, dateOpts));
  return assemble(lines, cls, { repsFirst, today, dateOrder: det.order, dateOrderAmbiguous: det.ambiguous });
}

/**
 * Second pass: turn classified lines into workouts (exported for chunked parsing).
 * @param {string[]} lines
 * @param {ReturnType<typeof classifyLine>[]} cls
 */
export function assemble(lines, cls, { repsFirst = false, today, dateOrder = 'dmy', dateOrderAmbiguous = false }) {
  /** @type {Issue[]} */
  const issues = [];
  /** @type {ParsedWorkout[]} */
  const workouts = [];
  let cur = null;
  let ex = null;
  const issue = (i, message, level = 'error') => issues.push({ line: i + 1, text: lines[i], message, level });

  const multi = [];
  cls.forEach((c, i) => { if (c.kind === 'multi') multi.push(i + 1); });
  if (multi.length) {
    for (const n of multi.slice(0, 20)) issue(n - 1, 'Several columns side by side');
    return {
      workouts: [], issues, dateOrder, dateOrderAmbiguous, lineCount: lines.length,
      fatal: `This looks like several column groups side by side (line${multi.length > 1 ? 's' : ''} ${multi.slice(0, 8).join(', ')}${multi.length > 8 ? ', …' : ''}). `
        + 'Copy one column group at a time (one exercise or one date column with its weight and reps columns), import it, then copy the next one.',
    };
  }

  const nextSignificant = (i) => {
    for (let j = i + 1; j < cls.length; j++) if (cls[j].kind !== 'blank' && cls[j].kind !== 'header') return cls[j];
    return null;
  };
  const newWorkout = (i) => {
    cur = { index: workouts.length, line: i + 1, date: null, dateLine: null, name: null, exercises: [] };
    workouts.push(cur);
    ex = null;
    return cur;
  };
  // Per exercise: has a normal set with an absolute weight ("100 7") / with added weight ("+10 6").
  const loaded = new WeakMap();
  const pushSet = (i, nums, bw, type, units) => {
    const st = loaded.get(ex) || { abs: false, added: false };
    if (type === 'normal' && nums.length === 1 && !bw && !(units && units.kg && units.kg.length) && st.abs && !st.added) {
      issue(i, `Weight without reps? "${nums[0]}" follows sets with a weight in this exercise, so it is not read as ${nums[0]} bodyweight reps. Write weight and reps ("${nums[0]} 8"), or "BW ${nums[0]}" for a bodyweight set`);
      return;
    }
    const r = readSet(nums, bw, type === 'normal' ? repsFirst : false, units);
    if (!r.ok) { issue(i, r.error); return; }
    ex.sets.push({ weight: r.set.weight, reps: r.set.reps, type, line: i + 1 });
    if (type === 'normal' && r.set.weight !== null) {
      if (nums.some((n) => n.startsWith('+'))) st.added = true; else st.abs = true;
      loaded.set(ex, st);
    }
  };

  cls.forEach((c, i) => {
    switch (c.kind) {
      case 'blank': return;
      case 'header': issue(i, 'Column header, ignored', 'info'); return;
      case 'date': {
        if (c.error || !c.date) { issue(i, `${c.error || 'Not a valid date'}`); return; }
        if (!cur || cur.exercises.length || cur.date) newWorkout(i);
        cur.date = c.date;
        cur.dateLine = i + 1;
        if (c.name) cur.name = c.name;
        if (c.weekdayMismatch) issue(i, `The weekday does not match ${c.date}; the date is used`, 'warning');
        if (c.date > today) issue(i, `${c.date} is in the future`, 'error');
        return;
      }
      case 'name': {
        const next = nextSignificant(i);
        const nextKind = next ? next.kind : null;
        if (c.target || nextKind === 'target' || nextKind === 'set' || nextKind === 'dropset') {
          if (!cur) newWorkout(i);
          ex = { name: c.name, line: i + 1, target: c.target || null, sets: [] };
          cur.exercises.push(ex);
          return;
        }
        if (nextKind === 'name' || nextKind === 'date') {
          // A workout title: names the empty workout being started, else starts the next workout.
          if (cur && !cur.exercises.length && !cur.name) { cur.name = c.name; ex = null; return; }
          if (cur && !cur.exercises.length && nextKind === 'date') { cur.name = c.name; return; }
          newWorkout(i).name = c.name;
          return;
        }
        issue(i, next ? 'Text without sets below it, ignored' : 'Exercise name with no sets below it, ignored', 'warning');
        return;
      }
      case 'target': {
        if (!ex) { issue(i, 'Sets x reps line without an exercise name above it'); return; }
        if (!ex.target && !ex.sets.length && (c.sets <= 10 || !c.setLike)) { ex.target = { sets: c.sets, reps: c.reps, repsMax: c.repsMax }; return; }
        if (c.setLike) { pushSet(i, [c.setLike.a, c.setLike.b], false, 'normal'); return; }
        issue(i, 'A second sets x reps line in the same exercise');
        return;
      }
      case 'set': {
        if (!ex) { issue(i, 'Numbers without an exercise name above them'); return; }
        pushSet(i, c.nums, c.bw, 'normal', { kg: c.kg, reps: c.reps });
        return;
      }
      case 'dropset': {
        if (!ex) { issue(i, 'Dropset without an exercise name above it'); return; }
        pushSet(i, [c.weight, c.reps], false, 'dropset'); // dropset lines are always reps x weight
        return;
      }
      default:
        issue(i, c.message || 'Could not read this line');
    }
  });

  // Drop empty exercises/workouts, with a note.
  for (const w of workouts) {
    w.exercises = w.exercises.filter((e) => {
      if (e.sets.length) return true;
      if (!issues.some((x) => x.line === e.line)) issues.push({ line: e.line, text: lines[e.line - 1], message: 'Exercise without readable sets, left out', level: 'warning' });
      return false;
    });
  }
  const kept = workouts.filter((w) => w.exercises.length);
  kept.forEach((w, k) => { w.index = k; });
  issues.sort((a, b) => a.line - b.line);
  return { workouts: kept, issues, fatal: null, dateOrder, dateOrderAmbiguous, lineCount: lines.length };
}

/** Exercise names in a parse result, unique by normalised text, in order of appearance. */
export function exerciseNames(parsed) {
  const seen = new Map();
  for (const w of parsed.workouts) for (const e of w.exercises) if (!seen.has(e.name.toLowerCase())) seen.set(e.name.toLowerCase(), e.name);
  return [...seen.values()];
}

const HOUR = 3600000;

/**
 * Start/finish times for imported workouts: 18:00 local on the date (the 2nd workout of a day at
 * 20:00, …), 60 minutes long; on today never after `now`.
 * @returns {{startedAt: number, finishedAt: number}}
 */
export function plausibleTimes(date, k, now) {
  const [y, m, d] = date.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const nextDay = new Date(y, m - 1, d + 1).getTime();
  let start = new Date(y, m - 1, d, 18 + 2 * Math.min(k, 2), 0).getTime();
  let end = start + HOUR;
  if (end > now) {
    end = Math.max(dayStart + 2, Math.min(now, nextDay - 1));
    start = Math.max(dayStart, end - HOUR);
  }
  return { startedAt: start, finishedAt: end };
}

/**
 * Workout records (SPEC §3) from a parse result. Pure: ids and time are passed in.
 * @param {ParsedWorkout[]} workouts
 * @param {{dates: string[], exerciseIds: Record<string, string>, importId: string, now: number,
 *   newId: () => string}} opts dates[i] for workouts[i]; exerciseIds keyed by exercise name as parsed
 * @returns {object[]} finished workouts with done sets, tagged with importId
 */
export function buildWorkoutRecords(workouts, { dates, exerciseIds, importId, now, newId }) {
  const perDay = new Map();
  return workouts.map((w, i) => {
    const date = dates[i];
    if (!isValidDate(date)) throw new Error(`Workout ${i + 1} has no valid date`);
    const k = perDay.get(date) || 0;
    perDay.set(date, k + 1);
    const { startedAt, finishedAt } = plausibleTimes(date, k, now);
    const exercises = w.exercises.map((e) => {
      const exerciseId = exerciseIds[e.name];
      if (!exerciseId) throw new Error(`No exercise chosen for "${e.name}"`);
      const normal = e.sets.filter((s) => s.type === 'normal').length;
      const t = normaliseTarget(e.target
        ? { targetSets: e.target.sets, targetReps: e.target.reps, targetRepsMax: e.target.repsMax, targetWeight: null }
        : { targetSets: Math.max(1, normal), targetReps: null, targetRepsMax: null, targetWeight: null });
      return {
        exerciseId, ...t,
        sets: e.sets.map((s) => ({ weight: s.weight, reps: s.reps, type: s.type, done: true })),
        note: '',
      };
    });
    return {
      id: newId(), date, routineId: null, name: w.name || 'Workout', startedAt, finishedAt,
      exercises, createdAt: now, updatedAt: now, importId,
    };
  });
}
