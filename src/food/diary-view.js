// Diary: day view with four meals, per-meal and day totals vs targets, entry editing, copy/save meals.
import {
  el, pageHeader, openSheet, numberInput, toast, fmtGrouped, fmtDay, fmtDate, fmtAmount, navigate, href, field,
  replaceChildren, iconButton, icon, ring, progressBar,
} from '../ui/index.js';
import { today, addDays, isValidDate, weekStart, parseDate } from '../core/dates.js';
import { dayRange } from '../i18n/dates.js';
import { scale } from '../core/nutrition.js';
import { MEALS, groupByMeal, totals, copyEntries, isQuickAdd, isEstimateEntry } from '../core/food-diary.js';
import { targetStatus, shareOfDay, fmtPercent } from '../core/food-percent.js';
import { t } from '../i18n/index.js';
import { dayEntries, putEntry, putEntries, removeEntry, removeEntries, getTargets, updateFoodFromEntry, getFood } from './store.js';
import { openFoodEditor } from './food-editor.js';
import { openSaveAsMeal } from './meals.js';
import { ensureCss, mealSelect, dateInput, macroText, mealDateRow, portionValues, approxMark } from './widgets.js';
import { isEstimateFood } from '../core/dishes.js';
import { mealName, itemName, isUnnamedQuickAdd, savedMealDefault } from './names.js';
import { ensureDisplayNames } from './generic.js';
import { PHOTO_DRAFT } from './photo-tab.js';
import { loadDraft } from '../ui/draft.js';

/** Catalogue keys of the macro labels. */
const LABEL = { kcal: 'food.nutrient.calories', protein: 'food.nutrient.protein', carbs: 'food.nutrient.carbs', fat: 'food.nutrient.fat' };
const uuid = () => crypto.randomUUID();
// Quick add = no food behind it AND stored as amount 100 (per100 = the totals). Photo items that were not
// remembered also have no food but keep their real amount, so they stay editable by amount.
const isQuick = (e) => isQuickAdd(e) && e.amount === 100;

/** '16–22 Nov' (or '30 Nov – 6 Dec') for the Mon–Sun week of `date`, in the app language (src/i18n/dates.js). */
function weekRange(date) {
  return dayRange(parseDate(weekStart(date)), parseDate(addDays(weekStart(date), 6)));
}

/** Route: diary, diary/:date */
export async function mountDiary(container, params) {
  ensureCss();
  const date = params.date && isValidDate(params.date) ? params.date : today();
  const isToday = date === today();
  const go = (d) => navigate(`diary/${d}`, { replace: true });

  const picker = dateInput(date, { ariaLabel: t('food.diary.jumpToDate'), onChange: (d) => { if (d !== date) go(d); } });
  picker.classList.add('date-picker-input');
  picker.addEventListener('click', () => { try { picker.showPicker(); } catch { /* not supported: native tap opens it */ } });
  const pickerBtn = el('label', { class: 'btn btn-icon btn-ghost date-picker', title: t('food.date.pick') }, icon('calendar'), picker);

  container.append(pageHeader({
    title: fmtDay(date),
    subtitle: fmtDay(date) === fmtDate(date) ? null : fmtDate(date),
    actions: [
      iconButton('chevron-left', { label: t('food.diary.previousDay'), onClick: () => go(addDays(date, -1)) }),
      pickerBtn,
      iconButton('chevron-right', { label: t('food.diary.nextDay'), onClick: () => go(addDays(date, 1)) }),
    ],
  }));
  const todayLink = isToday ? null : el('a', { class: 'btn btn-sm today-link', href: href(`diary/${today()}`) }, t('food.diary.jumpToToday'));
  const summary = el('section', { class: 'card day-summary', 'aria-label': t('food.diary.dayTotals') });
  const mealsWrap = el('div', { class: 'stack meals' });
  // A meal-photo review left unfinished (e.g. the app was reloaded) is kept for 24 h: offer to continue.
  const pd = loadDraft(PHOTO_DRAFT);
  const draftLink = pd && isValidDate(pd.date) && Array.isArray(pd.rows)
    ? el('div', { class: 'card card-flush' },
      el('a', { class: 'list-item photo-draft-link', href: href(`food/add/${pd.date}/${pd.meal}?tab=quick`) },
        icon('camera', { class: 'li-lead' }),
        el('span', { class: 'li-main' },
          el('span', { class: 'li-title' }, t('food.diary.continueEstimate')),
          el('span', { class: 'li-sub' }, t('food.diary.continueEstimateSub', { meal: mealName(pd.meal), day: fmtDay(pd.date) }))),
        icon('chevron-right', { class: 'li-chevron' })))
    : null;
  // Weekly report for the Mon–Sun week of the day being viewed (route owned by trends).
  const reportLink = el('div', { class: 'card card-flush' },
    el('a', { class: 'list-item week-report-link', href: href(`trends/week/${weekStart(date)}`) },
      icon('file-chart-column', { class: 'li-lead' }),
      el('span', { class: 'li-main li-title' }, t('food.diary.weeklyReport')),
      el('span', { class: 'li-trail t-sub muted' }, weekRange(date)),
      icon('chevron-right', { class: 'li-chevron' })));
  container.append(...[todayLink, draftLink, summary, mealsWrap, reportLink].filter(Boolean));

  let targets = await getTargets();
  let entries = [];
  /** Stored foods of the day's entries (by id), for generic food names in the app language. */
  let foods = new Map();

  async function render() {
    entries = await dayEntries(date);
    const ids = [...new Set(entries.map((e) => e.foodId).filter(Boolean))];
    foods = new Map((await Promise.all(ids.map((id) => getFood(id)))).filter(Boolean).map((f) => [f.id, f]));
    // Generic (USDA) food names in the app language: the names file is loaded only when one is on screen.
    await ensureDisplayNames([...foods.values()]);
    renderSummary();
    const byMeal = groupByMeal(entries);
    const dayKcal = totals(entries).kcal;
    replaceChildren(mealsWrap, ...MEALS.map((m) => mealCard(m, byMeal[m.id], dayKcal)));
  }

  // ---------------------------------------------------------------- day summary
  const kcalRing = ring({ value: 0, max: 0, size: 148, stroke: 10 });
  const restCap = el('span', { class: 't-cap muted' }, t('food.diary.left'));
  const restVal = el('span', { class: 't-head num' });
  const targetVal = el('span', { class: 't-head num' });
  const targetPct = el('span', { class: 't-sub num' });
  const macroCells = Object.fromEntries(['protein', 'carbs', 'fat'].map((key) => {
    const pct = el('span', { class: 'num pct' });
    const bar = progressBar({ value: 0, max: 0, tone: key, label: t(LABEL[key]) });
    const amt = el('span', { class: 't-sub num macro-amounts' });
    const cell = el('div', { class: 'macro-bar' },
      el('div', { class: 't-sub macro-label' }, el('span', { class: 'strong' }, t(LABEL[key])), pct), bar, amt);
    return [key, { cell, pct, bar, amt }];
  }));
  summary.append(
    el('div', { class: 'hero-row' },
      el('div', { class: 'hero-side' }, restCap, restVal, el('span', { class: 't-sub muted' }, 'kcal')),
      kcalRing,
      el('div', { class: 'hero-side is-right' }, el('span', { class: 't-cap muted' }, t('food.diary.target')), targetVal, targetPct)),
    el('div', { class: 'macro-bars' }, Object.values(macroCells).map((c) => c.cell)));

  function renderSummary() {
    const tot = totals(entries);
    // One rounding rule for everything shown: eaten rounded once, left/over from the rounded value.
    const st = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map((k) => [k, targetStatus(tot[k], targets && targets[k])]));
    const kcal = st.kcal;
    // Ring and centre number both show eaten; left/over sits beside it (no target: '–').
    kcalRing.update({
      value: kcal.eaten, max: kcal.target ?? 0, tone: kcal.isOver ? 'warn' : 'accent',
      label: fmtGrouped(kcal.eaten, 0), sub: t('food.diary.kcalEaten'),
    });
    restCap.textContent = t(kcal.isOver ? 'food.diary.over' : 'food.diary.left');
    restVal.textContent = fmtGrouped(kcal.isOver ? kcal.over : kcal.left, 0);
    restVal.classList.toggle('pct-over', kcal.isOver);
    targetVal.textContent = fmtGrouped(kcal.target, 0);
    if (kcal.target === null) { targetPct.textContent = 'kcal'; targetPct.className = 't-sub num muted'; targetPct.removeAttribute('title'); } else setPct(targetPct, kcal);
    for (const [key, c] of Object.entries(macroCells)) {
      const x = st[key];
      setPct(c.pct, x);
      c.bar.update({ value: x.eaten, max: x.target ?? 0, tone: x.isOver ? 'warn' : key });
      replaceChildren(c.amt, fmtGrouped(x.eaten, 0), el('span', { class: 'muted' }, ` / ${fmtGrouped(x.target, 0)} g`));
    }
  }

  /** '62 %' (warning colour when over target); empty without a target. */
  function setPct(node, x) {
    node.textContent = x && x.pct !== null ? fmtPercent(x.pct) : '';
    node.classList.toggle('pct-over', Boolean(x && x.isOver));
    node.classList.toggle('muted', !(x && x.isOver));
    node.title = t(x && x.isOver ? 'food.diary.overTarget' : 'food.diary.ofTarget');
  }

  // ---------------------------------------------------------------- meals
  function mealCard(m, list, dayKcal) {
    const tot = totals(list);
    const share = list.length ? shareOfDay(tot.kcal, dayKcal) : null;
    const label = mealName(m.id);
    return el('section', { class: 'card card-flush meal-card', 'aria-label': label },
      el('div', { class: 'meal-head' },
        el('div', { class: 'meal-title-wrap' },
          el('h2', { class: 't-head meal-title' }, label),
          list.length ? el('div', { class: 't-sub muted num meal-macros' }, macroText(tot)) : null),
        el('div', { class: 't-sub muted num meal-kcal' }, list.length ? `${fmtGrouped(tot.kcal, 0)} kcal` : '–',
          share === null ? null : el('div', { class: 'meal-share', 'aria-label': t('food.diary.shareAria', { pct: share }), title: t('food.diary.shareTitle') }, fmtPercent(share))),
        list.length ? iconButton('ellipsis', { label: t('food.diary.mealOptions', { meal: label }), onClick: () => mealMenu(m, list) }) : null,
        el('a', { class: 'btn btn-icon btn-ghost meal-add', href: href(`food/add/${date}/${m.id}`), 'aria-label': t('food.diary.addToMeal', { meal: label }) }, icon('plus'))),
      list.length ? el('div', { class: 'list' }, list.map(entryRow)) : null);
  }

  /** Entry name in the app language (generic foods, 'Quick add'); user names as stored. */
  function nameOf(e) { return itemName(e, e.foodId ? foods.get(e.foodId) : null); }

  /**
   * True when an entry holds an estimate: logged by "Estimate a meal" (`estimate: true`), or a dish's own estimate
   * (its food is an unedited dish and the entry still has the dish's values). Its kcal is shown with '≈'.
   */
  function isEstimate(e) {
    if (isEstimateEntry(e)) return true; // logged by "Estimate a meal"
    const f = e.foodId ? foods.get(e.foodId) : null;
    return isEstimateFood(f) && e.per100 && f.per100 && e.per100.kcal === f.per100.kcal;
  }

  function entryRow(e) {
    const v = scale(e.per100, e.amount);
    return el('button', { type: 'button', class: 'list-item entry-row', onClick: () => editEntry(e) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, nameOf(e)),
        el('div', { class: 'li-sub' }, isQuick(e) ? (isUnnamedQuickAdd(e) ? macroText(v) : `${t('food.quickAdd.title')} · ${macroText(v)}`) : [fmtAmount(e.amount, e.basis), e.brand].filter(Boolean).join(' · '))),
      el('div', { class: 'li-trail num' }, isEstimate(e) ? approxMark() : null, fmtGrouped(v.kcal, 0), el('span', { class: 'vh' }, ' kcal')));
  }

  // ---------------------------------------------------------------- entry sheet
  function editEntry(entry) {
    let draft = { ...entry, per100: { ...entry.per100 } };
    const quick = isQuick(entry);
    const amount = numberInput({ value: entry.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: t('food.portion.amount'), onInput: update });
    amount.classList.add('portion-amount');
    const values = el('div', { class: 'portion-values' });
    // Shown name: translated while unchanged; once "Edit values" returns a name, that one.
    const shownName = nameOf(entry);
    let nameChanged = false;
    let approx = isEstimate(entry); // '≈' until the values are edited
    const nameEl = el('div', { class: 't-head portion-name' }, shownName);
    const mealSel = mealSelect(entry.meal);
    const dateIn = dateInput(entry.date);
    let alsoUpdateFood = false;
    const sheet = openSheet({
      title: t(quick ? 'food.quickAdd.title' : 'food.entry.edit'),
      className: 'portion-sheet',
      content: [
        el('div', { class: 'portion-head' }, nameEl, entry.brand ? el('div', { class: 't-sub muted' }, entry.brand) : null),
        quick ? null : field(t('food.portion.amount'), amount, { unit: entry.basis }),
        values,
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: editValues }, icon('pencil'), t('food.portion.editValues')),
        mealDateRow(mealSel, dateIn),
      ],
    });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: del }, icon('trash-2'), t('food.action.delete')),
      el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, t('food.action.save')));

    function update() {
      const v = scale(draft.per100, quick ? 100 : amount.getNumber() ?? 0);
      nameEl.textContent = nameChanged ? draft.name : shownName;
      replaceChildren(values, portionValues(v, null, { approx }));
    }
    async function editValues() {
      // The editor shows the name as the user sees it; an unchanged name keeps the stored one (so a generic
      // food keeps its English record name and stays translated).
      const shown = nameChanged ? draft.name : shownName;
      const food = { ...draft, name: shown };
      const r = await openFoodEditor({
        food, mode: 'entry', title: t(quick ? 'food.quickAdd.valuesTitle' : 'food.entry.editValues'), canUpdateFood: !quick && Boolean(entry.foodId),
      });
      if (!r) return;
      if (r.food.name !== shown) nameChanged = true;
      draft = { ...draft, name: nameChanged ? r.food.name : draft.name, basis: r.food.basis, per100: r.food.per100 };
      approx = approx && r.food.per100.kcal === entry.per100.kcal;
      alsoUpdateFood = r.alsoUpdateFood;
      update();
    }
    async function save() {
      const a = quick ? 100 : amount.getNumber();
      const d = dateIn.getValue();
      if (a === null || a <= 0) { amount.focus(); return; }
      if (!d) { toast(t('food.date.invalid'), { type: 'error' }); return; }
      const updated = { ...draft, amount: a, meal: mealSel.value, date: d };
      // an estimate whose kcal was edited is no longer one (an invalid value is dropped too)
      if (!approx || updated.estimate !== true) delete updated.estimate;
      try {
        await putEntry(updated);
        if (alsoUpdateFood) {
          const f = await getFood(entry.foodId);
          if (f) await updateFoodFromEntry(updated);
        }
        sheet.close(true);
        toast(d !== date ? t('food.entry.moved', { day: fmtDay(d) }) : t('food.entry.saved'), { type: 'success' });
        render();
      } catch (err) {
        console.error(err);
        toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
      }
    }
    async function del() {
      await removeEntry(entry.id);
      sheet.close(true);
      render();
      toast(t('food.entry.deleted', { name: shownName }), { action: { label: t('food.action.undo'), onClick: async () => { await putEntries([entry]); render(); } } });
    }
    update();
  }

  // ---------------------------------------------------------------- meal menu
  function mealMenu(m, list) {
    const item = (iconName, label, onClick, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick },
      icon(iconName, { class: 'li-lead' }), el('span', { class: 'li-main' }, label));
    const label = mealName(m.id);
    const sheet = openSheet({
      title: label,
      content: el('div', { class: 'list menu-list' },
        item('copy', t('food.diary.copyToDay'), () => { sheet.close(); copyMeal(m, list); }),
        item('bookmark', t('food.diary.saveAsMeal'), () => { sheet.close(); openSaveAsMeal(list, savedMealDefault(m.id, date), { names: list.map(nameOf) }); }),
        item('trash-2', t('food.diary.deleteAll', { count: list.length }), () => { sheet.close(); deleteAll(m, list); }, 'text-danger')),
    });
  }

  function copyMeal(m, list) {
    const dateIn = dateInput(isToday ? addDays(date, 1) : today());
    const mealSel = mealSelect(m.id);
    const sheet = openSheet({
      title: t('food.diary.copyTitle', { meal: mealName(m.id) }),
      content: [
        el('p', { class: 't-sub muted num' }, t('food.diary.itemsKcal', { count: list.length, kcal: fmtGrouped(totals(list).kcal, 0) })),
        mealDateRow(mealSel, dateIn, { dateLabel: t('food.diary.toDate'), mealFirst: false }),
      ],
    });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => sheet.close() }, t('food.action.cancel')),
      el('button', { type: 'button', class: 'btn btn-primary grow', onClick: async () => {
        const d = dateIn.getValue();
        if (!d) { toast(t('food.date.invalid'), { type: 'error' }); return; }
        const copies = copyEntries(list, { date: d, meal: mealSel.value, now: Date.now(), newId: uuid });
        await putEntries(copies);
        sheet.close();
        if (d === date) render();
        toast(t('food.diary.copied', { meal: mealName(mealSel.value), day: fmtDay(d) }), { type: 'success', action: { label: t('food.action.open'), onClick: () => navigate(`diary/${d}`) } });
      } }, t('food.action.copy')));
  }

  async function deleteAll(m, list) {
    await removeEntries(list.map((e) => e.id));
    render();
    toast(t('food.diary.deletedFrom', { count: list.length, meal: mealName(m.id) }), { action: { label: t('food.action.undo'), onClick: async () => { await putEntries(list); render(); } } });
  }

  // Keep in sync if targets change elsewhere or the tab regains focus (e.g. the day rolled over).
  const onVisible = async () => { if (!document.hidden) { targets = await getTargets(); render(); } };
  document.addEventListener('visibilitychange', onVisible);

  await render();
  return () => document.removeEventListener('visibilitychange', onVisible);
}
