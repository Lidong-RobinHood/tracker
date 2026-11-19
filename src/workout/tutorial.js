// Exercise form tutorials: "Tutorial" card (exercise detail) and the session menu entry.
// A link only, never an embedded player. The thumbnail on the detail card is the only third-party
// request, made lazily and without a referrer; lists never load thumbnails.
import { el } from '../ui/index.js';
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
  if (t.kind === 'search') return 'Search YouTube (no specific video chosen)';
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
        el('span', { class: 'wk-thumb-play' }, '▶'), el('span', { class: 'small' }, 'Preview unavailable'));
      const img = el('img', {
        class: 'wk-thumb-img', src: t.thumbnail, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', width: '480', height: '360',
      });
      const badge = el('span', { class: 'wk-thumb-badge', 'aria-hidden': 'true' }, '▶');
      img.addEventListener('error', () => { img.hidden = true; badge.hidden = true; fallback.hidden = false; }, { once: true });
      fallback.hidden = true;
      const label = t.title ? `Watch “${t.title}” on YouTube (opens in a new tab)` : 'Watch the video on YouTube (opens in a new tab)';
      thumb = external(t.url, { class: 'wk-thumb', 'aria-label': label, tabindex: '-1' }, fallback, img, badge);
    }
    body = [
      thumb,
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, t.title || (t.source === 'user' ? 'Your tutorial video' : 'Tutorial video')),
        t.channel ? el('div', { class: 'small muted' }, t.channel) : null,
        t.source === 'user' ? el('div', { class: 'small muted' }, 'Your own link · change it under Details') : null,
        t.match === 'close'
          ? el('p', { class: 'wk-tut-note small' }, 'Similar exercise: this video shows a close variation, the form cues still apply.')
          : null),
      external(t.url, { class: 'btn btn-primary btn-block' }, 'Watch on YouTube ↗'),
    ];
  } else if (t.kind === 'link') {
    body = [
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, 'Your tutorial link'),
        el('div', { class: 'small muted wk-tut-host' }, t.host)),
      external(t.url, { class: 'btn btn-primary btn-block' }, `Open ${t.host} ↗`),
    ];
  } else {
    body = [
      el('p', { class: 'small muted' },
        'No specific video picked for this exercise yet. Search YouTube, or paste a video you like into "Tutorial link" under Details.'),
      external(t.url, { class: 'btn btn-block' }, 'Search YouTube for a tutorial ↗'),
    ];
  }
  return el('section', { class: 'section wk-tutorial' },
    el('h2', { class: 'section-title' }, 'Tutorial'),
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
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, t.kind === 'search' ? 'Watch tutorial (search)' : 'Watch tutorial'),
      el('div', { class: 'li-sub truncate' }, tutorialSub(t))),
    el('span', { class: 'li-chevron', 'aria-hidden': 'true' }, '↗'));
}
