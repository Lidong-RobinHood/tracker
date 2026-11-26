// Info button (ⓘ) and the small sheet it opens. Texts live in ./info-sheets.js, keyed by id.
//   cardTitleRow.append(infoButton('recovery'));
//   infoButton('sets', { values: { primary: 1, secondary: 0.5, dropset: 0 } })  // user's own factors
import { el } from './dom.js';
import { openSheet } from './overlay.js';
import { icon } from './icons.js';
import { infoSheet } from './info-sheets.js';
import { t, getLanguage } from '../i18n/index.js';

// English only: 'About muscle recovery'. German nouns keep their capital; Chinese has no case.
const lowerFirst = (s) => (getLanguage() === 'en' && /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * Open the info sheet `id` (title + 1–3 short paragraphs, nothing else).
 * @param {string} id @param {{values?: Record<string, any>}} [opts]
 * @returns {import('./overlay.js').Overlay|null}
 */
export function openInfo(id, { values } = {}) {
  const s = infoSheet(id, values);
  if (!s) { console.error(`openInfo(): unknown info sheet "${id}"`); return null; }
  return openSheet({
    title: s.title,
    className: 'info-sheet',
    content: s.paragraphs.map((p) => el('p', { class: 'info-text' }, p)),
  });
}

/**
 * 44 px ghost icon button that opens info sheet `sheetId`. Place it right after a section or card
 * title (or a value); never add a sentence that introduces it.
 * @param {string} sheetId id in src/ui/info-sheets.js (tests/info-sheets.test.js checks every id used)
 * @param {{values?: Record<string, any>, label?: string, class?: string}} [opts]
 *   label: accessible name, default 'About <sheet title>'.
 * @returns {HTMLButtonElement}
 */
export function infoButton(sheetId, { values, label, class: cls } = {}) {
  const s = infoSheet(sheetId, values);
  if (!s) console.error(`infoButton(): unknown info sheet "${sheetId}"`);
  return /** @type {HTMLButtonElement} */ (el('button', {
    type: 'button',
    class: ['btn', 'btn-icon', 'btn-ghost', 'btn-info', cls],
    'aria-label': label || t('common.info.about', { title: s ? lowerFirst(s.title) : sheetId }),
    'aria-haspopup': 'dialog',
    dataset: { info: sheetId },
    onClick: () => { openInfo(sheetId, { values }); },
  }, icon('info', { size: 18 })));
}
