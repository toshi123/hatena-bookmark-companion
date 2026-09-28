import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from 'linkedom';
import { parseEntryData, fetchEntry } from '../lib/hatena-api.js';
import { parseHatenaEntryPage } from '../lib/hatena-entry-parser.js';
import { loadPublicComments } from '../lib/public-comments.js';
import { bookmarkStarUri, commentStarUri } from '../lib/star-api.js';

globalThis.DOMParser = DOMParser;
const target = 'https://dailyportalz.jp/kiji/farewell-shibuya-seibu';
const entryUrl = 'https://b.hatena.ne.jp/entry/s/dailyportalz.jp/kiji/farewell-shibuya-seibu';
const eid = '4793661180715152706';

function htmlFixture(count, users = ['mska', 'I000i000I', 'telegnosis']) {
  const items = users.map((user, i) => `<div class="js-user-bookmark-comment" data-user-name="${user}">
    <span class="js-bookmark-comment">Comment ${i + 1}</span>
    <ul class="entry-comment-tags"><li><a>tag${i + 1}</a></li></ul>
    <span class="entry-comment-timestamp"><a content="2026-09-28T03:22:06Z" href="https://b.hatena.ne.jp/${user}/20260928#bookmark-${eid}">2026/09/28</a></span>
    <span class="entry-comment-permalink"><a href="/entry/${eid}/comment/${user}">リンク</a></span>
  </div>`).join('');
  return `<h3 class="entry-comment-title">記事へのコメント<span>${count}</span>件</h3>
    <div class="js-bookmark-autoloader-recent" data-autoload-url="${target}">${items}</div>`;
}

function jsonFixture(comments) {
  return { url: target, entry_url: entryUrl, eid, count: 88,
    bookmarks: Array.from({ length: comments }, (_, i) => ({ user: `user${i}`, comment: `Comment ${i}`, timestamp: '2026/09/28 12:00:00' })) };
}

test('JSONLite counts public comments separately from bookmarks and fresh fetch bypasses cache', async (t) => {
  const parsed = parseEntryData({ ...jsonFixture(2), bookmarks: [
    { user: 'one', comment: 'hello' }, { user: 'two', comment: '  ' }, { user: 'three', comment: 'world' }
  ] }, target);
  assert.equal(parsed.rawBookmarksLength, 3);
  assert.equal(parsed.publicCommentCount, 2);
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let request;
  globalThis.fetch = async (url, options) => { request = { url: String(url), options }; return Response.json(jsonFixture(2)); };
  await fetchEntry(target);
  const endpoint = new URL(request.url);
  assert.equal(endpoint.searchParams.get('url'), target);
  assert.match(endpoint.searchParams.get('_'), /^\d+$/);
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'omit');
});

test('HTML count and three comments preserve user, text, timestamp, tags and Star URI', () => {
  const parsed = parseHatenaEntryPage(htmlFixture(40));
  assert.equal(parsed.officialCommentCount, 40);
  assert.equal(parsed.comments.length, 3);
  assert.deepEqual(parsed.comments.map((item) => item.user), ['mska', 'I000i000I', 'telegnosis']);
  assert.equal(parsed.comments[0].comment, 'Comment 1');
  assert.equal(parsed.comments[0].timestamp, '2026-09-28T03:22:06Z');
  assert.deepEqual(parsed.comments[0].tags, ['tag1']);
  assert.equal(parsed.comments[0].eid, eid);
  assert.equal(parsed.comments[0].permalink, `https://b.hatena.ne.jp/mska/20260928#bookmark-${eid}`);
  assert.equal(commentStarUri(eid, parsed.comments[0]), parsed.comments[0].permalink);
  assert.equal(bookmarkStarUri(eid, 'mska', '2026-09-27T15:30:00Z'), `https://b.hatena.ne.jp/mska/20260928#bookmark-${eid}`);
});

test('HTML parser logs every rejected comment and its reason', () => {
  const parsed = parseHatenaEntryPage(`<h3 class="entry-comment-title"><span>3</span></h3>
    <div class="js-bookmark-autoloader-recent" data-autoload-url="${target}">
      <div class="js-user-bookmark-comment" data-user-name="valid"><span class="js-bookmark-comment">ok</span></div>
      <div class="js-user-bookmark-comment" data-user-name="bad/user"><span class="js-bookmark-comment">text</span></div>
      <div class="js-user-bookmark-comment" data-user-name="empty"><span class="js-bookmark-comment"> </span></div>
    </div>`);
  assert.equal(parsed.initialHtmlRawCount, 3);
  assert.equal(parsed.comments.length, 1);
  assert.deepEqual(parsed.excludedComments.map(({ index, user, reasons }) => ({ index, user, reasons })), [
    { index: 1, user: 'bad/user', reasons: ['invalid-username'] },
    { index: 2, user: 'empty', reasons: ['empty-comment'] }
  ]);
});

test('HTML parser keeps unique comments from recent and popular panels', () => {
  const item = (user) => `<div class="js-user-bookmark-comment" data-user-name="${user}">
    <span class="js-bookmark-comment">${user} says hello</span>
    <span class="entry-comment-timestamp"><a content="2024-10-14T03:22:06Z" href="https://b.hatena.ne.jp/${user}/20241014#bookmark-${eid}">date</a></span>
  </div>`;
  const parsed = parseHatenaEntryPage(`<h3 class="entry-comment-title"><span>3</span></h3>
    <div class="js-bookmark-autoloader-recent" data-autoload-url="${target}">${item('alice')}${item('bob')}</div>
    <div class="js-bookmarks-popular">${item('bob')}${item('carol')}</div>`);
  assert.equal(parsed.initialHtmlRecentRawCount, 2);
  assert.equal(parsed.initialHtmlPopularRawCount, 2);
  assert.equal(parsed.initialHtmlRawCount, 4);
  assert.equal(parsed.initialHtmlAcceptedBeforeDedup, 4);
  assert.deepEqual(parsed.comments.map((comment) => comment.user), ['alice', 'bob', 'carol']);
  assert.deepEqual(parsed.duplicateComments.map(({ user, panel }) => ({ user, panel })), [{ user: 'bob', panel: 'popular' }]);
});

test('matching HTML count adopts JSONLite', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => String(url).includes('jsonlite')
    ? Response.json(jsonFixture(3)) : new Response(htmlFixture(3));
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'jsonlite');
  assert.equal(result.incomplete, false);
  assert.equal(result.entry.bookmarks.length, 3);
});

test('5 JSON comments versus 40 HTML comments uses complete paged fallback', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(5));
    if (path.includes('/api/entry/')) return Response.json({ cursor: null, bookmarks: Array.from({ length: 40 }, (_, i) => ({
      user: { name: ['mska', 'I000i000I', 'telegnosis', 'yas-mal'][i] || `user${i}` },
      comment: `Comment ${i}`, created: '2026-09-28T03:22:06Z', location_id: eid, url: target, tags: []
    })) });
    return new Response(htmlFixture(40));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'html-fallback');
  assert.equal(result.entry.bookmarks.length, 40);
  assert.equal(result.incomplete, false);
  assert.equal(result.diagnostics.parsedHtmlComments, 3);
  assert.equal(result.diagnostics.pagedComments, 40);
});

test('failed HTML verification keeps JSONLite explicitly unverified', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => String(url).includes('jsonlite')
    ? Response.json(jsonFixture(5)) : new Response('unavailable', { status: 503 });
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'jsonlite-unverified');
  assert.equal(result.entry.bookmarks.length, 5);
});

test('missing JSON bookmarks falls back to HTML comments', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => String(url).includes('jsonlite')
    ? Response.json({ url: target, count: 3 }) : new Response(htmlFixture(3));
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'html-fallback');
  assert.equal(result.entry.bookmarks.length, 3);
  assert.equal(result.entry.eid, eid);
  assert.equal(result.incomplete, false);
});

test('failed pagination leaves public availability unverified instead of claiming a shortfall', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(5));
    if (path.includes('/api/entry/')) return new Response('unavailable', { status: 503 });
    return new Response(htmlFixture(40));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'html-fallback');
  assert.equal(result.entry.bookmarks.length, 3);
  assert.equal(result.officialCommentCount, 40);
  assert.equal(result.incomplete, false);
  assert.equal(result.unverified, true);
});

test('new comments arriving after HTML fetch are reported as a count mismatch', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(1));
    if (path.includes('/api/entry/')) return Response.json({ cursor: null, bookmarks: Array.from({ length: 4 }, (_, i) => ({
      user: { name: ['mska', 'I000i000I'][i] || `user${i}` }, comment: `Comment ${i}`, created: '2026-09-28T03:22:06Z',
      location_id: eid, url: target, tags: []
    })) });
    return new Response(htmlFixture(3, ['mska', 'I000i000I']));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.entry.bookmarks.length, 4);
  assert.equal(result.officialCommentCount, 3);
  assert.equal(result.incomplete, false);
  assert.equal(result.countMismatch, true);
});

test('50 in heading and 47 in all public sources identifies the upstream mismatch', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const users = Array.from({ length: 30 }, (_, i) => `user${i}`);
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(47));
    if (path.includes('/api/entry/')) return Response.json({ cursor: null, bookmarks: Array.from({ length: 47 }, (_, i) => ({
      user: { name: `user${i}` }, comment: `Comment ${i}`, created: '2024-10-14T03:22:06Z',
      location_id: eid, url: target, tags: []
    })) });
    return new Response(htmlFixture(50, users));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.commentSource, 'html-fallback');
  assert.equal(result.entry.bookmarks.length, 47);
  assert.equal(result.officialCommentCount, 50);
  assert.equal(result.incomplete, false);
  assert.equal(result.headlineCommentCount, 50);
  assert.equal(result.publicAvailableCommentCount, 47);
  assert.equal(result.extensionCommentCount, 47);
  assert.equal(result.countMismatch, true);
  assert.equal(result.diagnostics.initialHtmlRawCount, 30);
  assert.equal(result.diagnostics.parsedHtmlComments, 30);
  assert.deepEqual(result.diagnostics.htmlExcludedComments, []);
  assert.deepEqual(result.diagnostics.apiPages.map(({ rawCount, cursorOut, acceptedCount }) => ({ rawCount, cursorOut, acceptedCount })),
    [{ rawCount: 47, cursorOut: null, acceptedCount: 47 }]);
  assert.deepEqual(result.diagnostics.apiExcludedComments, []);
  assert.deepEqual(result.diagnostics.apiDuplicateComments, []);
  assert.equal(result.diagnostics.selectedBeforeDedup, 77);
  assert.equal(result.diagnostics.selectedAfterDedup, 47);
  assert.equal(result.diagnostics.deduplicatedComments.length, 30);
});

test('API pagination continues past duplicate rows and records every exclusion', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const record = (user, comment = 'text', url = target) => ({ user: { name: user }, comment,
    created: '2024-10-14T03:22:06Z', location_id: eid, url, tags: [] });
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(1));
    if (path.includes('/api/entry/')) return new URL(path).searchParams.has('cursor')
      ? Response.json({ cursor: null, bookmarks: [record('user2'), record('user3')] })
      : Response.json({ cursor: 'next-page', bookmarks: [record('user0'), record('user0'), record('user1'),
        record('bad/user'), record('blank', ' '), record('wrong-url', 'text', 'https://other.example/'),
        { ...record('bad-eid'), location_id: 'not-an-id' }] });
    return new Response(htmlFixture(4, ['user0']));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.entry.bookmarks.length, 4);
  assert.deepEqual(result.diagnostics.apiPages.map(({ rawCount, cursorIn, cursorOut, uniqueCumulative }) =>
    ({ rawCount, cursorIn, cursorOut, uniqueCumulative })), [
    { rawCount: 7, cursorIn: null, cursorOut: 'next-page', uniqueCumulative: 2 },
    { rawCount: 2, cursorIn: 'next-page', cursorOut: null, uniqueCumulative: 4 }
  ]);
  assert.deepEqual(result.diagnostics.apiExcludedComments.map(({ page, index, reasons }) => ({ page, index, reasons })), [
    { page: 1, index: 3, reasons: ['invalid-username'] },
    { page: 1, index: 4, reasons: ['empty-comment'] },
    { page: 1, index: 5, reasons: ['url-mismatch'] },
    { page: 1, index: 6, reasons: ['invalid-eid'] }
  ]);
  assert.equal(result.diagnostics.apiDuplicateComments.length, 1);
});

test('a later pagination failure preserves comments and audit from earlier pages', async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const record = (user) => ({ user: { name: user }, comment: `${user} comment`,
    created: '2024-10-14T03:22:06Z', location_id: eid, url: target, tags: [] });
  globalThis.fetch = async (url) => {
    const path = String(url);
    if (path.includes('jsonlite')) return Response.json(jsonFixture(1));
    if (path.includes('/api/entry/')) return new URL(path).searchParams.has('cursor')
      ? new Response('unavailable', { status: 503 })
      : Response.json({ cursor: 'next-page', bookmarks: [record('user0'), record('user1')] });
    return new Response(htmlFixture(3, ['user0']));
  };
  const result = await loadPublicComments(target);
  assert.equal(result.entry.bookmarks.length, 2);
  assert.equal(result.officialCommentCount, 3);
  assert.equal(result.diagnostics.apiPages.length, 1);
  assert.equal(result.diagnostics.apiPages[0].rawCount, 2);
  assert.match(result.diagnostics.paginationError, /503/);
  assert.equal(result.incompleteReason, 'public-list-unverified');
  assert.equal(result.unverified, true);
  assert.equal(result.incomplete, false);
});
