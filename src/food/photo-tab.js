// "Scan meal photo" section at the top of the Quick add tab:
// photo → AI estimate (user's own key) → editable review → diary (one entry per item, or one quick-add entry).
// The manual Quick add form below stays usable; while an estimate is shown it is hidden (never cleared).
import {
  el, numberInput, toast, fmtGrouped, fmtAmount, fmtTime, href, emptyState, replaceChildren, confirmDialog, cardHeader, icon, iconButton, joinSentences,
} from '../ui/index.js';
import { scale, sumEntries, isComplete } from '../core/nutrition.js';
import { itemWarnings, HINT_MAX, setPortionValue, photoMealName, photoMealTotals, ENTRY_NAME_MAX, UNNAMED_ITEM } from '../core/meal-photo.js';
import { getAdapter } from '../core/photo-providers.js';
import { quickAddEntry } from '../core/food-diary.js';
import { t } from '../i18n/index.js';
import { activePhotoConfig } from './photo-key.js';
import { analyseMealPhoto, photoErrorText, photoMsgText, providerName as adapterName } from './photo-provider.js';
import { mealName, itemName, photoMealDefault } from './names.js';
import { prepareImage } from './photo-image.js';
import { openFoodEditor } from './food-editor.js';
import { openSaveAsMeal } from './meals.js';
import { logPhotoItems, putEntry } from './store.js';
import { mealSelect, macroText } from './widgets.js';
import { loadDraft, saveDraft, clearDraft } from '../ui/draft.js';

/**
 * localStorage draft of the review (src/ui/draft.js): items with the user's edits, hint, meal/date,
 * provider/model and time. Never the image or a key. Restored after a reload, cleared when the items
 * are logged or the estimate is discarded, expires after 24 h.
 */
export const PHOTO_DRAFT = 'photo-review';

/** Catalogue keys of the confidence badges. */
const CONF_LABEL = { high: 'food.photo.conf.high', medium: 'food.photo.conf.medium', low: 'food.photo.conf.low', unknown: 'food.photo.conf.unknown', manual: 'food.photo.conf.manual' };
const CONF_CLASS = { high: 'badge-conf-high', medium: 'badge-conf-medium', low: 'badge-conf-low', unknown: 'badge-conf-low', manual: 'badge-edited' };
// kcal shares the top line with the amount; the macros sit in a row of three below (P/C/F swatches).
// label: catalogue key (kcal is a unit, not translated).
const VALUE_FIELDS = [
  { key: 'kcal', label: null, unit: 'kcal', decimals: 0, max: 10000 },
  { key: 'protein', label: 'food.nutrient.protein', unit: 'g', decimals: 1, max: 1000 },
  { key: 'carbs', label: 'food.nutrient.carbs', unit: 'g', decimals: 1, max: 1000 },
  { key: 'fat', label: 'food.nutrient.fat', unit: 'g', decimals: 1, max: 1000 },
];

/** Shown name of a review row (the model's unnamed marker translated). */
const rowName = (row) => (row.name === UNNAMED_ITEM ? t('food.photo.unnamedItem') : row.name);
/** Labels for photoMealName in the app language. */
const mealNameLabels = () => ({ fallback: t('food.photo.mealPhoto'), more: (n) => t('food.photo.more', { count: n }), sep: t('food.list.separator') });

/**
 * @param {{date: string, meal: string, cleanups: Function[], onFinished: () => void,
 *          manual: {hasValues: () => boolean, name: () => string, setHidden: (hidden: boolean) => void}}} opts
 * @returns {{el: HTMLElement, show: () => void}}
 */
export function buildPhotoScan({ date, meal, cleanups, onFinished, manual }) {
  const wrap = el('div', { class: 'stack photo-panel photo-scan', id: 'meal-photo' });
  let photo = null;        // { blob, url, width, height }
  let ctrl = null;         // AbortController of the running analysis
  let timer = null;
  let rows = [];           // review rows
  let lastNote = '';
  let usedModel = '';
  let nameTouched = false; // the user edited the one-entry name
  let estimate = null;     // { provider, model, at } of the analysis shown

  cleanups.push(() => { if (ctrl) ctrl.abort(); clearInterval(timer); dropPhoto(); });

  function dropPhoto() { if (photo) { URL.revokeObjectURL(photo.url); photo = null; } }
  const settingsLink = (label = t('food.photo.settings')) => el('a', { class: 'btn btn-sm', href: href('food/photo-settings?from=add') }, icon('settings'), label);
  const settingsIcon = () => el('a', { class: 'btn btn-icon btn-ghost', href: href('food/photo-settings?from=add'), 'aria-label': t('food.photo.settings') }, icon('settings'));
  /** Estimate on screen → manual form hidden (values kept); otherwise visible. */
  const setEstimateMode = (on) => { wrap.classList.toggle('is-estimate', on); manual.setHidden(on); };

  // ------------------------------------------------------------ capture
  const hint = el('textarea', { class: 'textarea photo-hint', rows: '2', maxlength: String(HINT_MAX), placeholder: t('food.photo.hintPlaceholder'), 'aria-label': t('food.photo.hintAria') });

  function fileInput(capture) {
    const i = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden-file', tabindex: '-1', 'aria-hidden': 'true', ...(capture ? { capture: 'environment' } : {}) });
    i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) choose(f); });
    return i;
  }
  const camIn = fileInput(true);
  const libIn = fileInput(false);

  /** Card title row: 'Scan meal photo' ⓘ (+ settings link on the right). */
  const scanHead = (withSettings = true) => cardHeader(t('food.photo.scanTitle'), { info: 'photo', trail: withSettings ? settingsIcon() : null });
  /** The one muted line under the title: who bills the analysis. */
  const billedLine = (cfg) => el('p', { class: 't-sub muted photo-billed' }, t('food.photo.billedBy', { provider: adapterName(getAdapter(cfg.provider)) }));

  /** Catalogue keys: what is still missing before an analysis. */
  const SETUP_TEXT = { key: 'food.photo.setup.key', model: 'food.photo.setup.model', baseUrl: 'food.photo.setup.baseUrl' };
  function renderNoKey() {
    setEstimateMode(false);
    const cfg = activePhotoConfig();
    const a = getAdapter(cfg.provider);
    replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
      scanHead(false),
      el('div', { class: 'stack' },
        el('p', null, t('food.photo.intro')),
        el('p', { class: 't-sub muted' }, joinSentences([t('food.photo.needsKey', { provider: a.labelKey ? t(a.labelKey) : a.label }), SETUP_TEXT[cfg.missing] ? t(SETUP_TEXT[cfg.missing]) : null])),
        el('a', { class: 'btn btn-secondary btn-block', href: href('food/photo-settings?from=add') }, icon('key-round'), t('food.photo.addKey')))));
  }

  function renderCapture(msg) {
    setEstimateMode(false);
    const pickRow = el('div', { class: 'grid-2 photo-pick' },
      el('button', { type: 'button', class: 'btn btn-secondary', onClick: () => camIn.click() }, icon('camera'), t(photo ? 'food.photo.retake' : 'food.photo.take')),
      el('button', { type: 'button', class: 'btn btn-secondary', onClick: () => libIn.click() }, icon('image'), t('food.photo.choose')));
    const cfg = activePhotoConfig();
    if (!photo) {
      replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
        scanHead(),
        el('div', { class: 'stack' },
          billedLine(cfg),
          msg || null,
          pickRow, camIn, libIn)));
      return;
    }
    replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
      scanHead(),
      el('div', { class: 'stack' },
        billedLine(cfg),
        el('div', { class: 'photo-preview is-small' },
          el('img', { src: photo.url, alt: t('food.photo.selectedAlt') }),
          iconButton('x', { label: t('food.photo.remove'), class: 'photo-remove', onClick: () => { dropPhoto(); renderCapture(); } })),
        pickRow, camIn, libIn,
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, t('food.photo.hintLabel'), hint),
          el('span', { class: 'field-hint' }, t('food.photo.hintFact'))),
        msg || null,
        el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: analyse }, t('food.photo.analyse')))));
  }

  async function choose(file) {
    if (!/^image\//.test(file.type || 'image/')) { toast(t('food.photo.chooseImage'), { type: 'error' }); return; }
    replaceChildren(wrap, el('div', { class: 'card' }, el('p', { class: 'muted', role: 'status' }, t('food.photo.preparing'))));
    try {
      const p = await prepareImage(file);
      dropPhoto();
      photo = { ...p, url: URL.createObjectURL(p.blob) };
      renderCapture();
    } catch (err) {
      renderCapture(el('p', { class: 't-sub text-danger', role: 'alert' }, err.key ? t(err.key) : err.message || String(err)));
    }
  }

  // ------------------------------------------------------------ analysis
  async function analyse() {
    if (!photo || ctrl) return;
    const cfg = activePhotoConfig();
    if (cfg.missing) { renderNoKey(); return; }
    const c = ctrl = new AbortController();
    const started = Date.now();
    const { model } = cfg;
    const providerName = adapterName(getAdapter(cfg.provider));
    const status = el('p', { class: 't-sub num', role: 'status' });
    const tick = () => { status.textContent = t('food.photo.analysing', { provider: providerName, model, s: Math.round((Date.now() - started) / 1000) }); };
    tick();
    timer = setInterval(tick, 1000);
    replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
      scanHead(false),
      el('div', { class: 'stack' },
        el('div', { class: 'photo-preview is-small is-busy' }, el('img', { src: photo.url, alt: t('food.photo.busyAlt') })),
        el('div', { class: 'progress-indeterminate', role: 'progressbar', 'aria-label': t('food.photo.analysingAria') }),
        status,
        el('p', { class: 't-sub muted' }, t('food.photo.duration')),
        el('button', { type: 'button', class: 'btn btn-block', onClick: () => c.abort() }, t('food.action.cancel')))));
    const r = await analyseMealPhoto(photo.blob, { provider: cfg.provider, apiKey: cfg.apiKey, model, baseUrl: cfg.baseUrl, useSchema: cfg.useSchema, hint: hint.value, signal: c.signal });
    clearInterval(timer);
    if (ctrl !== c) return;
    ctrl = null;
    if (!wrap.isConnected && c.signal.aborted) return; // view gone
    if (r.ok) {
      usedModel = `${providerName} · ${r.model || model}`;
      estimate = { provider: cfg.provider, model: r.model || model, at: Date.now() };
      lastNote = r.note;
      rows = r.items.map((it) => ({ ...it, remember: false }));
      nameTouched = false;
      renderReview(r.dropped ? t('food.photo.firstShown', { count: rows.length }) : null);
    } else {
      renderError(r);
    }
  }

  function renderError(r) {
    setEstimateMode(false);
    const actions = [];
    if (r.retry && r.kind !== 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, icon('refresh-cw'), t('food.action.tryAgain')));
    if (r.kind === 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, t('food.photo.analyseAgain')));
    if (['auth', 'billing', 'permission', 'model', 'no_key', 'bad_request', 'network'].includes(r.kind)) actions.push(settingsLink());
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { rows = []; lastNote = ''; nameTouched = false; renderReview(); addManual(); } }, t('food.photo.addManually')));
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => renderCapture() }, t('food.photo.backToPhoto')));
    const isInfo = r.kind === 'cancelled' || r.kind === 'empty';
    replaceChildren(wrap, el('div', { class: ['card photo-scan-card', isInfo ? null : 'error-card'] },
      scanHead(),
      el('div', { class: 'stack' },
        photo ? el('div', { class: 'photo-preview is-small' }, el('img', { src: photo.url, alt: t('food.photo.mealPhoto') })) : null,
        el('div', { class: 'stack', role: 'alert' },
          el('p', { class: isInfo ? null : 'text-danger' }, photoErrorText(r)),
          r.note ? el('p', { class: 't-sub muted' }, t('food.photo.modelNote', { note: r.note })) : null,
          r.detail ? el('p', { class: 't-sub muted' }, t('food.photo.details', { detail: r.detail })) : null),
        el('div', { class: 'row photo-actions' }, actions),
        el('p', { class: 't-sub muted' }, t('food.photo.orBelow')))));
  }

  // ------------------------------------------------------------ review
  const reviewList = el('div', { class: 'photo-items' });
  const totalsEl = el('div', { class: 'photo-totals', 'aria-live': 'polite' });
  const blocker = el('p', { class: 'field-error' });
  const mealSel = mealSelect(meal);
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block photo-add-items', onClick: addAll });
  const oneName = el('input', { class: 'input', type: 'text', maxlength: String(ENTRY_NAME_MAX), autocomplete: 'off', 'aria-label': t('food.photo.oneNameAria'),
    onInput: () => { nameTouched = true; persist(); } });
  const oneBtn = el('button', { type: 'button', class: 'btn btn-secondary btn-block photo-add-one', onClick: addOne });
  mealSel.addEventListener('change', updateTotals);

  function renderReview(info) {
    setEstimateMode(true);
    if (!nameTouched) oneName.value = suggestedName();
    const kept = manual.hasValues();
    if (!mealSel.id) mealSel.id = `pm-${Math.random().toString(36).slice(2)}`;
    if (!oneName.id) oneName.id = `pn-${Math.random().toString(36).slice(2)}`;
    replaceChildren(wrap,
      el('section', { class: 'card photo-review', 'aria-label': t('food.photo.estimateTitle') },
        cardHeader(t('food.photo.estimateTitle'), { info: 'photo', trail: photo ? el('img', { class: 'photo-thumb', src: photo.url, alt: t('food.photo.mealPhoto') }) : null }),
        el('div', { class: 'stack photo-review-notes' },
          el('p', { class: 't-sub muted' }, t('food.photo.estimateNote')),
          kept ? el('p', { class: 't-sub editor-note' }, t('food.photo.discardRestores')) : null,
          lastNote ? el('p', { class: 't-sub editor-note' }, lastNote) : null,
          info ? el('p', { class: 't-sub editor-note', role: 'status' }, info) : null),
        reviewList,
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost photo-add-item', onClick: addManual }, icon('plus'), t('food.photo.addItem')),
        totalsEl,
        el('div', { class: 'stack photo-log' },
          el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: mealSel.id }, t('food.meal.label')), mealSel),
          blocker,
          addBtn,
          el('p', { class: 't-sub muted' }, t('food.photo.perItemNote')))),
      el('section', { class: 'card stack photo-log-option', 'aria-label': t('food.photo.asOneAria') },
        el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: oneName.id }, t('food.photo.oneEntry')), oneName),
        oneBtn),
      el('button', { type: 'button', class: 'btn btn-ghost text-danger photo-discard', onClick: discard }, icon('trash-2'), t('food.photo.discard')));
    renderRows();
  }

  /** Name stored for the one entry: as typed, or the generated suggestion in its stored English form (shown translated). */
  function oneEntryName() {
    const typed = oneName.value.trim();
    if (typed && typed !== suggestedName()) return typed;
    return manual.name().trim() || photoMealName(rows, hint.value);
  }

  function suggestedName() {
    const typed = manual.name().trim();
    return typed || photoMealName(rows, hint.value, mealNameLabels());
  }

  function renderRows() {
    replaceChildren(reviewList, ...(rows.length ? rows.map(rowEl) : [emptyState(t('food.photo.noItems'))]));
    updateTotals();
  }

  function rowEl(row, idx) {
    const subEl = el('span', { class: 'num' });
    const warnEl = el('ul', { class: 't-sub photo-warnings' });
    const uid = `${idx}-${Math.random().toString(36).slice(2)}`;
    const valueInputs = {};
    const valueCells = {};
    for (const f of VALUE_FIELDS) {
      const id = `pv-${f.key}-${uid}`;
      const input = numberInput({ min: 0, max: f.max, decimals: f.decimals, id, ariaLabel: t('food.photo.valueOf', { value: f.label ? `${t(f.label)} g` : 'kcal', name: rowName(row) }),
        onInput: (n) => {
          if (!(typeof row.amount === 'number' && row.amount > 0)) return;
          row.per100 = setPortionValue(row.per100, row.amount, f.key, n);
          row.fixes = [];
          if (row.confidence !== 'manual') row.edited = true;
          refreshRow(f.key);
          updateTotals();
        } });
      valueInputs[f.key] = input;
      const box = el('div', { class: 'input-unit' }, input, el('span', { class: 'unit', 'aria-hidden': 'true' }, f.unit));
      valueCells[f.key] = f.key === 'kcal' ? box
        : el('div', { class: 'photo-value' }, el('label', { class: 't-cap muted photo-value-label', htmlFor: id },
          el('i', { class: `swatch is-${f.key}`, 'aria-hidden': 'true' }), t(f.label)), box);
    }
    const amount = numberInput({ value: row.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: t('food.meals.amountOf', { name: rowName(row) }),
      onInput: (n) => { row.amount = n; refreshRow(); updateTotals(); } });
    const remember = el('input', { type: 'checkbox', checked: row.remember, id: `rem-${uid}`,
      onChange: () => { row.remember = remember.checked; persist(); } });
    const card = el('div', { class: 'photo-item', dataset: { idx: String(idx) } },
      el('div', { class: 'photo-item-head' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, rowName(row)),
          el('div', { class: 'li-sub' },
            el('span', { class: ['badge', CONF_CLASS[row.confidence] || 'badge-conf-low'] }, CONF_LABEL[row.confidence] ? t(CONF_LABEL[row.confidence]) : row.confidence),
            ' ', subEl)),
        iconButton('pencil', { label: t('food.photo.editRow', { name: rowName(row) }), onClick: () => editRow(row) }),
        iconButton('x', { label: t('food.meals.removeItem', { name: rowName(row) }), onClick: () => { rows.splice(rows.indexOf(row), 1); renderRows(); } })),
      el('div', { class: 'photo-item-amount' },
        el('div', { class: 'input-unit' }, amount, el('span', { class: 'unit', 'aria-hidden': 'true' }, row.basis)),
        valueCells.kcal),
      el('div', { class: 'photo-values' }, valueCells.protein, valueCells.carbs, valueCells.fat),
      warnEl,
      row.assumptions ? el('p', { class: 't-sub muted' }, row.assumptions) : null,
      el('label', { class: 'row check-row t-sub', htmlFor: remember.id }, remember, el('span', null, t('food.photo.saveToFoods'))));

    /** Re-derive the portion values; `typing` is the field being edited (left alone). */
    function refreshRow(typing) {
      const ok = typeof row.amount === 'number' && row.amount > 0;
      const v = scale(row.per100, ok ? row.amount : 0);
      for (const f of VALUE_FIELDS) {
        const i = valueInputs[f.key];
        i.disabled = !ok;
        if (f.key === typing) continue;
        i.setNumber(ok && typeof v[f.key] === 'number' ? Number(v[f.key].toFixed(f.decimals)) : null);
      }
      subEl.textContent = `${fmtGrouped(row.per100.kcal, 0)} kcal / 100 ${row.basis}`;
      row.warnings = itemWarnings(row);
      replaceChildren(warnEl, ...[...(row.fixes || []), ...row.warnings].map((w) => el('li', null, photoMsgText(w))));
      card.classList.toggle('has-warning', row.warnings.length > 0);
    }
    refreshRow();
    return card;
  }

  async function editRow(row) {
    const r = await openFoodEditor({
      food: { name: rowName(row), brand: null, basis: row.basis, per100: row.per100, servings: [] },
      mode: 'entry', title: t('food.photo.editItemTitle'),
      note: row.confidence === 'manual' ? null : t('food.photo.valuesPer100', { basis: row.basis }),
    });
    if (!r) return;
    Object.assign(row, { name: r.food.name === rowName(row) ? row.name : r.food.name, basis: r.food.basis, per100: r.food.per100, fixes: [] });
    if (row.confidence !== 'manual') row.edited = true;
    renderRows();
  }

  async function addManual() {
    const r = await openFoodEditor({ food: { name: '', brand: null, basis: 'g', per100: { kcal: null, protein: null, carbs: null, fat: null, sugars: null, satFat: null, fibre: null, salt: null }, servings: [] }, mode: 'entry', title: t('food.photo.addItem') });
    if (!r) return;
    rows.push({ name: r.food.name, amount: 100, basis: r.food.basis, per100: r.food.per100, confidence: 'manual', assumptions: '', fixes: [], remember: false });
    if (!reviewList.isConnected) renderReview(); else renderRows();
    const last = reviewList.querySelector('.photo-item:last-child .photo-item-amount input.input-num');
    if (last) { last.focus(); last.select(); }
  }

  async function discard() {
    const ok = await confirmDialog({ title: t('food.photo.discardTitle'), message: t('food.photo.discardMessage'), confirmLabel: t('food.photo.discard'), cancelLabel: t('food.photo.keep') });
    if (!ok) return;
    reset();
  }

  function reset() {
    rows = []; lastNote = ''; usedModel = ''; nameTouched = false; estimate = null;
    mealSel.value = meal; oneName.value = '';
    clearDraft(PHOTO_DRAFT);
    dropPhoto(); hint.value = '';
    if (!activePhotoConfig().missing) renderCapture(); else renderNoKey();
  }

  function readyRows() { return rows.filter((r) => typeof r.amount === 'number' && r.amount > 0 && isComplete(r)); }

  /** 'Estimated by Anthropic' over the model id (wraps instead of being cut off). */
  function estimatedBy() {
    if (!usedModel) return el('span', { class: 't-sub muted' }, t('food.photo.mealTotal'));
    const i = usedModel.indexOf(' · ');
    const provider = i < 0 ? '' : usedModel.slice(0, i);
    const model = i < 0 ? usedModel : usedModel.slice(i + 3);
    return el('div', { class: 't-sub muted photo-estimated' }, el('div', null, provider ? t('food.photo.estimatedByName', { provider }) : t('food.photo.estimatedBy')),
      el('code', { class: 'model-id' }, model));
  }

  function updateTotals() {
    const tot = photoMealTotals(rows);
    replaceChildren(totalsEl,
      el('div', { class: 'row-between photo-total-line' },
        estimatedBy(),
        el('span', { class: 't-head num photo-total-kcal' }, `${fmtGrouped(tot.kcal, 0)} kcal`)),
      el('div', { class: 't-sub muted num photo-total-macros' }, macroText(tot)));
    const incomplete = rows.length - readyRows().length;
    if (incomplete) totalsEl.append(el('div', { class: 't-sub text-warning' }, t('food.photo.incompleteNotCounted')));
    blocker.textContent = incomplete ? t('food.photo.needsValues', { count: incomplete }) : '';
    const n = rows.length;
    const blocked = n === 0 || incomplete > 0;
    addBtn.disabled = blocked;
    oneBtn.disabled = blocked;
    addBtn.textContent = n === 0 ? t('food.photo.noItemsToAdd') : t('food.photo.addItems', { count: n, meal: mealName(mealSel.value) });
    oneBtn.textContent = n === 0 ? t('food.photo.nothingToAdd') : t('food.photo.addAsOne', { kcal: fmtGrouped(tot.kcal, 0) });
    if (!nameTouched && oneName.isConnected) oneName.value = suggestedName();
    persist();
  }

  /** Save the review as it is now (called after every change while it is shown). */
  function persist() {
    if (!rows.length && !usedModel) { clearDraft(PHOTO_DRAFT); return; }
    saveDraft(PHOTO_DRAFT, {
      date, meal, mealChoice: mealSel.value, hint: hint.value,
      rows: rows.map(({ warnings, ...r }) => r), lastNote, usedModel, estimate,
      nameTouched, oneName: oneName.value,
    });
  }

  /** Bring back a review saved before a reload. @returns {boolean} */
  function restore() {
    const d = loadDraft(PHOTO_DRAFT);
    if (!d || d.date !== date || d.meal !== meal || !Array.isArray(d.rows) || (!d.rows.length && !d.usedModel)) return false;
    rows = d.rows.map((r) => ({ ...r, remember: !!r.remember }));
    lastNote = d.lastNote || '';
    usedModel = d.usedModel || '';
    estimate = d.estimate || null;
    nameTouched = !!d.nameTouched;
    oneName.value = d.oneName || '';
    hint.value = d.hint || '';
    if (d.mealChoice) mealSel.value = d.mealChoice;
    const at = estimate && estimate.at ? new Date(estimate.at) : null;
    renderReview(at ? t('food.photo.restoredAt', { time: fmtTime(at.getTime()) }) : t('food.photo.restored'));
    return true;
  }

  let busy = false;
  async function addAll() {
    if (busy || addBtn.disabled) return;
    busy = true;
    try {
      const items = readyRows().map((r) => ({ name: rowName(r), amount: r.amount, basis: r.basis, per100: r.per100, remember: r.remember }));
      const entries = await logPhotoItems(items, { date, meal: mealSel.value });
      renderDone(entries, mealSel.value);
    } catch (err) {
      console.error(err);
      toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
    } finally {
      busy = false;
    }
  }

  /** The whole estimate as ONE quick-add entry (same record shape as the manual Quick add form). */
  async function addOne() {
    if (busy || oneBtn.disabled) return;
    busy = true;
    try {
      const tot = photoMealTotals(readyRows());
      const mealId = mealSel.value;
      const e = quickAddEntry({ id: crypto.randomUUID(), date, meal: mealId, name: oneEntryName(), kcal: tot.kcal, protein: tot.protein, carbs: tot.carbs, fat: tot.fat, now: Date.now() });
      await putEntry(e);
      rows = [];
      clearDraft(PHOTO_DRAFT);
      toast(t('food.quickAdd.added', { kcal: fmtGrouped(tot.kcal, 0), meal: mealName(mealId) }), { type: 'success' });
      onFinished();
    } catch (err) {
      console.error(err);
      toast(t('food.error.save', { error: err.message || err }), { type: 'error' });
    } finally {
      busy = false;
    }
  }

  function renderDone(entries, mealId) {
    const tot = sumEntries(entries);
    const remembered = rows.filter((r) => r.remember).length;
    toast(t('food.photo.addedItems', { count: entries.length, meal: mealName(mealId) }), { type: 'success' });
    rows = [];
    clearDraft(PHOTO_DRAFT);
    setEstimateMode(true);
    replaceChildren(wrap, el('div', { class: 'card photo-done' },
      cardHeader(t('food.photo.addedTo', { meal: mealName(mealId) })),
      el('div', { class: 'stack' },
        el('div', { class: 'list' }, entries.map((e) => el('div', { class: 'list-item' },
          el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, itemName(e)), el('div', { class: 'li-sub num' }, fmtAmount(e.amount, e.basis))),
          el('div', { class: 'li-trail num' }, `${fmtGrouped(scale(e.per100, e.amount).kcal, 0)} kcal`)))),
        el('div', { class: 'row-between photo-total-line' },
          el('span', { class: 't-sub muted num' }, macroText(tot)), el('span', { class: 't-head num' }, `${fmtGrouped(tot.kcal, 0)} kcal`)),
        remembered ? el('p', { class: 't-sub muted' }, t('food.photo.remembered', { count: remembered })) : null,
        el('div', { class: 'row photo-actions photo-done-actions' },
          el('button', { type: 'button', class: 'btn', onClick: async () => { if (await openSaveAsMeal(entries, photoMealDefault(mealId))) onFinished(); } }, icon('bookmark'), t('food.diary.saveAsMeal')),
          el('button', { type: 'button', class: 'btn btn-primary', onClick: () => onFinished() }, icon('check'), t('food.action.done'))),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reset }, icon('camera'), t('food.photo.scanAnother')))));
  }

  return {
    el: wrap,
    show() {
      if (ctrl || rows.length || wrap.childElementCount) return; // keep the current state
      if (restore()) return;
      if (activePhotoConfig().missing) renderNoKey();
      else renderCapture();
    },
  };
}
