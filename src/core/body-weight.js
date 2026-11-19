// Plausible body-weight range, shared by the weight screen, the optional setup, the body-weight import
// and the trend maths, so a value accepted in one place is never rejected or ignored in another.

/** Lowest accepted body weight in kg (inclusive). */
export const MIN_KG = 30;
/** Highest accepted body weight in kg (inclusive). */
export const MAX_KG = 300;

/** @param {unknown} kg @returns {boolean} a finite number within MIN_KG–MAX_KG */
export function isPlausibleKg(kg) {
  return typeof kg === 'number' && Number.isFinite(kg) && kg >= MIN_KG && kg <= MAX_KG;
}
