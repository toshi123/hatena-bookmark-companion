export function isSupportedUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatBadgeCount(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return '';
  if (value < 1000) return String(value);
  if (value < 10000) {
    const rounded = Math.floor(value / 100) / 10;
    return Number.isInteger(rounded) ? `${rounded}k` : `${rounded.toFixed(1)}k`;
  }
  return `${Math.floor(value / 1000)}k`;
}

export function sortBookmarks(bookmarks, order) {
  const items = [...bookmarks];
  const recent = (a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
  if (order === 'recent') {
    return items.sort(recent);
  }
  return items.sort((a, b) => {
    const known = (item) => item.starStatus === 'loaded' || item.starStatus === 'not-found';
    if (known(a) !== known(b)) return known(a) ? -1 : 1;
    if (!known(a)) return recent(a, b);
    return order === 'supporters'
      ? b.supporterCount - a.supporterCount || b.starTotal - a.starTotal || recent(a, b)
      : b.starTotal - a.starTotal || b.supporterCount - a.supporterCount || recent(a, b);
  });
}

export function safeHatenaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'b.hatena.ne.jp' ? url.href : null;
  } catch {
    return null;
  }
}
