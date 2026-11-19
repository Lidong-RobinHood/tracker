// App-level pieces of onboarding: the notice strip above every view (Update available, backup
// reminder, the optional "New here? Set up" card on the Diary, an import hint on an empty Workout tab).
// The setup itself is never opened automatically.
import * as db from '../db/db.js';
import { el, href } from '../ui/index.js';
import { showSetupCard } from '../core/setup.js';
import { backupState, snoozeBackup, updateMeta } from './backup.js';
import { startUpdateChecks, onUpdateState, applyUpdate } from './update.js';
import { exportBackup } from '../settings/settings-view.js';

export function ensureCss() {
  if (document.querySelector('link[data-onboarding-css]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./onboarding.css', import.meta.url).href, 'data-onboarding-css': '' }));
}

const routePath = () => location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '');

// ---------------------------------------------------------------- notice strip

let host = null;
let updateStatus = null;
let token = 0;

/**
 * Start update checks and the notice strip. Call once after the first render.
 * @param {Promise<ServiceWorkerRegistration|undefined>|null} regPromise
 */
export function startAppServices(regPromise) {
  ensureCss();
  const main = document.getElementById('main');
  host = el('div', { class: 'ob-notices', role: 'region', 'aria-label': 'Notices' });
  main.before(host);
  startUpdateChecks(regPromise);
  onUpdateState((st) => { if (st.status !== updateStatus) { updateStatus = st.status; refreshNotices(); } });
  window.addEventListener('hashchange', refreshNotices);
  window.addEventListener('tracker:exported', refreshNotices);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshNotices(); });
  refreshNotices();
}

async function refreshNotices() {
  if (!host) return;
  const my = ++token;
  const path = routePath();
  const notes = [];
  const quiet = path === 'welcome' || path.startsWith('workout/session/');

  if (updateStatus === 'available' && !quiet) {
    notes.push(notice('update', [el('span', { class: 'grow' }, 'A new version of the app is available.')],
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => applyUpdate() }, 'Update')));
  }
  try {
    if (path !== 'welcome') {
      const st = await backupState(path);
      if (my !== token) return;
      if (st.banner && path !== 'settings') {
        notes.push(notice('backup', [el('span', { class: 'grow' },
          st.never ? 'No backup yet. Your data exists only on this phone.' : `Last backup ${st.daysSince} days ago. Your data exists only on this phone.`)],
        el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: async () => { if (await exportBackup()) refreshNotices(); } }, 'Export'),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: async () => { await snoozeBackup(); refreshNotices(); } }, 'Later')));
      }
      const hint = await emptyHint(path, st);
      if (my !== token) return;
      if (hint) notes.push(hint);
    }
  } catch (err) {
    console.error('Notices failed', err);
  }
  if (my !== token) return;
  host.replaceChildren(...notes);
  document.documentElement.classList.toggle('has-notices', notes.length > 0);
}

function notice(kind, text, ...actions) {
  return el('div', { class: `ob-notice ob-notice-${kind}`, dataset: { notice: kind }, role: kind === 'update' ? 'status' : null },
    ...text, el('div', { class: 'ob-notice-actions' }, actions));
}

/** Optional setup card on the Diary; import hint on an empty Workout tab. Both dismissible for good. */
async function emptyHint(path, st) {
  const meta = st.meta;
  const counts = st.counts;
  if (path === '' || path === 'diary' || path.startsWith('diary/')) {
    const keys = (await db.getAll('settings')).map((s) => s.key);
    if (!showSetupCard({ meta, settingKeys: keys })) return null;
    return notice('setup', [el('span', { class: 'grow' }, el('strong', null, 'New here?'), ' Set up your targets in 2 minutes, or bring your old data.')],
      el('a', { class: 'btn btn-sm btn-primary', href: href('welcome') }, 'Set up'),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
        onClick: async () => { await updateMeta({ setupCardDismissedAt: Date.now() }); refreshNotices(); } }, 'Not now'));
  }
  if (meta.hintsDismissedAt) return null;
  const dismiss = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-label': 'Hide this hint',
    onClick: async () => { await updateMeta({ hintsDismissedAt: Date.now() }); refreshNotices(); } }, 'Hide');
  if (path === 'workout' && !counts.workouts && !counts.routines) {
    return notice('hint', [el('span', { class: 'grow' }, 'Coming from a spreadsheet? Import your workout history.')],
      el('a', { class: 'btn btn-sm', href: href('import') }, 'Import'), dismiss);
  }
  return null;
}
