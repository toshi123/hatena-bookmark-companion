import { fetchCount } from './lib/hatena-api.js';
import { loadAccount, getMyBookmark } from './lib/account.js';
import { badgeColor, badgeTitle } from './lib/badge-state.js';
import { formatBadgeCount, isSupportedUrl } from './lib/utils.js';

const cache = new Map();
const inFlight = new Map();
const cacheGenerations = new Map();
const tabUrls = new Map();
const tabRequests = new Map();
const tabState = new Map();
const personalCache = new Map();
const personalInFlight = new Map();
const appearanceQueues = new Map();
let personalGeneration = 0;
const TTL_MS = 5 * 60 * 1000;
const PERSONAL_TTL_MS = 2 * 60 * 1000;
const ERROR_TTL_MS = 30 * 1000;

function invalidateCount(url) {
  cacheGenerations.set(url, (cacheGenerations.get(url) || 0) + 1);
  cache.delete(url);
  inFlight.delete(url);
}

async function cachedCount(url) {
  const stored = cache.get(url);
  if (stored && Date.now() - stored.at < (stored.error ? ERROR_TTL_MS : TTL_MS)) {
    if (stored.error) throw new Error('Recently failed count request');
    return stored.value;
  }
  if (inFlight.has(url)) return inFlight.get(url);
  const generation = cacheGenerations.get(url) || 0;
  const request = fetchCount(url)
    .then((value) => {
      if ((cacheGenerations.get(url) || 0) === generation) cache.set(url, { value, at: Date.now() });
      return value;
    })
    .catch((error) => {
      if ((cacheGenerations.get(url) || 0) === generation) cache.set(url, { error: true, at: Date.now() });
      throw error;
    })
    .finally(() => {
      if (inFlight.get(url) === request) inFlight.delete(url);
      if (cache.size > 200) cache.delete(cache.keys().next().value);
    });
  inFlight.set(url, request);
  return request;
}

function invalidatePersonal(url = null) {
  personalGeneration += 1;
  if (url === null) { personalCache.clear(); personalInFlight.clear(); }
  else { personalCache.delete(url); personalInFlight.delete(url); }
}

async function cachedPersonal(url) {
  const stored = personalCache.get(url);
  if (stored && Date.now() - stored.at < (stored.myBookmarkStatus === 'unknown' ? ERROR_TTL_MS : PERSONAL_TTL_MS)) {
    return stored;
  }
  if (personalInFlight.has(url)) return personalInFlight.get(url);
  const generation = personalGeneration;
  const request = (async () => {
    try {
      const account = await loadAccount();
      if (!account.consumerKey || !account.consumerSecret || !account.accessToken || !account.accessTokenSecret) {
        return { myBookmarkStatus: 'unknown', bookmark: null, at: Date.now() };
      }
      const bookmark = await getMyBookmark(account, url);
      return { myBookmarkStatus: bookmark ? 'bookmarked' : 'not-bookmarked', bookmark, at: Date.now() };
    } catch {
      return { myBookmarkStatus: 'unknown', bookmark: null, at: Date.now() };
    }
  })().then((result) => {
    if (generation === personalGeneration) personalCache.set(url, result);
    return result;
  }).finally(() => {
    if (personalInFlight.get(url) === request) personalInFlight.delete(url);
    if (personalCache.size > 200) personalCache.delete(personalCache.keys().next().value);
  });
  personalInFlight.set(url, request);
  return request;
}

function updateBadgeAppearance(tabId, requestId) {
  const previous = appearanceQueues.get(tabId) || Promise.resolve();
  const request = previous.catch(() => {}).then(async () => {
    const state = tabState.get(tabId);
    if (!state || tabRequests.get(tabId) !== requestId) return;
    await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeColor(state.myBookmarkStatus) });
    try { await chrome.action.setBadgeTextColor({ tabId, color: '#FFFFFF' }); }
    catch { /* Older Chrome versions use the default contrasting text color. */ }
    if (tabRequests.get(tabId) !== requestId) return;
    await chrome.action.setBadgeText({ tabId, text: state.bookmarkCount === null ? '' : formatBadgeCount(state.bookmarkCount) });
    await chrome.action.setTitle({ tabId, title: badgeTitle(state.bookmarkCount, state.myBookmarkStatus) });
  });
  appearanceQueues.set(tabId, request);
  void request.finally(() => {
    if (appearanceQueues.get(tabId) === request) appearanceQueues.delete(tabId);
  }).catch(() => {});
  return request;
}

async function updateBadge(tabId, url, { force = false } = {}) {
  const requestId = (tabRequests.get(tabId) || 0) + 1;
  tabRequests.set(tabId, requestId);
  tabUrls.set(tabId, url || '');
  const cachedStatus = !force && personalCache.get(url);
  tabState.set(tabId, { url: url || '', bookmarkCount: null,
    myBookmarkStatus: cachedStatus && Date.now() - cachedStatus.at < PERSONAL_TTL_MS
      ? cachedStatus.myBookmarkStatus : 'unknown', updatedAt: Date.now() });
  if (!isSupportedUrl(url)) {
    await updateBadgeAppearance(tabId, requestId);
    if (tabRequests.get(tabId) === requestId) await chrome.action.setTitle({ tabId, title: 'このページでは利用できません' });
    return { status: 'unsupported' };
  }
  if (force) { invalidateCount(url); invalidatePersonal(url); }
  void updateBadgeAppearance(tabId, requestId);
  void cachedPersonal(url).then((personal) => {
    const state = tabState.get(tabId);
    if (!state || state.url !== url || tabRequests.get(tabId) !== requestId) return;
    state.myBookmarkStatus = personal.myBookmarkStatus;
    state.updatedAt = Date.now();
    return updateBadgeAppearance(tabId, requestId);
  }).catch(() => {});
  try {
    const count = await cachedCount(url);
    if (tabUrls.get(tabId) !== url || tabRequests.get(tabId) !== requestId) return { status: 'stale' };
    const state = tabState.get(tabId);
    state.bookmarkCount = count;
    state.updatedAt = Date.now();
    await updateBadgeAppearance(tabId, requestId);
    if (tabRequests.get(tabId) !== requestId) return { status: 'stale' };
    return { status: 'loaded', count };
  } catch {
    if (tabUrls.get(tabId) !== url || tabRequests.get(tabId) !== requestId) return { status: 'stale' };
    tabState.get(tabId).bookmarkCount = null;
    await updateBadgeAppearance(tabId, requestId);
    return { status: 'error' };
  }
}

async function refreshTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.active) await updateBadge(tabId, tab.url || tab.pendingUrl);
  } catch {
    tabUrls.delete(tabId);
    tabState.delete(tabId);
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => { void refreshTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url !== undefined || changeInfo.status === 'complete')) {
    void updateBadge(tabId, tab.url || tab.pendingUrl);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => { tabUrls.delete(tabId); tabRequests.delete(tabId); tabState.delete(tabId); appearanceQueues.delete(tabId); });
chrome.tabs.onReplaced.addListener((newTabId, oldTabId) => {
  tabUrls.delete(oldTabId);
  tabRequests.delete(oldTabId);
  tabState.delete(oldTabId);
  appearanceQueues.delete(oldTabId);
  void refreshTab(newTabId);
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) void refreshTab(details.tabId);
});
chrome.webNavigation.onReferenceFragmentUpdated.addListener((details) => {
  if (details.frameId === 0) void refreshTab(details.tabId);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void chrome.tabs.query({ active: true, windowId }).then((tabs) => {
    if (tabs[0]?.id) return updateBadge(tabs[0].id, tabs[0].url || tabs[0].pendingUrl);
  });
});
function refreshActiveTabs() {
  void chrome.tabs.query({ active: true }).then((tabs) => {
    for (const tab of tabs) if (tab.id) void updateBadge(tab.id, tab.url || tab.pendingUrl);
  });
}
chrome.runtime.onStartup.addListener(refreshActiveTabs);
chrome.runtime.onInstalled.addListener(refreshActiveTabs);
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local' || !['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret'].some((key) => key in changes)) return;
  invalidatePersonal();
  refreshActiveTabs();
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!['getCount', 'getPersonal', 'bookmarkChanged'].includes(message?.type) ||
      !Number.isInteger(message.tabId) || !isSupportedUrl(message.url)) return;
  void chrome.tabs.get(message.tabId)
    .then(async (tab) => {
      if (!tab.active || tab.url !== message.url) return { status: 'stale' };
      if (message.type === 'getPersonal') {
        if (message.force) invalidatePersonal(message.url);
        const personal = await cachedPersonal(message.url);
        return { status: 'loaded', myBookmarkStatus: personal.myBookmarkStatus, bookmark: personal.bookmark };
      }
      if (message.type === 'bookmarkChanged') {
        invalidatePersonal(message.url);
        personalCache.set(message.url, { myBookmarkStatus: 'bookmarked', bookmark: message.bookmark || null, at: Date.now() });
        const state = tabState.get(message.tabId);
        if (state?.url === message.url) {
          state.myBookmarkStatus = 'bookmarked';
          void updateBadgeAppearance(message.tabId, tabRequests.get(message.tabId));
        }
        invalidateCount(message.url);
        return updateBadge(message.tabId, message.url);
      }
      return updateBadge(message.tabId, message.url, { force: message.force === true });
    })
    .then(sendResponse)
    .catch(() => sendResponse({ status: 'error' }));
  return true;
});
