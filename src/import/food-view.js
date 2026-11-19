// Import food diary history from a CSV/TSV export: file → detected format → column mapping
// (presets for documented exports) → meal names → preview → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, href, fmtNum } from '../ui/index.js';
import { today } from '../core/dates.js';
import {
  FOOD_FIELDS, PRESETS, guessMapping, detectPreset, presetMapping, detectFormats, mealValues, guessMeal,
  summariseFood, toDiaryRecords,
} from '../core/import-food.js';
import { MEALS } from '../core/food-diary.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, plural, commitRun, dateY } from './shared.js';

const EXAMPLE = `Date;Meal;Food;Amount;kcal;Protein;Carbs;Fat
12.11.2026;Breakfast;Oats with milk;250;380;16;55;9,5
12.11.2026;Lunch;Pasta;350;620;24;98;12
13.11.2026;Dinner;"Pizza; salami";;850;35;90;38`;

/** Number styles: the value is the decimal mark (import-common.parseNumber). */
const NUMBER_STYLES = [['comma', '1.234,5 (decimal comma)'], ['dot', '1,234.5 (decimal dot)']];
const styleLabel = (d) => (d === 'comma' ? '"1.234,5"' : '"1,234.5"');

const DELIMS = [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']];

export async function mountFoodImport(container) {
  ensureCss();
  const now = today();
  const state = {
    text: '', table: null, delimiter: null, hasHeader: null, presetId: 'auto', preset: null,
    mapping: {}, dateOrder: 'dmy', dateOrderAmbiguous: false, decimal: 'dot', decimalConfidence: 'high', decimalReason: '', energy: null, sodiumToSalt: true,
    mealMap: {}, defaultMeal: 'snack', result: null, summary: null, policy: 'skip', busy: false, done: null,
  };

  const textarea = el('textarea', { class: 'textarea imp-text', rows: '5', spellcheck: 'false', 'aria-label': 'CSV text', placeholder: 'Or paste the file contents here' });
  const setup = el('div', { class: 'stack' });
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.append(
    pageHeader({ title: 'Import food diary', back: 'import' }),
    el('section', { class: 'card stack' },
      el('p', null, 'Pick the CSV file you exported from your old app (or any spreadsheet saved as CSV). Each row becomes one quick-add entry with its calories and macros.'),
      el('details', { class: 'imp-example' }, el('summary', null, 'Where do I get the file?'),
        el('ul', { class: 'small imp-help' },
          el('li', null, 'MyFitnessPal (Premium): Reports or More → Export → choose dates. You get a zip by email; use the "Nutrition Summary" CSV inside. It has one row per meal per day, not single foods.'),
          el('li', null, 'Cronometer (free): on the website, More → Account → Account Data → Export Data. "Servings" has single foods; "Daily Nutrition" has day totals.'),
          el('li', null, 'FDDB (free, website only): My Fddb → Account → Manage content and data → Export food diary. Our layout for this file is not confirmed by FDDB; check the preview.'),
          el('li', null, 'Yazio has no export of its own at the moment (only a data request to their support). If you get a CSV from them, use the column mapping.'))),
      exampleBox('Example of a simple CSV', EXAMPLE),
      filePicker({ label: 'Pick a CSV file', onText: (t) => { textarea.value = ''; load(t); }, onError: (e) => toast(e.message, { type: 'error' }) }),
      textarea,
      el('button', { type: 'button', class: 'btn btn-block', onClick: () => { if (textarea.value.trim()) load(textarea.value); else toast('Pick a file or paste its contents', { type: 'error' }); } }, 'Read pasted text')),
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
      toast(`Could not read the file: ${err.message}`, { type: 'error' });
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
      options.map(([v, t]) => el('option', { value: v, selected: String(v) === String(value) }, t)));
    return s;
  }

  function renderSetup() {
    const t = state.table;
    if (!t) { setup.replaceChildren(); return; }
    if (!t.rows.length) { setup.replaceChildren(el('section', { class: 'card imp-fatal' }, el('p', null, 'The file has no data rows.'))); return; }
    const sample = (i) => {
      const v = t.rows.slice(0, 20).map((r) => r.cells[i]).find((x) => x);
      return v ? ` (e.g. ${String(v).slice(0, 24)})` : '';
    };
    const colOptions = [['', '— not in file —'], ...t.headers.map((h, i) => [String(i), `${h}${sample(i)}`])];
    const presetNote = state.preset
      ? el('p', { class: ['small', state.preset.status === 'unconfirmed' ? 'text-warning' : 'muted'] },
        `${state.preset.label}${state.presetId === 'auto' ? ' (recognised from the column names)' : ''}. ${state.preset.status === 'unconfirmed' ? 'Unconfirmed layout. ' : 'Layout confirmed from real export files. '}${state.preset.note}`)
      : el('p', { class: 'small muted' }, 'No known app layout recognised. Map the columns yourself below.');

    const nodes = [
      el('h2', { class: 'section-title' }, 'File'),
      el('section', { class: 'card stack' },
        el('p', { class: 'small muted' }, `${plural(t.rows.length, 'data row')}, ${plural(t.columnCount, 'column')}.`),
        el('div', { class: 'grid-2' },
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Columns separated by'),
            select(DELIMS, state.delimiter, (v) => { state.delimiter = v; load(state.text, true); }, 'Column separator')),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'First row'),
            select([['1', 'Column names'], ['0', 'Data']], state.hasHeader ? '1' : '0', (v) => { state.hasHeader = v === '1'; load(state.text, true); }, 'First row')),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, `Numbers${state.decimalConfidence !== 'high' ? ' (please check)' : ''}`),
            select(NUMBER_STYLES, state.decimal, (v) => { state.decimal = v; state.decimalConfidence = 'high'; invalidate(); }, 'Number style')),
          el('div', { class: 'field' }, el('span', { class: 'field-label' }, `Dates${state.dateOrderAmbiguous ? ' (please check)' : ''}`),
            select([['dmy', 'Day first (12/11)'], ['mdy', 'Month first (11/12)']], state.dateOrder, (v) => { state.dateOrder = v; invalidate(); }, 'Date order'))),
        el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'App layout'),
          select([['auto', 'Recognise automatically'], ['none', 'None (map columns myself)'], ...PRESETS.map((p) => [p.id, `${p.label}${p.status === 'unconfirmed' ? ' – unconfirmed' : ''}`])],
            state.presetId, (v) => { state.presetId = v; applyPreset(); renderSetup(); preview.replaceChildren(); }, 'App layout')),
        presetNote,
        state.decimalConfidence !== 'high' ? el('p', { class: 'small text-warning' }, `Number style detected as ${styleLabel(state.decimal)} with ${state.decimalConfidence} confidence${state.decimalReason ? ` (${state.decimalReason})` : ''}. Check it in the preview.`) : null),
      el('h2', { class: 'section-title' }, 'Columns'),
      el('section', { class: 'card stack imp-mapping' }, FOOD_FIELDS.map((f) => el('div', { class: ['field', f.required && state.mapping[f.id] === undefined && !(f.id === 'kcal' && state.mapping.kj !== undefined) ? 'is-missing' : null] },
        el('span', { class: 'field-label' }, `${f.label}${f.required ? (f.id === 'kcal' ? ' (required, or kJ)' : ' (required)') : ''}`),
        select(colOptions, state.mapping[f.id] === undefined ? '' : String(state.mapping[f.id]), (v) => {
          if (v === '') delete state.mapping[f.id]; else state.mapping[f.id] = Number(v);
          if (f.id === 'meal') resetMeals();
          if (f.id === 'kcal' || f.id === 'kj') state.energy = state.mapping.kcal !== undefined ? 'kcal' : state.mapping.kj !== undefined ? 'kj' : null;
          renderSetup(); preview.replaceChildren();
        }, f.label)))),
    ];

    const extra = [];
    if (state.mapping.kcal !== undefined && state.mapping.kj !== undefined) {
      extra.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Energy from'),
        select([['kcal', 'The kcal column'], ['kj', 'The kJ column (converted: kcal = kJ ÷ 4.184)']], state.energy, (v) => { state.energy = v; invalidate(); }, 'Energy from')));
    } else if (state.mapping.kj !== undefined) {
      extra.push(el('p', { class: 'small muted' }, 'Energy is read from the kJ column and converted to kcal (kJ ÷ 4.184).'));
    }
    if (state.mapping.sodium !== undefined && state.mapping.salt === undefined) {
      const cb = el('input', { type: 'checkbox', checked: state.sodiumToSalt, onChange: () => { state.sodiumToSalt = cb.checked; invalidate(); } });
      extra.push(el('label', { class: 'imp-check' }, cb, el('span', null, 'Convert sodium (mg) to salt (g): salt = sodium × 2.5 ÷ 1000')));
    }
    const mealOpts = MEALS.map((m) => [m.id, m.label]);
    extra.push(el('div', { class: 'field' }, el('span', { class: 'field-label' }, state.mapping.meal === undefined ? 'Put all entries in' : 'Rows without a meal go to'),
      select(mealOpts, state.defaultMeal, (v) => { state.defaultMeal = v; invalidate(); }, 'Default meal')));
    nodes.push(el('section', { class: 'card stack' }, extra));

    if (state.mapping.meal !== undefined) {
      const vals = mealValues(t, state.mapping).filter((m) => m.value);
      nodes.push(el('h2', { class: 'section-title' }, 'Meals in the file'));
      nodes.push(el('section', { class: 'card stack imp-meals' }, vals.slice(0, 40).map((m) => el('div', { class: 'field' },
        el('span', { class: 'field-label' }, `"${m.value}" (${plural(m.count, 'row')})`),
        select([...mealOpts, ['skip', 'Skip these rows']], state.mealMap[m.value] || state.defaultMeal, (v) => { state.mealMap[m.value] = v; invalidate(); }, `Meal for ${m.value}`))),
      vals.length > 40 ? el('p', { class: 'small muted' }, `${vals.length - 40} more meal names go to the default meal.`) : null));
    }

    const missing = mappingProblems();
    nodes.push(el('section', { class: 'card stack' },
      missing.length ? el('ul', { class: 'imp-problems text-danger small' }, missing.map((x) => el('li', null, x))) : null,
      el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: missing.length > 0, onClick: (e) => buildPreview(e.currentTarget) }, 'Show preview')));
    setup.replaceChildren(...nodes);
  }

  function mappingProblems() {
    const out = [];
    if (state.mapping.date === undefined) out.push('Choose the date column.');
    if (state.mapping.kcal === undefined && state.mapping.kj === undefined) out.push('Choose the energy column (kcal or kJ).');
    return out;
  }

  function invalidate() {
    state.result = null;
    preview.replaceChildren();
  }

  async function buildPreview(btn = null) {
    if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
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
      toast(`Could not build the preview: ${err.message}`, { type: 'error' });
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Show preview'; }
    }
  }

  function renderPreview() {
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    const r = state.result;
    const s = state.summary;
    if (!r) { preview.replaceChildren(); return; }
    const nodes = [el('h2', { class: 'section-title' }, 'Preview')];
    nodes.push(el('section', { class: 'card stack' }, s.entries
      ? el('dl', { class: 'imp-stats' },
        st('Days', String(s.days)), st('Entries', String(s.entries)),
        st('From', dateY(s.from)), st('To', dateY(s.to)),
        st('kcal/day min', fmtNum(s.kcalMin, 0)), st('median', fmtNum(s.kcalMedian, 0)), st('max', fmtNum(s.kcalMax, 0)))
      : el('p', { class: 'text-danger' }, 'No row could be used. Check the column mapping and the date and decimal settings.')));
    for (const w of s.warnings || []) nodes.push(el('p', { class: 'small text-warning' }, w.message));
    // Number style can be switched here and the file is read again (ambiguous files: "1.050" / "1,050").
    nodes.push(el('section', { class: 'card stack' },
      el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Numbers in the file are written as'),
        select(NUMBER_STYLES, state.decimal, (v) => { state.decimal = v; state.decimalConfidence = 'high'; renderSetup(); buildPreview(); }, 'Number style')),
      el('p', { class: 'small muted' }, state.decimal === 'comma'
        ? 'Read as 1.234,5: "1.050" is one thousand and fifty, "9,5" is nine and a half.'
        : 'Read as 1,234.5: "1,050" is one thousand and fifty, "9.5" is nine and a half.')));
    nodes.push(issueList(r.skipped.map((x) => ({ line: x.line, message: x.reason, level: 'error' })), { title: `${plural(r.skipped.length, 'row')} skipped` }));

    if (s.conflictDays.length) {
      const radio = (value, label) => el('label', { class: 'imp-check' },
        el('input', { type: 'radio', name: 'imp-food-policy', value, checked: state.policy === value, onChange: () => { state.policy = value; renderPreview(); } }),
        el('span', null, label));
      nodes.push(el('section', { class: 'card stack imp-conflicts' },
        el('div', { class: 'card-title' }, `${plural(s.conflictDays.length, 'day')} already ${s.conflictDays.length === 1 ? 'has' : 'have'} diary entries`),
        el('p', { class: 'small muted num' }, s.conflictDays.slice(0, 30).map(dateY).join(', ') + (s.conflictDays.length > 30 ? ', …' : '')),
        radio('skip', 'Skip those days (keep my diary as it is)'),
        radio('add', 'Add the file entries to those days as well')));
    }
    if (s.entries) {
      const days = [...s.perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      nodes.push(el('details', { class: 'card imp-all' }, el('summary', null, `kcal per day (${days.length})`),
        el('ul', { class: 'imp-plain small num' }, days.map(([d, k]) => el('li', null, `${dateY(d)}: ${fmtNum(k, 0)} kcal${s.conflictDays.includes(d) ? (state.policy === 'skip' ? ' (skipped, day has entries)' : ' (added to existing day)') : ''}`)))));
    }
    const skip = state.policy === 'skip' ? new Set(s.conflictDays) : new Set();
    const n = r.entries.filter((e) => !skip.has(e.date)).length;
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: n === 0 || state.busy, onClick: () => confirm(btn, skip) },
      n ? `Import ${plural(n, 'entry', 'entries')}` : 'Nothing to import');
    nodes.push(el('section', { class: 'card stack imp-confirm' }, el('p', { class: 'small muted' }, 'Entries are saved as quick-add items (calories and macros, no food link). The whole import can be undone from the Import page.'), btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  async function confirm(btn, skipDays) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const runId = crypto.randomUUID();
      const records = toDiaryRecords(state.result.entries, { importId: runId, now: Date.now(), newId: () => crypto.randomUUID(), skipDays });
      const days = [...new Set(records.map((x) => x.date))].sort();
      const label = state.preset ? state.preset.label.split(' – ')[0] : 'CSV';
      await commitRun({
        id: runId, type: 'food',
        summary: `${label}: ${plural(records.length, 'entry', 'entries')} on ${plural(days.length, 'day')}, ${dateY(days[0])} – ${dateY(days[days.length - 1])}`,
        counts: { diary: records.length, days: days.length },
        writes: [{ store: 'diary', records }],
      }, (done, total) => { btn.textContent = `Saving… ${done}/${total}`; });
      state.done = { count: records.length, days: days.length, first: days[0] };
      toast(`Imported ${plural(records.length, 'entry', 'entries')}`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Import failed: ${err.message}`, { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      renderPreview();
    }
  }

  function doneCard() {
    const d = state.done;
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'card-title' }, 'Import finished'),
      el('p', null, `${plural(d.count, 'entry', 'entries')} on ${plural(d.days, 'day')} saved.`),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href(`diary/${d.first}`) }, 'Open first day'),
        el('a', { class: 'btn', href: href('import') }, 'Import page (undo)')));
  }
}

function st(label, value) {
  return el('div', { class: 'imp-stat' }, el('dt', { class: 'small muted' }, label), el('dd', { class: 'num' }, value));
}
