// Provider adapters: request building, response parsing, error classification, model lists.
// Fixtures follow the shapes in each provider's documentation (URLs at the top of src/core/photo-*.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_SCHEMA, SYSTEM_PROMPT, parsePhotoAnswer } from '../src/core/meal-photo.js';
import {
  buildAnthropicRequest, buildAnthropicTest, buildAnthropicModels, parseAnthropicModels, classifyAnthropicError,
  extractAnthropicText, anthropicKeyLooksValid, ANTHROPIC_DEFAULT_MODEL,
} from '../src/core/photo-anthropic.js';
import {
  buildGeminiRequest, buildGeminiTest, buildGeminiModels, parseGeminiModels, classifyGeminiError, extractGeminiText,
} from '../src/core/photo-gemini.js';
import {
  buildOpenAIRequest, buildCustomRequest, buildCustomModels, parseOpenAIModels, classifyOpenAIError, classifyCustomError,
  extractOpenAIText, extractCustomText, validateBaseUrl,
} from '../src/core/photo-openai.js';
import { PHOTO_PROVIDERS, PROVIDER_IDS, authHeader, networkError, getAdapter } from '../src/core/photo-providers.js';

const answer = { items: [{ name: 'Cooked white rice', amount: 200, unit: 'g', per100: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, sugars: 0.1, satFat: 0.1, fibre: 0.4, salt: 0 }, confidence: 'high', assumptions: 'Plate for scale.' }], note: '' };
const answerText = JSON.stringify(answer);
const img = { imageBase64: 'QUJD', mediaType: 'image/jpeg', hint: 'about 200 g rice' };
const KEY = 'test-key-not-real-0123456789';

// ================================================================ registry
test('every provider has the full adapter interface and sends the key in a header only', () => {
  assert.deepEqual(PROVIDER_IDS, ['anthropic', 'gemini', 'openai', 'custom']);
  for (const id of PROVIDER_IDS) {
    const a = PHOTO_PROVIDERS[id];
    for (const f of ['buildAnalyse', 'buildTest', 'buildModels', 'parseModels', 'parseAnswer', 'classifyError']) assert.equal(typeof a[f], 'function', `${id}.${f}`);
    const ctx = { baseUrl: 'https://example.com/v1', model: 'some-model' };
    for (const req of [a.buildAnalyse({ ...img, ...ctx }), a.buildTest(ctx), a.buildModels(ctx)]) {
      assert.ok(req.url.startsWith('https://'), req.url);
      assert.ok(!req.url.includes('key='), req.url);
      assert.ok(!JSON.stringify(req.headers).toLowerCase().includes('bearer'));
    }
  }
  assert.deepEqual(authHeader('anthropic', KEY), { 'x-api-key': KEY });
  assert.deepEqual(authHeader('gemini', KEY), { 'x-goog-api-key': KEY });
  assert.deepEqual(authHeader('openai', KEY), { authorization: `Bearer ${KEY}` });
  assert.deepEqual(authHeader('custom', KEY), { authorization: `Bearer ${KEY}` });
  assert.equal(getAdapter('nope').id, 'anthropic');
});

test('network failures: custom says the service may block browser calls', () => {
  const c = networkError('custom', { baseUrl: 'https://api.example.com/v1' });
  assert.equal(c.kind, 'network');
  assert.equal(c.retry, true);
  assert.equal(c.key, 'food.photoError.networkCustom');
  assert.equal(c.params.p, 'api.example.com');
  assert.equal(networkError('openai').key, 'food.photoError.network');
  assert.equal(networkError('openai').params.p, 'OpenAI');
  assert.equal(networkError('anthropic').params.p, 'Anthropic');
  assert.equal(networkError('custom', { baseUrl: 'bad' }).params.p, null);
});

// ================================================================ Anthropic
test('Anthropic: request shape, fallback only for documented models, free-text model passes through', () => {
  const req = buildAnthropicRequest({ model: 'claude-opus-5-5', ...img });
  assert.equal(req.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(req.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(req.headers['anthropic-version'], '2026-10-21');
  assert.equal(req.headers['x-api-key'], undefined);
  assert.equal(req.body.system, SYSTEM_PROMPT);
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.output_config.effort, 'medium');
  assert.equal(req.body.output_config.format.schema, PHOTO_SCHEMA);
  assert.equal(req.body.thinking, undefined);
  assert.equal(req.body.temperature, undefined);
  const [image, text] = req.body.messages[0].content;
  assert.deepEqual(image, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } });
  assert.match(text.text, /about 200 g rice/);
  const haiku = buildAnthropicRequest({ model: 'claude-haiku-5-5', ...img });
  assert.equal(haiku.body.fallbacks, undefined);
  assert.equal(haiku.headers['anthropic-beta'], undefined);
  const other = buildAnthropicRequest({ model: 'claude-future-9', ...img });
  assert.equal(other.body.model, 'claude-future-9');
  assert.equal(other.body.output_config.effort, undefined);
  assert.equal(buildAnthropicRequest({ model: '', ...img }).body.model, ANTHROPIC_DEFAULT_MODEL);
  assert.equal(buildAnthropicTest({ model: 'claude-sonnet-5-5' }).url, 'https://api.anthropic.com/v1/models/claude-sonnet-5-5');
  assert.equal(buildAnthropicModels().url, 'https://api.anthropic.com/v1/models?limit=1000');
});

test('Anthropic: response text, refusal, cut-off, fallback blocks', () => {
  assert.equal(extractAnthropicText({ stop_reason: 'refusal', content: [] }).kind, 'refusal');
  assert.equal(extractAnthropicText({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{' }] }).kind, 'truncated');
  assert.equal(extractAnthropicText({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }] }).kind, 'unusable');
  assert.equal(extractAnthropicText(null).kind, 'unusable');
  const r = extractAnthropicText({
    id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'partial' }, { type: 'fallback', from: {}, to: {} }, { type: 'text', text: answerText }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.text, answerText);
  assert.equal(parsePhotoAnswer(r.text).ok, true);
});

test('Anthropic: HTTP errors', () => {
  const e = (type, message = '') => ({ type: 'error', error: { type, message }, request_id: 'req_011CSHoEeqs5C35K2UUqR7Fy' });
  assert.equal(classifyAnthropicError(401, e('authentication_error', 'invalid x-api-key')).kind, 'auth');
  assert.equal(classifyAnthropicError(402, e('billing_error')).kind, 'billing');
  assert.equal(classifyAnthropicError(400, e('invalid_request_error', 'Your credit balance is too low to access the Anthropic API.')).kind, 'billing');
  assert.equal(classifyAnthropicError(403, e('permission_error')).kind, 'permission');
  assert.equal(classifyAnthropicError(404, e('not_found_error', 'model: x')).kind, 'model');
  assert.equal(classifyAnthropicError(413, e('request_too_large')).kind, 'too_large');
  assert.equal(classifyAnthropicError(429, e('rate_limit_error')).kind, 'rate_limit');
  assert.equal(classifyAnthropicError(529, e('overloaded_error')).kind, 'overloaded');
  assert.equal(classifyAnthropicError(500, null).kind, 'server');
  const br = classifyAnthropicError(400, e('invalid_request_error', 'messages: roles must alternate between "user" and "assistant"'));
  assert.equal(br.kind, 'bad_request');
  assert.match(br.detail, /roles must alternate/);
  assert.equal(classifyAnthropicError(401, null).params.p, 'Anthropic');
  assert.equal(anthropicKeyLooksValid('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'), true);
  assert.equal(anthropicKeyLooksValid('hello'), false);
});

test('Anthropic: model list (documented example) keeps image-capable models', () => {
  const doc = {
    data: [
      { id: 'claude-opus-5-5', capabilities: { image_input: { supported: true }, structured_outputs: { supported: true } }, created_at: '2026-09-21T00:00:00Z', display_name: 'Claude Opus 5.5', lifecycle: 'active', line: 'opus', type: 'model' },
      { id: 'claude-text-only', capabilities: { image_input: { supported: false } }, display_name: 'Text only', lifecycle: 'active', type: 'model' },
      { id: 'claude-old', capabilities: null, display_name: 'Old', lifecycle: 'deprecated', type: 'model' },
    ],
    first_id: 'claude-opus-5-5', has_more: false, last_id: 'claude-old',
  };
  assert.deepEqual(parseAnthropicModels(doc), [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-old', label: 'Old' }]);
  assert.deepEqual(parseAnthropicModels(null), []);
});

// ================================================================ Gemini
test('Gemini: generateContent request with inline image, system instruction and JSON schema', () => {
  const req = buildGeminiRequest({ model: 'gemini-4-hydrogen', ...img });
  assert.equal(req.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent');
  assert.equal(req.headers['x-goog-api-key'], undefined);
  assert.deepEqual(req.body.systemInstruction, { parts: [{ text: SYSTEM_PROMPT }] });
  const parts = req.body.contents[0].parts;
  assert.equal(req.body.contents[0].role, 'user');
  assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  assert.match(parts[1].text, /about 200 g rice/);
  assert.equal(req.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(req.body.generationConfig.responseJsonSchema, PHOTO_SCHEMA);
  assert.equal(req.body.generationConfig.maxOutputTokens, 16000);
  assert.equal(buildGeminiRequest({ model: 'models/gemini-4-carbon', ...img }).url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon:generateContent');
  assert.equal(buildGeminiTest({ model: 'gemini-4-carbon' }).url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-carbon');
  assert.equal(buildGeminiModels().url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
});

test('Gemini: answer text skips thought parts; blocked prompts and safety stops are refusals', () => {
  const ok = extractGeminiText({
    candidates: [{ content: { role: 'model', parts: [{ text: 'thinking…', thought: true }, { text: answerText }] }, finishReason: 'STOP', index: 0 }],
    usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 200, totalTokenCount: 1700 },
    modelVersion: 'gemini-4-hydrogen', responseId: 'abc',
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, answerText);
  assert.equal(ok.model, 'gemini-4-hydrogen');
  const blocked = extractGeminiText({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' }, usageMetadata: {} });
  assert.equal(blocked.kind, 'refusal');
  assert.match(blocked.detail, /PROHIBITED_CONTENT/);
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }).kind, 'refusal');
  assert.equal(extractGeminiText({ candidates: [{ finishReason: 'IMAGE_SAFETY' }] }).kind, 'refusal');
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ text: '{"items":' }] }, finishReason: 'MAX_TOKENS' }] }).kind, 'truncated');
  assert.equal(extractGeminiText({ candidates: [] }).kind, 'unusable');
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ text: answerText }] }, finishReason: 'OTHER' }] }).ok, true);
});

test('Gemini: documented error shapes', () => {
  const g = (code, status, message, reason) => ({ error: { code, message, status, details: reason ? [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com' }] : [] } });
  assert.equal(classifyGeminiError(400, g(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID')).kind, 'auth');
  assert.equal(classifyGeminiError(403, g(403, 'PERMISSION_DENIED', 'Your API key was reported as leaked. Please use another API key.')).kind, 'auth');
  assert.equal(classifyGeminiError(403, g(403, 'PERMISSION_DENIED', 'Your project has been denied access.')).kind, 'permission');
  assert.equal(classifyGeminiError(400, g(400, 'FAILED_PRECONDITION', 'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.')).kind, 'billing');
  assert.equal(classifyGeminiError(402, g(402, 'RESOURCE_EXHAUSTED', 'Your Prepay credit balance is depleted.')).kind, 'billing');
  const rl = classifyGeminiError(429, g(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota.'));
  assert.equal(rl.kind, 'rate_limit');
  assert.equal(rl.key, 'food.photoError.geminiQuota');
  assert.equal(classifyGeminiError(429, g(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.')).kind, 'rate_limit');
  assert.equal(classifyGeminiError(404, g(404, 'NOT_FOUND', 'models/gemini-x is not found')).kind, 'model');
  assert.equal(classifyGeminiError(503, g(503, 'UNAVAILABLE', 'The model is overloaded.')).kind, 'overloaded');
  assert.equal(classifyGeminiError(500, g(500, 'INTERNAL', 'An internal error has occurred.')).kind, 'server');
  assert.equal(classifyGeminiError(400, g(400, 'INVALID_ARGUMENT', 'Invalid JSON payload received.')).kind, 'bad_request');
});

test('Gemini: model list keeps generateContent models and strips "models/"', () => {
  const doc = { models: [
    { name: 'models/gemini-4-hydrogen', baseModelId: 'gemini-4-hydrogen', version: '4', displayName: 'Gemini 4 Hydrogen', inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ['generateContent', 'countTokens'], thinking: true },
    { name: 'models/text-embedding-9', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
  ], nextPageToken: '' };
  assert.deepEqual(parseGeminiModels(doc), [{ id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' }]);
});

// ================================================================ OpenAI
test('OpenAI: chat completions request with data-URL image and strict JSON schema', () => {
  const req = buildOpenAIRequest({ model: 'gpt-6.2-astra', ...img });
  assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(req.headers.authorization, undefined);
  const [dev, user] = req.body.messages;
  assert.deepEqual(dev, { role: 'developer', content: SYSTEM_PROMPT });
  assert.deepEqual(user.content[0], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } });
  assert.match(user.content[1].text, /about 200 g rice/);
  assert.deepEqual(req.body.response_format, { type: 'json_schema', json_schema: { name: 'meal_photo_estimate', schema: PHOTO_SCHEMA, strict: true } });
  assert.equal(req.body.max_completion_tokens, 16000);
  assert.equal(req.body.max_tokens, undefined);
});

test('OpenAI: answer, refusal, content filter, cut-off', () => {
  const res = (message, finish = 'stop') => ({ id: 'chatcmpl-1', object: 'chat.completion', created: 1, model: 'gpt-6.2-astra', choices: [{ index: 0, message: { role: 'assistant', refusal: null, ...message }, finish_reason: finish }] });
  const ok = extractOpenAIText(res({ content: answerText }));
  assert.equal(ok.ok, true);
  assert.equal(ok.model, 'gpt-6.2-astra');
  assert.equal(parsePhotoAnswer(ok.text).ok, true);
  assert.equal(extractOpenAIText(res({ content: null, refusal: 'I can’t help with that.' })).kind, 'refusal');
  assert.equal(extractOpenAIText(res({ content: '' }, 'content_filter')).kind, 'refusal');
  assert.equal(extractOpenAIText(res({ content: '{"items":' }, 'length')).kind, 'truncated');
  assert.equal(extractOpenAIText({ choices: [] }).kind, 'unusable');
});

test('OpenAI: documented error codes', () => {
  const o = (message, type, code) => ({ error: { message, type, param: null, code } });
  assert.equal(classifyOpenAIError(401, o('Incorrect API key provided: sk-abc***wxyz.', 'invalid_request_error', 'invalid_api_key')).kind, 'auth');
  assert.equal(classifyOpenAIError(429, o('Rate limit reached for requests', 'requests', 'rate_limit_exceeded')).kind, 'rate_limit');
  assert.equal(classifyOpenAIError(429, o('Your request rate increased too quickly.', 'rate_limit_error', 'slow_down')).kind, 'rate_limit');
  assert.equal(classifyOpenAIError(429, o('Your organization has no prepaid credits remaining.', 'insufficient_quota', 'credit_balance_exhausted')).kind, 'billing');
  assert.equal(classifyOpenAIError(429, o('You exceeded your current quota.', 'insufficient_quota', 'insufficient_quota')).kind, 'billing');
  assert.equal(classifyOpenAIError(429, o('Project spend limit reached.', 'insufficient_quota', 'project_spend_limit_exceeded')).kind, 'billing');
  assert.equal(classifyOpenAIError(403, o('Country, region, or territory not supported', 'request_forbidden', 'unsupported_country_region_territory')).kind, 'permission');
  assert.equal(classifyOpenAIError(404, o('The model `x` does not exist', 'invalid_request_error', 'model_not_found')).kind, 'model');
  assert.equal(classifyOpenAIError(503, o('The requested model is temporarily overloaded.', 'service_unavailable_error', 'server_is_overloaded')).kind, 'overloaded');
  assert.equal(classifyOpenAIError(500, o('The server had an error while processing your request.', 'server_error', null)).kind, 'server');
  assert.equal(classifyOpenAIError(400, o('Your request was rejected as a result of our safety system.', 'invalid_request_error', 'content_policy_violation')).kind, 'refusal');
  assert.equal(classifyOpenAIError(400, o('Invalid schema for response_format', 'invalid_request_error', null)).kind, 'bad_request');
});

test('OpenAI: model list (documented shape) is unfiltered, newest first', () => {
  const doc = { object: 'list', data: [
    { id: 'gpt-6-luna', object: 'model', created: 1760000000, owned_by: 'openai' },
    { id: 'gpt-6.2-astra', object: 'model', created: 1780000000, owned_by: 'openai', shutdown_date: null },
  ] };
  assert.deepEqual(parseOpenAIModels(doc).map((m) => m.id), ['gpt-6.2-astra', 'gpt-6-luna']);
});

// ================================================================ OpenAI-compatible (custom)
test('custom: base URL validation', () => {
  assert.deepEqual(validateBaseUrl('https://openrouter.ai/api/v1/'), { ok: true, url: 'https://openrouter.ai/api/v1', host: 'openrouter.ai' });
  assert.equal(validateBaseUrl('https://api.groq.com/openai/v1/chat/completions').url, 'https://api.groq.com/openai/v1');
  assert.equal(validateBaseUrl(' https://api.mistral.ai/v1 ').ok, true);
  for (const bad of ['', 'http://api.example.com/v1', 'ftp://x.com', 'https://user:pass@api.example.com/v1', 'https://key@api.example.com/v1',
    'https://api.example.com/v1?key=abc', 'https://api.example.com/v1#x', 'not a url', 'https://intranet/v1', `https://x.com/${'a'.repeat(400)}`, 'javascript:alert(1)']) {
    const r = validateBaseUrl(bad);
    assert.equal(r.ok, false, bad);
    assert.match(r.errorKey, /^food\.baseUrl\.[a-zA-Z]+$/);
  }
});

test('custom: request against the base URL, schema only when enabled, no token limit', () => {
  const plain = buildCustomRequest({ model: 'meta-llama/llama-4-scout', ...img, baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(plain.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(plain.body.model, 'meta-llama/llama-4-scout');
  assert.equal(plain.body.messages[0].role, 'system');
  assert.ok(plain.body.messages[0].content.includes(JSON.stringify(PHOTO_SCHEMA)), 'schema in the prompt');
  assert.equal(plain.body.response_format, undefined);
  assert.equal(plain.body.max_tokens, undefined);
  assert.equal(plain.body.max_completion_tokens, undefined);
  const schema = buildCustomRequest({ model: 'm', ...img, baseUrl: 'https://api.example.com/v1', useSchema: true });
  assert.equal(schema.body.response_format.type, 'json_schema');
  assert.equal(schema.body.messages[0].content, SYSTEM_PROMPT);
  assert.throws(() => buildCustomRequest({ model: 'm', ...img, baseUrl: 'http://insecure.example.com' }));
  assert.equal(buildCustomModels({ baseUrl: 'https://api.example.com/v1' }).url, 'https://api.example.com/v1/models');
});

test('custom: tolerant errors and answers (numeric codes, content parts, code fences)', () => {
  const ctx = { baseUrl: 'https://openrouter.ai/api/v1' };
  const auth = classifyCustomError(401, { error: { code: 401, message: 'No auth credentials found' } }, ctx);
  assert.equal(auth.kind, 'auth');
  assert.equal(auth.params.p, 'openrouter.ai');
  assert.equal(classifyCustomError(402, { error: { code: 402, message: 'Insufficient credits' } }, ctx).kind, 'billing');
  assert.equal(classifyCustomError(429, { error: { message: 'Rate limit exceeded' } }, ctx).kind, 'rate_limit');
  assert.equal(classifyCustomError(422, { detail: 'model does not support images' }, ctx).detail, 'model does not support images');
  assert.equal(classifyCustomError(400, { error: { message: 'Request blocked by content moderation' } }, ctx).kind, 'refusal');
  const fenced = extractCustomText({ model: 'x', choices: [{ message: { role: 'assistant', content: '```json\n' + answerText + '\n```' }, finish_reason: 'stop' }] }, ctx);
  assert.equal(parsePhotoAnswer(fenced.text).ok, true);
  const parts = extractCustomText({ choices: [{ message: { content: [{ type: 'text', text: answerText }] }, finish_reason: 'stop' }] }, ctx);
  assert.equal(parts.text, answerText);
});

test('custom: model list filtered by input_modalities when the service lists them', () => {
  const doc = { data: [
    { id: 'vision/model', name: 'Vision', architecture: { input_modalities: ['text', 'image'] } },
    { id: 'text/model', name: 'Text', architecture: { input_modalities: ['text'] } },
    { id: 'plain-model', object: 'model' },
  ] };
  assert.deepEqual(parseOpenAIModels(doc).map((m) => m.id).sort(), ['plain-model', 'vision/model']);
});
