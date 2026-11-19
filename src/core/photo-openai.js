// OpenAI and "OpenAI-compatible (custom)" adapters: both use the Chat Completions shape.
// Pure: builds requests (without the key) and turns responses / errors into the app's result shape.
//
// Sources (checked 2026-11-18):
// - https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
//   (POST /v1/chat/completions, Authorization: Bearer, `developer` role, image_url content parts,
//   response_format {type:'json_schema', json_schema:{name, schema, strict}}, max_completion_tokens,
//   choices[].message.content / .refusal, finish_reason stop | length | content_filter | tool_calls)
// - https://developers.openai.com/api/docs/guides/images-vision   (base64 images as data URLs
//   "data:image/jpeg;base64,…"; PNG/JPEG/WEBP/GIF)
// - https://developers.openai.com/api/docs/guides/structured-outputs   (supported schemas: root object, anyOf inside
//   properties, null via union, every key required, additionalProperties:false)
// - https://developers.openai.com/api/reference/resources/models/methods/list   (GET /v1/models → {object:'list',
//   data:[{id, created, owned_by}]}; no modality field, no pagination)
// - https://developers.openai.com/api/docs/guides/error-codes   (401, 403 region, 429 rate limit vs
//   credit_balance_exhausted / insufficient_quota / spend limits, 503 server_is_overloaded)
// - https://developers.openai.com/api/docs/models   (gpt-6.2-astra default, gpt-6.1-terra fast; all accept images)
// - https://developers.openai.com/api/docs/pricing , https://developers.openai.com/api/docs/quickstart (key page)
// CORS: OpenAI's docs do not say whether direct browser calls are allowed (not confirmed either way).
// Custom endpoints: the same Chat Completions request against `<base URL>/chat/completions`, `system` role
// (more widely accepted than `developer`), no token limit (provider caps differ), JSON schema only when the
// user enables it; otherwise the schema goes into the prompt and the tolerant parser handles the answer.
// Key: `Authorization: Bearer <key>` header only.
import {
  PHOTO_SCHEMA, MAX_OUTPUT_TOKENS, systemPromptFor, userPrompt, photoError, errorMessageOf,
} from './meal-photo.js';

export const OPENAI_BASE = 'https://api.openai.com/v1';
const NAME = 'OpenAI';

export const OPENAI_SUGGESTED = Object.freeze([
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', note: 'OpenAI’s recommended starting model' },
  { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', note: 'fast and efficient' },
]);
export const OPENAI_DEFAULT_MODEL = OPENAI_SUGGESTED[0].id;

// ------------------------------------------------------------------ custom base URL
export const BASE_URL_MAX = 300;

/**
 * Check a user-entered base URL for an OpenAI-compatible service (e.g. "https://openrouter.ai/api/v1").
 * https only, no user:password@, no query string or fragment (a key must never ride in the URL).
 * A pasted ".../chat/completions" is cut back to the base.
 * @returns {{ok: true, url: string, host: string} | {ok: false, error: string}}
 */
export function validateBaseUrl(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { ok: false, error: 'Enter the base URL of the service.' };
  if (s.length > BASE_URL_MAX) return { ok: false, error: 'The base URL is too long.' };
  if (/\s/.test(s)) return { ok: false, error: 'The base URL must not contain spaces.' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'This is not a valid URL. It should look like https://example.com/v1' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'Only https:// URLs are allowed.' };
  if (u.username || u.password || /@/.test(s.replace(/^https:\/\//i, '').split('/')[0])) return { ok: false, error: 'The URL must not contain a user name or password. Put the API key in the key field.' };
  if (u.search || s.includes('?')) return { ok: false, error: 'The URL must not contain a query string (“?…”). Put the API key in the key field, never in the URL.' };
  if (u.hash || s.includes('#')) return { ok: false, error: 'The URL must not contain “#”.' };
  if (!u.hostname || !(u.hostname.includes('.') || u.hostname === 'localhost')) return { ok: false, error: 'The URL needs a full host name, e.g. https://example.com/v1' };
  const path = u.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  return { ok: true, url: `${u.origin}${path}`, host: u.host };
}

const hostOf = (baseUrl) => { const v = validateBaseUrl(baseUrl); return v.ok ? v.host : 'the custom service'; };

// ------------------------------------------------------------------ requests
function chatBody({ model, imageBase64, mediaType, hint, schemaInRequest, systemRole, maxTokensField }) {
  const body = {
    model,
    messages: [
      { role: systemRole, content: systemPromptFor({ schemaInRequest }) },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
          { type: 'text', text: userPrompt(hint) },
        ],
      },
    ],
  };
  if (schemaInRequest) body.response_format = { type: 'json_schema', json_schema: { name: 'meal_photo_estimate', schema: PHOTO_SCHEMA, strict: true } };
  if (maxTokensField) body[maxTokensField] = MAX_OUTPUT_TOKENS;
  return body;
}

/** OpenAI Chat Completions request (without the key). */
export function buildOpenAIRequest({ model, imageBase64, mediaType = 'image/jpeg', hint = '' }) {
  return {
    url: `${OPENAI_BASE}/chat/completions`,
    headers: { 'content-type': 'application/json' },
    body: chatBody({ model: model || OPENAI_DEFAULT_MODEL, imageBase64, mediaType, hint, schemaInRequest: true, systemRole: 'developer', maxTokensField: 'max_completion_tokens' }),
  };
}

/**
 * Custom OpenAI-compatible request. Throws if the base URL is invalid (the UI validates before saving).
 * @param {{model: string, imageBase64: string, mediaType?: string, hint?: string, baseUrl: string, useSchema?: boolean}} a
 */
export function buildCustomRequest({ model, imageBase64, mediaType = 'image/jpeg', hint = '', baseUrl, useSchema = false }) {
  const v = validateBaseUrl(baseUrl);
  if (!v.ok) throw new Error(v.error);
  return {
    url: `${v.url}/chat/completions`,
    headers: { 'content-type': 'application/json' },
    body: chatBody({ model, imageBase64, mediaType, hint, schemaInRequest: !!useSchema, systemRole: 'system', maxTokensField: null }),
  };
}

export const buildOpenAIModels = () => ({ url: `${OPENAI_BASE}/models`, headers: {} });
export function buildCustomModels({ baseUrl }) {
  const v = validateBaseUrl(baseUrl);
  if (!v.ok) throw new Error(v.error);
  return { url: `${v.url}/models`, headers: {} };
}

/**
 * Models from GET /models ({data:[{id}]}). OpenAI exposes no modality field, so its list is unfiltered;
 * services that list `architecture.input_modalities` (e.g. OpenRouter) are filtered to image-capable models.
 * @returns {{id: string, label: string}[]}
 */
export function parseOpenAIModels(json) {
  const list = json && Array.isArray(json.data) ? json.data : Array.isArray(json) ? json : [];
  return list
    .filter((m) => m && typeof m.id === 'string' && m.id)
    .filter((m) => {
      const mods = m.architecture && Array.isArray(m.architecture.input_modalities) ? m.architecture.input_modalities : null;
      return !mods || mods.includes('image');
    })
    .sort((a, b) => (Number(b.created) || 0) - (Number(a.created) || 0) || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, label: typeof m.name === 'string' && m.name ? m.name : m.id }));
}

// ------------------------------------------------------------------ errors
const BILLING_CODES = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'billing_hard_limit_reached', 'billing_not_active']);

function classifyChatError(status, body, provider) {
  const e = body && typeof body.error === 'object' && body.error ? body.error : {};
  const code = typeof e.code === 'string' ? e.code : '';
  const type = typeof e.type === 'string' ? e.type : '';
  const msg = errorMessageOf(body);
  const o = { provider };
  if (status === 401 || code === 'invalid_api_key' || type === 'authentication_error') return photoError('auth', '', o);
  if (status === 402 || BILLING_CODES.has(code) || BILLING_CODES.has(type) || (/quota|credit|billing|spend limit/i.test(msg) && (status === 429 || status === 400 || status === 403))) return photoError('billing', msg, o);
  if (status === 403) return photoError('permission', msg, o);
  if (status === 404 || code === 'model_not_found') return photoError('model', msg, o);
  if (status === 413) return photoError('too_large', '', o);
  if (status === 429) return photoError('rate_limit', '', o);
  if (status === 529 || code === 'server_is_overloaded' || type === 'service_unavailable_error' || status === 503) return photoError('overloaded', '', o);
  if (status >= 500) return photoError('server', msg, o);
  if (/content[_ ]?(policy|filter|management)|safety system|moderation/i.test(msg)) return photoError('refusal', msg, o);
  return photoError('bad_request', msg || `HTTP ${status}`, o);
}

/** Classify an HTTP error ({error:{message, type, code, param}}). */
export const classifyOpenAIError = (status, body) => classifyChatError(status, body, NAME);
/** Same for custom services; tolerant of numeric `error.code` and `{message}` / `{detail}` bodies. */
export const classifyCustomError = (status, body, ctx = {}) => classifyChatError(status, body, hostOf(ctx.baseUrl));

function extractChatText(res, provider) {
  const o = { provider };
  const c = res && Array.isArray(res.choices) ? res.choices[0] : null;
  if (!c || !c.message) return photoError('unusable', '', o);
  if (typeof c.message.refusal === 'string' && c.message.refusal.trim()) return photoError('refusal', c.message.refusal, o);
  if (c.finish_reason === 'content_filter') return photoError('refusal', 'Stopped by the content filter.', o);
  if (c.finish_reason === 'length') return photoError('truncated', '', o);
  const content = c.message.content;
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter((p) => p && typeof p.text === 'string' && p.type !== 'reasoning').map((p) => p.text).join('') : '';
  if (!text.trim()) return photoError('unusable', '', o);
  return { ok: true, text, model: typeof res.model === 'string' ? res.model : null };
}

/** @returns {{ok: true, text: string, model: string|null} | ReturnType<typeof photoError>} */
export const extractOpenAIText = (res) => extractChatText(res, NAME);
export const extractCustomText = (res, ctx = {}) => extractChatText(res, hostOf(ctx.baseUrl));

// ------------------------------------------------------------------ adapters
export const openai = Object.freeze({
  id: 'openai',
  label: 'OpenAI',
  name: NAME,
  auth: { header: 'authorization', prefix: 'Bearer ' },
  hosts: ['api.openai.com'],
  suggested: OPENAI_SUGGESTED,
  defaultModel: OPENAI_DEFAULT_MODEL,
  keyPlaceholder: 'OpenAI API key',
  keyHelp: 'Create one at platform.openai.com/api-keys.',
  keyLooksValid: () => true,
  keyFormatNote: '',
  pricingUrl: 'https://developers.openai.com/api/docs/pricing',
  notes: [
    'Each analysis is billed to your OpenAI credit.',
  ],
  structured: true,
  buildAnalyse: buildOpenAIRequest,
  buildTest: buildOpenAIModels,
  buildModels: buildOpenAIModels,
  parseModels: parseOpenAIModels,
  parseAnswer: extractOpenAIText,
  classifyError: classifyOpenAIError,
});

export const custom = Object.freeze({
  id: 'custom',
  label: 'OpenAI-compatible (custom)',
  name: 'Custom service',
  auth: { header: 'authorization', prefix: 'Bearer ' },
  hosts: [],
  suggested: Object.freeze([]),
  defaultModel: '',
  keyPlaceholder: 'API key of the service',
  keyHelp: 'Create one in your service’s dashboard.',
  keyLooksValid: () => true,
  keyFormatNote: '',
  pricingUrl: '',
  notes: [
    'For OpenAI-style services with image input, e.g. OpenRouter, Groq, Mistral, Together.',
    'Billed by that service, or within its free tier.',
    'Services that block browser calls (CORS) cannot be used.',
  ],
  structured: false,
  needsBaseUrl: true,
  buildAnalyse: buildCustomRequest,
  buildTest: buildCustomModels,
  buildModels: buildCustomModels,
  parseModels: parseOpenAIModels,
  parseAnswer: extractCustomText,
  classifyError: classifyCustomError,
  networkMessage: (ctx = {}) => `Could not reach ${hostOf(ctx.baseUrl)}. Check the URL and connection; the service may block browser calls (CORS).`,
});
