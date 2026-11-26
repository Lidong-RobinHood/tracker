// en catalogue, namespace 'common'. Flat 'key': 'text' with {placeholders}; see docs/I18N.md.
export default {
  'common.today': 'Today',
  'common.yesterday': 'Yesterday',
  'common.tomorrow': 'Tomorrow',
  'common.kgPerWeek': '{value} kg / week',
  'common.exportBackup': 'Export backup',
  'common.importBackup': 'Import backup',
  'common.update': 'Update',
  'common.checking': 'Checking…',
  // shared UI helpers (src/ui)
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.confirm.title': 'Are you sure?',
  'common.info.about': 'About {title}',
  'common.number.minusSign': 'Minus sign',
  // backup file check (src/db/db.js validateImport), shown after "Import failed:"
  'common.backupFile.notObject': 'Not a JSON object.',
  'common.backupFile.notTracker': 'This file is not a Tracker export.',
  'common.backupFile.badSchema': 'Missing or invalid schemaVersion.',
  'common.backupFile.newer': 'File is from a newer app version (schema {file}, this app supports {app}). Update the app first.',
  'common.backupFile.noStores': 'File has no stores.',
  'common.backupFile.notList': 'Store "{store}" is not a list.',
  'common.backupFile.missingKey': 'Store "{store}", record {n}: missing "{key}".',
};
