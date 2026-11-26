// Provider choice, one API key per provider, model per provider, custom base URL – for meal-photo analysis.
// Keys live in localStorage ONLY: IndexedDB is part of the export/backup file, a key must never be.
// Never log a key, never put it in a URL, never render it after saving (use maskKey()).
import { isValidModelId } from '../core/meal-photo.js';
import { PROVIDER_IDS, DEFAULT_PROVIDER, isProviderId, getAdapter } from '../core/photo-providers.js';
import { validateBaseUrl } from '../core/photo-openai.js';

const P = 'tracker.food.photo.';
const PROVIDER_STORAGE = `${P}provider`;
const keyStorage = (id) => `${P}key.${id}`;
const modelStorage = (id) => `${P}model.${id}`;
const BASE_URL_STORAGE = `${P}custom.baseUrl`;
const SCHEMA_STORAGE = `${P}custom.schema`;
// Before multi-provider support: one Anthropic key + model.
const OLD_KEY_STORAGE = `${P}apiKey`;
const OLD_MODEL_STORAGE = `${P}model`;
const OLD_DEFAULT_MODEL = 'claude-fable-5-2'; // what the app used when no model had been chosen

function read(k) { try { return localStorage.getItem(k); } catch { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
function drop(k) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } }

let migrated = false;
/** Move the old single Anthropic key + model to the per-provider entries (once; never loses them). */
export function migrateOldPhotoSettings() {
  if (migrated) return;
  migrated = true;
  const oldKey = read(OLD_KEY_STORAGE);
  const oldModel = read(OLD_MODEL_STORAGE);
  if (oldKey === null && oldModel === null) return;
  let ok = true;
  if (oldKey && !read(keyStorage('anthropic'))) ok = write(keyStorage('anthropic'), oldKey) && ok;
  const model = oldModel && isValidModelId(oldModel) ? oldModel : (oldKey ? OLD_DEFAULT_MODEL : null);
  if (model && !read(modelStorage('anthropic'))) ok = write(modelStorage('anthropic'), model) && ok;
  if (!read(PROVIDER_STORAGE)) ok = write(PROVIDER_STORAGE, 'anthropic') && ok;
  // Remove the old entries only once the new ones are verifiably there.
  if (ok && (!oldKey || read(keyStorage('anthropic')))) { drop(OLD_KEY_STORAGE); drop(OLD_MODEL_STORAGE); }
}

/** @returns {string} active provider id */
export function getProvider() {
  migrateOldPhotoSettings();
  const p = read(PROVIDER_STORAGE);
  return isProviderId(p) ? p : DEFAULT_PROVIDER;
}
export function setProvider(id) { if (isProviderId(id)) write(PROVIDER_STORAGE, id); }

/** @returns {string} the stored key for a provider (default: the active one) or '' */
export function getApiKey(provider = getProvider()) {
  migrateOldPhotoSettings();
  return isProviderId(provider) ? read(keyStorage(provider)) || '' : '';
}
/** @returns {boolean} true if stored */
export function setApiKey(provider, key) {
  if (!isProviderId(provider)) return false;
  return write(keyStorage(provider), String(key).trim());
}
export function deleteApiKey(provider) { if (isProviderId(provider)) drop(keyStorage(provider)); }
export const hasApiKey = (provider = getProvider()) => getApiKey(provider) !== '';

/** @returns {string} the chosen model id, else the provider's default ('' for custom) */
export function getModel(provider = getProvider()) {
  migrateOldPhotoSettings();
  const m = read(modelStorage(provider));
  return isValidModelId(m) ? m : getAdapter(provider).defaultModel;
}
/** @returns {boolean} false if the id is not acceptable */
export function setModel(provider, id) {
  const m = String(id ?? '').trim();
  if (!isProviderId(provider) || !isValidModelId(m)) return false;
  return write(modelStorage(provider), provider === 'gemini' ? m.replace(/^models\//, '') : m);
}

/** @returns {string} the validated custom base URL or '' */
export function getBaseUrl() {
  const v = validateBaseUrl(read(BASE_URL_STORAGE) || '');
  return v.ok ? v.url : '';
}
/** @returns {{ok: true, url: string} | {ok: false, errorKey: string}} errorKey: catalogue key (namespace food) */
export function setBaseUrl(raw) {
  const v = validateBaseUrl(raw);
  if (!v.ok) return v;
  if (!write(BASE_URL_STORAGE, v.url)) return { ok: false, errorKey: 'food.photoSettings.storageBlocked' };
  return v;
}
export const getUseSchema = () => read(SCHEMA_STORAGE) === '1';
export function setUseSchema(on) { write(SCHEMA_STORAGE, on ? '1' : '0'); }

/**
 * Everything needed to call the active provider.
 * `missing`: what still has to be set up ('key' | 'model' | 'baseUrl'), or null when ready.
 */
export function activePhotoConfig() {
  const provider = getProvider();
  const cfg = { provider, apiKey: getApiKey(provider), model: getModel(provider), baseUrl: provider === 'custom' ? getBaseUrl() : '', useSchema: provider === 'custom' ? getUseSchema() : true };
  cfg.missing = provider === 'custom' && !cfg.baseUrl ? 'baseUrl' : !cfg.apiKey ? 'key' : !cfg.model ? 'model' : null;
  return cfg;
}

export { PROVIDER_IDS };
