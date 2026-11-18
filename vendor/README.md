# Vendored third-party code

Everything here is served as-is from this repo; no CDN is used at runtime.

| File | Source package | Version | Licence |
|---|---|---|---|
| `barcode-detector/ponyfill.js` | [`barcode-detector`](https://www.npmjs.com/package/barcode-detector), file `dist/iife/ponyfill.js` (bundles the JS part of `zxing-wasm`) | 3.2.4 | MIT (`barcode-detector/LICENSE-barcode-detector.txt`) |
| `barcode-detector/zxing_reader.wasm` | [`zxing-wasm`](https://www.npmjs.com/package/zxing-wasm), file `dist/reader/zxing_reader.wasm` | 3.1.7 (the exact version `barcode-detector@3.2.4` depends on) | zxing-wasm glue: MIT (`barcode-detector/LICENSE-zxing-wasm.txt`); compiled-in [zxing-cpp](https://github.com/zxing-cpp/zxing-cpp) and `ZXingWasm.cpp`: Apache-2.0 |

SHA-256 of `zxing_reader.wasm`: `33c8c50be17d0bb05454b4fd3ffb5b5ab9a8e8d1c0ebeb21a1adf4a89c1a8b59`
(matches `ZXING_WASM_SHA256` exported by the bundled JS).

The IIFE build registers `window.BarcodeDetectionAPI` (`BarcodeDetector`, `prepareZXingModule`, ...).
By default it would fetch the `.wasm` from jsDelivr; `app.js` overrides `locateFile` via
`prepareZXingModule({ overrides: { locateFile } })` (documented in the zxing-wasm README,
section "Configuring .wasm Serving") so the file is loaded from this folder via a relative URL.

The `.wasm` must always match the JS version. To update: `npm pack barcode-detector@<v>`, check which
`zxing-wasm` version it depends on, `npm pack zxing-wasm@<that>`, copy the two files above.
