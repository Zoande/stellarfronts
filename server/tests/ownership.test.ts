import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { getGameStateDirectory } from "../game-state-path";
import { acquireOwnership, releaseOwnership } from "../game/persistence";
import { minimalRuntimeContext } from "./helpers/runtime-context";

test("ownership is exclusive even inside the same version process", async () => {
  const gameId = `lock${Date.now().toString(36)}`;
  const directory = getGameStateDirectory(gameId);
  const first = minimalRuntimeContext(path.join(directory, "game-state.json"), gameId);
  const second = minimalRuntimeContext(path.join(directory, "game-state.json"), gameId);
  try {
    await acquireOwnership(first);
    await assert.rejects(acquireOwnership(second), /already owned/);
    await releaseOwnership(first);
    await acquireOwnership(second);
    await releaseOwnership(second);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent stale-lock reclamation still produces exactly one owner", async () => {
  const gameId = `stale${Date.now().toString(36)}`;
  const directory = getGameStateDirectory(gameId);
  const contenders = [
    minimalRuntimeContext(path.join(directory, "game-state.json"), gameId),
    minimalRuntimeContext(path.join(directory, "game-state.json"), gameId),
  ];
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, ".owner"), JSON.stringify({
      versionId: "dead",
      pid: 2_000_000_000,
      token: "stale-token",
      startedAt: 1,
    }), "utf8");
    const results = await Promise.allSettled(contenders.map(acquireOwnership));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const winner = contenders.find((context) => context.ownershipToken !== null);
    assert.ok(winner);
    await releaseOwnership(winner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
