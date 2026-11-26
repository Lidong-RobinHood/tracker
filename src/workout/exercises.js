// Exercise library: list (search, muscle filter, archived), detail/edit with history, new.
// Routes: workout/exercises, workout/exercises/new, workout/exercises/:id
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, toast, navigate, href, emptyState, fmtNum, icon, iconButton, sectionHeader, segmented, tag } from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import {
  exerciseHistory, exerciseSeries, filterRange, seriesChange, personalRecords, recordSessions, entryMetrics, compareMetrics,
} from '../core/workout-progress.js';
import { today } from '../core/dates.js';
import { lineChart } from './chart.js';
import { pctBadge, fmtTonnage, recordBadges } from './progress-ui.js';
import {
  ensureCss, loadExercises, loadWorkouts, newExercise, shortDate, findByName, confirmAction, exLabel, equipmentName,
  fmtSets, fmtWeight, workoutTitle,
} from './data.js';
import { exerciseForm } from './exercise-form.js';
import { t, compareText } from '../i18n/index.js';
import { exerciseNameForSave } from '../i18n/names.js';
import { matches } from './picker.js';
import { tutorialSection } from './tutorial.js';
import { musclesBlock, rowMuscleIcon, musclesText, muscleChip } from './muscle-map.js';
import { isBaseline, workingEntry, workingSets, bestSetOf } from '../core/baseline.js';

// Filter state survives navigating into a detail and back.
const state = { query: '', muscle: null, archived: false };

export async function mountLibrary(container) {
  ensureCss();
  const exMap = await loadExercises();
  const all = [...exMap.values()].sort((a, b) => compareText(exLabel(a), exLabel(b)));

  const list = el('div', { class: 'list' });
  const count = el('div', { class: 't-sub muted wk-pad-x' });
  const search = el('input', {
    type: 'search', placeholder: t('workout.library.search'), value: state.query, autocomplete: 'off', 'aria-label': t('workout.picker.search'),
    onInput: () => { state.query = search.value.trim(); render(); },
  });
  const chips = el('div', { class: 'chips chips-scroll' });
  const renderChips = () => replaceChildren(chips, 
    el('button', { type: 'button', class: 'chip', 'aria-pressed': state.muscle ? 'false' : 'true', onClick: () => { state.muscle = null; renderChips(); render(); } }, t('workout.filter.all')),
    ...MUSCLES.map((m) => muscleChip(m, state.muscle === m.id, () => { state.muscle = state.muscle === m.id ? null : m.id; renderChips(); render(); })),
    el('button', {
      type: 'button', class: 'chip', 'aria-pressed': state.archived ? 'true' : 'false',
      onClick: () => { state.archived = !state.archived; renderChips(); render(); },
    }, t('workout.library.archived')));
  renderChips();

  function render() {
    const items = all
      .filter((e) => (state.archived ? e.archived : !e.archived))
      .filter((e) => matches(e, state.query))
      .filter((e) => !state.muscle || e.primary.includes(state.muscle) || (e.secondary || []).includes(state.muscle));
    count.textContent = t('workout.library.count', { count: items.length });
    replaceChildren(list, ...items.map((e) => el('a', { class: 'list-item wk-ex-row', href: href(`workout/exercises/${encodeURIComponent(e.id)}`) },
      rowMuscleIcon((e.primary || [])[0]),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, exLabel(e)),
        el('div', { class: 'li-sub' }, musclesText(e), equipmentSuffix(e))),
      e.isCustom ? tag(t('workout.library.custom')) : null,
      icon('chevron-right', { class: 'li-chevron' }))));
    if (!items.length) append(list, el('p', { class: 't-sub muted wk-pad' }, state.archived ? t('workout.library.noArchived') : t('workout.library.noMatch')));
  }
  render();

  append(container, 
    pageHeader({
      title: t('workout.route.exercises'), back: 'workout',
      actions: [el('a', { class: 'btn btn-icon btn-ghost', href: href('workout/exercises/new'), 'aria-label': t('workout.exercise.new') }, icon('plus'))],
    }),
    el('label', { class: 'search-field' }, icon('search'), search), chips, count,
    el('div', { class: 'card card-flush' }, list));
}

export async function mountNewExercise(container, _params, ctx) {
  ensureCss();
  const form = exerciseForm({ name: ctx.query.name || '' }, { preview: true });
  const create = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    const dup = findByName(await loadExercises(), r.value.name);
    if (dup) { toast(t(dup.archived ? 'workout.exercise.existsArchived' : 'workout.exercise.exists', { name: exLabel(dup) }), { type: 'error' }); return; }
    const ex = newExercise(r.value);
    await db.put('exercises', ex);
    toast(t('workout.exercise.created'), { type: 'success' });
    navigate(`workout/exercises/${encodeURIComponent(ex.id)}`, { replace: true });
  };
  append(container, pageHeader({ title: t('workout.exercise.new'), back: 'workout/exercises' }),
    el('div', { class: 'card' }, form.node),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: create }, t('workout.exercise.create')));
}

export async function mountExerciseDetail(container, { id }) {
  ensureCss();
  const [ex, workouts] = await Promise.all([db.get('exercises', id), loadWorkouts()]);
  if (!ex) {
    append(container, pageHeader({ title: t('workout.route.exercise'), back: 'workout/exercises' }), emptyState(t('workout.exercise.notFound')));
    return;
  }
  // Muscles near the top, live while the muscles are edited in the form below (saved with Save changes).
  const muscles = musclesBlock({ primary: ex.primary, secondary: ex.secondary });
  // A built-in exercise shows its translated name; saved unchanged, the record keeps its English name.
  const form = exerciseForm({ ...ex, name: exLabel(ex) }, { onMuscles: (p, s) => muscles.update(p, s) });
  const save = async () => {
    const r = form.read();
    if (!r.ok) { toast(r.error, { type: 'error' }); return; }
    r.value.name = exerciseNameForSave(ex, r.value.name);
    const dup = findByName(await loadExercises(), r.value.name, ex.id);
    if (dup) { toast(t('workout.exercise.exists', { name: exLabel(dup) }), { type: 'error' }); return; }
    Object.assign(ex, r.value, { updatedAt: Date.now() });
    await db.put('exercises', ex);
    title.textContent = exLabel(ex);
    const fresh = tutorialSection(ex);
    tutorial.replaceWith(fresh);
    tutorial = fresh;
    toast(t('workout.exercise.saved'), { type: 'success' });
  };
  const toggleArchive = async () => {
    if (!ex.archived) {
      const ok = await confirmAction({
        title: t('workout.exercise.archiveTitle'),
        message: t('workout.exercise.archiveMessage'),
        confirmLabel: t('workout.exercise.archive'),
      });
      if (!ok) return;
    }
    ex.archived = !ex.archived;
    ex.updatedAt = Date.now();
    await db.put('exercises', ex);
    toast(ex.archived ? t('workout.exercise.archivedToast') : t('workout.exercise.unarchivedToast'));
    archiveBtn.textContent = ex.archived ? t('workout.exercise.unarchive') : t('workout.exercise.archive');
    badge.hidden = !ex.archived;
  };

  const header = pageHeader({ title: exLabel(ex), subtitle: ex.isCustom ? t('workout.exercise.customSub') : t('workout.exercise.librarySub'), back: 'workout/exercises' });
  const title = header.querySelector('.page-title');
  const badge = el('span', { class: 'tag tag-warn wk-badge-gap', hidden: !ex.archived }, t('workout.library.archived'));
  append(header.querySelector('.page-subtitle'), badge);
  const archiveBtn = el('button', { type: 'button', class: 'btn btn-block', onClick: toggleArchive }, ex.archived ? t('workout.exercise.unarchive') : t('workout.exercise.archive'));

  const progress = progressSections(ex, workouts);
  let tutorial = tutorialSection(ex);

  append(container, header,
    el('section', { class: 'section' }, sectionHeader(t('workout.exercise.muscles')), el('div', { class: 'card' }, muscles.node)),
    tutorial,
    ...progress,
    el('section', { class: 'section' },
      sectionHeader(t('workout.exercise.details')),
      el('div', { class: 'card' }, form.node)),
    el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: save }, t('workout.exercise.saveChanges')),
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
      sectionHeader(t('workout.progress.title')),
      el('div', { class: 'card' }, el('p', { class: 't-sub muted' }, t('workout.progress.none'))))];
  }
  // Chart points leave the starting point out; records and the list below include it.
  const points = exerciseSeries(hist);
  const bw = points.length ? points.every((p) => p.bodyweight) : hist.every((h) => entryMetrics(h.entry).bodyweight);
  const METRICS = bw
    ? [['bestReps', t('workout.progress.bestSet')], ['reps', t('workout.progress.totalReps')]]
    : [['topWeight', t('workout.progress.topSet')], ['e1rm', t('workout.progress.e1rm')], ['load', t('workout.progress.tonnage')],
      ...(points.some((p) => p.bodyweight) ? [['bestReps', t('workout.progress.reps')]] : [])];
  if (!METRICS.some(([k]) => k === progressState.metric)) progressState.metric = METRICS[0][0];
  const RANGE_LABELS = [['3m', t('workout.progress.range3m')], ['1y', t('workout.progress.range1y')], ['all', t('workout.progress.rangeAll')]];
  const records = recordSessions(hist);

  const metricHost = el('div');
  const rangeHost = el('div');
  const chartBox = el('div', { class: 'wk-chart-box' });
  const statsBox = el('div', { class: 'tiles' });
  const note = el('p', { class: 'field-hint' }, t('workout.progress.highlight'));

  const fmtV = (key, v) => {
    if (v === null || v === undefined) return '–';
    if (key === 'load') return fmtTonnage(v, { kg: true }); // per exercise: always kg
    if (key === 'bestReps' || key === 'reps') return t('workout.progress.nReps', { count: v, n: fmtNum(v, 0) });
    return `${fmtNum(v, 1)} kg`;
  };

  function render() {
    const key = progressState.metric;
    replaceChildren(metricHost, segmented({
      ariaLabel: t('workout.progress.metric'), value: key, options: METRICS.map(([k, label]) => ({ value: k, label })),
      onChange: (v) => { progressState.metric = v; render(); },
    }));
    replaceChildren(rangeHost, segmented({
      ariaLabel: t('workout.progress.range'), small: true, value: progressState.range, options: RANGE_LABELS.map(([k, label]) => ({ value: k, label })),
      onChange: (v) => { progressState.range = v; render(); },
    }));
    const pts = filterRange(points, progressState.range, today());
    const ch = seriesChange(pts, key);
    const unitShort = (v) => (key === 'load' ? fmtTonnage(v, { kg: true }).replace(/ kg$/, '') : fmtNum(v, 1));
    replaceChildren(chartBox, pts.length
      ? lineChart({
        points: pts.map((p) => ({
          date: p.date, value: p[key], mark: records.has(p.workoutId),
          label: pointLabel(`${fmtV(key, p[key])}${key === 'topWeight' ? ` × ${p.topReps}` : ''}`, records.has(p.workoutId)),
        })),
        format: unitShort,
        ariaLabel: t('workout.progress.chartAria', { metric: METRICS.find(([k]) => k === key)[1], count: pts.length, first: fmtV(key, ch.first), last: fmtV(key, ch.last) }),
      })
      : el('p', { class: 't-sub muted wk-chart-empty' }, t('workout.progress.noneInRange')));
    const lastP = pts[pts.length - 1];
    replaceChildren(statsBox,
      pstat(t('workout.progress.latest'), lastP ? fmtV(key, ch.last) : '–', lastP ? `${key === 'topWeight' && lastP.topWeight > 0 ? `× ${lastP.topReps} · ` : ''}${shortDate(lastP.date)}` : ''),
      pstat(t('workout.progress.overRange'), pts.length > 1 ? pctBadge(ch.rangePct) : '–', pts.length > 1 ? t('workout.progress.from', { value: fmtV(key, ch.first) }) : t('workout.progress.needs2')),
      pstat(t('workout.progress.vsPrevious'), pts.length > 1 ? pctBadge(ch.prevPct) : '–', pts.length > 1 ? t('workout.progress.was', { value: fmtV(key, ch.previous) }) : t('workout.progress.needs2')));
  }
  render();

  // Records
  const nReal = hist.filter((h) => !isBaseline(h.workout)).length;
  const pr = personalRecords(hist);
  const recRows = [];
  if (pr.heaviest) recRows.push(recRow(t('workout.records.heaviest'), `${fmtNum(pr.heaviest.weight, 2)} kg × ${pr.heaviest.reps}`, pr.heaviest));
  if (pr.e1rm) recRows.push(recRow(t('workout.progress.e1rm'), `${fmtNum(pr.e1rm.value, 1)} kg`, pr.e1rm, `${fmtWeight(pr.e1rm.weight)} × ${pr.e1rm.reps}`));
  if (pr.mostReps && (bw || !pr.heaviest)) recRows.push(recRow(t('workout.records.mostReps'), `${pr.mostReps.reps}`, pr.mostReps, t('workout.records.at', { weight: `${fmtWeight(pr.mostReps.weight)}${pr.mostReps.weight ? ' kg' : ''}` })));
  const atWeight = pr.repsByWeight.slice(0, 8);
  const recSection = el('section', { class: 'section' },
    sectionHeader(t('workout.records.title'), { info: 'records' }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, recRows)),
    atWeight.length > 1 || (atWeight.length === 1 && atWeight[0].weight > 0) ? el('div', { class: 'card wk-repsw' },
      el('div', { class: 't-cap muted' }, t('workout.records.repsAtWeight')),
      atWeight.map((r) => el('div', { class: 'wk-repsw-row' },
        el('span', r.weight ? `${fmtNum(r.weight, 2)} kg` : t('workout.records.bodyweight')),
        el('span', t('workout.progress.nReps', { count: r.reps, n: r.reps })),
        el('span', { class: 't-sub muted' }, r.baseline ? t('workout.records.startingPoint') : shortDate(r.date))))) : null);

  // History with % vs previous session and PR badges
  const histList = el('div', { class: 'list' });
  const PAGE = 20;
  const renderHist = (all) => {
    replaceChildren(histList, ...hist.slice(0, all ? undefined : PAGE).map(({ workout, entry }, i) => {
      if (isBaseline(workout)) return startingPointItem(workout, entry);
      const m = entryMetrics(entry);
      const prev = hist[i + 1];
      const c = prev ? compareMetrics(m, entryMetrics(workingEntry(prev.entry))) : null;
      return el('a', { class: 'list-item', href: href(`workout/history/${encodeURIComponent(workout.id)}`) },
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title wk-wrap' }, fmtSets(entry.sets), ...recordBadges(records.get(workout.id))),
          el('div', { class: 'li-sub' }, `${shortDate(workout.date)} · ${workoutTitle(workout)} · ${m.bodyweight ? t('workout.progress.nReps', { count: m.reps, n: m.reps }) : fmtTonnage(m.load, { kg: true })}`)),
        el('span', { class: 'li-trail' }, c ? pctBadge(c.pct) : el('span', { class: 't-sub muted' }, t('workout.history.first'))),
        icon('chevron-right', { class: 'li-chevron' }));
    }));
    if (!all && hist.length > PAGE) {
      append(histList, el('button', { type: 'button', class: 'list-item wk-more', onClick: () => renderHist(true) },
        el('div', { class: 'li-main' }, el('div', { class: 'li-title wk-link' }, t('workout.history.showAll', { count: hist.length })))));
    }
  };
  renderHist(false);

  return [
    el('section', { class: 'section' },
      sectionHeader(t('workout.progress.title'), { info: 'metrics', trail: rangeHost }),
      metricHost,
      el('div', { class: 'card stack wk-chart-card' }, chartBox, note),
      statsBox),
    recSection,
    el('section', { class: 'section' },
      sectionHeader(t(nReal < hist.length ? 'workout.history.sessionsStart' : 'workout.history.sessions', { count: nReal }), { trail: t('workout.history.pctTrail') }),
      el('div', { class: 'card card-flush' }, histList)),
  ];
}

/** Chart point text, '100 kg × 5 (record)' for a record session. */
function pointLabel(value, record) {
  return record ? t('workout.progress.pointRecord', { value }) : value;
}

function pstat(label, value, sub) {
  return el('div', { class: 'tile' },
    el('span', { class: 'tile-label' }, label),
    el('span', { class: 'tile-value wk-tile-sm' }, value),
    el('span', { class: 'tile-sub truncate' }, sub));
}

function recRow(label, value, at, extra) {
  return el('a', { class: 'list-item', href: href(at.baseline ? 'workout/starting-point' : `workout/history/${encodeURIComponent(at.workoutId)}`) },
    icon('trophy', { class: 'li-lead' }),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-sub' }, label),
      el('div', { class: 'li-title' }, value, extra ? el('span', { class: 't-sub muted' }, ` · ${extra}`) : null)),
    el('span', { class: 'li-trail t-sub muted' }, at.baseline ? t('workout.records.startingPointAt', { date: shortDate(at.date) }) : shortDate(at.date)),
    icon('chevron-right', { class: 'li-chevron' }));
}

/** The starting point in an exercise's history list (not a session). */
function startingPointItem(workout, entry) {
  const best = bestSetOf(entry);
  return el('a', { class: 'list-item', href: href('workout/starting-point') },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title wk-wrap' }, fmtSets(workingSets(entry)), best ? ` · ${t('workout.records.best', { sets: fmtSets([best]) })}` : null),
      el('div', { class: 'li-sub' }, t('workout.history.startAsOf', { date: shortDate(workout.date) }))),
    el('span', { class: 'li-trail t-sub muted' }, t('workout.history.startTrail')),
    icon('chevron-right', { class: 'li-chevron' }));
}

/** ' · Barbell', or nothing when the name already says it ('Bench Press (Barbell)'). */
function equipmentSuffix(e) {
  const eq = equipmentName(e.equipment);
  const en = String(e.equipment || '').toLowerCase();
  const name = exLabel(e).toLowerCase();
  if (!eq || name.includes(String(eq).toLowerCase()) || (name === String(e.name).toLowerCase() && en && name.includes(en))) return null;
  return el('span', { class: 'wk-mus-p wk-eq' }, ` · ${eq}`);
}
