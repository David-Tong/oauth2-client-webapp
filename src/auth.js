const TRANSACTION = 'oauth2.transaction';
const TOKEN = 'oauth2.token';
const CLIENT_ID = 'webapp';
const SCOPE = 'demo.read';
const TRANSACTION_LIFETIME = 10 * 60 * 1000;

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

function redirectUri() {
  return `${window.location.origin}/app/callback`;
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => {
    throw new Error(`The server returned an unreadable response (HTTP ${response.status}).`);
  });
  if (!response.ok) {
    throw new Error(`Request failed (HTTP ${response.status}, ${body.error || 'unknown_error'}).`);
  }
  return body;
}

export async function beginAuthorization() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('PKCE requires a secure browser context. Use HTTPS or localhost.');
  }
  const verifier = randomString();
  const state = randomString();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  sessionStorage.setItem(TRANSACTION, JSON.stringify({ state, verifier, createdAt: Date.now() }));
  sessionStorage.removeItem(TOKEN);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SCOPE,
    state,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: 'S256'
  });
  window.location.assign(`/oauth2/authorize?${params}`);
}

export async function finishAuthorization(search) {
  const params = new URLSearchParams(search);
  const raw = sessionStorage.getItem(TRANSACTION);
  sessionStorage.removeItem(TRANSACTION);
  let transaction;
  try {
    transaction = JSON.parse(raw);
  } catch {
    throw new Error('Invalid authorization state. Please sign in again.');
  }
  if (!transaction || typeof transaction.state !== 'string' || typeof transaction.verifier !== 'string'
      || !Number.isFinite(transaction.createdAt) || Date.now() - transaction.createdAt > TRANSACTION_LIFETIME
      || Date.now() < transaction.createdAt || params.getAll('state').length !== 1
      || params.get('state') !== transaction.state) {
    throw new Error('Invalid authorization state or expired request. Please sign in again.');
  }
  if (params.has('error')) {
    throw new Error(`Authorization failed (${params.get('error')}).`);
  }
  if (params.getAll('code').length !== 1 || !params.get('code')) {
    throw new Error('The authorization response is missing a code. Please sign in again.');
  }
  const startedAt = Date.now();
  const body = await jsonResponse(await fetch('/oauth2/token', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      redirect_uri: redirectUri(),
      code: params.get('code'),
      code_verifier: transaction.verifier
    })
  }));
  if (typeof body.access_token !== 'string' || !body.access_token
      || typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer'
      || !Number.isFinite(body.expires_in) || body.expires_in <= 0) {
    throw new Error('The server returned an invalid access token.');
  }
  const token = { accessToken: body.access_token, expiresAt: startedAt + body.expires_in * 1000, lifetime: body.expires_in * 1000 };
  if (!Number.isSafeInteger(token.expiresAt) || token.expiresAt <= Date.now()) {
    throw new Error('The received access token has already expired.');
  }
  sessionStorage.setItem(TOKEN, JSON.stringify(token));
  return token;
}

export function readToken() {
  const raw = sessionStorage.getItem(TOKEN);
  if (!raw) return null;
  let token;
  try {
    token = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(TOKEN);
    throw new Error('Invalid local token data. Please sign in again.');
  }
  if (!token || typeof token.accessToken !== 'string' || !token.accessToken
      || !Number.isSafeInteger(token.expiresAt) || !Number.isFinite(token.lifetime) || token.lifetime <= 0) {
    sessionStorage.removeItem(TOKEN);
    throw new Error('Invalid local token data. Please sign in again.');
  }
  return token;
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN);
  sessionStorage.removeItem(TRANSACTION);
}

export function clearAccessToken() {
  sessionStorage.removeItem(TOKEN);
}

export function renewalDelay(token, now = Date.now()) {
  return Math.max(0, token.expiresAt - now - Math.min(30000, token.lifetime / 2));
}

async function csrf() {
  const body = await jsonResponse(await fetch('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' }));
  if (typeof body.token !== 'string' || !body.token || typeof body.headerName !== 'string' || !body.headerName) {
    throw new Error('The server returned an invalid CSRF token.');
  }
  return body;
}

export async function login(username, password) {
  const token = await csrf();
  const body = await jsonResponse(await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [token.headerName]: token.token },
    body: JSON.stringify({ username, password })
  }));
  if (body.continueUrl !== null) {
    if (typeof body.continueUrl !== 'string' || !/^\/api\/auth\/continue\?id=[A-Za-z0-9-]+$/.test(body.continueUrl)) {
      throw new Error('The server returned an invalid authorization continuation URL.');
    }
    window.location.assign(body.continueUrl);
  } else {
    await beginAuthorization();
  }
}

export async function getSession() {
  const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) return null;
  const body = await jsonResponse(response);
  if (typeof body.id !== 'string' || typeof body.username !== 'string') {
    throw new Error('The server returned invalid session information.');
  }
  return body;
}

export async function logout() {
  const token = await csrf();
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { [token.headerName]: token.token }
  });
  if (!response.ok) await jsonResponse(response);
  clearToken();
}
