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
import { t } from '../i18n/index.js';

import { MIN_KG, MAX_KG } from '../core/body-weight.js'; // same limits everywhere
const MACRO_LABEL = { protein: 'onboarding.macro.protein', carbs: 'onboarding.macro.carbs', fat: 'onboarding.macro.fat' };
const macroLabel = (k) => t(MACRO_LABEL[k]);
/** Activity level label – hint, translated by id (core.activity.<id>, see src/core/adaptive.js). */
const activityText = (a) => `${t(`core.activity.${a.id}`)} – ${t(`core.activity.${a.id}.hint`)}`;
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

  const skipAll = el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => finish('diary', true) }, t('onboarding.welcome.skipAll'));

  // ---------------------------------------------------------------- step: about you (inputs kept across steps)
  const sel = (value, options, ariaLabel) => el('select', { class: 'select', 'aria-label': ariaLabel },
    options.map(([v, label]) => el('option', { value: v, selected: v === (value ?? '') }, label)));
  const about = {
    sex: sel(profile.sex, [['', t('onboarding.about.notSet')], ['female', t('onboarding.about.female')], ['male', t('onboarding.about.male')], ['other', t('onboarding.about.other')]], t('onboarding.about.sex')),
    birthYear: numberInput({ value: profile.birthYear, integer: true, min: 1900, max: new Date().getFullYear() - 10, ariaLabel: t('onboarding.about.birthYear') }),
    height: numberInput({ value: profile.heightCm, min: 100, max: 250, decimals: 1, ariaLabel: t('onboarding.about.height') }),
    weight: numberInput({ value: lastWeight && lastWeight.date === todayStr ? lastWeight.kg : null, min: MIN_KG, max: MAX_KG, decimals: 2,
      ariaLabel: t('onboarding.about.weightAria'), placeholder: lastWeight ? fmtNum(lastWeight.kg, 2) : '' }),
    activity: sel(profile.activity, [['', t('onboarding.about.notSet')], ...ACTIVITY_LEVELS.map((a) => [a.id, activityText(a)])], t('onboarding.about.activity')),
  };
  if (typed.about) for (const [k, input] of Object.entries(about)) if (typeof typed.about[k] === 'string') input.value = typed.about[k];
  /** Profile as currently typed (for the estimate), and the weight to use for it. */
  const typedProfile = () => ({ ...profile, sex: about.sex.value || null, birthYear: about.birthYear.getNumber(),
    heightCm: about.height.getNumber(), activity: about.activity.value || null });
  const estimateWeight = () => about.weight.getNumber() ?? (lastWeight ? lastWeight.kg : null);

  function aboutStep() {
    return [
      el('h2', { class: 'ob-title' }, t('onboarding.about.title')),
      el('p', { class: 'muted' }, t('onboarding.about.lead')),
      el('div', { class: 'card stack' },
        el('div', { class: 'grid-2' }, field(t('onboarding.about.sex'), about.sex), field(t('onboarding.about.birthYear'), about.birthYear)),
        el('div', { class: 'grid-2' }, field(t('onboarding.about.height'), about.height, { unit: 'cm' }), field(t('onboarding.about.weightToday'), about.weight, { unit: 'kg' })),
        field(t('onboarding.about.activity'), about.activity, { hint: t('onboarding.about.activityHint') })),
    ];
  }
  function readAbout() {
    const checks = [[about.birthYear, 'onboarding.about.errorBirthYear'], [about.height, 'onboarding.about.errorHeight'], [about.weight, 'onboarding.about.errorWeight']];
    for (const [input, key] of checks) {
      if (input.value.trim() && input.getNumber() === null) { input.focus(); toast(t(key, { min: MIN_KG, max: MAX_KG }), { type: 'error' }); return false; }
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
  const useEstimate = el('button', { type: 'button', class: 'btn btn-sm', hidden: true, onClick: () => { applyProposal(true); } }, t('onboarding.goal.useEstimate'));

  function refreshEstimate() {
    const r = rate.getRate();
    const p = proposeTargets({ profile: typedProfile(), weightKg: estimateWeight(), rateKgPerWeek: r ?? 0, adaptive: adaptive || {}, asOf: todayStr });
    proposal = p.target;
    if (!p.target) {
      estimateBox.replaceChildren(el('p', { class: 't-sub' }, t('onboarding.goal.fillAbout')));
      useEstimate.hidden = true;
      return;
    }
    estimateBox.replaceChildren(...[
      el('div', { class: 'ob-est-row' }, el('span', { class: 'ob-est-label' }, t('onboarding.goal.expenditure'), infoButton('expenditure')), el('strong', null, t('onboarding.goal.kcalPerDay', { kcal: fmtGrouped(p.tdee) }))),
      el('div', { class: 'ob-est-row' }, el('span', { class: 'ob-est-label' }, t('onboarding.goal.suggested')), el('strong', null, `${fmtGrouped(p.target.kcal)} kcal`)),
      el('div', { class: 't-sub muted' }, t('onboarding.goal.macros', { protein: p.target.protein, carbs: p.target.carbs, fat: p.target.fat })),
      p.target.limitedBy === 'floor' ? el('p', { class: 't-sub text-warning' }, t('onboarding.goal.floor')) : null,
      p.target.proteinLimited ? el('p', { class: 't-sub text-warning' }, t('onboarding.goal.proteinCapped', { protein: p.target.protein, wanted: p.target.proteinWanted })) : null,
      el('p', { class: 't-sub muted' }, t('onboarding.goal.formula')),
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
      el('div', { class: 'ob-title-row' }, el('h2', { class: 'ob-title' }, t('onboarding.goal.title')), infoButton('goal')),
      el('div', { class: 'card set-card' }, rate),
      el('div', { class: 'card stack' }, estimateBox),
      el('section', { class: 'card stack' },
        el('div', { class: 'row-between' }, el('div', { class: 'ob-title-row' }, el('h3', { class: 'card-title' }, t('onboarding.goal.dailyTargets')), infoButton('macros')), useEstimate),
        editor.el),
      el('p', { class: 't-sub muted ob-foot' },
        t('onboarding.goal.checkinNote'), infoButton('checkin')),
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
    if (!check.ok) { editor.focus(check.field); toast(t(check.errorKey), { type: 'error' }); return false; }
    answers.rateKgPerWeek = r;
    answers.targets = input;
    return true;
  }

  // ---------------------------------------------------------------- steps: intro, install, data
  function introStep() {
    return [
      el('h2', { class: 'ob-title' }, t('onboarding.intro.title')),
      el('p', null, t('onboarding.intro.lead')),
      el('section', { class: 'card stack ob-key' },
        el('div', { class: 'ob-title-row' }, icon('shield', { class: 'ob-key-ic' }), el('h3', { class: 'card-title' }, t('onboarding.intro.dataTitle'))),
        el('ul', { class: 'ob-list' },
          el('li', null, t('onboarding.intro.noAccount')),
          el('li', null, t('onboarding.intro.clearing')),
          el('li', null, t('onboarding.intro.export'))),
        el('p', { class: 't-sub muted' }, t('onboarding.intro.online'))),
    ];
  }
  function installStep() {
    return [
      el('h2', { class: 'ob-title' }, t('onboarding.installStep.title')),
      el('p', { class: 'muted' }, t('onboarding.install.why')),
      el('div', { class: 'card' }, installGuide(plat)),
    ];
  }

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast(t('onboarding.data.notJson'), { type: 'error' }); return; }
    await importFlow(data, { reloadTo: 'diary' });
  });
  function dataStep() {
    const item = (props, title, sub) => el(props.href ? 'a' : 'button', { class: 'list-item', ...(props.href ? {} : { type: 'button' }), ...props },
      el('span', { class: 'li-lead' }, icon(props.href ? 'file-text' : 'upload')),
      el('div', { class: 'li-main' }, el('div', { class: 'li-title ob-wrap' }, title), el('div', { class: 'li-sub ob-wrap' }, sub)),
      icon('chevron-right', { class: 'li-chevron' }));
    return [
      el('h2', { class: 'ob-title' }, t('onboarding.data.title')),
      el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
        item({ href: href('import'), onClick: (e) => { e.preventDefault(); finish('import'); } },
          t('onboarding.data.import'), t('onboarding.data.importSub')),
        item({ onClick: () => fileInput.click() },
          t('onboarding.data.restore'), t('onboarding.data.restoreSub')))),
      fileInput,
    ];
  }

  // ---------------------------------------------------------------- navigation
  const VIEW = { intro: introStep, install: installStep, about: aboutStep, goal: goalStep, data: dataStep };
  const READ = { about: readAbout, goal: readGoal };

  function render() {
    const step = STEPS[i];
    const stepText = t('onboarding.welcome.step', { n: i + 1, total: STEPS.length });
    header.replaceChildren(pageHeader({ title: t('onboarding.welcome.title'), subtitle: stepText, actions: [skipAll] }),
      progressBar({ value: i + 1, max: STEPS.length, label: stepText }));
    const last = i === STEPS.length - 1;
    const nextLabel = t(last ? 'onboarding.welcome.startFresh' : step === 'install' && plat.install.startsWith('ios') ? 'onboarding.welcome.continueBrowser' : 'onboarding.welcome.next');
    const nav = el('div', { class: 'stack ob-nav' },
      el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => next(true) }, nextLabel),
      el('div', { class: 'row-between' },
        i > 0 ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => go(i - 1) }, icon('chevron-left', { size: 18 }), t('common.back')) : el('span'),
        READ[step] || step === 'install' ? el('button', { type: 'button', class: 'btn btn-ghost', onClick: () => next(false) }, t('onboarding.welcome.skipStep')) : el('span')));
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
      if (w.errorKey) { toast(t(w.errorKey), { type: 'error' }); return; }
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
      if (wrote) toast(t('onboarding.welcome.saved'), { type: 'success' });
      navigate(dest, { replace: true });
    } catch (err) {
      console.error(err);
      toast(t('onboarding.welcome.saveFailed', { error: err.message }), { type: 'error' });
    } finally {
      busy = false;
    }
  }

  render();
  if (draft) toast(t('onboarding.welcome.restored'), { duration: 4000 });
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
  const kcal = numberInput({ value: targets.kcal, min: 0, max: 20000, decimals: 0, ariaLabel: t('onboarding.targets.kcalAria'), onInput: () => { markEdited(); update(); } });
  const grams = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: targets[k], min: 0, max: 2000, decimals: 0,
    ariaLabel: t('onboarding.targets.gramsAria', { macro: macroLabel(k) }), onInput: () => { markEdited(); update(); } })]));
  const initialPct = mode === 'percent' && targets.pct ? targets.pct : pctFromGrams(targets, 0) || { protein: 30, carbs: 40, fat: 30 };
  const pct = Object.fromEntries(MACROS.map((k) => [k, numberInput({ value: initialPct[k], min: 0, max: 100, decimals: 1,
    ariaLabel: t('onboarding.targets.pctAria', { macro: macroLabel(k) }), onInput: () => { markEdited(); update(); } })]));
  const pctHints = Object.fromEntries(MACROS.map((k) => [k, el('div', { class: 'field-hint' })]));
  const sumLine = el('p', { class: 't-sub', 'aria-live': 'polite' });
  const chips = SPLIT_PRESETS.map((p) => el('button', { type: 'button', class: 'chip', 'aria-pressed': 'false',
    'aria-label': t('onboarding.targets.presetAria', { protein: p.pct.protein, carbs: p.pct.carbs, fat: p.pct.fat }),
    onClick: () => { for (const k of MACROS) pct[k].setNumber(p.pct[k]); markEdited(); update(); } }, p.label.replace(/\//g, ' / ')));
  const tabs = segmented({ ariaLabel: t('onboarding.targets.modeAria'), value: mode,
    options: [{ value: 'grams', label: t('onboarding.targets.grams') }, { value: 'percent', label: t('onboarding.targets.percent') }], onChange: (m) => switchMode(m) });
  const withHint = (f, hint) => { f.append(hint); return f; };
  const gramsPanel = el('div', { class: 'grid-3' }, MACROS.map((k) => field(macroLabel(k), grams[k], { unit: 'g' })));
  const pctPanel = el('div', { class: 'stack' },
    el('div', { class: 'chips', role: 'group', 'aria-label': t('onboarding.targets.presetsAria') }, chips),
    el('div', { class: 'grid-3' }, MACROS.map((k) => withHint(field(macroLabel(k), pct[k], { unit: '%' }), pctHints[k]))),
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
    sumLine.textContent = v.ok ? t('onboarding.targets.total', { sum: fmtNum(v.sum) })
      : rest !== null ? t('onboarding.targets.totalFix', { sum: fmtNum(v.sum), carbs: fmtNum(rest) }) : t('onboarding.targets.totalWrong', { sum: fmtNum(v.sum) });
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
    el: el('div', { class: 'stack' }, field(t('onboarding.targets.kcal'), kcal, { unit: 'kcal' }), tabs, gramsPanel, pctPanel),
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
