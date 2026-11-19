// Sub-navigation of the Workout tab: Train · Analysis · History. Shown only on the three top-level
// workout screens (routes workout, workout/analysis, workout/history); deep screens keep their back
// button and a running session shows neither.
import { el, href } from '../ui/index.js';

const ITEMS = [['train', 'workout', 'Train'], ['analysis', 'workout/analysis', 'Analysis'], ['history', 'workout/history', 'History']];

/** @param {'train'|'analysis'|'history'} current */
export function workoutNav(current) {
  return el('nav', { class: 'tabs wk-subnav', 'aria-label': 'Workout sections' },
    ITEMS.map(([key, path, label]) => el('a', {
      href: href(path),
      class: key === current ? 'is-active' : null,
      'aria-current': key === current ? 'page' : null,
      // Tapping the current section does nothing (no duplicate history entry).
      onClick: key === current ? (e) => e.preventDefault() : null,
    }, label)));
}
