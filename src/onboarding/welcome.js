// First-run welcome (#/welcome): what the app is, install, about you, goal + targets, bring your data.
// One decision per screen, every step skippable. Finishing writes the same settings records as the
// Settings screen (core/setup.js) plus today's weigh-in, and marks setup complete in settings.meta.
import * as db from '../db/db.js';
import { el, pageHeader, field, numberInput, toast, navigate, fmtNum, fmtGrouped, href, icon, infoButton, segmented, progressBar } from '../ui/index.js';
import { today } from '../core/dates.js';
import { ACTIVITY_LEVELS } from '../core/adaptive.js';
import { MACROS, SPLIT_PRESETS, validateSplit, pctFromGrams, gramsFromPct, targetMode, carbsRest } from '../core/macro-split.js';
import { proposeTargets, setupWrites, buildTargets } from '../core/setup.js';
import { goalRateControl, importFlow } from '../settings/settings-view.js';
import { currentPlatform, installGuide } from './install.js';
import { requestPersistence } from './backup.js';
import { ensureCss } from './shell.js';
import { loadDraft, saveDraft, clearDraft } from '../ui/draft.js';

import { MIN_KG, MAX_KG } from '../core/body-weight.js'; // same limits everywhere
const MACRO_LABEL = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
/** localStorage draft of the setup (answers, typed values, current step), so a reload loses nothing. */
const DRAFT = 'welcome';

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

  // Answers and typed values from before a reload (iOS reloads an evicted home-screen app).
  const draft = loadDraft(DRAFT);
  const typed = (draft && draft.typed) || {};

  /** What the user confirmed with Next. Skipped steps stay undefined (nothing is written for them). */
  const answers = draft && draft.answers && typeof draft.answers === 'object' ? { ...draft.answers } : {};
  let i = draft ? Math.max(0, STEPS.indexOf(draft.step)) : 0;
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
  if (typed.about) for (const [k, input] of Object.entries(about)) if (typeof typed.about[k] === 'string') input.value = typed.about[k];
  /** Profile as currently typed (for the estimate), and the weight to use for it. */
  const typedProfile = () => ({ ...profile, sex: about.sex.value || null, birthYear: about.birthYear.getNumber(),
    heightCm: about.height.getNumber(), activity: about.activity.value || null });
  const estimateWeight = () => about.weight.getNumber() ?? (lastWeight ? lastWeight.kg : null);

  function aboutStep() {
    return [
      el('h2', { class: 'ob-title' }, 'About you'),
      el('p', { class: 'muted' }, 'For a first estimate. All optional.'),
      el('div', { class: 'card stack' },
        el('div', { class: 'grid-2' }, field('Sex', about.sex), field('Birth year', about.birthYear)),
        el('div', { class: 'grid-2' }, field('Height', about.height, { unit: 'cm' }), field('Weight today', about.weight, { unit: 'kg' })),
        field('Activity level', about.activity, { hint: 'Including your workouts' })),
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
  const rate = goalRateControl(typed.rate ?? goal.rateKgPerWeek);
  const editor = targetsEditor(targets, typed.editor);
  const estimateBox = el('div', { class: 'stack ob-estimate', 'aria-live': 'polite' });
  let proposal = null;
  const useEstimate = el('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => { applyProposal(true); } }, 'Use the estimate');

  function refreshEstimate() {
    const r = rate.getRate();
    const p = proposeTargets({ profile: typedProfile(), weightKg: estimateWeight(), rateKgPerWeek: r ?? 0, adaptive: adaptive || {}, asOf: todayStr });
    proposal = p.target;
    if (!p.target) {
      estimateBox.replaceChildren(el('p', { class: 't-sub' }, 'Fill in About you for an estimate, or type targets below.'));
      useEstimate.hidden = true;
      return;
    }
    estimateBox.replaceChildren(...[
      el('div', { class: 'ob-est-row' }, el('span', { class: 'ob-est-label' }, 'Expenditure', infoButton('expenditure')), el('strong', null, `${fmtGrouped(p.tdee)} kcal / day`)),
      el('div', { class: 'ob-est-row' }, el('span', { class: 'ob-est-label' }, 'Suggested target'), el('strong', null, `${fmtGrouped(p.target.kcal)} kcal`)),
      el('div', { class: 't-sub muted' }, `Protein ${p.target.protein} g · carbs ${p.target.carbs} g · fat ${p.target.fat} g`),
      p.target.limitedBy === 'floor' ? el('p', { class: 't-sub text-warning' }, 'Raised to the calorie floor.') : null,
      p.target.proteinLimited ? el('p', { class: 't-sub text-warning' }, `Protein capped at ${p.target.protein} g to fit calories (setting: ${p.target.proteinWanted} g).`) : null,
      el('p', { class: 't-sub muted' }, 'Formula estimate, not from your data yet.'),
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
      el('div', { class: 'ob-title-row' }, el('h2', { class: 'ob-title' }, 'Your goal'), infoButton('goal')),
      el('div', { class: 'card set-card' }, rate),
      el('div', { class: 'card stack' }, estimateBox),
      el('section', { class: 'card stack' },
        el('div', { class: 'row-between' }, el('div', { class: 'ob-title-row' }, el('h3', { class: 'card-title' }, 'Daily targets'), infoButton('macros')), useEstimate),
        editor.el),
      el('p', { class: 't-sub muted ob-foot' },
        'After about 2 weeks of logging, Trends proposes targets each Monday. You decide.', infoButton('checkin')),
    ];
  }
  function readGoal() {
    const r = rate.getRate();
    if (r === null) {
      rate.amount.focus();
      toast(`${rate.getError()}.`, { type: 'error' });
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
      el('p', null, 'Log food, weight and workouts. Get targets, weekly reports and training stats.'),
      el('section', { class: 'card stack ob-key' },
        el('div', { class: 'ob-title-row' }, icon('shield', { class: 'ob-key-ic' }), el('h3', { class: 'card-title' }, 'Your data stays on this phone')),
        el('ul', { class: 'ob-list' },
          el('li', null, 'No account, no cloud. Only you can see your data.'),
          el('li', null, 'Clearing browser data or deleting the app deletes everything.'),
          el('li', null, 'Export a backup now and then: Settings › Data.')),
        el('p', { class: 't-sub muted' }, 'Online only for food lookups and, if set up, meal photos.')),
    ];
  }
  function installStep() {
    return [
      el('h2', { class: 'ob-title' }, 'Add it to your home screen'),
      el('p', { class: 'muted' }, 'Works offline, and the browser is less likely to clear data.'),
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
      el('span', { class: 'li-lead' }, icon(props.href ? 'file-text' : 'upload')),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), el('div', { class: 'li-sub ob-wrap' }, sub)),
      icon('chevron-right', { class: 'li-chevron' }));
    return [
      el('h2', { class: 'ob-title' }, 'Bring your data'),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        item({ href: href('import'), onClick: (e) => { e.preventDefault(); finish('import'); } },
          'Import from other tools', 'Workout sheet, body weights, food diary'),
        item({ onClick: () => fileInput.click() },
          'Restore a Tracker backup', 'Replaces everything on this device.'))),
      fileInput,
    ];
  }

  // ---------------------------------------------------------------- navigation
  const VIEW = { intro: introStep, install: installStep, about: aboutStep, goal: goalStep, data: dataStep };
  const READ = { about: readAbout, goal: readGoal };

  function render() {
    const step = STEPS[i];
    header.replaceChildren(pageHeader({ title: 'Setup', subtitle: `Step ${i + 1} of ${STEPS.length}`, actions: [skipAll] }),
      progressBar({ value: i + 1, max: STEPS.length, label: `Step ${i + 1} of ${STEPS.length}` }));
    const last = i === STEPS.length - 1;
    const nextLabel = last ? 'Start fresh' : step === 'install' && plat.install.startsWith('ios') ? 'Continue in the browser' : 'Next';
    const nav = el('div', { class: 'stack ob-nav' },
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => next(true) }, nextLabel),
      el('div', { class: 'row-between' },
        i > 0 ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go(i - 1) }, icon('chevron-left', { size: 18 }), 'Back') : el('span'),
        READ[step] || step === 'install' ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => next(false) }, 'Skip this step') : el('span')));
    body.replaceChildren(...VIEW[step](), nav);
    body.dataset.step = step;
    window.scrollTo(0, 0);
    const h = body.querySelector('.ob-title');
    if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
  }
  function go(n) { i = Math.max(0, Math.min(STEPS.length - 1, n)); render(); persist(); }

  function persist() {
    if (busy) return;
    saveDraft(DRAFT, {
      step: STEPS[i], answers,
      typed: {
        about: Object.fromEntries(Object.entries(about).map(([k, input]) => [k, input.value])),
        rate: rate.getRate(),
        editor: editor.state(),
      },
    });
  }
  // Every change on any step is saved (after the control's own handler ran).
  let persistTimer = null;
  const persistSoon = () => { clearTimeout(persistTimer); persistTimer = setTimeout(persist, 0); };
  for (const type of ['input', 'change', 'click']) body.addEventListener(type, persistSoon);
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
      clearTimeout(persistTimer);
      clearDraft(DRAFT);
      requestPersistence();
      const wrote = Object.keys(w.settings).length || w.weight;
      if (wrote) toast('Setup saved. Change it any time in Settings.', { type: 'success' });
      navigate(dest, { replace: true });
    } catch (err) {
      console.error(err);
      toast(`Could not save: ${err.message}`, { type: 'error' });
    } finally {
      busy = false;
    }
  }

  render();
  if (draft) toast('Answers restored.', { duration: 4000 });
  return () => { clearTimeout(persistTimer); document.documentElement.classList.remove('ob-focus'); };
}

/**
 * Calories + macros in grams or as a percentage split (same storage rules as Settings).
 * @param {object} targets stored settings.targets
 */
function targetsEditor(targets, saved = null) {
  let mode = saved && (saved.mode === 'percent' || saved.mode === 'grams') ? saved.mode : targetMode(targets);
  let edited = !!(saved && saved.edited);
  const listeners = [];
  const markEdited = () => { edited = true; for (const fn of listeners) fn(); };
  const kcal = numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: 'Calories target', onInput: () => { markEdited(); update(); } });
  const grams = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: targets[k], min: 0, max: 2000, decimals: 0,
    ariaLabel: `${MACRO_LABEL[k]} target in grams`, onInput: () => { markEdited(); update(); } })]));
  const initialPct = mode === 'percent' && targets.pct ? targets.pct : pctFromGrams(targets, 0) || { protein: 30, carbs: 40, fat: 30 };
  const pct = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: initialPct[k], min: 0, max: 100, decimals: 1,
    ariaLabel: `${MACRO_LABEL[k]} share of calories in percent`, onInput: () => { markEdited(); update(); } })]));
  const pctHints = Object.fromEntries(MACROS.map((k) => [k, el('div', { class: 'field-hint' })]));
  const sumLine = el('p', { class: 't-sub', 'aria-live': 'polite' });
  const chips = SPLIT_PRESETS.map((p) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false',
    'aria-label': `${p.pct.protein} % protein, ${p.pct.carbs} % carbs, ${p.pct.fat} % fat`,
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); markEdited(); update(); } }, p.label.replace(/\//g, ' / ')));
  const tabs = segmented({ ariaLabel: 'Enter macros as', value: mode,
    options: [{ value: 'grams', label: 'Grams' }, { value: 'percent', label: 'Percent' }], onChange: (m) => switchMode(m) });
  const withHint = (f, hint) => { f.append(hint); return f; };
  const gramsPanel = el('div', { class: 'grid-3' }, MACROS.map((k) => field(MACRO_LABEL[k], grams[k], { unit: 'g' })));
  const pctPanel = el('div', { class: 'stack' },
    el('div', { class: 'chips', role: 'group', 'aria-label': 'Preset splits' }, chips),
    el('div', { class: 'grid-3' }, MACROS.map((k) => withHint(field(MACRO_LABEL[k], pct[k], { unit: '%' }), pctHints[k]))),
    sumLine);

  if (saved) {
    // Typed values from a draft (raw text, so a half-typed number comes back as it was).
    if (typeof saved.kcal === 'string') kcal.value = saved.kcal;
    for (const k of MACROS) {
      if (saved.grams && typeof saved.grams[k] === 'string') grams[k].value = saved.grams[k];
      if (saved.pct && typeof saved.pct[k] === 'string') pct[k].value = saved.pct[k];
    }
  }

  const pctValues = () => Object.fromEntries(MACROS.map((k) => [k, pct[k].getNumber()]));
  function update() {
    tabs.setValue(mode);
    gramsPanel.hidden = mode !== 'grams';
    pctPanel.hidden = mode !== 'percent';
    if (mode !== 'percent') return;
    const p = pctValues();
    const g = gramsFromPct(kcal.getNumber(), p);
    for (const k of MACROS) pctHints[k].textContent = g[k] === null ? '= – g' : `= ${g[k]} g`;
    const v = validateSplit(p);
    const rest = carbsRest(p);
    sumLine.className = `t-sub ${v.ok ? 'text-success' : 'text-warning'}`;
    sumLine.textContent = v.ok ? `Total ${fmtNum(v.sum)} %` : `Total ${fmtNum(v.sum)} %, must be 100${rest !== null && !v.ok ? ` · carbs ${fmtNum(rest)} % fits` : ''}`;
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
    el: el('div', { class: 'stack' }, field('Calories', kcal, { unit: 'kcal' }), tabs, gramsPanel, pctPanel),
    edited: () => edited,
    onEdit: (fn) => listeners.push(fn),
    /** Everything typed, for the draft. */
    state: () => ({
      mode, edited, kcal: kcal.value,
      grams: Object.fromEntries(MACROS.map((k) => [k, grams[k].value])),
      pct: Object.fromEntries(MACROS.map((k) => [k, pct[k].value])),
    }),
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
