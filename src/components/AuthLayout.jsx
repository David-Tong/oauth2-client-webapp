import React from 'react';

export default function AuthLayout({ title, subtitle, children }) {
  return (
    <main className="shell">
      <section className="card">
        <div className="mark" aria-hidden="true">O</div>
        <p className="eyebrow">OAUTH2 · PKCE</p>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
        {children}
        <p className="footnote">Authorization code + PKCE - Tokens are stored in this tab</p>
      </section>
    </main>
  );
}
