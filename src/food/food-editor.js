// Food editor: name, brand, basis, every per-100 value, servings. Also used for a diary entry's values.
import { el, openSheet, numberInput, field, toast, fmtGrouped, segmented, iconButton, icon, sectionHeader } from '../ui/index.js';
import { missingFields, kjToKcal, macroKcal, NUTRIENTS } from '../core/nutrition.js';
import { copyPer100 } from '../core/food-diary.js';
import { SERVING_LABEL } from '../core/portion.js';
import { localFoodName } from '../core/food-names.js';
import { servingLabel } from './names.js';
import { displayNames } from './generic.js';
import { round } from '../core/numbers.js';
import { t } from '../i18n/index.js';
import { offCredit, missingText } from './widgets.js';

/** Catalogue keys of the value labels (as on a nutrition label). */
const LABELS = {
  kcal: 'food.editor.energy', protein: 'food.nutrient.protein', carbs: 'food.editor.carbs', fat: 'food.nutrient.fat',
  sugars: 'food.editor.sugars', satFat: 'food.editor.satFat', fibre: 'food.nutrient.fibre', salt: 'food.nutrient.salt',
};
const label = (k) => t(LABELS[k]);
const MAX = { kcal: 900, protein: 100, carbs: 100, fat: 100, sugars: 100, satFat: 100, fibre: 100, salt: 100 };

/**
 * Open the editor.
 * @param {{food: object, title?: string, note?: string, kcalConverted?: boolean,
 *          mode?: 'food'|'entry', canUpdateFood?: boolean, saveLabel?: string}} opts
 *   mode 'entry': editing one diary entry's snapshot (no servings; optional "also update the saved food").
 * @returns {Promise<null | {food: object, alsoUpdateFood?: boolean}>} edited copy, or null if cancelled
 */
export function openFoodEditor({ food, title = t('food.portion.editValues'), note, kcalConverted = false, mode = 'food', canUpdateFood = false, saveLabel = t('food.action.save') }) {
  const draft = { ...food, per100: copyPer100(food.per100), servings: (food.servings || []).map((s) => ({ ...s })) };
  let basis = draft.basis === 'ml' ? 'ml' : 'g';

  // A generic food is shown with its translated name; saved unchanged, the record keeps its English name.
  const shownName = (mode === 'food' && localFoodName(draft, displayNames())) || draft.name || '';
  const name = el('input', { class: 'input', type: 'text', value: shownName, autocomplete: 'off', placeholder: t('food.editor.namePlaceholder'), maxlength: '120' });
  const brand = el('input', { class: 'input', type: 'text', value: draft.brand || '', autocomplete: 'off', placeholder: t('food.field.optional'), maxlength: '80' });
  const nameField = field(t('food.field.name'), name);
  const brandField = field(t('food.editor.brand'), brand);

  const inputs = {};
  const fields = {};
  const units = [];
  for (const k of NUTRIENTS) {
    inputs[k] = numberInput({ value: draft.per100[k], min: 0, max: MAX[k], decimals: k === 'kcal' ? 0 : 2, ariaLabel: label(k) });
    const f = field(label(k) + (k === 'kcal' || k === 'protein' || k === 'carbs' || k === 'fat' ? ' *' : ''), inputs[k], { unit: k === 'kcal' ? 'kcal' : 'g' });
    fields[k] = f;
  }
  if (kcalConverted) {
    fields.kcal.querySelector('.field-label-row').append(el('span', { class: 'badge badge-warning' }, t('food.badge.fromKj')));
  }
  const kj = numberInput({ min: 0, max: 4000, decimals: 0, ariaLabel: t('food.editor.energyKj'),
    onInput: (n) => { if (n !== null) { inputs.kcal.setNumber(round(kjToKcal(n), 0)); refresh(); } } });
  const kjField = field(t('food.editor.orKj'), kj, { unit: 'kJ', hint: t('food.editor.fillsKcal') });

  const per100Head = sectionHeader(t('food.editor.per100Title', { basis }));
  const per100Title = per100Head.querySelector('.section-title');
  const basisCtl = segmented({
    options: [{ value: 'g', label: t('food.editor.per100', { basis: 'g' }) }, { value: 'ml', label: t('food.editor.per100', { basis: 'ml' }) }], value: basis, ariaLabel: t('food.editor.basis'),
    onChange: (v) => { basis = v; per100Title.textContent = t('food.editor.per100Title', { basis }); for (const u of units) u.textContent = basis; },
  });

  const macroHint = el('p', { class: 'field-hint' });
  const missingNote = el('p', { class: 'field-error', role: 'alert' });

  function current() {
    const per100 = {};
    for (const k of NUTRIENTS) per100[k] = inputs[k].getNumber();
    const typed = name.value.trim();
    return { ...draft, name: typed && typed === shownName ? draft.name || typed : typed, brand: brand.value.trim() || null, basis, per100 };
  }
  function refresh(showAll = false) {
    const c = current();
    const missing = missingFields(c);
    nameField.classList.toggle('is-missing', missing.includes('name'));
    for (const k of ['kcal', 'protein', 'carbs', 'fat']) fields[k].classList.toggle('is-missing', missing.includes(k));
    const m = macroKcal(c.per100);
    macroHint.textContent = c.per100.protein !== null || c.per100.carbs !== null || c.per100.fat !== null
      ? t('food.editor.macroHint', { kcal: fmtGrouped(m, 0), basis }) : '';
    missingNote.textContent = missing.length && showAll ? t('food.editor.missing', { fields: missingText(missing) }) : '';
    return missing;
  }
  name.addEventListener('input', () => refresh());
  for (const k of NUTRIENTS) inputs[k].addEventListener('input', () => refresh());

  // Servings (food mode only)
  const servingRows = el('div', { class: 'stack serving-rows' });
  const addServingRow = (s = { label: '', amount: null }) => {
    // Stored markers ('Whole pack', 'Serving') are shown translated; unchanged, they are saved as they were.
    const shown = servingLabel(s.label || '');
    const labelIn = el('input', { class: 'input', type: 'text', value: shown, placeholder: t('food.editor.servingPlaceholder'), 'aria-label': t('food.editor.servingName') });
    const amount = numberInput({ value: s.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: t('food.editor.servingAmount') });
    const unit = el('span', { class: 'unit' }, basis);
    units.push(unit);
    const row = el('div', { class: 'serving-row' }, labelIn,
      el('div', { class: 'input-unit' }, amount, unit),
      iconButton('x', { label: t('food.editor.removeServing'), onClick: () => row.remove() }));
    row.read = () => {
      const v = labelIn.value.trim();
      return { label: !v ? SERVING_LABEL : v === shown && s.label ? s.label : v, amount: amount.getNumber() };
    };
    servingRows.append(row);
  };
  for (const s of draft.servings) addServingRow(s);

  const alsoUpdate = el('input', { type: 'checkbox', class: 'switch', id: `upd-${Math.random().toString(36).slice(2)}` });

  const content = [
    note ? el('p', { class: 'editor-note' }, note) : null,
    nameField,
    mode === 'food' ? brandField : null,
    draft.barcode ? el('p', { class: 't-sub muted num' }, t('food.editor.barcode', { code: draft.barcode })) : null,
    draft.source === 'off' ? offCredit() : null,
    basisCtl,
    per100Head,
    el('div', { class: 'grid-2' }, fields.kcal, kjField, fields.protein, fields.carbs, fields.fat, fields.sugars, fields.satFat, fields.fibre, fields.salt),
    macroHint,
    mode === 'food' ? el('div', { class: 'stack' },
      sectionHeader(t('food.editor.servings')),
      servingRows,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost add-serving', onClick: () => addServingRow() }, icon('plus'), t('food.editor.addServing'))) : null,
    mode === 'entry' && canUpdateFood ? el('label', { class: 'row check-row', htmlFor: alsoUpdate.id }, alsoUpdate, el('span', t('food.editor.alsoUpdate'))) : null,
    mode === 'entry' && !canUpdateFood ? el('p', { class: 't-sub muted' }, t('food.editor.entryOnly')) : null,
    missingNote,
  ];
  const sheet = openSheet({ title, content, className: 'food-editor' });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, t('food.action.cancel')),
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
    if (bad) { inputs[bad].focus(); toast(t('food.editor.badNumber', { label: label(bad), max: MAX[bad] }), { type: 'error' }); return; }
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
