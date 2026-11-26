// Small shared pieces for the progress views: percentage badge, tonnage formatting, comparison block.
import { el, href, fmtNum, fmtTonnage, icon, sectionHeader } from '../ui/index.js';
import { formatPct, trendOf } from '../core/workout-progress.js';
import { parseDate } from '../core/dates.js';
import { isBaseline } from '../core/baseline.js';
import { t } from '../i18n/index.js';
import { dayMonth } from '../i18n/dates.js';
import { exerciseName } from '../i18n/names.js';
import { fmtWeight, workoutTitle } from './data.js';

/**
 * Short date of a 'YYYY-MM-DD' for the analysis screens: en '12 Nov', de '12. Nov.', zh '11月12日'; the
 * year is added when it is not this year. No-break spaces, so a date never wraps inside.
 * @param {string} date @param {{year?: boolean}} [opts] year: false never adds the year (chart axes)
 */
export function dateShort(date, { year } = {}) {
  const d = parseDate(date);
  const y = year === undefined ? d.getFullYear() !== new Date().getFullYear() : year;
  return dayMonth(d, { year: y }).replace(/ /g, '\u00a0');
}

/** Display name of an exercise by id: built-in names translated, the user's own as stored. */
export function exLabel(exMap, id) {
  const e = exMap && exMap.get(id);
  return e ? exerciseName(e) : t('analysis.unknownExercise');
}

/** Display title of a workout (data.js: starting point and the default name translated, others as stored). */
export { workoutTitle };

/** Metric names (keys of core METRICS): label = title case for headings, short = inside a sentence. */
export const metricLabel = (k) => t(`analysis.metric.${k}`);
export const metricShort = (k) => t(`analysis.metricShort.${k}`);

/** '12 reps', '1 rep' (n formatted without decimals). */
export const repsText = (n) => t('analysis.reps', { count: n, n: fmtNum(n, 0) });

/** '12 Nov', or 'Start 12 Nov' when the earlier entry is the starting point. */
const prevWhen = (w) => (isBaseline(w) ? t('analysis.cmp.start', { date: dateShort(w.date) }) : dateShort(w.date));

/** '+2.5 %' with a true minus and a no-break space before % (core formatPct / withPercent). */
export const pctText = (p) => formatPct(p);

/**
 * Coloured percentage with an arrow icon (colour is never the only cue).
 * @param {number|null} pct
 * @param {{suffix?: string, title?: string}} [opts]
 */
export function pctBadge(pct, { suffix = '', title } = {}) {
  const tr = trendOf(pct);
  return el('span', { class: ['wk-pct', `is-${tr}`], title: title || null },
    tr === 'up' ? icon('arrow-up', { size: 14 }) : tr === 'down' ? icon('arrow-down', { size: 14 }) : null,
    tr === 'none' ? '–' : pctText(pct),
    suffix && tr !== 'none' ? el('span', { class: 'wk-pct-suffix' }, ` ${suffix}`) : null);
}

/** Spoken form of a percentage, for aria-labels. */
export function pctWords(pct) {
  const tr = trendOf(pct);
  if (tr === 'none') return t('analysis.pct.none');
  if (tr === 'flat') return t('analysis.pct.flat');
  return t(tr === 'up' ? 'analysis.pct.up' : 'analysis.pct.down', { n: fmtNum(Math.abs(pct), 1) });
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

/**
 * Duration for a stat tile: { value: '< 1', unit: 'min' }, { value: '45', unit: 'min' },
 * { value: '1:20', unit: 'h' } (hours:minutes, fits a narrow tile in every language); null → { value: '–' }.
 */
export function durationParts(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return { value: '–', unit: null };
  if (ms < 60000) return { value: '< 1', unit: 'min' };
  const min = Math.round(ms / 60000);
  if (min < 60) return { value: String(min), unit: 'min' };
  return { value: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`, unit: 'h' };
}

/** Top set as '100 × 8' or 'BW × 12'. */
export function topText(top) {
  if (!top) return '–';
  return `${fmtWeight(top.weight)} × ${top.reps}`;
}

/** Value of a per-exercise comparison in its basis: '2 340 kg' (always kg) or '36 reps'. */
export function basisValue(basis, v) {
  return basis === 'reps' ? repsText(v) : fmtTonnage(v, { kg: true });
}

/** Record tags (trophy) for newRecords() output. */
export function recordBadges(records) {
  return (records || []).map((r) => el('span', {
    class: 'tag tag-accent wk-pr',
    title: r.kind === 'weight' ? t('analysis.record.weightTitle', { weight: fmtWeight(r.weight) })
      : r.kind === 'e1rm' ? t('analysis.record.e1rmTitle', { value: fmtNum(r.value, 1) })
        : t(r.weight ? 'analysis.record.repsTitleKg' : 'analysis.record.repsTitleBw', { weight: fmtWeight(r.weight), reps: r.reps }),
  }, icon('trophy', { size: 14 }), t(`analysis.record.${r.kind}`)));
}

/**
 * "This time vs last time" block from compareSession().
 * @param {ReturnType<import('../core/workout-progress.js').compareSession>} cmp
 * @param {Map<string, object>} exMap
 */
export function comparisonBlock(cmp, exMap) {
  const tot = cmp.total;
  const totalLabel = cmp.prevSession
    ? t('analysis.cmp.vsSession', { name: workoutTitle(cmp.prevSession), date: dateShort(cmp.prevSession.date) })
    : t('analysis.cmp.vsEach');
  const groups = ['up', 'flat', 'down', 'new', 'skipped'].map((st) => [st, t(`analysis.cmp.group.${st}`)]);
  const rows = (status) => cmp.rows.filter((r) => r.status === status);
  return el('div', { class: 'wk-cmp' },
    el('div', { class: 'wk-cmp-total' },
      el('div', { class: 'grow wk-min0' },
        el('div', { class: 't-cap muted' }, t('analysis.tonnage')),
        el('div', { class: 't-title' }, fmtTonnage(tot.cur)),
        // `cur` is always this session's whole tonnage; the % may compare only the exercises that
        // have an earlier entry (matched basis), so say so when that differs.
        el('div', { class: 't-sub muted' }, tot.prev === null ? t('analysis.cmp.nothing')
          : tot.basis === 'matched' && tot.matchedCur !== tot.cur
            ? t('analysis.cmp.prevMatched', { label: totalLabel, prev: fmtTonnage(tot.prev), now: fmtTonnage(tot.matchedCur) })
            : t('analysis.cmp.prev', { label: totalLabel, prev: fmtTonnage(tot.prev) }))),
      pctBadge(tot.pct)),
    ...groups.map(([status, title]) => {
      const list = rows(status);
      if (!list.length) return null;
      return el('div', { class: 'wk-cmp-group' },
        el('div', { class: ['t-cap', 'wk-cmp-head', `is-${status}`] }, title),
        ...list.map((r) => el('a', {
          class: 'wk-cmp-row', href: href(`workout/exercises/${encodeURIComponent(r.exerciseId)}`),
        },
        // the % sits on the name line, so the now / before values get the full width below it
        el('div', { class: 'grow wk-min0' },
          el('div', { class: 'wk-cmp-top' },
            el('div', { class: 'wk-cmp-name' }, exLabel(exMap, r.exerciseId), ...recordBadges(r.records)),
            status === 'skipped' || status === 'new' ? null : pctBadge(r.cmp && r.cmp.pct)),
          rowDetail(r)),
        icon('chevron-right', { class: 'li-chevron' }))));
    }));
}

/** Section title + comparison card, used by the summary, history detail and routine progress. */
export function comparisonSection(title, cmp, exMap) {
  return el('section', { class: 'section' }, sectionHeader(title, { info: 'tonnage' }), el('div', { class: 'card' }, comparisonBlock(cmp, exMap)));
}

/**
 * Per-exercise line(s): 'top 100 × 8 · 2 300 kg'; with an earlier entry two aligned rows, now and
 * before (labelled with its date): the top set and the tonnage / reps of each.
 */
function rowDetail(r) {
  if (r.status === 'skipped') return el('div', { class: 't-sub muted' }, t('analysis.cmp.lastTop', { top: topText(r.prevMetrics.top), date: dateShort(r.prevWorkout.date) }));
  const value = r.cmp ? basisValue(r.cmp.basis, r.cmp.cur)
    : r.metrics.bodyweight ? basisValue('reps', r.metrics.reps) : basisValue('load', r.metrics.load);
  if (!r.prevMetrics) return el('div', { class: 't-sub muted' }, t('analysis.cmp.top', { top: topText(r.metrics.top), value }));
  const val = (top, v) => el('span', { class: 'wk-cmp-val' }, el('span', { class: 'wk-nowrap' }, topText(top)), ' · ', el('span', { class: 'wk-nowrap' }, v));
  return el('div', { class: 'wk-cmp-vals t-sub' },
    el('span', { class: 'muted' }, t('analysis.cmp.now')), val(r.metrics.top, value),
    el('span', { class: 'muted' }, prevWhen(r.prevWorkout)), val(r.prevMetrics.top, basisValue(r.cmp.basis, r.cmp.prev)));
}
