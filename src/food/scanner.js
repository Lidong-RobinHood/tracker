// Camera barcode scanner, ported from the phone-tested step-1 test page (removed in 0.5.2).
// Native BarcodeDetector if it supports all four retail formats, else the vendored ZXing ponyfill
// (classic script that sets window.BarcodeDetectionAPI + wasm), loaded lazily on first use.
import { normaliseScan } from '../core/barcode.js';
import { t } from '../i18n/index.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
const CONFIRM_HITS = 2;          // same code must be read in 2 frames before we accept it
const CONFIRM_WINDOW_MS = 2500;
const PONYFILL_URL = new URL('../../vendor/barcode-detector/ponyfill.js', import.meta.url).href;
const WASM_URL = new URL('../../vendor/barcode-detector/zxing_reader.wasm', import.meta.url).href;
const ZX_OVERRIDES = { locateFile: (path, prefix) => (path.endsWith('.wasm') ? WASM_URL : prefix + path) };

/** @type {Promise<{kind: 'native'|'zxing'|'none', detector?: any, note?: string}> | null} */
let decoderPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load the barcode decoder script'));
    document.head.append(s);
  });
}

async function setupZxing(note) {
  if (!window.BarcodeDetectionAPI) await loadScript(PONYFILL_URL);
  const api = window.BarcodeDetectionAPI;
  if (!api || !api.BarcodeDetector) throw new Error('fallback library failed to load');
  // Load the wasm now (it is only fetched once and cached by the browser/service worker).
  await api.prepareZXingModule({ overrides: ZX_OVERRIDES, fireImmediately: true });
  return { kind: 'zxing', detector: new api.BarcodeDetector({ formats: FORMATS }), note };
}

/** Pick the decoder once per page load. `?decoder=zxing` in the hash query forces the fallback. */
export function getDecoder(force) {
  if (!decoderPromise) {
    decoderPromise = (async () => {
      // Notes are diagnostics (not shown as text).
      // i18n-ignore-start (diagnostic notes)
      if (force === 'zxing') return setupZxing('forced');
      if (!('BarcodeDetector' in window)) return setupZxing('no native BarcodeDetector');
      try {
        const fmts = await window.BarcodeDetector.getSupportedFormats();
        const missing = FORMATS.filter((f) => !fmts.includes(f));
        if (missing.length) return setupZxing(`native lacks ${missing.join(',')}`);
        return { kind: 'native', detector: new window.BarcodeDetector({ formats: FORMATS }) };
      } catch (e) {
        return setupZxing(`native failed: ${e && e.message || e}`);
      }
      // i18n-ignore-end
    })();
    decoderPromise.catch(() => { decoderPromise = null; });
  }
  return decoderPromise;
}

/**
 * Camera start failure → status text and code ('blocked': the user can allow the camera; see the info sheet).
 * @returns {{text: string, code: string}}
 */
export function cameraError(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') return { text: t('food.scan.blocked'), code: 'blocked' };
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return { text: t('food.scan.noCamera'), code: 'none' };
  if (n === 'NotReadableError' || n === 'TrackStartError') return { text: t('food.scan.busy'), code: 'busy' };
  if (n === 'SecurityError') return { text: t('food.scan.needsHttps'), code: 'https' };
  return { text: t('food.scan.startFailed', { error: `${n ? `${n} – ` : ''}${e && e.message || e}` }), code: 'other' };
}

/**
 * @param {{video: HTMLVideoElement, onStatus: (msg: string, isError?: boolean, code?: string) => void,
 *          onCode: (code: string, info: {format: string, upcE: string|null, decoder: string}) => void,
 *          onState?: (running: boolean) => void, force?: string}} opts
 */
export function createScanner({ video, onStatus, onCode, onState = () => {}, force }) {
  const st = { stream: null, scanning: false, timer: null, busy: false, candidate: null, errors: 0, decoder: null, destroyed: false, starting: false };

  function stop() {
    st.scanning = false;
    clearTimeout(st.timer);
    st.timer = null;
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
    st.stream = null;
    video.srcObject = null;
    onState(false);
  }

  async function start() {
    if (st.stream || st.starting || st.destroyed) return;
    if (!window.isSecureContext) { onStatus(t('food.scan.needsHttps'), true, 'https'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onStatus(t('food.scan.noAccess'), true, 'none'); return; }
    st.starting = true;
    onStatus(t('food.scan.startingCamera'));
    try {
      // Choose/load the decoder in parallel with the permission prompt.
      const decP = getDecoder(force).then((d) => d, (e) => ({ kind: 'none', note: e && e.message || String(e) }));
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (st.destroyed) { stream.getTracks().forEach((t) => t.stop()); return; }
      st.stream = stream;
      video.srcObject = stream;
      onState(true);
      await video.play().catch(() => { /* muted + playsinline normally suffices */ });
      const dec = await decP;
      if (!st.stream) return;
      if (dec.kind === 'none') { stop(); onStatus(t('food.scan.noDecoder'), true, 'decoder'); return; }
      st.decoder = dec;
      st.scanning = true; st.candidate = null; st.errors = 0;
      onStatus(t('food.scan.point'));
      tick();
    } catch (e) {
      stop();
      const ce = cameraError(e);
      onStatus(ce.text, true, ce.code);
    } finally {
      st.starting = false;
    }
  }

  function tick() {
    if (!st.scanning) return;
    const delay = st.decoder.kind === 'zxing' ? 100 : 80;
    if (st.busy || video.readyState < 2 || !video.videoWidth) { st.timer = setTimeout(tick, delay); return; }
    st.busy = true;
    st.decoder.detector.detect(video).then((codes) => {
      st.busy = false;
      if (!st.scanning) return;
      for (const c of codes) {
        const n = normaliseScan(c.rawValue, c.format);
        if (n && candidate(n, c.format)) return; // accepted -> loop stopped
      }
      st.timer = setTimeout(tick, delay);
    }, (e) => {
      st.busy = false;
      if (!st.scanning) return;
      if (++st.errors >= 5) { stop(); onStatus(t('food.scan.failing'), true, 'failing'); return; }
      st.timer = setTimeout(tick, 300);
    });
  }

  function candidate(n, format) {
    const now = Date.now();
    let c = st.candidate;
    if (!c || c.code !== n.code || now - c.first > CONFIRM_WINDOW_MS) { c = st.candidate = { code: n.code, hits: 1, first: now }; } else c.hits++;
    if (c.hits < CONFIRM_HITS) return false;
    stop();
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch { /* ignore */ } }
    onCode(n.code, { format, upcE: n.upcE, decoder: st.decoder.kind });
    return true;
  }

  const onHidden = () => { if (document.hidden && st.stream) { stop(); onStatus(t('food.scan.paused')); } };
  document.addEventListener('visibilitychange', onHidden);

  return {
    start,
    stop,
    get running() { return Boolean(st.stream); },
    destroy() { st.destroyed = true; stop(); document.removeEventListener('visibilitychange', onHidden); },
  };
}
