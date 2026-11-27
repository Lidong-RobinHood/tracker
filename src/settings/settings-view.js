// Settings home: grouped rows (goal and targets, set weighting, backup, storage, help, about) and the
// set weighting screen. Goal and targets live in goal-view.js. Routes: settings, settings/sets.
import { el, pageHeader, numberInput, toast, confirmDialog, fmtNum, fmtGrouped, fmtSigned, fmtBytes, fmtError, href, icon, sectionHeader, infoButton, joinSentences } from '../ui/index.js';
import * as db from '../db/db.js';
import { today } from '../core/dates.js';
import { APP_VERSION } from '../version.js';
import { exportAgeDays } from '../core/backup-reminder.js';
import { t, LANGUAGES, LANGUAGE_CHOICES, SETTING_KEY, getLanguageChoice, setLanguage } from '../i18n/index.js';
import { backupState, markExported, noteRestored } from '../onboarding/backup.js';
import { onUpdateState, checkForUpdate, applyUpdate } from '../onboarding/update.js';
import { ensureCss } from './css.js';

export { goalRateControl } from './goal-view.js';

/** Store name → catalogue key of its label in the import summary. */
const STORE_LABEL_KEYS = {
  foods: 'settings.store.foods', diary: 'settings.store.diary', meals: 'settings.store.meals',
  exercises: 'settings.store.exercises', routines: 'settings.store.routines', workouts: 'settings.store.workouts',
  weights: 'settings.store.weights', settings: 'settings.store.settings', targetHistory: 'settings.store.targetHistory',
};

/** Run when the view is left (update-state subscription). */
const cleanups = [];

/** @param {HTMLElement} container */
export async function mountSettings(container) {
  ensureCss();
  container.classList.add('settings-view');
  const [targets, volume, goal] = await Promise.all([db.getSetting('targets'), db.getSetting('volume'), db.getSetting('goal')]);
  const rate = goal.rateKgPerWeek;
  container.append(
    pageHeader({ title: t('settings.title') }),
    backupReminderCard(),
    group(t('settings.section.goalTraining'), null,
      linkRow(href('settings/goal'), 'target', t('settings.goal.title'), [
        rate ? t('common.kgPerWeek', { value: fmtSigned(rate, 2) }) : t('settings.goal.maintain'),
        `${fmtGrouped(targets.kcal)} kcal`,
        t(targets.source === 'adaptive' ? 'settings.goal.sourceAdaptive' : 'settings.goal.sourceManual'),
      ].join(' · ')),
      linkRow(href('settings/sets'), 'sliders-horizontal', t('settings.sets.title'), t('settings.sets.summary', {
        direct: fmtNum(volume.primary, 2), partial: fmtNum(volume.secondary, 2), dropset: fmtNum(volume.dropset, 2) })),
      linkRow('#/workout/targets', 'barbell', t('settings.row.weeklyTargets'), null),
      linkRow('#/food/photo-settings', 'camera', t('settings.row.mealPhotos'), t('settings.row.mealPhotosSub'))),
    dataSection(),
    generalSection(),
    group(t('settings.section.help'), null,
      linkRow(href('help'), 'circle-question-mark', t('settings.row.help'), t('settings.row.helpSub'))),
    aboutSection(),
  );
  return () => { for (const fn of cleanups.splice(0)) fn(); };
}

/** Caps section title (+ ⓘ) above a card that holds rows edge to edge. */
function group(title, info, ...rows) {
  return el('section', { class: 'section' }, sectionHeader(title, { info: info || undefined }),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list set-list' }, rows)));
}

function rowParts(iconName, title, sub, trail) {
  return [
    el('span', { class: 'li-lead' }, icon(iconName)),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, title), sub ? el('div', { class: 'li-sub' }, sub) : null),
    trail || null,
  ];
}
function linkRow(hrefValue, iconName, title, sub) {
  return el('a', { class: 'list-item', href: hrefValue }, rowParts(iconName, title, sub, icon('chevron-right', { class: 'li-chevron' })));
}

// ---------------------------------------------------------------- set weighting

/** Route: settings/sets */
export async function mountSets(container) {
  ensureCss();
  container.classList.add('settings-view');
  const volume = await db.getSetting('volume');
  const LABEL = { primary: t('settings.sets.direct'), secondary: t('settings.sets.partial'), dropset: t('settings.sets.dropset') };
  const ERROR = { primary: 'settings.sets.errorDirect', secondary: 'settings.sets.errorPartial', dropset: 'settings.sets.errorDropset' };
  const inputs = {
    primary: numberInput({ value: volume.primary, min: 0, max: 5, ariaLabel: t('settings.sets.directAria') }),
    secondary: numberInput({ value: volume.secondary, min: 0, max: 5, ariaLabel: t('settings.sets.partialAria') }),
    dropset: numberInput({ value: volume.dropset, min: 0, max: 5, ariaLabel: t('settings.sets.dropsetAria') }),
  };
  const save = async () => {
    const v = {};
    for (const [k, input] of Object.entries(inputs)) {
      v[k] = input.getNumber();
      if (v[k] === null) { input.focus(); toast(t(ERROR[k]), { type: 'error' }); return; }
    }
    await db.setSetting('volume', v);
    toast(t('settings.sets.saved'), { type: 'success' });
  };
  const row = (k) => {
    inputs[k].id = `set-w-${k}`;
    return el('div', { class: 'set-row' },
      el('label', { class: 'set-row-label', htmlFor: inputs[k].id }, LABEL[k]),
      el('div', { class: 'input-unit set-in' }, el('span', { class: 'set-times', 'aria-hidden': 'true' }, '×'), inputs[k]));
  };
  container.append(
    pageHeader({ title: t('settings.sets.title'), back: 'settings', info: 'sets' }),
    el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' }, row('primary'), row('secondary'), row('dropset'))),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, t('settings.sets.save')));
}

// ---------------------------------------------------------------- export / import backup

/**
 * Download every store as one JSON file and record the export time (settings.meta.lastExportAt) for
 * the backup reminder. Also used by the reminder banner. @returns {Promise<boolean>} success
 */
export async function exportBackup() {
  try {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: `tracker-export-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await markExported(data.exportedAt);
    const n = Object.values(data.stores).reduce((s, r) => s + r.length, 0);
    toast(t('settings.export.done', { count: n, n: fmtGrouped(n) }), { type: 'success', duration: 5000 });
    window.dispatchEvent(new CustomEvent('tracker:exported'));
    return true;
  } catch (err) {
    console.error(err);
    toast(t('settings.export.failed', { error: fmtError(err) }), { type: 'error' });
    return false;
  }
}

/**
 * Validate, show counts, confirm, replace, reload. Also used by the first-run setup ("Restore a backup").
 * @param {object} data parsed export file
 * @param {{reloadTo?: string}} [opts] route to open after the reload (default: stay)
 */
export async function importFlow(data, { reloadTo } = {}) {
  const v = db.validateImport(data);
  if (!v.ok) { toast(t('settings.import.failed', { error: v.error }), { type: 'error', duration: 5000 }); return false; }
  const rows = Object.entries(v.counts).map(([s, n]) =>
    el('div', { class: 'list-item set-count' }, el('span', { class: 'li-main' }, STORE_LABEL_KEYS[s] ? t(STORE_LABEL_KEYS[s]) : s), el('span', { class: 'li-trail' }, fmtGrouped(n))));
  const message = el('div', { class: 'stack' },
    el('p', { class: 't-sub muted' }, t('settings.import.contains')),
    el('div', { class: 'list' }, rows),
    v.ignored.length ? el('p', { class: 't-sub muted' }, t('settings.import.ignored', { parts: v.ignored.join(', ') })) : null,
    el('p', el('strong', t('settings.import.replacesStrong')), ' ', t('settings.import.exportFirst')));
  const ok = await confirmDialog({ title: t('settings.import.confirmTitle'), message, confirmLabel: t('settings.import.confirm'), danger: true });
  if (!ok) return false;
  try {
    await db.importAll(v.data);
    // The device now holds exactly the file's data: counts as backed up; asks to keep the data.
    await noteRestored(data).catch((err) => console.error(err));
    toast(t('settings.import.done'), { type: 'success' });
    if (reloadTo) history.replaceState(null, '', `#/${reloadTo}`);
    location.reload();
    return true;
  } catch (err) {
    console.error(err);
    toast(t('settings.import.failedUnchanged', { error: fmtError(err) }), { type: 'error', duration: 6000 });
    return false;
  }
}

// ---------------------------------------------------------------- data: backup, import, storage

function dataSection() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const lastLine = el('div', { class: 'li-sub', 'aria-live': 'polite' }, t('settings.data.lastExportPending'));
  const refreshLast = async () => {
    const meta = await db.getSetting('meta');
    const days = exportAgeDays(meta.lastExportAt, Date.now());
    lastLine.textContent = days === null ? t('settings.data.lastExportNever')
      : days === 0 ? t('settings.data.lastExportToday')
        : days === 1 ? t('settings.data.lastExportYesterday')
          : t('settings.data.lastExportDays', { count: days });
  };
  const doExport = async () => { if (await exportBackup()) refreshLast(); };
  refreshLast();

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      toast(t('settings.import.notJson'), { type: 'error' });
      return;
    }
    // importFlow shows its own messages; anything unexpected still gets the translated "Import failed" (the
    // input was cleared above, so the same file can be picked again)
    try {
      await importFlow(data);
    } catch (err) {
      console.error(err);
      toast(t('settings.import.failed', { error: fmtError(err) }), { type: 'error', duration: 5000 });
    }
  });

  const exportRow = el('button', { class: 'list-item', type: 'button', onClick: doExport },
    el('span', { class: 'li-lead' }, icon('download')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, t('common.exportBackup')), lastLine));
  const importRow = el('button', { class: 'list-item', type: 'button', onClick: () => fileInput.click() },
    rowParts('upload', t('common.importBackup'), t('settings.data.importSub')));
  return el('section', { class: 'section' }, sectionHeader(t('settings.section.data'), { info: 'backup' }),
    el('p', { class: 't-sub muted set-section-note' }, t('settings.data.note')),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list set-list' },
      exportRow, importRow,
      linkRow(href('import'), 'file-text', t('settings.data.otherApps'), t('settings.data.otherAppsSub')),
      storageRow())),
    fileInput);
}

/** Storage protection in few words; "Protect" asks the browser to keep the data. */
function storageRow() {
  const sub = el('div', { class: 'li-sub set-wrap', 'aria-live': 'polite' }, t('common.checking'));
  const btn = el('button', { class: 'btn btn-sm', type: 'button', hidden: true, 'aria-label': t('settings.storage.protectLabel') }, t('settings.storage.protect'));
  const refresh = async () => {
    const s = await db.storageStatus();
    const persist = s.persisted === null ? t('settings.storage.unknown')
      : s.persisted ? t('settings.storage.protected')
        : t('settings.storage.notProtected');
    sub.textContent = s.usage !== null ? joinSentences([persist, t('settings.storage.used', { size: fmtBytes(s.usage).replace(' ', '\u00a0') })]) : persist;
    btn.hidden = s.persisted !== false;
  };
  btn.addEventListener('click', async () => {
    const r = await db.requestPersist();
    toast(r ? t('settings.storage.nowPersistent') : t('settings.storage.declined'));
    refresh();
  });
  refresh();
  return el('div', { class: 'list-item' },
    el('span', { class: 'li-lead' }, icon('shield')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title set-title-info' }, t('settings.storage.title'), infoButton('storage')), sub),
    btn);
}

// ---------------------------------------------------------------- general: language

/**
 * Language picker (Automatic, English, Deutsch, 中文). A change is stored in localStorage (read at boot)
 * and in settings key 'language' (so backups carry it), then the app reloads in the new language.
 */
function generalSection() {
  const id = 'set-language';
  const current = getLanguageChoice();
  const select = el('select', { class: 'select', id },
    LANGUAGE_CHOICES.map((c) => el('option', { value: c, selected: c === current },
      c === 'auto' ? t('settings.language.auto') : LANGUAGES.find((l) => l.code === c).name)));
  select.addEventListener('change', async () => {
    const choice = select.value;
    select.disabled = true;
    try {
      await setLanguage(choice);
      await db.setSetting(SETTING_KEY, choice);
    } catch (err) {
      console.error('Language change failed', err);
    }
    location.reload();
  });
  return group(t('settings.section.general'), null,
    el('div', { class: 'list-item set-lang' },
      el('span', { class: 'li-lead' }, icon('globe')),
      el('div', { class: 'li-main' }, el('label', { class: 'li-title', htmlFor: id }, t('settings.language.label'))),
      select));
}

// ---------------------------------------------------------------- about

function aboutSection() {
  return group(t('settings.section.about'), null,
    el('div', { class: 'list-item' }, rowParts('info', t('settings.about.version'), null, el('span', { class: 'li-trail muted' }, APP_VERSION))),
    updateRow(),
    el('div', { class: 'list-item' }, rowParts('save', t('settings.about.schema'), null, el('span', { class: 'li-trail muted' }, String(db.DB_VERSION)))),
    linkRow(href('licences'), 'book-open', t('settings.about.licences'), null));
}

// ---------------------------------------------------------------- backup reminder, update check

/** Quiet card at the top when the last export is 14+ days old (the snooze only hides the banner). */
function backupReminderCard() {
  const card = el('section', { class: 'card set-backup-card', hidden: true, 'aria-live': 'polite' });
  const refresh = async () => {
    const st = await backupState('settings');
    if (!st.due) { card.hidden = true; return; }
    card.replaceChildren(
      el('div', { class: 'set-backup-head' }, icon('triangle-exclamation-point', { class: 'set-warn-ic' }),
        el('div', null, el('h2', { class: 'card-title' }, t('settings.backup.title')),
          el('p', { class: 't-sub muted' }, st.never ? t('settings.backup.never') : t('settings.backup.days', { count: st.daysSince })))),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: async () => { if (await exportBackup()) refresh(); } }, icon('download', { size: 18 }), t('common.exportBackup')));
    card.hidden = false;
  };
  refresh();
  return card;
}

/** "Check for update" row; turns into an Update button when a new version is deployed. */
function updateRow() {
  const status = el('div', { class: 'li-sub', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn btn-sm set-update-btn', type: 'button' }, t('settings.update.check'));
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'apply') applyUpdate();
    else checkForUpdate();
  });
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    btn.dataset.mode = apply ? 'apply' : 'check';
    btn.className = apply ? 'btn btn-sm set-update-btn btn-primary' : 'btn btn-sm set-update-btn';
    btn.textContent = apply ? t('common.update') : t('settings.update.check');
    btn.disabled = st.status === 'checking';
    status.textContent = st.status === 'available' ? t('settings.update.available', { version: st.deployed })
      : st.status === 'current' ? t('settings.update.current')
        : st.status === 'offline' ? t('settings.update.offline')
          : st.status === 'checking' ? t('common.checking') : '';
    status.hidden = !status.textContent;
  });
  cleanups.push(off);
  return el('div', { class: 'list-item' },
    el('span', { class: 'li-lead' }, icon('refresh-cw')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, t('settings.update.title')), status), btn);
}
