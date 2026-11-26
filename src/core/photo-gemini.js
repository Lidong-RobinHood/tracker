// Google Gemini adapter (Gemini API with a Google AI Studio key). Pure: builds requests (without the key)
// and turns responses / errors into the app's result shape.
//
// Sources (checked 2026-11-18; ai.google.dev/gemini-api/docs/* now redirects to aistudio.google.com/docs/*):
// - https://aistudio.google.com/api-reference/generate-content   (POST /v1beta/models/{model}:generateContent,
//   systemInstruction, Part.inlineData {mimeType, data}, generationConfig.responseMimeType / responseJsonSchema /
//   maxOutputTokens, candidates[].finishReason, promptFeedback.blockReason, modelVersion, thought parts)
// - https://aistudio.google.com/docs/image-understanding.md?generate-content=true   (inline image REST example,
//   x-goog-api-key header, 20 MB request limit, JPEG/PNG/WEBP/HEIC/HEIF)
// - https://aistudio.google.com/docs/structured-output.md?generate-content=true   (JSON schema subset: anyOf, enum,
//   additionalProperties, required, null types; SDKs send responseMimeType + responseJsonSchema)
// - https://aistudio.google.com/api-reference/models/list-models.md   (GET /v1beta/models, pageSize ≤ 1000,
//   supportedGenerationMethods; no field says whether a model accepts images)
// - https://aistudio.google.com/docs/api-errors.md?generate-content=true   ({error:{code, message, status, details}},
//   API_KEY_INVALID, 400 FAILED_PRECONDITION, 402/429 RESOURCE_EXHAUSTED, 403, 503 UNAVAILABLE)
// - https://aistudio.google.com/docs/api-key   (key in the `x-goog-api-key` header; Google advises against
//   client-side keys in production apps; CORS is not documented)
// - https://aistudio.google.com/docs/models   (gemini-4-hydrogen / gemini-4-carbon accept images)
// - https://aistudio.google.com/docs/pricing   (free tier: content may be used to improve Google's products)
// Google now recommends its newer Interactions API for new work; generateContent is documented as legacy but
// fully supported, and is used here because its request/response shape is stable and fully documented.
// Key: `x-goog-api-key` header only (the docs' list-models curl example uses `?key=`; we never do).
import {
  PHOTO_SCHEMA, SYSTEM_PROMPT, MAX_OUTPUT_TOKENS, userPrompt, photoError, errorMessageOf,
} from './meal-photo.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const NAME = 'Google Gemini'; // i18n-ignore (brand)

// i18n-ignore-start (model names; notes are catalogue keys)
export const GEMINI_SUGGESTED = Object.freeze([
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', noteKey: 'food.provider.note.fastEveryday' },
  { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', noteKey: 'food.provider.note.strongest' },
]);
// i18n-ignore-end
export const GEMINI_DEFAULT_MODEL = GEMINI_SUGGESTED[0].id;

/** "models/gemini-x" → "gemini-x" (the list returns resource names). */
export const geminiModelId = (m) => String(m || '').replace(/^models\//, '');
const modelPath = (model) => `${GEMINI_BASE}/models/${encodeURIComponent(geminiModelId(model) || GEMINI_DEFAULT_MODEL)}`;

/**
 * generateContent request (without the key).
 * @param {{model: string, imageBase64: string, mediaType?: string, hint?: string}} a
 */
export function buildGeminiRequest({ model, imageBase64, mediaType = 'image/jpeg', hint = '' }) {
  return {
    url: `${modelPath(model)}:generateContent`,
    headers: { 'content-type': 'application/json' },
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType: mediaType, data: imageBase64 } },
          { text: userPrompt(hint) },
        ],
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema: PHOTO_SCHEMA,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    },
  };
}

/** "Test key": get the chosen model (free). */
export function buildGeminiTest({ model }) {
  return { url: modelPath(model), headers: {} };
}

/** "Load models": one page of up to 1000 (the documented maximum). */
export function buildGeminiModels() {
  return { url: `${GEMINI_BASE}/models?pageSize=1000`, headers: {} };
}

/** @returns {{id: string, label: string}[]} models that support generateContent (no image flag exists) */
export function parseGeminiModels(json) {
  const list = json && Array.isArray(json.models) ? json.models : [];
  return list
    .filter((m) => m && typeof m.name === 'string')
    .filter((m) => !Array.isArray(m.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
    .map((m) => ({ id: geminiModelId(m.name), label: typeof m.displayName === 'string' && m.displayName ? m.displayName : geminiModelId(m.name) }));
}

function errorInfo(body) {
  const e = body && body.error && typeof body.error === 'object' ? body.error : {};
  const details = Array.isArray(e.details) ? e.details : [];
  const reasons = details.map((d) => (d && typeof d.reason === 'string' ? d.reason : '')).filter(Boolean);
  return { status: typeof e.status === 'string' ? e.status : '', reasons };
}

/**
 * Classify an HTTP error ({error: {code, message, status, details: [{@type: …ErrorInfo, reason}]}}).
 * @param {number} status @param {any} body
 */
export function classifyGeminiError(status, body) {
  const { status: st, reasons } = errorInfo(body);
  const msg = errorMessageOf(body);
  const o = { provider: NAME };
  if (status === 401 || st === 'UNAUTHENTICATED' || reasons.includes('API_KEY_INVALID') || /api key not valid/i.test(msg)) return photoError('auth', '', o);
  if (status === 403 && /api key|leaked|blocked/i.test(msg)) return photoError('auth', msg, o);
  if (status === 429) {
    return photoError('rate_limit', msg, { ...o, key: 'food.photoError.geminiQuota' });
  }
  if (status === 402 || (st === 'FAILED_PRECONDITION' && /billing|free tier/i.test(msg)) || /prepay|credit balance/i.test(msg)) return photoError('billing', msg, o);
  if (status === 403 || st === 'PERMISSION_DENIED') return photoError('permission', msg, o);
  if (status === 404 || st === 'NOT_FOUND') return photoError('model', msg, o);
  if (status === 413) return photoError('too_large', '', o);
  if (st === 'RESOURCE_EXHAUSTED') return photoError('billing', msg, o);
  if (status === 503 || st === 'UNAVAILABLE') return photoError('overloaded', '', o);
  if (status >= 500) return photoError('server', msg, o);
  return photoError('bad_request', msg || `HTTP ${status}`, o); // i18n-ignore (technical detail)
}

const BLOCKED = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'LANGUAGE', 'OTHER']);

/**
 * Answer text of a generateContent response. Thought parts are skipped.
 * @returns {{ok: true, text: string, model: string|null} | ReturnType<typeof photoError>}
 */
export function extractGeminiText(res) {
  const o = { provider: NAME };
  if (!res || typeof res !== 'object') return photoError('unusable', '', o);
  const block = res.promptFeedback && res.promptFeedback.blockReason;
  if (block) return photoError('refusal', `blockReason: ${block}`, o); // i18n-ignore (technical detail)
  const c = Array.isArray(res.candidates) ? res.candidates[0] : null;
  if (!c) return photoError('unusable', '', o);
  if (c.finishReason === 'MAX_TOKENS') return photoError('truncated', '', o);
  const parts = c.content && Array.isArray(c.content.parts) ? c.content.parts : [];
  const text = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
  // A blocked candidate is a refusal; "OTHER" only counts when nothing usable came back.
  if (BLOCKED.has(c.finishReason) && (c.finishReason !== 'OTHER' || !text.trim())) return photoError('refusal', `finishReason: ${c.finishReason}`, o); // i18n-ignore (technical detail)
  if (!text.trim()) return photoError('unusable', '', o);
  return { ok: true, text, model: typeof res.modelVersion === 'string' ? res.modelVersion : null };
}

export const gemini = Object.freeze({
  id: 'gemini',
  label: 'Google Gemini (AI Studio)', // i18n-ignore (brand)
  name: NAME,
  auth: { header: 'x-goog-api-key', prefix: '' },
  hosts: ['generativelanguage.googleapis.com'],
  suggested: GEMINI_SUGGESTED,
  defaultModel: GEMINI_DEFAULT_MODEL,
  // Texts are catalogue keys (namespace food), translated by the UI.
  keyPlaceholderKey: 'food.provider.gemini.keyPlaceholder',
  keyHelpKey: 'food.provider.gemini.keyHelp',
  keyLooksValid: () => true,
  keyFormatNoteKey: '',
  pricingUrl: 'https://aistudio.google.com/docs/pricing',
  noteKeys: ['food.provider.gemini.note1', 'food.provider.gemini.note2'],
  structured: true,
  buildAnalyse: buildGeminiRequest,
  buildTest: buildGeminiTest,
  buildModels: buildGeminiModels,
  parseModels: parseGeminiModels,
  parseAnswer: extractGeminiText,
  classifyError: classifyGeminiError,
});
