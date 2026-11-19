// Weekly reports: list of weeks (trends/weeks) and one Monday–Sunday report (trends/week/:weekStart).
// All numbers come from src/core/weekly-report.js; definitions are documented there and repeated in
// the info sheets (report, complete, trend, sets, tonnage, macros).
import * as db from '../db/db.js';
import { el, pageHeader, emptyState, fmtNum, fmtDate, fmtGrouped, href, navigate, cardHeader, statTile, tag, icon, infoButton } from '../ui/index.js';
import { today as todayStr, addDays, weekStart, weekday, isValidDate } from '../core/dates.js';
import { fmtPercent } from '../core/food-percent.js';
import { formatPct } from '../core/workout-progress.js';
import { buildWeeklyReport, weekSummaries, normaliseWeek, weekStatus } from '../core/weekly-report.js';
import { intakeChart } from './charts.js';
import { fixed, ensureCss, getAdaptiveSetting, signed, goalText, tdeeText } from './data.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LABEL = { kcal: 'Calories', protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };
const UNIT = { kcal: 'kcal', protein: 'g', carbs: 'g', fat: 'g' };

/** '9 – 15 Nov', '28 Dec – 3 Jan 2027' (year shown when not the current one). */
export function weekRange(ws) {
  const we = addDays(ws, 6);
  const d = (s) => Number(s.slice(8, 10));
  const m = (s) => MONTHS[Number(s.slice(5, 7)) - 1];
  const y = (s) => s.slice(0, 4);
  const thisYear = String(new Date().getFullYear());
  const tail = y(we) !== thisYear || y(ws) !== y(we) ? ` ${y(we)}` : '';
  if (m(ws) === m(we)) return `${d(ws)} – ${d(we)} ${m(we)}${tail}`;
  return `${d(ws)} ${m(ws)}${y(ws) !== y(we) ? ` ${y(ws)}` : ''} – ${d(we)} ${m(we)}${tail}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------- list

/** Tonnage: kg below 1000, t (one decimal) from 1000. */
const tonnage = (kg) => (kg === null || kg === undefined ? '–' : kg < 1000 ? `${fmtGrouped(kg)} kg` : `${fmtNum(kg / 1000, 1)} t`);

/** Route: trends/weeks */
export async function mountWeeks(container) {
  ensureCss();
  container.classList.add('tr-view');
  container.append(pageHeader({ title: 'Weekly reports', back: 'trends', info: 'report' }));
  const now = todayStr();
  const [entries, weights, workouts, adaptive] = await Promise.all([
    db.getAll('diary'), db.getAll('weights'), db.getAll('workouts'), getAdaptiveSetting(),
  ]);
  const weeks = weekSummaries({ today: now, entries, weights, workouts, config: adaptive });
  const list = el('div', { class: 'list' }, weeks.map((w) => el('a', { class: 'list-item wr-week', href: href(`trends/week/${w.weekStart}`) },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, weekRange(w.weekStart), w.status === 'current' ? tag('In progress', { tone: 'accent' }) : null),
      el('div', { class: 'li-sub' }, summaryLine(w))),
    icon('chevron-right', { class: 'li-chevron' }))));
  container.append(el('div', { class: 'card card-flush' }, list));
  if (weeks.length === 1 && !weeks[0].hasData) container.append(el('p', { class: 't-sub muted tr-note' }, 'No weeks logged yet.'));
}

function summaryLine(w) {
  if (!w.hasData) return 'Nothing logged yet';
  const parts = [];
  if (w.avgKcal !== null) parts.push(`${fmtGrouped(w.avgKcal)} kcal avg`);
  parts.push(w.status === 'current' ? `${w.loggedDays} / ${w.countedDays} days so far` : `${w.loggedDays} / 7 days`);
  if (w.sessions) parts.push(plural(w.workouts, 'workout'));
  if (w.avgWeight !== null) parts.push(`${fixed(w.avgWeight, 1)} kg`);
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
    subtitle: status === 'current' ? 'This week · in progress' : ws === addDays(cur, -7) ? 'Last week' : `Week of ${fmtDate(ws)}`,
    back: 'trends/weeks',
    info: 'report',
  }));
  container.append(el('nav', { class: 'wr-nav', 'aria-label': 'Week navigation' },
    el('a', { class: 'btn btn-sm btn-ghost wr-nav-btn', 'aria-label': `Previous week, ${weekRange(prevWs)}`, href: href(`trends/week/${prevWs}`) },
      icon('chevron-left', { size: 18 }), weekRange(prevWs)),
    nextWs > cur
      ? el('span', { class: 't-sub muted wr-nav-end' }, 'Latest week')
      : el('a', { class: 'btn btn-sm btn-ghost wr-nav-btn', 'aria-label': `Next week, ${weekRange(nextWs)}`, href: href(`trends/week/${nextWs}`) },
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
    getAdaptiveSetting(),
  ]);
  const r = buildWeeklyReport({
    weekStart: ws, today: now, entries, weights, workouts, exercises: new Map(exList.map((e) => [e.id, e])),
    targets, history, goal, volumeWeights: volume, setTargets, config: adaptive,
  });

  if (!r.hasData) {
    container.append(el('div', { class: 'card' }, emptyState(
      status === 'current' ? 'Nothing logged this week yet.' : 'Nothing logged this week.',
      el('div', { class: 'row wr-empty-actions' },
        el('a', { class: 'btn btn-primary', href: href(`diary/${status === 'current' ? now : ws}`) }, 'Open diary'),
        el('a', { class: 'btn', href: href('trends/weight') }, 'Log weight'),
        el('a', { class: 'btn', href: href('workout') }, 'Workout')))));
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
  const t = r.targets;
  if (r.status === 'current') return null;
  if (t.source === 'history') return `Target ${fmtGrouped(t.kcal)} kcal from check-in ${fmtDate(t.fromWeek)}`;
  return 'Targets: current (none recorded that week)';
}

// ---------------------------------------------------------------- nutrition

function nutritionCard(r, now) {
  const n = r.nutrition;
  const t = r.targets;
  if (!n.days.some((d) => d.kcal)) {
    return section('Nutrition', {}, el('p', { class: 't-sub muted' }, 'No food logged this week.'),
      el('a', { class: 'btn btn-sm', href: href(`diary/${r.status === 'current' ? now : r.weekStart}`) }, 'Open diary'));
  }
  const inProgress = r.status === 'current';
  const head = el('div', { class: 'tiles' },
    statTile({ label: 'Logged', value: `${n.loggedDays}`, unit: inProgress ? `/ ${n.countedDays}` : '/ 7' }),
    statTile({ label: 'Complete', value: `${n.completeDays}`, sub: n.incompleteDays ? `${n.incompleteDays} incomplete` : null }),
    statTile({ label: 'On target', value: `${n.onTargetDays}`, sub: t.kcal ? `± 10 % of ${fmtGrouped(t.kcal)}` : 'no target' }));

  const table = el('table', { class: 'tr-table' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Daily avg'), el('th', { scope: 'col' }, 'Eaten'), el('th', { scope: 'col' }, 'Target'), el('th', { scope: 'col' }, '%'))),
    el('tbody', null, ['kcal', 'protein', 'carbs', 'fat'].map((k) => {
      const pct = n.pct[k];
      return el('tr', null,
        el('th', { scope: 'row' }, LABEL[k]),
        el('td', null, n.avg[k] === null ? '–' : `${fmtGrouped(n.avg[k])} ${UNIT[k]}`),
        el('td', { class: 'muted' }, t[k] === null ? '–' : fmtGrouped(t[k])),
        el('td', { class: pct !== null && pct > 110 ? 'text-warning strong' : null }, pct === null ? '–' : fmtPercent(pct)));
    })));

  const days7 = n.days.map((d) => ({ date: d.date, kcal: d.kcal }));
  const chart = intakeChart(days7, t.kcal || null, [{ from: r.weekStart, to: r.weekEnd, avg: n.avg.kcal }], now);
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

  const dayList = el('div', { class: 'list wr-days' }, n.days.map((d, i) => dayRow(d, i, n, t)));

  const split = el('div', { class: 'wr-split' },
    sub('Split · complete days', 'macros'),
    splitRow('Eaten', n.split),
    splitRow('Target', n.targetSplit));

  const extremes = el('div', { class: 'tiles wr-tiles-2' },
    statTile({ label: 'Highest day', value: n.highest ? fmtGrouped(n.highest.kcal) : '–', unit: n.highest ? 'kcal' : null, sub: n.highest ? fmtDate(n.highest.date) : null }),
    statTile({ label: 'Lowest day', value: n.lowest ? fmtGrouped(n.lowest.kcal) : '–', unit: n.lowest ? 'kcal' : null, sub: n.lowest ? fmtDate(n.lowest.date) : null }));

  const total = el('div', { class: 't-sub wr-total' },
    el('span', { class: 'strong' }, `Week total ${fmtGrouped(n.total.kcal)} kcal`),
    n.total.target ? ` of ${fmtGrouped(n.total.target)} for ${plural(n.completeDays, 'complete day')} (${fmtPercent(n.total.pct)})` : '',
    n.total.weekTarget ? el('div', { class: 'muted' }, `Full 7-day target ${fmtGrouped(n.total.weekTarget)} kcal`) : null);

  const note = targetsNote(r);
  const notes = [
    n.incompleteDays ? '* Incomplete, not counted' : null,
    note,
  ].filter(Boolean);

  return section('Nutrition', { info: 'complete' }, head, table, el('div', { class: 'tr-chart-wrap' }, chart), dayList, split, extremes, total,
    notes.length ? el('div', { class: 'wr-notes t-sub muted' }, notes.map((x) => el('p', null, x))) : null);
}

function dayRow(d, i, n, t) {
  const tags = [];
  if (d.isToday) tags.push(tag('today, not counted'));
  if (d.incomplete) tags.push(tag('* incomplete', { tone: 'warn' }));
  if (d.onTarget) tags.push(tag('on target', { tone: 'ok', icon: 'check' }));
  if (n.highest && n.highest.date === d.date && n.completeDays > 1) tags.push(tag('highest'));
  if (n.lowest && n.lowest.date === d.date && n.completeDays > 1) tags.push(tag('lowest'));
  const kcal = d.kcal ? `${fmtGrouped(d.kcal)} kcal` : d.isFuture ? '' : 'not logged';
  const main = el('div', { class: 'li-main wr-day-main' },
    el('span', { class: 'wr-dow' }, DOW[i], el('span', { class: 'muted' }, ` ${Number(d.date.slice(8, 10))}`)),
    el('span', { class: 'wr-tags' }, tags));
  const trail = el('div', { class: 'li-trail wr-day-trail' },
    el('div', { class: d.kcal ? null : 'muted t-sub' }, kcal),
    d.kcal && d.pct !== null && t.kcal ? el('div', { class: ['t-sub', d.pct > 110 ? 'text-warning' : 'muted'] }, fmtPercent(d.pct)) : null);
  if (d.isFuture) return el('div', { class: 'list-item wr-day is-future' }, main, trail, el('span', { class: 'wr-chev-space' }));
  return el('a', { class: 'list-item wr-day', href: href(`diary/${d.date}`), 'aria-label': `${fmtDate(d.date)}, ${kcal}. Open in diary` },
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
    el('span', { class: 'wr-split-txt' }, `P ${split.protein} · C ${split.carbs} · F ${split.fat} %`));
}

// ---------------------------------------------------------------- weight

function weightCard(r) {
  const w = r.weight;
  if (!w.count && w.trendEnd === null) {
    return section('Body weight', { info: 'trend' }, el('p', { class: 't-sub muted' }, 'No weigh-ins this week.'),
      el('a', { class: 'btn btn-sm', href: href('trends/weight') }, 'Log weight'));
  }
  const inProgress = r.status === 'current';
  const changeCls = w.change === null ? null : w.goalRate === null ? null : Math.sign(w.change) === Math.sign(w.goalRate) ? 'text-success' : 'text-warning';
  const kids = [
    el('div', { class: 'tiles' },
      statTile({ label: 'Weigh-ins', value: `${w.count}`, unit: inProgress ? 'so far' : '/ 7' }),
      statTile({ label: 'Average', value: w.avg === null ? '–' : fixed(w.avg, 1), unit: 'kg' }),
      statTile({ label: inProgress ? 'Trend now' : 'Trend Sun', value: w.trendEnd === null ? '–' : fixed(w.trendEnd, 1), unit: 'kg' })),
    el('div', { class: 't-sub' },
      el('span', { class: 'muted' }, inProgress ? 'vs last Sunday: ' : 'vs previous week: '),
      w.change === null ? el('span', { class: 'muted' }, '–')
        : el('span', { class: ['strong', changeCls] }, `${signed(w.change, 1)} kg (${signed(w.changePct, 1)} %)`)),
  ];
  if (w.goalRate !== null) {
    kids.push(el('div', { class: 't-sub muted' },
      `Goal ${goalText(w.goalRate)}`,
      w.expected !== null && w.change !== null ? ` → ${signed(w.expected, 1)} kg expected${inProgress ? ' so far' : ''} · ${goalPace(w)}` : null));
  } else {
    kids.push(el('div', { class: 't-sub muted wr-goal' }, 'Goal: maintain',
      el('a', { class: 'btn btn-sm btn-ghost', href: href('settings/goal') }, 'Set goal')));
  }
  if (w.weighIns.length) {
    kids.push(el('div', { class: 't-sub muted wr-weighins' }, w.weighIns.map((x) => `${DOW[weekday(x.date)]} ${fixed(x.kg, 1)}`).join(' · ')));
  }
  return section('Body weight', { info: 'trend' }, kids);
}

/** 'ahead of goal by 0.1 kg' / 'behind' / 'on pace' (ahead = moved further in the goal's direction). */
function goalPace(w) {
  if (Math.abs(w.vsGoal) < 0.05) return 'on pace';
  const ahead = w.goalRate < 0 ? w.vsGoal < 0 : w.vsGoal > 0;
  return `${fmtNum(Math.abs(w.vsGoal), 1)} kg ${ahead ? 'ahead of' : 'behind'} goal`;
}

// ---------------------------------------------------------------- training

function trainingCard(r) {
  const t = r.training;
  if (!t.workouts.length) {
    return section('Training', {}, el('p', { class: 't-sub muted' }, `No workouts this week.${t.prev.count ? ` Last week: ${plural(t.prev.done, 'workout')}, ${plural(t.prev.sets, 'set')}.` : ''}`),
      r.status === 'current' ? el('a', { class: 'btn btn-sm', href: href('workout') }, 'Start a workout') : null);
  }
  const kids = [
    el('div', { class: 'tiles' },
      statTile({ label: 'Workouts', value: `${t.done}`, sub: t.workouts.length > t.done ? `+${t.workouts.length - t.done} unfinished` : null }),
      statTile({ label: 'Sets', value: `${t.sets}`, sub: `${formatPct(t.setsPct)} vs last` }),
      statTile({ label: 'Tonnage', value: tonnage(t.load).split(' ')[0], unit: t.load < 1000 ? 'kg' : 't', sub: `${formatPct(t.loadPct)} vs last` })),
    t.dropsets ? el('div', { class: 't-sub muted' }, `+${plural(t.dropsets, 'dropset')}, not counted`) : null,
    el('div', { class: 'list wr-workouts' }, t.workouts.map((w) => el('a', { class: 'list-item', href: href(w.finished ? `workout/history/${encodeURIComponent(w.id)}` : `workout/session/${encodeURIComponent(w.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, w.name || 'Workout', w.finished ? null : tag('unfinished', { tone: 'warn' })),
        el('div', { class: 'li-sub' }, `${fmtDate(w.date)} · ${plural(w.exercises, 'exercise')} · ${plural(w.sets, 'set')} · ${tonnage(w.load)}`)),
      icon('chevron-right', { class: 'li-chevron' })))),
  ];
  if (t.muscles.length) {
    kids.push(sub('Sets per muscle', 'sets'));
    kids.push(el('table', { class: 'tr-table' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Muscle'), el('th', { scope: 'col' }, 'Sets'),
        t.hasTargets ? [el('th', { scope: 'col' }, 'Target'), el('th', { scope: 'col' }, '%')] : null,
        el('th', { scope: 'col' }, 'Last wk'))),
      el('tbody', null, t.muscles.map((m) => el('tr', null,
        el('th', { scope: 'row' }, m.name),
        el('td', { class: 'strong' }, fmtNum(m.sets, 1)),
        t.hasTargets ? [
          el('td', { class: 'muted' }, m.target === null ? '–' : fmtNum(m.target, 1)),
          el('td', { class: m.pct === null ? 'muted' : m.reached ? 'text-success' : null }, m.pct === null ? '–' : fmtPercent(m.pct)),
        ] : null,
        el('td', { class: 'muted' }, fmtNum(m.prev, 1)))))));
    if (!t.hasTargets) kids.push(el('a', { class: 'btn btn-sm btn-ghost wr-link', href: href('workout/targets') }, 'Set targets', icon('chevron-right', { size: 18 })));
  }
  if (t.records.length) {
    kids.push(sub('Records', 'records'));
    kids.push(el('ul', { class: 'wr-records t-sub' }, t.records.map((x) => el('li', null,
      icon('trophy', { size: 16, class: 'wr-trophy' }),
      el('span', null, el('span', { class: 'strong' }, x.name), ` · ${fmtDate(x.date)} · `, x.records.map((p) => recordText(p)).join(', '))))));
  }
  return section('Training', { info: 'tonnage' }, kids);
}

function recordText(p) {
  if (p.kind === 'weight') return `heaviest ${fmtNum(p.weight, 2)} kg × ${p.reps}`;
  if (p.kind === 'e1rm') return `est. 1RM ${fmtNum(p.value, 1)} kg`;
  return `${p.reps} reps at ${p.weight ? `${fmtNum(p.weight, 2)} kg` : 'bodyweight'}`;
}

// ---------------------------------------------------------------- comparison

function compareCard(r) {
  const fmt = (row, v) => {
    if (v === null) return '–';
    if (row.key === 'load') return tonnage(v);
    if (row.unit === 'kg') return fmtNum(v, 1);
    if (row.unit === 'kcal' || row.unit === 'g') return fmtGrouped(v);
    return fmtNum(v, 1);
  };
  const rows = r.comparison.filter((x) => x.cur !== null || x.prev !== null);
  return section('Compared with last week', { info: 'report' },
    rows.length ? el('table', { class: 'tr-table' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, el('span', { class: 'vh' }, 'Value')), el('th', { scope: 'col' }, 'This'), el('th', { scope: 'col' }, 'Last'), el('th', { scope: 'col' }, 'Change'))),
      el('tbody', null, rows.map((x) => el('tr', null,
        el('th', { scope: 'row' }, x.label, x.unit && x.key !== 'load' ? el('span', { class: 'muted t-sub' }, ` ${x.unit}`) : null),
        el('td', null, fmt(x, x.cur)),
        el('td', { class: 'muted' }, fmt(x, x.prev)),
        el('td', null, x.key === 'trend' || x.key === 'avgWeight' ? (x.diff === null ? '–' : `${signed(x.diff, 1)} kg`) : formatPct(x.pct))))))
      : null,
    r.previous ? null : el('p', { class: 't-sub muted' }, 'Nothing logged the week before.'));
}

// ---------------------------------------------------------------- check-in

function checkInCard(r) {
  const c = r.checkIn;
  const p = c.proposal;
  const decided = c.decision === 'accepted' ? 'Accepted' : 'Kept current targets';
  return section('Check-in', { info: 'checkin' },
    el('div', { class: 't-sub' }, el('span', { class: 'strong' }, decided),
      c.createdAt ? el('span', { class: 'muted' }, ` · ${fmtDate(todayStr(new Date(c.createdAt)))}`) : null),
    p ? el('div', { class: 't-sub' }, el('span', { class: 'muted' }, 'Proposed: '),
      `${fmtGrouped(p.kcal)} kcal · P ${fmtGrouped(p.protein)} · C ${fmtGrouped(p.carbs)} · F ${fmtGrouped(p.fat)} g`) : el('div', { class: 't-sub muted' }, 'No proposal (not enough data).'),
    el('div', { class: 't-sub' }, el('span', { class: 'muted' }, 'Target after check-in: '), `${fmtGrouped(c.kcalTarget)} kcal`),
    el('div', { class: 't-sub muted' }, [
      c.tdee ? `Expenditure ${tdeeText(c.tdee)} kcal${c.basis === 'formula' ? ' (formula)' : ''}` : null,
      c.trendKg ? `trend ${fixed(c.trendKg, 1)} kg` : null,
      Number.isFinite(c.daysLogged) ? `${plural(c.daysLogged, 'complete day')} reviewed` : null,
    ].filter(Boolean).join(' · ')),
    el('a', { class: 'btn btn-sm btn-ghost wr-link', href: href('trends/expenditure') }, 'Expenditure', icon('chevron-right', { size: 18 })));
}
