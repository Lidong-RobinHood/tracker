// "Estimate a meal" (Quick add): entry row and the builder sheet. A plate of hand portions (palms of protein,
// fists of carbs and vegetables, thumbs of fat) with a live estimate; logged as one quick-add entry.
// Model and constants: src/core/meal-estimate.js.
import { el, openSheet, toast, fmtGrouped, icon, replaceChildren } from '../ui/index.js';
import { t } from '../i18n/index.js';
import {
  defaultPlate, amountOf, step, setKind, setCooking, groupGrams, plateTotals, estimateName, halvesText,
  ESTIMATE_GROUPS, ESTIMATE_GROUP_UNIT, ESTIMATE_MAX, PROTEIN_KINDS, CARB_KINDS, COOKING_METHODS,
} from '../core/meal-estimate.js';
import { quickAddEntry } from '../core/food-diary.js';
import { putEntry } from './store.js';
import { mealSelect, portionValues, ensureCss } from './widgets.js';
import { mealName } from './names.js';

/** Icon of each group's hand unit and of each cooking method (literal names for tests/icons.test.js). */
const UNIT_ICON = { palm: 'hand-palm', fist: 'hand-fist', thumb: 'hand-thumb' };
const COOK_ICON = { grilled: 'cook-steam', pan: 'cook-pan', fried: 'cook-fry', creamy: 'droplet' };
const KINDS = { protein: PROTEIN_KINDS, carbs: CARB_KINDS };

/** '1½ palms' / '1½ Handflächen' / '1½ 掌' (screen-reader text). ½ and 1 take the singular. */
function unitsText(group, n) {
  const count = n > 0 && n <= 1 ? 1 : 2;
  return t(`food.estimate.units.${ESTIMATE_GROUP_UNIT[group]}`, { count: n === 0 ? 0 : count, n: halvesText(n) });
}

/**
 * Card with the one "Estimate a meal" row (top of the Quick add tab).
 * @param {() => void} onOpen
 */
export function estimateEntry(onOpen) {
  ensureCss();
  return el('div', { class: 'card card-flush estimate-entry' }, el('div', { class: 'list' },
    el('button', { type: 'button', class: 'list-item', onClick: onOpen },
      el('span', { class: 'li-lead' }, icon('hand-palm')),
      el('span', { class: 'li-main' },
        el('span', { class: 'li-title' }, t('food.estimate.title')),
        el('span', { class: 'unit-icons', 'aria-hidden': 'true' }, icon('hand-palm'), icon('hand-fist'), icon('hand-thumb'))),
      icon('chevron-right', { class: 'li-chevron' }))));
}

/**
 * Open the builder sheet. Logs one quick-add entry (kcal + macros) to the chosen meal on `date`.
 * @param {{date: string, meal: string}} opts
 * @returns {Promise<object|null>} the logged entry, or null when closed
 */
export function openEstimate({ date, meal }) {
  ensureCss();
  let plate = defaultPlate();

  const values = el('div', { class: 'portion-values' });
  const live = el('p', { class: 'vh', role: 'status', 'aria-live': 'polite' });
  const rows = el('div', { class: 'est-rows' });
  const syncers = [];

  for (const g of ESTIMATE_GROUPS) {
    const groupName = t(`food.estimate.group.${g}`);
    const val = el('span', { class: 'stepper-val num', 'aria-hidden': 'true' });
    const valSr = el('span', { class: 'vh' });
    const sub = el('span', { class: 't-sub muted num' });
    const change = (dir) => { plate = step(plate, g, dir); sync(); announce(g); };
    const minus = el('button', { type: 'button', 'aria-label': t(`food.estimate.less.${g}`), onClick: () => change(-1) }, icon('minus'));
    const plus = el('button', { type: 'button', 'aria-label': t(`food.estimate.more.${g}`), onClick: () => change(1) }, icon('plus'));
    const titleId = `est-${g}-${Math.random().toString(36).slice(2)}`;
    const row = el('div', { class: 'est-row', role: 'group', 'aria-labelledby': titleId },
      el('div', { class: 'est-row-head' },
        icon(UNIT_ICON[ESTIMATE_GROUP_UNIT[g]], { size: 28 }),
        el('div', { class: 'est-row-title' }, el('span', { class: 'strong', id: titleId }, groupName), sub),
        el('div', { class: 'stepper' }, minus, val, valSr, plus)));
    let kindSync = () => {};
    if (KINDS[g]) {
      const chips = KINDS[g].map((k) => el('button', {
        type: 'button', class: 'chip', dataset: { k },
        onClick: () => { plate = setKind(plate, g, k); sync(); announce(g); },
      }, t(`food.estimate.kind.${k}`)));
      row.append(el('div', { class: 'chips', role: 'group', 'aria-label': t('food.estimate.kindOf', { group: groupName }) }, chips));
      kindSync = () => { for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.k === plate[g].kind)); };
    } else if (g === 'fat') {
      const btns = COOKING_METHODS.map((k) => el('button', {
        type: 'button', dataset: { k }, 'aria-label': t(`food.estimate.cookLong.${k}`), title: t(`food.estimate.cookLong.${k}`),
        onClick: () => { plate = setCooking(plate, k); sync(); announce('fat'); },
      }, icon(COOK_ICON[k]), el('span', null, t(`food.estimate.cook.${k}`))));
      row.append(el('div', { class: 'seg seg-stack', role: 'group', 'aria-label': t('food.estimate.cooking') }, btns));
      kindSync = () => { for (const b of btns) b.setAttribute('aria-pressed', String(b.dataset.k === plate.cooking)); };
    }
    syncers.push(() => {
      const a = amountOf(plate, g);
      val.textContent = halvesText(a);
      valSr.textContent = unitsText(g, a);
      sub.textContent = `${fmtGrouped(groupGrams(plate, g), 0)} g`;
      minus.disabled = a <= 0;
      plus.disabled = a >= ESTIMATE_MAX[g];
      row.classList.toggle('is-zero', a === 0 && g !== 'fat');
      kindSync();
    });
    rows.append(row);
  }
  const name = el('input', { class: 'input', type: 'text', placeholder: t('food.field.optional'), maxlength: '80', autocomplete: 'off' });
  const nameId = `est-name-${Math.random().toString(36).slice(2)}`;
  name.id = nameId;
  const mealSel = mealSelect(meal);
  const nameMeal = el('div', { class: 'grid-2 name-meal-row' },
    el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: nameId }, t('food.field.name')), name),
    el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('food.meal.label')), mealSel));

  const sheet = openSheet({ title: t('food.estimate.title'), className: 'estimate-sheet', content: [values, rows, nameMeal, live] });
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: add });
  sheet.footer.append(addBtn);
  mealSel.addEventListener('change', sync);

  function sync() {
    for (const f of syncers) f();
    const v = plateTotals(plate);
    replaceChildren(values, portionValues(v, null, { approx: true }));
    addBtn.textContent = t('food.estimate.add', { kcal: fmtGrouped(v.kcal, 0), meal: mealName(mealSel.value) });
    addBtn.disabled = v.kcal <= 0;
  }

  /** Screen readers: the changed row and the new total ('Protein: 1½ palms, 150 g. About 735 kcal'). */
  function announce(g) {
    const v = plateTotals(plate);
    live.textContent = t('food.estimate.announce', {
      group: t(`food.estimate.group.${g}`), units: unitsText(g, amountOf(plate, g)),
      grams: fmtGrouped(groupGrams(plate, g), 0), kcal: fmtGrouped(v.kcal, 0),
    });
  }

  let busy = false;
  async function add() {
    const v = plateTotals(plate);
    if (busy || v.kcal <= 0) return;
    busy = true;
    try {
      const e = quickAddEntry({
        id: crypto.randomUUID(), date, meal: mealSel.value, name: estimateName(name.value),
        kcal: v.kcal, protein: v.protein, carbs: v.carbs, fat: v.fat, estimate: true, now: Date.now(),
      });
      await putEntry(e);
      sheet.close(e);
      toast(t('food.quickAdd.added', { kcal: fmtGrouped(v.kcal, 0), meal: mealName(e.meal) }), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
    } finally {
      busy = false;
    }
  }

  sync();
  return sheet.closed.then((r) => (r && r.id ? r : null));
}
