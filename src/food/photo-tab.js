// "Scan meal photo" section at the top of the Quick add tab:
// photo → AI estimate (user's own key) → editable review → diary (one entry per item, or one quick-add entry).
// The manual Quick add form below stays usable; while an estimate is shown it is hidden (never cleared).
import {
  el, numberInput, toast, fmtGrouped, fmtAmount, href, emptyState, replaceChildren, confirmDialog, cardHeader, icon, iconButton,
} from '../ui/index.js';
import { scale, sumEntries, isComplete } from '../core/nutrition.js';
import { itemWarnings, HINT_MAX, setPortionValue, photoMealName, photoMealTotals, ENTRY_NAME_MAX } from '../core/meal-photo.js';
import { getAdapter } from '../core/photo-providers.js';
import { mealLabel, quickAddEntry } from '../core/food-diary.js';
import { activePhotoConfig } from './photo-key.js';
import { analyseMealPhoto } from './photo-provider.js';
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

const CONF_LABEL = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence', unknown: 'confidence unknown', manual: 'added by you' };
const CONF_CLASS = { high: 'badge-conf-high', medium: 'badge-conf-medium', low: 'badge-conf-low', unknown: 'badge-conf-low', manual: 'badge-edited' };
// kcal shares the top line with the amount; the macros sit in a row of three below (P/C/F swatches).
const VALUE_FIELDS = [
  { key: 'kcal', label: 'kcal', unit: 'kcal', decimals: 0, max: 10000 },
  { key: 'protein', label: 'Protein', unit: 'g', decimals: 1, max: 1000 },
  { key: 'carbs', label: 'Carbs', unit: 'g', decimals: 1, max: 1000 },
  { key: 'fat', label: 'Fat', unit: 'g', decimals: 1, max: 1000 },
];

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
  const settingsLink = (label = 'Photo settings') => el('a', { class: 'btn btn-sm', href: href('food/photo-settings?from=add') }, icon('settings'), label);
  const settingsIcon = () => el('a', { class: 'btn btn-icon btn-ghost', href: href('food/photo-settings?from=add'), 'aria-label': 'Photo settings' }, icon('settings'));
  /** Estimate on screen → manual form hidden (values kept); otherwise visible. */
  const setEstimateMode = (on) => { wrap.classList.toggle('is-estimate', on); manual.setHidden(on); };

  // ------------------------------------------------------------ capture
  const hint = el('textarea', { class: 'textarea photo-hint', rows: '2', maxlength: String(HINT_MAX), placeholder: 'e.g. 200 g rice, chicken thigh', 'aria-label': 'Hint for the analysis' });

  function fileInput(capture) {
    const i = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden-file', tabindex: '-1', 'aria-hidden': 'true', ...(capture ? { capture: 'environment' } : {}) });
    i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) choose(f); });
    return i;
  }
  const camIn = fileInput(true);
  const libIn = fileInput(false);

  /** Card title row: 'Scan meal photo' ⓘ (+ settings link on the right). */
  const scanHead = (withSettings = true) => cardHeader('Scan meal photo', { info: 'photo', trail: withSettings ? settingsIcon() : null });
  /** The one muted line under the title: who bills the analysis. */
  const billedLine = (cfg) => el('p', { class: 't-sub muted photo-billed' }, `Your API key · billed by ${getAdapter(cfg.provider).name}`);

  const SETUP_TEXT = { key: 'No key yet.', model: 'No model yet.', baseUrl: 'No base URL yet.' };
  function renderNoKey() {
    setEstimateMode(false);
    const cfg = activePhotoConfig();
    const a = getAdapter(cfg.provider);
    replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
      scanHead(false),
      el('div', { class: 'stack' },
        el('p', null, 'AI estimates the meal from a photo. You check every value before adding.'),
        el('p', { class: 't-sub muted' }, `Needs your own API key · billed by ${a.label}. ${SETUP_TEXT[cfg.missing] || ''}`.trim()),
        el('a', { class: 'btn btn-secondary btn-block', href: href('food/photo-settings?from=add') }, icon('key-round'), 'Add API key'))));
  }

  function renderCapture(msg) {
    setEstimateMode(false);
    const pickRow = el('div', { class: 'grid-2 photo-pick' },
      el('button', { type: 'button', class: 'btn btn-secondary', onClick: () => camIn.click() }, icon('camera'), photo ? 'Retake photo' : 'Take photo'),
      el('button', { type: 'button', class: 'btn btn-secondary', onClick: () => libIn.click() }, icon('image'), 'Choose photo'));
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
          el('img', { src: photo.url, alt: 'Selected meal photo' }),
          iconButton('x', { label: 'Remove photo', class: 'photo-remove', onClick: () => { dropPhoto(); renderCapture(); } })),
        pickRow, camIn, libIn,
        el('div', { class: 'field' }, el('label', { class: 'field-label' }, 'Hint (optional)', hint),
          el('span', { class: 'field-hint' }, 'Treated as fact.')),
        msg || null,
        el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: analyse }, 'Analyse'))));
  }

  async function choose(file) {
    if (!/^image\//.test(file.type || 'image/')) { toast('Choose an image file.', { type: 'error' }); return; }
    replaceChildren(wrap, el('div', { class: 'card' }, el('p', { class: 'muted', role: 'status' }, 'Preparing photo…')));
    try {
      const p = await prepareImage(file);
      dropPhoto();
      photo = { ...p, url: URL.createObjectURL(p.blob) };
      renderCapture();
    } catch (err) {
      renderCapture(el('p', { class: 't-sub text-danger', role: 'alert' }, err.message || String(err)));
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
    const providerName = getAdapter(cfg.provider).name;
    const status = el('p', { class: 't-sub num', role: 'status' });
    const tick = () => { status.textContent = `Analysing with ${providerName} · ${model}… ${Math.round((Date.now() - started) / 1000)} s`; };
    tick();
    timer = setInterval(tick, 1000);
    replaceChildren(wrap, el('div', { class: 'card photo-scan-card' },
      scanHead(false),
      el('div', { class: 'stack' },
        el('div', { class: 'photo-preview is-small is-busy' }, el('img', { src: photo.url, alt: 'Meal photo being analysed' })),
        el('div', { class: 'progress-indeterminate', role: 'progressbar', 'aria-label': 'Analysing' }),
        status,
        el('p', { class: 't-sub muted' }, 'Usually 10–60 s. A cancelled request may still be billed.'),
        el('button', { type: 'button', class: 'btn btn-block', onClick: () => c.abort() }, 'Cancel'))));
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
      renderReview(r.dropped ? `First ${rows.length} items shown.` : null);
    } else {
      renderError(r);
    }
  }

  function renderError(r) {
    setEstimateMode(false);
    const actions = [];
    if (r.retry && r.kind !== 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, icon('refresh-cw'), 'Try again'));
    if (r.kind === 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, 'Analyse again'));
    if (['auth', 'billing', 'permission', 'model', 'no_key', 'bad_request', 'network'].includes(r.kind)) actions.push(settingsLink());
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { rows = []; lastNote = ''; nameTouched = false; renderReview(); addManual(); } }, 'Add items manually'));
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => renderCapture() }, 'Back to photo'));
    const isInfo = r.kind === 'cancelled' || r.kind === 'empty';
    replaceChildren(wrap, el('div', { class: ['card photo-scan-card', isInfo ? null : 'error-card'] },
      scanHead(),
      el('div', { class: 'stack' },
        photo ? el('div', { class: 'photo-preview is-small' }, el('img', { src: photo.url, alt: 'Meal photo' })) : null,
        el('div', { class: 'stack', role: 'alert' },
          el('p', { class: isInfo ? null : 'text-danger' }, r.message),
          r.note ? el('p', { class: 't-sub muted' }, `Model note: ${r.note}`) : null,
          r.detail ? el('p', { class: 't-sub muted' }, `Details: ${r.detail}`) : null),
        el('div', { class: 'row photo-actions' }, actions),
        el('p', { class: 't-sub muted' }, 'Or enter the values below.'))));
  }

  // ------------------------------------------------------------ review
  const reviewList = el('div', { class: 'photo-items' });
  const totalsEl = el('div', { class: 'photo-totals', 'aria-live': 'polite' });
  const blocker = el('p', { class: 'field-error' });
  const mealSel = mealSelect(meal);
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block photo-add-items', onClick: addAll });
  const oneName = el('input', { class: 'input', type: 'text', maxlength: String(ENTRY_NAME_MAX), autocomplete: 'off', 'aria-label': 'Name of the single entry',
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
      el('section', { class: 'card photo-review', 'aria-label': 'Photo estimate' },
        cardHeader('Photo estimate', { info: 'photo', trail: photo ? el('img', { class: 'photo-thumb', src: photo.url, alt: 'Meal photo' }) : null }),
        el('div', { class: 'stack photo-review-notes' },
          el('p', { class: 't-sub muted' }, 'AI estimate. Nothing is saved until you add.'),
          kept ? el('p', { class: 't-sub editor-note' }, 'Discard restores your typed values.') : null,
          lastNote ? el('p', { class: 't-sub editor-note' }, lastNote) : null,
          info ? el('p', { class: 't-sub editor-note', role: 'status' }, info) : null),
        reviewList,
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost photo-add-item', onClick: addManual }, icon('plus'), 'Add item'),
        totalsEl,
        el('div', { class: 'stack photo-log' },
          el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: mealSel.id }, 'Meal'), mealSel),
          blocker,
          addBtn,
          el('p', { class: 't-sub muted' }, 'One entry per item. Ticked items are saved to your foods.'))),
      el('section', { class: 'card stack photo-log-option', 'aria-label': 'Add as one entry' },
        el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: oneName.id }, 'One Quick add entry'), oneName),
        oneBtn),
      el('button', { type: 'button', class: 'btn btn-ghost text-danger photo-discard', onClick: discard }, icon('trash-2'), 'Discard'));
    renderRows();
  }

  function suggestedName() {
    const typed = manual.name().trim();
    return typed || photoMealName(rows, hint.value);
  }

  function renderRows() {
    replaceChildren(reviewList, ...(rows.length ? rows.map(rowEl) : [emptyState('No items.')]));
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
      const input = numberInput({ min: 0, max: f.max, decimals: f.decimals, id, ariaLabel: `${f.key === 'kcal' ? 'kcal' : `${f.label} g`} of ${row.name}`,
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
          el('i', { class: `swatch is-${f.key}`, 'aria-hidden': 'true' }), f.label), box);
    }
    const amount = numberInput({ value: row.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: `Amount of ${row.name}`,
      onInput: (n) => { row.amount = n; refreshRow(); updateTotals(); } });
    const remember = el('input', { type: 'checkbox', checked: row.remember, id: `rem-${uid}`,
      onChange: () => { row.remember = remember.checked; persist(); } });
    const card = el('div', { class: 'photo-item', dataset: { idx: String(idx) } },
      el('div', { class: 'photo-item-head' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, row.name),
          el('div', { class: 'li-sub' },
            el('span', { class: ['badge', CONF_CLASS[row.confidence] || 'badge-conf-low'] }, CONF_LABEL[row.confidence] || row.confidence),
            ' ', subEl)),
        iconButton('pencil', { label: `Edit name and all values of ${row.name}`, onClick: () => editRow(row) }),
        iconButton('x', { label: `Remove ${row.name}`, onClick: () => { rows.splice(rows.indexOf(row), 1); renderRows(); } })),
      el('div', { class: 'photo-item-amount' },
        el('div', { class: 'input-unit' }, amount, el('span', { class: 'unit', 'aria-hidden': 'true' }, row.basis)),
        valueCells.kcal),
      el('div', { class: 'photo-values' }, valueCells.protein, valueCells.carbs, valueCells.fat),
      warnEl,
      row.assumptions ? el('p', { class: 't-sub muted' }, row.assumptions) : null,
      el('label', { class: 'row check-row t-sub', htmlFor: remember.id }, remember, el('span', null, 'Save to my foods')));

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
      replaceChildren(warnEl, ...[...(row.fixes || []), ...row.warnings].map((w) => el('li', null, w)));
      card.classList.toggle('has-warning', row.warnings.length > 0);
    }
    refreshRow();
    return card;
  }

  async function editRow(row) {
    const r = await openFoodEditor({
      food: { name: row.name, brand: null, basis: row.basis, per100: row.per100, servings: [] },
      mode: 'entry', title: 'Edit item values',
      note: row.confidence === 'manual' ? null : `Values per 100 ${row.basis}.`,
    });
    if (!r) return;
    Object.assign(row, { name: r.food.name, basis: r.food.basis, per100: r.food.per100, fixes: [] });
    if (row.confidence !== 'manual') row.edited = true;
    renderRows();
  }

  async function addManual() {
    const r = await openFoodEditor({ food: { name: '', brand: null, basis: 'g', per100: { kcal: null, protein: null, carbs: null, fat: null, sugars: null, satFat: null, fibre: null, salt: null }, servings: [] }, mode: 'entry', title: 'Add item' });
    if (!r) return;
    rows.push({ name: r.food.name, amount: 100, basis: r.food.basis, per100: r.food.per100, confidence: 'manual', assumptions: '', fixes: [], remember: false });
    if (!reviewList.isConnected) renderReview(); else renderRows();
    const last = reviewList.querySelector('.photo-item:last-child .photo-item-amount input.input-num');
    if (last) { last.focus(); last.select(); }
  }

  async function discard() {
    const ok = await confirmDialog({ title: 'Discard the estimate?', message: 'Nothing has been added to the diary.', confirmLabel: 'Discard', cancelLabel: 'Keep' });
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
    if (!usedModel) return el('span', { class: 't-sub muted' }, 'Meal total');
    const i = usedModel.indexOf(' · ');
    const provider = i < 0 ? '' : usedModel.slice(0, i);
    const model = i < 0 ? usedModel : usedModel.slice(i + 3);
    return el('div', { class: 't-sub muted photo-estimated' }, el('div', null, provider ? `Estimated by ${provider}` : 'Estimated by'),
      el('code', { class: 'model-id' }, model));
  }

  function updateTotals() {
    const t = photoMealTotals(rows);
    replaceChildren(totalsEl,
      el('div', { class: 'row-between photo-total-line' },
        estimatedBy(),
        el('span', { class: 't-head num photo-total-kcal' }, `${fmtGrouped(t.kcal, 0)} kcal`)),
      el('div', { class: 't-sub muted num photo-total-macros' }, macroText(t)));
    const incomplete = rows.length - readyRows().length;
    if (incomplete) totalsEl.append(el('div', { class: 't-sub text-warning' }, 'Incomplete items not counted.'));
    blocker.textContent = incomplete ? `${incomplete} item${incomplete === 1 ? ' needs' : 's need'} an amount or values before adding.` : '';
    const n = rows.length;
    const blocked = n === 0 || incomplete > 0;
    addBtn.disabled = blocked;
    oneBtn.disabled = blocked;
    addBtn.textContent = n === 0 ? 'No items to add' : `Add ${n} item${n === 1 ? '' : 's'} to ${mealLabel(mealSel.value)}`;
    oneBtn.textContent = n === 0 ? 'Nothing to add' : `Add as one entry · ${fmtGrouped(t.kcal, 0)} kcal`;
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
    const when = at ? ` from ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : '';
    renderReview(`Estimate restored${when}. Photo not kept.`);
    return true;
  }

  let busy = false;
  async function addAll() {
    if (busy || addBtn.disabled) return;
    busy = true;
    try {
      const items = readyRows().map((r) => ({ name: r.name, amount: r.amount, basis: r.basis, per100: r.per100, remember: r.remember }));
      const entries = await logPhotoItems(items, { date, meal: mealSel.value });
      renderDone(entries, mealSel.value);
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message || err}`, { type: 'error' });
    } finally {
      busy = false;
    }
  }

  /** The whole estimate as ONE quick-add entry (same record shape as the manual Quick add form). */
  async function addOne() {
    if (busy || oneBtn.disabled) return;
    busy = true;
    try {
      const t = photoMealTotals(readyRows());
      const mealId = mealSel.value;
      const e = quickAddEntry({ id: crypto.randomUUID(), date, meal: mealId, name: oneName.value.trim() || photoMealName(rows, hint.value), kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, now: Date.now() });
      await putEntry(e);
      rows = [];
      clearDraft(PHOTO_DRAFT);
      toast(`Added ${fmtGrouped(t.kcal, 0)} kcal to ${mealLabel(mealId)}`, { type: 'success' });
      onFinished();
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message || err}`, { type: 'error' });
    } finally {
      busy = false;
    }
  }

  function renderDone(entries, mealId) {
    const t = sumEntries(entries);
    const remembered = rows.filter((r) => r.remember).length;
    toast(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} to ${mealLabel(mealId)}`, { type: 'success' });
    rows = [];
    clearDraft(PHOTO_DRAFT);
    setEstimateMode(true);
    replaceChildren(wrap, el('div', { class: 'card photo-done' },
      cardHeader(`Added to ${mealLabel(mealId)}`),
      el('div', { class: 'stack' },
        el('div', { class: 'list' }, entries.map((e) => el('div', { class: 'list-item' },
          el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, e.name), el('div', { class: 'li-sub num' }, fmtAmount(e.amount, e.basis))),
          el('div', { class: 'li-trail num' }, `${fmtGrouped(scale(e.per100, e.amount).kcal, 0)} kcal`)))),
        el('div', { class: 'row-between photo-total-line' },
          el('span', { class: 't-sub muted num' }, macroText(t)), el('span', { class: 't-head num' }, `${fmtGrouped(t.kcal, 0)} kcal`)),
        remembered ? el('p', { class: 't-sub muted' }, `${remembered} food${remembered === 1 ? '' : 's'} added to your foods.`) : null,
        el('div', { class: 'row photo-actions photo-done-actions' },
          el('button', { type: 'button', class: 'btn', onClick: async () => { if (await openSaveAsMeal(entries, `${mealLabel(mealId)} photo`)) onFinished(); } }, icon('bookmark'), 'Save as meal…'),
          el('button', { type: 'button', class: 'btn btn-primary', onClick: () => onFinished() }, icon('check'), 'Done')),
        el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reset }, icon('camera'), 'Scan another photo'))));
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
