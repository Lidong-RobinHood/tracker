// Saved meals: log (with editable amounts), rename/edit/delete, create from diary entries.
import { el, openSheet, numberInput, toast, confirmDialog, fmtNum, fmtAmount, fmtDay } from '../ui/index.js';
import { scale, sumEntries } from '../core/nutrition.js';
import { entriesFromMeal, mealFromEntries, mealLabel } from '../core/food-diary.js';
import { putEntries, putMeal, removeMeal, touchFoods } from './store.js';
import { mealSelect, dateInput } from './widgets.js';

const uuid = () => crypto.randomUUID();

/** kcal of a saved meal at its stored amounts. */
export const mealKcal = (meal) => sumEntries(meal.items).kcal;

/**
 * Log a saved meal: items with editable amounts, meal + date, confirm.
 * @returns {Promise<'logged'|'changed'|null>} 'changed' if the meal was edited/deleted
 */
export function openLogMeal(meal, { date, meal: mealId }) {
  const rows = meal.items.map((item) => {
    const amount = numberInput({ value: item.amount, min: 0, max: 10000, decimals: 1, ariaLabel: `Amount of ${item.name}`, onInput: update });
    const kcal = el('span', { class: 'num small muted' });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, item.name), el('div', { class: 'li-sub' }, kcal)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)));
    return { item, amount, kcal, row };
  });
  const total = el('div', { class: 'num meal-total' });
  const mealSel = mealSelect(mealId);
  const dateIn = dateInput(date);
  const sheet = openSheet({
    title: meal.name,
    content: [
      el('p', { class: 'small muted' }, 'Adjust amounts if needed. 0 skips an item.'),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      total,
      el('div', { class: 'grid-2' },
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Date'), dateIn)),
    ],
  });
  const logBtn = el('button', { type: 'button', class: 'btn btn-primary grow', onClick: log }, 'Log');
  sheet.footer.append(el('button', { type: 'button', class: 'btn', onClick: edit }, 'Edit meal'), logBtn);

  function amounts() { return rows.map((r) => r.amount.getNumber()); }
  function update() {
    const a = amounts();
    rows.forEach((r, i) => { r.kcal.textContent = `${fmtNum(scale(r.item.per100, a[i] ?? 0).kcal, 0)} kcal`; });
    const used = rows.map((r, i) => ({ per100: r.item.per100, amount: a[i] ?? 0 }));
    const t = sumEntries(used);
    total.textContent = `Total ${fmtNum(t.kcal, 0)} kcal · P ${fmtNum(t.protein)} · C ${fmtNum(t.carbs)} · F ${fmtNum(t.fat)}`;
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
    const r = await openEditMeal(meal);
    if (r) sheet.close('changed');
  }
  update();
  return sheet.closed.then((r) => r || null);
}

/**
 * Rename / change amounts / remove items / delete a saved meal.
 * @returns {Promise<'saved'|'deleted'|null>}
 */
export function openEditMeal(meal) {
  const name = el('input', { class: 'input', type: 'text', value: meal.name, maxlength: '80', 'aria-label': 'Meal name' });
  const rows = meal.items.map((item) => {
    const amount = numberInput({ value: item.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: `Amount of ${item.name}` });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, item.name), el('div', { class: 'li-sub' }, `${fmtNum(item.per100.kcal, 0)} kcal / 100 ${item.basis}`)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)),
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Remove ${item.name}`, onClick: () => { row.remove(); r.removed = true; } }, '×'));
    const r = { item, amount, row, removed: false };
    return r;
  });
  const sheet = openSheet({
    title: 'Edit meal',
    content: [
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), name),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: del }, 'Delete meal'),
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
    const ok = await confirmDialog({ title: 'Delete meal?', message: `“${meal.name}” will be removed from your saved meals. Diary entries stay.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await removeMeal(meal.id);
    sheet.close('deleted');
    toast('Meal deleted', { action: { label: 'Undo', onClick: () => putMeal(meal).then(() => toast('Meal restored')) } });
  }
  return sheet.closed.then((r) => r || null);
}

/** Ask for a name and save diary entries as a saved meal. @returns {Promise<object|null>} */
export function openSaveAsMeal(entries, defaultName) {
  const name = el('input', { class: 'input', type: 'text', value: defaultName, maxlength: '80', 'aria-label': 'Meal name' });
  const sheet = openSheet({
    title: 'Save as meal',
    content: [
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Name'), name),
      el('ul', { class: 'small muted plain-list' }, entries.map((e) => el('li', `${e.name} · ${fmtAmount(e.amount, e.basis)}`))),
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
