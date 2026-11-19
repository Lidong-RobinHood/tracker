// Settings home: grouped rows (goal and targets, set weighting, backup, storage, help, about) and the
// set weighting screen. Goal and targets live in goal-view.js. Routes: settings, settings/sets.
import { el, pageHeader, numberInput, toast, confirmDialog, fmtNum, fmtGrouped, fmtBytes, href, icon, sectionHeader, infoButton } from '../ui/index.js';
import * as db from '../db/db.js';
import { today } from '../core/dates.js';
import { APP_VERSION } from '../version.js';
import { signedRateText } from '../core/goal-display.js';
import { lastExportText } from '../core/backup-reminder.js';
import { backupState, markExported, noteRestored } from '../onboarding/backup.js';
import { onUpdateState, checkForUpdate, applyUpdate } from '../onboarding/update.js';
import { ensureCss } from './css.js';

export { goalRateControl } from './goal-view.js';

const STORE_LABELS = {
  foods: 'Foods', diary: 'Diary entries', meals: 'Saved meals', exercises: 'Exercises', routines: 'Routines',
  workouts: 'Workouts', weights: 'Body weights', settings: 'Settings', targetHistory: 'Target history',
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
    pageHeader({ title: 'Settings' }),
    backupReminderCard(),
    group('Goal and training', null,
      linkRow(href('settings/goal'), 'target', 'Goal and targets',
        `${rate ? signedRateText(rate) : 'Maintain'} · ${fmtGrouped(targets.kcal)} kcal · ${targets.source === 'adaptive' ? 'adaptive' : 'manual'}`),
      linkRow(href('settings/sets'), 'sliders-horizontal', 'Set weighting',
        `Direct × ${fmtNum(volume.primary, 2)} · partial × ${fmtNum(volume.secondary, 2)} · dropset × ${fmtNum(volume.dropset, 2)}`),
      linkRow('#/workout/targets', 'barbell', 'Weekly set targets', null),
      linkRow('#/food/photo-settings', 'camera', 'Meal photos', 'Your API key and model')),
    dataSection(),
    group('Help', null,
      linkRow(href('help'), 'circle-question-mark', 'Help and setup', 'Install, backup, how it works')),
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
  const LABEL = { primary: 'Direct', secondary: 'Partial', dropset: 'Dropset' };
  const inputs = {
    primary: numberInput({ value: volume.primary, min: 0, max: 5, ariaLabel: 'Direct muscle factor' }),
    secondary: numberInput({ value: volume.secondary, min: 0, max: 5, ariaLabel: 'Partial muscle factor' }),
    dropset: numberInput({ value: volume.dropset, min: 0, max: 5, ariaLabel: 'Dropset factor' }),
  };
  const save = async () => {
    const v = {};
    for (const [k, input] of Object.entries(inputs)) {
      v[k] = input.getNumber();
      if (v[k] === null) { input.focus(); toast(`Enter a number from 0 to 5 for ${LABEL[k].toLowerCase()}.`, { type: 'error' }); return; }
    }
    await db.setSetting('volume', v);
    toast('Set weighting saved', { type: 'success' });
  };
  const row = (k) => {
    inputs[k].id = `set-w-${k}`;
    return el('div', { class: 'set-row' },
      el('label', { class: 'set-row-label', htmlFor: inputs[k].id }, LABEL[k]),
      el('div', { class: 'input-unit set-in' }, el('span', { class: 'set-times', 'aria-hidden': 'true' }, '×'), inputs[k]));
  };
  container.append(
    pageHeader({ title: 'Set weighting', back: 'settings', info: 'sets' }),
    el('div', { class: 'card set-card' }, el('div', { class: 'set-rows' }, row('primary'), row('secondary'), row('dropset'))),
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: save }, 'Save weighting'));
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
    toast(`Exported ${n} records. Keep the file off this phone.`, { type: 'success', duration: 5000 });
    window.dispatchEvent(new CustomEvent('tracker:exported'));
    return true;
  } catch (err) {
    console.error(err);
    toast(`Export failed: ${err.message}`, { type: 'error' });
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
  if (!v.ok) { toast(`Import failed: ${v.error}`, { type: 'error', duration: 5000 }); return false; }
  const rows = Object.entries(v.counts).map(([s, n]) =>
    el('div', { class: 'list-item set-count' }, el('span', { class: 'li-main' }, STORE_LABELS[s] || s), el('span', { class: 'li-trail' }, fmtGrouped(n))));
  const message = el('div', { class: 'stack' },
    el('p', { class: 't-sub muted' }, 'This file contains:'),
    el('div', { class: 'list' }, rows),
    v.ignored.length ? el('p', { class: 't-sub muted' }, `Ignored unknown parts: ${v.ignored.join(', ')}`) : null,
    el('p', el('strong', 'Replaces all data on this device.'), ' Export first if unsure.'));
  const ok = await confirmDialog({ title: 'Import backup?', message, confirmLabel: 'Replace all data', danger: true });
  if (!ok) return false;
  try {
    await db.importAll(v.data);
    // The device now holds exactly the file's data: counts as backed up; asks to keep the data.
    await noteRestored(data).catch((err) => console.error(err));
    toast('Import complete', { type: 'success' });
    if (reloadTo) history.replaceState(null, '', `#/${reloadTo}`);
    location.reload();
    return true;
  } catch (err) {
    console.error(err);
    toast(`Import failed, nothing was changed: ${err.message}`, { type: 'error', duration: 6000 });
    return false;
  }
}

// ---------------------------------------------------------------- data: backup, import, storage

function dataSection() {
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const lastLine = el('div', { class: 'li-sub', 'aria-live': 'polite' }, 'Last export: …');
  const refreshLast = async () => {
    const meta = await db.getSetting('meta');
    lastLine.textContent = `Last export: ${lastExportText(meta.lastExportAt, Date.now())}`;
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
      toast('That file is not valid JSON.', { type: 'error' });
      return;
    }
    await importFlow(data);
  });

  const exportRow = el('button', { class: 'list-item', type: 'button', onClick: doExport },
    el('span', { class: 'li-lead' }, icon('download')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Export backup'), lastLine));
  const importRow = el('button', { class: 'list-item', type: 'button', onClick: () => fileInput.click() },
    rowParts('upload', 'Import backup', 'Replaces all data on this device'));
  return el('section', { class: 'section' }, sectionHeader('Data', { info: 'backup' }),
    el('p', { class: 't-sub muted set-section-note' }, 'Data lives only on this device. Export regularly and keep the file elsewhere.'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list set-list' },
      exportRow, importRow,
      linkRow(href('import'), 'file-text', 'Import from other apps', 'Workouts, body weight, food diary'),
      storageRow())),
    fileInput);
}

/** Storage protection in few words; "Protect" asks the browser to keep the data. */
function storageRow() {
  const sub = el('div', { class: 'li-sub set-wrap', 'aria-live': 'polite' }, 'Checking…');
  const btn = el('button', { class: 'btn btn-sm', type: 'button', hidden: true, 'aria-label': 'Ask the browser to keep the data' }, 'Protect');
  const refresh = async () => {
    const s = await db.storageStatus();
    const persist = s.persisted === null ? 'Protection unknown. Keep backups.'
      : s.persisted ? 'Protected from automatic deletion.'
        : 'Not protected: may be deleted when storage is low.';
    sub.textContent = `${persist}${s.usage !== null ? ` ${fmtBytes(s.usage)} used.` : ''}`;
    btn.hidden = s.persisted !== false;
  };
  btn.addEventListener('click', async () => {
    const r = await db.requestPersist();
    toast(r ? 'Storage is now persistent' : 'Declined. Installing the app usually helps.');
    refresh();
  });
  refresh();
  return el('div', { class: 'list-item' },
    el('span', { class: 'li-lead' }, icon('shield')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title set-title-info' }, 'Storage', infoButton('storage')), sub),
    btn);
}

// ---------------------------------------------------------------- about

function aboutSection() {
  return group('About', null,
    el('div', { class: 'list-item' }, rowParts('info', 'Version', null, el('span', { class: 'li-trail muted' }, APP_VERSION))),
    updateRow(),
    el('div', { class: 'list-item' }, rowParts('save', 'Data schema', null, el('span', { class: 'li-trail muted' }, String(db.DB_VERSION)))),
    linkRow(href('licences'), 'book-open', 'Licences and data sources', null));
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
        el('div', null, el('h2', { class: 'card-title' }, 'Time for a backup'),
          el('p', { class: 't-sub muted' }, st.never ? 'No backup yet. Clearing browser data deletes everything.' : `Last backup ${st.daysSince} days ago.`))),
      el('button', { class: 'btn btn-primary btn-block', type: 'button', onClick: async () => { if (await exportBackup()) refresh(); } }, icon('download', { size: 18 }), 'Export backup'));
    card.hidden = false;
  };
  refresh();
  return card;
}

/** "Check for update" row; turns into an Update button when a new version is deployed. */
function updateRow() {
  const status = el('div', { class: 'li-sub', 'aria-live': 'polite' });
  const btn = el('button', { class: 'btn btn-sm set-update-btn', type: 'button' }, 'Check for update');
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'apply') applyUpdate();
    else checkForUpdate();
  });
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    btn.dataset.mode = apply ? 'apply' : 'check';
    btn.className = apply ? 'btn btn-sm set-update-btn btn-primary' : 'btn btn-sm set-update-btn';
    btn.textContent = apply ? 'Update' : 'Check for update';
    btn.disabled = st.status === 'checking';
    status.textContent = st.status === 'available' ? `Version ${st.deployed} available`
      : st.status === 'current' ? 'Up to date'
        : st.status === 'offline' ? 'Offline, cannot check'
          : st.status === 'checking' ? 'Checking…' : '';
    status.hidden = !status.textContent;
  });
  cleanups.push(off);
  return el('div', { class: 'list-item' },
    el('span', { class: 'li-lead' }, icon('refresh-cw')),
    el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, 'Updates'), status), btn);
}
