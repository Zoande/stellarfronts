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
  getActivePlanetDefenseBuildings,
  normalizePlanetDefenseState,
  countPlanetShipyards,
  recalculatePlanetStateEconomy,
  progressPlanetConstructionQueue,
  removeExpiredPlanetModifiers,
} from "../../src/data/Economy";
import type { PlanetState } from "../../src/data/Economy";
import {
  MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS,
  pruneMarketTradeBuckets,
} from "../../src/data/Market";
import type { MarketAutoTradeOrder } from "../../src/data/Market";
import {
  progressStarbaseConstructionQueue,
  progressStarbaseShipQueue,
  countStarbaseShipyards,
} from "../../src/data/Starbase";
import type { StarbaseShipKind, StarbaseShipQueueItem } from "../../src/data/Starbase";
import { NEBULA_DEFINITIONS, buildNebulaByStarId } from "../../src/data/Nebula";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import { getSystemStarbaseOrbitPosition } from "../../src/data/SystemCoordinates";
import { GAME_HOURS_PER_MONTH, GAME_HOURS_PER_YEAR, gameYearToMonthIndex, elapsedHoursToGameYear } from "../../src/game/GameTime";
import type { ServerStarbase } from "../../src/game/GameProtocol";
import { getActiveTreatiesBetween, getBorderPolicy } from "../../src/data/Diplomacy";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import {
  STARBASE_REPAIR_ENERGY_COST_PER_POINT,
  STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY,
  STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT,
  STARBASE_HULL_REPAIR_FRACTION_PER_DAY,
  STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT,
} from "./constants";
import { scaleResourceCounts } from "./pure-helpers";
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
  calculateTradeQuote,
  getMarketPlayerStats,
  recordMarketTransaction,
  recordMarketTradeVolume,
  appendMarketPriceSnapshots,
} from "./economy-market";
import { getFactionResearchPerHour, applyTechnologyResearchForFaction } from "./research";
import { findShipDesignById, getShipDesignForShip } from "./ship-designs";
import { createShip, createFleet, applyShipDesignToShip, syncStarbaseCombatHealth } from "./fleet-factory";
import { applyFleetOrbitTarget, createStarbaseOrbitTarget, startOrbitOrder } from "./fleet-combat";
import type { GameFleet, GameShip, RuntimeContext } from "./types";

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

export function recruitPlanetCrew(ctx: RuntimeContext, factionId: number, elapsedMonths: number): number {
  if (elapsedMonths <= 0) return 0;
  let recruitedTotal = 0;
  ctx.state.planetStates = ctx.state.planetStates.map((planetState) => {
    if (!planetState.isHabited || planetState.ownerId !== factionId) return planetState;
    if (!planetState.buildings || !planetState.urbanSubDistricts || !planetState.economy?.popGroups) {
      return planetState;
    }
    let next = {
      ...planetState,
      defense: normalizePlanetDefenseState(planetState.defense),
    };
    for (let month = 0; month < elapsedMonths; month += 1) {
      const barracks = getActivePlanetDefenseBuildings(next)
        .filter((building) => building.kind === "barracks").length;
      if (barracks <= 0) break;
      let remainingRecruitment = Math.min(
        barracks * 10_000,
        next.economy.popGroups
          .filter((group) => group.job === "trainee")
          .reduce((total, group) => total + group.population, 0),
      );
      if (remainingRecruitment <= 0) break;
      const traineeGroups = next.economy.popGroups
        .filter((group) => group.job === "trainee" && group.population > 0)
        .sort((left, right) => right.population - left.population || left.speciesId.localeCompare(right.speciesId));
      const removedBySpecies = new Map<string, number>();
      const priorRemainders = new Map(
        next.defense.traineeRemainders.map((entry) => [entry.speciesId, entry.population]),
      );
      const nextRemainders = new Map(priorRemainders);

      // Fractional allocations are permanently stuck in the trainee job and
      // continue training before a new whole-million block begins.
      const continuingRemainders = traineeGroups
        .map((group) => ({
          speciesId: group.speciesId,
          population: Math.min(group.population, priorRemainders.get(group.speciesId) ?? 0),
        }))
        .filter((entry) => entry.population > 0)
        .sort((left, right) => right.population - left.population || left.speciesId.localeCompare(right.speciesId));
      for (const entry of continuingRemainders) {
        if (remainingRecruitment <= 0) break;
        const removed = Math.min(entry.population, remainingRecruitment);
        removedBySpecies.set(entry.speciesId, (removedBySpecies.get(entry.speciesId) ?? 0) + removed);
        const remainder = entry.population - removed;
        if (remainder > 0) nextRemainders.set(entry.speciesId, remainder);
        else nextRemainders.delete(entry.speciesId);
        remainingRecruitment -= removed;
        recruitedTotal += removed;
      }

      for (const group of traineeGroups) {
        if (remainingRecruitment <= 0) break;
        const priorRemainder = priorRemainders.get(group.speciesId) ?? 0;
        const wholeMillionAllocation = Math.floor(
          Math.max(0, group.population - priorRemainder) / 1_000_000,
        ) * 1_000_000;
        const alreadyRemoved = removedBySpecies.get(group.speciesId) ?? 0;
        const removed = Math.min(wholeMillionAllocation, remainingRecruitment);
        if (removed <= 0) continue;
        removedBySpecies.set(group.speciesId, alreadyRemoved + removed);
        const remainder = (wholeMillionAllocation - removed) % 1_000_000;
        if (remainder > 0) nextRemainders.set(group.speciesId, remainder);
        remainingRecruitment -= removed;
        recruitedTotal += removed;
      }
      const speciesPopulations = next.speciesPopulations
        .map((entry) => ({
          ...entry,
          population: Math.max(0, entry.population - (removedBySpecies.get(entry.speciesId) ?? 0)),
        }))
        .filter((entry) => entry.population > 0);
      const traineeRemainders = Array.from(nextRemainders.entries())
        .map(([speciesId, population]) => ({ speciesId, population: Math.max(0, population % 1_000_000) }))
        .filter((entry) => entry.population > 0)
        .sort((left, right) => left.speciesId.localeCompare(right.speciesId));
      next = recalculatePlanetStateEconomy({
        ...next,
        population: speciesPopulations.reduce((total, entry) => total + entry.population, 0),
        speciesPopulations,
        defense: { ...next.defense, traineeRemainders },
        jobLocks: [
          ...next.jobLocks.filter((lock) => lock.job !== "trainee"),
          ...(traineeRemainders.length > 0
            ? [{ job: "trainee" as const, allocations: traineeRemainders.map((entry) => ({ ...entry })) }]
            : []),
        ],
      }, getPlanetDistrictLimitsFromState(ctx.state, next), getPlanetTechnologyModifiers(ctx.state, next), getPlanetSpeciesContext(ctx.state, next));
    }
    return next;
  });
  return recruitedTotal;
}

export function processEconomyHours(ctx: RuntimeContext, targetHour: number): { economyChanged: boolean; technologiesChanged: boolean } {
  const previousPlanetSignatures = new Map(
    ctx.state.planetStates.map((planetState) => [planetState.id, getPlanetDetailSignature(planetState)]),
  );
  let expiredModifiers = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planetState) => {
    const result = removeExpiredPlanetModifiers(planetState, ctx.state.clock.year);
    expiredModifiers = expiredModifiers || result.changed;
    return result.state;
  });
  ctx.recalculatePlanetEconomies();
  ctx.refreshFactionEconomyDeltas();
  let economyChanged = expiredModifiers;
  let technologiesChanged = false;
  for (const economy of ctx.state.factionEconomies) {
    const processedHour = economy.lastProcessedHour ?? targetHour;
    const elapsedHours = Math.max(0, targetHour - processedHour);
    if (elapsedHours <= 0) continue;
    const targetMonth = gameYearToMonthIndex(elapsedHoursToGameYear(targetHour));
    const elapsedMonths = Math.max(0, targetMonth - (economy.lastProcessedMonth ?? targetMonth));
    const recruitedCrew = recruitPlanetCrew(ctx, economy.factionId, elapsedMonths);
    if (recruitedCrew > 0) {
      economy.crewStockpile += recruitedCrew;
      ctx.recalculatePlanetEconomies();
      ctx.refreshFactionEconomyDeltas();
    }
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
    economy.lastProcessedMonth = targetMonth;
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
    const currentMonthIndex = gameYearToMonthIndex(ctx.state.clock.year);
    const retainedBuckets = pruneMarketTradeBuckets(ctx.state.market.tradeBuckets, currentMonthIndex);
    if (retainedBuckets.length !== ctx.state.market.tradeBuckets.length) {
      ctx.state.market.tradeBuckets = retainedBuckets;
      marketChanged = true;
    }
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
    appendMarketPriceSnapshots(ctx, ctx.state.clock.year);
    ctx.state.market.lastSnapshotHour = targetHour;
    marketChanged = true;
  }

  if (marketChanged || economyChanged) ctx.hasDirtyState = true;
  return { marketChanged, economyChanged };
}

export function executeMarketAutoTrade(ctx: RuntimeContext, order: MarketAutoTradeOrder, elapsedHours: number): boolean {
  if (!order.enabled || order.amountPerHour <= 0 || elapsedHours <= 0) return false;
  const economy = getFactionEconomy(ctx.state, order.playerId);
  if (!economy) return false;

  const requestedAmount = order.amountPerHour * elapsedHours;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return false;

  const stats = getMarketPlayerStats(ctx, order.playerId);
  let amount = requestedAmount;

  if (order.type === "auto_buy") {
    amount = findAffordableMarketBuyAmount(ctx, order, requestedAmount, economy.stockpiles.energy);
    if (amount <= 0.000001) {
      recordTradeAlert(ctx, order, elapsedHours, 0);
      return false;
    }
    const quote = calculateTradeQuote(ctx.state, order.playerId, order.resourceId, "buy", amount).trade;
    const grossEnergy = amount * quote.averageUnitPrice;
    const feePaid = quote.feePaid;
    const buyCost = quote.totalEnergy;
    economy.stockpiles = {
      ...economy.stockpiles,
      energy: economy.stockpiles.energy - buyCost,
      [order.resourceId]: economy.stockpiles[order.resourceId] + amount,
    };
    stats.totalImportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, order.playerId, order.resourceId, "auto_buy", amount, quote.averageUnitPrice, feePaid, -buyCost);
    recordMarketTradeVolume(ctx, order.playerId, order.resourceId, "auto_buy", amount);
  } else {
    amount = Math.min(amount, economy.stockpiles[order.resourceId]);
    if (amount <= 0.000001) {
      recordTradeAlert(ctx, order, elapsedHours, 0);
      return false;
    }
    const quote = calculateTradeQuote(ctx.state, order.playerId, order.resourceId, "sell", amount).trade;
    const grossEnergy = amount * quote.averageUnitPrice;
    const feePaid = quote.feePaid;
    const sellPayout = quote.totalEnergy;
    economy.stockpiles = {
      ...economy.stockpiles,
      [order.resourceId]: economy.stockpiles[order.resourceId] - amount,
      energy: economy.stockpiles.energy + sellPayout,
    };
    stats.totalExportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, order.playerId, order.resourceId, "auto_sell", amount, quote.averageUnitPrice, feePaid, sellPayout);
    recordMarketTradeVolume(ctx, order.playerId, order.resourceId, "auto_sell", amount);
  }

  order.updatedAt = ctx.state.clock.year;
  recordTradeAlert(ctx, order, elapsedHours, amount);
  return true;
}

function findAffordableMarketBuyAmount(
  ctx: RuntimeContext,
  order: MarketAutoTradeOrder,
  requestedAmount: number,
  availableEnergy: number,
): number {
  if (availableEnergy <= 0 || requestedAmount <= 0) return 0;
  const requestedQuote = calculateTradeQuote(
    ctx.state,
    order.playerId,
    order.resourceId,
    "buy",
    requestedAmount,
  ).trade;
  if (requestedQuote.totalEnergy <= availableEnergy) return requestedAmount;
  let low = 0;
  let high = requestedAmount;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const mid = (low + high) / 2;
    const quote = calculateTradeQuote(ctx.state, order.playerId, order.resourceId, "buy", mid).trade;
    if (quote.totalEnergy <= availableEnergy) low = mid;
    else high = mid;
  }
  return low;
}

function recordTradeAlert(ctx: RuntimeContext, order: MarketAutoTradeOrder, elapsedHours: number, executedAmount: number): void {
  const alertId = `${order.playerId}:${order.resourceId}:${order.type}`;
  const requestedAmount = order.amountPerHour * elapsedHours;
  if (executedAmount < requestedAmount - 0.001) {
    const executedPerHour = elapsedHours > 0 ? executedAmount / elapsedHours : 0;
    const existing = ctx.state.market.tradeAlerts.find((a) => a.id === alertId);
    if (existing) {
      existing.executedPerHour = executedPerHour;
      existing.requestedPerHour = order.amountPerHour;
    } else {
      ctx.state.market.tradeAlerts.push({
        id: alertId,
        playerId: order.playerId,
        resourceId: order.resourceId,
        tradeType: order.type,
        requestedPerHour: order.amountPerHour,
        executedPerHour,
      });
    }
  } else {
    ctx.state.market.tradeAlerts = ctx.state.market.tradeAlerts.filter((a) => a.id !== alertId);
  }
}

export function processShipShortageEffects(ctx: RuntimeContext, elapsedDays = 0): { shipsChanged: boolean; starbasesChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  const nebulaByStar = buildNebulaByStarId(ctx.state.nebulae);
  const fleetById = new Map(ctx.state.fleets.map((fleet) => [fleet.id, fleet] as const));

  for (const ship of ctx.state.ships) {
    const fleet = fleetById.get(ship.fleetId) ?? null;
    const nebula = fleet ? nebulaByStar.get(fleet.currentStarId) : undefined;
    const nebulaDef = nebula ? NEBULA_DEFINITIONS[nebula.kind] : undefined;

    // Radiation nebulas corrode hull/armor each tick (floored at 1 so they harass
    // rather than annihilate). Applies even once shields are already down.
    if (nebulaDef?.hullDamagePerTick && elapsedDays > 0 && ship.maxHull > 0 && ship.hull > 1) {
      let remaining = nebulaDef.hullDamagePerTick * elapsedDays;
      const armorAbsorbed = Math.min(ship.armor, remaining);
      ship.armor = Math.max(0, ship.armor - armorAbsorbed);
      remaining -= armorAbsorbed;
      if (remaining > 0) ship.hull = Math.max(1, ship.hull - remaining);
      shipsChanged = true;
    }

    if (ship.maxShield <= 0 || ship.shield <= 0) continue;
    // Electric/ion nebulas collapse shields entirely; otherwise the usual cap applies.
    const shieldMultiplier = nebulaDef?.forcesShieldsToZero
      ? 0
      : (fleet ? getFleetShieldMultiplier(ctx.state, fleet) : getFactionFleetShortageEffects(ctx.state, ship.ownerId).shieldMultiplier);
    const shieldCap = ship.maxShield * shieldMultiplier;
    if (ship.shield <= shieldCap) continue;
    ship.shield = Math.max(0, shieldCap);
    shipsChanged = true;
  }
  for (const starbase of ctx.state.starbases) {
    if (starbase.status !== "online" || starbase.maxShield <= 0 || starbase.shield <= 0) continue;
    const nebulaDef = (() => {
      const nebula = nebulaByStar.get(starbase.starId);
      return nebula ? NEBULA_DEFINITIONS[nebula.kind] : undefined;
    })();
    const shieldMultiplier = nebulaDef?.forcesShieldsToZero
      ? 0
      : getFactionFleetShortageEffects(ctx.state, starbase.ownerId).shieldMultiplier;
    const shieldCap = starbase.maxShield * shieldMultiplier;
    if (starbase.shield <= shieldCap) continue;
    starbase.shield = Math.max(0, shieldCap);
    starbasesChanged = true;
  }
  if (shipsChanged || starbasesChanged) ctx.hasDirtyState = true;
  return { shipsChanged, starbasesChanged };
}

type ShipRepairLayer = "shield" | "armor" | "hull";
interface ShipRepairRequest {
  ship: GameShip;
  layer: ShipRepairLayer;
  points: number;
  costs: { energy: number; minerals: number; alloys: number };
}

const SHIELD_FULL_REPAIR_DAYS = 150; // one real hour at normal speed
const STARBASE_ARMOR_FULL_REPAIR_DAYS = 1_200; // eight real hours
const SHIPYARD_HULL_FULL_REPAIR_DAYS = 3_600; // one real day
const REPAIR_DRONE_FULL_REPAIR_DAYS = 1_800; // twelve real hours
const ARMOR_NANITE_FULL_REPAIR_DAYS = 300; // roughly 3-8% in a normal battle
const SHIELD_DAMAGE_DELAY_HOURS = 60;

function canFactionUseRepairStarbase(ctx: RuntimeContext, ownerId: number, starbase: ServerStarbase): boolean {
  if (starbase.status !== "online") return false;
  if (starbase.ownerId === ownerId) return true;
  return getBorderPolicy(ctx.state.diplomacy, starbase.ownerId, ownerId) === "open"
    && getActiveTreatiesBetween(ctx.state.diplomacy, ownerId, starbase.ownerId).length > 0;
}

function fleetIsActivelyFighting(ctx: RuntimeContext, fleet: GameFleet): boolean {
  if (ctx.state.combatProjectiles.some((projectile) => projectile.status === "inFlight" && (projectile.sourceActorId === fleet.id || projectile.targetActorId === fleet.id))) return true;
  if (!Number.isFinite(fleet.lastCombatAtYear)) return false;
  return (ctx.state.clock.year - Number(fleet.lastCombatAtYear)) * GAME_HOURS_PER_YEAR < SHIELD_DAMAGE_DELAY_HOURS;
}

function diminishingModuleRate(count: number): number {
  let total = 0;
  for (let index = 0; index < count; index += 1) total += 0.6 ** index;
  return total;
}

function addRepairRequest(
  requests: ShipRepairRequest[],
  ship: GameShip,
  layer: ShipRepairLayer,
  points: number,
  perPoint: { energy?: number; minerals?: number; alloys?: number },
): void {
  const current = ship[layer];
  const maximum = ship[`max${layer[0].toUpperCase()}${layer.slice(1)}` as "maxShield" | "maxArmor" | "maxHull"];
  const bounded = Math.max(0, Math.min(maximum - current, points));
  if (bounded <= 0) return;
  requests.push({
    ship,
    layer,
    points: bounded,
    costs: {
      energy: bounded * (perPoint.energy ?? 0),
      minerals: bounded * (perPoint.minerals ?? 0),
      alloys: bounded * (perPoint.alloys ?? 0),
    },
  });
}

export function processShipRepairs(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  const requestsByOwner = new Map<number, ShipRepairRequest[]>();
  const fleetsById = new Map((ctx.state.fleets as GameFleet[]).map((fleet) => [fleet.id, fleet]));
  for (const ship of ctx.state.ships) {
    if (ship.hull <= 0 || ship.disabled) continue;
    const fleet = fleetsById.get(ship.fleetId);
    if (!fleet || fleet.phase === "jumpingHyperlane" || fleet.phase === "missingInAction") continue;
    const requests = requestsByOwner.get(ship.ownerId) ?? [];
    requestsByOwner.set(ship.ownerId, requests);
    const fighting = fleetIsActivelyFighting(ctx, fleet);
    const systemStarbases = ctx.state.starbases.filter((starbase) => starbase.starId === fleet.currentStarId && canFactionUseRepairStarbase(ctx, ship.ownerId, starbase));
    const shieldSupport = systemStarbases.length > 0;
    const shieldDelaySatisfied = !Number.isFinite(ship.lastShieldDamageAtYear)
      || (ctx.state.clock.year - Number(ship.lastShieldDamageAtYear)) * GAME_HOURS_PER_YEAR >= SHIELD_DAMAGE_DELAY_HOURS;
    if (shieldSupport && shieldDelaySatisfied && ship.maxShield > 0) {
      const shieldCap = ship.maxShield * getFleetShieldMultiplier(ctx.state, fleet);
      addRepairRequest(requests, ship, "shield", Math.min(shieldCap - ship.shield, shieldCap * elapsedDays / SHIELD_FULL_REPAIR_DAYS), { energy: 0.015 });
    }

    const orbitingStarbase = fleet.orbitTarget?.kind === "starbase"
      ? systemStarbases.find((starbase) => starbase.id === fleet.orbitTarget?.starbaseId) ?? null
      : null;
    if (!fighting && orbitingStarbase) {
      addRepairRequest(requests, ship, "armor", ship.maxArmor * elapsedDays / STARBASE_ARMOR_FULL_REPAIR_DAYS, { minerals: 0.02, alloys: 0.035 });
      if (countStarbaseShipyards(orbitingStarbase.buildingSlots) > 0) {
        addRepairRequest(requests, ship, "hull", ship.maxHull * elapsedDays / SHIPYARD_HULL_FULL_REPAIR_DAYS, { minerals: 0.04, alloys: 0.06 });
        if (ship.subsystemState && (ship.subsystemState.engineDisabled || ship.subsystemState.disabledWeaponKeys.length > 0) && ship.hull >= ship.maxHull - 0.001) {
          ship.subsystemState = { disabledWeaponKeys: [], engineDisabled: false, emergencyMobility: false };
        }
      }
    }

    const design = getShipDesignForShip(ctx, ship);
    const droneRate = diminishingModuleRate(design.utilityModuleIds.filter((id) => id === "utility_repair_drones").length);
    const naniteRate = diminishingModuleRate(design.utilityModuleIds.filter((id) => id === "utility_armor_nanites").length);
    if (!fighting && droneRate > 0) {
      addRepairRequest(requests, ship, "armor", ship.maxArmor * elapsedDays * droneRate / REPAIR_DRONE_FULL_REPAIR_DAYS, { energy: 0.015, minerals: 0.02, alloys: 0.035 });
    }
    if (naniteRate > 0) {
      addRepairRequest(requests, ship, "armor", ship.maxArmor * elapsedDays * naniteRate / ARMOR_NANITE_FULL_REPAIR_DAYS, { minerals: 0.03, alloys: 0.05 });
    }
  }

  let changed = false;
  for (const [ownerId, requests] of requestsByOwner) {
    const economy = getFactionEconomy(ctx.state, ownerId);
    if (!economy || requests.length === 0) continue;
    const grouped = new Map<string, ShipRepairRequest[]>();
    for (const request of requests) {
      const key = `${request.ship.id}:${request.layer}`;
      const group = grouped.get(key) ?? [];
      group.push(request);
      grouped.set(key, group);
    }
    for (const group of grouped.values()) {
      const first = group[0];
      const maximum = first.ship[`max${first.layer[0].toUpperCase()}${first.layer.slice(1)}` as "maxShield" | "maxArmor" | "maxHull"];
      const missing = Math.max(0, maximum - first.ship[first.layer]);
      const requested = group.reduce((sum, request) => sum + request.points, 0);
      const overlapScale = requested > missing && requested > 0 ? missing / requested : 1;
      if (overlapScale >= 1) continue;
      for (const request of group) {
        request.points *= overlapScale;
        request.costs.energy *= overlapScale;
        request.costs.minerals *= overlapScale;
        request.costs.alloys *= overlapScale;
      }
    }
    const total = requests.reduce((sum, request) => ({
      energy: sum.energy + request.costs.energy,
      minerals: sum.minerals + request.costs.minerals,
      alloys: sum.alloys + request.costs.alloys,
    }), { energy: 0, minerals: 0, alloys: 0 });
    const factor = Math.min(1,
      total.energy > 0 ? economy.stockpiles.energy / total.energy : 1,
      total.minerals > 0 ? economy.stockpiles.minerals / total.minerals : 1,
      total.alloys > 0 ? economy.stockpiles.alloys / total.alloys : 1,
    );
    if (factor <= 0) continue;
    for (const request of requests) {
      request.ship[request.layer] = Math.min(request.ship[`max${request.layer[0].toUpperCase()}${request.layer.slice(1)}` as "maxShield" | "maxArmor" | "maxHull"], request.ship[request.layer] + request.points * factor);
      if (request.layer === "hull") request.ship.hp = request.ship.hull;
      const snapshot = fleetsById.get(request.ship.fleetId)?.battleSnapshot;
      if (snapshot) {
        const spending = (snapshot.repairSpending ??= {});
        spending.energy = (spending.energy ?? 0) + request.costs.energy * factor;
        spending.minerals = (spending.minerals ?? 0) + request.costs.minerals * factor;
        spending.alloys = (spending.alloys ?? 0) + request.costs.alloys * factor;
      }
      changed = true;
    }
    economy.stockpiles.energy -= total.energy * factor;
    economy.stockpiles.minerals -= total.minerals * factor;
    economy.stockpiles.alloys -= total.alloys * factor;
  }
  if (changed) {
    ctx.refreshFactionEconomyDeltas();
    ctx.hasDirtyState = true;
  }
  return changed;
}

function constructionEmergencyHours(ship: GameShip): number {
  return ship.shipKind === "battleship" ? 600 : ship.shipKind === "cruiser" ? 360 : ship.shipKind === "destroyer" ? 240 : 120;
}

function spendFieldRepair(
  ctx: RuntimeContext,
  ownerId: number,
  desiredPoints: number,
  costs: { energy?: number; minerals?: number; alloys?: number },
): number {
  const economy = getFactionEconomy(ctx.state, ownerId);
  if (!economy || desiredPoints <= 0) return 0;
  const factor = Math.min(1,
    costs.energy ? economy.stockpiles.energy / (desiredPoints * costs.energy) : 1,
    costs.minerals ? economy.stockpiles.minerals / (desiredPoints * costs.minerals) : 1,
    costs.alloys ? economy.stockpiles.alloys / (desiredPoints * costs.alloys) : 1,
  );
  const points = desiredPoints * Math.max(0, factor);
  economy.stockpiles.energy -= points * (costs.energy ?? 0);
  economy.stockpiles.minerals -= points * (costs.minerals ?? 0);
  economy.stockpiles.alloys -= points * (costs.alloys ?? 0);
  return points;
}

function canConstructionAssist(ctx: RuntimeContext, constructionOwnerId: number, targetOwnerId: number): boolean {
  if (constructionOwnerId === targetOwnerId) return true;
  return getBorderPolicy(ctx.state.diplomacy, targetOwnerId, constructionOwnerId) === "open"
    && getActiveTreatiesBetween(ctx.state.diplomacy, constructionOwnerId, targetOwnerId).length > 0;
}

export function processConstructionRepairs(ctx: RuntimeContext, elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  const shipsById = new Map(ctx.state.ships.map((ship) => [ship.id, ship]));
  for (const repairFleet of ctx.state.fleets as GameFleet[]) {
    const order = repairFleet.repairOrder;
    if (!order) continue;
    const constructionShip = repairFleet.shipIds.map((id) => shipsById.get(id)).find((ship) => ship?.shipKind === "constructionShip" && ship.hull > 0);
    const targetFleet = (ctx.state.fleets as GameFleet[]).find((fleet) => fleet.id === order.targetFleetId);
    if (!constructionShip || !targetFleet || targetFleet.currentStarId !== repairFleet.currentStarId || !canConstructionAssist(ctx, repairFleet.ownerId, targetFleet.ownerId)) {
      repairFleet.repairOrder = null;
      changed = true;
      continue;
    }
    if (fleetIsActivelyFighting(ctx, repairFleet) || fleetIsActivelyFighting(ctx, targetFleet)) continue;
    const targets = targetFleet.shipIds.map((id) => shipsById.get(id)).filter((ship): ship is GameShip => !!ship && ship.hull > 0 && ship.shipKind !== "defensePlatform");
    const stranded = targets.find((ship) => ship.subsystemState?.engineDisabled && !ship.subsystemState.emergencyMobility);
    if (stranded) {
      if (order.targetShipId !== stranded.id || order.stage !== "emergencyMobility") {
        order.targetShipId = stranded.id;
        order.stage = "emergencyMobility";
        order.progressHours = 0;
      }
      order.progressHours += elapsedDays * 24;
      if (order.progressHours >= constructionEmergencyHours(stranded)) {
        stranded.subsystemState!.emergencyMobility = true;
        order.progressHours = 0;
        order.targetShipId = null;
      }
      changed = true;
      continue;
    }
    const subsystemTarget = targets.find((ship) => ship.subsystemState?.engineDisabled || (ship.subsystemState?.disabledWeaponKeys.length ?? 0) > 0);
    if (subsystemTarget) {
      if (order.targetShipId !== subsystemTarget.id || order.stage !== "subsystems") {
        order.targetShipId = subsystemTarget.id;
        order.stage = "subsystems";
        order.progressHours = 0;
      }
      order.progressHours += elapsedDays * 24;
      if (order.progressHours >= constructionEmergencyHours(subsystemTarget) * 2) {
        subsystemTarget.subsystemState = { disabledWeaponKeys: [], engineDisabled: false, emergencyMobility: false };
        order.progressHours = 0;
        order.targetShipId = null;
      }
      changed = true;
      continue;
    }
    const layerTarget = targets.find((ship) => ship.hull < ship.maxHull || ship.armor < ship.maxArmor || ship.shield < ship.maxShield);
    if (!layerTarget) {
      repairFleet.repairOrder = null;
      changed = true;
      continue;
    }
    order.targetShipId = layerTarget.id;
    if (layerTarget.hull < layerTarget.maxHull) {
      order.stage = "hull";
      const desired = Math.min(layerTarget.maxHull - layerTarget.hull, layerTarget.maxHull * elapsedDays / (SHIPYARD_HULL_FULL_REPAIR_DAYS * 2));
      const restored = spendFieldRepair(ctx, targetFleet.ownerId, desired, { minerals: 0.06, alloys: 0.09 });
      layerTarget.hull += restored;
      layerTarget.hp = layerTarget.hull;
      changed ||= restored > 0;
    } else if (layerTarget.armor < layerTarget.maxArmor) {
      order.stage = "armor";
      const desired = Math.min(layerTarget.maxArmor - layerTarget.armor, layerTarget.maxArmor * elapsedDays / (STARBASE_ARMOR_FULL_REPAIR_DAYS * 2));
      const restored = spendFieldRepair(ctx, targetFleet.ownerId, desired, { minerals: 0.03, alloys: 0.0525 });
      layerTarget.armor += restored;
      changed ||= restored > 0;
    } else if (layerTarget.shield < layerTarget.maxShield) {
      order.stage = "shield";
      const desired = Math.min(layerTarget.maxShield - layerTarget.shield, layerTarget.maxShield * elapsedDays / (SHIELD_FULL_REPAIR_DAYS * 2));
      const restored = spendFieldRepair(ctx, targetFleet.ownerId, desired, { energy: 0.0225 });
      layerTarget.shield += restored;
      changed ||= restored > 0;
    }
  }
  if (changed) {
    ctx.refreshFactionEconomyDeltas();
    ctx.hasDirtyState = true;
  }
  return changed;
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

function trySpendStarbaseRepairResources(ctx: RuntimeContext, ownerId: number, repairPoints: number, alloyCostPerPoint: number, mineralCostPerPoint: number, energyCostPerPoint = 0): boolean {
  const economy = getFactionEconomy(ctx.state, ownerId);
  if (!economy || repairPoints <= 0) return false;
  const alloys = repairPoints * alloyCostPerPoint;
  const minerals = repairPoints * mineralCostPerPoint;
  const energy = repairPoints * energyCostPerPoint;
  if (economy.stockpiles.alloys < alloys || economy.stockpiles.minerals < minerals || economy.stockpiles.energy < energy) return false;
  economy.stockpiles = addResourceCounts(economy.stockpiles, {
    ...createEmptyResourceCounts(),
    alloys: -alloys,
    minerals: -minerals,
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
    const recentlyHit = Number.isFinite(next.lastShieldDamageAtYear)
      && (ctx.state.clock.year - Number(next.lastShieldDamageAtYear)) * GAME_HOURS_PER_YEAR < SHIELD_DAMAGE_DELAY_HOURS;
    const activelyTargeted = ctx.state.combatProjectiles.some((projectile) => projectile.status === "inFlight" && (projectile.targetActorId === next.id || projectile.sourceActorId === next.id));
    const usableShield = next.maxShield * getFactionFleetShortageEffects(ctx.state, next.ownerId).shieldMultiplier;
    if (next.shield < usableShield && !recentlyHit) {
      const repair = Math.min(usableShield - next.shield, usableShield * elapsedDays / SHIELD_FULL_REPAIR_DAYS);
      if (trySpendStarbaseRepairResources(ctx, next.ownerId, repair, 0, 0, STARBASE_REPAIR_ENERGY_COST_PER_POINT)) {
        next = { ...next, shield: next.shield + repair };
        changed = true;
      }
    }
    if (activelyTargeted) return next;
    if (next.armor < next.maxArmor) {
      const repair = Math.min(next.maxArmor - next.armor, next.maxArmor * STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(ctx, next.ownerId, repair, STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT, 0.02)) {
        next = { ...next, armor: next.armor + repair };
        changed = true;
      }
    }
    if (next.hull < next.maxHull) {
      const repair = Math.min(next.maxHull - next.hull, next.maxHull * STARBASE_HULL_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(ctx, next.ownerId, repair, STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT, 0.04)) {
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
  if (item.shipKind === "defensePlatform") {
    let fleet = ctx.state.fleets.find((candidate) => (
      candidate.stationaryStarbaseId === starbase.id
      && candidate.ownerId === starbase.ownerId
      && candidate.combatStatus !== "destroyed"
    ));
    if (!fleet) {
      fleet = createFleet(
        ctx,
        starbase.ownerId,
        starbase.starId,
        [],
        ctx.createRuntimeId("defense-fleet", [starbase.ownerId, starbase.id]),
      );
      fleet.stationaryStarbaseId = starbase.id;
      fleet.speed = 0;
      fleet.phaseStartedAtYear = ctx.state.clock.year;
      fleet.systemPosition = getSystemStarbaseOrbitPosition(starbase.systemPosition);
      ctx.state.fleets.push(fleet);
    }
    const ship = createShip(
      ctx,
      starbase.ownerId,
      fleet.id,
      item.shipKind,
      ctx.createRuntimeId("ship", [starbase.ownerId, item.shipKind]),
      item.designId,
    );
    fleet.shipIds.push(ship.id);
    ctx.state.ships.push(ship);
    ctx.syncFleetMembership();
    return;
  }
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
  if (["scienceShip", "constructionShip", "colonizationShip", "armyShip"].includes(item.shipKind)) {
    fleet.combatSettings.engagementRule = "avoid";
  }
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
  const previousCrew = ship.crew;
  applyShipDesignToShip(ship, targetDesign);
  const availableCrew = previousCrew + Math.max(0, item.reservedCrew ?? 0);
  ship.crew = Math.min(ship.crewCapacity, availableCrew);
  const surplus = Math.max(0, availableCrew - ship.crewCapacity);
  const economy = getFactionEconomy(ctx.state, ship.ownerId);
  if (economy && surplus > 0) economy.crewStockpile += surplus;
  ship.disabled = false;
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

function spawnCompletedPlanetShip(
  ctx: RuntimeContext,
  planet: PlanetState,
  item: Pick<StarbaseShipQueueItem, "shipKind" | "designId">,
): void {
  if (item.shipKind === "defensePlatform") {
    let fleet = ctx.state.fleets.find((candidate) => (
      candidate.stationaryPlanetId === planet.id
      && candidate.ownerId === planet.ownerId
      && candidate.combatStatus !== "destroyed"
    ));
    if (!fleet) {
      fleet = createFleet(
        ctx,
        planet.ownerId!,
        planet.starId,
        [],
        ctx.createRuntimeId("planet-defense-fleet", [planet.ownerId!, planet.id]),
      );
      fleet.stationaryPlanetId = planet.id;
      fleet.speed = 0;
      fleet.phaseStartedAtYear = ctx.state.clock.year;
      startOrbitOrder(ctx, fleet, planet.id);
      ctx.state.fleets.push(fleet);
    }
    const ship = createShip(
      ctx,
      planet.ownerId!,
      fleet.id,
      item.shipKind,
      ctx.createRuntimeId("ship", [planet.ownerId!, item.shipKind]),
      item.designId,
    );
    fleet.shipIds.push(ship.id);
    ctx.state.ships.push(ship);
    ctx.syncFleetMembership();
    return;
  }

  const fleetId = ctx.createRuntimeId("fleet", [planet.ownerId!, planet.starId]);
  const ship = createShip(
    ctx,
    planet.ownerId!,
    fleetId,
    item.shipKind,
    ctx.createRuntimeId("ship", [planet.ownerId!, item.shipKind]),
    item.designId,
  );
  const fleet = createFleet(ctx, planet.ownerId!, planet.starId, [ship.id], fleetId);
  if (["scienceShip", "constructionShip", "colonizationShip", "armyShip"].includes(item.shipKind)) {
    fleet.combatSettings.engagementRule = "avoid";
  }
  fleet.phaseStartedAtYear = ctx.state.clock.year;
  fleet.speed = ship.speed;
  startOrbitOrder(ctx, fleet, planet.id);
  ctx.state.ships.push(ship);
  ctx.state.fleets.push(fleet);
}

export function processPlanetShipQueues(
  ctx: RuntimeContext,
  elapsedDays: number,
): { planetsChanged: boolean; fleetsChanged: boolean } {
  if (elapsedDays <= 0) return { planetsChanged: false, fleetsChanged: false };
  let planetsChanged = false;
  let fleetsChanged = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planet) => {
    if (!planet.isHabited || planet.ownerId === null || planet.defense.shipQueue.length === 0) return planet;
    const shipyards = countPlanetShipyards(planet);
    if (shipyards <= 0) return planet;
    const economy = getFactionEconomy(ctx.state, planet.ownerId);
    const queueHolder = { buildingSlots: [], shipQueue: planet.defense.shipQueue };
    const result = progressStarbaseShipQueue(queueHolder, elapsedDays, economy?.stockpiles, shipyards);
    if (!result.changed) return planet;
    if (economy) {
      economy.stockpiles = addResourceCounts(economy.stockpiles, scaleResourceCounts(result.resourcesConsumed, -1));
    }
    for (const completed of result.completed) {
      spawnCompletedPlanetShip(ctx, planet, completed);
      fleetsChanged = true;
    }
    planetsChanged = true;
    ctx.queuePlanetDetailRefresh(planet.id);
    return {
      ...planet,
      defense: { ...planet.defense, shipQueue: result.starbase.shipQueue },
    };
  });
  if (fleetsChanged) {
    ctx.syncFleetMembership();
    ctx.refreshDiscovery();
  }
  if (planetsChanged || fleetsChanged) {
    ctx.refreshFactionEconomyDeltas();
    ctx.hasDirtyState = true;
  }
  return { planetsChanged, fleetsChanged };
}
