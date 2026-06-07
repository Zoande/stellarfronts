import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { rm } from 'node:fs/promises';
import {
  authStore,
  clearDevSessionCookie,
  clearSessionCookie,
  isAuthError,
  parseDevSessionTokenFromCookie,
  parseSessionTokenFromCookie,
  serializeDevSessionCookie,
  serializeSessionCookie,
} from './auth-store';
import { getGameStateDirectory } from './game-state-path';
import type { AuthAccount, Credentials, LoginCredentials } from '../src/auth/types';

const PORT = Number(process.env.AUTH_SERVER_PORT ?? 8788);

// Parse comma-separated allowed origins from environment
// Default: localhost dev environments
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function parseAllowedOrigins(): Set<string> {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return new Set(envOrigins.split(',').map((o) => o.trim()).filter(Boolean));
  }
  return new Set(DEFAULT_ALLOWED_ORIGINS);
}

const allowedOrigins = parseAllowedOrigins();

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins.has(origin);
}

function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({} as T);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin || !isOriginAllowed(origin)) {
    return;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  response.setHeader('Vary', 'Origin');
}

function isDevRequestAuthorized(request: IncomingMessage): boolean {
  const token = parseDevSessionTokenFromCookie(request.headers.cookie);
  return token ? authStore.isDevSessionTokenValid(token) : false;
}

function getAuthenticatedAccount(request: IncomingMessage): AuthAccount | null {
  const token = parseSessionTokenFromCookie(request.headers.cookie);
  return token ? authStore.getAccountFromSessionToken(token) : null;
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  applyCors(request, response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/me') {
    const account = getAuthenticatedAccount(request);
    writeJson(response, 200, { account });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/games') {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      writeJson(response, 401, { error: 'Authentication required' });
      return;
    }

    writeJson(response, 200, { games: authStore.getGameSummariesForAccount(account) });
    return;
  }

  const joinGameMatch = url.pathname.match(/^\/api\/games\/([a-z0-9]+)\/join$/i);
  if (request.method === 'POST' && joinGameMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      writeJson(response, 401, { error: 'Authentication required' });
      return;
    }

    const body = await readJsonBody<{ countryName?: unknown; flagDesign?: unknown; speciesSetup?: unknown }>(request);
    const countryName = typeof body.countryName === 'string' ? body.countryName : '';
    const membership = authStore.joinGame(account, joinGameMatch[1], countryName, body.flagDesign, body.speciesSetup);
    const game = authStore.getGameSummaryForAccount(joinGameMatch[1], account);
    if (!game) {
      writeJson(response, 404, { error: 'Game not found' });
      return;
    }
    writeJson(response, membership ? 201 : 200, { game, membership });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    const credentials = await readJsonBody<LoginCredentials>(request);
    const rememberMe = credentials.rememberMe !== false;
    const result = authStore.login(credentials);
    response.setHeader('Set-Cookie', serializeSessionCookie(result.token, { rememberMe }));
    writeJson(response, 200, { account: result.account });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/signup') {
    const credentials = await readJsonBody<Credentials>(request);
    const result = authStore.signup(credentials);
    response.setHeader('Set-Cookie', serializeSessionCookie(result.token));
    writeJson(response, 201, { account: result.account });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const token = parseSessionTokenFromCookie(request.headers.cookie);
    if (token) {
      authStore.clearSession(token);
    }
    response.setHeader('Set-Cookie', clearSessionCookie());
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/dev/login') {
    const body = await readJsonBody<{ password?: unknown }>(request);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!authStore.validateDevPassword(password)) {
      writeJson(response, 401, { error: 'Invalid developer password' });
      return;
    }

    const token = authStore.createDevSession();
    response.setHeader('Set-Cookie', serializeDevSessionCookie(token));
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/dev/logout') {
    const token = parseDevSessionTokenFromCookie(request.headers.cookie);
    if (token) {
      authStore.clearDevSession(token);
    }
    response.setHeader('Set-Cookie', clearDevSessionCookie());
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/dev/stats') {
    if (!isDevRequestAuthorized(request)) {
      writeJson(response, 401, { error: 'Developer session required' });
      return;
    }

    writeJson(response, 200, authStore.getDevStats());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/dev/games') {
    if (!isDevRequestAuthorized(request)) {
      writeJson(response, 401, { error: 'Developer session required' });
      return;
    }

    const body = await readJsonBody<{ name?: unknown }>(request);
    const name = typeof body.name === 'string' ? body.name : '';
    writeJson(response, 201, { game: authStore.createGame(name) });
    return;
  }

  const deleteDevGameMatch = url.pathname.match(/^\/api\/dev\/games\/([a-z0-9]+)$/i);
  if (request.method === 'DELETE' && deleteDevGameMatch) {
    if (!isDevRequestAuthorized(request)) {
      writeJson(response, 401, { error: 'Developer session required' });
      return;
    }

    const deleted = authStore.deleteGame(deleteDevGameMatch[1]);
    if (!deleted) {
      writeJson(response, 404, { error: 'Game not found' });
      return;
    }
    await rm(getGameStateDirectory(deleted.id), { recursive: true, force: true });
    writeJson(response, 200, { ok: true, game: deleted });
    return;
  }

  if (request.method === 'POST' && (url.pathname === '/api/oauth/google' || url.pathname === '/api/oauth/microsoft')) {
    writeJson(response, 501, { error: 'OAuth is not enabled yet' });
    return;
  }

  writeJson(response, 404, { error: 'Not found' });
}

const server = createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (isAuthError(error)) {
      writeJson(response, error.statusCode, { error: error.message });
      return;
    }

    console.error('[AuthServer] Unhandled error', error);
    writeJson(response, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, () => {
  console.log(`[AuthServer] Listening on http://localhost:${PORT}`);
});
