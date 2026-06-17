/**
 * Control-plane / orchestrator for game versions and lifecycle.
 *
 * Responsibilities:
 *  - Version registry backed by git worktrees (a "version" = a git ref checked
 *    out under versions/<id>/ and run with tsx).
 *  - Supervise one game-server child process per version that has active games,
 *    each on its own port; auto-restart on crash.
 *  - Lifecycle: create / reset / update (compat-gated) / stop / start / archive
 *    / rollback games; register / list versions; dry-run compatibility report.
 *  - Auto-backup game state before destructive ops.
 *
 * Drives the shared catalog (auth.sqlite via authStore); the auth server reads
 * the same catalog to route clients. Exposes a token-gated HTTP control API used
 * by the CLI (scripts/control.ts) and the dev panel.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { RawData } from "ws";
import path from "node:path";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { authStore } from "./auth-store";
import type { StoredGame, StoredGameVersion } from "./auth-store";
import { getGameStateDirectory, getGameStatePath } from "./game-state-path";

const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 8790);
const CONTROL_TOKEN = process.env.CONTROL_TOKEN ?? "dev-control-token";
const VERSIONS_ROOT = path.join(process.cwd(), "versions");
const DEV_VERSION_ID = "dev";
// The public game WS port (what Cloudflare tunnels). The orchestrator binds this
// as a gateway and proxies each connection to the right internal version process.
const GATEWAY_PORT = Number(process.env.PUBLIC_GAME_PORT ?? process.env.GAME_SERVER_PORT ?? 8787);
// Per-version game-server processes listen on internal ports (never exposed).
const DEV_INTERNAL_PORT = Number(process.env.DEV_INTERNAL_PORT ?? 8809);
const PORT_BASE = Number(process.env.VERSION_PORT_BASE ?? 8810);
const GIT_REMOTE = process.env.GIT_REMOTE ?? "origin";
const RESTART_DELAY_MS = 2000;
const RECONCILE_INTERVAL_MS = 5000;

interface VersionProcess {
  child: ChildProcess;
  port: number;
  stopping: boolean;
  restarts: number;
}

interface VersionSpec {
  id: string;
  worktreePath: string;
  port: number;
}

const processes = new Map<string, VersionProcess>();

/** Resolve the runnable spec for a version id (dev = the deployed working tree). */
function versionSpec(versionId: string): VersionSpec | null {
  if (versionId === DEV_VERSION_ID) {
    return { id: DEV_VERSION_ID, worktreePath: process.cwd(), port: DEV_INTERNAL_PORT };
  }
  const version = authStore.getGameVersion(versionId);
  return version ? { id: version.id, worktreePath: version.worktreePath, port: version.port } : null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeId(input: string): string {
  return input.replace(/[^a-z0-9]/gi, "").toLowerCase() || `v${Date.now().toString(36)}`;
}

// Run a command, collect stdout/stderr. shell:true for cross-platform npx/git on Windows.
function runCapture(command: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.on("error", (error) => resolve({ code: 1, stdout, stderr: stderr + String(error) }));
  });
}

function allocatePort(): number {
  const used = new Set(authStore.listGameVersions().map((version) => version.port));
  used.add(DEV_INTERNAL_PORT);
  used.add(GATEWAY_PORT);
  let port = PORT_BASE;
  while (used.has(port)) port += 1;
  return port;
}

async function probeManifest(worktreePath: string): Promise<{ protocolVersion: number; schemaVersion: number; migratesFromSchema: number[] }> {
  const result = await runCapture("npx", ["tsx", path.join("server", "index.ts"), "--print-version"], worktreePath);
  const line = result.stdout.split("\n").map((value) => value.trim()).filter(Boolean).pop() ?? "";
  const manifest = JSON.parse(line) as { protocolVersion: number; schemaVersion: number; migratesFromSchema: number[] };
  return manifest;
}

interface RemoteRef { ref: string; sha: string; type: "tag" | "branch"; }

/** List selectable refs (tags + branches) from the GitHub remote. */
async function listRemoteRefs(): Promise<RemoteRef[]> {
  const result = await runCapture("git", ["ls-remote", "--tags", "--heads", GIT_REMOTE]);
  if (result.code !== 0) throw new Error(`git ls-remote failed: ${result.stderr || result.stdout}`);
  const refs: RemoteRef[] = [];
  for (const line of result.stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const [sha, fullRef] = line.split(/\s+/);
    if (!fullRef) continue;
    if (fullRef.startsWith("refs/tags/")) {
      refs.push({ ref: fullRef.replace("refs/tags/", "").replace(/\^\{\}$/, ""), sha, type: "tag" });
    } else if (fullRef.startsWith("refs/heads/")) {
      refs.push({ ref: fullRef.replace("refs/heads/", ""), sha, type: "branch" });
    }
  }
  return refs;
}

async function registerVersion(gitRef: string, requestedId?: string, requestedPort?: number): Promise<StoredGameVersion> {
  const id = sanitizeId(requestedId ?? gitRef);
  if (id === DEV_VERSION_ID) throw new Error('"dev" is the reserved working-tree version.');
  const worktreePath = path.join(VERSIONS_ROOT, id);
  if (!existsSync(worktreePath)) {
    await mkdir(VERSIONS_ROOT, { recursive: true });
    // Fetch so any tag/branch/SHA from GitHub is available, then check it out
    // detached (immutable snapshot — a branch ref won't drift afterwards).
    await runCapture("git", ["fetch", GIT_REMOTE, "--tags", "--prune"]);
    const result = await runCapture("git", ["worktree", "add", "--detach", worktreePath, gitRef]);
    if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
  }
  const manifest = await probeManifest(worktreePath);
  const version: StoredGameVersion = {
    id,
    gitRef,
    worktreePath,
    port: requestedPort ?? allocatePort(),
    protocolVersion: manifest.protocolVersion,
    schemaVersion: manifest.schemaVersion,
    migratesFromSchema: manifest.migratesFromSchema,
    createdAt: Date.now(),
  };
  authStore.registerGameVersion(version);
  await reconcile();
  return version;
}

/** Internal port of the process hosting a game (for the gateway proxy). */
function resolveGameInternalPort(game: StoredGame): number | null {
  if (game.versionId === DEV_VERSION_ID) return DEV_INTERNAL_PORT;
  return authStore.getGameVersion(game.versionId)?.port ?? null;
}

// Public-facing info for a game (clients always connect to the single gateway).
function resolveGameEndpoint(game: StoredGame): { versionId: string; status: string; protocolVersion: number | null } {
  const version = game.versionId === DEV_VERSION_ID ? null : authStore.getGameVersion(game.versionId);
  return {
    versionId: game.versionId,
    status: game.status,
    protocolVersion: version?.protocolVersion ?? game.protocolVersion ?? null,
  };
}

function spawnVersionProcess(spec: VersionSpec): void {
  if (processes.has(spec.id)) return;
  const child = spawn("npx", ["tsx", path.join("server", "index.ts")], {
    cwd: spec.worktreePath,
    shell: true,
    env: { ...process.env, GAME_SERVER_PORT: String(spec.port), SF_VERSION_ID: spec.id },
  });
  const entry: VersionProcess = { child, port: spec.port, stopping: false, restarts: 0 };
  processes.set(spec.id, entry);
  child.stdout?.on("data", (chunk) => process.stdout.write(`[v:${spec.id}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[v:${spec.id}] ${chunk}`));
  child.on("exit", (code) => {
    console.warn(`[Orchestrator] version ${spec.id} process exited (code ${code}).`);
    processes.delete(spec.id);
    if (entry.stopping) return;
    // Auto-restart on crash if it still has active games.
    void delay(RESTART_DELAY_MS).then(() => {
      const stillActive = authStore.listGames().some((game) => game.versionId === spec.id && game.status === "active");
      const fresh = versionSpec(spec.id);
      if (stillActive && fresh) spawnVersionProcess(fresh);
    });
  });
}

async function stopVersionProcess(versionId: string): Promise<void> {
  const entry = processes.get(versionId);
  if (!entry) return;
  entry.stopping = true;
  entry.child.kill();
  processes.delete(versionId);
}

// Ensure exactly the right per-version processes are running for the catalog
// (including the built-in "dev" working-tree version).
async function reconcile(): Promise<void> {
  const activeVersionIds = new Set(
    authStore.listGames().filter((game) => game.status === "active").map((game) => game.versionId),
  );
  for (const versionId of activeVersionIds) {
    if (processes.has(versionId)) continue;
    const spec = versionSpec(versionId);
    if (spec) spawnVersionProcess(spec);
  }
  for (const versionId of Array.from(processes.keys())) {
    if (!activeVersionIds.has(versionId)) await stopVersionProcess(versionId);
  }
}

async function waitForRuntimeRelease(gameId: string, timeoutMs = 10000): Promise<void> {
  const lock = path.join(getGameStateDirectory(gameId), ".owner");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!existsSync(lock)) return;
    await delay(250);
  }
}

async function backupGameState(game: StoredGame): Promise<string | null> {
  const statePath = getGameStatePath(game.id);
  if (!existsSync(statePath)) return null;
  const backupDir = path.join(getGameStateDirectory(game.id), "backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${stamp}-v${game.schemaVersion ?? "x"}.json`);
  await copyFile(statePath, backupPath);
  return backupPath;
}

async function latestBackup(gameId: string): Promise<string | null> {
  const backupDir = path.join(getGameStateDirectory(gameId), "backups");
  if (!existsSync(backupDir)) return null;
  const entries = (await readdir(backupDir)).filter((name) => name.endsWith(".json")).sort();
  return entries.length ? path.join(backupDir, entries[entries.length - 1]) : null;
}

function canMigrate(game: StoredGame, targetVersionId: string): boolean {
  if (targetVersionId === game.versionId) return true;
  const target = targetVersionId === DEV_VERSION_ID ? null : authStore.getGameVersion(targetVersionId);
  // dev accepts everything; a tagged version gates on its migratesFromSchema.
  if (targetVersionId === DEV_VERSION_ID) return true;
  if (!target) return false;
  if (game.schemaVersion === null) return true; // never run yet → fresh init under target
  return target.migratesFromSchema.includes(game.schemaVersion);
}

async function resetGame(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  authStore.setGameStatus(gameId, "stopped");
  await waitForRuntimeRelease(gameId);
  await backupGameState(game);
  await rm(getGameStatePath(gameId), { force: true });
  await rm(path.join(getGameStateDirectory(gameId), ".owner"), { force: true });
  authStore.setGameStatus(gameId, "active");
  await reconcile();
}

async function updateGame(gameId: string, toVersionId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  if (toVersionId !== DEV_VERSION_ID && !authStore.getGameVersion(toVersionId)) throw new Error("Unknown target version.");
  if (!canMigrate(game, toVersionId)) {
    throw new Error(`Version ${toVersionId} cannot migrate game from schema ${game.schemaVersion}.`);
  }
  authStore.setGameStatus(gameId, "stopped");
  await waitForRuntimeRelease(gameId);
  await backupGameState(game);
  authStore.setGameVersion(gameId, toVersionId);
  authStore.setGameStatus(gameId, "active");
  await reconcile();
}

async function rollbackGame(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  const backup = await latestBackup(gameId);
  if (!backup) throw new Error("No backup to roll back to.");
  authStore.setGameStatus(gameId, "stopped");
  await waitForRuntimeRelease(gameId);
  await copyFile(backup, getGameStatePath(gameId));
  authStore.setGameStatus(gameId, "active");
  await reconcile();
}

function compatReport(toVersionId: string): Array<{ id: string; name: string; versionId: string; schemaVersion: number | null; canUpdate: boolean }> {
  return authStore.listGames().map((game) => ({
    id: game.id,
    name: game.name,
    versionId: game.versionId,
    schemaVersion: game.schemaVersion,
    canUpdate: canMigrate(game, toVersionId),
  }));
}

function listGamesWithEndpoints(): unknown {
  return authStore.listGames().map((game) => ({ ...game, endpoint: resolveGameEndpoint(game) }));
}

// ---- HTTP control API (token-gated) ----
async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(json);
}

const server = http.createServer(async (request, response) => {
  try {
    if (request.headers["x-control-token"] !== CONTROL_TOKEN) {
      return send(response, 401, { error: "Unauthorized" });
    }
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const method = request.method ?? "GET";
    const body = method === "POST" ? await readJsonBody(request) : {};
    const gameMatch = url.pathname.match(/^\/games\/([a-z0-9]+)\/(reset|update|stop|start|archive|rollback|endpoint)$/i);

    if (method === "GET" && url.pathname === "/versions") return send(response, 200, { versions: authStore.listGameVersions() });
    if (method === "GET" && url.pathname === "/remote-versions") return send(response, 200, { refs: await listRemoteRefs() });
    if (method === "GET" && url.pathname === "/games") return send(response, 200, { games: listGamesWithEndpoints() });
    if (method === "GET" && url.pathname === "/compat") return send(response, 200, { games: compatReport(String(url.searchParams.get("to") ?? "")) });

    if (method === "POST" && url.pathname === "/versions") {
      const version = await registerVersion(String(body.gitRef ?? ""), body.id ? String(body.id) : undefined, body.port ? Number(body.port) : undefined);
      return send(response, 201, { version });
    }
    if (method === "POST" && url.pathname === "/games") {
      const game = authStore.createGame(String(body.name ?? ""), body.versionId ? String(body.versionId) : DEV_VERSION_ID);
      await reconcile();
      return send(response, 201, { game });
    }
    if (gameMatch) {
      const [, gameId, action] = gameMatch;
      switch (action) {
        case "reset": await resetGame(gameId); break;
        case "update": await updateGame(gameId, String(body.toVersion ?? "")); break;
        case "rollback": await rollbackGame(gameId); break;
        case "stop": authStore.setGameStatus(gameId, "stopped"); await reconcile(); break;
        case "start": authStore.setGameStatus(gameId, "active"); await reconcile(); break;
        case "archive": authStore.setGameStatus(gameId, "archived"); await reconcile(); break;
        case "endpoint": {
          const game = authStore.getGameById(gameId);
          return game ? send(response, 200, { endpoint: resolveGameEndpoint(game) }) : send(response, 404, { error: "Game not found." });
        }
      }
      return send(response, 200, { ok: true, game: authStore.getGameById(gameId) });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

// ---- WS gateway: one public game port → the right internal version process ----
// Clients always connect here (the port Cloudflare tunnels). We look up the game's
// version, open an upstream WS to that internal process forwarding the auth cookie
// + origin, and pipe both directions. Cloudflare config never changes per version.
const gateway = new WebSocketServer({ port: GATEWAY_PORT });
gateway.on("connection", (client: WebSocket, request: IncomingMessage) => {
  const url = new URL(request.url ?? "/", "ws://localhost");
  const gameId = url.searchParams.get("gameId") ?? "";
  const game = authStore.getGameById(gameId);
  if (!game || game.status !== "active") {
    client.close(1011, "Game not available.");
    return;
  }
  const port = resolveGameInternalPort(game);
  if (!port) {
    client.close(1011, "No host process for this game.");
    return;
  }
  const upstream = new WebSocket(`ws://127.0.0.1:${port}${request.url ?? "/"}`, {
    headers: { cookie: request.headers.cookie ?? "", origin: request.headers.origin ?? "" },
  });
  const pending: { data: RawData; isBinary: boolean }[] = [];
  client.on("message", (data: RawData, isBinary: boolean) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
    else pending.push({ data, isBinary });
  });
  upstream.on("open", () => {
    for (const msg of pending) upstream.send(msg.data, { binary: msg.isBinary });
    pending.length = 0;
  });
  upstream.on("message", (data: RawData, isBinary: boolean) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });
  client.on("close", () => upstream.close());
  upstream.on("close", () => client.close());
  upstream.on("error", () => client.close(1011, "Upstream error."));
  client.on("error", () => upstream.close());
});

server.listen(CONTROL_PORT, () => {
  console.log(`✓ Orchestrator control API on http://localhost:${CONTROL_PORT}`);
  console.log(`✓ Game WS gateway on ws://localhost:${GATEWAY_PORT} (proxies to internal version processes)`);
  void reconcile();
  setInterval(() => { void reconcile(); }, RECONCILE_INTERVAL_MS);
});

process.on("SIGINT", () => { for (const [, entry] of processes) { entry.stopping = true; entry.child.kill(); } process.exit(0); });
process.on("SIGTERM", () => { for (const [, entry] of processes) { entry.stopping = true; entry.child.kill(); } process.exit(0); });
