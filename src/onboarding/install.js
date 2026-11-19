// "Install to the home screen" guidance for the current browser (welcome step and Help).
import { el, icon } from '../ui/index.js';
import { detectPlatform, isStandalone } from '../core/platform.js';

// Chrome/Edge/Samsung on Android fire beforeinstallprompt early; keep it for the Install button.
let deferredPrompt = null;
let installed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = null; });
}

function displayMode() {
  for (const m of ['standalone', 'fullscreen', 'minimal-ui']) {
    if (window.matchMedia && window.matchMedia(`(display-mode: ${m})`).matches) return m;
  }
  return 'browser';
}

/** The platform of this browser, evaluated now. */
export function currentPlatform() {
  const standalone = isStandalone({ displayMode: displayMode(), navigatorStandalone: /** @type {any} */ (navigator).standalone ?? null });
  return detectPlatform(navigator.userAgent, { standalone, maxTouchPoints: navigator.maxTouchPoints || 0 });
}

const steps = (...items) => el('ol', { class: 'ob-steps' }, items.map((i) => el('li', null, i)));
const b = (t) => el('strong', null, t);

/**
 * Guidance block for the platform.
 * @param {ReturnType<typeof detectPlatform>} p
 * @param {{compact?: boolean}} [opts] compact: Help (no separate-data paragraph for iOS duplicates; the
 *   Android install button gets its own why-sentence, which the welcome step has above the guide)
 * @returns {HTMLElement}
 */
export function installGuide(p, { compact = false } = {}) {
  const node = el('div', { class: 'stack ob-install', dataset: { install: p.install } });
  const box = { append: (...kids) => node.append(...kids.filter(Boolean)) };
  if (p.install === 'standalone' || installed) {
    box.append(el('p', { class: 'ob-ok' }, icon('circle-check', { size: 18 }), 'Installed.'));
    return node;
  }
  if (p.install === 'in-app') {
    const where = p.os === 'ios' ? 'Safari' : 'Chrome';
    box.append(
      el('p', { class: 'ob-note' }, `Open inside ${p.inApp === 'another app' ? 'another app' : p.inApp}: it cannot install apps and may delete your data.`),
      steps(
        ['Tap the ', icon('ellipsis', { size: 16, label: 'More', class: 'ob-inline-ic' }), ' or ', b('share'), ' button of that app (usually at the top or bottom).'],
        ['Choose ', b(`Open in ${where}`), ' (or ', b('Open in browser'), ').'],
        `Then continue in ${where}.`),
      el('p', { class: 't-sub muted' }, 'Or copy the link into your browser.'));
    return node;
  }
  if (p.install === 'ios-safari' || p.install === 'ios-other') {
    const shareWhere = p.install === 'ios-safari'
      ? ['Tap the ', b('Share'), ' button (square with an arrow, in the toolbar; on newer iOS first tap the ', b('More'), ' button).']
      : ['Tap the ', b('Share'), ' button (in Chrome and Edge it is in the address bar).'];
    box.append(
      steps(
        shareWhere,
        ['Scroll down and tap ', b('Add to Home Screen'), '.'],
        ['Tap ', b('Add'), ', then open ', b('Tracker'), ' from your home screen.']),
      p.install === 'ios-other'
        ? el('p', { class: 't-sub muted' }, 'Add to Home Screen missing (older iOS)? Open this page in Safari and do it there.')
        : null,
      compact ? null : el('p', { class: 'ob-note' },
        icon('triangle-exclamation-point', { size: 18 }),
        el('span', null, b('iPhone and iPad: '), 'the installed app has separate data. Install first, then set up inside it.')));
    return node;
  }
  if (p.install === 'android') {
    if (deferredPrompt) {
      const btn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'Install app');
      btn.addEventListener('click', async () => {
        const ev = deferredPrompt;
        if (!ev) return;
        deferredPrompt = null;
        ev.prompt();
        const choice = await ev.userChoice.catch(() => null);
        btn.replaceWith(el('p', null, choice && choice.outcome === 'accepted'
          ? 'Installed. Open Tracker from your home screen.'
          : 'Not installed. Install later from the browser menu.'));
      });
      // The welcome step already says why above the guide; Help (compact) has no such intro.
      box.append(compact ? el('p', null, 'Works offline, and the browser is less likely to clear data.') : null, btn);
      return node;
    }
    const menu = p.browser === 'samsung' ? [['Tap the menu (three lines) at the bottom.'], ['Tap ', b('Add page to'), ' → ', b('Home screen'), '.']]
      : p.browser === 'firefox' ? [['Tap the menu ', icon('ellipsis-vertical', { size: 16, label: 'three dots', class: 'ob-inline-ic' }), '.'], ['Tap ', b('Install'), ' (or ', b('Add to Home screen'), ').']]
        : [['Tap the browser menu ', icon('ellipsis-vertical', { size: 16, label: 'three dots', class: 'ob-inline-ic' }), ' (top right).'], ['Tap ', b('Install app'), ' (or ', b('Add to Home screen'), ').']];
    box.append(steps(...menu, ['Confirm, then open ', b('Tracker'), ' from your home screen.']));
    return node;
  }
  box.append(
    el('p', null, 'Tracker is made for phones. Open this link on your phone.'),
    el('p', { class: 't-sub muted' }, 'A computer and a phone never share data.'));
  return node;
}
