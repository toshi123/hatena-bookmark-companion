import { loadAccount, requestToken, authorizationUrl, exchangeToken } from '../lib/account.js';

const keyInput = document.querySelector('#consumer-key');
const secretInput = document.querySelector('#consumer-secret');
const verifierInput = document.querySelector('#verifier');
const verifierArea = document.querySelector('#verifier-area');
const connectionNode = document.querySelector('#connection');
const statusNode = document.querySelector('#status');
const buttons = ['save', 'clear', 'connect', 'manual', 'disconnect', 'finish'].map((id) => document.getElementById(id));
let pendingRequest = null;
let busy = false;

function status(message, error = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle('error', error);
}

function setBusy(value) {
  busy = value;
  for (const button of buttons) button.disabled = value;
}

async function refreshConnection() {
  const account = await loadAccount();
  connectionNode.textContent = account.accessToken && account.accessTokenSecret
    ? `Hatena: 接続済み${account.urlName ? ` ／ ユーザー: ${account.urlName}` : ''}`
    : 'Hatena: 未接続';
}

async function saveInputs() {
  const consumerKey = keyInput.value.trim();
  const consumerSecret = secretInput.value.trim();
  if (!consumerKey || !consumerSecret) throw new Error('Consumer key と secret を入力してください。');
  const previous = await loadAccount();
  if (previous.consumerKey !== consumerKey || previous.consumerSecret !== consumerSecret) {
    pendingRequest = null;
    verifierInput.value = '';
    verifierArea.hidden = true;
    await chrome.storage.local.remove(['accessToken', 'accessTokenSecret', 'urlName']);
  }
  await chrome.storage.local.set({ consumerKey, consumerSecret });
  await refreshConnection();
  return { consumerKey, consumerSecret };
}

async function runAction(action) {
  if (busy) return;
  setBusy(true);
  status('');
  try {
    await action();
  } catch (error) {
    status(error instanceof Error ? error.message : '操作に失敗しました。', true);
  } finally {
    setBusy(false);
  }
}

document.querySelector('#save').addEventListener('click', () => void runAction(async () => {
  await saveInputs();
  status('Consumer credentials を保存しました。');
}));

document.querySelector('#connect').addEventListener('click', () => void runAction(async () => {
  const credentials = await saveInputs();
  const callback = chrome.identity.getRedirectURL('hatena');
  const request = await requestToken(credentials, callback);
  const redirect = await chrome.identity.launchWebAuthFlow({ url: authorizationUrl(request.token), interactive: true });
  if (!redirect || new URL(redirect).origin !== new URL(callback).origin ||
      new URL(redirect).pathname !== new URL(callback).pathname) {
    throw new Error('認証の戻り先を確認できませんでした。確認コード方式をお試しください。');
  }
  const result = new URL(redirect);
  if (result.searchParams.get('oauth_token') !== request.token || !result.searchParams.get('oauth_verifier')) {
    throw new Error('OAuth の確認値が一致しません。確認コード方式をお試しください。');
  }
  const access = await exchangeToken(credentials, request, result.searchParams.get('oauth_verifier'));
  await chrome.storage.local.set(access);
  await refreshConnection();
  status('Hatena に接続しました。');
}));

document.querySelector('#manual').addEventListener('click', () => void runAction(async () => {
  const credentials = await saveInputs();
  pendingRequest = await requestToken(credentials, 'oob');
  verifierArea.hidden = false;
  verifierInput.value = '';
  await chrome.tabs.create({ url: authorizationUrl(pendingRequest.token) });
  status('はてなの画面で認証し、表示された確認コードをここに入力してください。');
}));

document.querySelector('#finish').addEventListener('click', () => void runAction(async () => {
  if (!pendingRequest) throw new Error('確認コード方式を最初からやり直してください。');
  const account = await loadAccount();
  const access = await exchangeToken(account, pendingRequest, verifierInput.value.trim());
  await chrome.storage.local.set(access);
  pendingRequest = null;
  verifierInput.value = '';
  verifierArea.hidden = true;
  await refreshConnection();
  status('Hatena に接続しました。');
}));

document.querySelector('#disconnect').addEventListener('click', () => void runAction(async () => {
  await chrome.storage.local.remove(['accessToken', 'accessTokenSecret', 'urlName']);
  pendingRequest = null;
  verifierArea.hidden = true;
  await refreshConnection();
  status('接続を解除しました。Consumer credentials は保存されています。');
}));

document.querySelector('#clear').addEventListener('click', () => void runAction(async () => {
  await chrome.storage.local.remove(['consumerKey', 'consumerSecret', 'accessToken', 'accessTokenSecret', 'urlName']);
  keyInput.value = '';
  secretInput.value = '';
  pendingRequest = null;
  verifierArea.hidden = true;
  await refreshConnection();
  status('保存した設定を削除しました。');
}));

try {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const account = await loadAccount();
  keyInput.value = account.consumerKey;
  secretInput.value = account.consumerSecret;
  await refreshConnection();
} catch {
  status('設定を読み込めませんでした。', true);
}
