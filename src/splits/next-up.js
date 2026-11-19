// "Next up" block of the followed split, mounted on the workout home (Train):
//
//   import { nextUpCard } from '../splits/next-up.js';
//   const card = await nextUpCard();          // HTMLElement, or null when no split is followed
//   if (card) append(container, card);
//
// Options: { onChange } runs after "Stop following" (default: the card removes itself);
// { showChange: false } hides "Change split".
// followingCard(): the compact "Following <split> · Stop following" block of the library screen,
// which is where the split is changed or stopped (no second Start there).
import * as db from '../db/db.js';
import { el, append, icon, href, confirmDialog, toast } from '../ui/index.js';
import { nextUp } from '../core/splits.js';
import { splitById } from '../data/splits.js';
import { startWorkout } from '../workout/data.js';
import { loadActiveSplit, stopFollowing, ensureSplitsCss } from './store.js';

/**
 * @param {{onChange?: () => void, showChange?: boolean}} [opts]
 * @returns {Promise<HTMLElement|null>}
 */
export async function nextUpCard({ onChange, showChange = true } = {}) {
  ensureSplitsCss();
  const active = await loadActiveSplit();
  if (!active) return null;
  const [routines, workouts] = await Promise.all([db.getAll('routines'), db.getAll('workouts')]);
  const byId = new Map(routines.map((r) => [r.id, r]));
  const next = nextUp(active, workouts, new Set(byId.keys()));
  if (!next) return null;
  const rotation = active.routineIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const routine = byId.get(next.routineId);
  const split = splitById(active.splitId);

  const card = el('section', { class: 'card sp-next', 'aria-label': 'Next up' });
  const stop = async () => {
    const ok = await confirmDialog({ title: 'Stop following?', message: 'Your routines stay.', confirmLabel: 'Stop following' });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast('Could not save.', { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  const names = routine.items.length;
  card.append(
    el('div', { class: 'sp-next-top' },
      el('span', { class: 't-cap sp-cap' }, 'Next up'),
      split ? el('a', { class: 'sp-next-split t-sub muted', href: href(`workout/splits/${encodeURIComponent(split.id)}`) }, split.name) : null),
    el('div', { class: 'sp-next-main' },
      el('div', { class: 'li-main' },
        el('div', { class: 't-head truncate' }, routine.name),
        el('div', { class: 't-sub muted' }, `${names} exercise${names === 1 ? '' : 's'} · ${next.index + 1} of ${next.count}`)),
      el('button', {
        type: 'button', class: 'btn btn-primary',
        onClick: async () => { try { await startWorkout(routine); } catch (err) { console.error(err); toast('Could not start.', { type: 'error' }); } },
      }, icon('play', { size: 18 }), 'Start')),
    el('ol', { class: 'sp-steps', 'aria-label': 'Rotation' },
      rotation.map((r, i) => el('li', {
        class: ['sp-step', i === next.index ? 'is-next' : null],
        title: r.name,
        'aria-current': i === next.index ? 'step' : null,
      }, el('span', { class: 'vh' }, r.name)))),
    el('div', { class: 'sp-next-links' },
      showChange ? el('a', { class: 'btn btn-ghost btn-sm', href: href('workout/splits') }, 'Change split') : null,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, 'Stop following')));
  return card;
}

/**
 * Library screen: which split is followed, with "Stop following". Null when none is followed.
 * @param {{onChange?: () => void}} [opts] runs after "Stop following" (default: the card removes itself)
 * @returns {Promise<HTMLElement|null>}
 */
export async function followingCard({ onChange } = {}) {
  ensureSplitsCss();
  const active = await loadActiveSplit();
  const split = active ? splitById(active.splitId) : null;
  if (!split) return null;
  const card = el('section', { class: 'card sp-following', 'aria-label': 'Followed split' });
  const stop = async () => {
    const ok = await confirmDialog({ title: 'Stop following?', message: 'Your routines stay.', confirmLabel: 'Stop following' });
    if (!ok) return;
    try { await stopFollowing(); } catch (err) { console.error(err); toast('Could not save.', { type: 'error' }); return; }
    if (onChange) onChange(); else card.remove();
  };
  append(card,
    el('a', { class: 'sp-following-main', href: href(`workout/splits/${encodeURIComponent(split.id)}`) },
      el('span', { class: 't-cap sp-cap' }, 'Following'),
      el('span', { class: 'li-title' }, split.name),
      icon('chevron-right', { class: 'li-chevron' })),
    el('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: stop }, 'Stop following'));
  return card;
}
