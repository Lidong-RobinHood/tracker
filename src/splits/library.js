// Split library: filter chips (days, style, level, equipment) and the matching splits. Route: workout/splits
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, sectionHeader, emptyState, tag, icon, href, bodyMap } from '../ui/index.js';
import { SPLITS, STYLES, LEVELS, EQUIPMENT } from '../data/splits.js';
import { filterSplits, coverageStep } from '../core/splits.js';
import { MUSCLE_IDS } from '../core/muscles.js';
import { loadExercises } from '../workout/data.js';
import { ensureSplitsCss, coverageFor } from './store.js';
import { nextUpCard } from './next-up.js';

const label = (list, id) => (list.find((x) => x.id === id) || {}).label || id;
export const styleLabel = (id) => label(STYLES, id);
export const levelLabel = (id) => label(LEVELS, id);
export const equipmentLabel = (id) => label(EQUIPMENT, id);

// Filters survive moving to a split and back (module state, not stored).
const filters = { days: null, style: null, level: null, equipment: null };

/** Small front + back map shaded by planned weekly sets (decorative; the row says the rest). */
export function coverageGlyph(coverage) {
  const svg = bodyMap({ view: 'both', values: Object.fromEntries(MUSCLE_IDS.map((m) => [m, coverageStep(coverage[m].total)])), class: 'sp-glyph' });
  svg.removeAttribute('role');
  svg.removeAttribute('aria-label');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

export async function mountLibrary(container) {
  ensureSplitsCss();
  const [exMap, weights] = await Promise.all([loadExercises(), db.getSetting('volume')]);
  const glyphs = new Map(SPLITS.map((s) => [s.id, coverageFor(s, { level: 'standard', swaps: {}, exMap, weights }).coverage]));

  const nextSlot = el('div', { class: 'sp-next-slot' });
  const results = el('div', { class: 'stack' });
  const filterBox = el('div', { class: 'sp-filters' });

  const renderNext = async () => {
    const card = await nextUpCard({ showChange: false, onChange: renderNext });
    replaceChildren(nextSlot, card);
    nextSlot.hidden = !card;
  };

  const chipRow = (key, options, ariaLabel) => el('div', { class: 'chips chips-scroll sp-chip-row', role: 'group', 'aria-label': ariaLabel },
    options.map((o) => el('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(filters[key] === o.value),
      onClick: () => { filters[key] = filters[key] === o.value ? null : o.value; paint(); },
    }, o.label)));

  const reset = () => { for (const k of Object.keys(filters)) filters[k] = null; paint(); };

  function paint() {
    replaceChildren(filterBox,
      chipRow('days', [2, 3, 4, 5, 6].map((d) => ({ value: d, label: `${d} days` })), 'Days per week'),
      chipRow('style', STYLES.map((s) => ({ value: s.id, label: s.label })), 'Style'),
      chipRow('level', LEVELS.map((s) => ({ value: s.id, label: s.label })), 'Level'),
      chipRow('equipment', EQUIPMENT.map((s) => ({ value: s.id, label: s.label })), 'Equipment'));
    const list = filterSplits(SPLITS, filters);
    const any = Object.values(filters).some((v) => v != null);
    replaceChildren(results,
      sectionHeader(`${list.length} ${list.length === 1 ? 'split' : 'splits'}`, {
        trail: any ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reset }, 'Reset') : null,
      }),
      list.length
        ? el('div', { class: 'card card-flush list sp-results' }, list.map((s) => row(s, glyphs.get(s.id))))
        : el('div', { class: 'card' }, emptyState('No split matches.',
          el('button', { type: 'button', class: 'btn', onClick: reset }, 'Reset filters'))));
  }

  append(container,
    pageHeader({ title: 'Splits', back: 'workout', info: 'split-choose' }),
    nextSlot, filterBox, results);
  paint();
  await renderNext();
}

function row(s, coverage) {
  return el('a', { class: 'list-item sp-row', href: href(`workout/splits/${encodeURIComponent(s.id)}`) },
    coverageGlyph(coverage),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, s.name),
      el('div', { class: 'sp-row-sub' }, s.suits),
      el('div', { class: 'sp-tags' },
        tag(`${s.days} days`, { tone: 'accent' }), tag(styleLabel(s.style)),
        s.equipment === 'home' ? tag('Home') : null)),
    icon('chevron-right', { class: 'li-chevron' }));
}
