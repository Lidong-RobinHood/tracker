// Creating a custom split (docs/SPLITS.md › Custom splits): the "New split" sheet with three starting
// points (from my routines, from scratch, copy a library split), the routine picker shared with the
// editor, and Customise on a library split. Routines stay ordinary routines; new sessions are made in the
// existing routine editor (src/workout/routines.js).
import * as db from '../db/db.js';
import { el, replaceChildren, icon, iconButton, sectionHeader, toast, navigate } from '../ui/index.js';
import { SPLITS } from '../data/splits.js';
import { autoSwaps } from '../core/splits.js';
import { NEW_ROUTINE_NAME } from '../core/workout.js';
import { exerciseUsage } from '../core/exercise-usage.js';
import { loadRoutines, loadWorkouts, newRoutine, nextRoutineOrder, navAction } from '../workout/data.js';
import { loadChoices, newCustomSplit, saveCustomSplit, copyLibrarySplit, undoCopy, splitPath } from './store.js';
import { t } from '../i18n/index.js';
import { splitName, routineName, styleLabel } from '../i18n/names.js';

/**
 * Click handler: copy a library split (level and swaps from `choices()`) to My splits and open it.
 * @param {object} split @param {() => {level: string, swaps: object}} choices @param {Map<string, object>} exMap
 */
export function customiseAction(split, choices, exMap) {
  return navAction(async () => copyAndOpen(split, choices(), exMap));
}

async function copyAndOpen(split, { level, swaps }, exMap) {
  try {
    const r = await copyLibrarySplit(split, { level, swaps, exMap });
    navigate(splitPath(r.cs.id));
    toast(t('splits.custom.copied'), {
      action: { label: t('splits.undo'), onClick: async () => { await undoCopy(r); navigate('workout/splits', { replace: true }); } },
    });
    return true;
  } catch (err) {
    console.error(err);
    toast(t('splits.custom.copyFailed'), { type: 'error' });
    return false;
  }
}

/** A routine as a tappable row: name, exercise count, trailing icon. */
function routineRow(r, { onClick, trail = 'plus', label }) {
  return el('button', { type: 'button', class: 'list-item sp-pick-row', onClick, 'aria-label': label },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, routineName(r)),
      el('div', { class: 'li-sub' }, t('splits.exercises', { count: r.items.length }))),
    icon(trail, { class: 'sp-pick-ic' }));
}

/**
 * Routine list for a sheet: tapping one calls onPick(routine). Optional first row "New routine".
 * verb: 'add' (rows say "Add <name>", plus icon) or 'use' ("Use <name>", chevron).
 * @param {object[]} routines @param {{onPick: (r: object) => void, onNew?: () => void, verb?: 'add'|'use'}} opts
 */
export function routineList(routines, { onPick, onNew, verb = 'add' }) {
  return el('div', { class: 'list sp-pick' },
    onNew ? el('button', { type: 'button', class: 'list-item sp-pick-row', onClick: onNew },
      icon('plus', { class: 'li-lead' }),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, t('splits.custom.newRoutine'))),
      icon('chevron-right', { class: 'li-chevron' })) : null,
    routines.map((r) => routineRow(r, {
      onClick: () => onPick(r), label: t(verb === 'use' ? 'splits.custom.useAria' : 'splits.custom.addAria', { name: routineName(r) }),
      trail: verb === 'use' ? 'chevron-right' : 'plus',
    })));
}

/** Set an open sheet's title. */
function retitle(sheet, title) {
  const head = sheet.el.querySelector('.overlay-title');
  if (head) head.textContent = title;
}

/**
 * The "New split" sheet (library screen).
 * @param {import('../ui/overlay.js').Overlay|any} sheet an open sheet (openSheet) to fill
 * @param {{exMap: Map<string, object>}} ctx
 */
export async function fillNewSplitSheet(sheet, { exMap }) {
  const routines = await loadRoutines();
  const option = (iconName, title, sub, onClick, disabled = false) => el('button', {
    type: 'button', class: 'list-item', onClick, disabled,
  },
  icon(iconName, { class: 'li-lead' }),
  el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), sub ? el('div', { class: 'li-sub' }, sub) : null),
  icon('chevron-right', { class: 'li-chevron' }));

  const fromScratch = navAction(async () => {
    const cs = await saveCustomSplit(newCustomSplit());
    sheet.close();
    navigate(`${splitPath(cs.id)}?new=1`);
    return true;
  });

  replaceChildren(sheet.body, el('div', { class: 'list sp-new-options' },
    option('list', t('splits.new.fromRoutines'), routines.length ? t('splits.routines', { count: routines.length }) : t('splits.new.noRoutines'), () => buildFromRoutines(sheet, routines), !routines.length),
    option('pencil', t('splits.new.fromScratch'), null, fromScratch),
    option('copy', t('splits.new.copyLibrary'), null, () => pickLibrary(sheet, exMap))));
}

/** Pick routines in order (a routine may be added more than once), then create the split. */
function buildFromRoutines(sheet, routines) {
  retitle(sheet, t('splits.new.fromRoutines'));
  const byId = new Map(routines.map((r) => [r.id, r]));
  const order = [];
  const name = el('input', { class: 'input', type: 'text', maxlength: '60', placeholder: t('splits.custom.defaultName'), 'aria-label': t('splits.new.nameAria'), id: 'sp-new-name' });
  const rotBox = el('div');
  const count = el('span');
  const create = el('button', {
    type: 'button', class: 'btn btn-primary btn-block', disabled: true,
    onClick: navAction(async () => {
      if (!order.length) return false;
      try {
        const cs = await saveCustomSplit(newCustomSplit({ name: name.value.trim(), sessions: order }));
        sheet.close();
        navigate(splitPath(cs.id));
        return true;
      } catch (err) {
        console.error(err);
        toast(t('splits.saveFailed'), { type: 'error' });
        return false;
      }
    }),
  }, t('splits.new.create'));
  const paint = () => {
    count.textContent = order.length ? String(order.length) : '';
    create.disabled = !order.length;
    replaceChildren(rotBox, order.length
      ? el('ol', { class: 'list sp-pick-order' }, order.map((id, i) => el('li', { class: 'list-item' },
        el('span', { class: 'sp-day-n', 'aria-hidden': 'true' }, String(i + 1)),
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, routineName(byId.get(id)))),
        iconButton('x', { label: t('splits.new.removeAria', { name: routineName(byId.get(id)), i: i + 1 }), onClick: () => { order.splice(i, 1); paint(); } }))))
      : el('p', { class: 't-sub muted sp-pick-empty' }, t('splits.new.pickHint')));
  };
  paint();
  replaceChildren(sheet.body,
    el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: 'sp-new-name' }, t('splits.name')), name),
    sectionHeader(t('splits.rotation'), { trail: count }),
    rotBox,
    sectionHeader(t('splits.new.routines')),
    routineList(routines, { onPick: (r) => { order.push(r.id); paint(); } }));
  replaceChildren(sheet.footer, create);
}

/** The 14 library splits; tapping one copies it with the level and swaps chosen on its screen. */
async function pickLibrary(sheet, exMap) {
  retitle(sheet, t('splits.new.copyLibrary'));
  const usage = exerciseUsage(await loadWorkouts());
  replaceChildren(sheet.body, el('div', { class: 'list' }, SPLITS.map((s) => el('button', {
    type: 'button', class: 'list-item',
    onClick: navAction(async () => {
      const saved = loadChoices(s.id);
      const choices = { level: saved.level || 'standard', swaps: autoSwaps(s, { exercises: exMap, usage, swaps: saved.swaps }) };
      sheet.close();
      return copyAndOpen(s, choices, exMap);
    }),
  },
  el('div', { class: 'li-main' },
    el('div', { class: 'li-title' }, splitName(s)),
    el('div', { class: 'li-sub' }, `${t('splits.days', { count: s.days })} · ${styleLabel(s.style)}`)),
  icon('copy', { class: 'sp-pick-ic' })))));
}

/**
 * Create an ordinary routine for a new session and open it in the routine editor. The split is saved
 * first (the caller appends the id), so the round trip and a reload lose nothing; Back in the editor
 * returns here through the browser history.
 * @param {(routineId: string) => Promise<void>} attach saves the split with the new session
 * @param {string} backPath the split's route (passed as ?back= for an editor that honours it)
 */
export async function newSessionRoutine(attach, backPath) {
  const r = newRoutine(NEW_ROUTINE_NAME, [], await nextRoutineOrder()); // stored marker, shown translated (routineName)
  await db.put('routines', r);
  await attach(r.id);
  navigate(`workout/routines/${encodeURIComponent(r.id)}?new=1&back=${encodeURIComponent(backPath)}`);
}

