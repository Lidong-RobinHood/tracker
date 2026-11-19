// "Install to the home screen" guidance for the current browser (welcome step and Help).
import { el } from '../ui/index.js';
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
 * @param {{compact?: boolean}} [opts] compact: Help (no separate-data paragraph for iOS duplicates)
 * @returns {HTMLElement}
 */
export function installGuide(p, { compact = false } = {}) {
  const node = el('div', { class: 'stack ob-install', dataset: { install: p.install } });
  const box = { append: (...kids) => node.append(...kids.filter(Boolean)) };
  if (p.install === 'standalone' || installed) {
    box.append(el('p', null, 'You are using the installed app. Nothing to do here.'));
    return node;
  }
  if (p.install === 'in-app') {
    const where = p.os === 'ios' ? 'Safari' : 'Chrome';
    box.append(
      el('p', null, `This page is open inside ${p.inApp === 'another app' ? 'another app' : p.inApp}. That app’s browser cannot install apps and may delete what you enter here.`),
      steps(
        ['Tap the ', b('⋯'), ' or ', b('share'), ' button of that app (usually at the top or bottom).'],
        ['Choose ', b(`Open in ${where}`), ' (or ', b('Open in browser'), ').'],
        `Then continue in ${where}.`),
      el('p', { class: 'small muted' }, 'You can also copy the link and paste it into the browser.'));
    return node;
  }
  if (p.install === 'ios-safari' || p.install === 'ios-other') {
    const shareWhere = p.install === 'ios-safari'
      ? ['Tap the ', b('Share'), ' button (square with an arrow, in the toolbar; on newer iOS first tap ', b('⋯'), ').']
      : ['Tap the ', b('Share'), ' button (in Chrome and Edge it is in the address bar).'];
    box.append(
      steps(
        shareWhere,
        ['Scroll down and tap ', b('Add to Home Screen'), '.'],
        ['Tap ', b('Add'), ', then open ', b('Tracker'), ' from your home screen.']),
      p.install === 'ios-other'
        ? el('p', { class: 'small muted' }, 'If Add to Home Screen is missing (older iOS), open this page in Safari and do it there.')
        : null,
      compact ? null : el('p', { class: 'ob-note' },
        b('Important on iPhone and iPad: '),
        'the home-screen app keeps its own data, separate from the browser. Install first, then do this setup inside the installed app. '
        + 'Anything you enter here in the browser stays here and does not appear in the app.'));
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
          ? 'Installed. You can open Tracker from your home screen or app drawer.'
          : 'Not installed. You can install it later from the browser menu.'));
      });
      box.append(el('p', null, 'Install Tracker so it opens like an app, works offline and the browser is less likely to clear its data.'), btn);
      return node;
    }
    const menu = p.browser === 'samsung' ? [['Tap the menu ', b('≡'), ' at the bottom.'], ['Tap ', b('Add page to'), ' → ', b('Home screen'), '.']]
      : p.browser === 'firefox' ? [['Tap the menu ', b('⋮'), '.'], ['Tap ', b('Install'), ' (or ', b('Add to Home screen'), ').']]
        : [['Tap the browser menu ', b('⋮'), ' (top right).'], ['Tap ', b('Install app'), ' (or ', b('Add to Home screen'), ').']];
    box.append(steps(...menu, ['Confirm, then open ', b('Tracker'), ' from your home screen.']));
    return node;
  }
  box.append(
    el('p', null, 'This looks like a computer. Tracker is made for phones: open the same link on your phone and install it there.'),
    el('p', { class: 'small muted' }, 'Chrome and Edge on a computer show an install icon in the address bar. A computer and a phone never share data.'));
  return node;
}
