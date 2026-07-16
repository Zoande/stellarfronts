import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveState } from "../game/persistence";
import type { RuntimeContext } from "../game/types";

test("state saves are single-flight, compact, and atomically replaced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-save-"));
  try {
    const statePath = path.join(directory, "game-state.json");
    const state = { schemaVersion: 23, marker: 1 };
    const ctx = {
      game: { id: "persistence-test" },
      statePath,
      state,
      hasDirtyState: true,
      lastSaveAt: 0,
      saveInFlight: null,
      saveQueued: false,
    } as unknown as RuntimeContext;

    const first = saveState(ctx);
    state.marker = 2;
    ctx.hasDirtyState = true;
    const second = saveState(ctx);
    assert.equal(second, first);
    await Promise.all([first, second]);

    const serialized = await readFile(statePath, "utf8");
    const saved = JSON.parse(serialized) as { marker: number };
    assert.equal(saved.marker, 2);
    assert.equal(serialized.includes("\n  \""), false);
    assert.deepEqual(await readdir(directory), ["game-state.json"]);
    assert.equal(ctx.saveInFlight, null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
