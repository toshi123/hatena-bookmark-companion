import { loadPublicComments } from '../lib/public-comments.js';
import { loadAccount, saveMyBookmark } from '../lib/account.js';
import { commentStarUri, fetchCommentStars } from '../lib/star-api.js';
import { commentCountDisplay } from '../lib/comment-display.js';
import { isSupportedUrl, sortBookmarks } from '../lib/utils.js';

const countNode = document.querySelector('#count');
const titleNode = document.querySelector('#page-title');
const domainNode = document.querySelector('#domain');
const statusNode = document.querySelector('#status');
const commentsNode = document.querySelector('#comments');
const shownCountNode = document.querySelector('#shown-count');
const addButton = document.querySelector('#add');
const refreshButton = document.querySelector('#refresh');
const accountPrompt = document.querySelector('#account-prompt');
const accountPromptText = document.querySelector('#account-prompt-text');
const bookmarkForm = document.querySelector('#bookmark-form');
const myBookmarkState = document.querySelector('#my-bookmark-state');
const commentInput = document.querySelector('#my-comment');
const tagInput = document.querySelector('#tag-input');
const tagChips = document.querySelector('#tag-chips');
const privateInput = document.querySelector('#private');
const laterInput = document.querySelector('#later');
const submitButton = document.querySelector('#submit-bookmark');
const formStatusNode = document.querySelector('#form-status');

let pageUrl = null;
let pageTitle = '';
let pageTabId = null;
let bookmarks = [];
let entryId = null;
let headlineCommentCount = null;
let publicAvailableCommentCount = null;
let commentSource = null;
let incompleteReason = null;
let order = 'stars';
let loadId = 0;
let countDisplayRequest = 0;
let account = null;
let hasMyBookmark = false;
let tags = [];

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', isError);
}

function setFormStatus(message, isError = false) {
  formStatusNode.textContent = message;
  formStatusNode.classList.toggle('error', isError);
}

function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function renderComments() {
  commentsNode.replaceChildren();
  const visible = sortBookmarks(bookmarks.filter((bookmark) => bookmark.comment.trim()), order);
  const display = commentCountDisplay(visible.length, publicAvailableCommentCount, headlineCommentCount);
  shownCountNode.textContent = display.label;
  if (display.title) shownCountNode.title = display.title;
  else shownCountNode.removeAttribute('title');
  if (!visible.length) {
    setStatus('表示できるコメントはありません。');
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const bookmark of visible) {
    const item = document.createElement('li');
    item.className = 'comment';
    const profileUrl = `https://b.hatena.ne.jp/${encodeURIComponent(bookmark.user)}/`;
    const openProfile = (event) => {
      event.preventDefault();
      void chrome.tabs.create({ url: profileUrl });
    };
    const avatar = document.createElement('a');
    avatar.className = 'avatar';
    avatar.href = profileUrl;
    avatar.target = '_blank';
    avatar.rel = 'noopener noreferrer';
    avatar.setAttribute('aria-label', `${bookmark.user} のプロフィールを開く`);
    avatar.addEventListener('click', openProfile);
    const fallback = document.createElement('span');
    fallback.className = 'avatar-fallback';
    fallback.textContent = bookmark.user[0]?.toUpperCase() || '?';
    const picture = document.createElement('img');
    picture.src = `https://cdn.profile-image.st-hatena.com/users/${encodeURIComponent(bookmark.user)}/profile.png`;
    picture.alt = '';
    picture.width = 32;
    picture.height = 32;
    picture.loading = 'lazy';
    picture.addEventListener('error', () => picture.remove());
    avatar.append(fallback, picture);
    const content = document.createElement('div');
    content.className = 'comment-content';
    const head = document.createElement('div');
    head.className = 'comment-head';
    const user = document.createElement('a');
    user.className = 'user';
    user.textContent = bookmark.user;
    user.href = profileUrl;
    user.target = '_blank';
    user.rel = 'noopener noreferrer';
    user.addEventListener('click', openProfile);
    const metrics = document.createElement('div');
    metrics.className = 'metrics';
    const total = document.createElement('span');
    total.textContent = `★ ${bookmark.starStatus === 'loading' ? '…' : bookmark.starStatus === 'loaded' || bookmark.starStatus === 'not-found' ? bookmark.starTotal : '—'}`;
    const colorSummary = Object.entries(bookmark.starColors || {}).map(([color, count]) => `${color}: ${count}`).join('、');
    total.title = bookmark.starStatus === 'loading' ? 'スターを取得中' :
      bookmark.starStatus === 'error' ? 'スター情報を取得できませんでした' :
      `スター総数${colorSummary ? `（カラースター ${colorSummary}）` : ''}`;
    const supporters = document.createElement('span');
    supporters.className = 'supporters';
    supporters.textContent = `${bookmark.starStatus === 'loading' ? '…' : bookmark.starStatus === 'loaded' || bookmark.starStatus === 'not-found' ? bookmark.supporterCount : '—'}人`;
    supporters.title = 'スターを付けたユニークユーザー数';
    metrics.append(total, supporters);
    head.append(user, metrics);
    const body = document.createElement('p');
    body.className = 'comment-text';
    body.textContent = bookmark.comment;
    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const tags = document.createElement('div');
    tags.className = 'tags';
    for (const tag of bookmark.tags) {
      const tagNode = document.createElement('span');
      tagNode.className = 'tag';
      tagNode.textContent = tag;
      tags.append(tagNode);
    }
    const date = document.createElement('time');
    date.className = 'date';
    date.textContent = dateLabel(bookmark.timestamp);
    if (date.textContent) date.dateTime = bookmark.timestamp;
    meta.append(tags, date);
    content.append(head, body, meta);
    item.append(avatar, content);
    fragment.append(item);
  }
  commentsNode.append(fragment);
}

async function loadPublic({ forceCount = false } = {}) {
  const currentLoad = ++loadId;
  refreshButton.disabled = true;
  commentsNode.replaceChildren();
  bookmarks = [];
  entryId = null;
  headlineCommentCount = null;
  publicAvailableCommentCount = null;
  commentSource = null;
  incompleteReason = null;
  shownCountNode.textContent = '';
  countNode.textContent = '—';
  setStatus('コメントを取得しています…');
  const countRequestId = ++countDisplayRequest;
  const debug = localStorage.getItem('debugStars') === '1' || localStorage.getItem('debugHatena') === '1';
  let countResult = { status: 'error' };
  let diagnostics = null;
  const countPromise = chrome.runtime.sendMessage({
    type: 'getCount', tabId: pageTabId, url: pageUrl, force: forceCount
  }).then((result) => {
    countResult = result || { status: 'error' };
    if (currentLoad === loadId && countDisplayRequest === countRequestId) countNode.textContent = countResult.status === 'loaded'
      ? new Intl.NumberFormat('ja-JP').format(countResult.count) : '—';
  }).catch(() => { countResult = { status: 'error' }; });
  try {
    const publicResult = await loadPublicComments(pageUrl, { debug });
    const { entry } = publicResult;
    if (currentLoad !== loadId) return;
    diagnostics = publicResult.diagnostics;
    headlineCommentCount = publicResult.headlineCommentCount;
    publicAvailableCommentCount = publicResult.publicAvailableCommentCount;
    commentSource = publicResult.commentSource;
    incompleteReason = publicResult.incompleteReason || null;
    titleNode.textContent = entry.title || pageTitle || pageUrl;
    bookmarks = entry.bookmarks;
    entryId = entry.eid;
    if (!bookmarks.some((bookmark) => bookmark.comment.trim())) {
      renderComments();
      if (publicResult.incomplete) setStatus('コメント取得が不完全です。', true);
      else if (publicResult.unverified) setStatus('公開コメント一覧を最後まで確認できませんでした。', true);
      return;
    }
    if (!entryId) {
      bookmarks = bookmarks.map((bookmark) => ({ ...bookmark, starStatus: 'error' }));
      renderComments();
      setStatus('スター情報を対応付けられませんでした。— は未取得を示します。', true);
      return;
    }
    renderComments();
    setStatus('スターを取得しています…');
    const { result, failedBatches, invalidUris, mappingErrors } = await fetchCommentStars(
      entry.eid, bookmarks.filter((bookmark) => bookmark.comment.trim()), { debug });
    if (currentLoad !== loadId) return;
    bookmarks = bookmarks.map((bookmark) => {
      const uri = commentStarUri(entry.eid, bookmark);
      const star = uri ? result.get(uri) : null;
      return { ...bookmark, ...(star ?? { starStatus: 'error' }) };
    });
    renderComments();
    if (failedBatches || invalidUris || mappingErrors || publicResult.incomplete || publicResult.unverified) {
      const messages = [];
      if (publicResult.incomplete) messages.push('コメント取得が不完全です。');
      if (publicResult.unverified) messages.push('公開コメント一覧を最後まで確認できませんでした。');
      if (failedBatches || invalidUris || mappingErrors) messages.push('一部のスター情報を取得できませんでした。— は未取得を示します。');
      setStatus(messages.join(' '), true);
    } else if (commentSource === 'jsonlite-unverified') {
      setStatus('公式ページのコメント件数を検証できませんでした。');
    } else {
      setStatus('');
    }
  } catch {
    if (currentLoad === loadId) {
      bookmarks = bookmarks.map((bookmark) => ({ ...bookmark, starStatus: 'error' }));
      if (bookmarks.length) renderComments();
      setStatus('はてなブックマークの情報を取得できませんでした。更新ボタンで再試行できます。', true);
    }
  } finally {
    await countPromise;
    if (currentLoad === loadId) {
      if (debug) console.debug('Hatena diagnostics', {
        ...diagnostics, countApiCount: countResult.status === 'loaded' ? countResult.count : null,
        commentSource, incompleteReason, headlineCommentCount, publicAvailableCommentCount,
        displayedComments: bookmarks.filter((bookmark) => bookmark.comment.trim()).length
      });
      if (countResult.status === 'error' && !statusNode.classList.contains('error')) {
        setStatus('件数 API を取得できませんでした。', true);
      }
      refreshButton.disabled = false;
    }
  }
}

function renderTagChips() {
  tagChips.replaceChildren();
  for (const tag of tags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const label = document.createElement('span');
    label.textContent = tag;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${tag} を削除`);
    remove.addEventListener('click', () => {
      tags = tags.filter((value) => value !== tag);
      renderTagChips();
    });
    chip.append(label, remove);
    tagChips.append(chip);
  }
}

function addTagsFromInput() {
  const additions = tagInput.value.split(/[,、]/).map((value) => value.trim()).filter(Boolean);
  for (const tag of additions) {
    if (tag === 'あとで読む') laterInput.checked = true;
    else if (!tags.includes(tag)) tags.push(tag);
  }
  tagInput.value = '';
  renderTagChips();
}

async function loadPersonal() {
  try {
    account = await loadAccount();
    if (!account.consumerKey || !account.consumerSecret || !account.accessToken || !account.accessTokenSecret) {
      accountPrompt.hidden = false;
      bookmarkForm.hidden = true;
      accountPromptText.textContent = account.consumerKey && account.consumerSecret
        ? 'Hatena アカウントと接続すると、ここから直接ブックマークできます。'
        : 'Consumer credentials を設定して Hatena に接続すると、ここから直接ブックマークできます。';
      return;
    }
    accountPrompt.hidden = true;
    bookmarkForm.hidden = false;
    submitButton.disabled = true;
    myBookmarkState.textContent = '自分のブックマークを確認しています…';
    const personal = await chrome.runtime.sendMessage({ type: 'getPersonal', tabId: pageTabId, url: pageUrl });
    if (personal?.status !== 'loaded' || personal.myBookmarkStatus === 'unknown') {
      throw new Error('自分のブックマーク状態を確認できませんでした。');
    }
    const existing = personal.bookmark;
    hasMyBookmark = Boolean(existing);
    commentInput.value = typeof existing?.comment === 'string' ? existing.comment : '';
    const existingTags = Array.isArray(existing?.tags) ? existing.tags.filter((tag) => typeof tag === 'string') : [];
    tags = [...new Set(existingTags.filter((tag) => tag !== 'あとで読む'))];
    laterInput.checked = existingTags.includes('あとで読む');
    privateInput.checked = existing != null && existing.private != null &&
      existing.private !== 0 && existing.private !== '0' && existing.private !== false;
    renderTagChips();
    myBookmarkState.textContent = hasMyBookmark ? '登録済みの内容を編集中' : '未ブックマーク';
    submitButton.textContent = hasMyBookmark ? '更新する' : 'ブックマークする';
    submitButton.disabled = false;
  } catch (error) {
    accountPrompt.hidden = true;
    bookmarkForm.hidden = false;
    submitButton.disabled = true;
    myBookmarkState.textContent = '自分のブックマークを取得できませんでした。';
    setFormStatus(error instanceof Error ? error.message : '接続を確認してください。', true);
  }
}

document.querySelectorAll('.sort').forEach((button) => {
  button.addEventListener('click', () => {
    order = button.dataset.sort;
    document.querySelectorAll('.sort').forEach((candidate) => {
      const active = candidate === button;
      candidate.classList.toggle('active', active);
      candidate.setAttribute('aria-pressed', String(active));
    });
    if (bookmarks.length) renderComments();
  });
});
refreshButton.addEventListener('click', () => {
  if (pageUrl) void loadPublic({ forceCount: true }).then(() => loadPersonal());
});
document.querySelector('#settings').addEventListener('click', () => { void chrome.runtime.openOptionsPage(); });
document.querySelector('#tag-add').addEventListener('click', addTagsFromInput);
tagInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); addTagsFromInput(); }
});
bookmarkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pageUrl || !account || submitButton.disabled) return;
  addTagsFromInput();
  const submittedTags = [...tags, ...(laterInput.checked ? ['あとで読む'] : [])];
  if (submittedTags.length > 10) {
    setFormStatus('タグは「あとで読む」を含めて10個までです。', true);
    return;
  }
  submitButton.disabled = true;
  setFormStatus('保存しています…');
  try {
    await saveMyBookmark(account, pageUrl, {
      comment: commentInput.value,
      tags: submittedTags,
      privateBookmark: privateInput.checked
    });
    setFormStatus(hasMyBookmark ? '✓ 更新しました。' : '✓ ブックマークしました。');
    hasMyBookmark = true;
    myBookmarkState.textContent = '登録済みの内容を編集中';
    submitButton.textContent = '更新する';
    const countRequestId = ++countDisplayRequest;
    void chrome.runtime.sendMessage({ type: 'bookmarkChanged', tabId: pageTabId, url: pageUrl,
      bookmark: { comment: commentInput.value, tags: submittedTags, private: privateInput.checked } })
      .then((result) => {
        if (countDisplayRequest === countRequestId) countNode.textContent = result?.status === 'loaded'
          ? new Intl.NumberFormat('ja-JP').format(result.count) : '—';
      }).catch(() => { if (countDisplayRequest === countRequestId) countNode.textContent = '—'; });
  } catch (error) {
    setFormStatus(error instanceof Error ? error.message : '保存できませんでした。', true);
  } finally {
    submitButton.disabled = false;
  }
});
addButton.addEventListener('click', () => {
  if (!pageUrl) return;
  const url = new URL('https://b.hatena.ne.jp/add');
  url.searchParams.set('mode', 'confirm');
  url.searchParams.set('url', pageUrl);
  if (pageTitle) url.searchParams.set('title', pageTitle);
  void chrome.tabs.create({ url: url.href });
});

try {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!isSupportedUrl(tab?.url)) {
    titleNode.textContent = 'このページでは利用できません';
    domainNode.textContent = 'HTTP(S) のページを開いてください。';
    refreshButton.disabled = true;
    setStatus('Chrome の内部ページ、ファイル、空タブなどには対応していません。');
  } else {
    pageUrl = tab.url;
    pageTitle = tab.title || '';
    titleNode.textContent = pageTitle || pageUrl;
    domainNode.textContent = new URL(pageUrl).host;
    addButton.disabled = false;
    pageTabId = tab.id;
    void loadPublic();
    void loadPersonal();
  }
} catch {
  titleNode.textContent = 'このページでは利用できません';
  refreshButton.disabled = true;
  setStatus('現在のタブを取得できませんでした。', true);
}
