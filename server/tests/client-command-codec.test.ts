import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_COMMAND_TYPES, decodeClientCommand } from "../game/client-command-codec";

const EXPECTED_COMMAND_TYPES = [
  "join", "adminCommand", "moveShip", "moveFleet", "buildStarbase", "orbitPlanet",
  "colonizePlanet", "mergeFleets", "stopFleet", "setFleetDarkMatterBoost",
  "setSpeedMultiplier", "buildDistrict", "queuePlanetFeatureRemoval", "buildPlanetBuilding", "upgradePlanetBuilding",
  "downgradePlanetBuilding", "setPlanetBuildingEnabled", "setPlanetJobLock",
  "cancelPlanetConstruction", "skipPlanetConstruction",
  "buildPlanetDefenseBuilding", "upgradePlanetDefenseBuilding", "setPlanetDefenseBuildingEnabled",
  "demolishPlanetDefenseBuilding", "buildPlanetShip", "cancelShipConstruction", "orderArmyTransfer",
  "buildStarbaseBuilding",
  "upgradeStarbase", "buildStarbaseShip", "upgradeShip", "saveShipDesign",
  "decommissionShipDesign", "setActiveTechnology", "recruitLeader", "resolveEvent",
  "assignLeader", "dismissLeader", "setGovernmentLaw", "setSpeciesRights",
  "setUrbanSubDistrict", "marketTrade", "addMarketAutoTrade", "removeMarketAutoTrade",
  "sendDiplomacyMessage", "setBorderPolicy", "declareWar", "proposeTreaty",
  "respondDiplomacyProposal", "cancelTreaty", "cancelDiplomacyProposal", "proposePeace",
  "requestDetails", "subscribeDetails", "unsubscribeDetails", "retreatFleet",
  "retreatFleetTo", "emergencyRetreatFleetTo", "attackTarget", "attackSystem",
  "setFleetCombatSettings", "issueFleetTacticalOrder", "repairFleet",
] as const;

test("command decoder allowlist stays aligned with the public command contract", () => {
  assert.deepEqual(CLIENT_COMMAND_TYPES, EXPECTED_COMMAND_TYPES);
  assert.equal(new Set(CLIENT_COMMAND_TYPES).size, CLIENT_COMMAND_TYPES.length);
  for (const type of EXPECTED_COMMAND_TYPES) {
    const command = { type, marker: type };
    assert.equal(decodeClientCommand(command), command);
  }
});

test("command decoder rejects malformed and unknown input at the trust boundary", () => {
  for (const input of [null, undefined, 1, "join", [], {}, { type: 7 }, { type: "futureCommand" }]) {
    assert.throws(() => decodeClientCommand(input));
  }
});
