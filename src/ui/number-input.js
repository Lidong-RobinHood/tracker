// Decimal text field with a numeric keypad. Accepts ',' and '.', selects all on focus.
import { el } from './dom.js';
import { parseDecimal } from '../core/numbers.js';

/**
 * @typedef {HTMLInputElement & {getNumber: () => number|null, setNumber: (n: number|null) => void}} NumberInput
 */

/**
 * @param {{value?: number|null, placeholder?: string, min?: number, max?: number, decimals?: number,
 *          integer?: boolean, class?: string, ariaLabel?: string, id?: string, name?: string,
 *          onInput?: (n: number|null, input: NumberInput) => void,
 *          onChange?: (n: number|null, input: NumberInput) => void}} [opts]
 *   value is shown with at most `decimals` places (default 2). integer: true -> numeric keypad, no separator.
 *   onInput fires on every keystroke; onChange on blur/enter. Both receive the parsed number (null if empty/invalid).
 *   Out-of-range values (min/max) are reported as null and the field gets aria-invalid.
 * @returns {NumberInput}
 */
export function numberInput(opts = {}) {
  const { value = null, placeholder = '', min, max, decimals = 2, integer = false, ariaLabel, onInput, onChange } = opts;
  const input = /** @type {NumberInput} */ (el('input', {
    type: 'text',
    inputmode: integer ? 'numeric' : 'decimal',
    autocomplete: 'off',
    enterkeyhint: 'done',
    class: ['input', 'input-num', opts.class],
    placeholder,
    id: opts.id,
    name: opts.name,
    'aria-label': ariaLabel,
  }));

  const read = () => {
    const n = parseDecimal(input.value);
    if (n === null) return null;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null;
    if (integer && !Number.isInteger(n)) return null;
    return n;
  };
  const validate = () => {
    const bad = input.value.trim() !== '' && read() === null;
    if (bad) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  input.getNumber = read;
  input.setNumber = (n) => {
    input.value = n === null || n === undefined || !Number.isFinite(n) ? '' : String(Number(n.toFixed(integer ? 0 : decimals)));
    validate();
  };
  input.setNumber(value);

  // Keep only characters that can form a number.
  input.addEventListener('input', () => {
    const cleaned = input.value.replace(integer ? /[^\d-]/g : /[^\d.,-]/g, '');
    if (cleaned !== input.value) input.value = cleaned;
    validate();
    if (onInput) onInput(read(), input);
  });
  input.addEventListener('change', () => { if (onChange) onChange(read(), input); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  // Select all on focus. iOS Safari ignores select() inside focus, so also do it on the next tick.
  input.addEventListener('focus', () => {
    input.select();
    setTimeout(() => { if (document.activeElement === input) input.setSelectionRange(0, input.value.length); }, 0);
  });
  return input;
}
