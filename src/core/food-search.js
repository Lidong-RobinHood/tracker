// Food text search: normalisation, ranking, generic (USDA) dataset decoding. Pure, no DOM.
import { emptyPer100 } from './nutrition.js';

const HAN = /\p{Script=Han}/u;
const HAN_RUNS = /\p{Script=Han}+/gu;

/**
 * Lowercase, fold full-width ASCII (ＡＢＣ１２３) to ASCII, strip accents (not kana voicing marks),
 * map ß -> ss, keep letters/digits only (others become spaces). Han characters are kept unchanged.
 * @param {string} text
 */
export function normalize(text) {
  return String(text ?? '')
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .toLowerCase()
    .normalize('NFD').replace(/(?<![\p{Script=Hiragana}\p{Script=Katakana}])\p{M}+/gu, '').normalize('NFC')
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** @returns {string[]} normalised words */
export function tokenize(text) {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** True when the text contains Han (Chinese) characters. */
export const hasHan = (text) => HAN.test(String(text ?? ''));

/** German spelling without umlauts: ä -> ae, ö -> oe, ü -> ue (so "haehnchen" finds "Hähnchen"). */
const expandUmlauts = (text) => String(text).replace(/[äöüÄÖÜ]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue' })[c]);

/**
 * One searchable name: words, their umlaut-expanded variants (only where different) and, for names with
 * Han characters, the normalised name for substring matching (its words are the name's segments: the
 * parts between "，" and other punctuation, parenthesised synonyms "（…）" included as segments of their own).
 * @param {string} text
 * @returns {{words: string[], len: number, vars?: Array<string|null>, han?: string}}
 */
function indexName(text) {
  const words = tokenize(text);
  const joined = words.join(' ');
  const rec = { words, len: joined.length, text: joined };
  if (/[äöüÄÖÜ]/.test(text)) {
    const v = tokenize(expandUmlauts(text));
    if (v.length === words.length) {
      rec.vars = v.map((w, i) => (w === words[i] ? null : w));
      rec.text = `${joined} ${v.join(' ')}`;
    }
  }
  if (HAN.test(text)) rec.han = words.join(' '); // runs never contain spaces: no match across punctuation
  return rec;
}

/**
 * Prepare an item for repeated searching (do this once per item, not per keystroke).
 * `text` may be several names (e.g. English, German, Chinese): the item is found by any of them, ranked by
 * the best-scoring one, and returned once. The first name is the primary one (entry.words / entry.len).
 *
 * A name may be given as `{ text, rank }`: rank 0 (default) = a name in the app language (or a user's own
 * name), 1 = English when it is not the app language, 2 = another language (see nameRank). A match found only
 * in a name of rank > 0 ranks below the app language's matches of comparable quality, and a prefix or
 * inside-word match on such a name below every app-language match (search(), bucketOf, FOREIGN_PENALTY).
 *
 * `opts` (optional, e.g. one entry of commonFoodsFromFile()):
 * - `tier` 1 (everyday staple) or 2 (common food): search() ranks the item higher (TIER_BONUS) among
 *   matches of similar quality. Without opts (or without a tier) the item gets no bonus.
 * - `aliases` extra searchable names (e.g. "Haferflocken" for USDA "Oats"), strings or `{ text, rank }`;
 *   never the primary name.
 * @template T
 * @param {T} item
 * @param {string|Array<string|{text: string, rank?: number}|null|undefined>} text searchable text (e.g. name + brand)
 * @param {{tier?: number, aliases?: Array<string|{text: string, rank?: number}>}|null} [opts]
 * @returns {{item: T, words: string[], len: number, vars?: Array<string|null>, han?: string, tier?: number,
 *   alt?: Array<{words: string[], len: number, vars?: Array<string|null>, han?: string}>}}
 */
export function indexItem(item, text, opts) {
  const all = Array.isArray(text) ? text : [text];
  const aliases = opts && Array.isArray(opts.aliases) ? opts.aliases : [];
  const texts = (aliases.length ? [...all, ...aliases] : all).map(asName).filter(Boolean);
  const [first, ...rest] = texts.length ? texts : [{ text: '', rank: 0 }];
  const entry = { item, ...indexName(first.text) };
  if (first.rank) entry.rank = first.rank;
  const seen = new Map([[first.text, entry]]);
  const alt = [];
  for (const n of rest) {
    const had = seen.get(n.text);
    if (had) { // the same text in several languages counts in the best-ranked one
      if ((had.rank || 0) > n.rank) { if (n.rank) had.rank = n.rank; else delete had.rank; }
      continue;
    }
    const rec = indexName(n.text);
    if (n.rank) rec.rank = n.rank;
    seen.set(n.text, rec);
    alt.push(rec);
  }
  if (alt.length) entry.alt = alt;
  const tier = opts && opts.tier;
  if (tier && TIER_BONUS[tier]) entry.tier = tier;
  return entry;
}

/** A name argument of indexItem as { text, rank }, or null when empty. */
function asName(t) {
  if (typeof t === 'string') return t.trim() ? { text: t, rank: 0 } : null;
  if (t && typeof t.text === 'string' && t.text.trim()) return { text: t.text, rank: Number.isInteger(t.rank) && t.rank > 0 ? Math.min(t.rank, 2) : 0 };
  return null;
}

/**
 * Rank of a name in language `nameLang` when the app language is `appLang`: 0 = the app language, 1 = English
 * (the base data's language) when the app language is another one, 2 = any other language. A name of unknown
 * language (null) counts as the app language.
 * @param {string|null|undefined} nameLang @param {string} appLang
 */
export function nameRank(nameLang, appLang) {
  if (!nameLang || nameLang === appLang) return 0;
  return nameLang === 'en' ? 1 : 2;
}

/**
 * Score subtracted from a match found only in another language's name (index = rank, see indexItem): larger
 * than the tier bonus plus the usual spread between two exact matches, so the app language's matches of the
 * same quality stay above it; English (rank 1) above the third language.
 */
export const FOREIGN_PENALTY = Object.freeze([0, 60, 70]);

/**
 * Ranking bonus by tier (index = tier). Big enough to lift a staple ("Milk, whole") above shorter or
 * earlier-matching odd variants ("Milk and cereal bar") that match the query as well; too small to beat
 * a clearly better match (an exact word against a prefix, a matching first word against a later one plus
 * a short name, or a whole Han segment against a match inside a longer word). Items that do not match every
 * query word are never shown, whatever their tier.
 */
export const TIER_BONUS = Object.freeze([0, 24, 14]);

/** Word endings accepted as inflections (see wordMatch). */
const INFLECTION = new Set(['e', 'n', 'r', 's', 'en', 'er', 'es', 'em']);

/**
 * How well one query token matches one word: 3 exact/plural, 2 prefix or inflected, 1 inside (≥3 chars),
 * 0 none. Plurals: English -s/-es and German -n/-en (tokens of 3+ resp. 4+ letters: "ei" is not "eis").
 * Inflected: the token is a word of 5+ letters plus a German/English ending ("griechischer" → "griechisch").
 */
function wordMatch(token, word) {
  if (word === token) return 3;
  const tl = token.length;
  if (tl >= 3 && (word === `${token}s` || word === `${token}es` || token === `${word}s`)) return 3;
  if (tl >= 4 && (word === `${token}n` || word === `${token}en` || token === `${word}n`)) return 3;
  if (word.startsWith(token)) return 2;
  if (tl >= 7 && word.length >= 5 && INFLECTION.has(token.slice(word.length)) && token.startsWith(word)) return 2;
  if (tl >= 3 && word.includes(token)) return 1;
  return 0;
}

/** Best match of a token over a name's words: [quality, position] (quality 0 = none). */
function bestWord(token, words, vars) {
  let best = 0;
  let bestPos = -1;
  for (let i = 0; i < words.length; i++) {
    let m = wordMatch(token, words[i]);
    if (m < 3 && vars && vars[i]) m = Math.max(m, wordMatch(token, vars[i]));
    if (m > best) { best = m; bestPos = i; }
    if (best === 3) break;
  }
  return [best, bestPos];
}

/** Shortest part when a compound query word is split in two (see scoreEntry). */
const SPLIT_MIN = 3;
/** splitWord quality when both parts are whole words ((3 + 3) / 2 − 0.8). */
const SPLIT_EXACT = 2.2 - 1e-9;

/**
 * A compound query word that matches no word as a whole ("hähnchenbrust" against "Hähnchen, …, Brust"):
 * the best split into two parts that each match the start of a word, as [quality, position] (quality
 * 0 = none). Parts have SPLIT_MIN+ letters; a 2-letter last part must be a whole word ("oliven" + "öl").
 * The quality is lower than for a direct match so whole-word matches rank first.
 */
function splitWord(token, words, vars) {
  let best = 0;
  let bestPos = -1;
  for (let k = SPLIT_MIN; k <= token.length - 2; k++) {
    const [ma, pa] = bestWord(token.slice(0, k), words, vars);
    if (ma < 2) continue;
    const tail = token.slice(k);
    const [mb, pb] = bestWord(tail, words, vars);
    if (mb < (tail.length < SPLIT_MIN ? 3 : 2)) continue;
    const q = (ma + mb) / 2 - 0.8;
    if (q > best) { best = q; bestPos = Math.min(pa, pb); }
  }
  return [best, bestPos];
}

/**
 * Score one indexed name against query tokens. Every token must match some word, else null.
 * Higher is better: exact words > prefixes, matches early in the name, short names. A token of 6+ letters
 * that matches no word may match as two parts (German compounds, see splitWord).
 * @param {string[]} tokens @param {{words: string[], len: number, vars?: Array<string|null>}} entry
 * @returns {number|null}
 */
export function scoreEntry(tokens, entry) {
  const r = scoreName(tokens, entry);
  return r ? r.s : null;
}

/** scoreEntry with `exact` (every token matched a whole word) and `strong` (no token only inside a word). */
function scoreName(tokens, entry) {
  if (!tokens.length) return null;
  const vars = entry.vars;
  let score = 0;
  let exact = true;  // every token a whole word (quality 3, or a compound of two whole words)
  let strong = true; // no token only inside a word (quality ≥ 2)
  for (let t = 0; t < tokens.length; t++) {
    let [best, bestPos] = bestWord(tokens[t], entry.words, vars);
    let split = false;
    if (!best && tokens[t].length >= 2 * SPLIT_MIN) {
      [best, bestPos] = splitWord(tokens[t], entry.words, vars);
      split = true;
    }
    if (!best) return null;
    if (split ? best < SPLIT_EXACT : best < 3) exact = false;
    if (best < 2 && !(split && best >= SPLIT_EXACT)) strong = false;
    score += best * 10;
    score -= Math.min(bestPos, 6) * 2;                  // earlier in the name is better
    if (t === 0 && bestPos === 0 && best >= 2 && !split) score += 15; // name starts with the first query word
  }
  score -= Math.min(entry.words.length, 15);            // fewer extra words
  score -= entry.len / 20;                              // shorter names
  return { s: score, exact, strong };
}

/**
 * Best occurrence of a Han run among a name's segments: [quality, segment index, offset] with quality
 * 3 = the whole segment, 2 = start of a segment, 1 = inside a segment (鸡腿 in 火鸡腿), 0 = none.
 */
function hanMatch(run, segs) {
  let best = 0;
  let at = -1;
  let off = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const p = s.indexOf(run);
    if (p < 0) continue;
    const q = s.length === run.length ? 3 : p === 0 ? 2 : 1;
    if (q > best) { best = q; at = i; off = p; }
    if (q === 3) break;
  }
  return [best, at, off];
}

/** Score of one Han run in a name with its match [quality, segment, offset]. */
function hanRunScore(len, [q, at, off], first) {
  let s = 20 + len * 4 + (q === 3 ? 12 : q === 2 ? 6 : 0);
  s -= Math.min(at, 6) * 2 + Math.min(off, 4);         // earlier segment, earlier in the segment
  if (first && at === 0 && off === 0) s += 15;         // name starts with the query
  return s;
}

/**
 * Score a Chinese (Han) name: every run of Han characters in the query must occur in the name.
 * Whole segments beat segment starts beat matches inside a longer word; earlier segments and shorter names
 * rank higher. A run of 3+ characters that occurs nowhere may match as two parts in the name (鸡腿肉 →
 * 鸡腿 + 肉), scored lower than any direct match. null = no match.
 * @param {string[]} runs normalised Han runs of the query @param {{han?: string}} rec
 */
function scoreHan(runs, rec) {
  const han = rec.han;
  if (!han) return null;
  let segs = null;
  let score = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (han.indexOf(run) >= 0) {
      if (!segs) segs = han.split(' ');
      score += hanRunScore(run.length, hanMatch(run, segs), r === 0);
      continue;
    }
    if (run.length < 3) return null;
    let best = null;
    for (let k = 1; k < run.length; k++) {
      const a = run.slice(0, k);
      const b = run.slice(k);
      if (han.indexOf(a) < 0 || han.indexOf(b) < 0) continue;
      if (!segs) segs = han.split(' ');
      const s = (hanRunScore(a.length, hanMatch(a, segs), false) + hanRunScore(b.length, hanMatch(b, segs), false)) / 2
        - 20 - (Math.min(a.length, b.length) < 2 ? 6 : 0);
      if (best === null || s > best) best = s;
    }
    if (best === null) return null;
    score += best;
  }
  return score - han.length / 2;
}

/**
 * Parse a query once: Latin/digit tokens (word matching) and Han runs (substring matching).
 * @param {string} query
 * @returns {{tokens: string[], runs: string[]}}
 */
export function parseQuery(query) {
  const q = String(query ?? '');
  if (!HAN.test(q)) return { tokens: tokenize(q), runs: [] };
  const runs = (normalize(q).match(HAN_RUNS) || []);
  return { tokens: tokenize(q.replace(HAN_RUNS, ' ')), runs };
}

/**
 * Per-query pre-check data for mayMatch: each token, its stem ("apples" → "apple", "griechischer" → "griechisch")
 * and, for compound splitting, its heads and tails (tails with a leading space: they must start a word).
 * @param {string[]} tokens
 */
function prepareChecks(tokens) {
  return tokens.map((t) => {
    const c = { t, stem: t.length > 1 && /[sn]$/.test(t) ? t.slice(0, -1) : null, heads: null, tails: null };
    if (t.length >= 7) c.stem = t.slice(0, -2); // covers the one-letter stem too (inflected, see wordMatch)
    if (t.length >= 2 * SPLIT_MIN) {
      c.heads = [];
      c.tails = [];
      for (let k = SPLIT_MIN; k <= t.length - 2; k++) {
        // one letter shorter where wordMatch accepts plurals ("puten" matches "Pute")
        c.heads.push(t.slice(0, Math.max(SPLIT_MIN, k - 1)));
        c.tails.push(` ${t.length - k > SPLIT_MIN ? t.slice(k, -1) : t.slice(k)}`);
      }
    }
    return c;
  });
}

/**
 * Cheap pre-check: can every token match some word of this name? (Any match implies the token, its stem,
 * or both parts of a compound split occur in the joined words.) Skips most names per keystroke.
 * @param {ReturnType<typeof prepareChecks>} checks
 */
function mayMatch(checks, rec) {
  const text = rec.text;
  if (text === undefined) return true;
  for (const c of checks) {
    // the token, its stem and every split head start with the shortest of these: one test rejects most names
    if (!text.includes(c.heads ? c.heads[0] : c.stem || c.t)) return false;
    if (text.includes(c.t)) continue;
    if (c.stem && text.includes(c.stem)) continue;
    if (c.heads && maySplit(c, text)) continue;
    return false;
  }
  return true;
}

/** Could the token match as two parts (splitWord)? Both must occur, the second at the start of a word. */
function maySplit({ heads, tails }, text) {
  for (let i = 0; i < heads.length; i++) {
    if (!text.includes(heads[i])) return false; // a longer head cannot occur either
    if (text.includes(tails[i])) return true;
  }
  return false;
}

/**
 * Best match of an index entry (any of its names) for a parsed query, or null: { s, b } with the match class
 * `b` (bucketOf; search() sorts by class, then score) and the score `s`. Latin words and Han runs are matched
 * separately over all names (a mixed query may match its parts in different names). A name of rank > 0
 * (another language) also loses FOREIGN_PENALTY[rank] within its class. Han matches count as whole words.
 */
function scoreItem({ tokens, runs, checks }, entry) {
  const names = entry.alt ? [entry, ...entry.alt] : [entry];
  let latin = null;
  let han = null;
  if (tokens.length) {
    for (const n of names) {
      if (!mayMatch(checks, n)) continue;
      const r = scoreName(tokens, n);
      if (!r) continue;
      const rank = n.rank || 0;
      const m = adjust(r.s, rank, rank ? !r.exact : !r.strong);
      if (!latin || better(m, latin)) latin = m;
    }
    if (!latin) return null;
  }
  if (runs.length) {
    for (const n of names) {
      const s = scoreHan(runs, n);
      if (s === null) continue;
      const m = adjust(s, n.rank || 0, false);
      if (!han || better(m, han)) han = m;
    }
    if (!han) return null;
  }
  if (latin && han) return { s: latin.s + han.s, b: combine(latin.b, han.b) };
  return latin || han;
}

/** Class of a mixed Latin + Han match: loose if either part is, foreign if either part is. */
const combine = (a, b) => (Math.max(a, b) >> 1 << 1) | ((a | b) & 1);
/** A name's match after the language rule (see scoreItem). */
const adjust = (s, rank, looseMatch) => ({ s: s - FOREIGN_PENALTY[rank], b: bucketOf(rank, looseMatch) });
/**
 * Match class, best first: 0 an app-language name (every query word a whole word or the start of one),
 * 1 another language's name, every query word a whole word, 2 an app-language name with a query word only
 * inside a longer word, 3 any other match in another language's name (prefix, inside a word).
 */
const bucketOf = (rank, looseMatch) => (looseMatch ? 2 : 0) + (rank > 0 ? 1 : 0);
/** Is match a better than b (lower class first, then score)? */
const better = (a, b) => (a.b !== b.b ? a.b < b.b : a.s > b.s);

/**
 * Rank items by query. Returns at most `limit` items, best first. Empty query -> [].
 * Queries with Han characters match Chinese names by substring; mixed queries need both parts to match
 * (Latin words against any of the item's names). Items indexed with a tier (indexItem's `opts.tier`) get
 * TIER_BONUS added to their score; an index without tiers ranks as before. Results are sorted by match
 * class first (bucketOf: app language before other languages, see indexItem), so neither the tier bonus nor
 * a short name lifts a match only in another language's name above the app language's.
 * @template T
 * @param {string} query
 * @param {Array<{item: T, words: string[], len: number, tier?: number}>} index from indexItem()
 * @param {{limit?: number}} [opts]
 * @returns {T[]}
 */
export function search(query, index, { limit = 30 } = {}) {
  const parsed = parseQuery(query);
  if (!parsed.tokens.length && !parsed.runs.length) return [];
  parsed.checks = prepareChecks(parsed.tokens);
  const hits = [];
  for (const e of index) {
    const m = scoreItem(parsed, e);
    if (m === null) continue;
    const s = m.s + (e.tier ? TIER_BONUS[e.tier] || 0 : 0);
    hits.push({ s, b: m.b, e });
  }
  hits.sort((a, b) => a.b - b.b || b.s - a.s || a.e.len - b.e.len);
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
 * Read src/data/generic-foods-common.json (curated everyday foods, see generic-foods.README.md) into
 * fdcId → {tier, aliases?}. `aliases` are { text, lang } (lang 'en' | 'de' | 'zh'; null in the older untagged
 * array form). forLanguage() turns an entry into indexItem's third argument. Unknown shapes give an empty map.
 * @param {{groups?: Record<string, Record<string, number>>, aliases?: Record<string, string[]|Record<string, string[]>>}} doc
 * @returns {Map<number, {tier?: number, aliases?: Array<{text: string, lang: string|null}>}>}
 */
export function commonFoodsFromFile(doc) {
  const out = new Map();
  const groups = doc && typeof doc.groups === 'object' && doc.groups ? doc.groups : {};
  for (const g of Object.values(groups)) {
    for (const [id, tier] of Object.entries(g || {})) {
      if (Number.isInteger(tier) && tier > 0) out.set(Number(id), { tier });
    }
  }
  const aliases = doc && typeof doc.aliases === 'object' && doc.aliases ? doc.aliases : {};
  const ok = (s) => typeof s === 'string' && s.trim();
  for (const [id, v] of Object.entries(aliases)) {
    let names = [];
    if (Array.isArray(v)) names = v.filter(ok).map((text) => ({ text, lang: null }));
    else if (v && typeof v === 'object') {
      for (const [lang, list] of Object.entries(v)) if (Array.isArray(list)) names.push(...list.filter(ok).map((text) => ({ text, lang })));
    }
    if (!names.length) continue;
    const key = Number(id);
    out.set(key, { ...(out.get(key) || {}), aliases: names });
  }
  return out;
}

/**
 * A common-foods entry (commonFoodsFromFile) as indexItem's third argument for app language `lang`: aliases
 * ranked by nameRank (a text listed in several languages keeps its best rank).
 * @param {{tier?: number, aliases?: Array<{text: string, lang: string|null}>}|undefined} entry @param {string} lang
 */
export function forLanguage(entry, lang) {
  if (!entry) return undefined;
  if (!entry.aliases) return entry;
  return { ...entry, aliases: entry.aliases.map((a) => ({ text: a.text, rank: nameRank(a.lang, lang) })) };
}

/**
 * Searchable names of a generic food for app language `lang`: the shown name first (rank 0), then English,
 * German, Chinese with their rank (nameRank). `names`: { en, de?, zh? } (missing translations left out); a
 * missing app-language translation shows English, which then counts as the app language.
 * @param {string} lang @param {{en: string, de?: string|null, zh?: string|null}} names
 * @param {string} [shown] the shown name (default: names[lang] or English)
 * @returns {Array<{text: string, rank: number}>}
 */
export function langNames(lang, names, shown) {
  const own = shown || names[lang] || names.en;
  const out = [{ text: own, rank: 0 }];
  for (const l of ['en', 'de', 'zh']) if (names[l]) out.push({ text: names[l], rank: names[l] === own ? 0 : nameRank(l, lang) });
  return out;
}

/**
 * Short hash of the generic foods' fdcId order (FNV-1a 32-bit, hex). A translated names file
 * (src/data/generic-foods.<lang>.json) stores it so a mismatch with generic-foods.json is detectable.
 * @param {Array<number|string>} ids
 */
export function foodIdsHash(ids) {
  let h = 0x811c9dc5;
  const s = ids.join(',');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
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
