import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
import type { AuthAccount, Credentials, LoginCredentials, NewsContentBlock, NewsPost } from '../src/auth/types';

const PORT = Number(process.env.AUTH_SERVER_PORT ?? 8788);
const NEWS_MEDIA_DIR = path.join(process.cwd(), 'server', 'state', 'news-media');
const NEWS_MEDIA_ROUTE = '/news-media/';
const NEWS_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const NEWS_MEDIA_TYPES: Record<string, { extension: string; contentType: string }> = {
  'image/jpeg': { extension: 'jpg', contentType: 'image/jpeg' },
  'image/png': { extension: 'png', contentType: 'image/png' },
  'image/webp': { extension: 'webp', contentType: 'image/webp' },
  'image/gif': { extension: 'gif', contentType: 'image/gif' },
};

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

function writeHtml(response: ServerResponse, statusCode: number, html: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  });
  response.end(html);
}

function writeXml(response: ServerResponse, statusCode: number, xml: string): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  });
  response.end(xml);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getRequestBaseUrl(request: IncomingMessage): string {
  const forwardedProto = request.headers['x-forwarded-proto'];
  const forwardedHost = request.headers['x-forwarded-host'];
  const proto = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(',')[0]?.trim() || 'http';
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(',')[0]?.trim()
    || request.headers.host
    || `localhost:${PORT}`;
  return `${proto}://${host}`;
}

function normalizeUploadedMedia(body: { filename?: unknown; mimeType?: unknown; data?: unknown; dataUrl?: unknown }): {
  filename: string;
  contentType: string;
  buffer: Buffer;
} {
  const rawData = typeof body.dataUrl === 'string' ? body.dataUrl : body.data;
  if (typeof rawData !== 'string' || !rawData.trim()) {
    throw new Error('Image data is required');
  }

  let mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  let base64 = rawData.trim();
  const dataUrlMatch = base64.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1];
    base64 = dataUrlMatch[2];
  }

  const mediaType = NEWS_MEDIA_TYPES[mimeType];
  if (!mediaType) {
    throw new Error('Image must be a JPG, PNG, WEBP, or GIF');
  }

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0 || buffer.length > NEWS_MEDIA_MAX_BYTES) {
    throw new Error('Image must be 5 MB or smaller');
  }

  const filename = typeof body.filename === 'string' ? body.filename : 'news-image';
  const baseName = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'news-image';

  return {
    filename: `${Date.now()}-${randomBytes(4).toString('hex')}-${baseName}.${mediaType.extension}`,
    contentType: mediaType.contentType,
    buffer,
  };
}

function getMediaContentType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'application/octet-stream';
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

function renderNewsBlockHtml(block: NewsContentBlock): string {
  if (block.type === 'heading') {
    return `<h2>${escapeHtml(block.text)}</h2>`;
  }
  if (block.type === 'paragraph') {
    const paragraphs = block.text
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) return '';
    return paragraphs
      .map((line) => `<p>${escapeHtml(line).replace(/\n/g, '<br>')}</p>`)
      .join('\n');
  }
  return `
    <figure>
      <img src="${escapeHtml(block.imageUrl)}" alt="${escapeHtml(block.altText)}" loading="lazy" />
      ${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}
    </figure>
  `;
}

function renderNewsShell(title: string, description: string, canonicalUrl: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
  <style>
    :root { color-scheme: dark; font-family: Orbitron, Rajdhani, Trebuchet MS, Arial, sans-serif; background: #03070d; color: #d6dde7; }
    body { margin: 0; background: radial-gradient(circle at 22% 0%, rgba(112,184,255,.18), transparent 36%), linear-gradient(180deg, #07101b, #02050a 78%); }
    a { color: #75cdf7; text-decoration: none; }
    a:hover { text-decoration: underline; }
    main { width: min(920px, calc(100% - 32px)); margin: 0 auto; padding: 42px 0 72px; }
    header { border-bottom: 1px solid rgba(136,151,171,.32); margin-bottom: 28px; padding-bottom: 18px; }
    nav { display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 26px; font-size: 12px; text-transform: uppercase; }
    h1 { color: #f3f7ff; font-size: clamp(34px, 6vw, 64px); line-height: 1.02; margin: 0 0 12px; }
    h2 { color: #f3f7ff; font-size: 26px; margin: 34px 0 12px; }
    p, li, figcaption { line-height: 1.75; color: rgba(214,221,231,.82); }
    article { border: 1px solid rgba(136,151,171,.28); border-radius: 8px; background: rgba(8,14,23,.78); padding: 24px; margin: 18px 0; }
    article img { width: 100%; height: auto; border-radius: 8px; border: 1px solid rgba(136,151,171,.28); }
    figure { margin: 28px 0; }
    figcaption { margin-top: 8px; color: rgba(214,221,231,.62); font-size: 13px; }
    .meta { color: rgba(117,205,247,.88); font-size: 12px; text-transform: uppercase; }
    .comment { border-top: 1px solid rgba(136,151,171,.22); padding: 16px 0; }
    .comment strong { color: #f3f7ff; }
    .comment small { color: rgba(214,221,231,.58); }
  </style>
</head>
<body>
  <main>
    <nav>
      <a href="/news">News</a>
      <span>Forums</span>
      <span>Support</span>
      <span>Privacy Policy</span>
      <span>Terms and Conditions</span>
    </nav>
    ${body}
  </main>
</body>
</html>`;
}

function renderNewsIndex(request: IncomingMessage): string {
  const baseUrl = getRequestBaseUrl(request);
  const posts = authStore.listNewsPosts();
  const items = posts.map((post) => `
    <article>
      ${post.coverImageUrl ? `<img src="${escapeHtml(post.coverImageUrl)}" alt="" loading="lazy" />` : ''}
      <p class="meta">${post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : 'Draft'} / ${escapeHtml(post.author.username)}</p>
      <h2><a href="/news/${encodeURIComponent(post.slug)}">${escapeHtml(post.title)}</a></h2>
      <p>${escapeHtml(post.summary)}</p>
      <p><a href="/news/${encodeURIComponent(post.slug)}">${post.commentCount} comments</a></p>
    </article>
  `).join('\n') || '<p>No published news yet.</p>';

  return renderNewsShell(
    'StellarFronts News',
    'Development updates, announcements, and devlogs for StellarFronts.',
    `${baseUrl}/news`,
    `<header><p class="meta">StellarFronts public archive</p><h1>News</h1><p>Development updates, announcements, and devlogs.</p></header>${items}`,
  );
}

function renderNewsPost(request: IncomingMessage, post: NewsPost): string {
  const baseUrl = getRequestBaseUrl(request);
  const publishedDate = post.publishedAt ? new Date(post.publishedAt).toISOString().slice(0, 10) : 'Unpublished';
  const blocks = post.blocks.map(renderNewsBlockHtml).join('\n');
  const comments = post.comments.map((comment) => `
    <section class="comment">
      <p><strong>${escapeHtml(comment.author.username)}</strong> <small>${new Date(comment.createdAt).toISOString().slice(0, 10)} / Score ${comment.score}</small></p>
      <p>${escapeHtml(comment.body).replace(/\n/g, '<br>')}</p>
    </section>
  `).join('\n') || '<p>No comments yet.</p>';

  return renderNewsShell(
    `${post.title} - StellarFronts News`,
    post.summary,
    `${baseUrl}/news/${encodeURIComponent(post.slug)}`,
    `
      <header>
        <p class="meta">${publishedDate} / ${escapeHtml(post.author.username)}</p>
        <h1>${escapeHtml(post.title)}</h1>
        <p>${escapeHtml(post.summary)}</p>
      </header>
      <article>${blocks}</article>
      <section aria-labelledby="comments-title">
        <h2 id="comments-title">Comments</h2>
        ${comments}
      </section>
    `,
  );
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  applyCors(request, response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'GET' && url.pathname.startsWith(NEWS_MEDIA_ROUTE)) {
    const rawFilename = decodePathSegment(url.pathname.slice(NEWS_MEDIA_ROUTE.length));
    if (!/^[a-z0-9][a-z0-9._-]+$/i.test(rawFilename)) {
      writeJson(response, 404, { error: 'Not found' });
      return;
    }

    try {
      const file = await readFile(path.join(NEWS_MEDIA_DIR, rawFilename));
      response.writeHead(200, {
        'Content-Type': getMediaContentType(rawFilename),
        'Cache-Control': 'public, max-age=31536000, immutable',
      });
      response.end(file);
    } catch {
      writeJson(response, 404, { error: 'Not found' });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/robots.txt') {
    response.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    response.end(`User-agent: *\nAllow: /news\nSitemap: ${getRequestBaseUrl(request)}/sitemap.xml\n`);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/sitemap.xml') {
    const baseUrl = getRequestBaseUrl(request);
    const posts = authStore.listNewsPosts();
    const urls = [
      `<url><loc>${escapeHtml(`${baseUrl}/news`)}</loc></url>`,
      ...posts.map((post) => (
        `<url><loc>${escapeHtml(`${baseUrl}/news/${encodeURIComponent(post.slug)}`)}</loc>${post.updatedAt ? `<lastmod>${new Date(post.updatedAt).toISOString()}</lastmod>` : ''}</url>`
      )),
    ];
    writeXml(response, 200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/news') {
    writeHtml(response, 200, renderNewsIndex(request));
    return;
  }

  const htmlNewsPostMatch = url.pathname.match(/^\/news\/([^/]+)$/);
  if (request.method === 'GET' && htmlNewsPostMatch) {
    const post = authStore.getNewsPostBySlug(decodePathSegment(htmlNewsPostMatch[1]));
    if (!post) {
      writeHtml(response, 404, renderNewsShell(
        'News post not found - StellarFronts',
        'The requested StellarFronts news post was not found.',
        `${getRequestBaseUrl(request)}/news`,
        '<header><h1>News post not found</h1><p>This post is not published or does not exist.</p></header>',
      ));
      return;
    }
    writeHtml(response, 200, renderNewsPost(request, post));
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/me') {
    const account = getAuthenticatedAccount(request);
    writeJson(response, 200, { account });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/news/posts') {
    writeJson(response, 200, { posts: authStore.listNewsPosts() });
    return;
  }

  const publicNewsPostMatch = url.pathname.match(/^\/api\/news\/posts\/([^/]+)$/);
  if (request.method === 'GET' && publicNewsPostMatch) {
    const post = authStore.getNewsPostBySlug(
      decodePathSegment(publicNewsPostMatch[1]),
      getAuthenticatedAccount(request),
    );
    if (!post) {
      writeJson(response, 404, { error: 'News post not found' });
      return;
    }
    writeJson(response, 200, { post });
    return;
  }

  const createNewsCommentMatch = url.pathname.match(/^\/api\/news\/posts\/([^/]+)\/comments$/);
  if (request.method === 'POST' && createNewsCommentMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      writeJson(response, 401, { error: 'Authentication required' });
      return;
    }

    const body = await readJsonBody<{ body?: unknown }>(request);
    writeJson(response, 201, {
      comment: authStore.createNewsComment(account, decodePathSegment(createNewsCommentMatch[1]), body.body),
    });
    return;
  }

  const voteNewsCommentMatch = url.pathname.match(/^\/api\/news\/comments\/(\d+)\/vote$/);
  if (request.method === 'POST' && voteNewsCommentMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      writeJson(response, 401, { error: 'Authentication required' });
      return;
    }

    const body = await readJsonBody<{ vote?: unknown }>(request);
    writeJson(response, 200, {
      comment: authStore.voteNewsComment(account, Number(voteNewsCommentMatch[1]), body.vote),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/news/posts') {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    writeJson(response, 200, { posts: authStore.listNewsPosts({ includeDrafts: true }) });
    return;
  }

  const adminNewsPostReadMatch = url.pathname.match(/^\/api\/admin\/news\/posts\/([^/]+)$/);
  if (request.method === 'GET' && adminNewsPostReadMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    const post = authStore.getNewsPostBySlug(decodePathSegment(adminNewsPostReadMatch[1]), account, { includeDrafts: true });
    if (!post) {
      writeJson(response, 404, { error: 'News post not found' });
      return;
    }
    writeJson(response, 200, { post });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/news/posts') {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(response, 201, { post: authStore.createNewsPost(account, body) });
    return;
  }

  const adminNewsPostMutationMatch = url.pathname.match(/^\/api\/admin\/news\/posts\/([a-z0-9]+)$/i);
  if (request.method === 'POST' && adminNewsPostMutationMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    const body = await readJsonBody<unknown>(request);
    writeJson(response, 200, { post: authStore.updateNewsPost(account, adminNewsPostMutationMatch[1], body) });
    return;
  }

  if (request.method === 'DELETE' && adminNewsPostMutationMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    const deleted = authStore.deleteNewsPost(account, adminNewsPostMutationMatch[1]);
    if (!deleted) {
      writeJson(response, 404, { error: 'News post not found' });
      return;
    }
    writeJson(response, 200, { ok: true, post: deleted });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/news/media') {
    const account = getAuthenticatedAccount(request);
    if (!account || !authStore.isAdminAccount(account)) {
      writeJson(response, account ? 403 : 401, { error: account ? 'Administrator account required' : 'Authentication required' });
      return;
    }
    try {
      const body = await readJsonBody<{ filename?: unknown; mimeType?: unknown; data?: unknown; dataUrl?: unknown }>(request);
      const media = normalizeUploadedMedia(body);
      await mkdir(NEWS_MEDIA_DIR, { recursive: true });
      await writeFile(path.join(NEWS_MEDIA_DIR, media.filename), media.buffer);
      writeJson(response, 201, { url: `${getRequestBaseUrl(request)}${NEWS_MEDIA_ROUTE}${encodeURIComponent(media.filename)}` });
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : 'Could not upload image' });
    }
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

  const endpointMatch = url.pathname.match(/^\/api\/games\/([a-z0-9]+)\/endpoint$/i);
  if (request.method === 'GET' && endpointMatch) {
    const account = getAuthenticatedAccount(request);
    if (!account) {
      writeJson(response, 401, { error: 'Authentication required' });
      return;
    }
    const game = authStore.getGameById(endpointMatch[1]);
    if (!game) {
      writeJson(response, 404, { error: 'Game not found' });
      return;
    }
    // Resolve which game-server process (port) hosts this game's version so the
    // client connects to the right one. "dev" = the default working-tree server.
    const devPort = Number(process.env.GAME_SERVER_PORT ?? 8787);
    const version = game.versionId === 'dev' ? null : authStore.getGameVersion(game.versionId);
    writeJson(response, 200, {
      versionId: game.versionId,
      status: game.status,
      port: game.versionId === 'dev' ? devPort : version?.port ?? devPort,
      protocolVersion: version?.protocolVersion ?? game.protocolVersion ?? null,
    });
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
