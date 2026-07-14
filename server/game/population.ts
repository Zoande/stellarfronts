import {
  applyPopulationGrowthFraction,
  calculatePlanetCapacity,
  getAmenityNeed,
  getEffectiveSpeciesHabitability,
  sumSpeciesPopulation,
} from "../../src/data/Economy";
import type { PlanetState, SpeciesPopulation } from "../../src/data/Economy";
import type { SpeciesId } from "../../src/data/Species";
import { applyPlanetStatesToStars } from "../../src/data/StarMap";
import {
  areFactionsAtWar,
  getBorderPolicy,
  getActiveTreatyPartnersForArticle,
  MIGRATION_PACT_ARTICLE_ID,
} from "../../src/data/Diplomacy";
import { calculateLeaderLevel, LEADER_POOL_PER_CLASS, refreshLeaderPool } from "../../src/data/Leaders";
import { GAME_DAYS_PER_WEEK, GAME_DAYS_PER_QUARTER, GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import { clamp, computeJumpDistances, getMigrationDistanceMultiplier } from "./pure-helpers";
import {
  getFactionGovernment,
  getSpeciesRightsForFaction,
  getPlanetSpeciesContext,
  getPlanetDistrictLimitsFromState,
  getPlanetTechnologyModifiers,
  haveFactionsMet,
} from "./state-queries";
import {
  MIGRATION_BASE_WEEKLY_RATE,
  MIGRATION_DISTANCE_MAX_JUMPS,
  MIGRATION_DESTINATION_CAPACITY_BUFFER,
  MIGRATION_FOREIGN_MET_MULTIPLIER,
  MIGRATION_FOREIGN_OPEN_BORDER_MULTIPLIER,
  MIGRATION_MIN_FLOW_POPULATION,
  MIGRATION_MIN_SOURCE_POPULATION,
  MIGRATION_PACT_MULTIPLIER,
  MIGRATION_PRESSURE_WEEKLY_RATE,
} from "./constants";
import type { RuntimeContext } from "./types";

interface MigrationPolicyFactors {
  internal: number;
  foreignOut: number;
  foreignIn: number;
  pressure: number;
  attraction: number;
}

interface MigrationPlanetProfile {
  index: number;
  planet: PlanetState;
  ownerId: number;
  population: number;
  capacity: number;
  capacityRoom: number;
  sourcePressure: number;
  attraction: number;
}

function getMigrationPolicyFactors(ctx: RuntimeContext, factionId: number): MigrationPolicyFactors {
  const optionId = getFactionGovernment(ctx.state, factionId).selectedLawOptionIds.migrationPolicy ?? "managedMigration";
  if (optionId === "freeMovement") {
    return { internal: 1.35, foreignOut: 1.15, foreignIn: 1.35, pressure: 1.1, attraction: 1.1 };
  }
  if (optionId === "migrationControls") {
    return { internal: 0.45, foreignOut: 0.1, foreignIn: 0.25, pressure: 0.65, attraction: 0.75 };
  }
  if (optionId === "closedMovement") {
    return { internal: 0.08, foreignOut: 0, foreignIn: 0, pressure: 0.28, attraction: 0.35 };
  }
  return { internal: 1, foreignOut: 0.45, foreignIn: 0.7, pressure: 1, attraction: 1 };
}

function getSpeciesMigrationRightsMultiplier(ctx: RuntimeContext, factionId: number, speciesId: SpeciesId): number {
  const rights = getSpeciesRightsForFaction(ctx.state, factionId, speciesId);
  if (rights.migration === "prohibited") return 0;
  if (rights.migration === "free") return 1.15;
  return 0.65;
}

function getProductiveJobCapacity(planetState: PlanetState): number {
  return Object.entries(planetState.economy.jobCapacity)
    .filter(([job]) => job !== "criminal" && job !== "unemployed")
    .reduce((sum, [, population]) => sum + population, 0);
}

function getMigrationAmenityRatio(planetState: PlanetState): number {
  if (planetState.population <= 0) return 1;
  const amenityNeed = getAmenityNeed(planetState.population);
  return amenityNeed > 0 ? planetState.economy.amenities / amenityNeed : 1;
}

function getMigrationHousingRatio(planetState: PlanetState): number {
  return planetState.population > 0 ? planetState.economy.housing / planetState.population : 1;
}

function createMigrationProfile(ctx: RuntimeContext, planetState: PlanetState, index: number): MigrationPlanetProfile | null {
  if (!planetState.isHabited || planetState.population <= MIGRATION_MIN_SOURCE_POPULATION) return null;
  const ownerId = planetState.ownerId ?? -1;
  if (!Number.isInteger(ownerId) || ownerId < 0) return null;

  const population = planetState.population;
  const economy = planetState.economy;
  const capacity = Math.max(1, calculatePlanetCapacity(
    planetState,
    getPlanetDistrictLimitsFromState(ctx.state, planetState),
    getPlanetTechnologyModifiers(ctx.state, planetState),
  ));
  const housingRatio = getMigrationHousingRatio(planetState);
  const amenityRatio = getMigrationAmenityRatio(planetState);
  const unemploymentRatio = population > 0 ? economy.unemployedPopulation / population : 0;
  const jobRoomRatio = Math.max(0, getProductiveJobCapacity(planetState) - economy.employedPopulation) / population;
  const capacityPressure = population / capacity;
  const housingShortage = clamp(1 - housingRatio, 0, 1.4);
  const amenityShortage = clamp(1 - amenityRatio, 0, 1.4);
  const overCapacity = clamp(capacityPressure - 0.95, 0, 1.2);
  const lowStability = clamp((55 - economy.stability) / 55, 0, 1.4);
  const declinePressure = economy.populationGrowth.netPerQuarter < 0
    ? clamp(Math.abs(economy.populationGrowth.netPerQuarter) / Math.max(1, population * 0.03), 0, 1)
    : 0;
  const sourcePressure = clamp(
    0.04
      + lowStability * 0.58
      + clamp(unemploymentRatio / 0.22, 0, 1.5) * 0.62
      + housingShortage * 0.5
      + amenityShortage * 0.28
      + overCapacity * 0.7
      + declinePressure * 0.35,
    0,
    3,
  );
  const stabilityAttraction = clamp((economy.stability - 35) / 65, 0, 1.2);
  const housingAttraction = clamp(housingRatio - 0.95, 0, 1.5);
  const amenityAttraction = clamp(amenityRatio - 0.85, 0, 1.2);
  const capacityAttraction = clamp(1 - capacityPressure, 0, 1.2);
  const jobAttraction = clamp(jobRoomRatio / 0.18, 0, 1.4);
  const policyAttraction = getMigrationPolicyFactors(ctx, ownerId).attraction;
  const attraction = Math.max(
    0,
    (0.08
      + stabilityAttraction * 1.05
      + housingAttraction * 0.82
      + amenityAttraction * 0.38
      + capacityAttraction * 0.72
      + jobAttraction * 1.08
      - clamp((35 - economy.stability) / 35, 0, 1) * 0.55
      - clamp(unemploymentRatio / 0.3, 0, 1) * 0.45)
      * policyAttraction,
  );

  return {
    index,
    planet: planetState,
    ownerId,
    population,
    capacity,
    capacityRoom: Math.max(0, capacity * MIGRATION_DESTINATION_CAPACITY_BUFFER - population),
    sourcePressure,
    attraction,
  };
}

function getMigrationRelationMultiplier(ctx: RuntimeContext, sourceOwnerId: number, targetOwnerId: number): number {
  if (sourceOwnerId === targetOwnerId) return getMigrationPolicyFactors(ctx, sourceOwnerId).internal;
  if (areFactionsAtWar(ctx.state.diplomacy, sourceOwnerId, targetOwnerId)) return 0;
  if (!haveFactionsMet(ctx.state, sourceOwnerId, targetOwnerId)) return 0;
  const sourcePolicy = getMigrationPolicyFactors(ctx, sourceOwnerId);
  const targetPolicy = getMigrationPolicyFactors(ctx, targetOwnerId);
  if (sourcePolicy.foreignOut <= 0 || targetPolicy.foreignIn <= 0) return 0;
  const hasPact = getActiveTreatyPartnersForArticle(ctx.state.diplomacy, sourceOwnerId, MIGRATION_PACT_ARTICLE_ID)
    .includes(targetOwnerId);
  const bordersMutuallyOpen = getBorderPolicy(ctx.state.diplomacy, sourceOwnerId, targetOwnerId) === "open"
    && getBorderPolicy(ctx.state.diplomacy, targetOwnerId, sourceOwnerId) === "open";
  const tierMultiplier = hasPact
    ? MIGRATION_PACT_MULTIPLIER
    : bordersMutuallyOpen
      ? MIGRATION_FOREIGN_OPEN_BORDER_MULTIPLIER
      : MIGRATION_FOREIGN_MET_MULTIPLIER;
  return tierMultiplier * sourcePolicy.foreignOut * targetPolicy.foreignIn;
}

export function applySpeciesPopulationDelta(
  populations: SpeciesPopulation[],
  speciesId: SpeciesId,
  delta: number,
): SpeciesPopulation[] {
  const bySpecies = new Map<SpeciesId, number>();
  for (const population of populations) {
    bySpecies.set(population.speciesId, (bySpecies.get(population.speciesId) ?? 0) + Math.max(0, Math.round(population.population)));
  }
  bySpecies.set(speciesId, Math.max(0, (bySpecies.get(speciesId) ?? 0) + Math.round(delta)));
  return Array.from(bySpecies.entries())
    .filter(([, population]) => population > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([nextSpeciesId, population]) => ({ speciesId: nextSpeciesId, population }));
}

function processPopulationMigrationWeeks(ctx: RuntimeContext, weeks: number): boolean {
  if (weeks <= 0) return false;
  const profiles = ctx.state.planetStates
    .map((planetState, index) => createMigrationProfile(ctx, planetState, index))
    .filter((profile): profile is MigrationPlanetProfile => profile !== null);
  if (profiles.length < 2) return false;

  const inboundByPlanet = new Map<number, number>();
  const deltasByPlanet = new Map<number, Map<SpeciesId, number>>();
  const addDelta = (planetIndex: number, speciesId: SpeciesId, delta: number): void => {
    if (Math.abs(delta) < MIGRATION_MIN_FLOW_POPULATION) return;
    const bySpecies = deltasByPlanet.get(planetIndex) ?? new Map<SpeciesId, number>();
    bySpecies.set(speciesId, (bySpecies.get(speciesId) ?? 0) + Math.round(delta));
    deltasByPlanet.set(planetIndex, bySpecies);
  };

  for (const source of profiles) {
    const sourcePolicy = getMigrationPolicyFactors(ctx, source.ownerId);
    const weeklyRate = (MIGRATION_BASE_WEEKLY_RATE + MIGRATION_PRESSURE_WEEKLY_RATE * source.sourcePressure) * sourcePolicy.pressure;
    if (weeklyRate <= 0) continue;
    const sourceDistances = computeJumpDistances(ctx.state.adjacency, source.planet.starId, MIGRATION_DISTANCE_MAX_JUMPS);

    for (const species of source.planet.speciesPopulations) {
      const sourceRightsMultiplier = getSpeciesMigrationRightsMultiplier(ctx, source.ownerId, species.speciesId);
      if (sourceRightsMultiplier <= 0 || species.population <= MIGRATION_MIN_SOURCE_POPULATION) continue;

      const candidates = profiles
        .filter((target) => target.index !== source.index)
        .map((target) => {
          const relationMultiplier = getMigrationRelationMultiplier(ctx, source.ownerId, target.ownerId);
          if (relationMultiplier <= 0) return null;
          const targetRightsMultiplier = getSpeciesMigrationRightsMultiplier(ctx, target.ownerId, species.speciesId);
          if (targetRightsMultiplier <= 0) return null;
          const availableRoom = target.capacityRoom - (inboundByPlanet.get(target.index) ?? 0);
          if (availableRoom < MIGRATION_MIN_FLOW_POPULATION) return null;
          const habitability = getEffectiveSpeciesHabitability(
            target.planet,
            species.speciesId,
            getPlanetSpeciesContext(ctx.state, target.planet),
          );
          if (habitability < 20) return null;
          const habitabilityMultiplier = clamp((habitability - 10) / 80, 0.1, 1.2);
          const distanceMultiplier = getMigrationDistanceMultiplier(sourceDistances, target.planet.starId);
          const attractionGap = Math.max(0, target.attraction - source.attraction + source.sourcePressure * 0.35);
          if (attractionGap <= 0.02) return null;
          const weight = relationMultiplier * targetRightsMultiplier * target.attraction * attractionGap
            * habitabilityMultiplier * distanceMultiplier;
          return weight > 0 ? { target, weight, availableRoom } : null;
        })
        .filter((candidate): candidate is { target: MigrationPlanetProfile; weight: number; availableRoom: number } => candidate !== null);

      const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
      if (totalWeight <= 0) continue;

      const maxLeaving = Math.max(0, species.population - MIGRATION_MIN_SOURCE_POPULATION);
      const desiredOutflow = Math.min(
        maxLeaving,
        species.population * weeklyRate * weeks * sourceRightsMultiplier,
      );
      if (desiredOutflow < MIGRATION_MIN_FLOW_POPULATION) continue;

      let moved = 0;
      for (const candidate of candidates) {
        const share = desiredOutflow * (candidate.weight / totalWeight);
        const flow = Math.min(
          Math.round(share),
          Math.floor(candidate.availableRoom),
          Math.round(desiredOutflow - moved),
        );
        if (flow < MIGRATION_MIN_FLOW_POPULATION) continue;
        addDelta(source.index, species.speciesId, -flow);
        addDelta(candidate.target.index, species.speciesId, flow);
        inboundByPlanet.set(candidate.target.index, (inboundByPlanet.get(candidate.target.index) ?? 0) + flow);
        moved += flow;
        if (moved >= desiredOutflow - MIGRATION_MIN_FLOW_POPULATION) break;
      }
    }
  }

  if (deltasByPlanet.size === 0) return false;
  ctx.state.planetStates = ctx.state.planetStates.map((planetState, index) => {
    const deltas = deltasByPlanet.get(index);
    if (!deltas) return planetState;
    let speciesPopulations = planetState.speciesPopulations.map((entry) => ({ ...entry }));
    for (const [speciesId, delta] of deltas) {
      speciesPopulations = applySpeciesPopulationDelta(speciesPopulations, speciesId, delta);
    }
    const population = sumSpeciesPopulation(speciesPopulations);
    ctx.queuePlanetDetailRefresh(planetState.id);
    return { ...planetState, population, speciesPopulations };
  });
  ctx.hasDirtyState = true;
  return true;
}

export function processPopulationWeeks(ctx: RuntimeContext, targetWeek: number): boolean {
  const previousWeek = ctx.state.clock.lastProcessedPopulationWeek ?? targetWeek;
  const weeks = Math.max(0, targetWeek - previousWeek);
  if (weeks <= 0) return false;

  let changed = false;
  ctx.state.planetStates = ctx.state.planetStates.map((planetState) => {
    if (!planetState.isHabited) return planetState;
    const nextPlanetState = applyPopulationGrowthFraction(
      planetState,
      getPlanetDistrictLimitsFromState(ctx.state, planetState),
      (GAME_DAYS_PER_WEEK * weeks) / GAME_DAYS_PER_QUARTER,
      getPlanetTechnologyModifiers(ctx.state, planetState),
      getPlanetSpeciesContext(ctx.state, planetState),
    );
    if (nextPlanetState.population !== planetState.population) changed = true;
    if (nextPlanetState.population !== planetState.population) ctx.queuePlanetDetailRefresh(planetState.id);
    return nextPlanetState;
  });
  changed = processPopulationMigrationWeeks(ctx, weeks) || changed;

  ctx.state.clock.lastProcessedPopulationWeek = targetWeek;
  ctx.hasDirtyState = true;
  if (!changed) return false;
  ctx.recalculatePlanetEconomies();
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return true;
}

function getLeaderDailyDeathChance(age: number, lifespan: number): number {
  if (age < lifespan - 8) return 0.000002;
  if (age < lifespan) return 0.00002;
  const overdue = Math.max(0, age - lifespan);
  return clamp(0.00025 + overdue * overdue * 0.000025, 0.00025, 0.03);
}

export function processLeaderDays(ctx: RuntimeContext, targetDay: number): {
  leadersChanged: boolean;
  planetEconomiesChanged: boolean;
  fleetEffectsChanged: boolean;
  governmentEffectsChanged: boolean;
} {
  const previousDay = ctx.state.clock.lastProcessedLeaderDay ?? targetDay;
  const days = Math.max(0, targetDay - previousDay);
  const factionIds = ctx.state.factions.map((faction) => faction.id);
  if (days <= 0) {
    const expectedPoolCount = factionIds.length * LEADER_POOL_PER_CLASS * 2;
    if (ctx.state.leaders.filter((leader) => leader.status === "pool").length >= expectedPoolCount) {
      return { leadersChanged: false, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
    }
    ctx.state.leaders = refreshLeaderPool(ctx.state.leaders, factionIds, targetDay, ctx.state.clock.year);
    ctx.state.clock.lastProcessedLeaderDay = targetDay;
    ctx.hasDirtyState = true;
    return { leadersChanged: true, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
  }

  let leadersChanged = false;
  let planetEconomiesChanged = false;
  let fleetEffectsChanged = false;
  let governmentEffectsChanged = false;
  const ageIncrease = days / GAME_DAYS_PER_YEAR;
  for (const leader of ctx.state.leaders) {
    if (leader.status !== "recruited") continue;
    const previousLevel = leader.level;
    leader.age += ageIncrease;
    const dailyXp = leader.assignment ? (leader.class === "military" ? 0.2 : 0.16) : 0.03;
    leader.xp += dailyXp * days;
    leader.level = calculateLeaderLevel(leader.xp);
    leadersChanged = true;
    if (leader.level !== previousLevel && leader.assignment) {
      if (leader.assignment.kind === "planet") planetEconomiesChanged = true;
      if (leader.assignment.kind === "fleet") fleetEffectsChanged = true;
      if (leader.assignment.kind === "government") governmentEffectsChanged = true;
    }

    const dailyDeathChance = getLeaderDailyDeathChance(leader.age, leader.lifespan);
    const deathChance = 1 - Math.pow(1 - dailyDeathChance, days);
    if (Math.random() >= deathChance) continue;
    const oldAssignment = leader.assignment;
    leader.status = "dead";
    leader.assignment = null;
    leader.diedAtYear = ctx.state.clock.year;
    leadersChanged = true;
    if (oldAssignment?.kind === "planet") planetEconomiesChanged = true;
    if (oldAssignment?.kind === "fleet") fleetEffectsChanged = true;
    if (oldAssignment?.kind === "government") governmentEffectsChanged = true;
  }

  ctx.state.leaders = refreshLeaderPool(ctx.state.leaders, factionIds, targetDay, ctx.state.clock.year);
  ctx.state.clock.lastProcessedLeaderDay = targetDay;
  leadersChanged = true;
  ctx.hasDirtyState = true;
  if (planetEconomiesChanged || governmentEffectsChanged) {
    ctx.recalculatePlanetEconomies();
    ctx.refreshFactionEconomyDeltas();
  } else if (fleetEffectsChanged) {
    ctx.refreshFactionEconomyDeltas();
  }
  return { leadersChanged, planetEconomiesChanged, fleetEffectsChanged, governmentEffectsChanged };
}
