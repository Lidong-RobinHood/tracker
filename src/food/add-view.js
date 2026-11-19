// Add-food screen: tabs Search · Scan · Recent · Meals · Quick add. Every food path ends in the portion sheet.
// Quick add also holds "Scan meal photo" (AI estimate → review → log); old ?tab=photo links open it there.
import {
  el, pageHeader, numberInput, field, toast, emptyState, fmtGrouped, fmtDate, fmtAmount, back, iconTabs, segmented, sectionHeader,
  cardHeader, iconButton, icon, infoButton, replaceChildren,
} from '../ui/index.js';
import { isComplete, missingFields, macroKcal, emptyPer100 } from '../core/nutrition.js';
import { checkDigitOk } from '../core/barcode.js';
import { indexItem, search, preferMatches } from '../core/food-search.js';
import { mealLabel, usedFoods, quickAddEntry } from '../core/food-diary.js';
import { allFoods, allMeals, findByBarcode, preferStored, putEntry } from './store.js';
import { lookupBarcode, searchProducts, searchWait } from './off-api.js';
import { searchGeneric } from './generic.js';
import { createScanner } from './scanner.js';
import { openPortion, editAndSaveFood } from './portion.js';
import { openLogMeal, openEditMeal, mealKcal } from './meals.js';
import { foodRow, ensureCss, per100Text, offCredit } from './widgets.js';
import { buildPhotoScan, PHOTO_DRAFT } from './photo-tab.js';
import { loadDraft, saveDraft, clearDraft } from '../ui/draft.js';

const TABS = [
  { value: 'search', label: 'Search', icon: 'search' },
  { value: 'scan', label: 'Scan', icon: 'scan-barcode' },
  { value: 'recent', label: 'Recent', icon: 'history' },
  { value: 'meals', label: 'Meals', icon: 'bookmark' },
  { value: 'quick', label: 'Quick add', icon: 'pencil' },
];
const TAB_KEY = 'tracker.food.addTab';
const OFF_AUTO_MS = 1100;   // pause before an automatic OFF search
const OFF_MIN_CHARS = 3;

function rememberTab(t) { try { localStorage.setItem(TAB_KEY, t); } catch { /* storage blocked */ } }
function lastTab() { try { return localStorage.getItem(TAB_KEY); } catch { return null; } }

/** Route: food/add/:date/:meal */
export async function mountAdd(container, params, ctx) {
  ensureCss();
  const date = params.date;
  const meal = params.meal;
  const cleanups = [];
  let done = false;

  container.append(pageHeader({ title: `Add to ${mealLabel(meal)}`, subtitle: fmtDate(date), back: `diary/${date}` }));

  /** After a successful log, go back to the diary. */
  const finished = () => { if (!done) { done = true; back(`diary/${date}`); } };

  /** Open the portion sheet; on success go back to the diary. Returns true if logged. */
  async function toPortion(food, extra = {}) {
    const r = await openPortion({ food, date, meal, ...extra });
    if (r) finished();
    return Boolean(r);
  }

  /** Incomplete or unknown food: editor first, then portion. */
  async function toEditorThenPortion(food, { note, kcalConverted } = {}) {
    const saved = await editAndSaveFood(food, { note, kcalConverted, title: food.name ? 'Complete the values' : 'New food', saveLabel: 'Save & continue' });
    if (saved) return toPortion(saved);
    return false;
  }

  /** Any food picked from a list. Prefers the user's stored copy (their corrections win). */
  async function pick(food, { kcalConverted = false } = {}) {
    const f = await preferStored(food);
    if (!isComplete(f)) {
      return toEditorThenPortion(f, { kcalConverted, note: `Missing: ${missingFields(f).join(', ')}. Copy them from the label.` });
    }
    return toPortion(f, { kcalConverted: f === food && kcalConverted });
  }

  const panels = {};
  const body = el('div', { class: 'add-body' });
  const tabs = iconTabs({ tabs: TABS, value: 'search', onChange: (t) => show(t), ariaLabel: 'Add food' });
  tabs.classList.add('add-tabs');
  container.append(tabs, body);

  let active = null;
  function show(t) {
    if (active === t) return;
    if (active && panels[active] && panels[active].hide) panels[active].hide();
    active = t;
    rememberTab(t);
    tabs.setValue(t);
    if (!panels[t]) panels[t] = builders[t]();
    replaceChildren(body, panels[t].el);
    if (panels[t].show) panels[t].show();
  }

  // ------------------------------------------------------------ search
  function buildSearch() {
    const input = el('input', { type: 'search', placeholder: 'Search foods', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search foods' });
    const searchField = el('label', { class: 'search-field' }, icon('search'), input);
    const localSec = el('div', { class: 'stack' });
    const genericSec = el('div', { class: 'stack' });
    const offSec = el('div', { class: 'stack' });
    const offBtn = el('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => runOff(true) }, icon('search'), 'Search Open Food Facts');
    const createBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => toEditorThenPortion({ source: 'custom', name: input.value.trim(), per100: emptyPer100(), servings: [], basis: 'g' }) }, icon('plus'), 'Create a food');
    const wrap = el('div', { class: 'stack' }, searchField, localSec, genericSec, offSec, el('div', { class: 'row-between search-actions' }, offBtn, createBtn));

    let localIndex = null;
    let seq = 0;
    let offTimer = null;
    let offCtrl = null;
    let lastOffQuery = '';

    async function ensureLocal() {
      if (!localIndex) localIndex = (await allFoods()).map((f) => indexItem(f, `${f.name} ${f.brand || ''}`));
      return localIndex;
    }

    function section(title, items, note) {
      return [
        sectionHeader(title),
        items && items.length ? el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, items)) : null,
        note ? el('p', { class: 't-sub muted search-note' }, note) : null,
      ].filter(Boolean);
    }

    async function runLocal() {
      const q = input.value.trim();
      const my = ++seq;
      if (!q) {
        replaceChildren(localSec); replaceChildren(genericSec); replaceChildren(offSec); offBtn.hidden = true;
        const recent = usedFoods(await ensureLocal().then((ix) => ix.map((e) => e.item)), { limit: 8 });
        if (my !== seq) return;
        if (recent.length) replaceChildren(localSec, ...section('Recent', recent.map((f) => foodRow(f, { onClick: () => pick(f) }))));
        return;
      }
      offBtn.hidden = false;
      const local = search(q, await ensureLocal(), { limit: 10 });
      if (my !== seq) return;
      replaceChildren(localSec, ...(local.length ? section('Your foods', local.map((f) => foodRow(f, { onClick: () => pick(f) }))) : []));
      if (q.length < 2) { replaceChildren(genericSec); return; }
      if (!genericSec.childElementCount) replaceChildren(genericSec, el('p', { class: 't-sub muted search-note' }, 'Loading generic foods…'));
      try {
        const gen = await searchGeneric(q, 15);
        if (my !== seq) return;
        replaceChildren(genericSec, ...(gen.length ? section('Generic foods · USDA', gen.map((f) => foodRow(f, { onClick: () => pick(f) }))) : []));
      } catch (err) {
        if (my !== seq) return;
        console.warn('Generic foods:', err);
        replaceChildren(genericSec, el('p', { class: 't-sub text-danger search-note' }, `Generic foods unavailable${navigator.onLine === false ? ' offline' : ''}. Try again later.`));
      }
    }

    async function runOff(explicit = false) {
      clearTimeout(offTimer);
      const q = input.value.trim();
      if (!q || (!explicit && q.length < OFF_MIN_CHARS)) return;
      if (!explicit && q === lastOffQuery) return;
      if (offCtrl) offCtrl.abort();
      const ctrl = offCtrl = new AbortController();
      lastOffQuery = q;
      replaceChildren(offSec, ...section('Open Food Facts', null, 'Searching Open Food Facts…'));
      let r;
      try {
        r = await searchProducts(q, { signal: ctrl.signal });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        r = { ok: false, error: String(err.message || err) };
      }
      if (ctrl !== offCtrl || input.value.trim() !== q) return; // stale
      offCtrl = null;
      if (!r.ok) {
        lastOffQuery = '';
        replaceChildren(offSec, ...section('Open Food Facts', null), el('p', { class: 't-sub text-danger search-note', role: 'status' }, r.error));
        return;
      }
      const ranked = preferMatches(q, r.results, (m) => `${m.food.name} ${m.food.brand || ''}`);
      const rows = ranked.slice(0, 20).map((m) => foodRow(m.food, {
        onClick: () => pick(m.food, { kcalConverted: m.kcalConverted }),
        sub: m.missing.length ? 'incomplete' : (m.kcalConverted ? 'kcal from kJ' : null),
        trail: m.food.per100.kcal === null ? '– kcal' : per100Text(m.food),
      }));
      replaceChildren(offSec, ...section('Open Food Facts', rows, rows.length ? null : 'No products found.'), rows.length ? offCredit() : '');
    }

    let localTimer = null;
    input.addEventListener('input', () => {
      clearTimeout(localTimer);
      localTimer = setTimeout(runLocal, 80);
      clearTimeout(offTimer);
      if (offCtrl && input.value.trim() !== lastOffQuery) { offCtrl.abort(); offCtrl = null; }
      if (input.value.trim() !== lastOffQuery) replaceChildren(offSec);
      if (input.value.trim().length >= OFF_MIN_CHARS) {
        offTimer = setTimeout(() => runOff(false), Math.max(OFF_AUTO_MS, searchWait()));
      }
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); runOff(true); } });
    cleanups.push(() => { clearTimeout(offTimer); clearTimeout(localTimer); if (offCtrl) offCtrl.abort(); });

    return {
      el: wrap,
      show() {
        localIndex = null; // foods may have changed (edited/logged)
        runLocal();
        requestAnimationFrame(() => input.focus());
      },
    };
  }

  // ------------------------------------------------------------ scan
  function buildScan() {
    const video = el('video', { class: 'scan-video', muted: true, playsinline: true, autoplay: true, 'aria-label': 'Camera preview' });
    video.muted = true;
    const status = el('p', { class: 't-sub muted scan-status', role: 'status' }, 'Starting…');
    const cameraInfo = infoButton('camera');
    cameraInfo.hidden = true;
    const startBtn = el('button', { type: 'button', class: 'btn btn-primary scan-toggle', onClick: () => scanner.start() }, icon('scan-barcode'), 'Scan');
    const stopBtn = el('button', { type: 'button', class: 'btn scan-toggle', hidden: true, onClick: () => { scanner.stop(); setStatus('Camera off.'); } }, icon('x'), 'Stop');
    const box = el('div', { class: 'scan-box' }, video,
      el('div', { class: 'scan-frame', 'aria-hidden': 'true' }, el('div', { class: 'scan-guide' })),
      el('div', { class: 'scan-idle', 'aria-hidden': 'true' }, icon('scan-barcode', { size: 32 })));
    const code = el('input', { class: 'input input-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: 'e.g. 3017620422003', 'aria-label': 'Barcode', maxlength: '14', enterkeyhint: 'search' });
    const codeMsg = el('p', { class: 't-sub', role: 'status' });
    const result = el('div', { class: 'stack scan-result' });
    const form = el('form', { class: 'row barcode-form', onSubmit: (e) => { e.preventDefault(); manual(); } },
      code, el('button', { type: 'submit', class: 'btn' }, 'Look up'));
    const wrap = el('div', { class: 'stack' },
      box,
      el('div', { class: 'row scan-status-row' }, status, cameraInfo),
      el('div', { class: 'row scan-buttons' }, startBtn, stopBtn),
      sectionHeader('Or type the barcode'), form, codeMsg, result);

    function setStatus(msg, isErr) {
      status.textContent = msg;
      status.className = `t-sub scan-status ${isErr ? 'text-danger' : 'muted'}`;
      cameraInfo.hidden = !(isErr && /^Camera blocked/.test(msg)); // the sheet explains how to allow the camera
    }
    const scanner = createScanner({
      video,
      force: ctx.query.decoder,
      onStatus: setStatus,
      onState: (on) => { startBtn.hidden = on; stopBtn.hidden = !on; box.classList.toggle('is-on', on); },
      onCode: (c, info) => { setStatus(`Read ${c}${info.note ? ` (${info.note})` : ''}.`); handleBarcode(c); },
    });
    cleanups.push(() => scanner.destroy());

    function manual() {
      const v = code.value.replace(/\s+/g, '');
      codeMsg.className = 't-sub text-danger';
      if (!/^\d{8}$|^\d{12,14}$/.test(v)) { codeMsg.textContent = 'Enter 8, 12, 13 or 14 digits.'; return; }
      if (!checkDigitOk(v)) { codeMsg.textContent = 'Check digit does not match. Re-check the number.'; return; }
      codeMsg.textContent = '';
      code.blur();
      scanner.stop();
      handleBarcode(v);
    }

    let lookupCtrl = null;
    async function handleBarcode(c) {
      if (lookupCtrl) lookupCtrl.abort();
      const ctrl = lookupCtrl = new AbortController();
      replaceChildren(result, el('p', { class: 't-sub muted num' }, `Looking up ${c}…`));
      const local = await findByBarcode(c);
      if (ctrl.signal.aborted) return;
      if (local) {
        replaceChildren(result, el('p', { class: 't-sub muted' }, `${local.name} – from your foods.`));
        const logged = isComplete(local) ? await toPortion(local) : await toEditorThenPortion(local, { note: 'Values missing. Copy them from the label.' });
        if (!logged) afterClose();
        return;
      }
      let r;
      try { r = await lookupBarcode(c, { signal: ctrl.signal }); } catch { return; }
      if (ctrl.signal.aborted) return;
      lookupCtrl = null;
      if (r.outcome === 'complete') {
        replaceChildren(result, el('p', { class: 't-sub muted' }, `${r.food.name} – Open Food Facts.`), offCredit());
        if (!(await toPortion(r.food, { kcalConverted: r.kcalConverted }))) afterClose();
      } else if (r.outcome === 'incomplete') {
        replaceChildren(result, el('p', { class: 't-sub muted' }, `${r.food.name || c} – incomplete on Open Food Facts.`), offCredit());
        const ok = await toEditorThenPortion(r.food, { kcalConverted: r.kcalConverted, note: `Missing: ${r.missing.join(', ')}. Copy them from the label; saved for next time.` });
        if (!ok) afterClose();
      } else if (r.outcome === 'not_found') {
        replaceChildren(result, el('p', { class: 't-sub muted num' }, `${c} is not on Open Food Facts.`));
        const ok = await toEditorThenPortion({ source: 'custom', barcode: c, name: '', brand: null, basis: 'g', per100: emptyPer100(), servings: [] },
          { note: 'Not found. Enter it once from the label; it is saved for next time.' });
        if (!ok) afterClose();
      } else {
        replaceChildren(result,
          el('p', { class: 'text-danger t-sub', role: 'alert' }, r.error),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn btn-sm', onClick: () => handleBarcode(c) }, icon('refresh-cw'), 'Retry'),
            el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => toEditorThenPortion({ source: 'custom', barcode: c, name: '', basis: 'g', per100: emptyPer100(), servings: [] }) }, 'Enter values manually')));
      }
    }
    function afterClose() {
      if (active === 'scan' && !done) setStatus('Camera off.');
    }

    return {
      el: wrap,
      show() { if (!done) scanner.start(); },
      hide() { scanner.stop(); if (lookupCtrl) lookupCtrl.abort(); },
    };
  }

  // ------------------------------------------------------------ recent
  function buildRecent() {
    let by = 'recent';
    const list = el('div');
    const toggle = segmented({ options: [{ value: 'recent', label: 'Recent' }, { value: 'frequent', label: 'Most used' }], value: by, onChange: (v) => { by = v; render(); }, ariaLabel: 'Sort' });
    const wrap = el('div', { class: 'stack' }, toggle, list);
    async function render() {
      const foods = usedFoods(await allFoods(), { by, limit: 60 });
      replaceChildren(list, foods.length
        ? el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, foods.map((f) => foodRow(f, {
          onClick: () => pick(f),
          sub: f.lastAmount ? `last ${fmtAmount(f.lastAmount, f.basis)}` : null,
          trail: by === 'frequent' ? `${fmtGrouped(f.useCount, 0)}×` : per100Text(f),
        }))))
        : emptyState('Foods you log appear here.'));
    }
    return { el: wrap, show: render };
  }

  // ------------------------------------------------------------ saved meals
  function buildMeals() {
    const list = el('div');
    const wrap = el('div', { class: 'stack' }, list);
    async function render() {
      const meals = await allMeals();
      replaceChildren(list, meals.length
        ? el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, meals.map((m) => el('div', { class: 'list-item meal-row' },
          el('button', { type: 'button', class: 'li-main meal-open', onClick: () => open(m) },
            el('div', { class: 'li-title' }, m.name),
            el('div', { class: 'li-sub num' }, `${m.items.length} item${m.items.length === 1 ? '' : 's'} · ${fmtGrouped(mealKcal(m), 0)} kcal`)),
          iconButton('pencil', { label: `Edit ${m.name}`, onClick: () => edit(m) })))))
        : el('div', { class: 'empty' }, el('p', null, 'No saved meals. Save one from a diary meal’s ', icon('ellipsis', { size: 16, label: 'more' }), ' menu.')));
    }
    async function open(m) {
      const r = await openLogMeal(m, { date, meal, onChange: render });
      if (r === 'logged') finished();
      else if (r === 'changed') render();
    }
    async function edit(m) { if (await openEditMeal(m, { onChange: render })) render(); }
    return { el: wrap, show: render };
  }

  // ------------------------------------------------------------ quick add
  function buildQuick() {
    const name = el('input', { class: 'input', type: 'text', placeholder: 'Optional', maxlength: '80', autocomplete: 'off' });
    const kcal = numberInput({ min: 0, max: 10000, decimals: 0, ariaLabel: 'Calories', onInput: hint });
    const protein = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: 'Protein', onInput: hint });
    const carbs = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: 'Carbohydrates', onInput: hint });
    const fat = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: 'Fat', onInput: hint });
    const kcalField = field('Calories *', kcal, { unit: 'kcal' });
    const hintEl = el('p', { class: 'field-hint' });
    // Half-filled form survives a reload (iOS evicting the app): localStorage draft per date + meal.
    const QUICK_DRAFT = 'quick-add';
    const inputs = { name, kcal, protein, carbs, fat };
    const saveQuick = () => {
      const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
      if (Object.values(v).some((x) => x.trim())) saveDraft(QUICK_DRAFT, { date, meal, ...v });
      else clearDraft(QUICK_DRAFT);
    };
    for (const i of Object.values(inputs)) i.addEventListener('input', saveQuick);
    const qd = loadDraft(QUICK_DRAFT);
    const restoredNote = qd && qd.date === date && qd.meal === meal
      ? el('p', { class: 't-sub editor-note', role: 'status' }, 'Draft restored.') : null;
    if (restoredNote) { for (const [k, i] of Object.entries(inputs)) i.value = typeof qd[k] === 'string' ? qd[k] : ''; hint(); }
    function hint() {
      const m = macroKcal({ protein: protein.getNumber(), carbs: carbs.getNumber(), fat: fat.getNumber() });
      hintEl.textContent = m ? `Macros = ${fmtGrouped(m, 0)} kcal` : '';
      if (kcal.getNumber() !== null) kcalField.classList.remove('is-missing');
    }
    async function add() {
      const k = kcal.getNumber();
      if (k === null) { kcalField.classList.add('is-missing'); kcal.focus(); return; }
      for (const i of [protein, carbs, fat]) if (i.value.trim() && i.getNumber() === null) { i.focus(); toast('Enter a valid number.', { type: 'error' }); return; }
      const e = quickAddEntry({ id: crypto.randomUUID(), date, meal, name: name.value, kcal: k, protein: protein.getNumber(), carbs: carbs.getNumber(), fat: fat.getNumber(), now: Date.now() });
      await putEntry(e);
      clearDraft(QUICK_DRAFT);
      toast(`Added ${fmtGrouped(k, 0)} kcal to ${mealLabel(meal)}`, { type: 'success' });
      finished();
    }
    const manualCard = el('div', { class: 'card stack quick-manual' },
      cardHeader('Enter by hand'),
      restoredNote,
      field('Name', name),
      kcalField,
      el('div', { class: 'grid-3' }, field('Protein', protein, { unit: 'g' }), field('Carbs', carbs, { unit: 'g' }), field('Fat', fat, { unit: 'g' })),
      hintEl,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: add }, `Add to ${mealLabel(meal)}`));
    // Photo estimate section above the manual form. It only hides the form while an estimate is shown;
    // typed values stay in the fields.
    const scan = buildPhotoScan({
      date, meal, cleanups, onFinished: finished,
      manual: {
        hasValues: () => [name, kcal, protein, carbs, fat].some((i) => i.value.trim() !== ''),
        name: () => name.value,
        setHidden: (h) => { manualCard.hidden = h; },
      },
    });
    const wrap = el('div', { class: 'stack quick-panel' }, scan.el, manualCard);
    return {
      el: wrap,
      show() {
        scan.show();
        if (photoFirst) {
          photoFirst = false;
          requestAnimationFrame(() => scan.el.scrollIntoView({ block: 'start' }));
        } else if (!manualCard.hidden) {
          requestAnimationFrame(() => kcal.focus({ preventScroll: true }));
        }
      },
    };
  }

  const builders = { search: buildSearch, scan: buildScan, recent: buildRecent, meals: buildMeals, quick: buildQuick };
  // An unfinished photo review or quick add for this date and meal (restored after a reload) opens Quick add.
  const hasDraft = [PHOTO_DRAFT, 'quick-add'].some((n) => { const d = loadDraft(n); return d && d.date === date && d.meal === meal; });
  let want = ctx.query.tab || (hasDraft ? 'quick' : lastTab());
  // The former "Photo" tab now lives in Quick add: old links (and a remembered tab) open it there.
  let photoFirst = want === 'photo';
  if (want === 'photo') want = 'quick';
  show(TABS.some((t) => t.value === want) ? want : 'search');

  return () => {
    done = true;
    for (const c of cleanups) { try { c(); } catch (err) { console.error(err); } }
  };
}
