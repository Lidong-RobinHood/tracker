// Text of the importers' messages. src/core/import-*.js return {key, params} objects (they run in a
// worker without catalogues); this turns them into text in the app language. Pure, no DOM (tests use it).
import { t } from '../i18n/index.js';

/**
 * @param {import('../core/import-common.js').ImportMsg|import('../core/import-common.js').ImportMsg[]|string|null|undefined} m
 *   a message; a list of messages (joined with '; '); a param that is a list of strings (quoted names,
 *   joined with ', ') or of numbers (line numbers, joined with ', '); plain text (shown as it is)
 * @returns {string}
 */
export function msgText(m) {
  if (m === null || m === undefined) return '';
  if (typeof m === 'string') return m;
  if (Array.isArray(m)) {
    if (m.every((x) => typeof x === 'number')) return m.join(t('import.sep.names'));
    if (m.every((x) => typeof x === 'string')) return quotedList(m);
    return m.map(msgText).filter(Boolean).join(t('import.sep.list'));
  }
  if (typeof m !== 'object' || typeof m.key !== 'string') return String(m);
  const params = {};
  for (const [k, v] of Object.entries(m.params || {})) params[k] = v !== null && typeof v === 'object' ? msgText(v) : v;
  return t(m.key, params);
}

/** Quoted list of names: „a“, „b“ / “a”、“b” / "a", "b". @param {string[]} names */
export function quotedList(names) {
  return names.map((n) => t('import.quoted', { text: n })).join(t('import.sep.names'));
}
