import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadState } from "../game/state-bootstrap";
import { GameStateLoadError, migrateGameStateEnvelope } from "../game/state-migrations";
import { minimalRuntimeContext } from "./helpers/runtime-context";

test("corrupt saves are preserved and reported instead of replaced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-corrupt-"));
  try {
    const statePath = path.join(directory, "game-state.json");
    const corrupt = '{"schemaVersion":27,"stars":[';
    await writeFile(statePath, corrupt, "utf8");
    await assert.rejects(loadState(minimalRuntimeContext(statePath)), GameStateLoadError);
    assert.equal(await readFile(statePath, "utf8"), corrupt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state envelope migrations are explicit, immutable, and reject unsupported schemas", () => {
  const state = {
    schemaVersion: 23,
    stars: [],
    planetStates: [],
    factions: [],
    hyperlanes: [],
    starbases: [],
    ships: [],
    clock: { year: 2200 },
  };
  const migrated = migrateGameStateEnvelope(state);
  assert.equal(migrated.originalSchema, 23);
  assert.equal(migrated.state.schemaVersion, 27);
  assert.equal(state.schemaVersion, 23);
  assert.throws(() => migrateGameStateEnvelope({ ...state, schemaVersion: 22 }), /not supported/);
  assert.throws(() => migrateGameStateEnvelope({ ...state, schemaVersion: 28 }), /not supported/);
});
