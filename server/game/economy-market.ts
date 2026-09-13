// =============================================================================
// Faction economy + galactic market core — extracted from server/index.ts
//
// Two cohesive concerns live here:
//   1. Faction resource flow / monthly delta calculations (production, upkeep,
//      ship maintenance, auto-trade income) — pure over a GameState.
//   2. Market state queries and mutations (player stats, price history, quotes,
//      transactions, trade pressure) — these read/write RuntimeContext.
//
// calculatePlayerMarketQuote takes the state explicitly (nextState) rather than
// reaching for ctx, so it composes inside the pure delta calculations.
// =============================================================================

import {
  RESOURCE_KINDS,
  createEmptyResourceCounts,
  addResourceCounts,
  recalculatePlanetStateEconomy,
} from "../../src/data/Economy";
import type { ResourceCounts } from "../../src/data/Economy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import {
  MARKET_RESOURCE_KINDS,
  MARKET_FEE_RATE,
  MARKET_TRANSACTION_LIMIT,
  MARKET_TRADE_WINDOW_MONTHS,
  calculateBulkMarketQuote,
  calculateMarketPricingState,
  trimMarketPriceSnapshots,
} from "../../src/data/Market";
import type {
  MarketBulkQuote,
  MarketPlayerStats,
  MarketPricingState,
  MarketPriceSnapshot,
  MarketResourceKind,
  MarketTradeType,
} from "../../src/data/Market";
import {
  TRADE_PRIVILEGE_ARTICLE_ID,
  getActiveTreatyPartnersForArticle,
} from "../../src/data/Diplomacy";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import { ARMY_TYPE_DEFINITIONS } from "../../src/data/Armies";
import { GAME_HOURS_PER_MONTH, gameYearToMonthIndex } from "../../src/game/GameTime";
import type { MarketResourceQuote } from "../../src/game/GameProtocol";
import { scaleResourceCounts } from "./pure-helpers";
import {
  getFleetLeaderEffects,
  getGovernmentFleetEffects,
  getPlanetDistrictLimitsFromState,
  getPlanetTechnologyModifiers,
  getPlanetSpeciesContext,
  getGroundLeaderEffects,
} from "./state-queries";
import { resolveShipDesign } from "./ship-designs";
import type { GameState, RuntimeContext } from "./types";

export interface FactionResourceFlow {
  production: ResourceCounts;
  consumption: ResourceCounts;
}

export interface PlayerMarketQuote {
  resourceId: MarketResourceKind;
  marketMemberIds: number[];
  finalQuotePrice: number;
  buyPrice: number;
  sellPrice: number;
  pricing: MarketPricingState;
  ownedAmount: number;
}

function getArmyUpkeepMultiplier(state: GameState, armyId: string): number {
  const army = state.armies.find((candidate) => candidate.id === armyId);
  if (!army || army.typeId === "garrison") return 1;
  if (army.location.kind === "fleet") return getGroundLeaderEffects(state, "fleet", army.location.fleetId, false).upkeepMultiplier;
  const planetId = army.location.planetId;
  const battle = state.groundBattles.find((candidate) => candidate.planetId === planetId);
  if (battle?.attackerFactionId === army.ownerId) return getGroundLeaderEffects(state, "groundBattle", battle.id, false).upkeepMultiplier;
  return getGroundLeaderEffects(state, "planetMilitary", planetId, true).upkeepMultiplier;
}

// ---------------------------------------------------------------------------
// Faction resource flow + monthly deltas
// ---------------------------------------------------------------------------

export function calculateFactionResourceFlow(nextState: GameState, factionId: number): FactionResourceFlow {
  const production = createEmptyResourceCounts();
  const consumption = createEmptyResourceCounts();

  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if (planetState.ownerId !== factionId) continue;
    for (const resource of RESOURCE_KINDS) {
      production[resource] += Math.max(0, planetState.economy.production[resource]);
      consumption[resource] += Math.max(0, planetState.economy.upkeep[resource]);
    }
  }

  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId || starbase.status !== "online") continue;
    for (const resource of RESOURCE_KINDS) {
      production[resource] += Math.max(0, starbase.economy.production[resource]);
      consumption[resource] += Math.max(0, starbase.economy.upkeep[resource]);
    }
  }

  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId || ship.hull <= 0) continue;
    if (ship.shipKind === "armyShip") continue;
    const design = resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, nextState.clock.year);
    const fleet = nextState.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const upkeepMultiplier = fleet
      ? getFleetLeaderEffects(nextState, fleet.id).upkeepMultiplier
        * getGovernmentFleetEffects(nextState, fleet.ownerId).upkeepMultiplier
      : getGovernmentFleetEffects(nextState, ship.ownerId).upkeepMultiplier;
    const upkeep = scaleResourceCounts(calculateShipDesignStats(design).upkeep, upkeepMultiplier);
    for (const resource of RESOURCE_KINDS) {
      consumption[resource] += Math.max(0, upkeep[resource]);
    }
  }
  for (const army of nextState.armies ?? []) {
    if (army.ownerId !== factionId || army.typeId === "garrison") continue;
    const upkeep = scaleResourceCounts(ARMY_TYPE_DEFINITIONS[army.typeId].upkeep, getArmyUpkeepMultiplier(nextState, army.id));
    for (const resource of RESOURCE_KINDS) consumption[resource] += Math.max(0, upkeep[resource]);
  }

  return { production, consumption };
}

export function calculateFactionMonthlyDelta(nextState: GameState, factionId: number): ResourceCounts {
  let delta = createEmptyResourceCounts();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if (planetState.ownerId !== factionId) continue;
    delta = addResourceCounts(delta, planetState.economy.net);
  }
  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId || starbase.status !== "online") continue;
    delta = addResourceCounts(delta, starbase.economy.net);
  }
  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId || ship.hull <= 0) continue;
    if (ship.shipKind === "armyShip") continue;
    const design = resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, nextState.clock.year);
    const fleet = nextState.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const upkeepMultiplier = fleet
      ? getFleetLeaderEffects(nextState, fleet.id).upkeepMultiplier
        * getGovernmentFleetEffects(nextState, fleet.ownerId).upkeepMultiplier
      : getGovernmentFleetEffects(nextState, ship.ownerId).upkeepMultiplier;
    delta = addResourceCounts(delta, scaleResourceCounts(calculateShipDesignStats(design).upkeep, -upkeepMultiplier));
  }
  for (const army of nextState.armies ?? []) {
    if (army.ownerId !== factionId || army.typeId === "garrison") continue;
    delta = addResourceCounts(delta, scaleResourceCounts(ARMY_TYPE_DEFINITIONS[army.typeId].upkeep, -getArmyUpkeepMultiplier(nextState, army.id)));
  }
  return delta;
}

export function calculateFactionMarketMonthlyDelta(nextState: GameState, factionId: number): ResourceCounts {
  const delta = createEmptyResourceCounts();
  const orders = nextState.market?.autoTrades ?? [];
  for (const order of orders) {
    if (!order.enabled || order.playerId !== factionId || order.amountPerHour <= 0) continue;
    const quote = calculatePlayerMarketQuote(order.resourceId, factionId, nextState);
    const hourlyTrade = calculateBulkMarketQuote(
      quote.pricing,
      order.type === "auto_buy" ? "buy" : "sell",
      order.amountPerHour,
    );
    const amountPerMonth = order.amountPerHour * GAME_HOURS_PER_MONTH;
    if (order.type === "auto_buy") {
      delta[order.resourceId] += amountPerMonth;
      delta.energy -= hourlyTrade.totalEnergy * GAME_HOURS_PER_MONTH;
    } else {
      delta[order.resourceId] -= amountPerMonth;
      delta.energy += hourlyTrade.totalEnergy * GAME_HOURS_PER_MONTH;
    }
  }
  return delta;
}

export function refreshFactionEconomyDeltas(nextState: GameState): void {
  for (const economy of nextState.factionEconomies) {
    const baseMonthlyDelta = calculateFactionMonthlyDelta(nextState, economy.factionId);
    const marketMonthlyDelta = calculateFactionMarketMonthlyDelta(nextState, economy.factionId);
    economy.marketMonthlyDelta = marketMonthlyDelta;
    economy.monthlyDelta = addResourceCounts(baseMonthlyDelta, marketMonthlyDelta);
  }
}

export function recalculatePlanetEconomies(nextState: GameState): void {
  nextState.planetStates = nextState.planetStates.map((planetState) => (
    recalculatePlanetStateEconomy(
      planetState,
      getPlanetDistrictLimitsFromState(nextState, planetState),
      getPlanetTechnologyModifiers(nextState, planetState),
      getPlanetSpeciesContext(nextState, planetState),
    )
  ));
  applyPlanetStatesToStars(nextState.stars, nextState.planetStates);
}

// ---------------------------------------------------------------------------
// Market quotes
// ---------------------------------------------------------------------------

export function calculatePlayerMarketQuote(
  resourceId: MarketResourceKind,
  factionId: number,
  nextState: GameState,
): PlayerMarketQuote {
  const economy = nextState.factionEconomies.find((candidate) => candidate.factionId === factionId) ?? null;
  const marketMemberIds = getMarketBlocMemberIds(nextState, factionId);
  let monthlyProduction = 0;
  let monthlyUpkeep = 0;
  for (const memberId of marketMemberIds) {
    const flows = calculateFactionResourceFlow(nextState, memberId);
    monthlyProduction += Math.max(0, flows.production[resourceId]);
    monthlyUpkeep += Math.max(0, flows.consumption[resourceId]);
  }

  const memberSet = new Set(marketMemberIds);
  const currentMonthIndex = gameYearToMonthIndex(nextState.clock.year);
  let tradeBalance = 0;
  for (const bucket of nextState.market.tradeBuckets) {
    if (!memberSet.has(bucket.playerId) || bucket.resourceId !== resourceId) continue;
    if (bucket.monthIndex > currentMonthIndex || currentMonthIndex - bucket.monthIndex >= MARKET_TRADE_WINDOW_MONTHS) continue;
    tradeBalance += Math.max(0, bucket.purchases) - Math.max(0, bucket.sales);
  }
  const pricing = calculateMarketPricingState(resourceId, monthlyProduction, monthlyUpkeep, tradeBalance);

  return {
    resourceId,
    marketMemberIds,
    finalQuotePrice: pricing.currentPrice,
    buyPrice: pricing.currentPrice * (1 + MARKET_FEE_RATE),
    sellPrice: pricing.currentPrice * (1 - MARKET_FEE_RATE),
    pricing,
    ownedAmount: economy?.stockpiles[resourceId] ?? 0,
  };
}

export function getMarketBlocMemberIds(nextState: GameState, factionId: number): number[] {
  const knownFactionIds = new Set(nextState.factions.map((faction) => faction.id));
  if (!knownFactionIds.has(factionId)) return [];
  const visited = new Set<number>([factionId]);
  const queue = [factionId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const partnerId of getActiveTreatyPartnersForArticle(
      nextState.diplomacy,
      current,
      TRADE_PRIVILEGE_ARTICLE_ID,
    )) {
      if (!knownFactionIds.has(partnerId) || visited.has(partnerId)) continue;
      visited.add(partnerId);
      queue.push(partnerId);
    }
  }
  return Array.from(visited).sort((a, b) => a - b);
}

export function calculateTradeQuote(
  nextState: GameState,
  factionId: number,
  resourceId: MarketResourceKind,
  tradeType: "buy" | "sell",
  amount: number,
): { market: PlayerMarketQuote; trade: MarketBulkQuote } {
  const market = calculatePlayerMarketQuote(resourceId, factionId, nextState);
  return {
    market,
    trade: calculateBulkMarketQuote(market.pricing, tradeType, amount),
  };
}

// ---------------------------------------------------------------------------
// Market state queries + mutations
// ---------------------------------------------------------------------------

export function getMarketPlayerStats(ctx: RuntimeContext, factionId: number): MarketPlayerStats {
  let stats = ctx.state.market.playerStats.find((candidate) => candidate.playerId === factionId);
  if (!stats) {
    stats = {
      playerId: factionId,
      totalImportsEnergy: 0,
      totalExportsEnergy: 0,
    };
    ctx.state.market.playerStats.push(stats);
    ctx.hasDirtyState = true;
  }
  return stats;
}

export function getReadonlyMarketPlayerStats(ctx: RuntimeContext, factionId: number | null): MarketPlayerStats | null {
  if (factionId === null) return null;
  return ctx.state.market.playerStats.find((candidate) => candidate.playerId === factionId) ?? {
    playerId: factionId,
    totalImportsEnergy: 0,
    totalExportsEnergy: 0,
  };
}

export function getMarketPriceHistory(
  ctx: RuntimeContext,
  factionId: number,
  resourceId: MarketResourceKind,
): MarketPriceSnapshot[] {
  return ctx.state.market.priceSnapshots
    .filter((snapshot) => snapshot.playerId === factionId && snapshot.resourceId === resourceId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function getMarketTrend(
  ctx: RuntimeContext,
  factionId: number,
  resourceId: MarketResourceKind,
  currentPrice: number,
): MarketResourceQuote["trend"] {
  const history = getMarketPriceHistory(ctx, factionId, resourceId);
  const previous = history.length >= 2 ? history[history.length - 2]?.price : history[0]?.price;
  if (!Number.isFinite(previous) || !previous) return "flat";
  const change = (currentPrice - previous) / Math.max(0.000001, previous);
  if (change > 0.005) return "up";
  if (change < -0.005) return "down";
  return "flat";
}

export function appendMarketPriceSnapshots(ctx: RuntimeContext, timestamp = ctx.state.clock.year): void {
  for (const faction of ctx.state.factions) {
    for (const resourceId of MARKET_RESOURCE_KINDS) {
      const quote = calculatePlayerMarketQuote(resourceId, faction.id, ctx.state);
      ctx.state.market.priceSnapshots.push({
        playerId: faction.id,
        resourceId,
        price: quote.finalQuotePrice,
        timestamp,
      });
    }
  }
  ctx.state.market.priceSnapshots = trimMarketPriceSnapshots(ctx.state.market.priceSnapshots);
}

export function ensureInitialMarketPriceSnapshots(nextState: GameState): boolean {
  let changed = false;
  for (const faction of nextState.factions) {
    for (const resourceId of MARKET_RESOURCE_KINDS) {
      if (nextState.market.priceSnapshots.some((snapshot) => (
        snapshot.playerId === faction.id && snapshot.resourceId === resourceId
      ))) continue;
      const quote = calculatePlayerMarketQuote(resourceId, faction.id, nextState);
      nextState.market.priceSnapshots.push({
        playerId: faction.id,
        resourceId,
        price: quote.finalQuotePrice,
        timestamp: nextState.clock.year,
      });
      changed = true;
    }
  }
  if (changed) {
    nextState.market.priceSnapshots = trimMarketPriceSnapshots(nextState.market.priceSnapshots);
  }
  return changed;
}

export function recordMarketTransaction(
  ctx: RuntimeContext,
  playerId: number,
  resourceId: MarketResourceKind,
  type: MarketTradeType,
  amount: number,
  unitPrice: number,
  feePaid: number,
  totalEnergyDelta: number,
): void {
  ctx.state.market.transactions.push({
    playerId,
    resourceId,
    type,
    amount,
    unitPrice,
    feeRate: MARKET_FEE_RATE,
    feePaid,
    totalEnergyDelta,
    timestamp: ctx.state.clock.year,
  });
  ctx.state.market.transactions = ctx.state.market.transactions.slice(-MARKET_TRANSACTION_LIMIT);
}

export function recordMarketTradeVolume(
  ctx: RuntimeContext,
  playerId: number,
  resourceId: MarketResourceKind,
  tradeType: "buy" | "sell" | "auto_buy" | "auto_sell",
  amount: number,
): void {
  const monthIndex = gameYearToMonthIndex(ctx.state.clock.year);
  let bucket = ctx.state.market.tradeBuckets.find((candidate) => (
    candidate.playerId === playerId
    && candidate.resourceId === resourceId
    && candidate.monthIndex === monthIndex
  ));
  if (!bucket) {
    bucket = { playerId, resourceId, monthIndex, purchases: 0, sales: 0 };
    ctx.state.market.tradeBuckets.push(bucket);
  }
  if (tradeType === "buy" || tradeType === "auto_buy") bucket.purchases += Math.max(0, amount);
  else bucket.sales += Math.max(0, amount);
  ctx.hasDirtyState = true;
}
