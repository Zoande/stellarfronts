import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDiplomacyState } from "../../src/data/Diplomacy";
import { createEmptyResourceCounts } from "../../src/data/Economy";
import {
  createInitialMarketState,
  MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS,
} from "../../src/data/Market";
import {
  GAME_HOURS_PER_MONTH,
  gameYearToElapsedHours,
  gameYearToMonthIndex,
} from "../../src/game/GameTime";
import { processEconomyHours, processMarketTicks } from "../game/economy-tick";
import type { GameState, RuntimeContext } from "../game/types";

function tickContext(): RuntimeContext {
  const year = 2200;
  const hour = gameYearToElapsedHours(year);
  const empty = createEmptyResourceCounts();
  const state = {
    clock: { year },
    factions: [{ id: 0, name: "Faction", color: [1, 1, 1], homeStarId: 0 }],
    diplomacy: createInitialDiplomacyState([0]),
    market: createInitialMarketState([0], hour),
    factionEconomies: [{
      factionId: 0,
      stockpiles: createEmptyResourceCounts(),
      monthlyDelta: createEmptyResourceCounts(),
      marketMonthlyDelta: createEmptyResourceCounts(),
      lastProcessedMonth: gameYearToMonthIndex(year),
      lastProcessedHour: hour,
    }],
    factionTechnologies: [],
    governments: [],
    leaders: [],
    planetStates: [{
      id: "planet",
      ownerId: 0,
      isHabited: true,
      modifiers: [{
        id: "expired",
        label: "Expired",
        source: "test",
        target: "stability",
        operation: "add",
        value: 1,
        expiresAtYear: year,
      }],
      economy: {
        production: { ...empty, food: 120 },
        upkeep: { ...empty, energy: 30 },
        net: { ...empty, food: 120, energy: -30 },
      },
    }],
    stars: [],
    starbases: [],
    ships: [],
    fleets: [],
    shipDesigns: [],
    recentCombatContacts: [],
  } as unknown as GameState;
  return {
    state,
    hasDirtyState: false,
    recalculatePlanetEconomies: () => undefined,
    refreshFactionEconomyDeltas: () => undefined,
    queuePlanetDetailRefresh: () => undefined,
  } as unknown as RuntimeContext;
}

test("economy hours accrue resources, clamp deficits, expire modifiers, and advance cursors", () => {
  const ctx = tickContext();
  const economy = ctx.state.factionEconomies[0]!;
  const queued: string[] = [];
  ctx.queuePlanetDetailRefresh = (id) => { queued.push(id); };
  const targetHour = economy.lastProcessedHour! + GAME_HOURS_PER_MONTH;

  assert.deepEqual(processEconomyHours(ctx, targetHour), {
    economyChanged: true,
    technologiesChanged: false,
  });
  assert.equal(economy.stockpiles.food, 120);
  assert.equal(economy.stockpiles.energy, 0);
  assert.equal(economy.stockpiles.research, 0);
  assert.equal(economy.lastProcessedHour, targetHour);
  assert.deepEqual(ctx.state.planetStates[0]?.modifiers, []);
  assert.deepEqual(queued, ["planet"]);
  assert.equal(ctx.hasDirtyState, true);
});

test("economy processing is idempotent when no game hours elapsed", () => {
  const ctx = tickContext();
  const targetHour = ctx.state.factionEconomies[0]!.lastProcessedHour!;
  ctx.state.planetStates[0]!.modifiers = [];
  assert.deepEqual(processEconomyHours(ctx, targetHour), {
    economyChanged: false,
    technologiesChanged: false,
  });
  assert.equal(ctx.hasDirtyState, false);
});

test("market ticks prune stale volume, create snapshots, and become idempotent", () => {
  const ctx = tickContext();
  const currentHour = gameYearToElapsedHours(ctx.state.clock.year);
  ctx.state.market.lastProcessedHour = currentHour - MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS;
  ctx.state.market.lastSnapshotHour = currentHour - MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS;
  ctx.state.market.tradeBuckets.push({
    playerId: 0,
    resourceId: "food",
    monthIndex: gameYearToMonthIndex(ctx.state.clock.year) - 6,
    purchases: 10,
    sales: 0,
  });

  assert.deepEqual(processMarketTicks(ctx, currentHour), {
    marketChanged: true,
    economyChanged: false,
  });
  assert.deepEqual(ctx.state.market.tradeBuckets, []);
  assert.ok(ctx.state.market.priceSnapshots.length > 0);
  assert.equal(ctx.state.market.lastProcessedHour, currentHour);
  assert.equal(ctx.state.market.lastSnapshotHour, currentHour);
  assert.equal(ctx.hasDirtyState, true);

  ctx.hasDirtyState = false;
  assert.deepEqual(processMarketTicks(ctx, currentHour), {
    marketChanged: false,
    economyChanged: false,
  });
  assert.equal(ctx.hasDirtyState, false);
});
