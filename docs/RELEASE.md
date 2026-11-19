# Releasing a new version

Everyone's data stays on their own phone, so a release only replaces code. Running apps find out
about it themselves; nobody has to reinstall.

## Steps

1. Pick the new version, e.g. `0.4.1`.
2. Set it in **both** places, as the same string:
   - `src/version.js` → `export const APP_VERSION = '0.4.1';`
   - `sw.js` → `const CACHE_VERSION = '0.4.1';`
3. **Last step before committing:** `node tools/build-precache.mjs`. It rewrites `precache-list.js`
   (every file the app can load — html, css, js modules, json data, icons, manifest, the vendored
   barcode ponyfill and wasm — with a content hash each; tests, docs and tools are left out).
   Run it again after any further file change.
4. `npm test` — `tests/app-version.test.js` fails if the two versions differ or `version.js` cannot be
   parsed; `tests/precache.test.js` fails if `precache-list.js` does not match the files on disk.
5. Commit and push to the branch GitHub Pages serves. Pages takes a minute or two to deploy.
6. Check: open the app, Settings › About › Check for update (or wait), tap **Update**, and see the
   new number next to "App version".

If the data schema changes (`DB_VERSION` in `src/db/db.js`), add the migration first; old export
files are upgraded on import via `EXPORT_MIGRATIONS`.

## How running apps update

- `sw.js` is network-first: every same-origin file is fetched from the server with `cache: 'no-cache'`
  (revalidated by ETag), and the cache is only an offline fallback. A normal start therefore always
  loads the newest files.
- Offline: at install the worker stores every file in `precache-list.js` (loaded with `importScripts`)
  in a cache named after the version and the list hash (`tracker-<version>-<hash>`), a few files at a
  time after the page has rendered. A file is stored only if its bytes match the hash in the list
  (retried past the HTTP cache and with `?v=<hash>`), so a deploy that is still rolling out cannot mix
  old files into the new cache; a file that cannot be stored does not fail the install and is stored
  when it is next fetched online. Online fetches never overwrite precached files.
- The problem case is a home-screen app on iOS that is resumed from memory: it does not reload, so it
  keeps running old code. The app therefore checks the deployed `src/version.js` (fetched with
  `cache: 'no-store'`; `sw.js` passes such requests straight to the network) and compares it with the
  version it was loaded with:
  - about 3 s after start,
  - whenever the app comes back to the foreground or goes online (at most every 10 minutes),
  - hourly while it is open,
  - on demand: Settings › About › Check for update, and Help › App version and updates.
- When the versions differ, a small **Update** notice appears at the top (not on the workout session
  screen, so a set being typed is not interrupted; the session autosaves anyway). Tapping it reloads;
  the reload goes through the network-first worker, so every module comes from the new release.
- The worker is registered with `updateViaCache: 'none'`, so the browser checks `sw.js` itself
  without the 10-minute GitHub Pages HTTP cache. A changed `sw.js` installs, activates at once
  (`skipWaiting` + `clients.claim`) and deletes caches of other versions; a page that sees a new worker
  take control runs the version check immediately.
- Any difference counts, so rolling back to an older version also offers **Update**.

Code: `src/onboarding/update.js`, `src/core/app-version.js`, `sw.js`, `tools/build-precache.mjs`.
