import React from 'react';
import AuthLayout from './components/AuthLayout';
import LoginForm from './components/LoginForm';
import AccountDetails from './components/AccountDetails';
import useAuth from './hooks/useAuth';

const headings = {
  loading: ['Secure sign-in', 'Sign in to this app with your authorization server account.'],
  welcome: ['Secure sign-in', 'Sign in to this app with your authorization server account.'],
  login: ['Welcome back', 'Enter your username and password to continue authorization.'],
  account: ['Signed in', 'Your account is connected. The access token will renew automatically before it expires.']
};

export default function App() {
  const { view, error, user, token, busy, authorize, signIn, signOut } = useAuth();
  const [title, subtitle] = headings[view];

  return (
    <AuthLayout title={title} subtitle={subtitle}>
      {error && <div className="error" role="alert">{error}</div>}
      {view === 'loading' && <p role="status">Processing, please wait...</p>}
      {view === 'welcome' && (
        <button disabled={busy} onClick={authorize}>{busy ? 'Redirecting...' : 'Sign in'}</button>
      )}
      {view === 'login' && <LoginForm busy={busy} onSignIn={signIn} />}
      {view === 'account' && user && token && (
        <AccountDetails user={user} token={token} busy={busy} canReauthorize={Boolean(error)} onAuthorize={authorize} onSignOut={signOut} />
      )}
    </AuthLayout>
  );
}
