import type {
  AuthAccount,
  AuthMeResponse,
  AuthSessionResponse,
  ClaimQuestResponse,
  Credentials,
  LoginCredentials,
  DevStatsResponse,
  GamesResponse,
  GameSummary,
  JoinGameResponse,
  NewsComment,
  NewsCommentVote,
  NewsMediaFile,
  NewsMediaListResponse,
  NewsMediaResponse,
  NewsPost,
  NewsPostListItem,
  NewsPostMutationPayload,
  NewsPostResponse,
  NewsPostsResponse,
  PlayerProfile,
  PlayerProfileResponse,
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

// ---- Orchestrator (versions & game lifecycle), proxied through the auth server ----
export interface OrchestratorVersion {
  id: string;
  gitRef: string;
  /** Exact commit this version is pinned to (resolved at registration). */
  commit: string;
  /** How gitRef was interpreted when registered. */
  refType: 'tag' | 'branch' | 'commit';
  port: number;
  protocolVersion: number;
  schemaVersion: number;
  migratesFromSchema: number[];
  createdAt: number;
}

export interface OrchestratorGame {
  id: string;
  name: string;
  versionId: string;
  status: string;
  schemaVersion: number | null;
  protocolVersion: number | null;
  createdAt: number;
}

export interface RemoteRef { ref: string; sha: string; type: 'tag' | 'branch'; }
export interface CompatRow { id: string; name: string; versionId: string; schemaVersion: number | null; canUpdate: boolean; }

export async function listOrchestratorVersions(): Promise<OrchestratorVersion[]> {
  const result = await requestJson<{ versions: OrchestratorVersion[] }>('/api/dev/orchestrator/versions', undefined, 'GET');
  return result.versions;
}

export async function listRemoteVersions(): Promise<RemoteRef[]> {
  const result = await requestJson<{ refs: RemoteRef[] }>('/api/dev/orchestrator/remote-versions', undefined, 'GET');
  return result.refs;
}

export async function registerOrchestratorVersion(gitRef: string, id?: string): Promise<void> {
  await requestJson('/api/dev/orchestrator/versions', { gitRef, id });
}

export async function unregisterOrchestratorVersion(versionId: string): Promise<void> {
  await requestJson(`/api/dev/orchestrator/versions/${encodeURIComponent(versionId)}`, undefined, 'DELETE');
}

export async function listOrchestratorGames(): Promise<OrchestratorGame[]> {
  const result = await requestJson<{ games: OrchestratorGame[] }>('/api/dev/orchestrator/games', undefined, 'GET');
  return result.games;
}

export async function createOrchestratorGame(name: string, versionId: string): Promise<void> {
  await requestJson('/api/dev/orchestrator/games', { name, versionId });
}

export async function runGameLifecycle(gameId: string, action: string, body?: Record<string, unknown>): Promise<void> {
  await requestJson(`/api/dev/orchestrator/games/${encodeURIComponent(gameId)}/${action}`, body ?? {}, 'POST');
}

export async function getCompatReport(toVersion: string): Promise<CompatRow[]> {
  const result = await requestJson<{ games: CompatRow[] }>(`/api/dev/orchestrator/compat?to=${encodeURIComponent(toVersion)}`, undefined, 'GET');
  return result.games;
}

export async function getNewsPosts(): Promise<NewsPostListItem[]> {
  const result = await requestJson<NewsPostsResponse>('/api/news/posts', undefined, 'GET');
  return result.posts;
}

export async function getNewsPost(slug: string): Promise<NewsPost> {
  const result = await requestJson<NewsPostResponse>(`/api/news/posts/${encodeURIComponent(slug)}`, undefined, 'GET');
  return result.post;
}

export async function getAdminNewsPosts(): Promise<NewsPostListItem[]> {
  const result = await requestJson<NewsPostsResponse>('/api/admin/news/posts', undefined, 'GET');
  return result.posts;
}

export async function getAdminNewsPost(slug: string): Promise<NewsPost> {
  const result = await requestJson<NewsPostResponse>(`/api/admin/news/posts/${encodeURIComponent(slug)}`, undefined, 'GET');
  return result.post;
}

export async function createNewsPost(payload: NewsPostMutationPayload): Promise<NewsPost> {
  const result = await requestJson<NewsPostResponse>('/api/admin/news/posts', payload);
  return result.post;
}

export async function updateNewsPost(postId: string, payload: NewsPostMutationPayload): Promise<NewsPost> {
  const result = await requestJson<NewsPostResponse>(`/api/admin/news/posts/${encodeURIComponent(postId)}`, payload);
  return result.post;
}

export async function deleteNewsPost(postId: string): Promise<void> {
  await requestJson(`/api/admin/news/posts/${encodeURIComponent(postId)}`, undefined, 'DELETE');
}

export async function uploadNewsImage(filename: string, mimeType: string, dataUrl: string): Promise<string> {
  const result = await requestJson<NewsMediaResponse>('/api/admin/news/media', { filename, mimeType, dataUrl });
  return result.url;
}

export async function listNewsMedia(): Promise<NewsMediaFile[]> {
  const result = await requestJson<NewsMediaListResponse>('/api/admin/news/media', undefined, 'GET');
  return result.files;
}

export async function createNewsComment(slug: string, body: string): Promise<NewsComment> {
  const result = await requestJson<{ comment: NewsComment }>(
    `/api/news/posts/${encodeURIComponent(slug)}/comments`,
    { body },
  );
  return result.comment;
}

export async function voteNewsComment(commentId: number, vote: NewsCommentVote): Promise<NewsComment> {
  const result = await requestJson<{ comment: NewsComment }>(
    `/api/news/comments/${encodeURIComponent(String(commentId))}/vote`,
    { vote },
  );
  return result.comment;
}

export async function requestOAuthPlaceholder(provider: 'google' | 'microsoft'): Promise<never> {
  await requestJson(`/api/oauth/${provider}`, undefined, 'POST');
  throw new Error('Unexpected OAuth placeholder response');
}

export async function getPlayerProfile(): Promise<PlayerProfile> {
  const result = await requestJson<PlayerProfileResponse>(`/api/player/profile`, undefined, 'GET');
  return result.profile;
}

export async function claimQuestReward(questId: string, windowKey: string): Promise<ClaimQuestResponse> {
  return requestJson<ClaimQuestResponse>(
    `/api/player/quests/${encodeURIComponent(questId)}/claim`,
    { windowKey },
  );
}
