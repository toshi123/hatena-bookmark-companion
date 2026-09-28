import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { readFile } from 'node:fs/promises';
import { assessCommentCompleteness } from '../lib/public-comments.js';
import { loadPublicComments } from '../lib/public-comments.js';
import { commentCountDisplay } from '../lib/comment-display.js';
import { getMyBookmark } from '../lib/account.js';

const url = 'https://example.com/article';
const account = { consumerKey: 'key', consumerSecret: 'secret', accessToken: 'token', accessTokenSecret: 'token-secret' };
globalThis.DOMParser = DOMParser;

test('public list, not headline, determines comment completeness', () => {
  const assess = (headlineCommentCount, publicAvailableCommentCount, extensionCommentCount) =>
    assessCommentCompleteness({ headlineCommentCount, publicAvailableCommentCount, extensionCommentCount });
  assert.deepEqual([assess(50, 47, 47).incomplete, assess(50, 47, 43).incomplete,
    assess(47, 47, 47).incomplete], [false, true, false]);
  assert.equal(assess(50, 47, 43).incompleteReason, 'fallback-partial');
  assert.equal(assess(50, 47, 47).countMismatch, true);
  assert.equal(assessCommentCompleteness({ headlineCommentCount: 50, publicAvailableCommentCount: null,
    extensionCommentCount: 43, retrievalFailed: true }).unverified, true);
  assert.deepEqual(commentCountDisplay(47, 47, 50), {
    label: '47 コメント ⓘ',
    title: '公開一覧として取得できるコメントは47件です。はてな公式の集計表示は50件です。'
  });
  assert.equal(commentCountDisplay(43, 47, 50).label, '43 / 47 コメント ⓘ');
});

test('pagination continues until cursor is exhausted even after passing headline count', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const record = (user) => ({ user: { name: user }, comment: user, location_id: '123', url, tags: [] });
  let pages = 0;
  globalThis.fetch = async (endpoint) => {
    const path = String(endpoint);
    if (path.includes('jsonlite')) return Response.json({ url, eid: '123', count: 2, bookmarks: [] });
    if (path.includes('/api/entry/')) {
      pages += 1;
      return pages === 1 ? Response.json({ cursor: 'next', bookmarks: [record('a'), record('b')] }) :
        Response.json({ cursor: null, bookmarks: [record('c')] });
    }
    return new Response(`<h3 class="entry-comment-title">記事へのコメント<span>2</span>件</h3>
      <div class="js-bookmark-autoloader-recent" data-autoload-url="${url}"></div>`);
  };
  const result = await loadPublicComments(url);
  assert.equal(pages, 2);
  assert.equal(result.publicAvailableCommentCount, 3);
  assert.equal(result.extensionCommentCount, 3);
  assert.equal(result.incomplete, false);
});

test('saved misdo responses render 47 comments without an incomplete warning', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const root = new URL('../diagnostics/misdo-yamucha-2026-09-28/raw/', import.meta.url);
  const [jsonlite, html, api] = await Promise.all([
    readFile(new URL('hatena-misdo-json.json', root), 'utf8'),
    readFile(new URL('hatena-misdo-html.html', root), 'utf8'),
    readFile(new URL('hatena-misdo-api-page1.json', root), 'utf8')
  ]);
  globalThis.fetch = async (endpoint) => {
    const path = String(endpoint);
    return new Response(path.includes('jsonlite') ? jsonlite : path.includes('/api/entry/') ? api : html);
  };
  const result = await loadPublicComments('https://dailyportalz.jp/kiji/misdo-yamucha');
  assert.equal(result.headlineCommentCount, 50);
  assert.equal(result.publicAvailableCommentCount, 47);
  assert.equal(result.extensionCommentCount, 47);
  assert.equal(result.incomplete, false);
  assert.equal(result.diagnostics.apiPages[0].cursorOut, null);
  assert.equal(result.diagnostics.apiExcludedComments.length, 0);
  assert.equal(commentCountDisplay(47, 47, 50).label, '47 コメント ⓘ');
});

test('own bookmark GET maps 200 to bookmark, 404 to absence, errors to unknown', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const [status, body] of [[200, { tags: [], comment: 'mine' }], [404, null], [401, null], [403, null]]) {
    globalThis.fetch = async () => status === 200 ? Response.json(body) : new Response('', { status });
    if (status === 200) assert.equal((await getMyBookmark(account, url)).comment, 'mine');
    else if (status === 404) assert.equal(await getMyBookmark(account, url), null);
    else await assert.rejects(getMyBookmark(account, url), /HTTP/);
  }
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(getMyBookmark(account, url), /offline/);
});

test('badge uses red, green and blue; successful post changes green to red without navigation', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; });
  const listeners = {};
  const event = (name) => ({ addListener: (listener) => { listeners[name] = listener; } });
  const colors = [];
  const texts = [];
  let count = 88;
  let personalStatus = 404;
  let personalRequests = 0;
  let storedAccount = account;
  globalThis.fetch = async (endpoint) => {
    const path = String(endpoint);
    if (path.includes('/count/entry')) return Response.json(count);
    if (path.includes('/my/bookmark')) {
      personalRequests += 1;
      if (personalStatus === 200) return Response.json({ comment: 'mine', tags: [] });
      if (personalStatus === 0) throw new Error('offline');
      return new Response('', { status: personalStatus });
    }
    throw new Error(`Unexpected endpoint ${path}`);
  };
  globalThis.chrome = {
    action: {
      setBadgeText: async ({ text }) => { texts.push(text); },
      setBadgeBackgroundColor: async ({ color }) => { colors.push(color); },
      setBadgeTextColor: async () => {}, setTitle: async () => {}
    },
    storage: { local: { get: async () => storedAccount }, onChanged: event('storage') },
    tabs: {
      onActivated: event('activated'), onUpdated: event('updated'), onRemoved: event('removed'),
      onReplaced: event('replaced'), get: async () => ({ id: 5, active: true, url }), query: async () => []
    },
    webNavigation: { onHistoryStateUpdated: event('history'), onReferenceFragmentUpdated: event('fragment') },
    windows: { onFocusChanged: event('focus'), WINDOW_ID_NONE: -1 },
    runtime: { onStartup: event('startup'), onInstalled: event('installed'), onMessage: event('message') }
  };
  await import(`../background.js?v05=${Date.now()}`);
  const message = (payload) => new Promise((resolve) => {
    assert.equal(listeners.message({ tabId: 5, url, ...payload }, {}, resolve), true);
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await message({ type: 'getCount' })).count, 88);
  await settle();
  assert.equal(colors.at(-1), '#22C55E');
  assert.equal(texts.at(-1), '88');
  assert.equal((await message({ type: 'getPersonal' })).myBookmarkStatus, 'not-bookmarked');
  assert.equal(personalRequests, 1);

  count = 89;
  assert.equal((await message({ type: 'bookmarkChanged', bookmark: { comment: 'mine', tags: [] } })).count, 89);
  await settle();
  assert.equal(colors.at(-1), '#E53935');
  assert.equal(texts.at(-1), '89');
  assert.equal((await message({ type: 'getPersonal' })).myBookmarkStatus, 'bookmarked');

  personalStatus = 200;
  await message({ type: 'getCount', force: true });
  await settle();
  assert.equal(colors.at(-1), '#E53935');
  assert.equal((await message({ type: 'getPersonal' })).bookmark.comment, 'mine');

  personalStatus = 401;
  await message({ type: 'getCount', force: true });
  await settle();
  assert.equal(colors.at(-1), '#01A5DF');
  assert.equal((await message({ type: 'getPersonal' })).myBookmarkStatus, 'unknown');
  personalStatus = 0;
  await message({ type: 'getCount', force: true });
  await settle();
  assert.equal(colors.at(-1), '#01A5DF');
  storedAccount = {};
  const beforeDisconnect = personalRequests;
  listeners.storage({ accessToken: { oldValue: 'token', newValue: null } }, 'local');
  await settle();
  assert.equal(colors.at(-1), '#01A5DF');
  assert.equal(personalRequests, beforeDisconnect);
});
