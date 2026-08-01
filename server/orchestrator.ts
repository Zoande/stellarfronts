/**
 * Raspberry-Pi control plane: version artifacts, process supervision, safe game
 * lifecycle, and the one public WebSocket gateway used by every client.
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { AuthStore } from "./auth-store";
import type { GameVersionRefType, StoredGame, StoredGameVersion } from "./auth-store";
import {
  createGameBackup,
  listGameBackups,
  restoreGameBackup,
  verifyGameBackup,
} from "./game-backups";
import { getGameStateDirectory, getGameStatePath, STATE_ROOT } from "./game-state-path";
import {
  dependencyArtifactStatus,
  ensureVersionArtifact,
  readStaticVersionManifest,
  versionTsxImport,
} from "./version-artifacts";
import { VERSION_MANIFEST } from "./versionManifest";
import { attachGatewayProxy } from "./ws-gateway";

const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 8790);
const CONTROL_HOST = process.env.CONTROL_HOST ?? "127.0.0.1";
const CONTROL_TOKEN = process.env.CONTROL_TOKEN;
if (!CONTROL_TOKEN) {
  throw new Error("CONTROL_TOKEN is required. Set the same long random value for auth and orchestrator.");
}
const VERSIONS_ROOT = path.join(process.cwd(), "versions");
const DEV_VERSION_ID = "dev";
const GATEWAY_PORT = Number(process.env.PUBLIC_GAME_PORT ?? process.env.GAME_SERVER_PORT ?? 8787);
const GATEWAY_HOST = process.env.GATEWAY_HOST ?? "127.0.0.1";
const DEV_INTERNAL_PORT = Number(process.env.DEV_INTERNAL_PORT ?? 8809);
const PORT_BASE = Number(process.env.VERSION_PORT_BASE ?? 8810);
const GIT_REMOTE = process.env.GIT_REMOTE ?? "origin";
const RESTART_DELAY_MS = 2_000;
const RECONCILE_INTERVAL_MS = 5_000;
const authStore = new AuthStore();
process.once("exit", () => authStore.close());
const HEALTHY_UPTIME_MS = 60_000;
const MAX_RAPID_RESTARTS = 5;
const MAX_RESTART_BACKOFF_MS = 30_000;
const STOP_TIMEOUT_MS = 20_000;
const RELEASE_TIMEOUT_MS = 25_000;
const MAX_CONTROL_BODY_BYTES = 256 * 1024;
const HEALTH_PATH = path.join(STATE_ROOT, "orchestrator-health.json");

interface VersionSpec {
  id: string;
  worktreePath: string;
  port: number;
}

interface VersionProcess {
  child: ChildProcess;
  port: number;
  stopping: boolean;
  startedAt: number;
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

interface VersionHealth {
  crashes: number;
  nextRetryAt: number;
  lastError?: string;
}

const processes = new Map<string, VersionProcess>();
const versionHealth = new Map<string, VersionHealth>();
let shuttingDown = false;
let reconcilePromise: Promise<void> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sanitizeId(input: string): string {
  return input.replace(/[^a-z0-9]/gi, "").toLowerCase() || `v${Date.now().toString(36)}`;
}

function runCapture(command: string, args: string[], cwd = process.cwd()): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
    child.once("error", (error) => resolve({ code: 1, stdout, stderr: `${stderr}${String(error)}` }));
  });
}

async function loadHealth(): Promise<void> {
  try {
    const decoded = JSON.parse(await readFile(HEALTH_PATH, "utf8")) as Record<
      string,
      { crashes?: unknown; nextRetryAt?: unknown; lastError?: unknown }
    >;
    for (const [versionId, health] of Object.entries(decoded)) {
      if (!health || typeof health !== "object") continue;
      versionHealth.set(versionId, {
        crashes: Number(health.crashes) || 0,
        nextRetryAt: health.nextRetryAt === null ? Number.POSITIVE_INFINITY : Number(health.nextRetryAt) || 0,
        lastError: typeof health.lastError === "string" ? health.lastError : undefined,
      });
    }
  } catch {
    // First run or a discarded health cache.
  }
}

async function persistHealth(): Promise<void> {
  await mkdir(path.dirname(HEALTH_PATH), { recursive: true });
  const serialized = Object.fromEntries(Array.from(versionHealth, ([versionId, health]) => [
    versionId,
    {
      ...health,
      nextRetryAt: Number.isFinite(health.nextRetryAt) ? health.nextRetryAt : null,
    },
  ]));
  await writeFile(HEALTH_PATH, `${JSON.stringify(serialized, null, 2)}\n`, "utf8");
}

function clearVersionHealth(versionId: string): void {
  versionHealth.delete(versionId);
  void persistHealth().catch((error) => console.error("[Orchestrator] Could not persist health", error));
}

function versionSpec(versionId: string): VersionSpec | null {
  if (versionId === DEV_VERSION_ID) {
    return { id: DEV_VERSION_ID, worktreePath: process.cwd(), port: DEV_INTERNAL_PORT };
  }
  const version = authStore.getGameVersion(versionId);
  return version ? { id: version.id, worktreePath: version.worktreePath, port: version.port } : null;
}

function usedPorts(): Set<number> {
  const used = new Set(authStore.listGameVersions().map((version) => version.port));
  used.add(DEV_INTERNAL_PORT);
  used.add(GATEWAY_PORT);
  used.add(CONTROL_PORT);
  return used;
}

function allocatePort(): number {
  const used = usedPorts();
  let port = PORT_BASE;
  while (used.has(port)) port += 1;
  return port;
}

function allocateVersionId(base: string): string {
  const taken = new Set(authStore.listGameVersions().map((version) => version.id));
  taken.add(DEV_VERSION_ID);
  if (!taken.has(base)) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${index}`;
    if (!taken.has(candidate)) return candidate;
  }
}

let registrationChain: Promise<void> = Promise.resolve();
function withRegistrationLock<T>(task: () => Promise<T>): Promise<T> {
  const result = registrationChain.then(task);
  registrationChain = result.then(() => undefined, () => undefined);
  return result;
}

interface RemoteRef {
  ref: string;
  sha: string;
  type: "tag" | "branch";
}

async function listRemoteRefs(): Promise<RemoteRef[]> {
  const result = await runCapture("git", ["ls-remote", "--tags", "--heads", GIT_REMOTE]);
  if (result.code !== 0) throw new Error(`git ls-remote failed: ${result.stderr || result.stdout}`);
  const refs: RemoteRef[] = [];
  for (const line of result.stdout.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const [sha, fullRef] = line.split(/\s+/);
    if (!fullRef) continue;
    if (fullRef.startsWith("refs/tags/") && !fullRef.endsWith("^{}")) {
      refs.push({ ref: fullRef.replace("refs/tags/", ""), sha, type: "tag" });
    } else if (fullRef.startsWith("refs/heads/")) {
      refs.push({ ref: fullRef.replace("refs/heads/", ""), sha, type: "branch" });
    }
  }
  return refs.sort((a, b) => a.ref.localeCompare(b.ref));
}

async function revCommit(ref: string): Promise<string | null> {
  const result = await runCapture("git", ["rev-list", "-n", "1", ref]);
  const sha = result.stdout.trim().split(/\s+/).pop() ?? "";
  return result.code === 0 && /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

async function resolveRef(gitRef: string): Promise<{ sha: string; refType: GameVersionRefType }> {
  const fetched = await runCapture("git", ["fetch", GIT_REMOTE, "--tags", "--prune"]);
  if (fetched.code !== 0) throw new Error(`git fetch failed: ${fetched.stderr || fetched.stdout}`);
  const branch = await revCommit(`refs/remotes/${GIT_REMOTE}/${gitRef}`);
  if (branch) return { sha: branch, refType: "branch" };
  const tag = await revCommit(`refs/tags/${gitRef}`);
  if (tag) return { sha: tag, refType: "tag" };
  const commit = await revCommit(gitRef);
  if (commit) return { sha: commit, refType: "commit" };
  throw new Error(`Could not resolve "${gitRef}" as a branch, tag, or commit.`);
}

async function removeWorktree(worktreePath: string): Promise<void> {
  const resolvedRoot = path.resolve(VERSIONS_ROOT);
  const resolvedTarget = path.resolve(worktreePath);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Refusing to remove worktree outside ${resolvedRoot}.`);
  }
  await runCapture("git", ["worktree", "remove", "--force", resolvedTarget]);
  if (existsSync(resolvedTarget)) await rm(resolvedTarget, { recursive: true, force: true });
  await runCapture("git", ["worktree", "prune"]);
}

async function ensureWorktreeAt(worktreePath: string, sha: string): Promise<void> {
  if (existsSync(worktreePath)) {
    const head = await runCapture("git", ["-C", worktreePath, "rev-parse", "HEAD"]);
    if (head.code === 0 && head.stdout.trim() === sha) return;
    await removeWorktree(worktreePath);
  }
  await runCapture("git", ["worktree", "prune"]);
  const result = await runCapture("git", ["worktree", "add", "--detach", worktreePath, sha]);
  if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
}

async function devVersionEntry(): Promise<StoredGameVersion> {
  const [head, branch] = await Promise.all([
    runCapture("git", ["rev-parse", "HEAD"]),
    runCapture("git", ["rev-parse", "--abbrev-ref", "HEAD"]),
  ]);
  const commit = head.code === 0 ? head.stdout.trim() : "";
  const branchName = branch.code === 0 ? branch.stdout.trim() : "HEAD";
  const detached = branchName === "HEAD" || branchName === "";
  return {
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
}

async function versionDetails(version: StoredGameVersion): Promise<Record<string, unknown>> {
  const spec = versionSpec(version.id)!;
  const artifact = await dependencyArtifactStatus(spec.worktreePath);
  let runtimeApiVersion = 0;
  try {
    runtimeApiVersion = (await readStaticVersionManifest(spec.worktreePath)).runtimeApiVersion;
  } catch {
    // Broken manifest is shown as legacy/unavailable in the dev panel.
  }
  const processEntry = processes.get(version.id);
  const health = versionHealth.get(version.id);
  return {
    ...version,
    runtimeApiVersion,
    artifactReady: version.id === DEV_VERSION_ID || artifact.ready,
    dependencyHash: artifact.dependencyHash,
    process: {
      running: !!processEntry,
      pid: processEntry?.child.pid ?? null,
      startedAt: processEntry?.startedAt ?? null,
      crashes: health?.crashes ?? 0,
      quarantined: health?.nextRetryAt === Number.POSITIVE_INFINITY,
      nextRetryAt: Number.isFinite(health?.nextRetryAt) ? health?.nextRetryAt ?? null : null,
      lastError: health?.lastError ?? null,
    },
  };
}

async function listVersionsDetailed(): Promise<Record<string, unknown>[]> {
  const versions = [await devVersionEntry(), ...authStore.listGameVersions()];
  return Promise.all(versions.map(versionDetails));
}

async function registerVersion(gitRef: string, requestedId?: string, requestedPort?: number): Promise<StoredGameVersion> {
  return withRegistrationLock(async () => {
    const trimmedRef = gitRef.trim();
    if (!trimmedRef) throw new Error("A git ref is required.");
    const explicitId = requestedId?.trim() ? sanitizeId(requestedId) : null;
    if (explicitId === DEV_VERSION_ID) throw new Error('"dev" is reserved.');
    const { sha, refType } = await resolveRef(trimmedRef);
    if (!explicitId) {
      const existing = authStore.listGameVersions().find(
        (version) => version.gitRef === trimmedRef && version.commit === sha,
      );
      if (existing) return existing;
    }
    const id = explicitId ?? allocateVersionId(sanitizeId(trimmedRef));
    if (authStore.getGameVersion(id)) throw new Error(`Version id "${id}" already exists.`);
    const port = requestedPort ?? allocatePort();
    if (!Number.isInteger(port) || port <= 0 || port > 65535 || usedPorts().has(port)) {
      throw new Error(`Port ${port} is invalid or already reserved.`);
    }
    const worktreePath = path.join(VERSIONS_ROOT, id);
    await mkdir(VERSIONS_ROOT, { recursive: true });
    await ensureWorktreeAt(worktreePath, sha);
    try {
      const manifest = await readStaticVersionManifest(worktreePath);
      // Install this commit's exact dependency graph before it is selectable.
      await ensureVersionArtifact(worktreePath);
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
      clearVersionHealth(id);
      await reconcile();
      return version;
    } catch (error) {
      await removeWorktree(worktreePath);
      throw error;
    }
  });
}

async function unregisterVersion(versionId: string): Promise<void> {
  if (versionId === DEV_VERSION_ID) throw new Error("The dev version cannot be unregistered.");
  const version = authStore.getGameVersion(versionId);
  if (!version) throw new Error("Unknown version.");
  const games = authStore.listGamesByVersion(versionId);
  if (games.length > 0) throw new Error(`${games.length} game(s) still use this version.`);
  await stopVersionProcess(versionId);
  authStore.removeGameVersion(versionId);
  clearVersionHealth(versionId);
  await removeWorktree(version.worktreePath);
}

async function ensureVersionRunnable(spec: VersionSpec): Promise<void> {
  if (!existsSync(path.join(spec.worktreePath, "server", "index.ts"))) {
    if (spec.id === DEV_VERSION_ID) throw new Error("Development server entry point is missing.");
    const version = authStore.getGameVersion(spec.id);
    if (!version) throw new Error(`Version ${spec.id} is not registered.`);
    await removeWorktree(spec.worktreePath);
    await ensureWorktreeAt(spec.worktreePath, version.commit);
  }
  await readStaticVersionManifest(spec.worktreePath);
  if (spec.id !== DEV_VERSION_ID) await ensureVersionArtifact(spec.worktreePath);
}

function recordCrash(versionId: string, startedAt: number, message: string): void {
  const uptimeMs = Date.now() - startedAt;
  if (uptimeMs >= HEALTHY_UPTIME_MS) {
    clearVersionHealth(versionId);
    return;
  }
  const crashes = (versionHealth.get(versionId)?.crashes ?? 0) + 1;
  const nextRetryAt = crashes > MAX_RAPID_RESTARTS
    ? Number.POSITIVE_INFINITY
    : Date.now() + Math.min(RESTART_DELAY_MS * 2 ** (crashes - 1), MAX_RESTART_BACKOFF_MS);
  versionHealth.set(versionId, { crashes, nextRetryAt, lastError: message });
  void persistHealth().catch((error) => console.error("[Orchestrator] Could not persist health", error));
}

function spawnVersionProcess(spec: VersionSpec): void {
  if (processes.has(spec.id) || shuttingDown) return;
  const child = spawn(process.execPath, [
    "--import",
    pathToFileURL(versionTsxImport(spec.worktreePath)).href,
    "--import",
    pathToFileURL(path.join(process.cwd(), "server", "runtime-module-guard.mjs")).href,
    path.join(spec.worktreePath, "server", "index.ts"),
  ], {
    cwd: process.cwd(),
    shell: false,
    env: {
      ...process.env,
      GAME_SERVER_PORT: String(spec.port),
      SF_VERSION_ID: spec.id,
      SF_STATE_DIR: STATE_ROOT,
      SF_AUTH_STORE_MODE: "runtime",
    },
  });
  let resolveExit!: (result: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    resolveExit = resolve;
  });
  const entry: VersionProcess = {
    child,
    port: spec.port,
    stopping: false,
    startedAt: Date.now(),
    exitPromise,
  };
  processes.set(spec.id, entry);
  child.stdout?.on("data", (chunk) => process.stdout.write(`[v:${spec.id}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[v:${spec.id}] ${chunk}`));
  child.once("error", (error) => {
    console.error(`[Orchestrator] Could not start version ${spec.id}`, error);
  });
  child.once("exit", (code, signal) => {
    resolveExit({ code, signal });
    if (processes.get(spec.id) === entry) processes.delete(spec.id);
    const message = `Exited with code ${code ?? "none"} signal ${signal ?? "none"}.`;
    console.warn(`[Orchestrator] Version ${spec.id}: ${message}`);
    if (!entry.stopping && !shuttingDown) recordCrash(spec.id, entry.startedAt, message);
  });
}

async function stopVersionProcess(versionId: string): Promise<void> {
  const entry = processes.get(versionId);
  if (!entry) return;
  entry.stopping = true;
  entry.child.kill("SIGTERM");
  const graceful = await Promise.race([
    entry.exitPromise.then(() => true),
    delay(STOP_TIMEOUT_MS).then(() => false),
  ]);
  if (!graceful) {
    console.error(`[Orchestrator] Version ${versionId} did not stop in ${STOP_TIMEOUT_MS}ms; sending SIGKILL.`);
    entry.child.kill("SIGKILL");
    const killed = await Promise.race([
      entry.exitPromise.then(() => true),
      delay(5_000).then(() => false),
    ]);
    if (!killed) throw new Error(`Version ${versionId} could not be stopped safely.`);
  }
  if (processes.get(versionId) === entry) processes.delete(versionId);
}

async function reconcileInternal(): Promise<void> {
  if (shuttingDown) return;
  const activeVersionIds = new Set(
    authStore.listGames().filter((game) => game.status === "active").map((game) => game.versionId),
  );
  for (const versionId of activeVersionIds) {
    if (processes.has(versionId)) continue;
    const spec = versionSpec(versionId);
    if (!spec) continue;
    const health = versionHealth.get(versionId);
    if (health && Date.now() < health.nextRetryAt) continue;
    try {
      await ensureVersionRunnable(spec);
      spawnVersionProcess(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Orchestrator] Version ${versionId} is not runnable: ${message}`);
      recordCrash(versionId, Date.now(), message);
    }
  }
  for (const versionId of Array.from(processes.keys())) {
    if (!activeVersionIds.has(versionId)) await stopVersionProcess(versionId);
  }
}

function reconcile(): Promise<void> {
  if (reconcilePromise) return reconcilePromise;
  reconcilePromise = reconcileInternal().finally(() => {
    reconcilePromise = null;
  });
  return reconcilePromise;
}

async function readOwner(gameId: string): Promise<{ pid: number; versionId?: string } | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(getGameStateDirectory(gameId), ".owner"), "utf8"),
    ) as { pid?: unknown; versionId?: unknown };
    return Number.isInteger(parsed.pid)
      ? { pid: Number(parsed.pid), versionId: typeof parsed.versionId === "string" ? parsed.versionId : undefined }
      : null;
  } catch {
    return null;
  }
}

async function waitForRuntimeRelease(gameId: string, timeoutMs = RELEASE_TIMEOUT_MS): Promise<void> {
  const lockPath = path.join(getGameStateDirectory(gameId), ".owner");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!existsSync(lockPath)) return;
    const owner = await readOwner(gameId);
    if (!owner || !isPidAlive(owner.pid)) {
      await rm(lockPath, { force: true });
      return;
    }
    await delay(250);
  }
  const owner = await readOwner(gameId);
  throw new Error(
    `Game ${gameId} did not release its save lock within ${timeoutMs}ms`
    + (owner ? ` (version ${owner.versionId ?? "unknown"}, pid ${owner.pid}).` : "."),
  );
}

async function quiesceGame(game: StoredGame): Promise<void> {
  authStore.setGameStatus(game.id, "stopped");
  await reconcile();
  await waitForRuntimeRelease(game.id);
}

function targetManifest(targetVersionId: string): { migratesFromSchema: number[] } | null {
  if (targetVersionId === DEV_VERSION_ID) return VERSION_MANIFEST;
  return authStore.getGameVersion(targetVersionId);
}

function canMigrate(game: Pick<StoredGame, "versionId" | "schemaVersion">, targetVersionId: string): boolean {
  if (targetVersionId === game.versionId) return true;
  const target = targetManifest(targetVersionId);
  if (!target) return false;
  if (game.schemaVersion === null) return true;
  return target.migratesFromSchema.includes(game.schemaVersion);
}

async function resetGame(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  const previousStatus = game.status;
  await quiesceGame(game);
  try {
    await createGameBackup(game, "before-reset");
    await rm(getGameStatePath(game.id), { force: true });
    authStore.clearGameStateVersions(game.id);
    authStore.setGameStatus(game.id, "active");
    clearVersionHealth(game.versionId);
    await reconcile();
  } catch (error) {
    authStore.setGameStatus(game.id, previousStatus);
    await reconcile();
    throw error;
  }
}

async function updateGame(gameId: string, toVersionId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  if (!targetManifest(toVersionId)) throw new Error("Unknown target version.");
  if (!canMigrate(game, toVersionId)) {
    throw new Error(`Version ${toVersionId} cannot migrate schema ${game.schemaVersion}.`);
  }
  const previousStatus = game.status;
  await quiesceGame(game);
  try {
    await createGameBackup(game, `before-update-to-${toVersionId}`);
    authStore.setGameVersion(game.id, toVersionId);
    authStore.setGameStatus(game.id, "active");
    clearVersionHealth(toVersionId);
    await reconcile();
  } catch (error) {
    authStore.setGameVersion(game.id, game.versionId);
    authStore.setGameStatus(game.id, previousStatus);
    await reconcile();
    throw error;
  }
}

async function rollbackGame(gameId: string, requestedBackupId?: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  const backups = await listGameBackups(game.id);
  const backupId = requestedBackupId || backups[0]?.id;
  if (!backupId) throw new Error("No backup is available.");
  const selected = await verifyGameBackup(game.id, backupId);
  const rollbackTarget = targetManifest(selected.sourceVersionId);
  if (!rollbackTarget) {
    throw new Error(`Backup requires unregistered version ${selected.sourceVersionId}. Register it before rollback.`);
  }
  if (selected.schemaVersion !== null && !rollbackTarget.migratesFromSchema.includes(selected.schemaVersion)) {
    throw new Error(
      `Version ${selected.sourceVersionId} cannot load backup schema ${selected.schemaVersion}.`,
    );
  }
  const previousStatus = game.status;
  await quiesceGame(game);
  try {
    await createGameBackup(game, `before-rollback-to-${backupId}`);
    const manifest = await restoreGameBackup(game.id, backupId);
    authStore.setGameVersion(game.id, manifest.sourceVersionId);
    if (manifest.schemaVersion !== null && manifest.protocolVersion !== null) {
      authStore.recordGameStateVersions(game.id, manifest.schemaVersion, manifest.protocolVersion);
    }
    authStore.setGameStatus(game.id, "active");
    clearVersionHealth(manifest.sourceVersionId);
    await reconcile();
  } catch (error) {
    authStore.setGameVersion(game.id, game.versionId);
    authStore.setGameStatus(game.id, previousStatus);
    await reconcile();
    throw error;
  }
}

async function manualBackup(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  const previousStatus = game.status;
  await quiesceGame(game);
  try {
    await createGameBackup(game, "manual");
  } finally {
    authStore.setGameStatus(game.id, previousStatus);
    await reconcile();
  }
}

async function stopGame(gameId: string, status: "stopped" | "archived"): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  await quiesceGame(game);
  authStore.setGameStatus(game.id, status);
}

async function startGame(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) throw new Error("Game not found.");
  // A stopped game has been removed from its version host, clearing any
  // per-game quarantine. Starting it is an explicit operator retry.
  if (game.status === "active") {
    // Explicit retry of a quarantined game: restart its version host so the
    // per-game failure registry is cleared. Graceful stop saves healthy siblings.
    await stopVersionProcess(game.versionId);
  }
  authStore.setGameStatus(game.id, "active");
  clearVersionHealth(game.versionId);
  await reconcile();
}

async function deleteGame(gameId: string): Promise<void> {
  const game = authStore.getGameById(gameId);
  if (!game) return;
  await quiesceGame(game);
  await createGameBackup(game, "before-delete");
  authStore.deleteGame(game.id);
  // Keep backups after deletion; remove only live save/lock files.
  await rm(getGameStatePath(game.id), { force: true });
  await rm(path.join(getGameStateDirectory(game.id), ".owner"), { force: true });
  await reconcile();
}

function compatReport(toVersionId: string): Array<Record<string, unknown>> {
  return authStore.listGames().map((game) => ({
    id: game.id,
    name: game.name,
    versionId: game.versionId,
    schemaVersion: game.schemaVersion,
    canUpdate: canMigrate(game, toVersionId),
  }));
}

async function listGamesDetailed(): Promise<Record<string, unknown>[]> {
  const stats = authStore.getDevStats().game;
  const runtimeById = new Map(stats.games.map((game) => [game.id, game]));
  return Promise.all(authStore.listGames().map(async (game) => {
    const backups = await listGameBackups(game.id);
    const owner = await readOwner(game.id);
    return {
      ...game,
      endpoint: {
        versionId: game.versionId,
        status: game.status,
        protocolVersion: (game.versionId === DEV_VERSION_ID
          ? VERSION_MANIFEST.protocolVersion
          : authStore.getGameVersion(game.versionId)?.protocolVersion) ?? game.protocolVersion,
      },
      runtime: runtimeById.get(game.id) ?? null,
      backupCount: backups.length,
      latestBackup: backups[0] ?? null,
      owner,
    };
  }));
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    bytes += buffer.byteLength;
    if (bytes > MAX_CONTROL_BODY_BYTES) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

const controlServer = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, {
        ok: !shuttingDown,
        generatedAt: Date.now(),
        gateway: gatewayProxy.metrics,
        versions: await listVersionsDetailed(),
        games: await listGamesDetailed(),
      });
    }
    if (request.headers["x-control-token"] !== CONTROL_TOKEN) {
      return send(response, 401, { error: "Unauthorized" });
    }
    const method = request.method ?? "GET";
    const body = method === "POST" ? await readJsonBody(request) : {};
    const gameMatch = url.pathname.match(
      /^\/games\/([a-z0-9]+)\/(reset|update|stop|start|archive|rollback|backup|backups|retry)$/i,
    );
    const gameRootMatch = url.pathname.match(/^\/games\/([a-z0-9]+)$/i);
    const versionMatch = url.pathname.match(/^\/versions\/([a-z0-9]+)$/i);

    if (method === "GET" && url.pathname === "/versions") return send(response, 200, { versions: await listVersionsDetailed() });
    if (method === "GET" && url.pathname === "/remote-versions") return send(response, 200, { refs: await listRemoteRefs() });
    if (method === "GET" && url.pathname === "/games") return send(response, 200, { games: await listGamesDetailed() });
    if (method === "GET" && url.pathname === "/compat") {
      return send(response, 200, { games: compatReport(String(url.searchParams.get("to") ?? "")) });
    }
    if (method === "DELETE" && versionMatch) {
      await unregisterVersion(versionMatch[1]);
      return send(response, 200, { ok: true });
    }
    if (method === "DELETE" && gameRootMatch) {
      await deleteGame(gameRootMatch[1]);
      return send(response, 200, { ok: true });
    }
    if (method === "POST" && url.pathname === "/versions") {
      const version = await registerVersion(
        String(body.gitRef ?? ""),
        body.id ? String(body.id) : undefined,
        body.port === undefined ? undefined : Number(body.port),
      );
      return send(response, 201, { version: await versionDetails(version) });
    }
    if (method === "POST" && url.pathname === "/games") {
      const game = authStore.createGame(String(body.name ?? ""), body.versionId ? String(body.versionId) : DEV_VERSION_ID);
      await reconcile();
      return send(response, 201, { game });
    }
    if (gameMatch) {
      const [, gameId, action] = gameMatch;
      if (method === "GET" && action === "backups") {
        return send(response, 200, { backups: await listGameBackups(gameId) });
      }
      if (method !== "POST") return send(response, 405, { error: "Method not allowed" });
      switch (action) {
        case "reset": await resetGame(gameId); break;
        case "update": await updateGame(gameId, String(body.toVersion ?? "")); break;
        case "stop": await stopGame(gameId, "stopped"); break;
        case "start":
        case "retry": await startGame(gameId); break;
        case "archive": await stopGame(gameId, "archived"); break;
        case "rollback": await rollbackGame(gameId, body.backupId ? String(body.backupId) : undefined); break;
        case "backup": await manualBackup(gameId); break;
        case "backups": return send(response, 405, { error: "Method not allowed" });
      }
      return send(response, 200, { ok: true, game: authStore.getGameById(gameId) });
    }
    return send(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("[Orchestrator] Control request failed", error);
    return send(response, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

const gateway = new WebSocketServer({
  host: GATEWAY_HOST,
  port: GATEWAY_PORT,
  maxPayload: 1024 * 1024,
  perMessageDeflate: false,
});
const gatewayProxy = attachGatewayProxy(gateway, {
  resolveTarget: (gameId) => {
    const game = authStore.getGameById(gameId);
    if (!game || game.status !== "active") return { port: 0, available: false, reason: "Game not available." };
    const spec = versionSpec(game.versionId);
    if (!spec) return { port: 0, available: false, reason: "Game version is unavailable." };
    return { port: spec.port, available: true };
  },
});

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Orchestrator] ${signal}: stopping ${processes.size} version process(es).`);
  controlServer.close();
  gateway.close();
  const results = await Promise.allSettled(Array.from(processes.keys()).map(stopVersionProcess));
  const failed = results.filter((result) => result.status === "rejected");
  authStore.close();
  if (failed.length > 0) throw new Error(`${failed.length} version process(es) failed to stop.`);
}

await loadHealth();
controlServer.listen(CONTROL_PORT, CONTROL_HOST, () => {
  console.log(`[Orchestrator] Control API on http://${CONTROL_HOST}:${CONTROL_PORT}`);
  console.log(`[Orchestrator] Game gateway on ws://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  void reconcile();
  const reconcileTimer = setInterval(() => {
    void reconcile().catch((error) => console.error("[Orchestrator] Reconcile failed", error));
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal)
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("[Orchestrator] Shutdown failed", error);
        process.exit(1);
      });
  });
}
