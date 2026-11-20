// Anthropic (Claude) adapter for meal-photo analysis. Pure: builds requests (without the key) and turns
// responses / errors into the app's result shape.
//
// Sources (checked 2026-11-18):
// - claude-api skill (bundled reference, models cached 2026-11-03): Messages API, image blocks, output_config
//   (format + effort), server-side refusal fallbacks, models + capabilities, error types.
// - https://platform.claude.com/docs/en/api/models/list   (GET /v1/models, limit 1..1000, capabilities.image_input)
// - https://platform.claude.com/docs/en/manage-claude/authentication   (browser calls need the
//   `anthropic-dangerous-direct-browser-access: true` header; orgs with zero data retention cannot call from a browser)
// - https://platform.claude.com/docs/en/about-claude/pricing   (prices: linked from the UI, not hard-coded)
// Key: `x-api-key` header (added by src/food/photo-provider.js). Never in the URL.
import {
  PHOTO_SCHEMA, SYSTEM_PROMPT, MAX_OUTPUT_TOKENS, userPrompt, photoError, errorMessageOf,
} from './meal-photo.js';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';
export const ANTHROPIC_VERSION = '2026-10-21';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
const NAME = 'Anthropic';

/** Documented suggestions (claude-api skill, 2026-11-03). Any other model id can be typed or loaded. */
export const ANTHROPIC_SUGGESTED = Object.freeze([
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '' }, // the default: the 'default' badge says so
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'fastest, lowest cost' },
]);
export const ANTHROPIC_DEFAULT_MODEL = ANTHROPIC_SUGGESTED[0].id;

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). Others are sent without it. */
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
/** Models documented to accept `output_config.effort`; for unknown ids it is left out (older models reject it). */
const EFFORT_MODELS = new Set([
  'claude-fable-5-2', 'claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8',
  'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-haiku-5-5',
]);

const browserHeaders = () => ({ 'anthropic-version': ANTHROPIC_VERSION, 'anthropic-dangerous-direct-browser-access': 'true' });

/**
 * Messages API request (without the key).
 * @param {{model: string, imageBase64: string, mediaType?: string, hint?: string}} a
 * @returns {{url: string, headers: Record<string, string>, body: object}}
 */
export function buildAnthropicRequest({ model, imageBase64, mediaType = 'image/jpeg', hint = '' }) {
  const id = model || ANTHROPIC_DEFAULT_MODEL;
  const headers = { 'content-type': 'application/json', ...browserHeaders() };
  const body = {
    model: id,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: userPrompt(hint) },
      ],
    }],
    output_config: { ...(EFFORT_MODELS.has(id) ? { effort: 'medium' } : {}), format: { type: 'json_schema', schema: PHOTO_SCHEMA } },
  };
  if (FALLBACK_MODELS.has(id)) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { url: ANTHROPIC_URL, headers, body };
}

/** "Test key": retrieve the chosen model (free; checks key + model access). */
export function buildAnthropicTest({ model }) {
  return { url: `${ANTHROPIC_MODELS_URL}/${encodeURIComponent(model || ANTHROPIC_DEFAULT_MODEL)}`, headers: browserHeaders() };
}

/** "Load models": one page of up to 1000 models (more than exist). */
export function buildAnthropicModels() {
  return { url: `${ANTHROPIC_MODELS_URL}?limit=1000`, headers: browserHeaders() };
}

/** @returns {{id: string, label: string}[]} models that accept images (capabilities.image_input), newest first */
export function parseAnthropicModels(json) {
  const list = json && Array.isArray(json.data) ? json.data : [];
  return list
    .filter((m) => m && typeof m.id === 'string' && m.lifecycle !== 'retired')
    .filter((m) => !(m.capabilities && m.capabilities.image_input && m.capabilities.image_input.supported === false))
    .map((m) => ({ id: m.id, label: typeof m.display_name === 'string' ? m.display_name : m.id }));
}

/**
 * Classify an HTTP error ({type:'error', error:{type, message}}).
 * @param {number} status @param {any} body
 */
export function classifyAnthropicError(status, body) {
  const type = body && body.error && typeof body.error.type === 'string' ? body.error.type : '';
  const msg = errorMessageOf(body);
  const o = { provider: NAME };
  if (status === 401 || type === 'authentication_error') return photoError('auth', /cors/i.test(msg) ? msg : '', o);
  if (status === 402 || type === 'billing_error' || /credit balance|billing|purchase credits/i.test(msg)) return photoError('billing', msg, o);
  if (status === 403 || type === 'permission_error') return photoError('permission', msg, o);
  if (status === 404 || type === 'not_found_error') return photoError('model', msg, o);
  if (status === 413 || type === 'request_too_large') return photoError('too_large', '', o);
  if (status === 429 || type === 'rate_limit_error') return photoError('rate_limit', '', o);
  if (status === 529 || type === 'overloaded_error') return photoError('overloaded', '', o);
  if (status >= 500) return photoError('server', msg, o);
  return photoError('bad_request', msg || `HTTP ${status}`, o);
}

/**
 * Answer text of a Messages API response, or an error for refusals / cut-off answers.
 * With server-side fallbacks, only text after the last `fallback` block belongs to the final answer.
 * @returns {{ok: true, text: string, model: string|null} | ReturnType<typeof photoError>}
 */
export function extractAnthropicText(res) {
  const o = { provider: NAME };
  if (!res || typeof res !== 'object' || !Array.isArray(res.content)) return photoError('unusable', '', o);
  if (res.stop_reason === 'refusal') return photoError('refusal', '', o);
  if (res.stop_reason === 'max_tokens') return photoError('truncated', '', o);
  let blocks = res.content;
  const lastFallback = blocks.map((b) => b && b.type).lastIndexOf('fallback');
  if (lastFallback >= 0) blocks = blocks.slice(lastFallback + 1);
  const text = blocks.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
  if (!text.trim()) return photoError('unusable', '', o);
  return { ok: true, text, model: typeof res.model === 'string' ? res.model : null };
}

/** Light format check for a pasted key (Anthropic keys start with "sk-ant-"). */
export function anthropicKeyLooksValid(key) {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(key || '').trim());
}

export const anthropic = Object.freeze({
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  name: NAME,
  auth: { header: 'x-api-key', prefix: '' },
  hosts: ['api.anthropic.com'],
  suggested: ANTHROPIC_SUGGESTED,
  defaultModel: ANTHROPIC_DEFAULT_MODEL,
  keyPlaceholder: 'sk-ant-…',
  keyHelp: 'Create one at console.anthropic.com › API keys.',
  keyLooksValid: anthropicKeyLooksValid,
  keyFormatNote: 'it does not look like an Anthropic key (sk-ant-…)',
  pricingUrl: 'https://platform.claude.com/docs/en/about-claude/pricing',
  notes: [
    'Each analysis is billed to your Anthropic account.',
    'Fable, Opus 5.5/5 and Sonnet 5.5 may fall back to another model; that run is billed too.',
  ],
  structured: true,
  buildAnalyse: buildAnthropicRequest,
  buildTest: buildAnthropicTest,
  buildModels: buildAnthropicModels,
  parseModels: parseAnthropicModels,
  parseAnswer: extractAnthropicText,
  classifyError: classifyAnthropicError,
});
