import { fetchEntry } from './hatena-api.js';
import { parseHatenaEntryPage } from './hatena-entry-parser.js';
import { safeHatenaUrl } from './utils.js';

async function fetchPublic(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try { return await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function entryPageUrl(pageUrl, entryUrl) {
  if (safeHatenaUrl(entryUrl)) return entryUrl;
  const url = new URL(pageUrl);
  return `https://b.hatena.ne.jp/entry/${url.protocol === 'https:' ? 's/' : ''}${url.host}${url.pathname}${url.search}${url.hash}`;
}

async function fetchHtml(pageUrl, entryUrl) {
  const response = await fetchPublic(entryPageUrl(pageUrl, entryUrl));
  if (!response.ok) throw new Error(`Entry HTML HTTP ${response.status}`);
  const parsed = parseHatenaEntryPage(await response.text());
  if (parsed.targetUrl && parsed.targetUrl !== pageUrl) throw new Error('Entry HTML URL mismatch');
  if (parsed.officialCommentCount === null) throw new Error('Entry HTML comment count missing');
  return parsed;
}

function parsePageBookmark(item, pageUrl, index) {
  const user = item?.user?.name;
  const comment = item?.comment;
  const eid = typeof item?.location_id === 'string' ? item.location_id :
    Number.isSafeInteger(item?.location_id) ? String(item.location_id) : '';
  const reasons = [];
  if (item?.url !== pageUrl) reasons.push('url-mismatch');
  if (!/^[A-Za-z0-9_-]+$/.test(user || '')) reasons.push('invalid-username');
  if (typeof comment !== 'string' || !comment.trim()) reasons.push('empty-comment');
  if (!/^\d+$/.test(eid)) reasons.push('invalid-eid');
  if (reasons.length) return { bookmark: null, exclusion: { index, user: user || null, eid: eid || null, reasons } };
  return { bookmark: { user, username: user, comment, timestamp: typeof item.created === 'string' ? item.created : '',
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
    permalink: null, eid, starStatus: 'loading', starTotal: null, supporterCount: null, starColors: null }, exclusion: null };
}

async function fetchRemainingComments(pageUrl) {
  const comments = [];
  const pages = [];
  const exclusions = [];
  const duplicates = [];
  const seenComments = new Set();
  const seenCursors = new Set();
  let cursor = null;
  let stopReason = 'page-limit-reached';
  const withAudit = (error) => {
    error.paginationAudit = { comments, pages, exclusions, duplicates };
    return error;
  };
  for (let page = 0; page < 5; page += 1) {
    const endpoint = new URL(`https://b.hatena.ne.jp/api/entry/${encodeURIComponent(pageUrl)}/bookmarks`);
    endpoint.searchParams.set('limit', '100');
    endpoint.searchParams.set('commented_only', '1');
    endpoint.searchParams.set('exclude_owner', '0');
    if (cursor) endpoint.searchParams.set('cursor', cursor);
    let response;
    try { response = await fetchPublic(endpoint); }
    catch (error) { throw withAudit(error); }
    if (!response.ok) throw withAudit(new Error(`Entry comments HTTP ${response.status}`));
    let data;
    try { data = await response.json(); }
    catch (error) { throw withAudit(error); }
    if (!data || !Array.isArray(data.bookmarks)) throw withAudit(new Error('Invalid entry comments response'));
    const pageExclusions = [];
    let pageDuplicates = 0;
    data.bookmarks.forEach((item, index) => {
      const { bookmark, exclusion } = parsePageBookmark(item, pageUrl, index);
      if (exclusion) { pageExclusions.push(exclusion); exclusions.push({ page: page + 1, ...exclusion }); return; }
      const key = `${bookmark.user}:${bookmark.eid}`;
      if (seenComments.has(key)) {
        pageDuplicates += 1;
        duplicates.push({ page: page + 1, index, user: bookmark.user, eid: bookmark.eid });
      }
      seenComments.add(key);
      comments.push(bookmark);
    });
    pages.push({ page: page + 1, cursorIn: cursor, cursorOut: data.cursor ?? null,
      rawCount: data.bookmarks.length, acceptedCount: data.bookmarks.length - pageExclusions.length,
      excludedComments: pageExclusions, duplicates: pageDuplicates, uniqueCumulative: seenComments.size });
    if (!data.cursor) { stopReason = 'cursor-exhausted'; break; }
    if (seenCursors.has(data.cursor)) throw withAudit(new Error('Repeated entry comments cursor'));
    seenCursors.add(data.cursor);
    cursor = data.cursor;
  }
  return { comments, pages, exclusions, duplicates, uniqueCount: seenComments.size, stopReason };
}

export function assessCommentCompleteness({ headlineCommentCount, publicAvailableCommentCount, extensionCommentCount,
  retrievalFailed = false }) {
  const incomplete = publicAvailableCommentCount !== null && extensionCommentCount < publicAvailableCommentCount;
  const unverified = publicAvailableCommentCount === null && retrievalFailed;
  return {
    headlineCommentCount, publicAvailableCommentCount, extensionCommentCount, incomplete, unverified,
    incompleteReason: incomplete ? 'fallback-partial' : unverified ? 'public-list-unverified' : null,
    countMismatch: publicAvailableCommentCount !== null && headlineCommentCount !== null &&
      publicAvailableCommentCount !== headlineCommentCount
  };
}

export async function loadPublicComments(pageUrl, { debug = false } = {}) {
  const diagnostics = { activeTabUrl: pageUrl, jsonliteNormal: null, jsonliteFresh: null,
    officialHtmlCommentCount: null, initialHtmlRawCount: null, initialHtmlRecentRawCount: null,
    initialHtmlPopularRawCount: null, initialHtmlAcceptedBeforeDedup: null, initialHtmlCursor: null,
    parsedHtmlComments: null, htmlExcludedComments: [], htmlDuplicateComments: [], pagedComments: null,
    apiPages: [], apiExcludedComments: [], apiDuplicateComments: [], paginationStopReason: null,
    selectedBeforeDedup: null, selectedAfterDedup: null, deduplicatedComments: [],
    jsonError: null, htmlError: null, paginationError: null };
  const summary = (entry) => entry && ({ requestedUrl: entry.requestedUrl, returnedUrl: entry.returnedUrl,
    entryUrl: entry.entryUrl, eid: entry.eid, count: entry.count,
    bookmarksLength: entry.rawBookmarksLength, publicCommentCount: entry.publicCommentCount,
    fetchedAt: entry.fetchedAt });
  if (debug) {
    try { diagnostics.jsonliteNormal = summary(await fetchEntry(pageUrl, { fresh: false })); }
    catch (error) { diagnostics.jsonliteNormal = { error: String(error) }; }
  }
  let entry = null;
  try { entry = await fetchEntry(pageUrl, { fresh: true }); diagnostics.jsonliteFresh = summary(entry); }
  catch (error) { diagnostics.jsonError = String(error); }
  let html = null;
  try {
    html = await fetchHtml(pageUrl, entry?.entryUrl);
    diagnostics.officialHtmlCommentCount = html.officialCommentCount;
    diagnostics.initialHtmlRawCount = html.initialHtmlRawCount;
    diagnostics.initialHtmlRecentRawCount = html.initialHtmlRecentRawCount;
    diagnostics.initialHtmlPopularRawCount = html.initialHtmlPopularRawCount;
    diagnostics.initialHtmlAcceptedBeforeDedup = html.initialHtmlAcceptedBeforeDedup;
    diagnostics.initialHtmlCursor = html.initialHtmlCursor;
    diagnostics.htmlExcludedComments = html.excludedComments;
    diagnostics.htmlDuplicateComments = html.duplicateComments;
  }
  catch (error) { diagnostics.htmlError = String(error); }
  if (!html && !entry) throw new Error('JSONLite and entry HTML unavailable');
  if (!html) return { entry, commentSource: 'jsonlite-unverified', officialCommentCount: null,
    ...assessCommentCompleteness({ headlineCommentCount: null, publicAvailableCommentCount: null,
      extensionCommentCount: entry.bookmarks.filter((bookmark) => bookmark.comment.trim()).length }), diagnostics };
  if (entry && entry.publicCommentCount === html.officialCommentCount &&
      entry.bookmarks.filter((bookmark) => bookmark.comment.trim()).length === html.officialCommentCount) {
    return { entry, commentSource: 'jsonlite', officialCommentCount: html.officialCommentCount,
      ...assessCommentCompleteness({ headlineCommentCount: html.officialCommentCount,
        publicAvailableCommentCount: html.officialCommentCount, extensionCommentCount: html.officialCommentCount }), diagnostics };
  }
  diagnostics.parsedHtmlComments = html.comments.length;
  let comments = html.comments;
  let paged = null;
  if (comments.length < html.officialCommentCount) {
    try {
      paged = await fetchRemainingComments(pageUrl);
      diagnostics.pagedComments = paged.comments.length;
      diagnostics.apiPages = paged.pages;
      diagnostics.apiExcludedComments = paged.exclusions;
      diagnostics.apiDuplicateComments = paged.duplicates;
      diagnostics.paginationStopReason = paged.stopReason;
      comments = [...paged.comments, ...html.comments];
    } catch (error) {
      diagnostics.paginationError = String(error);
      if (error.paginationAudit) {
        diagnostics.apiPages = error.paginationAudit.pages;
        diagnostics.apiExcludedComments = error.paginationAudit.exclusions;
        diagnostics.apiDuplicateComments = error.paginationAudit.duplicates;
        diagnostics.pagedComments = error.paginationAudit.comments.length;
        comments = [...error.paginationAudit.comments, ...html.comments];
      }
    }
  }
  if (!comments.length && entry) return { entry, commentSource: 'jsonlite-unverified',
    officialCommentCount: html.officialCommentCount,
    ...assessCommentCompleteness({ headlineCommentCount: html.officialCommentCount,
      publicAvailableCommentCount: null,
      extensionCommentCount: entry.bookmarks.filter((bookmark) => bookmark.comment.trim()).length,
      retrievalFailed: true }), diagnostics };
  const seen = new Map();
  diagnostics.selectedBeforeDedup = comments.length;
  comments = comments.filter((item, index) => {
    const key = `${item.user}:${item.eid}`;
    if (seen.has(key)) {
      diagnostics.deduplicatedComments.push({ index, user: item.user, eid: item.eid, keptIndex: seen.get(key) });
      return false;
    }
    seen.set(key, index);
    return true;
  });
  diagnostics.selectedAfterDedup = comments.length;
  const publicAvailableCommentCount = paged?.stopReason === 'cursor-exhausted' &&
    !diagnostics.paginationError && !diagnostics.apiExcludedComments.length
    ? Math.max(paged.uniqueCount, comments.length) : comments.length >= html.officialCommentCount && !diagnostics.paginationError
      ? comments.length : null;
  const completeness = assessCommentCompleteness({ headlineCommentCount: html.officialCommentCount,
    publicAvailableCommentCount, extensionCommentCount: comments.length,
    retrievalFailed: !!diagnostics.paginationError || !!diagnostics.apiExcludedComments.length ||
      (paged !== null && paged.stopReason !== 'cursor-exhausted') });
  const fallback = { ...entry, title: entry?.title || '', eid: entry?.eid || comments[0]?.eid || null,
    entryUrl: entry?.entryUrl || entryPageUrl(pageUrl), bookmarks: comments };
  return { entry: fallback, commentSource: 'html-fallback', officialCommentCount: html.officialCommentCount,
    ...completeness, diagnostics };
}
