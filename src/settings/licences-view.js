// Licences and data sources (#/licences): third-party code and data with their licences, linked
// content, AI providers, and how the numbers are calculated. Keep in step with THIRD-PARTY-NOTICES.md.
// Constants in the methods table come from src/core so the screen cannot drift from the code.
import { el, pageHeader, sectionHeader, icon } from '../ui/index.js';
import { ensureCss } from './css.js';
import { t } from '../i18n/index.js';
import { KJ_PER_KCAL } from '../core/nutrition.js';
import { ACTIVITY_LEVELS, KCAL_PER_KG } from '../core/adaptive.js';
import { RECOVERY_CONFIG } from '../core/recovery.js';
import { SPLIT_SOURCES, SPLIT_BASIS } from '../data/splits.js';

const ext = (url, text) => el('a', { class: 'lic-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, text, icon('external-link', { size: 14, class: 'lic-ext' }));
/** Licence file in this repo, relative to the app root (works under a sub-path). */
const file = (path, text) => el('a', { class: 'lic-link', href: path, target: '_blank', rel: 'noopener' }, text);
const p = (...c) => el('p', { class: 'lic-text' }, ...c);
const b = (text) => el('strong', null, text);

function section(title, ...children) {
  return el('section', { class: 'section' }, sectionHeader(title), el('div', { class: 'card lic-card' }, children));
}

/** 7700 → '7 700' (thin space, as in the rest of the docs). */
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+$)/g, '\u202f');

function methodsTable() {
  const factors = ACTIVITY_LEVELS.map((a) => String(a.factor)).join(' / ');
  const ranges = Object.values(RECOVERY_CONFIG.base);
  const lo = Math.min(...ranges.map((r) => r[0]));
  const hi = Math.max(...ranges.map((r) => r[1]));
  // [label, how, source]; method and author names (Mifflin-St Jeor …) stay as published.
  const rows = [
    [t('settings.lic.m.macros'), t('settings.lic.m.macrosHow'), t('settings.lic.m.macrosSrc')],
    [t('settings.lic.m.kj'), `kJ ÷ ${KJ_PER_KCAL}`, null],
    [t('settings.lic.m.salt'), t('settings.lic.m.saltHow'), t('settings.lic.m.saltSrc')],
    [t('settings.lic.m.e1rm'), t('settings.lic.m.e1rmHow'), t('settings.lic.m.e1rmSrc')],
    [t('settings.lic.m.resting'), t('settings.lic.m.restingHow'), 'Mifflin-St Jeor (Mifflin et al., 1990)'], // i18n-ignore (citation)
    [t('settings.lic.m.daily'), t('settings.lic.m.dailyHow', { factors }), t('settings.lic.m.dailySrc')],
    [t('settings.lic.m.weight'), t('settings.lic.m.weightHow', { kcal: thousands(KCAL_PER_KG) }), t('settings.lic.m.weightSrc')],
    [t('settings.lic.m.recovery'), t('settings.lic.m.recoveryHow', { lo, hi }), t('settings.lic.m.recoverySrc')],
  ];
  return el('table', { class: 'lic-table' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, t('settings.lic.value')), el('th', { scope: 'col' }, t('settings.lic.how')))),
    el('tbody', null, rows.map(([what, how, src]) => el('tr', null,
      el('th', { scope: 'row' }, what),
      el('td', null, how, src ? el('div', { class: 'muted lic-src' }, src) : null)))));
}

/** Split library: what it rests on and its verified sources (docs/SPLITS.md › Evidence). */
function trainingSection() {
  return el('section', { class: 'section', id: 'split-sources' },
    sectionHeader(t('settings.lic.training')),
    el('div', { class: 'card lic-card' },
      SPLIT_BASIS.map((_, i) => p(t(`data.splitGuide.basis${i + 1}`))),
      el('ul', { class: 'lic-sources', style: { margin: 0, paddingLeft: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' } }, SPLIT_SOURCES.map((x) => el('li', { class: 'lic-text' }, // i18n-ignore (CSS values)
        `${x.cite}. `, x.title ? `${x.title} ` : null, `${x.ref}. `, ext(x.url, x.id)))),
      p(t('data.splitGuide.disclaimer'))));
}

export function mountLicences(container, params, ctx) {
  ensureCss();
  container.classList.add('settings-view');
  // Third-party names, licence names and required attribution lines stay verbatim in English (legal texts);
  // headings and our own wording are translated.
  container.append(
    pageHeader({ title: t('settings.about.licences'), back: 'settings' }),
    section(t('settings.lic.food'),
      // i18n-ignore-start (USDA attribution and licence name, verbatim)
      p(b(t('settings.lic.generic')), ' ', ext('https://fdc.nal.usda.gov', 'USDA FoodData Central'), ' (SR Legacy; Survey (FNDDS) 2021-2023), public domain (CC0). U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov. U.S. Department of Agriculture, Agricultural Research Service. 2024. USDA Food and Nutrient Database for Dietary Studies 2021-2023. Food Surveys Research Group.'),
      // i18n-ignore-end
      p(b(t('settings.lic.dishes')), ' ', t('settings.lic.dishesText')),
      p(b(t('settings.lic.packaged')), ' ',
        // i18n-ignore-start (Open Food Facts / ODbL attribution notice, verbatim)
        'Contains data from ', ext('https://world.openfoodfacts.org', 'Open Food Facts'),
        ', available under the ', ext('https://opendatacommons.org/licenses/odbl/1-0/', 'Open Database License'), '. ',
        // i18n-ignore-end
        t('settings.lic.dataErrors'))),
    section(t('settings.lic.barcode'),
      // i18n-ignore-start (project and licence names)
      p('barcode-detector 3.2.4 (', file('vendor/barcode-detector/LICENSE-barcode-detector.txt', 'MIT'), '), zxing-wasm 3.1.7 (',
        file('vendor/barcode-detector/LICENSE-zxing-wasm.txt', 'MIT'), '), ', ext('https://github.com/zxing-cpp/zxing-cpp', 'zxing-cpp'), ' (',
        file('vendor/barcode-detector/LICENSE-zxing-cpp.txt', 'Apache License 2.0'), ').')),
    section(t('settings.lic.icons'),
      p(ext('https://lucide.dev', 'Lucide'), ' (', file('vendor/icons/LICENSE-lucide.txt', 'ISC License'),
        // i18n-ignore-end
        `; ${t('settings.lic.feather')}). `, ext('https://tabler.io/icons', 'Tabler Icons'), // i18n-ignore (brand name)
        `, ${t('settings.lic.barbell')} (`, file('vendor/icons/LICENSE-tabler-icons.txt', 'MIT License'), ').')), // i18n-ignore (licence name)
    section(t('settings.lic.tutorials'),
      p(t('settings.lic.tutorialsText'))),
    section(t('settings.lic.photos'),
      p(t('settings.lic.photosText'))),
    el('section', { class: 'section', id: 'methods' },
      sectionHeader(t('settings.lic.methods')),
      el('div', { class: 'card lic-card' }, methodsTable(),
        p(t('settings.lic.estimates')))),
    trainingSection(),
    el('p', { class: 't-sub muted lic-foot' }, t('settings.lic.trademarks')),
  );
  // #/licences?section=split-sources (split detail › Methods and sources) jumps to that section.
  const target = ctx && ctx.query && ctx.query.section ? container.querySelector(`#${CSS.escape(ctx.query.section)}`) : null;
  if (target) scrollBelowHeader(container, target);
}

/**
 * Scroll `target` to the top, fully below the sticky page header (its measured height + 8 px). Waits
 * for settings.css: scrolling before it applies leaves the section partly under the header.
 */
function scrollBelowHeader(container, target) {
  let cancelled = false;
  const cancel = () => { cancelled = true; };
  window.addEventListener('touchstart', cancel, { once: true, passive: true });
  window.addEventListener('wheel', cancel, { once: true, passive: true });
  const go = () => requestAnimationFrame(() => {
    window.removeEventListener('touchstart', cancel);
    window.removeEventListener('wheel', cancel);
    if (cancelled || !target.isConnected) return;
    const head = container.querySelector('.page-header');
    target.style.scrollMarginTop = `${Math.ceil(head ? head.getBoundingClientRect().height : 0) + 8}px`;
    target.scrollIntoView({ block: 'start' });
  });
  const link = /** @type {HTMLLinkElement|null} */ (document.querySelector('link[data-settings-css]'));
  if (link && !link.sheet) {
    link.addEventListener('load', go, { once: true });
    link.addEventListener('error', go, { once: true });
  } else go();
}
