// Exercise editor form (library detail, "new exercise", and inline create from the picker).
import { el, field, numberInput } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { DEFAULT_INCREMENT } from '../data/exercises.js';
import { parseVideoUrl } from '../core/exercise-video.js';

export const EQUIPMENT = [
  ['barbell', 'Barbell'], ['dumbbell', 'Dumbbell'], ['machine', 'Machine'],
  ['cable', 'Cable'], ['bodyweight', 'Bodyweight'], ['other', 'Other'],
];

/**
 * @param {object} [initial] exercise or partial ({ name })
 * @param {{compact?: boolean}} [opts] compact: hide notes and tutorial link (picker)
 * @returns {{node: HTMLElement, read: () => {ok: true, value: object}|{ok: false, error: string}, focusName: () => void}}
 */
export function exerciseForm(initial = {}, { compact = false } = {}) {
  const primary = new Set(initial.primary || []);
  const secondary = new Set(initial.secondary || []);
  let incrementEdited = initial.increment !== undefined;

  const name = el('input', { class: 'input', type: 'text', value: initial.name || '', autocomplete: 'off', maxlength: '80' });
  const equipment = el('select', { class: 'select' },
    EQUIPMENT.map(([v, label]) => el('option', { value: v, selected: v === (initial.equipment || 'barbell') }, label)));
  const increment = numberInput({
    value: initial.increment ?? DEFAULT_INCREMENT[initial.equipment || 'barbell'],
    min: 0, max: 50, ariaLabel: 'Increment', onInput: () => { incrementEdited = true; },
  });
  equipment.addEventListener('change', () => {
    if (!incrementEdited) increment.setNumber(DEFAULT_INCREMENT[equipment.value] ?? 2.5);
  });
  const notes = el('textarea', { class: 'textarea', rows: '2', value: initial.notes || '' });
  const videoUrl = el('input', {
    class: 'input', type: 'url', inputmode: 'url', value: initial.videoUrl || '', autocomplete: 'off',
    autocapitalize: 'off', spellcheck: 'false', maxlength: '2000', placeholder: 'https://youtu.be/…',
  });
  const videoField = field('Tutorial link', videoUrl, { hint: 'YouTube video or any https link. Leave empty to use the default tutorial.' });
  videoUrl.addEventListener('input', () => { videoField.classList.remove('is-missing'); videoUrl.removeAttribute('aria-invalid'); });

  const primaryChips = el('div', { class: 'chips' });
  const secondaryChips = el('div', { class: 'chips' });
  const renderChips = () => {
    primaryChips.replaceChildren(...MUSCLES.map((m) => chip(m, primary, secondary)));
    secondaryChips.replaceChildren(...MUSCLES.map((m) => chip(m, secondary, primary)));
  };
  // Selecting a muscle in one group removes it from the other.
  const chip = (m, set, other) => el('button', {
    type: 'button', class: 'chip', 'aria-pressed': set.has(m.id) ? 'true' : 'false',
    onClick: () => {
      if (set.has(m.id)) set.delete(m.id);
      else { set.add(m.id); other.delete(m.id); }
      renderChips();
    },
  }, m.name);
  renderChips();

  const primaryField = el('div', { class: 'field' }, el('div', { class: 'field-label' }, 'Primary muscles (count 1 set each)'), primaryChips);
  const node = el('div', { class: 'stack' },
    field('Name', name),
    primaryField,
    el('div', { class: 'field' }, el('div', { class: 'field-label' }, 'Secondary muscles (count ½ set each by default)'), secondaryChips),
    el('div', { class: 'grid-2' },
      field('Equipment', equipment),
      field('Increment', increment, { unit: 'kg', hint: '0 = no suggestions' })),
    compact ? null : field('Notes', notes),
    compact ? null : videoField);

  return {
    node,
    focusName: () => name.focus(),
    read() {
      const n = name.value.trim();
      primaryField.classList.remove('is-missing');
      if (!n) { name.focus(); return { ok: false, error: 'Enter a name.' }; }
      if (!primary.size) { primaryField.classList.add('is-missing'); return { ok: false, error: 'Pick at least one primary muscle.' }; }
      const inc = increment.getNumber();
      if (inc === null) { increment.focus(); return { ok: false, error: 'Enter an increment from 0 to 50 kg.' }; }
      const video = parseVideoUrl(compact ? initial.videoUrl : videoUrl.value);
      videoField.classList.toggle('is-missing', !video.ok);
      if (!video.ok) { videoUrl.setAttribute('aria-invalid', 'true'); videoUrl.focus(); return { ok: false, error: `Tutorial link: ${video.error}` }; }
      const order = (s) => MUSCLES.map((m) => m.id).filter((id) => s.has(id));
      return {
        ok: true,
        value: { name: n, primary: order(primary), secondary: order(secondary), equipment: equipment.value, increment: inc, notes: notes.value.trim(), videoUrl: video.value },
      };
    },
  };
}
