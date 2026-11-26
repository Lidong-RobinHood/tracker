// Translated names of the bundled generic (USDA) foods: validation of a names file and display lookup.
// Pure, no DOM / fetch. Files: src/data/generic-foods.<lang>.json (see src/data/generic-foods.README.md).
// Records keep the English USDA name (no migration, backups unchanged); the UI shows the translated name
// at display time, looked up by the record's sourceKey ('usda:<fdcId>'), unless the user renamed the food.
import { foodIdsHash } from './food-search.js';

/**
 * Short hash of an English USDA name (FNV-1a 32-bit, base 36). A names file stores it per food, so a stored
 * food can be checked for "still the USDA name" (not renamed) without loading generic-foods.json.
 * @param {string} name
 */
export function nameHash(name) {
  let h = 0x811c9dc5;
  const s = String(name ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Check a translated names file and build sourceKey → {h, name} (h = nameHash of the English name). The file
 * is self-contained (its own fdcIds and English-name hashes), so the diary can show translated names without
 * the 0.8 MB base file. With `baseIds` (generic-foods.json loaded for search) it must match the base order too.
 * @param {any} doc parsed generic-foods.<lang>.json ({lang, count, idsHash, ids, en, names})
 * @param {string} [lang] expected language (checked when the file says)
 * @param {Array<number|string>|null} [baseIds] fdcIds in the order of generic-foods.json, when loaded
 * @returns {{ok: true, names: Map<string, {h: string, name: string}>} | {ok: false, reason: string}}
 *   reason: for a console warning
 */
// i18n-ignore-start (reasons are console diagnostics, not UI)
export function namesFromFile(doc, lang, baseIds = null) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.names)) return { ok: false, reason: 'no names array' };
  if (lang && doc.lang && doc.lang !== lang) return { ok: false, reason: `language ${doc.lang}, expected ${lang}` };
  const { ids, en, names } = doc;
  if (!Array.isArray(ids) || !Array.isArray(en)) return { ok: false, reason: 'no ids / en arrays (old format)' };
  if (doc.count !== ids.length || names.length !== ids.length || en.length !== ids.length) {
    return { ok: false, reason: `count ${doc.count}: ${ids.length} ids, ${en.length} hashes, ${names.length} names` };
  }
  const hash = foodIdsHash(ids);
  if (doc.idsHash !== hash) return { ok: false, reason: `idsHash ${doc.idsHash}, its ids give ${hash}` };
  if (baseIds && foodIdsHash(baseIds) !== hash) return { ok: false, reason: `idsHash ${hash}, base file ${foodIdsHash(baseIds)}` };
  const out = new Map();
  ids.forEach((id, i) => {
    const n = names[i];
    if (typeof n === 'string' && n.trim()) out.set(`usda:${id}`, { h: String(en[i] ?? ''), name: n.trim() });
  });
  return { ok: true, names: out };
}
// i18n-ignore-end

/**
 * Translated name of a generic food (record or search item), or null: not a generic food, unknown id, or the
 * food was renamed (its name is no longer the English USDA name: the user's own name always wins).
 * Edited values alone (userEdited) keep the translation.
 * @param {{source?: string, sourceKey?: string|null, name?: string}|null|undefined} food
 * @param {Map<string, {h: string, name: string}>|null|undefined} names from namesFromFile
 */
export function localFoodName(food, names) {
  if (!food || !names || food.source !== 'usda' || !food.sourceKey) return null;
  const n = names.get(food.sourceKey);
  return n && nameHash(food.name) === n.h ? n.name : null;
}

/**
 * Translated name of a diary entry or saved-meal item (snapshots with `foodId` and the name at the time),
 * or null. Only when its stored food is a generic food and the snapshot still has that food's English USDA
 * name: a name changed in the entry editor wins.
 * @param {{name?: string, foodId?: string|null}} item
 * @param {object|null|undefined} food the stored food with id item.foodId
 * @param {Map<string, {h: string, name: string}>|null|undefined} names
 */
export function localItemName(item, food, names) {
  if (!item || !food || !item.foodId || item.foodId !== food.id) return null;
  return localFoodName({ source: food.source, sourceKey: food.sourceKey, name: item.name }, names);
}
