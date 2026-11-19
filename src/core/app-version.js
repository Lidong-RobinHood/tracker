// App version helpers for the update check. Pure, no DOM.
// The deployed version is read from the text of src/version.js (fetched without any cache) and
// compared with the APP_VERSION the running page was loaded with.

/**
 * Read APP_VERSION from the source text of src/version.js.
 * @param {string} text
 * @returns {string|null}
 */
export function parseAppVersion(text) {
  const m = /export\s+const\s+APP_VERSION\s*=\s*(['"])([^'"\s]{1,40})\1/.exec(String(text || ''));
  return m ? m[2] : null;
}

/**
 * Compare dotted versions numerically ('0.10.0' > '0.9.3'). Non-numeric parts compare as text.
 * @returns {-1|0|1}
 */
export function compareVersions(a, b) {
  const pa = String(a).split('.');
  const pb = String(b).split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = /^\d+$/.test(x) ? Number(x) : NaN;
    const ny = /^\d+$/.test(y) ? Number(y) : NaN;
    const c = Number.isNaN(nx) || Number.isNaN(ny) ? (x < y ? -1 : x > y ? 1 : 0) : Math.sign(nx - ny);
    if (c) return /** @type {-1|1} */ (c);
  }
  return 0;
}

/**
 * Should the app offer to reload? Any difference counts (also a rolled-back release), so nobody
 * stays on a version that is no longer deployed. Unknown remote (offline, parse error) → false.
 * @param {string|null} deployed version found on the server
 * @param {string} running version of the loaded code
 */
export function updateAvailable(deployed, running) {
  return typeof deployed === 'string' && deployed !== '' && compareVersions(deployed, running) !== 0;
}

/**
 * Throttle for background checks: check when the page becomes visible and the last check is older
 * than `minGapMs`. @returns {boolean}
 */
export function checkDue(lastCheckAt, now, minGapMs = 10 * 60 * 1000) {
  return !(typeof lastCheckAt === 'number' && now - lastCheckAt >= 0 && now - lastCheckAt < minGapMs);
}
