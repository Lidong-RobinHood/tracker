// Small pieces for showing how a muscle's weekly sets are made up (direct vs partial).
// Numbers come from muscleVolumeBreakdown in src/core/volume.js. The explanation of the words lives in
// the 'sets' info sheet.
import { el, fmtNum, infoButton } from '../ui/index.js';
import { t } from '../i18n/index.js';

/**
 * '6 direct + 3 partial × 0.5 + 2 drop (1)'. Multipliers are shown when they are not 1; dropsets
 * only when the dropset weight is not 0.
 * @param {ReturnType<typeof import('../core/volume.js').muscleVolumeBreakdown>[string]|undefined} b
 * @param {{primary: number, secondary: number, dropset: number}} weights
 */
export function breakdownText(b, weights) {
  if (!b) return t('analysis.vol.none');
  const parts = [];
  const part = (key, n, w) => (w === 1 ? t(`analysis.vol.${key}`, { n }) : t(`analysis.vol.${key}Times`, { n, x: fmtNum(w, 2) }));
  if (b.direct.sets) parts.push(part('direct', b.direct.sets, weights.primary));
  if (b.partial.sets) parts.push(part('partial', b.partial.sets, weights.secondary));
  if (weights.dropset && b.drop.sets) parts.push(t('analysis.vol.drop', { n: b.drop.sets, value: fmtNum(b.drop.value, 2) }));
  return parts.length ? parts.join(' + ') : t('analysis.vol.none');
}

/** Words for a screen reader: '6 direct sets, 3 partial sets counted as 1.5'. */
export function breakdownAria(b, weights) {
  if (!b) return t('analysis.vol.ariaNone');
  const out = [weights.primary === 1 ? t('analysis.vol.ariaDirect', { count: b.direct.sets })
    : t('analysis.vol.ariaDirectCounted', { count: b.direct.sets, value: fmtNum(b.direct.value, 2) })];
  if (b.partial.sets) out.push(t('analysis.vol.ariaPartial', { count: b.partial.sets, value: fmtNum(b.partial.value, 2) }));
  if (weights.dropset && b.drop.sets) out.push(t('analysis.vol.ariaDrop', { count: b.drop.sets, value: fmtNum(b.drop.value, 2) }));
  return out.join(t('analysis.listSep'));
}

/**
 * Sets bar: direct (solid accent) then partial and counted dropsets (lighter accent) inside a track;
 * a dark tick at the right end when the muscle has a target (the bar is full at 100 %).
 * @param {object|undefined} b breakdown of the muscle
 * @param {number} fraction 0–1 width of the whole fill
 * @param {{target?: boolean}} [opts]
 */
export function setsBar(b, fraction, { target = false } = {}) {
  const segs = b ? [['is-direct', b.direct.value], ['is-partial', b.partial.value + b.drop.value]] : [];
  return el('span', { class: ['wk-sbar', target && 'has-target'], 'aria-hidden': 'true' },
    el('span', { class: 'wk-sbar-fill', style: { width: `${(Math.max(0, Math.min(1, fraction)) * 100).toFixed(1)}%` } },
      segs.filter(([, v]) => v > 0).map(([cls, v]) => el('span', { class: ['wk-sbar-seg', cls], style: { flexGrow: String(v) } }))),
    target ? el('span', { class: 'wk-sbar-tick' }) : null);
}

/** Legend line under a sets card title: Direct · Partial (· Target). */
export function setsLegend({ target = false } = {}) {
  return el('ul', { class: 'legend legend-row wk-sets-legend' },
    el('li', el('span', { class: 'swatch is-accent' }), t('analysis.legend.direct')),
    el('li', el('span', { class: 'swatch is-partial' }), t('analysis.legend.partial')),
    target ? el('li', el('span', { class: 'wk-tick-swatch' }), t('analysis.legend.target')) : null);
}

/**
 * Put the 'sets' (or 'sets-workout') info button (with the user's own factors) right after the title of a section or card
 * header. @param {HTMLElement} header from sectionHeader / cardHeader / pageHeader @returns {HTMLElement}
 */
export function withSetsInfo(header, weights, sheet = 'sets') {
  const title = header.querySelector('.section-title, .card-title, .page-title');
  // 'sets' = weekly sets; 'sets-workout' = the sets of one workout (summary, history detail)
  const btn = infoButton(sheet === 'sets-workout' ? 'sets-workout' : 'sets', { values: { primary: weights.primary, secondary: weights.secondary, dropset: weights.dropset } });
  if (title) title.after(btn);
  return header;
}
