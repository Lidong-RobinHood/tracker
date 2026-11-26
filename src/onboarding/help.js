// Help (#/help): short reference, one collapsible section per topic. Written from what the code does;
// update it when a feature changes.
import * as db from '../db/db.js';
import { el, pageHeader, href, icon } from '../ui/index.js';
import { infoSheet } from '../ui/info-sheets.js';
import { exportAgeDays } from '../core/backup-reminder.js';
import { APP_VERSION } from '../version.js';
import { t } from '../i18n/index.js';
import { currentPlatform, installGuide } from './install.js';
import { onUpdateState, checkForUpdate, applyUpdate } from './update.js';
import { ensureCss } from './shell.js';
import { rich } from './rich.js';

const a = (path, text) => el('a', { href: href(path) }, text);
const p = (...c) => el('p', null, ...c);
const ul = (...items) => el('ul', null, items.map((i) => el('li', null, i)));
const b = (text) => el('strong', null, text);
/** The paragraphs of an info sheet, so Help and the ⓘ buttons say the same thing in the same words. */
const sheet = (id) => (infoSheet(id) || { paragraphs: [] }).paragraphs.map((x) => p(x));
/** A list item: bold term, then its explanation ('Search: your foods, …'). */
const term = (key) => rich(`onboarding.help.${key}`, { term: b(t(`onboarding.help.${key}Term`)) });

function topic(id, iconName, title, ...body) {
  return el('details', { id: `help-${id}` },
    el('summary', null, el('span', { class: 'li-lead' }, icon(iconName)), el('span', { class: 'ob-help-title' }, title), icon('chevron-down', { class: 'ob-help-chev' })),
    el('div', { class: 'ob-help-body' }, body));
}

/** 'Last export: 3 days ago.' */
function lastExportLine(lastExportAt) {
  const d = exportAgeDays(lastExportAt, Date.now());
  if (d === null) return t('onboarding.help.lastExportNever');
  if (d === 0) return t('onboarding.help.lastExportToday');
  if (d === 1) return t('onboarding.help.lastExportYesterday');
  return t('onboarding.help.lastExportDays', { count: d });
}

export async function mountHelp(container, params, ctx) {
  ensureCss();
  container.classList.add('ob-view');
  const [meta, storage] = await Promise.all([db.getSetting('meta'), db.storageStatus()]);
  const plat = currentPlatform();

  // Same words as Settings › Storage.
  const storageLine = storage.persisted === true ? t('onboarding.help.storageProtected')
    : storage.persisted === false ? t('onboarding.help.storageNotProtected')
      : t('onboarding.help.storageUnknown');

  const updStatus = el('span', { class: 't-sub muted', 'aria-live': 'polite' });
  const updBtn = el('button', { type: 'button', class: 'btn btn-sm' }, t('onboarding.help.checkUpdate'));
  updBtn.addEventListener('click', () => (updBtn.dataset.mode === 'apply' ? applyUpdate() : checkForUpdate()));
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    updBtn.dataset.mode = apply ? 'apply' : 'check';
    updBtn.className = apply ? 'btn btn-sm btn-primary' : 'btn btn-sm';
    updBtn.textContent = apply ? t('common.update') : t('onboarding.help.checkUpdate');
    updBtn.disabled = st.status === 'checking';
    updStatus.textContent = apply ? t('onboarding.help.versionAvailable', { version: st.deployed }) : st.status === 'current' ? t('onboarding.help.upToDate')
      : st.status === 'offline' ? t('onboarding.help.offline') : st.status === 'checking' ? t('common.checking') : '';
  });

  const topics = el('div', { class: 'card card-flush ob-help' },
    topic('install', 'smartphone', t('onboarding.help.installTitle'),
      installGuide(plat, { compact: true }),
      p(t('onboarding.help.installIos'))),

    topic('data', 'shield', t('onboarding.help.dataTitle'),
      ul(t('onboarding.help.dataLocal'),
        t('onboarding.help.dataClearing'),
        rich('onboarding.help.dataExport', { settings: a('settings', t('onboarding.help.settingsLink')) }),
        t('onboarding.help.dataNewPhone'),
        t('onboarding.help.dataKeys')),
      p(b(t('onboarding.help.thisDevice')), ' ', lastExportLine(meta.lastExportAt), ' ', storageLine)),

    topic('import', 'upload', t('onboarding.help.importTitle'),
      p(rich('onboarding.help.importText', { link: a('import', t('onboarding.help.importLink')) })),
      p(t('onboarding.help.importBackup'))),

    topic('food', 'utensils', t('onboarding.help.foodTitle'),
      p(rich('onboarding.help.foodIntro', { diary: a('diary', t('onboarding.help.diaryLink')) })),
      ul(term('foodSearch'), term('foodScan'), term('foodRecent'), term('foodMeals'), term('foodQuick')),
      p(t('onboarding.help.foodAmount')),
      p(b(t('onboarding.help.photoTerm')), ' ', rich('onboarding.help.photoText', { link: a('food/photo-settings', t('onboarding.help.photoLink')) }))),

    topic('workout', 'barbell', t('onboarding.help.workoutTitle'),
      p(rich('onboarding.help.workoutIntro', { workout: a('workout', t('onboarding.help.workoutLink')), routines: a('workout/routines', t('onboarding.help.routinesLink')) })),
      ul(t('onboarding.help.workoutPrefill'),
        t('onboarding.help.workoutTarget'),
        t('onboarding.help.workoutSetMenu'),
        t('onboarding.help.workoutSuggestion'),
        t('onboarding.help.workoutAutosave'),
        t('onboarding.help.workoutMenu')),
      ...sheet('progression')),

    topic('splits', 'repeat', t('onboarding.help.splitsTitle'),
      ul(rich('onboarding.help.splitsLibrary', { splits: a('workout/splits', t('onboarding.help.splitsLink')) }),
        t('onboarding.help.splitsFollow'),
        t('onboarding.help.splitsNext'),
        t('onboarding.help.splitsStop'),
        t('onboarding.help.splitsNew'),
        t('onboarding.help.splitsDifferent'))),

    topic('sets', 'activity', t('onboarding.help.setsTitle'),
      p(infoSheet('sets').paragraphs[0]),
      p(rich('onboarding.help.setsChange', { weighting: a('settings/sets', t('onboarding.help.weightingLink')), targets: a('workout/targets', t('onboarding.help.targetsLink')) })),
      p(t('onboarding.help.setsDropsets'))),

    topic('recovery', 'heart-pulse', t('onboarding.help.recoveryTitle'),
      p(rich('onboarding.help.recoveryText', { link: a('workout/recovery', t('onboarding.help.recoveryLink')) })),
      ...sheet('recovery')),

    topic('adaptive', 'flame', t('onboarding.help.adaptiveTitle'),
      ...sheet('expenditure'),
      ...sheet('checkin'),
      p(rich('onboarding.help.adaptiveDetails', { link: a('trends/expenditure', t('onboarding.help.expenditureLink')) }))),

    topic('reports', 'file-chart-column', t('onboarding.help.reportsTitle'),
      p(rich('onboarding.help.reportsText', { link: a('trends/weeks', t('onboarding.help.reportsLink')) }))),

    topic('tutorials', 'circle-play', t('onboarding.help.tutorialsTitle'),
      p(rich('onboarding.help.tutorialsText', { library: a('workout/exercises', t('onboarding.help.libraryLink')) }))),

    topic('not', 'info', t('onboarding.help.notTitle'),
      ul(t('onboarding.help.notAccount'),
        t('onboarding.help.notHealth'),
        t('onboarding.help.notReminders'),
        t('onboarding.help.notUnits'),
        t('onboarding.help.notMedical'))),

    topic('licences', 'book-open', t('onboarding.help.licencesTitle'),
      p(a('licences', t('onboarding.help.licencesLink')), t('onboarding.help.licencesEnd'))),

    topic('version', 'refresh-cw', t('onboarding.help.versionTitle'),
      p(t('onboarding.help.versionText', { version: APP_VERSION })),
      el('div', { class: 'row-between' }, updStatus, updBtn)),

    topic('setup', 'target', t('onboarding.help.setupTitle'),
      p(t('onboarding.help.setupText')),
      el('a', { class: 'btn btn-block', href: href('welcome') }, t('onboarding.help.openSetup'))));

  container.append(pageHeader({ title: t('onboarding.help.title'), back: 'settings' }), topics);
  // #/help?topic=data opens that section.
  const open = ctx && ctx.query && ctx.query.topic ? topics.querySelector(`#help-${CSS.escape(ctx.query.topic)}`) : null;
  if (open) { open.open = true; open.scrollIntoView(); }
  return () => off();
}
