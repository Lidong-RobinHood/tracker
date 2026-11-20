// Body-map pieces shared by the workout and split screens (one place for the look and the legends).
//
// Exercise muscles (direct / partial):
//   musclesBlock({ primary, secondary, small })  map (front + back) + Direct / Partial legend with the
//                                                muscle names → { node, update(primary, secondary) }
//   openMusclesSheet(ex)                         the same block in a sheet (session card)
//   rowMuscleIcon(id, size)                      muscleIcon of the main muscle for list rows (cached clone)
//   musclesText(ex)                              'Chest · Triceps, Shoulders' (partial quieter)
//
// Sets per muscle on the four-step ramp (is-1..is-4, --wk-ramp-1..4 in workout.css):
//   setsGlyph(steps)            small decorative two-figure map (library / routine rows)
//   setsMap()                   full map; paint with setBodyMapValues(map, steps)
//   setsMapRow(map, bands, label)  map + band legend side by side (legend under the map below 360 px)
//   setsRow(name, c, opts)      one muscle as a list row: swatch, name, 'x direct · y partial', total
import { el, replaceChildren, bodyMap, setBodyMapValues, muscleIcon, openSheet, fmtNum } from '../ui/index.js';
import { muscleName } from '../core/muscles.js';
import { ensureCss } from './data.js';
import { workoutSets, mapSteps } from '../core/routine-sets.js';

// ---------------------------------------------------------------- exercise muscles

const names = (ids) => (ids || []).map(muscleName).join(', ');

/** Body-map values: direct muscles in the accent, partial ones in the second accent step. */
export function exerciseMapValues(primary = [], secondary = []) {
  const v = {};
  for (const m of secondary || []) v[m] = 2; // painted --accent-2 inside .wk-exmap
  for (const m of primary || []) v[m] = 'hot';
  return v;
}

/** Accessible name of an exercise's muscles. */
export function musclesLabel(primary = [], secondary = []) {
  const p = names(primary);
  const s = names(secondary);
  return `Muscles. Direct: ${p || 'none'}${s ? `. Partial: ${s}` : ''}`;
}

/**
 * Map of an exercise's muscles with a two-item legend (Direct · Partial) carrying the names.
 * @param {{primary?: string[], secondary?: string[], small?: boolean}} [opts] small: 96 px wide map (forms)
 * @returns {{node: HTMLElement, update: (primary: string[], secondary: string[]) => void}}
 */
export function musclesBlock({ primary = [], secondary = [], small = false } = {}) {
  ensureCss();
  const map = bodyMap({ view: 'both', class: 'wk-exmap' });
  const direct = el('span', { class: 'wk-mus-names' });
  const partial = el('span', { class: 'wk-mus-names' });
  const item = (swatch, term, namesEl) => el('li', el('span', { class: ['swatch', swatch] }),
    el('span', { class: 'wk-mus-item' }, el('span', { class: 'wk-mus-term' }, term), namesEl));
  const node = el('div', { class: ['wk-mus', small && 'is-small'] }, map,
    el('ul', { class: 'legend wk-mus-legend', 'aria-hidden': 'true' },
      item('is-accent', 'Direct', direct), item('is-partial', 'Partial', partial)));
  const update = (p, s) => {
    setBodyMapValues(map, exerciseMapValues(p, s));
    map.setAttribute('aria-label', musclesLabel(p, s));
    direct.textContent = names(p) || '–';
    partial.textContent = names(s) || '–';
  };
  update(primary, secondary);
  return { node, update };
}

/** Sheet with the muscles of one exercise (no navigation away from the session). */
export function openMusclesSheet(ex) {
  const block = musclesBlock({ primary: ex.primary, secondary: ex.secondary });
  return openSheet({ title: ex.name, content: block.node, className: 'wk-mus-sheet' });
}

// One muscleIcon per muscle and size, cloned per row: a list of 100+ rows builds 12 icons at most.
const iconCache = new Map();
/**
 * Decorative icon of a muscle for a list row (the row's text names the muscles).
 * @param {string|undefined} id @param {number} [size]
 * @returns {Element} an empty placeholder of the same size when the exercise has no direct muscle
 */
export function rowMuscleIcon(id, size = 36) {
  if (!id) return el('span', { class: 'wk-row-ic', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
  const key = `${id}:${size}`;
  if (!iconCache.has(key)) iconCache.set(key, muscleIcon(id, { size }));
  const svg = /** @type {Element} */ (iconCache.get(key).cloneNode(true));
  svg.classList.add('wk-row-ic');
  return svg;
}

/** Muscle filter chip with the muscle's icon (library, picker). */
export function muscleChip(m, pressed, onClick) {
  return el('button', { type: 'button', class: 'chip wk-mchip-f', 'aria-pressed': pressed ? 'true' : 'false', onClick },
    rowMuscleIcon(m.id, 24), m.name);
}

/** Direct muscles, then the partial ones (quieter): for a row's sub line. */
export function musclesText(ex) {
  const p = names(ex && ex.primary);
  const s = names(ex && ex.secondary);
  return [el('span', { class: 'wk-mus-d' }, p), s ? el('span', { class: 'wk-mus-p' }, ` · ${s}`) : null];
}

// ---------------------------------------------------------------- sets per muscle (ramp)

/** Small front + back map shaded by sets per muscle (decorative; the row says the rest). */
export function setsGlyph(steps) {
  ensureCss();
  const svg = bodyMap({ view: 'both', values: steps, class: 'wk-glyph wk-ramp' });
  svg.removeAttribute('role');
  svg.removeAttribute('aria-label');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Full front + back map on the ramp; paint it with setBodyMapValues. */
export function setsMap(cls) {
  ensureCss();
  return bodyMap({ view: 'both', class: ['wk-ramp', cls].filter(Boolean).join(' ') });
}

/**
 * The map with its band legend beside it (under it below 360 px).
 * @param {SVGSVGElement} map @param {{step: number, label: string}[]} bands @param {string} label legend name
 * @param {{caption?: string|null}} [opts] caption: a caps line above the bands (what they count)
 */
export function setsMapRow(map, bands, label, { caption = null } = {}) {
  ensureCss();
  return el('div', { class: 'wk-map-row' }, map,
    el('ul', { class: 'legend wk-map-legend wk-ramp', 'aria-label': label },
      caption ? el('li', { class: 't-cap muted wk-legend-cap', 'aria-hidden': 'true' }, caption) : null,
      bands.map((b) => el('li', el('span', { class: ['swatch', b.step ? `is-${b.step}` : null] }), b.label))));
}

/**
 * One muscle of a sets list: swatch, name, 'x direct · y partial' (+ extra parts), the total and an
 * optional ' / target'.
 * @param {string} name
 * @param {{total: number, direct: number, partial: number}} c
 * @param {{step: number, extra?: string[], target?: number|null}} opts
 */
export function setsRow(name, c, { step, extra = [], target = null }) {
  ensureCss();
  const parts = [`${fmtNum(c.direct, 1)} direct`, `${fmtNum(c.partial, 1)} partial`, ...extra];
  return el('div', { class: 'list-item wk-sets-row' },
    el('span', { class: ['swatch', `is-${step}`] }),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, name),
      el('div', { class: 'li-sub' }, parts.join(' · '))),
    el('span', { class: 'li-trail' },
      el('span', { class: 'wk-sets-total' }, fmtNum(c.total, 1)),
      target ? el('span', { class: 'muted' }, ` / ${fmtNum(target, 1)}`) : null));
}

/** A sets list (rows of setsRow) inside a card. */
export function setsList(rows) {
  return el('div', { class: 'list wk-sets-list wk-ramp' }, rows);
}

/** Small two-figure map of one logged workout, shaded by its sets per muscle (session bands). */
export function workoutGlyph(workout, exMap, weights) {
  return setsGlyph(mapSteps(workoutSets(workout, exMap, weights)));
}

/** A stat tile with the workout glyph at its right (Sets tiles of the summary and the analysis tab). */
export function withGlyph(tile, glyph) {
  ensureCss();
  tile.classList.add('wk-tile-glyph');
  tile.appendChild(glyph);
  return tile;
}

/**
 * Make the muscles of a map tappable (buttons; keyboard Tab + Enter / Space): one muscle at a time is
 * outlined and its figures fill one line under the map. The line keeps its height when empty, so
 * nothing below moves.
 * @param {SVGSVGElement} map
 * @param {(muscleId: string) => (string|Node|(string|Node)[])} describe the line for a muscle
 * @returns {{line: HTMLElement, select: (id: string|null) => void, refresh: () => void}}
 */
export function selectableMap(map, describe) {
  ensureCss();
  let open = null;
  const line = el('p', { class: 't-sub wk-map-line', 'aria-live': 'polite' });
  const select = (id) => {
    open = id;
    for (const p of map.querySelectorAll('.bm-muscle')) {
      const on = p.getAttribute('data-muscle') === open;
      p.classList.toggle('is-sel', on);
      p.setAttribute('aria-pressed', String(on));
    }
    replaceChildren(line, open ? describe(open) : null);
  };
  map.classList.add('wk-rc-map');
  map.setAttribute('role', 'group');
  for (const p of map.querySelectorAll('.bm-muscle')) {
    const id = p.getAttribute('data-muscle');
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', 'button');
    p.setAttribute('aria-label', muscleName(id));
    p.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(open === id ? null : id); } });
  }
  map.addEventListener('click', (e) => {
    const p = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('[data-muscle]');
    if (p) { const id = p.getAttribute('data-muscle'); select(open === id ? null : id); }
  });
  return { line, select, refresh: () => select(open) };
}
