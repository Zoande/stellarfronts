import { createEmptyResourceCounts, RESOURCE_KINDS } from "../../src/data/Economy";
import type { FactionEconomyState, PlanetModifier, PlanetState, ResourceCounts, ResourceKind, PlanetEconomySpeciesContext } from "../../src/data/Economy";
import { createInitialGovernmentState, getGovernmentPositionDefinition, getSelectedGovernmentLawOptions } from "../../src/data/Government";
import type { FactionGovernmentState, GovernmentEffect, GovernmentPositionDefinition, GovernmentPositionId } from "../../src/data/Government";
import { getLeaderTraitDefinition } from "../../src/data/Leaders";
import type { LeaderAssignment, LeaderFleetEffects, LeaderState } from "../../src/data/Leaders";
import { SHORTAGE_SITUATION_ID, situationInstanceId } from "../../src/data/Situations";
import { ACTIVE_RESEARCH_FRACTION, PASSIVE_RESEARCH_FRACTION, getCompletedTechnologyEffects, TECHNOLOGY_BY_ID } from "../../src/data/Technology";
import type { FactionTechState } from "../../src/data/Technology";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import type { ServerFleet, ServerStarbase } from "../../src/game/GameProtocol";
import { createDefaultSpeciesRightsState, normalizeSpeciesRightsForLaws } from "../../src/data/Species";
import type { FactionSpeciesRightsState, SpeciesId, SpeciesRights, SpeciesLawSelections } from "../../src/data/Species";
import type { GalaxyPerspective } from "../../src/data/Factions";
import type { PlanetConfig } from "../../src/data/StarMap";
import { SHORTAGE_GRACE_MONTHS } from "./constants";
import { clamp } from "./pure-helpers";
import type { GameState, RuntimeContext } from "./types";

// --- Shortage severity ---

export function computeShortageSeverity(stockpile: number, monthlyDelta: number, consumption: number): number {
  const deficit = Math.max(0, -monthlyDelta);
  if (deficit <= 0) return 0;
  const deficitFraction = clamp(deficit / Math.max(consumption, deficit, 1), 0, 1);
  const bufferFactor = clamp(1 - Math.max(0, stockpile) / (deficit * SHORTAGE_GRACE_MONTHS), 0, 1);
  return clamp(deficitFraction * bufferFactor, 0, 1);
}

// Single source of truth for shortage severity: the Resource Shortage *situation*.
// Its per-resource progress (0-100, advanced/receded each tick by processSituations
// using computeShortageSeverity) drives all shortage penalties below.
export function getFactionShortageSeverities(nextState: GameState, factionId: number): ResourceCounts {
  const severities = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) {
    const instanceId = situationInstanceId(SHORTAGE_SITUATION_ID, factionId, resource);
    const situation = nextState.situations.find((candidate) => candidate.id === instanceId);
    severities[resource] = situation ? clamp(situation.progress / 100, 0, 1) : 0;
  }
  return severities;
}

function shortageModifier(
  resource: ResourceKind,
  id: string,
  label: string,
  target: PlanetModifier["target"],
  operation: PlanetModifier["operation"],
  value: number,
): PlanetModifier {
  return {
    id: `shortage-${resource}-${id}`,
    label,
    source: `shortage:${resource}`,
    target,
    operation,
    value,
  };
}

export function getFactionShortagePlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const { food, goods, energy, minerals, alloys } = getFactionShortageSeverities(nextState, factionId);
  const modifiers: PlanetModifier[] = [];

  if (food > 0) {
    modifiers.push(
      shortageModifier("food", "happiness", "Food Shortage", "happiness", "add", -50 * food),
      shortageModifier("food", "stability", "Food Shortage", "stability", "add", -28 * food),
      shortageModifier("food", "growth", "Food Shortage", "populationGrowth", "multiply", -0.8 * food),
      shortageModifier("food", "output", "Food Shortage", "jobOutput", "multiply", -0.2 * food),
    );
  }
  if (goods > 0) {
    modifiers.push(
      shortageModifier("goods", "happiness", "Goods Shortage", "happiness", "add", -24 * goods),
      shortageModifier("goods", "stability", "Goods Shortage", "stability", "add", -18 * goods),
      shortageModifier("goods", "research", "Goods Shortage", "jobOutput:researcher:research", "multiply", -0.35 * goods),
      shortageModifier("goods", "amenities", "Goods Shortage", "jobAmenities:entertainer", "multiply", -0.45 * goods),
    );
  }
  if (energy > 0) {
    modifiers.push(
      shortageModifier("energy", "stability", "Energy Shortage", "stability", "add", -20 * energy),
      shortageModifier("energy", "output", "Energy Shortage", "jobOutput", "multiply", -0.35 * energy),
      shortageModifier("energy", "construction", "Energy Shortage", "constructionSpeed", "multiply", -0.25 * energy),
    );
  }
  if (minerals > 0) {
    modifiers.push(
      shortageModifier("minerals", "construction", "Mineral Shortage", "constructionSpeed", "multiply", -0.55 * minerals),
      shortageModifier("minerals", "goods", "Mineral Shortage", "jobOutput:artisan:goods", "multiply", -0.4 * minerals),
      shortageModifier("minerals", "alloys", "Mineral Shortage", "jobOutput:metallurgist:alloys", "multiply", -0.4 * minerals),
    );
  }
  if (alloys > 0) {
    modifiers.push(
      shortageModifier("alloys", "stability", "Alloy Shortage", "stability", "add", -8 * alloys),
      shortageModifier("alloys", "construction", "Alloy Shortage", "constructionSpeed", "multiply", -0.2 * alloys),
    );
  }
  return modifiers;
}

export function getFactionFleetShortageEffects(nextState: GameState, factionId: number): {
  attackMultiplier: number;
  speedMultiplier: number;
  shieldMultiplier: number;
} {
  const { food, goods, energy, alloys } = getFactionShortageSeverities(nextState, factionId);
  return {
    attackMultiplier: clamp(1 - energy * 0.35 - alloys * 0.3 - goods * 0.15 - food * 0.1, 0.35, 1),
    speedMultiplier: clamp(1 - energy * 0.3 - alloys * 0.2 - food * 0.1, 0.4, 1),
    shieldMultiplier: clamp(1 - energy * 0.75, 0.2, 1),
  };
}

// --- Leader helpers ---

export function getLeaderDayIndex(year: number): number {
  return Math.floor(year * GAME_DAYS_PER_YEAR);
}

export function getLeaderLevelScale(leader: Pick<LeaderState, "level">): number {
  return 1 + Math.max(0, leader.level - 1) * 0.01;
}

export function getAssignedLeader(
  nextState: GameState,
  assignmentKind: LeaderAssignment["kind"],
  targetId: string,
): LeaderState | null {
  return nextState.leaders.find((leader) => (
    leader.status === "recruited"
    && leader.assignment?.kind === assignmentKind
    && leader.assignment.targetId === targetId
  )) ?? null;
}

// --- Government helpers ---

export interface GovernmentEffectInstance {
  sourceId: string;
  label: string;
  effect: GovernmentEffect;
  scale: number;
}

export function getFactionGovernment(nextState: GameState, factionId: number): FactionGovernmentState {
  return nextState.governments.find((government) => government.factionId === factionId)
    ?? createInitialGovernmentState(factionId);
}

export function getAssignedGovernmentLeader(
  nextState: GameState,
  factionId: number,
  positionId: GovernmentPositionId,
): LeaderState | null {
  return nextState.leaders.find((leader) => (
    leader.factionId === factionId
    && leader.status === "recruited"
    && leader.assignment?.kind === "government"
    && leader.assignment.targetId === positionId
  )) ?? null;
}

function addGovernmentEffectInstances(
  instances: GovernmentEffectInstance[],
  sourceId: string,
  label: string,
  effects: GovernmentEffect[],
  scale = 1,
): void {
  effects.forEach((effect, index) => {
    instances.push({
      sourceId: `${sourceId}-${index}`,
      label,
      effect,
      scale,
    });
  });
}

export function getGovernmentEffectInstances(nextState: GameState, factionId: number): GovernmentEffectInstance[] {
  const instances: GovernmentEffectInstance[] = [];
  const government = getFactionGovernment(nextState, factionId);
  for (const { law, option } of getSelectedGovernmentLawOptions(government)) {
    addGovernmentEffectInstances(instances, `law-${law.id}-${option.id}`, `${law.name}: ${option.name}`, option.effects);
  }

  for (const position of Object.values(getGovernmentPositionDefinitionMap())) {
    const leader = getAssignedGovernmentLeader(nextState, factionId, position.id);
    if (!leader || leader.class !== position.requiredClass) continue;
    addGovernmentEffectInstances(
      instances,
      `cabinet-${position.id}-${leader.id}-level`,
      `${position.title}: ${leader.name}`,
      position.levelEffects,
      Math.max(1, leader.level),
    );
    const leaderScale = getLeaderLevelScale(leader);
    for (const traitId of leader.traits) {
      const trait = getLeaderTraitDefinition(traitId);
      for (const traitEffect of trait.governmentEffects ?? []) {
        if (traitEffect.positionId && traitEffect.positionId !== "any" && traitEffect.positionId !== position.id) continue;
        addGovernmentEffectInstances(
          instances,
          `cabinet-${position.id}-${leader.id}-${trait.id}`,
          `${leader.name}: ${trait.name}`,
          traitEffect.effects,
          leaderScale,
        );
      }
    }
  }
  return instances;
}

export function getGovernmentPositionDefinitionMap(): Record<GovernmentPositionId, GovernmentPositionDefinition> {
  return {
    president: getGovernmentPositionDefinition("president")!,
    headOfResearch: getGovernmentPositionDefinition("headOfResearch")!,
    headOfDevelopment: getGovernmentPositionDefinition("headOfDevelopment")!,
    ministerOfDefense: getGovernmentPositionDefinition("ministerOfDefense")!,
  };
}

export function getGovernmentPlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const modifiers: PlanetModifier[] = [];
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    const effect = instance.effect;
    if (effect.type !== "planetModifier") continue;
    modifiers.push({
        id: `government-${instance.sourceId}-${effect.target}`,
        label: instance.label,
        source: `government:${factionId}`,
        target: effect.target,
        operation: effect.operation,
        value: effect.value * instance.scale,
    });
  }
  return modifiers;
}

export function getGovernmentFleetEffects(nextState: GameState, factionId: number): Required<LeaderFleetEffects> {
  const totals: Required<LeaderFleetEffects> = {
    attackMultiplier: 1,
    speedMultiplier: 1,
    shieldMultiplier: 1,
    upkeepMultiplier: 1,
    evasionBonus: 0,
  };
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type !== "fleetModifier") continue;
    const value = instance.effect.value * instance.scale;
    if (instance.effect.target === "attack") totals.attackMultiplier += value;
    if (instance.effect.target === "speed") totals.speedMultiplier += value;
    if (instance.effect.target === "shield") totals.shieldMultiplier += value;
    if (instance.effect.target === "upkeep") totals.upkeepMultiplier += value;
    if (instance.effect.target === "evasion") totals.evasionBonus += value;
  }
  return {
    attackMultiplier: clamp(totals.attackMultiplier, 0.25, 2.5),
    speedMultiplier: clamp(totals.speedMultiplier, 0.25, 2.5),
    shieldMultiplier: clamp(totals.shieldMultiplier, 0.25, 2.5),
    upkeepMultiplier: clamp(totals.upkeepMultiplier, 0.25, 2.5),
    evasionBonus: clamp(totals.evasionBonus, -0.25, 0.25),
  };
}

export function getGovernmentResearchSpeedMultiplier(nextState: GameState, factionId: number): number {
  let multiplier = 1;
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type === "researchSpeed") {
      multiplier += instance.effect.value * instance.scale;
    }
  }
  return clamp(multiplier, 0.25, 3);
}

export function getGovernmentResearchAllocation(nextState: GameState, factionId: number): { activeFraction: number; passiveFraction: number } {
  let activeFraction = ACTIVE_RESEARCH_FRACTION;
  let passiveFraction = PASSIVE_RESEARCH_FRACTION;
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type !== "researchAllocation") continue;
    activeFraction = instance.effect.activeFraction;
    passiveFraction = instance.effect.passiveFraction;
  }
  const total = Math.max(0.000001, activeFraction + passiveFraction);
  return {
    activeFraction: clamp(activeFraction / total, 0, 1),
    passiveFraction: clamp(passiveFraction / total, 0, 1),
  };
}

export function getPlanetLeaderModifiers(nextState: GameState, planetState: PlanetState, ownerId: number): PlanetModifier[] {
  const leader = getAssignedLeader(nextState, "planet", planetState.id);
  if (!leader || leader.factionId !== ownerId || leader.class !== "civilian") return [];
  const scale = getLeaderLevelScale(leader);
  const modifiers: PlanetModifier[] = [];
  for (const traitId of leader.traits) {
    const trait = getLeaderTraitDefinition(traitId);
    for (const effect of trait.planetEffects ?? []) {
      modifiers.push({
        id: `leader-${leader.id}-${trait.id}-${effect.target}`,
        label: `${leader.name}: ${trait.name}`,
        source: `leader:${leader.id}`,
        target: effect.target,
        operation: effect.operation,
        value: effect.value * scale,
      });
    }
  }
  return modifiers;
}

// --- Fleet effect multipliers ---

export function getFleetLeaderEffects(nextState: GameState, fleetId: string): Required<LeaderFleetEffects> {
  const leader = getAssignedLeader(nextState, "fleet", fleetId);
  const totals: Required<LeaderFleetEffects> = {
    attackMultiplier: 1,
    speedMultiplier: 1,
    shieldMultiplier: 1,
    upkeepMultiplier: 1,
    evasionBonus: 0,
  };
  if (!leader || leader.class !== "military") return totals;
  const scale = getLeaderLevelScale(leader);
  for (const traitId of leader.traits) {
    const effects = getLeaderTraitDefinition(traitId).fleetEffects;
    if (!effects) continue;
    totals.attackMultiplier += (effects.attackMultiplier ?? 0) * scale;
    totals.speedMultiplier += (effects.speedMultiplier ?? 0) * scale;
    totals.shieldMultiplier += (effects.shieldMultiplier ?? 0) * scale;
    totals.upkeepMultiplier += (effects.upkeepMultiplier ?? 0) * scale;
    totals.evasionBonus += (effects.evasionBonus ?? 0) * scale;
  }
  return {
    attackMultiplier: clamp(totals.attackMultiplier, 0.25, 2.25),
    speedMultiplier: clamp(totals.speedMultiplier, 0.25, 2.25),
    shieldMultiplier: clamp(totals.shieldMultiplier, 0.25, 2.25),
    upkeepMultiplier: clamp(totals.upkeepMultiplier, 0.25, 2),
    evasionBonus: clamp(totals.evasionBonus, -0.25, 0.25),
  };
}

export function getFleetSpeedMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).speedMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).speedMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).speedMultiplier;
}

export function getFleetAttackMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).attackMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).attackMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).attackMultiplier;
}

export function getFleetShieldMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).shieldMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).shieldMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).shieldMultiplier;
}

// --- Faction modifier queries ---

export function getActiveFactionPlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const modifiers: PlanetModifier[] = [];
  for (const entry of nextState.factionModifiers) {
    if (entry.factionId === factionId) modifiers.push(...entry.modifiers);
  }
  return modifiers;
}

// --- Species queries ---

export function getSpeciesLawSelections(nextState: GameState, factionId: number): SpeciesLawSelections {
  const government = getFactionGovernment(nextState, factionId);
  const selected = getSelectedGovernmentLawOptions(government);
  return {
    civilRights: selected.find((entry) => entry.law.id === "civilRights")?.option.id,
    speciesPolicy: selected.find((entry) => entry.law.id === "speciesPolicy")?.option.id,
  };
}

export function getFactionSpeciesRightsState(nextState: GameState, factionId: number): FactionSpeciesRightsState {
  return nextState.speciesRights.find((rights) => rights.factionId === factionId)
    ?? createDefaultSpeciesRightsState(factionId, nextState.species.map((species) => species.id));
}

export function getSpeciesRightsForFaction(nextState: GameState, factionId: number, speciesId: SpeciesId): SpeciesRights {
  const rightsState = getFactionSpeciesRightsState(nextState, factionId);
  return normalizeSpeciesRightsForLaws(
    rightsState.rightsBySpeciesId?.[speciesId] ?? undefined,
    getSpeciesLawSelections(nextState, factionId),
  );
}

export function getPlanetSpeciesContext(nextState: GameState, planetState: PlanetState): PlanetEconomySpeciesContext | undefined {
  const ownerId = nextState.starOwnership[planetState.starId] ?? -1;
  if (!Number.isInteger(ownerId) || ownerId < 0) {
    return { species: nextState.species, rightsBySpeciesId: {} };
  }
  const rightsState = getFactionSpeciesRightsState(nextState, ownerId);
  return {
    species: nextState.species,
    rightsBySpeciesId: rightsState.rightsBySpeciesId,
  };
}

export function getPlanetDistrictLimitsFromState(nextState: GameState, planetState: PlanetState) {
  return nextState.stars[planetState.starId]?.system.planets[planetState.planetIndex]?.objectDetails.districtLimits ?? undefined;
}

export function haveFactionsMet(nextState: GameState, a: number, b: number): boolean {
  if (a === b) return true;
  return (nextState.metByFaction[String(a)] ?? []).includes(b);
}

// --- Technology queries ---

export function getFactionTechnology(nextState: GameState, factionId: number): FactionTechState | undefined {
  return nextState.factionTechnologies.find((techState) => techState.factionId === factionId);
}

export function getTechnologyPlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const techState = getFactionTechnology(nextState, factionId);
  if (!techState) return [];
  const modifiers: PlanetModifier[] = [];
  for (const techId of techState.completedTechIds) {
    const tech = TECHNOLOGY_BY_ID[techId];
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.type === "job_output_mult") {
        modifiers.push({
          id: `tech-${tech.id}-${effect.job}-${effect.resource}`,
          label: tech.name,
          source: `technology:${tech.id}`,
          target: `jobOutput:${effect.job}:${effect.resource}`,
          operation: "multiply",
          value: effect.value,
        });
      } else if (effect.type === "construction_speed_mult") {
        modifiers.push({
          id: `tech-${tech.id}-construction-speed`,
          label: tech.name,
          source: `technology:${tech.id}`,
          target: "constructionSpeed",
          operation: "multiply",
          value: effect.value,
        });
      }
    }
  }
  return modifiers;
}

export function getPlanetTechnologyModifiers(nextState: GameState, planetState: PlanetState): PlanetModifier[] {
  const ownerId = nextState.starOwnership[planetState.starId] ?? -1;
  return ownerId >= 0
    ? [
      ...getTechnologyPlanetModifiers(nextState, ownerId),
      ...getGovernmentPlanetModifiers(nextState, ownerId),
      ...getFactionShortagePlanetModifiers(nextState, ownerId),
      ...getActiveFactionPlanetModifiers(nextState, ownerId),
      ...getPlanetLeaderModifiers(nextState, planetState, ownerId),
    ]
    : [];
}

export function getFactionEconomy(nextState: GameState, factionId: number): FactionEconomyState | null {
  return nextState.factionEconomies.find((e) => e.factionId === factionId) ?? null;
}

export function getFactionStarbaseShipBuildSpeedMultiplier(nextState: GameState, factionId: number): number {
  const techState = getFactionTechnology(nextState, factionId);
  if (!techState) return 1;
  let multiplier = 1;
  for (const effect of getCompletedTechnologyEffects(techState)) {
    if (effect.type === "starbase_ship_build_speed_mult") multiplier *= 1 + effect.value;
  }
  return Math.max(0.1, multiplier);
}

// ---------------------------------------------------------------------------
// Planet / starbase lookups + perspective access control
// ---------------------------------------------------------------------------

export function getEmpireSpeciesIds(nextState: GameState, factionId: number): SpeciesId[] {
  const ids = new Set<SpeciesId>();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited || (nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const population of planetState.speciesPopulations ?? []) {
      if (population.population > 0) ids.add(population.speciesId);
    }
  }
  const foundingSpeciesId = nextState.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId;
  if (foundingSpeciesId && ids.size === 0) ids.add(foundingSpeciesId);
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
}

export function getPlanetState(ctx: RuntimeContext, planetId: string): PlanetState | null {
  return ctx.state.planetStates.find((planetState) => planetState.id === planetId) ?? null;
}

export function getPlanetConfig(ctx: RuntimeContext, planetState: PlanetState): PlanetConfig | null {
  return ctx.state.stars[planetState.starId]?.system.planets[planetState.planetIndex] ?? null;
}

export function canAccessStar(ctx: RuntimeContext, perspective: GalaxyPerspective, starId: number): boolean {
  if (starId < 0 || starId >= ctx.state.stars.length) return false;
  if (perspective.mode === "observer") return true;
  const known = ctx.state.discoveredByFaction[String(perspective.factionId)] ?? [];
  return known.includes(starId);
}

export function canAccessPlanet(ctx: RuntimeContext, perspective: GalaxyPerspective, planetState: PlanetState): boolean {
  return canAccessStar(ctx, perspective, planetState.starId);
}

export function canAccessStarbase(ctx: RuntimeContext, perspective: GalaxyPerspective, starbase: ServerStarbase): boolean {
  return canAccessStar(ctx, perspective, starbase.starId);
}

export function validateCommandPerspective(perspective: GalaxyPerspective): number | null {
  return perspective.mode === "faction" ? perspective.factionId : null;
}

export function getStarbaseInSystem(ctx: RuntimeContext, starId: number): ServerStarbase | null {
  return ctx.state.starbases.find((starbase) => starbase.starId === starId) ?? null;
}
