export function commentPermalink(eid, user) {
  if (!/^\d+$/.test(String(eid)) || !/^[A-Za-z0-9_-]+$/.test(user)) return null;
  return `https://b.hatena.ne.jp/entry/${eid}/comment/${encodeURIComponent(user)}`;
}

export function bookmarkStarUri(eid, user, timestamp) {
  if (!/^\d+$/.test(String(eid)) || !/^[A-Za-z0-9_-]+$/.test(user)) return null;
  let localTimestamp = timestamp;
  if (typeof timestamp === 'string' && /^\d{4}-\d\d-\d\dT/.test(timestamp) && /(?:Z|[+-]\d\d:\d\d)$/.test(timestamp)) {
    const instant = new Date(timestamp);
    if (Number.isNaN(instant.getTime())) return null;
    localTimestamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
  }
  const match = typeof localTimestamp === 'string' && /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\D|$)/.exec(localTimestamp);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null;
  const ymd = `${year}${month.padStart(2, '0')}${day.padStart(2, '0')}`;
  return `https://b.hatena.ne.jp/${user}/${ymd}#bookmark-${eid}`;
}

export function commentStarUri(eid, bookmark) {
  const entryId = bookmark.eid || eid;
  const expected = bookmarkStarUri(entryId, bookmark.user, bookmark.timestamp);
  const permalink = bookmark.permalink;
  if (typeof permalink === 'string' && /^\d+$/.test(String(entryId)) &&
      permalink.startsWith(`https://b.hatena.ne.jp/${bookmark.user}/`) &&
      new RegExp(`^https://b\\.hatena\\.ne\\.jp/${bookmark.user}/\\d{8}#bookmark-${entryId}$`).test(permalink)) {
    return permalink;
  }
  return expected;
}

function normalizedStarUri(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function summarizeStars(entry) {
  const stars = Array.isArray(entry?.stars) ? entry.stars : [];
  const colored = Array.isArray(entry?.colored_stars) ? entry.colored_stars : [];
  const users = new Set();
  const colors = {};
  let total = 0;
  const add = (star, color) => {
    if (!star || typeof star !== 'object' || typeof star.name !== 'string' || !star.name) {
      throw new Error('Invalid star record');
    }
    const count = star.count == null ? 1 : Number(star.count);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid star count');
    total += count;
    users.add(star.name);
    if (color) colors[color] = (colors[color] || 0) + count;
  };
  for (const star of stars) add(star, null);
  for (const group of colored) {
    if (!group || !Array.isArray(group.stars)) throw new Error('Invalid colored stars');
    const color = typeof group.color === 'string' && /^[a-z]+$/.test(group.color) ? group.color : 'other';
    for (const star of group.stars) add(star, color);
  }
  return { starTotal: total, supporterCount: users.size, starColors: colors };
}

function makeBatches(uris) {
  const batches = [];
  let batch = [];
  let length = 'https://s.hatena.com/entry.json?'.length;
  for (const uri of uris) {
    const extra = new URLSearchParams({ uri }).toString().length + 1;
    if (batch.length && (batch.length >= 20 || length + extra > 3500)) {
      batches.push(batch);
      batch = [];
      length = 'https://s.hatena.com/entry.json?'.length;
    }
    batch.push(uri);
    length += extra;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export async function fetchCommentStars(eid, bookmarks, { debug = false } = {}) {
  const result = new Map();
  const generated = bookmarks.map((bookmark) => commentStarUri(eid, bookmark));
  const uris = [...new Set(generated.filter(Boolean))];
  const invalidUris = generated.length - generated.filter(Boolean).length;
  if (debug) console.debug('Generated star URI', uris);
  let failedBatches = 0;
  let mappingErrors = 0;
  for (const batch of makeBatches(uris)) {
    const endpoint = new URL('https://s.hatena.com/entry.json');
    for (const uri of batch) endpoint.searchParams.append('uri', uri);
    if (debug) console.debug('Star API request', endpoint.href);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(endpoint, { signal: controller.signal, credentials: 'omit' });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error(`Star API HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.entries) || data.error) throw new Error('Invalid Star API response');
      if (debug) console.debug('Star API response entries count', data.entries.length);
      const entries = data.entries.map((entry) => [normalizedStarUri(entry?.uri), entry]);
      const malformedEntries = entries.filter(([uri]) => !uri).length;
      const byUri = new Map(entries.filter(([uri]) => uri));
      const unexpectedUris = [...byUri.keys()].filter((uri) => !batch.includes(uri)).length;
      const mappingFailure = malformedEntries + unexpectedUris > 0;
      mappingErrors += malformedEntries + unexpectedUris;
      for (const uri of batch) {
        const entry = byUri.get(normalizedStarUri(uri));
        if (!entry) {
          const status = mappingFailure ? 'error' : 'not-found';
          result.set(uri, { starStatus: status, starTotal: status === 'not-found' ? 0 : null,
            supporterCount: status === 'not-found' ? 0 : null, starColors: status === 'not-found' ? {} : null });
          continue;
        }
        try {
          if (!Array.isArray(entry.stars) || (entry.colored_stars != null && !Array.isArray(entry.colored_stars))) {
            throw new Error('Invalid Star entry');
          }
          result.set(uri, { starStatus: 'loaded', ...summarizeStars(entry) });
        } catch {
          mappingErrors += 1;
          result.set(uri, { starStatus: 'error', starTotal: null, supporterCount: null, starColors: null });
        }
      }
    } catch {
      failedBatches += 1;
      if (debug) console.debug('Star API response entries count', 'request failed');
      for (const uri of batch) result.set(uri,
        { starStatus: 'error', starTotal: null, supporterCount: null, starColors: null });
    }
  }
  return { result, failedBatches, invalidUris, mappingErrors };
}
