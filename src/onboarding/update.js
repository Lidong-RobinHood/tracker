// Update detection. A home-screen app on iOS is resumed from memory and does not reload by itself,
// so it can keep running old code for days. The deciding signal: the deployed src/version.js
// (fetched with cache: 'no-store', which sw.js passes straight to the network) differs from the
// APP_VERSION this page was loaded with. A new service worker (sw.js changes with every release)
// only triggers an immediate check: a page that was itself loaded fresh must not be told to update.
// Checks run shortly after start, whenever the app comes back to the foreground (at most every
// 10 minutes) and hourly while visible. "Update" reloads; sw.js is network-first and revalidates every
// file, so the reload loads the new version of every module.
import { APP_VERSION } from '../version.js';
import { parseAppVersion, updateAvailable, checkDue } from '../core/app-version.js';

const VERSION_URL = new URL('../version.js', import.meta.url).href;

/** @type {{status: 'unknown'|'checking'|'current'|'available'|'offline', deployed: string|null, checkedAt: number|null}} */
const state = { status: 'unknown', deployed: null, checkedAt: null };
const listeners = new Set();
let registration = null;

const emit = () => { for (const fn of listeners) { try { fn({ ...state }); } catch (err) { console.error(err); } } };

/** Subscribe to state changes; returns unsubscribe. The callback is called at once with the current state. */
export function onUpdateState(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export const runningVersion = () => APP_VERSION;

/**
 * Ask the server for the deployed version (and the browser for a new service worker).
 * @returns {Promise<typeof state>}
 */
export async function checkForUpdate() {
  state.status = state.status === 'available' ? 'available' : 'checking';
  emit();
  if (registration) registration.update().catch(() => {});
  let deployed = null;
  let offline = false;
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (res.ok) deployed = parseAppVersion(await res.text());
  } catch {
    offline = true;
  }
  state.checkedAt = Date.now();
  if (deployed) state.deployed = deployed;
  if (updateAvailable(deployed, APP_VERSION)) state.status = 'available';
  else if (state.status === 'available' && !deployed) state.status = 'available'; // offline after finding one
  else state.status = offline ? 'offline' : deployed ? 'current' : 'unknown';
  emit();
  return { ...state };
}

/** Reload into the new version. A waiting worker is told to take over first. */
export async function applyUpdate() {
  const reg = registration;
  if (reg && reg.waiting && navigator.serviceWorker) {
    const changed = new Promise((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    await changed;
  }
  location.reload();
}

/**
 * Start background checks. Call once at boot.
 * @param {Promise<ServiceWorkerRegistration|undefined>|null} regPromise
 */
export function startUpdateChecks(regPromise) {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : null;
  // Another worker took control (a release was installed in the background): compare versions now.
  if (sw) sw.addEventListener('controllerchange', () => checkForUpdate());
  if (regPromise) {
    regPromise.then((reg) => {
      if (!reg) return;
      registration = reg;
      if (reg.waiting) checkForUpdate();
    }).catch(() => {});
  }
  const maybeCheck = () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (checkDue(state.checkedAt, Date.now())) checkForUpdate();
  };
  setTimeout(maybeCheck, 3000);
  document.addEventListener('visibilitychange', maybeCheck);
  window.addEventListener('online', maybeCheck);
  window.addEventListener('pageshow', (e) => { if (e.persisted) maybeCheck(); });
  setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) checkForUpdate(); }, 60 * 60 * 1000);
}
