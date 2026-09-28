// All selectors tied to Hatena's entry-page markup live here.
const SELECTORS = {
  count: '.entry-comment-title span',
  recent: '.js-bookmark-autoloader-recent',
  popular: '.js-bookmarks-popular',
  item: '.js-user-bookmark-comment',
  user: '.entry-comment-username [itemprop="name"]',
  comment: '.js-bookmark-comment',
  timestamp: '.entry-comment-timestamp a',
  tag: '.entry-comment-tags a',
  permalink: '.entry-comment-permalink a'
};

export function parseHatenaEntryPage(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const countText = doc.querySelector(SELECTORS.count)?.textContent?.trim();
  const officialCommentCount = /^[\d,]+$/.test(countText || '') ? Number(countText.replaceAll(',', '')) : null;
  const panel = doc.querySelector(SELECTORS.recent);
  const recentItems = [...(panel?.querySelectorAll(SELECTORS.item) || [])];
  const popularItems = [...(doc.querySelector(SELECTORS.popular)?.querySelectorAll(SELECTORS.item) || [])];
  const rawItems = [
    ...recentItems.map((item) => ({ item, panel: 'recent' })),
    ...popularItems.map((item) => ({ item, panel: 'popular' }))
  ];
  const comments = [];
  const excludedComments = [];
  const duplicateComments = [];
  const seen = new Map();
  let acceptedBeforeDedup = 0;
  rawItems.forEach(({ item, panel: sourcePanel }, index) => {
    const username = item.getAttribute('data-user-name') || item.querySelector(SELECTORS.user)?.textContent?.trim();
    const comment = item.querySelector(SELECTORS.comment)?.textContent?.trim();
    const date = item.querySelector(SELECTORS.timestamp);
    const permalink = date?.getAttribute('href') || null;
    const eid = /#bookmark-(\d+)$/.exec(permalink || '')?.[1] ||
      /\/entry\/(\d+)\/comment\//.exec(item.querySelector(SELECTORS.permalink)?.getAttribute('href') || '')?.[1] || null;
    const reasons = [];
    if (!/^[A-Za-z0-9_-]+$/.test(username || '')) reasons.push('invalid-username');
    if (!comment) reasons.push('empty-comment');
    if (reasons.length) {
      excludedComments.push({ index, panel: sourcePanel, user: username || null, eid, reasons });
      return;
    }
    acceptedBeforeDedup += 1;
    const key = `${username}:${eid}`;
    if (seen.has(key)) {
      duplicateComments.push({ index, panel: sourcePanel, user: username, eid, keptIndex: seen.get(key) });
      return;
    }
    seen.set(key, index);
    comments.push({ user: username, username, comment, timestamp: date?.getAttribute('content') || date?.textContent?.trim() || '',
      tags: [...item.querySelectorAll(SELECTORS.tag)].map((tag) => tag.textContent.trim()).filter(Boolean),
      permalink, eid, starStatus: 'loading', starTotal: null, supporterCount: null, starColors: null });
  });
  return { officialCommentCount, targetUrl: panel?.getAttribute('data-autoload-url') || null,
    initialHtmlRawCount: rawItems.length, initialHtmlRecentRawCount: recentItems.length,
    initialHtmlPopularRawCount: popularItems.length, initialHtmlAcceptedBeforeDedup: acceptedBeforeDedup,
    initialHtmlCursor: panel?.getAttribute('data-next-cursor') || null,
    excludedComments, duplicateComments, comments };
}
