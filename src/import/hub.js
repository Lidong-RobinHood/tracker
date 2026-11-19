// Import hub: the three importers and the list of past imports with "Undo this import".
import { el, pageHeader, href, confirmDialog, toast, fmtDate } from '../ui/index.js';
import { fromTimestamp } from '../core/dates.js';
import { ensureCss, loadRuns, undoRun, plural, runSummary } from './shared.js';

const TYPE_LABEL = { workouts: 'Workouts', weights: 'Body weight', food: 'Food diary' };

export async function mountHub(container) {
  ensureCss();
  const runsBox = el('div', { class: 'stack' });
  container.append(
    pageHeader({ title: 'Import data', back: 'settings' }),
    el('p', { class: 'muted' }, 'Bring your history from a spreadsheet or another app. You always see a preview first, nothing is overwritten without asking, and every import can be undone below.'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      item('import/workouts', 'Workouts from a spreadsheet', 'Paste exercise blocks: name, 3 x 6, weight and reps, dropsets.'),
      item('import/weights', 'Body weight', 'Paste or pick a file with a date and kg on each line.'),
      item('import/food', 'Food diary', 'A CSV file from MyFitnessPal, Cronometer, FDDB or any spreadsheet.'))),
    el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Past imports'), runsBox));

  async function render() {
    const runs = await loadRuns();
    if (!runs.length) { runsBox.replaceChildren(el('p', { class: 'muted small' }, 'No imports yet.')); return; }
    runsBox.replaceChildren(...runs.map((r) => runCard(r)));
  }

  function runCard(r) {
    const when = `${fmtDate(fromTimestamp(r.createdAt))} ${new Date(r.createdAt).toTimeString().slice(0, 5)}`;
    const status = r.status === 'undone' ? el('span', { class: 'badge' }, 'Undone')
      : r.status === 'done' ? null : el('span', { class: 'badge badge-warning' }, 'Not finished');
    const btn = r.status === 'undone' ? null : el('button', {
      type: 'button', class: 'btn btn-danger btn-sm imp-undo', onClick: async () => {
        const ok = await confirmDialog({
          title: 'Undo this import?',
          message: `This removes exactly what this import added (${runSummary(r)}). Entries you added yourself stay.`,
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
    }, 'Undo this import');
    return el('div', { class: 'card imp-run', dataset: { run: r.id } },
      el('div', { class: 'row-between' },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, TYPE_LABEL[r.type] || r.type, ' ', status),
          el('div', { class: 'li-sub' }, `${when} · ${runSummary(r)}`)),
        btn));
  }

  await render();
}

function item(path, title, sub) {
  return el('a', { class: 'list-item', href: href(path) },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), el('div', { class: 'li-sub' }, sub)),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}
