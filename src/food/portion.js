// Portion screen: every add path ends here. Amount, serving chips, live values, edit values, meal/date.
import { el, openSheet, numberInput, toast, fmtNum, fmtDay, fmtAmount, replaceChildren } from '../ui/index.js';
import { scale, isComplete, missingFields } from '../core/nutrition.js';
import { defaultAmount, multiplyAmount } from '../core/portion.js';
import { mealLabel } from '../core/food-diary.js';
import { logFood, saveFood } from './store.js';
import { openFoodEditor } from './food-editor.js';
import { mealSelect, dateInput, sourceBadge, per100Text } from './widgets.js';

/**
 * Edit a food's values (userEdited) and store it. Returns the stored record or null.
 * @param {object} food @param {{note?: string, kcalConverted?: boolean, title?: string, saveLabel?: string}} [opts]
 */
export async function editAndSaveFood(food, opts = {}) {
  const r = await openFoodEditor({ food, ...opts });
  if (!r) return null;
  try {
    const saved = await saveFood(r.food, { userEdited: true });
    toast('Food saved', { type: 'success' });
    return saved;
  } catch (err) {
    console.error(err);
    toast(`Could not save the food: ${err.message || err}`, { type: 'error' });
    return null;
  }
}

/**
 * Open the portion sheet.
 * @param {{food: object, date: string, meal: string, kcalConverted?: boolean}} opts
 * @returns {Promise<null | {entry: object, food: object}>} the logged entry, or null if closed
 */
export function openPortion({ food, date, meal, kcalConverted = false }) {
  let current = food;
  let converted = kcalConverted;

  const titleEl = el('div', { class: 'portion-name' });
  const subEl = el('div', { class: 'portion-sub small muted' });
  const amount = numberInput({ value: defaultAmount(food), min: 0.1, max: 10000, decimals: 1, ariaLabel: 'Amount', onInput: () => update() });
  amount.classList.add('portion-amount');
  const unit = el('span', { class: 'unit' });
  const chips = el('div', { class: 'chips' });
  const kcalEl = el('div', { class: 'portion-kcal num' });
  const macros = el('div', { class: 'portion-macros grid-3' });
  const extra = el('div', { class: 'small muted portion-extra' });
  const warn = el('p', { class: 'field-error' });
  const mealSel = mealSelect(meal);
  const dateIn = dateInput(date);

  const sheet = openSheet({
    title: 'Add food',
    className: 'portion-sheet',
    content: [
      el('div', { class: 'portion-head' }, titleEl, subEl),
      el('div', { class: 'portion-amount-row' },
        el('label', { class: 'field-label', htmlFor: amount.id = `amt-${Math.random().toString(36).slice(2)}` }, 'Amount'),
        el('div', { class: 'input-unit' }, amount, unit)),
      chips,
      el('div', { class: 'portion-values card' }, kcalEl, macros, extra),
      warn,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: editValues }, '✎ Edit values'),
      el('div', { class: 'grid-2' },
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Date'), dateIn)),
    ],
  });
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: add }, 'Add');
  sheet.footer.append(addBtn);

  function renderFood() {
    titleEl.textContent = current.name || 'Unnamed food';
    replaceChildren(subEl, sourceBadge(current, { long: true }),
      converted ? el('span', { class: 'badge badge-warning' }, 'kcal from kJ') : null,
      ` ${[current.brand, per100Text(current)].filter(Boolean).join(' · ')}`);
    unit.textContent = current.basis || 'g';
    chips.replaceChildren(
      ...(current.servings || []).map((s) => el('button', {
        type: 'button', class: 'chip', dataset: { amount: String(s.amount) },
        onClick: () => { amount.setNumber(s.amount); update(); },
      }, `${s.label} · ${fmtAmount(s.amount, current.basis)}`)),
      el('button', { type: 'button', class: 'chip', 'aria-label': 'Half the amount', onClick: () => mult(0.5) }, '×½'),
      el('button', { type: 'button', class: 'chip', 'aria-label': 'Double the amount', onClick: () => mult(2) }, '×2'),
    );
    update();
  }
  function mult(f) {
    const n = amount.getNumber();
    if (n !== null) { amount.setNumber(multiplyAmount(n, f)); update(); }
  }
  function update() {
    const n = amount.getNumber();
    const v = scale(current.per100, n ?? 0);
    kcalEl.replaceChildren(el('span', { class: 'big' }, fmtNum(v.kcal, 0)), ' kcal');
    macros.replaceChildren(
      macroCell('Protein', v.protein), macroCell('Carbs', v.carbs), macroCell('Fat', v.fat));
    const extras = [['Sugars', v.sugars], ['Sat. fat', v.satFat], ['Fibre', v.fibre], ['Salt', v.salt]]
      .filter(([, x]) => x !== null).map(([l, x]) => `${l} ${fmtNum(x, l === 'Salt' ? 2 : 1)} g`);
    extra.textContent = extras.join(' · ');
    for (const c of chips.querySelectorAll('[data-amount]')) c.classList.toggle('is-active', n !== null && Number(c.dataset.amount) === n);
    const missing = missingFields(current);
    warn.textContent = missing.length ? `Values missing (${missing.join(', ')}). Use “Edit values” to complete them.` : '';
    addBtn.disabled = n === null || n <= 0;
    addBtn.textContent = n === null ? 'Enter an amount' : `Add ${fmtAmount(n, current.basis)} to ${mealLabel(mealSel.value)}`;
  }
  mealSel.addEventListener('change', update);

  async function editValues() {
    const saved = await editAndSaveFood(current, { kcalConverted: converted });
    if (!saved) return;
    current = saved;
    converted = false;
    renderFood();
  }

  let busy = false;
  async function add() {
    const n = amount.getNumber();
    const d = dateIn.getValue();
    if (n === null || n <= 0) { amount.focus(); return; }
    if (!d) { toast('Choose a valid date.', { type: 'error' }); return; }
    if (!isComplete(current)) { await editValues(); if (!isComplete(current)) return; }
    if (busy) return;
    busy = true;
    try {
      const r = await logFood(current, { date: d, meal: mealSel.value, amount: n });
      sheet.close(r);
      toast(`Added ${r.entry.name} to ${mealLabel(r.entry.meal)}${d !== date ? ` (${fmtDay(d)})` : ''}`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message || err}`, { type: 'error' });
    } finally {
      busy = false;
    }
  }

  renderFood();
  // Focus + select the amount so typing replaces it (after the sheet's own focus handling).
  requestAnimationFrame(() => requestAnimationFrame(() => { amount.focus(); amount.select(); }));
  return sheet.closed.then((r) => r || null);
}

function macroCell(label, v) {
  return el('div', { class: 'macro-cell' }, el('div', { class: 'num macro-val' }, `${fmtNum(v)} g`), el('div', { class: 'small muted' }, label));
}
