// Weekly reports: list of weeks (trends/weeks) and one Monday–Sunday report (trends/week/:weekStart).
// All numbers come from src/core/weekly-report.js; definitions are documented there and repeated in
// the footnotes below.
import * as db from '../db/db.js';
import { el, pageHeader, emptyState, fmtNum, fmtDate, href, navigate } from '../ui/index.js';
import { today as todayStr, addDays, weekStart, weekday, isValidDate } from '../core/dates.js';
import { fmtPercent } from '../core/food-percent.js';
import { formatPct } from '../core/workout-progress.js';
import { buildWeeklyReport, weekSummaries, normaliseWeek, weekStatus } from '../core/weekly-report.js';
import { intakeChart } from './charts.js';
import { ensureCss, getAdaptiveSetting, signed, goalText, tdeeText } from './data.js';

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

/** Route: trends/weeks */
export async function mountWeeks(container) {
  ensureCss();
  container.append(pageHeader({ title: 'Weekly reports', back: 'trends' }));
  const now = todayStr();
  const [entries, weights, workouts, adaptive] = await Promise.all([
    db.getAll('diary'), db.getAll('weights'), db.getAll('workouts'), getAdaptiveSetting(),
  ]);
  const weeks = weekSummaries({ today: now, entries, weights, workouts, config: adaptive });
  const list = el('div', { class: 'list' }, weeks.map((w) => el('a', { class: 'list-item wr-week', href: href(`trends/week/${w.weekStart}`) },
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, weekRange(w.weekStart), w.status === 'current' ? el('span', { class: 'badge wr-badge' }, 'in progress') : null),
      el('div', { class: 'li-sub num' }, summaryLine(w))),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))));
  container.append(el('div', { class: 'card card-flush' }, list));
  if (weeks.length === 1 && !weeks[0].hasData) {
    container.append(el('p', { class: 'muted small tr-note' }, 'Log food in the diary, your weight and your workouts; each week then gets a report here.'));
  } else {
    container.append(el('p', { class: 'muted small tr-note' }, 'Weeks run Monday to Sunday. Only weeks with something logged are listed.'));
  }
}

function summaryLine(w) {
  if (!w.hasData) return 'Nothing logged yet';
  const parts = [];
  if (w.avgKcal !== null) parts.push(`avg ${fmtNum(w.avgKcal, 0)} kcal`);
  parts.push(w.status === 'current' ? `${w.loggedDays}/${w.countedDays} days so far` : `${w.loggedDays}/7 days logged`);
  if (w.sessions) parts.push(plural(w.workouts, 'workout'));
  if (w.avgWeight !== null) parts.push(`${fmtNum(w.avgWeight, 1)} kg`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------- report

/** Route: trends/week/:weekStart */
export async function mountWeek(container, params) {
  ensureCss();
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
  }));
  container.append(el('nav', { class: 'wr-nav', 'aria-label': 'Week navigation' },
    el('a', { class: 'btn btn-ghost wr-nav-btn', 'aria-label': 'Previous week', href: href(`trends/week/${prevWs}`) }, `‹ ${weekRange(prevWs)}`),
    nextWs > cur
      ? el('span', { class: 'small muted wr-nav-end' }, 'Latest week')
      : el('a', { class: 'btn btn-ghost wr-nav-btn', 'aria-label': 'Next week', href: href(`trends/week/${nextWs}`) }, `${weekRange(nextWs)} ›`)));

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
      status === 'current'
        ? 'Nothing logged this week yet. Log what you eat in the diary, weigh yourself in the morning and record your workouts — this report fills in as the week goes on.'
        : 'Nothing was logged this week. A report needs at least one diary day, weigh-in or workout. You can still add food to past days in the diary.',
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

function section(title, ...children) {
  return el('section', { class: 'card stack wr-card', 'aria-label': title }, el('h2', { class: 'wr-title' }, title), children);
}

function fig(label, value, sub, cls) {
  return el('div', { class: 'tr-fig' },
    el('div', { class: 'small muted' }, label),
    el('div', { class: ['tr-fig-val num', cls] }, value),
    sub ? el('div', { class: 'small muted' }, sub) : null);
}

function targetsNote(r) {
  const t = r.targets;
  if (r.status === 'current') return 'Targets: your current targets.';
  if (t.source === 'history') {
    return `Targets in force: ${fmtNum(t.kcal, 0)} kcal from the check-in of the week of ${fmtDate(t.fromWeek)}`
      + `${t.macroSource === 'history' ? '' : '; macros are your current targets'}. Manual target changes are not recorded, so this may differ if you edited targets by hand.`;
  }
  return 'Targets: current targets (no record of the targets in force that week).';
}

// ---------------------------------------------------------------- nutrition

function nutritionCard(r, now) {
  const n = r.nutrition;
  const t = r.targets;
  if (!n.days.some((d) => d.kcal)) {
    return section('Nutrition', el('p', { class: 'small muted' }, 'No food logged this week.'),
      el('a', { class: 'btn btn-sm', href: href(`diary/${r.status === 'current' ? now : r.weekStart}`) }, 'Open diary'));
  }
  const inProgress = r.status === 'current';
  const daysOf = inProgress ? `of ${n.countedDays} so far` : 'of 7';
  const head = el('div', { class: 'grid-3 tr-figs' },
    fig('Logged days', `${n.loggedDays}`, daysOf),
    fig('Complete', `${n.completeDays}`, n.incompleteDays ? `${n.incompleteDays} incomplete` : 'days averaged'),
    fig('On target', `${n.onTargetDays}`, t.kcal ? `±10 % of ${fmtNum(t.kcal, 0)}` : 'no target'));

  const table = el('table', { class: 'tr-table wr-table num' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Daily avg'), el('th', { scope: 'col' }, 'Eaten'), el('th', { scope: 'col' }, 'Target'), el('th', { scope: 'col' }, '%'))),
    el('tbody', null, ['kcal', 'protein', 'carbs', 'fat'].map((k) => {
      const pct = n.pct[k];
      return el('tr', null,
        el('th', { scope: 'row' }, LABEL[k]),
        el('td', null, n.avg[k] === null ? '–' : `${fmtNum(n.avg[k], 0)} ${UNIT[k]}`),
        el('td', { class: 'muted' }, t[k] === null ? '–' : `${fmtNum(t[k], 0)}`),
        el('td', { class: pct !== null && pct > 110 ? 'text-warning wr-strong' : null }, pct === null ? '–' : fmtPercent(pct)));
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

  const split = el('div', { class: 'stack wr-split' },
    splitRow('Eaten', n.split),
    splitRow('Target', n.targetSplit),
    el('div', { class: 'small muted' }, 'Share of calories from protein, carbs and fat (4 / 4 / 9 kcal per g), complete days.'));

  const extremes = el('div', { class: 'grid-2 tr-figs' },
    fig('Highest day', n.highest ? fmtNum(n.highest.kcal, 0) : '–', n.highest ? fmtDate(n.highest.date) : null),
    fig('Lowest day', n.lowest ? fmtNum(n.lowest.kcal, 0) : '–', n.lowest ? fmtDate(n.lowest.date) : null));

  const total = el('div', { class: 'small wr-total num' },
    el('span', { class: 'wr-strong' }, `Week total ${fmtNum(n.total.kcal, 0)} kcal`),
    n.total.target ? ` of ${fmtNum(n.total.target, 0)} for ${plural(n.completeDays, 'complete day')} (${fmtPercent(n.total.pct)})` : '',
    n.total.weekTarget ? el('div', { class: 'muted' }, `Full 7-day target ${fmtNum(n.total.weekTarget, 0)} kcal`) : null);

  const notes = [
    n.incompleteDays ? `* Incomplete: logged under half of a usual day (median of logged days within ± 4 weeks), so probably not fully logged. Excluded from averages, on-target days, highest/lowest and the total.` : null,
    inProgress ? 'Week in progress: averages use the days up to yesterday; today is shown but not counted.' : null,
    'On target = a complete day within ± 10 % of the calorie target.',
    targetsNote(r),
  ].filter(Boolean);

  return section('Nutrition', head, table, el('div', { class: 'tr-chart-wrap' }, chart), dayList, split, extremes, total,
    el('div', { class: 'wr-notes small muted' }, notes.map((x) => el('p', null, x))));
}

function dayRow(d, i, n, t) {
  const tags = [];
  if (d.isToday) tags.push(el('span', { class: 'badge' }, 'today, not counted'));
  if (d.incomplete) tags.push(el('span', { class: 'badge badge-warning' }, '* incomplete'));
  if (d.onTarget) tags.push(el('span', { class: 'badge wr-badge-ok' }, 'on target'));
  if (n.highest && n.highest.date === d.date && n.completeDays > 1) tags.push(el('span', { class: 'badge' }, 'highest'));
  if (n.lowest && n.lowest.date === d.date && n.completeDays > 1) tags.push(el('span', { class: 'badge' }, 'lowest'));
  const kcal = d.kcal ? `${fmtNum(d.kcal, 0)} kcal` : d.isFuture ? '' : 'not logged';
  const main = el('div', { class: 'li-main wr-day-main' },
    el('span', { class: 'wr-dow' }, DOW[i], el('span', { class: 'muted small' }, ` ${Number(d.date.slice(8, 10))}`)),
    el('span', { class: 'wr-tags' }, tags));
  const trail = el('div', { class: 'li-trail num wr-day-trail' },
    el('div', { class: d.kcal ? null : 'muted small' }, kcal),
    d.kcal && d.pct !== null && t.kcal ? el('div', { class: ['small', d.pct > 110 ? 'text-warning' : 'muted'] }, fmtPercent(d.pct)) : null);
  if (d.isFuture) return el('div', { class: 'list-item wr-day is-future' }, main, trail, el('span', { class: 'li-chevron' }));
  return el('a', { class: 'list-item wr-day', href: href(`diary/${d.date}`), 'aria-label': `${fmtDate(d.date)}, ${kcal}. Open in diary` },
    main, trail, el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
}

function splitRow(label, split) {
  if (!split) return el('div', { class: 'wr-split-row small' }, el('span', { class: 'wr-split-label muted' }, label), el('span', { class: 'muted' }, '–'));
  return el('div', { class: 'wr-split-row small' },
    el('span', { class: 'wr-split-label muted' }, label),
    el('div', { class: 'wr-split-bar', 'aria-hidden': 'true' },
      el('span', { class: 'wr-seg wr-seg-p', style: { width: `${split.protein}%` } }),
      el('span', { class: 'wr-seg wr-seg-c', style: { width: `${split.carbs}%` } }),
      el('span', { class: 'wr-seg wr-seg-f', style: { width: `${split.fat}%` } })),
    el('span', { class: 'num wr-split-txt' }, `P ${split.protein} · C ${split.carbs} · F ${split.fat} %`));
}

// ---------------------------------------------------------------- weight

function weightCard(r) {
  const w = r.weight;
  if (!w.count && w.trendEnd === null) {
    return section('Body weight', el('p', { class: 'small muted' }, 'No weigh-ins yet. Weigh yourself in the morning to see your weekly change.'),
      el('a', { class: 'btn btn-sm', href: href('trends/weight') }, 'Log weight'));
  }
  const inProgress = r.status === 'current';
  const changeCls = w.change === null ? null : w.goalRate === null ? null : Math.sign(w.change) === Math.sign(w.goalRate) ? 'text-success' : 'text-warning';
  const kids = [
    el('div', { class: 'grid-3 tr-figs' },
      fig('Weigh-ins', `${w.count}`, inProgress ? 'so far' : 'of 7'),
      fig('Average', w.avg === null ? '–' : fmtNum(w.avg, 1), 'kg'),
      fig(inProgress ? 'Trend now' : 'Trend Sun', w.trendEnd === null ? '–' : fmtNum(w.trendEnd, 1), 'kg')),
    el('div', { class: 'small num' },
      el('span', { class: 'muted' }, inProgress ? 'Change since last Sunday: ' : 'Change vs previous week: '),
      w.change === null ? el('span', { class: 'muted' }, '– (no earlier weigh-in)')
        : el('span', { class: ['wr-strong', changeCls] }, `${signed(w.change, 2)} kg (${signed(w.changePct, 2)} %)`)),
  ];
  if (w.goalRate !== null) {
    kids.push(el('div', { class: 'small num' },
      el('span', { class: 'muted' }, `Goal: ${goalText(w.goalRate).toLowerCase()}`),
      w.expected !== null && w.change !== null
        ? el('span', { class: 'muted' }, ` → ${signed(w.expected, 2)} kg expected${inProgress ? ' so far' : ''}; ${goalPace(w)}`)
        : null));
  } else {
    kids.push(el('div', { class: 'small muted' }, 'No weight goal set (maintain). Set one under Trends › Expenditure.'));
  }
  if (w.weighIns.length) {
    kids.push(el('div', { class: 'small muted num wr-weighins' }, w.weighIns.map((x) => `${DOW[weekday(x.date)]} ${fmtNum(x.kg, 1)}`).join(' · ')));
  }
  kids.push(el('p', { class: 'small muted wr-notes' }, 'Trend = smoothed weight (moving average), compared with its value at the end of the previous Sunday. Goal = your current goal setting.'));
  return section('Body weight', kids);
}

/** '0.09 kg ahead of goal' / 'behind goal' / 'on pace' (ahead = moved further in the goal's direction). */
function goalPace(w) {
  if (Math.abs(w.vsGoal) < 0.005) return 'on pace';
  const ahead = w.goalRate < 0 ? w.vsGoal < 0 : w.vsGoal > 0;
  return `${fmtNum(Math.abs(w.vsGoal), 2)} kg ${ahead ? 'ahead of' : 'behind'} goal`;
}

// ---------------------------------------------------------------- training

function trainingCard(r) {
  const t = r.training;
  if (!t.workouts.length) {
    return section('Training', el('p', { class: 'small muted' }, `No workouts this week.${t.prev.count ? ` Last week: ${plural(t.prev.done, 'workout')}, ${plural(t.prev.sets, 'set')}.` : ''}`),
      r.status === 'current' ? el('a', { class: 'btn btn-sm', href: href('workout') }, 'Start a workout') : null);
  }
  const kids = [
    el('div', { class: 'grid-3 tr-figs' },
      fig('Workouts', `${t.done}`, t.workouts.length > t.done ? `+${t.workouts.length - t.done} unfinished` : 'finished'),
      fig('Sets', `${t.sets}`, `${formatPct(t.setsPct)} vs last`),
      fig('Volume kg', fmtNum(t.load, 0), `${formatPct(t.loadPct)} vs last`)),
    t.dropsets ? el('div', { class: 'small muted' }, `Plus ${plural(t.dropsets, 'dropset')} (not in sets or volume).`) : null,
    el('div', { class: 'list wr-workouts' }, t.workouts.map((w) => el('a', { class: 'list-item', href: href(w.finished ? `workout/history/${encodeURIComponent(w.id)}` : `workout/session/${encodeURIComponent(w.id)}`) },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, w.name || 'Workout', w.finished ? null : el('span', { class: 'badge badge-warning wr-badge' }, 'unfinished')),
        el('div', { class: 'li-sub num' }, `${fmtDate(w.date)} · ${plural(w.exercises, 'exercise')} · ${plural(w.sets, 'set')} · ${fmtNum(w.load, 0)} kg`)),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›')))),
  ];
  if (t.muscles.length) {
    kids.push(el('h3', { class: 'wr-sub' }, 'Sets per muscle'));
    kids.push(el('table', { class: 'tr-table wr-table num' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Muscle'), el('th', { scope: 'col' }, 'Sets'),
        t.hasTargets ? [el('th', { scope: 'col' }, 'Target'), el('th', { scope: 'col' }, '%')] : null,
        el('th', { scope: 'col' }, 'Last wk'))),
      el('tbody', null, t.muscles.map((m) => el('tr', null,
        el('th', { scope: 'row' }, m.name),
        el('td', { class: 'wr-strong' }, fmtNum(m.sets, 1)),
        t.hasTargets ? [
          el('td', { class: 'muted' }, m.target === null ? '–' : fmtNum(m.target, 1)),
          el('td', { class: m.pct === null ? 'muted' : m.reached ? 'text-success' : null }, m.pct === null ? '–' : fmtPercent(m.pct)),
        ] : null,
        el('td', { class: 'muted' }, fmtNum(m.prev, 1)))))));
  }
  if (t.records.length) {
    kids.push(el('h3', { class: 'wr-sub' }, 'Personal records'));
    kids.push(el('ul', { class: 'wr-records small' }, t.records.map((x) => el('li', null,
      el('span', { class: 'wr-strong' }, x.name), ` · ${fmtDate(x.date)} · `,
      x.records.map((p) => recordText(p)).join(', ')))));
  }
  kids.push(el('p', { class: 'small muted wr-notes' },
    'Sets = done normal sets. Volume load = weight × reps of done normal sets (dropsets excluded). Sets per muscle count primary muscles fully and secondary ones by your volume weighting.'
    + `${t.hasTargets ? '' : ' Set weekly targets per muscle under Workout to see how much of each you reached.'}`));
  return section('Training', kids);
}

function recordText(p) {
  if (p.kind === 'weight') return `heaviest ${fmtNum(p.weight, 2)} kg × ${p.reps}`;
  if (p.kind === 'e1rm') return `best est. 1RM ${fmtNum(p.value, 1)} kg`;
  return `${p.reps} reps at ${p.weight ? `${fmtNum(p.weight, 2)} kg` : 'bodyweight'}`;
}

// ---------------------------------------------------------------- comparison

function compareCard(r) {
  const fmt = (row, v) => {
    if (v === null) return '–';
    if (row.unit === 'kg') return fmtNum(v, row.key === 'load' ? 0 : 1);
    if (row.unit === 'kcal' || row.unit === 'g') return fmtNum(v, 0);
    return fmtNum(v, 1);
  };
  const rows = r.comparison.filter((x) => x.cur !== null || x.prev !== null);
  return section('Compared with last week',
    rows.length ? el('table', { class: 'tr-table wr-table num' },
      el('thead', null, el('tr', null, el('th', { scope: 'col' }, ''), el('th', { scope: 'col' }, 'This'), el('th', { scope: 'col' }, 'Last'), el('th', { scope: 'col' }, 'Change'))),
      el('tbody', null, rows.map((x) => el('tr', null,
        el('th', { scope: 'row' }, x.label, x.unit ? el('span', { class: 'muted small' }, ` ${x.unit}`) : null),
        el('td', null, fmt(x, x.cur)),
        el('td', { class: 'muted' }, fmt(x, x.prev)),
        el('td', null, x.key === 'trend' || x.key === 'avgWeight' ? (x.diff === null ? '–' : `${signed(x.diff, 2)} kg`) : formatPct(x.pct))))))
      : null,
    r.previous ? null : el('p', { class: 'small muted' }, 'Nothing was logged the week before, so there is nothing to compare with.'),
    el('p', { class: 'small muted wr-notes' }, `${r.status === 'current' ? 'This week is not over yet. ' : ''}Change = (this − last) / last. “–” when last week has no value.`));
}

// ---------------------------------------------------------------- check-in

function checkInCard(r) {
  const c = r.checkIn;
  const p = c.proposal;
  const decided = c.decision === 'accepted' ? 'Accepted' : 'Kept current targets';
  return section('Weekly check-in',
    el('div', { class: 'small' }, el('span', { class: 'wr-strong' }, decided),
      c.createdAt ? el('span', { class: 'muted' }, ` · ${fmtDate(todayStr(new Date(c.createdAt)))}`) : null),
    p ? el('div', { class: 'small num' }, el('span', { class: 'muted' }, 'Proposed: '),
      `${fmtNum(p.kcal, 0)} kcal · P ${fmtNum(p.protein, 0)} g · C ${fmtNum(p.carbs, 0)} g · F ${fmtNum(p.fat, 0)} g`) : el('div', { class: 'small muted' }, 'No proposal (not enough data).'),
    el('div', { class: 'small num' }, el('span', { class: 'muted' }, 'Target after check-in: '), `${fmtNum(c.kcalTarget, 0)} kcal`),
    el('div', { class: 'small muted num' }, [
      c.tdee ? `Expenditure ${tdeeText(c.tdee)} kcal${c.basis === 'formula' ? ' (formula, not from your data)' : ''}` : null,
      c.trendKg ? `trend ${fmtNum(c.trendKg, 1)} kg` : null,
      Number.isFinite(c.daysLogged) ? `${plural(c.daysLogged, 'complete day')} reviewed` : null,
    ].filter(Boolean).join(' · ')),
    el('a', { class: 'btn btn-sm btn-ghost wr-link', href: href('trends/expenditure') }, 'Expenditure & target ›'));
}
