// Weekly reports: list of weeks (trends/weeks) and one Monday–Sunday report (trends/week/:weekStart).
// All numbers come from src/core/weekly-report.js; definitions are documented there and repeated in
// the info sheets (report, complete, trend, sets, tonnage, macros).
import { withPercent } from '../core/numbers.js';
import * as db from '../db/db.js';
import { el, pageHeader, emptyState, fmtNum, fmtDate, fmtGrouped, fmtTonnage, href, navigate, cardHeader, statTile, tag, icon, infoButton, joinSentences } from '../ui/index.js';
import { today as todayStr, addDays, weekStart, weekday, isValidDate, parseDate } from '../core/dates.js';
import { fmtPercent } from '../core/food-percent.js';
import { formatPct } from '../core/workout-progress.js';
import { buildWeeklyReport, weekSummaries, normaliseWeek, weekStatus } from '../core/weekly-report.js';
import { intakeChart } from './charts.js';
import { shownKgChange, shownKgChangePct, shownKgDiff } from '../core/weight-format.js';
import { fixed, ensureCss, getAdaptiveSetting, signed, goalText, tdeeText } from './data.js';
import { t } from '../i18n/index.js';
import { dayRange, weekdayShort } from '../i18n/dates.js';
import { muscleName, exerciseName } from '../i18n/names.js';
import { workoutTitle, loadRoutineIndex } from '../workout/data.js';

const UNIT = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };

/** Mon–Sun span: '9–15 Nov', '28 Dec 2026 – 3 Jan 2027' (year shown when not the current one; src/i18n/dates.js). */
export function weekRange(ws) {
  return dayRange(parseDate(ws), parseDate(addDays(ws, 6)));
}

// ---------------------------------------------------------------- list

/** Tonnage: the shared rule (whole kg below 10 000 kg, t with two decimals from 10 000 kg). */
const tonnage = (kg) => fmtTonnage(kg);

/** Route: trends/weeks */
export async function mountWeeks(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: t('trends.weeks.title'), back: 'trends', info: 'report' }));
  const now = todayStr();
  const [entries, weights, workouts, adaptive] = await Promise.all([
    db.getAll('diary'), db.getAll('weights'), db.getAll('workouts'), getAdaptiveSetting(),
  ]);
  const weeks = weekSummaries({ today: now, entries, weights, workouts, config: adaptive });
  const list = el('div', { class: 'list' }, weeks.map((w) => el('a', { class: 'list-item wr-week', href: href(`trends/week/${w.weekStart}`) },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, weekRange(w.weekStart), w.status === 'current' ? tag(t('trends.weeks.inProgress'), { tone: 'accent' }) : null),
      el('div', { class: 'li-sub' }, summaryLine(w))),
    icon('chevron-right', { class: 'li-chevron' }))));
  container.append(el('div', { class: 'card card-flush' }, list));
  if (weeks.length === 1 && !weeks[0].hasData) container.append(el('p', { class: 't-sub muted tr-note' }, t('trends.weeks.none')));
}

function summaryLine(w) {
  if (!w.hasData) return t('trends.weeks.nothingYet');
  const parts = [];
  if (w.avgKcal !== null) parts.push(t('trends.weeks.kcalAvg', { kcal: fmtGrouped(w.avgKcal) }));
  parts.push(w.status === 'current' ? t('trends.weeks.daysSoFar', { n: w.loggedDays, count: w.countedDays })
    : t('trends.weeks.daysOf7', { n: w.loggedDays }));
  if (w.sessions) parts.push(t('trends.dash.workouts', { count: w.workouts }));
  if (w.avgWeight !== null) parts.push(`${fixed(w.avgWeight, 1)}\u00a0kg`); // no break between number and unit
  return parts.join(' · ');
}

// ---------------------------------------------------------------- report

/** Route: trends/week/:weekStart */
export async function mountWeek(container, params) {
  ensureCss();
  container.classList.add('tr-view');
  const now = todayStr();
  const cur = weekStart(now);
  const raw = params.weekStart;
  const ws = isValidDate(raw) ? normaliseWeek(raw) : null;
  if (!ws || ws > cur) { navigate(`trends/week/${cur}`, { replace: true }); return; }
  if (ws !== raw) { navigate(`trends/week/${ws}`, { replace: true }); return; }

  const status = weekStatus(ws, now);
  const prevWs = addDays(ws, -7);
  const nextWs = addDays(ws, 7);
  container.append(pageHeader({
    title: weekRange(ws),
    subtitle: status === 'current' ? t('trends.week.currentSub') : ws === addDays(cur, -7) ? t('trends.dash.lastWeek') : t('trends.weekOf', { date: fmtDate(ws) }),
    back: 'trends/weeks',
    info: 'report',
  }));
  container.append(el('nav', { class: 'wr-nav', 'aria-label': t('trends.week.navAria') },
    el('a', { class: 'btn btn-sm btn-ghost wr-nav-btn', 'aria-label': t('trends.week.prevAria', { range: weekRange(prevWs) }), href: href(`trends/week/${prevWs}`) },
      icon('chevron-left', { size: 18 }), weekRange(prevWs)),
    nextWs > cur
      ? el('span', { class: 't-sub muted wr-nav-end' }, t('trends.week.latest'))
      : el('a', { class: 'btn btn-sm btn-ghost wr-nav-btn', 'aria-label': t('trends.week.nextAria', { range: weekRange(nextWs) }), href: href(`trends/week/${nextWs}`) },
        weekRange(nextWs), icon('chevron-right', { size: 18 }))));

  const [entries, weights, workouts, exList, targets, history, goal, volume, setTargets, adaptive] = await Promise.all([
    db.range('diary', 'date', { lower: addDays(ws, -42), upper: addDays(ws, 41) }),
    db.getAll('weights'),
    db.getAll('workouts'),
    db.getAll('exercises'),
    db.getSetting('targets'),
    db.getAll('targetHistory'),
    db.getSetting('goal'),
    db.getSetting('volume'),
    db.getSetting('volumeTargets'),
    getAdaptiveSetting(), loadRoutineIndex(),
  ]);
  const r = buildWeeklyReport({
    weekStart: ws, today: now, entries, weights, workouts, exercises: new Map(exList.map((e) => [e.id, e])),
    targets, history, goal, volumeWeights: volume, setTargets, config: adaptive,
  });

  if (!r.hasData) {
    container.append(el('div', { class: 'card' }, emptyState(
      t(status === 'current' ? 'trends.week.emptyCurrent' : 'trends.week.empty'),
      el('div', { class: 'row wr-empty-actions' },
        el('a', { class: 'btn btn-primary', href: href(`diary/${status === 'current' ? now : ws}`) }, t('trends.openDiary')),
        el('a', { class: 'btn', href: href('trends/weight') }, t('trends.week.logWeight')),
        el('a', { class: 'btn', href: href('workout') }, t('trends.week.workout'))))));
    if (r.checkIn) container.append(checkInCard(r));
    return;
  }

  container.append(...[
    nutritionCard(r, now),
    weightCard(r),
    trainingCard(r),
    compareCard(r),
    r.checkIn ? checkInCard(r) : null,
  ].filter(Boolean));
}

function section(title, opts, ...children) {
  return el('section', { class: 'card wr-card', 'aria-label': title }, cardHeader(title, opts), children);
}

const sub = (title, info) => el('h3', { class: 't-cap muted wr-sub' }, title, info ? infoButton(info) : null);

function targetsNote(r) {
  const tg = r.targets;
  if (r.status === 'current') return t('trends.week.targetsCurrent');
  if (tg.source === 'history') return t('trends.week.targetsHistory', { kcal: fmtGrouped(tg.kcal), date: fmtDate(tg.fromWeek) });
  return t('trends.week.targetsNone');
}

// ---------------------------------------------------------------- nutrition

function nutritionCard(r, now) {
  const n = r.nutrition;
  const tg = r.targets;
  if (!n.days.some((d) => d.kcal)) {
    return section(t('trends.week.nutrition'), {}, el('p', { class: 't-sub muted' }, t('trends.week.noFood')),
      el('a', { class: 'btn btn-sm', href: href(`diary/${r.status === 'current' ? now : r.weekStart}`) }, t('trends.openDiary')));
  }
  const inProgress = r.status === 'current';
  const head = el('div', { class: 'tiles' },
    statTile({ label: t('trends.week.logged'), value: `${n.loggedDays}`, unit: inProgress ? `/ ${n.countedDays}` : '/ 7' }),
    statTile({ label: t('trends.week.complete'), value: `${n.completeDays}`, sub: n.incompleteDays ? t('trends.intake.incomplete', { count: n.incompleteDays }) : null }),
    statTile({ label: t('trends.week.onTarget'), value: `${n.onTargetDays}`,
      sub: tg.kcal ? t('trends.week.onTargetSub', { kcal: fmtGrouped(tg.kcal) }) : t('trends.week.noTarget') }));

  const table = el('table', { class: 'tr-table' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, t('trends.week.dailyAvg')), el('th', { scope: 'col' }, t('trends.week.eaten')),
      el('th', { scope: 'col' }, t('trends.checkin.target')), el('th', { scope: 'col' }, '%'))),
    el('tbody', null, ['kcal', 'protein', 'carbs', 'fat'].map((k) => {
      const pct = n.pct[k];
      return el('tr', null,
        el('th', { scope: 'row' }, t(`trends.macro.${k}`)),
        el('td', null, n.avg[k] === null ? '–' : `${fmtGrouped(n.avg[k])} ${UNIT[k]}`),
        el('td', { class: 'muted' }, tg[k] === null ? '–' : fmtGrouped(tg[k])),
        el('td', { class: pct !== null && pct > 110 ? 'text-warning strong' : null }, pct === null ? '–' : fmtPercent(pct)));
    })));

  const days7 = n.days.map((d) => ({ date: d.date, kcal: d.kcal }));
  const chart = intakeChart(days7, tg.kcal || null, [{ from: r.weekStart, to: r.weekEnd, avg: n.avg.kcal }], now);
  const svg = chart.querySelector('svg');
  if (svg) {
    svg.classList.add('wr-chart-tap');
    svg.addEventListener('click', (ev) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width) return;
      const x = ((ev.clientX - rect.left) / rect.width) * 340; // intakeChart geometry: W 340, L 38, R 6
      const i = Math.floor((x - 38) / ((340 - 38 - 6) / 7));
      if (i >= 0 && i < 7 && !n.days[i].isFuture) navigate(`diary/${n.days[i].date}`);
    });
  }

  const dayList = el('div', { class: 'list wr-days' }, n.days.map((d, i) => dayRow(d, i, n, tg)));

  const split = el('div', { class: 'wr-split' },
    sub(t('trends.week.splitTitle'), 'macros'),
    splitRow(t('trends.week.eaten'), n.split),
    splitRow(t('trends.checkin.target'), n.targetSplit));

  const extremes = el('div', { class: 'tiles wr-tiles-2' },
    statTile({ label: t('trends.week.highestDay'), value: n.highest ? fmtGrouped(n.highest.kcal) : '–', unit: n.highest ? 'kcal' : null, sub: n.highest ? fmtDate(n.highest.date) : null }),
    statTile({ label: t('trends.week.lowestDay'), value: n.lowest ? fmtGrouped(n.lowest.kcal) : '–', unit: n.lowest ? 'kcal' : null, sub: n.lowest ? fmtDate(n.lowest.date) : null }));

  const total = el('div', { class: 't-sub wr-total' },
    el('span', { class: 'strong' }, t('trends.week.total', { kcal: fmtGrouped(n.total.kcal) })),
    n.total.target ? ` ${t('trends.week.totalOf', { count: n.completeDays, target: fmtGrouped(n.total.target), pct: fmtPercent(n.total.pct) })}` : '',
    n.total.weekTarget ? el('div', { class: 'muted' }, t('trends.week.fullTarget', { kcal: fmtGrouped(n.total.weekTarget) })) : null);

  const note = targetsNote(r);
  const notes = [
    n.incompleteDays ? t('trends.week.incompleteNote') : null,
    note,
  ].filter(Boolean);

  return section(t('trends.week.nutrition'), { info: 'complete' }, head, table, el('div', { class: 'tr-chart-wrap' }, chart), dayList, split, extremes, total,
    notes.length ? el('div', { class: 'wr-notes t-sub muted' }, notes.map((x) => el('p', null, x))) : null);
}

function dayRow(d, i, n, tg) {
  const tags = [];
  if (d.isToday) tags.push(tag(t('trends.week.tagToday')));
  if (d.incomplete) tags.push(tag(t('trends.week.tagIncomplete'), { tone: 'warn' }));
  if (d.onTarget) tags.push(tag(t('trends.week.tagOnTarget'), { tone: 'ok', icon: 'check' }));
  if (n.highest && n.highest.date === d.date && n.completeDays > 1) tags.push(tag(t('trends.week.tagHighest')));
  if (n.lowest && n.lowest.date === d.date && n.completeDays > 1) tags.push(tag(t('trends.week.tagLowest')));
  const kcal = d.kcal ? `${fmtGrouped(d.kcal)} kcal` : d.isFuture ? '' : t('trends.chart.notLogged');
  const main = el('div', { class: 'li-main wr-day-main' },
    el('span', { class: 'wr-dow' }, weekdayShort(i), el('span', { class: 'muted' }, ` ${Number(d.date.slice(8, 10))}`)),
    el('span', { class: 'wr-tags' }, tags));
  const trail = el('div', { class: 'li-trail wr-day-trail' },
    el('div', { class: d.kcal ? null : 'muted t-sub' }, kcal),
    d.kcal && d.pct !== null && tg.kcal ? el('div', { class: ['t-sub', d.pct > 110 ? 'text-warning' : 'muted'] }, fmtPercent(d.pct)) : null);
  if (d.isFuture) return el('div', { class: 'list-item wr-day is-future' }, main, trail, el('span', { class: 'wr-chev-space' }));
  return el('a', { class: 'list-item wr-day', href: href(`diary/${d.date}`), 'aria-label': t('trends.week.dayAria', { date: fmtDate(d.date), kcal }) },
    main, trail, icon('chevron-right', { class: 'li-chevron' }));
}

function splitRow(label, split) {
  if (!split) return el('div', { class: 'wr-split-row t-sub' }, el('span', { class: 'wr-split-label muted' }, label), el('span', { class: 'muted' }, '–'));
  return el('div', { class: 'wr-split-row t-sub' },
    el('span', { class: 'wr-split-label muted' }, label),
    el('div', { class: 'wr-split-bar', 'aria-hidden': 'true' },
      el('span', { class: 'wr-seg wr-seg-p', style: { width: `${split.protein}%` } }),
      el('span', { class: 'wr-seg wr-seg-c', style: { width: `${split.carbs}%` } }),
      el('span', { class: 'wr-seg wr-seg-f', style: { width: `${split.fat}%` } })),
    el('span', { class: 'wr-split-txt' }, t('trends.week.splitText', { protein: split.protein, carbs: split.carbs, fat: split.fat })));
}

// ---------------------------------------------------------------- weight

function weightCard(r) {
  const w = r.weight;
  if (!w.count && w.trendEnd === null) {
    return section(t('trends.week.bodyWeight'), { info: 'trend' }, el('p', { class: 't-sub muted' }, t('trends.week.noWeighIns')),
      el('a', { class: 'btn btn-sm', href: href('trends/weight') }, t('trends.week.logWeight')));
  }
  const inProgress = r.status === 'current';
  // Changes from the displayed (1-decimal) weights, so the figures on the card add up.
  const change = shownKgChange(w.trendEnd, w.prevTrend);
  const changePct = shownKgChangePct(w.trendEnd, w.prevTrend);
  const vsGoal = shownKgDiff(change, w.expected);
  const changeCls = change === null ? null : w.goalRate === null ? null : Math.sign(change) === Math.sign(w.goalRate) ? 'text-success' : 'text-warning';
  const kids = [
    el('div', { class: 'tiles' },
      statTile({ label: t('trends.basis.weighIns'), value: `${w.count}`, unit: inProgress ? t('trends.week.soFar') : '/ 7' }),
      statTile({ label: t('trends.week.average'), value: w.avg === null ? '–' : fixed(w.avg, 1), unit: 'kg' }),
      statTile({ label: t(inProgress ? 'trends.week.trendNow' : 'trends.week.trendSun'), value: w.trendEnd === null ? '–' : fixed(w.trendEnd, 1), unit: 'kg' })),
    el('div', { class: 't-sub' },
      el('span', { class: 'muted' }, t(inProgress ? 'trends.week.vsLastSunday' : 'trends.week.vsPrevWeek'), ' '),
      change === null ? el('span', { class: 'muted' }, '–')
        : el('span', { class: ['strong', changeCls] }, `${signed(change, 1)} kg (${withPercent(signed(changePct, 1))})`)),
  ];
  if (w.goalRate !== null) {
    kids.push(el('div', { class: 't-sub muted' },
      t('trends.week.goal', { goal: goalText(w.goalRate) }),
      w.expected !== null && change !== null
        ? ` → ${t(inProgress ? 'trends.week.expectedSoFar' : 'trends.week.expected', { kg: signed(w.expected, 1) })} · ${goalPace(w.goalRate, vsGoal)}` : null));
  } else {
    kids.push(el('div', { class: 't-sub muted wr-goal' }, t('trends.week.goalMaintain'),
      el('a', { class: 'btn btn-sm btn-ghost', href: href('settings/goal') }, t('trends.week.setGoal'))));
  }
  if (w.weighIns.length) {
    kids.push(el('div', { class: 't-sub muted wr-weighins' }, w.weighIns.map((x) => `${weekdayShort(weekday(x.date))} ${fixed(x.kg, 1)}`).join(' · ')));
  }
  return section(t('trends.week.bodyWeight'), { info: 'trend' }, kids);
}

/** 'ahead of goal by 0.1 kg' / 'behind' / 'on pace' (ahead = moved further in the goal's direction). */
function goalPace(goalRate, vsGoal) {
  if (Math.abs(vsGoal) < 0.05) return t('trends.week.onPace');
  const ahead = goalRate < 0 ? vsGoal < 0 : vsGoal > 0;
  return t(ahead ? 'trends.week.ahead' : 'trends.week.behind', { kg: fmtNum(Math.abs(vsGoal), 1) });
}

// ---------------------------------------------------------------- training

function trainingCard(r) {
  const tr = r.training;
  if (!tr.workouts.length) {
    const last = tr.prev.count ? t('trends.week.lastWeekTraining', {
      workouts: t('trends.dash.workouts', { count: tr.prev.done }), sets: t('trends.week.sets', { count: tr.prev.sets }) }) : null;
    return section(t('trends.week.training'), {}, el('p', { class: 't-sub muted' }, joinSentences([t('trends.week.noWorkouts'), last])),
      r.status === 'current' ? el('a', { class: 'btn btn-sm', href: href('workout') }, t('trends.week.startWorkout')) : null);
  }
  const kids = [
    el('div', { class: 'tiles' },
      statTile({ label: t('trends.week.metric.workouts'), value: `${tr.done}`, sub: tr.workouts.length > tr.done ? t('trends.week.unfinishedCount', { n: tr.workouts.length - tr.done }) : null }),
      statTile({ label: t('trends.week.metric.sets'), value: `${tr.sets}`, sub: t('trends.week.vsLast', { pct: formatPct(tr.setsPct) }) }),
      statTile({ label: t('trends.week.metric.load'), value: tonnage(tr.load).replace(/ (kg|t)$/, ''), unit: tonnage(tr.load).replace(/^.* /, ''), sub: t('trends.week.vsLast', { pct: formatPct(tr.loadPct) }) })),
    tr.dropsets ? el('div', { class: 't-sub muted' }, t('trends.week.dropsets', { count: tr.dropsets })) : null,
    el('div', { class: 'list wr-workouts' }, tr.workouts.map((w) => el('a', { class: 'list-item', href: href(w.finished ? `workout/history/${encodeURIComponent(w.id)}` : `workout/session/${encodeURIComponent(w.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, workoutTitle(w), w.finished ? null : tag(t('trends.week.unfinished'), { tone: 'warn' })),
        el('div', { class: 'li-sub' }, [fmtDate(w.date), t('trends.week.exercises', { count: w.exercises }), t('trends.week.sets', { count: w.sets }), tonnage(w.load)].join(' · '))),
      icon('chevron-right', { class: 'li-chevron' })))),
  ];
  if (tr.muscles.length) {
    kids.push(sub(t('trends.week.setsPerMuscle'), 'sets'));
    kids.push(el('table', { class: 'tr-table' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, t('trends.week.muscle')), el('th', { scope: 'col' }, t('trends.week.metric.sets')),
        tr.hasTargets ? [el('th', { scope: 'col' }, t('trends.checkin.target')), el('th', { scope: 'col' }, '%')] : null,
        el('th', { scope: 'col' }, t('trends.week.lastWk')))),
      el('tbody', null, tr.muscles.map((m) => el('tr', null,
        el('th', { scope: 'row' }, muscleName(m.muscle)),
        el('td', { class: 'strong' }, fmtNum(m.sets, 1)),
        tr.hasTargets ? [
          el('td', { class: 'muted' }, m.target === null ? '–' : fmtNum(m.target, 1)),
          el('td', { class: m.pct === null ? 'muted' : m.reached ? 'text-success' : null }, m.pct === null ? '–' : fmtPercent(m.pct)),
        ] : null,
        el('td', { class: 'muted' }, fmtNum(m.prev, 1)))))));
    if (!tr.hasTargets) kids.push(el('a', { class: 'btn btn-sm btn-ghost wr-link', href: href('workout/targets') }, t('trends.week.setTargets'), icon('chevron-right', { size: 18 })));
  }
  if (tr.records.length) {
    kids.push(sub(t('trends.week.records'), 'records'));
    kids.push(el('ul', { class: 'wr-records t-sub' }, tr.records.map((x) => el('li', null,
      icon('trophy', { size: 16, class: 'wr-trophy' }),
      el('span', null, el('span', { class: 'strong' }, x.deleted ? t('trends.week.deletedExercise') : exerciseName({ id: x.exerciseId, name: x.name })),
        ` · ${fmtDate(x.date)} · `, x.records.map((p) => recordText(p)).join(', '))))));
  }
  return section(t('trends.week.training'), { info: 'tonnage' }, kids);
}

function recordText(p) {
  if (p.kind === 'weight') return t('trends.week.recordHeaviest', { kg: fmtNum(p.weight, 2), reps: p.reps });
  if (p.kind === 'e1rm') return t('trends.week.recordE1rm', { kg: fmtNum(p.value, 1) });
  return p.weight ? t('trends.week.recordReps', { count: p.reps, kg: fmtNum(p.weight, 2) }) : t('trends.week.recordRepsBw', { count: p.reps });
}

// ---------------------------------------------------------------- comparison

function compareCard(r) {
  const fmt = (row, v) => {
    if (v === null) return '–';
    if (row.key === 'load') return tonnage(v);
    if (row.unit === 'kg') return fixed(v, 1);
    if (row.unit === 'kcal' || row.unit === 'g') return fmtGrouped(v);
    return fmtNum(v, 1);
  };
  const rows = r.comparison.filter((x) => x.cur !== null || x.prev !== null);
  return section(t('trends.week.compared'), { info: 'report' },
    rows.length ? el('table', { class: 'tr-table' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, el('span', { class: 'vh' }, t('trends.week.value'))), el('th', { scope: 'col' }, t('trends.week.this')),
        el('th', { scope: 'col' }, t('trends.week.last')), el('th', { scope: 'col' }, t('trends.week.change')))),
      el('tbody', null, rows.map((x) => el('tr', null,
        el('th', { scope: 'row' }, t(`trends.week.metric.${x.key}`), x.unit && x.key !== 'load' ? el('span', { class: 'muted t-sub' }, ` ${x.unit}`) : null),
        el('td', null, fmt(x, x.cur)),
        el('td', { class: 'muted' }, fmt(x, x.prev)),
        el('td', null, x.key === 'trend' || x.key === 'avgWeight' ? weightDiff(x) : formatPct(x.pct))))))
      : null,
    r.previous ? null : el('p', { class: 't-sub muted' }, t('trends.week.nothingBefore')));
}

/** Weight rows: change between the two displayed weights, so This − Last = Change on screen. */
function weightDiff(x) {
  const d = shownKgChange(x.cur, x.prev);
  return d === null ? '–' : `${signed(d, 1)} kg`;
}

// ---------------------------------------------------------------- check-in

function checkInCard(r) {
  const c = r.checkIn;
  const p = c.proposal;
  const decided = t(c.decision === 'accepted' ? 'trends.history.accepted' : 'trends.week.keptCurrent');
  return section(t('trends.week.checkIn'), { info: 'checkin' },
    el('div', { class: 't-sub' }, el('span', { class: 'strong' }, decided),
      c.createdAt ? el('span', { class: 'muted' }, ` · ${fmtDate(todayStr(new Date(c.createdAt)))}`) : null),
    p ? el('div', { class: 't-sub' }, el('span', { class: 'muted' }, t('trends.week.proposedLabel'), ' '),
      t('trends.week.proposedValue', { kcal: fmtGrouped(p.kcal), protein: fmtGrouped(p.protein), carbs: fmtGrouped(p.carbs), fat: fmtGrouped(p.fat) }))
      : el('div', { class: 't-sub muted' }, t('trends.week.noProposal')),
    el('div', { class: 't-sub' }, el('span', { class: 'muted' }, t('trends.week.targetAfter'), ' '), `${fmtGrouped(c.kcalTarget)} kcal`),
    el('div', { class: 't-sub muted' }, [
      c.tdee ? t(c.basis === 'formula' ? 'trends.week.expFormula' : 'trends.week.exp', { kcal: tdeeText(c.tdee) }) : null,
      c.trendKg ? t('trends.weight.rowTrend', { kg: fixed(c.trendKg, 1) }) : null,
      Number.isFinite(c.daysLogged) ? t('trends.week.daysReviewed', { count: c.daysLogged }) : null,
    ].filter(Boolean).join(' · ')),
    el('a', { class: 'btn btn-sm btn-ghost wr-link', href: href('trends/expenditure') }, t('trends.exp.title'), icon('chevron-right', { size: 18 })));
}
