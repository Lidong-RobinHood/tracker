// Boot, hash router and tab bar. Features register routes by exporting `routes` from their index.js.
import { el, closeAllOverlays, icon } from './ui/index.js';
import { _dropStaleOverlayEntry } from './ui/overlay.js';
import { _noteNavigation } from './ui/nav.js';
import { openDb, seedExercises, getSetting, setSetting } from './db/db.js';
import { SEED_EXERCISES, SEED_VERSION } from './data/exercises.js';
import { routes as foodRoutes } from './food/index.js';
import { routes as workoutRoutes } from './workout/index.js';
import { routes as trendsRoutes } from './trends/index.js';
import { routes as settingsRoutes } from './settings/index.js';
import { routes as importRoutes } from './import/index.js';
import { routes as onboardingRoutes, startAppServices } from './onboarding/index.js';
import { routes as splitRoutes } from './splits/index.js';
import { initI18n, t, readStoredChoice, setLanguage, isChoice, SETTING_KEY } from './i18n/index.js';

/**
 * Tabs in the bottom bar. A route belongs to the tab named by its `tab` field, else its first path segment.
 * Labels are catalogue keys: t() runs when the bar is built, after the language is loaded.
 */
const TABS = [
  { id: 'diary', label: 'app.tab.diary', icon: 'utensils' },
  { id: 'workout', label: 'app.tab.workout', icon: 'barbell' },
  { id: 'trends', label: 'app.tab.trends', icon: 'chart-line' },
  { id: 'settings', label: 'app.tab.settings', icon: 'settings' },
];
const APP_NAME = 'Tracker'; // i18n-ignore (product name, never translated)
const DEFAULT_PATH = 'diary';

const ROUTES = [...foodRoutes, ...workoutRoutes, ...trendsRoutes, ...settingsRoutes, ...importRoutes, ...onboardingRoutes, ...splitRoutes].map(compile);

/** Turn 'workout/session/:id' into a matcher. */
function compile(route) {
  const segs = route.path.split('/').filter(Boolean);
  return { ...route, segs, statics: segs.filter((s) => !s.startsWith(':')).length };
}

/** Find the best route for a path: all segments must match; more static segments win. */
function match(path) {
  const parts = path.split('/').filter(Boolean);
  let best = null;
  for (const r of ROUTES) {
    if (r.segs.length !== parts.length) continue;
    const params = {};
    const ok = r.segs.every((s, i) => {
      if (s.startsWith(':')) {
        try { params[s.slice(1)] = decodeURIComponent(parts[i]); } catch { params[s.slice(1)] = parts[i]; }
        return true;
      }
      return s === parts[i];
    });
    if (ok && (!best || r.statics > best.route.statics)) best = { route: r, params };
  }
  return best;
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { path: path.replace(/\/+$/, ''), query: Object.fromEntries(new URLSearchParams(qs)) };
}

// ---------------------------------------------------------------- shell

const main = document.getElementById('main');
const tabbar = document.getElementById('tabbar');
const tabLinks = new Map();

function buildTabbar() {
  tabbar.setAttribute('aria-label', t('app.tabbar.label'));
  for (const tab of TABS) {
    const a = el('a', { class: 'tab', href: `#/${tab.id}` }, icon(tab.icon, { size: 24 }), el('span', t(tab.label)));
    tabLinks.set(tab.id, a);
    tabbar.appendChild(a);
  }
}

function setActiveTab(id) {
  for (const [tid, a] of tabLinks) {
    if (tid === id) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------- router

let cleanup = null;
let navToken = 0;
let firstRender = true;

async function render() {
  const token = ++navToken;
  const { path, query } = parseHash();
  if (!path) { location.replace(`#/${DEFAULT_PATH}`); return; }
  if (!firstRender) _noteNavigation();
  firstRender = false;

  closeAllOverlays({ navigation: true });
  runCleanup();

  const found = match(path);
  const container = el('div', { class: 'view' });
  main.replaceChildren(container);
  window.scrollTo(0, 0);

  if (!found) {
    setActiveTab(path.split('/')[0]);
    document.title = `${t('app.notFound.title')} · ${APP_NAME}`;
    container.append(el('div', { class: 'empty' },
      el('p', t('app.notFound.text', { path })), el('a', { class: 'btn', href: `#/${DEFAULT_PATH}` }, t('app.notFound.action'))));
    return;
  }
  const { route, params } = found;
  setActiveTab(route.tab || route.segs[0]);
  const title = route.titleKey ? t(route.titleKey) : route.title;
  document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;

  try {
    const result = await route.mount(container, params, { path, query });
    const fn = typeof result === 'function' ? result : null;
    // The user navigated away while an async mount was running: clean up right away.
    if (token !== navToken) { if (fn) safeCall(fn); return; }
    cleanup = fn;
  } catch (err) {
    console.error(`Route "${route.path}" failed to mount`, err);
    if (token === navToken) {
      container.replaceChildren(el('div', { class: 'card error-card' },
        el('h2', t('app.error.title')), el('p', { class: 'muted' }, String(err && err.message || err))));
    }
  }
}

function runCleanup() {
  const fn = cleanup;
  cleanup = null;
  if (fn) safeCall(fn);
}

function safeCall(fn) {
  try { fn(); } catch (err) { console.error('View cleanup failed', err); }
}

// Stop cameras etc. when the page is hidden for good (tab closed, app swiped away).
window.addEventListener('pagehide', (e) => { if (!e.persisted) runCleanup(); });

// ---------------------------------------------------------------- boot

/**
 * The language choice lives in localStorage (read synchronously, so the catalogue loads in parallel
 * with the database) and in settings key 'language' (so backups carry it). After a backup import the
 * settings value differs: it wins and is copied back to localStorage. A device choice that is not in
 * the settings yet (old backup imported, storage cleared) is written there.
 */
async function syncLanguageSetting() {
  const local = readStoredChoice();
  const stored = await getSetting(SETTING_KEY);
  if (isChoice(stored) && stored !== local) await setLanguage(stored);
  else if (!isChoice(stored) && local !== 'auto') await setSetting(SETTING_KEY, local);
}

async function boot() {
  const language = initI18n(); // catalogues load while the database opens; awaited before anything renders
  _dropStaleOverlayEntry(); // reloaded while a sheet was open: step back to the page's own entry
  try {
    await openDb();
    const added = await seedExercises(SEED_EXERCISES, SEED_VERSION);
    if (added) console.info(`Seeded ${added} exercises`);
  } catch (err) {
    console.error('Database setup failed', err);
    await language;
    buildTabbar();
    main.replaceChildren(el('div', { class: 'card error-card' },
      el('h2', t('app.storage.title')),
      el('p', t('app.storage.text'))));
    return;
  }
  await language;
  await syncLanguageSetting().catch((err) => console.error('Language setting sync failed', err));
  buildTabbar();
  window.addEventListener('hashchange', render);
  await render();

  let reg = null;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // updateViaCache 'none': the browser always fetches sw.js itself from the server when checking for updates.
    reg = navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .catch((err) => { console.warn('Service worker registration failed', err); });
  }
  startAppServices(reg); // update check, backup reminder, optional setup card and empty-tab hints
}

boot();
