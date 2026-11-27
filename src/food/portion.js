// Portion screen: every add path ends here. Amount, serving chips, live values, edit values, meal/date.
// A dish (own estimate, core/dishes.js) adds Small / Normal / Large above the amount (picking one fills the grams;
// typing another amount deselects it) and shows its values with '≈'.
import { el, openSheet, numberInput, toast, fmtNum, fmtDay, fmtAmount, replaceChildren, icon } from '../ui/index.js';
import { scale, isComplete, missingFields } from '../core/nutrition.js';
import { defaultAmount, multiplyAmount } from '../core/portion.js';
import { validSizes, isEstimateFood, SIZE_LABELS } from '../core/dishes.js';
import { t } from '../i18n/index.js';
import { logFood, saveFood } from './store.js';
import { openFoodEditor } from './food-editor.js';
import { mealSelect, dateInput, sourceBadge, per100Text, offCredit, mealDateRow, portionValues, missingText } from './widgets.js';
import { foodName, mealName, servingLabel } from './names.js';

/** Plate icons of the three dish sizes (small, normal, large). */
const plates = () => [icon('plate-s'), icon('plate-m'), icon('plate-l')];

/**
 * Edit a food's values (userEdited) and store it. Returns the stored record or null.
 * @param {object} food @param {{note?: string, kcalConverted?: boolean, title?: string, saveLabel?: string}} [opts]
 */
export async function editAndSaveFood(food, opts = {}) {
  const r = await openFoodEditor({ food, ...opts });
  if (!r) return null;
  try {
    const saved = await saveFood(r.food, { userEdited: true });
    toast(t('food.editor.saved'), { type: 'success' });
    return saved;
  } catch (err) {
    console.error(err);
    toast(t('food.editor.saveFailed', { error: err.message || err }), { type: 'error' });
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

  const titleEl = el('div', { class: 't-head portion-name' });
  const subEl = el('div', { class: 'portion-sub t-sub muted' });
  const creditEl = offCredit();
  const amount = numberInput({ value: defaultAmount(food), min: 0.1, max: 10000, decimals: 1, ariaLabel: t('food.portion.amount'), onInput: () => update() });
  amount.classList.add('portion-amount');
  const unit = el('span', { class: 'unit' });
  const chips = el('div', { class: 'chips chips-scroll portion-chips' });
  const sizesEl = el('div', { class: 'seg size-seg', role: 'group', 'aria-label': t('food.dish.size') });
  const valuesEl = el('div', { class: 'portion-values' });
  const extra = el('div', { class: 't-sub muted num portion-extra' });
  const warn = el('p', { class: 'field-error' });
  const mealSel = mealSelect(meal);
  const dateIn = dateInput(date);

  const sheet = openSheet({
    title: t('food.portion.title'),
    className: 'portion-sheet',
    content: [
      el('div', { class: 'portion-head' }, titleEl, subEl),
      creditEl,
      sizesEl,
      el('div', { class: 'field portion-amount-row' },
        el('label', { class: 'field-label', htmlFor: amount.id = `amt-${Math.random().toString(36).slice(2)}` }, t('food.portion.amount')),
        el('div', { class: 'input-unit' }, amount, unit)),
      chips,
      valuesEl,
      warn,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: editValues }, icon('pencil'), t('food.portion.editValues')),
      mealDateRow(mealSel, dateIn),
    ],
  });
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: add }, t('food.action.add'));
  sheet.footer.append(addBtn);

  function renderFood() {
    titleEl.textContent = foodName(current);
    replaceChildren(subEl, sourceBadge(current, { long: true }),
      converted ? el('span', { class: 'badge badge-warning' }, t('food.badge.kcalFromKj')) : null,
      ` ${[current.brand, per100Text(current)].filter(Boolean).join(' · ')}`);
    creditEl.hidden = current.source !== 'off';
    unit.textContent = current.basis || 'g';
    const sizes = validSizes(current.sizes);
    sizesEl.hidden = !sizes;
    const icons = plates();
    sizesEl.replaceChildren(...(sizes || []).map((g, i) => el('button', {
      type: 'button', 'aria-pressed': 'false', dataset: { amount: String(g) },
      onClick: () => { amount.setNumber(g); update(); },
    }, icons[i], el('span', null, t(`food.dish.${SIZE_LABELS[i]}`)), el('span', { class: 'size-g' }, fmtAmount(g, current.basis)))));
    chips.replaceChildren(
      ...(current.servings || []).map((s) => el('button', {
        type: 'button', class: 'chip', dataset: { amount: String(s.amount) },
        onClick: () => { amount.setNumber(s.amount); update(); },
      }, `${servingLabel(s.label)} · ${fmtAmount(s.amount, current.basis)}`)),
      el('button', { type: 'button', class: 'chip', 'aria-label': t('food.portion.half'), onClick: () => mult(0.5) }, '×½'),
      el('button', { type: 'button', class: 'chip', 'aria-label': t('food.portion.double'), onClick: () => mult(2) }, '×2'),
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
    const extras = [['sugars', v.sugars], ['satFatShort', v.satFat], ['fibre', v.fibre], ['salt', v.salt]]
      .filter(([, x]) => x !== null).map(([k, x]) => t('food.portion.extra', { label: t(`food.nutrient.${k}`), value: fmtNum(x, k === 'salt' ? 2 : 1) }));
    extra.textContent = extras.join(' · ');
    replaceChildren(valuesEl, portionValues(v, extras.length ? extra : null, { approx: isEstimateFood(current) }));
    for (const c of chips.querySelectorAll('[data-amount]')) c.classList.toggle('is-active', n !== null && Number(c.dataset.amount) === n);
    for (const b of sizesEl.querySelectorAll('[data-amount]')) b.setAttribute('aria-pressed', String(n !== null && Number(b.dataset.amount) === n));
    const missing = missingFields(current);
    warn.textContent = missing.length ? t('food.portion.missing', { fields: missingText(missing) }) : '';
    addBtn.disabled = n === null || n <= 0;
    addBtn.textContent = n === null ? t('food.portion.enterAmount') : t('food.portion.addTo', { amount: fmtAmount(n, current.basis), meal: mealName(mealSel.value) });
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
    if (!d) { toast(t('food.date.invalid'), { type: 'error' }); return; }
    if (!isComplete(current)) { await editValues(); if (!isComplete(current)) return; }
    if (busy) return;
    busy = true;
    try {
      const r = await logFood(current, { date: d, meal: mealSel.value, amount: n });
      sheet.close(r);
      const params = { name: foodName(r.food), meal: mealName(r.entry.meal), day: fmtDay(d) };
      toast(d !== date ? t('food.portion.addedDay', params) : t('food.portion.added', params), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
    } finally {
      busy = false;
    }
  }

  renderFood();
  // Focus + select the amount so typing replaces it (after the sheet's own focus handling).
  requestAnimationFrame(() => requestAnimationFrame(() => { amount.focus(); amount.select(); }));
  return sheet.closed.then((r) => r || null);
}

