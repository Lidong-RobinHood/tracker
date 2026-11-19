// Weekly set targets per muscle (optional). Stored as setting 'volumeTargets' ({ muscleId: sets }).
// Route: workout/targets
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, numberInput, toast, fmtNum, icon } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { today } from '../core/dates.js';
import { weeklyComparison, weeklyBreakdown, sanitiseTargets, targetProgress, MAX_WEEKLY_TARGET, volumeWeights } from '../core/volume.js';
import { breakdownText, setsBar, withSetsInfo } from './volume-ui.js';
import { ensureCss, loadExercises, loadWorkouts, confirmAction } from './data.js';

export const TARGETS_KEY = 'volumeTargets';

/** @returns {Promise<Record<string, number>>} cleaned targets ({} when never set) */
export async function loadTargets() {
  return sanitiseTargets(await db.getSetting(TARGETS_KEY));
}

export async function mountTargets(container) {
  ensureCss();
  const [workouts, exMap, rawWeights, targets] = await Promise.all([
    loadWorkouts(), loadExercises(), db.getSetting('volume'), loadTargets(),
  ]);
  const weights = volumeWeights(rawWeights);
  const cmp = weeklyComparison(workouts, exMap, weights, today());
  const parts = weeklyBreakdown(workouts, exMap, weights, today());
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
    const pctEl = el('span', { class: 'wk-tg-pct' });
    const bar = el('div', { class: 'wk-tg-bar' });
    const paint = () => {
      const tp = targetProgress(done[m.id] || 0, targets[m.id]);
      bar.hidden = !tp;
      replaceChildren(bar, setsBar(parts[m.id], tp ? tp.fraction : 0, { target: true }));
      replaceChildren(pctEl, tp ? [' · ', tp.reached ? icon('check', { size: 14 }) : null, `${tp.pct}\u202f%`] : null);
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
        el('div', { class: 't-sub muted' }, `${fmtNum(done[m.id] || 0, 2)} this week`, pctEl),
        parts[m.id] ? el('div', { class: 't-sub muted' }, breakdownText(parts[m.id], weights)) : null,
        bar),
      input);
  });

  const clearAll = async () => {
    if (!Object.keys(targets).length) return;
    const ok = await confirmAction({ title: 'Clear all targets?', message: 'All muscle targets are removed.', confirmLabel: 'Clear' });
    if (!ok) return;
    for (const k of Object.keys(targets)) delete targets[k];
    for (const [, input, paint] of inputs) { input.setNumber(null); paint(); }
    await persist();
    toast('Targets cleared');
  };

  append(container, 
    withSetsInfo(pageHeader({ title: 'Weekly set targets', subtitle: 'Saved automatically', back: 'workout' }), weights),
    el('p', { class: 'field-hint wk-pad-x' }, 'Sets per week. Empty = no target.'),
    el('div', { class: 'card wk-tg-card' }, rows),
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: clearAll }, 'Clear all targets'));

  return () => { persist(); };
}
