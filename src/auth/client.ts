import type { AuthAccount, AuthMeResponse, AuthSessionResponse, Credentials } from './types';

const AUTH_SERVER_URL = import.meta.env.VITE_AUTH_SERVER_URL ?? 'http://localhost:8788';

async function requestJson<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`${AUTH_SERVER_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? 'Authentication request failed');
  }

  return payload as T;
}

export async function login(credentials: Credentials): Promise<AuthAccount> {
  const result = await requestJson<AuthSessionResponse>('/api/login', credentials);
  return result.account;
}

export async function signup(credentials: Credentials): Promise<AuthAccount> {
  const result = await requestJson<AuthSessionResponse>('/api/signup', credentials);
  return result.account;
}

export async function getCurrentSession(): Promise<AuthAccount | null> {
  const response = await fetch(`${AUTH_SERVER_URL}/api/me`, {
    credentials: 'include',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return null;
  }

  return (payload as AuthMeResponse).account;
}

export async function logout(): Promise<void> {
  await requestJson('/api/logout', undefined, 'POST');
}

export async function requestOAuthPlaceholder(provider: 'google' | 'microsoft'): Promise<never> {
  await requestJson(`/api/oauth/${provider}`, undefined, 'POST');
  throw new Error('Unexpected OAuth placeholder response');
}