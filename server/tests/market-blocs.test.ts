import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmptyResourceCounts } from "../../src/data/Economy";
import { createInitialDiplomacyState } from "../../src/data/Diplomacy";
import { createInitialMarketState } from "../../src/data/Market";
import { gameYearToMonthIndex } from "../../src/game/GameTime";
import {
  calculatePlayerMarketQuote,
  getMarketBlocMemberIds,
} from "../game/economy-market";
import { executeMarketAutoTrade } from "../game/economy-tick";
import { createMarketDetailPayload } from "../game/detail-payloads";
import type { GameState } from "../game/types";
import type { RuntimeContext } from "../game/types";

function marketState(): GameState {
  const year = 2400;
  const factions = [0, 1, 2].map((id) => ({
    id,
    name: `Faction ${id}`,
    color: [1, 1, 1] as [number, number, number],
    homeStarId: id,
  }));
  const flows = [
    { food: 1_000, upkeep: 100 },
    { food: 10, upkeep: 100 },
    { food: 100, upkeep: 100 },
  ];
  return {
    factions,
    clock: { year },
    diplomacy: createInitialDiplomacyState(factions.map((faction) => faction.id)),
    market: createInitialMarketState(factions.map((faction) => faction.id)),
    factionEconomies: factions.map((faction) => ({
      factionId: faction.id,
      stockpiles: createEmptyResourceCounts(),
      monthlyDelta: createEmptyResourceCounts(),
      marketMonthlyDelta: createEmptyResourceCounts(),
      lastProcessedMonth: 0,
      lastProcessedHour: 0,
    })),
    planetStates: flows.map((flow, ownerId) => ({
      id: `planet-${ownerId}`,
      isHabited: true,
      ownerId,
      economy: {
        production: { ...createEmptyResourceCounts(), food: flow.food },
        upkeep: { ...createEmptyResourceCounts(), food: flow.upkeep },
        net: createEmptyResourceCounts(),
      },
    })),
    starbases: [],
    ships: [],
    fleets: [],
    shipDesigns: [],
  } as unknown as GameState;
}

function addTradePrivilege(state: GameState, a: number, b: number, id: string): void {
  state.diplomacy.treaties.push({
    id,
    factionIds: [a, b],
    articleIds: ["tradePrivilege"],
    proposedByFactionId: a,
    acceptedByFactionId: b,
    startedAtYear: state.clock.year,
    minimumEndYear: state.clock.year + 10,
  });
}

test("isolated faction trades do not affect another faction's market", () => {
  const state = marketState();
  const before = calculatePlayerMarketQuote("food", 0, state).finalQuotePrice;
  state.market.tradeBuckets.push({
    playerId: 1,
    resourceId: "food",
    monthIndex: gameYearToMonthIndex(state.clock.year),
    purchases: 10_000,
    sales: 0,
  });
  assert.equal(calculatePlayerMarketQuote("food", 0, state).finalQuotePrice, before);
  assert.ok(calculatePlayerMarketQuote("food", 1, state).finalQuotePrice > before);
});

test("trade privilege forms a transitive market bloc with one quote", () => {
  const state = marketState();
  addTradePrivilege(state, 0, 1, "trade-01");
  addTradePrivilege(state, 1, 2, "trade-12");
  state.market.tradeBuckets.push({
    playerId: 2,
    resourceId: "food",
    monthIndex: gameYearToMonthIndex(state.clock.year),
    purchases: 1_000,
    sales: 0,
  });

  assert.deepEqual(getMarketBlocMemberIds(state, 0), [0, 1, 2]);
  const quotes = [0, 1, 2].map((id) => calculatePlayerMarketQuote("food", id, state));
  assert.equal(quotes[0]?.finalQuotePrice, quotes[1]?.finalQuotePrice);
  assert.equal(quotes[1]?.finalQuotePrice, quotes[2]?.finalQuotePrice);
  assert.equal(quotes[0]?.pricing.monthlyProduction, 1_110);
  assert.equal(quotes[0]?.pricing.monthlyUpkeep, 300);
});

test("cancellation and war suspension split blocs without moving faction ledgers", () => {
  const state = marketState();
  addTradePrivilege(state, 0, 1, "trade-01");
  addTradePrivilege(state, 1, 2, "trade-12");
  state.market.tradeBuckets.push({
    playerId: 2,
    resourceId: "food",
    monthIndex: gameYearToMonthIndex(state.clock.year),
    purchases: 1_000,
    sales: 0,
  });

  const treaty12 = state.diplomacy.treaties.find((treaty) => treaty.id === "trade-12");
  if (treaty12) treaty12.cancelledAtYear = state.clock.year;
  assert.deepEqual(getMarketBlocMemberIds(state, 0), [0, 1]);
  assert.deepEqual(getMarketBlocMemberIds(state, 2), [2]);
  assert.equal(state.market.tradeBuckets[0]?.playerId, 2);

  state.diplomacy.wars.push({
    id: "war-01",
    attackerFactionId: 0,
    defenderFactionId: 1,
    startedAtYear: state.clock.year,
    endedAtYear: null,
    preWarOwnership: [],
  });
  assert.deepEqual(getMarketBlocMemberIds(state, 0), [0]);
  assert.deepEqual(getMarketBlocMemberIds(state, 1), [1]);
});

test("automatic buys shrink deterministically to available energy and record actual execution", () => {
  const state = marketState();
  const economy = state.factionEconomies[0]!;
  economy.stockpiles.energy = 100;
  const order = {
    id: "auto-buy-food",
    playerId: 0,
    resourceId: "food" as const,
    type: "auto_buy" as const,
    amountPerHour: 1_000,
    enabled: true,
    createdAt: state.clock.year,
    updatedAt: state.clock.year,
  };
  state.market.autoTrades.push(order);
  const ctx = { state, hasDirtyState: false } as RuntimeContext;

  assert.equal(executeMarketAutoTrade(ctx, order, 1), true);
  const transaction = state.market.transactions[0];
  assert.ok(transaction);
  assert.ok(transaction.amount > 0 && transaction.amount < 1_000);
  assert.ok(economy.stockpiles.energy >= -0.000001);
  assert.ok(economy.stockpiles.energy < 0.001);
  assert.equal(state.market.tradeBuckets[0]?.purchases, transaction.amount);
  assert.equal(state.market.tradeAlerts[0]?.executedPerHour, transaction.amount);
});

test("automatic sales are capped by the actor's stockpile", () => {
  const state = marketState();
  const economy = state.factionEconomies[0]!;
  economy.stockpiles.food = 25;
  const order = {
    id: "auto-sell-food",
    playerId: 0,
    resourceId: "food" as const,
    type: "auto_sell" as const,
    amountPerHour: 100,
    enabled: true,
    createdAt: state.clock.year,
    updatedAt: state.clock.year,
  };
  const ctx = { state, hasDirtyState: false } as RuntimeContext;

  assert.equal(executeMarketAutoTrade(ctx, order, 1), true);
  assert.equal(state.market.transactions[0]?.amount, 25);
  assert.equal(economy.stockpiles.food, 0);
  assert.ok(economy.stockpiles.energy > 0);
  assert.equal(state.market.tradeBuckets[0]?.sales, 25);
});

test("market detail is faction-scoped and observers receive no synthetic global market", () => {
  const state = marketState();
  const ctx = { state, hasDirtyState: false } as RuntimeContext;
  const factionPayload = createMarketDetailPayload(ctx, { mode: "faction", factionId: 0 });
  assert.deepEqual(factionPayload.resources.map((resource) => resource.resourceId), [
    "food",
    "minerals",
    "goods",
    "alloys",
  ]);
  assert.deepEqual(factionPayload.marketMemberIds, [0]);

  const observerPayload = createMarketDetailPayload(ctx, { mode: "observer" });
  assert.deepEqual(observerPayload.resources, []);
  assert.deepEqual(observerPayload.marketMemberIds, []);
});
