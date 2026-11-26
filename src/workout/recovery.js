// Muscle recovery: body-map card for the workout home, the check-in sheet, and the detail screen.
// Route: workout/recovery. Model and caveats: src/core/recovery.js (rule of thumb, not a measurement;
// check-ins and personal ranges in its second half); the wording lives in the 'recovery',
// 'recovery-math' and 'recovery-yours' info sheets.
import * as db from '../db/db.js';
import {
  el, replaceChildren, append, pageHeader, href, fmtTime, fmtNum, toast, openSheet, numberInput, field,
  tag, sectionHeader, segmented, infoButton, icon, iconButton, bodyMap, muscleIcon, setBodyMapValues,
  joinSentences,
} from '../ui/index.js';
import {
  muscleRecovery, sortByRecovery, recoveryState, RECOVERY_CONFIG, RECOVERY_KEY,
  recoverySettings, paceFactor, lookbackFrom, validateRange, withBase, withRule, baseRange, spanRange,
  CHECKINS_KEY, CHECKIN_CONFIG, sanitiseCheckins, makeCheckin, addCheckin, removeCheckin, learnRanges, learnedBase,
  checkinBouts, doseFactor,
} from '../core/recovery.js';
import { MUSCLES } from '../core/muscles.js';
import { ensureCss, loadExercises, confirmAction, workoutTitle, loadRoutineIndex } from './data.js';
import { t } from '../i18n/index.js';
import { weekdayShort, dayMonth } from '../i18n/dates.js';
import { muscleName } from '../i18n/names.js';

const H = 3600000;
/** Core status -> body-map / muscle-icon / bar state. Recovered muscles are neutral everywhere (map,
 * legend, chips, detail list): red / amber only while recovering / likely ready; the label says which. */
const MAP_STATE = { recovering: 'recovering', 'likely-ready': 'ready', fresh: 'neutral' };
/** "Recently trained" on the home card: muscles trained within this many days. */
const HOME_DAYS = 7;
/** Catalogue key part per core status. */
const STATUS_KEY = { recovering: 'recovering', 'likely-ready': 'likelyReady', fresh: 'recovered' };
/** 'Recovering' / 'Likely ready' / 'Recovered' (label), or lower case inside a sentence (inline). */
const statusLabel = (st) => t(`analysis.rc.status.${STATUS_KEY[st]}`);
const statusInline = (st) => t(`analysis.rc.statusInline.${STATUS_KEY[st]}`);
/** Check-in answers: 'Recovered' / 'Still sore' (buttons, legend), lower case inside a sentence. */
const answerLabel = (a) => t(`analysis.rc.answer.${a}`);
const answerInline = (a) => t(`analysis.rc.answerInline.${a}`);
/** Where a range comes from: 'Rule of thumb' / 'Yours' / 'Set by you' (label) or lower case (inline). */
const sourceLabel = (src) => t(`analysis.rc.source.${src}`);
const sourceInline = (src) => t(`analysis.rc.sourceInline.${src}`);
/** Display name of a muscle row. */
const mName = (r) => muscleName(r.muscle);

/**
 * A duration from core span(): '10 h', '2.5 days'. after = the form after "in" / "ago" (German
 * dative: 'in 2 Tagen', 'vor 2 Tagen').
 * @param {{unit: 'h'|'days', value: number}} sp @param {boolean} [after]
 */
function spanText(sp, after = false) {
  if (sp.unit === 'h') return t(after ? 'analysis.span.hoursIn' : 'analysis.span.hours', { n: sp.value });
  return t(after ? 'analysis.span.daysIn' : 'analysis.span.days', { count: sp.value, n: fmtNum(sp.value, 1) });
}

/** A range from core spanRange(): '10–34 h', '1.5–2.5 days' (plural by the upper end). */
function spanRangeText(r, after = false) {
  if (r.lo === r.hi) return spanText({ unit: r.unit, value: r.hi }, after);
  if (r.unit === 'h') return t(after ? 'analysis.span.hoursRangeIn' : 'analysis.span.hoursRange', { lo: r.lo, hi: r.hi });
  return t(after ? 'analysis.span.daysRangeIn' : 'analysis.span.daysRange', { count: r.hi, lo: fmtNum(r.lo, 1), hi: fmtNum(r.hi, 1) });
}

/** '6 h ago', '2 days ago', 'just now'. */
const agoText = (sp) => (sp ? t('analysis.rc.ago', { span: spanText(sp, true) }) : t('analysis.rc.justNow'));

/**
 * Plain words for a row (core recoveryState): 'ready in about 10–34 h', 'likely ready — full recovery in
 * up to 12 h', 'recovered', 'you said still sore · 6 h ago', 'no recent training'.
 */
function stateText(r) {
  const st = recoveryState(r);
  switch (st.kind) {
    case 'untrained': return t('analysis.rc.words.untrained');
    case 'said': return t(`analysis.rc.words.said.${st.answer}`, { ago: agoText(st.ago) });
    case 'fresh': return t('analysis.rc.words.recovered');
    case 'recovering': return t('analysis.rc.words.readyIn', { span: spanRangeText(st.range, true) });
    default: return t('analysis.rc.words.likelyReady', { span: spanText(st.upTo, true) });
  }
}

/** The same without repeating the status label (screen-reader text): '' for recovered. */
function stateDetail(r) {
  const st = recoveryState(r);
  if (st.kind === 'fresh') return '';
  if (st.kind === 'likely-ready') return t('analysis.rc.words.fullIn', { span: spanText(st.upTo, true) });
  return stateText(r);
}

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
  const [workouts] = await Promise.all([db.range('workouts', 'date', { lower: lookbackFrom(now) }), loadRoutineIndex()]);
  return workouts;
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
    toast(t('analysis.saveFailed', { error: err && err.message }), { type: 'error' });
    return null;
  });
}

/** 'Thu 14:00' */
function absTime(ms) {
  return `${weekdayShort((new Date(ms).getDay() + 6) % 7)} ${fmtTime(ms)}`;
}

/** '6.5 sets', '1 set' */
const sets = (n) => t('analysis.rc.sets', { count: n, n: fmtNum(n, 2) });

/** 'Mon, 6.5 sets' */
function lastLine(r) {
  return t('analysis.rc.lastLine', { day: weekdayShort((new Date(r.lastAt).getDay() + 6) % 7), sets: sets(r.lastDose) });
}

function relative(ms, now) {
  const h = (ms - now) / H;
  if (h <= 0) return t('analysis.rc.rel.now');
  if (h < 1) return t('analysis.rc.rel.underHour');
  if (h < 48) return t('analysis.rc.rel.hours', { n: Math.round(h) });
  const d = Math.round((h / 24) * 2) / 2;
  return t('analysis.rc.rel.days', { count: d, n: fmtNum(d, 1) });
}

function ariaText(r, now) {
  if (!r.trained) return t('analysis.rc.aria.untrained', { muscle: mName(r), count: RECOVERY_CONFIG.lookbackDays });
  // stateDetail leaves out the status for likely ready / recovered: say it once
  const words = stateDetail(r);
  return joinSentences([
    words ? t('analysis.rc.aria.statusWords', { muscle: mName(r), status: statusLabel(r.status), words })
      : t('analysis.rc.aria.status', { muscle: mName(r), status: statusLabel(r.status) }),
    t('analysis.rc.aria.last', { last: lastLine(r) }),
    t('analysis.rc.aria.window', { min: r.minHours, max: r.maxHours, source: sourceInline(r.source), pct: r.progress }),
    r.modelStatus === 'fresh' ? null : t('analysis.rc.aria.times', {
      ready: absTime(r.readyAt), readyRel: relative(r.readyAt, now), full: absTime(r.fullAt), fullRel: relative(r.fullAt, now),
    }),
    t('analysis.rc.aria.checkIn'),
  ]);
}

/** Absolute times of a trained muscle: 'Estimate: ready from Thu 14:00 · fully by Fri 02:00'. */
function absText(r) {
  return r.modelStatus === 'fresh'
    ? t('analysis.rc.est.since', { time: absTime(r.fullAt) })
    : t('analysis.rc.est.window', { ready: absTime(r.readyAt), full: absTime(r.fullAt) });
}

const byUser = (r) => !!(r.said && r.said.shown);

/** Short time on a chip: '12–36 h' while recovering, 'Likely ready' inside the window, the user's word when it decides. */
function chipTime(r) {
  if (byUser(r)) return t(`analysis.rc.chipSaid.${r.said.answer}`);
  if (r.status === 'recovering') return spanRangeText(spanRange(r.minHours - r.hoursSince, r.maxHours - r.hoursSince));
  return statusLabel(r.status);
}

/** Small 'yours' marker next to a range learned from the user's check-ins. */
const yoursMark = (r) => (r.source === 'yours' ? el('span', { class: 'rc-yours' }, t('analysis.rc.yoursMark')) : null);

/** Status dot: red / amber; recovered = the neutral body-map colour (as on the map). */
function dot(status) {
  return el('span', { class: ['dot', MAP_STATE[status] === 'neutral' ? 'wk-dot-idle' : `is-${MAP_STATE[status]}`] });
}

function statusLine(r) {
  return el('span', { class: 'wk-rc-st' }, dot(r.status), statusLabel(r.status));
}

/**
 * Check-in sheet for one trained muscle: estimate, times, and Recovered / Still sore. One tap saves,
 * closes and offers Undo. `onChange(list)` gets the new stored list (after save and after undo).
 */
function openCheckin(r, { onChange, onClose }) {
  ensureRcCss();
  const sh = openSheet({
    title: mName(r),
    className: 'rc-sheet',
    onClose,
    content: [
      el('div', { class: 'rc-ck-head' },
        muscleIcon(r.muscle, { size: 48, state: MAP_STATE[r.status] }),
        el('div', { class: 'rc-ck-main' },
          statusLine(r),
          recoveryState(r).kind !== 'fresh' ? el('div', { class: 'rc-ck-words' }, stateText(r)) : null)),
      el('p', { class: 't-sub muted rc-ck-line' }, absText(r)),
      el('p', { class: 't-sub muted rc-ck-line' },
        [`${r.minHours}–${r.maxHours} h`, sourceInline(r.source), sets(r.dose)].join(' · ')),
      el('p', { class: 't-sub rc-ck-ask' }, t('analysis.rc.ask')),
    ],
  });
  const answer = async (a) => {
    sh.close();
    const rec = makeCheckin(r, a, Date.now(), crypto.randomUUID());
    const list = await updateCheckins((cur) => addCheckin(cur, rec));
    if (!list) return;
    onChange(list);
    checkinToast(t('analysis.rc.toastAnswer', { muscle: mName(r), answer: answerInline(a) }), {
      type: 'success',
      action: {
        label: t('analysis.rc.undo'),
        onClick: async () => {
          const back = await updateCheckins((cur) => removeCheckin(cur, rec.id));
          if (back) onChange(back);
        },
      },
    });
  };
  append(sh.footer,
    el('button', { type: 'button', class: 'btn rc-ck-btn', onClick: () => answer('sore') }, answerLabel('sore')),
    el('button', { type: 'button', class: 'btn rc-ck-btn', onClick: () => answer('recovered') }, answerLabel('recovered')));
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

  const map = bodyMap({
    view: 'both', values,
    title: t('analysis.rc.mapTitleList', {
      list: active.length ? active.map((r) => t('analysis.rc.mapItem', { muscle: mName(r), status: statusInline(r.status) })).join(t('analysis.listSep'))
        : t('analysis.rc.mapAllRecovered'),
    }),
  });
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
      replaceChildren(detail, off ? null : [el('span', { class: 'strong' }, mName(r)), ` · ${t('analysis.rc.notTrainedIn', { count: RECOVERY_CONFIG.lookbackDays })}`]);
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
      el('span', { class: 'wk-mchip-name' }, mName(r)),
      el('span', { class: 'wk-mchip-st' }, dot(r.status), el('span', { class: 'rc-chip-time' }, chipTime(r)), yoursMark(r)))));
  }

  const recName = (r) => (r.said && r.said.answer === 'recovered' ? t('analysis.rc.youSaid', { muscle: mName(r) }) : mName(r));
  // Section title above the card (home uses caps titles only: three type sizes plus the page title).
  return [
    sectionHeader(t('analysis.rc.title'), { info: 'recovery', trail: tag(t('analysis.rc.estimate')) }),
    el('div', { class: 'card wk-rc-card' },
      el('div', { class: 'wk-map-row' },
        map,
        legend()),
      chips.length ? el('div', { class: 'wk-mchips' }, chips) : null,
      !anyRecent && !active.length
        ? el('p', { class: 't-sub muted wk-rc-rested' }, t('analysis.rc.allRecovered'))
        : recovered.length ? el('p', { class: 't-sub wk-rc-rested' },
          dot('fresh'),
          el('span', el('span', { class: 'strong' }, statusLabel('fresh')), ' ', el('span', { class: 'muted' }, recovered.map(recName).join(' · ')))) : null,
      detail),
  ];
}

/** Map legend: Recovering · Likely ready · Recovered. */
function legend() {
  return el('ul', { class: 'legend wk-map-legend' },
    el('li', el('span', { class: 'swatch is-recovering' }), statusLabel('recovering')),
    el('li', el('span', { class: 'swatch is-ready' }), statusLabel('likely-ready')),
    el('li', el('span', { class: 'swatch' }), statusLabel('fresh')));
}

/** Pace ids; labels analysis.rc.pace.<id>, screen-reader text analysis.rc.paceAria.<id>. */
const PACES = ['faster', 'average', 'slower'];

export async function mountRecovery(container) {
  ensureRcCss();
  const now = Date.now();
  const [workouts, exMap, weights, loaded] = await Promise.all([
    loadRecentWorkouts(now), loadExercises(), db.getSetting('volume'), loadRecoverySetting(),
  ]);
  let checkins = loaded.checkins;
  const setting = recoverySettings(loaded);
  append(container, pageHeader({ title: t('analysis.rc.title'), subtitle: t('analysis.rc.estimate'), back: 'workout', info: 'recovery' }));

  const map = bodyMap({ view: 'both', title: t('analysis.rc.mapTitle') });
  map.classList.add('wk-rc-map');
  const listHost = el('div', { class: 'list' });
  const rangesHost = el('div', { class: 'list' });
  const historyHost = el('div', { class: 'rc-history' });
  const resetAllBtn = el('button', { type: 'button', class: 'btn btn-ghost btn-block', onClick: () => resetAll() }, t('analysis.rc.resetAll'));
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
      console.error(err); toast(t('analysis.saveFailed', { error: err && err.message }), { type: 'error' });
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
    if (f.source === 'yours') return t('analysis.rc.srcYours', { count: l.points });
    if (l && l.learned) return t('analysis.rc.srcAvailable', { source: sourceLabel(f.source) });
    return l && l.points ? t('analysis.rc.srcProgress', { source: sourceLabel(f.source), n: Math.min(l.points, l.needPoints), count: l.needPoints })
      : sourceLabel(f.source);
  }

  function rangeRow(m) {
    const f = inForce(m.id);
    return el('button', {
      type: 'button', class: 'list-item', onClick: () => editRange(m),
      'aria-label': t('analysis.rc.rangeAria', { muscle: muscleName(m.id), min: f.range[0], max: f.range[1], source: sourceText(f).replace(/ · /g, t('analysis.listSep')) }),
    },
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, muscleName(m.id)), el('div', { class: 'li-sub rc-src-sub' }, sourceText(f))),
    el('span', { class: 'li-trail' }, `${f.range[0]}–${f.range[1]} h`),
    icon('chevron-right', { class: 'li-chevron' }));
  }

  function editRange(m) {
    const f = inForce(m.id);
    const l = f.learned;
    const def = RECOVERY_CONFIG.base[m.id];
    const lo = numberInput({ value: f.range[0], min: 0, max: 999, integer: true, ariaLabel: t('analysis.rc.shortestAria', { muscle: muscleName(m.id) }) });
    const hi = numberInput({ value: f.range[1], min: 0, max: 999, integer: true, ariaLabel: t('analysis.rc.longestAria', { muscle: muscleName(m.id) }) });
    const err = el('p', { class: 'field-error', role: 'alert', hidden: true });
    const offer = l && l.learned && f.source !== 'yours';
    const sh = openSheet({
      title: t('analysis.rc.sheetTitle', { muscle: muscleName(m.id) }),
      content: [
        el('p', { class: 't-sub muted rc-src-line' }, t('analysis.rc.inUse', { min: f.range[0], max: f.range[1], source: sourceInline(f.source) })),
        offer ? el('div', { class: 'rc-offer' },
          el('div', { class: 'grow' },
            el('div', null, t('analysis.rc.yoursRange', { min: l.range[0], max: l.range[1] })),
            el('div', { class: 't-sub muted' }, t('analysis.rc.fromCheckins', { count: l.points }))),
          el('button', {
            type: 'button', class: 'btn btn-sm', onClick: async () => {
              sh.close();
              await replaceSetting(withRule(withBase(setting, m.id, null), m.id, false));
              toast(t('analysis.rc.toastYours', { muscle: muscleName(m.id), min: l.range[0], max: l.range[1] }), { type: 'success' });
            },
          }, t('analysis.rc.use'))) : null,
        !l || !l.learned ? el('p', { class: 't-sub muted rc-src-line' }, progressText(l)) : null,
        el('div', { class: 'grid-2' }, field(t('analysis.rc.shortest'), lo, { unit: 'h' }), field(t('analysis.rc.longest'), hi, { unit: 'h' })),
        el('div', { class: 'wk-hint-row' },
          el('p', { class: 'field-hint' }, t('analysis.rc.editHint', { count: RECOVERY_CONFIG.referenceDose, min: def[0], max: def[1] })),
          infoButton('recovery-math')),
        err,
      ],
    });
    append(sh.footer,
      f.source !== 'rule' ? el('button', {
        type: 'button', class: 'btn', onClick: async () => {
          sh.close();
          await replaceSetting(withRule(withBase(setting, m.id, null), m.id, !!(l && l.learned)));
          toast(t('analysis.rc.toastRule', { muscle: muscleName(m.id), min: def[0], max: def[1] }));
        },
      }, t('analysis.rc.resetOne')) : el('button', { type: 'button', class: 'btn', onClick: () => sh.close() }, t('analysis.rc.cancel')),
      el('button', {
        type: 'button', class: 'btn btn-primary', onClick: async () => {
          const v = validateRange(lo.getNumber(), hi.getNumber());
          if (!v.ok) { err.textContent = t(`analysis.rc.err.${v.error}`, v.params); err.hidden = false; return; }
          sh.close();
          const same = (r) => r && v.value[0] === r[0] && v.value[1] === r[1];
          if (f.source !== 'set' && same(f.range)) return; // nothing changed
          if (same(def) && !(l && l.learned)) await setRange(m.id, null);
          else await setRange(m.id, v.value);
          toast(t('analysis.rc.toastSaved', { muscle: muscleName(m.id), min: v.value[0], max: v.value[1] }), { type: 'success' });
        },
      }, t('analysis.rc.save')));
  }

  async function resetAll() {
    const ok = await confirmAction({
      title: t('analysis.rc.resetAllTitle'), message: t('analysis.rc.resetAllMessage'), confirmLabel: t('analysis.rc.resetAllConfirm'),
    });
    if (!ok) return;
    const rule = MUSCLES.map((m) => m.id).filter((id) => learned[id] && learned[id].learned);
    await replaceSetting(recoverySettings({ pace: setting.pace, rule }));
    toast(t('analysis.rc.resetAllDone'));
  }

  // ---------------------------------------------------------------- history
  const filterSel = el('select', {
    class: 'select rc-filter', 'aria-label': t('analysis.rc.filterAria'),
    onChange: () => { filter = filterSel.value; shown = 30; paintHistory(); },
  });

  function paintHistory() {
    const muscles = MUSCLES.filter((m) => checkins.some((c) => c.muscle === m.id));
    if (filter && !muscles.some((m) => m.id === filter)) filter = '';
    replaceChildren(filterSel,
      el('option', { value: '', selected: !filter }, t('analysis.rc.allMuscles')),
      muscles.map((m) => el('option', { value: m.id, selected: filter === m.id }, muscleName(m.id))));
    if (!checkins.length) {
      replaceChildren(historyHost, el('p', { class: 't-sub muted rc-empty' }, t('analysis.rc.noCheckins')));
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
      }, t('analysis.rc.showMore', { n: Math.min(100, list.length - shown) })) : null);
  }

  function historyRow(c) {
    const day = t('analysis.rc.dayTime', { date: dayMonth(new Date(c.at), { year: new Date(c.at).getFullYear() !== new Date().getFullYear() }), time: fmtTime(c.at) });
    return el('li', { class: 'list-item rc-ck-row' },
      el('span', { class: ['rc-mark', c.answer === 'sore' ? 'is-sore' : 'is-rec'], 'aria-hidden': 'true' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, `${muscleName(c.muscle)} · ${answerInline(c.answer)}`),
        el('div', { class: 'li-sub' }, t('analysis.rc.histSub', { day, hours: fmtNum(c.hours, 0), sets: sets(c.sets ?? c.dose) }))),
      iconButton('trash-2', {
        label: t('analysis.rc.deleteAria', { muscle: muscleName(c.muscle), answer: answerInline(c.answer), day }),
        onClick: async () => {
          const list = await updateCheckins((cur) => removeCheckin(cur, c.id));
          if (!list) return;
          onCheckins(list);
          checkinToast(t('analysis.rc.deleted'), {
            action: {
              label: t('analysis.rc.undo'),
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
    ariaLabel: t('analysis.rc.paceAria'),
    value: setting.pace,
    options: PACES.map((id) => ({ value: id, label: t(`analysis.rc.pace.${id}`), ariaLabel: t(`analysis.rc.paceOptionAria.${id}`, { factor: RECOVERY_CONFIG.paces[id] }) })),
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
        legend())),
    el('section', { class: 'section' }, sectionHeader(t('analysis.rc.yourPace')), pace,
      el('p', { class: 'field-hint wk-pad-x' }, t('analysis.rc.paceHint'))),
    el('section', { class: 'section' }, sectionHeader(t('analysis.rc.allMusclesTitle')), el('div', { class: 'card card-flush' }, listHost)),
    el('section', { class: 'section' },
      sectionHeader(t('analysis.rc.rangesTitle'), { info: 'recovery-yours' }),
      el('p', { class: 'field-hint wk-pad-x' }, t('analysis.rc.rangesHint', { count: RECOVERY_CONFIG.referenceDose })),
      el('div', { class: 'card card-flush' }, rangesHost), resetAllBtn),
    el('section', { class: 'section' }, sectionHeader(t('analysis.rc.checkins'), { info: 'recovery-yours' }), historyHost),
    assumptions());
}

/** '3 of 5 check-ins' or what is still missing. */
function progressText(l) {
  if (!l) return t('analysis.rc.progress', { n: 0, count: CHECKIN_CONFIG.minPoints });
  if (l.points < l.needPoints) return t('analysis.rc.progress', { n: l.points, count: l.needPoints });
  if (l.bouts < l.needBouts) return t('analysis.rc.progressBouts', { n: l.bouts, count: l.needBouts });
  return t(l.sore ? 'analysis.rc.needRecovered' : 'analysis.rc.needSore');
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
    'aria-label': t('analysis.rc.chartAria', {
      muscle: muscleName(muscle), sets: RECOVERY_CONFIG.referenceDose, rec, sore: all.length - rec, min: f.range[0], max: f.range[1],
    }),
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
      el('li', el('span', { class: 'rc-mark is-rec' }), answerLabel('recovered')),
      el('li', el('span', { class: 'rc-mark is-sore' }), answerLabel('sore')),
      el('li', el('span', { class: 'rc-swatch-band' }), t('analysis.rc.chartInUse', { min: f.range[0], max: f.range[1] }))),
    el('p', { class: 'field-hint' }, t('analysis.rc.chartHint', { count: RECOVERY_CONFIG.referenceDose })));
}

/** One muscle on the detail screen: status, bar, window; tapping opens the check-in sheet. */
function detailRow(r, now, onChange) {
  const state = r.trained ? MAP_STATE[r.status] : null;
  if (!r.trained) {
    return el('div', { class: 'list-item wk-rc-item' },
      muscleIcon(r.muscle, { state: 'neutral' }),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, mName(r)),
        el('div', { class: 'li-sub' }, t('analysis.rc.notTrainedCap', { count: RECOVERY_CONFIG.lookbackDays }))));
  }
  const band = (r.minHours / r.maxHours) * 100;
  const carried = r.dose - r.lastDose;
  const row = el('button', {
    type: 'button', class: 'list-item wk-rc-item', 'aria-label': ariaText(r, now), 'aria-haspopup': 'dialog',
    onClick: () => openCheckin(r, { onChange }),
  },
  muscleIcon(r.muscle, { state }),
  el('div', { class: 'li-main' },
    el('div', { class: 'wk-rc-head' }, el('span', { class: 'li-title' }, mName(r)), statusLine(r)),
    el('span', { class: 'wk-rc-bar', 'aria-hidden': 'true' },
      el('span', { class: 'wk-rc-band', style: { left: `${band}%` } }),
      el('span', { class: ['wk-rc-fill', `is-${state}`], style: { width: `${r.progress}%` } }),
      el('span', { class: 'wk-rc-min', style: { left: `${band}%` } })),
    el('div', { class: 'li-sub wk-rc-sub' }, el('span', { class: 'wk-rc-words' }, stateText(r))),
    el('div', { class: 'li-sub' },
      `${r.minHours}–${r.maxHours} h`, yoursMark(r),
      ` · ${carried > 0.004 ? t('analysis.rc.detailCarried', { sets: sets(r.dose), carried: fmtNum(carried, 2), last: lastLine(r) })
        : t('analysis.rc.detail', { sets: sets(r.dose), last: lastLine(r) })}`)));
  return el('div', { class: 'wk-rc-group' },
    row,
    r.sessions.length ? el('ul', { class: 'wk-rc-sessions' }, r.sessions.map((s) => el('li', null,
      el('a', {
        class: 'wk-rc-slink',
        href: href(s.finished ? `workout/history/${encodeURIComponent(s.workoutId)}` : `workout/session/${encodeURIComponent(s.workoutId)}`),
      },
      el('span', { class: 'wk-rc-sname' }, s.finished ? workoutTitle(s) : t('analysis.rc.inProgressName', { name: workoutTitle(s) })),
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
    groups.get(k).push(muscleName(m.id));
  }
  return el('details', { class: 'card wk-rc-assume' },
    el('summary', { class: 'wk-details-sum' }, el('span', { class: 'grow' }, t('analysis.rc.howTitle')), icon('chevron-down', { class: 'wk-summary-chev' })),
    el('div', { class: 'wk-rc-table', role: 'table', 'aria-label': t('analysis.rc.tableAria', { count: cfg.referenceDose }) },
      el('div', { class: 'wk-rc-trow is-head', role: 'row' },
        el('span', { role: 'columnheader' }, t('analysis.rc.musclesCol')), el('span', { role: 'columnheader' }, t('analysis.rc.ruleCol', { count: cfg.referenceDose }))),
      [...groups].map(([k, names]) => el('div', { class: 'wk-rc-trow', role: 'row' },
        el('span', { role: 'cell' }, names.join(t('analysis.nameSep'))), el('span', { role: 'cell' }, `${k} h`)))));
}
