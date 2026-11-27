// Inline SVG icons. icon(name, { size, label, class }) -> <svg class="ic"> (no icon font, no CDN, no emoji).
//
// Sources (each file fetched individually from the official repository on 2026-11-19; the element
// markup inside each <svg> is copied unmodified; the outer <svg> attributes of every file were
// viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
// stroke-linejoin="round", which icon() sets again):
//
//   Lucide — https://github.com/lucide-icons/lucide (icons/<name>.svg, branch main)
//   ISC License, Copyright (c) 2026 Lucide Icons and Contributors.
//   Icons used under ISC:
//     activity, book-open, bookmark, camera, chart-line, circle-check, circle-play, cloud-off, copy,
//     droplet, eye, eye-off, file-chart-column, file-text, flame, funnel, globe, grip-vertical, heart-pulse,
//     image, key-round, list, pause, pencil, play, refresh-cw, repeat, rotate-ccw, rotate-ccw-clock,
//     ruler, save, scale, scan-barcode, settings, shield, skip-forward, sliders-horizontal, star, timer,
//     trending-down, trending-up, trophy, undo-2, user, utensils, zap
//   Icons derived from Feather (listed as such in Lucide's LICENSE; MIT License,
//   Copyright (c) 2013-present Cole Bemis):
//     arrow-down, arrow-left, arrow-right, arrow-up, calendar, check, chevron-down, chevron-left,
//     chevron-right, chevron-up, circle, circle-question-mark, clock, download, ellipsis,
//     ellipsis-vertical, external-link, info, link, lock, log-in, minus, plus, search, share, smartphone,
//     target, trash, triangle-exclamation-point, upload, x
//
//   Tabler Icons — https://github.com/tabler/tabler-icons (icons/outline/barbell.svg, branch main)
//   MIT License, Copyright (c) 2020-2026 Paweł Kuna. Icon used: barbell.
//
// Full licence texts: vendor/icons/LICENSE-lucide.txt (ISC + the Feather MIT notice, exactly as in
// Lucide's LICENSE) and vendor/icons/LICENSE-tabler-icons.txt. Listed in THIRD-PARTY-NOTICES.md and
// on Settings › Licences and data sources.
//
// Own icons (drawn for this app on 2026-11-27, no third-party artwork; see docs/AUTHORSHIP.md): hand-palm,
// hand-fist, hand-thumb (hand portions of "Estimate a meal"), cook-steam (steamed / grilled), cook-pan
// (pan-fried), cook-fry (deep-fried); plate-s, plate-m, plate-l (small / normal / large dish portion, plate rims
// of growing size). Same grid and stroke as Lucide: 24 × 24, stroke 2, round caps and
// joins, no fill. They are not from Lucide: do not replace them when icons are fetched again.
//
// globe (2026-11-26, Settings › Language) was added without network access, from Lucide's published
// icons/globe.svg markup as known; compare it with the file the next time icons are fetched.
//
// Adding an icon: fetch https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/<name>.svg,
// copy the elements inside <svg> unchanged into ICONS below (keep the list sorted), add the name to
// the lists above, then run `npm test` (tests/icons.test.js checks every icon('…') in src/ exists).
// Lucide renamed some icons; ALIASES maps the old names used in the design notes to current ones.

const NS = 'http://www.w3.org/2000/svg';

/** @type {Readonly<Record<string, string>>} name -> inner SVG markup (trusted, static) — 84 icons */
const ICONS = Object.freeze({
  'activity': '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  'arrow-down': '<path d="M12 5v14" /><path d="m19 12-7 7-7-7" />',
  'arrow-left': '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
  'arrow-right': '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
  'arrow-up': '<path d="m5 12 7-7 7 7" /><path d="M12 19V5" />',
  'barbell': '<path d="M2 12h1" /><path d="M6 8h-2a1 1 0 0 0 -1 1v6a1 1 0 0 0 1 1h2" /><path d="M6 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" /><path d="M9 12h6" /><path d="M15 7v10a1 1 0 0 0 1 1h1a1 1 0 0 0 1 -1v-10a1 1 0 0 0 -1 -1h-1a1 1 0 0 0 -1 1" /><path d="M18 8h2a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-2" /><path d="M22 12h-1" />',
  'book-open': '<path d="M12 5v16" /><path d="M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z" />',
  'bookmark': '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z" />',
  'calendar': '<path d="M8 2v3" /><path d="M16 2v3" /><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" />',
  'camera': '<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z" /><circle cx="12" cy="13" r="3" />',
  'chart-line': '<path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="m19 9-5 5-4-4-3 3" />',
  'check': '<path d="M20 6 9 17l-5-5" />',
  'chevron-down': '<path d="m6 9 6 6 6-6" />',
  'chevron-left': '<path d="m15 18-6-6 6-6" />',
  'chevron-right': '<path d="m9 18 6-6-6-6" />',
  'chevron-up': '<path d="m18 15-6-6-6 6" />',
  'circle': '<circle cx="12" cy="12" r="10" />',
  'circle-check': '<circle cx="12" cy="12" r="10" /><path d="m16 9-5.5 5.5L8 12" />',
  'circle-play': '<path d="M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z" /><circle cx="12" cy="12" r="10" />',
  'circle-question-mark': '<circle cx="12" cy="12" r="10" /><path d="M9 9.5a3 2.5 0 016 0c0 2-2 2-3 3.5" /><path d="M12 17h.01" />',
  'clock': '<circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />',
  'cloud-off': '<path d="M10.94 5.274A7 7 0 0 1 15.71 10h1.79a4.5 4.5 0 0 1 4.222 6.057" /><path d="M18.796 18.81A4.5 4.5 0 0 1 17.5 19H9A7 7 0 0 1 5.79 5.78" /><path d="m2 2 20 20" />',
  'cook-fry': '<path d="M5 9h14v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" /><path d="M2.5 9H5" /><path d="M19 9h2.5" /><path d="M5 12.5h14" /><circle cx="9" cy="16.5" r="1" /><circle cx="12.5" cy="15.5" r="1" /><circle cx="15.5" cy="16.8" r=".6" /><path d="M10 6c-.6-.8-.6-1.7 0-2.5" /><path d="M14 6c-.6-.8-.6-1.7 0-2.5" />',
  'cook-pan': '<path d="M3 12h13v1.5a4.5 4.5 0 0 1-4.5 4.5h-4A4.5 4.5 0 0 1 3 13.5z" /><path d="M16 13.5h5" /><path d="M7.5 8.5c-.6-.8-.6-1.7 0-2.5" /><path d="M11.5 8.5c-.6-.8-.6-1.7 0-2.5" />',
  'cook-steam': '<path d="M8 3c-1.3 1.3-1.3 2.7 0 4s1.3 2.7 0 4" /><path d="M12 3c-1.3 1.3-1.3 2.7 0 4s1.3 2.7 0 4" /><path d="M16 3c-1.3 1.3-1.3 2.7 0 4s1.3 2.7 0 4" /><path d="M3 15h18" /><path d="M5 15a7 6 0 0 0 14 0" />',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
  'download': '<path d="M12 15V3" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" />',
  'droplet': '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" />',
  'ellipsis': '<circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" />',
  'ellipsis-vertical': '<circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />',
  'external-link': '<path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />',
  'eye': '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" />',
  'eye-off': '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" /><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" /><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" /><path d="m2 2 20 20" />',
  'file-chart-column': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M8 18v-1" /><path d="M12 18v-6" /><path d="M16 18v-3" />',
  'file-text': '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" /><path d="M14 2v5a1 1 0 0 0 1 1h5" /><path d="M10 9H8" /><path d="M16 13H8" /><path d="M16 17H8" />',
  'flame': '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4" />',
  'funnel': '<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />',
  'globe': '<circle cx="12" cy="12" r="10" /><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /><path d="M2 12h20" />',
  'grip-vertical': '<circle cx="9" cy="12" r="1" /><circle cx="9" cy="5" r="1" /><circle cx="9" cy="19" r="1" /><circle cx="15" cy="12" r="1" /><circle cx="15" cy="5" r="1" /><circle cx="15" cy="19" r="1" />',
  'hand-fist': '<path d="M7.5 22v-3.2C5.6 17.6 4.5 15.6 4.5 13.4V9.5A2.5 2.5 0 0 1 7 7h10a2.5 2.5 0 0 1 2.5 2.5v4.2c0 2.3-1.1 4.2-3 5.2V22" /><path d="M9 7v4" /><path d="M12 7v4" /><path d="M15 7v4" /><path d="M4.5 11h15" /><path d="M4.6 14H11a1.5 1.5 0 0 1 0 3H9" />',
  'hand-palm': '<path d="M8 22v-2.6c-1.8-1.1-3-2.7-3.6-4.7l-1-3.3a1.6 1.6 0 0 1 3-1.1L8 13.2V5.5A3.5 3.5 0 0 1 11.5 2h1A3.5 3.5 0 0 1 16 5.5V17c0 1.3-.7 2.4-2 3.1V22" /><path d="M10.7 2.6V8" /><path d="M13.3 2.6V8" />',
  'hand-thumb': '<path d="M8.5 22v-4.5A1.5 1.5 0 0 1 8 16.4V6a4 4 0 0 1 8 0v10.4a1.5 1.5 0 0 1-.5 1.1V22" /><path d="M10.5 8.5V6.8a1.5 1.5 0 0 1 3 0v1.7z" /><path d="M10 13.5h4" />',
  'heart-pulse': '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" /><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27" />',
  'image': '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
  'info': '<circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />',
  'key-round': '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" /><circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />',
  'link': '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
  'list': '<path d="M3 5h.01" /><path d="M3 12h.01" /><path d="M3 19h.01" /><path d="M8 5h13" /><path d="M8 12h13" /><path d="M8 19h13" />',
  'lock': '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  'log-in': '<path d="m10 17 5-5-5-5" /><path d="M15 12H3" /><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />',
  'minus': '<path d="M5 12h14" />',
  'pause': '<rect x="14" y="3" width="5" height="18" rx="1" /><rect x="5" y="3" width="5" height="18" rx="1" />',
  'pencil': '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" /><path d="m15 5 4 4" />',
  'plate-l': '<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="5.5" />',
  'plate-m': '<circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3.5" />',
  'plate-s': '<circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" />',
  'play': '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />',
  'plus': '<path d="M5 12h14" /><path d="M12 5v14" />',
  'refresh-cw': '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" /><path d="M8 16H3v5" />',
  'repeat': '<path d="m17 2 4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" />',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" />',
  'rotate-ccw-clock': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" />',
  'ruler': '<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z" /><path d="m14.5 12.5 2-2" /><path d="m11.5 9.5 2-2" /><path d="m8.5 6.5 2-2" /><path d="m17.5 15.5 2-2" />',
  'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /><path d="M7 3v4a1 1 0 0 0 1 1h7" />',
  'scale': '<path d="M12 3v18" /><path d="m19 8 3 8a5 5 0 0 1-6 0zV7" /><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1" /><path d="m5 8 3 8a5 5 0 0 1-6 0zV7" /><path d="M7 21h10" />',
  'scan-barcode': '<path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M8 7v10" /><path d="M12 7v10" /><path d="M17 7v10" />',
  'search': '<path d="m21 21-4.34-4.34" /><circle cx="11" cy="11" r="8" />',
  'settings': '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" /><circle cx="12" cy="12" r="3" />',
  'share': '<path d="M12 2v13" /><path d="m16 6-4-4-4 4" /><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />',
  'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />',
  'skip-forward': '<path d="M21 4v16" /><path d="M6.029 4.285A2 2 0 0 0 3 6v12a2 2 0 0 0 3.029 1.715l9.997-5.998a2 2 0 0 0 .003-3.432z" />',
  'sliders-horizontal': '<path d="M10 5H3" /><path d="M12 19H3" /><path d="M14 3v4" /><path d="M16 17v4" /><path d="M21 12h-9" /><path d="M21 19h-5" /><path d="M21 5h-7" /><path d="M8 10v4" /><path d="M8 12H3" />',
  'smartphone': '<rect width="14" height="20" x="5" y="2" rx="2" ry="2" /><path d="M12 18h.01" />',
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  'target': '<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />',
  'timer': '<line x1="10" x2="14" y1="2" y2="2" /><line x1="12" x2="15" y1="14" y2="11" /><circle cx="12" cy="14" r="8" />',
  'trash': '<path d="M10 11v6" /><path d="M14 11v6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  'trending-down': '<path d="M16 17h6v-6" /><path d="m22 17-8.5-8.5-5 5L2 7" />',
  'trending-up': '<path d="M16 7h6v6" /><path d="m22 7-8.5 8.5-5-5L2 17" />',
  'triangle-exclamation-point': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" />',
  'trophy': '<path d="M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2" /><path d="M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2" /><path d="M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3" /><path d="M4 22h16" /><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z" /><path d="M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3" />',
  'undo-2': '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  'upload': '<path d="M12 3v12" /><path d="m17 8-5-5-5 5" /><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />',
  'user': '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />',
  'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /><path d="M7 2v20" /><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />',
  'x': '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
  'zap': '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" />',
});

/** Older or alternative names -> current upstream name. */
const ALIASES = Object.freeze({
  'trash-2': 'trash',              // Lucide: trash-2 is a deprecated alias of trash
  history: 'rotate-ccw-clock',     // Lucide: history is a deprecated alias of rotate-ccw-clock
  'alert-triangle': 'triangle-exclamation-point',
  'triangle-alert': 'triangle-exclamation-point',
  'help-circle': 'circle-question-mark',
  'circle-help': 'circle-question-mark',
  'check-circle': 'circle-check',
  filter: 'funnel',
  'more-horizontal': 'ellipsis',
  'more-vertical': 'ellipsis-vertical',
  dumbbell: 'barbell',
});

/** Every name icon() accepts (canonical names first, then aliases). */
export const ICON_NAMES = Object.freeze([...Object.keys(ICONS), ...Object.keys(ALIASES)]);

/** @param {string} name @returns {boolean} */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name) || Object.prototype.hasOwnProperty.call(ALIASES, name);
}

/** Parsed <svg> per canonical name; cloned for every use. */
const cache = new Map();

function template(name) {
  let t = cache.get(name);
  if (!t) {
    // Static markup from this file only (never data), parsed once.
    const src = `<svg xmlns="${NS}">${ICONS[name]}</svg>`;
    const parsed = new DOMParser().parseFromString(src, 'image/svg+xml').documentElement;
    t = document.importNode(parsed, true);
    cache.set(name, t);
  }
  return t;
}

/**
 * @param {string} name icon name (see ICON_NAMES)
 * @param {{size?: number, label?: string, class?: string}} [opts]
 *   size: px, default 20 (24 in the tab bar and icon tabs, 16 inside chips — or set by CSS).
 *   label: accessible name; without it the icon is decorative (aria-hidden).
 * @returns {SVGSVGElement}
 */
export function icon(name, { size, label, class: cls } = {}) {
  const canonical = Object.prototype.hasOwnProperty.call(ICONS, name) ? name : ALIASES[name];
  let svg;
  if (canonical && Object.prototype.hasOwnProperty.call(ICONS, canonical)) {
    svg = /** @type {SVGSVGElement} */ (template(canonical).cloneNode(true));
  } else {
    console.error(`icon(): unknown icon "${name}"`);
    svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
  }
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', cls ? `ic ${cls}` : 'ic');
  svg.setAttribute('data-icon', canonical || name);
  if (size) { svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.style.width = `${size}px`; svg.style.height = `${size}px`; }
  svg.setAttribute('focusable', 'false');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}
