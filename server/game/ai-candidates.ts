import { BUILDING_DEFINITIONS, BUILDING_KINDS, DISTRICT_COSTS, RESOURCE_KINDS, getEffectivePlanetDistrictLimits, getQueuedDistrictCount, getBuildingCost, isBuildingCompatible, hasQueuedBuildingTarget, getPlanetBuildingKind, getPlanetBuildingLevel, getBuildingUpgradeTargetLevel, getBuildingUpgradeCost, meetsCapitalUpgradePopulation, isPlanetBuildingEnabled } from "../../src/data/Economy";
import type { BuildingSlotArea, PlanetState, ResourceCounts, DistrictKind } from "../../src/data/Economy";
import { getRequiredTechIdsForBuilding, getRequiredTechIdsForBuildingLevel } from "../../src/data/Technology";
import { OUTPOST_CONSTRUCTION_COST } from "../../src/data/Starbase";
import type { GameAction } from "./actions";
import type { AiObservation } from "./ai-observation";

export interface AiCandidates {
  economy: GameAction[];
  research: GameAction[];
  repairs: GameAction[];
  movement: GameAction[];
  expansion: GameAction[];
  colonization: GameAction[];
}

/** Advisory candidates, computed only from detached observations and public catalogs. */
export function getAiCandidates(observation: AiObservation): AiCandidates {
  const { factionId, snapshot, fleets, planets } = observation;
  const result: AiCandidates = { economy: [], research: [], repairs: [], movement: [], expansion: [], colonization: [] };
  const economy = snapshot.factionEconomies.find((e) => e.factionId === factionId);
  const tech = snapshot.technologies.find((t) => t.factionId === factionId);
  const completed = new Set(tech?.completedTechIds ?? []);
  const unlocked = (ids: string[]) => ids.length === 0 || ids.some((id) => completed.has(id));
  const affordable = (cost: Partial<ResourceCounts>) => !!economy && RESOURCE_KINDS.every((r) => economy.stockpiles[r] >= (cost[r] ?? 0));
  for (const status of tech?.technologies ?? []) {
    if (status.available && !status.completed && !status.active) result.research.push({ type: "setActiveTechnology", techId: status.id });
  }
  function buildingCandidates(planet: PlanetState, area: BuildingSlotArea, slots: PlanetState["buildings"]["city"], subDistrictIndex?: number) {
    const subDistrict = subDistrictIndex === undefined ? undefined : planet.urbanSubDistricts[subDistrictIndex];
    slots.forEach((slot, slotIndex) => {
      if (hasQueuedBuildingTarget(planet, area, slotIndex, subDistrictIndex)) return;
      const kind = getPlanetBuildingKind(slot);
      if (!kind) {
        for (const buildingKind of BUILDING_KINDS) {
          if (BUILDING_DEFINITIONS[buildingKind].autoPlaced || !isBuildingCompatible(buildingKind, area, subDistrict?.kind) ||
            !unlocked(getRequiredTechIdsForBuilding(buildingKind)) || !affordable(getBuildingCost(buildingKind))) continue;
          result.economy.push({ type: "buildPlanetBuilding", planetId: planet.id, area, slotIndex, subDistrictIndex, buildingKind });
        }
      } else {
        const targetLevel = getBuildingUpgradeTargetLevel(slot);
        if (targetLevel && meetsCapitalUpgradePopulation(kind, targetLevel, planet.population) && unlocked(getRequiredTechIdsForBuildingLevel(kind, targetLevel)) && affordable(getBuildingUpgradeCost(kind, getPlanetBuildingLevel(slot)))) {
          result.economy.push({ type: "upgradePlanetBuilding", planetId: planet.id, area, slotIndex, subDistrictIndex });
        }
        result.economy.push({ type: "setPlanetBuildingEnabled", planetId: planet.id, area, slotIndex, subDistrictIndex, enabled: !isPlanetBuildingEnabled(slot) });
      }
    });
  }
  for (const entry of planets.planets) {
    const planet = entry.planetState;
    if (planet.ownerId !== factionId || !planet.isHabited) continue;
    const limits = getEffectivePlanetDistrictLimits(entry.planet.objectDetails.districtLimits, planet.features);
    for (const districtKind of ["agriculture", "generator", "mining", "city"] as DistrictKind[]) {
      if (planet.builtDistricts[districtKind] + getQueuedDistrictCount(planet, districtKind) < limits[districtKind] && affordable(DISTRICT_COSTS[districtKind])) {
        result.economy.push({ type: "buildDistrict", planetId: planet.id, districtKind });
      }
      buildingCandidates(planet, districtKind, planet.buildings[districtKind]);
    }
    planet.urbanSubDistricts.forEach((sub, index) => buildingCandidates(planet, "urbanSubDistrict", sub.buildings, index));
  }
  for (const quote of observation.market.resources) {
    if (economy && economy.stockpiles.energy >= quote.buyPrice) result.economy.push({ type: "marketTrade", resourceId: quote.resourceId, tradeType: "buy", amount: 1 });
    if (quote.ownedAmount >= 1) result.economy.push({ type: "marketTrade", resourceId: quote.resourceId, tradeType: "sell", amount: 1 });
  }
  const ownedFleets = fleets.fleets.filter((f) => f.ownerId === factionId && observation.commandLinks[f.id] && !f.retreatState && f.phase === "idle");
  const shipsById = new Map(fleets.ships.map((s) => [s.id, s]));
  const owners = new Map(snapshot.starOwnership);
  const known = new Set(snapshot.knownStarIds ?? []);
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of snapshot.hyperlanes) {
    adjacency.set(a, [...adjacency.get(a) ?? [], b]); adjacency.set(b, [...adjacency.get(b) ?? [], a]);
  }
  for (const fleet of ownedFleets) {
    const members = fleet.shipIds.map((id) => shipsById.get(id));
    const construction = members.some((s) => s?.shipKind === "constructionShip");
    const colonizer = members.some((s) => s?.shipKind === "colonizationShip");
    const destinations = new Set<number>([fleet.currentStarId]);
    const queue = [fleet.currentStarId];
    for (let i = 0; i < queue.length; i++) {
      for (const target of adjacency.get(queue[i]) ?? []) {
        if (!known.has(target) || destinations.has(target)) continue;
        const owner = owners.get(target) ?? -1;
        const country = observation.diplomacy.countries.find((c) => c.faction.id === owner);
        if (owner >= 0 && owner !== factionId && country?.theirBorderPolicy !== "open" && !country?.atWar) continue;
        destinations.add(target); queue.push(target);
      }
    }
    for (const targetStarId of Array.from(destinations).sort((a, b) => a - b)) {
      if (targetStarId !== fleet.currentStarId) result.movement.push({ type: "moveFleet", fleetId: fleet.id, targetStarId });
      if (construction && affordable(OUTPOST_CONSTRUCTION_COST) && (owners.get(targetStarId) ?? -1) < 0 && !fleets.starbases.some((s) => s.starId === targetStarId)) {
        result.expansion.push({ type: "buildStarbase", fleetId: fleet.id, targetStarId });
      }
    }
    if (colonizer) {
      for (const entry of planets.planets) {
        if (!entry.planetState.isHabited && entry.colonizationEligibility?.eligible && destinations.has(entry.starId)) result.colonization.push({ type: "colonizePlanet", fleetId: fleet.id, planetId: entry.planetState.id });
      }
    }
    if (construction) {
      for (const target of ownedFleets) {
        if (target.id === fleet.id || target.currentStarId !== fleet.currentStarId) continue;
        if (target.shipIds.some((id) => { const s = shipsById.get(id); return !!s && (s.hull < s.maxHull || s.armor < s.maxArmor || s.shield < s.maxShield || s.subsystemState?.engineDisabled || (s.subsystemState?.disabledWeaponKeys.length ?? 0) > 0); })) {
          result.repairs.push({ type: "repairFleet", constructionFleetId: fleet.id, targetFleetId: target.id });
        }
      }
    }
  }
  return result;
}
