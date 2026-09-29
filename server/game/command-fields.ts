import type { ClientCommand } from "../../src/game/GameProtocol";
import { BUILDING_KINDS, JOB_KINDS, PLANET_DEFENSE_BUILDING_KINDS, PLANET_FEATURE_KINDS, URBAN_SUB_DISTRICT_KINDS } from "../../src/data/Economy";
import { STARBASE_BUILDING_KINDS, STARBASE_SHIP_KINDS } from "../../src/data/Starbase";
import { MOBILE_ARMY_TYPE_IDS } from "../../src/data/Armies";
import { TECHNOLOGY_BY_ID } from "../../src/data/Technology";
import { GOVERNMENT_LAW_BY_ID } from "../../src/data/Government";
import { MARKET_RESOURCE_KINDS } from "../../src/data/Market";
import { COMBAT_STANCES, FLEET_BEHAVIORS, FLEET_CHASE_POLICIES, FLEET_RETREAT_POLICIES, FLEET_TACTICAL_ORDER_TYPES, FLEET_ENGAGEMENT_RULES, FLEET_DOCTRINES, FLEET_RETREAT_PRESETS } from "./validators";

type Check = (value: unknown) => boolean;
type Fields = Record<string, Check>;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (max = 256): Check => (v) => typeof v === "string" && v.length > 0 && v.length <= max;
const number: Check = (v) => typeof v === "number" && Number.isFinite(v);
const index: Check = (v) => number(v) && Number.isSafeInteger(v) && (v as number) >= 0;
const positive: Check = (v) => number(v) && (v as number) > 0;
const boolean: Check = (v) => typeof v === "boolean";
const optional = (check: Check): Check => (v) => v === undefined || check(v);
const nullable = (check: Check): Check => (v) => v === null || check(v);
const oneOf = (values: readonly string[]): Check => (v) => typeof v === "string" && values.includes(v);
const array = (check: Check, max = 256): Check => (v) => Array.isArray(v) && v.length <= max && v.every(check);
const object = (fields: Fields): Check => (v) => record(v) && Object.keys(v).every((key) => Object.hasOwn(fields, key)) && Object.entries(fields).every(([key, check]) => check(v[key]));
const position = object({ x: number, y: number, z: number });
const targetKind = oneOf(["fleet", "starbase"]);
const orbit = object({ kind: oneOf(["star", "planet", "starbase", "hyperlane", "fleet"]), starId: index, position,
  planetId: optional(nullable(text())), starbaseId: optional(nullable(text())), connectedStarId: optional(nullable(index)), targetFleetId: optional(nullable(text())) });
const retreatDestination = object({ kind: oneOf(["nearestFriendlyStarbase", "selectedSystem"]), targetStarId: optional(nullable(index)), targetSystemPosition: optional(nullable(position)) });
const settings = object({ behavior: optional(oneOf(FLEET_BEHAVIORS)), chasePolicy: optional(oneOf(FLEET_CHASE_POLICIES)), retreatPolicy: optional(oneOf(FLEET_RETREAT_POLICIES)), retreatDestination: optional(nullable(retreatDestination)),
  engagementRule: optional(oneOf(FLEET_ENGAGEMENT_RULES)), doctrine: optional(oneOf(FLEET_DOCTRINES)), retreatPreset: optional(oneOf(FLEET_RETREAT_PRESETS)) });
const order = object({ type: oneOf(FLEET_TACTICAL_ORDER_TYPES), targetId: optional(nullable(text())), targetKind: optional(nullable(targetKind)), targetPosition: optional(nullable(position)), guardPosition: optional(nullable(position)), issuedAtYear: optional(nullable(number)) });
const assignment = object({ kind: oneOf(["planet", "planetMilitary", "groundBattle", "fleet", "government"]), targetId: text() });
const rights = object({ livingStandard: optional(oneOf(["luxurious", "comfortable", "basic", "subsistence", "oppressed"])), citizenship: optional(oneOf(["fullCitizenship", "residence", "limitedRights", "nonCitizen"])), migration: optional(oneOf(["notAllowed", "internalOnly", "free"])), workEligibility: optional(oneOf(["allJobs", "noAuthority", "laborOnly"])) });
const articles = array(oneOf(["tradePrivilege", "migrationPact"]));
const terms = object({ mode: oneOf(["whitePeace", "statusQuo"]), transfers: array(object({ starbaseId: text(), fromFactionId: index, toFactionId: index })), enforcedArticleIds: articles, enforcedDurationYears: positive });
const context = object({ currentStarId: optional(nullable(index)), selectedFleetId: optional(nullable(text())), selectedFleetIds: optional(array(text())), selectedShipId: optional(nullable(text())), selectedStarbaseId: optional(nullable(text())), selectedPlanetId: optional(nullable(text())), perspectiveOwnerId: optional(nullable(number)) });
const scope = oneOf(["system", "planet", "starbase", "fleet", "fleetManager", "planetManager", "market", "diplomacy", "society", "technology", "leaders", "government", "selection", "hud"]);
const detail = { scope, id: optional(nullable((v) => text()(v) || index(v))), knownRevision: optional(nullable(text())) };
const fleet = { fleetId: text() };
const planet = { planetId: text() };
const starbase = { starbaseId: text() };
const buildingSlot = { ...planet, area: oneOf(["city", "generator", "mining", "agriculture", "urbanSubDistrict"]), slotIndex: index, subDistrictIndex: optional(index) };
const defenseSlot = { ...planet, section: oneOf(["defense", "shipyard"]), slotIndex: index };
const yard = { yardKind: oneOf(["planet", "starbase"]), yardId: text() };
const movement = { fleetId: optional(text()), shipId: optional(text()), targetStarId: index, targetSystemPosition: optional(position), orbitTarget: optional(nullable(orbit)) };
const ship = { shipKind: oneOf(STARBASE_SHIP_KINDS), designId: optional(text()) };

/** Exhaustive at compile time: adding a protocol command requires its decoder. */
export const COMMAND_FIELDS: Record<ClientCommand["type"], Fields> = {
  join: {}, adminCommand: { input: text(4096), context: optional(context) },
  moveFleet: movement, moveShip: movement, buildStarbase: { fleetId: optional(text()), shipId: optional(text()), targetStarId: index },
  orbitPlanet: { ...fleet, ...planet }, colonizePlanet: { ...fleet, ...planet },
  mergeFleets: { targetFleetId: text(), sourceFleetIds: array(text()) }, stopFleet: fleet,
  setFleetDarkMatterBoost: { ...fleet, enabled: boolean }, setSpeedMultiplier: { multiplier: (v) => number(v) && (v as number) >= 0 },
  buildDistrict: { ...planet, districtKind: oneOf(["city", "generator", "mining", "agriculture"]) },
  queuePlanetFeatureRemoval: { ...planet, featureKind: oneOf(PLANET_FEATURE_KINDS) },
  buildPlanetBuilding: { ...buildingSlot, buildingKind: oneOf(BUILDING_KINDS) },
  upgradePlanetBuilding: buildingSlot, downgradePlanetBuilding: buildingSlot,
  setPlanetBuildingEnabled: { ...buildingSlot, enabled: boolean },
  setPlanetJobLock: { ...planet, job: oneOf(JOB_KINDS.filter((job) => job !== "criminal" && job !== "unemployed")), locked: boolean },
  cancelPlanetConstruction: { ...planet, queueItemId: text() }, skipPlanetConstruction: { ...planet, queueItemId: text() },
  buildPlanetDefenseBuilding: { ...defenseSlot, buildingKind: oneOf(PLANET_DEFENSE_BUILDING_KINDS) },
  upgradePlanetDefenseBuilding: defenseSlot, demolishPlanetDefenseBuilding: defenseSlot,
  setPlanetDefenseBuildingEnabled: { ...defenseSlot, enabled: boolean },
  buildPlanetShip: { ...planet, ...ship }, cancelShipConstruction: { ...yard, queueItemId: text() },
  queueArmyRecruitment: { ...yard, armyTypeId: oneOf(MOBILE_ARMY_TYPE_IDS), speciesId: text() },
  landArmyFleet: { ...fleet, ...planet }, embarkPlanetArmies: { ...planet, armyIds: array(text()), embarkCommander: boolean },
  beginPlanetInvasion: { ...fleet, ...planet }, withdrawGroundBattle: { battleId: text() },
  buildStarbaseBuilding: { ...starbase, slotIndex: index, buildingKind: oneOf(STARBASE_BUILDING_KINDS) },
  upgradeStarbase: starbase, buildStarbaseShip: { ...starbase, ...ship },
  upgradeShip: { shipId: text(), ...starbase, targetDesignId: optional(text()) },
  saveShipDesign: { designId: optional(text()), shipKind: oneOf(STARBASE_SHIP_KINDS), name: text(256), weaponSectionModuleIds: optional(array(text())), defenseSectionModuleIds: optional(array(text())), weaponModuleIds: array(text()), defenseModuleIds: array(text()), utilityModuleIds: optional(array(text())), utilityModuleId: optional(nullable(text())) },
  decommissionShipDesign: { designId: text() }, setActiveTechnology: { techId: oneOf(Object.keys(TECHNOLOGY_BY_ID)) },
  recruitLeader: { leaderId: text() }, dismissLeader: { leaderId: text() }, assignLeader: { leaderId: text(), assignment: nullable(assignment) },
  resolveEvent: { eventId: text(), choiceId: text() }, setGovernmentLaw: { lawId: oneOf(Object.keys(GOVERNMENT_LAW_BY_ID)), optionId: text() },
  setSpeciesRights: { speciesId: text(), rights }, setUrbanSubDistrict: { ...planet, subDistrictIndex: index, subDistrictKind: oneOf(URBAN_SUB_DISTRICT_KINDS) },
  marketTrade: { resourceId: oneOf(MARKET_RESOURCE_KINDS), tradeType: oneOf(["buy", "sell"]), amount: positive },
  addMarketAutoTrade: { resourceId: oneOf(MARKET_RESOURCE_KINDS), tradeType: oneOf(["auto_buy", "auto_sell"]), amountPerHour: positive }, removeMarketAutoTrade: { orderId: text() },
  sendDiplomacyMessage: { targetFactionId: index, body: text(4096) }, setBorderPolicy: { targetFactionId: index, policy: oneOf(["open", "closed"]) }, declareWar: { targetFactionId: index },
  proposeTreaty: { targetFactionId: index, articleIds: articles, durationYears: optional(positive), replacesTreatyId: optional(nullable(text())) },
  respondDiplomacyProposal: { proposalId: text(), response: oneOf(["accept", "decline"]) }, cancelTreaty: { treatyId: text() }, cancelDiplomacyProposal: { proposalId: text() }, proposePeace: { targetFactionId: index, terms },
  requestDetails: detail, subscribeDetails: detail, unsubscribeDetails: { scope, id: detail.id },
  retreatFleet: fleet, retreatFleetTo: { ...fleet, targetStarId: index, targetSystemPosition: optional(position) }, emergencyRetreatFleetTo: { ...fleet, targetStarId: index },
  attackTarget: { ...fleet, targetId: text(), targetKind }, attackSystem: { ...fleet, targetStarId: index },
  setFleetCombatSettings: { ...fleet, combatSettings: settings, combatStance: optional(oneOf(COMBAT_STANCES)) }, issueFleetTacticalOrder: { ...fleet, order }, repairFleet: { constructionFleetId: text(), targetFleetId: text() },
};

export function validateCommandFields(command: Record<string, unknown>, type: ClientCommand["type"]): void {
  for (const [field, check] of Object.entries(COMMAND_FIELDS[type])) {
    if (!check(command[field])) throw new Error(`Invalid ${type} command field "${field}".`);
  }
  if (["moveFleet", "moveShip", "buildStarbase"].includes(type) && !command.fleetId && !command.shipId) {
    throw new Error("Command requires a fleet or ship ID.");
  }
}
