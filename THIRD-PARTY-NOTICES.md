# Third-party notices

This app is written for this project. The third-party material it uses is listed below, with its licence.
The same information is in the app under Settings › About › Licences and data sources.
Last reviewed: 2026-11-19 (app version 0.5.2).

## Bundled code

### barcode-detector 3.2.4
- File: `vendor/barcode-detector/ponyfill.js` (from npm `barcode-detector`, `dist/iife/ponyfill.js`)
- Licence: MIT. Copyright (c) 2023 Ze-Zheng Wu. Full text: `vendor/barcode-detector/LICENSE-barcode-detector.txt`

### zxing-wasm 3.1.7
- Files: JS part bundled in `ponyfill.js`; `vendor/barcode-detector/zxing_reader.wasm`
- zxing-wasm code: MIT. Copyright (c) 2023 Ze-Zheng Wu. Full text: `vendor/barcode-detector/LICENSE-zxing-wasm.txt`
- Compiled into `zxing_reader.wasm`: zxing-cpp (https://github.com/zxing-cpp/zxing-cpp) and `ZXingWasm.cpp`,
  Apache License 2.0. Full text: `vendor/barcode-detector/LICENSE-zxing-cpp.txt`
- The files are unmodified copies of the published npm packages (versions and checksum: `vendor/README.md`).

### Lucide icons
- Source: https://github.com/lucide-icons/lucide (one SVG file per icon from `icons/`, fetched individually
  on 2026-11-19). The element markup of each icon is inlined unmodified in `src/ui/icons.js`, which lists
  every icon used.
- Licence: ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
- Icons derived from Feather (the ones Lucide's LICENSE lists, marked in `src/ui/icons.js`): MIT License,
  Copyright (c) 2013-present Cole Bemis.
- Full text (ISC and the Feather MIT notice, exactly as in Lucide's LICENSE): `vendor/icons/LICENSE-lucide.txt`

### Tabler Icons (barbell icon only)
- Source: https://github.com/tabler/tabler-icons, file `icons/outline/barbell.svg` (fetched 2026-11-19),
  element markup inlined unmodified in `src/ui/icons.js`.
- Licence: MIT License. Copyright (c) 2020-2026 Paweł Kuna. Full text: `vendor/icons/LICENSE-tabler-icons.txt`

## Original artwork
The body map and the muscle icons were drawn for this project; no third-party artwork was used
(`docs/AUTHORSHIP.md`).

## Bundled data

### USDA FoodData Central – SR Legacy (April 2018 release)
- File: `src/data/generic-foods.json` (built with `tools/build-generic-foods.mjs`; a selection of foods and
  fields, values per 100 g, salt calculated from sodium, brand-name foods removed;
  see `src/data/generic-foods.README.md`)
- Licence: public domain, CC0 1.0 Universal.
- Citation: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. fdc.nal.usda.gov.
- Use of this data does not imply endorsement by USDA.

## Online services used at runtime (nothing is bundled)

### Open Food Facts
- Product lookup by barcode and text search via https://world.openfoodfacts.org.
- Contains data from Open Food Facts (https://world.openfoodfacts.org), available under the
  Open Database License (ODbL 1.0, https://opendatacommons.org/licenses/odbl/1-0/). Individual contents are
  under the Database Contents License (https://opendatacommons.org/licenses/dbcl/1-0/).
- The app credits this wherever Open Food Facts data is shown ("Data: Open Food Facts · ODbL", both linked).
- The app does not show or store Open Food Facts product images.
- Open Food Facts data can contain errors and is not for medical use.

### YouTube
- Exercise tutorials link to videos on youtube.com. The videos, titles, channel names and thumbnail images
  belong to their creators and are provided by YouTube. They are not part of this app.

### AI providers (optional; only with the user's own API key)
- Anthropic, Google (Gemini API), OpenAI, or an OpenAI-compatible service chosen by the user.
  The photo and hint go directly from the device to the chosen provider, under that provider's terms.

## Names of other products
MyFitnessPal, Cronometer, FDDB, Yazio, YouTube, Apple Health, Google Fit and other names mentioned in the app or
its documentation are trademarks of their owners. They are named only to describe compatibility (for example
import file formats). This app is not affiliated with or endorsed by them.

## Formulas and reference values
Mifflin-St Jeor equation (Mifflin et al., 1990) for resting energy; common activity factors (1.2–1.9);
7,700 kcal per kg of body-mass change (an approximation); Atwater factors 4/4/9 kcal per g; kJ ÷ 4.184 = kcal;
salt = sodium × 2.5; estimated one-rep maximum by the Epley formula;
muscle recovery ranges as a rule of thumb. These are published facts or methods, used as estimates.
They are not medical advice. The app shows the exact values under Licences and data sources › How the numbers
are calculated.
