// API key + model choice for meal-photo analysis.
// The key lives in localStorage ONLY: IndexedDB is part of the export/backup file, the key must never be.
// Never log the key, never put it in a URL, never render it after saving (use maskKey()).
import { DEFAULT_PHOTO_MODEL, isPhotoModel } from '../core/meal-photo.js';

const KEY_STORAGE = 'tracker.food.photo.apiKey';
const MODEL_STORAGE = 'tracker.food.photo.model';

/** @returns {string} the stored key or '' */
export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
/** @returns {boolean} true if stored */
export function setApiKey(key) {
  try { localStorage.setItem(KEY_STORAGE, String(key).trim()); return true; } catch { return false; }
}
export function deleteApiKey() {
  try { localStorage.removeItem(KEY_STORAGE); } catch { /* storage blocked */ }
}
export const hasApiKey = () => getApiKey() !== '';

/** @returns {string} model id */
export function getPhotoModel() {
  let m = null;
  try { m = localStorage.getItem(MODEL_STORAGE); } catch { /* storage blocked */ }
  return isPhotoModel(m) ? m : DEFAULT_PHOTO_MODEL;
}
export function setPhotoModel(id) {
  if (!isPhotoModel(id)) return;
  try { localStorage.setItem(MODEL_STORAGE, id); } catch { /* storage blocked */ }
}
