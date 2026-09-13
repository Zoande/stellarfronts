import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MARKET_FEE_RATE,
  MARKET_MIN_PRICE_MULTIPLIER,
  MARKET_RESOURCE_DEFINITIONS,
  MARKET_RESOURCE_KINDS,
  MARKET_SEED_LIQUIDITY,
  calculateBulkMarketQuote,
  calculateMarketPricingState,
  createInitialMarketState,
  normalizeMarketState,
  pruneMarketTradeBuckets,
  trimMarketPriceSnapshots,
} from "../../src/data/Market";

test("market exposes only the four physical trade resources", () => {
  assert.deepEqual(MARKET_RESOURCE_KINDS, ["food", "minerals", "goods", "alloys"]);
  assert.deepEqual(MARKET_RESOURCE_DEFINITIONS, {
    food: { basePrice: 1.1 },
    minerals: { basePrice: 1.4 },
    goods: { basePrice: 3.2 },
    alloys: { basePrice: 5.5 },
  });
  assert.equal(MARKET_FEE_RATE, 0.05);
  assert.equal(MARKET_MIN_PRICE_MULTIPLIER, 0.25);
  assert.equal(MARKET_SEED_LIQUIDITY, 10);
});

test("supply-demand pricing has a floor but no ceiling", () => {
  const oversupplied = calculateMarketPricingState("food", 1_000, 0, -10_000);
  assert.equal(oversupplied.currentPrice, 1.1 * 0.25);

  const empty = calculateMarketPricingState("alloys", 0, 0, 0);
  assert.equal(empty.baselineSupply, 10);
  assert.equal(empty.baselineDemand, 10);
  assert.equal(empty.currentPrice, 5.5);

  const starved = calculateMarketPricingState("alloys", 0, 0, 1_000_000);
  assert.ok(starved.currentPrice > MARKET_RESOURCE_DEFINITIONS.alloys.basePrice * 100);
});

test("the same purchase moves a shallow market more than a productive market", () => {
  const deep = calculateMarketPricingState("food", 1_000, 1_000, 0);
  const shallow = calculateMarketPricingState("food", 10, 10, 0);
  const deepTrade = calculateBulkMarketQuote(deep, "buy", 100);
  const shallowTrade = calculateBulkMarketQuote(shallow, "buy", 100);
  assert.ok(deepTrade.priceAfter - deepTrade.priceBefore < 0.02);
  assert.ok(shallowTrade.priceAfter - shallowTrade.priceBefore > 0.5);
});

test("bulk slippage uses endpoint average and round trips lose the two fees", () => {
  const initial = calculateMarketPricingState("goods", 20, 20, 0);
  const buy = calculateBulkMarketQuote(initial, "buy", 100);
  assert.equal(buy.averageUnitPrice, (buy.priceBefore + buy.priceAfter) / 2);
  const afterBuy = calculateMarketPricingState("goods", 20, 20, buy.postTradeBalance);
  const sell = calculateBulkMarketQuote(afterBuy, "sell", 100);
  assert.equal(sell.postTradeBalance, 0);
  assert.ok(buy.totalEnergy > sell.totalEnergy);
});

test("five monthly buckets remain active and the sixth expires", () => {
  const buckets = Array.from({ length: 7 }, (_, index) => ({
    playerId: 1,
    resourceId: "food" as const,
    monthIndex: index + 4,
    purchases: 10,
    sales: 0,
  }));
  assert.deepEqual(
    pruneMarketTradeBuckets(buckets, 10).map((bucket) => bucket.monthIndex),
    [6, 7, 8, 9, 10],
  );
});

test("market normalization preserves eligible player data and drops legacy resources and pressure", () => {
  const raw = {
    resources: [{
      resourceId: "food",
      basePrice: 999,
      temporaryPressure: 20,
      persistentPressure: 20,
    }],
    tradeBuckets: [{
      playerId: 7,
      resourceId: "goods",
      monthIndex: 10,
      purchases: 30,
      sales: 4,
    }],
    playerStats: [{ playerId: 7, totalImportsEnergy: 11, totalExportsEnergy: 22 }],
    autoTrades: [
      { id: "food", playerId: 7, resourceId: "food", type: "auto_buy", amountPerHour: 1, enabled: true, createdAt: 1, updatedAt: 1 },
      { id: "energy", playerId: 7, resourceId: "energy", type: "auto_buy", amountPerHour: 1, enabled: true, createdAt: 1, updatedAt: 1 },
    ],
    transactions: [],
    priceSnapshots: [],
    tradeAlerts: [],
    lastProcessedHour: 7_200,
    lastSnapshotHour: 7_200,
  };
  const normalized = normalizeMarketState(raw as never, [7], 7_200, 2401);
  assert.equal(normalized.changed, true);
  assert.equal("resources" in normalized.state, false);
  assert.equal(normalized.state.tradeBuckets[0]?.purchases, 30);
  assert.deepEqual(normalized.state.autoTrades.map((order) => order.resourceId), ["food"]);
  assert.equal(normalized.state.playerStats[0]?.totalImportsEnergy, 11);
  assert.equal(normalized.state.playerStats[0]?.totalExportsEnergy, 22);
});

test("new market state starts with neutral ledgers for every faction", () => {
  const state = createInitialMarketState([1, 2], 100, 2400);
  assert.deepEqual(state.tradeBuckets, []);
  assert.deepEqual(state.playerStats.map((stats) => stats.playerId), [1, 2]);
  assert.deepEqual(state.autoTrades, []);
  assert.deepEqual(state.priceSnapshots, []);
});

test("price history is retained independently per faction and resource", () => {
  const snapshots = [1, 2].flatMap((playerId) => (
    Array.from({ length: 605 }, (_, timestamp) => ({
      playerId,
      resourceId: "food" as const,
      price: playerId + timestamp / 100,
      timestamp,
    }))
  ));
  const trimmed = trimMarketPriceSnapshots(snapshots);
  assert.equal(trimmed.filter((snapshot) => snapshot.playerId === 1).length, 600);
  assert.equal(trimmed.filter((snapshot) => snapshot.playerId === 2).length, 600);
  assert.equal(trimmed.find((snapshot) => snapshot.playerId === 1)?.timestamp, 5);
});
