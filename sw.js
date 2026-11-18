// Service worker: network-first with cache fallback for same-origin GETs.
// Never touches cross-origin requests (APIs such as Open Food Facts go straight to the network).
// Bump CACHE_VERSION on release (old caches are deleted on activate). Keep APP_VERSION in src/version.js in step.
const CACHE_VERSION = 'v1';
const CACHE = `tracker-${CACHE_VERSION}`;

// Small shell so the app opens offline after the first visit. Everything else is cached as it is fetched.
// Paths are relative to this file, so the app works under any sub-path (e.g. /tracker/).
const SHELL = ['./', 'index.html', 'app.css', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // One failing file must not break installation.
    await Promise.all(SHELL.map((url) => cache.add(new Request(url, { cache: 'no-cache' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('tracker-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;       // cross-origin: not handled, not cached
  if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return; // outside our scope
  if (req.headers.has('range')) return;                   // media range requests: let the browser handle
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    // 'no-cache' revalidates with the server (ETag), so a stale HTTP cache never hides an update.
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.type === 'basic') cache.put(req, res.clone()).catch(() => {});
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('index.html') || await cache.match('./');
      if (shell) return shell;
    }
    throw err;
  }
}
