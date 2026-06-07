import type {
  AuthAccount,
  AuthMeResponse,
  AuthSessionResponse,
  Credentials,
  LoginCredentials,
  DevStatsResponse,
  GamesResponse,
  GameSummary,
  JoinGameResponse,
} from './types';
import type { FlagDesign } from '@/flags/flagTypes';
import type { SpeciesSetup } from '@/data/Species';

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

export async function login(credentials: LoginCredentials): Promise<AuthAccount> {
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

export async function loginToDevPanel(password: string): Promise<void> {
  await requestJson('/api/dev/login', { password });
}

export async function getDevStats(): Promise<DevStatsResponse> {
  return requestJson<DevStatsResponse>('/api/dev/stats', undefined, 'GET');
}

export async function logoutFromDevPanel(): Promise<void> {
  await requestJson('/api/dev/logout', undefined, 'POST');
}

export async function getGames(): Promise<GameSummary[]> {
  const result = await requestJson<GamesResponse>('/api/games', undefined, 'GET');
  return result.games;
}

export async function joinGame(
  gameId: string,
  countryName: string,
  flagDesign?: FlagDesign,
  speciesSetup?: SpeciesSetup,
): Promise<JoinGameResponse> {
  return requestJson<JoinGameResponse>(`/api/games/${encodeURIComponent(gameId)}/join`, { countryName, flagDesign, speciesSetup });
}

export async function createDevGame(name: string): Promise<void> {
  await requestJson('/api/dev/games', { name });
}

export async function deleteDevGame(gameId: string): Promise<void> {
  await requestJson(`/api/dev/games/${encodeURIComponent(gameId)}`, undefined, 'DELETE');
}

export async function requestOAuthPlaceholder(provider: 'google' | 'microsoft'): Promise<never> {
  await requestJson(`/api/oauth/${provider}`, undefined, 'POST');
  throw new Error('Unexpected OAuth placeholder response');
}
