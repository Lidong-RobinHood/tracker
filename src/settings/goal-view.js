// Settings › Goal and targets (#/settings/goal): weight goal (Lose / Maintain / Gain + signed amount and
// one result line), daily targets in grams or percent, how targets are set, profile, adaptive macros.
// Writes exactly what the single Settings screen wrote before (same records, same rules).
import { el, pageHeader, numberInput, toast, fmtNum, fmtGrouped, sectionHeader, segmented, iconButton, field } from '../ui/index.js';
import * as db from '../db/db.js';
import { macroKcal } from '../core/nutrition.js';
import { MACROS, SPLIT_PRESETS, targetMode, validateSplit, macroGrams, gramsFromPct, pctFromGrams, pctOfKcal, carbsRest } from '../core/macro-split.js';
import { ACTIVITY_LEVELS, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';
import { rateToGoal, goalToRate, amountValid, GOAL_AMOUNT_MAX, GOAL_DEFAULT_AMOUNT } from '../core/goal-rate.js';
import { buildTargets } from '../core/setup.js';
import { goalSign, signedRateSpeech, signedGoalSummary } from '../core/goal-display.js';
import { ensureCss } from './css.js';

const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const SWATCH = { protein: 'is-protein', carbs: 'is-carbs', fat: 'is-fat' };

/** @param {HTMLElement} container */
export async function mountGoal(container) {
  ensureCss();
  container.classList.add('settings-view');
  const [targets, goal, profile, adaptive] = await Promise.all([db.getSetting('targets'), db.getSetting('goal'),
    db.getSetting('profile'), db.getSetting('adaptive')]);
  const rest = goalSection(targets, goal, profile, adaptive || {});
  container.append(
    pageHeader({ title: 'Goal and targets', back: 'settings' }),
    el('section', { class: 'section' }, sectionHeader('Goal', { info: 'goal' }), el('div', { class: 'card set-card' }, rest.rate)),
    targetsSection(targets, (t) => rest.updateSplitNote(t)),
    ...rest.sections);
}

/** One row: label (+ swatch, + muted extra) on the left, a control on the right. */
function row(label, control, { swatch, alt, id } = {}) {
  if (!control.id) control.id = id || `s-${Math.random().toString(36).slice(2)}`;
  return el('div', { class: 'set-row' },
    swatch ? el('span', { class: ['swatch', swatch], 'aria-hidden': 'true' }) : null,
    el('label', { class: 'set-row-label', htmlFor: control.id }, label),
    alt || null,
    control.closest ? control.closest('.input-unit') || control : control);
}
/** numberInput wrapped with a unit suffix ('g', 'kcal'). */
const withUnit = (input, unit) => { el('div', { class: 'input-unit set-in' }, input, el('span', { class: 'unit', 'aria-hidden': 'true' }, unit)); return input; };

// ---------------------------------------------------------------- daily targets

/** Targets as grams (always stored) or as a percentage split of calories (mode 'percent', see core/macro-split.js). */
function targetsSection(targets, onSaved) {
  let mode = targetMode(targets);
  const kcalInput = withUnit(numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: 'Calories target' }), 'kcal');
  const grams = {
    protein: withUnit(numberInput({ value: targets.protein, min: 0, max: 1000, decimals: 0, ariaLabel: 'Protein target in grams' }), 'g'),
    carbs: withUnit(numberInput({ value: targets.carbs, min: 0, max: 2000, decimals: 0, ariaLabel: 'Carbohydrates target in grams' }), 'g'),
    fat: withUnit(numberInput({ value: targets.fat, min: 0, max: 1000, decimals: 0, ariaLabel: 'Fat target in grams' }), 'g'),
  };
  const storedPct = mode === 'percent' && targets.pct ? targets.pct : {};
  const pct = Object.fromEntries(MACROS.map((k) => [k, withUnit(numberInput({ value: storedPct[k] ?? null, min: 0, max: 100, decimals: 1,
    ariaLabel: `${MACRO_LABEL[k]} share of calories in percent` }), '%')]));
  // Percent fields: whole numbers or one decimal only.
  const readPct = (k) => {
    const n = pct[k].getNumber();
    return n !== null && Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? n : null;
  };
  const pctValues = () => Object.fromEntries(MACROS.map((k) => [k, readPct(k)]));
  const gramValues = () => Object.fromEntries(MACROS.map((k) => [k, grams[k].getNumber()]));

  const gramHints = Object.fromEntries(MACROS.map((k) => [k, el('span', { class: 'set-row-alt', 'aria-live': 'polite' })]));
  const pctHints = Object.fromEntries(MACROS.map((k) => [k, el('span', { class: 'set-row-alt', 'aria-live': 'polite' })]));
  const macrosHint = el('p', { class: 'field-hint set-card-foot' });
  const sumLine = el('p', { class: 't-sub', 'aria-live': 'polite' });
  const restBtn = el('button', { class: 'btn btn-sm', type: 'button' }, 'Set carbs to the rest');
  const presetChips = SPLIT_PRESETS.map((p) => el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false',
    'aria-label': `${p.pct.protein} % protein, ${p.pct.carbs} % carbs, ${p.pct.fat} % fat`,
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); update(); } }, p.label.replace(/\//g, ' / ')));
  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Save targets');

  const gramsPanel = el('div', { class: 'set-rows' },
    MACROS.map((k) => row(MACRO_LABEL[k], grams[k], { swatch: SWATCH[k], alt: gramHints[k] })),
    macrosHint);
  const pctPanel = el('div', { class: 'set-rows' },
    el('div', { class: 'chips set-chips', role: 'group', 'aria-label': 'Preset splits' }, presetChips),
    MACROS.map((k) => row(MACRO_LABEL[k], pct[k], { swatch: SWATCH[k], alt: pctHints[k] })),
    el('div', { class: 'row-between set-card-foot set-sum' }, sumLine, restBtn));

  const tabs = segmented({ ariaLabel: 'Enter macros as', value: mode,
    options: [{ value: 'grams', label: 'Grams' }, { value: 'percent', label: 'Percent' }], onChange: (m) => switchMode(m) });

  function update() {
    const kcal = kcalInput.getNumber();
    tabs.setValue(mode);
    gramsPanel.hidden = mode !== 'grams';
    pctPanel.hidden = mode !== 'percent';
    if (mode === 'grams') {
      const g = gramValues();
      for (const k of MACROS) {
        const share = pctOfKcal(kcal, g[k], k);
        gramHints[k].textContent = share === null ? '' : `${fmtNum(share, 0)} %`;
      }
      macrosHint.textContent = `Macros = ${fmtGrouped(macroKcal(g))} kcal`;
      saveBtn.disabled = false;
      return;
    }
    const p = pctValues();
    // Just switched, nothing edited: the percentages only describe the stored grams, so show those.
    const keep = untouched();
    for (const k of MACROS) {
      if (pct[k].value.trim() && p[k] === null) pct[k].setAttribute('aria-invalid', 'true');
      const g = keep ? memo.grams[k] : macroGrams(kcal, p[k], k);
      pctHints[k].textContent = g === null ? '= – g' : `= ${fmtGrouped(Math.round(g))} g`;
    }
    const v = validateSplit(p);
    const allValid = MACROS.every((k) => p[k] !== null);
    sumLine.className = `t-sub ${v.ok ? 'text-success' : 'text-warning'}`;
    const badInput = MACROS.some((k) => pct[k].value.trim() && p[k] === null);
    sumLine.textContent = badInput ? 'Use 0–100 with at most one decimal.'
      : !allValid ? `Total ${fmtNum(v.sum)} % · enter all three`
      : v.ok ? `Total ${fmtNum(v.sum)} %`
        : v.diff < 0 ? `Total ${fmtNum(v.sum)} % · ${fmtNum(-v.diff)} % left`
          : `Total ${fmtNum(v.sum)} % · ${fmtNum(v.diff)} % too much`;
    const restPct = carbsRest(p);
    restBtn.hidden = v.ok && allValid; // already 100 %: nothing to fill in
    restBtn.disabled = restPct === null || (v.ok && p.carbs === restPct);
    restBtn.textContent = restPct === null ? 'Carbs = rest' : `Carbs = rest (${fmtNum(restPct)} %)`;
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
    const r = carbsRest(pctValues());
    if (r !== null) { pct.carbs.setNumber(r); update(); }
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
  return el('section', { class: 'section' }, sectionHeader('Daily targets', { info: 'macros' }),
    el('div', { class: 'card set-card' },
      el('div', { class: 'set-card-top' }, tabs),
      el('div', { class: 'set-rows' }, row('Calories', kcalInput)),
      gramsPanel,
      pctPanel,
      el('div', { class: 'set-card-foot' }, saveBtn)));
}

// ---------------------------------------------------------------- how targets are set, profile, adaptive macros

function goalSection(targets, goal, profile, adaptive) {
  const select = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const mode = select(targets.source === 'adaptive' ? 'adaptive' : 'manual',
    [['manual', 'Manual'], ['adaptive', 'Adaptive']], 'How targets are set');
  const rate = goalRateControl(goal.rateKgPerWeek);
  const sex = select(profile.sex, [['', 'Not set'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other / prefer not to say']], 'Sex');
  const birthYear = numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: 'Birth year' });
  const height = withUnit(numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: 'Height' }), 'cm');
  const activity = select(profile.activity, [['', 'Not set'], ...ACTIVITY_LEVELS.map((a) => [a.id, `${a.label} – ${a.hint}`])], 'Activity level');
  const protein = withUnit(numberInput({ value: adaptive.proteinPerKg ?? ADAPTIVE_DEFAULTS.proteinPerKg, min: 0.8, max: 3.5, decimals: 2, ariaLabel: 'Protein per kg' }), 'g / kg');
  const fat = withUnit(numberInput({ value: adaptive.fatPerKg ?? ADAPTIVE_DEFAULTS.fatPerKg, min: 0.3, max: 2, decimals: 2, ariaLabel: 'Fat per kg' }), 'g / kg');
  const floor = withUnit(numberInput({ value: adaptive.kcalFloor ?? null, integer: true, min: 800, max: 4000, placeholder: 'auto', ariaLabel: 'Calorie floor' }), 'kcal');

  const save = async () => {
    const r = rate.getRate();
    if (r === null) {
      rate.amount.focus();
      const dir = rate.getDirection();
      toast(`Enter up to ${GOAL_AMOUNT_MAX[dir]} kg / week.`, { type: 'error' });
      return;
    }
    const checks = [[birthYear, 'birth year'], [height, 'height'], [protein, 'protein per kg'], [fat, 'fat per kg'], [floor, 'calorie floor']];
    for (const [input, name] of checks) {
      if (input.value.trim() && input.getNumber() === null) { input.focus(); toast(`Enter a valid ${name} or leave it empty.`, { type: 'error' }); return; }
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

  const splitNote = el('p', { class: 'field-hint text-warning set-card-foot' });
  const updateSplitNote = (t) => {
    splitNote.hidden = targetMode(t) !== 'percent' || !t.pct;
    if (!splitNote.hidden) {
      splitNote.textContent = `Percent split ${fmtNum(t.pct.protein)} / ${fmtNum(t.pct.carbs)} / ${fmtNum(t.pct.fat)} % active: check-ins change calories only; g / kg values unused.`;
    }
  };
  updateSplitNote(targets);
  const sections = [
    el('section', { class: 'section' }, sectionHeader('Targets', { info: 'checkin' }),
      el('div', { class: 'card set-card' },
        el('div', { class: 'set-rows' }, row('Set by', mode)),
        el('p', { class: 'field-hint set-card-foot' }, 'Adaptive: proposed each Monday, applied only if you accept.'))),
    el('section', { class: 'section' }, sectionHeader('Profile', { info: 'expenditure' }),
      el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' },
        row('Sex', sex), row('Birth year', birthYear), row('Height', height)),
      el('div', { class: 'set-card-foot' }, field('Activity level', activity)))),
    el('section', { class: 'section' }, sectionHeader('Adaptive macros', { info: 'adaptive-macros' }),
      el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' },
        row('Protein', protein), row('Fat, minimum', fat), row('Calorie floor', floor)),
      splitNote)),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save goal & profile'),
  ];
  return { rate, sections, updateSplitNote };
}

// ---------------------------------------------------------------- goal control

/**
 * Goal as Lose | Maintain | Gain plus a positive amount in kg / week (no minus key needed on a phone keypad),
 * with − / + steppers. The sign is always shown: a fixed "−" (lose) or "+" (gain) in front of the field
 * and one signed result line '−0.5 kg / week · −550 kcal / day' (core/goal-display.js); the limit appears
 * only as an error. Stored as the signed settings.goal.rateKgPerWeek (core/goal-rate.js).
 * Shared with the first-run setup (src/onboarding/welcome.js).
 * @returns {HTMLElement & {getRate: () => number|null, getDirection: () => string, amount: HTMLInputElement}}
 */
export function goalRateControl(storedRate) {
  ensureCss();
  const STEP = 0.05;
  const initial = rateToGoal(storedRate);
  let direction = initial.direction;
  const uid = Math.random().toString(36).slice(2);
  const amount = numberInput({ value: initial.amount, min: 0, max: Math.max(GOAL_AMOUNT_MAX.lose, GOAL_AMOUNT_MAX.gain), decimals: 2,
    ariaLabel: 'Amount in kg per week', id: `goal-amount-${uid}` });
  // Visible result line with the signed rate; screen readers get the spoken form ("minus 0.5 kilograms per week").
  const summaryText = el('span', { 'aria-hidden': 'true' });
  const summarySpeech = el('span', { class: 'vh' });
  const summary = el('div', { class: 'set-goal-result', 'aria-live': 'polite' }, summaryText, summarySpeech);
  const signEl = el('span', { class: 'set-goal-sign', 'aria-hidden': 'true' });
  const DIRS = [['lose', 'Lose'], ['maintain', 'Maintain'], ['gain', 'Gain']];
  const group = segmented({ ariaLabel: 'Goal direction', value: direction,
    options: DIRS.map(([value, label]) => ({ value, label })), onChange: (d) => setDirection(d, true) });
  const step = (sign) => {
    const max = GOAL_AMOUNT_MAX[direction];
    const n = amount.getNumber() ?? 0;
    const next = Math.round((Math.min(max, Math.max(STEP, n + sign * STEP))) * 100) / 100;
    amount.setNumber(next);
    paint();
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const less = iconButton('minus', { label: 'Less per week', class: 'set-step', onClick: () => step(-1) });
  const more = iconButton('plus', { label: 'More per week', class: 'set-step', onClick: () => step(1) });
  const amountRow = el('div', { class: 'set-row set-goal-row' },
    el('label', { class: 'set-row-label set-goal-label', htmlFor: amount.id }, el('span', null, 'Amount'), el('span', { class: 't-sub muted' }, 'kg / week')),
    el('div', { class: 'set-stepper' }, less,
      el('div', { class: 'input-unit set-goal-signed' }, signEl, amount),
      more));

  const current = () => amount.getNumber();
  function paint() {
    group.setValue(direction);
    const maintain = direction === 'maintain';
    amountRow.hidden = maintain;
    amount.disabled = maintain;
    const n = current();
    const valid = !maintain && amountValid(direction, n);
    // numberInput only knows 0…1; the limit depends on the direction.
    if (!maintain && amount.value.trim() !== '' && !valid) amount.setAttribute('aria-invalid', 'true');
    else amount.removeAttribute('aria-invalid');
    less.disabled = maintain || n === null || n <= STEP;
    more.disabled = maintain || (n !== null && n >= GOAL_AMOUNT_MAX[direction]);
    const kcalDay = valid ? Math.round((n * ADAPTIVE_DEFAULTS.kcalPerKg) / 7 / 10) * 10 : null;
    const line = signedGoalSummary(direction, n, { max: GOAL_AMOUNT_MAX[direction], kcalDay });
    summary.classList.toggle('is-error', !maintain && !valid);
    if (!maintain && !valid) summary.setAttribute('role', 'alert'); else summary.removeAttribute('role');
    summaryText.textContent = line;
    summarySpeech.textContent = valid || maintain ? `${signedRateSpeech(direction, n)}${kcalDay ? `, ${kcalDay} kilocalories per day` : ''}` : line;
    signEl.textContent = goalSign(direction);
    amount.setAttribute('aria-label', direction === 'lose' ? 'Amount to lose, minus kilograms per week' : 'Amount to gain, plus kilograms per week');
  }
  function setDirection(d, byUser) {
    direction = d;
    // Switching from Maintain with nothing typed yet: start from a sensible amount.
    if (d !== 'maintain' && byUser && amount.value.trim() === '') amount.setNumber(GOAL_DEFAULT_AMOUNT[d]);
    paint();
  }
  amount.addEventListener('input', paint);

  const wrap = /** @type {any} */ (el('div', { class: 'set-goal', role: 'group', 'aria-label': 'Weight goal' },
    el('div', { class: 'set-card-top' }, group),
    amountRow,
    summary));
  wrap.getDirection = () => direction;
  wrap.getRate = () => goalToRate(direction, current());
  wrap.amount = amount;
  setDirection(direction, false);
  return wrap;
}
