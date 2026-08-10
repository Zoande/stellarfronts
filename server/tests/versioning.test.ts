import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AuthStore } from "../auth-store";
import type { StoredGameVersion } from "../auth-store";
import {
  CURRENT_PROTOCOL_VERSION,
  CURRENT_RUNTIME_API_VERSION,
  CURRENT_SCHEMA_VERSION,
  VERSION_MANIFEST,
  canMigrateFromSchema,
} from "../versionManifest";
import { readStaticVersionManifest } from "../version-artifacts";
import { SUPPORTED_SERVER_PROTOCOL_VERSIONS } from "../../src/game/GameProtocol";

function freshStore(): AuthStore {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-version-"));
  return new AuthStore(path.join(directory, "auth.sqlite"));
}

function sampleVersion(overrides: Partial<StoredGameVersion> = {}): StoredGameVersion {
  return {
    id: "v2",
    gitRef: "v2.0.0",
    commit: "a".repeat(40),
    refType: "tag",
    worktreePath: "versions/v2",
    port: 8810,
    protocolVersion: 2,
    schemaVersion: 20,
    migratesFromSchema: [18, 19, 20],
    createdAt: Date.now(),
    ...overrides,
  };
}

test("new games default to the dev version and active status", () => {
  const store = freshStore();
  const game = store.createGame("Versioned Alpha");
  assert.equal(game.versionId, "dev");
  assert.equal(game.status, "active");
  assert.equal(game.schemaVersion, null);
});

test("version registry round-trips and games can be assigned/filtered by version", () => {
  const store = freshStore();
  store.registerGameVersion(sampleVersion());
  const versions = store.listGameVersions();
  assert.equal(versions.length, 1);
  assert.deepEqual(versions[0].migratesFromSchema, [18, 19, 20]);

  const game = store.createGame("On V2", "v2");
  assert.equal(game.versionId, "v2");
  assert.deepEqual(store.listGamesByVersion("v2").map((g) => g.id), [game.id]);
  assert.deepEqual(store.listGamesByVersion("dev").map((g) => g.id), []);
});

test("creating a game on an unknown version is rejected", () => {
  const store = freshStore();
  assert.throws(() => store.createGame("Ghost", "nope"));
});

test("game version, status and state-version stamps are mutable", () => {
  const store = freshStore();
  store.registerGameVersion(sampleVersion());
  const game = store.createGame("Mutable");
  store.setGameVersion(game.id, "v2");
  store.setGameStatus(game.id, "archived");
  store.recordGameStateVersions(game.id, 20, 2);
  const updated = store.getGameById(game.id);
  assert.equal(updated?.versionId, "v2");
  assert.equal(updated?.status, "archived");
  assert.equal(updated?.schemaVersion, 20);
  assert.equal(updated?.protocolVersion, 2);
});

test("registered versions persist their pinned commit and ref type", () => {
  const store = freshStore();
  store.registerGameVersion(sampleVersion({ commit: "b".repeat(40), refType: "branch", gitRef: "main" }));
  const [version] = store.listGameVersions();
  assert.equal(version.commit, "b".repeat(40));
  assert.equal(version.refType, "branch");
  assert.equal(version.gitRef, "main");
});

test("archived games are hidden from the lobby for every account", () => {
  const store = freshStore();
  const account = store.getAccountByUsername("color_1");
  assert.ok(account);
  const game = store.createGame("Soon Archived");
  // Visible while active...
  assert.ok(store.getGameSummariesForAccount(account!).some((g) => g.id === game.id));
  store.setGameStatus(game.id, "archived");
  // ...and gone once archived (for joined and unjoined accounts alike).
  assert.equal(store.getGameSummariesForAccount(account!).some((g) => g.id === game.id), false);
  assert.equal(store.getGameSummaryForAccount(game.id, account!), null);
});

test("an archived game cannot be joined", () => {
  const store = freshStore();
  const account = store.getAccountByUsername("color_1");
  assert.ok(account);
  const game = store.createGame("No Entry");
  store.setGameStatus(game.id, "archived");
  assert.throws(() => store.joinGame(account!, game.id, "Latecomer"), /Game not found/);
});

test("compatibility gate matches a version's declared migratesFromSchema", () => {
  const target = sampleVersion({ migratesFromSchema: [19, 20] });
  assert.equal(target.migratesFromSchema.includes(20), true);
  assert.equal(target.migratesFromSchema.includes(17), false);
  // The current build accepts its own schema.
  assert.equal(canMigrateFromSchema(VERSION_MANIFEST, VERSION_MANIFEST.schemaVersion), true);
});

test("schema and wire protocol manifests stay aligned with current compatibility", () => {
  assert.equal(CURRENT_SCHEMA_VERSION, 29);
  assert.equal(VERSION_MANIFEST.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(VERSION_MANIFEST.migratesFromSchema, [23, 24, 25, 26, 27, 28, 29]);
  assert.equal(CURRENT_PROTOCOL_VERSION, 10);
  assert.equal(VERSION_MANIFEST.protocolVersion, CURRENT_PROTOCOL_VERSION);
  assert.deepEqual(SUPPORTED_SERVER_PROTOCOL_VERSIONS, [5, 6, 7, 8, 9, 10]);
  assert.equal(CURRENT_RUNTIME_API_VERSION, 1);
});

test("static version manifest matches executable constants without importing a server entry", async () => {
  const manifest = await readStaticVersionManifest(process.cwd());
  assert.equal(manifest.protocolVersion, CURRENT_PROTOCOL_VERSION);
  assert.equal(manifest.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.deepEqual(manifest.migratesFromSchema, VERSION_MANIFEST.migratesFromSchema);
  assert.equal(manifest.runtimeApiVersion, CURRENT_RUNTIME_API_VERSION);
});
