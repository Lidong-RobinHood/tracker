// Decimal text field with a numeric keypad. Accepts ',' and '.', selects all on focus.
// Fields that allow negatives (min < 0) get a sign toggle button: the iOS decimal keypad has no minus key.
import { el } from './dom.js';
import { t } from '../i18n/index.js';
import { parseDecimal } from '../core/numbers.js';
import { normalizeMinus, flipSignText } from '../core/signed-number.js';

/**
 * @typedef {HTMLInputElement & {getNumber: () => number|null, setNumber: (n: number|null) => void,
 *           signToggle?: HTMLButtonElement}} NumberInput
 */

/**
 * @param {{value?: number|null, placeholder?: string, min?: number, max?: number, decimals?: number,
 *          integer?: boolean, class?: string, ariaLabel?: string, id?: string, name?: string,
 *          onInput?: (n: number|null, input: NumberInput) => void,
 *          onChange?: (n: number|null, input: NumberInput) => void}} [opts]
 *   value is shown with at most `decimals` places (default 2). integer: true -> numeric keypad, no separator.
 *   onInput fires on every keystroke; onChange on blur/enter. Both receive the parsed number (null if empty/invalid).
 *   Out-of-range values (min/max) are reported as null and the field gets aria-invalid.
 *   min < 0: a '±' button (input.signToggle) flips the sign; it is placed right before the input once the
 *   input has a parent (the input is wrapped in <span class="num-signed">). '-' and '−' are accepted when typed.
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

  const signed = min !== undefined && min < 0;
  const read = () => {
    const n = parseDecimal(signed ? normalizeMinus(input.value) : input.value);
    if (n === null) return null;
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return null;
    if (integer && !Number.isInteger(n)) return null;
    return n;
  };
  const validate = () => {
    const t = input.value.trim();
    // A lone '-' while typing a negative number is incomplete, not invalid.
    const bad = t !== '' && !(signed && t === '-') && read() === null;
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
    const typed = signed ? normalizeMinus(input.value) : input.value;
    const cleaned = typed.replace(integer ? /[^\d-]/g : /[^\d.,-]/g, '');
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
  if (signed) addSignToggle(input);
  return input;
}

/** '±' button that flips the sign of the typed value (fires input + change like typing would). */
function addSignToggle(input) {
  const btn = /** @type {HTMLButtonElement} */ (el('button', {
    // A toggle: pressed = the value is negative.
    type: 'button', class: 'btn num-sign', 'aria-label': t('common.number.minusSign'), 'aria-pressed': 'false',
    // Keep focus (and the keypad) in the field when the field is being edited.
    onMousedown: (e) => { if (document.activeElement === input) e.preventDefault(); },
    onClick: () => {
      if (input.disabled || input.readOnly) return;
      const wasEmpty = input.value.trim() === '';
      input.value = flipSignText(input.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (wasEmpty) {
        // Caret after the '-' (the focus handler would otherwise select it and the next digit would replace it).
        input.focus();
        setTimeout(() => { if (document.activeElement === input) input.setSelectionRange(input.value.length, input.value.length); }, 0);
      }
    },
  }, '\u00b1'));
  const sync = () => btn.setAttribute('aria-pressed', String(normalizeMinus(input.value).trim().startsWith('-')));
  input.addEventListener('input', sync);
  const setNumber = input.setNumber;
  input.setNumber = (n) => { setNumber(n); sync(); };
  sync();
  input.signToggle = btn;
  // Callers append the input right after creating it; wrap it then. Retry a few frames for late placement.
  let tries = 0;
  const place = () => {
    if (btn.isConnected || btn.parentNode) return;
    const parent = input.parentNode;
    if (!parent) { if (++tries < 30) requestAnimationFrame(place); return; }
    const wrap = el('span', { class: 'num-signed' });
    parent.insertBefore(wrap, input);
    wrap.append(btn, input);
  };
  queueMicrotask(place);
}
