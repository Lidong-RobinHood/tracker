// Help (#/help): short reference, one collapsible section per topic. Written from what the code does;
// update it when a feature changes.
import * as db from '../db/db.js';
import { el, pageHeader, href } from '../ui/index.js';
import { lastExportText } from '../core/backup-reminder.js';
import { APP_VERSION } from '../version.js';
import { currentPlatform, installGuide } from './install.js';
import { onUpdateState, checkForUpdate, applyUpdate } from './update.js';
import { ensureCss } from './shell.js';

const a = (path, text) => el('a', { href: href(path) }, text);
const p = (...c) => el('p', null, ...c);
const ul = (...items) => el('ul', null, items.map((i) => el('li', null, i)));
const b = (t) => el('strong', null, t);

function topic(id, title, ...body) {
  return el('details', { id: `help-${id}` }, el('summary', null, title), el('div', { class: 'ob-help-body' }, body));
}

export async function mountHelp(container, params, ctx) {
  ensureCss();
  container.classList.add('ob-view');
  const [meta, storage] = await Promise.all([db.getSetting('meta'), db.storageStatus()]);
  const plat = currentPlatform();

  const storageLine = storage.persisted === true ? 'This browser has agreed to keep the data (it is still deleted if you clear site data or remove the app).'
    : storage.persisted === false ? 'This browser has not promised to keep the data: it may delete it when the phone runs low on space. Installing the app and keeping backups helps.'
      : 'This browser does not say whether it keeps the data.';

  const updStatus = el('span', { class: 'small muted', 'aria-live': 'polite' });
  const updBtn = el('button', { type: 'button', class: 'btn btn-sm' }, 'Check for update');
  updBtn.addEventListener('click', () => (updBtn.dataset.mode === 'apply' ? applyUpdate() : checkForUpdate()));
  const off = onUpdateState((st) => {
    const apply = st.status === 'available';
    updBtn.dataset.mode = apply ? 'apply' : 'check';
    updBtn.className = apply ? 'btn btn-sm btn-primary' : 'btn btn-sm';
    updBtn.textContent = apply ? 'Update' : 'Check for update';
    updBtn.disabled = st.status === 'checking';
    updStatus.textContent = apply ? `Version ${st.deployed} is available.` : st.status === 'current' ? 'Up to date.'
      : st.status === 'offline' ? 'Offline, cannot check.' : st.status === 'checking' ? 'Checking…' : '';
  });

  const topics = el('div', { class: 'card card-flush ob-help' },
    topic('install', 'Install on your home screen',
      installGuide(plat, { compact: true }),
      p('On iPhone and iPad the home-screen app keeps its own data, separate from Safari. If you already entered data in Safari, export it there (Settings › Backup) and import the file in the installed app.')),

    topic('data', 'Where your data is, backups, new phone',
      p('Everything is stored only in this browser on this device. There is no account, no cloud and no sync; nobody else can see your data. Clearing the browser’s site data or deleting the app deletes it.'),
      p(b('Back up: '), a('settings', 'Settings'), ' › Backup › Export JSON saves one file with all your data. Keep it somewhere other than the phone (cloud drive, e-mail to yourself). The app reminds you when the last export is two weeks old.'),
      p(b('New phone: '), 'export on the old phone, get the file onto the new one, open the app there (install it first on iPhone), then Settings › Backup › Import JSON. Importing replaces everything on that device.'),
      p('Meal-photo API keys are not in the backup file; enter them again on the new device.'),
      p(b('This device: '), `last export ${lastExportText(meta.lastExportAt, Date.now())}. ${storageLine}`)),

    topic('import', 'Bring data from other tools',
      p(a('import', 'Settings › Import data'), ' is where data from other tools comes in: a workout sheet, body weights or a food diary.'),
      p('A backup from Tracker itself is restored with Settings › Backup › Import JSON instead.')),

    topic('food', 'Logging food',
      p('In the ', a('diary', 'Diary'), ', tap “Add to …” under a meal. The add screen has five tabs:'),
      ul([b('Search'), ': your own foods first, then a built-in list of generic foods, then Open Food Facts (labelled by source).'],
        [b('Scan'), ': barcode with the camera. Foods you corrected yourself win over Open Food Facts. A product that is not found opens the food editor with the barcode filled in, so you enter it once.'],
        [b('Recent'), ': foods you logged before, by recent or most used.'],
        [b('Meals'), ': saved meals. Save one from a diary meal’s ⋯ menu (Save as meal…); logging it lets you adjust each amount.'],
        [b('Quick add'), ': calories and macros without a food.']),
      p('The amount starts at what you logged last time for that food. “Edit values” corrects a food’s name or nutrients; your values are kept and never overwritten. A diary meal’s ⋯ menu can also copy it to another day.'),
      p(b('Meal photo: '), 'in Quick add, “Scan meal photo” sends a photo to an AI service with your own API key (Anthropic, Google Gemini, OpenAI or an OpenAI-compatible service; set it up under ',
        a('food/photo-settings', 'Settings › Meal photo'), '). The photo goes straight from your phone to that provider. The result is an estimate: check and edit it before logging.')),

    topic('workout', 'Logging a workout',
      p('On ', a('workout', 'Workout'), ', start a routine, an empty workout, or “Log a past workout” (pick the day first). Create routines under ', a('workout/routines', 'Routines'), ' or save a finished workout as a routine from its ⋯ menu.'),
      ul(['Each set row is pre-filled with the weight and reps of the last session of that exercise, so an unchanged set is one tap on done.'],
        ['“+ Dropset” adds a dropset row; the set menu turns a row into a dropset or back. Dropsets do not count for progression.'],
        ['Tap the target (e.g. 3 x 6) to change sets, reps, an optional rep range (3 x 6–8) and an optional target weight.'],
        ['Progression: when the last real session had at least the target number of normal sets at its heaviest weight and every set at that weight reached the target reps, a chip suggests the next weight (that weight + the exercise’s step). Lighter warm-up or back-off sets are ignored; the starting point never triggers it. One tap applies it; nothing changes on its own. If it goes past your target weight, a second chip offers to make it the new target.'],
        ['Everything saves as you type; an unfinished workout is waiting on the Workout tab after a reload.'],
        ['The workout ⋯ menu changes its date and time (also after finishing), so a forgotten workout can be backdated.'])),

    topic('sets', 'Direct and partial sets',
      p('Weekly sets per muscle count each done normal set:'),
      ul([b('Direct'), ': the muscle is a main mover of the exercise (counts × 1 by default).'],
        [b('Partial'), ': the muscle only assists (counts × 0.5 by default).'],
        [b('Dropsets'), ': count × 0 by default.']),
      p('Change the factors under ', a('settings', 'Settings › Weekly volume weighting'), ' and set goals per muscle under ', a('workout/targets', 'Weekly set targets'), '.')),

    topic('recovery', 'Recovery estimates',
      p(a('workout/recovery', 'Muscle recovery'), ' shows per muscle whether it is recovering, likely ready or recovered, as a range of hours since the last hard training of it.'),
      p('It is a general rule of thumb (roughly 48–72 h for a hard-trained muscle; smaller muscles less, big leg muscles more), scaled by how many sets you did. It is not a measurement of your body: sleep, food, how hard the sets were, soreness and stress all change real recovery. You can set your own pace and ranges there. If a muscle still feels sore or weak, give it more time.')),

    topic('adaptive', 'Calorie targets and the weekly check-in',
      p('Until there is enough data, targets come from a formula (sex, age, height, weight, activity level). With enough data the app estimates what you really burn from your logged food and your weight trend.'),
      p('It needs, within the last 28 days, at least 8 weigh-ins and 10 fully logged days, at least 14 days since you started, and a weigh-in in the last 7 days. Today never counts; a day logged far below your usual intake is treated as incomplete.'),
      p('Every Monday the ', a('trends', 'Trends'), ' tab offers a check-in for the past week with proposed targets. Accept changes them; Keep current changes nothing. Changes are limited to 150 kcal a week and never go below a minimum (1200 / 1500 / 1350 kcal by sex, adjustable in Settings). Details: ', a('trends/expenditure', 'Expenditure & target'), '.'),
      p('The estimate is only as good as the logging: skipped big days make it too low.')),

    topic('reports', 'Weekly reports',
      p(a('trends/weeks', 'Weekly reports'), ' (also from the Diary’s “Weekly report” link) show each Monday–Sunday week: nutrition against your targets, body-weight change, training (sets, volume, sets per muscle), a comparison with the week before and that week’s check-in.')),

    topic('tutorials', 'Exercise tutorials',
      p('An exercise’s page in the ', a('workout/exercises', 'exercise library'), ' has a Tutorial card that links to a YouTube video (or a YouTube search if none is picked). You can paste your own link under Details. During a workout, the exercise’s ⋯ menu has “Watch tutorial”. Videos open on YouTube; nothing plays inside the app.')),

    topic('not', 'What the app does not do',
      ul('No account, no sync between devices, no automatic cloud backup.',
        'No connection to Apple Health, Google Fit or wearables.',
        'No reminders or notifications.',
        'Metric units only; no micronutrients beyond sugars, saturated fat, fibre and salt.',
        'No medical advice. Estimates of calories, expenditure and recovery are estimates.')),

    topic('version', 'App version and updates',
      p(`You are running version ${APP_VERSION}. The app checks for a new version when it opens and when you come back to it; when one is out, an “Update” button appears at the top. Updating keeps all your data.`),
      el('div', { class: 'row-between' }, updStatus, updBtn)),

    topic('setup', 'Setup guide',
      p('A short, optional guide: install, your profile and goal, proposed targets, and bringing old data. Every step can be skipped; it changes only what you confirm.'),
      el('a', { class: 'btn btn-block', href: href('welcome') }, 'Open the setup')));

  container.append(pageHeader({ title: 'Help', back: 'settings' }), topics);
  // #/help?topic=data opens that section.
  const open = ctx && ctx.query && ctx.query.topic ? topics.querySelector(`#help-${CSS.escape(ctx.query.topic)}`) : null;
  if (open) { open.open = true; open.scrollIntoView(); }
  return () => off();
}
