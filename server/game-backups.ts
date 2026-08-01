import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoredGame } from "./auth-store";
import { getGameStateDirectory, getGameStatePath } from "./game-state-path";

export interface GameBackupManifest {
  id: string;
  gameId: string;
  gameName: string;
  createdAt: number;
  reason: string;
  sourceVersionId: string;
  schemaVersion: number | null;
  protocolVersion: number | null;
  stateSha256: string;
  stateBytes: number;
}

const DEFAULT_RETENTION = 30;

function backupDirectory(gameId: string): string {
  return path.join(getGameStateDirectory(gameId), "backups");
}

function manifestPath(gameId: string, backupId: string): string {
  return path.join(backupDirectory(gameId), `${backupId}.manifest.json`);
}

function stateBackupPath(gameId: string, backupId: string): string {
  return path.join(backupDirectory(gameId), `${backupId}.state.json`);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function isBackupManifest(value: unknown): value is GameBackupManifest {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GameBackupManifest>;
  return typeof record.id === "string"
    && typeof record.gameId === "string"
    && typeof record.sourceVersionId === "string"
    && typeof record.stateSha256 === "string"
    && typeof record.createdAt === "number";
}

export async function listGameBackups(gameId: string): Promise<GameBackupManifest[]> {
  let entries: string[];
  try {
    entries = await readdir(backupDirectory(gameId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const manifests = await Promise.all(entries
    .filter((entry) => entry.endsWith(".manifest.json"))
    .map(async (entry) => {
      try {
        const parsed: unknown = JSON.parse(await readFile(path.join(backupDirectory(gameId), entry), "utf8"));
        return isBackupManifest(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }));
  return manifests
    .filter((entry): entry is GameBackupManifest => entry !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function pruneBackups(gameId: string): Promise<void> {
  const retention = Math.max(1, Number(process.env.GAME_BACKUP_RETENTION ?? DEFAULT_RETENTION) || DEFAULT_RETENTION);
  const backups = await listGameBackups(gameId);
  await Promise.all(backups.slice(retention).flatMap((backup) => [
    rm(manifestPath(gameId, backup.id), { force: true }),
    rm(stateBackupPath(gameId, backup.id), { force: true }),
  ]));
}

export async function createGameBackup(game: StoredGame, reason: string): Promise<GameBackupManifest | null> {
  const sourcePath = getGameStatePath(game.id);
  let state: Buffer;
  try {
    state = await readFile(sourcePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  // A backup must at least be parseable JSON; never bless a partial write.
  const decoded = JSON.parse(state.toString("utf8")) as { schemaVersion?: unknown; protocolVersion?: unknown; codeVersion?: unknown };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${stamp}-${randomUUID().slice(0, 8)}`;
  const directory = backupDirectory(game.id);
  await mkdir(directory, { recursive: true });
  const backupState = stateBackupPath(game.id, id);
  await writeFile(backupState, state);
  const details = await stat(backupState);
  const manifest: GameBackupManifest = {
    id,
    gameId: game.id,
    gameName: game.name,
    createdAt: Date.now(),
    reason,
    sourceVersionId: typeof decoded.codeVersion === "string" ? decoded.codeVersion : game.versionId,
    schemaVersion: Number.isInteger(Number(decoded.schemaVersion)) ? Number(decoded.schemaVersion) : game.schemaVersion,
    protocolVersion: Number.isInteger(Number(decoded.protocolVersion)) ? Number(decoded.protocolVersion) : game.protocolVersion,
    stateSha256: sha256(state),
    stateBytes: details.size,
  };
  await writeFile(manifestPath(game.id, id), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await pruneBackups(game.id);
  return manifest;
}

export async function verifyGameBackup(gameId: string, backupId: string): Promise<GameBackupManifest> {
  const parsed: unknown = JSON.parse(await readFile(manifestPath(gameId, backupId), "utf8"));
  if (!isBackupManifest(parsed) || parsed.gameId !== gameId || parsed.id !== backupId) {
    throw new Error("Backup manifest is invalid.");
  }
  const state = await readFile(stateBackupPath(gameId, backupId));
  if (sha256(state) !== parsed.stateSha256) throw new Error("Backup checksum mismatch.");
  const decoded = JSON.parse(state.toString("utf8")) as { schemaVersion?: unknown };
  if (!Number.isInteger(Number(decoded.schemaVersion))) throw new Error("Backup save has no valid schema.");
  return parsed;
}

export async function restoreGameBackup(gameId: string, backupId: string): Promise<GameBackupManifest> {
  const manifest = await verifyGameBackup(gameId, backupId);
  const targetPath = getGameStatePath(gameId);
  const temporaryPath = `${targetPath}.restore.${randomUUID()}.tmp`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await copyFile(stateBackupPath(gameId, backupId), temporaryPath);
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return manifest;
}
