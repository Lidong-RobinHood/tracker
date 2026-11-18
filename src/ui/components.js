// Small reusable building blocks that match the classes in app.css.
import { el } from './dom.js';
import { back as goBack } from './nav.js';

/**
 * Sticky page header.
 * @param {{title: string, subtitle?: string, back?: string|boolean, actions?: Node[]}} opts
 *   back: true -> history back (fallback 'diary'); a path string -> back with that fallback.
 */
export function pageHeader({ title, subtitle, back, actions = [] }) {
  const backBtn = back
    ? el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Back',
      onClick: () => goBack(typeof back === 'string' ? back : 'diary') }, '‹')
    : null;
  return el('header', { class: 'page-header' },
    backBtn,
    el('div', { class: 'page-title-wrap' },
      el('h1', { class: 'page-title' }, title),
      subtitle ? el('div', { class: 'page-subtitle' }, subtitle) : null),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null);
}

/**
 * Labelled form field. @param {string} label @param {HTMLElement} control input/select/textarea
 * @param {{hint?: string, unit?: string}} [opts] unit renders a suffix like 'kcal' or 'g'
 */
export function field(label, control, { hint, unit } = {}) {
  if (!control.id) control.id = `f-${Math.random().toString(36).slice(2)}`;
  return el('div', { class: 'field' },
    el('label', { class: 'field-label', htmlFor: control.id }, label),
    unit ? el('div', { class: 'input-unit' }, control, el('span', { class: 'unit' }, unit)) : control,
    hint ? el('div', { class: 'field-hint' }, hint) : null);
}

/** Centered placeholder text for empty lists. */
export function emptyState(text, ...children) {
  return el('div', { class: 'empty' }, el('p', text), children);
}
