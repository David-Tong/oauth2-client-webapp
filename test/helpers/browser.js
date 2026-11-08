import { afterEach, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import React from 'react';
import { JSDOM } from 'jsdom';
import App from '../../src/App.tsx';
import useAuth from '../../src/hooks/useAuth.ts';

// React DOM detects browser input support when it is first imported.
const initialDom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = initialDom.window;
globalThis.document = initialDom.window.document;
const initialNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
Object.defineProperty(globalThis, 'navigator', { value: initialDom.window.navigator, configurable: true });
const { act, cleanup, fireEvent, render, renderHook } = await import('@testing-library/react');
delete globalThis.window;
delete globalThis.document;
if (initialNavigator) Object.defineProperty(globalThis, 'navigator', initialNavigator);
else delete globalThis.navigator;
initialDom.window.close();

let dom;
let originals;
let location;
let redirects;
let requests;
const identity = { id: 'user-1', username: 'alice' };
const h = React.createElement;

beforeEach(() => {
  originals = new Map();
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:9001/app/' });
  redirects = [];
  requests = [];
  location = { origin: 'http://localhost:9001', pathname: '/app/', search: '', assign: url => redirects.push(url) };
  // Keep real DOM constructors while recording navigation instead of leaving the test page.
  const browser = Object.create(dom.window);
  Object.defineProperties(browser, {
    addEventListener: { value: dom.window.addEventListener.bind(dom.window) },
    removeEventListener: { value: dom.window.removeEventListener.bind(dom.window) },
    dispatchEvent: { value: dom.window.dispatchEvent.bind(dom.window) },
    location: { value: location },
    history: { value: { replaceState: (_state, _title, url) => {
      const next = new URL(url, location.origin);
      location.pathname = next.pathname;
      location.search = next.search;
    } } }
  });
  for (const [key, value] of Object.entries({
    window: browser, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, FormData: dom.window.FormData,
    sessionStorage: dom.window.sessionStorage, crypto: webcrypto,
    IS_REACT_ACT_ENVIRONMENT: true,
    fetch: async (path, options) => {
      requests.push({ path, options });
      if (path === '/api/auth/session') return Response.json(identity);
      if (path === '/api/auth/csrf') return Response.json({ token: 'csrf', headerName: 'X-CSRF' });
      if (path === '/api/auth/logout') return new Response(null, { status: 204 });
      if (path === '/api/auth/login') return Response.json({ continueUrl: '/api/auth/continue?id=abc' });
      if (path === '/oauth2/token') return Response.json({ access_token: 'exchanged', token_type: 'Bearer', expires_in: 300 });
      throw new Error(`Unexpected request: ${path}`);
    }
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
});

function saveToken(overrides = {}) {
  const token = { accessToken: 'secret-access-token', expiresAt: Date.now() + 300000, lifetime: 300000, ...overrides };
  sessionStorage.setItem('oauth2.token', JSON.stringify(token));
  return token;
}

function saveTransaction() {
  sessionStorage.setItem('oauth2.transaction', JSON.stringify({ state: 'ok', verifier: 'verifier', createdAt: Date.now() }));
}

async function mountHook() {
  let hook;
  await act(async () => { hook = renderHook(() => useAuth()); });
  return hook;
}

async function mountApp() {
  let app;
  await act(async () => { app = render(h(App)); });
  return app;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function controlTimers() {
  let now = 1000000;
  let id = 0;
  const timers = new Map();
  const realSetTimeout = globalThis.setTimeout;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  // jsdom uses zero-delay timers for document events; keep those on the real clock.
  vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
    if (!delay) return realSetTimeout(callback, delay, ...args);
    timers.set(++id, { callback, delay });
    return id;
  });
  const realClearTimeout = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(key => {
    if (typeof key === 'number') timers.delete(key);
    else realClearTimeout(key);
  });
  return { timers, advance: elapsed => { now += elapsed; }, fire: async () => {
    const [key, timer] = timers.entries().next().value;
    timers.delete(key);
    await act(async () => { timer.callback(); });
  } };
}

async function waitForRedirect() {
  const deadline = performance.now() + 2000;
  while (redirects.length === 0) {
    if (performance.now() > deadline) throw new Error('Authorization did not redirect');
    await act(async () => { await setImmediate(); });
  }
}

export { act, fireEvent, dom, location, redirects, requests, identity, saveToken, saveTransaction, mountHook, mountApp, deferred, controlTimers, waitForRedirect };
