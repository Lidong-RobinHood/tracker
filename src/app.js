// Boot, hash router and tab bar. Features register routes by exporting `routes` from their index.js.
import { el, closeAllOverlays, icon } from './ui/index.js';
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
import { routes as splitRoutes } from './splits/index.js';

/** Tabs in the bottom bar. A route belongs to the tab named by its `tab` field, else its first path segment. */
const TABS = [
  { id: 'diary', label: 'Diary', icon: 'utensils' },
  { id: 'workout', label: 'Workout', icon: 'barbell' },
  { id: 'trends', label: 'Trends', icon: 'chart-line' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];
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
  for (const t of TABS) {
    const a = el('a', { class: 'tab', href: `#/${t.id}` }, icon(t.icon, { size: 24 }), el('span', t.label));
    tabLinks.set(t.id, a);
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
