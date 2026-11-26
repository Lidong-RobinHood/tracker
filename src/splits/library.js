// Split library: filter chips (days, style, level, equipment) and the matching splits. Route: workout/splits
import * as db from '../db/db.js';
import { el, append, replaceChildren, pageHeader, sectionHeader, emptyState, tag, icon, iconButton, href, openSheet } from '../ui/index.js';
import { SPLITS, STYLES, LEVELS, EQUIPMENT } from '../data/splits.js';
import { t } from '../i18n/index.js';
import { splitName, splitSuits, styleLabel, levelLabel, placeLabel, routineName } from '../i18n/names.js';
import { filterSplits, coverageStep } from '../core/splits.js';
import { mapSteps } from '../core/routine-sets.js';
import { loadExercises, loadRoutines } from '../workout/data.js';
import { setsGlyph } from '../workout/muscle-map.js';
import { ensureSplitsCss, coverageFor, loadCustomSplits, customCoverage, splitPath } from './store.js';
import { sessionsPerWeekOf } from '../core/splits.js';
import { fillNewSplitSheet } from './custom-new.js';
import { followingCard } from './next-up.js';

// Filters survive moving to a split and back (module state, not stored).
const filters = { days: null, style: null, level: null, equipment: null };

/** Small front + back map shaded by planned weekly sets (decorative; the row says the rest). */
export function coverageGlyph(coverage) {
  return setsGlyph(mapSteps(coverage, coverageStep));
}

export async function mountLibrary(container) {
  ensureSplitsCss();
  const [exMap, weights, routines, custom] = await Promise.all([loadExercises(), db.getSetting('volume'), loadRoutines(), loadCustomSplits()]);
  const glyphs = new Map(SPLITS.map((s) => [s.id, coverageFor(s, { level: 'standard', swaps: {}, exMap, weights }).coverage]));
  const byId = new Map(routines.map((r) => [r.id, r]));
  const mine = custom.map((cs) => ({ cs, ...customCoverage(cs, byId, exMap, weights) }));
  const openNew = () => {
    const sheet = openSheet({ title: t('splits.new.title'), className: 'sp-new-sheet' });
    fillNewSplitSheet(sheet, { exMap }).catch((err) => console.error(err));
  };
  const newRow = () => el('button', { type: 'button', class: 'list-item', onClick: openNew },
    icon('plus', { class: 'li-lead' }),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, t('splits.new.title'))),
    icon('chevron-right', { class: 'li-chevron' }));

  const nextSlot = el('div', { class: 'sp-next-slot' });
  const results = el('div', { class: 'stack' });
  const filterBox = el('div', { class: 'sp-filters' });

  const renderNext = async () => {
    // Next up and its Start live on the workout home; here only which split is followed (to change it,
    // pick another below) and Stop following.
    const card = await followingCard({ onChange: renderNext });
    replaceChildren(nextSlot, card);
    nextSlot.hidden = !card;
  };

  // One labelled row per filter; a row too wide for the screen scrolls inside itself (fade at the edge).
  const chipRow = (key, options, label) => el('div', { class: 'sp-filter' },
    el('span', { class: 't-cap muted sp-filter-label', 'aria-hidden': 'true' }, label),
    el('div', { class: 'chips chips-scroll sp-chip-row', role: 'group', 'aria-label': label },
      options.map((o) => el('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(filters[key] === o.value),
        onClick: () => { filters[key] = filters[key] === o.value ? null : o.value; paint(); },
      }, o.label))));

  const reset = () => { for (const k of Object.keys(filters)) filters[k] = null; paint(); };

  function paint() {
    replaceChildren(filterBox,
      chipRow('days', [2, 3, 4, 5, 6].map((d) => ({ value: d, label: String(d) })), t('splits.filter.days')),
      chipRow('style', STYLES.map((s) => ({ value: s.id, label: styleLabel(s.id) })), t('splits.filter.style')),
      chipRow('level', LEVELS.map((s) => ({ value: s.id, label: levelLabel(s.id) })), t('splits.filter.level')),
      chipRow('equipment', EQUIPMENT.map((s) => ({ value: s.id, label: placeLabel(s.id) })), t('splits.filter.equipment')));
    const list = filterSplits(SPLITS, filters);
    const any = Object.values(filters).some((v) => v != null);
    // My splits: the days filter matches sessions per week; style, level and equipment do not apply to them,
    // so with one of those set they are left out.
    const other = filters.style != null || filters.level != null || filters.equipment != null;
    const myList = other ? [] : mine.filter((m) => filters.days == null || sessionsPerWeekOf(m.cs) === filters.days);
    const myBlock = myList.length
      ? el('section', { class: 'section' }, sectionHeader(t('splits.mine')),
        el('div', { class: 'card card-flush list sp-results' }, myList.map((m) => customRow(m, byId))))
      : !any ? el('section', { class: 'section' }, sectionHeader(t('splits.mine')), el('div', { class: 'card card-flush list' }, newRow())) : null;
    replaceChildren(results,
      myBlock,
      el('section', { class: 'section' },
        sectionHeader(t('splits.count', { count: list.length }), {
          trail: any ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: reset }, t('splits.filter.reset')) : null,
        }),
        list.length
          ? el('div', { class: 'card card-flush list sp-results' }, list.map((s) => row(s, glyphs.get(s.id))))
          : el('div', { class: 'card' }, emptyState(t('splits.noMatch'),
            el('div', { class: 'sp-empty-actions' },
              el('button', { type: 'button', class: 'btn', onClick: reset }, t('splits.filter.resetAll')),
              el('button', { type: 'button', class: 'btn btn-ghost', onClick: openNew }, icon('plus', { size: 18 }), t('splits.new.title')))))));
  }

  append(container,
    pageHeader({ title: t('splits.title'), back: 'workout', info: 'split-choose', actions: [iconButton('plus', { label: t('splits.new.title'), onClick: openNew })] }),
    nextSlot, filterBox, results);
  paint();
  await renderNext();
}

function row(s, coverage) {
  return el('a', { class: 'list-item sp-row', href: href(`workout/splits/${encodeURIComponent(s.id)}`) },
    coverageGlyph(coverage),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, splitName(s)),
      el('div', { class: 'sp-row-sub' }, splitSuits(s)),
      el('div', { class: 'sp-tags' },
        tag(t('splits.days', { count: s.days }), { tone: 'accent' }), tag(styleLabel(s.style)),
        s.equipment === 'home' ? tag(placeLabel('home')) : null)),
    icon('chevron-right', { class: 'li-chevron' }));
}

/** A custom split as a library row: glyph, name, its sessions, days per week. */
function customRow({ cs, state, coverage, perWeek }, byId) {
  const names = cs.sessions.map((id) => (byId.get(id) ? routineName(byId.get(id)) : null)).filter(Boolean);
  return el('a', { class: 'list-item sp-row', href: href(splitPath(cs.id)) },
    coverageGlyph(coverage),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, splitName(cs)),
      el('div', { class: 'sp-row-sub' }, names.length ? names.join(' · ') : t('splits.noSessionsYet')),
      el('div', { class: 'sp-tags' },
        tag(t('splits.days', { count: perWeek }), { tone: 'accent' }),
        state.missing.length ? tag(t('splits.missing', { count: state.missing.length }), { tone: 'warn', icon: 'alert-triangle' }) : null)),
    icon('chevron-right', { class: 'li-chevron' }));
}
