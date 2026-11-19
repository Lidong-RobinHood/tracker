// First-run welcome (#/welcome): what the app is, install, about you, goal + targets, bring your data.
// One decision per screen, every step skippable. Finishing writes the same settings records as the
// Settings screen (core/setup.js) plus today's weigh-in, and marks setup complete in settings.meta.
import * as db from '../db/db.js';
import { el, pageHeader, field, numberInput, toast, navigate, fmtNum, href } from '../ui/index.js';
import { today } from '../core/dates.js';
import { ACTIVITY_LEVELS } from '../core/adaptive.js';
import { MACROS, SPLIT_PRESETS, validateSplit, pctFromGrams, gramsFromPct, targetMode, carbsRest } from '../core/macro-split.js';
import { proposeTargets, setupWrites, buildTargets } from '../core/setup.js';
import { goalRateControl, importFlow } from '../settings/settings-view.js';
import { GOAL_AMOUNT_MAX } from '../core/goal-rate.js';
import { currentPlatform, installGuide } from './install.js';
import { requestPersistence } from './backup.js';
import { ensureCss } from './shell.js';

const MIN_KG = 20; const MAX_KG = 400; // same limits as the Trends weight screen
const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

export async function mountWelcome(container) {
  ensureCss();
  container.classList.add('ob-view');
  document.documentElement.classList.add('ob-focus');
  const [profile, goal, targets, adaptive, latest] = await Promise.all([
    db.getSetting('profile'), db.getSetting('goal'), db.getSetting('targets'), db.getSetting('adaptive'),
    db.range('weights', null, { direction: 'prev', limit: 1 }),
  ]);
  const todayStr = today();
  const lastWeight = latest[0] || null;
  const plat = currentPlatform();
  const STEPS = ['intro', plat.install === 'standalone' ? null : 'install', 'about', 'goal', 'data'].filter(Boolean);

  /** What the user confirmed with Next. Skipped steps stay undefined (nothing is written for them). */
  const answers = {};
  let i = 0;
  let busy = false;

  const body = el('div', { class: 'stack ob-body' });
  const header = el('div');
  container.append(header, body);

  const skipAll = el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => finish('diary', true) }, 'Skip setup');

  // ---------------------------------------------------------------- step: about you (inputs kept across steps)
  const sel = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const about = {
    sex: sel(profile.sex, [['', 'Not set'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other / prefer not to say']], 'Sex'),
    birthYear: numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: 'Birth year' }),
    height: numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: 'Height' }),
    weight: numberInput({ value: lastWeight && lastWeight.date === todayStr ? lastWeight.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2,
      ariaLabel: "Today's weight", placeholder: lastWeight ? fmtNum(lastWeight.kg, 2) : '' }),
    activity: sel(profile.activity, [['', 'Not set'], ...ACTIVITY_LEVELS.map((a) => [a.id, `${a.label} – ${a.hint}`])], 'Activity level'),
  };
  /** Profile as currently typed (for the estimate), and the weight to use for it. */
  const typedProfile = () => ({ ...profile, sex: about.sex.value || null, birthYear: about.birthYear.getNumber(),
    heightCm: about.height.getNumber(), activity: about.activity.value || null });
  const estimateWeight = () => about.weight.getNumber() ?? (lastWeight ? lastWeight.kg : null);

  function aboutStep() {
    return [
      el('h2', { class: 'ob-title' }, 'About you'),
      el('p', { class: 'muted' }, 'Used for a first calorie estimate. Leave anything empty you do not want to give.'),
      el('div', { class: 'card stack' },
        el('div', { class: 'grid-2' }, field('Sex', about.sex), field('Birth year', about.birthYear)),
        el('div', { class: 'grid-2' }, field('Height', about.height, { unit: 'cm' }), field('Weight today', about.weight, { unit: 'kg' })),
        field('Activity level', about.activity, { hint: 'Your normal week, including training.' })),
    ];
  }
  function readAbout() {
    const checks = [[about.birthYear, 'birth year'], [about.height, 'height'], [about.weight, `weight (${MIN_KG}–${MAX_KG} kg)`]];
    for (const [input, name] of checks) {
      if (input.value.trim() && input.getNumber() === null) { input.focus(); toast(`Enter a valid ${name} or leave it empty.`, { type: 'error' }); return false; }
    }
    const a = { sex: about.sex.value || null, birthYear: about.birthYear.getNumber(), heightCm: about.height.getNumber(),
      weightKg: about.weight.getNumber(), activity: about.activity.value || null };
    if (Object.values(a).some((v) => v !== null)) answers.about = a;
    return true;
  }

  // ---------------------------------------------------------------- step: goal and targets
  const rate = goalRateControl(goal.rateKgPerWeek);
  const editor = targetsEditor(targets);
  const estimateBox = el('div', { class: 'stack ob-estimate', 'aria-live': 'polite' });
  let proposal = null;
  const useEstimate = el('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => { applyProposal(true); } }, 'Use the estimate');

  function refreshEstimate() {
    const r = rate.getRate();
    const p = proposeTargets({ profile: typedProfile(), weightKg: estimateWeight(), rateKgPerWeek: r ?? 0, adaptive: adaptive || {}, asOf: todayStr });
    proposal = p.target;
    if (!p.target) {
      estimateBox.replaceChildren(el('p', { class: 'small' },
        'No estimate yet: it needs sex, birth year, height, weight and activity level (step “About you”). You can type your own targets below.'));
      useEstimate.hidden = true;
      return;
    }
    estimateBox.replaceChildren(...[
      el('div', { class: 'row-between' }, el('span', null, 'You burn about'), el('strong', { class: 'num' }, `${fmtNum(p.tdee, 0)} kcal a day`)),
      el('div', { class: 'row-between' }, el('span', null, 'Suggested target'), el('strong', { class: 'num' }, `${fmtNum(p.target.kcal, 0)} kcal`)),
      el('div', { class: 'small muted num' }, `Protein ${p.target.protein} g · carbs ${p.target.carbs} g · fat ${p.target.fat} g`),
      p.target.limitedBy === 'floor' ? el('p', { class: 'small text-warning' }, `Raised to the lowest target the app proposes (${fmtNum(p.target.kcal, 0)} kcal).`) : null,
      el('p', { class: 'small muted' }, 'Formula estimate from your profile (Mifflin-St Jeor × activity), not yet based on your data.'),
    ].filter(Boolean));
    applyProposal(false);
  }
  /** Put the proposal into the editor unless the user typed their own numbers (force: button). */
  function applyProposal(force) {
    if (!proposal) return;
    if (force || !editor.edited()) editor.set(proposal);
    useEstimate.hidden = !editor.edited();
  }
  editor.onEdit(() => { useEstimate.hidden = !proposal || !editor.edited(); });
  rate.addEventListener('click', () => setTimeout(refreshEstimate, 0));
  rate.addEventListener('input', refreshEstimate);

  function goalStep() {
    refreshEstimate();
    return [
      el('h2', { class: 'ob-title' }, 'Your goal'),
      el('div', { class: 'card stack' }, rate),
      el('div', { class: 'card stack' }, estimateBox),
      el('section', { class: 'card stack' },
        el('div', { class: 'row-between' }, el('h3', { class: 'card-title' }, 'Daily targets'), useEstimate),
        editor.el),
      el('p', { class: 'small muted' },
        'After about two weeks of logging food and weight, the Trends tab proposes new targets each Monday from your own data. Nothing changes until you accept.'),
    ];
  }
  function readGoal() {
    const r = rate.getRate();
    if (r === null) {
      rate.amount.focus();
      const dir = rate.getDirection();
      toast(`Enter how many kg a week to ${dir}: more than 0, at most ${GOAL_AMOUNT_MAX[dir]}.`, { type: 'error' });
      return false;
    }
    const input = editor.read();
    const check = buildTargets(targets, input);
    if (!check.ok) { editor.focus(check.field); toast(check.error, { type: 'error' }); return false; }
    answers.rateKgPerWeek = r;
    answers.targets = input;
    return true;
  }

  // ---------------------------------------------------------------- steps: intro, install, data
  function introStep() {
    return [
      el('h2', { class: 'ob-title' }, 'Welcome to Tracker'),
      el('p', null, 'Log what you eat, your body weight and your workouts. Tracker turns them into daily calorie and macro targets, weekly reports and training stats.'),
      el('section', { class: 'card stack ob-key' },
        el('h3', { class: 'card-title' }, 'Your data stays on this phone'),
        el('ul', { class: 'ob-list' },
          el('li', null, 'No account and no cloud. Nobody else can see your data, including whoever sent you the link.'),
          el('li', null, 'Clearing this browser’s data or deleting the app deletes everything.'),
          el('li', null, 'So export a backup now and then (Settings › Backup). The app reminds you.')),
        el('p', { class: 'small muted' }, 'The app only goes online to look up foods (Open Food Facts) and, if you set it up, to analyse meal photos with your own AI key.')),
    ];
  }
  function installStep() {
    return [
      el('h2', { class: 'ob-title' }, 'Add it to your home screen'),
      el('p', { class: 'muted' }, 'It then opens like an app, works offline, and the browser is less likely to clear its data.'),
      el('div', { class: 'card' }, installGuide(plat)),
    ];
  }

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('That file is not valid JSON.', { type: 'error' }); return; }
    await importFlow(data, { reloadTo: 'diary' });
  });
  function dataStep() {
    const item = (props, title, sub) => el(props.href ? 'a' : 'button', { class: 'list-item', ...(props.href ? {} : { type: 'button' }), ...props },
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), el('div', { class: 'li-sub' }, sub)),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
    return [
      el('h2', { class: 'ob-title' }, 'Bring your data'),
      el('p', { class: 'muted' }, 'Coming from another app or a spreadsheet? Bring your history so trends and progress start from it.'),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        item({ href: href('import'), onClick: (e) => { e.preventDefault(); finish('import'); } },
          'Import from other tools', 'Workout sheet, body weights, food diary'),
        item({ onClick: () => fileInput.click() },
          'Restore a Tracker backup', 'A .json file exported from Tracker, e.g. on your old phone. Replaces everything on this device, including what you entered here.'))),
      fileInput,
    ];
  }

  // ---------------------------------------------------------------- navigation
  const VIEW = { intro: introStep, install: installStep, about: aboutStep, goal: goalStep, data: dataStep };
  const READ = { about: readAbout, goal: readGoal };

  function render() {
    const step = STEPS[i];
    header.replaceChildren(pageHeader({ title: 'Setup', subtitle: `Step ${i + 1} of ${STEPS.length}`, actions: [skipAll] }));
    const last = i === STEPS.length - 1;
    const nextLabel = last ? 'Start fresh' : step === 'install' && plat.install.startsWith('ios') ? 'Continue in the browser' : 'Next';
    const nav = el('div', { class: 'stack ob-nav' },
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => next(true) }, nextLabel),
      el('div', { class: 'row-between' },
        i > 0 ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go(i - 1) }, 'Back') : el('span'),
        READ[step] || step === 'install' ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => next(false) }, 'Skip this step') : el('span')));
    body.replaceChildren(...VIEW[step](), nav);
    body.dataset.step = step;
    window.scrollTo(0, 0);
    const h = body.querySelector('.ob-title');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  function go(n) { i = Math.max(0, Math.min(STEPS.length - 1, n)); render(); }
  function next(save) {
    const step = STEPS[i];
    if (save && READ[step] && !READ[step]()) return;
    if (i === STEPS.length - 1) { finish('diary'); return; }
    go(i + 1);
  }

  /** Write what was answered and leave. @param {string} dest route @param {boolean} [skipped] */
  async function finish(dest, skipped = false) {
    if (busy) return;
    busy = true;
    try {
      const w = setupWrites(answers, { profile, goal, targets }, { today: todayStr, now: Date.now(), skipped });
      if (w.error) { toast(w.error, { type: 'error' }); return; }
      await db.transaction(['settings', 'weights'], 'readwrite', async (t) => {
        for (const [key, value] of Object.entries(w.settings)) t.put('settings', { key, value });
        if (w.weight) t.put('weights', w.weight);
        const rec = await t.get('settings', 'meta');
        t.put('settings', { key: 'meta', value: { ...db.SETTINGS_DEFAULTS.meta, ...(rec && rec.value), ...w.metaPatch } });
      });
      requestPersistence();
      const wrote = Object.keys(w.settings).length || w.weight;
      if (wrote) toast('Setup saved. You can change everything later in Settings.', { type: 'success' });
      navigate(dest, { replace: true });
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message}`, { type: 'error' });
    } finally {
      busy = false;
    }
  }

  render();
  return () => document.documentElement.classList.remove('ob-focus');
}

/**
 * Calories + macros in grams or as a percentage split (same storage rules as Settings).
 * @param {object} targets stored settings.targets
 */
function targetsEditor(targets) {
  let mode = targetMode(targets);
  let edited = false;
  const listeners = [];
  const markEdited = () => { edited = true; for (const fn of listeners) fn(); };
  const kcal = numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: 'Calories target', onInput: () => { markEdited(); update(); } });
  const grams = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: targets[k], min: 0, max: 2000, decimals: 0,
    ariaLabel: `${MACRO_LABEL[k]} target in grams`, onInput: () => { markEdited(); update(); } })]));
  const initialPct = mode === 'percent' && targets.pct ? targets.pct : pctFromGrams(targets, 0) || { protein: 30, carbs: 40, fat: 30 };
  const pct = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: initialPct[k], min: 0, max: 100, decimals: 1,
    ariaLabel: `${MACRO_LABEL[k]} share of calories in percent`, onInput: () => { markEdited(); update(); } })]));
  const pctHints = Object.fromEntries(MACROS.map((k) => [k, el('div', { class: 'field-hint num' })]));
  const sumLine = el('p', { class: 'small num', 'aria-live': 'polite' });
  const chips = SPLIT_PRESETS.map((p) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false',
    'aria-label': `${p.pct.protein} % protein, ${p.pct.carbs} % carbs, ${p.pct.fat} % fat`,
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); markEdited(); update(); } }, p.label));
  const tabBtn = (m, label) => el('button', { type: 'button', role: 'tab', dataset: { mode: m }, onClick: () => switchMode(m) }, label);
  const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Enter macros as' }, tabBtn('grams', 'Grams'), tabBtn('percent', 'Percent'));
  const withHint = (f, hint) => { f.append(hint); return f; };
  const gramsPanel = el('div', { class: 'grid-3' }, MACROS.map((k) => field(MACRO_LABEL[k], grams[k], { unit: 'g' })));
  const pctPanel = el('div', { class: 'stack' },
    el('div', { class: 'chips', role: 'group', 'aria-label': 'Preset splits' }, chips),
    el('div', { class: 'grid-3' }, MACROS.map((k) => withHint(field(MACRO_LABEL[k], pct[k], { unit: '%' }), pctHints[k]))),
    sumLine);

  const pctValues = () => Object.fromEntries(MACROS.map((k) => [k, pct[k].getNumber()]));
  function update() {
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    gramsPanel.hidden = mode !== 'grams';
    pctPanel.hidden = mode !== 'percent';
    if (mode !== 'percent') return;
    const p = pctValues();
    const g = gramsFromPct(kcal.getNumber(), p);
    for (const k of MACROS) pctHints[k].textContent = g[k] === null ? '= – g' : `= ${g[k]} g`;
    const v = validateSplit(p);
    const rest = carbsRest(p);
    sumLine.className = `small num ${v.ok ? 'text-success' : 'text-warning'}`;
    sumLine.textContent = v.ok ? `Total ${fmtNum(v.sum)} %` : `Total ${fmtNum(v.sum)} %, must be 100${rest !== null && !v.ok ? ` (carbs ${fmtNum(rest)} % would fit)` : ''}`;
    for (const [n, preset] of SPLIT_PRESETS.entries()) chips[n].setAttribute('aria-pressed', String(MACROS.every((k) => p[k] === preset.pct[k])));
  }
  function switchMode(m) {
    if (m === mode) return;
    if (m === 'percent') {
      const p = pctFromGrams(Object.fromEntries(MACROS.map((k) => [k, grams[k].getNumber()])), 0);
      if (p) for (const k of MACROS) pct[k].setNumber(p[k]);
    } else {
      const g = gramsFromPct(kcal.getNumber(), pctValues());
      if (validateSplit(pctValues()).ok) for (const k of MACROS) if (g[k] !== null) grams[k].setNumber(g[k]);
    }
    mode = m;
    update();
  }
  update();
  return {
    el: el('div', { class: 'stack' }, field('Calories', kcal, { unit: 'kcal' }), tabs, gramsPanel, pctPanel,
      el('p', { class: 'field-hint' }, 'Percent: protein and carbs 4 kcal/g, fat 9 kcal/g; grams are rounded.')),
    edited: () => edited,
    onEdit: (fn) => listeners.push(fn),
    /** Fill in a proposal: calories always; grams in grams mode (percent mode keeps the split). */
    set(t) {
      kcal.setNumber(t.kcal);
      for (const k of MACROS) grams[k].setNumber(t[k]);
      if (mode === 'percent') { /* keep the user's split */ }
      edited = false;
      update();
    },
    read: () => (mode === 'percent'
      ? { mode, kcal: kcal.getNumber(), pct: pctValues() }
      : { mode, kcal: kcal.getNumber(), ...Object.fromEntries(MACROS.map((k) => [k, grams[k].getNumber()])) }),
    focus(name) {
      const input = name === 'kcal' ? kcal : name === 'pct' ? pct.protein : grams[name];
      if (input) input.focus();
    },
  };
}
