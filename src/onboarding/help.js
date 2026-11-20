// Help (#/help): short reference, one collapsible section per topic. Written from what the code does;
// update it when a feature changes.
import * as db from '../db/db.js';
import { el, pageHeader, href, icon } from '../ui/index.js';
import { infoSheet } from '../ui/info-sheets.js';
import { lastExportText } from '../core/backup-reminder.js';
import { APP_VERSION } from '../version.js';
import { currentPlatform, installGuide } from './install.js';
import { onUpdateState, checkForUpdate, applyUpdate } from './update.js';
import { ensureCss } from './shell.js';

const a = (path, text) => el('a', { href: href(path) }, text);
const p = (...c) => el('p', null, ...c);
const ul = (...items) => el('ul', null, items.map((i) => el('li', null, i)));
const b = (t) => el('strong', null, t);
/** The paragraphs of an info sheet, so Help and the ⓘ buttons say the same thing in the same words. */
const sheet = (id) => (infoSheet(id) || { paragraphs: [] }).paragraphs.map((x) => p(x));

function topic(id, iconName, title, ...body) {
  return el('details', { id: `help-${id}` },
    el('summary', null, el('span', { class: 'li-lead' }, icon(iconName)), el('span', { class: 'ob-help-title' }, title), icon('chevron-down', { class: 'ob-help-chev' })),
    el('div', { class: 'ob-help-body' }, body));
}

export async function mountHelp(container, params, ctx) {
  ensureCss();
  container.classList.add('ob-view');
  const [meta, storage] = await Promise.all([db.getSetting('meta'), db.storageStatus()]);
  const plat = currentPlatform();

  // Same words as Settings › Storage.
  const storageLine = storage.persisted === true ? 'Protected from automatic deletion.'
    : storage.persisted === false ? 'Not protected: may be deleted when storage is low.'
      : 'Protection unknown. Keep backups.';

  const updStatus = el('span', { class: 't-sub muted', 'aria-live': 'polite' });
  const updBtn = el('button', { type: 'button', class: 'btn btn-sm' }, 'Check for update');
  updBtn.addEventListener('click', () => (updBtn.dataset.mode === 'apply' ? applyUpdate() : checkForUpdate()));
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    updBtn.dataset.mode = apply ? 'apply' : 'check';
    updBtn.className = apply ? 'btn btn-sm btn-primary' : 'btn btn-sm';
    updBtn.textContent = apply ? 'Update' : 'Check for update';
    updBtn.disabled = st.status === 'checking';
    updStatus.textContent = apply ? `Version ${st.deployed} available` : st.status === 'current' ? 'Up to date'
      : st.status === 'offline' ? 'Offline, cannot check' : st.status === 'checking' ? 'Checking…' : '';
  });

  const topics = el('div', { class: 'card card-flush ob-help' },
    topic('install', 'smartphone', 'Install on your home screen',
      installGuide(plat, { compact: true }),
      p('iPhone and iPad: the installed app has separate data. Entered data in Safari already? Export it there (Settings › Data) and import the file in the installed app.')),

    topic('data', 'shield', 'Your data, backups, new phone',
      ul('Only on this device; no account, cloud or sync.',
        'Clearing site data or deleting the app deletes it.',
        [a('settings', 'Settings'), ' › Data › Export backup; keep the file elsewhere.'],
        'New phone: export, then Import backup there. It replaces everything.',
        'API keys are not in the backup.'),
      p(b('This device: '), `last export ${lastExportText(meta.lastExportAt, Date.now())}. ${storageLine}`)),

    topic('import', 'upload', 'Bring data from other tools',
      p(a('import', 'Settings › Import from other apps'), ': a workout sheet, body weights or a food diary.'),
      p('A Tracker backup is restored with Settings › Data › Import backup.')),

    topic('food', 'utensils', 'Logging food',
      p('In the ', a('diary', 'Diary'), ', tap “Add to …” under a meal. Five tabs:'),
      ul([b('Search'), ': your foods, then generic foods, then Open Food Facts (labelled by source).'],
        [b('Scan'), ': barcode with the camera. A product that is not found opens the food editor with the barcode filled in.'],
        [b('Recent'), ': foods you logged before.'],
        [b('Meals'), ': saved meals. Save one from a diary meal’s menu (Save as meal).'],
        [b('Quick add'), ': calories and macros without a food.']),
      p('The amount starts at what you logged last time. “Edit values” corrects a food; your values are never overwritten.'),
      p(b('Meal photo: '), 'Quick add › Scan meal photo sends the photo to an AI service with your own API key (',
        a('food/photo-settings', 'Settings › Meal photos'), '). The result is an estimate: check it before logging.')),

    topic('workout', 'barbell', 'Logging a workout',
      p('On ', a('workout', 'Workout'), ', start a routine, an empty workout, or “Log a past workout”. Create routines under ', a('workout/routines', 'Routines'), '.'),
      ul(['Set rows are pre-filled from the last session, so an unchanged set is one tap on done.'],
        ['Tap the target (e.g. 3 × 6) to change sets, reps, a rep range and a target weight.'],
        ['Tap a set number for its menu: make it a dropset or a normal set, duplicate, delete. Add dropset adds one at the end.'],
        ['After applying a weight suggestion, you can make the new weight the target.'],
        ['Everything saves as you type; an unfinished workout waits on the Workout tab.'],
        ['The workout menu changes the date and time, also after finishing, and saves the workout as a routine.']),
      ...sheet('progression')),

    topic('splits', 'repeat', 'Splits',
      ul([a('workout/splits', 'Splits'), ': ready-made weekly plans by days, style, level and equipment.'],
        ['Follow creates one routine per session; you can edit them like your own.'],
        ['Next up on the Workout tab runs the sessions in order.'],
        ['Stop following keeps the routines.'])),

    topic('sets', 'activity', 'Direct and partial sets',
      p(infoSheet('sets').paragraphs[0]),
      p('Change the factors in ', a('settings/sets', 'Settings › Set weighting'), ' and set targets per muscle under ', a('workout/targets', 'Weekly set targets'), '. With a target, a row shows done / target.'),
      p('Dropsets never count for weight suggestions.')),

    topic('recovery', 'heart-pulse', 'Recovery estimates',
      p(a('workout/recovery', 'Muscle recovery'), ' shows per muscle whether it is recovering, likely ready or recovered.'),
      ...sheet('recovery')),

    topic('adaptive', 'flame', 'Calorie targets and the check-in',
      ...sheet('expenditure'),
      ...sheet('checkin'),
      p('Details: ', a('trends/expenditure', 'Trends › Expenditure'), '.')),

    topic('reports', 'file-chart-column', 'Weekly reports',
      p(a('trends/weeks', 'Weekly reports'), ': each Monday–Sunday week with nutrition, body weight, training (sets, tonnage, sets per muscle), the week before and that week’s check-in.')),

    topic('tutorials', 'circle-play', 'Exercise tutorials',
      p('An exercise’s page in the ', a('workout/exercises', 'exercise library'), ' links to a YouTube video, or a search. Paste your own link under Details. During a workout: the exercise menu › Watch tutorial. Videos open on YouTube.')),

    topic('not', 'info', 'What the app does not do',
      ul('No account, no sync between devices, no automatic cloud backup.',
        'No connection to Apple Health, Google Fit or wearables.',
        'No reminders or notifications.',
        'Metric units only; no micronutrients beyond sugars, saturated fat, fibre and salt.',
        'No medical advice. Calorie, expenditure and recovery figures are estimates. Not a medical device.')),

    topic('licences', 'book-open', 'Licences and data sources',
      p(a('licences', 'Sources, licences and how the numbers are calculated'), '.')),

    topic('version', 'refresh-cw', 'App version and updates',
      p(`Version ${APP_VERSION}. Updates appear as a banner at the top and keep your data.`),
      el('div', { class: 'row-between' }, updStatus, updBtn)),

    topic('setup', 'target', 'Setup guide',
      p('Install, profile, goal, targets, import. Every step can be skipped.'),
      el('a', { class: 'btn btn-block', href: href('welcome') }, 'Open the setup')));

  container.append(pageHeader({ title: 'Help', back: 'settings' }), topics);
  // #/help?topic=data opens that section.
  const open = ctx && ctx.query && ctx.query.topic ? topics.querySelector(`#help-${CSS.escape(ctx.query.topic)}`) : null;
  if (open) { open.open = true; open.scrollIntoView(); }
  return () => off();
}
