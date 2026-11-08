import type { AccessToken } from './auth';

export interface DemoResource {
  message: string;
  subject: string;
  items: string[];
}

export async function getDemoResource(token: AccessToken, signal?: AbortSignal): Promise<DemoResource> {
  if (token.expiresAt <= Date.now()) throw new Error('Your access token has expired. Please authorize again.');
  const response = await fetch('/api/resources/demo', {
    headers: { Authorization: `Bearer ${token.accessToken}` },
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal
  });
  if (response.status === 401) throw new Error('The resource server rejected your token. Please authorize again.');
  if (response.status === 403) throw new Error('Access denied: demo.read permission is required.');
  if (!response.ok) throw new Error(`Resource request failed (HTTP ${response.status}).`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object'
      || !('message' in body) || typeof body.message !== 'string'
      || !('subject' in body) || typeof body.subject !== 'string'
      || !('items' in body) || !Array.isArray(body.items) || !body.items.every(item => typeof item === 'string')) {
    throw new Error('The resource server returned invalid data.');
  }
  return body as DemoResource;
}
