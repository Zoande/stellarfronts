// =============================================================================
// Per-tick economy / market / construction processing — extracted from server/index.ts
//
// The advanceState pipeline calls into these each tick: stockpile accrual and
// research, market price decay + auto-trades, ship/starbase shortage effects,
// planet & starbase construction, repairs, and starbase ship queues. All read
// and mutate RuntimeContext; the orchestrating advanceState stays in index.ts.
// =============================================================================

import {
  RESOURCE_KINDS,
  createEmptyResourceCounts,
  addResourceCounts,
  progressPlanetConstructionQueue,
} from "../../src/data/Economy";
import type { PlanetState } from "../../src/data/Economy";
import {
  MARKET_FEE_RATE,
  MARKET_TEMPORARY_DECAY_PER_HOUR,
  MARKET_PERSISTENT_DECAY_PER_HOUR,
  MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS,
  recomputeMarketResourcePrice,
} from "../../src/data/Market";
import type { MarketAutoTradeOrder } from "../../src/data/Market";
import {
  progressStarbaseConstructionQueue,
  progressStarbaseShipQueue,
} from "../../src/data/Starbase";
import type { StarbaseShipKind, StarbaseShipQueueItem } from "../../src/data/Starbase";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import { getSystemStarbaseOrbitPosition } from "../../src/data/SystemCoordinates";
import { GAME_HOURS_PER_MONTH, gameYearToMonthIndex, elapsedHoursToGameYear } from "../../src/game/GameTime";
import type { ServerStarbase } from "../../src/game/GameProtocol";
import {
  STARBASE_REPAIR_ENERGY_COST_PER_POINT,
  STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY,
  STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT,
  STARBASE_HULL_REPAIR_FRACTION_PER_DAY,
  STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT,
} from "./constants";
import { roundTinyPressure, scaleResourceCounts } from "./pure-helpers";
import {
  getFactionEconomy,
  getFleetShieldMultiplier,
  getFactionFleetShortageEffects,
  getPlanetDistrictLimitsFromState,
  getPlanetTechnologyModifiers,
  getPlanetSpeciesContext,
  getFactionStarbaseShipBuildSpeedMultiplier,
} from "./state-queries";
import {
  calculateFactionMonthlyDelta,
  calculateFactionResourceFlow,
  calculatePlayerMarketQuote,
  getMarketResourceState,
  getMarketPlayerStats,
  recordMarketTransaction,
  applyMarketTradePressure,
  appendMarketPriceSnapshot,
} from "./economy-market";
import { getFactionResearchPerHour, applyTechnologyResearchForFaction } from "./research";
import { findShipDesignById } from "./ship-designs";
import { createShip, createFleet, applyShipDesignToShip, syncStarbaseCombatHealth } from "./fleet-factory";
import { applyFleetOrbitTarget, createStarbaseOrbitTarget } from "./fleet-combat";
import type { RuntimeContext } from "./types";

function getPlanetDetailSignature(planetState: PlanetState): string {
  return JSON.stringify(planetState);
}

function queueChangedPlanetDetailRefreshes(ctx: RuntimeContext, previousSignatures: Map<string, string>): boolean {
  let changed = false;
  for (const planetState of ctx.state.planetStates) {
    if (previousSignatures.get(planetState.id) === getPlanetDetailSignature(planetState)) continue;
    ctx.queuePlanetDetailRefresh(planetState.id);
    changed = true;
  }
  return changed;
}

export function processEconomyHours(ctx: RuntimeContext, targetHour: number): { economyChanged: boolean; technologiesChanged: boolean } {
  const previousPlanetSignatures = new Map(
    ctx.state.planetStates.map((planetState) => [planetState.id, getPlanetDetailSignature(planetState)]),
  );
  ctx.recalculatePlanetEconomies();
  ctx.refreshFactionEconomyDeltas();
  let economyChanged = false;
  let technologiesChanged = false;
  for (const economy of ctx.state.factionEconomies) {
    const processedHour = economy.lastProcessedHour ?? targetHour;
    const elapsedHours = Math.max(0, targetHour - processedHour);
    if (elapsedHours <= 0) continue;
    const researchPerHour = getFactionResearchPerHour(ctx, economy.factionId);
    technologiesChanged = applyTechnologyResearchForFaction(ctx, economy.factionId, elapsedHours, researchPerHour) || technologiesChanged;
    const resourceGain = scaleResourceCounts(
      calculateFactionMonthlyDelta(ctx.state, economy.factionId),
      elapsedHours / GAME_HOURS_PER_MONTH,
    );
    resourceGain.research = 0;
    economy.stockpiles = addResourceCounts(
      economy.stockpiles,
      resourceGain,
    );
    // Stockpiles never go negative; a sustained deficit instead drives shortage penalties
    // (see computeShortageSeverity) once the buffer is exhausted.
    for (const resource of RESOURCE_KINDS) {
      economy.stockpiles[resource] = Math.max(0, economy.stockpiles[resource]);
    }
    economy.stockpiles.research = 0;
    economy.lastProcessedHour = targetHour;
    economy.lastProcessedMonth = gameYearToMonthIndex(elapsedHoursToGameYear(targetHour));
    economyChanged = true;
  }
  if (technologiesChanged) {
    ctx.recalculatePlanetEconomies();
    ctx.refreshFactionEconomyDeltas();
  }
  const planetDetailsChanged = queueChangedPlanetDetailRefreshes(ctx, previousPlanetSignatures);
  if (economyChanged || technologiesChanged) {
    ctx.hasDirtyState = true;
  }
  if (planetDetailsChanged) ctx.hasDirtyState = true;
  return { economyChanged, technologiesChanged };
}

export function processMarketTicks(ctx: RuntimeContext, targetHour: number): { marketChanged: boolean; economyChanged: boolean } {
  const processedHour = Number.isFinite(ctx.state.market.lastProcessedHour)
    ? ctx.state.market.lastProcessedHour
    : targetHour;
  const elapsedHours = Math.max(0, targetHour - processedHour);
  let marketChanged = false;
  let economyChanged = false;

  if (elapsedHours > 0) {
    const temporaryDecay = Math.pow(MARKET_TEMPORARY_DECAY_PER_HOUR, elapsedHours);
    const persistentDecay = Math.pow(MARKET_PERSISTENT_DECAY_PER_HOUR, elapsedHours);
    ctx.state.market.resources = ctx.state.market.resources.map((resource) => {
      const temporaryPressure = roundTinyPressure(resource.temporaryPressure * temporaryDecay);
      const persistentPressure = roundTinyPressure(resource.persistentPressure * persistentDecay);
      const next = recomputeMarketResourcePrice({
        ...resource,
        temporaryPressure,
        persistentPressure,
      }, ctx.state.clock.year);
      const resourceChanged = (
        next.temporaryPressure !== resource.temporaryPressure
        || next.persistentPressure !== resource.persistentPressure
        || Math.abs(next.currentPrice - resource.currentPrice) > 0.000001
      );
      if (!resourceChanged) return resource;
      marketChanged = true;
      return next;
    });
    for (const order of ctx.state.market.autoTrades) {
      const executed = executeMarketAutoTrade(ctx, order, elapsedHours);
      marketChanged = executed || marketChanged;
      economyChanged = executed || economyChanged;
    }
    ctx.state.market.lastProcessedHour = targetHour;
  }

  const snapshotHour = Number.isFinite(ctx.state.market.lastSnapshotHour)
    ? ctx.state.market.lastSnapshotHour
    : targetHour;
  if (targetHour - snapshotHour >= MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS) {
    for (const resource of ctx.state.market.resources) {
      appendMarketPriceSnapshot(ctx, resource, ctx.state.clock.year);
    }
    ctx.state.market.lastSnapshotHour = targetHour;
    marketChanged = true;
  }

  if (marketChanged || economyChanged) ctx.hasDirtyState = true;
  return { marketChanged, economyChanged };
}

export function executeMarketAutoTrade(ctx: RuntimeContext, order: MarketAutoTradeOrder, elapsedHours: number): boolean {
  if (!order.enabled || order.amountPerHour <= 0 || elapsedHours <= 0) return false;
  const resource = getMarketResourceState(ctx, order.resourceId);
  if (!resource?.marketEnabled) return false;
  const economy = getFactionEconomy(ctx.state, order.playerId);
  if (!economy) return false;

  const requestedAmount = order.amountPerHour * elapsedHours;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return false;

  const flows = calculateFactionResourceFlow(ctx.state, order.playerId);
  const quote = calculatePlayerMarketQuote(resource, order.playerId, flows, ctx.state);
  const stats = getMarketPlayerStats(ctx, order.playerId);
  let amount = requestedAmount;

  if (order.type === "auto_buy") {
    const unitCost = quote.finalQuotePrice * (1 + MARKET_FEE_RATE);
    amount = Math.min(amount, unitCost > 0 ? economy.stockpiles.energy / unitCost : 0);
    if (amount <= 0.000001) return false;
    const grossEnergy = amount * quote.finalQuotePrice;
    const feePaid = grossEnergy * MARKET_FEE_RATE;
    const buyCost = grossEnergy + feePaid;
    economy.stockpiles = {
      ...economy.stockpiles,
      energy: economy.stockpiles.energy - buyCost,
      [order.resourceId]: economy.stockpiles[order.resourceId] + amount,
    };
    stats.totalImportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, order.playerId, order.resourceId, "auto_buy", amount, quote.finalQuotePrice, feePaid, -buyCost);
    applyMarketTradePressure(ctx, resource, "auto_buy", amount);
  } else {
    amount = Math.min(amount, economy.stockpiles[order.resourceId]);
    if (amount <= 0.000001) return false;
    const grossEnergy = amount * quote.finalQuotePrice;
    const feePaid = grossEnergy * MARKET_FEE_RATE;
    const sellPayout = grossEnergy - feePaid;
    economy.stockpiles = {
      ...economy.stockpiles,
      [order.resourceId]: economy.stockpiles[order.resourceId] - amount,
      energy: economy.stockpiles.energy + sellPayout,
    };
    stats.totalExportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, order.playerId, order.resourceId, "auto_sell", amount, quote.finalQuotePrice, feePaid, sellPayout);
    applyMarketTradePressure(ctx, resource, "auto_sell", amount);
  }

  order.updatedAt = ctx.state.clock.year;
  return true;
}

export function processShipShortageEffects(ctx: RuntimeContext): { shipsChanged: boolean; starbasesChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  for (const ship of ctx.state.ships) {
    if (ship.maxShield <= 0 || ship.shield <= 0) continue;
    const fleet = ctx.state.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const shieldCap = ship.maxShield * (fleet ? getFleetShieldMultiplier(ctx.state, fleet) : getFactionFleetShortageEffects(ctx.state, ship.ownerId).shieldMultiplier);
    if (ship.shield <= shieldCap) continue;
    ship.shield = Math.max(0, shieldCap);
    shipsChanged = true;
  }
  for (const starbase of ctx.state.starbases) {
    if (starbase.status !== "online" || starbase.maxShield <= 0 || starbase.shield <= 0) continue;
    const shieldCap = starbase.maxShield * getFactionFleetShortageEffects(ctx.state, starbase.ownerId).shieldMultiplier;
    if (starbase.shield <= shieldCap) continue;
    starbase.shield = Math.max(0, shieldCap);
    starbasesChanged = true;
  }
  if (shipsChanged || starbasesChanged) ctx.hasDirtyState = true;
  return { shipsChanged, starbasesChanged };
}

export function processPlanetConstruction(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planetState) => {
    if (!planetState.isHabited || planetState.constructionQueue.length === 0) return planetState;
    const result = progressPlanetConstructionQueue(
      planetState,
      elapsedDays,
      getPlanetDistrictLimitsFromState(ctx.state, planetState),
      getPlanetTechnologyModifiers(ctx.state, planetState),
      getPlanetSpeciesContext(ctx.state, planetState),
    );
    if (!result.changed) return planetState;
    changed = true;
    ctx.queuePlanetDetailRefresh(planetState.id);
    return result.state;
  });

  if (!changed) return false;
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return true;
}

export function processStarbaseConstruction(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  ctx.state.starbases = ctx.state.starbases.map((starbase) => {
    if (starbase.constructionQueue.length === 0) return starbase;
    const result = progressStarbaseConstructionQueue(starbase, elapsedDays);
    if (!result.changed) return starbase;
    changed = true;
    return syncStarbaseCombatHealth(result.starbase);
  });

  if (!changed) return false;
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return true;
}

function trySpendStarbaseRepairResources(ctx: RuntimeContext, ownerId: number, repairPoints: number, alloyCostPerPoint: number): boolean {
  const economy = getFactionEconomy(ctx.state, ownerId);
  if (!economy || repairPoints <= 0) return false;
  const alloys = repairPoints * alloyCostPerPoint;
  const energy = repairPoints * STARBASE_REPAIR_ENERGY_COST_PER_POINT;
  if (economy.stockpiles.alloys < alloys || economy.stockpiles.energy < energy) return false;
  economy.stockpiles = addResourceCounts(economy.stockpiles, {
    ...createEmptyResourceCounts(),
    alloys: -alloys,
    energy: -energy,
  });
  return true;
}

export function processStarbaseRepairs(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  ctx.state.starbases = ctx.state.starbases.map((starbase) => {
    if (starbase.status !== "online") return starbase;
    let next = starbase;
    if (next.armor < next.maxArmor) {
      const repair = Math.min(next.maxArmor - next.armor, next.maxArmor * STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(ctx, next.ownerId, repair, STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT)) {
        next = { ...next, armor: next.armor + repair };
        changed = true;
      }
    }
    if (next.hull < next.maxHull) {
      const repair = Math.min(next.maxHull - next.hull, next.maxHull * STARBASE_HULL_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(ctx, next.ownerId, repair, STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT)) {
        next = { ...next, hull: next.hull + repair };
        changed = true;
      }
    }
    return next;
  });
  if (changed) {
    ctx.refreshFactionEconomyDeltas();
    ctx.hasDirtyState = true;
  }
  return changed;
}

function spawnCompletedShip(ctx: RuntimeContext, starbase: ServerStarbase, item: { shipKind: StarbaseShipKind; designId?: string | null }): void {
  const fleetId = ctx.createRuntimeId("fleet", [starbase.ownerId, starbase.starId]);
  const ship = createShip(
    ctx,
    starbase.ownerId,
    fleetId,
    item.shipKind,
    ctx.createRuntimeId("ship", [starbase.ownerId, item.shipKind]),
    item.designId,
  );
  const fleet = createFleet(ctx, starbase.ownerId, starbase.starId, [ship.id], fleetId);
  fleet.phaseStartedAtYear = ctx.state.clock.year;
  fleet.speed = ship.speed;
  fleet.systemPosition = getSystemStarbaseOrbitPosition(starbase.systemPosition);
  applyFleetOrbitTarget(fleet, createStarbaseOrbitTarget(starbase, fleet.systemPosition));
  ctx.setFleetPhase(fleet, "orbiting");
  ctx.state.ships.push(ship);
  ctx.state.fleets.push(fleet);
}

function completeQueuedShipUpgrade(ctx: RuntimeContext, item: StarbaseShipQueueItem): boolean {
  if (item.kind !== "upgrade" || !item.shipId) return false;
  const ship = ctx.state.ships.find((candidate) => candidate.id === item.shipId);
  if (!ship) return false;
  const targetDesign = findShipDesignById(
    ctx.state.shipDesigns,
    ship.ownerId,
    ship.shipKind,
    item.targetDesignId ?? item.designId,
    true,
  );
  if (!targetDesign) return false;
  applyShipDesignToShip(ship, targetDesign);
  ctx.syncFleetMembership();
  return true;
}

export function processStarbaseShipQueues(ctx: RuntimeContext, elapsedDays: number): { starbasesChanged: boolean; fleetsChanged: boolean } {
  if (elapsedDays <= 0) return { starbasesChanged: false, fleetsChanged: false };
  let starbasesChanged = false;
  let fleetsChanged = false;
  ctx.state.starbases = ctx.state.starbases.map((starbase) => {
    if (starbase.shipQueue.length === 0) return starbase;
    const speed = getFactionStarbaseShipBuildSpeedMultiplier(ctx.state, starbase.ownerId);
    const economy = getFactionEconomy(ctx.state, starbase.ownerId);
    const result = progressStarbaseShipQueue(starbase, elapsedDays * speed, economy?.stockpiles);
    if (!result.changed) return starbase;

    if (economy) {
      economy.stockpiles = addResourceCounts(economy.stockpiles, scaleResourceCounts(result.resourcesConsumed, -1));
    }
    for (const completed of result.completed) {
      if (completed.kind === "upgrade") {
        fleetsChanged = completeQueuedShipUpgrade(ctx, completed) || fleetsChanged;
      } else {
        spawnCompletedShip(ctx, starbase, completed);
        fleetsChanged = true;
      }
    }
    starbasesChanged = true;
    return result.starbase;
  });

  if (!starbasesChanged && !fleetsChanged) return { starbasesChanged: false, fleetsChanged: false };
  if (fleetsChanged) {
    ctx.refreshDiscovery();
  }
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return { starbasesChanged, fleetsChanged };
}
