import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { loadState } from "../game/state-bootstrap";
import { GameStateLoadError, migrateGameStateEnvelope } from "../game/state-migrations";
import { acquireOwnership, releaseOwnership } from "../game/persistence";
import type { RuntimeContext } from "../game/types";
import { getGameStateDirectory } from "../game-state-path";
import { adaptSnapshot, adaptUpdate, decodeServerEvent, reduceSnapshot } from "../../src/game/ProtocolAdapter";
import type { GameSnapshot } from "../../src/game/GameProtocol";
import { attachGatewayProxy } from "../ws-gateway";
import { createServer } from "node:net";
import { createGameBackup, listGameBackups, restoreGameBackup, verifyGameBackup } from "../game-backups";
import { getGameStatePath } from "../game-state-path";

function minimalContext(statePath: string, gameId = "healthtest"): RuntimeContext {
  return {
    game: {
      id: gameId,
      name: "Health Test",
      seed: 1,
      countryCapacity: 1,
      createdAt: Date.now(),
      versionId: "dev",
      status: "active",
      schemaVersion: 27,
      protocolVersion: 7,
    },
    statePath,
    state: {} as RuntimeContext["state"],
    clients: new Set(),
    pendingPlanetDetailRefreshes: new Set(),
    hasDirtyState: false,
    lastSaveAt: 0,
    saveInFlight: null,
    saveQueued: false,
    ownershipToken: null,
  } as unknown as RuntimeContext;
}

test("corrupt saves are preserved and reported instead of replaced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stellarfronts-corrupt-"));
  try {
    const statePath = path.join(directory, "game-state.json");
    const corrupt = '{"schemaVersion":27,"stars":[';
    await writeFile(statePath, corrupt, "utf8");
    await assert.rejects(loadState(minimalContext(statePath)), GameStateLoadError);
    assert.equal(await readFile(statePath, "utf8"), corrupt);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("state envelope migrations are explicit and reject unsupported schemas", () => {
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
});

test("ownership is exclusive even inside the same version process", async () => {
  const gameId = `lock${Date.now().toString(36)}`;
  const directory = getGameStateDirectory(gameId);
  const first = minimalContext(path.join(directory, "game-state.json"), gameId);
  const second = minimalContext(path.join(directory, "game-state.json"), gameId);
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

test("concurrent stale-lock reclamation still produces one owner", async () => {
  const gameId = `stale${Date.now().toString(36)}`;
  const directory = getGameStateDirectory(gameId);
  const first = minimalContext(path.join(directory, "game-state.json"), gameId);
  const second = minimalContext(path.join(directory, "game-state.json"), gameId);
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, ".owner"), JSON.stringify({
      versionId: "dead",
      pid: 2_000_000_000,
      token: "stale-token",
      startedAt: 1,
    }), "utf8");
    const contenders = [first, second];
    const results = await Promise.allSettled(contenders.map(acquireOwnership));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const winner = contenders.find((context) => context.ownershipToken !== null);
    assert.ok(winner);
    await releaseOwnership(winner);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("verified backups carry version metadata and restore exact state", async () => {
  const gameId = `backup${Date.now().toString(36)}`;
  const directory = getGameStateDirectory(gameId);
  const statePath = getGameStatePath(gameId);
  const game = minimalContext(statePath, gameId).game;
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(statePath, JSON.stringify({
      schemaVersion: 27,
      protocolVersion: 7,
      codeVersion: "dev",
      marker: "before",
    }), "utf8");
    const backup = await createGameBackup(game, "test");
    assert.ok(backup);
    assert.equal(backup.sourceVersionId, "dev");
    await verifyGameBackup(gameId, backup.id);
    await writeFile(statePath, JSON.stringify({ schemaVersion: 27, marker: "after" }), "utf8");
    await restoreGameBackup(gameId, backup.id);
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).marker, "before");
    assert.equal((await listGameBackups(gameId)).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function protocolSnapshot(protocolVersion: number): Record<string, unknown> {
  return {
    type: "snapshot",
    protocolVersion,
    perspective: { mode: "observer" },
    clock: { year: 2200 },
    stars: [],
    planetStates: [],
    factions: [],
    hyperlanes: [],
  };
}

test("protocol adapters normalize v5-v7 snapshots into one canonical model", () => {
  for (const protocol of [5, 6, 7]) {
    const snapshot = adaptSnapshot(protocolSnapshot(protocol));
    assert.equal(snapshot.protocolVersion, protocol);
    assert.deepEqual(snapshot.intelligence, { entities: [], lanes: [] });
    assert.deepEqual(snapshot.tradeAlerts, []);
    assert.deepEqual(snapshot.diplomacy, {
      playerFactionId: null,
      openBorderFactionIds: [],
      warFactionIds: [],
    });
  }
  assert.throws(() => adaptSnapshot(protocolSnapshot(4)), /Unsupported/);
  assert.throws(() => decodeServerEvent({ type: "mystery" }), /Unknown/);
});

test("snapshot reducer preserves omitted fields and respects explicit nulls", () => {
  const snapshot = adaptSnapshot(protocolSnapshot(7));
  snapshot.visibleStarIds = [1, 2];
  const update = adaptUpdate({
    type: "update",
    perspective: { mode: "observer" },
    changed: ["visibility"],
    visibleStarIds: null,
  }, 7);
  const reduced = reduceSnapshot(snapshot, update);
  assert.equal(reduced.visibleStarIds, null);
  assert.equal(reduced.stars, snapshot.stars);
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

test("gateway preserves queued messages across a cold-start retry", async () => {
  const upstreamPort = await freePort();
  const gateway = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  const proxy = attachGatewayProxy(gateway, {
    resolveTarget: () => ({ port: upstreamPort, available: true }),
    retryMs: 30,
    maxAttempts: 10,
  });
  await new Promise<void>((resolve) => gateway.once("listening", resolve));
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === "object");

  const client = new WebSocket(`ws://127.0.0.1:${gatewayAddress.port}/?gameId=test`);
  await new Promise<void>((resolve) => client.once("open", resolve));
  client.send("queued-before-upstream");
  await new Promise((resolve) => setTimeout(resolve, 80));

  const upstream = new WebSocketServer({ port: upstreamPort, host: "127.0.0.1" });
  upstream.on("connection", (socket) => socket.on("message", (message) => socket.send(message)));
  const echoed = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("gateway retry timed out")), 2_000);
    client.once("message", (message) => {
      clearTimeout(timer);
      resolve(String(message));
    });
  });
  assert.equal(echoed, "queued-before-upstream");
  await new Promise<void>((resolve) => {
    client.once("close", resolve);
    client.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(proxy.metrics.activeConnections, 0);
  assert.equal(proxy.metrics.connectingConnections, 0);
  assert.equal(proxy.metrics.queuedBytes, 0);
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});
