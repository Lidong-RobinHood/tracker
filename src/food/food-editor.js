// Food editor: name, brand, basis, every per-100 value, servings. Also used for a diary entry's values.
import { el, openSheet, numberInput, field, toast, fmtGrouped, segmented, iconButton, icon, sectionHeader } from '../ui/index.js';
import { missingFields, kjToKcal, macroKcal, NUTRIENTS } from '../core/nutrition.js';
import { copyPer100 } from '../core/food-diary.js';
import { round } from '../core/numbers.js';
import { offCredit } from './widgets.js';

const LABELS = {
  kcal: 'Energy', protein: 'Protein', carbs: 'Carbohydrates', fat: 'Fat',
  sugars: 'of which sugars', satFat: 'of which saturated', fibre: 'Fibre', salt: 'Salt',
};
const MAX = { kcal: 900, protein: 100, carbs: 100, fat: 100, sugars: 100, satFat: 100, fibre: 100, salt: 100 };

/**
 * Open the editor.
 * @param {{food: object, title?: string, note?: string, kcalConverted?: boolean,
 *          mode?: 'food'|'entry', canUpdateFood?: boolean, saveLabel?: string}} opts
 *   mode 'entry': editing one diary entry's snapshot (no servings; optional "also update the saved food").
 * @returns {Promise<null | {food: object, alsoUpdateFood?: boolean}>} edited copy, or null if cancelled
 */
export function openFoodEditor({ food, title = 'Edit values', note, kcalConverted = false, mode = 'food', canUpdateFood = false, saveLabel = 'Save' }) {
  const draft = { ...food, per100: copyPer100(food.per100), servings: (food.servings || []).map((s) => ({ ...s })) };
  let basis = draft.basis === 'ml' ? 'ml' : 'g';

  const name = el('input', { class: 'input', type: 'text', value: draft.name || '', autocomplete: 'off', placeholder: 'e.g. Skyr natural', maxlength: '120' });
  const brand = el('input', { class: 'input', type: 'text', value: draft.brand || '', autocomplete: 'off', placeholder: 'Optional', maxlength: '80' });
  const nameField = field('Name', name);
  const brandField = field('Brand', brand);

  const inputs = {};
  const fields = {};
  const units = [];
  for (const k of NUTRIENTS) {
    inputs[k] = numberInput({ value: draft.per100[k], min: 0, max: MAX[k], decimals: k === 'kcal' ? 0 : 2, ariaLabel: LABELS[k] });
    const f = field(LABELS[k] + (k === 'kcal' || k === 'protein' || k === 'carbs' || k === 'fat' ? ' *' : ''), inputs[k], { unit: k === 'kcal' ? 'kcal' : 'g' });
    fields[k] = f;
  }
  if (kcalConverted) {
    fields.kcal.querySelector('.field-label-row').append(el('span', { class: 'badge badge-warning' }, 'from kJ'));
  }
  const kj = numberInput({ min: 0, max: 4000, decimals: 0, ariaLabel: 'Energy in kJ',
    onInput: (n) => { if (n !== null) { inputs.kcal.setNumber(round(kjToKcal(n), 0)); refresh(); } } });
  const kjField = field('or kJ', kj, { unit: 'kJ', hint: 'Fills kcal' });

  const per100Head = sectionHeader(`Per 100 ${basis}`);
  const per100Title = per100Head.querySelector('.section-title');
  const basisCtl = segmented({
    options: [{ value: 'g', label: 'per 100 g' }, { value: 'ml', label: 'per 100 ml' }], value: basis, ariaLabel: 'Basis',
    onChange: (v) => { basis = v; per100Title.textContent = `Per 100 ${basis}`; for (const u of units) u.textContent = basis; },
  });

  const macroHint = el('p', { class: 'field-hint' });
  const missingNote = el('p', { class: 'field-error', role: 'alert' });

  function current() {
    const per100 = {};
    for (const k of NUTRIENTS) per100[k] = inputs[k].getNumber();
    return { ...draft, name: name.value.trim(), brand: brand.value.trim() || null, basis, per100 };
  }
  function refresh(showAll = false) {
    const c = current();
    const missing = missingFields(c);
    nameField.classList.toggle('is-missing', missing.includes('name'));
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) fields[k].classList.toggle('is-missing', missing.includes(k));
    const m = macroKcal(c.per100);
    macroHint.textContent = c.per100.protein !== null || c.per100.carbs !== null || c.per100.fat !== null
      ? `Macros = ${fmtGrouped(m, 0)} kcal / 100 ${basis}` : '';
    missingNote.textContent = missing.length && showAll ? `Missing: ${missing.map((x) => (x === 'name' ? 'name' : LABELS[x].toLowerCase())).join(', ')}.` : '';
    return missing;
  }
  name.addEventListener('input', () => refresh());
  for (const k of NUTRIENTS) inputs[k].addEventListener('input', () => refresh());

  // Servings (food mode only)
  const servingRows = el('div', { class: 'stack serving-rows' });
  const addServingRow = (s = { label: '', amount: null }) => {
    const label = el('input', { class: 'input', type: 'text', value: s.label || '', placeholder: '1 slice', 'aria-label': 'Serving name' });
    const amount = numberInput({ value: s.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: 'Serving amount' });
    const unit = el('span', { class: 'unit' }, basis);
    units.push(unit);
    const row = el('div', { class: 'serving-row' }, label,
      el('div', { class: 'input-unit' }, amount, unit),
      iconButton('x', { label: 'Remove serving', onClick: () => row.remove() }));
    row.read = () => ({ label: label.value.trim() || 'Serving', amount: amount.getNumber() });
    servingRows.append(row);
  };
  for (const s of draft.servings) addServingRow(s);

  const alsoUpdate = el('input', { type: 'checkbox', class: 'switch', id: `upd-${Math.random().toString(36).slice(2)}` });

  const content = [
    note ? el('p', { class: 'editor-note' }, note) : null,
    nameField,
    mode === 'food' ? brandField : null,
    draft.barcode ? el('p', { class: 't-sub muted num' }, `Barcode ${draft.barcode}`) : null,
    draft.source === 'off' ? offCredit() : null,
    basisCtl,
    per100Head,
    el('div', { class: 'grid-2' }, fields.kcal, kjField, fields.protein, fields.carbs, fields.fat, fields.sugars, fields.satFat, fields.fibre, fields.salt),
    macroHint,
    mode === 'food' ? el('div', { class: 'stack' },
      sectionHeader('Servings'),
      servingRows,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost add-serving', onClick: () => addServingRow() }, icon('plus'), 'Add serving')) : null,
    mode === 'entry' && canUpdateFood ? el('label', { class: 'row check-row', htmlFor: alsoUpdate.id }, alsoUpdate, el('span', 'Also update the saved food')) : null,
    mode === 'entry' && !canUpdateFood ? el('p', { class: 't-sub muted' }, 'This entry only.') : null,
    missingNote,
  ];
  const sheet = openSheet({ title, content, className: 'food-editor' });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, 'Cancel'),
    el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, saveLabel),
  );
  refresh();
  requestAnimationFrame(() => {
    const first = !name.value ? name : NUTRIENTS.map((k) => inputs[k]).find((i, idx) => idx < 4 && i.getNumber() === null);
    if (first) first.focus();
  });

  function save() {
    const c = current();
    const bad = NUTRIENTS.find((k) => inputs[k].value.trim() !== '' && inputs[k].getNumber() === null);
    if (bad) { inputs[bad].focus(); toast(`${LABELS[bad]}: enter a number between 0 and ${MAX[bad]}.`, { type: 'error' }); return; }
    const missing = refresh(true);
    if (missing.length) {
      (missing[0] === 'name' ? name : inputs[missing[0]]).focus();
      return;
    }
    if (mode === 'food') {
      c.servings = [...servingRows.children].map((r) => r.read()).filter((s) => s.amount !== null && s.amount > 0);
    }
    sheet.close({ food: c, alsoUpdateFood: alsoUpdate.checked });
  }

  return sheet.closed.then((r) => r || null);
}
