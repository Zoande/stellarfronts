import { calculatePlanetEconomy, createPlanetBuildingState, DISTRICT_COSTS, DISTRICT_BUILD_DAYS, getEffectivePlanetDistrictLimits, getQueuedDistrictCount, getPlanetBuildingKind, getPlanetBuildingLevel, RESOURCE_KINDS } from "../../src/data/Economy";
import type { PlanetState, ResourceKind } from "../../src/data/Economy";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { AiObservation } from "./ai-observation";
import type { AiCandidates } from "./ai-candidates";
import type { GameAction } from "./actions";
import type { ActiveEpisode } from "./types";

type Toggle = Extract<GameAction, { type: "setPlanetBuildingEnabled" }>;
type JobLock = Extract<GameAction, { type: "setPlanetJobLock" }>;
const BASIC = ["food", "energy", "minerals", "goods"] as const;
const FLOORS = { food: 300, energy: 500, minerals: 700, goods: 300, alloys: 500, research: 0 };
export const buildingKey = (action: Toggle) => JSON.stringify([action.planetId, action.area, action.subDistrictIndex ?? null, action.slotIndex]);
export const jobLockKey = (action: JobLock) => JSON.stringify([action.planetId, action.job]);

/** Job locks retain the currently staffed species allocations, exactly as the
 * player command does. They cannot directly fill an empty job. */
export function workforceForecast(observation: AiObservation, action: JobLock, next?: GameAction) {
  const entry = observation.planets.planets.find((item) => item.planetState.id === action.planetId);
  if (!entry) return;
  const planet = structuredClone(entry.planetState), before = calculatePlanetEconomy(planet);
  planet.jobLocks = planet.jobLocks.filter((lock) => lock.job !== action.job);
  if (action.locked) {
    const allocations = entry.planetState.economy.popGroups.filter((group) => group.job === action.job && group.population > 0)
      .map(({ speciesId, population }) => ({ speciesId, population }));
    if (!allocations.length) return;
    planet.jobLocks.push({ job: action.job, allocations });
  }
  if (next?.type === "setPlanetBuildingEnabled") {
    const slots = next.area === "urbanSubDistrict" ? planet.urbanSubDistricts[next.subDistrictIndex ?? -1]?.buildings : planet.buildings[next.area];
    const slot = slots?.[next.slotIndex], kind = getPlanetBuildingKind(slot);
    if (!slots || !kind) return;
    slots[next.slotIndex] = createPlanetBuildingState(kind, getPlanetBuildingLevel(slot), next.enabled);
  }
  else if (next && !applyDevelopment(planet, next)) return;
  const after = calculatePlanetEconomy(planet);
  return Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, after.net[resource] - before.net[resource]])) as Record<ResourceKind, number>;
}

function applyDevelopment(planet: PlanetState, action: GameAction): boolean {
  if (action.type === "buildDistrict") planet.builtDistricts[action.districtKind]++;
  else if (action.type === "buildPlanetBuilding" || action.type === "upgradePlanetBuilding") {
    const slots = action.area === "urbanSubDistrict" ? planet.urbanSubDistricts[action.subDistrictIndex ?? -1]?.buildings : planet.buildings[action.area];
    if (!slots) return false;
    const old = slots[action.slotIndex], kind = action.type === "buildPlanetBuilding" ? action.buildingKind : getPlanetBuildingKind(old);
    if (!kind) return false;
    slots[action.slotIndex] = createPlanetBuildingState(kind, action.type === "buildPlanetBuilding" ? 1 : getPlanetBuildingLevel(old) + 1);
  } else return false;
  return true;
}

export function developmentForecast(observation: AiObservation, action: GameAction) {
  if (action.type !== "buildDistrict" && action.type !== "buildPlanetBuilding" && action.type !== "upgradePlanetBuilding") return;
  const entry = observation.planets.planets.find((item) => item.planetState.id === action.planetId);
  if (!entry) return;
  const planet = structuredClone(entry.planetState), before = calculatePlanetEconomy(planet);
  if (!applyDevelopment(planet, action)) return;
  const after = calculatePlanetEconomy(planet);
  return Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, after.net[resource] - before.net[resource]])) as Record<ResourceKind, number>;
}

/** Preserve essential staff before construction adds higher-priority job slots.
 * The next decision forecasts the project again with the accepted lock. */
export function protectDevelopmentWorkforce(observation: AiObservation, project: GameAction): JobLock | undefined {
  const estimate = developmentForecast(observation, project);
  if (!estimate || !("planetId" in project)) return;
  const economy = observation.snapshot.factionEconomies.find((item) => item.factionId === observation.factionId);
  const planet = observation.planets.planets.find((entry) => entry.planetState.id === project.planetId)?.planetState;
  if (!economy || !planet) return;
  const jobs = { food: "farmer", energy: "technician", minerals: "miner", goods: "artisan", alloys: "metallurgist" } as const;
  const protectedResources = observation.diplomacy.countries.some((country) => country.atWar) ? [...BASIC, "alloys" as const] : BASIC;
  for (const resource of protectedResources) {
    if (estimate[resource] >= -1 || economy.monthlyDelta[resource] + estimate[resource] >= 5 || planet.jobLocks.some((lock) => lock.job === jobs[resource])) continue;
    const action: JobLock = { type: "setPlanetJobLock", planetId: planet.id, job: jobs[resource], locked: true };
    const change = workforceForecast(observation, action, project);
    if (change && change[resource] > estimate[resource] + 1) return action;
  }
}

export function improvesProduction(observation: AiObservation, action: GameAction, resource: ResourceKind): boolean {
  const economy = observation.snapshot.factionEconomies.find((item) => item.factionId === observation.factionId);
  const change = developmentForecast(observation, action);
  return !!economy && !!change && change[resource] > 1 && BASIC.every((input) => change[input] >= 0
    || economy.monthlyDelta[input] + change[input] >= 0
    || economy.stockpiles[input] >= -(economy.monthlyDelta[input] + change[input]) * 6);
}

/** Marginal forecast from our own visible planet and public rules, not rival state.
 * Government/species modifiers can change the estimate; reserves provide a margin. */
function toggleForecast(observation: AiObservation, action: Toggle) {
  const entry = observation.planets.planets.find((item) => item.planetState.id === action.planetId);
  if (!entry) return;
  const planet = structuredClone(entry.planetState);
  const before = calculatePlanetEconomy(planet);
  const slots = action.area === "urbanSubDistrict" ? planet.urbanSubDistricts[action.subDistrictIndex ?? -1]?.buildings : planet.buildings[action.area];
  const slot = slots?.[action.slotIndex], kind = getPlanetBuildingKind(slot);
  if (!slots || !kind) return;
  slots[action.slotIndex] = createPlanetBuildingState(kind, getPlanetBuildingLevel(slot), action.enabled);
  const after = calculatePlanetEconomy(planet);
  return { kind, change: Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, after.net[resource] - before.net[resource]])) as Record<ResourceKind, number> };
}

/** Preserve strategic output, fund lasting supply, and shed optional demand when
 * inputs run out. Only buildings paused by this episode may be restarted. */
export function activeRecoveryAction(observation: AiObservation, episode: ActiveEpisode, candidates: AiCandidates): GameAction | undefined {
  const economy = observation.snapshot.factionEconomies.find((item) => item.factionId === observation.factionId);
  if (!economy) return;
  const atWar = observation.diplomacy.countries.some((country) => country.atWar);
  const needy = BASIC.filter((resource) => economy.monthlyDelta[resource] < 0
    && economy.stockpiles[resource] < Math.max(FLOORS[resource], -economy.monthlyDelta[resource] * 6))
    .sort((a, b) => economy.stockpiles[a] / -economy.monthlyDelta[a] - economy.stockpiles[b] / -economy.monthlyDelta[b]);
  const toggles = candidates.economy.filter((action): action is Toggle => action.type === "setPlanetBuildingEnabled");
  const jobs = { food: "farmer", energy: "technician", minerals: "miner", goods: "artisan", alloys: "metallurgist" } as const;
  if (!needy.length) {
    // A restart can steal newly freed essential workers. Lock those workers
    // first, then re-evaluate the ordinary restart safeguards next decision.
    for (const restart of toggles.filter((action) => action.enabled && episode.pausedBuildings?.[buildingKey(action)] !== undefined)) {
      if (observation.snapshot.clock.year - episode.pausedBuildings![buildingKey(restart)] < 30 / GAME_DAYS_PER_YEAR) continue;
      const estimate = toggleForecast(observation, restart);
      const planet = observation.planets.planets.find((entry) => entry.planetState.id === restart.planetId)!.planetState;
      for (const resource of atWar ? [...BASIC, "alloys" as const] : BASIC) {
        if (!estimate || economy.monthlyDelta[resource] + estimate.change[resource] >= 5 || planet.jobLocks.some((lock) => lock.job === jobs[resource])) continue;
        const action: JobLock = { type: "setPlanetJobLock", planetId: planet.id, job: jobs[resource], locked: true };
        const change = workforceForecast(observation, action, restart);
        if (change && change[resource] > estimate.change[resource] + 1) return action;
      }
    }
    return toggles.find((action) => {
      const pausedAt = episode.pausedBuildings?.[buildingKey(action)];
      if (!action.enabled || pausedAt === undefined || observation.snapshot.clock.year - pausedAt < 30 / GAME_DAYS_PER_YEAR) return false;
      const estimate = toggleForecast(observation, action);
      return !!estimate && BASIC.every((resource) => economy.stockpiles[resource] >= FLOORS[resource] * 2
        && economy.monthlyDelta[resource] + estimate.change[resource] >= 5)
        && (!atWar || estimate.change.alloys >= -1);
    });
  }
  const urgent = needy[0];
  // Only release locks installed by this episode, and only when the current
  // distribution improves a shortage without sacrificing essential reserves.
  for (const entry of observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId)) {
    for (const lock of entry.planetState.jobLocks) {
      const action: JobLock = { type: "setPlanetJobLock", planetId: entry.planetState.id, job: lock.job, locked: false };
      if (!episode.managedJobLocks?.includes(jobLockKey(action))) continue;
      const change = workforceForecast(observation, action);
      if (change && change[urgent] > 1 && BASIC.every((resource) => economy.monthlyDelta[resource] + change[resource] >= 0
        || economy.stockpiles[resource] >= Math.max(FLOORS[resource], -(economy.monthlyDelta[resource] + change[resource]) * 6))
        && (!atWar || change.alloys >= -1)) return action;
    }
  }
  const supplyKind = urgent === "food" ? "agriculture" : urgent === "energy" ? "generator" : urgent === "minerals" ? "mining" : null;
  const owned = observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId);
  const pending = owned.some((entry) => supplyKind && entry.planetState.constructionQueue.some((item) => item.districtKind === supplyKind));
  const housing = candidates.economy.find((action) => action.type === "buildDistrict" && action.districtKind === "city"
    && owned.some((entry) => entry.planetState.id === action.planetId && entry.planetState.population >= entry.planetState.economy.housing * 0.95
      && !entry.planetState.constructionQueue.some((item) => item.districtKind === "city")) && improvesProduction(observation, action, urgent));
  const construction = housing ?? candidates.economy.find((action) => action.type === "buildDistrict" && action.districtKind === supplyKind && improvesProduction(observation, action, urgent));
  const pause = () => toggles.filter((action) => !action.enabled).map((action) => ({ action, estimate: toggleForecast(observation, action) }))
    .filter(({ estimate }) => estimate && ["alloyFoundries", "civilianFabricators", "researchLabs", "foodProcessingPlant", "mineralPurificationPlant"].includes(estimate.kind)
      && !(atWar && estimate.kind === "alloyFoundries")
      && (!atWar || estimate.change.alloys >= -1)
      && estimate.change[urgent] > 1
      && BASIC.every((resource) => estimate.change[resource] >= 0 || economy.monthlyDelta[resource] + estimate.change[resource] >= 0
        || economy.stockpiles[resource] >= Math.max(FLOORS[resource], -(economy.monthlyDelta[resource] + estimate.change[resource]) * 12))
      && (estimate.kind !== "alloyFoundries" || economy.stockpiles.alloys > FLOORS.alloys))
    .sort((a, b) => b.estimate!.change[urgent] - a.estimate!.change[urgent])[0]?.action;
  // In peace, avoid spending our last energy on perpetual small market rations.
  if (!atWar && economy.stockpiles[urgent] < -economy.monthlyDelta[urgent] * 3) {
    const action = pause(); if (action) return action;
  }
  if (!pending && construction) return construction;
  // A structural workforce shortage may have no productive construction option.
  // Prefer freeing workers to trading forever just above the emergency threshold.
  if (!atWar && !pending && !construction) { const action = pause(); if (action) return action; }
  // Save enough for one productive district and its construction horizon.
  // District candidates are absent until affordable, so inspect visible capacity.
  const capacity = supplyKind && owned.some((entry) => entry.planetState.builtDistricts[supplyKind] + getQueuedDistrictCount(entry.planetState, supplyKind)
    < getEffectivePlanetDistrictLimits(entry.planet.objectDetails.districtLimits, entry.planetState.features)[supplyKind]
    && improvesProduction(observation, { type: "buildDistrict", planetId: entry.planetState.id, districtKind: supplyKind }, urgent));
  const cost = supplyKind && capacity && !pending ? DISTRICT_COSTS[supplyKind] : undefined;
  const funding: ResourceKind = cost && economy.stockpiles.minerals < cost.minerals
    && (urgent === "energy" || economy.stockpiles[urgent] >= -economy.monthlyDelta[urgent] * 2) ? "minerals" : urgent;
  const months = supplyKind && cost ? DISTRICT_BUILD_DAYS[supplyKind] / 30 + 1 : 6;
  const wanted = Math.max(FLOORS[funding], (cost?.[funding] ?? 0) + Math.max(0, -economy.monthlyDelta[funding]) * months);
  const quote = observation.market.resources.find((entry) => entry.resourceId === funding);
  const sale = (["food", "goods", "alloys"] as const).find((resource) => resource !== funding && economy.monthlyDelta[resource] >= 0
    && economy.stockpiles[resource] > FLOORS[resource] * (atWar && resource === "alloys" ? 4 : 2) + 100);
  const sell = (): GameAction | undefined => sale ? { type: "marketTrade", resourceId: sale, tradeType: "sell",
    amount: Math.min(500, Math.floor(economy.stockpiles[sale] - FLOORS[sale] * (atWar && sale === "alloys" ? 4 : 2))) } : undefined;
  if (funding !== "energy" && quote && economy.stockpiles[funding] < wanted) {
    const amount = Math.ceil(wanted - economy.stockpiles[funding]);
    const reserve = Math.max(500, -economy.monthlyDelta.energy * 6) + (cost?.energy ?? 0);
    if (economy.stockpiles.energy >= reserve + amount * quote.buyPrice * 1.3) return { type: "marketTrade", resourceId: funding, tradeType: "buy", amount };
    const action = sell(); if (action) return action;
  }
  if (funding === "energy") { const action = sell(); if (action) return action; }
  return pause();
}
