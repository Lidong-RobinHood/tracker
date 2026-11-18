// Short non-blocking messages at the bottom of the screen.
import { el } from './dom.js';

/**
 * @param {string} message
 * @param {{type?: 'info'|'success'|'error', duration?: number,
 *          action?: {label: string, onClick: () => void}}} [opts]
 *   duration in ms (default 2500, 5000 with an action). An action renders a button, e.g. Undo.
 * @returns {() => void} dismiss function
 */
export function toast(message, { type = 'info', duration, action } = {}) {
  let host = document.getElementById('toast-root');
  if (!host) host = document.body.appendChild(el('div', { id: 'toast-root', 'aria-live': 'polite' }));
  const node = el('div', { class: ['toast', `toast-${type}`], role: type === 'error' ? 'alert' : 'status' },
    el('span', { class: 'toast-msg' }, message),
    action ? el('button', { class: 'toast-action', type: 'button', onClick: () => { dismiss(); action.onClick(); } }, action.label) : null);
  host.append(node);
  const timer = setTimeout(() => dismiss(), duration ?? (action ? 5000 : 2500));
  function dismiss() {
    clearTimeout(timer);
    node.remove();
  }
  return dismiss;
}
