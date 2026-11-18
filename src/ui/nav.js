// Navigation helpers. The router itself lives in src/app.js and listens to hashchange.

/** 'workout/session/abc' -> '#/workout/session/abc' (use for <a href>). Segments are not encoded. */
export function href(path) {
  return `#/${String(path).replace(/^[#/]+/, '')}`;
}

/**
 * Go to a route. @param {string} path e.g. 'diary/2026-11-18'
 * @param {{replace?: boolean}} [opts] replace: do not add a history entry
 */
export function navigate(path, { replace = false } = {}) {
  const h = href(path);
  if (replace) location.replace(h);
  else location.hash = h;
}

let inAppSteps = 0;
/** Called by the router on every in-app hash change (not on the initial load). @internal */
export function _noteNavigation() { inAppSteps++; }

/** History back if we navigated inside the app before, else go to `fallback` (e.g. after a deep link). */
export function back(fallback = 'diary') {
  if (inAppSteps > 0) history.back();
  else navigate(fallback, { replace: true });
}

/** Current route path without '#/' and query, e.g. 'workout/session/abc'. */
export function currentPath() {
  return location.hash.replace(/^#\/?/, '').split('?')[0];
}
