// App-level pieces of onboarding: the notice strip above every view (Update available, backup
// reminder, the optional "New here? Set up" card on the Diary, an import hint on an empty Workout tab).
// The setup itself is never opened automatically.
import * as db from '../db/db.js';
import { el, href, icon, infoButton } from '../ui/index.js';
import { showSetupCard } from '../core/setup.js';
import { backupState, snoozeBackup, updateMeta } from './backup.js';
import { startUpdateChecks, onUpdateState, applyUpdate } from './update.js';
import { exportBackup } from '../settings/settings-view.js';
import { t } from '../i18n/index.js';

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
  host = el('div', { class: 'ob-notices', role: 'region', 'aria-label': t('onboarding.notices.label') });
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
    notes.push(notice('update', 'refresh-cw', [el('span', { class: 'grow' }, t('onboarding.notice.updateAvailable'))],
      el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => applyUpdate() }, t('common.update'))));
  }
  try {
    if (path !== 'welcome') {
      const st = await backupState(path);
      if (my !== token) return;
      if (st.banner && path !== 'settings') {
        notes.push(notice('backup', 'triangle-exclamation-point', [el('span', { class: 'grow' },
          st.never ? t('onboarding.notice.backupNever') : t('onboarding.notice.backupDays', { count: st.daysSince })), infoButton('backup')],
        el('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: async () => { if (await exportBackup()) refreshNotices(); } }, t('common.exportBackup')),
        el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: async () => { await snoozeBackup(); refreshNotices(); } }, t('onboarding.notice.later'))));
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

function notice(kind, iconName, text, ...actions) {
  return el('div', { class: `ob-notice ob-notice-${kind}`, dataset: { notice: kind }, role: kind === 'update' ? 'status' : null },
    el('div', { class: 'ob-notice-text' }, icon(iconName, { class: 'ob-notice-ic' }), ...text), el('div', { class: 'ob-notice-actions' }, actions));
}

/** Optional setup card on the Diary; import hint on an empty Workout tab. Both dismissible for good. */
async function emptyHint(path, st) {
  const meta = st.meta;
  const counts = st.counts;
  if (path === '' || path === 'diary' || path.startsWith('diary/')) {
    const keys = (await db.getAll('settings')).map((s) => s.key);
    if (!showSetupCard({ meta, settingKeys: keys })) return null;
    return notice('setup', 'target', [el('span', { class: 'grow' }, el('strong', null, t('onboarding.notice.setupLead')), ' ', t('onboarding.notice.setupText'))],
      el('a', { class: 'btn btn-sm btn-primary', href: href('welcome') }, t('onboarding.notice.setUp')),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost',
        onClick: async () => { await updateMeta({ setupCardDismissedAt: Date.now() }); refreshNotices(); } }, t('onboarding.notice.notNow')));
  }
  if (meta.hintsDismissedAt) return null;
  const dismiss = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', 'aria-label': t('onboarding.notice.hideHintLabel'),
    onClick: async () => { await updateMeta({ hintsDismissedAt: Date.now() }); refreshNotices(); } }, t('onboarding.notice.hide'));
  if (path === 'workout' && !counts.workouts && !counts.routines) {
    return notice('hint', 'upload', [el('span', { class: 'grow' }, t('onboarding.notice.importHint'))],
      el('a', { class: 'btn btn-sm', href: href('import') }, t('onboarding.notice.import')), dismiss);
  }
  return null;
}
