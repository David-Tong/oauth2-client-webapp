import React from 'react';

import type { AccessToken, SessionUser } from '../auth';
interface AccountDetailsProps {
  user: SessionUser;
  token: AccessToken;
  busy: boolean;
  canReauthorize: boolean;
  onAuthorize: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

export default function AccountDetails({ user, token, busy, canReauthorize, onAuthorize, onSignOut }: AccountDetailsProps) {
  return (
    <>
      <div className="details">
        <div><span>Username</span><strong>{user.username}</strong></div>
        <div><span>User ID</span><strong>{user.id}</strong></div>
        <div><span>Token expires at</span><strong>{new Date(token.expiresAt).toLocaleString('en-US')}</strong></div>
        <div><span>Scope</span><strong>demo.read</strong></div>
      </div>
      {canReauthorize && <button disabled={busy} onClick={onAuthorize}>Authorize again</button>}
      <button className="secondary" disabled={busy} onClick={onSignOut}>{busy ? 'Signing out...' : 'Sign out'}</button>
    </>
  );
}
