// "Install to the home screen" guidance for the current browser (welcome step and Help).
import { el, icon } from '../ui/index.js';
import { detectPlatform, isStandalone } from '../core/platform.js';
import { t } from '../i18n/index.js';
import { rich } from './rich.js';

// Chrome/Edge/Samsung on Android fire beforeinstallprompt early; keep it for the Install button.
let deferredPrompt = null;
let installed = false;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; });
  window.addEventListener('appinstalled', () => { installed = true; deferredPrompt = null; });
}

function displayMode() {
  for (const m of ['standalone', 'fullscreen', 'minimal-ui']) { // i18n-ignore (display modes)
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
const b = (text) => el('strong', null, text);
/** A step whose bold words are the menu items as the browser / OS shows them ({x} slots, see rich.js). */
const step = (key, bold = {}, extra = {}) => rich(`onboarding.install.${key}`,
  { ...Object.fromEntries(Object.entries(bold).map(([k, v]) => [k, b(t(`onboarding.install.${v}`))])), ...extra });

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
    box.append(el('p', { class: 'ob-ok' }, icon('circle-check', { size: 18 }), t('onboarding.install.installed')));
    return node;
  }
  if (p.install === 'in-app') {
    const where = p.os === 'ios' ? 'Safari' : 'Chrome'; // i18n-ignore (browser names)
    const app = p.inApp === 'another app' ? t('onboarding.install.anotherApp') : p.inApp;
    box.append(
      el('p', { class: 'ob-note' }, t('onboarding.install.inApp', { app })),
      steps(
        step('inAppMenu', { share: 'inAppShare' }, { more: icon('ellipsis', { size: 16, label: t('onboarding.install.moreIcon'), class: 'ob-inline-ic' }) }),
        rich('onboarding.install.inAppOpen', { openIn: b(t('onboarding.install.openIn', { browser: where })), openBrowser: b(t('onboarding.install.openInBrowser')) }),
        t('onboarding.install.continueIn', { browser: where })),
      el('p', { class: 't-sub muted' }, t('onboarding.install.copyLink')));
    return node;
  }
  if (p.install === 'ios-safari' || p.install === 'ios-other') {
    const shareWhere = p.install === 'ios-safari'
      ? step('iosShareSafari', { share: 'iosShare', more: 'iosMore' })
      : step('iosShareOther', { share: 'iosShare' });
    box.append(
      steps(
        shareWhere,
        step('iosAddToHome', { add: 'iosAddToHomeLabel' }),
        step('iosAdd', { add: 'iosAddLabel', app: 'appName' })),
      p.install === 'ios-other'
        ? el('p', { class: 't-sub muted' }, t('onboarding.install.iosOld'))
        : null,
      compact ? null : el('p', { class: 'ob-note' },
        icon('triangle-exclamation-point', { size: 18 }),
        el('span', null, b(t('onboarding.install.iosDataLead')), ' ', t('onboarding.install.iosData'))));
    return node;
  }
  if (p.install === 'android') {
    if (deferredPrompt) {
      const btn = el('button', { class: 'btn btn-primary btn-block', type: 'button' }, t('onboarding.install.installApp'));
      btn.addEventListener('click', async () => {
        const ev = deferredPrompt;
        if (!ev) return;
        deferredPrompt = null;
        ev.prompt();
        const choice = await ev.userChoice.catch(() => null);
        btn.replaceWith(el('p', null, choice && choice.outcome === 'accepted'
          ? t('onboarding.install.installedOpen')
          : t('onboarding.install.notInstalled')));
      });
      // The welcome step already says why above the guide; Help (compact) has no such intro.
      box.append(compact ? el('p', null, t('onboarding.install.why')) : null, btn);
      return node;
    }
    const dots = () => icon('ellipsis-vertical', { size: 16, label: t('onboarding.install.threeDots'), class: 'ob-inline-ic' });
    const menu = p.browser === 'samsung' ? [t('onboarding.install.samsungMenu'), step('samsungAdd', { addTo: 'samsungAddPage', home: 'samsungHome' })]
      : p.browser === 'firefox' ? [step('firefoxMenu', {}, { dots: dots() }), step('firefoxInstall', { install: 'firefoxInstallLabel', add: 'firefoxAddLabel' })]
        : [step('chromeMenu', {}, { dots: dots() }), step('chromeInstall', { install: 'chromeInstallLabel', add: 'chromeAddLabel' })];
    box.append(steps(...menu, step('androidConfirm', { app: 'appName' })));
    return node;
  }
  box.append(
    el('p', null, t('onboarding.install.desktop')),
    el('p', { class: 't-sub muted' }, t('onboarding.install.desktopNote')));
  return node;
}
