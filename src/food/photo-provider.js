// Meal-photo providers. Interface:
//   analyseMealPhoto(imageBlob, { apiKey, model, hint, signal, provider? })
//     → { ok: true, items, note, dropped, model } | { ok: false, kind, message, retry, detail? }
//   testApiKey({ apiKey, model, signal, provider? }) → { ok: true } | { ok: false, kind, message }
// Exactly one HTTP request per call: never retries on its own (each request may be billed).
import {
  buildPhotoRequest, buildTestRequest, classifyHttpError, extractAnswerText, parsePhotoAnswer, photoError,
} from '../core/meal-photo.js';
import { blobToBase64 } from './photo-image.js';

function failure(err, signal) {
  if ((signal && signal.aborted) || (err && err.name === 'AbortError')) return photoError('cancelled');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return photoError('offline');
  return photoError('network');
}

async function errorBody(res) {
  try { return await res.json(); } catch { return null; }
}

const anthropic = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  async analyse(imageBlob, { apiKey, model, hint, signal }) {
    if (!apiKey) return photoError('no_key');
    const req = buildPhotoRequest({ model, hint, mediaType: imageBlob.type || 'image/jpeg', imageBase64: await blobToBase64(imageBlob) });
    let res;
    try {
      res = await fetch(req.url, {
        method: 'POST',
        headers: { ...req.headers, 'x-api-key': apiKey },
        body: JSON.stringify(req.body),
        signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
      });
    } catch (err) {
      return failure(err, signal);
    }
    if (!res.ok) return classifyHttpError(res.status, await errorBody(res));
    let data;
    try { data = await res.json(); } catch (err) {
      if (signal && signal.aborted) return photoError('cancelled');
      return photoError('unusable');
    }
    const text = extractAnswerText(data);
    if (!text.ok) return text;
    const parsed = parsePhotoAnswer(text.text);
    return parsed.ok ? { ...parsed, model: text.model } : parsed;
  },
  async test({ apiKey, model, signal }) {
    if (!apiKey) return photoError('no_key');
    const req = buildTestRequest(model);
    let res;
    try {
      res = await fetch(req.url, { headers: { ...req.headers, 'x-api-key': apiKey }, signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    } catch (err) {
      return failure(err, signal);
    }
    if (!res.ok) return classifyHttpError(res.status, await errorBody(res));
    return { ok: true };
  },
};

export const PROVIDERS = Object.freeze({ anthropic });
export const DEFAULT_PROVIDER = 'anthropic';

/** Analyse a (downscaled) meal photo with the chosen provider. Never throws. */
export async function analyseMealPhoto(imageBlob, { provider = DEFAULT_PROVIDER, ...opts } = {}) {
  const p = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  try {
    return await p.analyse(imageBlob, opts);
  } catch (err) {
    if (opts.signal && opts.signal.aborted) return photoError('cancelled');
    return { ...photoError('unusable'), message: 'The photo could not be prepared for upload. Try another photo.' };
  }
}

/** Cheap/free check that a key works. Never throws. */
export async function testApiKey({ provider = DEFAULT_PROVIDER, ...opts } = {}) {
  const p = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  try {
    return await p.test(opts);
  } catch (err) {
    return failure(err, opts.signal);
  }
}
