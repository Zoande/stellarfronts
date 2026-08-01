import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getGameStateDirectory } from "../game-state-path";
import { VERSION_MANIFEST } from "../versionManifest";
import type { RuntimeContext } from "./types";

const SF_VERSION_ID = VERSION_MANIFEST.versionId;

async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const directory = await open(directoryPath, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    // Directory fsync is supported on the Linux production host. Some
    // development platforms reject opening or syncing directories.
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "EISDIR", "EPERM", "EACCES"].includes(code ?? "")) throw error;
  }
}

async function writeStateSnapshot(ctx: RuntimeContext, nextState: RuntimeContext["state"]): Promise<void> {
  const stateDirectory = path.dirname(ctx.statePath);
  await mkdir(stateDirectory, { recursive: true });
  const stamped = {
    ...nextState,
    codeVersion: SF_VERSION_ID,
    protocolVersion: VERSION_MANIFEST.protocolVersion,
  };
  const temporaryPath = `${ctx.statePath}.${process.pid}.${randomUUID()}.tmp`;
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null;
  try {
    temporaryFile = await open(temporaryPath, "wx");
    await temporaryFile.writeFile(`${JSON.stringify(stamped)}\n`, "utf8");
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = null;
    await rename(temporaryPath, ctx.statePath);
    await syncDirectory(stateDirectory);
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
  ctx.services.authStore.recordGameStateVersions(ctx.game.id, nextState.schemaVersion, VERSION_MANIFEST.protocolVersion);
  ctx.lastSaveAt = ctx.services.now();
}

async function runSaveQueue(ctx: RuntimeContext, initialState: RuntimeContext["state"]): Promise<void> {
  let nextState = initialState;
  do {
    ctx.saveQueued = false;
    // Serialization is synchronous. Mutations made while the file write awaits
    // I/O set hasDirtyState again and are captured by the follow-up iteration.
    ctx.hasDirtyState = false;
    try {
      await writeStateSnapshot(ctx, nextState);
    } catch (error) {
      ctx.hasDirtyState = true;
      throw error;
    }
    nextState = ctx.state;
  } while (ctx.saveQueued || ctx.hasDirtyState);
}

export function saveState(ctx: RuntimeContext, nextState = ctx.state): Promise<void> {
  if (ctx.saveInFlight) {
    ctx.saveQueued = true;
    return ctx.saveInFlight;
  }
  const pending = runSaveQueue(ctx, nextState).finally(() => {
    if (ctx.saveInFlight === pending) ctx.saveInFlight = null;
  });
  ctx.saveInFlight = pending;
  return pending;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface OwnershipRecord {
  versionId: string;
  pid: number;
  token: string;
  startedAt: number;
}

function isOwnershipRecord(value: unknown): value is OwnershipRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<OwnershipRecord>;
  return typeof record.versionId === "string"
    && Number.isInteger(record.pid)
    && typeof record.token === "string"
    && typeof record.startedAt === "number";
}

export async function readOwnership(ownerLockPath: string): Promise<OwnershipRecord | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(ownerLockPath, "utf8"));
    return isOwnershipRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Acquire a game lock using an atomic create. Same-version duplicate processes
 * are deliberately rejected too: exactly one runtime may ever mutate a game.
 */
export async function acquireOwnership(ctx: RuntimeContext): Promise<void> {
  const ownerLockPath = path.join(getGameStateDirectory(ctx.game.id), ".owner");
  await mkdir(path.dirname(ownerLockPath), { recursive: true });
  const token = randomUUID();
  const record: OwnershipRecord = {
    versionId: SF_VERSION_ID,
    pid: process.pid,
    token,
    startedAt: Date.now(),
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const lockFile = await open(ownerLockPath, "wx");
      try {
        await lockFile.writeFile(JSON.stringify(record), "utf8");
        await lockFile.sync();
      } finally {
        await lockFile.close();
      }
      ctx.ownershipToken = token;
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readOwnership(ownerLockPath);
      if (existing && isPidAlive(existing.pid)) {
        throw new Error(
          `Game ${ctx.game.id} is already owned by version ${existing.versionId} (pid ${existing.pid}).`,
        );
      }
      // Atomically move the stale inode out of the lock name before deleting
      // it. Deleting by path after a read would race with another contender:
      // that contender could install a fresh lock which we would then remove.
      const stalePath = `${ownerLockPath}.stale.${process.pid}.${randomUUID()}`;
      try {
        await rename(ownerLockPath, stalePath);
        await rm(stalePath, { force: true });
      } catch (reclaimError) {
        if ((reclaimError as NodeJS.ErrnoException).code !== "ENOENT") throw reclaimError;
      }
    }
  }
  throw new Error(`Could not acquire exclusive ownership of game ${ctx.game.id}.`);
}

export async function releaseOwnership(ctx: RuntimeContext): Promise<void> {
  const ownerLockPath = path.join(getGameStateDirectory(ctx.game.id), ".owner");
  try {
    const existing = await readOwnership(ownerLockPath);
    if (existing?.pid === process.pid && existing.token === ctx.ownershipToken) {
      await rm(ownerLockPath, { force: true });
    }
  } finally {
    ctx.ownershipToken = null;
  }
}
