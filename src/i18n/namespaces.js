// Catalogue namespaces: one file per namespace and language (src/i18n/<lang>/<namespace>.js), so
// workers converting different folders never edit the same file. Keys are 'namespace.rest'.
// Adding a namespace: add it here, create src/i18n/en/<ns>.js and import it in index.js
// (EN_CATALOGUES), then de/zh (or list it in PENDING in tests/i18n.test.js until translated).

export const NAMESPACES = Object.freeze([
  'common',     // src/ui/* helpers and words shared by several features (Save, Cancel, Today, units text)
  'app',        // src/app.js: tab bar, router pages, boot errors
  'food',       // src/food/**
  'workout',    // src/workout/**
  'splits',     // src/splits/**
  'trends',     // src/trends/**
  'settings',   // src/settings/**
  'import',     // src/import/**
  'onboarding', // src/onboarding/** (notice strip, welcome, help, install, update)
  'core',       // texts that src/core/* modules describe with keys (UI translates them)
  'info',       // info sheets (src/ui/info-sheets.js): title + paragraphs per sheet id
  'analysis',   // workout analysis, progress, recovery, weekly set targets (src/workout analysis screens)
  'data',       // built-in names: muscles, exercises, splits (looked up by id via src/i18n/names.js)
]);
