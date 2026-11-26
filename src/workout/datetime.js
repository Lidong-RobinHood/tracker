// Date/time sheets: change the date/time of a workout, and log a past workout.
// The rules (no future, duration kept, date follows the start time) live in src/core/workout.js.
import { el, append, openSheet, numberInput, field, fmtDuration } from '../ui/index.js';
import { today, addDays } from '../core/dates.js';
import { rescheduleWorkout, timeOfDay, MAX_DURATION_MIN, DEFAULT_PAST_DURATION_MS } from '../core/workout.js';
import { startWorkout } from './data.js';
import { t } from '../i18n/index.js';
import { routineName } from '../i18n/names.js';

const dateInput = (value) => el('input', { class: 'input', type: 'date', value, max: today(), required: true, 'aria-label': t('workout.time.date') });
const timeInput = (value) => el('input', { class: 'input', type: 'time', value, required: true, 'aria-label': t('workout.time.start') });

/**
 * Ask for a new date / start time (and duration) of `workout`.
 * Finished: duration is required (prefilled with the current one) and kept when unchanged.
 * Unfinished: duration is optional; when set, Finish uses it instead of the time Finish is tapped.
 * @param {object} workout not changed here
 * @returns {Promise<ReturnType<typeof rescheduleWorkout>['value']|null>} null when cancelled
 */
export function changeDateTime(workout) {
  const finished = !!workout.finishedAt;
  const date = dateInput(workout.date);
  const time = timeInput(timeOfDay(workout.startedAt || Date.now()));
  const curMin = finished
    ? Math.max(1, Math.round((workout.finishedAt - workout.startedAt) / 60000))
    : workout.plannedDurationMs ? Math.round(workout.plannedDurationMs / 60000) : null;
  const dur = numberInput({ value: curMin, min: 1, max: MAX_DURATION_MIN, integer: true, placeholder: finished ? '' : t('workout.time.optional'), ariaLabel: t('workout.time.durationAria') });
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const s = openSheet({
    title: t('workout.time.changeTitle'),
    content: [
      el('div', { class: 'grid-2' }, field(t('workout.time.date'), date), field(t('workout.time.start'), time)),
      field(t('workout.time.duration'), dur, { unit: 'min', hint: finished ? null : t('workout.time.durationHint') }),
      err,
    ],
  });
  append(s.footer, 
    el('button', { type: 'button', class: 'btn', onClick: () => s.close(null) }, t('workout.action.cancel')),
    el('button', {
      type: 'button', class: 'btn btn-primary', onClick: () => {
        const n = dur.getNumber();
        if (finished && n === null) { show(t('workout.time.errDuration')); return; }
        const r = rescheduleWorkout(workout, { date: date.value, time: time.value, durationMin: n }, Date.now());
        if (!r.ok) { show(t(r.error, r.params)); return; }
        s.close(r.value);
      },
    }, t('workout.action.save')));
  function show(msg) { err.textContent = msg; err.hidden = false; }
  return s.closed.then((v) => v || null);
}

/**
 * "Log a past workout": date, start time, duration and (optionally) a routine; opens the normal
 * session screen for that date.
 * @param {object[]} routines
 */
export function logPastWorkout(routines) {
  const date = dateInput(addDays(today(), -1));
  const time = timeInput('18:00');
  const dur = numberInput({ value: DEFAULT_PAST_DURATION_MS / 60000, min: 1, max: MAX_DURATION_MIN, integer: true, ariaLabel: t('workout.time.durationAria') });
  const routine = el('select', { class: 'select', 'aria-label': t('workout.time.routine') },
    el('option', { value: '' }, t('workout.start.empty')),
    ...routines.map((r) => el('option', { value: r.id }, routineName(r))));
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const s = openSheet({
    title: t('workout.start.logPast'),
    content: [
      el('div', { class: 'grid-2' }, field(t('workout.time.date'), date), field(t('workout.time.start'), time)),
      field(t('workout.time.duration'), dur, { unit: 'min' }),
      field(t('workout.time.routine'), routine),
      err,
    ],
  });
  append(s.footer, 
    el('button', { type: 'button', class: 'btn', onClick: () => s.close(null) }, t('workout.action.cancel')),
    el('button', {
      type: 'button', class: 'btn btn-primary', onClick: async () => {
        const past = { date: date.value, time: time.value, durationMin: dur.getNumber() };
        if (past.durationMin === null) { show(t('workout.time.errDuration')); return; }
        const check = rescheduleWorkout({ finishedAt: null }, past, Date.now());
        if (!check.ok) { show(t(check.error, check.params)); return; }
        s.close(null);
        await startWorkout(routines.find((r) => r.id === routine.value) || null, past);
      },
    }, t('workout.time.logSets')));
  function show(msg) { err.textContent = msg; err.hidden = false; }
}

/** 'Mon 9 Nov · 18:00 · 1 h 00 min' style summary for a toast. */
export function scheduleWords(w, fmtDate) {
  const dur = w.finishedAt ? ` · ${fmtDuration(w.finishedAt - w.startedAt)}` : '';
  return `${fmtDate(w.date)} · ${timeOfDay(w.startedAt)}${dur}`;
}
