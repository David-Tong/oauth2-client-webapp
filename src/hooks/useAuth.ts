import { useEffect, useRef, useState } from 'react';
import { beginAuthorization, clearAccessToken, clearToken, finishAuthorization, getSession, login, logout, readToken, renewalDelay } from '../auth';

import type { AccessToken, SessionUser } from '../auth';

export type AuthView = 'loading' | 'welcome' | 'login' | 'account';

export default function useAuth() {
  const [view, setView] = useState<AuthView>('loading');
  const [error, setError] = useState('');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [token, setToken] = useState<AccessToken | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);

  async function authorize() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await beginAuthorization();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setBusy(false);
      operation.current = false;
    }
  }

  useEffect(() => {
    async function initialize() {
      try {
        let current;
        if (window.location.pathname === '/app/callback') {
          const search = window.location.search;
          window.history.replaceState(null, '', '/app/');
          current = await finishAuthorization(search);
        } else if (window.location.pathname === '/app/login') {
          clearAccessToken();
          setView('login');
          return;
        } else {
          current = readToken();
        }
        if (!current) {
          setView('welcome');
          return;
        }
        const identity = await getSession();
        if (!identity) {
          clearToken();
          setError('Your server session has expired. Please sign in again.');
          setView('welcome');
          return;
        }
        setUser(identity);
        setToken(current);
        setView('account');
      } catch (err) {
        clearToken();
        setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
        setView('welcome');
      }
    }
    initialize();
  }, []);

  useEffect(() => {
    if (view !== 'account' || !token) return undefined;
    const currentToken = token;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule() {
      clearTimeout(timer);
      const delay = renewalDelay(currentToken);
      if (delay <= 0) {
        if (active && operation.current) {
          timer = setTimeout(schedule, 1000);
        } else if (active) {
          active = false;
          authorize();
        }
      } else {
        timer = setTimeout(schedule, Math.min(delay, 2147483647));
      }
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [view, token]);

  async function signIn(username: string, password: string) {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await login(username, password);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
      setBusy(false);
      operation.current = false;
    }
  }

  async function signOut() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await logout();
      setToken(null);
      setUser(null);
      window.history.replaceState(null, '', '/app/');
      setView('welcome');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setBusy(false);
      operation.current = false;
    }
  }

  return { view, error, user, token, busy, authorize, signIn, signOut };
}
