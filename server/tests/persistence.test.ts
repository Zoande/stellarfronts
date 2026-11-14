import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { saveState } from "../game/persistence";
import type { RuntimeContext } from "../game/types";

test("large saves capture one coherent instant before yielding and flush later mutations separately", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-large-save-"));
  try {
    const statePath = path.join(directory, "game-state.json");
    const state = { schemaVersion: 30, clock: { year: 1 }, populations: [1], payload: "🌌".repeat(300_000) };
    const snapshots: number[][] = [];
    const ctx = { game: { id: "large-save" }, statePath, state, hasDirtyState: true, lastSaveAt: 0,
      saveInFlight: null, saveQueued: false, services: { now: () => Date.now(), authStore: {
        recordGameStateVersions: () => {
          const saved = JSON.parse(readFileSync(statePath, "utf8"));
          assert.equal(saved.payload, state.payload);
          snapshots.push([saved.clock.year, saved.populations.at(-1)]);
        },
      } } } as unknown as RuntimeContext;
    const first = saveState(ctx);
    state.clock = { year: 2 };
    state.populations.push(2);
    ctx.hasDirtyState = true;
    await first;
    assert.deepEqual(snapshots, [[1, 1], [2, 2]], "never combine an old clock with later mutable arrays");
    assert.deepEqual(await readdir(directory), ["game-state.json"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

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
      services: {
        authStore: {
          recordGameStateVersions: () => undefined,
        },
        now: () => Date.now(),
      },
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
