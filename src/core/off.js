// Open Food Facts: URLs, response -> food mapping, rate limiting. Pure, no DOM / fetch.
// Ported from the step-1 barcode test page (removed in 0.5.2; see git history).
import { kjToKcal, emptyPer100, missingFields } from './nutrition.js';
import { parseDecimal, round } from './numbers.js';
import { servingFromText, parseAmountText, cleanServings, basisFromQuantity, PACK_LABEL, multipackLabel } from './portion.js';

export const OFF_BASE = 'https://world.openfoodfacts.org';

/** Fields requested from OFF (keeps responses small). */
export const OFF_FIELDS = [
  'code', 'product_name', 'product_name_en', 'product_name_de', 'product_name_zh', 'generic_name', 'brands', 'quantity',
  'serving_size', 'serving_quantity', 'nutrition_data_per', 'nutriments',
].join(',');

/** Barcode lookup URL (API v2). */
export function productUrl(code) {
  return `${OFF_BASE}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
}

/**
 * Text search URL. Uses the classic /cgi/search.pl endpoint: it sends `Access-Control-Allow-Origin: *`
 * and honours `fields`. (search.openfoodfacts.org sends no Access-Control-Allow-Origin header, so browsers
 * block it; /api/v2/search has no full-text search and answered 503 when checked on 2026-11-18.) OFF allows about 10 search requests per minute per client.
 * @param {string} query @param {{pageSize?: number}} [opts]
 */
export function searchUrl(query, { pageSize = 24 } = {}) {
  const q = new URLSearchParams({
    search_terms: String(query).trim(), search_simple: '1', action: 'process', json: '1', // i18n-ignore (API parameters)
    page_size: String(pageSize), fields: OFF_FIELDS,
  });
  return `${OFF_BASE}/cgi/search.pl?${q}`;
}

const num = (x) => (x === null || x === undefined || x === '' ? null : parseDecimal(typeof x === 'number' ? x : String(x)));
const r = (n, d = 2) => (n === null ? null : round(n, d));

/** Languages with their own product_name_<lang> field we prefer (English keeps OFF's main product_name first). */
const NAME_LANGS = ['de', 'zh'];

/**
 * Map an OFF product object to our food shape (not yet stored: no id/timestamps).
 * @param {any} p OFF product
 * @param {{lang?: string}} [opts] app language: product_name_<lang> is preferred when OFF has it (de, zh)
 * @returns {{food: object, missing: string[], kcalConverted: boolean}}
 */
export function offProductToFood(p, { lang } = {}) {
  p = p || {};
  const n = p.nutriments || {};
  const own = NAME_LANGS.includes(lang) ? p[`product_name_${lang}`] : null;
  const name = [own, p.product_name, p.product_name_en, p.product_name_de, p.generic_name]
    .map((s) => String(s ?? '').trim()).find(Boolean) || '';
  let kcal = num(n['energy-kcal_100g']);
  let kcalConverted = false;
  if (kcal === null) {
    let kj = num(n['energy-kj_100g']);
    if (kj === null) kj = num(n.energy_100g); // OFF stores generic energy in kJ
    if (kj !== null) { kcal = kjToKcal(kj); kcalConverted = true; }
  }
  const per100 = emptyPer100();
  per100.kcal = kcal === null ? null : round(kcal, 0);
  per100.protein = r(num(n.proteins_100g));
  per100.carbs = r(num(n.carbohydrates_100g));
  per100.fat = r(num(n.fat_100g));
  per100.sugars = r(num(n.sugars_100g));
  per100.satFat = r(num(n['saturated-fat_100g']));
  per100.fibre = r(num(n.fiber_100g));
  let salt = num(n.salt_100g);
  if (salt === null && num(n.sodium_100g) !== null) salt = num(n.sodium_100g) * 2.5;
  per100.salt = r(salt);

  const quantity = String(p.quantity ?? '').trim();
  const basis = basisFromQuantity(quantity);
  const servings = [];
  const serving = servingFromText(p.serving_size, num(p.serving_quantity));
  if (serving) servings.push(serving);
  const pack = parseAmountText(quantity);
  // Multipack ("6 x 330 ml"): the single unit is a serving, the whole pack is the total.
  if (pack && pack.count > 1 && pack.each > 0) servings.push({ label: multipackLabel(pack.count), amount: pack.each });
  if (pack && pack.amount <= 5000) servings.push({ label: PACK_LABEL, amount: pack.amount });

  const brands = String(p.brands ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const code = p.code ? String(p.code) : null;
  const food = {
    source: 'off',
    sourceKey: code ? `off:${code}` : null,
    barcode: code,
    name,
    brand: brands.length ? brands.slice(0, 2).join(', ') : null,
    basis,
    per100,
    servings: cleanServings(servings),
    userEdited: false,
    lastAmount: null,
  };
  return { food, missing: missingFields(food), kcalConverted };
}

/**
 * An error for the UI to translate: catalogue key (namespace food) + values.
 * @typedef {{key: string, params?: Record<string, string|number>}} OffError
 */

/**
 * Classify a product lookup response. `json` may be null when the body was not JSON.
 * @param {number} status HTTP status @param {any} json @param {{lang?: string}} [opts] see offProductToFood
 * @returns {{outcome: 'complete'|'incomplete'|'not_found'|'error', food?: object, missing?: string[],
 *            kcalConverted?: boolean, error?: OffError}}
 */
export function interpretProductResponse(status, json, opts = {}) {
  if (status === 429 || status === 503) return { outcome: 'error', error: rateLimitError(status) };
  if (status === 404 || (status >= 200 && status < 300)) {
    if (json && json.status === 1 && json.product) {
      const m = offProductToFood(json.product, opts);
      return { outcome: m.missing.length ? 'incomplete' : 'complete', ...m };
    }
    if (json && json.status === 0) return { outcome: 'not_found', error: { key: 'food.off.notFound' } };
    return { outcome: 'error', error: { key: 'food.off.unexpected', params: { status } } };
  }
  return { outcome: 'error', error: { key: 'food.off.httpError', params: { status } } };
}

/**
 * Map a /cgi/search.pl response to foods. Products without a name or barcode are dropped;
 * incomplete ones are kept and flagged (`missing`).
 * @returns {Array<{food: object, missing: string[], kcalConverted: boolean}>}
 */
export function parseSearchResponse(json, opts = {}) {
  const list = (json && Array.isArray(json.products)) ? json.products : [];
  const out = [];
  const seen = new Set();
  for (const p of list) {
    if (!p || !p.code || seen.has(String(p.code))) continue;
    const m = offProductToFood(p, opts);
    if (!m.food.name) continue;
    seen.add(String(p.code));
    out.push(m);
  }
  return out;
}

/** @returns {OffError} 'Open Food Facts is busy (HTTP 429)…' */
export function rateLimitError(status) {
  return { key: 'food.off.busy', params: { status: status === 503 ? 503 : 429 } };
}

/**
 * Sliding-window rate limit. Given the times of earlier requests, how long to wait before the next one.
 * @param {number[]} times epoch ms of previous requests
 * @param {number} now
 * @param {{max?: number, windowMs?: number}} [opts]
 * @returns {number} ms to wait (0 = go now)
 */
export function rateLimitDelay(times, now, { max = 8, windowMs = 60000 } = {}) {
  const recent = times.filter((t) => now - t < windowMs).sort((a, b) => a - b);
  if (recent.length < max) return 0;
  return recent[recent.length - max] + windowMs - now;
}
