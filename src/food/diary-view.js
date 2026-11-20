// Diary: day view with four meals, per-meal and day totals vs targets, entry editing, copy/save meals.
import {
  el, pageHeader, openSheet, numberInput, toast, fmtGrouped, fmtDay, fmtDate, fmtAmount, navigate, href, field,
  replaceChildren, iconButton, icon, ring, progressBar,
} from '../ui/index.js';
import { today, addDays, isValidDate, weekStart } from '../core/dates.js';
import { scale } from '../core/nutrition.js';
import { MEALS, mealLabel, groupByMeal, totals, copyEntries, isQuickAdd } from '../core/food-diary.js';
import { targetStatus, shareOfDay, fmtPercent } from '../core/food-percent.js';
import { dayEntries, putEntry, putEntries, removeEntry, removeEntries, getTargets, updateFoodFromEntry, getFood } from './store.js';
import { openFoodEditor } from './food-editor.js';
import { openSaveAsMeal } from './meals.js';
import { ensureCss, mealSelect, dateInput, macroText, mealDateRow, portionValues } from './widgets.js';
import { PHOTO_DRAFT } from './photo-tab.js';
import { loadDraft } from '../ui/draft.js';

const LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const uuid = () => crypto.randomUUID();
// Quick add = no food behind it AND stored as amount 100 (per100 = the totals). Photo items that were not
// remembered also have no food but keep their real amount, so they stay editable by amount.
const isQuick = (e) => isQuickAdd(e) && e.amount === 100;

/** '16–22 Nov' (or '30 Nov – 6 Dec') for the Mon–Sun week of `date`. */
function weekRange(date) {
  const a = fmtDate(weekStart(date)).split(' ');
  const b = fmtDate(addDays(weekStart(date), 6)).split(' ');
  const year = b[3] ? ` ${b[3]}` : '';
  return a[2] === b[2] ? `${a[1]}–${b[1]} ${b[2]}${year}` : `${a[1]} ${a[2]} – ${b[1]} ${b[2]}${year}`;
}

/** Route: diary, diary/:date */
export async function mountDiary(container, params) {
  ensureCss();
  const date = params.date && isValidDate(params.date) ? params.date : today();
  const isToday = date === today();
  const go = (d) => navigate(`diary/${d}`, { replace: true });

  const picker = dateInput(date, { ariaLabel: 'Jump to date', onChange: (d) => { if (d !== date) go(d); } });
  picker.classList.add('date-picker-input');
  picker.addEventListener('click', () => { try { picker.showPicker(); } catch { /* not supported: native tap opens it */ } });
  const pickerBtn = el('label', { class: 'btn btn-icon btn-ghost date-picker', title: 'Pick a date' }, icon('calendar'), picker);

  container.append(pageHeader({
    title: fmtDay(date),
    subtitle: fmtDay(date) === fmtDate(date) ? null : fmtDate(date),
    actions: [
      iconButton('chevron-left', { label: 'Previous day', onClick: () => go(addDays(date, -1)) }),
      pickerBtn,
      iconButton('chevron-right', { label: 'Next day', onClick: () => go(addDays(date, 1)) }),
    ],
  }));
  const todayLink = isToday ? null : el('a', { class: 'btn btn-sm today-link', href: href(`diary/${today()}`) }, 'Jump to today');
  const summary = el('section', { class: 'card day-summary', 'aria-label': 'Day totals' });
  const mealsWrap = el('div', { class: 'stack meals' });
  // A meal-photo review left unfinished (e.g. the app was reloaded) is kept for 24 h: offer to continue.
  const pd = loadDraft(PHOTO_DRAFT);
  const draftLink = pd && isValidDate(pd.date) && Array.isArray(pd.rows)
    ? el('div', { class: 'card card-flush' },
      el('a', { class: 'list-item photo-draft-link', href: href(`food/add/${pd.date}/${pd.meal}?tab=quick`) },
        icon('camera', { class: 'li-lead' }),
        el('span', { class: 'li-main' },
          el('span', { class: 'li-title' }, 'Continue estimate'),
          el('span', { class: 'li-sub' }, `Meal photo · ${mealLabel(pd.meal)}, ${fmtDay(pd.date)}`)),
        icon('chevron-right', { class: 'li-chevron' })))
    : null;
  // Weekly report for the Mon–Sun week of the day being viewed (route owned by trends).
  const reportLink = el('div', { class: 'card card-flush' },
    el('a', { class: 'list-item week-report-link', href: href(`trends/week/${weekStart(date)}`) },
      icon('file-chart-column', { class: 'li-lead' }),
      el('span', { class: 'li-main li-title' }, 'Weekly report'),
      el('span', { class: 'li-trail t-sub muted' }, weekRange(date)),
      icon('chevron-right', { class: 'li-chevron' })));
  container.append(...[todayLink, draftLink, summary, mealsWrap, reportLink].filter(Boolean));

  let targets = await getTargets();
  let entries = [];

  async function render() {
    entries = await dayEntries(date);
    renderSummary();
    const byMeal = groupByMeal(entries);
    const dayKcal = totals(entries).kcal;
    replaceChildren(mealsWrap, ...MEALS.map((m) => mealCard(m, byMeal[m.id], dayKcal)));
  }

  // ---------------------------------------------------------------- day summary
  const kcalRing = ring({ value: 0, max: 0, size: 148, stroke: 10 });
  const restCap = el('span', { class: 't-cap muted' }, 'Left');
  const restVal = el('span', { class: 't-head num' });
  const targetVal = el('span', { class: 't-head num' });
  const targetPct = el('span', { class: 't-sub num' });
  const macroCells = Object.fromEntries(['protein', 'carbs', 'fat'].map((key) => {
    const pct = el('span', { class: 'num pct' });
    const bar = progressBar({ value: 0, max: 0, tone: key, label: LABEL[key] });
    const amt = el('span', { class: 't-sub num macro-amounts' });
    const cell = el('div', { class: 'macro-bar' },
      el('div', { class: 't-sub macro-label' }, el('span', { class: 'strong' }, LABEL[key]), pct), bar, amt);
    return [key, { cell, pct, bar, amt }];
  }));
  summary.append(
    el('div', { class: 'hero-row' },
      el('div', { class: 'hero-side' }, restCap, restVal, el('span', { class: 't-sub muted' }, 'kcal')),
      kcalRing,
      el('div', { class: 'hero-side is-right' }, el('span', { class: 't-cap muted' }, 'Target'), targetVal, targetPct)),
    el('div', { class: 'macro-bars' }, Object.values(macroCells).map((c) => c.cell)));

  function renderSummary() {
    const t = totals(entries);
    // One rounding rule for everything shown: eaten rounded once, left/over from the rounded value.
    const st = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map((k) => [k, targetStatus(t[k], targets && targets[k])]));
    const kcal = st.kcal;
    // Ring and centre number both show eaten; left/over sits beside it (no target: '–').
    kcalRing.update({
      value: kcal.eaten, max: kcal.target ?? 0, tone: kcal.isOver ? 'warn' : 'accent',
      label: fmtGrouped(kcal.eaten, 0), sub: 'kcal eaten',
    });
    restCap.textContent = kcal.isOver ? 'Over' : 'Left';
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
    node.title = x && x.isOver ? 'Over target' : 'Of daily target';
  }

  // ---------------------------------------------------------------- meals
  function mealCard(m, list, dayKcal) {
    const t = totals(list);
    const share = list.length ? shareOfDay(t.kcal, dayKcal) : null;
    return el('section', { class: 'card card-flush meal-card', 'aria-label': m.label },
      el('div', { class: 'meal-head' },
        el('div', { class: 'meal-title-wrap' },
          el('h2', { class: 't-head meal-title' }, m.label),
          list.length ? el('div', { class: 't-sub muted num meal-macros' }, macroText(t)) : null),
        el('div', { class: 't-sub muted num meal-kcal' }, list.length ? `${fmtGrouped(t.kcal, 0)} kcal` : '–',
          share === null ? null : el('div', { class: 'meal-share', 'aria-label': `${share} percent of the day's calories`, title: 'Share of the day’s calories' }, fmtPercent(share))),
        list.length ? iconButton('ellipsis', { label: `${m.label} options`, onClick: () => mealMenu(m, list) }) : null,
        el('a', { class: 'btn btn-icon btn-ghost meal-add', href: href(`food/add/${date}/${m.id}`), 'aria-label': `Add to ${m.label}` }, icon('plus'))),
      list.length ? el('div', { class: 'list' }, list.map(entryRow)) : null);
  }

  function entryRow(e) {
    const v = scale(e.per100, e.amount);
    return el('button', { type: 'button', class: 'list-item entry-row', onClick: () => editEntry(e) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, e.name),
        el('div', { class: 'li-sub' }, isQuick(e) ? (e.name === 'Quick add' ? macroText(v) : `Quick add · ${macroText(v)}`) : [fmtAmount(e.amount, e.basis), e.brand].filter(Boolean).join(' · '))),
      el('div', { class: 'li-trail num' }, fmtGrouped(v.kcal, 0), el('span', { class: 'vh' }, ' kcal')));
  }

  // ---------------------------------------------------------------- entry sheet
  function editEntry(entry) {
    let draft = { ...entry, per100: { ...entry.per100 } };
    const quick = isQuick(entry);
    const amount = numberInput({ value: entry.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: 'Amount', onInput: update });
    amount.classList.add('portion-amount');
    const values = el('div', { class: 'portion-values' });
    const nameEl = el('div', { class: 't-head portion-name' }, entry.name);
    const mealSel = mealSelect(entry.meal);
    const dateIn = dateInput(entry.date);
    let alsoUpdateFood = false;
    const sheet = openSheet({
      title: quick ? 'Quick add' : 'Edit entry',
      className: 'portion-sheet',
      content: [
        el('div', { class: 'portion-head' }, nameEl, entry.brand ? el('div', { class: 't-sub muted' }, entry.brand) : null),
        quick ? null : field('Amount', amount, { unit: entry.basis }),
        values,
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: editValues }, icon('pencil'), 'Edit values'),
        mealDateRow(mealSel, dateIn),
      ],
    });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: del }, icon('trash-2'), 'Delete'),
      el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, 'Save'));

    function update() {
      const v = scale(draft.per100, quick ? 100 : amount.getNumber() ?? 0);
      nameEl.textContent = draft.name;
      replaceChildren(values, portionValues(v));
    }
    async function editValues() {
      const food = quick ? { ...draft, name: draft.name } : draft;
      const r = await openFoodEditor({
        food, mode: 'entry', title: quick ? 'Quick add values' : 'Edit entry values', canUpdateFood: !quick && Boolean(entry.foodId),
      });
      if (!r) return;
      draft = { ...draft, name: r.food.name, basis: r.food.basis, per100: r.food.per100 };
      alsoUpdateFood = r.alsoUpdateFood;
      update();
    }
    async function save() {
      const a = quick ? 100 : amount.getNumber();
      const d = dateIn.getValue();
      if (a === null || a <= 0) { amount.focus(); return; }
      if (!d) { toast('Choose a valid date.', { type: 'error' }); return; }
      const updated = { ...draft, amount: a, meal: mealSel.value, date: d };
      try {
        await putEntry(updated);
        if (alsoUpdateFood) {
          const f = await getFood(entry.foodId);
          if (f) await updateFoodFromEntry(updated);
        }
        sheet.close(true);
        toast(d !== date ? `Moved to ${fmtDay(d)}` : 'Entry saved', { type: 'success' });
        render();
      } catch (err) {
        console.error(err);
        toast(`Could not save: ${err.message || err}`, { type: 'error' });
      }
    }
    async function del() {
      await removeEntry(entry.id);
      sheet.close(true);
      render();
      toast(`Deleted ${entry.name}`, { action: { label: 'Undo', onClick: async () => { await putEntries([entry]); render(); } } });
    }
    update();
  }

  // ---------------------------------------------------------------- meal menu
  function mealMenu(m, list) {
    const item = (iconName, label, onClick, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick },
      icon(iconName, { class: 'li-lead' }), el('span', { class: 'li-main' }, label));
    const sheet = openSheet({
      title: m.label,
      content: el('div', { class: 'list menu-list' },
        item('copy', 'Copy to another day…', () => { sheet.close(); copyMeal(m, list); }),
        item('bookmark', 'Save as meal…', () => { sheet.close(); openSaveAsMeal(list, `${m.label} ${fmtDate(date)}`); }),
        item('trash-2', `Delete all (${list.length})`, () => { sheet.close(); deleteAll(m, list); }, 'text-danger')),
    });
  }

  function copyMeal(m, list) {
    const dateIn = dateInput(isToday ? addDays(date, 1) : today());
    const mealSel = mealSelect(m.id);
    const sheet = openSheet({
      title: `Copy ${m.label.toLowerCase()}`,
      content: [
        el('p', { class: 't-sub muted num' }, `${list.length} item${list.length === 1 ? '' : 's'} · ${fmtGrouped(totals(list).kcal, 0)} kcal`),
        mealDateRow(mealSel, dateIn, { dateLabel: 'To date', mealFirst: false }),
      ],
    });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn', onClick: () => sheet.close() }, 'Cancel'),
      el('button', { type: 'button', class: 'btn btn-primary grow', onClick: async () => {
        const d = dateIn.getValue();
        if (!d) { toast('Choose a valid date.', { type: 'error' }); return; }
        const copies = copyEntries(list, { date: d, meal: mealSel.value, now: Date.now(), newId: uuid });
        await putEntries(copies);
        sheet.close();
        if (d === date) render();
        toast(`Copied to ${mealLabel(mealSel.value)}, ${fmtDay(d)}`, { type: 'success', action: { label: 'Open', onClick: () => navigate(`diary/${d}`) } });
      } }, 'Copy'));
  }

  async function deleteAll(m, list) {
    await removeEntries(list.map((e) => e.id));
    render();
    toast(`Deleted ${list.length} from ${m.label}`, { action: { label: 'Undo', onClick: async () => { await putEntries(list); render(); } } });
  }

  // Keep in sync if targets change elsewhere or the tab regains focus (e.g. the day rolled over).
  const onVisible = async () => { if (!document.hidden) { targets = await getTargets(); render(); } };
  document.addEventListener('visibilitychange', onVisible);

  await render();
  return () => document.removeEventListener('visibilitychange', onVisible);
}
