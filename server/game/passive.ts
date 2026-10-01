import { DISTRICT_COSTS, RESOURCE_KINDS, getBuildingCost, getBuildingUpgradeCost, getPlanetBuildingKind, getPlanetBuildingLevel, getEffectivePlanetDistrictLimits, getQueuedDistrictCount } from "../../src/data/Economy";
import type { ResourceCounts } from "../../src/data/Economy";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import { OUTPOST_CONSTRUCTION_COST, STARBASE_BUILDING_DEFINITIONS } from "../../src/data/Starbase";
import { TECHNOLOGY_BY_ID } from "../../src/data/Technology";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { AiObservation } from "./ai-observation";
import { getAiCandidates } from "./ai-candidates";
import type { GameAction } from "./actions";
import { createCaretakerEpisode, decideCaretaker } from "./caretaker";
import type { CaretakerDecision } from "./caretaker";
import type { PassiveEpisode } from "./types";

export const PASSIVE_AFK_MS = 5 * 24 * 60 * 60 * 1000;
export const PASSIVE_MILITARY_UPKEEP_SHARE = 0.2;
export const PASSIVE_OUTPOST_DAYS = 90;
export const PASSIVE_COLONY_DAYS = 360;
const MILITARY_KINDS = new Set(["corvette", "destroyer", "cruiser", "battleship", "defensePlatform"]);

export function createPassiveEpisode(observation: AiObservation, accountId: number | null, lastActivityAt: number, realNow: number): PassiveEpisode {
  return { ...createCaretakerEpisode(observation, accountId ?? -1, lastActivityAt, realNow),
    source: accountId === null ? "unclaimed" : "afk", nextOutpostYear: observation.snapshot.clock.year,
    nextColonyYear: observation.snapshot.clock.year, nextDevelopmentYear: observation.snapshot.clock.year, nextShipYear: observation.snapshot.clock.year };
}

function economyOf(observation: AiObservation) {
  return observation.snapshot.factionEconomies.find((economy) => economy.factionId === observation.factionId);
}

function actionCost(observation: AiObservation, action: GameAction): Partial<ResourceCounts> {
  if (action.type === "buildDistrict") return DISTRICT_COSTS[action.districtKind];
  if (action.type === "buildPlanetBuilding") return getBuildingCost(action.buildingKind);
  if (action.type === "buildStarbase") return OUTPOST_CONSTRUCTION_COST;
  if (action.type === "buildStarbaseBuilding") return STARBASE_BUILDING_DEFINITIONS[action.buildingKind].cost;
  if (action.type === "buildStarbaseShip" || action.type === "buildPlanetShip") {
    const design = observation.fleets.shipDesigns.find((design) => design.id === action.designId && design.ownerId === observation.factionId);
    return design ? calculateShipDesignStats(design).cost : { energy: Infinity };
  }
  if (action.type === "upgradePlanetBuilding") {
    const planet = observation.planets.planets.find((entry) => entry.planetState.id === action.planetId)?.planetState;
    const slots = action.area === "urbanSubDistrict" ? planet?.urbanSubDistricts[action.subDistrictIndex ?? -1]?.buildings : planet?.buildings[action.area];
    const slot = slots?.[action.slotIndex];
    const kind = getPlanetBuildingKind(slot);
    return kind ? getBuildingUpgradeCost(kind, getPlanetBuildingLevel(slot)) : { energy: Infinity };
  }
  return {};
}

/** Elective growth retains construction funds and six months of recurring deficits. */
function affordableWithReserve(observation: AiObservation, action: GameAction): boolean {
  const economy = economyOf(observation);
  if (!economy) return false;
  const cost = actionCost(observation, action);
  const floors: Partial<ResourceCounts> = { energy: 500, minerals: 550, food: 100, goods: 100, alloys: 200 };
  const pendingCosts = Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, 0])) as ResourceCounts;
  for (const item of [
    ...observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId).flatMap((base) => base.shipQueue),
    ...observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId).flatMap((entry) => entry.planetState.defense.shipQueue),
  ]) for (const resource of RESOURCE_KINDS) pendingCosts[resource] += item.remainingDays
    * (item.resourceUpkeepPerDay?.[resource] ?? (resource === "alloys" ? item.alloyUpkeepPerDay : 0));
  return RESOURCE_KINDS.every((resource) => economy.stockpiles[resource] - (cost[resource] ?? 0)
    >= pendingCosts[resource] + Math.max(floors[resource] ?? 0, -economy.monthlyDelta[resource] * 6));
}

function healthy(observation: AiObservation): boolean {
  const economy = economyOf(observation);
  return !!economy && (["energy", "minerals", "food", "goods", "alloys"] as const).every((resource) =>
    economy.stockpiles[resource] > 0 && (economy.monthlyDelta[resource] >= 0
      || economy.stockpiles[resource] >= -economy.monthlyDelta[resource] * 6))
    && !observation.planets.planets.some((entry) => entry.planetState.ownerId === observation.factionId
      && entry.planetState.economy.populationDecline.active && entry.planetState.economy.populationDecline.cause === "famine");
}

function researchAction(observation: AiObservation, candidates: ReturnType<typeof getAiCandidates>): GameAction | undefined {
  const technology = observation.snapshot.technologies.find((entry) => entry.factionId === observation.factionId);
  if (technology?.technologies.some((entry) => entry.id === technology.activeTechId && !entry.completed)) return;
  const economy = economyOf(observation);
  const categories = economy && economy.monthlyDelta.food < 0 ? ["agriculture", "energy", "industry", "logistics", "computing", "society", "military"]
    : ["industry", "energy", "agriculture", "logistics", "computing", "society", "military"];
  return [...candidates.research].sort((a, b) => {
    if (a.type !== "setActiveTechnology" || b.type !== "setActiveTechnology") return 0;
    const aa = TECHNOLOGY_BY_ID[a.techId]; const bb = TECHNOLOGY_BY_ID[b.techId];
    return aa.tier - bb.tier || categories.indexOf(aa.category) - categories.indexOf(bb.category) || aa.cost - bb.cost || a.techId.localeCompare(b.techId);
  })[0];
}

function fundFamineConstruction(observation: AiObservation, candidates: ReturnType<typeof getAiCandidates>): GameAction | undefined {
  const economy = economyOf(observation);
  const cost = DISTRICT_COSTS.agriculture;
  const owned = observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId && entry.planetState.isHabited);
  if (!economy || !owned.some((entry) => entry.planetState.economy.populationDecline.active
    && entry.planetState.economy.populationDecline.cause === "famine")
    || owned.some((entry) => getQueuedDistrictCount(entry.planetState, "agriculture") > 0)
    || !owned.some((entry) => entry.planetState.builtDistricts.agriculture < getEffectivePlanetDistrictLimits(entry.planet.objectDetails.districtLimits, entry.planetState.features).agriculture)) return;
  if (economy.stockpiles.food >= cost.food) return economy.stockpiles.energy >= cost.energy + 150
    ? candidates.economy.find((action) => action.type === "buildDistrict" && action.districtKind === "agriculture") : undefined;
  if (RESOURCE_KINDS.some((resource) => resource !== "food" && resource !== "energy" && economy.stockpiles[resource] < cost[resource])) return;
  const buy = candidates.economy.find((action) => action.type === "marketTrade" && action.tradeType === "buy" && action.resourceId === "food");
  const quote = observation.market.resources.find((quote) => quote.resourceId === "food");
  if (!buy || !quote) return;
  // Reserve the district's food plus time for the next decision. A general
  // stockpile target must not trap the controller buying tiny rations forever.
  const amount = Math.ceil(cost.food + Math.max(25, -economy.monthlyDelta.food / 30 + 5) - economy.stockpiles.food);
  if (economy.stockpiles.energy < cost.energy + amount * quote.buyPrice * 1.3 + 150) return;
  return { type: "marketTrade", resourceId: "food", tradeType: "buy", amount };
}

function developmentAction(observation: AiObservation, candidates: ReturnType<typeof getAiCandidates>): GameAction | undefined {
  const economy = economyOf(observation);
  if (!economy) return;
  const resources = [...(["food", "energy", "minerals", "goods", "alloys"] as const)].sort((a, b) =>
    (economy.monthlyDelta[a] < 0 ? economy.stockpiles[a] / -economy.monthlyDelta[a] : 100 + economy.monthlyDelta[a])
    - (economy.monthlyDelta[b] < 0 ? economy.stockpiles[b] / -economy.monthlyDelta[b] : 100 + economy.monthlyDelta[b]));
  for (const resource of resources) {
    const kind = resource === "food" ? "agriculture" : resource === "energy" ? "generator" : resource === "minerals" ? "mining" : null;
    const buildingKind = resource === "food" ? "foodProcessingPlant" : resource === "energy" ? "energyGrid"
      : resource === "minerals" ? "mineralPurificationPlant" : resource === "goods" ? "civilianFabricators" : "alloyFoundries";
    const needsProduction = economy.monthlyDelta[resource] < 0 || economy.stockpiles[resource] < ({ food: 500, energy: 1000, minerals: 2000, goods: 300, alloys: 500 }[resource]);
    if (!needsProduction) continue;
    const candidate = candidates.economy.find((action) => {
      if (!(action.type === "buildDistrict" && action.districtKind === kind || action.type === "buildPlanetBuilding" && action.buildingKind === buildingKind)) return false;
      const planet = observation.planets.planets.find((entry) => entry.planetState.id === action.planetId)?.planetState;
      if (!planet || planet.constructionQueue.length >= 2 || !affordableWithReserve(observation, action)) return false;
      if (planet.constructionQueue.some((item) => item.districtKind === kind && kind !== null || item.buildingKind === buildingKind)) return false;
      return economy.monthlyDelta[resource] < 0 || planet.economy.unemployedPopulation >= 250_000_000;
    });
    if (candidate) return candidate;
  }
  return candidates.economy.find((action) => {
    if (action.type !== "buildDistrict" || action.districtKind !== "city" || !affordableWithReserve(observation, action)) return false;
    const planet = observation.planets.planets.find((entry) => entry.planetState.id === action.planetId)?.planetState;
    return !!planet && planet.constructionQueue.length < 2 && planet.population > planet.economy.housing * 0.9
      && !planet.constructionQueue.some((item) => item.districtKind === "city");
  });
}

/** Includes player queues and accepted receipts whose intelligence has not caught up. */
function pendingShips(observation: AiObservation, episode: PassiveEpisode) {
  const queue = new Map<string, { shipKind: string; designId: string | null }>();
  for (const item of [
    ...observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId).flatMap((base) => base.shipQueue),
    ...observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId).flatMap((entry) => entry.planetState.defense.shipQueue),
  ]) if (item.kind === "build") queue.set(item.id, { shipKind: item.shipKind, designId: item.designId ?? null });
  for (const [id, item] of Object.entries(episode.queuedShips)) queue.set(id, item);
  const observed = new Set(observation.fleets.ships.map((ship) => ship.id));
  for (const [id, item] of Object.entries(episode.reinforcements)) if (!observed.has(id)) queue.set(`completed:${id}`, item);
  return [...queue.values()];
}

function shipAction(observation: AiObservation, episode: PassiveEpisode, candidates: ReturnType<typeof getAiCandidates>): CaretakerDecision | undefined {
  const pending = pendingShips(observation, episode);
  if (pending.length >= 2) return;
  const ownShips = observation.fleets.ships.filter((ship) => ship.ownerId === observation.factionId && ship.hull > 0);
  const owners = new Map(observation.snapshot.starOwnership);
  const knownColony = observation.planets.planets.some((entry) => !entry.planetState.isHabited && entry.colonizationEligibility?.eligible && owners.get(entry.starId) === observation.factionId);
  const supportKind = !ownShips.some((ship) => ship.shipKind === "constructionShip") && !pending.some((ship) => ship.shipKind === "constructionShip") ? "constructionShip"
    : knownColony && !ownShips.some((ship) => ship.shipKind === "colonizationShip") && !pending.some((ship) => ship.shipKind === "colonizationShip") ? "colonizationShip" : null;
  const recurring = { energy: 0, alloys: 0 };
  const military = { energy: 0, alloys: 0 };
  for (const entry of observation.planets.planets.filter((entry) => entry.planetState.ownerId === observation.factionId && entry.planetState.isHabited)) {
    recurring.energy += entry.planetState.economy.production.energy; recurring.alloys += entry.planetState.economy.production.alloys;
  }
  for (const base of observation.fleets.starbases.filter((base) => base.ownerId === observation.factionId && base.status === "online")) {
    recurring.energy += base.economy.production.energy; recurring.alloys += base.economy.production.alloys;
  }
  for (const ship of [...ownShips, ...pending].filter((ship) => MILITARY_KINDS.has(ship.shipKind))) {
    const design = observation.fleets.shipDesigns.find((design) => design.id === ship.designId && design.ownerId === observation.factionId);
    if (!design) return; // Unknown upkeep never licenses additional spending.
    const upkeep = calculateShipDesignStats(design).upkeep;
    const multiplier = "fleetId" in ship ? observation.fleetUpkeepMultipliers[ship.fleetId] ?? observation.newShipUpkeepMultiplier : observation.newShipUpkeepMultiplier;
    military.energy += upkeep.energy * multiplier; military.alloys += upkeep.alloys * multiplier;
  }
  for (const action of candidates.ships) {
    if (action.type !== "buildStarbaseShip" && action.type !== "buildPlanetShip" || !affordableWithReserve(observation, action)) continue;
    if (supportKind ? action.shipKind !== supportKind : !MILITARY_KINDS.has(action.shipKind)) continue;
    const design = observation.fleets.shipDesigns.find((design) => design.id === action.designId)!;
    const stats = calculateShipDesignStats(design);
    const upkeepMultiplier = Math.max(observation.newShipUpkeepMultiplier, ...Object.values(observation.fleetUpkeepMultipliers));
    const economy = economyOf(observation)!;
    if (RESOURCE_KINDS.some((resource) => stats.upkeep[resource] > 0 && (economy.monthlyDelta[resource] - stats.upkeep[resource] * upkeepMultiplier < 0
      || economy.stockpiles[resource] - stats.cost[resource] < stats.upkeep[resource] * upkeepMultiplier * 6))) continue;
    if (!supportKind && (["energy", "alloys"] as const).some((resource) => military[resource] + stats.upkeep[resource] * upkeepMultiplier > recurring[resource] * PASSIVE_MILITARY_UPKEEP_SHARE)) continue;
    const target = !supportKind && observation.fleets.fleets.find((fleet) => fleet.ownerId === observation.factionId
      && !fleet.stationaryStarbaseId && !fleet.stationaryPlanetId && fleet.shipIds.some((id) => ownShips.some((ship) => ship.id === id && MILITARY_KINDS.has(ship.shipKind))));
    const fleetId = target ? target.id : `passive-${observation.factionId}-${supportKind ?? "reserve"}`;
    if (!episode.fleets.some((fleet) => fleet.fleetId === fleetId)) episode.fleets.push({ fleetId, ships: [] });
    return { action, replacementForFleetId: fleetId };
  }
}

/** Passive controllers only receive the same detached country information as players. */
export function decidePassive(observation: AiObservation, episode: PassiveEpisode): CaretakerDecision[] {
  const year = observation.snapshot.clock.year;
  const candidates = getAiCandidates(observation);
  let decisions = decideCaretaker(observation, episode).filter(({ action }) =>
    action.type !== "buildStarbase" && action.type !== "buildStarbaseShip" && action.type !== "buildPlanetShip");
  const famineFunding = fundFamineConstruction(observation, candidates);
  if (famineFunding) decisions = [...decisions.filter(({ action }) => !["marketTrade", "buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding"].includes(action.type)), { action: famineFunding }];
  const research = researchAction(observation, candidates);
  if (research) decisions.push({ action: research });
  const hasEconomyAction = decisions.some(({ action }) => ["marketTrade", "buildDistrict", "buildPlanetBuilding", "upgradePlanetBuilding"].includes(action.type));
  if (!hasEconomyAction && year + 1e-9 >= episode.nextDevelopmentYear) {
    const development = developmentAction(observation, candidates);
    if (development) decisions.push({ action: development });
  }
  const atWar = observation.diplomacy.countries.some((country) => country.atWar);
  if (!healthy(observation) || hasEconomyAction) return decisions;
  // One elective expense per decision keeps all reserve checks on a current view.
  if (decisions.some(({ action }) => action.type === "buildDistrict" || action.type === "buildPlanetBuilding")) return decisions;
  if (year + 1e-9 >= episode.nextShipYear) {
    const ship = shipAction(observation, episode, candidates);
    if (ship) return [...decisions, ship];
    const hasYard = candidates.ships.length > 0 || observation.fleets.starbases.some((base) => base.ownerId === observation.factionId && base.buildingSlots.includes("shipyard"))
      || observation.planets.planets.some((entry) => entry.planetState.ownerId === observation.factionId && entry.planetState.defense.shipyardSlots.some((slot) => slot?.kind === "orbitalShipyard"));
    const queuedYard = observation.fleets.starbases.some((base) => base.ownerId === observation.factionId && base.constructionQueue.some((item) => item.buildingKind === "shipyard"));
    const yard = !hasYard && !queuedYard && candidates.infrastructure.find((action) => affordableWithReserve(observation, action));
    if (yard) return [...decisions, { action: yard }];
  }
  if (atWar) return decisions;
  const owners = new Map(observation.snapshot.starOwnership);
  if (year + 1e-9 >= episode.nextColonyYear) {
    const colony = candidates.colonization.find((action) => action.type === "colonizePlanet"
      && owners.get(observation.planets.planets.find((entry) => entry.planetState.id === action.planetId)?.starId ?? -1) === observation.factionId);
    if (colony) return [...decisions, { action: colony }];
  }
  if (year + 1e-9 >= episode.nextOutpostYear) {
    const busy = new Set(decisions.flatMap(({ action }) => action.type === "repairFleet" ? [action.constructionFleetId] : action.type === "moveFleet" ? [action.fleetId] : []));
    const outpost = candidates.expansion.find((action) => action.type === "buildStarbase" && !!action.fleetId && !busy.has(action.fleetId)
      && !episode.repairOrders?.[action.fleetId] && affordableWithReserve(observation, action)
      && observation.snapshot.hyperlanes.some(([a, b]) => a === action.targetStarId && owners.get(b) === observation.factionId || b === action.targetStarId && owners.get(a) === observation.factionId)
      && !observation.fleets.fleets.some((fleet) => fleet.ownerId === observation.factionId && fleet.orderType === "build" && fleet.targetStarId === action.targetStarId));
    if (outpost) decisions.push({ action: outpost });
  }
  return decisions;
}

/** Only accepted commands consume policy cooldowns. */
export function recordPassiveAcceptance(episode: PassiveEpisode, action: GameAction, year: number): void {
  if (action.type === "buildStarbase") episode.nextOutpostYear = year + PASSIVE_OUTPOST_DAYS / GAME_DAYS_PER_YEAR;
  if (action.type === "colonizePlanet") episode.nextColonyYear = year + PASSIVE_COLONY_DAYS / GAME_DAYS_PER_YEAR;
  if (action.type === "buildDistrict" || action.type === "buildPlanetBuilding" || action.type === "upgradePlanetBuilding" || action.type === "buildStarbaseBuilding") episode.nextDevelopmentYear = year + 30 / GAME_DAYS_PER_YEAR;
  if (action.type === "buildStarbaseShip" || action.type === "buildPlanetShip" || action.type === "buildStarbaseBuilding") episode.nextShipYear = year + 30 / GAME_DAYS_PER_YEAR;
}
