// Exercise form tutorials: "Tutorial" card (exercise detail) and the session menu entry.
// A link only, never an embedded player. The thumbnail on the detail card is the only third-party
// request, made lazily and without a referrer; lists never load thumbnails.
import { el, icon, sectionHeader } from '../ui/index.js';
import { exerciseVideo } from '../core/exercise-video.js';
import { EXERCISE_VIDEOS } from '../data/exercise-videos.js';

/**
 * Thumbnails are hot-linked from YouTube's image host (i.ytimg.com). Whether that is allowed outside the
 * official player is not verified: set to false to show the text and the "Watch on YouTube" link only
 * (no image request at all).
 */
export const SHOW_VIDEO_THUMBNAILS = true;

/** @param {object} ex exercise record */
export const tutorialFor = (ex) => exerciseVideo(ex, EXERCISE_VIDEOS);

const external = (url, props, ...children) =>
  el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', ...props }, ...children);

/** Short description for a one-line sub-label (session menu). */
export function tutorialSub(t) {
  if (t.kind === 'search') return 'YouTube search';
  if (t.kind === 'link') return `Your link · ${t.host}`;
  if (t.source === 'user') return 'Your video · YouTube';
  return [t.title, t.match === 'close' ? 'similar exercise' : null].filter(Boolean).join(' · ') || 'YouTube';
}

/** @param {object} ex exercise record @returns {HTMLElement} the "Tutorial" section */
export function tutorialSection(ex) {
  const t = tutorialFor(ex);
  let body;
  if (t.kind === 'video') {
    let thumb = null;
    if (SHOW_VIDEO_THUMBNAILS) {
      const fallback = el('div', { class: 'wk-thumb-fallback', 'aria-hidden': 'true' },
        icon('circle-play', { size: 28 }), el('span', { class: 't-sub' }, 'Preview unavailable'));
      const img = el('img', {
        class: 'wk-thumb-img', src: t.thumbnail, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', width: '480', height: '360',
      });
      const badge = el('span', { class: 'wk-thumb-badge', 'aria-hidden': 'true' }, icon('play', { size: 22 }));
      img.addEventListener('error', () => { img.hidden = true; badge.hidden = true; fallback.hidden = false; }, { once: true });
      fallback.hidden = true;
      const label = t.title ? `Watch “${t.title}” on YouTube (opens in a new tab)` : 'Watch the video on YouTube (opens in a new tab)';
      thumb = external(t.url, { class: 'wk-thumb', 'aria-label': label, tabindex: '-1' }, fallback, img, badge);
    }
    body = [
      thumb,
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, t.title || (t.source === 'user' ? 'Your tutorial video' : 'Tutorial video')),
        t.channel ? el('div', { class: 't-sub muted' }, t.channel) : null,
        t.source === 'user' ? el('div', { class: 't-sub muted' }, 'Your link') : null,
        t.match === 'close' ? el('div', { class: 't-sub muted' }, 'Shows a close variation.') : null),
      external(t.url, { class: 'btn btn-primary btn-block' }, 'Watch on YouTube', icon('external-link', { size: 16 })),
    ];
  } else if (t.kind === 'link') {
    body = [
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, 'Your tutorial link'),
        el('div', { class: 't-sub muted wk-tut-host' }, t.host)),
      external(t.url, { class: 'btn btn-primary btn-block' }, `Open ${t.host}`, icon('external-link', { size: 16 })),
    ];
  } else {
    body = [
      el('p', { class: 't-sub muted' }, 'No video picked.'),
      external(t.url, { class: 'btn btn-block' }, 'Search YouTube', icon('external-link', { size: 16 })),
    ];
  }
  return el('section', { class: 'section wk-tutorial' },
    sectionHeader('Tutorial'),
    el('div', { class: 'card stack' }, body));
}

/**
 * Session "…" menu entry: a real link (new tab), closes the sheet on click.
 * @param {object} ex exercise record (or { id, name })
 * @param {() => void} onOpen
 */
export function tutorialMenuItem(ex, onOpen) {
  const t = tutorialFor(ex);
  // Close after the click finished: a link removed from the DOM during its click would not navigate.
  return external(t.url, { class: 'list-item', onClick: () => setTimeout(onOpen, 0) },
    icon('circle-play', { class: 'li-lead' }),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, t.kind === 'search' ? 'Watch tutorial (search)' : 'Watch tutorial'),
      el('div', { class: 'li-sub truncate' }, tutorialSub(t))),
    icon('external-link', { class: 'li-chevron' }));
}
