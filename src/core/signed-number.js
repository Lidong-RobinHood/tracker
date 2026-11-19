// Signed number text without relying on a minus key (the iOS decimal keypad has none). Pure, no DOM.
import { parseDecimal } from './numbers.js';

// Minus-like characters a keyboard or paste may produce: U+2212 minus, U+2012/U+2013/U+2014 dashes,
// U+FE63 small hyphen-minus, U+FF0D fullwidth hyphen-minus, U+2010/U+2011 hyphens.
const MINUS_LIKE = /[\u2212\u2012\u2013\u2014\uFE63\uFF0D\u2010\u2011]/g;

/** Replace typographic minus signs and dashes with ASCII '-'. */
export function normalizeMinus(text) {
  return String(text ?? '').replace(MINUS_LIKE, '-');
}

/** parseDecimal that also accepts '−' (U+2212) and similar dashes as the sign. */
export function parseSigned(text) {
  if (typeof text === 'number') return parseDecimal(text);
  return parseDecimal(normalizeMinus(text));
}

/**
 * Flip the sign of typed text, keeping what the user typed (e.g. '0,5' -> '-0,5', '-2' -> '2').
 * Empty text becomes '-' so the user can type the digits next. A leading '+' is replaced.
 */
export function flipSignText(text) {
  const s = normalizeMinus(text).trim();
  if (s === '') return '-';
  if (s.startsWith('-')) return s.slice(1);
  if (s.startsWith('+')) return `-${s.slice(1)}`;
  return `-${s}`;
}
