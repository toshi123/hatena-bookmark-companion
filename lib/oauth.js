// OAuth 1.0a request signing per RFC 5849. No credentials are logged or exported.
export function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signatureBaseString(method, requestUrl, oauthParams, bodyParams = []) {
  const url = new URL(requestUrl);
  const baseUri = `${url.protocol}//${url.host}${url.pathname}`;
  const pairs = [
    ...url.searchParams.entries(),
    ...Object.entries(oauthParams).filter(([key]) => key !== 'oauth_signature'),
    ...bodyParams
  ].map(([key, value]) => [percentEncode(key), percentEncode(value)]);
  pairs.sort(([aKey, aValue], [bKey, bValue]) =>
    aKey < bKey ? -1 : aKey > bKey ? 1 : aValue < bValue ? -1 : aValue > bValue ? 1 : 0);
  const normalized = pairs.map(([key, value]) => `${key}=${value}`).join('&');
  return `${method.toUpperCase()}&${percentEncode(baseUri)}&${percentEncode(normalized)}`;
}

export async function signBaseString(baseString, consumerSecret, tokenSecret = '') {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(`${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(baseString)));
  return btoa(String.fromCharCode(...signature));
}

export async function authorizationHeader({
  method, url, consumerKey, consumerSecret, token = '', tokenSecret = '',
  oauthExtras = {}, bodyParams = [], nonce, timestamp
}) {
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, '0')).join(''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...(token ? { oauth_token: token } : {}),
    ...oauthExtras
  };
  const base = signatureBaseString(method, url, params, bodyParams);
  params.oauth_signature = await signBaseString(base, consumerSecret, tokenSecret);
  return `OAuth ${Object.entries(params).map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`).join(', ')}`;
}

export async function signedFetch({ method, url, credentials, token = '', tokenSecret = '', oauthExtras = {}, bodyParams = [] }) {
  const bodyPairs = Array.from(bodyParams, ([key, value]) => [String(key), String(value)]);
  const authorization = await authorizationHeader({
    method, url, consumerKey: credentials.consumerKey, consumerSecret: credentials.consumerSecret,
    token, tokenSecret, oauthExtras, bodyParams: bodyPairs
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {})
      },
      ...(method === 'POST' ? { body: new URLSearchParams(bodyPairs).toString() } : {}),
      credentials: 'omit',
      redirect: 'error',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}
