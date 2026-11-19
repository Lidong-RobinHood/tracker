// Small reusable building blocks that match the classes in app.css (see docs/CONTRACT.md › Components).
import { el } from './dom.js';
import { back as goBack } from './nav.js';
import { icon } from './icons.js';
import { infoButton } from './info.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);

/**
 * 44 px icon-only button (ghost by default). The label is required: it is the accessible name.
 * @param {string} name icon name @param {{label: string, onClick?: (e: Event) => any, class?: string|string[],
 *   variant?: 'ghost'|'primary'|'secondary'|'danger', size?: number, disabled?: boolean, type?: string}} opts
 * @returns {HTMLButtonElement}
 */
export function iconButton(name, { label, onClick, class: cls, variant = 'ghost', size, disabled, type = 'button' }) {
  return /** @type {HTMLButtonElement} */ (el('button', {
    type, class: ['btn', 'btn-icon', `btn-${variant}`, ...(Array.isArray(cls) ? cls : [cls])],
    'aria-label': label, onClick, disabled,
  }, icon(name, { size })));
}

/**
 * Sticky page header: optional back button, title (22 px), muted subtitle, info button, actions.
 * @param {{title: string, subtitle?: string, back?: string|boolean, actions?: Node[], info?: string}} opts
 *   back: true -> history back (fallback 'diary'); a path string -> back with that fallback.
 *   info: info-sheet id; puts an ⓘ button right after the title.
 */
export function pageHeader({ title, subtitle, back, actions = [], info }) {
  const backBtn = back
    ? iconButton('chevron-left', { label: 'Back', class: 'page-back', onClick: () => goBack(typeof back === 'string' ? back : 'diary') })
    : null;
  return el('header', { class: ['page-header', back ? 'has-back' : null] },
    backBtn,
    el('div', { class: 'page-title-wrap' },
      el('div', { class: 'page-title-line' },
        el('h1', { class: 'page-title' }, title),
        info ? infoButton(info) : null),
      subtitle ? el('div', { class: 'page-subtitle' }, subtitle) : null),
    actions.length ? el('div', { class: 'page-actions' }, actions) : null);
}

/**
 * Section heading (small caps label) with optional info button and trailing node (e.g. a date range).
 * Use above a card or list: sectionHeader('Records · this week', { info: 'records' }).
 * @param {string} title @param {{info?: string, trail?: Node|string, id?: string}} [opts]
 */
export function sectionHeader(title, { info, trail, id } = {}) {
  return el('div', { class: 'section-header' },
    el('h2', { class: 'section-title', id }, title),
    info ? infoButton(info) : null,
    el('span', { class: 'grow' }),
    trail != null ? el('span', { class: 'section-trail' }, trail) : null);
}

/**
 * Card header: 17 px title, optional status tag ('Estimate'), info button and trailing controls.
 * @param {string} title @param {{info?: string, tag?: string, trail?: Node|Node[]}} [opts]
 */
export function cardHeader(title, { info, tag: tagText, trail } = {}) {
  return el('div', { class: 'card-header' },
    el('h3', { class: 'card-title' }, title),
    tagText ? tag(tagText) : null,
    info ? infoButton(info) : null,
    el('span', { class: 'grow' }),
    trail || null);
}

/**
 * Labelled form field. @param {string} label @param {HTMLElement} control input/select/textarea
 * @param {{hint?: string, unit?: string, info?: string}} [opts] unit renders a suffix like 'kcal' or 'g'
 *   inside the field; hint: at most one short muted line; info: info-sheet id next to the label.
 */
export function field(label, control, { hint, unit, info } = {}) {
  if (!control.id) control.id = `f-${Math.random().toString(36).slice(2)}`;
  return el('div', { class: 'field' },
    el('div', { class: 'field-label-row' },
      el('label', { class: 'field-label', htmlFor: control.id }, label),
      info ? infoButton(info) : null),
    unit ? el('div', { class: 'input-unit' }, control, el('span', { class: 'unit', 'aria-hidden': 'true' }, unit)) : control,
    hint ? el('div', { class: 'field-hint' }, hint) : null);
}

/** Empty state: one short line plus at most one action (a button or link). */
export function emptyState(text, ...children) {
  return el('div', { class: 'empty' }, el('p', text), children);
}

/**
 * Small static label chip (not a button): 'Estimate', 'Check portions', '± 120 kcal'.
 * @param {string} text @param {{tone?: 'neutral'|'accent'|'ok'|'warn'|'bad', icon?: string}} [opts]
 */
export function tag(text, { tone = 'neutral', icon: iconName } = {}) {
  return el('span', { class: ['tag', tone !== 'neutral' ? `tag-${tone}` : null] }, iconName ? icon(iconName, { size: 14 }) : null, text);
}

/**
 * One-letter set-type badge for the SET column: 'W' warm-up, 'D' dropset, 'F' failure …
 * @param {string} letter @param {{title?: string, tone?: 'accent'|'warn'|'bad'}} [opts] title = full name
 */
export function setBadge(letter, { title, tone = 'accent' } = {}) {
  return el('span', { class: ['set-badge', tone !== 'accent' ? `set-badge-${tone}` : null], title, 'aria-label': title }, letter);
}

/**
 * Stat tile: caption label, big number, small unit. Put several in <div class="tiles">.
 * @param {{label: string, value: string|number, unit?: string, sub?: string}} opts
 */
export function statTile({ label, value, unit, sub }) {
  return el('div', { class: 'tile' },
    el('span', { class: 'tile-label' }, label),
    el('span', { class: 'tile-value' }, String(value), unit ? el('small', { class: 'tile-unit' }, unit) : null),
    sub ? el('span', { class: 'tile-sub' }, sub) : null);
}

/**
 * Horizontal progress bar (6 px track). tone: 'accent' (default) | 'ok' | 'warn' | 'bad' | 'protein' |
 * 'carbs' | 'fat' (macro colours only for nutrition). update({ value, max, tone }) changes it.
 * @param {{value: number, max: number, tone?: string, label?: string}} opts label = accessible name
 * @returns {HTMLElement & {update: (o: {value?: number, max?: number, tone?: string}) => void}}
 */
export function progressBar({ value, max, tone = 'accent', label }) {
  const fill = el('i', { class: 'progress-fill' });
  const bar = /** @type {any} */ (el('div', { class: 'progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0' }, fill));
  let state = { value, max, tone };
  bar.update = (o = {}) => {
    state = { ...state, ...o };
    const f = clamp01(state.value / state.max);
    fill.style.width = `${(f * 100).toFixed(2)}%`;
    bar.className = `progress tone-${state.tone}`;
    bar.setAttribute('aria-valuemax', String(state.max));
    bar.setAttribute('aria-valuenow', String(Math.max(0, Math.min(state.max, state.value || 0))));
  };
  bar.update();
  return bar;
}

/**
 * Progress ring with a number in the middle (the diary's calorie ring). One ring per screen at most.
 * @param {{value: number, max: number, label?: string|number, sub?: string, size?: number, stroke?: number,
 *          tone?: 'accent'|'ok'|'warn'|'bad', onClick?: (e: Event) => any, ariaLabel?: string}} opts
 *   label: the big figure (34 px when size ≥ 120, else 17 px); sub: one short muted line under it.
 *   onClick makes the ring a button (e.g. toggle 'left' / 'eaten'); give it an ariaLabel then.
 * @returns {HTMLElement & {update: (o: {value?: number, max?: number, label?: string|number, sub?: string, tone?: string}) => void}}
 */
export function ring({ value, max, label = '', sub = '', size = 148, stroke = 10, tone = 'accent', onClick, ariaLabel }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const circle = (cls) => {
    const k = document.createElementNS(SVG_NS, 'circle');
    k.setAttribute('class', cls);
    k.setAttribute('cx', String(size / 2)); k.setAttribute('cy', String(size / 2)); k.setAttribute('r', String(r));
    k.setAttribute('stroke-width', String(stroke));
    svg.appendChild(k);
    return k;
  };
  circle('ring-track');
  const fill = circle('ring-fill');
  fill.setAttribute('stroke-dasharray', c.toFixed(2));
  fill.setAttribute('stroke-dashoffset', c.toFixed(2)); // empty first; filled on the next frame (animates once)
  const big = el('span', { class: size >= 120 ? 'ring-value t-hero' : 'ring-value t-head' });
  const small = el('span', { class: 'ring-sub' });
  const root = /** @type {any} */ (el(onClick ? 'button' : 'div', {
    class: ['ring', `ring-${tone}`], type: onClick ? 'button' : null, onClick, 'aria-label': ariaLabel,
    style: { width: `${size}px`, height: `${size}px` },
  }, svg, el('span', { class: 'ring-center' }, big, small)));
  let state = { value, max, label, sub, tone };
  let ready = false;
  const paint = () => fill.setAttribute('stroke-dashoffset', (c * (1 - clamp01(state.value / state.max))).toFixed(2));
  root.update = (o = {}) => {
    state = { ...state, ...o };
    big.textContent = String(state.label ?? '');
    small.textContent = String(state.sub ?? '');
    small.hidden = !state.sub;
    root.classList.remove('ring-accent', 'ring-ok', 'ring-warn', 'ring-bad');
    root.classList.add(`ring-${state.tone}`);
    if (ready) paint();
  };
  root.update();
  requestAnimationFrame(() => requestAnimationFrame(() => { ready = true; paint(); }));
  return root;
}

/**
 * Segmented control (one choice of 2–5). Buttons carry aria-pressed; arrow keys move between them.
 * @param {{options: {value: string, label?: string, icon?: string, ariaLabel?: string}[], value: string,
 *          onChange?: (value: string) => void, ariaLabel: string, small?: boolean}} opts
 *   small: inline, content-width (e.g. '1W 1M 3M 1Y' in a card header). An option with only `icon`
 *   needs `ariaLabel`.
 * @returns {HTMLElement & {setValue: (v: string) => void, value: string}}
 */
export function segmented({ options, value, onChange, ariaLabel, small = false }) {
  const root = /** @type {any} */ (el('div', { class: ['seg', small ? 'seg-small' : null], role: 'group', 'aria-label': ariaLabel }));
  const buttons = options.map((o) => el('button', {
    type: 'button', 'aria-pressed': String(o.value === value), 'aria-label': o.ariaLabel, dataset: { value: o.value },
    onClick: () => { if (root.value !== o.value) { root.setValue(o.value); if (onChange) onChange(o.value); } },
  }, o.icon ? icon(o.icon, { size: 18 }) : null, o.label || null));
  for (const b of buttons) root.appendChild(b);
  root.value = value;
  root.setValue = (v) => { root.value = v; for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.value === v)); };
  root.addEventListener('keydown', (e) => arrowMove(e, buttons));
  return root;
}

/**
 * Icon tabs (icon over a short label, underline on the selected one), e.g. Add food: Search / Scan / …
 * role=tablist; the caller shows the matching panel in onChange.
 * @param {{tabs: {value: string, label: string, icon: string}[], value: string, onChange?: (value: string) => void,
 *          ariaLabel: string}} opts
 * @returns {HTMLElement & {setValue: (v: string) => void, value: string}}
 */
export function iconTabs({ tabs, value, onChange, ariaLabel }) {
  const root = /** @type {any} */ (el('div', { class: 'icon-tabs', role: 'tablist', 'aria-label': ariaLabel }));
  root.style.setProperty('--n', String(tabs.length));
  const buttons = tabs.map((t) => el('button', {
    type: 'button', role: 'tab', dataset: { value: t.value },
    onClick: () => { if (root.value !== t.value) { root.setValue(t.value); if (onChange) onChange(t.value); } },
  }, icon(t.icon, { size: 24 }), el('span', null, t.label)));
  for (const b of buttons) root.appendChild(b);
  root.setValue = (v) => {
    root.value = v;
    for (const b of buttons) {
      const on = b.dataset.value === v;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  };
  root.setValue(value);
  root.addEventListener('keydown', (e) => arrowMove(e, buttons, true));
  return root;
}

function arrowMove(e, buttons, activate = false) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const i = buttons.indexOf(/** @type {any} */ (document.activeElement));
  if (i < 0) return;
  const next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
  e.preventDefault();
  next.focus();
  if (activate) next.click();
}
