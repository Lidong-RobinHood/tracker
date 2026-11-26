// Settings › Goal and targets (#/settings/goal): weight goal (Lose / Maintain / Gain + signed amount and
// one result line), daily targets in grams or percent, how targets are set, profile, adaptive macros.
// Writes exactly what the single Settings screen wrote before (same records, same rules).
import { el, append, pageHeader, numberInput, toast, fmtNum, fmtGrouped, sectionHeader, segmented, iconButton, field } from '../ui/index.js';
import { withPercent } from '../core/numbers.js';
import * as db from '../db/db.js';
import { macroKcal } from '../core/nutrition.js';
import { MACROS, SPLIT_PRESETS, targetMode, validateSplit, macroGrams, gramsFromPct, pctFromGrams, pctOfKcal, carbsRest } from '../core/macro-split.js';
import { ACTIVITY_LEVELS, ADAPTIVE_DEFAULTS } from '../core/adaptive.js';
import { rateToGoal, goalToRate, amountValid, GOAL_AMOUNT_MAX, GOAL_DEFAULT_AMOUNT } from '../core/goal-rate.js';
import { buildTargets } from '../core/setup.js';
import { goalSign, signedAmount, signedRateSpeech, signedGoalSummary, goalAmountError, parseGoalAmount } from '../core/goal-display.js';
import { ensureCss } from './css.js';
import { t } from '../i18n/index.js';

/** Macro label: settings.goal.macro.<key> (Protein / Carbs / Fat). */
const macroLabel = (k) => t(`settings.goal.macro.${k}`);
/** Core goal message {key, params} → text. */
const say = (m) => (m ? t(m.key, m.params) : '');
const SWATCH = { protein: 'is-protein', carbs: 'is-carbs', fat: 'is-fat' };

/** @param {HTMLElement} container */
export async function mountGoal(container) {
  ensureCss();
  container.classList.add('settings-view');
  const [targets, goal, profile, adaptive] = await Promise.all([db.getSetting('targets'), db.getSetting('goal'),
    db.getSetting('profile'), db.getSetting('adaptive')]);
  const rest = goalSection(targets, goal, profile, adaptive || {});
  container.append(
    pageHeader({ title: t('settings.goal.title'), back: 'settings' }),
    el('section', { class: 'section' }, sectionHeader(t('settings.goal.section'), { info: 'goal' }), el('div', { class: 'card set-card' }, rest.rate)),
    targetsSection(targets, (tg) => rest.updateSplitNote(tg)),
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
  const kcalInput = withUnit(numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: t('settings.goal.kcalAria') }), 'kcal');
  const grams = {
    protein: withUnit(numberInput({ value: targets.protein, min: 0, max: 1000, decimals: 0, ariaLabel: t('settings.goal.proteinAria') }), 'g'),
    carbs: withUnit(numberInput({ value: targets.carbs, min: 0, max: 2000, decimals: 0, ariaLabel: t('settings.goal.carbsAria') }), 'g'),
    fat: withUnit(numberInput({ value: targets.fat, min: 0, max: 1000, decimals: 0, ariaLabel: t('settings.goal.fatAria') }), 'g'),
  };
  const storedPct = mode === 'percent' && targets.pct ? targets.pct : {};
  const pct = Object.fromEntries(MACROS.map((k) => [k, withUnit(numberInput({ value: storedPct[k] ?? null, min: 0, max: 100, decimals: 1,
    ariaLabel: t('settings.goal.pctAria', { macro: macroLabel(k) }) }), '%')]));
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
  const restBtn = el('button', { class: 'btn btn-sm', type: 'button' }, t('settings.goal.carbsRest'));
  const presetChips = SPLIT_PRESETS.map((p) => el('button', { class: 'chip', type: 'button', 'aria-pressed': 'false',
    'aria-label': t('settings.goal.presetAria', { protein: p.pct.protein, carbs: p.pct.carbs, fat: p.pct.fat }),
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); update(); } }, p.label.replace(/\//g, ' / ')));
  const saveBtn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, t('settings.goal.saveTargets'));

  const gramsPanel = el('div', { class: 'set-rows' },
    MACROS.map((k) => row(macroLabel(k), grams[k], { swatch: SWATCH[k], alt: gramHints[k] })),
    macrosHint);
  const pctPanel = el('div', { class: 'set-rows' },
    el('div', { class: 'chips set-chips', role: 'group', 'aria-label': t('settings.goal.presetsAria') }, presetChips),
    MACROS.map((k) => row(macroLabel(k), pct[k], { swatch: SWATCH[k], alt: pctHints[k] })),
    el('div', { class: 'row-between set-card-foot set-sum' }, sumLine, restBtn));

  const tabs = segmented({ ariaLabel: t('settings.goal.modeAria'), value: mode,
    options: [{ value: 'grams', label: t('settings.goal.grams') }, { value: 'percent', label: t('settings.goal.percent') }], onChange: (m) => switchMode(m) });

  function update() {
    const kcal = kcalInput.getNumber();
    tabs.setValue(mode);
    gramsPanel.hidden = mode !== 'grams';
    pctPanel.hidden = mode !== 'percent';
    if (mode === 'grams') {
      const g = gramValues();
      for (const k of MACROS) {
        const share = pctOfKcal(kcal, g[k], k);
        gramHints[k].textContent = share === null ? '' : withPercent(fmtNum(share, 0));
      }
      macrosHint.textContent = t('settings.goal.macrosKcal', { kcal: fmtGrouped(macroKcal(g)) });
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
    const sum = fmtNum(v.sum);
    sumLine.textContent = badInput ? t('settings.goal.pctInvalid')
      : !allValid ? t('settings.goal.totalEnterAll', { sum })
      : v.ok ? t('settings.goal.total', { sum })
        : v.diff < 0 ? t('settings.goal.totalLeft', { sum, diff: fmtNum(-v.diff) })
          : t('settings.goal.totalTooMuch', { sum, diff: fmtNum(v.diff) });
    const restPct = carbsRest(p);
    restBtn.hidden = v.ok && allValid; // already 100 %: nothing to fill in
    restBtn.disabled = restPct === null || (v.ok && p.carbs === restPct);
    restBtn.textContent = restPct === null ? t('settings.goal.carbsRestShort') : t('settings.goal.carbsRestPct', { pct: fmtNum(restPct) });
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
    if (kcal === null) { kcalInput.focus(); toast(t('core.setup.errorKcal'), { type: 'error' }); return; }
    const current = await db.getSetting('targets');
    // Same rules as the first-run setup (core/setup.js buildTargets).
    const r = buildTargets(current, mode === 'grams' ? { mode, kcal, ...gramValues() } : { mode, kcal, pct: pctValues() });
    if (!r.ok) {
      if (grams[r.field]) grams[r.field].focus();
      toast(t(r.errorKey), { type: 'error' });
      return;
    }
    let next = r.targets;
    // Saved right after switching to Percent without edits: the stored grams stay as they are
    // (the rounded percentages would turn e.g. 70 g fat into 71 g).
    if (mode === 'percent' && untouched()) next = { ...next, ...memo.grams };
    await db.setSetting('targets', next);
    memo = { kcal, grams: { protein: next.protein, carbs: next.carbs, fat: next.fat }, pct: next.pct || pctValues() };
    if (mode === 'percent') for (const k of MACROS) grams[k].setNumber(next[k]);
    toast(mode === 'percent' ? t('settings.goal.savedGrams', { protein: next.protein, carbs: next.carbs, fat: next.fat }) : t('settings.goal.saved'), { type: 'success' });
    if (onSaved) onSaved(next);
  });

  update();
  return el('section', { class: 'section' }, sectionHeader(t('settings.goal.dailyTargets'), { info: 'macros' }),
    el('div', { class: 'card set-card' },
      el('div', { class: 'set-card-top' }, tabs),
      el('div', { class: 'set-rows' }, row(t('settings.goal.calories'), kcalInput)),
      gramsPanel,
      pctPanel,
      el('div', { class: 'set-card-foot' }, saveBtn)));
}

// ---------------------------------------------------------------- how targets are set, profile, adaptive macros

function goalSection(targets, goal, profile, adaptive) {
  const select = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const mode = select(targets.source === 'adaptive' ? 'adaptive' : 'manual',
    [['manual', t('settings.goal.manual')], ['adaptive', t('settings.goal.adaptive')]], t('settings.goal.setByAria'));
  const rate = goalRateControl(goal.rateKgPerWeek);
  const sex = select(profile.sex, [['', t('settings.goal.notSet')], ['female', t('settings.goal.female')], ['male', t('settings.goal.male')],
    ['other', t('settings.goal.otherSex')]], t('settings.goal.sex'));
  const birthYear = numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: t('settings.goal.birthYear') });
  const height = withUnit(numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: t('settings.goal.height') }), 'cm');
  // Short labels so the chosen one is always readable; its detail is the one helper line below.
  const activity = select(profile.activity, [['', t('settings.goal.notSet')], ...ACTIVITY_LEVELS.map((a) => [a.id, t(`core.activity.${a.id}`)])],
    t('settings.goal.activity'));
  const activityHint = el('div', { class: 'field-hint' });
  const paintActivityHint = () => {
    const a = ACTIVITY_LEVELS.find((x) => x.id === activity.value);
    activityHint.textContent = a ? t(`core.activity.${a.id}.hint`) : '';
    activityHint.hidden = !a;
  };
  activity.addEventListener('change', paintActivityHint);
  paintActivityHint();
  const protein = withUnit(numberInput({ value: adaptive.proteinPerKg ?? ADAPTIVE_DEFAULTS.proteinPerKg, min: 0.8, max: 3.5, decimals: 2, ariaLabel: t('settings.goal.proteinPerKgAria') }), 'g / kg');
  const fat = withUnit(numberInput({ value: adaptive.fatPerKg ?? ADAPTIVE_DEFAULTS.fatPerKg, min: 0.3, max: 2, decimals: 2, ariaLabel: t('settings.goal.fatPerKgAria') }), 'g / kg');
  const floor = withUnit(numberInput({ value: adaptive.kcalFloor ?? null, integer: true, min: 800, max: 4000, placeholder: t('settings.goal.auto'), ariaLabel: t('settings.goal.floor') }), 'kcal');

  const save = async () => {
    const r = rate.getRate();
    if (r === null) {
      rate.amount.focus();
      toast(t('settings.goal.errorSentence', { error: rate.getError() }), { type: 'error' });
      return;
    }
    const checks = [[birthYear, 'birthYear'], [height, 'height'], [protein, 'proteinPerKg'], [fat, 'fatPerKg'], [floor, 'floor']];
    for (const [input, name] of checks) {
      if (input.value.trim() && input.getNumber() === null) { input.focus(); toast(t(`settings.goal.invalid.${name}`), { type: 'error' }); return; }
    }
    if (protein.getNumber() === null) { protein.focus(); toast(t('settings.goal.enterProtein'), { type: 'error' }); return; }
    if (fat.getNumber() === null) { fat.focus(); toast(t('settings.goal.enterFat'), { type: 'error' }); return; }
    const current = await db.getSetting('targets');
    await Promise.all([
      db.setSetting('goal', { ...goal, rateKgPerWeek: r }),
      db.setSetting('profile', { ...profile, sex: sex.value || null, birthYear: birthYear.getNumber(), heightCm: height.getNumber(), activity: activity.value || null }),
      db.setSetting('adaptive', { ...adaptive, proteinPerKg: protein.getNumber(), fatPerKg: fat.getNumber(), kcalFloor: floor.getNumber() }),
      db.setSetting('targets', { ...current, source: mode.value }),
    ]);
    toast(t('settings.goal.profileSaved'), { type: 'success' });
  };

  const splitNote = el('p', { class: 'field-hint text-warning set-card-foot' });
  const updateSplitNote = (tg) => {
    splitNote.hidden = targetMode(tg) !== 'percent' || !tg.pct;
    if (!splitNote.hidden) {
      splitNote.textContent = t('settings.goal.splitNote', { protein: fmtNum(tg.pct.protein), carbs: fmtNum(tg.pct.carbs), fat: fmtNum(tg.pct.fat) });
    }
  };
  updateSplitNote(targets);
  const sections = [
    el('section', { class: 'section' }, sectionHeader(t('settings.goal.targets'), { info: 'checkin' }),
      el('div', { class: 'card set-card' },
        el('div', { class: 'set-rows' }, row(t('settings.goal.setBy'), mode)),
        el('p', { class: 'field-hint set-card-foot' }, t('settings.goal.adaptiveHint')))),
    el('section', { class: 'section' }, sectionHeader(t('settings.goal.profile'), { info: 'expenditure' }),
      el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' },
        row(t('settings.goal.sex'), sex), row(t('settings.goal.birthYear'), birthYear), row(t('settings.goal.height'), height)),
      el('div', { class: 'set-card-foot' }, append(field(t('settings.goal.activity'), activity), activityHint)))),
    el('section', { class: 'section' }, sectionHeader(t('settings.goal.adaptiveMacros'), { info: 'adaptive-macros' }),
      el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' },
        row(macroLabel('protein'), protein), row(t('settings.goal.fatMin'), fat), row(t('settings.goal.floor'), floor)),
      splitNote)),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, t('settings.goal.saveProfile')),
  ];
  return { rate, sections, updateSplitNote };
}

// ---------------------------------------------------------------- goal control

/**
 * Goal as Lose | Maintain | Gain plus an amount in kg / week, shown as ONE signed number between a
 * "less" and a "more" stepper: [−] −0.5 [+] (true minus, tabular). The number can also be typed; the sign
 * comes from Lose / Gain (the iPhone keypad has no minus key), so only the amount is read from the field.
 * One result line '−0.5 kg / week · −550 kcal / day' (core/goal-display.js); errors replace it:
 * 'Enter an amount above 0' or 'Max 1 kg / week'. Stored as the signed settings.goal.rateKgPerWeek
 * (core/goal-rate.js). Shared with the first-run setup (src/onboarding/welcome.js).
 * @returns {HTMLElement & {getRate: () => number|null, getDirection: () => string, getError: () => string|null,
 *   amount: HTMLInputElement}}
 */
export function goalRateControl(storedRate) {
  ensureCss();
  const STEP = 0.05;
  const initial = rateToGoal(storedRate);
  let direction = initial.direction;
  let typedAmount = initial.amount;
  const uid = Math.random().toString(36).slice(2);
  const amount = /** @type {HTMLInputElement} */ (el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', enterkeyhint: 'done',
    class: 'input input-num set-goal-val', id: `goal-amount-${uid}` }));
  // Visible result line with the signed rate; screen readers get the spoken form ("minus 0.5 kilograms per week").
  const summaryText = el('span', { 'aria-hidden': 'true' });
  const summarySpeech = el('span', { class: 'vh' });
  const summary = el('div', { class: 'set-goal-result', 'aria-live': 'polite' }, summaryText, summarySpeech);
  const DIRS = ['lose', 'maintain', 'gain'];
  const group = segmented({ ariaLabel: t('settings.goal.directionAria'), value: direction,
    options: DIRS.map((value) => ({ value, label: t(`settings.goal.dir.${value}`) })), onChange: (d) => setDirection(d, true) });

  /** Show the amount as the signed number ('−0.5', '+0.25'); keeps what was typed when it is not a number. */
  const showSigned = () => {
    if (typedAmount === null || direction === 'maintain') return;
    amount.value = Math.round(typedAmount * 100) === 0 ? '0' : signedAmount(direction, typedAmount);
  };
  const step = (sign) => {
    const max = GOAL_AMOUNT_MAX[direction];
    const n = typedAmount ?? 0;
    typedAmount = Math.round((Math.min(max, Math.max(STEP, n + sign * STEP))) * 100) / 100;
    showSigned();
    paint();
    amount.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const less = iconButton('minus', { label: t('settings.goal.lessAria'), class: 'set-step', onClick: () => step(-1) });
  const more = iconButton('plus', { label: t('settings.goal.moreAria'), class: 'set-step', onClick: () => step(1) });
  const amountRow = el('div', { class: 'set-row set-goal-row' },
    el('label', { class: 'set-row-label set-goal-label', htmlFor: amount.id }, el('span', null, t('settings.goal.amount')), el('span', { class: 't-sub muted' }, t('settings.goal.kgWeek'))),
    el('div', { class: 'set-stepper' }, less, amount, more));

  function paint() {
    group.setValue(direction);
    const maintain = direction === 'maintain';
    amountRow.hidden = maintain;
    amount.disabled = maintain;
    const n = typedAmount;
    const valid = !maintain && amountValid(direction, n);
    if (!maintain && !valid) amount.setAttribute('aria-invalid', 'true');
    else amount.removeAttribute('aria-invalid');
    less.disabled = maintain || n === null || n <= STEP;
    more.disabled = maintain || (n !== null && n >= GOAL_AMOUNT_MAX[direction]);
    const kcalDay = valid ? Math.round((n * ADAPTIVE_DEFAULTS.kcalPerKg) / 7 / 10) * 10 : null;
    const line = say(signedGoalSummary(direction, n, { kcalDay }));
    summary.classList.toggle('is-error', !maintain && !valid);
    if (!maintain && !valid) summary.setAttribute('role', 'alert'); else summary.removeAttribute('role');
    summaryText.textContent = line;
    const speech = say(signedRateSpeech(direction, n));
    summarySpeech.textContent = valid || maintain ? (kcalDay ? t('settings.goal.speechKcal', { rate: speech, kcal: kcalDay }) : speech) : line;
    amount.setAttribute('aria-label', t(direction === 'lose' ? 'settings.goal.amountLoseAria' : 'settings.goal.amountGainAria'));
  }
  function setDirection(d, byUser) {
    direction = d;
    // Switching from Maintain with nothing typed yet: start from a sensible amount.
    if (d !== 'maintain' && byUser && typedAmount === null && amount.value.trim() === '') typedAmount = GOAL_DEFAULT_AMOUNT[d];
    // Lose 0.75 → Gain: start at the gain limit rather than at an error.
    if (d !== 'maintain' && byUser && typedAmount !== null && typedAmount > GOAL_AMOUNT_MAX[d]) typedAmount = GOAL_AMOUNT_MAX[d];
    showSigned();
    paint();
  }
  amount.addEventListener('input', () => {
    // The sign belongs to the number from the first digit on ('0.7' → '−0.7'); typing happens at the end.
    const typed = amount.value;
    if (direction !== 'maintain' && /^[\d.,]/.test(typed) && document.activeElement === amount) amount.value = `${goalSign(direction)}${typed}`;
    typedAmount = parseGoalAmount(amount.value);
    paint();
  });
  // Typed '0,7' becomes '−0.7' once the field is left.
  amount.addEventListener('change', () => { typedAmount = parseGoalAmount(amount.value); showSigned(); paint(); });
  amount.addEventListener('keydown', (e) => { if (e.key === 'Enter') amount.blur(); });
  amount.addEventListener('focus', () => {
    amount.select();
    setTimeout(() => { if (document.activeElement === amount) amount.setSelectionRange(0, amount.value.length); }, 0);
  });

  const wrap = /** @type {any} */ (el('div', { class: 'set-goal', role: 'group', 'aria-label': t('settings.goal.weightGoalAria') },
    el('div', { class: 'set-card-top' }, group),
    amountRow,
    summary));
  wrap.getDirection = () => direction;
  wrap.getRate = () => goalToRate(direction, typedAmount);
  wrap.getError = () => { const e = goalAmountError(direction, typedAmount); return e ? say(e) : null; };
  wrap.amount = amount;
  setDirection(direction, false);
  return wrap;
}
