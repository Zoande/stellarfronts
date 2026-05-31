import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MARKET_AUTO_PRESSURE_FACTOR,
  MARKET_MANUAL_PRESSURE_FACTOR,
  calculateMarketPressureDelta,
  calculateMarketPrice,
  createInitialMarketState,
  normalizeMarketState,
} from "../src/data/Market";
import { RESOURCE_KINDS } from "../src/data/Economy";

test("market price formula clamps pressure multiplier", () => {
  assert.equal(calculateMarketPrice(10, 0.5, 0.25), 17.5);
  assert.equal(calculateMarketPrice(10, -10, 0), 2.5);
  assert.equal(calculateMarketPrice(10, 10, 0), 40);
});

test("market pressure deltas use square root liquidity scaling", () => {
  assert.equal(calculateMarketPressureDelta(1_600, 1_600, MARKET_MANUAL_PRESSURE_FACTOR), 0.04);
  assert.equal(calculateMarketPressureDelta(1_600, 1_600, MARKET_AUTO_PRESSURE_FACTOR), 0.01);
  assert.ok(calculateMarketPressureDelta(400, 1_600, MARKET_MANUAL_PRESSURE_FACTOR) < 0.04);
});

test("initial market state uses existing resources and disables settlement-only resources", () => {
  const state = createInitialMarketState([1, 2], 100, 2400);
  assert.deepEqual(state.resources.map((resource) => resource.resourceId), RESOURCE_KINDS);
  assert.equal(state.resources.find((resource) => resource.resourceId === "food")?.marketEnabled, true);
  assert.equal(state.resources.find((resource) => resource.resourceId === "energy")?.marketEnabled, false);
  assert.equal(state.resources.find((resource) => resource.resourceId === "research")?.marketEnabled, false);
  assert.deepEqual(state.playerStats.map((stats) => stats.playerId), [1, 2]);
  assert.deepEqual(state.autoTrades, []);
});

test("market normalization recomputes prices and player stats", () => {
  const normalized = normalizeMarketState({
    resources: [{
      resourceId: "food",
      basePrice: 2,
      currentPrice: 999,
      liquidity: 5000,
      temporaryPressure: 0.5,
      persistentPressure: 0.25,
      marketEnabled: true,
      lastUpdatedAt: 1,
    }],
    playerStats: [{ playerId: 7, totalImportsEnergy: 11, totalExportsEnergy: 22 }],
    autoTrades: [],
    transactions: [],
    priceSnapshots: [],
    lastProcessedHour: 1,
    lastSnapshotHour: 1,
  }, [7], 10, 2401);

  assert.equal(normalized.changed, true);
  assert.equal(normalized.state.resources.find((resource) => resource.resourceId === "food")?.currentPrice, 3.5);
  assert.equal(normalized.state.resources.length, RESOURCE_KINDS.length);
  assert.equal(normalized.state.playerStats[0]?.totalImportsEnergy, 11);
  assert.ok(normalized.state.priceSnapshots.length >= RESOURCE_KINDS.length);
});
