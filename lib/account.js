import { signedFetch } from './oauth.js';

const REQUEST_URL = 'https://www.hatena.com/oauth/initiate';
const ACCESS_URL = 'https://www.hatena.com/oauth/token';
const AUTHORIZE_URL = 'https://www.hatena.ne.jp/oauth/authorize';
const BOOKMARK_URL = 'https://bookmark.hatenaapis.com/rest/1/my/bookmark';
export const OAUTH_SCOPES = 'read_public,write_public,read_private,write_private';

export async function loadAccount() {
  const data = await chrome.storage.local.get(['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret', 'urlName']);
  return {
    consumerKey: data.consumerKey || '',
    consumerSecret: data.consumerSecret || '',
    accessToken: data.accessToken || '',
    accessTokenSecret: data.accessTokenSecret || '',
    urlName: data.urlName || ''
  };
}

export async function requestToken(credentials, callback) {
  const response = await signedFetch({
    method: 'POST', url: REQUEST_URL, credentials,
    oauthExtras: { oauth_callback: callback }, bodyParams: [['scope', OAUTH_SCOPES]]
  });
  if (!response.ok) throw new Error(`Request token HTTP ${response.status}`);
  const form = new URLSearchParams(await response.text());
  const token = form.get('oauth_token');
  const secret = form.get('oauth_token_secret');
  if (!token || !secret || (callback !== 'oob' && form.get('oauth_callback_confirmed') !== 'true')) {
    throw new Error('Invalid request token response');
  }
  return { token, secret };
}

export function authorizationUrl(token) {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('oauth_token', token);
  return url.href;
}

export async function exchangeToken(credentials, request, verifier) {
  if (!verifier || !request?.token || !request?.secret) throw new Error('Missing OAuth verifier');
  const response = await signedFetch({
    method: 'POST', url: ACCESS_URL, credentials,
    token: request.token, tokenSecret: request.secret,
    oauthExtras: { oauth_verifier: verifier }
  });
  if (!response.ok) throw new Error(`Access token HTTP ${response.status}`);
  const form = new URLSearchParams(await response.text());
  const accessToken = form.get('oauth_token');
  const accessTokenSecret = form.get('oauth_token_secret');
  if (!accessToken || !accessTokenSecret) throw new Error('Invalid access token response');
  return { accessToken, accessTokenSecret, urlName: form.get('url_name') || '' };
}

function accountCredentials(account) {
  if (!account.consumerKey || !account.consumerSecret || !account.accessToken || !account.accessTokenSecret) {
    throw new Error('Hatena account is not connected');
  }
  return { consumerKey: account.consumerKey, consumerSecret: account.consumerSecret };
}

export async function getMyBookmark(account, pageUrl) {
  const url = new URL(BOOKMARK_URL);
  url.searchParams.set('url', pageUrl);
  const response = await signedFetch({
    method: 'GET', url: url.href, credentials: accountCredentials(account),
    token: account.accessToken, tokenSecret: account.accessTokenSecret
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Bookmark GET HTTP ${response.status}`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || !Array.isArray(data.tags)) throw new Error('Invalid bookmark response');
  return data;
}

export async function saveMyBookmark(account, pageUrl, { comment, tags, privateBookmark }) {
  if (!Array.isArray(tags) || tags.length > 10 || tags.some((tag) => typeof tag !== 'string' || !tag)) {
    throw new Error('Invalid tags');
  }
  const bodyParams = [
    ['url', pageUrl], ['comment', comment], ['private', privateBookmark ? '1' : '0'],
    ...tags.map((tag) => ['tags', tag])
  ];
  const response = await signedFetch({
    method: 'POST', url: BOOKMARK_URL, credentials: accountCredentials(account),
    token: account.accessToken, tokenSecret: account.accessTokenSecret, bodyParams
  });
  if (!response.ok) throw new Error(`Bookmark POST HTTP ${response.status}`);
  return response.json();
}
