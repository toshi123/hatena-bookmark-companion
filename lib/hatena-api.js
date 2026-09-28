import { isSupportedUrl, safeHatenaUrl } from './utils.js';

async function fetchJson(url, { preserveEid = false, noStore = false } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: 'omit', ...(noStore ? { cache: 'no-store' } : {}) });
    if (!response.ok) throw new Error(`Hatena API HTTP ${response.status}`);
    if (!preserveEid) return await response.json();
    const raw = await response.text();
    // Entry IDs are identifiers, and current IDs can exceed Number.MAX_SAFE_INTEGER.
    return JSON.parse(raw.replace(/("eid"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"'));
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCount(pageUrl) {
  if (!isSupportedUrl(pageUrl)) throw new Error('Unsupported URL');
  const endpoint = new URL('https://bookmark.hatenaapis.com/count/entry');
  endpoint.searchParams.set('url', pageUrl);
  const count = await fetchJson(endpoint);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid count response');
  return count;
}

export function parseEntryData(data, pageUrl, fetchedAt = new Date().toISOString()) {
  if (data === null) throw new Error('Entry not found');
  if (!data || typeof data !== 'object' || !Array.isArray(data.bookmarks)) {
    throw new Error('Invalid entry response');
  }
  if (typeof data.url === 'string' && data.url !== pageUrl) throw new Error('Entry URL mismatch');
  const eid = typeof data.eid === 'string' ? data.eid :
    Number.isSafeInteger(data.eid) ? String(data.eid) : null;
  return {
    title: typeof data.title === 'string' ? data.title : '',
    count: Number.isSafeInteger(data.count) && data.count >= 0 ? data.count : null,
    requestedUrl: pageUrl,
    returnedUrl: typeof data.url === 'string' ? data.url : null,
    fetchedAt,
    rawBookmarksLength: data.bookmarks.length,
    publicCommentCount: data.bookmarks.filter((item) => typeof item?.comment === 'string' && item.comment.trim()).length,
    eid: eid && /^\d+$/.test(eid) ? eid : null,
    entryUrl: safeHatenaUrl(data.entry_url),
    bookmarks: data.bookmarks.flatMap((item) => {
      if (!item || typeof item.user !== 'string' || !/^[A-Za-z0-9_-]+$/.test(item.user)) return [];
      return [{
        user: item.user,
        comment: typeof item.comment === 'string' ? item.comment : '',
        tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
        timestamp: typeof item.timestamp === 'string' ? item.timestamp : '',
        starStatus: 'loading', starTotal: null, supporterCount: null, starColors: null
      }];
    })
  };
}

export async function fetchEntry(pageUrl, { fresh = true } = {}) {
  if (!isSupportedUrl(pageUrl)) throw new Error('Unsupported URL');
  const endpoint = new URL('https://b.hatena.ne.jp/entry/jsonlite/');
  endpoint.searchParams.set('url', pageUrl);
  if (fresh) endpoint.searchParams.set('_', String(Date.now()));
  const data = await fetchJson(endpoint, { preserveEid: true, noStore: fresh });
  return parseEntryData(data, pageUrl);
}
