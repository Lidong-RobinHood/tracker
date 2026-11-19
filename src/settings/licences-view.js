// Licences and data sources (#/licences): third-party code and data with their licences, linked
// content, AI providers, and how the numbers are calculated. Keep in step with THIRD-PARTY-NOTICES.md.
// Constants in the methods table come from src/core so the screen cannot drift from the code.
import { el, pageHeader } from '../ui/index.js';
import { KJ_PER_KCAL } from '../core/nutrition.js';
import { ACTIVITY_LEVELS, KCAL_PER_KG } from '../core/adaptive.js';
import { RECOVERY_CONFIG } from '../core/recovery.js';

const ext = (url, text) => el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, text);
/** Licence file in this repo, relative to the app root (works under a sub-path). */
const file = (path, text) => el('a', { href: path, target: '_blank', rel: 'noopener' }, text);
const p = (...c) => el('p', { class: 'small' }, ...c);
const b = (t) => el('strong', null, t);

function section(title, ...children) {
  return el('section', { class: 'section' }, el('h2', { class: 'section-title' }, title), el('div', { class: 'card stack' }, children));
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
  return el('table', { class: 'lic-table small' },
    el('thead', null, el('tr', null, el('th', { scope: 'col' }, 'Value'), el('th', { scope: 'col' }, 'How'))),
    el('tbody', null, rows.map(([what, how, src]) => el('tr', null,
      el('th', { scope: 'row' }, what),
      el('td', null, how, src ? el('div', { class: 'muted' }, src) : null)))));
}

export function mountLicences(container) {
  if (!document.querySelector('link[data-settings-css]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: new URL('./settings.css', import.meta.url).href, 'data-settings-css': '' }));
  }
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
    section('Exercise tutorials',
      p('Videos are on YouTube and belong to their creators. Links open YouTube.')),
    section('Meal photos (optional)',
      p('With your own API key, the photo and hint go directly to the AI provider you chose, under its terms.')),
    el('section', { class: 'section', id: 'methods' },
      el('h2', { class: 'section-title' }, 'How the numbers are calculated'),
      el('div', { class: 'card stack' }, methodsTable(),
        p('All figures are estimates. This app is not a medical device and does not replace professional advice.'))),
    p(el('span', { class: 'muted' }, 'Other product names are trademarks of their owners. This app is not affiliated with them.')),
  );
}
