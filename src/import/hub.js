// Import hub: the three importers and the list of past imports with Undo.
import { el, pageHeader, href, confirmDialog, toast, fmtDate, icon, sectionHeader, tag } from '../ui/index.js';
import { fromTimestamp } from '../core/dates.js';
import { ensureCss, loadRuns, undoRun, plural, runSummary } from './shared.js';

const TYPE_LABEL = { workouts: 'Workouts', weights: 'Body weight', food: 'Food diary' };

export async function mountHub(container) {
  ensureCss();
  container.classList.add('imp-view');
  const runsBox = el('div', { class: 'card card-flush' });
  container.append(
    pageHeader({ title: 'Import data', subtitle: 'Preview first. Every import can be undone below.', back: 'settings' }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      item('import/workouts', 'barbell', 'Workouts from a spreadsheet', 'Pasted sheet or a .txt / .csv file'),
      item('import/weights', 'scale', 'Body weight', 'Date and kg per line'),
      item('import/food', 'utensils', 'Food diary', 'CSV from MyFitnessPal, Cronometer, FDDB'))),
    el('section', { class: 'section' }, sectionHeader('Past imports'), runsBox));

  async function render() {
    const runs = await loadRuns();
    if (!runs.length) { runsBox.replaceChildren(el('p', { class: 't-sub muted imp-none' }, 'No imports yet.')); return; }
    runsBox.replaceChildren(el('div', { class: 'list' }, runs.map((r) => runRow(r))));
  }

  function runRow(r) {
    const when = `${fmtDate(fromTimestamp(r.createdAt))} ${new Date(r.createdAt).toTimeString().slice(0, 5)}`;
    const status = r.status === 'undone' ? tag('Undone')
      : r.status === 'done' ? null : tag('Not finished', { tone: 'warn' });
    const btn = r.status === 'undone' ? null : el('button', {
      type: 'button', class: 'btn btn-sm btn-danger imp-undo', 'aria-label': `Undo this import: ${runSummary(r)}`, onClick: async () => {
        const ok = await confirmDialog({
          title: 'Undo this import?',
          message: `Removes ${runSummary(r)}. Your own entries stay.`,
          confirmLabel: 'Undo import', danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          const res = await undoRun(r.id);
          const n = Object.values(res.removed).reduce((a, b) => a + b, 0);
          toast(`Import undone: ${plural(n, 'record')} removed${res.restored ? `, ${res.restored} earlier weights restored` : ''}${res.keptExercises ? `, ${plural(res.keptExercises, 'exercise')} kept because they are in use` : ''}.`, { type: 'success' });
        } catch (err) {
          console.error(err);
          toast(`Undo failed: ${err.message}`, { type: 'error' });
        }
        render();
      },
    }, icon('undo-2', { size: 18 }), 'Undo');
    return el('div', { class: 'list-item imp-run', dataset: { run: r.id } },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title imp-run-title' }, TYPE_LABEL[r.type] || r.type, status),
        el('div', { class: 'li-sub imp-wrap' }, `${when} · ${runSummary(r)}`)),
      btn);
  }

  await render();
}

function item(path, iconName, title, sub) {
  return el('a', { class: 'list-item', href: href(path) },
    el('span', { class: 'li-lead' }, icon(iconName)),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), el('div', { class: 'li-sub' }, sub)),
    icon('chevron-right', { class: 'li-chevron' }));
}
