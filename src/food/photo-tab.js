// "Photo" tab of the add-food screen: photo → AI estimate (user's own key) → editable review → diary.
import { el, numberInput, toast, fmtNum, fmtAmount, href, emptyState, replaceChildren } from '../ui/index.js';
import { scale, sumEntries, isComplete } from '../core/nutrition.js';
import { itemWarnings, HINT_MAX, PHOTO_MODELS } from '../core/meal-photo.js';
import { mealLabel } from '../core/food-diary.js';
import { getApiKey, getPhotoModel } from './photo-key.js';
import { analyseMealPhoto } from './photo-provider.js';
import { prepareImage } from './photo-image.js';
import { openFoodEditor } from './food-editor.js';
import { openSaveAsMeal } from './meals.js';
import { logPhotoItems } from './store.js';
import { mealSelect, macroText } from './widgets.js';

const CONF_LABEL = { high: 'high confidence', medium: 'medium confidence', low: 'low confidence', unknown: 'confidence unknown', manual: 'added by you' };
const CONF_CLASS = { high: 'badge-conf-high', medium: 'badge-conf-medium', low: 'badge-conf-low', unknown: 'badge-conf-low', manual: 'badge-edited' };

/**
 * @param {{date: string, meal: string, cleanups: Function[], onFinished: () => void}} opts
 * @returns {{el: HTMLElement, show: () => void}}
 */
export function buildPhotoPanel({ date, meal, cleanups, onFinished }) {
  const wrap = el('div', { class: 'stack photo-panel' });
  let photo = null;        // { blob, url, width, height }
  let ctrl = null;         // AbortController of the running analysis
  let timer = null;
  let rows = [];           // review rows
  let lastNote = '';
  let usedModel = '';

  cleanups.push(() => { if (ctrl) ctrl.abort(); clearInterval(timer); dropPhoto(); });

  function dropPhoto() { if (photo) { URL.revokeObjectURL(photo.url); photo = null; } }
  const settingsLink = (label = 'Photo settings') => el('a', { class: 'btn btn-sm', href: href('food/photo-settings?from=add') }, label);

  // ------------------------------------------------------------ capture
  const hint = el('textarea', { class: 'textarea photo-hint', rows: '2', maxlength: String(HINT_MAX), placeholder: 'Optional hint, e.g. “about 200 g rice, chicken thigh”', 'aria-label': 'Hint for the analysis' });

  function fileInput(capture) {
    const i = el('input', { type: 'file', accept: 'image/*', class: 'visually-hidden-file', tabindex: '-1', 'aria-hidden': 'true', ...(capture ? { capture: 'environment' } : {}) });
    i.addEventListener('change', () => { const f = i.files && i.files[0]; i.value = ''; if (f) choose(f); });
    return i;
  }
  const camIn = fileInput(true);
  const libIn = fileInput(false);

  function renderNoKey() {
    replaceChildren(wrap, el('div', { class: 'card stack' },
      el('h2', { class: 'section-title' }, 'Log a meal from a photo'),
      el('p', null, 'Take a photo of your meal and an AI model estimates the foods, portions and nutrition values. You review and correct everything before it is added.'),
      el('p', { class: 'small muted' }, 'This uses your own Anthropic API key. Each analysis is billed to your Anthropic account. No key is set yet.'),
      settingsLink('Set up API key')));
  }

  function renderCapture(msg) {
    const model = PHOTO_MODELS.find((m) => m.id === getPhotoModel());
    const preview = photo
      ? el('div', { class: 'photo-preview' }, el('img', { src: photo.url, alt: 'Selected meal photo' }))
      : el('div', { class: 'photo-preview is-empty' }, el('span', { class: 'muted small' }, 'No photo yet'));
    const analyseBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: !photo, onClick: analyse }, 'Analyse');
    replaceChildren(wrap,
      preview,
      el('div', { class: 'grid-2' },
        el('button', { type: 'button', class: 'btn', onClick: () => camIn.click() }, photo ? 'Retake photo' : 'Take photo'),
        el('button', { type: 'button', class: 'btn', onClick: () => libIn.click() }, 'Choose photo')),
      camIn, libIn,
      el('div', { class: 'field' }, el('label', { class: 'field-label' }, 'Hint (optional)', hint),
        el('span', { class: 'field-hint' }, 'Anything you know for sure – amounts, ingredients, how it was cooked. It is taken as fact.')),
      msg || null,
      analyseBtn,
      el('p', { class: 'small muted row-between photo-model-line' },
        el('span', null, `Model: ${model ? model.label : getPhotoModel()} · billed to your account`), settingsLink('Settings')));
  }

  async function choose(file) {
    if (!/^image\//.test(file.type || 'image/')) { toast('Choose an image file.', { type: 'error' }); return; }
    replaceChildren(wrap, el('p', { class: 'muted', role: 'status' }, 'Preparing photo…'));
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
    const apiKey = getApiKey();
    if (!apiKey) { renderNoKey(); return; }
    const c = ctrl = new AbortController();
    const started = Date.now();
    const model = getPhotoModel();
    const status = el('p', { class: 'muted', role: 'status' });
    const tick = () => { status.textContent = `Analysing with ${model}… ${Math.round((Date.now() - started) / 1000)} s`; };
    tick();
    timer = setInterval(tick, 1000);
    replaceChildren(wrap,
      el('div', { class: 'photo-preview is-busy' }, el('img', { src: photo.url, alt: 'Meal photo being analysed' })),
      el('div', { class: 'progress-indeterminate', role: 'progressbar', 'aria-label': 'Analysing' }),
      status,
      el('p', { class: 'small muted' }, 'This usually takes 10–60 seconds. Cancelling stops waiting; a request already received by the API may still be billed.'),
      el('button', { type: 'button', class: 'btn btn-block', onClick: () => c.abort() }, 'Cancel'));
    const r = await analyseMealPhoto(photo.blob, { apiKey, model, hint: hint.value, signal: c.signal });
    clearInterval(timer);
    if (ctrl !== c) return;
    ctrl = null;
    if (!wrap.isConnected && c.signal.aborted) return; // view gone
    if (r.ok) {
      usedModel = r.model || model;
      lastNote = r.note;
      rows = r.items.map((it) => ({ ...it, remember: false }));
      renderReview(r.dropped ? `Only the first ${rows.length} items are shown.` : null);
    } else {
      renderError(r);
    }
  }

  function renderError(r) {
    const actions = [];
    if (r.retry && r.kind !== 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, 'Try again'));
    if (r.kind === 'cancelled') actions.push(el('button', { type: 'button', class: 'btn btn-primary', onClick: analyse }, 'Analyse again'));
    if (['auth', 'billing', 'permission', 'model', 'no_key'].includes(r.kind)) actions.push(settingsLink());
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => { rows = []; lastNote = ''; renderReview(); addManual(); } }, 'Add items manually'));
    actions.push(el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => renderCapture() }, 'Back to photo'));
    const isInfo = r.kind === 'cancelled' || r.kind === 'empty';
    replaceChildren(wrap,
      photo ? el('div', { class: 'photo-preview is-small' }, el('img', { src: photo.url, alt: 'Meal photo' })) : null,
      el('div', { class: ['card stack', isInfo ? null : 'photo-error'], role: 'alert' },
        el('p', { class: isInfo ? null : 'text-danger' }, r.message),
        r.note ? el('p', { class: 'small muted' }, `Model note: ${r.note}`) : null,
        r.detail ? el('p', { class: 'small muted' }, `Details: ${r.detail}`) : null),
      el('div', { class: 'row photo-actions' }, actions));
  }

  // ------------------------------------------------------------ review
  const reviewList = el('div', { class: 'stack' });
  const totalsEl = el('div', { class: 'card photo-totals' });
  const blocker = el('p', { class: 'small field-error' });
  const mealSel = mealSelect(meal);
  const addBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: addAll });
  mealSel.addEventListener('change', updateTotals);

  function renderReview(info) {
    replaceChildren(wrap,
      el('div', { class: 'row-between' },
        el('h2', { class: 'section-title' }, 'Check and correct'),
        photo ? el('img', { class: 'photo-thumb', src: photo.url, alt: 'Meal photo' }) : null),
      el('p', { class: 'small muted' }, 'These are estimates. Correct the amounts and values before adding; nothing is saved yet.'),
      lastNote ? el('p', { class: 'small editor-note' }, lastNote) : null,
      info ? el('p', { class: 'small muted' }, info) : null,
      reviewList,
      el('button', { type: 'button', class: 'btn btn-sm photo-add-item', onClick: addManual }, '+ Add item'),
      totalsEl,
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Meal'), mealSel),
      blocker,
      addBtn,
      el('div', { class: 'row-between' },
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => renderCapture() }, '‹ Photo'),
        usedModel ? el('span', { class: 'small muted' }, `Estimated by ${usedModel}`) : null));
    renderRows();
  }

  function renderRows() {
    replaceChildren(reviewList, ...(rows.length ? rows.map(rowEl) : [emptyState('No items. Add one manually or go back to the photo.')]));
    updateTotals();
  }

  function rowEl(row, idx) {
    const kcalEl = el('div', { class: 'num photo-item-kcal' });
    const macroEl = el('div', { class: 'small muted num' });
    const amount = numberInput({ value: row.amount, min: 0.1, max: 5000, decimals: 1, ariaLabel: `Amount of ${row.name}`,
      onInput: (n) => { row.amount = n; refreshRow(); updateTotals(); } });
    const warnEl = el('ul', { class: 'small photo-warnings' });
    const remember = el('input', { type: 'checkbox', checked: row.remember, id: `rem-${idx}-${Math.random().toString(36).slice(2)}`,
      onChange: () => { row.remember = remember.checked; } });
    const card = el('div', { class: ['card stack photo-item'], dataset: { idx: String(idx) } },
      el('div', { class: 'photo-item-head' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, row.name),
          el('div', { class: 'li-sub' },
            el('span', { class: ['badge', CONF_CLASS[row.confidence] || 'badge-conf-low'] }, CONF_LABEL[row.confidence] || row.confidence),
            ` ${fmtNum(row.per100.kcal, 0)} kcal / 100 ${row.basis}`)),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost edit-values', onClick: () => editRow(row), 'aria-label': `Edit values of ${row.name}` }, '✎ Values'),
        el('button', { type: 'button', class: 'btn btn-icon btn-ghost', 'aria-label': `Remove ${row.name}`, onClick: () => { rows.splice(rows.indexOf(row), 1); renderRows(); } }, '×')),
      el('div', { class: 'photo-item-amount' },
        el('div', { class: 'input-unit' }, amount, el('span', { class: 'unit' }, row.basis)),
        el('div', null, kcalEl, macroEl)),
      warnEl,
      row.assumptions ? el('p', { class: 'small muted' }, row.assumptions) : null,
      el('label', { class: 'row check-row small', htmlFor: remember.id }, remember, el('span', null, 'Remember this food (add to my foods)')));

    function refreshRow() {
      const v = scale(row.per100, row.amount ?? 0);
      kcalEl.textContent = `${fmtNum(v.kcal, 0)} kcal`;
      macroEl.textContent = macroText(v);
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
    const last = reviewList.querySelector('.photo-item:last-child input.input-num');
    if (last) { last.focus(); last.select(); }
  }

  function readyRows() { return rows.filter((r) => typeof r.amount === 'number' && r.amount > 0 && isComplete(r)); }

  function updateTotals() {
    const t = sumEntries(rows.filter((r) => typeof r.amount === 'number' && r.amount > 0));
    replaceChildren(totalsEl, 
      el('div', { class: 'row-between' }, el('span', { class: 'field-label' }, 'Meal total'), el('span', { class: 'num photo-total-kcal' }, `${fmtNum(t.kcal, 0)} kcal`)),
      el('div', { class: 'small muted num' }, macroText(t)));
    const incomplete = rows.length - readyRows().length;
    if (incomplete) totalsEl.append(el('div', { class: 'small text-warning' }, 'Incomplete items are not fully counted.'));
    blocker.textContent = incomplete ? `${incomplete} item${incomplete === 1 ? ' needs' : 's need'} an amount or values (✎ Values) before adding.` : '';
    const n = rows.length;
    addBtn.disabled = n === 0 || incomplete > 0;
    addBtn.textContent = n === 0 ? 'No items to add' : `Add ${n} item${n === 1 ? '' : 's'} to ${mealLabel(mealSel.value)}`;
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

  function renderDone(entries, mealId) {
    const t = sumEntries(entries);
    const remembered = rows.filter((r) => r.remember).length;
    toast(`Added ${entries.length} item${entries.length === 1 ? '' : 's'} to ${mealLabel(mealId)}`, { type: 'success' });
    rows = [];
    replaceChildren(wrap, el('div', { class: 'card stack' },
      el('h2', { class: 'section-title' }, `Added to ${mealLabel(mealId)}`),
      el('ul', { class: 'plain-list small' }, entries.map((e) => el('li', null, `${e.name} · ${fmtAmount(e.amount, e.basis)} · ${fmtNum(scale(e.per100, e.amount).kcal, 0)} kcal`))),
      el('p', { class: 'num' }, `${fmtNum(t.kcal, 0)} kcal · ${macroText(t)}`),
      remembered ? el('p', { class: 'small muted' }, `${remembered} food${remembered === 1 ? '' : 's'} added to your foods.`) : null,
      el('div', { class: 'row photo-actions' },
        el('button', { type: 'button', class: 'btn', onClick: async () => { if (await openSaveAsMeal(entries, `${mealLabel(mealId)} photo`)) onFinished(); } }, 'Save as meal…'),
        el('button', { type: 'button', class: 'btn btn-primary', onClick: () => onFinished() }, 'Done')),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { dropPhoto(); hint.value = ''; renderCapture(); } }, 'Analyse another photo')));
  }

  return {
    el: wrap,
    show() {
      if (ctrl || rows.length || wrap.querySelector('.photo-item, .photo-error, [role="alert"]')) return; // keep the current state
      if (!getApiKey()) renderNoKey();
      else renderCapture();
    },
  };
}
