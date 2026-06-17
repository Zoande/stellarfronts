import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { authStore } from "../auth-store";
import { getGameStateDirectory } from "../game-state-path";
import { VERSION_MANIFEST } from "../versionManifest";
import type { RuntimeContext } from "./types";

const SF_VERSION_ID = VERSION_MANIFEST.versionId;

export async function saveState(ctx: RuntimeContext, nextState = ctx.state): Promise<void> {
  await mkdir(path.dirname(ctx.statePath), { recursive: true });
  // Stamp the writing build's identity so the orchestrator/catalog know which
  // code last wrote this save and which schema it is on.
  const stamped = {
    ...nextState,
    codeVersion: SF_VERSION_ID,
    protocolVersion: VERSION_MANIFEST.protocolVersion,
  };
  await writeFile(ctx.statePath, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  authStore.recordGameStateVersions(ctx.game.id, nextState.schemaVersion, VERSION_MANIFEST.protocolVersion);
  ctx.lastSaveAt = Date.now();
  ctx.hasDirtyState = false;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Exclusive ownership: refuse to open a game already held by a live process of a
// different version (belt-and-suspenders on top of the version filter, covering
// the brief window during an update before the old process releases it).
export async function acquireOwnership(ctx: RuntimeContext): Promise<void> {
  const ownerLockPath = path.join(getGameStateDirectory(ctx.game.id), ".owner");
  await mkdir(path.dirname(ownerLockPath), { recursive: true });
  try {
    const existing = JSON.parse(await readFile(ownerLockPath, "utf8")) as { versionId: string; pid: number };
    if (existing.pid !== process.pid && existing.versionId !== SF_VERSION_ID && isPidAlive(existing.pid)) {
      throw new Error(`Game ${ctx.game.id} is owned by version ${existing.versionId} (pid ${existing.pid}).`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("is owned by version")) throw error;
    // No readable lock → free to take ownership.
  }
  await writeFile(ownerLockPath, JSON.stringify({ versionId: SF_VERSION_ID, pid: process.pid, startedAt: Date.now() }));
}

export async function releaseOwnership(ctx: RuntimeContext): Promise<void> {
  const ownerLockPath = path.join(getGameStateDirectory(ctx.game.id), ".owner");
  try {
    const existing = JSON.parse(await readFile(ownerLockPath, "utf8")) as { pid: number };
    if (existing.pid === process.pid) await rm(ownerLockPath, { force: true });
  } catch {
    // Lock already gone.
  }
}
