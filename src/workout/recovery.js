// Muscle recovery: compact section for the workout home, and the detail screen.
// Route: workout/recovery. Model and caveats: src/core/recovery.js (general rule of thumb, not a measurement).
import * as db from '../db/db.js';
import { el, pageHeader, href, fmtTime, fmtNum, toast, openSheet, numberInput, field, confirmDialog } from '../ui/index.js';
import {
  muscleRecovery, sortByRecovery, recoveryWords, STATUS_LABEL, RECOVERY_CONFIG, RECOVERY_KEY,
  recoverySettings, paceFactor, lookbackFrom, doseFactor, recoveryWindow, validateRange, withBase, baseRange,
} from '../core/recovery.js';
import { MUSCLES } from '../core/muscles.js';
import { ensureCss, loadExercises } from './data.js';

const H = 3600000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ICON = { recovering: '○', 'likely-ready': '◐', fresh: '●' };
/** Rows on the home screen: muscles trained within this many days. */
const HOME_DAYS = 7;

const CAPTION = 'A general estimate from your sets and the time since, not a measurement. '
  + 'Sleep, nutrition, how hard the sets were and soreness all change real recovery.';

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

function statusBadge(r) {
  return el('span', { class: ['wk-rc-status', `is-${r.status}`] },
    el('span', { 'aria-hidden': 'true' }, ICON[r.status]), ' ', STATUS_LABEL[r.status]);
}

/** Bar: 0 … max hours; the min–max band is hatched, a tick marks min, the fill is time passed. */
function bar(r) {
  if (!r.trained) return null;
  const band = (r.minHours / r.maxHours) * 100;
  return el('span', { class: 'wk-rc-bar', 'aria-hidden': 'true' },
    el('span', { class: 'wk-rc-band', style: { left: `${band}%` } }),
    el('span', { class: ['wk-rc-fill', `is-${r.status}`], style: { width: `${r.progress}%` } }),
    el('span', { class: 'wk-rc-min', style: { left: `${band}%` } }));
}

function ariaText(r, now) {
  if (!r.trained) return `${r.name}: no training in the last ${RECOVERY_CONFIG.lookbackDays} days.`;
  return `${r.name}: ${STATUS_LABEL[r.status]}, ${recoveryWords(r)}. Last trained ${lastLine(r)}. `
    + `Estimated window ${r.minHours} to ${r.maxHours} hours; ${r.progress} percent through it.`
    + (r.status === 'fresh' ? '' : ` Ready from ${absTime(r.readyAt)} (${relative(r.readyAt, now)}), fully recovered by ${absTime(r.fullAt)} (${relative(r.fullAt, now)}).`);
}

/**
 * One muscle row. Tapping toggles between relative words and absolute times.
 * @param {ReturnType<typeof muscleRecovery>[number]} r
 */
function recoveryRow(r, now) {
  const words = el('span', { class: 'wk-rc-words' }, recoveryWords(r));
  const abs = r.status === 'fresh'
    ? `recovered since ${absTime(r.fullAt)}`
    : `ready from ${absTime(r.readyAt)} · fully by ${absTime(r.fullAt)}`;
  const rel = recoveryWords(r);
  const row = el('button', {
    type: 'button', class: 'wk-rc-row', 'aria-pressed': 'false', 'aria-label': ariaText(r, now),
    onClick: () => {
      const on = row.getAttribute('aria-pressed') !== 'true';
      row.setAttribute('aria-pressed', String(on));
      words.textContent = on ? abs : rel;
    },
  },
  el('span', { class: 'wk-rc-head' },
    el('span', { class: 'wk-rc-name' }, r.name),
    statusBadge(r)),
  bar(r),
  el('span', { class: 'wk-rc-sub small' }, words, el('span', { class: 'wk-rc-last muted' }, lastLine(r))));
  return row;
}

/**
 * Home section. `workouts` may be the full list already loaded by the home view; only the
 * last 14 days are used.
 */
export function recoverySection(workouts, exMap, weights, setting, now = Date.now()) {
  const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { now, ...recoveryOpts(setting) }));
  const recent = rows.filter((r) => r.trained && (now - r.lastAt < HOME_DAYS * 24 * H || r.status !== 'fresh'));
  const rested = MUSCLES.filter((m) => !recent.some((r) => r.muscle === m.id)).map((m) => m.name);
  return el('section', { class: 'section', 'data-recovery': '' },
    el('div', { class: 'row-between' },
      el('h2', { class: 'section-title' }, 'Muscle recovery'),
      el('a', { class: 'wk-rc-more', href: href('workout/recovery') }, 'Details ›')),
    el('div', { class: 'card wk-rc-card' },
      recent.length
        ? el('div', { class: 'wk-rc-list' }, recent.map((r) => recoveryRow(r, now)))
        : el('p', { class: 'muted small wk-rc-empty' }, `No muscle trained in the last ${HOME_DAYS} days — everything is rested.`),
      recent.length && rested.length ? el('p', { class: 'small muted wk-rc-rested' }, `Rested: ${rested.join(', ')}`) : null,
      el('p', { class: 'field-hint wk-rc-caption' }, CAPTION, recent.length ? ' Tap a row for times.' : null)));
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
  container.append(pageHeader({ title: 'Muscle recovery', subtitle: 'General estimate per muscle', back: 'workout' }));

  const listHost = el('div', { class: 'card wk-rc-card' });
  const rangesHost = el('div', { class: 'card card-flush' });
  const resetAllBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: () => resetAll() }, 'Reset all to default');
  const paint = () => {
    const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { now, ...recoveryOpts(setting) }));
    listHost.replaceChildren(el('div', { class: 'wk-rc-list' }, rows.map((r) => detailRow(r, now))));
    rangesHost.replaceChildren(el('div', { class: 'list' }, MUSCLES.map((m) => rangeRow(m))));
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
    el('span', { class: 'li-trail num' }, custom ? el('span', { class: 'badge wk-rc-own' }, 'yours') : null, ` ${range[0]}–${range[1]} h`),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'));
  }

  function editRange(m) {
    const { range, custom } = baseRange(m.id, setting.base);
    const def = RECOVERY_CONFIG.base[m.id];
    const c = RECOVERY_CONFIG.custom;
    const lo = numberInput({ value: range[0], min: 0, max: 999, integer: true, ariaLabel: `${m.name} shortest hours` });
    const hi = numberInput({ value: range[1], min: 0, max: 999, integer: true, ariaLabel: `${m.name} longest hours` });
    const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const sh = openSheet({
      title: `${m.name} recovery`,
      content: [
        el('div', { class: 'grid-2' }, field('Shortest', lo, { unit: 'h' }), field('Longest', hi, { unit: 'h' })),
        el('p', { class: 'field-hint' },
          `Hours after about ${RECOVERY_CONFIG.referenceDose} hard sets at average pace. More or fewer sets and your pace still scale it. `
          + `Whole hours, ${c.min}–${c.max} h, longest at least ${c.minGap} h more. Default ${def[0]}–${def[1]} h.`),
        err,
      ],
    });
    sh.footer.append(
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
    const ok = await confirmDialog({ title: 'Reset all ranges?', message: 'Every muscle goes back to the default range. Your pace setting stays.', confirmLabel: 'Reset' });
    if (!ok) return;
    delete setting.base;
    paint();
    await persist();
    toast('All ranges reset to default');
  }

  const tabs = el('div', { class: 'tabs wk-rc-tabs', role: 'radiogroup', 'aria-label': 'How fast you recover' },
    PACES.map(([id, label, aria]) => el('button', {
      type: 'button', role: 'radio', 'aria-checked': String(setting.pace === id), 'aria-label': `${aria} (× ${RECOVERY_CONFIG.paces[id]})`,
      dataset: { pace: id },
      onClick: async () => {
        setting.pace = id;
        for (const b of tabs.children) b.setAttribute('aria-checked', String(b.dataset.pace === id));
        paint();
        await persist();
      },
    }, label)));

  paint();
  container.append(
    el('p', { class: 'small muted wk-pad-x' }, CAPTION),
    el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Your recovery'),
      tabs,
      el('p', { class: 'field-hint wk-pad-x' },
        `Scales every window: faster × ${RECOVERY_CONFIG.paces.faster}, average × 1, slower × ${RECOVERY_CONFIG.paces.slower}. Saved automatically.`)),
    el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'All muscles'), listHost),
    el('section', { class: 'section' },
      el('h2', { class: 'section-title' }, 'Recovery range per muscle'),
      el('p', { class: 'field-hint wk-pad-x' }, `Tap a muscle to set your own range (hours after about ${RECOVERY_CONFIG.referenceDose} hard sets). Saved automatically.`),
      rangesHost, resetAllBtn),
    assumptions(weights));
}

function detailRow(r, now) {
  const row = recoveryRow(r, now);
  if (!r.trained) {
    return el('div', { class: 'wk-rc-detail' },
      el('div', { class: 'wk-rc-head wk-rc-static' }, el('span', { class: 'wk-rc-name' }, r.name), statusBadge(r)),
      el('div', { class: 'small muted' }, `Not trained in the last ${RECOVERY_CONFIG.lookbackDays} days.`));
  }
  const carried = r.dose - r.lastDose;
  return el('div', { class: 'wk-rc-detail' },
    row,
    el('div', { class: 'small muted wk-rc-why' },
      `Window ${r.minHours}–${r.maxHours} h after the last session`,
      carried > 0.004 ? ` (${sets(r.lastDose)} + ${fmtNum(carried, 2)} carried over from the session before = ${sets(r.dose)})` : ` (${sets(r.dose)})`,
      '.'),
    el('ul', { class: 'wk-rc-sessions' }, r.sessions.map((s) => el('li', null,
      el('a', {
        class: 'wk-rc-slink',
        href: href(s.finished ? `workout/history/${encodeURIComponent(s.workoutId)}` : `workout/session/${encodeURIComponent(s.workoutId)}`),
      },
      el('span', { class: 'wk-rc-sname' }, `${s.name}${s.finished ? '' : ' (in progress)'}`),
      el('span', { class: 'small muted num' }, `${absTime(s.at)} · ${sets(s.dose)}`),
      el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '›'))))));
}

function assumptions(weights) {
  const cfg = RECOVERY_CONFIG;
  const groups = new Map();
  for (const m of MUSCLES) {
    const k = cfg.base[m.id].join('–');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m.name);
  }
  const ex = (d) => recoveryWindow('chest', d).join('–');
  return el('section', { class: 'section' },
    el('h2', { class: 'section-title' }, 'How the estimate works'),
    el('div', { class: 'card stack wk-rc-assume' },
      el('p', { class: 'small' },
        `Rule of thumb from common training advice: a muscle trained hard is usually given about 48–72 h before training it hard again. `
        + 'Smaller muscles tend to need less, the big leg muscles more. This is not a measurement of your body and not based on a specific study.'),
      el('div', { class: 'wk-rc-table', role: 'table', 'aria-label': `Base range per muscle for about ${cfg.referenceDose} sets` },
        el('div', { class: 'wk-rc-trow is-head', role: 'row' },
          el('span', { role: 'columnheader' }, 'Muscles'), el('span', { role: 'columnheader' }, `Default, ${cfg.referenceDose} sets`)),
        [...groups].map(([k, names]) => el('div', { class: 'wk-rc-trow', role: 'row' },
          el('span', { role: 'cell' }, names.join(', ')), el('span', { role: 'cell', class: 'num' }, `${k} h`)))),
      el('p', { class: 'small' },
        `Sets are counted like the weekly volume: a ticked set adds ${fmtNum(weights.primary, 2)} to each primary and ${fmtNum(weights.secondary, 2)} to each secondary muscle; `
        + `a dropset adds ${fmtNum(weights.dropset, 2)} × that. Fewer sets shorten the range, more sets lengthen it: `
        + `1 set × ${doseFactor(1)}, ${cfg.referenceDose} sets × 1, 8 sets × ${fmtNum(doseFactor(8), 1)}, ${Math.round((cfg.doseFactorMax - cfg.doseIntercept) / cfg.doseSlope)}+ sets × ${cfg.doseFactorMax}. `
        + `For chest that is ${ex(1)} h (1 set), ${ex(4)} h (4 sets), ${ex(8)} h (8 sets).`),
      el('p', { class: 'small' },
        `Less than ${cfg.minDose} counted set (e.g. a single set where the muscle only helps) does not restart the clock. `
        + `If you train a muscle again before its window is over, the leftover part of the earlier sets is added to the new session. `
        + `Default ranges stay between ${cfg.capMin} h and ${cfg.capMax} h (${cfg.capMax / 24} days). `
        + `A range you set yourself is used as is for about ${cfg.referenceDose} sets and is only kept within ${cfg.custom.min}–${cfg.custom.max} h. `
        + `Only the last ${cfg.lookbackDays} days are looked at.`),
      el('p', { class: 'small' },
        'Recovering = before the short end of the range. Likely ready = inside the range. Recovered = past the long end. '
        + 'If a muscle still feels sore or weak, give it more time.')));
}
