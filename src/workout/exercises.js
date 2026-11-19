// Exercise library: list (search, muscle filter, archived), detail/edit with history, new.
// Routes: workout/exercises, workout/exercises/new, workout/exercises/:id
import * as db from '../db/db.js';
import { el, pageHeader, toast, navigate, href, emptyState, confirmDialog, fmtNum } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { formatSets, formatWeight } from '../core/workout.js';
import {
  exerciseHistory, exerciseSeries, filterRange, seriesChange, personalRecords, recordSessions, entryMetrics, compareMetrics,
} from '../core/workout-progress.js';
import { today } from '../core/dates.js';
import { lineChart } from './chart.js';
import { pctBadge, fmtLoad, fmtLoadNum, recordBadges } from './progress-ui.js';
import { ensureCss, loadExercises, loadWorkouts, musclesLine, newExercise, shortDate, findByName } from './data.js';
import { exerciseForm, EQUIPMENT } from './exercise-form.js';
import { matches } from './picker.js';
import { tutorialSection } from './tutorial.js';
import { isBaseline, workingEntry, workingSets, bestSetOf } from '../core/baseline.js';

// Filter state survives navigating into a detail and back.
const state = { query: '', muscle: null, archived: false };

export async function mountLibrary(container) {
  ensureCss();
  const exMap = await loadExercises();
  const all = [...exMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  const list = el('div', { class: 'list' });
  const count = el('div', { class: 'small muted wk-pad-x' });
  const search = el('input', {
    class: 'input', type: 'search', placeholder: 'Search', value: state.query, autocomplete: 'off', 'aria-label': 'Search exercises',
    onInput: () => { state.query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => chips.replaceChildren(
    el('button', { type: 'button', class: 'chip', 'aria-pressed': state.muscle ? 'false' : 'true', onClick: () => { state.muscle = null; renderChips(); render(); } }, 'All'),
    ...MUSCLES.map((m) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': state.muscle === m.id ? 'true' : 'false',
      onClick: () => { state.muscle = state.muscle === m.id ? null : m.id; renderChips(); render(); },
    }, m.name)),
    el('button', {
      type: 'button', class: 'chip', 'aria-pressed': state.archived ? 'true' : 'false',
      onClick: () => { state.archived = !state.archived; renderChips(); render(); },
    }, 'Archived'));
  renderChips();

  function render() {
    const items = all
      .filter((e) => (state.archived ? e.archived : !e.archived))
      .filter((e) => matches(e, state.query))
      .filter((e) => !state.muscle || e.primary.includes(state.muscle) || (e.secondary || []).includes(state.muscle));
    count.textContent = `${items.length} exercise${items.length === 1 ? '' : 's'}`;
    list.replaceChildren(...items.map((e) => el('a', { class: 'list-item', href: href(`workout/exercises/${encodeURIComponent(e.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, e.name, e.isCustom ? el('span', { class: 'badge wk-badge-gap' }, 'Custom') : null),
        el('div', { class: 'li-sub' }, `${musclesLine(e)} · ${equipmentName(e.equipment)}`)),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))));
    if (!items.length) list.append(el('p', { class: 'muted small wk-pad' }, state.archived ? 'No archived exercises.' : 'No match.'));
  }
  render();

  container.append(
    pageHeader({
      title: 'Exercises', back: 'workout',
      actions: [el('a', { class: 'btn btn-sm btn-primary', href: href('workout/exercises/new') }, '+ New')],
    }),
    search, chips, count,
    el('div', { class: 'card card-flush' }, list));
}

export async function mountNewExercise(container, _params, ctx) {
  ensureCss();
  const form = exerciseForm({ name: ctx.query.name || '' });
  const create = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    const dup = findByName(await loadExercises(), r.value.name);
    if (dup) { toast(`"${dup.name}" already exists${dup.archived ? ' (archived)' : ''}`, { type: 'error' }); return; }
    const ex = newExercise(r.value);
    await db.put('exercises', ex);
    toast('Exercise created', { type: 'success' });
    navigate(`workout/exercises/${encodeURIComponent(ex.id)}`, { replace: true });
  };
  container.append(pageHeader({ title: 'New exercise', back: 'workout/exercises' }),
    el('div', { class: 'card' }, form.node),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: create }, 'Create exercise'));
}

export async function mountExerciseDetail(container, { id }) {
  ensureCss();
  const [ex, workouts] = await Promise.all([db.get('exercises', id), loadWorkouts()]);
  if (!ex) {
    container.append(pageHeader({ title: 'Exercise', back: 'workout/exercises' }), emptyState('Exercise not found.'));
    return;
  }
  const form = exerciseForm(ex);
  const save = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    const dup = findByName(await loadExercises(), r.value.name, ex.id);
    if (dup) { toast(`"${dup.name}" already exists`, { type: 'error' }); return; }
    Object.assign(ex, r.value, { updatedAt: Date.now() });
    await db.put('exercises', ex);
    title.textContent = ex.name;
    const fresh = tutorialSection(ex);
    tutorial.replaceWith(fresh);
    tutorial = fresh;
    toast('Saved', { type: 'success' });
  };
  const toggleArchive = async () => {
    if (!ex.archived) {
      const ok = await confirmDialog({
        title: 'Archive exercise?',
        message: 'It is hidden from pickers and the library. History is kept; you can unarchive it any time.',
        confirmLabel: 'Archive',
      });
      if (!ok) return;
    }
    ex.archived = !ex.archived;
    ex.updatedAt = Date.now();
    await db.put('exercises', ex);
    toast(ex.archived ? 'Archived' : 'Unarchived');
    archiveBtn.textContent = ex.archived ? 'Unarchive' : 'Archive';
    badge.hidden = !ex.archived;
  };

  const header = pageHeader({ title: ex.name, subtitle: ex.isCustom ? 'Custom exercise' : 'Library exercise', back: 'workout/exercises' });
  const title = header.querySelector('.page-title');
  const badge = el('span', { class: 'badge badge-warning wk-badge-gap', hidden: !ex.archived }, 'Archived');
  header.querySelector('.page-subtitle').append(badge);
  const archiveBtn = el('button', { type: 'button', class: 'btn btn-block', onClick: toggleArchive }, ex.archived ? 'Unarchive' : 'Archive');

  const progress = progressSections(ex, workouts);
  let tutorial = tutorialSection(ex);

  container.append(header,
    tutorial,
    ...progress,
    el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Details'),
      el('div', { class: 'card' }, form.node)),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save }, 'Save changes'),
    archiveBtn);
}

// Progress state survives re-mounts within the app session.
const progressState = { metric: null, range: 'all' };

/**
 * Progress chart (metric + range switch), personal records and the session list.
 * Weighted exercises: top-set weight, estimated 1RM, volume load. Bodyweight-only history: best set reps, total reps.
 */
function progressSections(ex, workouts) {
  const hist = exerciseHistory(workouts, ex.id);
  if (!hist.length) {
    return [el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Progress'),
      el('p', { class: 'muted small wk-pad-x' }, 'No finished sessions with this exercise yet. Progress, records and history appear here after the first one.'))];
  }
  // Chart points leave the starting point out; records and the list below include it.
  const points = exerciseSeries(hist);
  const bw = points.length ? points.every((p) => p.bodyweight) : hist.every((h) => entryMetrics(h.entry).bodyweight);
  const METRICS = bw
    ? [['bestReps', 'Best set', 'reps'], ['reps', 'Total reps', 'reps']]
    : [['topWeight', 'Top set', 'kg'], ['e1rm', 'Est. 1RM', 'kg'], ['load', 'Volume', 'kg'],
      ...(points.some((p) => p.bodyweight) ? [['bestReps', 'Reps', 'reps']] : [])];
  if (!METRICS.some(([k]) => k === progressState.metric)) progressState.metric = METRICS[0][0];
  const RANGE_LABELS = [['3m', '3 M'], ['1y', '1 Y'], ['all', 'All']];
  const records = recordSessions(hist);

  const metricTabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Metric' });
  const rangeTabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Range' });
  const chartBox = el('div', { class: 'wk-chart-box' });
  const statsBox = el('div', { class: 'wk-pstats' });
  const note = el('p', { class: 'field-hint' });

  const fmtV = (key, v) => {
    if (v === null || v === undefined) return '–';
    if (key === 'load') return fmtLoad(v);
    if (key === 'bestReps' || key === 'reps') return `${fmtNum(v, 0)} reps`;
    return `${fmtNum(v, 1)} kg`;
  };
  const NOTES = {
    topWeight: 'Top set = heaviest ticked normal set (more reps wins a tie). Dropsets never count.',
    e1rm: 'Estimated 1RM (Epley) = weight × (1 + reps / 30) of the best normal set; 1 rep = the weight itself.',
    load: 'Volume load = weight × reps summed over ticked normal sets; dropsets not included.',
    bestReps: 'Most reps in one ticked normal set. Bodyweight exercises progress by reps.',
    reps: 'Total reps of ticked normal sets. Bodyweight exercises progress by reps.',
  };

  function render() {
    const key = progressState.metric;
    metricTabs.replaceChildren(...METRICS.map(([k, label]) => el('button', {
      type: 'button', role: 'tab', 'aria-selected': k === key ? 'true' : 'false',
      onClick: () => { progressState.metric = k; render(); },
    }, label)));
    rangeTabs.replaceChildren(...RANGE_LABELS.map(([k, label]) => el('button', {
      type: 'button', role: 'tab', 'aria-selected': k === progressState.range ? 'true' : 'false',
      onClick: () => { progressState.range = k; render(); },
    }, label)));
    const pts = filterRange(points, progressState.range, today());
    const ch = seriesChange(pts, key);
    const unitShort = (v) => (key === 'load' ? (v >= 10000 ? `${Math.round(v / 1000)}k` : fmtLoadNum(v)) : fmtNum(v, 1));
    chartBox.replaceChildren(pts.length
      ? lineChart({
        points: pts.map((p) => ({
          date: p.date, value: p[key], mark: records.has(p.workoutId),
          label: `${fmtV(key, p[key])}${key === 'topWeight' ? ` × ${p.topReps}` : ''}${records.has(p.workoutId) ? ' (PR)' : ''}`,
        })),
        format: unitShort,
        ariaLabel: `${METRICS.find(([k]) => k === key)[1]} over ${pts.length} session${pts.length === 1 ? '' : 's'}: from ${fmtV(key, ch.first)} to ${fmtV(key, ch.last)}`,
      })
      : el('p', { class: 'muted small wk-chart-empty' }, 'No sessions in this range.'));
    const lastP = pts[pts.length - 1];
    statsBox.replaceChildren(
      pstat('Latest', lastP ? fmtV(key, ch.last) : '–', lastP ? `${key === 'topWeight' && lastP.topWeight > 0 ? `× ${lastP.topReps} · ` : ''}${shortDate(lastP.date)}` : ''),
      pstat('Over range', pts.length > 1 ? pctBadge(ch.rangePct) : '–', pts.length > 1 ? `from ${fmtV(key, ch.first)}` : 'needs 2 sessions'),
      pstat('vs previous', pts.length > 1 ? pctBadge(ch.prevPct) : '–', pts.length > 1 ? `was ${fmtV(key, ch.previous)}` : 'needs 2 sessions'));
    note.textContent = `${NOTES[key]} Highlighted points set a personal record.`;
  }
  render();

  // Records
  const nReal = hist.filter((h) => !isBaseline(h.workout)).length;
  const pr = personalRecords(hist);
  const recRows = [];
  if (pr.heaviest) recRows.push(recRow('Heaviest weight', `${fmtNum(pr.heaviest.weight, 2)} kg × ${pr.heaviest.reps}`, pr.heaviest));
  if (pr.e1rm) recRows.push(recRow('Best est. 1RM', `${fmtNum(pr.e1rm.value, 1)} kg`, pr.e1rm, `${formatWeight(pr.e1rm.weight)} × ${pr.e1rm.reps}`));
  if (pr.mostReps && (bw || !pr.heaviest)) recRows.push(recRow('Most reps in a set', `${pr.mostReps.reps}`, pr.mostReps, `at ${formatWeight(pr.mostReps.weight)}${pr.mostReps.weight ? ' kg' : ''}`));
  const atWeight = pr.repsByWeight.slice(0, 8);
  const recSection = el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Personal records'),
    el('div', { class: 'card stack' },
      recRows,
      atWeight.length > 1 || (atWeight.length === 1 && atWeight[0].weight > 0) ? el('div', { class: 'wk-repsw' },
        el('div', { class: 'small muted' }, 'Most reps at a given weight'),
        atWeight.map((r) => el('div', { class: 'wk-repsw-row num' },
          el('span', r.weight ? `${fmtNum(r.weight, 2)} kg` : 'Bodyweight'),
          el('span', `${r.reps} reps`),
          el('span', { class: 'small muted' }, r.baseline ? 'starting point' : shortDate(r.date))))) : null,
      el('p', { class: 'field-hint' }, 'Normal ticked sets only; dropsets never count. A record belongs to the first session that reached it. Estimated 1RM = weight × (1 + reps / 30).')));

  // History with % vs previous session and PR badges
  const histList = el('div', { class: 'list' });
  const PAGE = 20;
  const renderHist = (all) => {
    histList.replaceChildren(...hist.slice(0, all ? undefined : PAGE).map(({ workout, entry }, i) => {
      if (isBaseline(workout)) return startingPointItem(workout, entry);
      const m = entryMetrics(entry);
      const prev = hist[i + 1];
      const c = prev ? compareMetrics(m, entryMetrics(workingEntry(prev.entry))) : null;
      return el('a', { class: 'list-item', href: href(`workout/history/${encodeURIComponent(workout.id)}`) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title wk-wrap' }, formatSets(entry.sets), ...recordBadges(records.get(workout.id))),
          el('div', { class: 'li-sub' }, `${shortDate(workout.date)} · ${workout.name} · ${m.bodyweight ? `${m.reps} reps` : fmtLoad(m.load)}`)),
        el('span', { class: 'li-trail' }, c ? pctBadge(c.pct) : el('span', { class: 'small muted' }, 'first')),
        el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
    }));
    if (!all && hist.length > PAGE) {
      histList.append(el('button', { type: 'button', class: 'list-item wk-more', onClick: () => renderHist(true) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, `Show all ${hist.length} sessions`))));
    }
  };
  renderHist(false);

  return [
    el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Progress'),
      el('div', { class: 'card stack wk-chart-card' }, metricTabs, rangeTabs, chartBox, statsBox, note)),
    recSection,
    el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, `History · ${nReal} session${nReal === 1 ? '' : 's'}${nReal < hist.length ? ' + starting point' : ''} · % vs previous`),
      el('div', { class: 'card card-flush' }, histList)),
  ];
}

function pstat(label, value, sub) {
  return el('div', { class: 'wk-pstat' },
    el('div', { class: 'small muted' }, label),
    el('div', { class: 'wk-pstat-value num' }, value),
    el('div', { class: 'small muted' }, sub));
}

function recRow(label, value, at, extra) {
  return el('a', { class: 'wk-rec', href: href(at.baseline ? 'workout/starting-point' : `workout/history/${encodeURIComponent(at.workoutId)}`) },
    el('div', { class: 'grow' }, el('div', { class: 'small muted' }, label), el('div', { class: 'wk-rec-value num' }, value, extra ? el('span', { class: 'small muted' }, ` · ${extra}`) : null)),
    el('span', { class: 'small muted' }, at.baseline ? `Starting point · ${shortDate(at.date)}` : shortDate(at.date)));
}

/** The starting point in an exercise's history list (not a session). */
function startingPointItem(workout, entry) {
  const best = bestSetOf(entry);
  return el('a', { class: 'list-item', href: href('workout/starting-point') },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title wk-wrap' }, formatSets(workingSets(entry)), best ? ` · best ${formatSets([best])}` : null),
      el('div', { class: 'li-sub' }, `Starting point · as of ${shortDate(workout.date)}`)),
    el('span', { class: 'li-trail small muted' }, 'start'),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}

function equipmentName(id) {
  const e = EQUIPMENT.find(([v]) => v === id);
  return e ? e[1] : id;
}
