// Muscle recovery: body-map card for the workout home, and the detail screen.
// Route: workout/recovery. Model and caveats: src/core/recovery.js (general rule of thumb, not a
// measurement); the explanation lives in the 'recovery' and 'recovery-math' info sheets.
import * as db from '../db/db.js';
import {
  el, replaceChildren, append, pageHeader, href, fmtTime, fmtNum, toast, openSheet, numberInput, field,
  tag, sectionHeader, segmented, infoButton, icon, bodyMap, muscleIcon, setBodyMapValues,
} from '../ui/index.js';
import {
  muscleRecovery, sortByRecovery, recoveryWords, STATUS_LABEL, RECOVERY_CONFIG, RECOVERY_KEY,
  recoverySettings, paceFactor, lookbackFrom, validateRange, withBase, baseRange, fmtSpanRange,
} from '../core/recovery.js';
import { MUSCLES } from '../core/muscles.js';
import { ensureCss, loadExercises, confirmAction } from './data.js';

const H = 3600000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Core status -> body-map / muscle-icon / bar state. Recovered muscles are neutral everywhere (map,
 * legend, chips, detail list): red / amber only while recovering / likely ready; the label says which. */
const MAP_STATE = { recovering: 'recovering', 'likely-ready': 'ready', fresh: 'neutral' };
/** "Recently trained" on the home card: muscles trained within this many days. */
const HOME_DAYS = 7;

/** Workouts that can matter for recovery at `now` (index query on date, not the whole history). */
export async function loadRecentWorkouts(now) {
  return db.range('workouts', 'date', { lower: lookbackFrom(now) });
}

/** Options for muscleRecovery from the stored setting: pace factor and the user's own base ranges. */
export function recoveryOpts(setting) {
  return { factor: paceFactor(setting), base: recoverySettings(setting).base || null };
}

/** @returns {Promise<{pace: string, base?: Record<string, [number, number]>}>} */
export async function loadRecoverySetting() {
  return recoverySettings(await db.getSetting(RECOVERY_KEY));
}

/** 'Thu 14:00' */
function absTime(ms) {
  return `${DAYS[new Date(ms).getDay()]} ${fmtTime(ms)}`;
}

const sets = (n) => `${fmtNum(n, 2)} set${n === 1 ? '' : 's'}`;

/** 'Mon, 6.5 sets' */
function lastLine(r) {
  return `${DAYS[new Date(r.lastAt).getDay()]}, ${sets(r.lastDose)}`;
}

function relative(ms, now) {
  const h = (ms - now) / H;
  if (h <= 0) return 'now';
  if (h < 1) return 'in under 1 h';
  return h < 48 ? `in about ${Math.round(h)} h` : `in about ${fmtNum(Math.round((h / 24) * 2) / 2, 1)} days`;
}

function ariaText(r, now) {
  if (!r.trained) return `${r.name}: no training in the last ${RECOVERY_CONFIG.lookbackDays} days.`;
  // recoveryWords repeats the status for likely ready / recovered: say it once
  const words = recoveryWords(r).replace(/^likely ready — /, '').replace(/^recovered$/, '');
  return `${r.name}: ${STATUS_LABEL[r.status]}${words ? `, ${words}` : ''}. Last trained ${lastLine(r)}. `
    + `Estimated window ${r.minHours} to ${r.maxHours} hours; ${r.progress} percent through it.`
    + (r.status === 'fresh' ? '' : ` Ready from ${absTime(r.readyAt)} (${relative(r.readyAt, now)}), fully recovered by ${absTime(r.fullAt)} (${relative(r.fullAt, now)}).`);
}

/** Absolute times of one muscle: 'ready from Thu 14:00 · fully by Fri 02:00'. */
function absText(r) {
  if (!r.trained) return `not trained in ${RECOVERY_CONFIG.lookbackDays} days`;
  return r.status === 'fresh'
    ? `recovered since ${absTime(r.fullAt)}`
    : `ready from ${absTime(r.readyAt)} · fully by ${absTime(r.fullAt)}`;
}

/** Short time on a chip: '12–36 h' while recovering, 'Likely ready' inside the window. */
function chipTime(r) {
  if (r.status === 'recovering') return fmtSpanRange(r.minHours - r.hoursSince, r.maxHours - r.hoursSince);
  return STATUS_LABEL[r.status];
}

/** Status dot: red / amber; recovered = the neutral body-map colour (as on the map). */
function dot(status) {
  return el('span', { class: ['dot', MAP_STATE[status] === 'neutral' ? 'wk-dot-idle' : `is-${MAP_STATE[status]}`] });
}

function statusLine(r) {
  return el('span', { class: 'wk-rc-st' }, dot(r.status), STATUS_LABEL[r.status]);
}

/**
 * Home card: body map (front + back) coloured only for recovering (red) and likely ready (amber)
 * muscles, a legend, chips for those muscles (least recovered first), recovered muscles in one muted
 * line. Tapping a chip or a muscle on the map shows its absolute times. `workouts` may be the full
 * list already loaded by the home view; only the last 14 days are used.
 */
export function recoverySection(workouts, exMap, weights, setting, now = Date.now()) {
  const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { now, ...recoveryOpts(setting) }));
  const byId = new Map(rows.map((r) => [r.muscle, r]));
  const active = rows.filter((r) => r.trained && r.status !== 'fresh');
  const recovered = rows.filter((r) => !active.includes(r));
  const anyRecent = rows.some((r) => r.trained && now - r.lastAt < HOME_DAYS * 24 * H);
  const values = Object.fromEntries(active.map((r) => [r.muscle, MAP_STATE[r.status]]));

  const map = bodyMap({ view: 'both', values, title: `Muscle recovery map: ${active.length ? active.map((r) => `${r.name} ${STATUS_LABEL[r.status].toLowerCase()}`).join(', ') : 'all muscles recovered'}` });
  map.classList.add('wk-rc-map');
  const detail = el('p', { class: 't-sub wk-rc-detail-line', 'aria-live': 'polite', hidden: true });
  const chips = [];
  let selected = null;
  const select = (muscle) => {
    selected = selected === muscle ? null : muscle;
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.muscle === selected));
    for (const p of map.querySelectorAll('.bm-muscle')) p.classList.toggle('is-sel', p.getAttribute('data-muscle') === selected);
    const r = selected ? byId.get(selected) : null;
    detail.hidden = !r;
    replaceChildren(detail, r ? [el('span', { class: 'strong' }, r.name), ` · ${absText(r)}`] : null);
  };
  map.addEventListener('click', (e) => {
    const p = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('[data-muscle]');
    if (p) select(p.getAttribute('data-muscle'));
  });

  for (const r of active) {
    chips.push(el('button', {
      type: 'button', class: 'wk-mchip', 'aria-pressed': 'false', dataset: { muscle: r.muscle },
      'aria-label': ariaText(r, now), onClick: () => select(r.muscle),
    },
    muscleIcon(r.muscle, { state: MAP_STATE[r.status] }),
    el('span', { class: 'wk-mchip-main' },
      el('span', { class: 'wk-mchip-name' }, r.name),
      el('span', { class: 'wk-mchip-st' }, dot(r.status), chipTime(r)))));
  }

  // Section title above the card (home uses caps titles only: three type sizes plus the page title).
  return el('section', { class: 'section', 'data-recovery': '' },
    sectionHeader('Muscle recovery', { info: 'recovery', trail: tag('Estimate') }),
    el('div', { class: 'card wk-rc-card' },
    el('div', { class: 'wk-map-row' },
      map,
      el('ul', { class: 'legend wk-map-legend' },
        el('li', el('span', { class: 'swatch is-recovering' }), 'Recovering'),
        el('li', el('span', { class: 'swatch is-ready' }), 'Likely ready'),
        el('li', el('span', { class: 'swatch' }), 'Recovered'))),
    chips.length ? el('div', { class: 'wk-mchips' }, chips) : null,
    !anyRecent && !active.length
      ? el('p', { class: 't-sub muted wk-rc-rested' }, 'All muscles recovered.')
      : recovered.length ? el('p', { class: 't-sub wk-rc-rested' },
        dot('fresh'),
        el('span', el('span', { class: 'strong' }, 'Recovered'), ' ', el('span', { class: 'muted' }, recovered.map((r) => r.name).join(' · ')))) : null,
    detail));
}

const PACES = [
  ['faster', 'Faster', 'I recover faster'],
  ['average', 'Average', 'Average'],
  ['slower', 'Slower', 'I recover slower'],
];

export async function mountRecovery(container) {
  ensureCss();
  const now = Date.now();
  const [workouts, exMap, weights, setting] = await Promise.all([
    loadRecentWorkouts(now), loadExercises(), db.getSetting('volume'), loadRecoverySetting(),
  ]);
  append(container, pageHeader({ title: 'Muscle recovery', subtitle: 'Rule-of-thumb estimate', back: 'workout', info: 'recovery' }));

  const map = bodyMap({ view: 'both', title: 'Muscle recovery map' });
  map.classList.add('wk-rc-map');
  const listHost = el('div', { class: 'list' });
  const rangesHost = el('div', { class: 'list' });
  const resetAllBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: () => resetAll() }, 'Reset all to default');
  const paint = () => {
    const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { now, ...recoveryOpts(setting) }));
    setBodyMapValues(map, Object.fromEntries(rows.filter((r) => r.trained && r.status !== 'fresh').map((r) => [r.muscle, MAP_STATE[r.status]])));
    replaceChildren(listHost, rows.map((r) => detailRow(r, now)));
    replaceChildren(rangesHost, MUSCLES.map((m) => rangeRow(m)));
    resetAllBtn.hidden = !setting.base;
  };
  let chain = Promise.resolve();
  const persist = () => {
    const value = { ...setting };
    chain = chain.then(() => db.setSetting(RECOVERY_KEY, value)).catch((err) => {
      console.error(err); toast(`Could not save: ${err && err.message}`, { type: 'error' });
    });
    return chain;
  };
  const setRange = (muscle, range) => {
    const v = withBase(setting, muscle, range);
    delete setting.base;
    Object.assign(setting, v);
    paint();
    return persist();
  };

  function rangeRow(m) {
    const { range, custom } = baseRange(m.id, setting.base);
    return el('button', {
      type: 'button', class: 'list-item', onClick: () => editRange(m),
      'aria-label': `${m.name}: ${range[0]} to ${range[1]} hours${custom ? ', your own range' : ', default'}. Edit`,
    },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, m.name)),
    custom ? el('span', { class: 'tag tag-accent' }, 'Yours') : null,
    el('span', { class: 'li-trail' }, `${range[0]}–${range[1]} h`),
    icon('chevron-right', { class: 'li-chevron' }));
  }

  function editRange(m) {
    const { range, custom } = baseRange(m.id, setting.base);
    const def = RECOVERY_CONFIG.base[m.id];
    const lo = numberInput({ value: range[0], min: 0, max: 999, integer: true, ariaLabel: `${m.name} shortest hours` });
    const hi = numberInput({ value: range[1], min: 0, max: 999, integer: true, ariaLabel: `${m.name} longest hours` });
    const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const sh = openSheet({
      title: `${m.name} recovery`,
      content: [
        el('div', { class: 'grid-2' }, field('Shortest', lo, { unit: 'h' }), field('Longest', hi, { unit: 'h' })),
        el('div', { class: 'wk-hint-row' },
          el('p', { class: 'field-hint' }, `For ${RECOVERY_CONFIG.referenceDose} hard sets. Default ${def[0]}–${def[1]} h.`),
          infoButton('recovery-math')),
        err,
      ],
    });
    append(sh.footer,
      custom ? el('button', {
        type: 'button', class: 'btn', onClick: async () => { sh.close(); await setRange(m.id, null); toast(`${m.name}: default ${def[0]}–${def[1]} h`); },
      }, 'Reset to default') : el('button', { type: 'button', class: 'btn', onClick: () => sh.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const v = validateRange(lo.getNumber(), hi.getNumber());
          if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
          sh.close();
          if (v.value[0] === def[0] && v.value[1] === def[1]) await setRange(m.id, null);
          else await setRange(m.id, v.value);
          toast(`${m.name}: ${v.value[0]}–${v.value[1]} h saved`, { type: 'success' });
        },
      }, 'Save'));
  }

  async function resetAll() {
    if (!setting.base) return;
    const ok = await confirmAction({ title: 'Reset all ranges?', message: 'All muscles return to default. Pace stays.', confirmLabel: 'Reset' });
    if (!ok) return;
    delete setting.base;
    paint();
    await persist();
    toast('All ranges reset to default');
  }

  const pace = segmented({
    ariaLabel: 'How fast you recover',
    value: setting.pace,
    options: PACES.map(([id, label, aria]) => ({ value: id, label, ariaLabel: `${aria} (× ${RECOVERY_CONFIG.paces[id]})` })),
    onChange: async (id) => {
      setting.pace = id;
      paint();
      await persist();
    },
  });
  pace.classList.add('wk-rc-pace');

  paint();
  append(container,
    el('section', { class: 'card wk-rc-card' },
      el('div', { class: 'wk-map-row' },
        map,
        el('ul', { class: 'legend wk-map-legend' },
          el('li', el('span', { class: 'swatch is-recovering' }), 'Recovering'),
          el('li', el('span', { class: 'swatch is-ready' }), 'Likely ready'),
          el('li', el('span', { class: 'swatch' }), 'Recovered')))),
    el('section', { class: 'section' }, sectionHeader('Your pace'), pace),
    el('section', { class: 'section' }, sectionHeader('All muscles'), el('div', { class: 'card card-flush' }, listHost)),
    el('section', { class: 'section' },
      sectionHeader('Recovery range per muscle', { info: 'recovery-math' }),
      el('p', { class: 'field-hint wk-pad-x' }, `Hours for ${RECOVERY_CONFIG.referenceDose} hard sets. Tap to edit.`),
      el('div', { class: 'card card-flush' }, rangesHost), resetAllBtn),
    assumptions());
}

/** One muscle on the detail screen: status, bar, window; tapping toggles relative words and absolute times. */
function detailRow(r, now) {
  const state = r.trained ? MAP_STATE[r.status] : null;
  if (!r.trained) {
    return el('div', { class: 'list-item wk-rc-item' },
      muscleIcon(r.muscle, { state: 'neutral' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, r.name),
        el('div', { class: 'li-sub' }, `Not trained in ${RECOVERY_CONFIG.lookbackDays} days`)));
  }
  const rel = recoveryWords(r);
  const abs = absText(r);
  const words = el('span', { class: 'wk-rc-words' }, rel);
  const band = (r.minHours / r.maxHours) * 100;
  const carried = r.dose - r.lastDose;
  const row = el('button', {
    type: 'button', class: 'list-item wk-rc-item', 'aria-pressed': 'false', 'aria-label': ariaText(r, now),
    onClick: () => {
      const on = row.getAttribute('aria-pressed') !== 'true';
      row.setAttribute('aria-pressed', String(on));
      words.textContent = on ? abs : rel;
    },
  },
  muscleIcon(r.muscle, { state }),
  el('div', { class: 'li-main' },
    el('div', { class: 'wk-rc-head' }, el('span', { class: 'li-title' }, r.name), statusLine(r)),
    el('span', { class: 'wk-rc-bar', 'aria-hidden': 'true' },
      el('span', { class: 'wk-rc-band', style: { left: `${band}%` } }),
      el('span', { class: ['wk-rc-fill', `is-${state}`], style: { width: `${r.progress}%` } }),
      el('span', { class: 'wk-rc-min', style: { left: `${band}%` } })),
    el('div', { class: 'li-sub wk-rc-sub' }, words),
    el('div', { class: 'li-sub' },
      `${r.minHours}–${r.maxHours} h · ${sets(r.dose)}${carried > 0.004 ? ` (${fmtNum(carried, 2)} carried over)` : ''} · last ${lastLine(r)}`)));
  return el('div', { class: 'wk-rc-group' },
    row,
    r.sessions.length ? el('ul', { class: 'wk-rc-sessions' }, r.sessions.map((s) => el('li', null,
      el('a', {
        class: 'wk-rc-slink',
        href: href(s.finished ? `workout/history/${encodeURIComponent(s.workoutId)}` : `workout/session/${encodeURIComponent(s.workoutId)}`),
      },
      el('span', { class: 'wk-rc-sname' }, `${s.name}${s.finished ? '' : ' (in progress)'}`),
      el('span', { class: 't-sub muted' }, `${absTime(s.at)} · ${sets(s.dose)}`),
      icon('chevron-right', { class: 'li-chevron' }))))) : null);
}

/** Default ranges per muscle group, collapsed. The wording is in the info sheets. */
function assumptions() {
  const cfg = RECOVERY_CONFIG;
  const groups = new Map();
  for (const m of MUSCLES) {
    const k = cfg.base[m.id].join('–');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m.name);
  }
  return el('details', { class: 'card wk-rc-assume' },
    el('summary', { class: 'wk-details-sum' }, el('span', { class: 'grow' }, 'How the estimate works'), icon('chevron-down', { class: 'wk-summary-chev' })),
    el('div', { class: 'wk-rc-table', role: 'table', 'aria-label': `Default range per muscle for ${cfg.referenceDose} sets` },
      el('div', { class: 'wk-rc-trow is-head', role: 'row' },
        el('span', { role: 'columnheader' }, 'Muscles'), el('span', { role: 'columnheader' }, `Default, ${cfg.referenceDose} sets`)),
      [...groups].map(([k, names]) => el('div', { class: 'wk-rc-trow', role: 'row' },
        el('span', { role: 'cell' }, names.join(', ')), el('span', { role: 'cell' }, `${k} h`)))));
}
