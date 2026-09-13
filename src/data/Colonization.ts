import { getEffectiveSpeciesHabitability } from "./Economy";
import type { PlanetEconomySpeciesContext, PlanetState, SpeciesId } from "./Economy";
import { PLANET_TYPES } from "./StarMap";
import type { PlanetConfig } from "./StarMap";

export type ColonizationBlockReason =
  | "colonizable"
  | "alreadyHabited"
  | "systemNotOwned"
  | "restrictedPlanetType"
  | "zeroHabitability"
  | "noColonizationShip"
  | "commandLinkUnavailable"
  | "fleetUnavailable";

export interface ColonizationEligibility {
  eligible: boolean;
  reason: ColonizationBlockReason;
  foundingSpeciesHabitability: number;
}

export interface PlanetColonizationEligibilityInput {
  planet: PlanetConfig;
  planetState: PlanetState;
  systemOwnerId: number;
  factionId: number;
  foundingSpeciesId: SpeciesId;
  speciesContext?: PlanetEconomySpeciesContext;
  allowRestrictedPlanetType?: boolean;
  hasColonizationShip?: boolean;
  hasCommandLink?: boolean;
  fleetAvailable?: boolean;
}

export function getPlanetColonizationEligibility(
  input: PlanetColonizationEligibilityInput,
): ColonizationEligibility {
  const foundingSpeciesHabitability = getEffectiveSpeciesHabitability(
    input.planetState,
    input.foundingSpeciesId,
    input.speciesContext,
  );
  if (input.planetState.isHabited || input.planet.isHabited === true) {
    return { eligible: false, reason: "alreadyHabited", foundingSpeciesHabitability };
  }
  if (input.systemOwnerId !== input.factionId) {
    return { eligible: false, reason: "systemNotOwned", foundingSpeciesHabitability };
  }
  if (!PLANET_TYPES[input.planet.type].colonizableByDefault && !input.allowRestrictedPlanetType) {
    return { eligible: false, reason: "restrictedPlanetType", foundingSpeciesHabitability };
  }
  if (foundingSpeciesHabitability <= 0) {
    return { eligible: false, reason: "zeroHabitability", foundingSpeciesHabitability };
  }
  if (input.fleetAvailable === false) {
    return { eligible: false, reason: "fleetUnavailable", foundingSpeciesHabitability };
  }
  if (input.hasCommandLink === false) {
    return { eligible: false, reason: "commandLinkUnavailable", foundingSpeciesHabitability };
  }
  if (input.hasColonizationShip === false) {
    return { eligible: false, reason: "noColonizationShip", foundingSpeciesHabitability };
  }
  return { eligible: true, reason: "colonizable", foundingSpeciesHabitability };
}
