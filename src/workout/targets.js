// Weekly set targets per muscle (optional). Stored as setting 'volumeTargets' ({ muscleId: sets }).
// Route: workout/targets
import * as db from '../db/db.js';
import { el, pageHeader, numberInput, toast, fmtNum, confirmDialog } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { today } from '../core/dates.js';
import { weeklyComparison, sanitiseTargets, targetProgress, MAX_WEEKLY_TARGET } from '../core/volume.js';
import { ensureCss, loadExercises, loadWorkouts } from './data.js';

export const TARGETS_KEY = 'volumeTargets';

/** @returns {Promise<Record<string, number>>} cleaned targets ({} when never set) */
export async function loadTargets() {
  return sanitiseTargets(await db.getSetting(TARGETS_KEY));
}

export async function mountTargets(container) {
  ensureCss();
  const [workouts, exMap, weights, targets] = await Promise.all([
    loadWorkouts(), loadExercises(), db.getSetting('volume'), loadTargets(),
  ]);
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const done = Object.fromEntries(cmp.rows.map((r) => [r.muscle, r.current]));

  let chain = Promise.resolve();
  const persist = () => {
    const value = sanitiseTargets(targets);
    chain = chain.then(() => db.setSetting(TARGETS_KEY, value))
      .catch((err) => { console.error(err); toast(`Could not save: ${err && err.message}`, { type: 'error' }); });
    return chain;
  };

  const inputs = [];
  const rows = MUSCLES.map((m) => {
    const pctEl = el('span', { class: 'wk-tg-pct num small' });
    const fill = el('span', { class: 'wk-vol-fill' });
    const bar = el('span', { class: 'wk-vol-bar', 'aria-hidden': 'true' }, fill);
    const paint = () => {
      const tp = targetProgress(done[m.id] || 0, targets[m.id]);
      bar.hidden = !tp;
      fill.style.width = tp ? `${tp.fraction * 100}%` : '0';
      fill.classList.toggle('is-reached', !!(tp && tp.reached));
      pctEl.textContent = tp ? `${tp.reached ? '✓ ' : ''}${tp.pct} %` : '';
      pctEl.classList.toggle('text-success', !!(tp && tp.reached));
    };
    const input = numberInput({
      value: targets[m.id] ?? null, min: 0, max: MAX_WEEKLY_TARGET, decimals: 1, placeholder: '–', class: 'wk-tg-in',
      ariaLabel: `${m.name} weekly set target`,
      onInput: (v) => {
        if (v === null || v === 0) delete targets[m.id]; else targets[m.id] = v;
        paint(); persist();
      },
    });
    input.addEventListener('change', () => input.setNumber(targets[m.id] ?? null));
    inputs.push([m.id, input, paint]);
    paint();
    return el('div', { class: 'wk-tg-row' },
      el('div', { class: 'wk-tg-main' },
        el('div', { class: 'wk-tg-name' }, m.name),
        el('div', { class: 'small muted num' }, `${fmtNum(done[m.id] || 0, 2)} this week`, ' ', pctEl),
        bar),
      input);
  });

  const clearAll = async () => {
    if (!Object.keys(targets).length) return;
    const ok = await confirmDialog({ title: 'Clear all targets?', message: 'Weekly set targets for every muscle are removed.', confirmLabel: 'Clear' });
    if (!ok) return;
    for (const k of Object.keys(targets)) delete targets[k];
    for (const [, input, paint] of inputs) { input.setNumber(null); paint(); }
    await persist();
    toast('Targets cleared');
  };

  container.append(
    pageHeader({ title: 'Weekly set targets', subtitle: 'Saved automatically', back: 'workout' }),
    el('p', { class: 'small muted wk-pad-x' },
      `Optional sets per week for each muscle (e.g. Chest 12). Sets are counted like the weekly list: a ticked normal set adds ${fmtNum(weights.primary, 2)} to each primary and ${fmtNum(weights.secondary, 2)} to each secondary muscle; a dropset adds ${fmtNum(weights.dropset, 2)} × that. Leave empty for no target.`),
    el('div', { class: 'card wk-tg-card' }, rows),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: clearAll }, 'Clear all targets'));

  return () => { persist(); };
}
