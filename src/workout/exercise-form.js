// Exercise editor form (library detail, "new exercise", and inline create from the picker).
import * as db from '../db/db.js';
import { el, replaceChildren, field, numberInput, fmtNum } from '../ui/index.js';
import { volumeWeights } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import { DEFAULT_INCREMENT } from '../data/exercises.js';
import { parseVideoUrl } from '../core/exercise-video.js';
import { musclesBlock } from './muscle-map.js';

export const EQUIPMENT = [
  ['barbell', 'Barbell'], ['dumbbell', 'Dumbbell'], ['machine', 'Machine'],
  ['cable', 'Cable'], ['bodyweight', 'Bodyweight'], ['other', 'Other'],
];

/**
 * @param {object} [initial] exercise or partial ({ name })
 * @param {{compact?: boolean, preview?: boolean, onMuscles?: (primary: string[], secondary: string[]) => void}} [opts]
 *   compact: hide notes and tutorial link (picker); preview: a small body map of the chosen muscles
 *   above the muscle chips; onMuscles: runs after every change of the direct / partial muscles
 * @returns {{node: HTMLElement, read: () => {ok: true, value: object}|{ok: false, error: string}, focusName: () => void}}
 */
export function exerciseForm(initial = {}, { compact = false, preview = false, onMuscles = null } = {}) {
  const primary = new Set(initial.primary || []);
  const secondary = new Set(initial.secondary || []);
  let incrementEdited = initial.increment !== undefined;

  const name = el('input', { class: 'input', type: 'text', value: initial.name || '', autocomplete: 'off', maxlength: '80' });
  const equipment = el('select', { class: 'select' },
    EQUIPMENT.map(([v, label]) => el('option', { value: v, selected: v === (initial.equipment || 'barbell') }, label)));
  const increment = numberInput({
    value: initial.increment ?? DEFAULT_INCREMENT[initial.equipment || 'barbell'],
    min: 0, max: 50, ariaLabel: 'Weight step', onInput: () => { incrementEdited = true; },
  });
  equipment.addEventListener('change', () => {
    if (!incrementEdited) increment.setNumber(DEFAULT_INCREMENT[equipment.value] ?? 2.5);
  });
  const notes = el('textarea', { class: 'textarea', rows: '2', value: initial.notes || '' });
  const videoUrl = el('input', {
    class: 'input', type: 'url', inputmode: 'url', value: initial.videoUrl || '', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', maxlength: '2000', placeholder: 'https://youtu.be/…',
  });
  const videoField = field('Tutorial link', videoUrl, { hint: 'Empty = default video.' });
  videoUrl.addEventListener('input', () => { videoField.classList.remove('is-missing'); videoUrl.removeAttribute('aria-invalid'); });

  const primaryChips = el('div', { class: 'chips' });
  const secondaryChips = el('div', { class: 'chips' });
  const order = (set) => MUSCLES.map((m) => m.id).filter((id) => set.has(id));
  const previewBlock = preview ? musclesBlock({ primary: order(primary), secondary: order(secondary), small: true }) : null;
  const renderChips = () => {
    replaceChildren(primaryChips, ...MUSCLES.map((m) => chip(m, primary, secondary)));
    replaceChildren(secondaryChips, ...MUSCLES.map((m) => chip(m, secondary, primary)));
  };
  const changed = () => {
    renderChips();
    if (previewBlock) previewBlock.update(order(primary), order(secondary));
    if (onMuscles) onMuscles(order(primary), order(secondary));
  };
  // Selecting a muscle in one group removes it from the other.
  const chip = (m, set, other) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': set.has(m.id) ? 'true' : 'false',
    onClick: () => {
      if (set.has(m.id)) set.delete(m.id);
      else { set.add(m.id); other.delete(m.id); }
      changed();
    },
  }, m.name);
  renderChips();

  // Labels show the user's own set weighting: 'Direct muscles · × 1', 'Partial muscles · × 0.5'.
  const directLabel = el('div', { class: 'field-label' }, 'Direct muscles');
  const partialLabel = el('div', { class: 'field-label' }, 'Partial muscles');
  db.getSetting('volume').then((raw) => {
    const w = volumeWeights(raw);
    directLabel.textContent = `Direct muscles · × ${fmtNum(w.primary, 2)}`;
    partialLabel.textContent = `Partial muscles · × ${fmtNum(w.secondary, 2)}`;
  }).catch((err) => console.error(err));
  const primaryField = el('div', { class: 'field' }, directLabel, primaryChips);
  const node = el('div', { class: 'stack' },
    field('Name', name),
    previewBlock ? previewBlock.node : null,
    primaryField,
    el('div', { class: 'field' }, partialLabel, secondaryChips),
    el('div', { class: 'grid-2' },
      field('Equipment', equipment),
      field('Weight step', increment, { unit: 'kg', hint: '0 = no suggestions', info: 'progression' })),
    compact ? null : field('Notes', notes),
    compact ? null : videoField);

  return {
    node,
    focusName: () => name.focus(),
    read() {
      const n = name.value.trim();
      primaryField.classList.remove('is-missing');
      if (!n) { name.focus(); return { ok: false, error: 'Enter a name.' }; }
      if (!primary.size) { primaryField.classList.add('is-missing'); return { ok: false, error: 'Pick at least one direct muscle.' }; }
      const inc = increment.getNumber();
      if (inc === null) { increment.focus(); return { ok: false, error: 'Enter a weight step from 0 to 50 kg.' }; }
      const video = parseVideoUrl(compact ? initial.videoUrl : videoUrl.value);
      videoField.classList.toggle('is-missing', !video.ok);
      if (!video.ok) { videoUrl.setAttribute('aria-invalid', 'true'); videoUrl.focus(); return { ok: false, error: `Tutorial link: ${video.error}` }; }
      return {
        ok: true,
        value: { name: n, primary: order(primary), secondary: order(secondary), equipment: equipment.value, increment: inc, notes: notes.value.trim(), videoUrl: video.value },
      };
    },
  };
}
