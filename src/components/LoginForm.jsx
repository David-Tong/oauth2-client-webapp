import React from 'react';

export default function LoginForm({ busy, onSignIn }) {
  async function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (await onSignIn(data.get('username'), data.get('password'))) {
      form.reset();
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="username">Username</label>
      <input id="username" name="username" autoComplete="username" required maxLength={128} autoFocus />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button disabled={busy} type="submit">{busy ? 'Signing in...' : 'Sign in and authorize'}</button>
    </form>
  );
}
