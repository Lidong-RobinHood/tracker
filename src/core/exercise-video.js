// Which tutorial to show for an exercise. Pure (no DOM, no network).
// Priority: the user's own link (exercise.videoUrl) → curated video (src/data/exercise-videos.js)
// → a YouTube search for the exercise name.

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
  'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SHORT_HOSTS = new Set(['youtu.be', 'www.youtu.be']);
const MAX_LEN = 2000;

/** @param {unknown} id */
export const isVideoId = (id) => typeof id === 'string' && ID_RE.test(id);
export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const thumbnailUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const searchUrl = (name) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${name} proper form tutorial`)}`;

/**
 * Parse a user-entered tutorial link.
 * - '' / whitespace → { ok: true, kind: 'none', value: '' } (use the default)
 * - YouTube watch?v=, youtu.be/, /shorts/, /embed/, /live/ → { ok, kind: 'youtube', videoId, url, value }
 * - any other https URL → { ok, kind: 'link', url, host, value }
 * - anything else → { ok: false, error }
 * `value` is what to store as exercise.videoUrl.
 * @param {unknown} input
 */
export function parseVideoUrl(input) {
  if (input === null || input === undefined) return { ok: true, kind: 'none', value: '' };
  if (typeof input !== 'string') return { ok: false, error: 'Not a link.' };
  const text = input.trim();
  if (!text) return { ok: true, kind: 'none', value: '' };
  if (text.length > MAX_LEN) return { ok: false, error: 'Link is too long.' };
  if (/\s/.test(text)) return { ok: false, error: 'A link cannot contain spaces.' };

  // Allow "youtube.com/watch?v=…" / "youtu.be/…" typed without a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text
    : /^(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(text) ? `https://${text}` : text;
  let u;
  try { u = new URL(withScheme); } catch { return { ok: false, error: 'Enter a full link starting with https://' }; }
  const host = u.hostname.toLowerCase();
  const isYt = YT_HOSTS.has(host) || SHORT_HOSTS.has(host);

  if (isYt && (u.protocol === 'https:' || u.protocol === 'http:')) {
    const seg = u.pathname.split('/').filter(Boolean);
    let id = null;
    let videoPath = false;
    if (SHORT_HOSTS.has(host)) { videoPath = true; id = seg[0] ?? null; }
    else if (seg[0] === 'watch') { videoPath = true; id = u.searchParams.get('v'); }
    else if (['shorts', 'embed', 'live', 'v'].includes(seg[0])) { videoPath = true; id = seg[1] ?? null; }
    if (videoPath) {
      if (!isVideoId(id)) return { ok: false, error: 'This YouTube link has no valid video id.' };
      return { ok: true, kind: 'youtube', videoId: id, url: watchUrl(id), value: text };
    }
    // Other YouTube pages (channel, playlist, search) fall through to a plain link if https.
  }
  if (u.protocol !== 'https:') return { ok: false, error: 'Use a secure link starting with https://' };
  if (!host || !host.includes('.') || u.username || u.password) return { ok: false, error: 'This is not a valid web link.' };
  return { ok: true, kind: 'link', url: u.href, host: host.replace(/^www\./, ''), value: text };
}

/**
 * What to show for an exercise's tutorial.
 * @param {{id?: string, name?: string, videoUrl?: string}} exercise
 * @param {Record<string, {videoId: string, title?: string, channel?: string, match?: string}>} [videos]
 * @returns {{kind: 'video', source: 'user'|'curated', videoId: string, url: string, thumbnail: string,
 *            title: string|null, channel: string|null, match: 'exact'|'close'|null}
 *         | {kind: 'link', source: 'user', url: string, host: string}
 *         | {kind: 'search', source: 'search', url: string, query: string}}
 */
export function exerciseVideo(exercise, videos = {}) {
  const ex = exercise || {};
  if (ex.videoUrl) {
    const p = parseVideoUrl(ex.videoUrl);
    if (p.ok && p.kind === 'youtube') {
      return { kind: 'video', source: 'user', videoId: p.videoId, url: p.url, thumbnail: thumbnailUrl(p.videoId), title: null, channel: null, match: null };
    }
    if (p.ok && p.kind === 'link') return { kind: 'link', source: 'user', url: p.url, host: p.host };
    // Invalid stored value (e.g. from an import): ignore it.
  }
  const v = ex.id && videos && Object.prototype.hasOwnProperty.call(videos, ex.id) ? videos[ex.id] : null;
  if (v && isVideoId(v.videoId)) {
    return {
      kind: 'video', source: 'curated', videoId: v.videoId, url: watchUrl(v.videoId), thumbnail: thumbnailUrl(v.videoId),
      title: typeof v.title === 'string' && v.title.trim() ? v.title.trim() : null,
      channel: typeof v.channel === 'string' && v.channel.trim() ? v.channel.trim() : null,
      match: v.match === 'close' ? 'close' : 'exact',
    };
  }
  const query = `${(ex.name || 'exercise').trim()} proper form tutorial`;
  return { kind: 'search', source: 'search', url: searchUrl((ex.name || 'exercise').trim()), query };
}
