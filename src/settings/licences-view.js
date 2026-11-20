// Licences and data sources (#/licences): third-party code and data with their licences, linked
// content, AI providers, and how the numbers are calculated. Keep in step with THIRD-PARTY-NOTICES.md.
// Constants in the methods table come from src/core so the screen cannot drift from the code.
import { el, pageHeader, sectionHeader, icon } from '../ui/index.js';
import { ensureCss } from './css.js';
import { KJ_PER_KCAL } from '../core/nutrition.js';
import { ACTIVITY_LEVELS, KCAL_PER_KG } from '../core/adaptive.js';
import { RECOVERY_CONFIG } from '../core/recovery.js';
import { SPLIT_SOURCES, SPLIT_BASIS, SPLIT_DISCLAIMER } from '../data/splits.js';

const ext = (url, text) => el('a', { class: 'lic-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, text, icon('external-link', { size: 14, class: 'lic-ext' }));
/** Licence file in this repo, relative to the app root (works under a sub-path). */
const file = (path, text) => el('a', { class: 'lic-link', href: path, target: '_blank', rel: 'noopener' }, text);
const p = (...c) => el('p', { class: 'lic-text' }, ...c);
const b = (t) => el('strong', null, t);

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
  const rows = [
    ['Energy from macros', '4 kcal per g protein and carbohydrate, 9 kcal per g fat', 'Atwater factors'],
    ['kJ to kcal', `kJ ÷ ${KJ_PER_KCAL}`, null],
    ['Salt', 'sodium × 2.5', 'Standard conversion'],
    ['Estimated 1RM', 'weight × (1 + reps ÷ 30); 1 rep = the weight', 'Epley formula'],
    ['Resting energy', '10 × kg + 6.25 × cm − 5 × age, then +5 (male), −161 (female), −78 (other)', 'Mifflin-St Jeor (Mifflin et al., 1990)'],
    ['Daily energy (formula)', `resting energy × ${factors} (by activity level)`, 'Common activity factors'],
    ['Body-weight change', `${KCAL_PER_KG.toLocaleString('en-GB').replace(',', ' ')} kcal per kg`, 'Common approximation'],
    ['Recovery', `${lo}–${hi} h per muscle by size, scaled by sets`, 'Rule of thumb, not a measurement'],
  ];
  return el('table', { class: 'lic-table' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Value'), el('th', { scope: 'col' }, 'How'))),
    el('tbody', null, rows.map(([what, how, src]) => el('tr', null,
      el('th', { scope: 'row' }, what),
      el('td', null, how, src ? el('div', { class: 'muted lic-src' }, src) : null)))));
}

/** Split library: what it rests on and its verified sources (docs/SPLITS.md › Evidence). */
function trainingSection() {
  return el('section', { class: 'section', id: 'split-sources' },
    sectionHeader('Training guidance'),
    el('div', { class: 'card lic-card' },
      SPLIT_BASIS.map((t) => p(t)),
      el('ul', { class: 'lic-sources', style: { margin: 0, paddingLeft: 'var(--s4)', display: 'flex', flexDirection: 'column', gap: 'var(--s2)' } }, SPLIT_SOURCES.map((x) => el('li', { class: 'lic-text' },
        `${x.cite}. `, x.title ? `${x.title} ` : null, `${x.ref}. `, ext(x.url, x.id)))),
      p(SPLIT_DISCLAIMER)));
}

export function mountLicences(container, params, ctx) {
  ensureCss();
  container.classList.add('settings-view');
  container.append(
    pageHeader({ title: 'Licences and data sources', back: 'settings' }),
    section('Food data',
      p(b('Generic foods: '), ext('https://fdc.nal.usda.gov', 'USDA FoodData Central'), ' (SR Legacy), public domain (CC0). U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.'),
      p(b('Packaged products: '), 'Contains data from ', ext('https://world.openfoodfacts.org', 'Open Food Facts'),
        ', available under the ', ext('https://opendatacommons.org/licenses/odbl/1-0/', 'Open Database License'), '. Data can contain errors; check the label.')),
    section('Barcode scanner',
      p('barcode-detector 3.2.4 (', file('vendor/barcode-detector/LICENSE-barcode-detector.txt', 'MIT'), '), zxing-wasm 3.1.7 (',
        file('vendor/barcode-detector/LICENSE-zxing-wasm.txt', 'MIT'), '), ', ext('https://github.com/zxing-cpp/zxing-cpp', 'zxing-cpp'), ' (',
        file('vendor/barcode-detector/LICENSE-zxing-cpp.txt', 'Apache License 2.0'), ').')),
    section('Icons',
      p(ext('https://lucide.dev', 'Lucide'), ' (', file('vendor/icons/LICENSE-lucide.txt', 'ISC License'),
        '; icons derived from Feather: MIT License, same file). ', ext('https://tabler.io/icons', 'Tabler Icons'),
        ', barbell icon (', file('vendor/icons/LICENSE-tabler-icons.txt', 'MIT License'), ').')),
    section('Exercise tutorials',
      p('Videos are on YouTube and belong to their creators. Links open YouTube.')),
    section('Meal photos (optional)',
      p('With your own API key, the photo and hint go directly to the AI provider you chose, under its terms.')),
    el('section', { class: 'section', id: 'methods' },
      sectionHeader('How the numbers are calculated'),
      el('div', { class: 'card lic-card' }, methodsTable(),
        p('All figures are estimates. This app is not a medical device and does not replace professional advice.'))),
    trainingSection(),
    el('p', { class: 't-sub muted lic-foot' }, 'Other product names are trademarks of their owners. This app is not affiliated with them.'),
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
