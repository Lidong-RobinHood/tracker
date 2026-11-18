// Barcode helpers, ported from the step-1 spike (spike/lookup.js). Pure, no DOM.

/**
 * GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14).
 * @param {string} code digits only
 */
export function checkDigitOk(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.slice(0, -1).split('').reverse();
  let sum = 0;
  for (let i = 0; i < digits.length; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(code.slice(-1));
}

/**
 * UPC-E (8 digits incl. number system + check digit) -> UPC-A (12 digits).
 * @returns {string|null}
 */
export function upcEtoA(e) {
  if (!/^[01]\d{7}$/.test(e)) return null;
  const ns = e[0];
  const d = e.slice(1, 7);
  const chk = e[7];
  const last = d[5];
  let m;
  if (last <= '2') m = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
  else if (last === '3') m = d.slice(0, 3) + '00000' + d.slice(3, 5);
  else if (last === '4') m = d.slice(0, 4) + '00000' + d[4];
  else m = d.slice(0, 5) + '0000' + last;
  return ns + m + chk;
}

/**
 * Normalise a decoded value to the code we look up.
 * @param {string} rawValue decoded text
 * @param {string} [format] BarcodeDetector format, e.g. 'ean_13', 'upc_e'
 * @returns {{code: string, note: string} | null} null if unusable
 */
export function normaliseScan(rawValue, format) {
  const v = String(rawValue ?? '').trim();
  if (format === 'upc_e' && v.length === 8) {
    const a = upcEtoA(v);
    if (a && checkDigitOk(a)) return { code: a, note: `UPC-E ${v} expanded` };
    return null;
  }
  if (!checkDigitOk(v)) return null;
  return { code: v, note: '' };
}
