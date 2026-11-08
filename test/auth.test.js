import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { beginAuthorization, clearAccessToken, finishAuthorization, getSession, login, logout, readToken, renewalDelay } from '../src/auth.ts';

let storage;
let assigned;

beforeEach(() => {
  storage = new Map();
  assigned = null;
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  globalThis.sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  globalThis.window = { location: { origin: 'http://localhost:9000', assign: url => { assigned = url; } } };
});

afterEach(() => {
  delete globalThis.sessionStorage;
  delete globalThis.window;
  delete globalThis.fetch;
});

test('PKCE authorization and code exchange persist a usable token', async () => {
  await beginAuthorization();
  const url = new URL(assigned, window.location.origin);
  const tx = JSON.parse(storage.get('oauth2.transaction'));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tx.verifier));
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(digest).toString('base64url'));
  assert.equal(url.searchParams.get('state'), tx.state);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:9000/app/callback');
  clearAccessToken();
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/oauth2/token');
    assert.equal(options.body.get('code'), 'one-time-code');
    assert.equal(options.body.get('code_verifier'), tx.verifier);
    assert.equal(options.body.get('grant_type'), 'authorization_code');
    return Response.json({ access_token: 'access', token_type: 'Bearer', expires_in: 300 });
  };
  const token = await finishAuthorization(`?code=one-time-code&state=${tx.state}`);
  assert.equal(token.accessToken, 'access');
  assert.deepEqual(readToken(), token);
  assert.equal(storage.has('oauth2.transaction'), false);
  assert.equal(renewalDelay(token, token.expiresAt - 300000), 270000);
  assert.equal(renewalDelay({ expiresAt: 10000, lifetime: 10000 }, 0), 5000);
  assert.equal(renewalDelay(token, token.expiresAt), 0);
  await assert.rejects(() => finishAuthorization(`?code=one-time-code&state=${tx.state}`), /Invalid authorization state/);
});

test('invalid, expired and duplicate state are rejected without a token request', async () => {
  globalThis.fetch = () => { throw new Error('must not fetch'); };
  for (const suffix of ['state=wrong', 'state=ok&state=ok']) {
    storage.set('oauth2.transaction', JSON.stringify({ state: 'ok', verifier: 'v', createdAt: Date.now() }));
    await assert.rejects(() => finishAuthorization(`?code=c&${suffix}`), /Invalid authorization state/);
    assert.equal(storage.has('oauth2.transaction'), false);
  }
  storage.set('oauth2.transaction', JSON.stringify({ state: 'ok', verifier: 'v', createdAt: Date.now() - 600001 }));
  await assert.rejects(() => finishAuthorization('?code=c&state=ok'), /Invalid authorization state/);
});

test('token errors are surfaced and invalid token responses are not stored', async () => {
  storage.set('oauth2.transaction', JSON.stringify({ state: 'ok', verifier: 'v', createdAt: Date.now() }));
  globalThis.fetch = async () => Response.json({ access_token: 'x', token_type: 'Bearer', expires_in: -1 });
  await assert.rejects(() => finishAuthorization('?code=c&state=ok'), /invalid/);
  assert.equal(readToken(), null);
});

test('login sends fresh CSRF and rejects untrusted continue URLs', async () => {
  let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls++;
    if (path === '/api/auth/csrf') return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'csrf' });
    assert.equal(options.headers['X-CSRF-TOKEN'], 'csrf');
    assert.deepEqual(JSON.parse(options.body), { username: 'alice', password: 'password' });
    return Response.json({ continueUrl: '/api/auth/continue?id=123-abc' });
  };
  await login('alice', 'password');
  assert.equal(calls, 2);
  assert.equal(assigned, '/api/auth/continue?id=123-abc');
  globalThis.fetch = async path => path.endsWith('/csrf')
    ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'csrf' })
    : Response.json({ continueUrl: '//evil.example/' });
  await assert.rejects(() => login('alice', 'password'), /invalid/);
});

test('logout uses a fresh CSRF token and clears local state only on success', async () => {
  storage.set('oauth2.token', 'token');
  storage.set('oauth2.transaction', 'transaction');
  globalThis.fetch = async path => path.endsWith('/csrf')
    ? Response.json({ headerName: 'X-CSRF-TOKEN', token: 'new' })
    : Response.json({ error: 'forbidden' }, { status: 403 });
  await assert.rejects(logout, /403/);
  assert.equal(storage.get('oauth2.token'), 'token');
  globalThis.fetch = async (path, options) => {
    if (path.endsWith('/csrf')) return Response.json({ headerName: 'X-CSRF-TOKEN', token: 'new' });
    assert.equal(options.headers['X-CSRF-TOKEN'], 'new');
    return new Response(null, { status: 204 });
  };
  await logout();
  assert.equal(storage.size, 0);
});

test('session distinguishes expiry from other server failures', async () => {
  globalThis.fetch = async () => Response.json({ error: 'unauthorized' }, { status: 401 });
  assert.equal(await getSession(), null);
  globalThis.fetch = async () => Response.json({ error: 'unavailable' }, { status: 503 });
  await assert.rejects(getSession, /503/);
});
