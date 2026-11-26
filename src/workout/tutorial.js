// Exercise form tutorials: "Tutorial" card (exercise detail) and the session menu entry.
// A link only, never an embedded player. The thumbnail on the detail card is the only third-party
// request, made lazily and without a referrer; lists never load thumbnails.
import { el, icon, sectionHeader } from '../ui/index.js';
import { exerciseVideo } from '../core/exercise-video.js';
import { EXERCISE_VIDEOS } from '../data/exercise-videos.js';
import { t } from '../i18n/index.js';

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

/** Short description for a one-line sub-label (session menu). @param {ReturnType<typeof tutorialFor>} v */
export function tutorialSub(v) {
  if (v.kind === 'search') return t('workout.tutorial.subSearch');
  if (v.kind === 'link') return t('workout.tutorial.subLink', { host: v.host });
  if (v.source === 'user') return t('workout.tutorial.subUserVideo');
  return [v.title, v.match === 'close' ? t('workout.tutorial.subSimilar') : null].filter(Boolean).join(' · ') || 'YouTube'; // i18n-ignore: brand
}

/** @param {object} ex exercise record @returns {HTMLElement} the "Tutorial" section */
export function tutorialSection(ex) {
  const v = tutorialFor(ex);
  let body;
  if (v.kind === 'video') {
    let thumb = null;
    if (SHOW_VIDEO_THUMBNAILS) {
      const fallback = el('div', { class: 'wk-thumb-fallback', 'aria-hidden': 'true' },
        icon('circle-play', { size: 28 }), el('span', { class: 't-sub' }, t('workout.tutorial.noPreview')));
      const img = el('img', {
        class: 'wk-thumb-img', src: v.thumbnail, alt: '', loading: 'lazy', decoding: 'async',
        referrerpolicy: 'no-referrer', width: '480', height: '360',
      });
      const badge = el('span', { class: 'wk-thumb-badge', 'aria-hidden': 'true' }, icon('play', { size: 22 }));
      img.addEventListener('error', () => { img.hidden = true; badge.hidden = true; fallback.hidden = false; }, { once: true });
      fallback.hidden = true;
      const label = v.title ? t('workout.tutorial.watchTitled', { title: v.title }) : t('workout.tutorial.watchAria');
      thumb = external(v.url, { class: 'wk-thumb', 'aria-label': label, tabindex: '-1' }, fallback, img, badge);
    }
    body = [
      thumb,
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, v.title || (v.source === 'user' ? t('workout.tutorial.userVideo') : t('workout.tutorial.video'))),
        v.channel ? el('div', { class: 't-sub muted' }, v.channel) : null,
        v.source === 'user' ? el('div', { class: 't-sub muted' }, t('workout.tutorial.yourLink')) : null,
        v.match === 'close' ? el('div', { class: 't-sub muted' }, t('workout.tutorial.close')) : null),
      external(v.url, { class: 'btn btn-primary btn-block' }, t('workout.tutorial.watch'), icon('external-link', { size: 16 })),
    ];
  } else if (v.kind === 'link') {
    body = [
      el('div', { class: 'stack wk-tut-text' },
        el('div', { class: 'wk-tut-title' }, t('workout.tutorial.userLink')),
        el('div', { class: 't-sub muted wk-tut-host' }, v.host)),
      external(v.url, { class: 'btn btn-primary btn-block' }, t('workout.tutorial.open', { host: v.host }), icon('external-link', { size: 16 })),
    ];
  } else {
    body = [
      el('p', { class: 't-sub muted' }, t('workout.tutorial.none')),
      external(v.url, { class: 'btn btn-block' }, t('workout.tutorial.search'), icon('external-link', { size: 16 })),
    ];
  }
  return el('section', { class: 'section wk-tutorial' },
    sectionHeader(t('workout.tutorial.title')),
    el('div', { class: 'card stack' }, body));
}

/**
 * Session "…" menu entry: a real link (new tab), closes the sheet on click.
 * @param {object} ex exercise record (or { id, name })
 * @param {() => void} onOpen
 */
export function tutorialMenuItem(ex, onOpen) {
  const v = tutorialFor(ex);
  // Close after the click finished: a link removed from the DOM during its click would not navigate.
  return external(v.url, { class: 'list-item', onClick: () => setTimeout(onOpen, 0) },
    icon('circle-play', { class: 'li-lead' }),
    el('div', { class: 'li-main' },
      el('div', { class: 'li-title' }, v.kind === 'search' ? t('workout.tutorial.menuSearch') : t('workout.tutorial.menu')),
      el('div', { class: 'li-sub truncate' }, tutorialSub(v))),
    icon('external-link', { class: 'li-chevron' }));
}
