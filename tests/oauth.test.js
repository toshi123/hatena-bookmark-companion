import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureBaseString, signBaseString, authorizationHeader } from '../lib/oauth.js';
import { requestToken, exchangeToken, getMyBookmark, saveMyBookmark, OAUTH_SCOPES } from '../lib/account.js';

test('OAuth 1.0a signer matches RFC 5849 example with verified erratum 2550', async () => {
  const base = signatureBaseString(
    'POST', 'http://example.com/request?b5=%3D%253D&a3=a&c%40=&a2=r%20b',
    {
      oauth_consumer_key: '9djdj82h48djs9d2',
      oauth_token: 'kkk9d7dh3k39sjv7',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '137131201',
      oauth_nonce: '7d8f3e4a'
    }, [['c2', ''], ['a3', '2 q']]
  );
  assert.equal(await signBaseString(base, 'j49sk3j29djd', 'dh893hdasih9'), 'r6/TJjbCOr97/+UU0NsvSne7s5g=');
});

test('OAuth header signs duplicate form parameters and hides shared secrets', async () => {
  const header = await authorizationHeader({
    method: 'POST', url: 'https://bookmark.hatenaapis.com/rest/1/my/bookmark',
    consumerKey: 'key', consumerSecret: 'private-secret', token: 'token', tokenSecret: 'token-secret',
    bodyParams: [['tags', 'science'], ['tags', 'AI']], nonce: 'fixed', timestamp: '123'
  });
  assert.match(header, /^OAuth /);
  assert.match(header, /oauth_signature="/);
  assert.doesNotMatch(header, /private-secret|token-secret/);
});

test('request and access token exchange use Hatena form endpoints', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(calls.length === 1
      ? 'oauth_token=temp&oauth_token_secret=tempsecret&oauth_callback_confirmed=true'
      : 'oauth_token=access&oauth_token_secret=accesssecret&url_name=testuser');
  };
  const credentials = { consumerKey: 'key', consumerSecret: 'secret' };
  const request = await requestToken(credentials, 'https://example.chromiumapp.org/hatena');
  assert.deepEqual(request, { token: 'temp', secret: 'tempsecret' });
  assert.equal(new URLSearchParams(calls[0].options.body).get('scope'), OAUTH_SCOPES);
  assert.match(calls[0].options.headers.Authorization, /oauth_callback=/);
  const access = await exchangeToken(credentials, request, 'verifier');
  assert.deepEqual(access, { accessToken: 'access', accessTokenSecret: 'accesssecret', urlName: 'testuser' });
  assert.match(calls[1].options.headers.Authorization, /oauth_verifier="verifier"/);
});

test('existing bookmark 404 is absent; POST sends comment, repeated tags and private flag', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1 ? new Response('', { status: 404 }) : Response.json({ user: 'test' });
  };
  const account = {
    consumerKey: 'key', consumerSecret: 'secret', accessToken: 'access', accessTokenSecret: 'accesssecret'
  };
  const pageUrl = 'https://example.com/?x=1#part';
  assert.equal(await getMyBookmark(account, pageUrl), null);
  assert.equal(new URL(calls[0].url).searchParams.get('url'), pageUrl);
  await saveMyBookmark(account, pageUrl, { comment: 'test', tags: ['science', 'あとで読む'], privateBookmark: true });
  const form = new URLSearchParams(calls[1].options.body);
  assert.equal(form.get('url'), pageUrl);
  assert.equal(form.get('comment'), 'test');
  assert.deepEqual(form.getAll('tags'), ['science', 'あとで読む']);
  assert.equal(form.get('private'), '1');
});
