import React from 'react';

interface LoginFormProps {
  busy: boolean;
  onSignIn: (username: string, password: string) => Promise<boolean | undefined>;
}

export default function LoginForm({ busy, onSignIn }: LoginFormProps) {
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const username = data.get('username');
    const password = data.get('password');
    if (typeof username !== 'string' || typeof password !== 'string') return;
    if (await onSignIn(username, password)) {
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
