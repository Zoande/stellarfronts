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
import type { ResourceCounts, ResourceKind } from "../../src/data/Economy";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import {
  MARKET_FEE_RATE,
  MARKET_TRANSACTION_LIMIT,
  MARKET_MANUAL_PRESSURE_FACTOR,
  MARKET_AUTO_PRESSURE_FACTOR,
  PLAYER_INTERNAL_MODIFIER_MIN,
  PLAYER_INTERNAL_MODIFIER_MAX,
  calculateMarketPressureDelta,
  recomputeMarketResourcePrice,
  trimMarketPriceSnapshots,
} from "../../src/data/Market";
import type {
  MarketPlayerStats,
  MarketPriceSnapshot,
  MarketResourceState,
  MarketTradeType,
} from "../../src/data/Market";
import {
  TREATY_ARTICLE_DEFINITIONS,
  TRADE_PRIVILEGE_ARTICLE_ID,
  getActiveTreatyPartnersForArticle,
} from "../../src/data/Diplomacy";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import { GAME_HOURS_PER_MONTH } from "../../src/game/GameTime";
import type { MarketResourceQuote } from "../../src/game/GameProtocol";
import { clamp, scaleResourceCounts } from "./pure-helpers";
import {
  getFleetLeaderEffects,
  getGovernmentFleetEffects,
  getPlanetDistrictLimitsFromState,
  getPlanetTechnologyModifiers,
  getPlanetSpeciesContext,
} from "./state-queries";
import { resolveShipDesign } from "./ship-designs";
import type { GameState, RuntimeContext } from "./types";

export interface FactionResourceFlow {
  production: ResourceCounts;
  consumption: ResourceCounts;
}

export interface PlayerMarketQuote {
  finalQuotePrice: number;
  buyPrice: number;
  sellPrice: number;
  productionPerHour: number;
  consumptionPerHour: number;
  internalSupply: number;
  internalDemand: number;
  playerInternalModifier: number;
  ownedAmount: number;
}

// ---------------------------------------------------------------------------
// Faction resource flow + monthly deltas
// ---------------------------------------------------------------------------

export function calculateFactionResourceFlow(nextState: GameState, factionId: number): FactionResourceFlow {
  const production = createEmptyResourceCounts();
  const consumption = createEmptyResourceCounts();

  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
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

  return { production, consumption };
}

export function calculateFactionMonthlyDelta(nextState: GameState, factionId: number): ResourceCounts {
  let delta = createEmptyResourceCounts();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    delta = addResourceCounts(delta, planetState.economy.net);
  }
  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId || starbase.status !== "online") continue;
    delta = addResourceCounts(delta, starbase.economy.net);
  }
  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId || ship.hull <= 0) continue;
    const design = resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, nextState.clock.year);
    const fleet = nextState.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const upkeepMultiplier = fleet
      ? getFleetLeaderEffects(nextState, fleet.id).upkeepMultiplier
        * getGovernmentFleetEffects(nextState, fleet.ownerId).upkeepMultiplier
      : getGovernmentFleetEffects(nextState, ship.ownerId).upkeepMultiplier;
    delta = addResourceCounts(delta, scaleResourceCounts(calculateShipDesignStats(design).upkeep, -upkeepMultiplier));
  }
  return delta;
}

export function calculateFactionMarketMonthlyDelta(nextState: GameState, factionId: number): ResourceCounts {
  const delta = createEmptyResourceCounts();
  const flows = calculateFactionResourceFlow(nextState, factionId);
  const orders = nextState.market?.autoTrades ?? [];
  for (const order of orders) {
    if (!order.enabled || order.playerId !== factionId || order.amountPerHour <= 0) continue;
    const resource = nextState.market.resources.find((candidate) => candidate.resourceId === order.resourceId);
    if (!resource?.marketEnabled) continue;
    const quote = calculatePlayerMarketQuote(resource, factionId, flows, nextState);
    const amountPerMonth = order.amountPerHour * GAME_HOURS_PER_MONTH;
    if (order.type === "auto_buy") {
      delta[order.resourceId] += amountPerMonth;
      delta.energy -= amountPerMonth * quote.buyPrice;
    } else {
      delta[order.resourceId] -= amountPerMonth;
      delta.energy += amountPerMonth * quote.sellPrice;
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
  resource: MarketResourceState,
  factionId: number | null,
  flows: FactionResourceFlow | undefined,
  nextState: GameState,
): PlayerMarketQuote {
  const economy = factionId === null
    ? null
    : nextState.factionEconomies.find((candidate) => candidate.factionId === factionId) ?? null;
  const productionPerHour = factionId === null || !flows
    ? 0
    : Math.max(0, flows.production[resource.resourceId]) / GAME_HOURS_PER_MONTH;
  const consumptionPerHour = factionId === null || !flows
    ? 0
    : Math.max(0, flows.consumption[resource.resourceId]) / GAME_HOURS_PER_MONTH;
  let effectiveProductionPerHour = productionPerHour;
  let effectiveConsumptionPerHour = consumptionPerHour;

  if (factionId !== null) {
    const tradePrivilege = TREATY_ARTICLE_DEFINITIONS.find((article) => article.id === TRADE_PRIVILEGE_ARTICLE_ID);
    const shareFraction = tradePrivilege?.effects.find((effect) => effect.type === "marketSharedSupply")?.shareFraction ?? 0;
    if (shareFraction > 0) {
      for (const partnerId of getActiveTreatyPartnersForArticle(nextState.diplomacy, factionId, TRADE_PRIVILEGE_ARTICLE_ID)) {
        const partnerFlows = calculateFactionResourceFlow(nextState, partnerId);
        effectiveProductionPerHour += (Math.max(0, partnerFlows.production[resource.resourceId]) / GAME_HOURS_PER_MONTH) * shareFraction;
        effectiveConsumptionPerHour += (Math.max(0, partnerFlows.consumption[resource.resourceId]) / GAME_HOURS_PER_MONTH) * shareFraction;
      }
    }
  }

  const internalSupply = effectiveProductionPerHour;
  let internalDemand = effectiveConsumptionPerHour * 0.85;

  if (effectiveConsumptionPerHour > effectiveProductionPerHour) {
    const deficitRatio = clamp(
      (effectiveConsumptionPerHour - effectiveProductionPerHour) / Math.max(effectiveConsumptionPerHour, 1),
      0,
      1,
    );
    internalDemand *= 1 - (0.12 * deficitRatio);
  }

  const ratio = (internalDemand + 10) / (internalSupply + 10);
  const playerInternalModifier = factionId === null
    ? 1
    : clamp(
      Math.pow(ratio, 0.18),
      PLAYER_INTERNAL_MODIFIER_MIN,
      PLAYER_INTERNAL_MODIFIER_MAX,
    );
  const finalQuotePrice = resource.currentPrice * playerInternalModifier;

  return {
    finalQuotePrice,
    buyPrice: finalQuotePrice * (1 + MARKET_FEE_RATE),
    sellPrice: finalQuotePrice * (1 - MARKET_FEE_RATE),
    productionPerHour,
    consumptionPerHour,
    internalSupply,
    internalDemand,
    playerInternalModifier,
    ownedAmount: economy?.stockpiles[resource.resourceId] ?? 0,
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

export function getMarketResourceState(ctx: RuntimeContext, resourceId: ResourceKind): MarketResourceState | null {
  return ctx.state.market.resources.find((resource) => resource.resourceId === resourceId) ?? null;
}

export function getMarketPriceHistory(ctx: RuntimeContext, resourceId: ResourceKind): MarketPriceSnapshot[] {
  return ctx.state.market.priceSnapshots
    .filter((snapshot) => snapshot.resourceId === resourceId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function getMarketTrend(ctx: RuntimeContext, resourceId: ResourceKind, currentPrice: number): MarketResourceQuote["trend"] {
  const history = getMarketPriceHistory(ctx, resourceId);
  const previous = history.length >= 2 ? history[history.length - 2]?.price : history[0]?.price;
  if (!Number.isFinite(previous) || !previous) return "flat";
  const change = (currentPrice - previous) / Math.max(0.000001, previous);
  if (change > 0.005) return "up";
  if (change < -0.005) return "down";
  return "flat";
}

export function appendMarketPriceSnapshot(ctx: RuntimeContext, resource: MarketResourceState, timestamp = ctx.state.clock.year): void {
  ctx.state.market.priceSnapshots.push({
    resourceId: resource.resourceId,
    price: resource.currentPrice,
    temporaryPressure: resource.temporaryPressure,
    persistentPressure: resource.persistentPressure,
    timestamp,
  });
  ctx.state.market.priceSnapshots = trimMarketPriceSnapshots(ctx.state.market.priceSnapshots);
}

export function recordMarketTransaction(
  ctx: RuntimeContext,
  playerId: number,
  resourceId: ResourceKind,
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

export function applyMarketTradePressure(ctx: RuntimeContext, resource: MarketResourceState, type: MarketTradeType, amount: number): void {
  const direction = type === "buy" || type === "auto_buy" ? 1 : -1;
  const factor = type === "buy" || type === "sell"
    ? MARKET_MANUAL_PRESSURE_FACTOR
    : MARKET_AUTO_PRESSURE_FACTOR;
  const pressure = direction * calculateMarketPressureDelta(amount, resource.liquidity, factor);

  if (type === "buy" || type === "sell") {
    resource.temporaryPressure += pressure;
  } else {
    resource.persistentPressure += pressure;
  }

  Object.assign(resource, recomputeMarketResourcePrice(resource, ctx.state.clock.year));
  appendMarketPriceSnapshot(ctx, resource, ctx.state.clock.year);
}
