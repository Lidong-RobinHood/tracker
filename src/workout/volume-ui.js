// Small pieces for showing how a muscle's weekly sets are made up (direct vs partial).
// Numbers come from muscleVolumeBreakdown in src/core/volume.js.
import { el, fmtNum } from '../ui/index.js';

/**
 * '6 direct + 3 partial × 0.5 + 2 drop (1)'. Multipliers are shown when they are not 1; dropsets
 * only when the dropset weight is not 0.
 * @param {ReturnType<typeof import('../core/volume.js').muscleVolumeBreakdown>[string]|undefined} b
 * @param {{primary: number, secondary: number, dropset: number}} weights
 */
export function breakdownText(b, weights) {
  if (!b) return 'none this week';
  const parts = [];
  const x = (w) => (w === 1 ? '' : ` × ${fmtNum(w, 2)}`);
  if (b.direct.sets) parts.push(`${b.direct.sets} direct${x(weights.primary)}`);
  if (b.partial.sets) parts.push(`${b.partial.sets} partial${x(weights.secondary)}`);
  if (weights.dropset && b.drop.sets) parts.push(`${b.drop.sets} drop (${fmtNum(b.drop.value, 2)})`);
  return parts.length ? parts.join(' + ') : 'none this week';
}

/** Words for a screen reader: '6 direct sets, 3 partial sets counted as 1.5'. */
export function breakdownAria(b, weights) {
  if (!b) return 'no sets this week';
  const out = [`${b.direct.sets} direct set${b.direct.sets === 1 ? '' : 's'}${weights.primary === 1 ? '' : ` counted as ${fmtNum(b.direct.value, 2)}`}`];
  if (b.partial.sets) out.push(`${b.partial.sets} partial set${b.partial.sets === 1 ? '' : 's'} counted as ${fmtNum(b.partial.value, 2)}`);
  if (weights.dropset && b.drop.sets) out.push(`${b.drop.sets} dropset${b.drop.sets === 1 ? '' : 's'} counted as ${fmtNum(b.drop.value, 2)}`);
  return out.join(', ');
}

/**
 * Bar fill split into direct (solid), partial (lighter) and dropset (lightest) parts.
 * @param {number} fraction 0–1 width of the whole fill
 */
export function splitFill(b, fraction, reached = false) {
  const segs = b ? [['is-direct', b.direct.value], ['is-partial', b.partial.value], ['is-drop', b.drop.value]] : [];
  return el('span', { class: ['wk-vol-fill', 'wk-vol-split', reached && 'is-reached'], style: { width: `${Math.max(0, Math.min(1, fraction)) * 100}%` } },
    segs.filter(([, v]) => v > 0).map(([cls, v]) => el('span', { class: ['wk-vol-seg', cls], style: { flexGrow: String(v) } })));
}

/** One-line explanation of the words, for a caption. */
export function breakdownCaption(weights) {
  return `Direct = sets of exercises where the muscle is a main mover (× ${fmtNum(weights.primary, 2)}). `
    + `Partial = sets where it only assists (× ${fmtNum(weights.secondary, 2)}). `
    + (weights.dropset ? `Dropsets × ${fmtNum(weights.dropset, 2)} of that. ` : 'Dropsets do not count. ');
}
