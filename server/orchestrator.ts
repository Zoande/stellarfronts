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
import type { StoredGame, StoredGameVersion, GameVersionRefType } from "./auth-store";
import { VERSION_MANIFEST } from "./versionManifest";
import { getGameStateDirectory, getGameStatePath, STATE_ROOT } from "./game-state-path";

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
// Crash supervision: a process that stays up this long is treated as a healthy
// run and clears its crash history. Rapid crashes back off exponentially up to a
// cap, and after too many in a row the version is quarantined (no auto-restart)
// so a broken snapshot can't spin `npx tsx` forever.
const HEALTHY_UPTIME_MS = 60_000;
const MAX_RAPID_RESTARTS = 5;
const MAX_RESTART_BACKOFF_MS = 30_000;

interface VersionProcess {
  child: ChildProcess;
  port: number;
  stopping: boolean;
  startedAt: number;
}

// Per-version crash health, consulted by reconcile (the single spawn authority).
// nextRetryAt = Infinity means quarantined. Cleared on healthy exit, on (re)
// registration, and on an explicit start — and entirely on orchestrator restart.
interface VersionHealth {
  crashes: number;
  nextRetryAt: number;
}
const versionHealth = new Map<string, VersionHealth>();

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

// Internal ports already claimed: every registered version's port plus the two
// the orchestrator itself binds. Used both to auto-allocate and to reject an
// explicit port that would crash-loop a subprocess with EADDRINUSE.
function usedPorts(): Set<number> {
  const used = new Set(authStore.listGameVersions().map((version) => version.port));
  used.add(DEV_INTERNAL_PORT);
  used.add(GATEWAY_PORT);
  return used;
}

function allocatePort(): number {
  const used = usedPorts();
  let port = PORT_BASE;
  while (used.has(port)) port += 1;
  return port;
}

/**
 * Pick a free, route-safe version id from a base name. Ids must match the control
 * API's [a-z0-9]+ route pattern, so collisions are resolved with a numeric suffix
 * (main, main2, main3, …) rather than a separator. "dev" is reserved. This is what
 * lets the same moving branch be pinned repeatedly: each registration that finds
 * its base taken claims the next free number.
 */
function allocateVersionId(base: string): string {
  const taken = new Set(authStore.listGameVersions().map((version) => version.id));
  taken.add(DEV_VERSION_ID);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// Registrations read the catalog to choose an id/port, then do async git work
// before inserting — so two concurrent calls could otherwise pick the same id or
// port. This promise-chain mutex serializes the whole resolve→pin→insert so each
// registration sees the previous one's committed result.
let registrationChain: Promise<void> = Promise.resolve();
function withRegistrationLock<T>(task: () => Promise<T>): Promise<T> {
  const result = registrationChain.then(task);
  registrationChain = result.then(() => undefined, () => undefined);
  return result;
}

async function probeManifest(worktreePath: string): Promise<{ protocolVersion: number; schemaVersion: number; migratesFromSchema: number[] }> {
  // Run from the orchestrator's cwd (root) so importing the version's index.ts —
  // which instantiates the authStore singleton before the --print-version exit —
  // touches the shared root DB rather than littering an empty one in the worktree.
  const result = await runCapture("npx", ["tsx", path.join(worktreePath, "server", "index.ts"), "--print-version"]);
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

/** Resolve a ref to the single commit it points at (peels tags, follows branches). */
async function revCommit(ref: string): Promise<string | null> {
  const result = await runCapture("git", ["rev-list", "-n", "1", ref]);
  const sha = result.stdout.trim().split(/\s+/).pop() ?? "";
  return result.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

/**
 * Resolve an operator-supplied ref (branch / tag / raw commit) to an immutable
 * commit SHA. Selecting a BRANCH pins its latest commit at registration time —
 * the worktree is then detached at that SHA so the branch moving later never
 * drifts a registered version.
 */
async function resolveRef(gitRef: string): Promise<{ sha: string; refType: GameVersionRefType }> {
  const fetched = await runCapture("git", ["fetch", GIT_REMOTE, "--tags", "--prune"]);
  if (fetched.code !== 0) throw new Error(`git fetch failed: ${fetched.stderr || fetched.stdout}`);
  const asBranch = await revCommit(`refs/remotes/${GIT_REMOTE}/${gitRef}`);
  if (asBranch) return { sha: asBranch, refType: "branch" };
  const asTag = await revCommit(`refs/tags/${gitRef}`);
  if (asTag) return { sha: asTag, refType: "tag" };
  const asCommit = await revCommit(gitRef);
  if (asCommit) return { sha: asCommit, refType: "commit" };
  throw new Error(`Could not resolve "${gitRef}" to a commit on ${GIT_REMOTE} (tried branch, tag, then commit).`);
}

/** Detach a fresh worktree at an exact SHA, reusing or replacing any stale dir. */
async function ensureWorktreeAt(worktreePath: string, sha: string): Promise<void> {
  if (existsSync(worktreePath)) {
    const head = await runCapture("git", ["-C", worktreePath, "rev-parse", "HEAD"]);
    if (head.code === 0 && head.stdout.trim() === sha) return; // already the right commit
    await removeWorktree(worktreePath); // stale/partial — clear it out and recreate
  }
  await runCapture("git", ["worktree", "prune"]);
  const result = await runCapture("git", ["worktree", "add", "--detach", worktreePath, sha]);
  if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
}

async function removeWorktree(worktreePath: string): Promise<void> {
  await runCapture("git", ["worktree", "remove", "--force", worktreePath]);
  if (existsSync(worktreePath)) await rm(worktreePath, { recursive: true, force: true });
  await runCapture("git", ["worktree", "prune"]);
}

/**
 * Pin a git ref (branch / tag / commit) to an immutable, runnable version.
 *
 * Naming: pass an explicit id to name it yourself (clashes error). Otherwise the
 * id is derived from the ref. Because branches MOVE, re-registering one captures a
 * fresh snapshot each time it has advanced:
 *   - ref still at the same commit as a prior auto-named version → returns that
 *     existing version unchanged (idempotent; no duplicate worktree/port).
 *   - ref has advanced (new commits) → a new snapshot under the next free id
 *     (main, main2, main3, …), leaving older games pinned to their old code.
 * The whole flow is serialized so concurrent registrations can't collide.
 */
async function registerVersion(gitRef: string, requestedId?: string, requestedPort?: number): Promise<StoredGameVersion> {
  return withRegistrationLock(async () => {
    const trimmedRef = gitRef.trim();
    if (!trimmedRef) throw new Error("A git ref (branch, tag, or commit) is required.");

    const explicitId = requestedId && requestedId.trim() ? sanitizeId(requestedId) : null;
    if (explicitId === DEV_VERSION_ID) throw new Error('"dev" is the reserved working-tree version.');

    // Resolve to an immutable commit first. This fetch is also how we learn
    // whether a moving branch has advanced since it was last registered.
    const { sha, refType } = await resolveRef(trimmedRef);

    // Idempotency (auto-named only): if this exact ref is already pinned at this
    // exact commit, hand back the existing version instead of cloning it. An
    // explicit id always means "make a distinct named version", so it opts out.
    if (!explicitId) {
      const existing = authStore.listGameVersions().find(
        (version) => version.gitRef === trimmedRef && version.commit === sha,
      );
      if (existing) return existing;
    }

    let id: string;
    if (explicitId) {
      if (authStore.getGameVersion(explicitId)) {
        throw new Error(`Version id "${explicitId}" is already registered. Unregister it first or pick a different id.`);
      }
      id = explicitId;
    } else {
      id = allocateVersionId(sanitizeId(trimmedRef));
    }

    let port: number;
    if (requestedPort !== undefined) {
      if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65535) {
        throw new Error(`Invalid port ${requestedPort}.`);
      }
      if (usedPorts().has(requestedPort)) {
        throw new Error(`Port ${requestedPort} is already in use by another version or the orchestrator.`);
      }
      port = requestedPort;
    } else {
      port = allocatePort();
    }

    const worktreePath = path.join(VERSIONS_ROOT, id);
    await mkdir(VERSIONS_ROOT, { recursive: true });
    await ensureWorktreeAt(worktreePath, sha);

    let manifest: { protocolVersion: number; schemaVersion: number; migratesFromSchema: number[] };
    try {
      manifest = await probeManifest(worktreePath);
    } catch (error) {
      // A failed probe must not leave an orphaned worktree behind.
      await removeWorktree(worktreePath);
      throw error;
    }

    const version: StoredGameVersion = {
      id,
      gitRef: trimmedRef,
      commit: sha,
      refType,
      worktreePath,
      port,
      protocolVersion: manifest.protocolVersion,
      schemaVersion: manifest.schemaVersion,
      migratesFromSchema: manifest.migratesFromSchema,
      createdAt: Date.now(),
    };
    authStore.registerGameVersion(version);
    versionHealth.delete(id); // a fresh registration gets a clean restart slate
    await reconcile();
    return version;
  });
}

/** Remove a registered version + its worktree. Refuses while any game still uses it. */
async function unregisterVersion(versionId: string): Promise<void> {
  if (versionId === DEV_VERSION_ID) throw new Error('The "dev" working-tree version cannot be unregistered.');
  const version = authStore.getGameVersion(versionId);
  if (!version) throw new Error("Unknown version.");
  const games = authStore.listGamesByVersion(versionId);
  if (games.length > 0) {
    throw new Error(`Cannot unregister: ${games.length} game(s) still run on this version. Reassign or delete them first.`);
  }
  await stopVersionProcess(versionId);
  authStore.removeGameVersion(versionId);
  await removeWorktree(version.worktreePath);
}

// The built-in "dev" working-tree version. The orchestrator IS that working tree,
// so its identity comes from this process's own manifest + git HEAD (resolved once).
let devVersionCache: StoredGameVersion | null = null;
async function devVersionEntry(): Promise<StoredGameVersion> {
  if (devVersionCache) return devVersionCache;
  const head = await runCapture("git", ["rev-parse", "HEAD"]);
  const branch = await runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  const commit = head.code === 0 ? head.stdout.trim() : "";
  const branchName = branch.code === 0 ? branch.stdout.trim() : "HEAD";
  const detached = branchName === "HEAD" || branchName === "";
  devVersionCache = {
    id: DEV_VERSION_ID,
    gitRef: detached ? commit.slice(0, 12) || "working-tree" : branchName,
    commit,
    refType: detached ? "commit" : "branch",
    worktreePath: process.cwd(),
    port: DEV_INTERNAL_PORT,
    protocolVersion: VERSION_MANIFEST.protocolVersion,
    schemaVersion: VERSION_MANIFEST.schemaVersion,
    migratesFromSchema: VERSION_MANIFEST.migratesFromSchema,
    createdAt: 0,
  };
  return devVersionCache;
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
  // Run with the orchestrator's own cwd (the repo root) but load the version's
  // code by absolute path. This is the load-bearing fix for the shared catalog:
  // process.cwd() inside the child resolves to the root, so EVERY version —
  // including older ones whose code still derives state paths from cwd — opens
  // the single root server/state (auth.sqlite + games/) instead of an empty
  // worktree-local copy. SF_STATE_DIR additionally pins newer builds explicitly.
  const child = spawn("npx", ["tsx", path.join(spec.worktreePath, "server", "index.ts")], {
    cwd: process.cwd(),
    shell: true,
    env: { ...process.env, GAME_SERVER_PORT: String(spec.port), SF_VERSION_ID: spec.id, SF_STATE_DIR: STATE_ROOT },
  });
  const entry: VersionProcess = { child, port: spec.port, stopping: false, startedAt: Date.now() };
  processes.set(spec.id, entry);
  child.stdout?.on("data", (chunk) => process.stdout.write(`[v:${spec.id}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[v:${spec.id}] ${chunk}`));
  child.on("exit", (code) => {
    const uptimeMs = Date.now() - entry.startedAt;
    console.warn(`[Orchestrator] version ${spec.id} process exited (code ${code}) after ${Math.round(uptimeMs / 1000)}s.`);
    processes.delete(spec.id);
    // Record crash health only; reconcile owns (re)spawning so there is a single
    // restart path that honors backoff/quarantine instead of two racing ones.
    if (entry.stopping) {
      versionHealth.delete(spec.id);
      return;
    }
    if (uptimeMs >= HEALTHY_UPTIME_MS) {
      versionHealth.delete(spec.id); // a real run — forget earlier crashes
      return;
    }
    const crashes = (versionHealth.get(spec.id)?.crashes ?? 0) + 1;
    if (crashes > MAX_RAPID_RESTARTS) {
      versionHealth.set(spec.id, { crashes, nextRetryAt: Number.POSITIVE_INFINITY });
      console.error(`[Orchestrator] version ${spec.id} crashed ${crashes}× rapidly — quarantined. Fix and re-register it, restart a game on it, or restart the orchestrator to retry.`);
      return;
    }
    const backoffMs = Math.min(RESTART_DELAY_MS * 2 ** (crashes - 1), MAX_RESTART_BACKOFF_MS);
    versionHealth.set(spec.id, { crashes, nextRetryAt: Date.now() + backoffMs });
    console.warn(`[Orchestrator] version ${spec.id} will retry in ~${Math.round(backoffMs / 1000)}s (crash ${crashes}/${MAX_RAPID_RESTARTS}).`);
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
  const now = Date.now();
  for (const versionId of activeVersionIds) {
    if (processes.has(versionId)) continue;
    // Respect crash backoff / quarantine: skip until the scheduled retry time.
    const health = versionHealth.get(versionId);
    if (health && now < health.nextRetryAt) continue;
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
    const versionMatch = url.pathname.match(/^\/versions\/([a-z0-9]+)$/i);

    if (method === "GET" && url.pathname === "/versions") {
      // Lead with the built-in dev working tree so every selectable version —
      // including dev — clearly shows which commit it is pinned to.
      const dev = await devVersionEntry();
      return send(response, 200, { versions: [dev, ...authStore.listGameVersions()] });
    }
    if (method === "DELETE" && versionMatch) {
      await unregisterVersion(versionMatch[1]);
      return send(response, 200, { ok: true });
    }
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
        case "start": {
          // Explicitly starting a game is an operator's "try again" — clear any
          // crash quarantine on its version so reconcile will respawn it.
          authStore.setGameStatus(gameId, "active");
          const startedVersionId = authStore.getGameById(gameId)?.versionId;
          if (startedVersionId) versionHealth.delete(startedVersionId);
          await reconcile();
          break;
        }
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
const UPSTREAM_MAX_ATTEMPTS = 15;
const UPSTREAM_RETRY_MS = 2000;
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

  // Retry loop: the version subprocess may still be starting (tsx compilation)
  // when the client first connects, causing ECONNREFUSED. Retry for up to
  // UPSTREAM_MAX_ATTEMPTS * UPSTREAM_RETRY_MS ms before giving up.
  const pending: { data: RawData; isBinary: boolean }[] = [];
  let clientClosed = false;
  let currentUpstream: WebSocket | null = null;

  client.on("message", (data: RawData, isBinary: boolean) => {
    if (currentUpstream && currentUpstream.readyState === WebSocket.OPEN) {
      currentUpstream.send(data, { binary: isBinary });
    } else {
      pending.push({ data, isBinary });
    }
  });
  client.on("close", () => {
    clientClosed = true;
    currentUpstream?.close();
  });
  client.on("error", () => currentUpstream?.close());

  function tryConnect(attempt: number): void {
    if (clientClosed) return;
    const upstream = new WebSocket(`ws://127.0.0.1:${port}${request.url ?? "/"}`, {
      headers: { cookie: request.headers.cookie ?? "", origin: request.headers.origin ?? "" },
    });
    currentUpstream = upstream;
    let connected = false;

    upstream.on("open", () => {
      connected = true;
      for (const msg of pending) upstream.send(msg.data, { binary: msg.isBinary });
      pending.length = 0;
    });
    upstream.on("message", (data: RawData, isBinary: boolean) => {
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
    });
    upstream.on("close", () => {
      if (!clientClosed) client.close();
    });
    upstream.on("error", () => {
      if (connected) return; // error after connect → let close handler deal with it
      if (!clientClosed && attempt < UPSTREAM_MAX_ATTEMPTS) {
        setTimeout(() => tryConnect(attempt + 1), UPSTREAM_RETRY_MS);
      } else if (!clientClosed) {
        clientClosed = true;
        client.close(1011, "Upstream error.");
      }
    });
  }

  tryConnect(1);
});

server.listen(CONTROL_PORT, () => {
  console.log(`✓ Orchestrator control API on http://localhost:${CONTROL_PORT}`);
  console.log(`✓ Game WS gateway on ws://localhost:${GATEWAY_PORT} (proxies to internal version processes)`);
  void reconcile();
  setInterval(() => { void reconcile(); }, RECONCILE_INTERVAL_MS);
});

process.on("SIGINT", () => { for (const [, entry] of processes) { entry.stopping = true; entry.child.kill(); } process.exit(0); });
process.on("SIGTERM", () => { for (const [, entry] of processes) { entry.stopping = true; entry.child.kill(); } process.exit(0); });
