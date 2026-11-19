// Service worker: precaches every runtime file at install, then serves same-origin GETs
// network-first with the cache as offline fallback.
// Never touches cross-origin requests (APIs such as Open Food Facts go straight to the network).
// Release: set CACHE_VERSION to the same string as APP_VERSION in src/version.js (npm test checks it)
// and run `node tools/build-precache.mjs` last. See docs/RELEASE.md.
// Changing this file or precache-list.js is what makes browsers install the new worker; old caches
// are deleted on activate.
const CACHE_VERSION = '0.6.0';

// self.PRECACHE = { hash, files: [[path, contentHash, bytes], ...] } (generated, see tools/build-precache.mjs).
importScripts('precache-list.js');
const LIST = self.PRECACHE;
// One cache per release and file set, so an update never mixes files of two releases.
const CACHE = `tracker-${CACHE_VERSION}-${LIST.hash}`;

// Paths are relative to this file, so the app works under any sub-path (e.g. /tracker/).
const SCOPE = new URL('./', self.location).href;
/** absolute URL (no query) → expected content hash */
const EXPECTED = new Map(LIST.files.map(([p, h]) => [new URL(p, SCOPE).href, h]));
const INDEX = new URL('index.html', SCOPE).href;
EXPECTED.set(SCOPE, EXPECTED.get(INDEX)); // './' is index.html

async function hashOf(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Response stored in the cache: the bytes we checked, without the original URL (served for the request URL). */
function stored(buf, res) {
  const headers = new Headers(res.headers);
  headers.delete('vary');
  return new Response(buf, { status: 200, statusText: 'OK', headers });
}

/**
 * Fetch one file of this release and store it, but only if its bytes match the list: while a deploy
 * rolls out the host may still answer with the previous file, and that must not end up in this cache.
 * Returns true when stored. Never throws.
 */
async function precacheOne(cache, url, hash) {
  if (await cache.match(url)) return true; // install retried: already stored with this cache name
  const attempts = [
    () => fetch(url, { cache: 'no-cache' }),
    () => fetch(url, { cache: 'reload' }),
    () => fetch(`${url}?v=${hash}`, { cache: 'reload' }), // past a CDN cache that still has the old file
  ];
  for (const attempt of attempts) {
    try {
      const res = await attempt();
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (await hashOf(buf) !== hash) continue;
      await cache.put(url, stored(buf, res));
      return true;
    } catch { /* next attempt */ }
  }
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const jobs = [[SCOPE, EXPECTED.get(SCOPE)], ...LIST.files.map(([p, h]) => [new URL(p, SCOPE).href, h])];
    // A few at a time so the page that is starting up keeps priority on the connection.
    let next = 0; let failed = 0;
    const lane = async () => {
      while (next < jobs.length) {
        const [url, hash] = jobs[next++];
        if (!await precacheOne(cache, url, hash)) failed++;
      }
    };
    await Promise.all([lane(), lane(), lane(), lane()]);
    // One failing file must not break installation; it is filled in when it is next fetched online.
    if (failed) console.warn(`Precache: ${failed} of ${jobs.length} files could not be stored`);
    await self.skipWaiting();
  })());
});

// The page can ask a waiting worker to take over (Update button). Install already calls skipWaiting,
// so this only matters if a browser kept a worker waiting anyway.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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
  if (!url.href.startsWith(SCOPE)) return;                // outside our scope
  if (req.headers.has('range')) return;                   // media range requests: let the browser handle
  if (req.cache === 'no-store') return;                   // update check: straight to the network, never cached
  event.respondWith(networkFirst(event, req));
});

/** Cache key: listed files by their plain URL (navigations ignore the query). */
function keyOf(req) {
  const u = new URL(req.url);
  u.hash = '';
  if (req.mode === 'navigate') u.search = '';
  return u.href;
}

async function fromCache(cache, req) {
  const key = keyOf(req);
  const hit = await cache.match(key, { ignoreVary: true }) || await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  if (req.mode === 'navigate') return await cache.match(INDEX) || await cache.match(SCOPE) || null;
  return null;
}

/**
 * Keep a response fetched online. Listed files only when the cache lacks them and the bytes are
 * this release's (a newer deploy seen before the worker updated must not mix into this cache).
 */
async function remember(cache, req, res) {
  const key = keyOf(req);
  const expected = EXPECTED.get(key);
  if (expected === undefined) { await cache.put(req, res); return; }
  if (await cache.match(key)) return;
  const buf = await res.arrayBuffer();
  if (await hashOf(buf) === expected) await cache.put(key, stored(buf, res));
}

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  try {
    // 'no-cache' revalidates with the server (ETag), so a stale HTTP cache never hides an update.
    let res = await fetch(req, { cache: 'no-cache' });
    // The host occasionally answers 5xx for a moment (e.g. while a deploy rolls out). One failed
    // module would leave the app blank, so retry once, then prefer a cached copy over the error.
    if (res.status >= 500) {
      await new Promise((r) => setTimeout(r, 900));
      const again = await fetch(req, { cache: 'no-cache' }).catch(() => null);
      if (again && again.status < 500) res = again;
      else {
        const hit = await fromCache(cache, req);
        if (hit) return hit;
      }
    }
    if (res.ok && res.type === 'basic') event.waitUntil(remember(cache, req, res.clone()).catch(() => {}));
    return res;
  } catch (err) {
    const hit = await fromCache(cache, req);
    if (hit) return hit;
    throw err;
  }
}
