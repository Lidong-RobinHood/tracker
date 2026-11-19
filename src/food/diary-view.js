// Diary: day view with four meals, per-meal and day totals vs targets, entry editing, copy/save meals.
import {
  el, pageHeader, openSheet, numberInput, toast, fmtNum, fmtDay, fmtDate, fmtAmount, navigate, href, field, replaceChildren,
} from '../ui/index.js';
import { today, addDays, isValidDate, weekStart } from '../core/dates.js';
import { scale } from '../core/nutrition.js';
import { MEALS, mealLabel, groupByMeal, totals, copyEntries, isQuickAdd } from '../core/food-diary.js';
import { targetStatus, shareOfDay, fmtPercent } from '../core/food-percent.js';
import { dayEntries, putEntry, putEntries, removeEntry, removeEntries, getTargets, updateFoodFromEntry, getFood } from './store.js';
import { openFoodEditor } from './food-editor.js';
import { openSaveAsMeal } from './meals.js';
import { ensureCss, mealSelect, dateInput, macroText } from './widgets.js';
import { PHOTO_DRAFT } from './photo-tab.js';
import { loadDraft } from '../ui/draft.js';

const LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const uuid = () => crypto.randomUUID();
// Quick add = no food behind it AND stored as amount 100 (per100 = the totals). Photo items that were not
// remembered also have no food but keep their real amount, so they stay editable by amount.
const isQuick = (e) => isQuickAdd(e) && e.amount === 100;

/** Route: diary, diary/:date */
export async function mountDiary(container, params) {
  ensureCss();
  const date = params.date && isValidDate(params.date) ? params.date : today();
  const isToday = date === today();
  const go = (d) => navigate(`diary/${d}`, { replace: true });

  const picker = dateInput(date, { ariaLabel: 'Jump to date', onChange: (d) => { if (d !== date) go(d); } });
  picker.classList.add('date-picker-input');
  picker.addEventListener('click', () => { try { picker.showPicker(); } catch { /* not supported: native tap opens it */ } });
  const pickerBtn = el('label', { class: 'btn btn-icon btn-ghost date-picker', title: 'Pick a date' }, calendarIcon(), picker);

  container.append(pageHeader({
    title: fmtDay(date),
    subtitle: fmtDay(date) === fmtDate(date) ? null : fmtDate(date),
    actions: [
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'Previous day', onClick: () => go(addDays(date, -1)) }, '‹'),
      pickerBtn,
      el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': 'Next day', onClick: () => go(addDays(date, 1)) }, '›'),
    ],
  }));
  const todayLink = isToday ? null : el('a', { class: 'btn btn-sm today-link', href: href(`diary/${today()}`) }, 'Jump to today');
  const summary = el('section', { class: 'card day-summary', 'aria-label': 'Day totals' });
  const mealsWrap = el('div', { class: 'stack' });
  // A meal-photo review left unfinished (e.g. the app was reloaded) is kept for 24 h: offer to continue.
  const pd = loadDraft(PHOTO_DRAFT);
  const draftLink = pd && isValidDate(pd.date) && Array.isArray(pd.rows)
    ? el('a', { class: 'card row-between photo-draft-link', href: href(`food/add/${pd.date}/${pd.meal}?tab=quick`) },
      el('span', { class: 'small' }, `Unfinished meal-photo estimate for ${mealLabel(pd.meal)}, ${fmtDay(pd.date)}`),
      el('span', { class: 'small' }, 'Continue ›'))
    : null;
  container.append(...[todayLink, draftLink, summary, mealsWrap].filter(Boolean));

  let targets = await getTargets();
  let entries = [];

  async function render() {
    entries = await dayEntries(date);
    renderSummary();
    const byMeal = groupByMeal(entries);
    const dayKcal = totals(entries).kcal;
    mealsWrap.replaceChildren(...MEALS.map((m) => mealCard(m, byMeal[m.id], dayKcal)));
  }

  function renderSummary() {
    const t = totals(entries);
    // One rounding rule for everything shown: eaten rounded once, left/over from the rounded value.
    const st = Object.fromEntries(['kcal', 'protein', 'carbs', 'fat'].map((k) => [k, targetStatus(t[k], targets && targets[k])]));
    const kcal = st.kcal;
    replaceChildren(summary,
      el('div', { class: 'kcal-line' },
        el('div', null, el('div', { class: 'kcal-big num' }, fmtNum(kcal.eaten, 0)), el('div', { class: 'small muted' }, `of ${fmtNum(kcal.target, 0)} kcal`, pctEl(kcal, ' · '))),
        el('div', { class: 'kcal-remaining' },
          el('div', { class: ['kcal-big num', kcal.isOver ? 'text-warning' : null] }, fmtNum(kcal.isOver ? kcal.over : kcal.left ?? 0, 0)),
          el('div', { class: 'small muted' }, kcal.isOver ? 'kcal over' : 'kcal left'))),
      bar(kcal, 'kcal'),
      el('div', { class: 'macro-bars' }, ['protein', 'carbs', 'fat'].map((key) => {
        const x = st[key];
        return el('div', { class: 'macro-bar' },
          el('div', { class: 'small macro-label' }, el('span', null, LABEL[key]), pctEl(x)),
          el('div', { class: 'num macro-amounts' }, `${fmtNum(x.eaten, 0)}`, el('span', { class: 'muted small' }, ` / ${fmtNum(x.target, 0)} g`)),
          bar(x, key),
          el('div', { class: ['small num', x.isOver ? 'text-warning' : 'muted'] }, x.target === null ? '' : x.isOver ? `${fmtNum(x.over, 0)} g over` : `${fmtNum(x.left, 0)} g left`));
      })),
      // Weekly report for the Mon–Sun week of the day being viewed (route owned by trends).
      el('a', { class: 'week-report-link', href: href(`trends/week/${weekStart(date)}`) }, 'Weekly report', el('span', { 'aria-hidden': 'true' }, ' ›')));
  }

  /** '62 %' (warning colour and bold when over target); nothing if there is no target. */
  function pctEl(x, prefix = '') {
    if (!x || x.pct === null) return null;
    return el('span', { class: ['num pct', x.isOver ? 'text-warning pct-over' : null], title: x.isOver ? 'Over target' : 'Of daily target' }, `${prefix}${fmtPercent(x.pct)}`);
  }

  /** @param {ReturnType<typeof targetStatus>} x */
  function bar(x, key) {
    const pct = Math.max(0, Math.min(1, x.fraction)) * 100;
    return el('div', {
      class: ['bar', `bar-${key}`, x.isOver ? 'is-over' : null], role: 'progressbar',
      'aria-label': LABEL[key], 'aria-valuemin': '0', 'aria-valuemax': String(x.target ?? 0), 'aria-valuenow': String(x.eaten),
    }, el('div', { class: 'bar-fill', style: { width: `${pct}%` } }));
  }

  function mealCard(m, list, dayKcal) {
    const t = totals(list);
    const share = list.length ? shareOfDay(t.kcal, dayKcal) : null;
    return el('section', { class: 'card card-flush meal-card', 'aria-label': m.label },
      el('div', { class: 'meal-head' },
        el('div', { class: 'grow' },
          el('h2', { class: 'meal-title' }, m.label),
          list.length ? el('div', { class: 'small muted num' }, macroText(t)) : null),
        el('div', { class: 'num meal-kcal' }, list.length ? `${fmtNum(t.kcal, 0)} kcal` : '',
          share === null ? null : el('div', { class: 'small muted meal-share', 'aria-label': `${share} percent of the day's calories`, title: 'Share of the day’s calories' }, fmtPercent(share))),
        list.length ? el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `${m.label} options`, onClick: () => mealMenu(m, list) }, '⋯') : null),
      list.length ? el('div', { class: 'list' }, list.map(entryRow)) : null,
      el('a', { class: 'list-item add-row', href: href(`food/add/${date}/${m.id}`) }, el('span', { class: 'add-plus', 'aria-hidden': 'true' }, '+'), `Add to ${m.label}`));
  }

  function entryRow(e) {
    const v = scale(e.per100, e.amount);
    return el('button', { type: 'button', class: 'list-item entry-row', onClick: () => editEntry(e) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, e.name),
        el('div', { class: 'li-sub' }, isQuick(e) ? (e.name === 'Quick add' ? macroText(v) : `Quick add · ${macroText(v)}`) : [fmtAmount(e.amount, e.basis), e.brand].filter(Boolean).join(' · '))),
      el('div', { class: 'li-trail num' }, `${fmtNum(v.kcal, 0)}`, el('span', { class: 'small muted' }, ' kcal')));
  }

  // ---------------------------------------------------------------- entry sheet
  function editEntry(entry) {
    let draft = { ...entry, per100: { ...entry.per100 } };
    const quick = isQuick(entry);
    const amount = numberInput({ value: entry.amount, min: 0.1, max: 10000, decimals: 1, ariaLabel: 'Amount', onInput: update });
    const values = el('div', { class: 'portion-values card' });
    const nameEl = el('div', { class: 'portion-name' }, entry.name);
    const mealSel = mealSelect(entry.meal);
    const dateIn = dateInput(entry.date);
    let alsoUpdateFood = false;
    const sheet = openSheet({
      title: quick ? 'Quick add' : 'Edit entry',
      content: [
        el('div', { class: 'portion-head' }, nameEl, entry.brand ? el('div', { class: 'small muted' }, entry.brand) : null),
        quick ? null : field('Amount', amount, { unit: entry.basis }),
        values,
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: editValues }, quick ? '✎ Edit calories & macros' : '✎ Edit values'),
        el('div', { class: 'grid-2' },
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Date'), dateIn)),
      ],
    });
    sheet.footer.append(
      el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: del }, 'Delete'),
      el('button', { type: 'button', class: 'btn btn-primary grow', onClick: save }, 'Save'));

    function update() {
      const v = scale(draft.per100, quick ? 100 : amount.getNumber() ?? 0);
      nameEl.textContent = draft.name;
      values.replaceChildren(
        el('div', { class: 'portion-kcal num' }, el('span', { class: 'big' }, fmtNum(v.kcal, 0)), ' kcal'),
        el('div', { class: 'small muted num' }, macroText(v)));
    }
    async function editValues() {
      const food = quick ? { ...draft, name: draft.name } : draft;
      const r = await openFoodEditor({
        food, mode: 'entry', title: quick ? 'Quick add values' : 'Edit entry values', canUpdateFood: !quick && Boolean(entry.foodId),
        note: quick ? 'Quick add is stored per 100 g = the totals you entered.' : null,
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
    const sheet = openSheet({
      title: m.label,
      content: el('div', { class: 'list menu-list' },
        el('button', { type: 'button', class: 'list-item', onClick: () => { sheet.close(); copyMeal(m, list); } }, el('span', { class: 'li-main' }, 'Copy to another day…')),
        el('button', { type: 'button', class: 'list-item', onClick: () => { sheet.close(); openSaveAsMeal(list, `${m.label} ${fmtDate(date)}`); } }, el('span', { class: 'li-main' }, 'Save as meal…')),
        el('button', { type: 'button', class: 'list-item text-danger', onClick: () => { sheet.close(); deleteAll(m, list); } }, el('span', { class: 'li-main' }, `Delete all (${list.length})`))),
    });
  }

  function copyMeal(m, list) {
    const dateIn = dateInput(isToday ? addDays(date, 1) : today());
    const mealSel = mealSelect(m.id);
    const sheet = openSheet({
      title: `Copy ${m.label.toLowerCase()}`,
      content: [
        el('p', { class: 'small muted' }, `${list.length} item${list.length === 1 ? '' : 's'}, ${fmtNum(totals(list).kcal, 0)} kcal`),
        el('div', { class: 'grid-2' },
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'To date'), dateIn),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel)),
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

function calendarIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4');
  svg.append(p);
  return svg;
}
