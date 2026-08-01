import type { ClientCommand } from "../../src/game/GameProtocol";

export const CLIENT_COMMAND_TYPES = [
  "join",
  "adminCommand",
  "moveShip",
  "moveFleet",
  "buildStarbase",
  "orbitPlanet",
  "colonizePlanet",
  "mergeFleets",
  "stopFleet",
  "setFleetDarkMatterBoost",
  "setSpeedMultiplier",
  "buildDistrict",
  "buildPlanetBuilding",
  "upgradePlanetBuilding",
  "downgradePlanetBuilding",
  "setPlanetBuildingEnabled",
  "setPlanetJobLock",
  "cancelPlanetConstruction",
  "skipPlanetConstruction",
  "buildStarbaseBuilding",
  "upgradeStarbase",
  "buildStarbaseShip",
  "upgradeShip",
  "saveShipDesign",
  "decommissionShipDesign",
  "setActiveTechnology",
  "recruitLeader",
  "resolveEvent",
  "assignLeader",
  "dismissLeader",
  "setGovernmentLaw",
  "setSpeciesRights",
  "setUrbanSubDistrict",
  "marketTrade",
  "addMarketAutoTrade",
  "removeMarketAutoTrade",
  "sendDiplomacyMessage",
  "setBorderPolicy",
  "declareWar",
  "proposeTreaty",
  "respondDiplomacyProposal",
  "cancelTreaty",
  "cancelDiplomacyProposal",
  "proposePeace",
  "requestDetails",
  "subscribeDetails",
  "unsubscribeDetails",
  "retreatFleet",
  "retreatFleetTo",
  "emergencyRetreatFleetTo",
  "attackTarget",
  "attackSystem",
  "setFleetCombatSettings",
  "issueFleetTacticalOrder",
  "repairFleet",
] as const satisfies readonly ClientCommand["type"][];

const COMMAND_TYPES = new Set<ClientCommand["type"]>(CLIENT_COMMAND_TYPES);

export function decodeClientCommand(input: unknown): ClientCommand {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Command must be an object.");
  }
  const type = (input as { type?: unknown }).type;
  if (typeof type !== "string" || !COMMAND_TYPES.has(type as ClientCommand["type"])) {
    throw new Error(`Unknown command type "${String(type)}".`);
  }
  return input as ClientCommand;
}
