import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDING_KINDS } from "../src/data/Economy";
import { SHIP_MODULE_DEFINITIONS, SHIP_SECTION_MODULE_DEFINITIONS } from "../src/data/ShipDesigns";
import { STARBASE_BUILDING_KINDS, STARBASE_SHIP_KINDS } from "../src/data/Starbase";
import {
  DEFAULT_COMPLETED_TECH_IDS,
  evaluateTechnologyResearch,
  getPassiveProgressCap,
  getRequiredTechIdsForBuilding,
  getRequiredTechIdsForShipHull,
  getRequiredTechIdsForShipModule,
  getRequiredTechIdsForShipSection,
  getRequiredTechIdsForStarbaseBuilding,
  normalizeFactionTechState,
  TECHNOLOGY_BY_ID,
} from "../src/data/Technology";
import type { ResearchContext } from "../src/data/Technology";

const EMPTY_CONTEXT: ResearchContext = {
  farmerJobs: 0,
  minerJobs: 0,
  researcherJobs: 0,
  artisanJobs: 0,
  metallurgistJobs: 0,
  technicianJobs: 0,
  fleetPower: 0,
  shipCount: 0,
  atWar: false,
  famine: false,
  lowFoodStockpile: false,
  foodIncome: 0,
  mineralsIncome: 0,
  alloyIncome: 0,
  energyIncome: 0,
  goodsIncome: 0,
  researchIncome: 0,
  researchLabs: 0,
  starbaseResearchAnnexes: 0,
};

test("baseline technologies are completed for current spacefaring factions", () => {
  const state = normalizeFactionTechState(1, undefined);

  assert.ok(DEFAULT_COMPLETED_TECH_IDS.includes("spacefaring_foundations"));
  assert.ok(DEFAULT_COMPLETED_TECH_IDS.includes("planetary_infrastructure"));
  assert.ok(state.completedTechIds.includes("spacefaring_foundations"));
  assert.ok(state.completedTechIds.includes("orbital_operations"));
  assert.equal(state.completedTechIds.includes("destroyer_hulls"), false);
  assert.equal(state.completedTechIds.includes("cruiser_hulls"), false);
  assert.equal(state.completedTechIds.includes("battleship_hulls"), false);
  assert.equal(state.progressByTechId.spacefaring_foundations.completed, true);
});

test("unlock requirements point at existing locked content", () => {
  assert.deepEqual(getRequiredTechIdsForBuilding("agroIndustrialKitchens"), ["agro_industrial_supply_chains"]);
  assert.deepEqual(getRequiredTechIdsForStarbaseBuilding("orbitalFabricator"), ["microgravity_fabrication"]);
  assert.deepEqual(getRequiredTechIdsForShipModule("weapon_point_defense"), ["point_defense_networks"]);
  assert.deepEqual(getRequiredTechIdsForShipModule("weapon_railgun_large"), ["kinetic_accelerators"]);
  assert.deepEqual(getRequiredTechIdsForShipModule("weapon_plasma_projector_large"), ["plasma_containment"]);
  assert.deepEqual(getRequiredTechIdsForShipModule("utility_command_uplink"), ["fleet_command_systems"]);
  assert.deepEqual(getRequiredTechIdsForShipSection("weapon_section_corvette_tanker"), ["heavy_corvette_frames"]);
  assert.deepEqual(getRequiredTechIdsForShipHull("constructionShip"), ["spacefaring_foundations"]);
  assert.deepEqual(getRequiredTechIdsForShipHull("colonizationShip"), ["spacefaring_foundations"]);
  assert.deepEqual(getRequiredTechIdsForShipHull("destroyer"), ["destroyer_hulls"]);
  assert.deepEqual(getRequiredTechIdsForShipHull("cruiser"), ["cruiser_hulls"]);
  assert.deepEqual(getRequiredTechIdsForShipHull("battleship"), ["battleship_hulls"]);
  assert.deepEqual(getRequiredTechIdsForShipSection("weapon_section_battleship_line"), ["battleship_hulls"]);
  assert.deepEqual(getRequiredTechIdsForShipSection("weapon_section_battleship_siege"), ["battleship_hulls"]);
});

test("all current buildings, hulls, modules, and sections have a technology mapping", () => {
  const missing: string[] = [];
  for (const building of BUILDING_KINDS) {
    if (getRequiredTechIdsForBuilding(building).length === 0) missing.push(`building:${building}`);
  }
  for (const building of STARBASE_BUILDING_KINDS) {
    if (getRequiredTechIdsForStarbaseBuilding(building).length === 0) missing.push(`starbaseBuilding:${building}`);
  }
  for (const shipKind of STARBASE_SHIP_KINDS) {
    if (getRequiredTechIdsForShipHull(shipKind).length === 0) missing.push(`hull:${shipKind}`);
  }
  for (const moduleId of Object.keys(SHIP_MODULE_DEFINITIONS)) {
    if (getRequiredTechIdsForShipModule(moduleId).length === 0) missing.push(`module:${moduleId}`);
  }
  for (const sectionModuleId of Object.keys(SHIP_SECTION_MODULE_DEFINITIONS)) {
    if (getRequiredTechIdsForShipSection(sectionModuleId).length === 0) missing.push(`section:${sectionModuleId}`);
  }

  assert.deepEqual(missing, []);
});

test("research modifiers clamp individual sources and final multiplier", () => {
  const tech = TECHNOLOGY_BY_ID.field_biochemistry;
  const evaluation = evaluateTechnologyResearch(tech, {
    ...EMPTY_CONTEXT,
    farmerJobs: 20_000,
    lowFoodStockpile: true,
    famine: true,
  });

  const farmerBonus = evaluation.breakdown.find((entry) => entry.id === "farmer_job_bonus");
  assert.equal(farmerBonus?.bonus, 0.35);
  assert.equal(evaluation.multiplier, 1.58);
});

test("passive research cap defaults to eighty percent", () => {
  const tech = TECHNOLOGY_BY_ID.industrial_tooling;

  assert.equal(getPassiveProgressCap(tech), tech.cost * 0.8);
});
