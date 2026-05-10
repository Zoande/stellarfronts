import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { authStore, clearSessionCookie, isAuthError, parseSessionTokenFromCookie, serializeSessionCookie } from './auth-store';
import type { Credentials } from '../src/auth/types';

const PORT = Number(process.env.AUTH_SERVER_PORT ?? 8788);
const ALLOWED_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

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
  });
  response.end(JSON.stringify(payload));
}

function applyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin || !ALLOWED_ORIGIN_PATTERN.test(origin)) {
    return;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Vary', 'Origin');
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
    const token = parseSessionTokenFromCookie(request.headers.cookie);
    const account = token ? authStore.getAccountFromSessionToken(token) : null;
    writeJson(response, 200, { account });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/login') {
    const credentials = await readJsonBody<Credentials>(request);
    const result = authStore.login(credentials);
    response.setHeader('Set-Cookie', serializeSessionCookie(result.token));
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