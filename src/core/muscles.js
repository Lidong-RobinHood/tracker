// Fixed muscle list. Ids are stored in exercises.primary / exercises.secondary.

// i18n-ignore-start: English source names (the 'data' catalogue is built from them); the UI shows
// muscleName() from src/i18n/names.js
/** @type {ReadonlyArray<{id: string, name: string}>} */
export const MUSCLES = Object.freeze([
  { id: 'chest', name: 'Chest' },
  { id: 'back', name: 'Back' },
  { id: 'traps', name: 'Traps' },
  { id: 'shoulders', name: 'Shoulders' },
  { id: 'biceps', name: 'Biceps' },
  { id: 'triceps', name: 'Triceps' },
  { id: 'forearms', name: 'Forearms' },
  { id: 'abs', name: 'Abs' },
  { id: 'glutes', name: 'Glutes' },
  { id: 'quads', name: 'Quads' },
  { id: 'hamstrings', name: 'Hamstrings' },
  { id: 'calves', name: 'Calves' },
].map(Object.freeze));
// i18n-ignore-end

export const MUSCLE_IDS = Object.freeze(MUSCLES.map((m) => m.id));

/** @param {string} id */
export function isMuscleId(id) {
  return MUSCLE_IDS.includes(id);
}

/** @param {string} id @returns {string} English name, or the id itself if unknown (UI: src/i18n/names.js muscleName) */
export function muscleName(id) {
  const m = MUSCLES.find((x) => x.id === id);
  return m ? m.name : id;
}
