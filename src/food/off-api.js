// Open Food Facts network client (barcode lookup + text search) with timeouts and a client-side rate limit.
import { productUrl, searchUrl, interpretProductResponse, parseSearchResponse, rateLimitDelay, rateLimitMessage } from '../core/off.js';

const TIMEOUT_MS = 15000;
const SEARCH_LIMIT = { max: 8, windowMs: 60000 }; // OFF asks for ≤ 10 search requests/min
const searchTimes = [];
const searchCache = new Map(); // query -> results (this session only)

function offlineMessage() {
  return typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'You are offline. Open Food Facts needs a connection; your foods, generic foods and quick add still work.'
    // A rate-limit/overload answer from OFF has no CORS header, so the browser reports it as a network error too.
    : 'Could not reach Open Food Facts. The service may be busy or rate-limiting (wait a minute), or the connection dropped.';
}

async function fetchJson(url, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), TIMEOUT_MS);
  const onAbort = () => ctrl.abort(signal.reason);
  if (signal) { if (signal.aborted) ctrl.abort(signal.reason); else signal.addEventListener('abort', onAbort, { once: true }); }
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { status: res.status, json };
  } catch (err) {
    if (signal && signal.aborted) throw err;              // caller cancelled: propagate AbortError
    if (ctrl.signal.aborted) return { status: 0, error: 'Open Food Facts did not answer within 15 s. Try again.' };
    return { status: 0, error: offlineMessage() };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Barcode lookup.
 * @returns {Promise<{outcome: 'complete'|'incomplete'|'not_found'|'error', food?: object, missing?: string[], kcalConverted?: boolean, error?: string}>}
 */
export async function lookupBarcode(code, { signal } = {}) {
  const r = await fetchJson(productUrl(code), signal);
  if (r.status === 0) return { outcome: 'error', error: r.error };
  return interpretProductResponse(r.status, r.json);
}

/** ms until another search request is allowed (0 = now). */
export function searchWait() {
  return rateLimitDelay(searchTimes, Date.now(), SEARCH_LIMIT);
}

/**
 * Text search. Cached per query for the session. Throws AbortError if cancelled.
 * @returns {Promise<{ok: true, results: Array<{food: object, missing: string[], kcalConverted: boolean}>} | {ok: false, error: string, retryInMs?: number}>}
 */
export async function searchProducts(query, { signal } = {}) {
  const key = query.trim().toLowerCase();
  if (searchCache.has(key)) return { ok: true, results: searchCache.get(key) };
  const wait = searchWait();
  if (wait > 0) return { ok: false, error: `Open Food Facts allows only a few searches per minute. Try again in ${Math.ceil(wait / 1000)} s.`, retryInMs: wait };
  searchTimes.push(Date.now());
  const r = await fetchJson(searchUrl(query), signal);
  if (r.status === 0) return { ok: false, error: r.error };
  if (r.status === 429 || r.status === 503) return { ok: false, error: rateLimitMessage(r.status), retryInMs: 60000 };
  if (r.status < 200 || r.status >= 300 || !r.json) return { ok: false, error: `Open Food Facts search failed (HTTP ${r.status}).` };
  const results = parseSearchResponse(r.json);
  searchCache.set(key, results);
  return { ok: true, results };
}
