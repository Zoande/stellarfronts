import { DISTRICT_COSTS, RESOURCE_KINDS } from "../../src/data/Economy";
import { countStarbaseShipyards, OUTPOST_CONSTRUCTION_COST } from "../../src/data/Starbase";
import { getStarbaseShipConstructionCostMultiplier } from "../../src/data/Starbase";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { GameAction } from "./actions";
import type { AiObservation } from "./ai-observation";
import { getAiCandidates } from "./ai-candidates";
import type { CaretakerEpisode, RuntimeContext } from "./types";

export const CARETAKER_AFK_MS = 48 * 60 * 60 * 1000;

/** Owned, observed ships at activation are the hard replacement ceiling. */
export function createCaretakerEpisode(observation: AiObservation, accountId: number, lastActivityAt: number, realNow: number): CaretakerEpisode {
  const ships = new Map(observation.fleets.ships.filter((ship) => ship.ownerId === observation.factionId).map((ship) => [ship.id, ship]));
  return {
    accountId, startedAt: realNow, lastActivityAt, nextDecisionYear: observation.snapshot.clock.year,
    fleets: observation.fleets.fleets.filter((fleet) => fleet.ownerId === observation.factionId).map((fleet) => ({
      fleetId: fleet.id,
      ships: fleet.shipIds.flatMap((id) => {
        const ship = ships.get(id);
        return ship ? [{ shipId: id, shipKind: ship.shipKind, designId: ship.designId ?? null }] : [];
      }),
    })),
    queuedShips: {}, reinforcements: {}, repairOrders: {},
  };
}

/** Called by ordinary ship-queue completion, including after a checkpoint restore. */
export function registerCaretakerShipCompletion(ctx: RuntimeContext, queueItemId: string, shipId: string): void {
  for (const episode of [...Object.values(ctx.state.caretakerEpisodes ?? {}), ...Object.values(ctx.state.passiveEpisodes ?? {})]) {
    const assignment = episode.queuedShips[queueItemId];
    if (!assignment) continue;
    delete episode.queuedShips[queueItemId];
    episode.reinforcements[shipId] = { ...assignment };
    ctx.hasDirtyState = true;
    return;
  }
}

function currentEnemyFleetIds(observation: AiObservation): Set<string> {
  return new Set(observation.snapshot.intelligence.entities
    .filter((entity) => entity.kind === "fleet" && entity.fields.existence?.status === "current" && entity.fields.existence.value === true
      && entity.fields.ownerId?.status === "current" && entity.fields.currentStarId?.status === "current")
    .map((entity) => entity.id));
}

function economyAction(observation: AiObservation, candidates: ReturnType<typeof getAiCandidates>): GameAction | null {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId);
  if (!economy) return null;
  const needs = RESOURCE_KINDS
    .filter((resource) => resource !== "research")
    .map((resource) => ({ resource, months: economy.monthlyDelta[resource] < 0
      ? economy.stockpiles[resource] / -economy.monthlyDelta[resource] : Infinity }))
    .filter(({ resource, months }) => economy.stockpiles[resource] <= 0 || months < 3)
    .sort((a, b) => a.months - b.months);
  const sellSurplus = (): GameAction | null => {
    const reserves = { goods: 300, minerals: 2_000, alloys: 400 } as const;
    const surplus = (["goods", "minerals", "alloys"] as const).flatMap((resource) =>
      economy.stockpiles[resource] > reserves[resource] + 100
        ? candidates.economy.filter((action) => action.type === "marketTrade" && action.tradeType === "sell" && action.resourceId === resource).slice(0, 1)
        : [])[0];
    return surplus?.type === "marketTrade"
      ? { ...surplus, amount: Math.min(100, Math.floor((economy.stockpiles[surplus.resourceId] - reserves[surplus.resourceId as keyof typeof reserves]) * 0.15)) } : null;
  };
  for (const { resource } of needs) {
    const districtKind = resource === "food" ? "agriculture" : resource === "minerals" ? "mining" : resource === "energy" ? "generator" : null;
    const buildingKind = resource === "food" ? "foodProcessingPlant" : resource === "minerals" ? "mineralPurificationPlant"
      : resource === "energy" ? "energyGrid" : resource === "goods" ? "civilianFabricators" : resource === "alloys" ? "alloyFoundries" : null;
    const districtQueued = observation.planets.planets.some((entry) => entry.planetState.ownerId === observation.factionId
      && entry.planetState.constructionQueue.some((item) => item.districtKind === districtKind));
    const district = !districtQueued ? candidates.economy.find((action) => action.type === "buildDistrict" && action.districtKind === districtKind) : undefined;
    if (district) return district;
    const canUseBuilding = !districtKind || observation.planets.planets.some((entry) => entry.planetState.ownerId === observation.factionId
      && entry.planetState.builtDistricts[districtKind] > 0);
    const alreadyQueued = observation.planets.planets.some((entry) => entry.planetState.ownerId === observation.factionId
      && entry.planetState.constructionQueue.some((item) => item.buildingKind === buildingKind));
    const building = canUseBuilding && !alreadyQueued
      ? candidates.economy.find((action) => action.type === "buildPlanetBuilding" && action.buildingKind === buildingKind) : undefined;
    if (building) return building;
    if (resource !== "energy" && economy.stockpiles.energy > 100) {
      const buy = candidates.economy.find((action) => action.type === "marketTrade" && action.tradeType === "buy" && action.resourceId === resource);
      const quote = observation.market.resources.find((entry) => entry.resourceId === resource);
      if (buy?.type === "marketTrade" && quote) {
        const constructionNeed = resource === "food" ? DISTRICT_COSTS.agriculture.food : 0;
        const wanted = Math.max(constructionNeed + 25, Math.ceil(-economy.monthlyDelta[resource] * 2), 50);
        const energyReserve = Math.max(500, -economy.monthlyDelta.energy * 2);
        const budget = Math.floor(Math.max(0, economy.stockpiles.energy - energyReserve) * 0.4 / Math.max(1, quote.buyPrice * 1.3));
        const amount = Math.min(500, budget, Math.ceil(wanted - economy.stockpiles[resource]));
        if (amount > 0) return { ...buy, amount };
      }
    }
    if (resource !== "energy" && economy.stockpiles[resource] < Math.max(25, -economy.monthlyDelta[resource])) {
      const sale = sellSurplus();
      if (sale) return sale;
    }
  }
  if (needs.some(({ resource }) => resource === "energy") && economy.stockpiles.energy < 150) return sellSurplus();
  return null;
}

function replacementAction(observation: AiObservation, episode: CaretakerEpisode): { action: GameAction; fleetId: string } | null {
  const confirmedLost = new Set(observation.fleets.combatReports.filter((report) => report.ownerId === observation.factionId)
    .flatMap((report) => report.shipsLost));
  for (const entity of observation.snapshot.intelligence.entities) {
    if (entity.kind === "ship" && entity.fields.existence?.status === "current" && entity.fields.existence.value === false) confirmedLost.add(entity.id);
  }
  const current = new Set(observation.fleets.ships.filter((ship) => ship.ownerId === observation.factionId && !confirmedLost.has(ship.id)).map((ship) => ship.id));
  // Queue receipts are authoritative. An owner's observed shipyard queue can lag
  // its accepted command, so absence from a view is not proof of cancellation.
  for (const id of Object.keys(episode.reinforcements)) if (confirmedLost.has(id)) delete episode.reinforcements[id];
  for (const baseline of episode.fleets) {
    for (const template of baseline.ships) {
      if (template.shipKind === "armyShip" || current.has(template.shipId)) continue;
      const targetCount = baseline.ships.filter((ship) => ship.shipKind === template.shipKind && ship.designId === template.designId).length;
      const surviving = baseline.ships.filter((ship) => ship.shipKind === template.shipKind && ship.designId === template.designId && current.has(ship.shipId)).length;
      const queued = Object.values(episode.queuedShips).filter((ship) => ship.fleetId === baseline.fleetId && ship.shipKind === template.shipKind && ship.designId === template.designId).length;
      const reinforced = Object.values(episode.reinforcements).filter((assignment) => assignment.fleetId === baseline.fleetId
        && assignment.shipKind === template.shipKind && assignment.designId === template.designId).length;
      if (surviving + queued + reinforced >= targetCount) continue;
      const countryBaseline = episode.fleets.flatMap((entry) => entry.ships)
        .filter((ship) => ship.shipKind === template.shipKind && ship.designId === template.designId).length;
      const countryShips = observation.fleets.ships.filter((ship) => ship.ownerId === observation.factionId && current.has(ship.id)
        && ship.shipKind === template.shipKind && (ship.designId ?? null) === template.designId).length
        + Object.entries(episode.reinforcements).filter(([id, assignment]) => !current.has(id)
          && assignment.shipKind === template.shipKind && assignment.designId === template.designId).length;
      const countryQueues = new Set([
        ...observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId).flatMap((base) => base.shipQueue),
        ...observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId).flatMap((entry) => entry.planetState.defense.shipQueue),
      ].filter((item) => item.kind === "build" && item.shipKind === template.shipKind && (item.designId ?? null) === template.designId).map((item) => item.id));
      for (const [id, item] of Object.entries(episode.queuedShips)) {
        if (item.shipKind === template.shipKind && item.designId === template.designId) countryQueues.add(id);
      }
      if (countryShips + countryQueues.size >= countryBaseline) continue;
      const designAvailable = observation.fleets.shipDesigns.some((design) => design.id === template.designId && design.ownerId === observation.factionId && design.status === "active");
      if (!designAvailable || !template.designId) continue;
      const design = observation.fleets.shipDesigns.find((entry) => entry.id === template.designId)!;
      const stats = calculateShipDesignStats(design);
      const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId);
      if (!economy || economy.crewStockpile < stats.crewDemand) continue;
      const yard = observation.fleets.starbases.find((base) => base.ownerId === observation.factionId && countStarbaseShipyards(base.buildingSlots) > 0);
      if (yard && RESOURCE_KINDS.every((resource) => economy.stockpiles[resource] >= stats.cost[resource] * getStarbaseShipConstructionCostMultiplier(yard.buildingSlots) * 0.05)) {
        return { action: { type: "buildStarbaseShip", starbaseId: yard.id, shipKind: template.shipKind, designId: template.designId }, fleetId: baseline.fleetId };
      }
      const planet = observation.planets.planets.find((entry) => entry.planetState.ownerId === observation.factionId
        && entry.planetState.defense.shipyardSlots.some((slot) => slot?.kind === "orbitalShipyard" && slot.enabled !== false));
      if (planet && RESOURCE_KINDS.every((resource) => economy.stockpiles[resource] >= stats.cost[resource] * 0.05)) {
        return { action: { type: "buildPlanetShip", planetId: planet.planetState.id, shipKind: template.shipKind, designId: template.designId }, fleetId: baseline.fleetId };
      }
    }
  }
  return null;
}

export interface CaretakerDecision { action: GameAction; replacementForFleetId?: string }

/** A deterministic, deliberately conservative policy over detached faction information. */
export function decideCaretaker(observation: AiObservation, episode: CaretakerEpisode): CaretakerDecision[] {
  const { factionId, snapshot, fleets } = observation;
  const candidates = getAiCandidates(observation);
  const decisions: CaretakerDecision[] = [];
  const owners = new Map(snapshot.starOwnership);
  const visibleEnemies = currentEnemyFleetIds(observation);
  const enemies = fleets.fleets.filter((fleet) => fleet.ownerId >= 0 && fleet.ownerId !== factionId
    && visibleEnemies.has(fleet.id) && owners.get(fleet.currentStarId) === factionId
    && observation.diplomacy.countries.some((country) => country.faction.id === fleet.ownerId && country.atWar));
  const ownMilitary = fleets.fleets.filter((fleet) => fleet.ownerId === factionId && observation.commandLinks[fleet.id]
    && fleet.shipIds.some((id) => fleets.ships.some((ship) => ship.id === id && !["scienceShip", "constructionShip", "colonizationShip", "armyShip", "defensePlatform"].includes(ship.shipKind)))
    && !fleet.retreatState && !fleet.stationaryPlanetId && !fleet.stationaryStarbaseId);
  for (const enemy of enemies) {
    const defender = ownMilitary.find((fleet) => fleet.currentStarId === enemy.currentStarId && fleet.phase === "idle");
    if (defender) { decisions.push({ action: { type: "attackTarget", fleetId: defender.id, targetId: enemy.id, targetKind: "fleet" } }); break; }
    const mover = ownMilitary.find((fleet) => fleet.phase === "idle"
      && candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === fleet.id && action.targetStarId === enemy.currentStarId));
    if (mover) { decisions.push({ action: { type: "moveFleet", fleetId: mover.id, targetStarId: enemy.currentStarId } }); break; }
  }
  const economical = economyAction(observation, candidates);
  if (economical) decisions.push({ action: economical });
  const busyFleetIds = new Set<string>();
  const repairReceipts = episode.repairOrders ??= {};
  for (const [constructionId, receipt] of Object.entries(repairReceipts)) {
    const target = fleets.fleets.find((fleet) => fleet.id === receipt.targetFleetId && fleet.ownerId === factionId);
    const damaged = target?.shipIds.some((id) => {
      const ship = fleets.ships.find((entry) => entry.id === id);
      return !!ship && (ship.hull < ship.maxHull || ship.armor < ship.maxArmor || ship.shield < ship.maxShield
        || ship.subsystemState?.engineDisabled || (ship.subsystemState?.disabledWeaponKeys.length ?? 0) > 0);
    });
    const construction = fleets.fleets.find((fleet) => fleet.id === constructionId);
    if (!damaged || snapshot.clock.year - receipt.issuedAtYear >= 30 / GAME_DAYS_PER_YEAR && construction?.repairOrder?.targetFleetId !== receipt.targetFleetId) {
      delete repairReceipts[constructionId];
    }
  }
  for (const id of Object.keys(repairReceipts)) busyFleetIds.add(id);
  for (const fleet of fleets.fleets) if (fleet.ownerId === factionId && fleet.repairOrder) busyFleetIds.add(fleet.id);
  const repair = candidates.repairs.find((action) => action.type === "repairFleet" && !busyFleetIds.has(action.constructionFleetId)
    && repairReceipts[action.constructionFleetId]?.targetFleetId !== action.targetFleetId);
  if (repair) {
    decisions.push({ action: repair });
    if (repair.type === "repairFleet") busyFleetIds.add(repair.constructionFleetId);
  } else {
    const damaged = fleets.fleets.find((fleet) => fleet.ownerId === factionId && owners.get(fleet.currentStarId) === factionId
      && fleet.shipIds.some((id) => {
        const ship = fleets.ships.find((entry) => entry.id === id);
        return !!ship && (ship.hull < ship.maxHull || ship.armor < ship.maxArmor || ship.subsystemState?.engineDisabled);
      }));
    const repairShip = damaged && !enemies.some((enemy) => enemy.currentStarId === damaged.currentStarId)
      && fleets.fleets.find((fleet) => fleet.ownerId === factionId && fleet.id !== damaged.id && !busyFleetIds.has(fleet.id)
      && fleet.phase === "idle" && observation.commandLinks[fleet.id]
      && fleet.shipIds.some((id) => fleets.ships.some((ship) => ship.id === id && ship.shipKind === "constructionShip"))
      && candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === fleet.id && action.targetStarId === damaged.currentStarId));
    if (repairShip && damaged) {
      decisions.push({ action: { type: "moveFleet", fleetId: repairShip.id, targetStarId: damaged.currentStarId } });
      busyFleetIds.add(repairShip.id);
    }
  }
  // Completed replacements assemble with their original fleet in friendly space.
  for (const baseline of episode.fleets) {
    const replacementFleetIds = new Set(Object.entries(episode.reinforcements)
      .filter(([shipId, assignment]) => assignment.fleetId === baseline.fleetId && fleets.ships.some((ship) => ship.id === shipId))
      .map(([shipId]) => fleets.ships.find((ship) => ship.id === shipId)?.fleetId)
      .filter((id): id is string => !!id));
    const original = fleets.fleets.find((fleet) => fleet.id === baseline.fleetId && fleet.ownerId === factionId);
    const target = original ?? fleets.fleets.find((fleet) => replacementFleetIds.has(fleet.id) && fleet.ownerId === factionId);
    if (!target || busyFleetIds.has(target.id) || target.phase !== "idle" || target.retreatState || owners.get(target.currentStarId) !== factionId) continue;
    for (const sourceId of replacementFleetIds) {
      if (sourceId === target.id) continue;
      const source = fleets.fleets.find((fleet) => fleet.id === sourceId && fleet.ownerId === factionId && observation.commandLinks[fleet.id]);
      if (!source || busyFleetIds.has(source.id) || source.phase !== "idle" || source.retreatState) continue;
      if (source.currentStarId === target.currentStarId) {
        decisions.push({ action: { type: "mergeFleets", targetFleetId: target.id, sourceFleetIds: [source.id] } });
      } else if (candidates.movement.some((action) => action.type === "moveFleet" && action.fleetId === source.id && action.targetStarId === target.currentStarId)) {
        decisions.push({ action: { type: "moveFleet", fleetId: source.id, targetStarId: target.currentStarId } });
      }
      break;
    }
  }
  const replacement = replacementAction(observation, episode);
  if (replacement) decisions.push({ action: replacement.action, replacementForFleetId: replacement.fleetId });
  // Research already in progress continues through the simulation pipeline.
  // Choosing a new focus is reserved for the returning player.
  // Each available construction fleet may claim a different known, unowned system.
  const reserved = new Set(fleets.fleets.filter((fleet) => fleet.ownerId === factionId && fleet.orderType === "build")
    .map((fleet) => fleet.targetStarId).filter((id): id is number => id !== null));
  const usedFleetIds = new Set<string>();
  const economy = snapshot.factionEconomies.find((entry) => entry.factionId === factionId);
  const expansionBudget = economy ? { ...economy.stockpiles } : null;
  const atWar = observation.diplomacy.countries.some((country) => country.atWar);
  for (const candidate of economical || enemies.length || atWar ? [] : candidates.expansion) {
    if (candidate.type !== "buildStarbase" || !candidate.fleetId || reserved.has(candidate.targetStarId) || usedFleetIds.has(candidate.fleetId) || busyFleetIds.has(candidate.fleetId)) continue;
    if (fleets.fleets.some((fleet) => fleet.ownerId !== factionId && visibleEnemies.has(fleet.id) && fleet.currentStarId === candidate.targetStarId)) continue;
    const frontier = snapshot.hyperlanes.some(([a, b]) => (a === candidate.targetStarId && owners.get(b) === factionId)
      || (b === candidate.targetStarId && owners.get(a) === factionId));
    if (!frontier) continue;
    if (!fleets.fleets.some((fleet) => fleet.id === candidate.fleetId && fleet.ownerId === factionId)) continue;
    if (!expansionBudget || RESOURCE_KINDS.some((resource) => expansionBudget[resource] < OUTPOST_CONSTRUCTION_COST[resource] * 1.25)) continue;
    for (const resource of RESOURCE_KINDS) expansionBudget[resource] -= OUTPOST_CONSTRUCTION_COST[resource];
    reserved.add(candidate.targetStarId);
    usedFleetIds.add(candidate.fleetId);
    decisions.push({ action: candidate });
  }
  return decisions;
}
