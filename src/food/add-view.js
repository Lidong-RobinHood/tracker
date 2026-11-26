// Add-food screen: tabs Search · Scan · Recent · Meals · Quick add. Every food path ends in the portion sheet.
// Quick add also holds "Scan meal photo" (AI estimate → review → log); old ?tab=photo links open it there.
import {
  el, pageHeader, numberInput, field, toast, emptyState, fmtGrouped, fmtDate, fmtAmount, back, iconTabs, segmented, sectionHeader,
  cardHeader, iconButton, icon, infoButton, replaceChildren,
} from '../ui/index.js';
import { isComplete, missingFields, macroKcal, emptyPer100 } from '../core/nutrition.js';
import { checkDigitOk } from '../core/barcode.js';
import { indexItem, search, preferMatches } from '../core/food-search.js';
import { usedFoods, quickAddEntry } from '../core/food-diary.js';
import { t, compareText } from '../i18n/index.js';
import { allFoods, allMeals, findByBarcode, preferStored, putEntry } from './store.js';
import { lookupBarcode, searchProducts, searchWait } from './off-api.js';
import { searchGeneric, loadGeneric, ensureDisplayNames, storedFoodNames } from './generic.js';
import { createScanner } from './scanner.js';
import { openPortion, editAndSaveFood } from './portion.js';
import { openLogMeal, openEditMeal, mealKcal } from './meals.js';
import { foodRow, ensureCss, per100Text, offCredit, missingText } from './widgets.js';
import { foodName, mealName, savedMealName } from './names.js';
import { buildPhotoScan, PHOTO_DRAFT } from './photo-tab.js';
import { loadDraft, saveDraft, clearDraft } from '../ui/draft.js';

/** Tabs; labels are catalogue keys (translated when the view mounts). */
const TABS = [
  { value: 'search', label: 'food.add.tab.search', icon: 'search' },
  { value: 'scan', label: 'food.add.tab.scan', icon: 'scan-barcode' },
  { value: 'recent', label: 'food.add.tab.recent', icon: 'history' },
  { value: 'meals', label: 'food.add.tab.meals', icon: 'bookmark' },
  { value: 'quick', label: 'food.add.tab.quick', icon: 'pencil' },
];
const TAB_KEY = 'tracker.food.addTab';
const OFF_AUTO_MS = 1100;   // pause before an automatic OFF search
const OFF_MIN_CHARS = 3;

function rememberTab(tab) { try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage blocked */ } }
function lastTab() { try { return localStorage.getItem(TAB_KEY); } catch { return null; } }

/** Route: food/add/:date/:meal */
export async function mountAdd(container, params, ctx) {
  ensureCss();
  const date = params.date;
  const meal = params.meal;
  const cleanups = [];
  let done = false;

  container.append(pageHeader({ title: t('food.add.title', { meal: mealName(meal) }), subtitle: fmtDate(date), back: `diary/${date}` })); // i18n-ignore (route)
  // Generic food names in the app language before the first list is drawn (cached; no-op in English; loaded
  // only when a stored food is a generic one: search loads them with the dataset).
  await ensureDisplayNames(await allFoods());

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
    const saved = await editAndSaveFood(food, { note, kcalConverted, title: t(food.name ? 'food.editor.completeTitle' : 'food.editor.newTitle'), saveLabel: t('food.editor.saveContinue') });
    if (saved) return toPortion(saved);
    return false;
  }

  /** Any food picked from a list. Prefers the user's stored copy (their corrections win). */
  async function pick(food, { kcalConverted = false } = {}) {
    const f = await preferStored(food);
    if (!isComplete(f)) {
      return toEditorThenPortion(f, { kcalConverted, note: t('food.add.missingNote', { fields: missingText(missingFields(f)) }) });
    }
    return toPortion(f, { kcalConverted: f === food && kcalConverted });
  }

  const panels = {};
  const body = el('div', { class: 'add-body' });
  const tabs = iconTabs({ tabs: TABS.map((x) => ({ ...x, label: t(x.label) })), value: 'search', onChange: (v) => show(v), ariaLabel: t('food.portion.title') });
  tabs.classList.add('add-tabs');
  container.append(tabs, body);

  let active = null;
  function show(tab) {
    if (active === tab) return;
    if (active && panels[active] && panels[active].hide) panels[active].hide();
    active = tab;
    rememberTab(tab);
    tabs.setValue(tab);
    if (!panels[tab]) panels[tab] = builders[tab]();
    replaceChildren(body, panels[tab].el);
    if (panels[tab].show) panels[tab].show();
  }

  // ------------------------------------------------------------ search
  function buildSearch() {
    const input = el('input', { type: 'search', placeholder: t('food.search.placeholder'), autocomplete: 'off', enterkeyhint: 'search', 'aria-label': t('food.search.placeholder') });
    const searchField = el('label', { class: 'search-field' }, icon('search'), input);
    const localSec = el('div', { class: 'stack' });
    const genericSec = el('div', { class: 'stack' });
    const offSec = el('div', { class: 'stack' });
    const offBtn = el('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => runOff(true) }, icon('search'), t('food.search.off'));
    const createBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => toEditorThenPortion({ source: 'custom', name: input.value.trim(), per100: emptyPer100(), servings: [], basis: 'g' }) }, icon('plus'), t('food.search.create'));
    const wrap = el('div', { class: 'stack' }, searchField, localSec, genericSec, offSec, el('div', { class: 'row-between search-actions' }, offBtn, createBtn));

    let localIndex = null;
    let localNamed = false; // index built with the translated names of generic foods
    let seq = 0;
    let offTimer = null;
    let offCtrl = null;
    let lastOffQuery = '';

    /**
     * Your foods, indexed by stored name and, for generic foods, by their German / Chinese names too
     * (withNames: wait for the names files, loaded with the generic foods on the first search).
     */
    async function ensureLocal(withNames = false) {
      if (withNames && !localNamed) {
        try { await loadGeneric(); } catch { /* offline: stored names only */ }
        localIndex = null;
        localNamed = true;
      }
      if (!localIndex) {
        localIndex = (await allFoods()).map((f) => {
          const brand = f.brand ? ` ${f.brand}` : '';
          return indexItem(f, storedFoodNames(f, foodName(f), brand));
        });
      }
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
        if (recent.length) replaceChildren(localSec, ...section(t('food.search.recent'), recent.map((f) => foodRow(f, { onClick: () => pick(f) }))));
        return;
      }
      offBtn.hidden = false;
      const local = search(q, await ensureLocal(q.length >= 2), { limit: 10 });
      if (my !== seq) return;
      replaceChildren(localSec, ...(local.length ? section(t('food.search.yourFoods'), local.map((f) => foodRow(f, { onClick: () => pick(f) }))) : []));
      if (q.length < 2) { replaceChildren(genericSec); return; }
      if (!genericSec.childElementCount) replaceChildren(genericSec, el('p', { class: 't-sub muted search-note' }, t('food.search.loadingGeneric')));
      try {
        const gen = await searchGeneric(q, 15);
        if (my !== seq) return;
        replaceChildren(genericSec, ...(gen.length ? section(t('food.search.generic'), gen.map((f) => foodRow(f, { onClick: () => pick(f) }))) : []));
      } catch (err) {
        if (my !== seq) return;
        console.warn('Generic foods:', err);
        replaceChildren(genericSec, el('p', { class: 't-sub text-danger search-note' }, t(navigator.onLine === false ? 'food.search.genericOffline' : 'food.search.genericUnavailable')));
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
      replaceChildren(offSec, ...section('Open Food Facts', null, t('food.search.offSearching'))); // i18n-ignore (brand)
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
        replaceChildren(offSec, ...section('Open Food Facts', null), el('p', { class: 't-sub text-danger search-note', role: 'status' }, r.error)); // i18n-ignore (brand)
        return;
      }
      const ranked = preferMatches(q, r.results, (m) => `${m.food.name} ${m.food.brand || ''}`);
      const rows = ranked.slice(0, 20).map((m) => foodRow(m.food, {
        onClick: () => pick(m.food, { kcalConverted: m.kcalConverted }),
        sub: m.missing.length ? t('food.search.incomplete') : (m.kcalConverted ? t('food.badge.kcalFromKj') : null),
        trail: m.food.per100.kcal === null ? '– kcal' : per100Text(m.food),
      }));
      replaceChildren(offSec, ...section('Open Food Facts', rows, rows.length ? null : t('food.search.noProducts')), rows.length ? offCredit() : ''); // i18n-ignore (brand)
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
    const video = el('video', { class: 'scan-video', muted: true, playsinline: true, autoplay: true, 'aria-label': t('food.scan.preview') });
    video.muted = true;
    const status = el('p', { class: 't-sub muted scan-status', role: 'status' }, t('food.scan.starting'));
    const cameraInfo = infoButton('camera');
    cameraInfo.hidden = true;
    const startBtn = el('button', { type: 'button', class: 'btn btn-primary scan-toggle', onClick: () => scanner.start() }, icon('scan-barcode'), t('food.scan.scan'));
    const stopBtn = el('button', { type: 'button', class: 'btn scan-toggle', hidden: true, onClick: () => { scanner.stop(); setStatus(t('food.scan.cameraOff')); } }, icon('x'), t('food.scan.stop'));
    const box = el('div', { class: 'scan-box' }, video,
      el('div', { class: 'scan-frame', 'aria-hidden': 'true' }, el('div', { class: 'scan-guide' })),
      el('div', { class: 'scan-idle', 'aria-hidden': 'true' }, icon('scan-barcode', { size: 32 })));
    const code = el('input', { class: 'input input-num', type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: t('food.scan.codePlaceholder', { code: '3017620422003' }), 'aria-label': t('food.scan.barcode'), maxlength: '14', enterkeyhint: 'search' });
    const codeMsg = el('p', { class: 't-sub', role: 'status' });
    const result = el('div', { class: 'stack scan-result' });
    const form = el('form', { class: 'row barcode-form', onSubmit: (e) => { e.preventDefault(); manual(); } },
      code, el('button', { type: 'submit', class: 'btn' }, t('food.scan.lookUp')));
    const wrap = el('div', { class: 'stack' },
      box,
      el('div', { class: 'row scan-status-row' }, status, cameraInfo),
      el('div', { class: 'row scan-buttons' }, startBtn, stopBtn),
      sectionHeader(t('food.scan.typeBarcode')), form, codeMsg, result);

    /** @param {string} msg @param {boolean} [isErr] @param {string} [code] scanner status code ('blocked': camera not allowed) */
    function setStatus(msg, isErr, code) {
      status.textContent = msg;
      status.className = `t-sub scan-status ${isErr ? 'text-danger' : 'muted'}`;
      cameraInfo.hidden = !(isErr && code === 'blocked'); // the sheet explains how to allow the camera
    }
    const scanner = createScanner({
      video,
      force: ctx.query.decoder,
      onStatus: setStatus,
      onState: (on) => { startBtn.hidden = on; stopBtn.hidden = !on; box.classList.toggle('is-on', on); },
      onCode: (c, info) => { setStatus(info.upcE ? t('food.scan.readUpcE', { code: c, upce: info.upcE }) : t('food.scan.read', { code: c })); handleBarcode(c); },
    });
    cleanups.push(() => scanner.destroy());

    function manual() {
      const v = code.value.replace(/\s+/g, '');
      codeMsg.className = 't-sub text-danger';
      if (!/^\d{8}$|^\d{12,14}$/.test(v)) { codeMsg.textContent = t('food.scan.digits'); return; }
      if (!checkDigitOk(v)) { codeMsg.textContent = t('food.scan.checkDigit'); return; }
      codeMsg.textContent = '';
      code.blur();
      scanner.stop();
      handleBarcode(v);
    }

    let lookupCtrl = null;
    async function handleBarcode(c) {
      if (lookupCtrl) lookupCtrl.abort();
      const ctrl = lookupCtrl = new AbortController();
      replaceChildren(result, el('p', { class: 't-sub muted num' }, t('food.scan.lookingUp', { code: c })));
      const local = await findByBarcode(c);
      if (ctrl.signal.aborted) return;
      if (local) {
        replaceChildren(result, el('p', { class: 't-sub muted' }, t('food.scan.fromYourFoods', { name: foodName(local) })));
        const logged = isComplete(local) ? await toPortion(local) : await toEditorThenPortion(local, { note: t('food.scan.valuesMissing') });
        if (!logged) afterClose();
        return;
      }
      let r;
      try { r = await lookupBarcode(c, { signal: ctrl.signal }); } catch { return; }
      if (ctrl.signal.aborted) return;
      lookupCtrl = null;
      if (r.outcome === 'complete') {
        replaceChildren(result, el('p', { class: 't-sub muted' }, t('food.scan.fromOff', { name: r.food.name })), offCredit());
        if (!(await toPortion(r.food, { kcalConverted: r.kcalConverted }))) afterClose();
      } else if (r.outcome === 'incomplete') {
        replaceChildren(result, el('p', { class: 't-sub muted' }, t('food.scan.incompleteOff', { name: r.food.name || c })), offCredit());
        const ok = await toEditorThenPortion(r.food, { kcalConverted: r.kcalConverted, note: t('food.scan.missingNote', { fields: missingText(r.missing) }) });
        if (!ok) afterClose();
      } else if (r.outcome === 'not_found') {
        replaceChildren(result, el('p', { class: 't-sub muted num' }, t('food.scan.notOnOff', { code: c })));
        const ok = await toEditorThenPortion({ source: 'custom', barcode: c, name: '', brand: null, basis: 'g', per100: emptyPer100(), servings: [] },
          { note: t('food.scan.notFoundNote') });
        if (!ok) afterClose();
      } else {
        replaceChildren(result,
          el('p', { class: 'text-danger t-sub', role: 'alert' }, r.error),
          el('div', { class: 'row' },
            el('button', { type: 'button', class: 'btn btn-sm', onClick: () => handleBarcode(c) }, icon('refresh-cw'), t('food.action.retry')),
            el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => toEditorThenPortion({ source: 'custom', barcode: c, name: '', basis: 'g', per100: emptyPer100(), servings: [] }) }, t('food.scan.enterManually'))));
      }
    }
    function afterClose() {
      if (active === 'scan' && !done) setStatus(t('food.scan.cameraOff'));
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
    const toggle = segmented({ options: [{ value: 'recent', label: t('food.search.recent') }, { value: 'frequent', label: t('food.recent.mostUsed') }], value: by, onChange: (v) => { by = v; render(); }, ariaLabel: t('food.recent.sort') });
    const wrap = el('div', { class: 'stack' }, toggle, list);
    async function render() {
      const foods = usedFoods(await allFoods(), { by, limit: 60 });
      replaceChildren(list, foods.length
        ? el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, foods.map((f) => foodRow(f, {
          onClick: () => pick(f),
          sub: f.lastAmount ? t('food.recent.last', { amount: fmtAmount(f.lastAmount, f.basis) }) : null,
          trail: by === 'frequent' ? `${fmtGrouped(f.useCount, 0)}×` : per100Text(f),
        }))))
        : emptyState(t('food.recent.empty')));
    }
    return { el: wrap, show: render };
  }

  // ------------------------------------------------------------ saved meals
  function buildMeals() {
    const list = el('div');
    const wrap = el('div', { class: 'stack' }, list);
    async function render() {
      const meals = (await allMeals()).sort((a, b) => compareText(savedMealName(a), savedMealName(b)));
      replaceChildren(list, meals.length
        ? el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, meals.map((m) => el('div', { class: 'list-item meal-row' },
          el('button', { type: 'button', class: 'li-main meal-open', onClick: () => open(m) },
            el('div', { class: 'li-title' }, savedMealName(m)),
            el('div', { class: 'li-sub num' }, t('food.diary.itemsKcal', { count: m.items.length, kcal: fmtGrouped(mealKcal(m), 0) }))),
          iconButton('pencil', { label: t('food.meals.editNamed', { name: savedMealName(m) }), onClick: () => edit(m) })))))
        : el('div', { class: 'empty' }, el('p', null, ...emptyMealsText())));
    }
    /** 'No saved meals. Save one from a diary meal’s ⋯ menu.' with the icon where {icon} stands. */
    function emptyMealsText() {
      const [before, after = ''] = t('food.meals.empty').split('{icon}');
      return [before, icon('ellipsis', { size: 16, label: t('food.meals.more') }), after];
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
    const name = el('input', { class: 'input', type: 'text', placeholder: t('food.field.optional'), maxlength: '80', autocomplete: 'off' });
    const kcal = numberInput({ min: 0, max: 10000, decimals: 0, ariaLabel: t('food.nutrient.calories'), onInput: hint });
    const protein = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: t('food.nutrient.protein'), onInput: hint });
    const carbs = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: t('food.editor.carbs'), onInput: hint });
    const fat = numberInput({ min: 0, max: 1000, decimals: 1, ariaLabel: t('food.nutrient.fat'), onInput: hint });
    const kcalField = field(`${t('food.nutrient.calories')} *`, kcal, { unit: 'kcal' });
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
      ? el('p', { class: 't-sub editor-note', role: 'status' }, t('food.quickAdd.draftRestored')) : null;
    if (restoredNote) { for (const [k, i] of Object.entries(inputs)) i.value = typeof qd[k] === 'string' ? qd[k] : ''; hint(); }
    function hint() {
      const m = macroKcal({ protein: protein.getNumber(), carbs: carbs.getNumber(), fat: fat.getNumber() });
      hintEl.textContent = m ? t('food.quickAdd.macroHint', { kcal: fmtGrouped(m, 0) }) : '';
      if (kcal.getNumber() !== null) kcalField.classList.remove('is-missing');
    }
    async function add() {
      const k = kcal.getNumber();
      if (k === null) { kcalField.classList.add('is-missing'); kcal.focus(); return; }
      for (const i of [protein, carbs, fat]) if (i.value.trim() && i.getNumber() === null) { i.focus(); toast(t('food.error.number'), { type: 'error' }); return; }
      const e = quickAddEntry({ id: crypto.randomUUID(), date, meal, name: name.value, kcal: k, protein: protein.getNumber(), carbs: carbs.getNumber(), fat: fat.getNumber(), now: Date.now() });
      await putEntry(e);
      clearDraft(QUICK_DRAFT);
      toast(t('food.quickAdd.added', { kcal: fmtGrouped(k, 0), meal: mealName(meal) }), { type: 'success' });
      finished();
    }
    const manualCard = el('div', { class: 'card stack quick-manual' },
      cardHeader(t('food.quickAdd.byHand')),
      restoredNote,
      field(t('food.field.name'), name),
      kcalField,
      el('div', { class: 'grid-3' }, field(t('food.nutrient.protein'), protein, { unit: 'g' }), field(t('food.nutrient.carbs'), carbs, { unit: 'g' }), field(t('food.nutrient.fat'), fat, { unit: 'g' })),
      hintEl,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: add }, t('food.add.title', { meal: mealName(meal) })));
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
  show(TABS.some((x) => x.value === want) ? want : 'search');

  return () => {
    done = true;
    for (const c of cleanups) { try { c(); } catch (err) { console.error(err); } }
  };
}
