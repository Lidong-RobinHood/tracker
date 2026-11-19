// Analysis hub: "how am I doing" in one screen, leading to every detailed view.
// Route: workout/analysis. Numbers come from core/workout-overview.js (records, routines,
// exercises, month, weekly sets) and core/workout-analytics.js analyseWorkout (last workout), so they
// equal the screens they link to. All workouts are read once and scanned once.
import * as db from '../db/db.js';
import { el, append, pageHeader, href, fmtNum, fmtDate } from '../ui/index.js';
import { today } from '../core/dates.js';
import { isBaseline } from '../core/baseline.js';
import { isLoggedWorkout } from '../core/workout.js';
import { analyseWorkout, METRICS } from '../core/workout-analytics.js';
import { formatPct } from '../core/workout-progress.js';
import { volumeWeights } from '../core/volume.js';
import { scanHistory, recentRecords, monthComparison, routineOverview, topExercises, weeklyMuscleSets } from '../core/workout-overview.js';
import { ensureCss, loadExercises, loadWorkouts, loadRoutines, findUnfinished, exName, shortDate } from './data.js';
import { loadTargets } from './targets.js';
import { workoutNav } from './subnav.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKS = 8;
const SET_WEEKS = 6;

// ---------------------------------------------------------------- formatting (as on the analysis screen)

/** '1 912.5' (narrow-space thousands, up to 1 decimal). */
function tNum(n) {
  if (!Number.isFinite(n)) return '–';
  const [i, f] = fmtNum(n, 1).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (f ? `.${f}` : '');
}
const tKg = (n) => `${tNum(n)} kg`;
/** Whole kg with grouped thousands (month totals). */
const wholeKg = (n) => tNum(Math.round(n));
const pctText = (p) => formatPct(p).replace(' ', ' ');

function valueText(metric, b) {
  if (!b) return '–';
  switch (metric) {
    case 'heaviest': return `${fmtNum(b.weight, 2)} kg × ${b.reps}`;
    case 'tonnageSet': return `${fmtNum(b.weight, 2)} × ${b.reps} = ${tKg(b.value)}`;
    case 'e1rm': return `${fmtNum(b.value, 1)} kg`;
    case 'tonnage': return tKg(b.value);
    default: return `${fmtNum(b.value, 0)} reps`;
  }
}

/** '102.5 → 105 kg' style: previous → new, for one record. */
function changeText(r) {
  const p = r.prev; const c = r.cur;
  switch (r.metric) {
    case 'heaviest': return `${fmtNum(p.weight, 2)} × ${p.reps} → ${fmtNum(c.weight, 2)} kg × ${c.reps}`;
    case 'e1rm': return `${fmtNum(p.value, 1)} → ${fmtNum(c.value, 1)} kg`;
    case 'tonnageSet': case 'tonnage': return `${tNum(p.value)} → ${tKg(c.value)}`;
    default: return `${fmtNum(p.value, 0)} → ${fmtNum(c.value, 0)} reps`;
  }
}

/** '+2.5 kg', '+1 rep' */
function absText(r) {
  const d = r.delta;
  if (!d) return '';
  const unit = d.unit === 'reps' ? (Math.abs(d.abs) === 1 ? 'rep' : 'reps') : d.unit;
  const v = r.metric === 'tonnage' || r.metric === 'tonnageSet' ? tNum(Math.abs(d.abs)) : fmtNum(Math.abs(d.abs), r.metric === 'e1rm' ? 1 : 2);
  return `${d.abs >= 0 ? '+' : '−'}${v} ${unit}`;
}

const summaryHref = (id) => href(`workout/summary/${encodeURIComponent(id)}`);
const dayRange = (r) => `${Number(r.from.slice(8, 10))}–${shortDate(r.to)}`;

// ---------------------------------------------------------------- mount

export async function mountAnalysisHub(container) {
  ensureCss();
  const [workouts, exMap, routines, rawWeights, targets] = await Promise.all([
    loadWorkouts(), loadExercises(), loadRoutines(), db.getSetting('volume'), loadTargets(),
  ]);
  const now = today();
  const name = (id) => exName(exMap, id);
  const open = findUnfinished(workouts);
  const last = workouts.find((w) => isLoggedWorkout(w) && !isBaseline(w)) || null;
  const scan = scanHistory(workouts);

  container.classList.add('wk-an', 'wk-hub');
  append(container, pageHeader({ title: 'Workout' }), workoutNav('analysis'));

  if (open) {
    append(container, el('a', { class: 'wk-hub-open', href: href(`workout/session/${encodeURIComponent(open.id)}`) },
      el('span', { class: 'grow' }, el('span', { class: 'wk-hub-kicker' }, 'Not finished'), ' ', `${open.name} · ${shortDate(open.date)}`),
      el('span', { class: 'wk-hub-go' }, 'Resume ›')));
  }

  if (!last) {
    append(container, el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Last workout'),
      el('div', { class: 'wk-an-rules' },
        el('p', { class: 'wk-an-line' }, open ? 'No finished workout yet. Finish the one in progress to see its analysis here.' : 'No finished workout yet.'),
        el('p', { class: 'wk-an-line muted' }, 'After each workout this screen shows its tonnage, records, routine trends, your most trained exercises and weekly sets per muscle. A starting point lets the first session compare with your current bests.')),
      el('div', { class: 'wk-hub-actions' },
        el('a', { class: 'btn btn-primary', href: href('workout') }, open ? 'Go to Train' : 'Start a workout'),
        el('a', { class: 'btn', href: href('workout/starting-point') }, 'Starting point'))));
    append(container, linksSection(targets));
    return;
  }

  append(container, lastSection(last, analyseWorkout(workouts, last, exMap)));
  append(container, monthSection(monthComparison(scan.sessions, scan.byWorkout, now)));
  append(container, recordsSection(recentRecords(scan.records, 8), name));
  if (routines.length) append(container, routinesSection(routines, routineOverview(workouts, routines)));
  append(container, exercisesSection(topExercises(scan.histories, now, { weeks: WEEKS, limit: 6 }), name));
  append(container, setsSection(weeklyMuscleSets(workouts, exMap, volumeWeights(rawWeights), now, { weeks: SET_WEEKS, targets }), targets));
}

// ---------------------------------------------------------------- sections

function stat(label, value, sub, title) {
  return el('div', { class: 'wk-an-stat', title: title || null },
    el('div', { class: 'wk-an-stat-label' }, label),
    el('div', { class: 'wk-an-stat-value num' }, value),
    sub ? el('div', { class: 'wk-an-stat-sub num' }, sub) : null);
}

function lastSection(w, res) {
  const t = res.totals;
  const prev = res.routine.prev;
  const prs = res.records.filter((r) => r.status === 'pr').length;
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Last workout'),
    el('a', { class: 'wk-hub-head', href: summaryHref(w.id) },
      el('span', { class: 'wk-hub-name' }, w.name || 'Workout'),
      el('span', { class: 'wk-hub-date num' }, fmtDate(w.date))),
    el('div', { class: 'wk-an-strip' },
      stat('Tonnage', tKg(t.load), t.dropLoad ? `+ ${tKg(t.dropLoad)} drop` : null),
      stat('Sets', String(t.sets), t.dropsets ? `+ ${t.dropsets} drop` : null),
      prev
        ? stat(`vs ${shortDate(prev.date)}`, res.routine.pct === null ? '–' : pctText(res.routine.pct), tKg(res.routine.prevTonnage), `Tonnage versus the previous ${w.name} on ${fmtDate(prev.date)}`)
        : stat('vs last time', '–', w.routineId ? 'first of routine' : 'no routine'),
      el('div', { class: ['wk-an-stat', prs && 'is-rec'] },
        el('div', { class: 'wk-an-stat-label' }, 'Records'),
        el('div', { class: 'wk-an-stat-value num' }, String(prs)),
        el('div', { class: 'wk-an-stat-sub' }, 'all-time'))),
    el('a', { class: 'btn btn-block', href: summaryHref(w.id) }, 'Full analysis'));
}

function monthSection(m) {
  const mName = MONTHS[Number(m.month.slice(5, 7)) - 1];
  const vs = (key, text) => `last ${text}${m.pct[key] === null ? '' : ` · ${pctText(m.pct[key])}`}`;
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, `This month · ${dayRange(m.curRange)}`),
    el('div', { class: 'wk-an-strip is-3' },
      stat('Sessions', String(m.cur.sessions), vs('sessions', String(m.prev.sessions))),
      stat('Tonnage', `${wholeKg(m.cur.tonnage)} kg`, vs('tonnage', wholeKg(m.prev.tonnage))),
      stat('Records', String(m.cur.records), vs('records', String(m.prev.records)))),
    el('p', { class: 'wk-an-note' }, `${mName} so far versus the same days of last month (${dayRange(m.prevRange)}). Starting point and unfinished workouts not counted.`));
}

function recordsSection(groups, name) {
  const sec = el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Recent records'));
  if (!groups.length) {
    append(sec, el('div', { class: 'wk-an-rules' },
      el('p', { class: 'wk-an-line muted' }, 'No records yet. A record is a set or session that beats every earlier one for that exercise; the first time you do an exercise only sets the mark to beat.')));
    return sec;
  }
  append(sec, el('div', { class: 'wk-hub-list' }, groups.map((g) => {
    const more = g.others.map((r) => METRICS[r.metric].short);
    return el('a', { class: 'wk-hub-row', href: summaryHref(g.workoutId) },
      el('div', { class: 'wk-hub-main' },
        el('div', { class: 'wk-hub-title' }, name(g.exerciseId)),
        el('div', { class: 'wk-hub-sub num' }, `${METRICS[g.lead.metric].label} ${changeText(g.lead)}`),
        more.length ? el('div', { class: 'wk-hub-sub' }, `also ${more.join(', ')}`) : null),
      el('div', { class: 'wk-hub-trail num' },
        el('div', { class: 'wk-hub-rec' }, absText(g.lead)),
        el('div', { class: 'wk-hub-sub' }, shortDate(g.date))),
      el('span', { class: 'wk-an-chev', 'aria-hidden': 'true' }, '›'));
  })));
  append(sec, el('p', { class: 'wk-an-note' }, 'All-time records, newest first; each opens that workout’s analysis.'));
  return sec;
}

function routinesSection(routines, rows) {
  const byId = new Map(rows.map((r) => [r.routineId, r]));
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'Routines'),
    el('div', { class: 'wk-hub-list' }, routines.map((r) => {
      const o = byId.get(r.id);
      const sub = o.last ? `${o.sessions} session${o.sessions === 1 ? '' : 's'} · last ${shortDate(o.last.date)}` : 'Not done yet';
      return el('a', { class: 'wk-hub-row', href: href(`workout/routines/${encodeURIComponent(r.id)}/progress`) },
        el('div', { class: 'wk-hub-main' },
          el('div', { class: 'wk-hub-title' }, r.name),
          el('div', { class: 'wk-hub-sub num' }, sub)),
        o.history.length > 1 ? spark(o.history.map((h) => h.tonnage), `Session tonnage of the last ${o.history.length} sessions`) : null,
        o.last ? el('div', { class: 'wk-hub-trail num' },
          el('div', { class: 'wk-hub-val' }, tKg(o.last.tonnage)),
          el('div', { class: 'wk-hub-sub' }, o.pct === null ? 'first' : `${pctText(o.pct)} vs before`)) : null,
        el('span', { class: 'wk-an-chev', 'aria-hidden': 'true' }, '›'));
    })),
    el('p', { class: 'wk-an-note' }, 'Session tonnage of the last session and its change versus the one before; line = last 8 sessions.'));
}

function exercisesSection(rows, name) {
  const sec = el('section', { class: 'section' }, el('h2', { class: 'section-title' }, `Exercises · last ${WEEKS} weeks`));
  if (!rows.length) {
    append(sec, el('div', { class: 'wk-an-rules' }, el('p', { class: 'wk-an-line muted' }, `No sets in the last ${WEEKS} weeks.`)));
  } else {
    append(sec, el('div', { class: 'wk-hub-list' }, rows.map((x) => {
      const reps = x.metric === 'bestReps';
      const val = x.value === null ? '–' : reps ? `${fmtNum(x.value, 0)} reps` : `${fmtNum(x.value, 1)} kg`;
      return el('a', { class: 'wk-hub-row', href: href(`workout/exercises/${encodeURIComponent(x.exerciseId)}`) },
        el('div', { class: 'wk-hub-main' },
          el('div', { class: 'wk-hub-title' }, name(x.exerciseId)),
          el('div', { class: 'wk-hub-sub num' }, `${reps ? 'best set reps' : 'est. 1RM'} · ${x.sessions} session${x.sessions === 1 ? '' : 's'}`)),
        x.points.length > 1 ? spark(x.points.map((p) => p.value), `${reps ? 'Most reps in a set' : 'Est. 1RM'} per session, ${x.points.length} sessions`) : null,
        el('div', { class: 'wk-hub-trail num' },
          el('div', { class: 'wk-hub-val' }, val),
          el('div', { class: 'wk-hub-sub' }, x.pct === null ? (x.points.length > 1 ? '–' : 'one session') : pctText(x.pct))),
        el('span', { class: 'wk-an-chev', 'aria-hidden': 'true' }, '›'));
    })));
    append(sec, el('p', { class: 'wk-an-note' }, `Most sessions in the last ${WEEKS} weeks. Value = latest session (best set’s est. 1RM; most reps in a set for bodyweight); % = versus the first session in these ${WEEKS} weeks.`));
  }
  append(sec, el('a', { class: 'wk-hub-more', href: href('workout/exercises') }, 'All exercises ›'));
  return sec;
}

function setsSection(data, targets) {
  const sec = el('section', { class: 'section' }, el('h2', { class: 'section-title' }, `Weekly sets per muscle · ${SET_WEEKS} weeks`));
  if (!data.rows.length) {
    append(sec, el('div', { class: 'wk-an-rules' }, el('p', { class: 'wk-an-line muted' }, `No sets in the last ${SET_WEEKS} weeks.`)));
  } else {
    const max = Math.max(1, ...data.rows.map((r) => r.max), ...data.rows.map((r) => targets[r.muscle] || 0));
    const first = data.weeks[0]; const lastWk = data.weeks[data.weeks.length - 1];
    append(sec, el('div', { class: 'wk-hub-sets' },
      el('div', { class: 'wk-hub-set wk-hub-set-head', 'aria-hidden': 'true' },
        el('span'), el('span', { class: 'wk-hub-weeks' }, el('span', shortDate(first.from)), el('span', 'this wk')),
        el('span', { class: 'wk-hub-setnum' }, 'this wk')),
      data.rows.map((r) => {
        const t = targets[r.muscle];
        const cur = r.values[r.values.length - 1];
        return el('div', {
          class: 'wk-hub-set', role: 'img',
          'aria-label': `${r.name}: ${r.values.map((v, i) => `week of ${shortDate(data.weeks[i].from)} ${fmtNum(v.total, 2)}`).join(', ')} sets${t ? `; target ${fmtNum(t, 1)}` : ''}`,
        },
        el('span', { class: 'wk-hub-mname' }, r.name),
        el('span', { class: 'wk-hub-weeks', 'aria-hidden': 'true' },
          r.values.map((v, i) => el('span', { class: ['wk-hub-wk', i === r.values.length - 1 && 'is-cur'] },
            t ? el('span', { class: 'wk-hub-tgt', style: { bottom: `${Math.min(100, (t / max) * 100).toFixed(1)}%` } }) : null,
            v.total > 0 ? el('span', { class: 'wk-hub-stack', style: { height: `${Math.max(4, (v.total / max) * 100).toFixed(1)}%` } },
              v.drop > 0 ? el('span', { class: 'wk-hub-seg is-drop', style: { flexGrow: String(v.drop) } }) : null,
              v.partial > 0 ? el('span', { class: 'wk-hub-seg is-partial', style: { flexGrow: String(v.partial) } }) : null,
              v.direct > 0 ? el('span', { class: 'wk-hub-seg is-direct', style: { flexGrow: String(v.direct) } }) : null) : null))),
        el('span', { class: 'wk-hub-setnum num', 'aria-hidden': 'true' }, t ? `${fmtNum(cur.total, 2)}/${fmtNum(t, 1)}` : fmtNum(cur.total, 2)));
      })));
    append(sec, el('p', { class: 'wk-an-note' }, `Weighted sets per Mon–Sun week, oldest left, this week (from ${shortDate(lastWk.from)}) right. Solid = direct (muscle is a main mover), faint = partial (it assists); dashed line = weekly target.`));
  }
  append(sec, linksSection(targets));
  return sec;
}

function linksSection(targets) {
  const n = Object.keys(targets).length;
  return el('div', { class: 'wk-hub-links' },
    el('a', { href: href('workout/targets') }, n ? `Weekly set targets (${n})` : 'Set weekly targets'),
    el('a', { href: href('workout/recovery') }, 'Muscle recovery'),
    el('a', { href: href('workout/history') }, 'All workouts'));
}

// ---------------------------------------------------------------- sparkline

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  append(n, ...children);
  return n;
}

/** Tiny line of values (oldest left), last point as a dot. */
function spark(values, label) {
  const W = 56; const H = 20; const P = 2.5;
  let lo = Math.min(...values); let hi = Math.max(...values);
  if (hi === lo) { lo -= 1; hi += 1; }
  const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
  const y = (v) => P + (1 - (v - lo) / (hi - lo)) * (H - 2 * P);
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const i = values.length - 1;
  return svg('svg', { class: 'wk-hub-spark', viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': label },
    svg('polyline', { class: 'wk-an-ch-line', points: pts }),
    svg('circle', { class: 'wk-an-ch-dot is-cur', cx: x(i).toFixed(1), cy: y(values[i]).toFixed(1), r: 2.2 }));
}
