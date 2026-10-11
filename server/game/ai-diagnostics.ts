import { countPlanetShipyards } from "../../src/data/Economy";
import type { AiObservation } from "./ai-observation";
import type { GameAction } from "./actions";
import { tradeBudget } from "./active-trade";
import { localWarOpportunities, hasPeaceExpansionGoal, hasVisibleMilitaryThreat } from "./active-strategy";
import { getAiCandidates, isAiFleetReady } from "./ai-candidates";
import { STARBASE_BUILDING_DEFINITIONS } from "../../src/data/Starbase";
import { resourceAllocation } from "./active-investment";
import { groundAssessment } from "./active-ground";

export interface AiDecisionRecord {
  factionId: number;
  mode: "caretaker" | "passive" | "active";
  year: number;
  selected: GameAction[];
  stockpiles: Record<string, number>;
  income: Record<string, number>;
  allocation?: ReturnType<typeof resourceAllocation>;
  runwayMonths: Record<string, number | null>;
  trade: ReturnType<typeof tradeBudget>;
  visibleThreat: boolean;
  expansionGoal: boolean;
  candidates: Record<string, number>;
  idleMobileFleets: number;
  localOpportunities: ReturnType<typeof localWarOpportunities>;
  warTag: boolean;
  cooldowns: Record<string, number>;
  ground?: { targets: ReturnType<typeof groundAssessment>["targets"]; requiredAttack: number; mobileAttack: number; pendingAttack: number; mobileArmies: number; pendingArmies: number };
  readiness: {
    trainedCrew: number; onlineShipyards: number; queuedShipyards: number;
    navyHealth: number; largestIdleNavyHealth: number; pausedBuildingCount: number;
    militaryOrdersSinceOutpost: number; shipyardMaterialShortfall: Record<string, number>;
  };
}
/** Laboratory-only diagnostics, computed from the same restricted observation.
 * Candidate counts are advisory; selected actions are the planner's actual output. */
export function aiDecisionRecord(observation: AiObservation, mode: AiDecisionRecord["mode"], selected: GameAction[], warTag: boolean, episode: object): AiDecisionRecord {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId)!;
  const candidates = getAiCandidates(observation);
  const navy = observation.fleets.fleets.filter((fleet) => fleet.ownerId === observation.factionId && !fleet.stationaryPlanetId && !fleet.stationaryStarbaseId)
    .map((fleet) => ({ fleet, health: observation.fleets.ships.filter((ship) => fleet.shipIds.includes(ship.id)
      && ["corvette", "destroyer", "cruiser", "battleship"].includes(ship.shipKind)).reduce((sum, ship) => sum + ship.hull + ship.armor + ship.shield, 0) }));
  const bases = observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId);
  const ownPlanets = observation.planets.planets.filter(({ planetState }) => planetState.ownerId === observation.factionId);
  const memory = episode as { pausedBuildings?: Record<string, number>; militaryOrdersSinceOutpost?: number };
  const ground = groundAssessment(observation, mode === "active" && warTag);
  return { factionId: observation.factionId, mode, year: observation.snapshot.clock.year, selected,
    stockpiles: economy.stockpiles, income: economy.monthlyDelta,
    allocation: resourceAllocation(observation),
    runwayMonths: Object.fromEntries(Object.entries(economy.monthlyDelta).map(([resource, delta]) => [resource, delta < 0 ? economy.stockpiles[resource as keyof typeof economy.stockpiles] / -delta : null])),
    trade: tradeBudget(observation), visibleThreat: hasVisibleMilitaryThreat(observation), expansionGoal: hasPeaceExpansionGoal(observation),
    candidates: Object.fromEntries(Object.entries(candidates).map(([key, actions]) => [key, actions.length])),
    idleMobileFleets: observation.fleets.fleets.filter((fleet) => fleet.ownerId === observation.factionId && !fleet.stationaryPlanetId && !fleet.stationaryStarbaseId && isAiFleetReady(fleet) && fleet.combatStatus === "idle").length,
    localOpportunities: localWarOpportunities(observation), warTag,
    cooldowns: Object.fromEntries(Object.entries(episode).filter(([key, value]) => key.startsWith("next") && typeof value === "number")),
    ground: { targets: ground.targets, requiredAttack: ground.requiredAttack, mobileAttack: ground.mobileAttack, pendingAttack: ground.pendingAttack,
      mobileArmies: ground.own.length, pendingArmies: ground.pending.length },
    readiness: { trainedCrew: economy.crewStockpile,
      onlineShipyards: bases.filter((base) => base.status === "online").reduce((sum, base) => sum + base.buildingSlots.filter((kind) => kind === "shipyard").length, 0)
        + ownPlanets.reduce((sum, { planetState }) => sum + countPlanetShipyards(planetState), 0),
      queuedShipyards: bases.flatMap((base) => base.constructionQueue).filter((item) => item.buildingKind === "shipyard").length
        + ownPlanets.flatMap(({ planetState }) => planetState.constructionQueue).filter((item) => item.defenseBuildingKind === "orbitalShipyard").length,
      navyHealth: navy.reduce((sum, fleet) => sum + fleet.health, 0),
      largestIdleNavyHealth: Math.max(0, ...navy.filter(({ fleet }) => isAiFleetReady(fleet) && fleet.combatStatus === "idle").map((entry) => entry.health)),
      pausedBuildingCount: Object.keys(memory.pausedBuildings ?? {}).length, militaryOrdersSinceOutpost: memory.militaryOrdersSinceOutpost ?? 0,
      shipyardMaterialShortfall: Object.fromEntries(Object.entries(STARBASE_BUILDING_DEFINITIONS.shipyard.cost)
        .map(([resource, cost]) => [resource, Math.max(0, cost - economy.stockpiles[resource as keyof typeof economy.stockpiles])])) },
  };
}
