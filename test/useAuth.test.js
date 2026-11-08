import { test } from 'vitest';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { act, dom, location, redirects, requests, identity, saveToken, saveTransaction, mountHook, deferred, controlTimers, waitForRedirect } from './helpers/browser.js';

test('useAuth starts at welcome without requesting a session when no token exists', async () => {
  const { result } = await mountHook();
  assert.equal(result.current.view, 'welcome');
  assert.equal(result.current.busy, false);
  assert.equal(result.current.error, '');
  assert.equal(result.current.user, null);
  assert.equal(result.current.token, null);
  assert.deepEqual(requests, []);
});

test('useAuth login route clears only the access token and preserves the pending transaction', async () => {
  location.pathname = '/app/login';
  saveToken();
  saveTransaction();
  const { result } = await mountHook();
  assert.equal(result.current.view, 'login');
  assert.equal(sessionStorage.getItem('oauth2.token'), null);
  assert.notEqual(sessionStorage.getItem('oauth2.transaction'), null);
  assert.deepEqual(requests, []);
});

test('useAuth restores an existing token and server identity', async () => {
  const token = saveToken();
  const { result } = await mountHook();
  assert.equal(result.current.view, 'account');
  assert.deepEqual(result.current.user, identity);
  assert.deepEqual(result.current.token, token);
  assert.deepEqual(requests.map(r => r.path), ['/api/auth/session']);
});

test('useAuth exchanges callbacks and removes authorization parameters from the URL', async () => {
  location.pathname = '/app/callback';
  location.search = '?state=ok&code=one-time-code';
  saveTransaction();
  const { result } = await mountHook();
  assert.equal(result.current.view, 'account');
  assert.equal(result.current.token.accessToken, 'exchanged');
  assert.equal(location.pathname, '/app/');
  assert.equal(location.search, '');
  assert.equal(sessionStorage.getItem('oauth2.transaction'), null);
  assert.deepEqual(requests.map(r => r.path), ['/oauth2/token', '/api/auth/session']);
});

test('useAuth rejects invalid callbacks, cleans local state and returns to welcome', async () => {
  location.pathname = '/app/callback';
  location.search = '?state=wrong&code=c';
  saveToken();
  saveTransaction();
  const { result } = await mountHook();
  assert.equal(result.current.view, 'welcome');
  assert.match(result.current.error, /Invalid authorization state/);
  assert.equal(sessionStorage.length, 0);
  assert.equal(location.search, '');
  assert.deepEqual(requests, []);
});

test('useAuth handles expired sessions and clears all authentication state', async () => {
  saveToken();
  saveTransaction();
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const { result } = await mountHook();
  assert.equal(result.current.view, 'welcome');
  assert.match(result.current.error, /server session has expired/);
  assert.equal(result.current.user, null);
  assert.equal(result.current.token, null);
  assert.equal(sessionStorage.length, 0);
});

test('useAuth reports initialization failures and clears malformed local tokens', async () => {
  sessionStorage.setItem('oauth2.token', '{');
  const { result } = await mountHook();
  assert.equal(result.current.view, 'welcome');
  assert.match(result.current.error, /Invalid local token data/);
  assert.equal(sessionStorage.length, 0);
});

test('useAuth sign-in guards concurrent operations and stays busy while redirecting', async () => {
  location.pathname = '/app/login';
  const { result } = await mountHook();
  const pending = deferred();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (...args) => { await pending.promise; return fetchOriginal(...args); };
  let first;
  await act(async () => {
    first = result.current.signIn('alice', 'password');
    assert.equal(await result.current.signIn('alice', 'password'), undefined);
    await result.current.authorize();
    await result.current.signOut();
  });
  assert.equal(result.current.busy, true);
  await act(async () => { pending.resolve(); assert.equal(await first, true); });
  assert.equal(result.current.busy, true);
  assert.deepEqual(requests.map(r => r.path), ['/api/auth/csrf', '/api/auth/login']);
  assert.deepEqual(redirects, ['/api/auth/continue?id=abc']);
});

test('useAuth allows sign-in retry after failure and clears the previous error', async () => {
  const { result } = await mountHook();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Offline'); };
  await act(async () => { assert.equal(await result.current.signIn('alice', 'wrong'), undefined); });
  assert.equal(result.current.busy, false);
  assert.equal(result.current.error, 'Offline');
  globalThis.fetch = fetchOriginal;
  await act(async () => { assert.equal(await result.current.signIn('alice', 'password'), true); });
  assert.equal(result.current.error, '');
  assert.equal(redirects.length, 1);
});

test('useAuth authorization failure releases the operation guard for a retry', async () => {
  const { result } = await mountHook();
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  await act(async () => { await result.current.authorize(); });
  assert.equal(result.current.busy, false);
  assert.match(result.current.error, /secure browser context/);
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  await act(async () => { await result.current.authorize(); });
  assert.equal(result.current.error, '');
  assert.equal(result.current.busy, true);
  assert.equal(redirects.length, 1);
});

test('useAuth successful sign-out clears identity, storage and busy state', async () => {
  saveToken();
  saveTransaction();
  const { result } = await mountHook();
  await act(async () => { await result.current.signOut(); });
  assert.equal(result.current.view, 'welcome');
  assert.equal(result.current.user, null);
  assert.equal(result.current.token, null);
  assert.equal(result.current.busy, false);
  assert.equal(sessionStorage.length, 0);
  assert.equal(location.pathname, '/app/');
});

test('useAuth failed sign-out retains the account and allows retry', async () => {
  const token = saveToken();
  const { result } = await mountHook();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async path => path.endsWith('/logout')
    ? Response.json({ error: 'unavailable' }, { status: 503 }) : fetchOriginal(path);
  await act(async () => { await result.current.signOut(); });
  assert.equal(result.current.view, 'account');
  assert.deepEqual(result.current.token, token);
  assert.deepEqual(result.current.user, identity);
  assert.equal(result.current.busy, false);
  assert.match(result.current.error, /503/);
  globalThis.fetch = fetchOriginal;
  await act(async () => { await result.current.signOut(); });
  assert.equal(result.current.view, 'welcome');
  assert.equal(result.current.error, '');
});

test('useAuth renews thirty seconds before expiry and removes timers on unmount', async () => {
  const clock = controlTimers();
  saveToken();
  const hook = await mountHook();
  assert.deepEqual([...clock.timers.values()].map(t => t.delay), [270000]);
  clock.advance(270000);
  await clock.fire();
  await waitForRedirect();
  assert.equal(redirects.length, 1);
  assert.equal(hook.result.current.busy, true);
  assert.equal(sessionStorage.getItem('oauth2.token'), null);
  hook.unmount();
  assert.equal(clock.timers.size, 0);
  document.dispatchEvent(new dom.window.Event('visibilitychange'));
  assert.equal(clock.timers.size, 0);
  assert.equal(redirects.length, 1);
});

test('useAuth checks expiry when the tab becomes visible and authorizes only once', async () => {
  const clock = controlTimers();
  saveToken();
  const hook = await mountHook();
  clock.advance(300000);
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
  await waitForRedirect();
  assert.equal(redirects.length, 1);
  await act(async () => { document.dispatchEvent(new dom.window.Event('visibilitychange')); });
  assert.equal(redirects.length, 1);
  assert.equal(clock.timers.size, 0);
  hook.unmount();
});

test('useAuth defers renewal during sign-out and cancels the retry on success', async () => {
  const clock = controlTimers();
  saveToken();
  const hook = await mountHook();
  const pending = deferred();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (...args) => { await pending.promise; return fetchOriginal(...args); };
  let signingOut;
  await act(async () => { signingOut = hook.result.current.signOut(); });
  clock.advance(270000);
  await clock.fire();
  assert.deepEqual([...clock.timers.values()].map(t => t.delay), [1000]);
  assert.equal(redirects.length, 0);
  await act(async () => { pending.resolve(); await signingOut; });
  assert.equal(hook.result.current.view, 'welcome');
  assert.equal(clock.timers.size, 0);
});

test('useAuth caps long renewal timers to the browser timeout limit', async () => {
  const clock = controlTimers();
  saveToken({ expiresAt: Date.now() + 3000000000, lifetime: 3000000000 });
  const hook = await mountHook();
  assert.deepEqual([...clock.timers.values()].map(t => t.delay), [2147483647]);
  hook.unmount();
  assert.equal(clock.timers.size, 0);
});

