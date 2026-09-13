import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { DevGameRuntimeRow, DevGameRuntimeStats } from "../../src/auth/types";
import { AuthStore } from "../auth-store";

function runtimeStats(game: DevGameRuntimeRow, failures: DevGameRuntimeStats["failures"] = []): DevGameRuntimeStats {
  return {
    online: true,
    activeConnections: game.activeConnections,
    activeAccounts: game.activeAccounts,
    serverStartedAt: Date.now(),
    lastHeartbeatAt: Date.now(),
    gameYear: game.gameYear,
    paused: game.paused,
    speedMultiplier: game.speedMultiplier,
    starCount: game.starCount,
    factionCount: game.factionCount,
    fleetCount: game.fleetCount,
    shipCount: game.shipCount,
    starbaseCount: game.starbaseCount,
    planetCount: 0,
    habitedPlanetCount: game.habitedPlanetCount,
    combatContactCount: 0,
    gameCount: 1,
    games: [game],
    processes: [],
    failures,
  };
}

test("player availability covers creating, ready, loading, failed, offline, and stopped games", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-availability-"));
  const store = new AuthStore(path.join(directory, "auth.sqlite"));
  const account = store.getAccountByUsername("color_1");
  assert.ok(account);
  const game = store.createGame("Availability");
  const baseRuntime: DevGameRuntimeRow = {
    id: game.id,
    name: game.name,
    seed: game.seed,
    countryCapacity: game.countryCapacity,
    controlledCountries: 0,
    createdAt: game.createdAt,
    online: true,
    activeConnections: 0,
    activeAccounts: [],
    gameYear: 2200,
    paused: false,
    speedMultiplier: 1,
    starCount: 10,
    factionCount: 1,
    fleetCount: 0,
    shipCount: 0,
    starbaseCount: 0,
    habitedPlanetCount: 1,
    lastHeartbeatAt: Date.now(),
    versionId: "dev",
    health: "healthy",
  };

  const creating = store.getGameSummaryForAccount(game.id, account!);
  assert.equal(creating?.availability, "starting");
  assert.equal(creating?.joinable, false);
  assert.equal(creating ? "versionId" in creating : true, false);
  assert.equal(creating ? "schemaVersion" in creating : true, false);

  store.setGameRuntimeStats(runtimeStats(baseRuntime));
  assert.equal(store.getGameSummaryForAccount(game.id, account!)?.availability, "ready");

  store.setGameRuntimeStats(runtimeStats({ ...baseRuntime, health: "loading" }));
  assert.equal(store.getGameSummaryForAccount(game.id, account!)?.availability, "starting");

  store.setGameRuntimeStats(runtimeStats(baseRuntime, [{
    gameId: game.id,
    gameName: game.name,
    versionId: "dev",
    message: "private stack detail",
    failedAt: Date.now(),
  }]));
  const failed = store.getGameSummaryForAccount(game.id, account!);
  assert.equal(failed?.availability, "unavailable");
  assert.equal(failed ? "error" in failed : true, false);

  const offlineGame = store.createGame("Offline");
  store.recordGameStateVersions(offlineGame.id, 27, 7);
  assert.equal(store.getGameSummaryForAccount(offlineGame.id, account!)?.availability, "unavailable");

  store.setGameStatus(game.id, "stopped");
  assert.equal(store.getGameSummaryForAccount(game.id, account!)?.availability, "stopped");
  assert.throws(() => store.joinGame(account!, game.id, "Unavailable"), /not currently available/);
});
