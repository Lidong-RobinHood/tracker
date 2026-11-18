/* UI + camera + log. Depends on lookup.js (window.Spike) and, for the fallback,
   vendor/barcode-detector/ponyfill.js (window.BarcodeDetectionAPI). */
(function () {
  'use strict';
  var S = window.Spike;
  var FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  var LOG_KEY = 'offSpike.log.v1';
  var CONFIRM_HITS = 2;          // same code must be read in 2 frames before we accept it
  var CONFIRM_WINDOW_MS = 2500;
  var REPEAT_BLOCK_MS = 4000;    // ignore the code we just looked up for this long after resuming

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var el = {
    video: $('video'), videoWrap: $('videoWrap'), scanStatus: $('scanStatus'),
    start: $('btnStart'), stop: $('btnStop'), next: $('btnNext'),
    manualForm: $('manualForm'), manualCode: $('manualCode'), manualMsg: $('manualMsg'),
    result: $('result'), failNote: $('failNote'), fail: $('btnFail'), failMsg: $('failMsg'),
    summary: $('summary'), copy: $('btnCopy'), clear: $('btnClear'), copyMsg: $('copyMsg'),
    copyFallback: $('copyFallback'), logList: $('logList'), diag: $('diag')
  };

  var state = {
    decoder: 'pending', decoderNote: '', detector: null, wasm: 'n/a',
    stream: null, scanning: false, timer: null, busy: false,
    candidate: null, lastLooked: null, lastLookedAt: 0, detectErrors: 0
  };

  // ---------- diagnostics ----------
  function secure() { return window.isSecureContext ? 'yes' : 'no'; }
  function renderDiag() {
    el.diag.textContent = 'Decoder: ' + state.decoder + (state.decoderNote ? ' (' + state.decoderNote + ')' : '') +
      (state.decoder === 'zxing' ? ' · wasm: ' + state.wasm : '') +
      ' · Secure context: ' + secure() + ' · UA: ' + navigator.userAgent;
  }
  function diagForReport() {
    return {
      decoder: state.decoder + (state.decoderNote ? ' (' + state.decoderNote + ')' : '') + (state.decoder === 'zxing' ? ', wasm ' + state.wasm : ''),
      secure: secure(), ua: navigator.userAgent
    };
  }

  // ---------- decoder selection ----------
  var wasmUrl = new URL('vendor/barcode-detector/zxing_reader.wasm', document.baseURI).href;
  var ZX_OVERRIDES = {
    locateFile: function (path, prefix) { return path.endsWith('.wasm') ? wasmUrl : prefix + path; }
  };
  var wasmPromise = null;

  function setupZxing(note) {
    var api = window.BarcodeDetectionAPI;
    if (!api || !api.BarcodeDetector) {
      state.decoder = 'none'; state.decoderNote = 'fallback library failed to load';
      return;
    }
    api.prepareZXingModule({ overrides: ZX_OVERRIDES }); // lazy: wasm fetched on first use
    state.detector = new api.BarcodeDetector({ formats: FORMATS });
    state.decoder = 'zxing'; state.decoderNote = note; state.wasm = 'not loaded yet';
  }

  function warmZxing() {
    if (state.decoder !== 'zxing') return Promise.resolve();
    if (!wasmPromise) {
      state.wasm = 'loading'; renderDiag();
      wasmPromise = Promise.resolve(window.BarcodeDetectionAPI.prepareZXingModule({ overrides: ZX_OVERRIDES, fireImmediately: true }))
        .then(function () { state.wasm = 'loaded'; renderDiag(); },
          function (e) { state.wasm = 'FAILED: ' + (e && e.message || e); wasmPromise = null; renderDiag(); throw e; });
    }
    return wasmPromise;
  }

  function chooseDecoder() {
    var force = new URLSearchParams(location.search).get('decoder');
    if (force === 'zxing') { setupZxing('forced via ?decoder=zxing'); return Promise.resolve(); }
    if (!('BarcodeDetector' in window)) { setupZxing('no native BarcodeDetector'); return Promise.resolve(); }
    return Promise.resolve()
      .then(function () { return window.BarcodeDetector.getSupportedFormats(); })
      .then(function (fmts) {
        var missing = FORMATS.filter(function (f) { return fmts.indexOf(f) < 0; });
        var usable = FORMATS.filter(function (f) { return fmts.indexOf(f) >= 0; });
        if (missing.length && !(force === 'native' && usable.length)) { setupZxing('native lacks ' + missing.join(',')); return; }
        state.detector = new window.BarcodeDetector({ formats: usable });
        state.decoder = 'native';
        state.decoderNote = missing.length ? 'forced via ?decoder=native, lacks ' + missing.join(',') : '';
      })
      .catch(function (e) { setupZxing('native failed: ' + (e && e.message || e)); });
  }

  // ---------- camera ----------
  function setStatus(msg, isErr) { el.scanStatus.textContent = msg; el.scanStatus.className = 'status' + (isErr ? ' err' : ''); }
  function show(node, on) { node.hidden = !on; }

  function cameraErrorText(e) {
    var n = e && e.name;
    if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return 'Camera permission denied. Allow camera access for this site in the browser settings (iPhone: Settings › Safari › Camera, or the "aA" menu; Android: lock icon in the address bar › Permissions), then reload.';
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return 'No suitable camera found on this device.';
    if (n === 'NotReadableError' || n === 'TrackStartError') return 'The camera is in use by another app or could not be started. Close other camera apps and retry.';
    if (n === 'SecurityError') return 'Camera blocked for security reasons (page must be opened over https).';
    return 'Could not start camera: ' + (n ? n + ' – ' : '') + (e && e.message || e);
  }

  function startCamera() {
    if (state.decoder === 'pending') { decoderReady.then(startCamera); return; }
    if (!window.isSecureContext) { setStatus('Insecure context: the camera only works over https:// (or localhost). Use manual entry below.', true); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setStatus('This browser does not provide camera access (getUserMedia missing). Use manual entry below.', true); return; }
    if (state.decoder === 'none' || !state.detector) { setStatus('No barcode decoder available: ' + state.decoderNote + '. Use manual entry below.', true); return; }
    if (state.stream) return;
    el.start.disabled = true; show(el.next, false);
    setStatus('Starting camera…');
    // Load the wasm in parallel with the permission prompt, so failures show up immediately.
    var warm = warmZxing().catch(function (e) { return e; });
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).then(function (stream) {
      state.stream = stream;
      el.video.srcObject = stream;
      show(el.videoWrap, true);
      return el.video.play().catch(function () { /* autoplay+muted+playsinline normally suffices */ });
    }).then(function () {
      return warm;
    }).then(function (warmErr) {
      if (!state.stream) return;
      if (warmErr) {
        stopCamera(); show(el.start, true);
        setStatus('Barcode decoder (wasm) failed to load: ' + (warmErr.message || warmErr) + '. Use manual entry.', true);
        return;
      }
      state.scanning = true; state.candidate = null; state.detectErrors = 0;
      show(el.start, false); show(el.stop, true); el.start.disabled = false;
      setStatus('Scanning… point at a barcode (' + state.decoder + ' decoder).');
      tick();
    }).catch(function (e) {
      stopCamera();
      setStatus(cameraErrorText(e), true);
    });
  }

  function stopCamera() {
    state.scanning = false;
    clearTimeout(state.timer); state.timer = null;
    if (state.stream) state.stream.getTracks().forEach(function (t) { t.stop(); });
    state.stream = null;
    el.video.srcObject = null;
    show(el.videoWrap, false); show(el.stop, false);
    el.start.disabled = false;
  }

  function tick() {
    if (!state.scanning) return;
    var delay = state.decoder === 'zxing' ? 100 : 80;
    if (state.busy || el.video.readyState < 2 || !el.video.videoWidth) { state.timer = setTimeout(tick, delay); return; }
    state.busy = true;
    state.detector.detect(el.video).then(function (codes) {
      state.busy = false;
      if (!state.scanning) return;
      for (var i = 0; i < codes.length; i++) {
        var n = S.normaliseScan(codes[i].rawValue, codes[i].format);
        if (n && onCandidate(n, codes[i].format)) return; // accepted -> stop loop
      }
      state.timer = setTimeout(tick, delay);
    }, function (e) {
      state.busy = false;
      state.detectErrors++;
      if (state.detectErrors >= 5) {
        stopCamera(); show(el.start, true);
        setStatus('Decoder keeps failing: ' + (e && e.message || e) + '. Use manual entry.', true);
        return;
      }
      state.timer = setTimeout(tick, 300);
    });
  }

  function onCandidate(n, format) {
    var now = Date.now();
    if (n.code === state.lastLooked && now - state.lastLookedAt < REPEAT_BLOCK_MS) return false;
    var c = state.candidate;
    if (!c || c.code !== n.code || now - c.first > CONFIRM_WINDOW_MS) { state.candidate = { code: n.code, hits: 1, first: now }; c = state.candidate; }
    else c.hits++;
    if (c.hits < CONFIRM_HITS) return false;
    stopCamera();
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) { /* ignore */ } }
    setStatus('Read ' + n.code + ' (' + format + (n.note ? ', ' + n.note : '') + '). Camera paused.');
    show(el.next, true);
    doLookup(n.code, 'camera-' + state.decoder);
    return true;
  }

  // ---------- lookup + result ----------
  var lookupSeq = 0;
  function doLookup(code, method) {
    var seq = ++lookupSeq;
    state.lastLooked = code; state.lastLookedAt = Date.now();
    el.result.hidden = false;
    el.result.innerHTML = '<p>Looking up <b>' + esc(code) + '</b> in Open Food Facts…</p>';
    return S.lookup(code).then(function (r) {
      if (seq !== lookupSeq) return;
      state.lastLookedAt = Date.now();
      renderResult(code, method, r);
      upsert({
        key: code, barcode: code, ts: Date.now(), method: method, outcome: r.outcome,
        name: r.product ? r.product.name : null,
        missing: r.product ? r.product.missing : [],
        kcalConverted: r.product ? r.product.kcalConverted : false,
        error: r.outcome === 'error' ? r.error : (r.outcome === 'not_found' ? r.error : null)
      });
    });
  }

  function fmt(n, unit) {
    var v = n >= 100 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
    return v + ' ' + unit;
  }

  function nutrientRow(label, value, unit, cls, flagMissing, extra) {
    var val = value === null
      ? (flagMissing ? '<span class="missing">MISSING</span>' : '<span class="sub">–</span>')
      : esc(fmt(value, unit)) + (extra || '');
    return '<tr class="' + cls + '"><td>' + esc(label) + '</td><td>' + val + '</td></tr>';
  }

  function renderResult(code, method, r) {
    var badge = '<span class="badge o-' + r.outcome + '">' + r.outcome.replace('_', ' ') + '</span>';
    if (r.outcome === 'not_found') {
      el.result.innerHTML = '<h2>Not found</h2><p class="meta">' + esc(code) + ' · ' + esc(method) + ' ' + badge + '</p>' +
        '<p>Open Food Facts has no product for this barcode (' + esc(r.error || '') + ').</p>' +
        '<p class="hint">If you scanned it, compare the digits with the number printed under the barcode to rule out a misread.</p>';
      return;
    }
    if (r.outcome === 'error') {
      el.result.innerHTML = '<h2>Lookup failed</h2><p class="meta">' + esc(code) + ' · ' + esc(method) + ' ' + badge + '</p>' +
        '<p class="status err">' + esc(r.error) + '</p><button id="btnRetry">Retry lookup</button>';
      $('btnRetry').onclick = function () { doLookup(code, method); };
      return;
    }
    var p = r.product;
    var html = '';
    if (p.image) html += '<img src="' + esc(p.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    html += '<h2>' + (p.name ? esc(p.name) : '<span class="missing">Name MISSING</span>') + '</h2>';
    html += '<p class="meta">' + esc(code) + ' · ' + esc(method) + ' ' + badge + '</p>';
    html += '<p class="meta">Brand: ' + (p.brands ? esc(p.brands) : '–') + '<br>Quantity: ' + (p.quantity ? esc(p.quantity) : '–') +
      '<br>Serving size: ' + (p.servingSize ? esc(p.servingSize) : '–') + '</p>';
    html += '<table><tr><td colspan="2"><b>Per ' + esc(p.perUnit) + '</b></td></tr>';
    html += nutrientRow('Energy', p.kcal, 'kcal', 'core', true, p.kcalConverted ? ' <span class="sub">(converted from kJ)</span>' : '');
    html += nutrientRow('Protein', p.protein, 'g', 'core', true);
    html += nutrientRow('Carbohydrates', p.carbs, 'g', 'core', true);
    html += nutrientRow('Fat', p.fat, 'g', 'core', true);
    html += nutrientRow('of which sugars', p.sugars, 'g', 'minor', false);
    html += nutrientRow('of which saturated fat', p.satFat, 'g', 'minor', false);
    html += nutrientRow('Fibre', p.fibre, 'g', 'minor', false);
    html += nutrientRow('Salt', p.salt, 'g', 'minor', false);
    html += '</table>';
    if (p.missing.length) html += '<p class="missing">Missing: ' + esc(p.missing.join(', ')) + '</p>';
    el.result.innerHTML = html;
  }

  // ---------- log ----------
  var entries = loadLog();
  function loadLog() {
    try { var j = JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); return Array.isArray(j) ? j : []; }
    catch (e) { return []; }
  }
  function saveLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(entries)); return true; }
    catch (e) { el.copyMsg.textContent = 'Warning: could not save log (storage blocked/private mode?). Copy results before closing.'; el.copyMsg.className = 'status err'; return false; }
  }
  function upsert(entry) {
    entries = entries.filter(function (e) { return e.key !== entry.key; });
    entries.unshift(entry);
    saveLog(); renderLog();
  }
  function renderLog() {
    el.summary.textContent = S.summaryLine(entries);
    el.logList.innerHTML = entries.map(function (e) {
      var sub = [S.fmtTime(e.ts), e.method];
      if (e.missing && e.missing.length) sub.push('missing: ' + e.missing.join(', '));
      if (e.kcalConverted) sub.push('kcal converted');
      if (e.error) sub.push(e.error);
      if (e.note) sub.push('note: ' + e.note);
      return '<li><span class="badge o-' + e.outcome + '">' + e.outcome.replace('_', ' ') + '</span> ' +
        '<b>' + esc(e.barcode || 'scan failed') + '</b> ' + (e.name ? esc(e.name) : '') +
        '<div class="sub">' + esc(sub.join(' · ')) + '</div></li>';
    }).join('');
  }

  // ---------- wiring ----------
  el.start.onclick = startCamera;
  el.next.onclick = function () { show(el.next, false); startCamera(); };
  el.stop.onclick = function () { stopCamera(); show(el.start, true); setStatus('Camera is off.'); };

  el.manualForm.onsubmit = function (ev) {
    ev.preventDefault();
    var v = el.manualCode.value.replace(/\s+/g, '');
    el.manualMsg.className = 'status';
    if (!/^\d{8}$|^\d{12,14}$/.test(v)) { el.manualMsg.textContent = 'Enter 8, 12, 13 or 14 digits.'; el.manualMsg.className = 'status err'; return; }
    if (!S.checkDigitOk(v)) { el.manualMsg.textContent = 'Check digit does not match – probably a typo. Please re-check the digits.'; el.manualMsg.className = 'status err'; return; }
    el.manualMsg.textContent = '';
    if (state.stream) { stopCamera(); show(el.start, true); setStatus('Camera is off.'); }
    el.manualCode.blur();
    doLookup(v, 'manual');
  };

  el.fail.onclick = function () {
    var note = el.failNote.value.trim();
    var ts = Date.now();
    upsert({ key: 'fail-' + ts, barcode: null, ts: ts, method: 'camera-' + state.decoder, outcome: 'scan_failed', note: note || null, missing: [] });
    el.failNote.value = '';
    el.failMsg.textContent = 'Logged a scan failure' + (note ? ' (' + note + ')' : '') + '.';
  };

  el.copy.onclick = function () {
    var text = S.buildReport(entries, diagForReport());
    function fallback(reason) {
      el.copyFallback.hidden = false; el.copyFallback.value = text;
      el.copyFallback.focus(); el.copyFallback.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      el.copyMsg.className = 'status';
      el.copyMsg.textContent = ok ? 'Copied (fallback method). Text also shown below.' : 'Automatic copy failed (' + reason + '). Select the text below and copy it manually.';
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        el.copyFallback.hidden = true; el.copyMsg.className = 'status'; el.copyMsg.textContent = 'Copied ' + entries.length + ' entries to the clipboard.';
      }, function (e) { fallback(e && e.name || 'clipboard error'); });
    } else fallback('clipboard API unavailable');
  };

  el.clear.onclick = function () {
    if (!entries.length) return;
    if (!window.confirm('Delete all ' + entries.length + ' log entries? This cannot be undone.')) return;
    entries = []; saveLog(); renderLog();
    el.copyMsg.textContent = 'Log cleared.'; el.copyMsg.className = 'status';
  };

  function pauseForHidden() {
    if (state.stream) { stopCamera(); show(el.start, true); show(el.next, false); setStatus('Camera stopped because the page was hidden. Tap "Start scanning" to resume.'); }
  }
  document.addEventListener('visibilitychange', function () { if (document.hidden) pauseForHidden(); });
  window.addEventListener('pagehide', pauseForHidden);

  renderLog();
  renderDiag();
  if (!window.isSecureContext) setStatus('Insecure context (not https): the camera will not work here. Manual entry still works.', true);
  var decoderReady = chooseDecoder().then(renderDiag);

  // Exposed for debugging/testing only.
  window.__spike = { state: state, doLookup: doLookup, warmZxing: warmZxing };
})();
