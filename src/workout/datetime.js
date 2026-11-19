// Date/time sheets: change the date/time of a workout, and log a past workout.
// The rules (no future, duration kept, date follows the start time) live in src/core/workout.js.
import { el, openSheet, numberInput, field, fmtDuration } from '../ui/index.js';
import { today, addDays } from '../core/dates.js';
import { rescheduleWorkout, timeOfDay, MAX_DURATION_MIN, DEFAULT_PAST_DURATION_MS } from '../core/workout.js';
import { startWorkout } from './data.js';

const dateInput = (value) => el('input', { class: 'input', type: 'date', value, max: today(), required: true, 'aria-label': 'Date' });
const timeInput = (value) => el('input', { class: 'input', type: 'time', value, required: true, 'aria-label': 'Start time' });

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
  const dur = numberInput({ value: curMin, min: 1, max: MAX_DURATION_MIN, integer: true, placeholder: finished ? '' : 'optional', ariaLabel: 'Duration in minutes' });
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const s = openSheet({
    title: 'Change date, time, duration',
    content: [
      el('div', { class: 'grid-2' }, field('Date', date), field('Start time', time)),
      field('Duration', dur, {
        unit: 'min',
        hint: finished
          ? 'The weekly sets, recovery, history and progress follow the new date.'
          : 'Leave empty while you are training: Finish then records the time you tap it. Set it for a workout done earlier.',
      }),
      err,
    ],
  });
  s.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => s.close(null) }, 'Cancel'),
    el('button', {
      type: 'button', class: 'btn btn-primary', onClick: () => {
        const n = dur.getNumber();
        if (finished && n === null) { show('Enter the duration in minutes.'); return; }
        const r = rescheduleWorkout(workout, { date: date.value, time: time.value, durationMin: n }, Date.now());
        if (!r.ok) { show(r.error); return; }
        s.close(r.value);
      },
    }, 'Save'));
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
  const dur = numberInput({ value: DEFAULT_PAST_DURATION_MS / 60000, min: 1, max: MAX_DURATION_MIN, integer: true, ariaLabel: 'Duration in minutes' });
  const routine = el('select', { class: 'select', 'aria-label': 'Routine' },
    el('option', { value: '' }, 'Empty workout'),
    ...routines.map((r) => el('option', { value: r.id }, r.name)));
  const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const s = openSheet({
    title: 'Log a past workout',
    content: [
      el('div', { class: 'grid-2' }, field('Date', date), field('Start time', time)),
      field('Duration', dur, { unit: 'min' }),
      field('Routine', routine),
      err,
    ],
  });
  s.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => s.close(null) }, 'Cancel'),
    el('button', {
      type: 'button', class: 'btn btn-primary', onClick: async () => {
        const past = { date: date.value, time: time.value, durationMin: dur.getNumber() };
        if (past.durationMin === null) { show('Enter the duration in minutes.'); return; }
        const check = rescheduleWorkout({ finishedAt: null }, past, Date.now());
        if (!check.ok) { show(check.error); return; }
        s.close(null);
        await startWorkout(routines.find((r) => r.id === routine.value) || null, past);
      },
    }, 'Log sets'));
  function show(msg) { err.textContent = msg; err.hidden = false; }
}

/** 'Mon 9 Nov · 18:00 · 1 h 00 min' style summary for a toast. */
export function scheduleWords(w, fmtDate) {
  const dur = w.finishedAt ? ` · ${fmtDuration(w.finishedAt - w.startedAt)}` : '';
  return `${fmtDate(w.date)} · ${timeOfDay(w.startedAt)}${dur}`;
}
