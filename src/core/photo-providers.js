// Registry of meal-photo providers. Each adapter (src/core/photo-<name>.js) is pure:
//   buildAnalyse(opts) / buildTest(opts) / buildModels(opts) → {url, headers, body?}   (never the key)
//   parseAnswer(json, ctx) → {ok: true, text, model} | error
//   classifyError(status, body, ctx) → error           parseModels(json) → [{id, label}]
// The network layer (src/food/photo-provider.js) adds the key header from `auth`, runs exactly one fetch,
// then hands the answer text to parsePhotoAnswer() – the same sanitising and review flow for every provider.
import { anthropic } from './photo-anthropic.js';
import { gemini } from './photo-gemini.js';
import { openai, custom } from './photo-openai.js';
import { photoError } from './meal-photo.js';

export const PHOTO_PROVIDERS = Object.freeze({ anthropic, gemini, openai, custom });
export const PROVIDER_IDS = Object.freeze(['anthropic', 'gemini', 'openai', 'custom']);
export const DEFAULT_PROVIDER = 'anthropic';
export const isProviderId = (id) => PROVIDER_IDS.includes(id);
export const getAdapter = (id) => PHOTO_PROVIDERS[id] || PHOTO_PROVIDERS[DEFAULT_PROVIDER];

/**
 * Header carrying the key for a provider ({'x-api-key': key} or {authorization: 'Bearer key'}).
 * The key only ever goes into this header, never into a URL or body.
 */
export function authHeader(providerId, apiKey) {
  const a = getAdapter(providerId).auth;
  return { [a.header]: `${a.prefix}${apiKey}` };
}

/** Network failure (fetch rejected): blocked CORS requests look exactly like this in the browser. */
export function networkError(providerId, ctx = {}) {
  const a = getAdapter(providerId);
  if (a.networkMessage) return photoError('network', '', { message: a.networkMessage(ctx) });
  if (providerId === 'anthropic') return photoError('network', '', { provider: a.name });
  return photoError('network', '', {
    provider: a.name,
    message: `Could not reach ${a.name}. Check your connection and try again. If this keeps happening while other sites work, the browser may be blocked from calling ${a.name} directly.`,
  });
}
