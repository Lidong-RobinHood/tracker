// Bottom sheet, centred modal and confirm dialog. All overlays close on navigation.
import { el } from './dom.js';

const open = new Set();

function root() {
  let r = document.getElementById('overlay-root');
  if (!r) r = document.body.appendChild(el('div', { id: 'overlay-root' }));
  return r;
}

/**
 * @typedef {object} Overlay
 * @property {HTMLElement} el      the panel element
 * @property {HTMLElement} body    put your content here (scrolls)
 * @property {HTMLElement} footer  optional action area (empty and hidden until you append to it)
 * @property {(result?: any) => void} close  close it; `result` resolves `closed`
 * @property {Promise<any>} closed resolves once closed (undefined when dismissed)
 */

function openOverlay(kind, { title = '', content = null, onClose = null, dismissible = true, className = '' } = {}) {
  let resolveClosed;
  const closed = new Promise((r) => { resolveClosed = r; });
  const titleId = `ov-title-${Math.random().toString(36).slice(2)}`;

  const body = el('div', { class: 'overlay-body' }, content);
  const footer = el('div', { class: 'overlay-footer' });
  const closeBtn = dismissible
    ? el('button', { class: 'btn btn-icon btn-ghost', type: 'button', 'aria-label': 'Close', onClick: () => api.close() }, '×')
    : null;
  const header = title || closeBtn
    ? el('div', { class: 'overlay-header' }, el('h2', { id: titleId, class: 'overlay-title' }, title), closeBtn)
    : null;
  const panel = el('div', {
    class: [kind, className], role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': title ? titleId : null, tabindex: '-1',
  }, kind === 'sheet' ? el('div', { class: 'sheet-handle', 'aria-hidden': 'true' }) : null, header, body, footer);
  const backdrop = el('div', { class: `backdrop backdrop-${kind}` }, panel);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop && dismissible) api.close(); });
  const onKey = (e) => { if (e.key === 'Escape' && dismissible && isTop()) { e.stopPropagation(); api.close(); } };
  document.addEventListener('keydown', onKey);
  const isTop = () => [...open].pop() === api;
  const previousFocus = document.activeElement;

  let isClosed = false;
  const api = {
    el: panel, body, footer, closed,
    close(result) {
      if (isClosed) return;
      isClosed = true;
      open.delete(api);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (!open.size) document.documentElement.classList.remove('overlay-open');
      try { if (onClose) onClose(result); } finally {
        resolveClosed(result);
        if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
      }
    },
  };
  open.add(api);
  document.documentElement.classList.add('overlay-open');
  root().append(backdrop);
  // Focus the panel itself so the keyboard does not pop up; callers may focus a field.
  requestAnimationFrame(() => { if (!isClosed && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true }); });
  return api;
}

/**
 * Bottom sheet (slides up from the bottom, full width on phones).
 * @param {{title?: string, content?: Node|Node[]|string, onClose?: (result:any)=>void,
 *          dismissible?: boolean, className?: string}} opts
 *   onClose runs exactly once, however it was closed (button, backdrop, Esc, navigation) —
 *   stop cameras/timers there.
 * @returns {Overlay}
 */
export function openSheet(opts) {
  return openOverlay('sheet', opts);
}

/** Centred modal. Same options and return value as openSheet. @returns {Overlay} */
export function openModal(opts) {
  return openOverlay('modal', opts);
}

/**
 * Yes/no question. Resolves true only if the confirm button was pressed.
 * @param {{title?: string, message?: string|Node, confirmLabel?: string, cancelLabel?: string, danger?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  const m = openModal({ title, content: typeof message === 'string' ? el('p', message) : message, className: 'confirm' });
  const ok = el('button', { class: ['btn', danger ? 'btn-danger' : 'btn-primary'], type: 'button', onClick: () => m.close(true) }, confirmLabel);
  m.footer.append(
    el('button', { class: 'btn', type: 'button', onClick: () => m.close(false) }, cancelLabel),
    ok,
  );
  requestAnimationFrame(() => ok.focus());
  return m.closed.then((r) => r === true);
}

/** Close every open overlay (the router calls this on navigation). */
export function closeAllOverlays() {
  for (const o of [...open].reverse()) o.close();
}
