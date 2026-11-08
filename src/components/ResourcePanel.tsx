import React, { useEffect, useRef, useState } from 'react';
import type { AccessToken } from '../auth';
import { getDemoResource } from '../resource';
import type { DemoResource } from '../resource';

export default function ResourcePanel({ token, busy, onAuthorize }: {
  token: AccessToken; busy: boolean; onAuthorize: () => Promise<void>;
}) {
  const [data, setData] = useState<DemoResource | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [token]);

  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    setData(null);
    try {
      const result = await getDemoResource(token, controller.signal);
      if (!controller.signal.aborted) setData(result);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Resource service unavailable.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return <section aria-label="Protected resource">
    <h2>Protected resource</h2>
    <button disabled={busy || loading} onClick={load}>{loading ? 'Loading resource...' : 'Load resource'}</button>
    {error && <><p role="alert">{error}</p><button disabled={busy} onClick={onAuthorize}>Authorize resource access again</button></>}
    {data && <div className="details"><p>{data.message}</p><p>Token subject: {data.subject}</p><ul>{data.items.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
  </section>;
}
