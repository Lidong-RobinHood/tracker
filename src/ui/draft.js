// Unfinished input that must survive a page reload (iOS reloads a home-screen app whenever the system
// evicted it). Kept in localStorage on purpose: sessionStorage is lost on eviction, and IndexedDB
// settings are part of the backup export, which drafts must not be. Never put keys or images here.

const PREFIX = 'tracker.draft.';
export const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * @param {string} name
 * @param {number} [maxAgeMs] older drafts are deleted and not returned
 * @returns {any|null} the stored value, or null (none, expired, unreadable, storage blocked)
 */
export function loadDraft(name, maxAgeMs = DRAFT_MAX_AGE_MS) {
  try {
    const raw = localStorage.getItem(PREFIX + name);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object' || typeof d.savedAt !== 'number' || !(Date.now() - d.savedAt < maxAgeMs) || Date.now() < d.savedAt - 60000) {
      localStorage.removeItem(PREFIX + name);
      return null;
    }
    return d.value;
  } catch {
    return null;
  }
}

/** Store (replace) a draft. Fails silently when storage is blocked or full. */
export function saveDraft(name, value) {
  try { localStorage.setItem(PREFIX + name, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* blocked or full */ }
}

export function clearDraft(name) {
  try { localStorage.removeItem(PREFIX + name); } catch { /* blocked */ }
}
