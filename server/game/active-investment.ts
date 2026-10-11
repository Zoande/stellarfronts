import { RESOURCE_KINDS, PLANET_DEFENSE_BUILDING_DEFINITIONS, getPlanetBuildingKind, type ResourceCounts } from "../../src/data/Economy";
import { OUTPOST_CONSTRUCTION_COST, STARBASE_BUILDING_DEFINITIONS, STARBASE_LEVEL_DEFINITIONS } from "../../src/data/Starbase";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import type { AiObservation } from "./ai-observation";
import { getAiCandidates } from "./ai-candidates";
import type { GameAction } from "./actions";
import type { ActiveEpisode } from "./types";
import { aiActionCost, aiResourceReserve, decidePassive } from "./passive";
import { developmentForecast, jobLockKey, workforceForecast } from "./active-economy";
import { hasPeaceExpansionGoal } from "./active-strategy";
import { tradeBudget } from "./active-trade";

const FLOORS: ResourceCounts = { food: 300, minerals: 700, energy: 1000, goods: 300, alloys: 500, research: 0 };
const COMMODITIES = ["food", "minerals", "goods", "alloys"] as const;
const PROJECTS = new Set(["buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding", "buildPlanetDefenseBuilding", "buildStarbase", "buildStarbaseBuilding", "buildStarbaseShip", "buildPlanetShip"]);

/** Counterfactual affordability is advisory only. Real commands and actual
 * reserve checks still use the original detached observation and inventory. */
export function projectPlanningView(observation: AiObservation): AiObservation {
  return { ...observation, snapshot: { ...observation.snapshot, factionEconomies: observation.snapshot.factionEconomies.map((entry) => entry.factionId === observation.factionId
    ? { ...entry, stockpiles: Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, 1e12])) as ResourceCounts } : entry) } };
}

function projectUpkeep(observation: AiObservation, project: GameAction): Partial<ResourceCounts> {
  const change = developmentForecast(observation, project);
  if (change) return Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, -change[resource]]));
  if (project.type === "buildStarbaseShip" || project.type === "buildPlanetShip") {
    const design = observation.fleets.shipDesigns.find((entry) => entry.id === project.designId && entry.ownerId === observation.factionId);
    if (!design) return { energy: Infinity };
    const multiplier = Math.max(observation.newShipUpkeepMultiplier, ...Object.values(observation.fleetUpkeepMultipliers));
    const upkeep = calculateShipDesignStats(design).upkeep;
    return Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, upkeep[resource] * multiplier]));
  }
  if (project.type === "buildStarbase") return STARBASE_LEVEL_DEFINITIONS.outpost.upkeep;
  if (project.type === "buildStarbaseBuilding") return STARBASE_BUILDING_DEFINITIONS[project.buildingKind].upkeep;
  if (project.type === "buildPlanetDefenseBuilding") return PLANET_DEFENSE_BUILDING_DEFINITIONS[project.buildingKind].levels[1].upkeep;
  return {};
}

/** Relative to ordinary consumption and protected stocks, not resource units
 * alone. A large mineral stock still has value when it funds the next outpost. */
export function resourceAllocation(observation: AiObservation) {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId)!;
  const expansion = hasPeaceExpansionGoal(observation);
  const pending = aiResourceReserve(observation, undefined, true);
  return Object.fromEntries(RESOURCE_KINDS.filter((resource) => resource !== "research").map((resource) => {
    const consumption = observation.planets.planets.filter(({ planetState }) => planetState.ownerId === observation.factionId)
      .reduce((sum, { planetState }) => sum + planetState.economy.upkeep[resource], 0);
    const threshold = Math.max(FLOORS[resource] * 2, consumption * 6, pending[resource])
      + (expansion ? OUTPOST_CONSTRUCTION_COST[resource] : 0);
    return [resource, { threshold, stockToThreshold: economy.stockpiles[resource] / Math.max(1, threshold),
      surplus: Math.max(0, economy.stockpiles[resource] - threshold), net: economy.monthlyDelta[resource] }];
  }));
}

/** Release only AI-created staffing reservations. A healthy mineral surplus
 * can give way to research or less abundant production without a shortage.
 * Keeping profitable output is preferable to disabling it merely to flatten
 * stockpiles, so require a useful worker transfer and sustainable trade. */
export function activeAllocationAction(observation: AiObservation, episode: ActiveEpisode): GameAction | undefined {
  if (!episode.managedJobLocks?.length) return;
  const allocation = resourceAllocation(observation);
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId)!;
  const atWar = observation.diplomacy.countries.some((country) => country.atWar);
  for (const { planetState } of observation.planets.planets.filter(({ planetState }) => planetState.ownerId === observation.factionId)) {
    for (const lock of planetState.jobLocks) {
      const action = { type: "setPlanetJobLock", planetId: planetState.id, job: lock.job, locked: false } as const;
      if (!episode.managedJobLocks?.includes(jobLockKey(action))) continue;
      const change = workforceForecast(observation, action);
      if (!change || atWar && change.alloys < -1) continue;
      const reduced = Object.entries(allocation).filter(([resource]) => change[resource as keyof ResourceCounts] < -1);
      if (!reduced.length || reduced.some(([resource, data]) => data.stockToThreshold < 2
        || economy.monthlyDelta[resource as keyof ResourceCounts] + change[resource as keyof ResourceCounts] < 5)) continue;
      const abundant = Math.min(...reduced.map(([, data]) => data.stockToThreshold));
      const useful = change.research > 1 || Object.entries(allocation).some(([resource, data]) =>
        change[resource as keyof ResourceCounts] > 1 && data.stockToThreshold * 2 < abundant);
      if (useful && tradeBudget(observation, Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, -change[resource]]))).sustainable) return action;
    }
  }
}

/** Diversify healthy economies as well as repair shortages. More research is
 * useful even when every commodity is positive. Forecasts must retain basic
 * reserves or profitable recurring trade; speculative unlimited-stock plans
 * are never enough to authorize an otherwise harmful project. */
export function activeInvestmentProject(observation: AiObservation, episode: ActiveEpisode): GameAction | undefined {
  if (!tradeBudget(observation).sustainable) return;
  const projected = projectPlanningView(observation), candidates = getAiCandidates(projected);
  const ordinary = decidePassive(projected, structuredClone(episode), true, candidates).find(({ action }) => PROJECTS.has(action.type))?.action;
  const military = ordinary && (ordinary.type === "buildStarbaseShip" || ordinary.type === "buildPlanetShip")
    && ["corvette", "destroyer", "cruiser", "battleship"].includes(ordinary.shipKind);
  if (ordinary && !military) return ordinary;
  if (observation.diplomacy.countries.some((country) => country.atWar) || hasPeaceExpansionGoal(observation)
    || observation.snapshot.clock.year < (episode.nextInvestmentYear ?? 0)) return ordinary;
  const allocation = resourceAllocation(observation);
  if (!Object.values(allocation).some((resource) => resource.surplus > 100 && resource.net > 0)) return ordinary;
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId)!;
  const ranked = Object.entries(allocation).sort((a, b) => a[1].stockToThreshold - b[1].stockToThreshold);
  const priorities = [...ranked.filter(([, data]) => data.stockToThreshold * 2 < ranked.at(-1)![1].stockToThreshold).map(([resource]) => resource), "research"];
  const projects = candidates.economy.filter((action) => action.type === "buildPlanetBuilding" || action.type === "upgradePlanetBuilding" || action.type === "buildDistrict").flatMap((action) => {
    const planet = observation.planets.planets.find(({ planetState }) => planetState.id === action.planetId)?.planetState;
    if (!planet || planet.constructionQueue.length >= 2) return [];
    const slots = action.type === "buildDistrict" ? undefined : action.area === "urbanSubDistrict" ? planet.urbanSubDistricts[action.subDistrictIndex ?? -1]?.buildings : planet.buildings[action.area];
    const kind = action.type === "buildDistrict" ? ({ agriculture: "foodProcessingPlant", mining: "mineralPurificationPlant", generator: "energyGrid" } as Record<string, string>)[action.districtKind]
      : action.type === "buildPlanetBuilding" ? action.buildingKind : getPlanetBuildingKind(slots?.[action.slotIndex]);
    const focus = ({ foodProcessingPlant: "food", mineralPurificationPlant: "minerals", energyGrid: "energy", civilianFabricators: "goods", alloyFoundries: "alloys", researchLabs: "research" } as Record<string, keyof ResourceCounts>)[kind ?? ""];
    if (!focus || !priorities.includes(focus) || planet.constructionQueue.some((item) => item.buildingKind === kind
      || action.type === "buildDistrict" && item.districtKind === action.districtKind)) return [];
    if ([...Object.values(planet.buildings).flat(), ...planet.urbanSubDistricts.flatMap((entry) => entry.buildings)]
      .some((slot) => slot && typeof slot !== "string" && slot.enabled === false && getPlanetBuildingKind(slot) === kind)) return [];
    const change = developmentForecast(observation, action);
    if (!change || change[focus as keyof ResourceCounts] <= 1 || !tradeBudget(observation, projectUpkeep(observation, action)).sustainable) return [];
    if (["food", "minerals", "energy", "goods"] .some((resource) => economy.monthlyDelta[resource as keyof ResourceCounts] + change[resource as keyof ResourceCounts] < 0
      && economy.stockpiles[resource as keyof ResourceCounts] < FLOORS[resource as keyof ResourceCounts] * 2)) return [];
    const cost = aiActionCost(observation, action);
    const value = change[focus as keyof ResourceCounts] / Math.max(1, (cost.minerals ?? 0) + (cost.energy ?? 0) + (cost.goods ?? 0) * 2);
    return [{ action, value, priority: priorities.indexOf(focus) }];
  });
  return projects.sort((a, b) => a.priority - b.priority || b.value - a.value)[0]?.action ?? ordinary;
}

/** Convert genuinely available surplus into the selected project. Reserve its
 * inputs, existing queues, six months of forecast deficits and peace expansion
 * funds before selling. A single real trade is issued per decision. */
export function fundActiveProject(observation: AiObservation, project: GameAction): GameAction | undefined {
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === observation.factionId)!;
  const extra = projectUpkeep(observation, project);
  if (!tradeBudget(observation, extra).sustainable) return;
  const cost = aiActionCost(observation, project), reserve = aiResourceReserve(observation, project, true);
  const expansion = project.type !== "buildStarbase" && hasPeaceExpansionGoal(observation);
  const targets = Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, (cost[resource] ?? 0) + Math.max(reserve[resource], FLOORS[resource],
    -(economy.monthlyDelta[resource] - (extra[resource] ?? 0)) * 6) + (expansion ? OUTPOST_CONSTRUCTION_COST[resource] : 0)])) as ResourceCounts;
  const missing = COMMODITIES.filter((resource) => economy.stockpiles[resource] + 1e-6 < targets[resource]);
  if (!missing.length && economy.stockpiles.energy >= targets.energy) return;
  const quotes = new Map(observation.market.resources.map((quote) => [quote.resourceId, quote]));
  const purchaseCost = missing.reduce((sum, resource) => sum + (targets[resource] - economy.stockpiles[resource]) * (quotes.get(resource)?.buyPrice ?? Infinity) * 1.3, 0);
  if (missing.length && economy.stockpiles.energy >= targets.energy + purchaseCost) {
    const resource = missing[0];
    return { type: "marketTrade", resourceId: resource, tradeType: "buy", amount: Math.ceil(targets[resource] - economy.stockpiles[resource]) };
  }
  const atWar = observation.diplomacy.countries.some((country) => country.atWar);
  const allocation = resourceAllocation(observation);
  const sales = COMMODITIES.filter((resource) => economy.monthlyDelta[resource] > 0).map((resource) => {
    const threshold = Math.max(targets[resource], allocation[resource].threshold, FLOORS[resource] * (atWar && resource === "alloys" ? 4 : 2));
    return { resource, amount: Math.floor(economy.stockpiles[resource] - threshold), price: quotes.get(resource)?.sellPrice ?? 0 };
  }).filter((sale) => sale.amount > 100 && sale.price > 0).sort((a, b) => b.amount * b.price - a.amount * a.price);
  const sale = sales[0];
  if (sale) return { type: "marketTrade", resourceId: sale.resource, tradeType: "sell", amount: Math.min(500, sale.amount) };
}
