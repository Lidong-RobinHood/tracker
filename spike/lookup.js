/* Pure logic: barcode validation, Open Food Facts lookup, product evaluation, report text.
   No DOM access, so it can also be loaded in Node for testing (module.exports at the end). */
(function (root) {
  'use strict';

  var OFF_FIELDS = 'code,product_name,product_name_de,product_name_en,brands,quantity,serving_size,' +
    'nutriments,nutrition_data_per,image_front_small_url';
  var CORE = ['name', 'kcal', 'protein', 'carbs', 'fat'];
  var CORE_LABEL = { name: 'name', kcal: 'kcal', protein: 'protein', carbs: 'carbohydrates', fat: 'fat' };

  // GTIN check digit (EAN-8, UPC-A, EAN-13, GTIN-14)
  function checkDigitOk(code) {
    if (!/^\d+$/.test(code) || [8, 12, 13, 14].indexOf(code.length) < 0) return false;
    var sum = 0, digits = code.slice(0, -1).split('').reverse();
    for (var i = 0; i < digits.length; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 3 : 1);
    return (10 - (sum % 10)) % 10 === Number(code.slice(-1));
  }

  // UPC-E (8 digits incl. number system + check digit) -> UPC-A (12 digits)
  function upcEtoA(e) {
    if (!/^[01]\d{7}$/.test(e)) return null;
    var ns = e[0], d = e.slice(1, 7), chk = e[7], m;
    var last = d[5];
    if (last <= '2') m = d.slice(0, 2) + last + '0000' + d.slice(2, 5);
    else if (last === '3') m = d.slice(0, 3) + '00000' + d.slice(3, 5);
    else if (last === '4') m = d.slice(0, 4) + '00000' + d[4];
    else m = d.slice(0, 5) + '0000' + last;
    return ns + m + chk;
  }

  // Normalise a decoded value to the code we look up. Returns {code, note} or null if unusable.
  function normaliseScan(rawValue, format) {
    var v = String(rawValue || '').trim();
    if (format === 'upc_e' && v.length === 8) {
      var a = upcEtoA(v);
      if (a && checkDigitOk(a)) return { code: a, note: 'UPC-E ' + v + ' expanded' };
      return null;
    }
    if (!checkDigitOk(v)) return null;
    return { code: v, note: '' };
  }

  function num(x) {
    if (x === null || x === undefined || x === '') return null;
    var n = typeof x === 'number' ? x : parseFloat(String(x).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  // Turn an OFF product object into what the UI needs.
  function evaluateProduct(p) {
    var n = (p && p.nutriments) || {};
    var name = (p.product_name || p.product_name_en || p.product_name_de || '').trim() || null;
    var kcal = num(n['energy-kcal_100g']);
    var kcalConverted = false;
    if (kcal === null) {
      var kj = num(n['energy-kj_100g']);
      if (kj === null) kj = num(n['energy_100g']); // OFF stores generic energy in kJ
      if (kj !== null) { kcal = kj / 4.184; kcalConverted = true; }
    }
    var q = (p.quantity || '').trim();
    var perUnit = /\d\s*(ml|cl|dl|l|liter|litre)\b/i.test(q) ? '100 ml' : '100 g';
    var r = {
      code: p.code,
      name: name,
      brands: (p.brands || '').trim() || null,
      quantity: q || null,
      servingSize: (p.serving_size || '').trim() || null,
      perUnit: perUnit,
      image: p.image_front_small_url || null,
      kcal: kcal, kcalConverted: kcalConverted,
      protein: num(n.proteins_100g),
      carbs: num(n.carbohydrates_100g),
      fat: num(n.fat_100g),
      sugars: num(n.sugars_100g),
      satFat: num(n['saturated-fat_100g']),
      fibre: num(n.fiber_100g),
      salt: num(n.salt_100g)
    };
    r.missing = CORE.filter(function (k) { return r[k] === null; }).map(function (k) { return CORE_LABEL[k]; });
    r.outcome = r.missing.length ? 'incomplete' : 'complete';
    return r;
  }

  // Returns {outcome: 'complete'|'incomplete'|'not_found'|'error', product?, error?, httpStatus?}
  function lookup(code, opts) {
    opts = opts || {};
    var fetchFn = opts.fetch || root.fetch;
    var url = 'https://world.openfoodfacts.org/api/v2/product/' + encodeURIComponent(code) + '.json?fields=' + OFF_FIELDS;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 15000) : null;
    return fetchFn(url, { signal: ctrl ? ctrl.signal : undefined, headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (res.status === 429) return { outcome: 'error', error: 'Rate limited by Open Food Facts (HTTP 429). Wait a minute and retry.', httpStatus: 429 };
        // OFF answers "product not found" with HTTP 404 + JSON {status:0}; invalid codes with 200 + {status:0}
        if (res.status === 404 || res.ok) {
          return res.json().then(function (j) {
            if (j && j.status === 1 && j.product) {
              var ev = evaluateProduct(j.product);
              return { outcome: ev.outcome, product: ev };
            }
            if (j && j.status === 0) return { outcome: 'not_found', error: j.status_verbose || 'product not found', httpStatus: res.status };
            return { outcome: 'error', error: 'Unexpected response from Open Food Facts', httpStatus: res.status };
          }, function () {
            return { outcome: 'error', error: 'Response was not valid JSON (HTTP ' + res.status + ')', httpStatus: res.status };
          });
        }
        return { outcome: 'error', error: 'Open Food Facts returned HTTP ' + res.status + (res.status >= 500 ? ' (server problem, try again later)' : ''), httpStatus: res.status };
      }, function (err) {
        var aborted = err && err.name === 'AbortError';
        return { outcome: 'error', error: aborted ? 'Request timed out (no answer within 15 s).' : 'Network error: could not reach Open Food Facts (offline?).' };
      })
      .then(function (r) { if (timer) clearTimeout(timer); return r; });
  }

  function summaryLine(entries) {
    var c = { complete: 0, incomplete: 0, not_found: 0, scan_failed: 0, error: 0 };
    entries.forEach(function (e) { c[e.outcome] = (c[e.outcome] || 0) + 1; });
    return entries.length + ' scanned: ' + c.complete + ' complete, ' + c.incomplete + ' incomplete, ' +
      c.not_found + ' not found, ' + c.scan_failed + ' scan failed' + (c.error ? ', ' + c.error + ' error' : '');
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function entryLine(e) {
    var parts = [fmtTime(e.ts), e.barcode || '-', e.method, e.outcome];
    if (e.name) parts.push(e.name);
    if (e.missing && e.missing.length) parts.push('missing: ' + e.missing.join(', '));
    if (e.kcalConverted) parts.push('kcal converted from kJ');
    if (e.error) parts.push(e.error);
    if (e.note) parts.push('note: ' + e.note);
    return parts.join(' | ');
  }

  function buildReport(entries, diag) {
    var lines = ['Open Food Facts barcode spike - results', summaryLine(entries), ''];
    entries.forEach(function (e) { lines.push(entryLine(e)); });
    lines.push('', 'Decoder: ' + diag.decoder, 'Secure context: ' + diag.secure, 'User agent: ' + diag.ua);
    return lines.join('\n');
  }

  var api = {
    checkDigitOk: checkDigitOk, upcEtoA: upcEtoA, normaliseScan: normaliseScan,
    evaluateProduct: evaluateProduct, lookup: lookup, summaryLine: summaryLine,
    entryLine: entryLine, buildReport: buildReport, fmtTime: fmtTime
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Spike = api;
})(typeof window !== 'undefined' ? window : globalThis);
