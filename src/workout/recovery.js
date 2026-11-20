// Muscle recovery: body-map card for the workout home, the check-in sheet, and the detail screen.
// Route: workout/recovery. Model and caveats: src/core/recovery.js (rule of thumb, not a measurement;
// check-ins and personal ranges in its second half); the wording lives in the 'recovery',
// 'recovery-math' and 'recovery-yours' info sheets.
import * as db from '../db/db.js';
import {
  el, replaceChildren, append, pageHeader, href, fmtTime, fmtNum, fmtDate, toast, openSheet, numberInput, field,
  tag, sectionHeader, segmented, infoButton, icon, iconButton, bodyMap, muscleIcon, setBodyMapValues,
} from '../ui/index.js';
import {
  muscleRecovery, sortByRecovery, recoveryWords, STATUS_LABEL, RECOVERY_CONFIG, RECOVERY_KEY,
  recoverySettings, paceFactor, lookbackFrom, validateRange, withBase, withRule, baseRange, fmtSpanRange,
  CHECKINS_KEY, CHECKIN_CONFIG, sanitiseCheckins, makeCheckin, addCheckin, removeCheckin, learnRanges, learnedBase,
  checkinBouts, doseFactor,
} from '../core/recovery.js';
import { MUSCLES, muscleName } from '../core/muscles.js';
import { fromTimestamp } from '../core/dates.js';
import { ensureCss, loadExercises, confirmAction } from './data.js';

const H = 3600000;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Core status -> body-map / muscle-icon / bar state. Recovered muscles are neutral everywhere (map,
 * legend, chips, detail list): red / amber only while recovering / likely ready; the label says which. */
const MAP_STATE = { recovering: 'recovering', 'likely-ready': 'ready', fresh: 'neutral' };
/** "Recently trained" on the home card: muscles trained within this many days. */
const HOME_DAYS = 7;
const ANSWER = { recovered: 'Recovered', sore: 'Still sore' };
const SOURCE = { rule: 'Rule of thumb', yours: 'Yours', set: 'Set by you' };

let rcCss = false;
/** recovery.css (check-in sheet, history, chart), once. */
function ensureRcCss() {
  ensureCss();
  if (rcCss || document.querySelector('link[data-rc-css]')) { rcCss = true; return; }
  rcCss = true;
  append(document.head, el('link', { rel: 'stylesheet', href: new URL('./recovery.css', import.meta.url).href, 'data-rc-css': '' }));
}

/** Workouts that can matter for recovery at `now` (index query on date, not the whole history). */
export async function loadRecentWorkouts(now) {
  return db.range('workouts', 'date', { lower: lookbackFrom(now) });
}

/**
 * Options for muscleRecovery from the loaded setting: pace, hand-set ranges, learned ranges in force
 * and the check-ins. With no check-ins this is exactly the previous behaviour.
 */
export function recoveryOpts(setting) {
  const s = recoverySettings(setting);
  const checkins = setting && Array.isArray(setting.checkins) ? setting.checkins : [];
  return {
    factor: paceFactor(setting), base: s.base || null,
    learned: checkins.length ? learnedBase(learnRanges(checkins), s.rule) : null, checkins,
  };
}

/**
 * The recovery setting plus the stored check-ins (`checkins`, oldest first). Only the setting part is
 * ever written back under 'recovery' (recoverySettings drops `checkins`).
 * @returns {Promise<{pace: string, base?: Record<string, [number, number]>, rule?: string[], checkins: object[]}>}
 */
export async function loadRecoverySetting() {
  const [raw, ck] = await Promise.all([db.getSetting(RECOVERY_KEY), db.getSetting(CHECKINS_KEY)]);
  return { ...recoverySettings(raw), checkins: sanitiseCheckins(ck) };
}

// Check-ins are written read-modify-write, one at a time (home card and detail screen share this).
let ckChain = Promise.resolve();
/** One check-in toast at a time: a new answer replaces the previous Undo. */
let ckToast = null;
function checkinToast(message, opts) {
  if (ckToast) ckToast();
  ckToast = toast(message, opts);
}
function updateCheckins(fn) {
  const p = ckChain.then(async () => {
    const next = fn(sanitiseCheckins(await db.getSetting(CHECKINS_KEY), Infinity));
    await db.setSetting(CHECKINS_KEY, next);
    return next;
  });
  ckChain = p.catch(() => {});
  return p.catch((err) => {
    console.error(err);
    toast(`Could not save: ${err && err.message}`, { type: 'error' });
    return null;
  });
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
    + `Estimated window ${r.minHours} to ${r.maxHours} hours (${SOURCE[r.source].toLowerCase()}); ${r.progress} percent through it.`
    + (r.modelStatus === 'fresh' ? '' : ` Ready from ${absTime(r.readyAt)} (${relative(r.readyAt, now)}), fully recovered by ${absTime(r.fullAt)} (${relative(r.fullAt, now)}).`)
    + ' Check in.';
}

/** Absolute times of one muscle: 'ready from Thu 14:00 · fully by Fri 02:00'. */
function absText(r) {
  if (!r.trained) return `not trained in ${RECOVERY_CONFIG.lookbackDays} days`;
  return r.modelStatus === 'fresh'
    ? `estimate: recovered since ${absTime(r.fullAt)}`
    : `estimate: ready from ${absTime(r.readyAt)} · fully by ${absTime(r.fullAt)}`;
}

const byUser = (r) => !!(r.said && r.said.shown);

/** Short time on a chip: '12–36 h' while recovering, 'Likely ready' inside the window, the user's word when it decides. */
function chipTime(r) {
  if (byUser(r)) return r.said.answer === 'sore' ? 'You: still sore' : 'You: recovered';
  if (r.status === 'recovering') return fmtSpanRange(r.minHours - r.hoursSince, r.maxHours - r.hoursSince);
  return STATUS_LABEL[r.status];
}

/** Small 'yours' marker next to a range learned from the user's check-ins. */
const yoursMark = (r) => (r.source === 'yours' ? el('span', { class: 'rc-yours' }, 'yours') : null);

/** Status dot: red / amber; recovered = the neutral body-map colour (as on the map). */
function dot(status) {
  return el('span', { class: ['dot', MAP_STATE[status] === 'neutral' ? 'wk-dot-idle' : `is-${MAP_STATE[status]}`] });
}

function statusLine(r) {
  return el('span', { class: 'wk-rc-st' }, dot(r.status), STATUS_LABEL[r.status]);
}

/**
 * Check-in sheet for one trained muscle: estimate, times, and Recovered / Still sore. One tap saves,
 * closes and offers Undo. `onChange(list)` gets the new stored list (after save and after undo).
 */
function openCheckin(r, { onChange, onClose }) {
  ensureRcCss();
  const sh = openSheet({
    title: r.name,
    className: 'rc-sheet',
    onClose,
    content: [
      el('div', { class: 'rc-ck-head' },
        muscleIcon(r.muscle, { size: 48, state: MAP_STATE[r.status] }),
        el('div', { class: 'rc-ck-main' },
          statusLine(r),
          recoveryWords(r) !== STATUS_LABEL[r.status].toLowerCase() ? el('div', { class: 'rc-ck-words' }, recoveryWords(r)) : null)),
      el('p', { class: 't-sub muted rc-ck-line' }, absText(r).replace(/^e/, 'E')),
      el('p', { class: 't-sub muted rc-ck-line' },
        `${r.minHours}–${r.maxHours} h · ${SOURCE[r.source].toLowerCase()} · ${sets(r.dose)}`),
      el('p', { class: 't-sub rc-ck-ask' }, 'How does it feel?'),
    ],
  });
  const answer = async (a) => {
    sh.close();
    const rec = makeCheckin(r, a, Date.now(), crypto.randomUUID());
    const list = await updateCheckins((cur) => addCheckin(cur, rec));
    if (!list) return;
    onChange(list);
    checkinToast(`${r.name}: ${ANSWER[a].toLowerCase()}`, {
      type: 'success',
      action: {
        label: 'Undo',
        onClick: async () => {
          const back = await updateCheckins((cur) => removeCheckin(cur, rec.id));
          if (back) onChange(back);
        },
      },
    });
  };
  append(sh.footer,
    el('button', { type: 'button', class: 'btn rc-ck-btn', onClick: () => answer('sore') }, ANSWER.sore),
    el('button', { type: 'button', class: 'btn rc-ck-btn', onClick: () => answer('recovered') }, ANSWER.recovered));
  return sh;
}

/**
 * Home card: body map (front + back) coloured only for recovering (red) and likely ready (amber)
 * muscles, a legend, chips for those muscles (least recovered first), recovered muscles in one muted
 * line. Tapping a chip or a trained muscle on the map opens the check-in sheet (it shows the absolute
 * times); an untrained one shows a line. `workouts` may be the full list already loaded by the home
 * view; only the last 14 days are used. `setting` = loadRecoverySetting(); its `checkins` are updated
 * in place after a check-in.
 */
export function recoverySection(workouts, exMap, weights, setting, now = Date.now()) {
  ensureRcCss();
  const section = el('section', { class: 'section', 'data-recovery': '' });
  const render = (at) => {
    const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { now: at, ...recoveryOpts(setting) }));
    replaceChildren(section, sectionContent(rows, at, (list) => {
      if (setting) setting.checkins = sanitiseCheckins(list);
      render(Date.now());
    }));
  };
  render(now);
  return section;
}

function sectionContent(rows, now, onChange) {
  const byId = new Map(rows.map((r) => [r.muscle, r]));
  const active = rows.filter((r) => r.trained && r.status !== 'fresh');
  const recovered = rows.filter((r) => !active.includes(r));
  const anyRecent = rows.some((r) => r.trained && now - r.lastAt < HOME_DAYS * 24 * H);
  const values = Object.fromEntries(active.map((r) => [r.muscle, MAP_STATE[r.status]]));

  const map = bodyMap({ view: 'both', values, title: `Muscle recovery map: ${active.length ? active.map((r) => `${r.name} ${STATUS_LABEL[r.status].toLowerCase()}`).join(', ') : 'all muscles recovered'}` });
  map.classList.add('wk-rc-map');
  const detail = el('p', { class: 't-sub wk-rc-detail-line', 'aria-live': 'polite', hidden: true });
  const chips = [];
  const mark = (muscle) => {
    for (const c of chips) c.setAttribute('aria-pressed', String(c.dataset.muscle === muscle));
    for (const p of map.querySelectorAll('.bm-muscle')) p.classList.toggle('is-sel', p.getAttribute('data-muscle') === muscle);
  };
  const select = (muscle) => {
    const r = byId.get(muscle);
    if (!r) return;
    if (!r.trained) {
      const off = detail.dataset.muscle === muscle && !detail.hidden;
      mark(off ? null : muscle);
      detail.hidden = off;
      detail.dataset.muscle = muscle;
      replaceChildren(detail, off ? null : [el('span', { class: 'strong' }, r.name), ` · ${absText(r)}`]);
      return;
    }
    detail.hidden = true;
    mark(muscle);
    openCheckin(r, { onChange, onClose: () => mark(null) });
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
      el('span', { class: 'wk-mchip-st' }, dot(r.status), el('span', { class: 'rc-chip-time' }, chipTime(r)), yoursMark(r)))));
  }

  const recName = (r) => (r.said && r.said.answer === 'recovered' ? `${r.name} (you said)` : r.name);
  // Section title above the card (home uses caps titles only: three type sizes plus the page title).
  return [
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
          el('span', el('span', { class: 'strong' }, 'Recovered'), ' ', el('span', { class: 'muted' }, recovered.map(recName).join(' · ')))) : null,
      detail),
  ];
}

const PACES = [
  ['faster', 'Faster', 'I recover faster'],
  ['average', 'Average', 'Average'],
  ['slower', 'Slower', 'I recover slower'],
];

export async function mountRecovery(container) {
  ensureRcCss();
  const now = Date.now();
  const [workouts, exMap, weights, loaded] = await Promise.all([
    loadRecentWorkouts(now), loadExercises(), db.getSetting('volume'), loadRecoverySetting(),
  ]);
  let checkins = loaded.checkins;
  const setting = recoverySettings(loaded);
  append(container, pageHeader({ title: 'Muscle recovery', subtitle: 'Estimate', back: 'workout', info: 'recovery' }));

  const map = bodyMap({ view: 'both', title: 'Muscle recovery map' });
  map.classList.add('wk-rc-map');
  const listHost = el('div', { class: 'list' });
  const rangesHost = el('div', { class: 'list' });
  const historyHost = el('div', { class: 'rc-history' });
  const resetAllBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: () => resetAll() }, 'Reset all to rule of thumb');
  let learned = learnRanges(checkins);
  let filter = '';
  let shown = 30;

  const opts = () => ({ ...recoveryOpts({ ...setting, checkins }), now: Date.now() });
  const paint = () => {
    learned = learnRanges(checkins);
    const at = Date.now();
    const rows = sortByRecovery(muscleRecovery(workouts, exMap, weights, { ...opts(), now: at }));
    setBodyMapValues(map, Object.fromEntries(rows.filter((r) => r.trained && r.status !== 'fresh').map((r) => [r.muscle, MAP_STATE[r.status]])));
    replaceChildren(listHost, rows.map((r) => detailRow(r, at, onCheckins)));
    replaceChildren(rangesHost, MUSCLES.map((m) => rangeRow(m)));
    resetAllBtn.hidden = !setting.base && !setting.rule && !Object.values(learned).some((l) => l.learned);
    paintHistory();
  };
  const onCheckins = (list) => { checkins = sanitiseCheckins(list); paint(); };
  map.addEventListener('click', (e) => {
    const p = /** @type {Element} */ (e.target).closest && /** @type {Element} */ (e.target).closest('[data-muscle]');
    if (!p) return;
    const rows = muscleRecovery(workouts, exMap, weights, opts());
    const r = rows.find((x) => x.muscle === p.getAttribute('data-muscle'));
    if (r && r.trained) openCheckin(r, { onChange: onCheckins });
  });

  let chain = Promise.resolve();
  const persist = () => {
    const value = recoverySettings(setting);
    chain = chain.then(() => db.setSetting(RECOVERY_KEY, value)).catch((err) => {
      console.error(err); toast(`Could not save: ${err && err.message}`, { type: 'error' });
    });
    return chain;
  };
  const replaceSetting = (v) => {
    delete setting.base;
    delete setting.rule;
    Object.assign(setting, v);
    paint();
    return persist();
  };
  const setRange = (muscle, range) => replaceSetting(withBase(setting, muscle, range));

  /** Range in force for a muscle and where it comes from. */
  function inForce(id) {
    const own = baseRange(id, setting.base);
    const l = learned[id];
    const ruled = (setting.rule || []).includes(id);
    if (own.custom) return { range: own.range, source: 'set', learned: l, ruled };
    if (l && l.learned && !ruled) return { range: l.range, source: 'yours', learned: l, ruled };
    return { range: RECOVERY_CONFIG.base[id], source: 'rule', learned: l, ruled };
  }

  /** 'Yours · 7 check-ins', 'Rule of thumb · 3 of 5 check-ins', 'Set by you · yours available'. */
  function sourceText(f) {
    const l = f.learned;
    if (f.source === 'yours') return `Yours · ${l.points} check-ins`;
    if (l && l.learned) return `${SOURCE[f.source]} · yours available`;
    return l && l.points ? `${SOURCE[f.source]} · ${Math.min(l.points, l.needPoints)} of ${l.needPoints} check-ins` : SOURCE[f.source];
  }

  function rangeRow(m) {
    const f = inForce(m.id);
    return el('button', {
      type: 'button', class: 'list-item', onClick: () => editRange(m),
      'aria-label': `${m.name}: ${f.range[0]} to ${f.range[1]} hours, ${sourceText(f).replace(/ · /g, ', ')}. Edit`,
    },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, m.name), el('div', { class: 'li-sub' }, sourceText(f))),
    el('span', { class: 'li-trail' }, `${f.range[0]}–${f.range[1]} h`),
    icon('chevron-right', { class: 'li-chevron' }));
  }

  function editRange(m) {
    const f = inForce(m.id);
    const l = f.learned;
    const def = RECOVERY_CONFIG.base[m.id];
    const lo = numberInput({ value: f.range[0], min: 0, max: 999, integer: true, ariaLabel: `${m.name} shortest hours` });
    const hi = numberInput({ value: f.range[1], min: 0, max: 999, integer: true, ariaLabel: `${m.name} longest hours` });
    const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const offer = l && l.learned && f.source !== 'yours';
    const sh = openSheet({
      title: `${m.name} recovery`,
      content: [
        el('p', { class: 't-sub muted rc-src-line' }, `In use: ${f.range[0]}–${f.range[1]} h · ${SOURCE[f.source].toLowerCase()}`),
        offer ? el('div', { class: 'rc-offer' },
          el('div', { class: 'grow' },
            el('div', null, `Yours: ${l.range[0]}–${l.range[1]} h`),
            el('div', { class: 't-sub muted' }, `from ${l.points} check-ins`)),
          el('button', {
            type: 'button', class: 'btn btn-sm', onClick: async () => {
              sh.close();
              await replaceSetting(withRule(withBase(setting, m.id, null), m.id, false));
              toast(`${m.name}: yours, ${l.range[0]}–${l.range[1]} h`, { type: 'success' });
            },
          }, 'Use')) : null,
        !l || !l.learned ? el('p', { class: 't-sub muted rc-src-line' }, progressText(l)) : null,
        el('div', { class: 'grid-2' }, field('Shortest', lo, { unit: 'h' }), field('Longest', hi, { unit: 'h' })),
        el('div', { class: 'wk-hint-row' },
          el('p', { class: 'field-hint' }, `For ${RECOVERY_CONFIG.referenceDose} hard sets. Rule of thumb ${def[0]}–${def[1]} h.`),
          infoButton('recovery-math')),
        err,
      ],
    });
    append(sh.footer,
      f.source !== 'rule' ? el('button', {
        type: 'button', class: 'btn', onClick: async () => {
          sh.close();
          await replaceSetting(withRule(withBase(setting, m.id, null), m.id, !!(l && l.learned)));
          toast(`${m.name}: rule of thumb ${def[0]}–${def[1]} h`);
        },
      }, 'Reset to rule of thumb') : el('button', { type: 'button', class: 'btn', onClick: () => sh.close() }, 'Cancel'),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const v = validateRange(lo.getNumber(), hi.getNumber());
          if (!v.ok) { err.textContent = v.error; err.hidden = false; return; }
          sh.close();
          const same = (r) => r && v.value[0] === r[0] && v.value[1] === r[1];
          if (f.source !== 'set' && same(f.range)) return; // nothing changed
          if (same(def) && !(l && l.learned)) await setRange(m.id, null);
          else await setRange(m.id, v.value);
          toast(`${m.name}: ${v.value[0]}–${v.value[1]} h saved`, { type: 'success' });
        },
      }, 'Save'));
  }

  async function resetAll() {
    const ok = await confirmAction({
      title: 'Reset all ranges?', message: 'All muscles use the rule of thumb. Check-ins and pace stay.', confirmLabel: 'Reset',
    });
    if (!ok) return;
    const rule = MUSCLES.map((m) => m.id).filter((id) => learned[id] && learned[id].learned);
    await replaceSetting(recoverySettings({ pace: setting.pace, rule }));
    toast('All ranges on the rule of thumb');
  }

  // ---------------------------------------------------------------- history
  const filterSel = el('select', {
    class: 'select rc-filter', 'aria-label': 'Show check-ins for',
    onChange: () => { filter = filterSel.value; shown = 30; paintHistory(); },
  });

  function paintHistory() {
    const muscles = MUSCLES.filter((m) => checkins.some((c) => c.muscle === m.id));
    if (filter && !muscles.some((m) => m.id === filter)) filter = '';
    replaceChildren(filterSel,
      el('option', { value: '', selected: !filter }, 'All muscles'),
      muscles.map((m) => el('option', { value: m.id, selected: filter === m.id }, m.name)));
    if (!checkins.length) {
      replaceChildren(historyHost, el('p', { class: 't-sub muted rc-empty' }, 'No check-ins yet. Tap a muscle to add one.'));
      return;
    }
    const list = checkins.filter((c) => !filter || c.muscle === filter).slice().reverse();
    const f = filter ? inForce(filter) : null;
    replaceChildren(historyHost,
      filterSel,
      filter ? checkinChart(checkins, filter, f) : null,
      el('div', { class: 'card card-flush' }, el('ul', { class: 'list rc-ck-list' }, list.slice(0, shown).map((c) => historyRow(c)))),
      list.length > shown ? el('button', {
        type: 'button', class: 'btn btn-ghost btn-block', onClick: () => { shown += 100; paintHistory(); },
      }, `Show ${Math.min(100, list.length - shown)} more`) : null);
  }

  function historyRow(c) {
    const day = `${fmtDate(fromTimestamp(c.at)).replace(/^\S+ /, '')}, ${fmtTime(c.at)}`;
    return el('li', { class: 'list-item rc-ck-row' },
      el('span', { class: ['rc-mark', c.answer === 'sore' ? 'is-sore' : 'is-rec'], 'aria-hidden': 'true' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, `${muscleName(c.muscle)} · ${ANSWER[c.answer].toLowerCase()}`),
        el('div', { class: 'li-sub' }, `${day} · ${fmtNum(c.hours, 0)} h after · ${sets(c.sets ?? c.dose)}`)),
      iconButton('trash-2', {
        label: `Delete check-in: ${muscleName(c.muscle)}, ${ANSWER[c.answer].toLowerCase()}, ${day}`,
        onClick: async () => {
          const list = await updateCheckins((cur) => removeCheckin(cur, c.id));
          if (!list) return;
          onCheckins(list);
          checkinToast('Check-in deleted', {
            action: {
              label: 'Undo',
              onClick: async () => {
                const back = await updateCheckins((cur) => sanitiseCheckins([...cur, c], CHECKIN_CONFIG.cap));
                if (back) onCheckins(back);
              },
            },
          });
        },
      }));
  }

  const pace = segmented({
    ariaLabel: 'How fast you recover (rule-of-thumb ranges)',
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
    el('section', { class: 'section' }, sectionHeader('Your pace'), pace,
      el('p', { class: 'field-hint wk-pad-x' }, 'Scales rule-of-thumb ranges only.')),
    el('section', { class: 'section' }, sectionHeader('All muscles'), el('div', { class: 'card card-flush' }, listHost)),
    el('section', { class: 'section' },
      sectionHeader('Recovery range per muscle', { info: 'recovery-yours' }),
      el('p', { class: 'field-hint wk-pad-x' }, `Hours for ${RECOVERY_CONFIG.referenceDose} hard sets. Tap to edit.`),
      el('div', { class: 'card card-flush' }, rangesHost), resetAllBtn),
    el('section', { class: 'section' }, sectionHeader('Check-ins', { info: 'recovery-yours' }), historyHost),
    assumptions());
}

/** '3 of 5 check-ins' or what is still missing. */
function progressText(l) {
  if (!l) return `0 of ${CHECKIN_CONFIG.minPoints} check-ins`;
  if (l.points < l.needPoints) return `${l.points} of ${l.needPoints} check-ins`;
  if (l.bouts < l.needBouts) return `${l.bouts} of ${l.needBouts} workouts with check-ins`;
  return l.sore ? 'Needs a “recovered” answer' : 'Needs a “still sore” answer';
}

/**
 * Compact chart of one muscle's check-ins: one row per workout (newest on top, at most 12), hours
 * after the workout scaled to the reference dose; recovered filled, still sore hollow; the range in
 * force as a band. SVG with token colours (classes in recovery.css).
 */
function checkinChart(checkins, muscle, f) {
  const bouts = checkinBouts(checkins, muscle).slice(0, 12);
  if (!bouts.length) return null;
  const all = bouts.flatMap((b) => [...b.kept, ...b.ignored].map((c) => ({ c, u: c.hours / doseFactor(c.dose) })));
  const xmax = Math.max(48, Math.ceil((Math.max(f.range[1] * 1.25, ...all.map((p) => p.u * 1.08))) / 24) * 24);
  const W = 320;
  const L = 8;
  const R = 8;
  const rowH = 18;
  const top = 6;
  const plotH = bouts.length * rowH;
  const Hh = top + plotH + 22;
  const x = (u) => L + (Math.min(u, xmax) / xmax) * (W - L - R);
  const ns = 'http://www.w3.org/2000/svg';
  const s = (tagName, attrs, ...kids) => {
    const n = document.createElementNS(ns, tagName);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
    for (const k of kids) if (k) n.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
    return n;
  };
  const rec = all.filter((p) => p.c.answer === 'recovered').length;
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${Hh}`, class: 'rc-chart', role: 'img',
    'aria-label': `${muscleName(muscle)} check-ins, hours after the workout scaled to ${RECOVERY_CONFIG.referenceDose} sets: ${rec} recovered, ${all.length - rec} still sore. Range in use ${f.range[0]} to ${f.range[1]} hours.`,
  });
  svg.appendChild(s('rect', { class: 'rc-band', x: x(f.range[0]), y: top - 4, width: Math.max(1, x(f.range[1]) - x(f.range[0])), height: plotH + 8, rx: 4 }));
  bouts.forEach((b, i) => {
    const y = top + i * rowH + rowH / 2;
    svg.appendChild(s('line', { class: 'rc-row', x1: L, x2: W - R, y1: y, y2: y }));
  });
  bouts.forEach((b, i) => {
    const y = top + i * rowH + rowH / 2;
    for (const c of [...b.kept, ...b.ignored]) {
      const off = b.ignored.includes(c);
      svg.appendChild(s('circle', {
        class: ['rc-dot', c.answer === 'sore' ? 'is-sore' : 'is-rec', off ? 'is-off' : ''].join(' ').trim(),
        cx: x(c.hours / doseFactor(c.dose)), cy: y, r: 4.5,
      }));
    }
  });
  for (let t = 0; t <= xmax; t += xmax > 144 ? 48 : 24) {
    svg.appendChild(s('line', { class: 'rc-tick', x1: x(t), x2: x(t), y1: top + plotH + 4, y2: top + plotH + 8 }));
    svg.appendChild(s('text', { class: 'rc-tlabel', x: x(t), y: top + plotH + 19, 'text-anchor': t === 0 ? 'start' : 'middle' }, t === 0 ? '0 h' : String(t)));
  }
  return el('div', { class: 'card rc-chart-card' },
    svg,
    el('ul', { class: 'legend legend-row rc-legend' },
      el('li', el('span', { class: 'rc-mark is-rec' }), 'Recovered'),
      el('li', el('span', { class: 'rc-mark is-sore' }), 'Still sore'),
      el('li', el('span', { class: 'rc-swatch-band' }), `In use ${f.range[0]}–${f.range[1]} h`)),
    el('p', { class: 'field-hint' }, `Hours after the workout, scaled to ${RECOVERY_CONFIG.referenceDose} sets. One row per workout.`));
}

/** One muscle on the detail screen: status, bar, window; tapping opens the check-in sheet. */
function detailRow(r, now, onChange) {
  const state = r.trained ? MAP_STATE[r.status] : null;
  if (!r.trained) {
    return el('div', { class: 'list-item wk-rc-item' },
      muscleIcon(r.muscle, { state: 'neutral' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, r.name),
        el('div', { class: 'li-sub' }, `Not trained in ${RECOVERY_CONFIG.lookbackDays} days`)));
  }
  const band = (r.minHours / r.maxHours) * 100;
  const carried = r.dose - r.lastDose;
  const row = el('button', {
    type: 'button', class: 'list-item wk-rc-item', 'aria-label': ariaText(r, now), 'aria-haspopup': 'dialog',
    onClick: () => openCheckin(r, { onChange }),
  },
  muscleIcon(r.muscle, { state }),
  el('div', { class: 'li-main' },
    el('div', { class: 'wk-rc-head' }, el('span', { class: 'li-title' }, r.name), statusLine(r)),
    el('span', { class: 'wk-rc-bar', 'aria-hidden': 'true' },
      el('span', { class: 'wk-rc-band', style: { left: `${band}%` } }),
      el('span', { class: ['wk-rc-fill', `is-${state}`], style: { width: `${r.progress}%` } }),
      el('span', { class: 'wk-rc-min', style: { left: `${band}%` } })),
    el('div', { class: 'li-sub wk-rc-sub' }, el('span', { class: 'wk-rc-words' }, recoveryWords(r))),
    el('div', { class: 'li-sub' },
      `${r.minHours}–${r.maxHours} h`, yoursMark(r),
      ` · ${sets(r.dose)}${carried > 0.004 ? ` (${fmtNum(carried, 2)} carried over)` : ''} · last ${lastLine(r)}`)));
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
    el('div', { class: 'wk-rc-table', role: 'table', 'aria-label': `Rule-of-thumb range per muscle for ${cfg.referenceDose} sets` },
      el('div', { class: 'wk-rc-trow is-head', role: 'row' },
        el('span', { role: 'columnheader' }, 'Muscles'), el('span', { role: 'columnheader' }, `Rule of thumb, ${cfg.referenceDose} sets`)),
      [...groups].map(([k, names]) => el('div', { class: 'wk-rc-trow', role: 'row' },
        el('span', { role: 'cell' }, names.join(', ')), el('span', { role: 'cell' }, `${k} h`)))));
}
