import { getPlanetColonizationEligibility } from "../../src/data/Colonization";
import type { ColonizationEligibility } from "../../src/data/Colonization";
import {
  createFrontierSettlementModifiers,
  NEW_COLONY_POPULATION,
} from "../../src/data/Economy";
import { applyPlanetStatesToStars, createPlanetStateFromConfig } from "../../src/data/StarMap";
import type { GameFleet, RuntimeContext } from "./types";
import {
  getFactionFoundingSpeciesId,
  getFleetColonizationShip,
  syncFleetMembership,
} from "./state-normalization";
import { getPlanetConfig, getPlanetSpeciesContext, getPlanetState } from "./state-queries";
import { hasCommandLink } from "./intelligence";

export function getFactionPlanetColonizationEligibility(
  ctx: RuntimeContext,
  factionId: number,
  planetId: string,
  fleet?: GameFleet | null,
): ColonizationEligibility | null {
  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) return null;
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) return null;
  const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId
    ?? getFactionFoundingSpeciesId(factionId);
  return getPlanetColonizationEligibility({
    planet,
    planetState,
    systemOwnerId: ctx.state.starOwnership[planetState.starId] ?? -1,
    factionId,
    foundingSpeciesId,
    speciesContext: getPlanetSpeciesContext(ctx.state, planetState),
    ...(fleet
      ? {
        fleetAvailable: fleet.ownerId === factionId && fleet.combatStatus !== "destroyed" && fleet.phase !== "missingInAction",
        hasCommandLink: hasCommandLink(ctx.state, factionId, fleet.currentStarId),
        hasColonizationShip: getFleetColonizationShip(ctx, fleet) !== null,
      }
      : {}),
  });
}

export interface FoundColonyResult {
  success: boolean;
  message: string;
}

export function foundColony(
  ctx: RuntimeContext,
  fleet: GameFleet,
  planetId: string,
): FoundColonyResult {
  const eligibility = getFactionPlanetColonizationEligibility(ctx, fleet.ownerId, planetId, fleet);
  if (!eligibility?.eligible) {
    return { success: false, message: eligibility?.reason ?? "Planet not found." };
  }
  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) return { success: false, message: "Planet not found." };
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) return { success: false, message: "Planet details are unavailable." };
  const colonizationShip = getFleetColonizationShip(ctx, fleet);
  if (!colonizationShip) return { success: false, message: "Requires a colonization ship." };
  const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === fleet.ownerId)?.foundingSpeciesId
    ?? getFactionFoundingSpeciesId(fleet.ownerId);
  const prospectiveState = createPlanetStateFromConfig(
    planetState.starId,
    planetState.planetIndex,
    planet,
    {
      ...planetState,
      ownerId: fleet.ownerId,
      isHabited: true,
      population: NEW_COLONY_POPULATION,
      speciesPopulations: [{ speciesId: foundingSpeciesId, population: NEW_COLONY_POPULATION }],
      builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
      buildings: undefined,
      constructionQueue: [],
      jobLocks: [],
      modifiers: [
        ...(planetState.modifiers ?? []),
        ...createFrontierSettlementModifiers(ctx.state.clock.year),
      ],
    },
    planetState.features,
    { starterInfrastructure: false, startingPopulation: NEW_COLONY_POPULATION },
  );

  ctx.state.ships = ctx.state.ships.filter((ship) => ship.id !== colonizationShip.id);
  syncFleetMembership(ctx, ctx.state);
  ctx.state.planetStates = ctx.state.planetStates.map((candidate) => (
    candidate.id === prospectiveState.id ? prospectiveState : candidate
  ));
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  ctx.queuePlanetDetailRefresh(prospectiveState.id);
  ctx.refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  return { success: true, message: `${planet.name} colonized.` };
}
