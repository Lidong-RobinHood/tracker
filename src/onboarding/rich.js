// Translated sentences with links or bold words inside: the catalogue text keeps {name} slots and the
// nodes are put in their place, so each language keeps its own word order.
//   rich('onboarding.help.foodIntro', { diary: el('a', …, t('onboarding.help.diaryLink')) })
import { t } from '../i18n/index.js';

/**
 * @param {string} key catalogue key
 * @param {Record<string, Node|string>} nodes slot name → node
 * @param {Record<string, string|number>} [params] ordinary text placeholders
 * @returns {(Node|string)[]}
 */
export function rich(key, nodes, params) {
  const text = t(key, params);
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/\{(\w+)\}/g)) {
    if (!Object.prototype.hasOwnProperty.call(nodes, m[1])) continue;
    out.push(text.slice(last, m.index), nodes[m[1]]);
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out.filter((x) => x !== '');
}
