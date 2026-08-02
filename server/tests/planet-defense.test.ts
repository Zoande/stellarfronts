import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANET_DEFENSE_BUILDING_DEFINITIONS,
  createEmptyPlanetDefenseState,
  createPlanetBuildingState,
  createPlanetStateFromSeed,
  getActivePlanetDefenseBuildings,
  getPlanetDefensePlatformCapacity,
  getUnlockedPlanetDefenseSlots,
  getUnlockedPlanetShipyardSlots,
  normalizePlanetDefenseState,
  recalculatePlanetStateEconomy,
} from "../../src/data/Economy";
import type { PlanetState } from "../../src/data/Economy";
import { SENSOR_SUITE_DEFINITIONS } from "../../src/data/Intelligence";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
} from "../../src/data/ShipDesigns";
import { completeArmyTransfer } from "../game/fleet-combat";
import { recruitPlanetCrew } from "../game/economy-tick";
import type { GameFleet, GameShip, RuntimeContext } from "../game/types";
import { createInitialGovernmentState } from "../../src/data/Government";
import { createInitialDiplomacyState } from "../../src/data/Diplomacy";

function defensePlanet(): PlanetState {
  return {
    buildings: {
      city: [null, null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
    urbanSubDistricts: [],
    defense: createEmptyPlanetDefenseState(),
  } as unknown as PlanetState;
}

test("enabled fortresses and foundries unlock only their authored slot groups", () => {
  const planet = defensePlanet();
  planet.buildings.city[0] = createPlanetBuildingState("fortress", 1);
  planet.buildings.city[1] = createPlanetBuildingState("fortress", 1);
  planet.buildings.city[2] = createPlanetBuildingState("alloyFoundries", 4);
  planet.buildings.city[3] = createPlanetBuildingState("alloyFoundries", 1, false);

  assert.equal(getUnlockedPlanetDefenseSlots(planet), 4);
  assert.equal(getUnlockedPlanetShipyardSlots(planet), 1);

  planet.buildings.city[0] = createPlanetBuildingState("fortress", 1, false);
  assert.equal(getUnlockedPlanetDefenseSlots(planet), 2);
  planet.buildings.city[0] = createPlanetBuildingState("fortress", 1);
  planet.buildings.city[4] = createPlanetBuildingState("fortress", 1);
  assert.equal(getUnlockedPlanetDefenseSlots(planet), 6);
});

test("overflow planetary facilities suspend deterministically and reactivate with capacity", () => {
  const planet = defensePlanet();
  planet.buildings.city[0] = createPlanetBuildingState("fortress", 1);
  planet.buildings.city[1] = createPlanetBuildingState("alloyFoundries", 1);
  planet.defense.defenseSlots[0] = { kind: "platformSupport", level: 1, enabled: true };
  planet.defense.defenseSlots[2] = { kind: "platformSupport", level: 1, enabled: true };
  planet.defense.shipyardSlots[0] = { kind: "orbitalShipyard", level: 1, enabled: true };
  planet.defense.shipyardSlots[1] = { kind: "platformSupport", level: 1, enabled: true };

  assert.deepEqual(
    getActivePlanetDefenseBuildings(planet).map((building) => `${building.section}:${building.slotIndex}`),
    ["defense:0", "shipyard:0"],
  );
  assert.equal(getPlanetDefensePlatformCapacity(planet), 2);

  planet.buildings.city[2] = createPlanetBuildingState("fortress", 1);
  planet.buildings.city[3] = createPlanetBuildingState("alloyFoundries", 1);
  assert.deepEqual(
    getActivePlanetDefenseBuildings(planet).map((building) => `${building.section}:${building.slotIndex}`),
    ["defense:0", "defense:2", "shipyard:0", "shipyard:1"],
  );
  assert.equal(getPlanetDefensePlatformCapacity(planet), 6);
});

test("planetary facility balance and sensor intelligence bands match protocol 9", () => {
  assert.deepEqual(PLANET_DEFENSE_BUILDING_DEFINITIONS.barracks.levels[1].cost, {
    food: 0,
    minerals: 1_500,
    energy: 0,
    goods: 250,
    alloys: 200,
    research: 0,
  });
  assert.equal(PLANET_DEFENSE_BUILDING_DEFINITIONS.platformSupport.platformCapacity, 2);
  assert.equal(PLANET_DEFENSE_BUILDING_DEFINITIONS.orbitalShipyard.shipyards, 1);
  assert.equal(SENSOR_SUITE_DEFINITIONS.planetarySensorArray1.maxRange, 2);
  assert.equal(SENSOR_SUITE_DEFINITIONS.planetarySensorArray2.maxRange, 3);
  assert.equal(SENSOR_SUITE_DEFINITIONS.planetarySensorArray3.maxRange, 4);
  assert.deepEqual(
    SENSOR_SUITE_DEFINITIONS.planetarySensorArray3.bands[4]?.bundles,
    ["stellar", "topology", "fleetContact", "fleetClassification"],
  );
});

test("Army Ships have fixed personnel and no generated defenses", () => {
  const design = createDefaultShipDesign(0, "armyShip", 2200);
  const stats = calculateShipDesignStats(design);
  assert.equal(stats.crewDemand, 50_000);
  assert.equal(stats.combat.maxShield, 0);
  assert.equal(stats.combat.maxArmor, 0);
  assert.deepEqual(stats.combat.weaponMounts, []);
  assert.ok(stats.combat.maxHull > 0);
});

test("malformed planetary defense personnel and slots normalize deterministically", () => {
  const normalized = normalizePlanetDefenseState({
    defenseSlots: [
      { kind: "sensorArray", level: 99, enabled: true },
      { kind: "orbitalShipyard", level: 1, enabled: true },
    ],
    shipyardSlots: [{ kind: "platformSupport", level: -4, enabled: false }],
    stationedArmies: -20,
    traineeRemainders: [
      { speciesId: "b", population: 2_500_000 },
      { speciesId: "a", population: 10_000 },
    ],
  });
  assert.equal(normalized.defenseSlots.length, 6);
  assert.equal(normalized.shipyardSlots.length, 3);
  assert.deepEqual(normalized.defenseSlots[0], { kind: "sensorArray", level: 3, enabled: true });
  assert.equal(normalized.defenseSlots[1], null);
  assert.deepEqual(normalized.shipyardSlots[0], { kind: "platformSupport", level: 1, enabled: false });
  assert.equal(normalized.stationedArmies, 0);
  assert.deepEqual(normalized.traineeRemainders, [
    { speciesId: "a", population: 10_000 },
    { speciesId: "b", population: 999_999 },
  ]);
});

test("Army Ship groups fill deterministically and drop their aggregate payload", () => {
  const planet = defensePlanet();
  planet.id = "planet";
  planet.ownerId = 0;
  planet.isHabited = true;
  planet.defense.stationedArmies = 70_000;
  const fleet = {
    id: "army-fleet",
    ownerId: 0,
    shipIds: ["ship-b", "ship-a"],
    pendingArmyTransfer: { planetId: planet.id, mode: "fill" },
  } as unknown as GameFleet;
  const ships = [
    { id: "ship-b", ownerId: 0, fleetId: fleet.id, shipKind: "armyShip", crew: 0, crewCapacity: 50_000 },
    { id: "ship-a", ownerId: 0, fleetId: fleet.id, shipKind: "armyShip", crew: 0, crewCapacity: 50_000 },
  ] as GameShip[];
  const refreshed: string[] = [];
  const ctx = {
    state: { planetStates: [planet], ships },
    hasDirtyState: false,
    recalculatePlanetEconomies: () => undefined,
    refreshFactionEconomyDeltas: () => undefined,
    queuePlanetDetailRefresh: (planetId: string) => refreshed.push(planetId),
  } as unknown as RuntimeContext;

  assert.equal(completeArmyTransfer(ctx, fleet), true);
  assert.equal(ships.find((ship) => ship.id === "ship-a")?.crew, 50_000);
  assert.equal(ships.find((ship) => ship.id === "ship-b")?.crew, 20_000);
  assert.equal(planet.defense.stationedArmies, 0);
  assert.deepEqual(refreshed, ["planet"]);

  fleet.pendingArmyTransfer = { planetId: planet.id, mode: "drop" };
  assert.equal(completeArmyTransfer(ctx, fleet), true);
  assert.equal(ships[0].crew, 0);
  assert.equal(ships[1].crew, 0);
  assert.equal(planet.defense.stationedArmies, 70_000);
});

test("Barracks recruit exactly ten thousand Crew monthly and preserve fractional locks", () => {
  const limits = { city: 12, generator: 6, mining: 6, agriculture: 6 };
  const builtDistricts = { city: 0, generator: 0, mining: 0, agriculture: 0 };
  let planet = createPlanetStateFromSeed({
    id: "recruiting-world",
    starId: 0,
    planetIndex: 0,
    ownerId: 0,
    isHabited: true,
    habitability: 80,
    builtDistricts,
    districtLimits: limits,
    starterInfrastructure: false,
    startingPopulation: 600_000_000,
  });
  planet = recalculatePlanetStateEconomy({
    ...planet,
    buildings: {
      ...planet.buildings,
      city: [
        createPlanetBuildingState("planetaryCapital", 1),
        createPlanetBuildingState("fortress", 1),
        null,
        null,
        null,
        null,
      ],
    },
    defense: {
      ...planet.defense,
      defenseSlots: [
        { kind: "barracks", level: 1, enabled: true },
        null,
        null,
        null,
        null,
        null,
      ],
    },
  }, limits);
  const initialPopulation = planet.population;
  assert.equal(
    planet.economy.popGroups
      .filter((group) => group.job === "trainee")
      .reduce((total, group) => total + group.population, 0),
    5_000_000,
  );
  const ctx = {
    state: {
      planetStates: [planet],
      stars: [],
      species: [],
      speciesRights: [],
      governments: [createInitialGovernmentState(0)],
      diplomacy: createInitialDiplomacyState([0]),
      situations: [],
      events: [],
      factionModifiers: [],
      factionEconomies: [],
      factionTechnologies: [],
      leaders: [],
      nebulae: [],
      starbases: [],
      ships: [],
      fleets: [],
    },
    queuePlanetDetailRefresh: () => undefined,
    hasDirtyState: false,
  } as unknown as RuntimeContext;

  assert.equal(recruitPlanetCrew(ctx, 0, 1), 10_000);
  assert.equal(ctx.state.planetStates[0].population, initialPopulation - 10_000);
  assert.deepEqual(ctx.state.planetStates[0].defense.traineeRemainders, [
    { speciesId: "human", population: 990_000 },
  ]);

  assert.equal(recruitPlanetCrew(ctx, 0, 1), 10_000);
  assert.equal(ctx.state.planetStates[0].population, initialPopulation - 20_000);
  assert.deepEqual(ctx.state.planetStates[0].defense.traineeRemainders, [
    { speciesId: "human", population: 980_000 },
  ]);
});
