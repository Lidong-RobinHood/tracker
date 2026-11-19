// Small shared pieces for the progress views: percentage badge, load formatting, comparison block.
import { el, href, fmtNum } from '../ui/index.js';
import { formatPct, trendOf } from '../core/workout-progress.js';
import { formatWeight } from '../core/workout.js';
import { exName, shortDate } from './data.js';
import { isBaseline } from '../core/baseline.js';

/** '12 Nov', or 'starting point 12 Nov' when the earlier entry is the starting point. */
const prevWhen = (w) => (isBaseline(w) ? `starting point ${shortDate(w.date)}` : shortDate(w.date));

const ARROW = { up: '▲', down: '▼', flat: '=', none: '' };

/**
 * Coloured percentage with an arrow (colour is never the only cue).
 * @param {number|null} pct
 * @param {{suffix?: string, title?: string}} [opts]
 */
export function pctBadge(pct, { suffix = '', title } = {}) {
  const t = trendOf(pct);
  const text = t === 'none' ? '–' : `${ARROW[t]} ${formatPct(pct).replace(' ', ' ')}`;
  return el('span', { class: ['wk-pct', `is-${t}`, 'num'], title: title || null },
    text, suffix && t !== 'none' ? el('span', { class: 'wk-pct-suffix' }, ` ${suffix}`) : null);
}

/** Spoken form of a percentage, for aria-labels. */
export function pctWords(pct) {
  const t = trendOf(pct);
  if (t === 'none') return 'no comparison';
  if (t === 'flat') return 'unchanged';
  return `${t === 'up' ? 'up' : 'down'} ${fmtNum(Math.abs(pct), 1)} percent`;
}

/** 12450 -> '12 450' (narrow no-break space groups), whole kg. */
export function fmtLoadNum(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** '12 450 kg' */
export const fmtLoad = (n) => `${fmtLoadNum(n)} kg`;

/** Top set as '100 × 8' or 'BW × 12'. */
export function topText(top) {
  if (!top) return '–';
  return `${formatWeight(top.weight)} × ${top.reps}`;
}

/** Value of a comparison in its basis: '2 300 kg' or '36 reps'. */
export function basisValue(basis, v) {
  return basis === 'reps' ? `${fmtNum(v, 0)} reps` : fmtLoad(v);
}

const RECORD_LABEL = { weight: 'PR weight', e1rm: 'PR 1RM', reps: 'PR reps' };

/** Badges for newRecords() output. */
export function recordBadges(records) {
  return (records || []).map((r) => el('span', {
    class: 'badge wk-pr',
    title: r.kind === 'weight' ? `Heaviest weight: ${formatWeight(r.weight)} kg`
      : r.kind === 'e1rm' ? `Best estimated 1RM: ${fmtNum(r.value, 1)} kg`
        : `Most reps at ${formatWeight(r.weight)}${r.weight ? ' kg' : ''}: ${r.reps}`,
  }, RECORD_LABEL[r.kind]));
}

/**
 * "This time vs last time" block from compareSession().
 * @param {ReturnType<import('../core/workout-progress.js').compareSession>} cmp
 * @param {Map<string, object>} exMap
 */
export function comparisonBlock(cmp, exMap) {
  const t = cmp.total;
  const totalLabel = cmp.prevSession
    ? `vs ${cmp.prevSession.name} · ${shortDate(cmp.prevSession.date)}`
    : 'vs each exercise’s last session';
  const groups = [
    ['up', 'Went up'], ['flat', 'Same as last time'], ['down', 'Went down'], ['new', 'First time'], ['skipped', 'Skipped this time'],
  ];
  const rows = (status) => cmp.rows.filter((r) => r.status === status);
  return el('div', { class: 'stack wk-cmp' },
    el('div', { class: 'wk-cmp-total' },
      el('div', { class: 'grow' },
        el('div', { class: 'small muted' }, 'Volume load'),
        el('div', { class: 'wk-cmp-big num' }, fmtLoad(t.cur)),
        el('div', { class: 'small muted' }, t.prev !== null ? `${totalLabel}: ${fmtLoad(t.prev)}` : 'Nothing to compare with yet')),
      pctBadge(t.pct)),
    ...groups.map(([status, title]) => {
      const list = rows(status);
      if (!list.length) return null;
      return el('div', { class: 'wk-cmp-group' },
        el('div', { class: `wk-cmp-head small is-${status}` }, title),
        ...list.map((r) => el('a', {
          class: 'wk-cmp-row', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`),
        },
        el('div', { class: 'grow wk-min0' },
          el('div', { class: 'wk-cmp-name' }, exName(exMap, r.exerciseId), ...recordBadges(r.records)),
          el('div', { class: 'small muted num' }, rowDetail(r))),
        status === 'skipped' || status === 'new' ? null : pctBadge(r.cmp && r.cmp.pct))));
    }));
}

function rowDetail(r) {
  if (r.status === 'skipped') return `Last: top ${topText(r.prevMetrics.top)} · ${shortDate(r.prevWorkout.date)}`;
  const value = r.cmp ? basisValue(r.cmp.basis, r.cmp.cur)
    : r.metrics.bodyweight ? basisValue('reps', r.metrics.reps) : basisValue('load', r.metrics.load);
  const now = `top ${topText(r.metrics.top)} · ${value}`;
  if (!r.prevMetrics) return now;
  return `${now} (was ${topText(r.prevMetrics.top)} · ${basisValue(r.cmp.basis, r.cmp.prev)}, ${prevWhen(r.prevWorkout)})`;
}
