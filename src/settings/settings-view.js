// Settings: daily targets, volume weighting, export/import, storage status, about.
import { el, pageHeader, field, numberInput, toast, confirmDialog, fmtNum, fmtBytes } from '../ui/index.js';
import * as db from '../db/db.js';
import { macroKcal } from '../core/nutrition.js';
import { today } from '../core/dates.js';
import { APP_VERSION } from '../version.js';

const STORE_LABELS = {
  foods: 'Foods', diary: 'Diary entries', meals: 'Saved meals', exercises: 'Exercises', routines: 'Routines',
  workouts: 'Workouts', weights: 'Body weights', settings: 'Settings', targetHistory: 'Target history',
};

/** @param {HTMLElement} container */
export async function mountSettings(container) {
  const [targets, volume] = await Promise.all([db.getSetting('targets'), db.getSetting('volume')]);
  container.append(
    pageHeader({ title: 'Settings' }),
    targetsSection(targets),
    volumeSection(volume),
    dataSection(),
    storageSection(),
    aboutSection(),
  );
}

function section(title, ...children) {
  return el('section', { class: 'section' }, el('h2', { class: 'section-title' }, title), el('div', { class: 'card stack' }, children));
}

// ---------------------------------------------------------------- targets

function targetsSection(targets) {
  const inputs = {
    kcal: numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: 'Calories target' }),
    protein: numberInput({ value: targets.protein, min: 0, max: 1000, decimals: 0, ariaLabel: 'Protein target' }),
    carbs: numberInput({ value: targets.carbs, min: 0, max: 2000, decimals: 0, ariaLabel: 'Carbohydrates target' }),
    fat: numberInput({ value: targets.fat, min: 0, max: 1000, decimals: 0, ariaLabel: 'Fat target' }),
  };
  const hint = el('p', { class: 'field-hint' });
  const updateHint = () => {
    const m = { protein: inputs.protein.getNumber(), carbs: inputs.carbs.getNumber(), fat: inputs.fat.getNumber() };
    hint.textContent = `Macros add up to ${fmtNum(macroKcal(m), 0)} kcal.`;
  };
  for (const k of ['protein', 'carbs', 'fat']) inputs[k].addEventListener('input', updateHint);
  updateHint();

  const save = async () => {
    const v = {};
    for (const [k, input] of Object.entries(inputs)) {
      v[k] = input.getNumber();
      if (v[k] === null) { input.focus(); toast(`Enter a valid ${k} target.`, { type: 'error' }); return; }
    }
    await db.setSetting('targets', { ...targets, ...v, source: 'manual' });
    toast('Targets saved', { type: 'success' });
  };

  return section('Daily targets',
    el('div', { class: 'grid-2' },
      field('Calories', inputs.kcal, { unit: 'kcal' }),
      field('Protein', inputs.protein, { unit: 'g' }),
      field('Carbs', inputs.carbs, { unit: 'g' }),
      field('Fat', inputs.fat, { unit: 'g' })),
    hint,
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save targets'));
}

// ---------------------------------------------------------------- volume

function volumeSection(volume) {
  const inputs = {
    primary: numberInput({ value: volume.primary, min: 0, max: 5, ariaLabel: 'Primary muscle weight' }),
    secondary: numberInput({ value: volume.secondary, min: 0, max: 5, ariaLabel: 'Secondary muscle weight' }),
    dropset: numberInput({ value: volume.dropset, min: 0, max: 5, ariaLabel: 'Dropset weight' }),
  };
  const save = async () => {
    const v = {};
    for (const [k, input] of Object.entries(inputs)) {
      v[k] = input.getNumber();
      if (v[k] === null) { input.focus(); toast(`Enter a number from 0 to 5 for ${k}.`, { type: 'error' }); return; }
    }
    await db.setSetting('volume', v);
    toast('Volume weighting saved', { type: 'success' });
  };
  return section('Weekly volume weighting',
    el('p', { class: 'muted small' }, 'How many sets one done set counts for, per muscle.'),
    el('div', { class: 'grid-3' },
      field('Primary', inputs.primary),
      field('Secondary', inputs.secondary),
      field('Dropset', inputs.dropset)),
    el('p', { class: 'field-hint' }, 'Dropset rows count this factor × the primary/secondary weights.'),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save weighting'));
}

// ---------------------------------------------------------------- export / import

function dataSection() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });

  const doExport = async () => {
    try {
      const data = await db.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `tracker-export-${today()}.json` });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      const n = Object.values(data.stores).reduce((s, r) => s + r.length, 0);
      toast(`Exported ${n} records`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Export failed: ${err.message}`, { type: 'error' });
    }
  };

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast('That file is not valid JSON.', { type: 'error' });
      return;
    }
    await importFlow(data);
  });

  return section('Backup',
    el('p', { class: 'muted small' }, 'All data lives only on this device. Export regularly.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-block', type: 'button', onClick: doExport }, 'Export JSON'),
      el('button', { class: 'btn btn-block', type: 'button', onClick: () => fileInput.click() }, 'Import JSON')),
    fileInput);
}

/** Validate, show counts, confirm, replace. Exported for testing from the console. */
export async function importFlow(data) {
  const v = db.validateImport(data);
  if (!v.ok) { toast(`Import failed: ${v.error}`, { type: 'error', duration: 5000 }); return false; }
  const rows = Object.entries(v.counts).map(([s, n]) =>
    el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, STORE_LABELS[s] || s), el('span', { class: 'num' }, n)));
  const message = el('div', { class: 'stack' },
    el('p', 'This file contains:'),
    el('div', { class: 'list' }, rows),
    v.ignored.length ? el('p', { class: 'muted small' }, `Ignored unknown parts: ${v.ignored.join(', ')}`) : null,
    el('p', el('strong', 'Importing replaces ALL data on this device.'), ' Export first if you are unsure.'));
  const ok = await confirmDialog({ title: 'Import backup?', message, confirmLabel: 'Replace all data', danger: true });
  if (!ok) return false;
  try {
    await db.importAll(v.data);
    toast('Import complete', { type: 'success' });
    location.reload();
    return true;
  } catch (err) {
    console.error(err);
    toast(`Import failed, nothing was changed: ${err.message}`, { type: 'error', duration: 6000 });
    return false;
  }
}

// ---------------------------------------------------------------- storage

function storageSection() {
  const status = el('p', 'Checking…');
  const btn = el('button', { class: 'btn btn-block', type: 'button', hidden: true }, 'Ask to keep data permanently');
  const refresh = async () => {
    const s = await db.storageStatus();
    const persist = s.persisted === null ? 'Persistence not supported by this browser.'
      : s.persisted ? 'Persistent: the browser will not clear this data automatically.'
        : 'Not persistent: the browser may clear data under storage pressure. Export regularly.';
    status.textContent = `${persist}${s.usage !== null ? ` Using ${fmtBytes(s.usage)}.` : ''}`;
    btn.hidden = s.persisted !== false;
  };
  btn.addEventListener('click', async () => {
    const r = await db.requestPersist();
    toast(r ? 'Storage is now persistent' : 'The browser declined (installing the app to the home screen usually helps).');
    refresh();
  });
  refresh();
  return section('Storage', status, btn);
}

// ---------------------------------------------------------------- about

function aboutSection() {
  return section('About',
    el('div', { class: 'list' },
      el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, 'App version'), el('span', { class: 'num' }, APP_VERSION)),
      el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, 'Data schema'), el('span', { class: 'num' }, db.DB_VERSION)),
      el('a', { class: 'list-item', href: 'spike/index.html' }, el('span', { class: 'li-main' }, 'Barcode spike (step 1)'), el('span', { class: 'li-chevron' }, '›'))));
}
