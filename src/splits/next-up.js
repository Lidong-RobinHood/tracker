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
import { loadActiveSplit, stopFollowing, ensureSplitsCss, followedName, splitPath, skipNext, unskipNext } from './store.js';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * @param {{onChange?: () => void, showChange?: boolean}} [opts]
 * @returns {Promise<HTMLElement|null>}
 */
export async function nextUpCard({ onChange, showChange = true } = {}) {
  ensureSplitsCss();
  const card = el('section', { class: 'card sp-next', 'aria-label': 'Next up' });
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
    const ok = await confirmDialog({ title: 'Stop following?', message: 'Your routines stay.', confirmLabel: 'Stop following' });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast('Could not save.', { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  const start = async (r) => { try { await startWorkout(r); } catch (err) { console.error(err); toast('Could not start.', { type: 'error' }); } };
  const repaint = () => paintNext(card, opts).then((ok) => { if (!ok) card.remove(); });

  // Other session: the rotation in order (tap one to start it today) and Skip for the suggested one.
  const openOther = () => {
    const sheet = openSheet({ title: 'Sessions', className: 'sp-other' });
    append(sheet.body, el('ol', { class: 'list sp-other-list' }, rotation.map((r, i) => el('li', null,
      el('button', {
        type: 'button', class: 'list-item', 'aria-label': `Start ${r.name} (${i + 1} of ${rotation.length})`,
        onClick: () => { sheet.close(); start(r); },
      },
      el('span', { class: ['sp-day-n', i === next.index ? 'is-next' : null], 'aria-hidden': 'true' }, String(i + 1)),
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, r.name),
        i === next.index ? el('div', { class: 'li-sub' }, 'Next up') : null),
      el('span', { class: 'wk-go sp-go', 'aria-hidden': 'true' }, 'Start'))))));
    append(sheet.footer, el('button', {
      type: 'button', class: 'btn btn-secondary btn-block',
      onClick: async () => {
        try { await skipNext(); } catch (err) { console.error(err); toast('Could not save.', { type: 'error' }); return; }
        sheet.close();
        await repaint();
        toast(`Skipped ${routine.name}`, { action: { label: 'Undo', onClick: async () => { await unskipNext(); await repaint(); } } });
      },
    }, icon('skip-forward', { size: 18 }), `Skip ${routine.name}`));
  };

  const n = routine.items.length;
  replaceChildren(card,
    el('div', { class: 'sp-next-top' },
      el('span', { class: 't-cap sp-cap' }, 'Next up'),
      name ? el('a', { class: 'sp-next-split t-sub muted', href: href(splitPath(active.splitId)) }, name) : null),
    el('div', { class: 'sp-next-main' },
      el('div', { class: 'li-main' },
        el('div', { class: 'strong truncate' }, routine.name),
        el('div', { class: 't-sub muted' }, `${plural(n, 'exercise')} · ${next.index + 1} of ${next.count}`)),
      el('button', { type: 'button', class: 'btn btn-primary', onClick: () => start(routine) }, icon('play', { size: 18 }), 'Start')),
    el('ol', { class: 'sp-steps', 'aria-label': 'Rotation' },
      rotation.map((r, i) => el('li', {
        class: ['sp-step', i === next.index ? 'is-next' : null],
        title: r.name,
        'aria-current': i === next.index ? 'step' : null,
      }, el('span', { class: 'vh' }, r.name)))),
    el('div', { class: 'sp-next-links' },
      rotation.length > 1 ? el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'dialog', onClick: openOther }, 'Other session') : null,
      showChange ? el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/splits') }, 'Change split') : null,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, 'Stop following')));
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
  const card = el('section', { class: 'card sp-following', 'aria-label': 'Followed split' });
  const stop = async () => {
    const ok = await confirmDialog({ title: 'Stop following?', message: 'Your routines stay.', confirmLabel: 'Stop following' });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast('Could not save.', { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  append(card,
    el('a', { class: 'sp-following-main', href: href(splitPath(active.splitId)) },
      el('span', { class: 't-cap sp-cap' }, 'Following'),
      el('span', { class: 'li-title' }, name),
      icon('chevron-right', { class: 'li-chevron' })),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, 'Stop following'));
  return card;
}
