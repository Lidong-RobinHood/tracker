// Sub-navigation of the Workout tab: Train · Analysis · History. Shown only on the three top-level
// workout screens (routes workout, workout/analysis, workout/history); deep screens keep their back
// button and a running session shows neither. Shared segmented control; tapping the current section
// does nothing (no duplicate history entry).
import { segmented, navigate } from '../ui/index.js';

const ITEMS = [['train', 'workout', 'Train'], ['analysis', 'workout/analysis', 'Analysis'], ['history', 'workout/history', 'History']];

/** @param {'train'|'analysis'|'history'} current */
export function workoutNav(current) {
  const seg = segmented({
    options: ITEMS.map(([value, , label]) => ({ value, label })),
    value: current,
    ariaLabel: 'Workout sections',
    onChange: (v) => {
      const item = ITEMS.find(([key]) => key === v);
      if (item) navigate(item[1]);
    },
  });
  seg.classList.add('wk-subnav');
  return seg;
}
