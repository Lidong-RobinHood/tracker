// Platform detection for the install guidance (first-run setup and Help). Pure, no DOM:
// the caller passes navigator.userAgent, navigator.maxTouchPoints and whether the app runs standalone.
//
// What matters for installing a web app to the home screen:
//   - already running from the home screen (standalone)  → nothing to do
//   - inside another app's browser (Instagram, WhatsApp…) → open the link in Safari/Chrome first
//     (in-app browsers keep their own storage, which the host app may wipe, and cannot install)
//   - iPhone/iPad: Safari → Share → Add to Home Screen. Other iOS browsers (Chrome, Edge, Firefox)
//     use Safari's engine and can add to the home screen from their share menu on iOS 16.4+.
//     The home-screen app keeps its OWN storage, separate from Safari.
//   - Android: Chrome offers an install prompt (beforeinstallprompt) or menu → Install app;
//     Samsung Internet, Firefox and Edge have their own menu entries.
//   - anything else: a computer; the app is made for phones.

/** UA fragments of apps that open links in their own embedded browser. Order: most specific first. */
// i18n-ignore-start (app brand names, not translated)
const IN_APP = [
  ['Instagram', /Instagram/i],
  ['Facebook Messenger', /Messenger|FBAN\/Messenger|MessengerForiOS/i],
  ['Facebook', /FBAN|FBAV|FB_IAB|FBIOS/],
  ['WhatsApp', /WhatsApp/i],
  ['Threads', /Barcelona/],
  ['LinkedIn', /LinkedInApp/i],
  ['Snapchat', /Snapchat/i],
  ['TikTok', /musical_ly|BytedanceWebview|TikTok/i],
  ['WeChat', /MicroMessenger/i],
  ['LINE', /\bLine\//],
  ['Telegram', /Telegram/i],
  ['X (Twitter)', /Twitter/i],
  ['Pinterest', /Pinterest/i],
  ['Discord', /Discord/i],
  ['Google app', /\bGSA\//],
];
// i18n-ignore-end

/**
 * Whether the page runs as an installed app.
 * @param {{displayMode?: string|null, navigatorStandalone?: boolean|null}} s
 *   displayMode: the matching CSS display-mode ('standalone', 'fullscreen', 'minimal-ui', 'browser');
 *   navigatorStandalone: iOS Safari's navigator.standalone
 */
export function isStandalone({ displayMode = null, navigatorStandalone = null } = {}) {
  return navigatorStandalone === true || displayMode === 'standalone' || displayMode === 'fullscreen' || displayMode === 'minimal-ui';
}

/**
 * @param {string} ua navigator.userAgent
 * @param {{standalone?: boolean, maxTouchPoints?: number}} [opts]
 * @returns {{
 *   os: 'ios'|'android'|'other',
 *   browser: 'safari'|'chrome'|'firefox'|'edge'|'samsung'|'opera'|'webview'|'other',
 *   inApp: string|null,        // name of the app whose embedded browser this is
 *   standalone: boolean,
 *   install: 'standalone'|'in-app'|'ios-safari'|'ios-other'|'android'|'desktop'
 * }}
 */
export function detectPlatform(ua, { standalone = false, maxTouchPoints = 0 } = {}) {
  const s = String(ua || '');
  // iPadOS 13+ reports a Mac user agent; a touch screen tells it apart from a real Mac.
  const ios = /iPhone|iPad|iPod/.test(s) || (/Macintosh/.test(s) && maxTouchPoints > 1);
  const android = !ios && /Android/i.test(s);
  const os = ios ? 'ios' : android ? 'android' : 'other';

  const app = IN_APP.find(([, re]) => re.test(s));
  let browser = 'other';
  if (ios) {
    browser = /CriOS/.test(s) ? 'chrome' : /FxiOS/.test(s) ? 'firefox' : /EdgiOS/.test(s) ? 'edge'
      : /OPiOS|OPT\//.test(s) ? 'opera'
        // Real Safari has both "Version/x" and "Safari/x"; embedded WKWebViews usually lack them.
        : /Version\/[\d.]+.*Safari\//.test(s) ? 'safari' : 'webview';
  } else if (android) {
    browser = /; wv\)/.test(s) ? 'webview' : /SamsungBrowser/.test(s) ? 'samsung' : /Firefox\//.test(s) ? 'firefox'
      : /EdgA\//.test(s) ? 'edge' : /OPR\//.test(s) ? 'opera' : /Chrome\//.test(s) ? 'chrome' : 'other';
  } else {
    browser = /Edg\//.test(s) ? 'edge' : /Firefox\//.test(s) ? 'firefox' : /OPR\//.test(s) ? 'opera'
      : /Chrome\//.test(s) ? 'chrome' : /Safari\//.test(s) ? 'safari' : 'other';
  }
  // 'another app' is a sentinel for an unnamed embedded browser; the UI words it (core.platform.anotherApp).
  const inApp = app ? app[0] : (browser === 'webview' ? 'another app' : null); // i18n-ignore (sentinel value, see core.platform.anotherApp)

  let install;
  if (standalone) install = 'standalone';
  else if (inApp && os !== 'other') install = 'in-app';
  else if (ios) install = browser === 'safari' ? 'ios-safari' : 'ios-other';
  else if (android) install = 'android';
  else install = 'desktop';
  return { os, browser, inApp, standalone: !!standalone, install };
}
