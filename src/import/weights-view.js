// Import body-weight history: paste/file → preview with flags and conflicts → confirm.
import * as db from '../db/db.js';
import { el, pageHeader, toast, href, fmtKg, sectionHeader, statTile, icon, joinSentences } from '../ui/index.js';
import { today } from '../core/dates.js';
import { analyseWeights, planWeights, MIN_KG, MAX_KG } from '../core/import-weights.js';
import { t } from '../i18n/index.js';
import { ensureCss, runParser, filePicker, exampleBox, issueList, commitRun, dateY, dateRangeY, msgText } from './shared.js';

// i18n-ignore-next-line (sample file content)
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

  const textarea = el('textarea', { class: 'textarea imp-text', rows: '8', spellcheck: 'false', 'aria-label': t('import.weights.textLabel'), placeholder: t('import.weights.placeholder') });
  const readBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: () => read() }, t('import.showPreview'));
  const preview = el('div', { class: 'stack imp-preview', 'aria-live': 'polite' });

  container.classList.add('imp-view');
  container.append(
    pageHeader({ title: t('import.weights.title'), back: 'import', info: 'import-weights' }),
    el('section', { class: 'section' }, sectionHeader(t('import.step1Paste')),
      el('div', { class: 'card stack' },
        el('p', { class: 't-sub' }, t('import.weights.lead')),
        el('p', { class: 't-sub muted' }, t('import.weights.kgOnly')),
        exampleBox(t('import.exampleTitle'), EXAMPLE),
        textarea,
        el('div', { class: 'imp-actions' },
          filePicker({ label: t('import.pickFile'), onText: (text) => { textarea.value = text; read(); }, onError: (e) => toast(e.message, { type: 'error' }) }),
          readBtn))),
    preview);

  async function read() {
    if (!textarea.value.trim()) { toast(t('import.weights.pasteFirst'), { type: 'error' }); return; }
    readBtn.disabled = true;
    readBtn.textContent = t('import.reading');
    state.done = null;
    try {
      state.parsed = await runParser('parseWeightText', textarea.value, { today: now, dateOrder: state.dateOrder });
      existing = new Map((await db.getAll('weights')).map((w) => [w.date, w]));
      state.analysis = analyseWeights(state.parsed.rows, { today: now, existing: new Map([...existing].map(([d, w]) => [d, w.kg])) });
      render();
      preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error(err);
      toast(t('import.readFailed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      readBtn.disabled = false;
      readBtn.textContent = t('import.showPreview');
    }
  }

  function render() {
    const p = state.parsed;
    const a = state.analysis;
    if (!p) { preview.replaceChildren(); return; }
    if (state.done) { preview.replaceChildren(doneCard()); return; }
    if (p.fatal) {
      preview.replaceChildren(el('section', { class: 'card imp-fatal', role: 'alert' }, el('div', { class: 'imp-card-head' }, icon('triangle-exclamation-point', { size: 18 }), el('h3', { class: 'card-title' }, t('import.cannotImport'))), el('p', { class: 't-sub' }, msgText(p.fatal))));
      return;
    }
    const nodes = [sectionHeader(t('import.step2Preview'))];
    nodes.push(el('section', { class: 'card stack' },
      a.count
        ? [el('div', { class: 'tiles' },
          statTile({ label: t('import.weights.tileCount'), value: String(a.count) }),
          statTile({ label: t('import.weights.tileLow'), value: fmtKg(a.min).replace(' kg', ''), unit: 'kg' }),
          statTile({ label: t('import.weights.tileHigh'), value: fmtKg(a.max).replace(' kg', ''), unit: 'kg' })),
        el('p', { class: 't-sub muted' }, dateRangeY(a.from, a.to))]
        : el('p', { class: 'text-danger' }, t('import.weights.none'))));
    for (const n of p.notes || []) nodes.push(el('p', { class: ['t-sub', 'imp-note', /guessNote/.test(n.key || '') ? 'text-warning' : 'muted'] }, msgText(n)));
    nodes.push(issueList(p.issues, { title: p.issues.some((i) => i.level !== 'info') ? t('import.issues.unreadable') : t('import.issues.notes') }));
    if (a.flagged.length) {
      nodes.push(issueList(a.flagged.map((f) => ({ line: f.line, text: `${f.date}  ${f.kg} kg`, message: f.reason, level: 'warning' })), { title: t('import.weights.flaggedTitle', { count: a.flagged.length, min: MIN_KG, max: MAX_KG }) }));
    }
    if (p.dateOrderAmbiguous || state.dateOrder !== 'auto') {
      const sel = el('select', { class: 'select', onChange: () => { state.dateOrder = sel.value; read(); } },
        el('option', { value: 'dmy', selected: p.dateOrder === 'dmy' }, t('import.weights.dmy')),
        el('option', { value: 'mdy', selected: p.dateOrder === 'mdy' }, t('import.weights.mdy')));
      sel.setAttribute('aria-label', t('import.dateOrderLabel'));
      nodes.push(el('section', { class: 'card' }, el('div', { class: 'field' }, el('span', { class: 'field-label' }, t('import.dateOrderLabel')), sel)));
    }
    if (a.conflicts.length) {
      const radio = (value, label) => {
        const r = el('input', { type: 'radio', name: 'imp-policy', value, checked: state.policy === value, onChange: () => { state.policy = value; render(); } });
        return el('label', { class: 'imp-check' }, r, el('span', null, label));
      };
      nodes.push(el('section', { class: 'card stack imp-conflicts' },
        el('h3', { class: 'card-title' }, t('import.weights.conflictTitle', { count: a.conflicts.length })),
        el('ul', { class: 'imp-plain t-sub' }, a.conflicts.slice(0, 50).map((c) => el('li', { class: 'num' }, t('import.weights.conflictRow', { date: dateY(c.date), saved: fmtKg(c.existingKg), file: fmtKg(c.kg), line: c.line })))),
        radio('keep', t('import.weights.keep')),
        radio('replace', t('import.weights.replace'))));
    }
    if (a.count) {
      nodes.push(el('details', { class: 'card imp-all' }, el('summary', null, el('span', null, t('import.weights.all', { count: a.count })), icon('chevron-down', { size: 18, class: 'imp-chev' })),
        el('ul', { class: 'imp-plain t-sub' }, a.valid.map((r) => el('li', null, t('import.listRow', { label: dateY(r.date), value: fmtKg(r.kg) }))))));
    }
    const writes = a.count - (state.policy === 'keep' ? a.conflicts.length : 0);
    const btn = el('button', { type: 'button', class: 'btn btn-primary btn-block', disabled: writes <= 0 || state.busy, onClick: () => confirm(btn) },
      writes > 0 ? t('import.weights.importBtn', { count: writes }) : t('import.nothingNew'));
    nodes.push(sectionHeader(t('import.step3Import')), el('section', { class: 'card stack imp-confirm' }, el('p', { class: 't-sub muted' }, t('import.undoHint')), btn));
    preview.replaceChildren(...nodes.filter(Boolean));
  }

  async function confirm(btn) {
    if (state.busy) return;
    state.busy = true;
    btn.disabled = true;
    btn.textContent = t('import.saving');
    try {
      const runId = crypto.randomUUID();
      // Re-read the stored weights right before writing (another tab may have added one).
      existing = new Map((await db.getAll('weights')).map((w) => [w.date, w]));
      const plan = planWeights(state.analysis.valid, { policy: state.policy, existing, importId: runId, now: Date.now() });
      const dates = plan.records.map((r) => r.date).sort();
      const info = { weighIns: plan.records.length, replaced: plan.replaced.length, from: dates[0] || null, to: dates[dates.length - 1] || null };
      await commitRun({
        id: runId, type: 'weights', info,
        counts: { weights: plan.records.length, replaced: plan.replaced.length },
        writes: [{ store: 'weights', records: plan.records }],
        replaced: { weights: plan.replaced },
      });
      state.done = { count: plan.records.length, kept: plan.keptExisting, replaced: plan.replaced.length };
      toast(t('import.weights.importedToast', { count: plan.records.length }), { type: 'success' });
    } catch (err) {
      console.error(err);
      toast(t('import.failed', { error: err.message }), { type: 'error', duration: 8000 });
    } finally {
      state.busy = false;
      render();
    }
  }

  function doneCard() {
    const d = state.done;
    return el('section', { class: 'card stack imp-done', role: 'status' },
      el('div', { class: 'imp-card-head imp-ok' }, icon('circle-check', { size: 18 }), el('h3', { class: 'card-title' }, t('import.finished'))),
      el('p', { class: 't-sub' }, joinSentences([t('import.weights.doneSaved', { count: d.count }),
        d.replaced ? t('import.weights.doneReplaced', { count: d.replaced }) : null,
        d.kept ? t('import.weights.doneKept', { count: d.kept }) : null])),
      el('div', { class: 'row imp-row-wrap' },
        el('a', { class: 'btn btn-primary', href: href('trends/weight') }, t('import.weights.openTrend')),
        el('a', { class: 'btn', href: href('import') }, t('import.undoPage'))));
  }
}

