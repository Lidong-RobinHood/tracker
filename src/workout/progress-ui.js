// Small shared pieces for the progress views: percentage badge, tonnage formatting, comparison block.
import { el, href, fmtNum, fmtTonnage, icon, sectionHeader } from '../ui/index.js';
import { formatPct, trendOf } from '../core/workout-progress.js';
import { formatWeight } from '../core/workout.js';
import { exName, shortDate } from './data.js';
import { isBaseline } from '../core/baseline.js';

/** '12 Nov', or 'starting point 12 Nov' when the earlier entry is the starting point. */
const prevWhen = (w) => (isBaseline(w) ? `starting point ${shortDate(w.date)}` : shortDate(w.date));

/** '+2.5 %' with a true minus and a narrow no-break space before %. */
export const pctText = (p) => formatPct(p).replace(' ', ' ');

/**
 * Coloured percentage with an arrow icon (colour is never the only cue).
 * @param {number|null} pct
 * @param {{suffix?: string, title?: string}} [opts]
 */
export function pctBadge(pct, { suffix = '', title } = {}) {
  const t = trendOf(pct);
  return el('span', { class: ['wk-pct', `is-${t}`], title: title || null },
    t === 'up' ? icon('arrow-up', { size: 14 }) : t === 'down' ? icon('arrow-down', { size: 14 }) : null,
    t === 'none' ? '–' : pctText(pct),
    suffix && t !== 'none' ? el('span', { class: 'wk-pct-suffix' }, ` ${suffix}`) : null);
}

/** Spoken form of a percentage, for aria-labels. */
export function pctWords(pct) {
  const t = trendOf(pct);
  if (t === 'none') return 'no comparison';
  if (t === 'flat') return 'unchanged';
  return `${t === 'up' ? 'up' : 'down'} ${fmtNum(Math.abs(pct), 1)} percent`;
}

/**
 * Tonnage: one shared rule (src/ui/format.js): whole kg below 10 000 kg, t with two decimals from
 * 10 000 kg; `{ kg: true }` for single sets and per-exercise tonnage. Re-exported for the views.
 */
export { fmtTonnage };

/** Tonnage split for a stat tile: { value: '12.48', unit: 't' } or { value: '2 340', unit: 'kg' }. */
export function tonnageParts(n, opts) {
  const s = fmtTonnage(n, opts);
  const i = s.lastIndexOf(' ');
  return i < 0 ? { value: s, unit: '' } : { value: s.slice(0, i), unit: s.slice(i + 1) };
}

/** Top set as '100 × 8' or 'BW × 12'. */
export function topText(top) {
  if (!top) return '–';
  return `${formatWeight(top.weight)} × ${top.reps}`;
}

/** Value of a per-exercise comparison in its basis: '2 340 kg' (always kg) or '36 reps'. */
export function basisValue(basis, v) {
  return basis === 'reps' ? `${fmtNum(v, 0)} reps` : fmtTonnage(v, { kg: true });
}

const RECORD_LABEL = { weight: 'Record weight', e1rm: 'Record est. 1RM', reps: 'Record reps' };

/** Record tags (trophy) for newRecords() output. */
export function recordBadges(records) {
  return (records || []).map((r) => el('span', {
    class: 'tag tag-accent wk-pr',
    title: r.kind === 'weight' ? `Heaviest weight: ${formatWeight(r.weight)} kg`
      : r.kind === 'e1rm' ? `Best est. 1RM: ${fmtNum(r.value, 1)} kg`
        : `Most reps at ${formatWeight(r.weight)}${r.weight ? ' kg' : ''}: ${r.reps}`,
  }, icon('trophy', { size: 14 }), RECORD_LABEL[r.kind]));
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
  return el('div', { class: 'wk-cmp' },
    el('div', { class: 'wk-cmp-total' },
      el('div', { class: 'grow wk-min0' },
        el('div', { class: 't-cap muted' }, 'Tonnage'),
        el('div', { class: 't-title' }, fmtTonnage(t.cur)),
        // `cur` is always this session's whole tonnage; the % may compare only the exercises that
        // have an earlier entry (matched basis), so say so when that differs.
        el('div', { class: 't-sub muted' }, t.prev === null ? 'Nothing to compare with yet'
          : `${totalLabel}: ${fmtTonnage(t.prev)}${t.basis === 'matched' && t.matchedCur !== t.cur ? ` (same exercises now ${fmtTonnage(t.matchedCur)})` : ''}`)),
      pctBadge(t.pct)),
    ...groups.map(([status, title]) => {
      const list = rows(status);
      if (!list.length) return null;
      return el('div', { class: 'wk-cmp-group' },
        el('div', { class: ['t-cap', 'wk-cmp-head', `is-${status}`] }, title),
        ...list.map((r) => el('a', {
          class: 'wk-cmp-row', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`),
        },
        el('div', { class: 'grow wk-min0' },
          el('div', { class: 'wk-cmp-name' }, exName(exMap, r.exerciseId), ...recordBadges(r.records)),
          el('div', { class: 't-sub muted' }, rowDetail(r))),
        status === 'skipped' || status === 'new' ? null : pctBadge(r.cmp && r.cmp.pct),
        icon('chevron-right', { class: 'li-chevron' }))));
    }));
}

/** Section title + comparison card, used by the summary, history detail and routine progress. */
export function comparisonSection(title, cmp, exMap) {
  return el('section', { class: 'section' }, sectionHeader(title, { info: 'tonnage' }), el('div', { class: 'card' }, comparisonBlock(cmp, exMap)));
}

function rowDetail(r) {
  if (r.status === 'skipped') return `Last: top ${topText(r.prevMetrics.top)} · ${shortDate(r.prevWorkout.date)}`;
  const value = r.cmp ? basisValue(r.cmp.basis, r.cmp.cur)
    : r.metrics.bodyweight ? basisValue('reps', r.metrics.reps) : basisValue('load', r.metrics.load);
  const now = `top ${topText(r.metrics.top)} · ${value}`;
  if (!r.prevMetrics) return now;
  return `${now} (was ${topText(r.prevMetrics.top)} · ${basisValue(r.cmp.basis, r.cmp.prev)}, ${prevWhen(r.prevWorkout)})`;
}
