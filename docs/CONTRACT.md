# Contract for feature modules

Read with `docs/SPEC.md` (data model). This file is the fixed interface between the shell and
the features. Do not edit shared files (`src/app.js`, `src/ui/*`, `src/db/db.js`, `app.css`,
existing `src/core/*`); if you need a change there, ask. All imports are relative ES modules.

## Ownership

| Worker  | Owns | Route paths |
|---------|------|-------------|
| food    | `src/food/**`, new `src/core/<food-things>.js`, `tests/<same>.test.js` | `diary`, `diary/:date`, `food/...` |
| workout | `src/workout/**`, `src/core/progression.js`, `src/core/volume.js` (+ others), their tests | `workout`, `workout/...` |
| trends  | `src/trends/**` (step 4) | `trends`, `trends/...` |

Feature CSS: put it in `src/<feature>/<feature>.css` and load it from your module with
`document.head.append(el('link', { rel: 'stylesheet', href: new URL('./food.css', import.meta.url).href }))`
once (guard against double insert). Prefer the shared classes below.

## Routes

`src/<feature>/index.js` must export `routes`:

```js
/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'workout', title: 'Workout', mount: mountHome },
  { path: 'workout/session/:id', title: 'Workout', mount: mountSession },
];
```

- `path`: segments separated by `/`, no leading `#/`. `:name` captures one segment (URI-decoded).
  All segments must match; when several routes match, the one with more static segments wins.
- `tab` (optional): tab to highlight; default is the first path segment. Tabs: `diary workout trends settings`.
- `#/` redirects to `#/diary`. Unknown paths show a "not found" page.
- Query strings are allowed: `#/diary/2026-11-18?meal=lunch` → `ctx.query.meal === 'lunch'`.

### mount(container, params, ctx) → void | cleanup | Promise<void | cleanup>

- `container`: a fresh empty `<div class="view">` (flex column, 16 px gap). Render into it.
  Start with `pageHeader({...})`.
- `params`: `{ id: 'abc' }` for `workout/session/:id`.
- `ctx`: `{ path, query }`.
- May be `async`. Return a **cleanup function** to stop cameras (`track.stop()`), timers,
  `document`/`window` listeners. The router calls it before the next view mounts (and on `pagehide`).
  If the user navigated away while an async mount was still running, cleanup runs immediately.
- A thrown error is caught and shown as an error card (and logged).
- On every navigation the router first closes all open sheets/modals (their `onClose` runs).

### Navigation — `src/ui/nav.js` (also re-exported by `src/ui/index.js`)

| Function | |
|---|---|
| `href(path)` | `'workout/x'` → `'#/workout/x'` for `<a href>`; encode param values yourself (`encodeURIComponent`) |
| `navigate(path, { replace })` | go to a route; `replace: true` = no history entry |
| `back(fallback = 'diary')` | history back if the user navigated in-app, else `navigate(fallback, {replace:true})` |
| `currentPath()` | e.g. `'workout/session/abc'` |

## UI helpers — `import { … } from '../ui/index.js'`

| Helper | Signature / behaviour |
|---|---|
| `el(tag, props?, ...children)` | `props`: `class` (string\|array), `style` (string\|object), `dataset`, `onClick`/`on<Event>` (listener), `value checked selected disabled hidden readOnly htmlFor textContent` set as properties, everything else `setAttribute` (`true` → `''`, `false/null/undefined` skipped). Children: strings, numbers, nodes, nested arrays; `null/false` skipped. `props` may be omitted. Never use innerHTML with data. |
| `append(parent, ...children)`, `clear(node)`, `replaceChildren(node, ...children)` | same child rules |
| `openSheet({ title, content, onClose, dismissible = true, className })` | bottom sheet → `{ el, body, footer, close(result), closed: Promise }`. `onClose(result)` runs exactly once however it closes (×, backdrop, Esc, navigation) — stop the camera there. Append content to `body`, buttons to `footer`. |
| `openModal(opts)` | same, centred |
| `confirmDialog({ title, message, confirmLabel, cancelLabel, danger })` | `Promise<boolean>`; `message` string or Node |
| `closeAllOverlays()` | router calls it; rarely needed |
| `toast(message, { type: 'info'\|'success'\|'error', duration, action: { label, onClick } })` | returns `dismiss()`. Use `action` for Undo. |
| `numberInput({ value, placeholder, min, max, decimals = 2, integer, class, ariaLabel, id, name, onInput, onChange })` | `<input type=text inputmode=decimal>` (numeric for `integer`), accepts `,` and `.`, selects all on focus, Enter blurs. Extra methods: `input.getNumber()` → number\|null (null if empty, invalid or outside min/max), `input.setNumber(n\|null)`. Sets `aria-invalid` when invalid. Callbacks get `(number\|null, input)`. With `min < 0` (the iOS decimal keypad has no minus key) a `±` toggle button (`input.signToggle`, `aria-label` "Minus sign", `aria-pressed` = negative, 44 px) is put before the input inside `<span class="num-signed">` once the input has a parent; it flips the sign of the typed text and fires `input` + `change`. Typed `-` and `−` are accepted there. `min ≥ 0`: unchanged, no button. |
| `field(label, control, { hint, unit })` | labelled field; `unit` shows a suffix (`'g'`, `'kcal'`) |
| `pageHeader({ title, subtitle, back, actions })` | sticky header; `back: true` or a fallback path shows a back button; `actions`: nodes on the right |
| `emptyState(text, ...children)` | centred placeholder |
| `fmtNum(n, maxDecimals = 1)` | `'12.5'`, `null` → `'–'` |
| `fmtKcal`, `fmtGrams`, `fmtKg`, `fmtAmount(n, basis)` | `'524 kcal'`, `'12.5 g'`, `'102.5 kg'`, `'250 ml'` |
| `fmtDate('2026-11-18')`, `fmtDay(date)` | `'Wed 18 Nov'`; `'Today'`/`'Yesterday'`/`'Tomorrow'` else fmtDate |
| `fmtTime(ms)`, `fmtDuration(ms)`, `fmtBytes(b)` | `'07:03'`, `'1 h 05 min'`, `'1.2 MB'` |

### CSS classes (app.css)

Layout: `stack` (column, 12 px gap), `row`, `row-between`, `grow`, `grid-2`, `grid-3`.
Text: `muted`, `small`, `num` (tabular figures), `truncate`, `text-danger|success|warning`.
`section` + `section-title`; `card` (+ `card-flush` for edge-to-edge lists, `card-header`, `card-title`).
Lists: `list` > `list-item` (div, `button` or `a`) with `li-main` > `li-title` + `li-sub`, `li-trail`, `li-chevron`.
Buttons: `btn` + `btn-primary | btn-danger | btn-ghost`, `btn-sm`, `btn-block`, `btn-icon`.
Chips: `chips` (+ `chips-scroll`) > `chip` (`is-active` or `aria-pressed="true"`), `chip-success`;
`badge` (+ `badge-warning | badge-danger | badge-dropset`).
Segmented tabs: `tabs` > `button[aria-selected="true"]`.
Forms: `field`, `field-label`, `field-hint`, `field-error`, `input`, `select`, `textarea`, `input-num`,
`input-unit` > `.unit`; wrap a field in `is-missing` to highlight it red.
Tokens: `--bg --surface --surface-2 --text --text-muted --border --accent --accent-text --accent-soft
--danger(-soft) --danger-text --success --warning(-soft) --dropset(-soft) --radius --radius-sm --s1..--s6 --tap`.

## Database — `import * as db from '../db/db.js'`

Stores, keys and indexes exactly as SPEC §3 (`DB_NAME 'tracker'`, `DB_VERSION 1`). You create ids
(`crypto.randomUUID()`) and timestamps (`Date.now()`) yourself; the db layer stores records as given.

| Function | Returns |
|---|---|
| `get(store, key)` | record or `undefined` |
| `getAll(store)` | all records, key order |
| `put(store, record)` | key (insert or replace) |
| `putMany(store, records)` | one transaction |
| `remove(store, key)` | — |
| `count(store)` / `countAll()` | number / `{ store: n }` |
| `byIndex(store, index, value)` | records where index = value, e.g. `byIndex('diary', 'date', '2026-11-18')` |
| `range(store, index\|null, { lower, upper, lowerOpen, upperOpen, direction: 'next'\|'prev', limit })` | records in key/index order; bounds inclusive by default, either may be omitted. e.g. `range('workouts', 'date', { upper: '2026-11-18', direction: 'prev', limit: 10 })` |
| `transaction(stores, 'readonly'\|'readwrite', async t => …)` | fn's result after commit. `t.get/getAll/put/delete/clear/byIndex(store, …)`. **Only await `t.*` inside** — awaiting anything else commits early. Throw to abort (nothing is written). |
| `getSetting(key)` | stored value shallow-merged over `SETTINGS_DEFAULTS[key]` (fresh copy) |
| `setSetting(key, value)` | replaces the whole value: `setSetting('goal', { ...await getSetting('goal'), rateKgPerWeek: -0.5 })` |
| `exportAll()`, `validateImport(data)`, `importAll(data)`, `clearAll()` | used by Settings |
| `storageStatus()`, `requestPersist()` | used by Settings; persistence is also requested automatically on first write |

`SETTINGS_DEFAULTS`: `targets {kcal:2000, protein:120, carbs:220, fat:70, source:'manual'}`,
`volume {primary:1, secondary:0.5, dropset:0}`, `goal {rateKgPerWeek:0}`,
`profile {heightCm:null, birthYear:null, sex:null}`, `meta {schemaVersion, seededAt, seedVersion}`.

Exercises are seeded from `src/data/exercises.js` (`SEED_EXERCISES`, ids `seed:<slug>`) at boot,
only while `meta.seedVersion < SEED_VERSION`, adding missing ids and never overwriting.

## Pure core — `src/core/` (no DOM; tests in `tests/*.test.js`, run `npm test`)

- `dates.js`: `today()`, `toDateStr(date)`, `fromTimestamp(ms)`, `isValidDate(s)`, `parseDate(s)` (local midnight),
  `addDays(s, n)`, `weekday(s)` (0 = Mon), `weekStart(s)` (Mon), `weekEnd(s)` (Sun), `daysBetween(a, b)`, `dateRange(a, b)`.
- `muscles.js`: `MUSCLES [{id, name}]`, `MUSCLE_IDS`, `isMuscleId(id)`, `muscleName(id)`.
- `nutrition.js`: `NUTRIENTS`, `REQUIRED_NUTRIENTS`, `OPTIONAL_NUTRIENTS`, `scale(per100, amount)`,
  `sumEntries([{per100, amount}])` (required → numbers, optional → null if unknown everywhere),
  `missingFields(food)` → e.g. `['name','protein']`, `isComplete(food)`, `kjToKcal(kj)`, `macroKcal({protein,carbs,fat})`, `emptyPer100()`.
- `barcode.js`: `checkDigitOk(code)`, `upcEtoA(e)`, `normaliseScan(raw, format)` → `{code, note} | null`.
- `numbers.js`: `parseDecimal(text)` (`,` or `.`) → number|null, `round(n, decimals)`.

## Other facts

- Barcode decoding: the vendored ZXing fallback is at `vendor/barcode-detector/ponyfill.js` (classic
  script, sets `window.BarcodeDetectionAPI`) + `zxing_reader.wasm`; see `spike/app.js` for how to load it
  lazily and point `locateFile` at the wasm with a relative URL. Prefer native `BarcodeDetector`.
- Service worker (`sw.js`) is network-first and ignores cross-origin requests, so API calls are never cached.
- Everything must work under a sub-path (`/tracker/`): never use URLs starting with `/`.
