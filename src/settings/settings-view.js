// Settings: daily targets, volume weighting, export/import, storage status, about.
import { el, pageHeader, field, numberInput, toast, confirmDialog, fmtNum, fmtBytes } from '../ui/index.js';
import * as db from '../db/db.js';
import { macroKcal } from '../core/nutrition.js';
import { MACROS, SPLIT_PRESETS, targetMode, validateSplit, macroGrams, gramsFromPct, pctFromGrams, pctOfKcal, carbsRest } from '../core/macro-split.js';
import { today } from '../core/dates.js';
import { APP_VERSION } from '../version.js';
import { ACTIVITY_LEVELS, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';
import { rateToGoal, goalToRate, amountValid, GOAL_AMOUNT_MAX, GOAL_PRESETS, GOAL_DEFAULT_AMOUNT } from '../core/goal-rate.js';
import { buildTargets } from '../core/setup.js';
import { goalSign, signedAmount, signedRateSpeech, signedGoalSummary } from '../core/goal-display.js';
import { lastExportText } from '../core/backup-reminder.js';
import { backupState, markExported, noteRestored } from '../onboarding/backup.js';
import { onUpdateState, checkForUpdate, applyUpdate } from '../onboarding/update.js';

const STORE_LABELS = {
  foods: 'Foods', diary: 'Diary entries', meals: 'Saved meals', exercises: 'Exercises', routines: 'Routines',
  workouts: 'Workouts', weights: 'Body weights', settings: 'Settings', targetHistory: 'Target history',
};

function ensureCss() {
  if (document.querySelector('link[data-settings-css]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./settings.css', import.meta.url).href, 'data-settings-css': '' }));
}

/** @param {HTMLElement} container */
export async function mountSettings(container) {
  ensureCss();
  container.classList.add('settings-view');
  const [targets, volume, goal, profile, adaptive] = await Promise.all([db.getSetting('targets'), db.getSetting('volume'),
    db.getSetting('goal'), db.getSetting('profile'), db.getSetting('adaptive')]);
  const goalEl = goalSection(targets, goal, profile, adaptive || {});
  container.append(
    pageHeader({ title: 'Settings' }),
    backupReminderCard(),
    targetsSection(targets, (t) => goalEl.updateSplitNote(t)),
    goalEl,
    volumeSection(volume),
    linksSection(),
    dataSection(),
    storageSection(),
    aboutSection(),
  );
  return () => { for (const fn of cleanups.splice(0)) fn(); };
}

/** Run when the view is left (update-state subscription). */
const cleanups = [];

function section(title, ...children) {
  return el('section', { class: 'section' }, el('h2', { class: 'section-title' }, title), el('div', { class: 'card stack' }, children));
}

// ---------------------------------------------------------------- targets

const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

/** Targets as grams (always stored) or as a percentage split of calories (mode 'percent', see core/macro-split.js). */
function targetsSection(targets, onSaved) {
  let mode = targetMode(targets);
  const kcalInput = numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: 'Calories target' });
  const grams = {
    protein: numberInput({ value: targets.protein, min: 0, max: 1000, decimals: 0, ariaLabel: 'Protein target in grams' }),
    carbs: numberInput({ value: targets.carbs, min: 0, max: 2000, decimals: 0, ariaLabel: 'Carbohydrates target in grams' }),
    fat: numberInput({ value: targets.fat, min: 0, max: 1000, decimals: 0, ariaLabel: 'Fat target in grams' }),
  };
  const storedPct = mode === 'percent' && targets.pct ? targets.pct : {};
  const pct = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: storedPct[k] ?? null, min: 0, max: 100, decimals: 1,
    ariaLabel: `${MACRO_LABEL[k]} share of calories in percent` })]));
  // Percent fields: whole numbers or one decimal only.
  const readPct = (k) => {
    const n = pct[k].getNumber();
    return n !== null && Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? n : null;
  };
  const pctValues = () => Object.fromEntries(MACROS.map((k) => [k, readPct(k)]));
  const gramValues = () => Object.fromEntries(MACROS.map((k) => [k, grams[k].getNumber()]));

  const gramHints = Object.fromEntries(MACROS.map((k) => [k, el('div', { class: 'field-hint num', 'aria-live': 'polite' })]));
  const pctHints = Object.fromEntries(MACROS.map((k) => [k, el('div', { class: 'field-hint num', 'aria-live': 'polite' })]));
  const withHint = (label, control, unit, hint) => {
    const f = field(label, control, { unit });
    f.append(hint);
    return f;
  };
  const macrosHint = el('p', { class: 'field-hint' });
  const sumLine = el('p', { class: 'small num', 'aria-live': 'polite' });
  const restBtn = el('button', { class: 'btn btn-sm', type: 'button' }, 'Set carbs to the rest');
  const presetChips = SPLIT_PRESETS.map((p) => el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false',
    'aria-label': `${p.pct.protein} % protein, ${p.pct.carbs} % carbs, ${p.pct.fat} % fat`,
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); update(); } }, p.label));
  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save targets');

  const gramsPanel = el('div', { class: 'stack' },
    el('div', { class: 'grid-3' },
      MACROS.map((k) => withHint(MACRO_LABEL[k], grams[k], 'g', gramHints[k]))),
    macrosHint);
  const pctPanel = el('div', { class: 'stack' },
    el('div', { class: 'chips', role: 'group', 'aria-label': 'Preset splits' }, presetChips),
    el('div', { class: 'grid-3' },
      MACROS.map((k) => withHint(MACRO_LABEL[k], pct[k], '%', pctHints[k]))),
    el('div', { class: 'row-between' }, sumLine, restBtn),
    el('p', { class: 'field-hint' }, 'Protein and carbs 4 kcal/g, fat 9 kcal/g. Grams are rounded to whole numbers.'));

  const tabBtn = (m, label) => el('button', { type: 'button', role: 'tab', dataset: { mode: m }, onClick: () => switchMode(m) }, label);
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Enter macros as' }, tabBtn('grams', 'Grams'), tabBtn('percent', 'Percent'));

  function update() {
    const kcal = kcalInput.getNumber();
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    gramsPanel.hidden = mode !== 'grams';
    pctPanel.hidden = mode !== 'percent';
    if (mode === 'grams') {
      const g = gramValues();
      for (const k of MACROS) {
        const share = pctOfKcal(kcal, g[k], k);
        gramHints[k].textContent = share === null ? ' ' : `${fmtNum(share, 0)} % of kcal`;
      }
      macrosHint.textContent = `Macros add up to ${fmtNum(macroKcal(g), 0)} kcal.`;
      saveBtn.disabled = false;
      return;
    }
    const p = pctValues();
    // Just switched, nothing edited: the percentages only describe the stored grams, so show those.
    const keep = untouched();
    for (const k of MACROS) {
      if (pct[k].value.trim() && p[k] === null) pct[k].setAttribute('aria-invalid', 'true');
      const g = keep ? memo.grams[k] : macroGrams(kcal, p[k], k);
      pctHints[k].textContent = g === null ? '= – g' : `= ${fmtNum(Math.round(g), 0)} g`;
    }
    const v = validateSplit(p);
    const allValid = MACROS.every((k) => p[k] !== null);
    sumLine.className = `small num ${v.ok ? 'text-success' : 'text-warning'}`;
    const badInput = MACROS.some((k) => pct[k].value.trim() && p[k] === null);
    sumLine.textContent = badInput ? 'Use 0–100 with at most one decimal.'
      : !allValid ? `Total ${fmtNum(v.sum)} % (enter all three)`
      : v.ok ? `Total ${fmtNum(v.sum)} % ✓`
        : v.diff < 0 ? `Total ${fmtNum(v.sum)} % · ${fmtNum(-v.diff)} % left to assign`
          : `Total ${fmtNum(v.sum)} % · ${fmtNum(v.diff)} % too much`;
    const rest = carbsRest(p);
    restBtn.hidden = v.ok && allValid; // already 100 %: nothing to fill in
    restBtn.disabled = rest === null || (v.ok && p.carbs === rest);
    restBtn.textContent = rest === null ? 'Set carbs to the rest' : `Set carbs to the rest (${fmtNum(rest)} %)`;
    for (const [i, preset] of SPLIT_PRESETS.entries()) {
      presetChips[i].setAttribute('aria-pressed', String(MACROS.every((k) => p[k] === preset.pct[k])));
    }
    saveBtn.disabled = !(v.ok && allValid && kcal !== null);
  }

  // Remembers what the last switch produced, so switching back without edits restores the exact values.
  let memo = mode === 'percent' ? { kcal: targets.kcal, grams: gramValues(), pct: pctValues() } : null;
  const same = (a, b) => !!a && !!b && MACROS.every((k) => a[k] === b[k]);
  /** Percent mode, and neither calories nor percentages edited since the switch / load / save. */
  const untouched = () => mode === 'percent' && !!memo && memo.kcal === kcalInput.getNumber() && same(memo.pct, pctValues())
    && MACROS.every((k) => Number.isFinite(memo.grams[k]));

  function switchMode(next) {
    if (next === mode) return;
    const kcal = kcalInput.getNumber();
    if (next === 'percent') {
      const g = gramValues();
      let p = memo && memo.kcal === kcal && same(memo.grams, g) ? memo.pct : null;
      if (!p) p = pctFromGrams(g, 0);
      if (p) for (const k of MACROS) pct[k].setNumber(p[k]);
      memo = { kcal, grams: g, pct: pctValues() };
    } else {
      const p = pctValues();
      let g = memo && memo.kcal === kcal && same(memo.pct, p) ? memo.grams : null;
      if (!g && validateSplit(p).ok && kcal !== null) g = gramsFromPct(kcal, p);
      if (g) for (const k of MACROS) grams[k].setNumber(g[k]);
      memo = { kcal, grams: gramValues(), pct: p };
    }
    mode = next;
    update();
  }

  kcalInput.addEventListener('input', update);
  for (const k of MACROS) { grams[k].addEventListener('input', update); pct[k].addEventListener('input', update); }
  restBtn.addEventListener('click', () => {
    const rest = carbsRest(pctValues());
    if (rest !== null) { pct.carbs.setNumber(rest); update(); }
  });

  saveBtn.addEventListener('click', async () => {
    const kcal = kcalInput.getNumber();
    if (kcal === null) { kcalInput.focus(); toast('Enter a valid calories target.', { type: 'error' }); return; }
    const current = await db.getSetting('targets');
    // Same rules as the first-run setup (core/setup.js buildTargets).
    const r = buildTargets(current, mode === 'grams' ? { mode, kcal, ...gramValues() } : { mode, kcal, pct: pctValues() });
    if (!r.ok) {
      if (grams[r.field]) grams[r.field].focus();
      toast(r.error, { type: 'error' });
      return;
    }
    let next = r.targets;
    // Saved right after switching to Percent without edits: the stored grams stay as they are
    // (the rounded percentages would turn e.g. 70 g fat into 71 g).
    if (mode === 'percent' && untouched()) next = { ...next, ...memo.grams };
    await db.setSetting('targets', next);
    memo = { kcal, grams: { protein: next.protein, carbs: next.carbs, fat: next.fat }, pct: next.pct || pctValues() };
    if (mode === 'percent') for (const k of MACROS) grams[k].setNumber(next[k]);
    toast(mode === 'percent' ? `Targets saved: ${next.protein} g protein, ${next.carbs} g carbs, ${next.fat} g fat` : 'Targets saved', { type: 'success' });
    if (onSaved) onSaved(next);
  });

  update();
  return section('Daily targets',
    tabs,
    field('Calories', kcalInput, { unit: 'kcal' }),
    gramsPanel,
    pctPanel,
    saveBtn);
}

// ---------------------------------------------------------------- goal, profile, adaptive options (trends)

function goalSection(targets, goal, profile, adaptive) {
  const select = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const mode = select(targets.source === 'adaptive' ? 'adaptive' : 'manual',
    [['manual', 'Manual (as set above)'], ['adaptive', 'Adaptive (weekly check-in)']], 'How targets are set');
  const rate = goalRateControl(goal.rateKgPerWeek);
  const sex = select(profile.sex, [['', 'Not set'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other / prefer not to say']], 'Sex');
  const birthYear = numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: 'Birth year' });
  const height = numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: 'Height' });
  const activity = select(profile.activity, [['', 'Not set'], ...ACTIVITY_LEVELS.map((a) => [a.id, `${a.label} – ${a.hint}`])], 'Activity level');
  const protein = numberInput({ value: adaptive.proteinPerKg ?? ADAPTIVE_DEFAULTS.proteinPerKg, min: 0.8, max: 3.5, decimals: 2, ariaLabel: 'Protein per kg' });
  const fat = numberInput({ value: adaptive.fatPerKg ?? ADAPTIVE_DEFAULTS.fatPerKg, min: 0.3, max: 2, decimals: 2, ariaLabel: 'Fat per kg' });
  const floor = numberInput({ value: adaptive.kcalFloor ?? null, integer: true, min: 800, max: 4000, placeholder: 'auto', ariaLabel: 'Calorie floor' });

  const save = async () => {
    const r = rate.getRate();
    if (r === null) {
      rate.amount.focus();
      const dir = rate.getDirection();
      toast(`Enter how many kg a week to ${dir}: more than 0, at most ${GOAL_AMOUNT_MAX[dir]}.`, { type: 'error' });
      return;
    }
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

  const splitNote = el('p', { class: 'field-hint text-warning' });
  const updateSplitNote = (t) => {
    splitNote.hidden = targetMode(t) !== 'percent' || !t.pct;
    if (!splitNote.hidden) {
      splitNote.textContent = `Your daily targets use a percentage split (${fmtNum(t.pct.protein)} / ${fmtNum(t.pct.carbs)} / ${fmtNum(t.pct.fat)} %). `
        + 'An accepted check-in changes only the calories; the grams follow your split and the per-kg values above are not used.';
    }
  };
  const sec = section('Goal & adaptive targets',
    field('Targets', mode, { hint: 'Adaptive: each Monday the Trends tab proposes new targets from your weight and food; nothing changes until you accept.' }),
    rate,
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
    splitNote,
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save goal & profile'));
  sec.updateSplitNote = updateSplitNote;
  updateSplitNote(targets);
  return sec;
}

/**
 * Goal as Lose | Maintain | Gain plus a positive amount in kg a week (no minus key needed on a phone keypad).
 * The sign is always shown: a fixed "−" (lose) or "+" (gain) in front of the field, signed chips and a
 * signed summary (core/goal-display.js). Stored as the signed settings.goal.rateKgPerWeek (core/goal-rate.js).
 * Shared with the first-run setup (src/onboarding/welcome.js).
 * @returns {HTMLElement & {getRate: () => number|null, getDirection: () => string, amount: HTMLInputElement}}
 */
export function goalRateControl(storedRate) {
  ensureCss();
  const initial = rateToGoal(storedRate);
  let direction = initial.direction;
  const uid = Math.random().toString(36).slice(2);
  const amount = numberInput({ value: initial.amount, min: 0, max: Math.max(GOAL_AMOUNT_MAX.lose, GOAL_AMOUNT_MAX.gain), decimals: 2,
    ariaLabel: 'Amount in kg per week', id: `goal-amount-${uid}` });
  // Visible summary with the signed rate; screen readers get the spoken form ("minus 0.5 kilograms per week").
  const summaryText = el('span', { 'aria-hidden': 'true' });
  const summarySpeech = el('span', { class: 'set-sr' });
  const summary = el('div', { class: 'field-hint', 'aria-live': 'polite' }, summaryText, summarySpeech);
  const signEl = el('span', { class: 'set-goal-sign', 'aria-hidden': 'true' });
  const DIRS = [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']];
  const dirBtns = DIRS.map(([d, label]) => el('button', { type: 'button', role: 'radio', dataset: { dir: d },
    onClick: () => setDirection(d, true) }, label));
  const group = el('div', { class: 'tabs', role: 'radiogroup', 'aria-labelledby': `goal-label-${uid}` }, dirBtns);
  // Arrow keys move between the three options (radio group pattern).
  group.addEventListener('keydown', (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = DIRS.findIndex(([d]) => d === direction);
    const next = DIRS[(i + step + DIRS.length) % DIRS.length][0];
    setDirection(next, true);
    dirBtns.find((b) => b.dataset.dir === next).focus();
  });
  const chipsBox = el('div', { class: 'chips', role: 'group', 'aria-label': 'Common amounts' });
  const amountLabel = el('label', { class: 'field-label', htmlFor: amount.id }, 'Amount');
  const amountRow = el('div', { class: 'stack' },
    el('div', { class: 'field' }, amountLabel,
      el('div', { class: 'input-unit set-goal-signed' }, signEl, amount, el('span', { class: 'unit' }, 'kg/wk'))),
    chipsBox);

  const current = () => amount.getNumber();
  function paint() {
    for (const b of dirBtns) {
      const on = b.dataset.dir === direction;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-active', on);
      b.tabIndex = on ? 0 : -1;
    }
    const maintain = direction === 'maintain';
    amountRow.hidden = maintain;
    amount.disabled = maintain;
    const n = current();
    const valid = !maintain && amountValid(direction, n);
    // numberInput only knows 0…1; the limit depends on the direction.
    if (!maintain && amount.value.trim() !== '' && !valid) amount.setAttribute('aria-invalid', 'true');
    else amount.removeAttribute('aria-invalid');
    for (const c of chipsBox.children) c.setAttribute('aria-pressed', String(Number(c.dataset.kg) === n));
    const kcalDay = valid ? Math.round((n * ADAPTIVE_DEFAULTS.kcalPerKg) / 7 / 10) * 10 : null;
    const limits = ` Lose up to ${GOAL_AMOUNT_MAX.lose} kg or gain up to ${GOAL_AMOUNT_MAX.gain} kg a week.`;
    const line = signedGoalSummary(direction, n, { max: GOAL_AMOUNT_MAX[direction], kcalDay });
    summaryText.textContent = `${line}.${limits}`;
    summarySpeech.textContent = `${valid || maintain ? signedRateSpeech(direction, n) : line}.${limits}`;
    signEl.textContent = goalSign(direction);
    amount.setAttribute('aria-label', direction === 'lose' ? 'Amount to lose, minus kilograms per week' : 'Amount to gain, plus kilograms per week');
  }
  function setDirection(d, byUser) {
    direction = d;
    if (d !== 'maintain') {
      chipsBox.replaceChildren(...GOAL_PRESETS[d].map((kg) => el('button', { class: 'chip', type: 'button', dataset: { kg: String(kg) },
        'aria-pressed': 'false', 'aria-label': signedRateSpeech(d, kg),
        onClick: () => { amount.setNumber(kg); paint(); } }, signedAmount(d, kg))));
      // Switching from Maintain with nothing typed yet: start from a sensible amount.
      if (byUser && amount.value.trim() === '') amount.setNumber(GOAL_DEFAULT_AMOUNT[d]);
    } else {
      chipsBox.replaceChildren();
    }
    paint();
  }
  amount.addEventListener('input', paint);

  const wrap = /** @type {any} */ (el('div', { class: 'field' },
    el('div', { class: 'field-label', id: `goal-label-${uid}` }, 'Goal'),
    group,
    amountRow,
    summary));
  wrap.getDirection = () => direction;
  wrap.getRate = () => goalToRate(direction, current());
  wrap.amount = amount;
  setDirection(direction, false);
  return wrap;
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

/**
 * Download every store as one JSON file and record the export time (settings.meta.lastExportAt) for
 * the backup reminder. Also used by the reminder banner. @returns {Promise<boolean>} success
 */
export async function exportBackup() {
  try {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `tracker-export-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await markExported(data.exportedAt);
    const n = Object.values(data.stores).reduce((s, r) => s + r.length, 0);
    toast(`Exported ${n} records. Keep the file somewhere other than this phone.`, { type: 'success', duration: 5000 });
    window.dispatchEvent(new CustomEvent('tracker:exported'));
    return true;
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, { type: 'error' });
    return false;
  }
}

function dataSection() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const lastLine = el('p', { class: 'small', 'aria-live': 'polite' });
  const refreshLast = async () => {
    const meta = await db.getSetting('meta');
    lastLine.textContent = `Last export from this device: ${lastExportText(meta.lastExportAt, Date.now())}.`;
  };
  const doExport = async () => { if (await exportBackup()) refreshLast(); };
  refreshLast();

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
    el('p', { class: 'muted small' }, 'All data lives only on this device. Export regularly and keep the file somewhere else (cloud drive, e-mail to yourself). To move to a new phone: export here, import the file there.'),
    lastLine,
    el('div', { class: 'row' },
      el('button', { class: 'btn btn-block', type: 'button', onClick: doExport }, 'Export JSON'),
      el('button', { class: 'btn btn-block', type: 'button', onClick: () => fileInput.click() }, 'Import JSON')),
    fileInput);
}

/**
 * Validate, show counts, confirm, replace, reload. Also used by the first-run setup ("Restore a backup").
 * @param {object} data parsed export file
 * @param {{reloadTo?: string}} [opts] route to open after the reload (default: stay)
 */
export async function importFlow(data, { reloadTo } = {}) {
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
    // The device now holds exactly the file's data: counts as backed up; asks to keep the data.
    await noteRestored(data).catch((err) => console.error(err));
    toast('Import complete', { type: 'success' });
    if (reloadTo) history.replaceState(null, '', `#/${reloadTo}`);
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
  const btn = el('button', { class: 'btn btn-block', type: 'button', hidden: true }, 'Ask the browser to keep it');
  const refresh = async () => {
    const s = await db.storageStatus();
    const persist = s.persisted === null ? 'This browser does not say whether it keeps the data. Keep backups.'
      : s.persisted ? 'Protected: the browser will not delete this data on its own. Clearing site data or removing the app still deletes it.'
        : 'Not protected: the browser may delete this data when the phone runs low on space. Installing the app and keeping backups helps.';
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

// ---------------------------------------------------------------- links to feature settings

function linksSection() {
  const link = (href, title, sub) => el('a', { class: 'list-item', href },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), el('div', { class: 'li-sub' }, sub)),
    el('span', { class: 'li-chevron' }, '\u203a'));
  return section('More',
    el('div', { class: 'list' },
      link('#/workout/targets', 'Weekly set targets', 'Sets per muscle per week'),
      link('#/food/photo-settings', 'Meal photo (AI)', 'Your API key and model'),
      link('#/import', 'Import data', 'Workout sheet, body weights, food diary'),
      link('#/help', 'Help and setup', 'Install, backup, how it works')));
}

// ---------------------------------------------------------------- about

function aboutSection() {
  return section('About',
    el('div', { class: 'list' },
      el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, 'App version'), el('span', { class: 'num' }, APP_VERSION)),
      updateRow(),
      el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, 'Data schema'), el('span', { class: 'num' }, db.DB_VERSION)),
      el('a', { class: 'list-item', href: '#/licences' }, el('span', { class: 'li-main' }, 'Licences and data sources'), el('span', { class: 'li-chevron' }, '\u203a'))));
}

// ---------------------------------------------------------------- backup reminder, update check

/** Quiet card at the top when the last export is 14+ days old (the snooze only hides the banner). */
function backupReminderCard() {
  const card = el('section', { class: 'card stack set-backup-card', hidden: true, 'aria-live': 'polite' });
  const refresh = async () => {
    const st = await backupState('settings');
    if (!st.due) { card.hidden = true; return; }
    card.replaceChildren(
      el('div', { class: 'card-title' }, 'Time for a backup'),
      el('p', { class: 'small' }, st.never
        ? 'You have not exported a backup from this device yet. If this browser’s data is cleared, everything is gone.'
        : `Your last backup is ${st.daysSince} days old. Export one and keep the file somewhere other than this phone.`),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: async () => { if (await exportBackup()) refresh(); } }, 'Export backup'));
    card.hidden = false;
  };
  refresh();
  return card;
}

/** "Check for update" row; turns into an Update button when a new version is deployed. */
function updateRow() {
  const status = el('span', { class: 'small muted', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn btn-sm set-update-btn', type: 'button' }, 'Check for update');
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'apply') applyUpdate();
    else checkForUpdate();
  });
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    btn.dataset.mode = apply ? 'apply' : 'check';
    btn.className = apply ? 'btn btn-sm set-update-btn btn-primary' : 'btn btn-sm set-update-btn';
    btn.textContent = apply ? 'Update' : 'Check for update';
    btn.disabled = st.status === 'checking';
    status.textContent = st.status === 'available' ? `Version ${st.deployed} is available.`
      : st.status === 'current' ? 'Up to date.'
        : st.status === 'offline' ? 'Offline, cannot check.'
          : st.status === 'checking' ? 'Checking…' : '';
  });
  cleanups.push(off);
  return el('div', { class: 'list-item' }, el('span', { class: 'li-main' }, 'Updates', el('br'), status), btn);
}
