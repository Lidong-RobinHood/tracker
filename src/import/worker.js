// Module worker: parses large pastes/files off the UI thread. Pure functions only, no DB.
import { PARSERS } from './parsers.js';

self.onmessage = (e) => {
  const { id, fn, args } = e.data || {};
  try {
    if (!PARSERS[fn]) throw new Error(`Unknown parser ${fn}`);
    self.postMessage({ id, result: PARSERS[fn](...args) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
self.postMessage({ ready: true });
