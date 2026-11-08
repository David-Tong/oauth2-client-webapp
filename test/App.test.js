import { test } from 'vitest';
import assert from 'node:assert/strict';
import { act, fireEvent, location, redirects, identity, saveToken, mountApp, deferred } from './helpers/browser.js';

test('App loads protected resource and displays the server subject', async () => {
  saveToken();
  const ui = await mountApp();
  const pending = deferred();
  globalThis.fetch = () => pending.promise;
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Load resource' })); });
  assert.equal(ui.getByRole('button', { name: 'Loading resource...' }).disabled, true);
  await act(async () => { pending.resolve(Response.json({ message: 'Protected data loaded', subject: 'user-001', items: ['Resource item'] })); });
  assert.ok(ui.getByText('Protected data loaded'));
  assert.ok(ui.getByText('Token subject: user-001'));
  assert.ok(ui.getByText('Resource item'));
  assert.equal(ui.getByRole('button', { name: 'Load resource' }).disabled, false);
});

test('App reports rejected resource token and can restart authorization', async () => {
  saveToken();
  const ui = await mountApp();
  globalThis.fetch = async () => new Response(null, { status: 401 });
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Load resource' })); });
  assert.match(ui.getByRole('alert').textContent, /authorize again/);
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Authorize resource access again' })); });
  assert.equal(redirects.length, 1);
});

test('App shows a loading status while restoring a server session', async () => {
  saveToken();
  const pending = deferred();
  globalThis.fetch = () => pending.promise;
  const ui = await mountApp();
  assert.match(ui.getByRole('status').textContent, /Processing/);
  await act(async () => { pending.resolve(Response.json(identity)); });
  assert.equal(ui.queryByRole('status'), null);
  assert.ok(ui.getByRole('heading', { name: 'Signed in' }));
});

test('App welcome sign-in button starts authorization and displays redirect feedback', async () => {
  const ui = await mountApp();
  assert.ok(ui.getByRole('heading', { name: 'Secure sign-in' }));
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Sign in' })); });
  assert.equal(ui.getByRole('button', { name: 'Redirecting...' }).disabled, true);
  assert.equal(redirects.length, 1);
});

test('App login view displays errors and supports retry through the form', async () => {
  location.pathname = '/app/login';
  const ui = await mountApp();
  assert.ok(ui.getByRole('heading', { name: 'Welcome back' }));
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Sign-in unavailable'); };
  const username = ui.getByLabelText('Username');
  fireEvent.change(username, { target: { value: 'alice' } });
  fireEvent.change(ui.getByLabelText('Password'), { target: { value: 'password' } });
  await act(async () => { fireEvent.submit(username.form); });
  assert.equal(ui.getByRole('alert').textContent, 'Sign-in unavailable');
  assert.equal(ui.getByRole('button', { name: 'Sign in and authorize' }).disabled, false);
  globalThis.fetch = fetchOriginal;
  await act(async () => { fireEvent.submit(username.form); });
  assert.equal(ui.queryByRole('alert'), null);
  assert.equal(ui.getByLabelText('Password').value, '');
  assert.equal(ui.getByRole('button', { name: 'Signing in...' }).disabled, true);
});

test('App account view offers reauthorization after sign-out failure and returns to welcome on retry', async () => {
  saveToken();
  const ui = await mountApp();
  assert.ok(ui.getByText('alice'));
  assert.equal(ui.queryByRole('button', { name: 'Authorize again' }), null);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Logout unavailable'); };
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Sign out' })); });
  assert.equal(ui.getByRole('alert').textContent, 'Logout unavailable');
  assert.ok(ui.getByRole('button', { name: 'Authorize again' }));
  globalThis.fetch = fetchOriginal;
  await act(async () => { fireEvent.click(ui.getByRole('button', { name: 'Sign out' })); });
  assert.ok(ui.getByRole('button', { name: 'Sign in' }));
  assert.equal(ui.queryByText('alice'), null);
  assert.equal(ui.queryByRole('alert'), null);
});
