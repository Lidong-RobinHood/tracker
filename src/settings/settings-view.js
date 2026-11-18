// Settings: daily targets, volume weighting, export/import, storage status, about.
import { el, pageHeader, field, numberInput, toast, confirmDialog, fmtNum, fmtBytes } from '../ui/index.js';
import * as db from '../db/db.js';
import { macroKcal } from '../core/nutrition.js';
import { today } from '../core/dates.js';
import { APP_VERSION } from '../version.js';
import { ACTIVITY_LEVELS, GOAL_RATE_MIN, GOAL_RATE_MAX, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';

const STORE_LABELS = {
  foods: 'Foods', diary: 'Diary entries', meals: 'Saved meals', exercises: 'Exercises', routines: 'Routines',
  workouts: 'Workouts', weights: 'Body weights', settings: 'Settings', targetHistory: 'Target history',
};

/** @param {HTMLElement} container */
export async function mountSettings(container) {
  const [targets, volume, goal, profile, adaptive] = await Promise.all([db.getSetting('targets'), db.getSetting('volume'),
    db.getSetting('goal'), db.getSetting('profile'), db.getSetting('adaptive')]);
  container.append(
    pageHeader({ title: 'Settings' }),
    targetsSection(targets),
    goalSection(targets, goal, profile, adaptive || {}),
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

// ---------------------------------------------------------------- goal, profile, adaptive options (trends)

function goalSection(targets, goal, profile, adaptive) {
  const select = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const mode = select(targets.source === 'adaptive' ? 'adaptive' : 'manual',
    [['manual', 'Manual (as set above)'], ['adaptive', 'Adaptive (weekly check-in)']], 'How targets are set');
  const rate = numberInput({ value: goal.rateKgPerWeek ?? 0, min: GOAL_RATE_MIN, max: GOAL_RATE_MAX, decimals: 2, ariaLabel: 'Goal rate' });
  const sex = select(profile.sex, [['', 'Not set'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other / prefer not to say']], 'Sex');
  const birthYear = numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: 'Birth year' });
  const height = numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: 'Height' });
  const activity = select(profile.activity, [['', 'Not set'], ...ACTIVITY_LEVELS.map((a) => [a.id, `${a.label} – ${a.hint}`])], 'Activity level');
  const protein = numberInput({ value: adaptive.proteinPerKg ?? ADAPTIVE_DEFAULTS.proteinPerKg, min: 0.8, max: 3.5, decimals: 2, ariaLabel: 'Protein per kg' });
  const fat = numberInput({ value: adaptive.fatPerKg ?? ADAPTIVE_DEFAULTS.fatPerKg, min: 0.3, max: 2, decimals: 2, ariaLabel: 'Fat per kg' });
  const floor = numberInput({ value: adaptive.kcalFloor ?? null, integer: true, min: 800, max: 4000, placeholder: 'by sex', ariaLabel: 'Calorie floor' });

  const save = async () => {
    const r = rate.getNumber();
    if (r === null) { rate.focus(); toast(`Enter a goal from ${GOAL_RATE_MIN} to +${GOAL_RATE_MAX} kg a week.`, { type: 'error' }); return; }
    const checks = [[birthYear, 'birth year'], [height, 'height'], [protein, 'protein per kg'], [fat, 'fat per kg'], [floor, 'calorie floor']];
    for (const [input, name] of checks) {
      if (input.value.trim() && input.getNumber() === null) { input.focus(); toast(`Enter a valid ${name} (or leave it empty).`, { type: 'error' }); return; }
    }
    if (protein.getNumber() === null) { protein.focus(); toast('Enter protein per kg.', { type: 'error' }); return; }
    if (fat.getNumber() === null) { fat.focus(); toast('Enter fat per kg.', { type: 'error' }); return; }
    const current = await db.getSetting('targets');
    await Promise.all([
      db.setSetting('goal', { ...goal, rateKgPerWeek: r }),
      db.setSetting('profile', { ...profile, sex: sex.value || null, birthYear: birthYear.getNumber(), heightCm: height.getNumber(), activity: activity.value || null }),
      db.setSetting('adaptive', { ...adaptive, proteinPerKg: protein.getNumber(), fatPerKg: fat.getNumber(), kcalFloor: floor.getNumber() }),
      db.setSetting('targets', { ...current, source: mode.value }),
    ]);
    toast('Goal and profile saved', { type: 'success' });
  };

  return section('Goal & adaptive targets',
    field('Targets', mode, { hint: 'Adaptive: each Monday the Trends tab proposes new targets from your weight and food; nothing changes until you accept.' }),
    field('Goal rate', rate, { unit: 'kg/wk', hint: `Negative = lose. −0.5 = lose half a kilo a week, 0 = maintain, +0.25 = gain a quarter kilo. Range ${GOAL_RATE_MIN} to +${GOAL_RATE_MAX}.` }),
    el('h3', { class: 'field-label' }, 'Profile (for the formula estimate before enough data)'),
    el('div', { class: 'grid-2' },
      field('Sex', sex),
      field('Birth year', birthYear),
      field('Height', height, { unit: 'cm' })),
    field('Activity level', activity),
    el('h3', { class: 'field-label' }, 'Adaptive macros'),
    el('div', { class: 'grid-3' },
      field('Protein', protein, { unit: 'g/kg' }),
      field('Fat min.', fat, { unit: 'g/kg' }),
      field('Floor', floor, { unit: 'kcal' })),
    el('p', { class: 'field-hint' }, 'Per kg of trend weight; carbs fill the rest. Floor: lowest calorie target ever proposed (empty = 1200 female, 1500 male, 1350 otherwise).'),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save goal & profile'));
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
