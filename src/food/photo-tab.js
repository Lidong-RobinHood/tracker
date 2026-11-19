// "Scan meal photo" section at the top of the Quick add tab:
// photo → AI estimate (user's own key) → editable review → diary (one entry per item, or one quick-add entry).
// The manual Quick add form below stays usable; while an estimate is shown it is hidden (never cleared).
import { el, numberInput, toast, fmtNum, fmtAmount, href, emptyState, replaceChildren, confirmDialog } from '../ui/index.js';
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
const VALUE_FIELDS = [
  { key: 'kcal', label: 'kcal', decimals: 0, max: 10000 },
  { key: 'protein', label: 'Protein g', decimals: 1, max: 1000 },
  { key: 'carbs', label: 'Carbs g', decimals: 1, max: 1000 },
  { key: 'fat', label: 'Fat g', decimals: 1, max: 1000 },
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
  const settingsLink = (label = 'Photo settings') => el('a', { class: 'btn btn-sm', href: href('food/photo-settings?from=add') }, label);
  /** Estimate on screen → manual form hidden (values kept); otherwise visible. */
  const setEstimateMode = (on) => { wrap.classList.toggle('is-estimate', on); manual.setHidden(on); };

  // ------------------------------------------------------------ capture
  const hint = el('textarea', { class: 'textarea photo-hint', rows: '2', maxlength: String(HINT_MAX), placeholder: 'Optional hint, e.g. “about 200 g rice, chicken thigh”', 'aria-label': 'Hint for the analysis' });

  function fileInput(capture) {
    const i = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden-file', tabindex: '-1', 'aria-hidden': 'true', ...(capture ? { capture: 'environment' } : {}) });
    i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) choose(f); });
    return i;
  }
  const camIn = fileInput(true);
  const libIn = fileInput(false);

  const scanTitle = () => el('h2', { class: 'section-title photo-scan-title' }, 'Scan meal photo');

  const SETUP_TEXT = { key: 'No API key is set for it yet.', model: 'No model is chosen for it yet.', baseUrl: 'Its base URL is not set yet.' };
  function renderNoKey() {
    setEstimateMode(false);
    const cfg = activePhotoConfig();
    const a = getAdapter(cfg.provider);
    replaceChildren(wrap, el('div', { class: 'card stack photo-scan-card' },
      scanTitle(),
      el('p', { class: 'small' }, 'Fill in this meal from a photo: an AI model estimates the foods, portions, calories and macros, and you can change every number before anything is added.'),
      el('p', { class: 'small muted' }, `It uses your own API key from a provider you choose (Anthropic, Google Gemini, OpenAI or an OpenAI-compatible service); usage is billed by that provider. Selected: ${a.label}. ${SETUP_TEXT[cfg.missing] || ''}`),
      settingsLink('Set up provider and key')));
  }

  /** "Anthropic (Claude) · claude-opus-5-5" for the active provider. */
  function activeLine(cfg) {
    const a = getAdapter(cfg.provider);
    return `${a.label} · ${cfg.model || 'no model'}`;
  }

  function renderCapture(msg) {
    setEstimateMode(false);
    const pickRow = el('div', { class: 'grid-2' },
      el('button', { type: 'button', class: ['btn', photo ? null : 'btn-primary'], onClick: () => camIn.click() }, photo ? 'Retake photo' : '📷 Take photo'),
      el('button', { type: 'button', class: 'btn', onClick: () => libIn.click() }, 'Choose photo'));
    const cfg = activePhotoConfig();
    if (!photo) {
      replaceChildren(wrap, el('div', { class: 'card stack photo-scan-card' },
        scanTitle(),
        el('p', { class: 'small muted' }, 'Estimate calories and macros from a photo, then adjust them before adding. Or type the values below.'),
        msg || null,
        pickRow, camIn, libIn,
        el('p', { class: 'small muted row-between photo-model-line' },
          el('span', { class: 'photo-active-provider' }, activeLine(cfg)), settingsLink('Settings'))));
      return;
    }
    replaceChildren(wrap, el('div', { class: 'card stack photo-scan-card' },
      el('div', { class: 'row-between' }, scanTitle(),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { dropPhoto(); renderCapture(); } }, 'Remove photo')),
      el('div', { class: 'photo-preview is-small' }, el('img', { src: photo.url, alt: 'Selected meal photo' })),
      pickRow, camIn, libIn,
      el('div', { class: 'field' }, el('label', { class: 'field-label' }, 'Hint (optional)', hint),
        el('span', { class: 'field-hint' }, 'Anything you know for sure – amounts, ingredients, how it was cooked. It is taken as fact.')),
      msg || null,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: analyse }, 'Analyse'),
      el('p', { class: 'small muted row-between photo-model-line' },
        el('span', { class: 'photo-active-provider' }, `${activeLine(cfg)} · billed by the provider`), settingsLink('Settings'))));
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
      renderCapture(el('p', { class: 'small text-danger', role: 'alert' }, err.message || String(err)));
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
    const status = el('p', { class: 'muted', role: 'status' });
    const tick = () => { status.textContent = `Analysing with ${providerName} · ${model}… ${Math.round((Date.now() - started) / 1000)} s`; };
    tick();
    timer = setInterval(tick, 1000);
    replaceChildren(wrap, el('div', { class: 'card stack photo-scan-card' },
      scanTitle(),
      el('div', { class: 'photo-preview is-small is-busy' }, el('img', { src: photo.url, alt: 'Meal photo being analysed' })),
      el('div', { class: 'progress-indeterminate', role: 'progressbar', 'aria-label': 'Analysing' }),
      status,
      el('p', { class: 'small muted' }, 'This usually takes 10–60 seconds. Cancelling stops waiting; a request already received by the API may still be billed.'),
      el('button', { type: 'button', class: 'btn btn-block', onClick: () => c.abort() }, 'Cancel')));
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
      renderReview(r.dropped ? `Only the first ${rows.length} items are shown.` : null);
    } else {
      renderError(r);
    }
  }

  function renderError(r) {
    setEstimateMode(false);
    const actions = [];
    if (r.retry && r.kind !== 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, 'Try again'));
    if (r.kind === 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, 'Analyse again'));
    if (['auth', 'billing', 'permission', 'model', 'no_key', 'bad_request', 'network'].includes(r.kind)) actions.push(settingsLink());
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { rows = []; lastNote = ''; nameTouched = false; renderReview(); addManual(); } }, 'Add items manually'));
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => renderCapture() }, 'Back to photo'));
    const isInfo = r.kind === 'cancelled' || r.kind === 'empty';
    replaceChildren(wrap, el('div', { class: ['card stack photo-scan-card', isInfo ? null : 'photo-error'] },
      scanTitle(),
      photo ? el('div', { class: 'photo-preview is-small' }, el('img', { src: photo.url, alt: 'Meal photo' })) : null,
      el('div', { class: 'stack', role: 'alert' },
        el('p', { class: isInfo ? null : 'text-danger' }, r.message),
        r.note ? el('p', { class: 'small muted' }, `Model note: ${r.note}`) : null,
        r.detail ? el('p', { class: 'small muted' }, `Details: ${r.detail}`) : null),
      el('div', { class: 'row photo-actions' }, actions),
      el('p', { class: 'small muted' }, 'You can still enter the values by hand below.')));
  }

  // ------------------------------------------------------------ review
  const reviewList = el('div', { class: 'stack' });
  const totalsEl = el('div', { class: 'card photo-totals', 'aria-live': 'polite' });
  const blocker = el('p', { class: 'small field-error' });
  const mealSel = mealSelect(meal);
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block photo-add-items', onClick: addAll });
  const oneName = el('input', { class: 'input', type: 'text', maxlength: String(ENTRY_NAME_MAX), autocomplete: 'off', 'aria-label': 'Name of the single entry',
    onInput: () => { nameTouched = true; persist(); } });
  const oneBtn = el('button', { type: 'button', class: 'btn btn-block photo-add-one', onClick: addOne });
  mealSel.addEventListener('change', updateTotals);

  function renderReview(info) {
    setEstimateMode(true);
    if (!nameTouched) oneName.value = suggestedName();
    const kept = manual.hasValues();
    replaceChildren(wrap,
      el('div', { class: 'row-between' },
        el('h2', { class: 'section-title' }, 'Photo estimate – check and adjust'),
        photo ? el('img', { class: 'photo-thumb', src: photo.url, alt: 'Meal photo' }) : null),
      el('p', { class: 'small muted' }, 'These are estimates. Change the grams, calories or macros of any item before adding; nothing is saved yet.'),
      kept ? el('p', { class: 'small editor-note' }, 'The values you typed in Quick add are kept. “Discard estimate” brings them back.') : null,
      lastNote ? el('p', { class: 'small editor-note' }, lastNote) : null,
      info ? el('p', { class: 'small editor-note', role: 'status' }, info) : null,
      reviewList,
      el('button', { type: 'button', class: 'btn btn-sm photo-add-item', onClick: addManual }, '+ Add item'),
      totalsEl,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel),
      blocker,
      el('section', { class: 'card stack photo-log-option', 'aria-label': 'Add as separate items' },
        el('div', { class: 'field-label' }, 'Separate items'),
        el('p', { class: 'small muted' }, 'One diary entry per item with its grams. Ticked items are saved to your foods; you can save the whole meal afterwards.'),
        addBtn),
      el('section', { class: 'card stack photo-log-option', 'aria-label': 'Add as one entry' },
        el('div', { class: 'field-label' }, 'One quick-add entry'),
        el('p', { class: 'small muted' }, 'Just the meal totals (calories, protein, carbs, fat) as a single Quick add entry.'),
        el('label', { class: 'field' }, el('span', { class: 'field-label' }, 'Entry name'), oneName),
        oneBtn),
      el('div', { class: 'row-between photo-review-foot' },
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: discard }, 'Discard estimate'),
        usedModel ? el('span', { class: 'small muted' }, `Estimated by ${usedModel}`) : null));
    renderRows();
  }

  function suggestedName() {
    const typed = manual.name().trim();
    return typed || photoMealName(rows, hint.value);
  }

  function renderRows() {
    replaceChildren(reviewList, ...(rows.length ? rows.map(rowEl) : [emptyState('No items. Add one manually, or discard the estimate.')]));
    updateTotals();
  }

  function rowEl(row, idx) {
    const subEl = el('span');
    const warnEl = el('ul', { class: 'small photo-warnings' });
    const uid = `${idx}-${Math.random().toString(36).slice(2)}`;
    const valueInputs = {};
    const valueCells = VALUE_FIELDS.map((f) => {
      const id = `pv-${f.key}-${uid}`;
      const input = numberInput({ min: 0, max: f.max, decimals: f.decimals, id, ariaLabel: `${f.label} of ${row.name}`,
        onInput: (n) => {
          if (!(typeof row.amount === 'number' && row.amount > 0)) return;
          row.per100 = setPortionValue(row.per100, row.amount, f.key, n);
          row.fixes = [];
          if (row.confidence !== 'manual') row.edited = true;
          refreshRow(f.key);
          updateTotals();
        } });
      valueInputs[f.key] = input;
      return el('div', { class: 'photo-value' }, el('label', { class: 'photo-value-label small muted', htmlFor: id }, f.label), input);
    });
    const amount = numberInput({ value: row.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: `Amount of ${row.name}`,
      onInput: (n) => { row.amount = n; refreshRow(); updateTotals(); } });
    const remember = el('input', { type: 'checkbox', checked: row.remember, id: `rem-${uid}`,
      onChange: () => { row.remember = remember.checked; persist(); } });
    const card = el('div', { class: ['card stack photo-item'], dataset: { idx: String(idx) } },
      el('div', { class: 'photo-item-head' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, row.name),
          el('div', { class: 'li-sub' },
            el('span', { class: ['badge', CONF_CLASS[row.confidence] || 'badge-conf-low'] }, CONF_LABEL[row.confidence] || row.confidence),
            ' ', subEl)),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: () => editRow(row), 'aria-label': `Edit name and all values of ${row.name}` }, '✎ More'),
        el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Remove ${row.name}`, onClick: () => { rows.splice(rows.indexOf(row), 1); renderRows(); } }, '×')),
      el('div', { class: 'photo-item-amount' },
        el('div', { class: 'input-unit' }, amount, el('span', { class: 'unit' }, row.basis)),
        el('span', { class: 'small muted' }, 'for this amount:')),
      el('div', { class: 'photo-values' }, valueCells),
      warnEl,
      row.assumptions ? el('p', { class: 'small muted' }, row.assumptions) : null,
      el('label', { class: 'row check-row small', htmlFor: remember.id }, remember, el('span', null, 'Remember this food (add to my foods)')));

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
      subEl.textContent = `${fmtNum(row.per100.kcal, 0)} kcal / 100 ${row.basis}`;
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
      note: row.confidence === 'manual' ? null : 'Values per 100 as estimated. Correct anything you know better (e.g. from a label).',
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
    const ok = await confirmDialog({ title: 'Discard the estimate?', message: 'The photo estimate and your changes to it are removed. Nothing has been added to the diary.', confirmLabel: 'Discard', cancelLabel: 'Keep' });
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

  function updateTotals() {
    const t = photoMealTotals(rows);
    replaceChildren(totalsEl,
      el('div', { class: 'row-between' }, el('span', { class: 'field-label' }, 'Meal total'), el('span', { class: 'num photo-total-kcal' }, `${fmtNum(t.kcal, 0)} kcal`)),
      el('div', { class: 'small muted num photo-total-macros' }, macroText(t)));
    const incomplete = rows.length - readyRows().length;
    if (incomplete) totalsEl.append(el('div', { class: 'small text-warning' }, 'Incomplete items are not fully counted.'));
    blocker.textContent = incomplete ? `${incomplete} item${incomplete === 1 ? ' needs' : 's need'} an amount or values before adding.` : '';
    const n = rows.length;
    const blocked = n === 0 || incomplete > 0;
    addBtn.disabled = blocked;
    oneBtn.disabled = blocked;
    addBtn.textContent = n === 0 ? 'No items to add' : `Add ${n} item${n === 1 ? '' : 's'} to ${mealLabel(mealSel.value)}`;
    oneBtn.textContent = n === 0 ? 'Nothing to add' : `Add as one entry · ${fmtNum(t.kcal, 0)} kcal`;
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
    renderReview(`Restored: this is the estimate${when} with your changes, as you left it before the app was reloaded. The photo itself is not kept.`);
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
      toast(`Added ${fmtNum(t.kcal, 0)} kcal to ${mealLabel(mealId)}`, { type: 'success' });
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
    replaceChildren(wrap, el('div', { class: 'card stack' },
      el('h2', { class: 'section-title' }, `Added to ${mealLabel(mealId)}`),
      el('ul', { class: 'plain-list small' }, entries.map((e) => el('li', null, `${e.name} · ${fmtAmount(e.amount, e.basis)} · ${fmtNum(scale(e.per100, e.amount).kcal, 0)} kcal`))),
      el('p', { class: 'num' }, `${fmtNum(t.kcal, 0)} kcal · ${macroText(t)}`),
      remembered ? el('p', { class: 'small muted' }, `${remembered} food${remembered === 1 ? '' : 's'} added to your foods.`) : null,
      el('div', { class: 'row photo-actions' },
        el('button', { type: 'button', class: 'btn', onClick: async () => { if (await openSaveAsMeal(entries, `${mealLabel(mealId)} photo`)) onFinished(); } }, 'Save as meal…'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: () => onFinished() }, 'Done')),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reset }, 'Scan another photo')));
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
