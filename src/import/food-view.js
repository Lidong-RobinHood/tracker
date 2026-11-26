// Import food diary history from a CSV/TSV export: file → detected format → column mapping
// (presets for documented exports) → meal names → preview → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, href, fmtGrouped, sectionHeader, statTile, icon, joinSentences } from '../ui/index.js';
import { today } from '../core/dates.js';
import {
  FOOD_FIELDS, PRESETS, guessMapping, detectPreset, presetMapping, detectFormats, mealValues, guessMeal,
  summariseFood, toDiaryRecords,
} from '../core/import-food.js';
import { MEALS } from '../core/food-diary.js';
import { t } from '../i18n/index.js';
import { mealName } from '../food/names.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, commitRun, dateY, dateRangeY, msgText, countOf } from './shared.js';

// i18n-ignore-next-line (sample file content)
const EXAMPLE = `Date;Meal;Food;Amount;kcal;Protein;Carbs;Fat
12.11.2026;Breakfast;Oats with milk;250;380;16;55;9,5
12.11.2026;Lunch;Pasta;350;620;24;98;12
13.11.2026;Dinner;"Pizza; salami";;850;35;90;38`;

/** Number styles: the value is the decimal mark (import-common.parseNumber). */
const numberStyles = () => [['comma', t('import.food.styleComma')], ['dot', t('import.food.styleDot')]];
const styleLabel = (d) => t('import.quoted', { text: d === 'comma' ? '1.234,5' : '1,234.5' });

const delims = () => [[',', t('import.food.delimComma')], [';', t('import.food.delimSemicolon')], ['\t', t('import.food.delimTab')], ['|', t('import.food.delimPipe')]];
/** Meal name in the app language (food namespace, English fallback while it is not translated). */
const presetLabel = (p) => t(p.labelKey);

export async function mountFoodImport(container) {
  ensureCss();
  const now = today();
  const state = {
    text: '', table: null, delimiter: null, hasHeader: null, presetId: 'auto', preset: null,
    mapping: {}, dateOrder: 'dmy', dateOrderAmbiguous: false, decimal: 'dot', decimalConfidence: 'high', decimalReason: '', energy: null, sodiumToSalt: true,
    mealMap: {}, defaultMeal: 'snack', result: null, summary: null, policy: 'skip', busy: false, done: null,
  };

  const textarea = el('textarea', { class: 'textarea imp-text', rows: '5', spellcheck: 'false', 'aria-label': t('import.food.textLabel'), placeholder: t('import.food.placeholder') });
  const setup = el('div', { class: 'stack' });
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.classList.add('imp-view');
  container.append(
    pageHeader({ title: t('import.food.title'), back: 'import' }),
    el('section', { class: 'section' }, sectionHeader(t('import.food.step1')), el('div', { class: 'card stack' },
      el('p', { class: 't-sub' }, t('import.food.lead')),
      el('details', { class: 'imp-example' }, el('summary', null, el('span', null, t('import.food.where')), icon('chevron-down', { size: 18, class: 'imp-chev' })),
        el('ul', { class: 't-sub imp-help' },
          el('li', null, t('import.food.helpMfp')),
          el('li', null, t('import.food.helpCronometer')),
          el('li', null, t('import.food.helpFddb')),
          el('li', null, t('import.food.helpYazio')))),
      el('p', { class: 't-sub muted' }, t('import.food.notAffiliated')),
      exampleBox(t('import.food.exampleTitle'), EXAMPLE),
      filePicker({ label: t('import.food.pickCsv'), onText: (text) => { textarea.value = ''; load(text); }, onError: (e) => toast(e.message, { type: 'error' }) }),
      textarea,
      el('button', { type: 'button', class: 'btn btn-block', onClick: () => { if (textarea.value.trim()) load(textarea.value); else toast(t('import.food.pickOrPaste'), { type: 'error' }); } }, t('import.food.readPasted')))),
    setup, preview);

  async function load(text, keep = false) {
    state.text = text;
    if (!keep) { state.delimiter = null; state.hasHeader = null; state.presetId = 'auto'; }
    state.result = null; state.done = null;
    preview.replaceChildren();
    try {
      state.table = await runParser('readTable', text, { delimiter: state.delimiter, hasHeader: state.hasHeader });
    } catch (err) {
      console.error(err);
      toast(t('import.food.readFileFailed', { error: err.message }), { type: 'error', duration: 8000 });
      return;
    }
    state.delimiter = state.table.delimiter;
    state.hasHeader = state.table.hasHeader;
    applyPreset();
    renderSetup();
    setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function applyPreset() {
    const headers = state.table.headers;
    state.preset = state.presetId === 'auto' ? (state.table.hasHeader ? detectPreset(headers) : null)
      : PRESETS.find((p) => p.id === state.presetId) || null;
    state.mapping = state.preset ? presetMapping(state.preset, headers) : (state.table.hasHeader ? guessMapping(headers) : {});
    const f = detectFormats(state.table, state.mapping);
    state.dateOrder = f.dateOrder;
    state.dateOrderAmbiguous = f.dateOrderAmbiguous;
    state.decimal = f.decimal;
    state.decimalConfidence = f.decimalConfidence;
    state.decimalReason = f.decimalReason;
    state.energy = state.mapping.kcal !== undefined ? 'kcal' : state.mapping.kj !== undefined ? 'kj' : null;
    resetMeals();
  }

  function resetMeals() {
    state.mealMap = {};
    for (const m of mealValues(state.table, state.mapping)) state.mealMap[m.value] = guessMeal(m.value) || state.defaultMeal;
  }

  function select(options, value, onChange, label) {
    const s = el('select', { class: 'select', 'aria-label': label, onChange: () => onChange(s.value) },
      options.map(([v, text]) => el('option', { value: v, selected: String(v) === String(value) }, text)));
    return s;
  }

  function renderSetup() {
    const tb = state.table;
    if (!tb) { setup.replaceChildren(); return; }
    if (!tb.rows.length) { setup.replaceChildren(el('section', { class: 'card imp-fatal' }, el('p', { class: 't-sub' }, t('import.food.noRows')))); return; }
    const colName = (h, i) => h || t('import.food.column', { n: i + 1 });
    const colOption = (h, i) => {
      const v = tb.rows.slice(0, 20).map((r) => r.cells[i]).find((x) => x);
      return v ? t('import.food.colOption', { name: colName(h, i), value: String(v).slice(0, 24) }) : colName(h, i);
    };
    const colOptions = [['', t('import.food.notInFile')], ...tb.headers.map((h, i) => [String(i), colOption(h, i)])];
    const presetNote = state.preset
      ? el('p', { class: ['t-sub', state.preset.status === 'unconfirmed' ? 'text-warning' : 'muted'] }, joinSentences([
        t(state.presetId === 'auto' ? 'import.food.presetRecognised' : 'import.food.presetChosen', { label: presetLabel(state.preset) }),
        state.preset.status === 'unconfirmed' ? null : t('import.food.presetConfirmed'),
        t(state.preset.noteKey)]))
      : el('p', { class: 't-sub muted' }, t('import.food.layoutUnknown'));

    const nodes = [
      sectionHeader(t('import.food.step2'), { trail: t('import.food.fileTrail', { rows: countOf('rows', tb.rows.length), columns: countOf('columns', tb.columnCount) }) }),
      el('section', { class: 'card stack' },
        el('div', { class: 'grid-2' },
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.food.separatedBy')),
            select(delims(), state.delimiter, (v) => { state.delimiter = v; load(state.text, true); }, t('import.food.separatorAria'))),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.food.firstRow')),
            select([['1', t('import.food.firstRowNames')], ['0', t('import.food.firstRowData')]], state.hasHeader ? '1' : '0', (v) => { state.hasHeader = v === '1'; load(state.text, true); }, t('import.food.firstRow'))),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, t(state.decimalConfidence !== 'high' ? 'import.food.numbersCheck' : 'import.food.numbers')),
            select(numberStyles(), state.decimal, (v) => { state.decimal = v; state.decimalConfidence = 'high'; invalidate(); }, t('import.food.numberStyle'))),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, t(state.dateOrderAmbiguous ? 'import.food.datesCheck' : 'import.food.dates')),
            select([['dmy', t('import.food.dmy')], ['mdy', t('import.food.mdy')]], state.dateOrder, (v) => { state.dateOrder = v; invalidate(); }, t('import.food.dateOrder')))),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.food.appLayout')),
          select([['auto', t('import.food.presetAuto')], ['none', t('import.food.presetNone')], ...PRESETS.map((p) => [p.id, p.status === 'unconfirmed' ? t('import.food.presetUnconfirmed', { label: presetLabel(p) }) : presetLabel(p)])],
            state.presetId, (v) => { state.presetId = v; applyPreset(); renderSetup(); preview.replaceChildren(); }, t('import.food.appLayout'))),
        presetNote,
        state.decimalConfidence !== 'high' ? el('p', { class: 't-sub text-warning' }, t(state.decimalConfidence === 'low' ? 'import.food.styleLow' : 'import.food.styleMedium', { style: styleLabel(state.decimal) })) : null),
      sectionHeader(t('import.food.columns')),
      el('section', { class: 'card stack imp-mapping' }, FOOD_FIELDS.map((f) => el('div', { class: ['field', f.required && state.mapping[f.id] === undefined && !(f.id === 'kcal' && state.mapping.kj !== undefined) ? 'is-missing' : null] },
        el('span', { class: 'field-label' }, f.required ? t(f.id === 'kcal' ? 'import.food.requiredOrKj' : 'import.food.required', { label: t(f.labelKey) }) : t(f.labelKey)),
        select(colOptions, state.mapping[f.id] === undefined ? '' : String(state.mapping[f.id]), (v) => {
          if (v === '') delete state.mapping[f.id]; else state.mapping[f.id] = Number(v);
          if (f.id === 'meal') resetMeals();
          if (f.id === 'kcal' || f.id === 'kj') state.energy = state.mapping.kcal !== undefined ? 'kcal' : state.mapping.kj !== undefined ? 'kj' : null;
          renderSetup(); preview.replaceChildren();
        }, t(f.labelKey))))),
    ];

    const extra = [];
    if (state.mapping.kcal !== undefined && state.mapping.kj !== undefined) {
      extra.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.food.energyFrom')),
        select([['kcal', t('import.food.kcalColumn')], ['kj', t('import.food.kjColumn')]], state.energy, (v) => { state.energy = v; invalidate(); }, t('import.food.energyFrom'))));
    }
    if (state.mapping.sodium !== undefined && state.mapping.salt === undefined) {
      const cb = el('input', { type: 'checkbox', checked: state.sodiumToSalt, onChange: () => { state.sodiumToSalt = cb.checked; invalidate(); } });
      extra.push(el('label', { class: 'imp-check' }, cb, el('span', null, t('import.food.sodiumToSalt'))));
    }
    const mealOpts = MEALS.map((m) => [m.id, mealName(m.id)]);
    extra.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, t(state.mapping.meal === undefined ? 'import.food.allIn' : 'import.food.noMealTo')),
      select(mealOpts, state.defaultMeal, (v) => { state.defaultMeal = v; invalidate(); }, t('import.food.defaultMeal'))));
    nodes.push(el('section', { class: 'card stack' }, extra));

    if (state.mapping.meal !== undefined) {
      const vals = mealValues(tb, state.mapping).filter((m) => m.value);
      nodes.push(sectionHeader(t('import.food.mealsInFile')));
      nodes.push(el('section', { class: 'card stack imp-meals' }, vals.slice(0, 40).map((m) => el('div', { class: 'field' },
        el('span', { class: 'field-label' }, t('import.food.mealRow', { value: m.value, count: m.count })),
        select([...mealOpts, ['skip', t('import.food.skipRows')]], state.mealMap[m.value] || state.defaultMeal, (v) => { state.mealMap[m.value] = v; invalidate(); }, t('import.food.mealFor', { value: m.value })))),
      vals.length > 40 ? el('p', { class: 't-sub muted' }, t('import.food.moreMeals', { count: vals.length - 40 })) : null));
    }

    const missing = mappingProblems();
    nodes.push(el('section', { class: 'card stack' },
      missing.length ? el('ul', { class: 'imp-problems text-danger t-sub' }, missing.map((x) => el('li', null, x))) : null,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: missing.length > 0, onClick: (e) => buildPreview(e.currentTarget) }, t('import.showPreview'))));
    setup.replaceChildren(...nodes);
  }

  function mappingProblems() {
    const out = [];
    if (state.mapping.date === undefined) out.push(t('import.food.chooseDate'));
    if (state.mapping.kcal === undefined && state.mapping.kj === undefined) out.push(t('import.food.chooseEnergy'));
    return out;
  }

  function invalidate() {
    state.result = null;
    preview.replaceChildren();
  }

  async function buildPreview(btn = null) {
    if (btn) { btn.disabled = true; btn.textContent = t('import.reading'); }
    try {
      state.result = await runParser('buildFoodRows', state.table, {
        mapping: state.mapping, dateOrder: state.dateOrder, decimal: state.decimal, mealMap: state.mealMap,
        defaultMeal: state.defaultMeal, energy: state.energy, sodiumToSalt: state.sodiumToSalt, today: now,
      });
      const dates = state.result.entries.map((e) => e.date).sort();
      const existingDays = dates.length
        ? new Set((await db.range('diary', 'date', { lower: dates[0], upper: dates[dates.length - 1] })).map((e) => e.date))
        : new Set();
      state.summary = summariseFood(state.result.entries, existingDays);
      renderPreview();
      if (btn) preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast(t('import.food.previewFailed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = t('import.showPreview'); }
    }
  }

  function renderPreview() {
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    const r = state.result;
    const s = state.summary;
    if (!r) { preview.replaceChildren(); return; }
    const nodes = [sectionHeader(t('import.food.step3'))];
    nodes.push(el('section', { class: 'card stack' }, s.entries
      ? [el('div', { class: 'tiles' },
        statTile({ label: t('import.food.tileDays'), value: String(s.days) }), statTile({ label: t('import.food.tileEntries'), value: String(s.entries) }),
        statTile({ label: t('import.food.tileMedian'), value: fmtGrouped(s.kcalMedian), unit: 'kcal' })),
      el('p', { class: 't-sub muted' }, t('import.food.rangeLine', { range: dateRangeY(s.from, s.to), min: fmtGrouped(s.kcalMin), max: fmtGrouped(s.kcalMax) }))]
      : el('p', { class: 'text-danger' }, t('import.food.noRow'))));
    for (const w of s.warnings || []) nodes.push(el('p', { class: 't-sub text-warning imp-note', role: 'alert' }, icon('triangle-exclamation-point', { size: 16 }), ' ', msgText(w.message)));
    // Number style can be switched here and the file is read again (ambiguous files: "1.050" / "1,050").
    nodes.push(el('section', { class: 'card stack' },
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.food.numbersAre')),
        select(numberStyles(), state.decimal, (v) => { state.decimal = v; state.decimalConfidence = 'high'; renderSetup(); buildPreview(); }, t('import.food.numberStyle'))),
      el('p', { class: 't-sub muted' }, state.decimal === 'comma'
        ? '"1.050" = 1050 · "9,5" = 9.5'
        : '"1,050" = 1050 · "9.5" = 9.5')));
    nodes.push(issueList(r.skipped.map((x) => ({ line: x.line, message: x.reason, level: 'error' })), { title: t('import.food.skippedTitle', { count: r.skipped.length }) }));

    if (s.conflictDays.length) {
      const radio = (value, label) => el('label', { class: 'imp-check' },
        el('input', { type: 'radio', name: 'imp-food-policy', value, checked: state.policy === value, onChange: () => { state.policy = value; renderPreview(); } }),
        el('span', null, label));
      nodes.push(el('section', { class: 'card stack imp-conflicts' },
        el('h3', { class: 'card-title' }, t('import.food.conflictTitle', { count: s.conflictDays.length })),
        el('p', { class: 't-sub muted' }, s.conflictDays.slice(0, 30).map(dateY).join(t('import.sep.names')) + (s.conflictDays.length > 30 ? `${t('import.sep.names')}…` : '')),
        radio('skip', t('import.food.skipDays')),
        radio('add', t('import.food.addDays'))));
    }
    if (s.entries) {
      const days = [...s.perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      nodes.push(el('details', { class: 'card imp-all' }, el('summary', null, el('span', null, t('import.food.perDay', { n: days.length })), icon('chevron-down', { size: 18, class: 'imp-chev' })),
        el('ul', { class: 'imp-plain t-sub' }, days.map(([d, k]) => el('li', null, t(!s.conflictDays.includes(d) ? 'import.food.dayRow' : state.policy === 'skip' ? 'import.food.dayRowSkipped' : 'import.food.dayRowAdded', { date: dateY(d), kcal: fmtGrouped(k) }))))));
    }
    const skip = state.policy === 'skip' ? new Set(s.conflictDays) : new Set();
    const n = r.entries.filter((e) => !skip.has(e.date)).length;
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: n === 0 || state.busy, onClick: () => confirm(btn, skip) },
      n ? t('import.food.importBtn', { count: n }) : t('import.food.nothing'));
    nodes.push(sectionHeader(t('import.food.step4')), el('section', { class: 'card stack imp-confirm' }, el('p', { class: 't-sub muted' }, t('import.food.savedAs')), btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  async function confirm(btn, skipDays) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = t('import.saving');
    try {
      const runId = crypto.randomUUID();
      const records = toDiaryRecords(state.result.entries, { importId: runId, now: Date.now(), newId: () => crypto.randomUUID(), skipDays });
      const days = [...new Set(records.map((x) => x.date))].sort();
      const source = state.preset ? presetLabel(state.preset).split(' – ')[0] : 'CSV'; // i18n-ignore (format name)
      const info = { entries: records.length, days: days.length, from: days[0] || null, to: days[days.length - 1] || null, source };
      await commitRun({
        id: runId, type: 'food', info,
        counts: { diary: records.length, days: days.length },
        writes: [{ store: 'diary', records }],
      }, (done, total) => { btn.textContent = t('import.savingProgress', { done, total }); });
      state.done = { count: records.length, days: days.length, first: days[0] };
      toast(t('import.food.importedToast', { count: records.length }), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('import.failed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      renderPreview();
    }
  }

  function doneCard() {
    const d = state.done;
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'imp-card-head imp-ok' }, icon('circle-check', { size: 18 }), el('h3', { class: 'card-title' }, t('import.finished'))),
      el('p', { class: 't-sub' }, t('import.food.doneText', { entries: countOf('entries', d.count), days: countOf('days', d.days) })),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href(`diary/${d.first}`) }, t('import.food.openFirst')),
        el('a', { class: 'btn', href: href('import') }, t('import.undoPage'))));
  }
}
