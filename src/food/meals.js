// Saved meals: log (with editable amounts), rename/edit/delete, create from diary entries.
import { el, openSheet, numberInput, toast, confirmDialog, fmtGrouped, fmtAmount, fmtDay, iconButton, icon, field } from '../ui/index.js';
import { scale, sumEntries } from '../core/nutrition.js';
import { entriesFromMeal, mealFromEntries, mealLabel } from '../core/food-diary.js';
import { putEntries, putMeal, removeMeal, touchFoods } from './store.js';
import { mealSelect, dateInput, mealDateRow, macroText } from './widgets.js';

const uuid = () => crypto.randomUUID();

/** kcal of a saved meal at its stored amounts. */
export const mealKcal = (meal) => sumEntries(meal.items).kcal;

/**
 * Log a saved meal: items with editable amounts, meal + date, confirm.
 * @param {{date: string, meal: string, onChange?: () => void}} opts onChange: the saved meals changed
 *   later (Undo after a delete), so a list showing them must be redrawn
 * @returns {Promise<'logged'|'changed'|null>} 'changed' if the meal was edited/deleted
 */
export function openLogMeal(meal, { date, meal: mealId, onChange }) {
  const rows = meal.items.map((item) => {
    const amount = numberInput({ value: item.amount, min: 0, max: 10000, decimals: 1, ariaLabel: `Amount of ${item.name}`, onInput: update });
    const kcal = el('span', { class: 'num' });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, item.name), el('div', { class: 'li-sub' }, kcal)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)));
    return { item, amount, kcal, row };
  });
  const totalKcal = el('span', { class: 't-head num' });
  const totalMacros = el('span', { class: 't-sub muted num' });
  const total = el('div', { class: 'meal-total' },
    el('div', { class: 'row-between' }, el('span', { class: 'field-label' }, 'Total'), totalKcal), totalMacros);
  const mealSel = mealSelect(mealId);
  const dateIn = dateInput(date);
  const sheet = openSheet({
    title: meal.name,
    content: [
      el('p', { class: 't-sub muted' }, '0 skips an item.'),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      total,
      mealDateRow(mealSel, dateIn),
    ],
  });
  const logBtn = el('button', { type: 'button', class: 'btn btn-primary grow', onClick: log }, 'Log');
  sheet.footer.append(el('button', { type: 'button', class: 'btn', onClick: edit }, icon('pencil'), 'Edit meal'), logBtn);

  function amounts() { return rows.map((r) => r.amount.getNumber()); }
  function update() {
    const a = amounts();
    rows.forEach((r, i) => { r.kcal.textContent = `${fmtGrouped(scale(r.item.per100, a[i] ?? 0).kcal, 0)} kcal`; });
    const used = rows.map((r, i) => ({ per100: r.item.per100, amount: a[i] ?? 0 }));
    const t = sumEntries(used);
    totalKcal.textContent = `${fmtGrouped(t.kcal, 0)} kcal`;
    totalMacros.textContent = macroText(t);
    const n = a.filter((x) => x !== null && x > 0).length;
    logBtn.disabled = n === 0;
    logBtn.textContent = `Log ${n} item${n === 1 ? '' : 's'}`;
  }
  async function log() {
    const d = dateIn.getValue();
    if (!d) { toast('Choose a valid date.', { type: 'error' }); return; }
    const entries = entriesFromMeal(meal, { date: d, meal: mealSel.value, amounts: amounts(), now: Date.now(), newId: uuid });
    if (!entries.length) return;
    try {
      await putEntries(entries);
      await touchFoods(entries);
      sheet.close('logged');
      toast(`Logged ${meal.name} to ${mealLabel(mealSel.value)}${d !== date ? ` (${fmtDay(d)})` : ''}`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message || err}`, { type: 'error' });
    }
  }
  async function edit() {
    const r = await openEditMeal(meal, { onChange });
    if (r) sheet.close('changed');
  }
  update();
  return sheet.closed.then((r) => r || null);
}

/**
 * Rename / change amounts / remove items / delete a saved meal.
 * @param {{onChange?: () => void}} [opts] onChange runs after Undo restored a deleted meal
 * @returns {Promise<'saved'|'deleted'|null>}
 */
export function openEditMeal(meal, { onChange } = {}) {
  const name = el('input', { class: 'input', type: 'text', value: meal.name, maxlength: '80', 'aria-label': 'Meal name' });
  const rows = meal.items.map((item) => {
    const amount = numberInput({ value: item.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: `Amount of ${item.name}` });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, item.name), el('div', { class: 'li-sub' }, `${fmtGrouped(item.per100.kcal, 0)} kcal / 100 ${item.basis}`)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)),
      iconButton('x', { label: `Remove ${item.name}`, onClick: () => { row.remove(); r.removed = true; } }));
    const r = { item, amount, row, removed: false };
    return r;
  });
  const sheet = openSheet({
    title: 'Edit meal',
    content: [
      field('Name', name),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      el('button', { type: 'button', class: 'btn btn-ghost text-danger delete-meal', onClick: del }, icon('trash-2'), 'Delete meal'),
    ],
  });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, 'Cancel'),
    el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, 'Save'));

  async function save() {
    const kept = rows.filter((r) => !r.removed);
    const bad = kept.find((r) => r.amount.getNumber() === null);
    if (bad) { bad.amount.focus(); toast('Enter a valid amount.', { type: 'error' }); return; }
    if (!kept.length) { del(); return; }
    const updated = { ...meal, name: name.value.trim() || meal.name, items: kept.map((r) => ({ ...r.item, amount: r.amount.getNumber() })) };
    await putMeal(updated);
    sheet.close('saved');
    toast('Meal saved', { type: 'success' });
  }
  async function del() {
    const ok = await confirmDialog({ title: `Delete “${meal.name}”?`, message: 'Diary entries stay.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await removeMeal(meal.id);
    sheet.close('deleted');
    toast('Meal deleted', {
      action: {
        label: 'Undo',
        onClick: () => putMeal(meal).then(() => { toast('Meal restored'); if (onChange) onChange(); })
          .catch((err) => { console.error(err); toast(`Could not restore: ${err.message || err}`, { type: 'error' }); }),
      },
    });
  }
  return sheet.closed.then((r) => r || null);
}

/** Ask for a name and save diary entries as a saved meal. @returns {Promise<object|null>} */
export function openSaveAsMeal(entries, defaultName) {
  const name = el('input', { class: 'input', type: 'text', value: defaultName, maxlength: '80', 'aria-label': 'Meal name' });
  const sheet = openSheet({
    title: 'Save as meal',
    content: [
      field('Name', name),
      el('ul', { class: 't-sub muted plain-list' }, entries.map((e) => el('li', `${e.name} · ${fmtAmount(e.amount, e.basis)}`))),
    ],
  });
  const save = async () => {
    const meal = mealFromEntries({ id: uuid(), name: name.value.trim() || defaultName, entries, now: Date.now() });
    await putMeal(meal);
    sheet.close(meal);
    toast(`Saved meal “${meal.name}”`, { type: 'success' });
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, 'Cancel'),
    el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, 'Save meal'));
  requestAnimationFrame(() => { name.focus(); name.select(); });
  return sheet.closed.then((r) => r || null);
}
