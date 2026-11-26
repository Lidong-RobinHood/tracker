// "Next up" block of the followed split, mounted on the workout home (Train):
//
//   import { nextUpCard } from '../splits/next-up.js';
//   const card = await nextUpCard();          // HTMLElement, or null when no split is followed
//   if (card) append(container, card);
//
// Options: { onChange } runs after "Stop following" (default: the card removes itself);
// { showChange: false } hides "Change split". "Other session" lists the rotation: tap one to start it
// today, or Skip the suggested one (stored as a skip, see rotationNext in src/core/splits.js); the card
// then repaints itself in place. Works for library and custom splits.
// followingCard(): the compact "Following <split> · Stop following" block of the library screen,
// which is where the split is changed or stopped (no second Start there).
import * as db from '../db/db.js';
import { el, append, replaceChildren, icon, href, confirmDialog, toast, openSheet } from '../ui/index.js';
import { nextUp } from '../core/splits.js';
import { startWorkout } from '../workout/data.js';
import { t } from '../i18n/index.js';
import { routineName } from '../i18n/names.js';
import { loadActiveSplit, stopFollowing, ensureSplitsCss, followedName, splitPath, skipNext, unskipNext } from './store.js';

/**
 * @param {{onChange?: () => void, showChange?: boolean}} [opts]
 * @returns {Promise<HTMLElement|null>}
 */
export async function nextUpCard({ onChange, showChange = true } = {}) {
  ensureSplitsCss();
  const card = el('section', { class: 'card sp-next', 'aria-label': t('splits.next.title') });
  return (await paintNext(card, { onChange, showChange })) ? card : null;
}

/** Fill (or refill) the Next up card. @returns {Promise<boolean>} false when there is nothing to show */
async function paintNext(card, opts) {
  const { onChange, showChange } = opts;
  const active = await loadActiveSplit();
  if (!active) return false;
  const [routines, workouts] = await Promise.all([db.getAll('routines'), db.getAll('workouts')]);
  const byId = new Map(routines.map((r) => [r.id, r]));
  const next = nextUp(active, workouts, new Set(byId.keys()));
  if (!next) return false;
  const rotation = active.routineIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const routine = byId.get(next.routineId);
  const name = followedName(active);

  // dataset.routineId: the workout home leaves this routine out of its Start list
  card.dataset.routineId = routine.id;
  const stop = async () => {
    const ok = await confirmDialog({ title: t('splits.stop.title'), message: t('splits.stop.message'), confirmLabel: t('splits.stop.button') });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast(t('splits.saveFailed'), { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  const start = async (r) => { try { await startWorkout(r); } catch (err) { console.error(err); toast(t('splits.next.startFailed'), { type: 'error' }); } };
  const repaint = () => paintNext(card, opts).then((ok) => { if (!ok) card.remove(); });

  // Other session: the rotation in order (tap one to start it today) and Skip for the suggested one.
  const openOther = () => {
    const sheet = openSheet({ title: t('splits.next.sessions'), className: 'sp-other' });
    append(sheet.body, el('ol', { class: 'list sp-other-list' }, rotation.map((r, i) => el('li', null,
      el('button', {
        type: 'button', class: 'list-item', 'aria-label': t('splits.next.startAria', { name: routineName(r), i: i + 1, n: rotation.length }),
        onClick: () => { sheet.close(); start(r); },
      },
      el('span', { class: ['sp-day-n', i === next.index ? 'is-next' : null], 'aria-hidden': 'true' }, String(i + 1)),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, routineName(r)),
        i === next.index ? el('div', { class: 'li-sub' }, t('splits.next.title')) : null),
      el('span', { class: 'wk-go sp-go', 'aria-hidden': 'true' }, t('splits.next.start')))))));
    append(sheet.footer, el('button', {
      type: 'button', class: 'btn btn-secondary btn-block',
      onClick: async () => {
        try { await skipNext(); } catch (err) { console.error(err); toast(t('splits.saveFailed'), { type: 'error' }); return; }
        sheet.close();
        await repaint();
        toast(t('splits.next.skipped', { name: routineName(routine) }), { action: { label: t('splits.undo'), onClick: async () => { await unskipNext(); await repaint(); } } });
      },
    }, icon('skip-forward', { size: 18 }), t('splits.next.skip', { name: routineName(routine) })));
  };

  const n = routine.items.length;
  replaceChildren(card,
    el('div', { class: 'sp-next-top' },
      el('span', { class: 't-cap sp-cap' }, t('splits.next.title')),
      name ? el('a', { class: 'sp-next-split t-sub muted', href: href(splitPath(active.splitId)) }, name) : null),
    el('div', { class: 'sp-next-main' },
      el('div', { class: 'li-main' },
        el('div', { class: 'strong truncate' }, routineName(routine)),
        el('div', { class: 't-sub muted' }, t('splits.next.position', { count: n, i: next.index + 1, n: next.count }))),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => start(routine) }, icon('play', { size: 18 }), t('splits.next.start'))),
    el('ol', { class: 'sp-steps', 'aria-label': t('splits.rotation') },
      rotation.map((r, i) => el('li', {
        class: ['sp-step', i === next.index ? 'is-next' : null],
        title: routineName(r),
        'aria-current': i === next.index ? 'step' : null,
      }, el('span', { class: 'vh' }, routineName(r))))),
    el('div', { class: 'sp-next-links' },
      rotation.length > 1 ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'dialog', onClick: openOther }, t('splits.next.other')) : null,
      showChange ? el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/splits') }, t('splits.next.change')) : null,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, t('splits.stop.button'))));
  return true;
}

/**
 * Library screen: which split is followed, with "Stop following". Null when none is followed.
 * @param {{onChange?: () => void}} [opts] runs after "Stop following" (default: the card removes itself)
 * @returns {Promise<HTMLElement|null>}
 */
export async function followingCard({ onChange } = {}) {
  ensureSplitsCss();
  const active = await loadActiveSplit();
  const name = followedName(active);
  if (!name) return null;
  const card = el('section', { class: 'card sp-following', 'aria-label': t('splits.followedAria') });
  const stop = async () => {
    const ok = await confirmDialog({ title: t('splits.stop.title'), message: t('splits.stop.message'), confirmLabel: t('splits.stop.button') });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast(t('splits.saveFailed'), { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  append(card,
    el('a', { class: 'sp-following-main', href: href(splitPath(active.splitId)) },
      el('span', { class: 't-cap sp-cap' }, t('splits.following')),
      el('span', { class: 'li-title' }, name),
      icon('chevron-right', { class: 'li-chevron' })),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, t('splits.stop.button')));
  return card;
}
