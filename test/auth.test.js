import { afterEach, beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { beginAuthorization, clearAccessToken, clearToken, finishAuthorization, getSession, login, logout, readToken, renewalDelay } from '../src/auth.ts';

let storage;
let assigned;
let originalGlobals;

beforeEach(() => {
  originalGlobals = Object.fromEntries(['crypto', 'sessionStorage', 'window', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  storage = new Map();
  assigned = null;
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  globalThis.sessionStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key)
  };
  globalThis.window = { location: { origin: 'http://localhost:9001', assign: url => { assigned = url; } } };
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(originalGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

test('PKCE authorization and code exchange persist a usable token', async () => {
  await beginAuthorization();
  const url = new URL(assigned, window.location.origin);
  const tx = JSON.parse(storage.get('oauth2.transaction'));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tx.verifier));
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('code_challenge'), Buffer.from(digest).toString('base64url'));
  assert.equal(url.searchParams.get('state'), tx.state);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:9001/app/callback');
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

function setTransaction(overrides = {}) {
  storage.set('oauth2.transaction', JSON.stringify({ state: 'ok', verifier: 'verifier', createdAt: Date.now(), ...overrides }));
}

test('authorization generates fresh PKCE credentials and removes the previous access token', async () => {
  storage.set('oauth2.token', 'old-token');
  await beginAuthorization();
  const first = JSON.parse(storage.get('oauth2.transaction'));
  const params = new URL(assigned, window.location.origin).searchParams;
  assert.equal(params.get('response_type'), 'code');
  assert.equal(params.get('client_id'), 'webapp');
  assert.equal(params.get('scope'), 'demo.read');
  assert.equal(params.get('code_challenge_method'), 'S256');
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.state, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.verifier, first.state);
  assert.equal(storage.has('oauth2.token'), false);
  await beginAuthorization();
  const second = JSON.parse(storage.get('oauth2.transaction'));
  assert.notEqual(first.verifier, second.verifier);
  assert.notEqual(first.state, second.state);
});

test('authorization fails without Web Crypto before changing stored state', async () => {
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  storage.set('oauth2.token', 'old-token');
  await assert.rejects(beginAuthorization, /secure browser context/);
  assert.equal(storage.get('oauth2.token'), 'old-token');
  assert.equal(storage.has('oauth2.transaction'), false);
  assert.equal(assigned, null);
});

describe('missing, malformed and future-dated transactions cannot exchange a code', () => {
  for (const [name, raw] of [
    ['missing', undefined], ['invalid JSON', '{'], ['null', 'null'], ['array', '[]'],
    ['missing verifier', JSON.stringify({ state: 'ok', createdAt: Date.now() })],
    ['invalid timestamp', JSON.stringify({ state: 'ok', verifier: 'v', createdAt: 'today' })],
    ['future timestamp', JSON.stringify({ state: 'ok', verifier: 'v', createdAt: Date.now() + 60000 })]
  ]) {
    test(name, async () => {
      if (raw !== undefined) storage.set('oauth2.transaction', raw);
      let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
      await assert.rejects(() => finishAuthorization('?code=c&state=ok'), /Invalid authorization state/);
      assert.equal(requests, 0);
      assert.equal(storage.has('oauth2.transaction'), false);
    });
  }
});

describe('callback errors and missing or duplicate parameters never request a token', () => {
  for (const [search, message] of [
    ['?code=c', /Invalid authorization state/],
    ['?state=ok', /missing a code/],
    ['?state=ok&code=', /missing a code/],
    ['?state=ok&code=c&code=d', /missing a code/],
    ['?state=ok&error=access_denied', /Authorization failed \(access_denied\)/],
    ['?state=wrong&error=access_denied', /Invalid authorization state/]
  ]) {
    test(search, async () => {
      setTransaction();
      let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
      await assert.rejects(() => finishAuthorization(search), message);
      assert.equal(requests, 0);
      assert.equal(storage.has('oauth2.transaction'), false);
      assert.equal(readToken(), null);
    });
  }
});

test('token exchange uses same-origin form credentials and accepts case-insensitive Bearer tokens', async () => {
  setTransaction();
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/oauth2/token');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(options.body), {
      grant_type: 'authorization_code', client_id: 'webapp',
      redirect_uri: 'http://localhost:9001/app/callback', code: 'a+b&c', code_verifier: 'verifier'
    });
    return Response.json({ access_token: 'access', token_type: 'bEaReR', expires_in: 60 });
  };
  const before = Date.now();
  const token = await finishAuthorization('?state=ok&code=a%2Bb%26c');
  assert.equal(token.lifetime, 60000);
  assert.ok(token.expiresAt >= before + 60000 && token.expiresAt <= Date.now() + 60000);
  assert.deepEqual(readToken(), token);
});

describe('malformed token responses are rejected without persisting tokens', () => {
  for (const body of [
    null, [], {},
    { access_token: '', token_type: 'Bearer', expires_in: 60 },
    { access_token: 123, token_type: 'Bearer', expires_in: 60 },
    { access_token: 'x', token_type: 'Basic', expires_in: 60 },
    { access_token: 'x', token_type: null, expires_in: 60 },
    { access_token: 'x', token_type: 'Bearer', expires_in: '60' },
    { access_token: 'x', token_type: 'Bearer', expires_in: 0 },
    { access_token: 'x', token_type: 'Bearer', expires_in: Number.MAX_VALUE }
  ]) {
    test(JSON.stringify(body), async () => {
      setTransaction();
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(() => finishAuthorization('?state=ok&code=c'), /invalid access token|already expired/);
      assert.equal(readToken(), null);
      assert.equal(storage.has('oauth2.transaction'), false);
    });
  }
});

describe('token exchange reports HTTP, unreadable response and network failures', () => {
  for (const [name, response, message] of [
    ['HTTP error', () => Response.json({ error: 'invalid_grant' }, { status: 400 }), /HTTP 400, invalid_grant/],
    ['missing error detail', () => Response.json({}, { status: 500 }), /HTTP 500, unknown_error/],
    ['non-JSON response', () => new Response('<html>Error</html>', { status: 502 }), /unreadable response \(HTTP 502\)/],
    ['network failure', () => { throw new Error('Network unavailable'); }, /Network unavailable/]
  ]) {
    test(name, async () => {
      setTransaction();
      globalThis.fetch = async () => response();
      await assert.rejects(() => finishAuthorization('?state=ok&code=c'), message);
      assert.equal(readToken(), null);
      assert.equal(storage.has('oauth2.transaction'), false);
    });
  }
});

describe('invalid local token data is removed and reported', () => {
  for (const raw of ['{', 'null', '[]', '{}', ...[
    { accessToken: '', expiresAt: 1000, lifetime: 1000 },
    { accessToken: 'x', expiresAt: '1000', lifetime: 1000 },
    { accessToken: 'x', expiresAt: 1.5, lifetime: 1000 },
    { accessToken: 'x', expiresAt: Number.MAX_VALUE, lifetime: 1000 },
    { accessToken: 'x', expiresAt: 1000, lifetime: 0 },
    { accessToken: 'x', expiresAt: 1000, lifetime: -1 },
    { accessToken: 'x', expiresAt: 1000, lifetime: '1000' }
  ].map(value => JSON.stringify(value))]) {
    test(raw, () => {
      storage.set('oauth2.token', raw);
      assert.throws(readToken, /Invalid local token data/);
      assert.equal(storage.has('oauth2.token'), false);
    });
  }
});

test('token cleanup preserves a pending transaction only when clearing the access token', () => {
  storage.set('unrelated', 'keep');
  setTransaction();
  storage.set('oauth2.token', 'token');
  clearAccessToken();
  assert.equal(readToken(), null);
  assert.equal(storage.has('oauth2.transaction'), true);
  clearToken();
  clearToken();
  assert.deepEqual([...storage], [['unrelated', 'keep']]);
});

test('renewal schedules long tokens thirty seconds early and short tokens halfway through', () => {
  for (const [lifetime, now, expected] of [
    [300000, 0, 270000], [10000, 0, 5000], [60000, 0, 30000],
    [10000, 4999, 1], [10000, 5000, 0], [10000, 11000, 0]
  ]) {
    assert.equal(renewalDelay({ accessToken: 'x', expiresAt: lifetime, lifetime }, now), expected);
  }
});

test('login without a continuation starts a fresh PKCE authorization', async () => {
  const paths = [];
  globalThis.fetch = async (path, options) => {
    paths.push(path);
    assert.equal(options.credentials, 'same-origin');
    if (path === '/api/auth/csrf') {
      assert.equal(options.cache, 'no-store');
      return Response.json({ headerName: 'X-CSRF', token: 'fresh' });
    }
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers['X-CSRF'], 'fresh');
    return Response.json({ continueUrl: null });
  };
  await login('alice', 'password');
  assert.deepEqual(paths, ['/api/auth/csrf', '/api/auth/login']);
  assert.equal(new URL(assigned, window.location.origin).pathname, '/oauth2/authorize');
  assert.equal(storage.has('oauth2.transaction'), true);
});

describe('login rejects unsafe or malformed continuation URLs', () => {
  for (const continueUrl of [undefined, '', 123, 'https://evil.example/', '//evil.example/',
    '/api/auth/continue?id=', '/api/auth/continue?id=abc&next=https://evil.example',
    '/api/auth/continue?id=abc#fragment', '/api/auth/continue?id=../admin']) {
    test(String(continueUrl), async () => {
      assigned = null;
      globalThis.fetch = async path => path.endsWith('/csrf')
        ? Response.json({ headerName: 'X-CSRF', token: 'fresh' })
        : Response.json({ continueUrl });
      await assert.rejects(() => login('alice', 'password'), /invalid authorization continuation URL/);
      assert.equal(assigned, null);
    });
  }
});

describe('invalid CSRF responses prevent login and logout requests and preserve local state', () => {
  for (const body of [null, {}, { token: '', headerName: 'X-CSRF' },
    { token: 'csrf', headerName: '' }, { token: 123, headerName: 'X-CSRF' }]) {
    test(JSON.stringify(body), async () => {
      for (const action of [() => login('alice', 'password'), logout]) {
        storage.set('oauth2.token', 'keep');
        setTransaction();
        const paths = [];
        globalThis.fetch = async path => { paths.push(path); return Response.json(body); };
        await assert.rejects(action, /invalid CSRF token/);
        assert.deepEqual(paths, ['/api/auth/csrf']);
        assert.equal(storage.get('oauth2.token'), 'keep');
        assert.equal(storage.has('oauth2.transaction'), true);
      }
    });
  }
});

test('login reports rejected credentials without redirecting', async () => {
  globalThis.fetch = async path => path.endsWith('/csrf')
    ? Response.json({ headerName: 'X-CSRF', token: 'fresh' })
    : Response.json({ error: 'bad_credentials' }, { status: 401 });
  await assert.rejects(() => login('alice', 'wrong'), /HTTP 401, bad_credentials/);
  assert.equal(assigned, null);
});

test('session requests bypass caches and return identity data', async () => {
  globalThis.fetch = async (path, options) => {
    assert.equal(path, '/api/auth/session');
    assert.deepEqual(options, { credentials: 'same-origin', cache: 'no-store' });
    return Response.json({ id: 'user-1', username: 'alice', extra: 'ignored' });
  };
  assert.deepEqual(await getSession(), { id: 'user-1', username: 'alice' });
});

describe('session rejects invalid identity data', () => {
  for (const body of [null, {}, { id: 1, username: 'alice' }, { id: '1', username: null }]) {
    test(JSON.stringify(body), async () => {
      globalThis.fetch = async () => Response.json(body);
      await assert.rejects(getSession, /invalid session information/);
    });
  }
});
