// Food text search: normalisation, ranking, generic (USDA) dataset decoding. Pure, no DOM.
import { emptyPer100 } from './nutrition.js';

/**
 * Lowercase, strip accents, map ß -> ss, keep letters/digits only (others become spaces).
 * @param {string} text
 */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}+/gu, '')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** @returns {string[]} normalised words */
export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/**
 * Prepare an item for repeated searching (do this once per item, not per keystroke).
 * @template T
 * @param {T} item @param {string} text searchable text (e.g. name + brand)
 * @returns {{item: T, words: string[], len: number}}
 */
export function indexItem(item, text) {
  const words = tokenize(text);
  return { item, words, len: words.join(' ').length };
}

/** How well one query token matches one word: 3 exact/plural, 2 prefix, 1 inside (≥3 chars), 0 none. */
function wordMatch(token, word) {
  if (word === token || word === `${token}s` || word === `${token}es` || token === `${word}s`) return 3;
  if (word.startsWith(token)) return 2;
  if (token.length >= 3 && word.includes(token)) return 1;
  return 0;
}

/**
 * Score an indexed item against query tokens. Every token must match some word, else null.
 * Higher is better: exact words > prefixes, matches early in the name, short names.
 * @param {string[]} tokens @param {{words: string[], len: number}} entry
 * @returns {number|null}
 */
export function scoreEntry(tokens, entry) {
  if (!tokens.length) return null;
  let score = 0;
  for (let t = 0; t < tokens.length; t++) {
    let best = 0;
    let bestPos = -1;
    for (let i = 0; i < entry.words.length; i++) {
      const m = wordMatch(tokens[t], entry.words[i]);
      if (m > best || (m === best && m > 0 && bestPos < 0)) { best = m; bestPos = i; }
      if (best === 3) break;
    }
    if (!best) return null;
    score += best * 10;
    score -= Math.min(bestPos, 6) * 2;                  // earlier in the name is better
    if (t === 0 && bestPos === 0) score += 15;          // name starts with the first query word
  }
  score -= Math.min(entry.words.length, 15);            // fewer extra words
  score -= entry.len / 20;                              // shorter names
  return score;
}

/**
 * Rank items by query. Returns at most `limit` items, best first. Empty query -> [].
 * @template T
 * @param {string} query
 * @param {Array<{item: T, words: string[], len: number}>} index from indexItem()
 * @param {{limit?: number}} [opts]
 * @returns {T[]}
 */
export function search(query, index, { limit = 30 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const hits = [];
  for (const e of index) {
    const s = scoreEntry(tokens, e);
    if (s !== null) hits.push({ s, e });
  }
  hits.sort((a, b) => b.s - a.s || a.e.len - b.e.len);
  return hits.slice(0, limit).map((h) => h.e.item);
}

/**
 * Decode src/data/generic-foods.json (see tools/build-generic-foods.mjs) into food-shaped objects.
 * @param {{fields: string[], foods: any[][]}} doc
 * @returns {Array<object>} foods with source 'usda', not yet stored (no id)
 */
export function decodeGenericFoods(doc) {
  const f = doc && Array.isArray(doc.fields) ? doc.fields : [];
  const at = (k) => f.indexOf(k);
  const idx = Object.fromEntries(['fdcId', 'name', 'kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt', 'portions'].map((k) => [k, at(k)]));
  if (idx.fdcId < 0 || idx.name < 0) throw new Error('Generic foods file has an unexpected format');
  return (doc.foods || []).map((row) => {
    const per100 = emptyPer100();
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'sugars', 'satFat', 'fibre', 'salt']) {
      const v = idx[k] >= 0 ? row[idx[k]] : null;
      per100[k] = typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
    const portions = idx.portions >= 0 && Array.isArray(row[idx.portions]) ? row[idx.portions] : [];
    return {
      source: 'usda',
      sourceKey: `usda:${row[idx.fdcId]}`,
      barcode: null,
      name: String(row[idx.name]),
      brand: null,
      basis: 'g',
      per100,
      servings: portions.map(([label, amount]) => ({ label: String(label), amount: Number(amount) }))
        .filter((s) => Number.isFinite(s.amount) && s.amount > 0),
      userEdited: false,
      lastAmount: null,
    };
  });
}

/**
 * Re-order remote results (e.g. Open Food Facts, which ranks by popularity): items whose text matches
 * every query word come first, best match first; the rest keep their original order after them.
 * @template T
 * @param {string} query @param {T[]} items @param {(item: T) => string} getText
 * @returns {T[]}
 */
export function preferMatches(query, items, getText) {
  const tokens = tokenize(query);
  if (!tokens.length) return items.slice();
  const scored = items.map((item, i) => ({ item, i, s: scoreEntry(tokens, indexItem(item, getText(item))) }));
  const hit = scored.filter((x) => x.s !== null).sort((a, b) => b.s - a.s || a.i - b.i);
  const miss = scored.filter((x) => x.s === null);
  return [...hit, ...miss].map((x) => x.item);
}
