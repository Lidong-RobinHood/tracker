// Boot, hash router and tab bar. Features register routes by exporting `routes` from their index.js.
import { el, closeAllOverlays } from './ui/index.js';
import { _dropStaleOverlayEntry } from './ui/overlay.js';
import { _noteNavigation } from './ui/nav.js';
import { openDb, seedExercises } from './db/db.js';
import { SEED_EXERCISES, SEED_VERSION } from './data/exercises.js';
import { routes as foodRoutes } from './food/index.js';
import { routes as workoutRoutes } from './workout/index.js';
import { routes as trendsRoutes } from './trends/index.js';
import { routes as settingsRoutes } from './settings/index.js';
import { routes as importRoutes } from './import/index.js';
import { routes as onboardingRoutes, startAppServices } from './onboarding/index.js';

/** Tabs in the bottom bar. A route belongs to the tab named by its `tab` field, else its first path segment. */
const TABS = [
  { id: 'diary', label: 'Diary', icon: 'M4 5h16M4 10h16M4 15h10M4 20h7' },
  { id: 'workout', label: 'Workout', icon: 'M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12' },
  { id: 'trends', label: 'Trends', icon: 'M3 20h18M5 16l4-5 4 3 6-8' },
  { id: 'settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1c.5.4 1.1.7 1.7 1l.4 2.5h4l.4-2.5c.6-.3 1.2-.6 1.7-1l2.4 1 2-3.4z' },
];
const DEFAULT_PATH = 'diary';

const ROUTES = [...foodRoutes, ...workoutRoutes, ...trendsRoutes, ...settingsRoutes, ...importRoutes, ...onboardingRoutes].map(compile);

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
  for (const t of TABS) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', t.icon);
    icon.append(p);
    const a = el('a', { class: 'tab', href: `#/${t.id}` }, icon, el('span', t.label));
    tabLinks.set(t.id, a);
    tabbar.append(a);
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
    document.title = 'Not found · Tracker';
    container.append(el('div', { class: 'empty' },
      el('p', `No page at "#/${path}".`), el('a', { class: 'btn', href: `#/${DEFAULT_PATH}` }, 'Go to diary')));
    return;
  }
  const { route, params } = found;
  setActiveTab(route.tab || route.segs[0]);
  document.title = route.title ? `${route.title} · Tracker` : 'Tracker';

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
        el('h2', 'Something went wrong'), el('p', { class: 'muted' }, String(err && err.message || err))));
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

async function boot() {
  buildTabbar();
  _dropStaleOverlayEntry(); // reloaded while a sheet was open: step back to the page's own entry
  window.addEventListener('hashchange', render);
  try {
    await openDb();
    const added = await seedExercises(SEED_EXERCISES, SEED_VERSION);
    if (added) console.info(`Seeded ${added} exercises`);
  } catch (err) {
    console.error('Database setup failed', err);
    main.replaceChildren(el('div', { class: 'card error-card' },
      el('h2', 'Storage unavailable'),
      el('p', 'This browser blocked local storage (private mode?). Data cannot be saved.')));
    return;
  }
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
