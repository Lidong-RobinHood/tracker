// Meal-photo network layer for every provider. Interface:
//   analyseMealPhoto(imageBlob, { provider, apiKey, model, hint, signal, baseUrl?, useSchema? })
//     → { ok: true, items, note, dropped, model } | { ok: false, kind, key, params, retry, detail? }
//   Error texts are catalogue keys (namespace food): show them with photoErrorText(r).
//   testApiKey({ provider, apiKey, model, baseUrl?, signal }) → { ok: true, checkedModel } | error
//   loadModels({ provider, apiKey, baseUrl?, signal }) → { ok: true, models: [{id, label}] } | error
// Exactly one HTTP request per call: never retries on its own (each request may be billed).
// The key goes only into the provider's auth header – never into a URL, a log line or an error text.
import { parsePhotoAnswer, photoError, redactSecrets } from '../core/meal-photo.js';
import { getAdapter, authHeader, networkError, DEFAULT_PROVIDER } from '../core/photo-providers.js';
import { t } from '../i18n/index.js';
import { blobToBase64 } from './photo-image.js';
import { missingText } from './widgets.js';
import { fmtGrouped } from '../ui/index.js';

/** Provider name for texts ('Anthropic', or the translated "Custom service"). */
export const providerName = (a) => (a.nameKey ? t(a.nameKey) : a.name);

/** Text of an error result ({key, params} from photoError); `{p}` falls back to "the API provider". */
export function photoErrorText(r) {
  if (!r) return '';
  if (!r.key) return r.message || '';
  const params = r.params || {};
  const p = params.p || t('food.photoError.theProvider');
  return t(r.key, { ...params, p, ...(params.reasonKey ? { reason: t(params.reasonKey) } : {}) });
}

/**
 * Text of a review warning / fix ({key, params}; nutrient id lists translated, numbers grouped). Plain strings
 * (from a review draft saved by an older version) are shown as they are.
 */
export function photoMsgText(m) {
  if (typeof m === 'string') return m;
  if (!m || !m.key) return '';
  const params = {};
  for (const [k, v] of Object.entries(m.params || {})) {
    params[k] = Array.isArray(v) ? missingText(v) : typeof v === 'number' ? fmtGrouped(v, 1) : v;
  }
  return t(m.key, params);
}

const FETCH_OPTS = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', mode: 'cors' };

function failure(err, signal, provider, ctx) {
  if ((signal && signal.aborted) || (err && err.name === 'AbortError')) return photoError('cancelled');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return photoError('offline');
  return networkError(provider, ctx);
}

async function jsonOrNull(res) {
  try { return await res.json(); } catch { return null; }
}

/** Remove the key from anything that came back from the provider. */
function scrub(r, apiKey) {
  if (r && r.detail) return { ...r, detail: redactSecrets(r.detail, apiKey) };
  return r;
}

/**
 * One request. Returns { ok: true, data } or an error result.
 * @param {string} provider @param {{url: string, headers: object, body?: object}} req
 */
async function call(provider, req, { apiKey, signal, ctx }) {
  const a = getAdapter(provider);
  let res;
  try {
    res = await fetch(req.url, {
      method: req.body ? 'POST' : 'GET',
      headers: { ...req.headers, ...authHeader(provider, apiKey) },
      ...(req.body ? { body: JSON.stringify(req.body) } : {}),
      signal,
      ...FETCH_OPTS,
    });
  } catch (err) {
    return failure(err, signal, provider, ctx);
  }
  if (!res.ok) return scrub(a.classifyError(res.status, await jsonOrNull(res), ctx), apiKey);
  const data = await jsonOrNull(res);
  if (data === null) return photoError(signal && signal.aborted ? 'cancelled' : 'unusable', '', { provider: a.name });
  return { ok: true, data };
}

const ctxOf = (o) => ({ baseUrl: o.baseUrl || '' });

/** Analyse a (downscaled) meal photo with the chosen provider. Never throws. */
export async function analyseMealPhoto(imageBlob, opts = {}) {
  const provider = opts.provider || DEFAULT_PROVIDER;
  const a = getAdapter(provider);
  const { apiKey, signal } = opts;
  if (!apiKey) return photoError('no_key');
  let imageBase64;
  try {
    imageBase64 = await blobToBase64(imageBlob);
  } catch (err) {
    if (signal && signal.aborted) return photoError('cancelled');
    return photoError('unusable', '', { key: 'food.photoError.prepareUpload' });
  }
  let req;
  try {
    req = a.buildAnalyse({ model: opts.model, hint: opts.hint, mediaType: imageBlob.type || 'image/jpeg', imageBase64, baseUrl: opts.baseUrl, useSchema: opts.useSchema });
  } catch (err) {
    return settingsError(err);
  }
  try {
    const r = await call(provider, req, { apiKey, signal, ctx: ctxOf(opts) });
    if (!r.ok) return r;
    const text = scrub(a.parseAnswer(r.data, ctxOf(opts)), apiKey);
    if (!text.ok) return text;
    const parsed = parsePhotoAnswer(text.text);
    return parsed.ok ? { ...parsed, model: text.model } : parsed;
  } catch (err) {
    if (signal && signal.aborted) return photoError('cancelled');
    return photoError('unusable', '', { provider: a.name });
  }
}

/** Settings incomplete (e.g. no valid custom base URL): the builder's error, as a settings error. */
function settingsError(err) {
  return photoError('bad_request', '', { key: 'food.photoError.settings', params: { reasonKey: (err && err.key) || 'food.photoError.settingsIncomplete' } });
}

/** Build a request; an invalid custom base URL becomes a settings error instead of a throw. */
function build(fn) {
  try { return { ok: true, req: fn() }; } catch (err) {
    return settingsError(err);
  }
}

function customNotFound(r, opts) {
  if (opts.provider === 'custom' && r.kind === 'model') return { ...r, key: 'food.photoError.noModelList' };
  return r;
}

/** Free check that a key works (model lookup or model list – no tokens are used). Never throws. */
export async function testApiKey(opts = {}) {
  const provider = opts.provider || DEFAULT_PROVIDER;
  if (!opts.apiKey) return photoError('no_key');
  const b = build(() => getAdapter(provider).buildTest({ model: opts.model, baseUrl: opts.baseUrl }));
  if (!b.ok) return b;
  try {
    const r = await call(provider, b.req, { apiKey: opts.apiKey, signal: opts.signal, ctx: ctxOf(opts) });
    if (!r.ok) return customNotFound(r, { provider });
    return { ok: true, checkedModel: provider === 'anthropic' || provider === 'gemini' };
  } catch (err) {
    return failure(err, opts.signal, provider, ctxOf(opts));
  }
}

/** List the provider's models (filtered to image-capable ones where the API says so). Never throws. */
export async function loadModels(opts = {}) {
  const provider = opts.provider || DEFAULT_PROVIDER;
  const a = getAdapter(provider);
  if (!opts.apiKey) return photoError('no_key');
  const b = build(() => a.buildModels({ baseUrl: opts.baseUrl }));
  if (!b.ok) return b;
  try {
    const r = await call(provider, b.req, { apiKey: opts.apiKey, signal: opts.signal, ctx: ctxOf(opts) });
    if (!r.ok) return customNotFound(r, { provider });
    return { ok: true, models: a.parseModels(r.data) };
  } catch (err) {
    return failure(err, opts.signal, provider, ctxOf(opts));
  }
}
