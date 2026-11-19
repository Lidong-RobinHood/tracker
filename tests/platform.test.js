import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, isStandalone } from '../src/core/platform.js';

const UA = {
  iosSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iosChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iosFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  iosInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 357.0.0.25.101 (iPhone15,2; iOS 18_1; en_US; en; scale=3.00; 1179x2556; 658490017)',
  iosFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/490.0.0.40.107;FBBV/668380123]',
  iosWebView: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iosGoogleApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/344.0.692074133 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0',
  androidWhatsApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 WhatsApp/2.24.23.78',
  androidInstagram: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 357.0.0.25.101 Android',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
};

test('iOS Safari → Add to Home Screen guidance', () => {
  const p = detectPlatform(UA.iosSafari);
  assert.deepEqual(p, { os: 'ios', browser: 'safari', inApp: null, standalone: false, install: 'ios-safari' });
});

test('other iOS browsers are ios-other', () => {
  assert.equal(detectPlatform(UA.iosChrome).install, 'ios-other');
  assert.equal(detectPlatform(UA.iosChrome).browser, 'chrome');
  assert.equal(detectPlatform(UA.iosFirefox).browser, 'firefox');
});

test('iPadOS with a Mac user agent is iOS only with a touch screen', () => {
  assert.equal(detectPlatform(UA.ipadOS, { maxTouchPoints: 5 }).install, 'ios-safari');
  assert.equal(detectPlatform(UA.ipadOS, { maxTouchPoints: 0 }).install, 'desktop');
});

test('in-app browsers are recognised by name, unknown web views generically', () => {
  assert.equal(detectPlatform(UA.iosInstagram).install, 'in-app');
  assert.equal(detectPlatform(UA.iosInstagram).inApp, 'Instagram');
  assert.equal(detectPlatform(UA.iosFacebook).inApp, 'Facebook');
  assert.equal(detectPlatform(UA.iosGoogleApp).inApp, 'Google app');
  assert.equal(detectPlatform(UA.iosWebView).inApp, 'another app');
  assert.equal(detectPlatform(UA.androidWhatsApp).inApp, 'WhatsApp');
  assert.equal(detectPlatform(UA.androidInstagram).install, 'in-app');
  assert.equal(detectPlatform(UA.androidWebView).install, 'in-app');
  assert.equal(detectPlatform(UA.androidWebView).inApp, 'another app');
});

test('Android browsers', () => {
  assert.deepEqual(detectPlatform(UA.androidChrome), { os: 'android', browser: 'chrome', inApp: null, standalone: false, install: 'android' });
  assert.equal(detectPlatform(UA.androidSamsung).browser, 'samsung');
  assert.equal(detectPlatform(UA.androidFirefox).browser, 'firefox');
  assert.equal(detectPlatform(UA.androidFirefox).install, 'android');
});

test('desktop browsers', () => {
  assert.equal(detectPlatform(UA.macChrome).install, 'desktop');
  assert.equal(detectPlatform(UA.macSafari).browser, 'safari');
  assert.equal(detectPlatform(UA.winEdge).browser, 'edge');
  assert.equal(detectPlatform('').install, 'desktop');
});

test('standalone wins over everything', () => {
  for (const ua of [UA.iosSafari, UA.androidChrome, UA.macChrome, UA.iosWebView]) {
    const p = detectPlatform(ua, { standalone: true });
    assert.equal(p.install, 'standalone');
    assert.equal(p.standalone, true);
  }
});

test('isStandalone from display mode or navigator.standalone', () => {
  assert.equal(isStandalone({ displayMode: 'standalone' }), true);
  assert.equal(isStandalone({ displayMode: 'fullscreen' }), true);
  assert.equal(isStandalone({ displayMode: 'minimal-ui' }), true);
  assert.equal(isStandalone({ displayMode: 'browser' }), false);
  assert.equal(isStandalone({ navigatorStandalone: true }), true);
  assert.equal(isStandalone({ navigatorStandalone: false, displayMode: 'browser' }), false);
  assert.equal(isStandalone(), false);
});
