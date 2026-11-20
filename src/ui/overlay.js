// Bottom sheet, centred modal and confirm dialog. All overlays close on navigation.
// Each dismissible overlay adds a history entry (same URL), so the phone's Back button closes the top
// overlay instead of leaving the screen; closing it with its own controls removes that entry again.
import { el } from './dom.js';
import { icon } from './icons.js';

const open = new Set();

// ---------------------------------------------------------------- history entries

/** Differs per page load: entries left over from before a reload are recognised as stale. */
const SESSION = Math.random().toString(36).slice(2);
let traversals = 0;   // history.back() calls made here whose popstate has not arrived yet
let waiting = [];     // run once those have arrived (pushState / navigation must not race them)
let settleTimer = null;

/** @returns {{session: string, id: string, depth: number}|null} overlay entry we are on */
function entryNow() {
  const s = history.state;
  return s && typeof s === 'object' && s.trackerOverlay ? s.trackerOverlay : null;
}
const isOpenEntry = (e) => [...open].some((o) => o.entry && o.entry.session === e.session && o.entry.id === e.id);

function settle() {
  traversals = 0;
  clearTimeout(settleTimer);
  const fns = waiting;
  waiting = [];
  for (const fn of fns) { try { fn(); } catch (err) { console.error(err); } }
}

/**
 * Run fn now, or after the history steps this module started have finished. nav.js uses it so that
 * navigate()/back() right after closing an overlay act on the page entry, not the overlay's.
 * @internal
 */
export function _afterHistory(fn) {
  if (traversals) waiting.push(fn); else fn();
}

function goBack() {
  traversals++;
  clearTimeout(settleTimer);
  settleTimer = setTimeout(settle, 1500); // no popstate (e.g. nothing to go back to): don't block
  history.back();
}

window.addEventListener('popstate', () => {
  if (traversals) traversals--;
  const now = entryNow();
  const depth = now && now.session === SESSION ? now.depth : 0;
  // Back button: close every overlay whose entry is above the one we are on now (normally just the top one).
  for (const o of [...open].reverse()) if (o.entry && o.entry.depth > depth) o.close(undefined, 'history');
  // The entry of an overlay that is no longer open (closed by navigation, or left from before a reload)
  // is never a resting place: keep going back to the page entry under it.
  if (now && !isOpenEntry(now)) { goBack(); return; }
  if (!traversals) settle();
});

/**
 * After a reload the current entry may still be an overlay entry: go back to the page entry
 * under it, so the next Back press does not seem to do nothing. Called once at boot. @internal
 */
export function _dropStaleOverlayEntry() {
  const now = entryNow();
  if (now && now.session !== SESSION) goBack();
}

// ---------------------------------------------------------------- tap guard

// For a moment after an overlay closes, taps are swallowed: the second tap of a quick double tap on a
// sheet's button must not land on whatever was underneath (tab bar, list rows, …).
const GUARD_MS = 350;
let guardUntil = 0;
function swallow(e) {
  if (!e.isTrusted || performance.now() >= guardUntil) return;
  e.preventDefault();
  e.stopPropagation();
}
window.addEventListener('click', swallow, true);
window.addEventListener('touchend', swallow, { capture: true, passive: false });

// ---------------------------------------------------------------- inert background

// While an overlay is open, everything behind it (page, tab bar, lower overlays) is `inert`: not
// focusable, not tappable, hidden from assistive tech. Toasts stay live (their Undo must work).
const backdrops = new WeakMap();
const madeInert = new Set();
function updateInert() {
  const any = open.size > 0;
  for (const n of [...madeInert]) {
    if (!any || !n.isConnected) { n.inert = false; madeInert.delete(n); }
  }
  if (any) {
    for (const n of document.body.children) {
      if (n.id === 'overlay-root' || n.id === 'toast-root' || n.tagName === 'SCRIPT' || n.tagName === 'NOSCRIPT' || n.inert) continue;
      n.inert = true;
      madeInert.add(n);
    }
  }
  const top = [...open].pop();
  for (const o of open) { const b = backdrops.get(o); if (b) b.inert = o !== top; }
}

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
    ? el('button', { class: 'btn btn-icon btn-ghost overlay-close', type: 'button', 'aria-label': 'Close', onClick: () => api.close() }, icon('x'))
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
    /** @type {{session: string, id: string, depth: number}|null} its history entry, once pushed */
    entry: null,
    /**
     * @param {any} [result]
     * @param {'history'|'navigation'} [why] internal: closed by Back / by the router (history already moved)
     */
    close(result, why) {
      if (isClosed) return;
      isClosed = true;
      open.delete(api);
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      guardUntil = performance.now() + GUARD_MS;
      if (!open.size) document.documentElement.classList.remove('overlay-open');
      updateInert();
      // Closed by its own controls: remove its history entry (if we are on it once pending steps are done).
      const entry = api.entry;
      if (entry && !why) {
        _afterHistory(() => {
          const now = entryNow();
          if (now && now.session === entry.session && now.id === entry.id) goBack();
        });
      }
      try { if (onClose) onClose(result); } finally {
        resolveClosed(result);
        if (previousFocus && previousFocus.focus && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
      }
    },
  };
  open.add(api);
  backdrops.set(api, backdrop);
  document.documentElement.classList.add('overlay-open');
  root().append(backdrop);
  updateInert();
  // A non-dismissible overlay (e.g. "Workout finished") gets no entry: Back keeps its old behaviour.
  if (dismissible) {
    _afterHistory(() => {
      if (isClosed) return;
      const now = entryNow();
      api.entry = { session: SESSION, id: titleId, depth: (now && now.session === SESSION ? now.depth : 0) + 1 };
      history.pushState({ trackerOverlay: api.entry }, '');
    });
  }
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
    el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => m.close(false) }, cancelLabel),
    ok,
  );
  requestAnimationFrame(() => ok.focus());
  return m.closed.then((r) => r === true);
}

/**
 * Close every open overlay. The router calls it on navigation with `{ navigation: true }` (the history
 * has already moved on; the overlays' entries are skipped when Back reaches them).
 */
export function closeAllOverlays({ navigation = false } = {}) {
  for (const o of [...open].reverse()) o.close(undefined, navigation ? 'navigation' : undefined);
}
