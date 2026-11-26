// Import hub: the three importers and the list of past imports with Undo.
import { el, pageHeader, href, confirmDialog, toast, fmtDate, fmtTime, icon, sectionHeader, tag, joinSentences } from '../ui/index.js';
import { fromTimestamp } from '../core/dates.js';
import { t } from '../i18n/index.js';
import { ensureCss, loadRuns, undoRun, runSummary } from './shared.js';

const TYPE_LABEL = { workouts: 'import.hub.workouts', weights: 'import.hub.weights', food: 'import.hub.food' };

export async function mountHub(container) {
  ensureCss();
  container.classList.add('imp-view');
  const runsBox = el('div', { class: 'card card-flush' });
  container.append(
    pageHeader({ title: t('import.title'), subtitle: t('import.hub.subtitle'), back: 'settings' }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' },
      item('import/workouts', 'barbell', t('import.hub.workouts'), t('import.hub.workoutsSub')),
      item('import/weights', 'scale', t('import.hub.weights'), t('import.hub.weightsSub')),
      item('import/food', 'utensils', t('import.hub.food'), t('import.hub.foodSub')))),
    el('section', { class: 'section' }, sectionHeader(t('import.hub.past')), runsBox));

  async function render() {
    const runs = await loadRuns();
    if (!runs.length) { runsBox.replaceChildren(el('p', { class: 't-sub muted imp-none' }, t('import.hub.none'))); return; }
    runsBox.replaceChildren(el('div', { class: 'list' }, runs.map((r) => runRow(r))));
  }

  function runRow(r) {
    const when = `${fmtDate(fromTimestamp(r.createdAt))} ${fmtTime(r.createdAt)}`;
    const status = r.status === 'undone' ? tag(t('import.hub.undone'))
      : r.status === 'done' ? null : tag(t('import.hub.notFinished'), { tone: 'warn' });
    const btn = r.status === 'undone' ? null : el('button', {
      type: 'button', class: 'btn btn-sm btn-danger imp-undo', 'aria-label': t('import.hub.undoLabel', { summary: runSummary(r) }), onClick: async () => {
        const ok = await confirmDialog({
          title: t('import.hub.undoTitle'),
          message: undoMessage(r),
          confirmLabel: t('import.hub.undoConfirm'), danger: true,
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          const res = await undoRun(r.id);
          const n = Object.values(res.removed).reduce((a, b) => a + b, 0);
          const parts = [t('import.hub.undoneToast', { count: n })];
          if (res.restored) parts.push(t('import.hub.restored', { count: res.restored }));
          if (res.keptExercises) parts.push(t('import.hub.keptExercises', { count: res.keptExercises }));
          toast(joinSentences(parts), { type: 'success' });
        } catch (err) {
          console.error(err);
          toast(t('import.hub.undoFailed', { error: err.message }), { type: 'error' });
        }
        render();
      },
    }, icon('undo-2', { size: 18 }), t('import.hub.undo'));
    return el('div', { class: 'list-item imp-run', dataset: { run: r.id } },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title imp-run-title' }, TYPE_LABEL[r.type] ? t(TYPE_LABEL[r.type]) : r.type, status),
        el('div', { class: 'li-sub imp-wrap' }, `${when} · ${runSummary(r)}`)),
      btn);
  }

  await render();
}

/** 'Removes 1 entry on 1 day (19 Nov 2026) from the CSV import. Your own entries stay.' */
function undoMessage(r) {
  if (!r.info) return t('import.hub.undoMessageOld', { summary: runSummary(r) });
  const what = runSummary(r, { source: false });
  return r.info.source ? t('import.hub.undoMessageSource', { summary: what, source: r.info.source }) : t('import.hub.undoMessage', { summary: what });
}

function item(path, iconName, title, sub) {
  return el('a', { class: 'list-item', href: href(path) },
    el('span', { class: 'li-lead' }, icon(iconName)),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title imp-wrap' }, title), el('div', { class: 'li-sub imp-wrap' }, sub)),
    icon('chevron-right', { class: 'li-chevron' }));
}
