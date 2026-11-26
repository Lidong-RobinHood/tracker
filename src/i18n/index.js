// App language: t(key, params), language choice and catalogue loading. See docs/I18N.md.
//
// - Catalogues are flat { 'namespace.key': 'text with {name} placeholders' } objects, one file per
//   namespace and language (src/i18n/<lang>/<ns>.js), so they convert 1:1 to iOS .strings /
//   Android strings.xml later.
// - English is imported statically (always available, the fallback); German / Chinese are loaded with
//   dynamic import() before the first render (initI18n), so there is no flash of English.
// - The choice ('auto' | 'en' | 'de' | 'zh') is kept in localStorage (read synchronously at boot) and
//   mirrored by the app into settings key 'language' so backups carry it (see src/app.js, Settings).
// - No DOM at import time; document / localStorage / navigator are touched only inside functions and
//   guarded, so the module runs under node --test.
import { NAMESPACES } from './namespaces.js';
import enCommon from './en/common.js';
import enApp from './en/app.js';
import enFood from './en/food.js';
import enWorkout from './en/workout.js';
import enSplits from './en/splits.js';
import enTrends from './en/trends.js';
import enSettings from './en/settings.js';
import enImport from './en/import.js';
import enOnboarding from './en/onboarding.js';
import enCore from './en/core.js';
import enInfo from './en/info.js';
import enAnalysis from './en/analysis.js';
import enData from './en/data.js';

export { NAMESPACES };

/** English catalogues by namespace (static: the fallback must never be missing). */
export const EN_CATALOGUES = Object.freeze({
  common: enCommon, app: enApp, food: enFood, workout: enWorkout, splits: enSplits, trends: enTrends,
  settings: enSettings, import: enImport, onboarding: enOnboarding, core: enCore, info: enInfo,
  analysis: enAnalysis, data: enData,
});

/** Languages the app offers, with their names in their own language (never translated). */
export const LANGUAGES = Object.freeze([
  Object.freeze({ code: 'en', name: 'English' }),
  Object.freeze({ code: 'de', name: 'Deutsch' }),
  Object.freeze({ code: 'zh', name: '中文' }),
]);
export const LANGUAGE_CODES = Object.freeze(LANGUAGES.map((l) => l.code));
/** Values the user can choose ('auto' = follow the device). */
export const LANGUAGE_CHOICES = Object.freeze(['auto', ...LANGUAGE_CODES]);
export const DEFAULT_CHOICE = 'auto';
export const FALLBACK = 'en';

/**
 * BCP 47 tag per language, used for <html lang> and Intl (dates, plural rules). Chinese is Simplified
 * for now; changing this one value to 'zh-Hant' switches the tag everywhere.
 */
export const ZH_TAG = 'zh-Hans';
export const LOCALE_TAGS = Object.freeze({ en: 'en', de: 'de', zh: ZH_TAG });

/** localStorage key of the choice (boot cache); settings key that carries it in backups. */
export const STORAGE_KEY = 'tracker.language';
export const SETTING_KEY = 'language';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
export const PLURAL_CATEGORIES = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);

/** Merge namespace objects into one flat dictionary. */
function flatten(byNs) {
  const out = Object.create(null);
  for (const ns of NAMESPACES) Object.assign(out, byNs[ns] || {});
  return out;
}

/** @type {Record<string, Record<string, string>>} language → flat dictionary (loaded ones only) */
const dicts = { en: flatten(EN_CATALOGUES) };
let active = FALLBACK;
let ready = false;
const warned = new Set();
const pluralRules = new Map();

function warnOnce(id, msg) {
  if (warned.has(id)) return;
  warned.add(id);
  if (typeof console !== 'undefined') console.warn(msg);
}

// ---------------------------------------------------------------- choice and detection

/** True for 'auto', 'en', 'de', 'zh'. */
export const isChoice = (v) => LANGUAGE_CHOICES.includes(v);

/**
 * Language for a device's preferred languages (navigator.languages): the first entry that is
 * German or Chinese decides; anything else (or nothing) is English. 'de-AT' → de, 'zh-TW' → zh.
 * @param {readonly string[]|string|null|undefined} prefs
 * @returns {'en'|'de'|'zh'}
 */
export function detectLanguage(prefs) {
  const list = Array.isArray(prefs) ? prefs : prefs ? [prefs] : [];
  for (const raw of list) {
    const base = String(raw || '').toLowerCase().split(/[-_]/)[0];
    if (base === 'de' || base === 'zh') return base;
    if (base === 'en') return 'en';
  }
  return 'en';
}

/** Effective language for a choice: 'auto' (or anything unknown) → detectLanguage(prefs). */
export function resolveLanguage(choice, prefs) {
  return LANGUAGE_CODES.includes(choice) ? choice : detectLanguage(prefs);
}

function navigatorLanguages() {
  try {
    if (typeof navigator === 'undefined') return [];
    if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
    return navigator.language ? [navigator.language] : [];
  } catch { return []; }
}

/** The stored choice ('auto' when nothing valid is stored or storage is blocked). Synchronous. */
export function readStoredChoice() {
  try {
    const v = globalThis.localStorage && globalThis.localStorage.getItem(STORAGE_KEY);
    return isChoice(v) ? v : DEFAULT_CHOICE;
  } catch { return DEFAULT_CHOICE; }
}

function writeStoredChoice(choice) {
  try {
    if (!globalThis.localStorage) return;
    if (choice === DEFAULT_CHOICE) globalThis.localStorage.removeItem(STORAGE_KEY);
    else globalThis.localStorage.setItem(STORAGE_KEY, choice);
  } catch { /* storage blocked: the choice lasts for this page only */ }
}

// ---------------------------------------------------------------- loading

/**
 * Load a language's catalogues (all namespaces; a missing file only warns, its keys fall back to English).
 * @param {string} code
 */
export async function loadLanguage(code) {
  if (dicts[code] || !LANGUAGE_CODES.includes(code)) return;
  const parts = await Promise.all(NAMESPACES.map((ns) => import(`./${code}/${ns}.js`)
    .then((m) => m.default)
    .catch((err) => { warnOnce(`load:${code}/${ns}`, `i18n: ${code}/${ns}.js not loaded (${err && err.message}); using English`); return {}; })));
  dicts[code] = flatten(Object.fromEntries(NAMESPACES.map((ns, i) => [ns, parts[i]])));
}

function apply(code) {
  active = code;
  ready = true;
  try {
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = LOCALE_TAGS[code];
  } catch { /* no document */ }
}

/**
 * Boot: resolve the stored choice, load its catalogues, set <html lang>. Await before the first render.
 * @param {{choice?: string, languages?: readonly string[]}} [opts] overrides for tests
 * @returns {Promise<'en'|'de'|'zh'>}
 */
export async function initI18n({ choice = readStoredChoice(), languages = navigatorLanguages() } = {}) {
  const code = resolveLanguage(choice, languages);
  await loadLanguage(code);
  apply(code);
  return code;
}

/**
 * Store a new choice and make it active (catalogues loaded first). The caller mirrors it into the
 * settings store (backups) and re-renders; the app reloads the page, see settings-view.js.
 * @param {string} choice 'auto' | 'en' | 'de' | 'zh'
 * @param {{languages?: readonly string[]}} [opts]
 * @returns {Promise<'en'|'de'|'zh'>} the effective language
 */
export async function setLanguage(choice, { languages = navigatorLanguages() } = {}) {
  if (!isChoice(choice)) throw new Error(`Unknown language choice: ${choice}`);
  writeStoredChoice(choice);
  const code = resolveLanguage(choice, languages);
  await loadLanguage(code);
  apply(code);
  return code;
}

/** Active language code: 'en' | 'de' | 'zh'. */
export const getLanguage = () => active;
/** The stored choice: 'auto' | 'en' | 'de' | 'zh'. */
export const getLanguageChoice = () => readStoredChoice();
/** BCP 47 tag of the active language for Intl APIs ('zh-Hans' for Chinese). */
export const getLocale = () => LOCALE_TAGS[active];

const collators = new Map();
/**
 * Compare two display texts for an alphabetical list in the app language (Intl.Collator of getLocale():
 * German umlauts next to their base letter, Chinese by pinyin). Use it for every sorted list of names.
 * @param {string} a @param {string} b
 */
export function compareText(a, b) {
  const tag = LOCALE_TAGS[active];
  let c = collators.get(tag);
  if (!c) { c = new Intl.Collator(tag === ZH_TAG ? 'zh-Hans-u-co-pinyin' : tag, { sensitivity: 'base', numeric: true }); collators.set(tag, c); }
  return c.compare(String(a ?? ''), String(b ?? ''));
}

// ---------------------------------------------------------------- lookup

function pluralCategory(code, n) {
  let pr = pluralRules.get(code);
  if (!pr) { pr = new Intl.PluralRules(LOCALE_TAGS[code]); pluralRules.set(code, pr); }
  return pr.select(n);
}

/** Text for key in one language (plural form chosen by count), or undefined. */
function lookup(code, key, count) {
  const d = dicts[code];
  if (!d) return undefined;
  if (typeof count === 'number' && Number.isFinite(count)) {
    const form = d[`${key}_${pluralCategory(code, count)}`] ?? d[`${key}_other`];
    if (form !== undefined) return form;
  }
  return d[key];
}

/** Replace {name} with params.name; unknown placeholders stay visible (easy to spot). */
export function interpolate(text, params) {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (m, name) => (params[name] === undefined || params[name] === null ? m : String(params[name])));
}

/**
 * Translate. `params` fill {name} placeholders (pass numbers already formatted with fmtGrouped etc.
 * when grouping matters). A numeric `params.count` selects the plural form: key_one / key_other
 * (Intl.PluralRules of the active language; Chinese uses only _other).
 * Missing in the active language → English; missing in English → the key itself (warned once).
 * @param {string} key 'namespace.key'
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
  if (!ready && typeof document !== 'undefined') {
    warnOnce(`early:${key}`, `i18n: t('${key}') called before initI18n() (module top level?); it will stay English`);
  }
  const count = params ? params.count : undefined;
  let text = lookup(active, key, count);
  if (text === undefined && active !== FALLBACK) text = lookup(FALLBACK, key, count);
  if (text === undefined) {
    warnOnce(`missing:${key}`, `i18n: missing key "${key}"`);
    return key;
  }
  return interpolate(text, params);
}

/** True when the key (or its plural forms) exists in English. */
export function hasKey(key) {
  const d = dicts.en;
  return d[key] !== undefined || d[`${key}_other`] !== undefined;
}

/** Placeholder names used in a text: 'Hi {name}, {count} sets' → ['count', 'name']. */
export function placeholders(text) {
  return [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** Base key of a plural form ('a.b_one' → 'a.b'), else null. */
export function pluralBase(key) {
  return PLURAL_SUFFIX.test(key) ? key.replace(PLURAL_SUFFIX, '') : null;
}

// ---------------------------------------------------------------- tests only

/** Replace a language's dictionary (tests). @param {string} code @param {Record<string, string>|null} dict */
export function _setDictionary(code, dict) {
  if (dict) dicts[code] = { ...dict };
  else if (code !== FALLBACK) delete dicts[code];
}
/** Make a language active without loading (tests). */
export function _activate(code) { apply(code); }
/** Forget warnings (tests). */
export function _resetWarnings() { warned.clear(); }
