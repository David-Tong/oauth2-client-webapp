import React from 'react';

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}

export default function AuthLayout({ title, subtitle, children }: AuthLayoutProps) {
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
