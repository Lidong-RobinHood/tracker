// Import body-weight history: paste/file → preview with flags and conflicts → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, href, fmtKg } from '../ui/index.js';
import { today } from '../core/dates.js';
import { analyseWeights, planWeights, MIN_KG, MAX_KG } from '../core/import-weights.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, plural, commitRun, dateY } from './shared.js';

const EXAMPLE = `Datum;Gewicht
12.11.2026;82,5
13.11.2026;82,1
2026-11-14	81.9
82,0;15.11.2026`;

export async function mountWeightImport(container) {
  ensureCss();
  const now = today();
  const state = { parsed: null, analysis: null, policy: 'keep', dateOrder: 'auto', busy: false, done: null };
  let existing = new Map();

  const textarea = el('textarea', { class: 'textarea imp-text', rows: '8', spellcheck: 'false', 'aria-label': 'Weights text', placeholder: 'Paste date and weight lines here' });
  const readBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => read() }, 'Show preview');
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.append(
    pageHeader({ title: 'Import body weight', back: 'import' }),
    el('section', { class: 'card stack' },
      el('p', null, 'Copy two columns from your spreadsheet or app export: the date and your weight in kg. One weigh-in per line, in either order. Or pick a .csv/.txt file.'),
      el('ul', { class: 'small muted imp-help' },
        el('li', null, 'Dates like 12.11.2026, 2026-11-12, 12/11/26 or Mon 12 Nov.'),
        el('li', null, 'Weights like 82,5 or 82.5. Kilograms only: pounds are not supported.'),
        el('li', null, 'Columns can be separated by tab, semicolon, comma or space. A header row is fine.')),
      exampleBox('Example of the expected shape', EXAMPLE),
      textarea,
      filePicker({ label: 'Pick a file', onText: (t) => { textarea.value = t; read(); }, onError: (e) => toast(e.message, { type: 'error' }) }),
      readBtn),
    preview);

  async function read() {
    if (!textarea.value.trim()) { toast('Paste your weights first', { type: 'error' }); return; }
    readBtn.disabled = true;
    readBtn.textContent = 'Reading…';
    state.done = null;
    try {
      state.parsed = await runParser('parseWeightText', textarea.value, { today: now, dateOrder: state.dateOrder });
      existing = new Map((await db.getAll('weights')).map((w) => [w.date, w]));
      state.analysis = analyseWeights(state.parsed.rows, { today: now, existing: new Map([...existing].map(([d, w]) => [d, w.kg])) });
      render();
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast(`Could not read the text: ${err.message}`, { type: 'error', duration: 8000 });
    } finally {
      readBtn.disabled = false;
      readBtn.textContent = 'Show preview';
    }
  }

  function render() {
    const p = state.parsed;
    const a = state.analysis;
    if (!p) { preview.replaceChildren(); return; }
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    if (p.fatal) {
      preview.replaceChildren(el('section', { class: 'card imp-fatal', role: 'alert' }, el('div', { class: 'card-title' }, 'This cannot be imported'), el('p', null, p.fatal)));
      return;
    }
    const nodes = [el('h2', { class: 'section-title' }, 'Preview')];
    nodes.push(el('section', { class: 'card stack' },
      a.count
        ? el('dl', { class: 'imp-stats' },
          stat('Weigh-ins', String(a.count)),
          stat('From', dateY(a.from)), stat('To', dateY(a.to)),
          stat('Lowest', fmtKg(a.min)), stat('Highest', fmtKg(a.max)))
        : el('p', { class: 'text-danger' }, 'No usable weigh-in found.')));
    for (const n of p.notes || []) nodes.push(el('p', { class: ['small', /^Guess/.test(n) ? 'text-warning' : 'muted'] }, n));
    nodes.push(issueList(p.issues, { title: p.issues.some((i) => i.level !== 'info') ? 'Lines that could not be read' : 'Notes' }));
    if (a.flagged.length) {
      nodes.push(issueList(a.flagged.map((f) => ({ line: f.line, text: `${f.date}  ${f.kg} kg`, message: f.reason, level: 'warning' })), { title: `${plural(a.flagged.length, 'value')} left out (plausible range ${MIN_KG}–${MAX_KG} kg, no future dates, one value per day)` }));
    }
    if (p.dateOrderAmbiguous || state.dateOrder !== 'auto') {
      const sel = el('select', { class: 'select', onChange: () => { state.dateOrder = sel.value; read(); } },
        el('option', { value: 'dmy', selected: p.dateOrder === 'dmy' }, 'Day/month (05/06 = 5 June)'),
        el('option', { value: 'mdy', selected: p.dateOrder === 'mdy' }, 'Month/day (05/06 = 6 May)'));
      nodes.push(el('section', { class: 'card' }, el('div', { class: 'field' }, el('span', { class: 'field-label' }, 'Dates like 05/06/26 are'), sel)));
    }
    if (a.conflicts.length) {
      const radio = (value, label) => {
        const r = el('input', { type: 'radio', name: 'imp-policy', value, checked: state.policy === value, onChange: () => { state.policy = value; render(); } });
        return el('label', { class: 'imp-check' }, r, el('span', null, label));
      };
      nodes.push(el('section', { class: 'card stack imp-conflicts' },
        el('div', { class: 'card-title' }, `${plural(a.conflicts.length, 'day')} already ${a.conflicts.length === 1 ? 'has' : 'have'} a weight`),
        el('ul', { class: 'imp-plain small' }, a.conflicts.slice(0, 50).map((c) => el('li', { class: 'num' }, `${dateY(c.date)}: saved ${fmtKg(c.existingKg)}, file ${fmtKg(c.kg)} (line ${c.line})`))),
        radio('keep', 'Keep my saved weights'),
        radio('replace', 'Replace them with the file (undo puts them back)')));
    }
    if (a.count) {
      nodes.push(el('details', { class: 'card imp-all' }, el('summary', null, `All ${plural(a.count, 'weigh-in')}`),
        el('ul', { class: 'imp-plain small num' }, a.valid.map((r) => el('li', null, `${dateY(r.date)}: ${fmtKg(r.kg)}`)))));
    }
    const writes = a.count - (state.policy === 'keep' ? a.conflicts.length : 0);
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: writes <= 0 || state.busy, onClick: () => confirm(btn) },
      writes > 0 ? `Import ${plural(writes, 'weigh-in')}` : 'Nothing new to import');
    nodes.push(el('section', { class: 'card stack imp-confirm' }, btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  async function confirm(btn) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const runId = crypto.randomUUID();
      // Re-read the stored weights right before writing (another tab may have added one).
      existing = new Map((await db.getAll('weights')).map((w) => [w.date, w]));
      const plan = planWeights(state.analysis.valid, { policy: state.policy, existing, importId: runId, now: Date.now() });
      const dates = plan.records.map((r) => r.date).sort();
      await commitRun({
        id: runId, type: 'weights',
        summary: `${plural(plan.records.length, 'weigh-in')}${plan.replaced.length ? ` (${plan.replaced.length} replaced)` : ''}, ${dateY(dates[0])} – ${dateY(dates[dates.length - 1])}`,
        counts: { weights: plan.records.length, replaced: plan.replaced.length },
        writes: [{ store: 'weights', records: plan.records }],
        replaced: { weights: plan.replaced },
      });
      state.done = { count: plan.records.length, kept: plan.keptExisting, replaced: plan.replaced.length };
      toast(`Imported ${plural(plan.records.length, 'weigh-in')}`, { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(`Import failed: ${err.message}`, { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      render();
    }
  }

  function doneCard() {
    const d = state.done;
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'card-title' }, 'Import finished'),
      el('p', null, `${plural(d.count, 'weigh-in')} saved${d.replaced ? `, ${d.replaced} replaced` : ''}${d.kept ? `, ${d.kept} saved days kept` : ''}.`),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href('trends/weight') }, 'Open weight trend'),
        el('a', { class: 'btn', href: href('import') }, 'Import page (undo)')));
  }
}

function stat(label, value) {
  return el('div', { class: 'imp-stat' }, el('dt', { class: 'small muted' }, label), el('dd', { class: 'num' }, value));
}
