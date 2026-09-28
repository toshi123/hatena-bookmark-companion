import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBadgeCount, isSupportedUrl, sortBookmarks } from '../lib/utils.js';
import { bookmarkStarUri, commentPermalink, summarizeStars, fetchCommentStars } from '../lib/star-api.js';
import { fetchCount, fetchEntry } from '../lib/hatena-api.js';

test('badge formatting and supported URLs', () => {
  for (const [value, expected] of [[0, ''], [1, '1'], [999, '999'], [1000, '1k'], [1280, '1.2k'], [10500, '10k']]) {
    assert.equal(formatBadgeCount(value), expected);
  }
  assert.equal(isSupportedUrl('https://example.com/a?x=1#b'), true);
  assert.equal(isSupportedUrl('chrome://extensions'), false);
  assert.equal(isSupportedUrl('file:///tmp/a.pdf'), false);
});

test('three sort orders and unavailable stars', () => {
  const rows = [
    { user: 'A', starStatus: 'loaded', starTotal: 10, supporterCount: 1, timestamp: '2026-09-26T00:00:00Z' },
    { user: 'B', starStatus: 'loaded', starTotal: 100, supporterCount: 1, timestamp: '2026-09-27T00:00:00Z' },
    { user: 'C', starStatus: 'loaded', starTotal: 2, supporterCount: 15, timestamp: '2026-09-28T00:00:00Z' },
    { user: 'D', starStatus: 'error', starTotal: null, supporterCount: null, timestamp: '2026-09-29T00:00:00Z' },
    { user: 'E', starStatus: 'not-found', starTotal: 0, supporterCount: 0, timestamp: '2026-09-30T00:00:00Z' }
  ];
  assert.deepEqual(sortBookmarks(rows, 'stars').map((row) => row.user), ['B', 'A', 'C', 'E', 'D']);
  assert.deepEqual(sortBookmarks(rows, 'supporters').map((row) => row.user), ['C', 'B', 'A', 'E', 'D']);
  assert.deepEqual(sortBookmarks(rows, 'recent').map((row) => row.user), ['E', 'D', 'C', 'B', 'A']);
  const supportersTie = [
    { user: 'older', starStatus: 'loaded', starTotal: 3, supporterCount: 2, timestamp: '2026-09-26T00:00:00Z' },
    { user: 'more', starStatus: 'loaded', starTotal: 5, supporterCount: 2, timestamp: '2026-09-25T00:00:00Z' }
  ];
  assert.deepEqual(sortBookmarks(supportersTie, 'supporters').map((row) => row.user), ['more', 'older']);
  const starsTie = [
    { user: 'one', starStatus: 'loaded', starTotal: 5, supporterCount: 1, timestamp: '2026-09-27T00:00:00Z' },
    { user: 'three', starStatus: 'loaded', starTotal: 5, supporterCount: 3, timestamp: '2026-09-26T00:00:00Z' }
  ];
  assert.deepEqual(sortBookmarks(starsTie, 'stars').map((row) => row.user), ['three', 'one']);
});

test('yellow repetitions and colored stars count once per user', () => {
  assert.deepEqual(summarizeStars({
    stars: [{ name: 'a', count: 10 }, { name: 'b' }],
    colored_stars: [{ color: 'green', stars: [{ name: 'a' }, { name: 'c', count: 2 }] }]
  }), { starTotal: 14, supporterCount: 3, starColors: { green: 3 } });
  assert.deepEqual(summarizeStars({ stars: [{ name: 'a', count: null }] }),
    { starTotal: 1, supporterCount: 1, starColors: {} });
  assert.equal(commentPermalink('123', 'foo_bar'), 'https://b.hatena.ne.jp/entry/123/comment/foo_bar');
  assert.equal(commentPermalink('bad', 'foo'), null);
  assert.equal(bookmarkStarUri('12345', 'foo', '2026/09/28 12:34:56'), 'https://b.hatena.ne.jp/foo/20260928#bookmark-12345');
  assert.equal(bookmarkStarUri('12345', 'foo', '2026/02/30 12:34:56'), null);
  const query = new URL('https://s.hatena.com/entry.json');
  query.searchParams.append('uri', bookmarkStarUri('12345', 'foo', '2026/09/28 12:34:56'));
  assert.match(query.href, /%23bookmark-12345/);
});

test('count and entry request preserve the page URL', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (seen.length === 1) return new Response('12', { status: 200, headers: { 'content-type': 'application/json' } });
    return Response.json({ title: 'Title', count: 12, eid: 123, entry_url: 'https://b.hatena.ne.jp/entry/example', bookmarks: [
      { user: 'alice', comment: '<b>safe text</b>', tags: ['tag'], timestamp: '2026/09/28 12:00:00' }
    ] });
  };
  const pageUrl = 'https://example.com/article?utm_source=a#section';
  assert.equal(await fetchCount(pageUrl), 12);
  const entry = await fetchEntry(pageUrl);
  assert.equal(entry.bookmarks[0].comment, '<b>safe text</b>');
  assert.equal(entry.eid, '123');
  for (const url of seen) assert.equal(new URL(url).searchParams.get('url'), pageUrl);
});

test('Entry JSON preserves a 19-digit eid for Star URI mapping', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(
    '{"title":"Example","count":62,"eid":4793661180715152706,"bookmarks":[{"user":"mska","comment":"hello","timestamp":"2026/09/28 12:00:00"}]}',
    { headers: { 'content-type': 'application/json' } }
  );
  const entry = await fetchEntry('https://example.com/');
  assert.equal(entry.eid, '4793661180715152706');
  assert.equal(bookmarkStarUri(entry.eid, entry.bookmarks[0].user, entry.bookmarks[0].timestamp),
    'https://b.hatena.ne.jp/mska/20260928#bookmark-4793661180715152706');
});

test('star API batches and leaves failures unknown', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    if (calls === 2) throw new Error('network');
    const uris = new URL(url).searchParams.getAll('uri');
    return Response.json({ entries: uris.map((uri) => ({ uri, stars: [{ name: 'one', count: 2 }] })) });
  };
  const bookmarks = Array.from({ length: 21 }, (_, i) => ({ user: `user${i}`, timestamp: '2026/09/28 12:34:56' }));
  const { result, failedBatches } = await fetchCommentStars('123', bookmarks);
  assert.equal(calls, 2);
  assert.equal(failedBatches, 1);
  assert.deepEqual(result.get(bookmarkStarUri('123', 'user0', bookmarks[0].timestamp)),
    { starStatus: 'loaded', starTotal: 2, supporterCount: 1, starColors: {} });
  assert.deepEqual(result.get(bookmarkStarUri('123', 'user20', bookmarks[20].timestamp)),
    { starStatus: 'error', starTotal: null, supporterCount: null, starColors: null });
});

test('star API matches bookmark URI and treats missing entries as zero', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const first = bookmarkStarUri('153543038', 'trashtoy', '2015/06/05 00:00:00');
  const second = bookmarkStarUri('153543038', 'another', '2015/06/05 00:00:00');
  globalThis.fetch = async (endpoint) => {
    assert.deepEqual(new URL(endpoint).searchParams.getAll('uri'), [first, second]);
    return Response.json({ entries: [{ uri: first, stars: [{ name: 'viewer', count: 3 }] }] });
  };
  const { result, failedBatches, invalidUris } = await fetchCommentStars('153543038', [
    { user: 'trashtoy', timestamp: '2015/06/05 00:00:00' },
    { user: 'another', timestamp: '2015/06/05 00:00:00' }
  ]);
  assert.equal(failedBatches, 0);
  assert.equal(invalidUris, 0);
  assert.equal(result.get(first).starTotal, 3);
  assert.equal(result.get(second).starTotal, 0);
  assert.equal(result.get(second).starStatus, 'not-found');
});

test('unexpected Star URI is a mapping error, not zero stars', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ entries: [{
    uri: 'https://b.hatena.ne.jp/other/20260928#bookmark-123', stars: []
  }] });
  const uri = bookmarkStarUri('123', 'foo', '2026/09/28 12:00:00');
  const { result, mappingErrors } = await fetchCommentStars('123', [{ user: 'foo', timestamp: '2026/09/28 12:00:00' }]);
  assert.equal(mappingErrors, 1);
  assert.equal(result.get(uri).starStatus, 'error');
  assert.equal(result.get(uri).starTotal, null);
});

test('malformed Star entry cannot become a false zero', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => Response.json({ entries: [{ stars: [{ name: 'viewer' }] }] });
  const uri = bookmarkStarUri('123', 'foo', '2026/09/28 12:00:00');
  const { result, mappingErrors } = await fetchCommentStars('123', [{ user: 'foo', timestamp: '2026/09/28 12:00:00' }]);
  assert.equal(mappingErrors, 1);
  assert.equal(result.get(uri).starStatus, 'error');
});

test('badge ignores a delayed response from the previous URL', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; });
  const listeners = {};
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const badge = [];
  globalThis.chrome = {
    action: {
      setBadgeText: async ({ text }) => { badge.push(text); },
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    },
    tabs: {
      onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed'), onReplaced: event('replaced'),
      get: async () => ({ id: 1, active: true, url: 'https://example.com/new' }),
      query: async () => []
    },
    webNavigation: { onHistoryStateUpdated: event('history'), onReferenceFragmentUpdated: event('fragment') },
    windows: { onFocusChanged: event('focus'), WINDOW_ID_NONE: -1 },
    runtime: { onStartup: event('startup'), onInstalled: event('installed'), onMessage: event('message') }
  };
  const pending = new Map();
  globalThis.fetch = (url) => new Promise((resolve) => { pending.set(new URL(url).searchParams.get('url'), resolve); });
  await import(`../background.js?badge-test=${Date.now()}`);
  listeners.updated(1, { url: 'https://example.com/old' }, { active: true, url: 'https://example.com/old' });
  listeners.updated(1, { url: 'https://example.com/new' }, { active: true, url: 'https://example.com/new' });
  await new Promise((resolve) => setImmediate(resolve));
  pending.get('https://example.com/new')(Response.json(7));
  await new Promise((resolve) => setImmediate(resolve));
  pending.get('https://example.com/old')(Response.json(99));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(badge.at(-1), '7');
});

test('Popup count and badge share one count API value and refresh together', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; });
  const listeners = {};
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const badge = [];
  const badgeColors = [];
  const url = 'https://example.com/article';
  let count = 173;
  let requests = 0;
  globalThis.fetch = async (endpoint) => {
    requests += 1;
    assert.equal(new URL(endpoint).searchParams.get('url'), url);
    return Response.json(count);
  };
  globalThis.chrome = {
    action: {
      setBadgeText: async ({ text }) => { badge.push(text); },
      setBadgeBackgroundColor: async ({ color }) => { badgeColors.push(['background', color]); },
      setBadgeTextColor: async ({ color }) => { badgeColors.push(['text', color]); },
      setTitle: async () => {}
    },
    tabs: {
      onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed'), onReplaced: event('replaced'),
      get: async () => ({ id: 5, active: true, url }), query: async () => []
    },
    webNavigation: { onHistoryStateUpdated: event('history'), onReferenceFragmentUpdated: event('fragment') },
    windows: { onFocusChanged: event('focus'), WINDOW_ID_NONE: -1 },
    runtime: { onStartup: event('startup'), onInstalled: event('installed'), onMessage: event('message') }
  };
  await import(`../background.js?shared-count-test=${Date.now()}`);
  const message = (payload) => new Promise((resolve) => {
    assert.equal(listeners.message(payload, {}, resolve), true);
  });
  const first = await message({ type: 'getCount', tabId: 5, url });
  assert.deepEqual(first, { status: 'loaded', count: 173 });
  assert.equal(badge.at(-1), '173');
  assert.deepEqual(badgeColors.slice(-2), [['background', '#01A5DF'], ['text', '#FFFFFF']]);
  assert.equal(requests, 1);
  count = 174;
  const refreshed = await message({ type: 'getCount', tabId: 5, url, force: true });
  assert.deepEqual(refreshed, { status: 'loaded', count: 174 });
  assert.equal(badge.at(-1), '174');
  assert.equal(requests, 2);
});
