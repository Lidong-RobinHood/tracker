import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoUrl, exerciseVideo, searchUrl, isVideoId } from '../src/core/exercise-video.js';
import { EXERCISE_VIDEOS } from '../src/data/exercise-videos.js';
import { SEED_EXERCISES } from '../src/data/exercises.js';

const ID = 'dQw4w9WgXcQ';

test('parseVideoUrl: YouTube forms → 11-char id', () => {
  for (const u of [
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://youtube.com/shorts/${ID}?feature=share`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}?rel=0`,
    `https://www.youtube.com/live/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`,
    `  https://youtu.be/${ID}  `,
  ]) {
    const r = parseVideoUrl(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.kind, 'youtube', u);
    assert.equal(r.videoId, ID, u);
    assert.equal(r.url, `https://www.youtube.com/watch?v=${ID}`);
  }
});

test('parseVideoUrl: empty = use default', () => {
  for (const v of ['', '   ', null, undefined]) assert.deepEqual(parseVideoUrl(v), { ok: true, kind: 'none', value: '' });
});

test('parseVideoUrl: other https link kept as plain link', () => {
  const r = parseVideoUrl('https://www.example.com/squat-guide?x=1');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'link');
  assert.equal(r.url, 'https://www.example.com/squat-guide?x=1');
  assert.equal(r.host, 'example.com');
  // A non-video YouTube page is a plain link too.
  assert.equal(parseVideoUrl('https://www.youtube.com/@somechannel').kind, 'link');
});

test('parseVideoUrl: invalid input rejected', () => {
  for (const v of [
    'not a link', 'squat tutorial', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x',
    'http://example.com/video', 'https://localhost/x', 'https://user:pw@example.com/',
    'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch', `https://youtu.be/${ID}x`,
    'https://youtu.be/', 'https://www.youtube.com/shorts/', `https://www.youtube.com/embed/${ID}!`,
    `https://example.com/${'a'.repeat(2100)}`, 42,
  ]) {
    const r = parseVideoUrl(v);
    assert.equal(r.ok, false, String(v).slice(0, 60));
    assert.equal(typeof r.error, 'string');
  }
});

test('exerciseVideo: user link wins over curated', () => {
  const map = { 'seed:x': { videoId: 'aaaaaaaaaaa', title: 'T', channel: 'C', match: 'exact' } };
  const r = exerciseVideo({ id: 'seed:x', name: 'X', videoUrl: `https://youtu.be/${ID}` }, map);
  assert.equal(r.kind, 'video');
  assert.equal(r.source, 'user');
  assert.equal(r.videoId, ID);
  assert.equal(r.thumbnail, `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  const l = exerciseVideo({ id: 'seed:x', name: 'X', videoUrl: 'https://example.org/guide' }, map);
  assert.deepEqual(l, { kind: 'link', source: 'user', url: 'https://example.org/guide', host: 'example.org' });
});

test('exerciseVideo: curated entry, close match', () => {
  const map = { 'seed:x': { videoId: ID, title: ' How to X ', channel: 'Coach', match: 'close' } };
  const r = exerciseVideo({ id: 'seed:x', name: 'X', videoUrl: '' }, map);
  assert.deepEqual(r, {
    kind: 'video', source: 'curated', videoId: ID, url: `https://www.youtube.com/watch?v=${ID}`,
    thumbnail: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`, title: 'How to X', channel: 'Coach', match: 'close',
  });
  assert.equal(exerciseVideo({ id: 'seed:x' }, { 'seed:x': { videoId: ID } }).match, 'exact');
});

test('exerciseVideo: search fallback (no entry, custom, invalid stored link, malformed entry)', () => {
  const name = 'Bench Press (Barbell)';
  const expected = `https://www.youtube.com/results?search_query=${encodeURIComponent('Bench Press (Barbell) proper form tutorial')}`;
  assert.equal(searchUrl(name), expected);
  for (const [ex, map] of [
    [{ id: 'seed:bench-press', name }, {}],
    [{ id: 'seed:bench-press', name }, undefined],
    [{ id: 'custom:1', name, isCustom: true }, { 'seed:bench-press': { videoId: ID } }],
    [{ id: 'seed:bench-press', name, videoUrl: 'garbage' }, {}],
    [{ id: 'seed:bench-press', name }, { 'seed:bench-press': { videoId: 'bad' } }],
    [{ id: 'toString', name }, {}],
  ]) {
    const r = exerciseVideo(ex, map);
    assert.equal(r.kind, 'search');
    assert.equal(r.url, expected);
  }
  assert.equal(exerciseVideo({ name: 'A&B #1' }).url, `https://www.youtube.com/results?search_query=A%26B%20%231%20proper%20form%20tutorial`);
});

test('EXERCISE_VIDEOS data is well-formed (any subset of seed ids)', () => {
  const ids = new Set(SEED_EXERCISES.map((e) => e.id));
  for (const [id, v] of Object.entries(EXERCISE_VIDEOS)) {
    assert.ok(ids.has(id), `unknown exercise id ${id}`);
    assert.ok(isVideoId(v.videoId), `${id}: videoId`);
    assert.ok(typeof v.title === 'string' && v.title.trim(), `${id}: title`);
    assert.ok(typeof v.channel === 'string' && v.channel.trim(), `${id}: channel`);
    assert.ok(v.match === 'exact' || v.match === 'close', `${id}: match`);
    assert.deepEqual(Object.keys(v).sort(), ['channel', 'match', 'title', 'videoId'], `${id}: keys`);
  }
});

test('parseVideoUrl errors are workout catalogue keys; the search query stays English', async () => {
  const { default: EN } = await import('../src/i18n/en/workout.js');
  for (const v of ['not a link', 42, 'https://youtu.be/', 'http://example.com/x', 'https://localhost/x', `https://example.com/${'a'.repeat(2100)}`, 'a b']) {
    const r = parseVideoUrl(v);
    assert.equal(r.ok, false);
    assert.ok(r.error in EN, r.error);
  }
  assert.equal(exerciseVideo({ name: 'Squat' }).query, 'Squat proper form tutorial');
});
