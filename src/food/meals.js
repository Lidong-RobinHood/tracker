// Saved meals: log (with editable amounts), rename/edit/delete, create from diary entries.
import { el, openSheet, numberInput, toast, confirmDialog, fmtGrouped, fmtAmount, fmtDay, iconButton, icon, field } from '../ui/index.js';
import { scale, sumEntries } from '../core/nutrition.js';
import { entriesFromMeal, mealFromEntries } from '../core/food-diary.js';
import { t } from '../i18n/index.js';
import { putEntries, putMeal, removeMeal, touchFoods, getFood } from './store.js';
import { mealSelect, dateInput, mealDateRow, macroText, approxMark } from './widgets.js';
import { isEstimateFood } from '../core/dishes.js';
import { mealName, itemName, savedMealName, foodsById } from './names.js';
import { ensureDisplayNames } from './generic.js';

const uuid = () => crypto.randomUUID();

/** kcal of a saved meal at its stored amounts. */
export const mealKcal = (meal) => sumEntries(meal.items).kcal;

/**
 * Display names of a saved meal's items (generic foods and dishes in the app language) and which items hold a
 * dish's own estimate (shown with '≈': an unedited dish whose values the item still has).
 * @returns {Promise<{names: string[], est: boolean[]}>}
 */
async function itemInfo(meal) {
  const ids = [...new Set(meal.items.map((i) => i.foodId).filter(Boolean))];
  const foods = await Promise.all(ids.map((id) => getFood(id)));
  await ensureDisplayNames(foods);
  const byId = foodsById(foods);
  const foodOf = (i) => (i.foodId ? byId.get(i.foodId) : null);
  return {
    names: meal.items.map((i) => itemName(i, foodOf(i))),
    est: meal.items.map((i) => { const f = foodOf(i); return isEstimateFood(f) && Boolean(i.per100 && f.per100 && i.per100.kcal === f.per100.kcal); }),
  };
}

/**
 * Log a saved meal: items with editable amounts, meal + date, confirm.
 * @param {{date: string, meal: string, onChange?: () => void}} opts onChange: the saved meals changed
 *   later (Undo after a delete), so a list showing them must be redrawn
 * @returns {Promise<'logged'|'changed'|null>} 'changed' if the meal was edited/deleted
 */
export async function openLogMeal(meal, { date, meal: mealId, onChange }) {
  const { names, est } = await itemInfo(meal);
  const rows = meal.items.map((item, i) => {
    const amount = numberInput({ value: item.amount, min: 0, max: 10000, decimals: 1, ariaLabel: t('food.meals.amountOf', { name: names[i] }), onInput: update });
    const kcal = el('span', { class: 'num' });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, names[i]), el('div', { class: 'li-sub' }, est[i] ? approxMark() : null, kcal)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)));
    return { item, amount, kcal, row };
  });
  const totalKcal = el('span', { class: 't-head num' });
  const totalMacros = el('span', { class: 't-sub muted num' });
  const total = el('div', { class: 'meal-total' },
    el('div', { class: 'row-between' }, el('span', { class: 'field-label' }, t('food.meals.total')), totalKcal), totalMacros);
  const mealSel = mealSelect(mealId);
  const dateIn = dateInput(date);
  const sheet = openSheet({
    title: savedMealName(meal),
    content: [
      el('p', { class: 't-sub muted' }, t('food.meals.zeroSkips')),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      total,
      mealDateRow(mealSel, dateIn),
    ],
  });
  const logBtn = el('button', { type: 'button', class: 'btn btn-primary grow', onClick: log }, t('food.meals.log'));
  sheet.footer.append(el('button', { type: 'button', class: 'btn', onClick: edit }, icon('pencil'), t('food.meals.edit')), logBtn);

  function amounts() { return rows.map((r) => r.amount.getNumber()); }
  function update() {
    const a = amounts();
    rows.forEach((r, i) => { r.kcal.textContent = `${fmtGrouped(scale(r.item.per100, a[i] ?? 0).kcal, 0)} kcal`; });
    const used = rows.map((r, i) => ({ per100: r.item.per100, amount: a[i] ?? 0 }));
    const tot = sumEntries(used);
    totalKcal.textContent = `${fmtGrouped(tot.kcal, 0)} kcal`;
    totalMacros.textContent = macroText(tot);
    const n = a.filter((x) => x !== null && x > 0).length;
    logBtn.disabled = n === 0;
    logBtn.textContent = t('food.meals.logItems', { count: n });
  }
  async function log() {
    const d = dateIn.getValue();
    if (!d) { toast(t('food.date.invalid'), { type: 'error' }); return; }
    const entries = entriesFromMeal(meal, { date: d, meal: mealSel.value, amounts: amounts(), now: Date.now(), newId: uuid });
    if (!entries.length) return;
    try {
      await putEntries(entries);
      await touchFoods(entries);
      sheet.close('logged');
      const params = { name: savedMealName(meal), meal: mealName(mealSel.value), day: fmtDay(d) };
      toast(d !== date ? t('food.meals.loggedDay', params) : t('food.meals.logged', params), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
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
export async function openEditMeal(meal, { onChange } = {}) {
  const { names, est } = await itemInfo(meal);
  const shownName = savedMealName(meal);
  const name = el('input', { class: 'input', type: 'text', value: shownName, maxlength: '80', 'aria-label': t('food.meals.name') });
  const rows = meal.items.map((item, i) => {
    const amount = numberInput({ value: item.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: t('food.meals.amountOf', { name: names[i] }) });
    const row = el('div', { class: 'meal-item-row' },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, names[i]), el('div', { class: 'li-sub' }, est[i] ? approxMark() : null, `${fmtGrouped(item.per100.kcal, 0)} kcal / 100 ${item.basis}`)),
      el('div', { class: 'input-unit meal-amount' }, amount, el('span', { class: 'unit' }, item.basis)),
      iconButton('x', { label: t('food.meals.removeItem', { name: names[i] }), onClick: () => { row.remove(); r.removed = true; } }));
    const r = { item, amount, row, removed: false };
    return r;
  });
  const sheet = openSheet({
    title: t('food.meals.edit'),
    content: [
      field(t('food.field.name'), name),
      el('div', { class: 'list' }, rows.map((r) => r.row)),
      el('button', { type: 'button', class: 'btn btn-ghost text-danger delete-meal', onClick: del }, icon('trash-2'), t('food.meals.delete')),
    ],
  });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, t('food.action.cancel')),
    el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, t('food.action.save')));

  async function save() {
    const kept = rows.filter((r) => !r.removed);
    const bad = kept.find((r) => r.amount.getNumber() === null);
    if (bad) { bad.amount.focus(); toast(t('food.error.amount'), { type: 'error' }); return; }
    if (!kept.length) { del(); return; }
    // An unchanged (translated) default name keeps the stored one.
    const typed = name.value.trim();
    const updated = { ...meal, name: !typed || typed === shownName ? meal.name : typed, items: kept.map((r) => ({ ...r.item, amount: r.amount.getNumber() })) };
    await putMeal(updated);
    sheet.close('saved');
    toast(t('food.meals.saved'), { type: 'success' });
  }
  async function del() {
    const ok = await confirmDialog({ title: t('food.meals.deleteTitle', { name: shownName }), message: t('food.meals.deleteMessage'), confirmLabel: t('food.action.delete'), danger: true });
    if (!ok) return;
    await removeMeal(meal.id);
    sheet.close('deleted');
    toast(t('food.meals.deleted'), {
      action: {
        label: t('food.action.undo'),
        onClick: () => putMeal(meal).then(() => { toast(t('food.meals.restored')); if (onChange) onChange(); })
          .catch((err) => { console.error(err); toast(t('food.meals.restoreFailed', { error: err.message || err }), { type: 'error' }); }),
      },
    });
  }
  return sheet.closed.then((r) => r || null);
}

/**
 * Ask for a name and save diary entries as a saved meal (items keep the entries' stored names).
 * @param {object[]} entries
 * @param {{stored: string, shown: string}} defaultName the suggested name (savedMealDefault / photoMealDefault):
 *   shown in the field; saved unchanged (or emptied), the language-neutral `stored` form is kept
 * @param {{names?: string[]}} [opts] names to show for the entries (app language), default the stored ones
 * @returns {Promise<object|null>}
 */
export function openSaveAsMeal(entries, defaultName, { names } = {}) {
  const name = el('input', { class: 'input', type: 'text', value: defaultName.shown, maxlength: '80', 'aria-label': t('food.meals.name') });
  const sheet = openSheet({
    title: t('food.meals.saveAsTitle'),
    content: [
      field(t('food.field.name'), name),
      el('ul', { class: 't-sub muted plain-list' }, entries.map((e, i) => el('li', `${names ? names[i] : itemName(e)} · ${fmtAmount(e.amount, e.basis)}`))),
    ],
  });
  const save = async () => {
    const typed = name.value.trim();
    const meal = mealFromEntries({ id: uuid(), name: !typed || typed === defaultName.shown ? defaultName.stored : typed, entries, now: Date.now() });
    await putMeal(meal);
    sheet.close(meal);
    toast(t('food.meals.savedNamed', { name: savedMealName(meal) }), { type: 'success' });
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  sheet.footer.append(
    el('button', { type: 'button', class: 'btn', onClick: () => sheet.close(null) }, t('food.action.cancel')),
    el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, t('food.meals.saveMeal')));
  requestAnimationFrame(() => { name.focus(); name.select(); });
  return sheet.closed.then((r) => r || null);
}
