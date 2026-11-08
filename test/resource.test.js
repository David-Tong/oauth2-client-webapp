import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert/strict';
import { getDemoResource } from '../src/resource';

afterEach(() => vi.unstubAllGlobals());
const token = () => ({ accessToken: 'test-access-token', expiresAt: Date.now() + 60000, lifetime: 60000 });

test('resource request sends bearer token without cookies and accepts resource data', async () => {
  const resource = { message: 'Success', subject: 'user-001', items: ['demo'] };
  const fetch = vi.fn(async () => Response.json(resource));
  vi.stubGlobal('fetch', fetch);
  assert.deepEqual(await getDemoResource(token()), resource);
  assert.equal(fetch.mock.calls[0][0], '/api/resources/demo');
  const options = fetch.mock.calls[0][1];
  assert.equal(options.headers.Authorization, 'Bearer test-access-token');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
});

test('expired token is rejected before making a request', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await assert.rejects(getDemoResource({ ...token(), expiresAt: Date.now() - 1 }), /expired/);
  assert.equal(fetch.mock.calls.length, 0);
});

test('resource errors distinguish rejected token, insufficient scope and service failures', async () => {
  for (const [status, message] of [[401, /authorize again/], [403, /demo.read/], [503, /503/]]) {
    vi.stubGlobal('fetch', async () => new Response(null, { status }));
    await assert.rejects(getDemoResource(token()), message);
  }
  vi.stubGlobal('fetch', async () => Response.json({ message: 'bad shape' }));
  await assert.rejects(getDemoResource(token()), /invalid data/);
  vi.stubGlobal('fetch', async () => { throw new Error('Network unavailable'); });
  await assert.rejects(getDemoResource(token()), /Network unavailable/);
});
