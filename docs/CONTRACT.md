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
- `titleKey` (preferred over `title`): catalogue key of the document title, e.g. `'settings.title'`. All user-facing
  text goes through `t(key, params)` from `src/i18n/index.js`; never call `t()` at module top level. See `docs/I18N.md`.
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
- While an overlay is open, everything behind it (page, tab bar, lower overlays; not toasts) is `inert`: not focusable or tappable.
- Each dismissible sheet/modal adds a history entry (same URL): the phone's Back button closes only the
  top overlay. Closing it with its own controls removes the entry; `navigate()`/`back()` called right
  after a close wait for that step. For ~350 ms after an overlay closes, taps are swallowed, and a
  `btn-primary` ignores clicks while the promise returned by its `onClick` is pending.

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
| `loadDraft(name)`, `saveDraft(name, value)`, `clearDraft(name)` (`src/ui/draft.js`) | unfinished input kept in localStorage across reloads (not in backups), expires after 24 h. Never keys or images. |
| `numberInput({ value, placeholder, min, max, decimals = 2, integer, class, ariaLabel, id, name, onInput, onChange })` | `<input type=text inputmode=decimal>` (numeric for `integer`), accepts `,` and `.`, selects all on focus, Enter blurs. Extra methods: `input.getNumber()` → number\|null (null if empty, invalid or outside min/max), `input.setNumber(n\|null)`. Sets `aria-invalid` when invalid. Callbacks get `(number\|null, input)`. With `min < 0` (the iOS decimal keypad has no minus key) a `±` toggle button (`input.signToggle`, `aria-label` "Minus sign", `aria-pressed` = negative, 44 px) is put before the input inside `<span class="num-signed">` once the input has a parent; it flips the sign of the typed text and fires `input` + `change`. Typed `-` and `−` are accepted there. `min ≥ 0`: unchanged, no button. |
| `field(label, control, { hint, unit, info })` | labelled field; `unit` shows a suffix inside the field (`'g'`, `'kcal'`); `hint` = at most one short muted line; `info` = info-sheet id next to the label |
| `pageHeader({ title, subtitle, back, actions, info })` | sticky header (title 22 px, subtitle 13 px muted); `back: true` or a fallback path shows a chevron back button; `actions`: nodes on the right (use `iconButton`); `info`: ⓘ after the title |
| `emptyState(text, ...children)` | empty state: one short line + at most one action |
| `sectionHeader(title, { info, trail, id })` | caps label above a card/list, optional ⓘ and a trailing muted note (e.g. a date range) |
| `cardHeader(title, { info, tag, trail })` | 17 px card title, optional status `tag` ('Estimate'), ⓘ, trailing controls (they wrap to a second line on narrow screens) |
| `iconButton(name, { label, onClick, variant = 'ghost', size, class, disabled })` | 44 × 44 icon-only button; `label` is required (accessible name); `variant`: `ghost` (ink-2 glyph), `primary`, `secondary`, `danger` |
| `icon(name, { size = 20, label, class })` (`src/ui/icons.js`) | inline `<svg class="ic">` in `currentColor`, aria-hidden unless `label`. Pass a **literal** name (`icon('trash-2')`, or `icon: 'name'` in option objects) so `tests/icons.test.js` can check it. Also `hasIcon(name)`, `ICON_NAMES` |
| `infoButton(sheetId, { values, label })`, `openInfo(sheetId, { values })` (`src/ui/info.js`) | 44 px ⓘ ghost button / open the sheet directly. Texts in `src/ui/info-sheets.js` (see Info sheets). `values` fills user-specific numbers, e.g. `infoButton('sets', { values: settings.volume })` |
| `tag(text, { tone, icon })` | static 24 px label chip; `tone`: `neutral` (default) `accent` `ok` `warn` `bad` |
| `setBadge(letter, { title, tone })` | one-letter set-type badge for the SET column (`W` warm-up `tone: 'warn'`, `D` dropset, `F` failure `tone: 'bad'`); `title` = full name (also the accessible name) |
| `statTile({ label, value, unit, sub })` | caps label + 22 px number + 13 px unit; put 2–3 in `<div class="tiles">` |
| `progressBar({ value, max, tone, label })` → `.update({ value, max, tone })` | 6 px bar; `tone`: `accent` (default) `ok` `warn` `bad`, macro tones `protein` `carbs` `fat` (nutrition only) |
| `ring({ value, max, label, sub, size = 148, stroke = 10, tone, onClick, ariaLabel })` → `.update({…})` | progress ring with the hero number inside (34 px when `size` ≥ 120) and one muted line; `onClick` makes it a button (e.g. left ↔ eaten). Animates once; at most one per screen |
| `segmented({ options: [{ value, label, icon, ariaLabel }], value, onChange, ariaLabel, small })` → `.setValue(v)` | segmented control (`.seg`, `aria-pressed`), 44 px; `small` = inline, content width (range picker in a card header); icons 18 px; ← → keys move |
| `iconTabs({ tabs: [{ value, label, icon }], value, onChange, ariaLabel })` → `.setValue(v)` | icon-over-label tabs with underline (`role=tablist`, `aria-selected`, roving tabindex), e.g. Add food: Search / Scan / Recent / Meals / Quick add. The caller shows the panel |
| `bodyMap({ view, values, title, class })`, `setBodyMapValues(svg, values)`, `BODY_MAP_MUSCLES` (in `src/ui/bodymap.js`: `bodyMap`, `setValues`, `MUSCLES`) | body-map SVG, `view`: `'front'` `'back'` `'both'`; 100 × 220 px (88 × 194 px below 400 px viewport). `values[muscleId]`: `0–4` (sets ramp), `'recovering'` `'ready'` `'fresh'` (status colours), `'hot'` (accent). Ids = `src/core/muscles.js`. `MUSCLES` = `{ front: [...], back: [...] }`: the ids each view draws |
| `muscleIcon(muscleId, { size = 36, state, label })` | square crop of one muscle, highlighted in accent (no `state`), red `'recovering'`, amber `'ready'`, or `'neutral'` (recovered: only subtly emphasised in `--map-idle`, as on the map; `'fresh'` = green, legacy, not used for recovery); decorative unless `label` |
| `fmtNum(n, maxDecimals = 1)` | `'12.5'`, `null` → `'–'` |
| `fmtKcal`, `fmtGrams`, `fmtKg`, `fmtAmount(n, basis)` | `'524 kcal'`, `'12.5 g'`, `'102.5 kg'`, `'250 ml'` |
| `fmtDate('2026-11-18')`, `fmtDay(date)` | `'Wed 18 Nov'`; `'Today'`/`'Yesterday'`/`'Tomorrow'` else fmtDate — in the app language (de `'Mi. 18. Nov.'`, zh `'11月18日周三'`); more date helpers in `src/i18n/dates.js` |
| `fmtTime(ms)`, `fmtDuration(ms)`, `fmtBytes(b)` | `'07:03'`, `'1 h 05 min'`, `'1.2 MB'` |
| `fmtGrouped(n, maxDecimals = 0)`, `fmtSigned(n, maxDecimals = 0)` | display numbers: `'1 310'` (narrow no-break space U+202F), `'−0.5'` (true minus U+2212); `fmtSigned` adds `+` (`'+50'`, `'−50'`, `'0'`). For numbers a user reads, not for input values |
| `fmtTonnage(kg, { kg })` (`src/ui/format.js`) | the one tonnage rule: whole kg, grouped, below 10 000 kg (`'2 340 kg'`), tonnes with two decimals from 10 000 kg (`'12.48 t'`; rounded kg decide, so 9 999.6 → `'10.00 t'`); `{ kg: true }` = always kg, for single-set and per-exercise tonnage (`'12 480 kg'`); `null` → `'–'`. Every tonnage on screen goes through it |

## Design system (2026-11 redesign) — `app.css`

Reference: the approved demo (system font, tabular figures, one indigo accent, 4 px spacing, radii
8/12/16/28, no shadows in dark mode). Light and dark follow `prefers-color-scheme`
(`<html data-theme="light|dark">` forces one; the app does not set it). Shared code lives in `app.css` and
`src/ui/*`; feature workers do not edit those files — ask if something shared is missing.

### Tokens

| Group | Tokens |
|---|---|
| Surfaces | `--bg` page · `--surface` cards, tab bar · `--surface-2` secondary surface inside a card · `--sheet` sheets/modals · `--fill` input wells, segmented track, neutral chips, pressed rows · `--seg-on` selected segment |
| Lines | `--line` separators · `--line-2` stronger (sheet handle, dashed outlines) · `--line-ctl` control outlines: inputs, wells, unticked boxes (≥ 3:1 on every surface) |
| Text | `--ink` primary · `--ink-2` secondary (≥ 4.5:1 on `--bg`, `--surface`, `--fill`) · `--ink-3` tertiary: chevrons, placeholders, greyed "previous" values only, never sentences |
| Accent (the only one) | `--accent` actions, selection, progress, today, record glyphs · `--accent-soft` secondary buttons, selected chips · `--accent-ink` accent text on `--accent-soft` · `--accent-2` second step (partial sets) · `--on-accent` text on `--accent` |
| Status (state only, always with a label) | `--ok` `--warn` `--bad` fills/dots · `--ok-soft` `--warn-soft` `--bad-soft` tints · `--ok-text` `--warn-text` `--bad-text` as text on surfaces · `--on-status` text on a status fill |
| Nutrition only (with P/C/F label) | `--prot` `--carb` `--fat` |
| Sets ramp / body map | `--heat-1` … `--heat-4` · `--map-body` `--map-idle` · `--map-icon-body` `--map-icon-idle` |
| Effects | `--scrim` · `--card-shadow` (none in dark) · `--toast-shadow` · `--focus` |
| Type | `--font` · sizes/line heights `--fs-hero`/`--lh-hero` 34/40 · `--fs-title`/`--lh-title` 22/28 · `--fs-head`/`--lh-head` 17/22 · `--fs-body`/`--lh-body` 16/22 · `--fs-sub`/`--lh-sub` 13/18 · `--fs-cap`/`--lh-cap` 11/13 · weights `--fw-regular` 400, `--fw-semibold` 600, `--fw-bold` 700 |
| Space | `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32 · `--gutter` 16 · `--gap-card` 12 · `--tap` 44 |
| Radii | `--r-sm` 8 chips, inputs, badges · `--r-md` 12 buttons, tiles, segmented · `--r-lg` 16 cards · `--r-xl` 28 sheets (top) and modals · `--r-full` |
| Motion | `--ease` cubic-bezier(.2, 0, 0, 1) · `--d-fast` 150 ms presses · `--d-med` 250 ms bars, chips · `--d-slow` 350 ms sheets. All motion is off under `prefers-reduced-motion` |
| Shell | `--safe-top/-bottom/-left/-right` · `--tabbar-h` 56 px |

**Deprecated aliases** (still defined so unmigrated CSS keeps working; replace them when you restyle a screen):

| Old | New |
|---|---|
| `--text` | `--ink` |
| `--text-muted` | `--ink-2` |
| `--border` | `--line` |
| `--accent-text` | `--on-accent` |
| `--danger` | `--bad-text` (text, borders) — use `--bad` for fills |
| `--danger-text` | `--on-status` |
| `--danger-soft` | `--bad-soft` |
| `--success` | `--ok-text` (text) — `--ok` for fills |
| `--warning` | `--warn-text` (text) — `--warn` for fills |
| `--warning-soft` | `--warn-soft` |
| `--dropset` | `--accent-ink` (dropsets use the accent) |
| `--dropset-soft` | `--accent-soft` |
| `--shadow` | `--card-shadow` |
| `--radius` | `--r-md` (cards are now `--r-lg`) |
| `--radius-sm` | `--r-sm` |
| `--fs-sm` | `--fs-sub` |
| `--fs` | `--fs-body` |
| `--fs-lg` (was 18) | `--fs-head` (17) |
| `--fs-xl` | `--fs-title` |

Unchanged names that are part of the new system: `--bg --surface --surface-2 --accent --accent-soft --font
--s1..--s6 --tap --safe-* --tabbar-h`.

### Shared classes

- **Type:** `t-hero` `t-title` `t-head` `t-body` `t-sub` `t-cap` (caps, 600, +0.04em); `muted` (ink-2), `faint` (ink-3),
  `strong` (600), `small` (13/18, old name kept), `num`/`tnum` (tabular; the body already uses tabular figures),
  `truncate`, `text-danger|success|warning|accent`, `vh` (visually hidden).
- **Layout:** `view` (16 px gap), `stack` (12), `row`, `row-between`, `grow`, `grid-2`, `grid-3`.
- **Page header:** `page-header` (+ `has-back`) > `page-back`, `page-title-wrap` > `page-title-line` > `page-title` (+ ⓘ), `page-subtitle`; `page-actions`.
- **Sections and cards:** `section` > `section-header` (`section-title` caps + ⓘ + `section-trail`); `card` (16 px radius, 16 px padding,
  shadow in light only), `card-flush` (lists edge to edge), `card-header` > `card-title` (17/600); `error-card`.
- **Rows:** `list` > `list-item` (div/button/a, 52 px min) > `li-lead` (accent icon) · `li-main` > `li-title` (16/400) + `li-sub` (13 ink-2) · `li-trail` · `li-chevron` (use `icon('chevron-right', { class: 'li-chevron' })`).
- **Buttons:** `btn` (= secondary: accent-soft + accent-ink, 44 px, 12 px radius, 16/600) · `btn-primary` · `btn-secondary` · `btn-ghost` (text, accent) ·
  `btn-danger` · `btn-sm` (36 px visible inside a 44 px box: 4 px transparent top/bottom borders, fill clipped to the padding box — the whole 44 px is the hit area) · `btn-block` · `btn-icon` (44 × 44, ink-2 glyph, transparent unless primary/secondary/danger) · `btn-info` (the ⓘ, negative margins so it does not grow a title row).
- **Chips and labels:** `chips` (+ `chips-scroll`) > `chip` (interactive, 36 px + 44 px hit area, 8 px radius; selected `aria-pressed="true"` or `is-active`), `chip-success`;
  `tag` (+ `tag-accent|ok|warn|bad`, static 24 px); `badge` (+ `badge-warning|danger|dropset`, 20 px); `set-badge` (+ `set-badge-warn|bad`, 24 × 24 letter);
  `dot` / `swatch` with `is-recovering|is-ready|is-fresh`, `swatch.is-1..is-4|is-accent|is-partial|is-protein|is-carbs|is-fat`; `legend` (column) / `legend legend-row`.
- **Segmented and tabs:** `seg` (new) = `tabs` (old name, same look) > `button` selected by `aria-pressed|aria-selected|aria-checked="true"` or `is-active`; `seg-small` (inline);
  `icon-tabs` (grid of icon + label, underline on `aria-selected="true"`, `--n` columns).
- **Forms:** `field` > `field-label-row` > `field-label` (13/600 ink-2) · control · `field-hint` / `field-error`; `input`, `select`, `textarea` (fill well, 8 px radius,
  accent border on focus, 16 px text), `input-num` (right aligned), `input-unit` > `.unit`, `well` (compact `<label class="well"><input><span>kg</span></label>`),
  `search-field` (leading icon + input), `is-missing` / `aria-invalid="true"` (red), `switch`, `num-signed` + `num-sign` (numberInput's ± toggle),
  `check-box` (custom unticked box, e.g. the set done toggle: `--line-ctl` outline like the fields).
- **Figures:** `tiles` > `tile` > `tile-label` · `tile-value` (+ `tile-unit`) · `tile-sub` (tiles inside a card use `--surface-2`); `progress` > `progress-fill` (`tone-*`);
  `ring` (`ring-track`, `ring-fill`, `ring-center`, `ring-value`, `ring-sub`, `ring-ok|warn|bad`).
- **Body map:** `bm` (+ `bm-both`, `bm-icon`, `bm-icon-recovering|ready|fresh`), paths `bm-body` / `bm-muscle` with `is-0..is-4`, `is-hot`, `is-recovering|ready|fresh`.
- **Overlays:** `backdrop` > `sheet` (28 px top radius, grab handle) / `modal` (28 px radius) > `sheet-handle`, `overlay-header` > `overlay-title` + `overlay-close`, `overlay-body`, `overlay-footer`; `info-sheet` > `info-text`.
- **Other:** `empty` (one line + one action), `toast` (+ `toast-error`, `toast-action`, 44 px), `tabbar` > `tab` (icon 24 + 11 px label, `aria-current="page"`), `ic` (+ `ic-sm` 16, `ic-lg` 24).

### Icons — `src/ui/icons.js`

Lucide (ISC; Feather-derived ones MIT) and Tabler Icons (MIT, `barbell` only), each file fetched individually and inlined
unmodified; the header comment of `icons.js` lists every icon and its licence. Licence texts: `vendor/icons/`. Names:
activity, arrow-down, arrow-left, arrow-right, arrow-up, barbell, book-open, bookmark, calendar, camera, chart-line, check,
chevron-down, chevron-left, chevron-right, chevron-up, circle, circle-check, circle-play, circle-question-mark, clock,
cloud-off, copy, download, droplet, ellipsis, ellipsis-vertical, external-link, eye, eye-off, file-chart-column, file-text,
flame, funnel, grip-vertical, heart-pulse, image, info, key-round, link, list, lock, log-in, minus, pause, pencil, play, plus,
refresh-cw, repeat, rotate-ccw, rotate-ccw-clock, ruler, save, scale, scan-barcode, search, settings, share, shield,
skip-forward, sliders-horizontal, smartphone, star, target, timer, trash, trending-down, trending-up,
triangle-exclamation-point, trophy, undo-2, upload, user, utensils, x. Aliases (older names): `trash-2` → trash,
`history` → rotate-ccw-clock, `alert-triangle`/`triangle-alert` → triangle-exclamation-point, `help-circle`/`circle-help` →
circle-question-mark, `check-circle` → circle-check, `filter` → funnel, `more-horizontal` → ellipsis, `more-vertical` →
ellipsis-vertical, `dumbbell` → barbell. A missing icon is added to `icons.js` by the shell owner (fetch the upstream file,
copy its elements unchanged, update the header list) — never draw or modify one.

Suggested meanings: add `plus` · delete `trash-2` · undo `undo-2` · edit `pencil` · more `ellipsis` · back `chevron-left` · row `chevron-right` ·
expand `chevron-down` · info `info` · close `x` · done `check` · date `calendar` · time/rest `timer` · tutorial `circle-play` · record `trophy` ·
recent/history `history` · saved meals `bookmark` · scan `scan-barcode` · photo `camera` · export `download` · import `upload` ·
offline `cloud-off` · update `refresh-cw` · warning `alert-triangle` · dropset `droplet` · settings group `sliders-horizontal` · profile `user` ·
help `help-circle` · storage `shield` · reorder `grip-vertical` · filter `filter` · link out `external-link` · weight `scale` · target `target`.

### Info sheets — `src/ui/info-sheets.js`

All explanation text lives here, keyed by id (the 23 sheets of the copy audit): `recovery`, `recovery-math`, `sets`, `tonnage`,
`records`, `metrics`, `top-exercises`, `progression`, `starting`, `photo`, `camera`, `expenditure`, `checkin`, `complete`, `trend`,
`report`, `macros`, `adaptive-macros`, `goal`, `backup`, `storage`, `import-weights`, `import-workouts`; added since:
`sets-workout` (sets per muscle of one workout, finish summary; takes the `sets` values), `split-choose`, `split-run`
(running a split: order, progression, swaps, easy week), `split-sets`. Each is a title plus
1–3 short paragraphs (≤ ~60 words); numbers come from the core constants (`RECOVERY_CONFIG`, `DEFAULT_VOLUME`,
`ADAPTIVE_DEFAULTS`, `GOAL_RATE_MIN/MAX`, `KCAL_PER_KG`, `BACKUP_DUE_DAYS`). `sets` and `recovery` accept current user values
(`{ primary, secondary, dropset }`, `{ faster, slower }`). Help topics should render these same texts (`infoSheet(id)` returns
`{ title, paragraphs }`). `tests/info-sheets.test.js` fails if an id used in `src/` (`infoButton('…')`, `openInfo('…')`,
`info: '…'`) does not exist. New or changed wording: ask the shell owner.

### Body map — `src/ui/bodymap.js`

Original artwork (`docs/AUTHORSHIP.md`); shapes in `src/ui/bodymap-art.js`, generated by `tools/bodymap/gen.py` (never edit
the generated file). Recovery: `values = { quads: 'recovering', back: 'ready', chest: 'fresh' }` with a legend
(`legend` + `swatch is-recovering|is-ready|is-fresh`, labels Recovering / Likely ready / Recovered). Weekly sets:
`values = { chest: 0..4 }` (4 = at target, 3 = over 2/3, 2 = over 1/3, 1 = started, 0/missing = none) with a `swatch is-1..is-4` legend.
Recovered muscles are never green: neutral on the map and legend (no value / plain `swatch`), and wherever else recovery
state is shown (home chips, recovery detail list) `muscleIcon(id, { state: 'neutral' })`, a `--map-idle` dot and a neutral bar;
red / amber only for recovering / likely ready, always with the status label.
Shared map pieces of the workout and split screens: `src/workout/muscle-map.js` (loads `workout.css`, so splits use
it too). Exercise muscles: `musclesBlock({ primary, secondary, small })` → `{ node, update(p, s) }` (map with direct in
`--accent`, partial in `--accent-2`, legend Direct · Partial with the names), `openMusclesSheet(ex)`, `rowMuscleIcon(id, size)`
(cached `muscleIcon` clone for list rows), `musclesText(ex)`, `muscleChip(m, pressed, onClick)`. Sets per muscle on the
four-step ramp (`.wk-ramp`, `--wk-ramp-1..4`): `setsGlyph(steps)` (40 × 44 decorative), `setsMap()`,
`setsMapRow(map, bands, label, { caption })`, `setsRow(name, c, { step, extra, target })`, `setsList(rows)`. One logged workout: `workoutGlyph(workout, exMap, weights)`,
`withGlyph(tile, glyph)` (glyph in a stat tile), `selectableMap(map, describe)` → `{ line, select, refresh }` (tappable
muscles, one fixed-height line with the figures).
Bands: `src/core/set-bands.js` `bandStep(total, edges)` / `bandLegend(weights, edges)` with `WEEK_BAND_EDGES` 12 / 8 / 4
(splits) and `SESSION_BAND_EDGES` 6 / 4 / 2 (one routine session: `src/core/routine-sets.js` `routineSets`, `sessionStep`,
`sessionBands`, `mapSteps`, `workoutSets` (= `workoutVolume` per muscle, with direct / partial / drop),
`tonnageStep(t, max)` / `tonnageBands(max, fmt)`: quarters of the workout's largest muscle tonnage).
Muscle chips: `muscleIcon(id, { state })` next to the muscle name and a `dot is-<state>`. At 320 px two maps (2 × 88 px) leave
≈ 80 px: put the legend under the maps there (e.g. a `legend legend-row`).

### How to restyle a screen (feature workers)

1. Work only in your folder (`src/<feature>/**` and its CSS). Do not edit `app.css` or `src/ui/*`; ask for missing shared parts.
2. Tokens only: no literal colours (`#…`, `rgb(…)`, named colours) in CSS or inline styles; no deprecated aliases in code you touch.
   Status colours only for state and always with a label or icon; macro colours only for nutrition with the P/C/F label; one accent.
3. Type scale only (`t-hero` 34 · `t-title` 22 · `t-head` 17 · `t-body` 16 · `t-sub` 13 · `t-cap` 11; weights 400/600/700).
   At most three sizes plus the hero per screen.
4. Spacing from `--s1..--s6`; cards 16 px padding, 12 px between cards, 24 px between blocks; radii from `--r-*` only.
5. Structure: `pageHeader` → `sectionHeader` / `cardHeader` → cards with rows, tiles, bars. One number per card with one line under it.
6. Text: at most **one** short muted helper line under a control; everything else goes behind `infoButton('<id>')`
   (never a sentence introducing the ⓘ). Terms from the copy-audit glossary: sets, direct / partial, tonnage, target (kcal, macros,
   weekly sets), goal (body-weight rate), expenditure, starting point, check-in, done, complete day, est. 1RM, weight step,
   calorie floor, Quick add, Export backup / Import backup. Sentence case, no exclamation marks.
7. Numbers: tabular figures (default), thousands with a narrow no-break space and a true minus (`fmtGrouped`, `fmtSigned`):
   `1 310 kcal`, `−0.5 kg / week · −550 kcal / day`, `+50 kcal`, `3 × 6` (multiplication sign), `48–72 h` (en dash).
   Units with a space: `kg / week`, `kcal / day`, `kcal / 100 g`, `102.5 kg`, `52 %`.
8. Icons via `icon('name')` / `iconButton('name', { label })` with literal names — no text glyphs (‹ › × ⋯ ✎ ±) as icons, no emojis.
9. Tap targets ≥ 44 px (`btn-sm` and `chip` already extend their hit area); visible focus is global (`:focus-visible`) — do not remove outlines.
10. Check light and dark at 375 and 320 px: no horizontal scroll, text contrast ≥ 4.5:1 (`--ink-3` is not for text), no console errors.
11. Keep the DOM helpers' null-safe `append` / `replaceChildren` (no native `.append(` / `.replaceChildren(` in `src/workout/**`,
    `tests/workout-dom-guard.test.js`).
12. Run `node tools/build-precache.mjs` and `npm test` when done.

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
  script, sets `window.BarcodeDetectionAPI`) + `zxing_reader.wasm`; see `src/food/scanner.js` for how to load it
  lazily and point `locateFile` at the wasm with a relative URL. Prefer native `BarcodeDetector`.
- Service worker (`sw.js`) is network-first and ignores cross-origin requests, so API calls are never cached.
  It precaches every file listed in `precache-list.js` at install; after adding, removing or changing any
  runtime file run `node tools/build-precache.mjs` (`npm test` fails otherwise).
- Everything must work under a sub-path (`/tracker/`): never use URLs starting with `/`.
- `dateBox(input, { placeholder })` (`src/food/widgets.js`): a native `<input type=date>` shown as the app's date
  ('Thu 19 Nov'), the transparent native input on top keeps focus, keyboard and the system picker. Used by Food, Trends
  (weight) and Import (workouts); it loads `food.css` (its styles live there), so importing it from another feature pulls that file in.
- Body-weight display (`src/core/weight-format.js`): weights 1 decimal (`shownKg`); a change between two weights is the
  difference of the two *displayed* weights (`shownKgChange`, `shownKgChangePct`, `shownKgDiff`), so `83.1 → 83.4 · +0.3 kg`
  always adds up; rates in kg / week 2 decimals (`shownRate`), never derived from rounded weights.
- Exercise alternatives (split library swap list, `alternatives()` in `src/core/splits.js`): movement-pattern data in
  `src/data/exercises.js` — `EXERCISE_PATTERN` (seed id → pattern, not stored in the db) and `RELATED_PATTERNS` (second choices).
  Same pattern first, then related patterns; custom exercises (no pattern) fall back to the same-primary-muscle rule.
- Languages (`docs/I18N.md`, glossary `docs/I18N-GLOSSARY.md`): every user-facing text is a catalogue key in
  `src/i18n/<lang>/<namespace>.js` (en, de, zh; all three complete, enforced by `tests/i18n.test.js`, which also
  runs `tools/i18n-scan.mjs` over all of `src/`). Show built-in names through the helpers (`src/i18n/names.js`,
  `src/food/names.js`, `src/workout/data.js`: `exerciseName`, `mealName`, `foodName`, `fmtSets`, `workoutTitle` …),
  never the stored English name; store ids and English seed names, never translated text. Dates via `fmtDate` /
  `src/i18n/dates.js`; numbers keep `.` as the decimal mark in every language. `<html lang>` follows the language.
- Body-map artwork: `docs/AUTHORSHIP.md`; third-party notices: `THIRD-PARTY-NOTICES.md` (keep the Licences screen in step).
