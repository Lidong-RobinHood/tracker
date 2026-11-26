// Exercise editor form (library detail, "new exercise", and inline create from the picker).
import * as db from '../db/db.js';
import { el, replaceChildren, field, numberInput, fmtNum } from '../ui/index.js';
import { volumeWeights } from '../core/volume.js';
import { MUSCLES } from '../core/muscles.js';
import { DEFAULT_INCREMENT } from '../data/exercises.js';
import { parseVideoUrl } from '../core/exercise-video.js';
import { musclesBlock } from './muscle-map.js';
import { EQUIPMENT_IDS, equipmentName } from './data.js';
import { t } from '../i18n/index.js';
import { muscleName } from '../i18n/names.js';

/**
 * @param {object} [initial] exercise or partial ({ name })
 * @param {{compact?: boolean, preview?: boolean, onMuscles?: (primary: string[], secondary: string[]) => void}} [opts]
 *   compact: hide notes and tutorial link (picker); preview: a small body map of the chosen muscles
 *   above the muscle chips; onMuscles: runs after every change of the direct / partial muscles
 * @returns {{node: HTMLElement, read: () => {ok: true, value: object}|{ok: false, error: string}, focusName: () => void}}
 *   error: translated text
 */
export function exerciseForm(initial = {}, { compact = false, preview = false, onMuscles = null } = {}) {
  const primary = new Set(initial.primary || []);
  const secondary = new Set(initial.secondary || []);
  let incrementEdited = initial.increment !== undefined;

  const name = el('input', { class: 'input', type: 'text', value: initial.name || '', autocomplete: 'off', maxlength: '80' });
  const equipment = el('select', { class: 'select' },
    EQUIPMENT_IDS.map((v) => el('option', { value: v, selected: v === (initial.equipment || 'barbell') }, equipmentName(v))));
  const increment = numberInput({
    value: initial.increment ?? DEFAULT_INCREMENT[initial.equipment || 'barbell'],
    min: 0, max: 50, ariaLabel: t('workout.form.step'), onInput: () => { incrementEdited = true; },
  });
  equipment.addEventListener('change', () => {
    if (!incrementEdited) increment.setNumber(DEFAULT_INCREMENT[equipment.value] ?? 2.5);
  });
  const notes = el('textarea', { class: 'textarea', rows: '2', value: initial.notes || '' });
  const videoUrl = el('input', {
    class: 'input', type: 'url', inputmode: 'url', value: initial.videoUrl || '', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', maxlength: '2000', placeholder: 'https://youtu.be/…',
  });
  const videoField = field(t('workout.form.tutorialLink'), videoUrl, { hint: t('workout.form.tutorialHint') });
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
  }, muscleName(m.id));
  renderChips();

  // Labels show the user's own set weighting: 'Direct muscles · × 1', 'Partial muscles · × 0.5'.
  const directLabel = el('div', { class: 'field-label' }, t('workout.form.direct'));
  const partialLabel = el('div', { class: 'field-label' }, t('workout.form.partial'));
  db.getSetting('volume').then((raw) => {
    const w = volumeWeights(raw);
    directLabel.textContent = t('workout.form.directWeighted', { weight: fmtNum(w.primary, 2) });
    partialLabel.textContent = t('workout.form.partialWeighted', { weight: fmtNum(w.secondary, 2) });
  }).catch((err) => console.error(err));
  const primaryField = el('div', { class: 'field' }, directLabel, primaryChips);
  const node = el('div', { class: 'stack' },
    field(t('workout.form.name'), name),
    previewBlock ? previewBlock.node : null,
    primaryField,
    el('div', { class: 'field' }, partialLabel, secondaryChips),
    el('div', { class: 'grid-2' },
      field(t('workout.form.equipment'), equipment),
      field(t('workout.form.step'), increment, { unit: 'kg', hint: t('workout.form.stepHint'), info: 'progression' })),
    compact ? null : field(t('workout.form.notes'), notes),
    compact ? null : videoField);

  return {
    node,
    focusName: () => name.focus(),
    read() {
      const n = name.value.trim();
      primaryField.classList.remove('is-missing');
      if (!n) { name.focus(); return { ok: false, error: t('workout.form.errName') }; }
      if (!primary.size) { primaryField.classList.add('is-missing'); return { ok: false, error: t('workout.form.errMuscle') }; }
      const inc = increment.getNumber();
      if (inc === null) { increment.focus(); return { ok: false, error: t('workout.form.errStep') }; }
      const video = parseVideoUrl(compact ? initial.videoUrl : videoUrl.value);
      videoField.classList.toggle('is-missing', !video.ok);
      if (!video.ok) { videoUrl.setAttribute('aria-invalid', 'true'); videoUrl.focus(); return { ok: false, error: t('workout.form.errLink', { error: t(video.error) }) }; }
      return {
        ok: true,
        value: { name: n, primary: order(primary), secondary: order(secondary), equipment: equipment.value, increment: inc, notes: notes.value.trim(), videoUrl: video.value },
      };
    },
  };
}
