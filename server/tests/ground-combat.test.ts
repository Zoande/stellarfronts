import assert from "node:assert/strict";
import test from "node:test";
import {
  ARMY_MANPOWER,
  ARMY_TYPE_DEFINITIONS,
  calculateGroundDailyLoss,
  createArmyUnit,
  getArmyCurrentPower,
  getArmyHabitabilityMultiplier,
  getArmyMaxHp,
  getPlanetCombatWidth,
  selectStrongestArmyIds,
} from "../../src/data/Armies";
import { PlanetType } from "../../src/data/StarMap";
import type { LeaderState } from "../../src/data/Leaders";
import {
  getArmyRecruitmentCap,
  getInvasionBlocker,
  processArmyAndCrewReplenishment,
  processGroundBattles,
} from "../game/ground-combat";
import { getGroundLeaderEffects } from "../game/state-queries";
import type { GameState, RuntimeContext } from "../game/types";
import { completeMergeSourceFleet } from "../game/fleet-combat";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";

test("army definitions, species HP, habitability, and current power follow authored curves", () => {
  assert.deepEqual(
    Object.keys(ARMY_TYPE_DEFINITIONS),
    ["lightInfantry", "lineInfantry", "mechanizedArmy", "garrison"],
  );
  assert.equal(getArmyMaxHp([]), 100);
  assert.equal(getArmyMaxHp(["resilient"]), 110);
  assert.equal(getArmyMaxHp(["delicate"]), 90);
  assert.equal(getArmyHabitabilityMultiplier(0), 0.6);
  assert.equal(getArmyHabitabilityMultiplier(80), 1);
  assert.equal(getArmyHabitabilityMultiplier(100), 1.1);

  const army = createArmyUnit({
    id: "army-a",
    ownerId: 0,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "planet", planetId: "world" },
  });
  army.hp = 50;
  army.manpower = ARMY_MANPOWER / 2;
  const power = getArmyCurrentPower(army);
  assert.equal(power.attack, 2_000);
  assert.equal(power.defense, 2_000);
  assert.equal(power.nominal, 2_000);
});

test("planet type and feature modifiers produce deterministic combat width with a floor of one", () => {
  assert.equal(getPlanetCombatWidth(PlanetType.Grassland, []), 4);
  assert.equal(getPlanetCombatWidth(PlanetType.Jungle, ["stableFoundations", "strategicCrossroads"]), 5);
  assert.equal(getPlanetCombatWidth(PlanetType.Methane, ["vastCavernNetwork", "shatteredCrust"]), 1);
  assert.equal(getPlanetCombatWidth(PlanetType.Barren, ["ecumenicFoundations", "seismicFaults"]), 4);
});

test("ground engagement selection is strongest-first with stable IDs and daily losses are clamped", () => {
  assert.deepEqual(selectStrongestArmyIds([
    { id: "z", power: 12 },
    { id: "b", power: 20 },
    { id: "a", power: 20 },
    { id: "x", power: 5 },
  ], 3), ["a", "b", "z"]);

  const equal = calculateGroundDailyLoss(10_000, 10_000);
  assert.equal(equal.ratio, 1);
  assert.equal(equal.hp, 100 / 90);
  assert.equal(equal.manpower, 50_000 / 120);
  assert.equal(calculateGroundDailyLoss(1, 100).ratio, 0.25);
  assert.equal(calculateGroundDailyLoss(1_000, 1).ratio, 4);
});

test("army recruitment caps count completed and queued units and never remove grandfathered units", () => {
  const first = createArmyUnit({
    id: "existing-a",
    ownerId: 0,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "planet", planetId: "world" },
  });
  const second = createArmyUnit({
    id: "existing-b",
    ownerId: 0,
    speciesId: "human",
    typeId: "lineInfantry",
    location: { kind: "planet", planetId: "world" },
  });
  const state = {
    armies: [first, second],
    starbases: [{ ownerId: 0, shipQueue: [{ kind: "armyBuild", speciesId: "human" }] }],
    planetStates: [{
      id: "world",
      ownerId: 0,
      isHabited: true,
      speciesPopulations: [{ speciesId: "human", population: 250_000_000 }],
      defense: { shipQueue: [{ kind: "armyBuild", speciesId: "human" }] },
    }],
  } as unknown as GameState;
  assert.deepEqual(getArmyRecruitmentCap(state, 0, "human"), { used: 4, cap: 2 });
  state.planetStates[0].speciesPopulations[0].population = 50_000_000;
  assert.deepEqual(getArmyRecruitmentCap(state, 0, "human"), { used: 4, cap: 0 });
  assert.equal(state.armies.length, 2);
});

test("ground commanders combine capped level bonuses with authored attack, defense, and logistics traits", () => {
  const leader: LeaderState = {
    id: "commander",
    factionId: 0,
    class: "military",
    gender: "female",
    speciesArchetypeId: "humanoid",
    name: "Test Commander",
    level: 6,
    xp: 0,
    age: 40,
    lifespan: 100,
    status: "recruited",
    traits: ["aggressive", "fortificationExpert", "fieldLogistician"],
    assignment: { kind: "planetMilitary", targetId: "world" },
    createdAtYear: 2200,
  };
  const state = { leaders: [leader] } as unknown as GameState;
  const attacking = getGroundLeaderEffects(state, "planetMilitary", "world", false);
  const defending = getGroundLeaderEffects(state, "planetMilitary", "world", true);
  assert.equal(Number(attacking.attackMultiplier.toFixed(4)), 1.15);
  assert.equal(Number(attacking.defenseMultiplier.toFixed(4)), 1.02);
  assert.equal(Number(attacking.upkeepMultiplier.toFixed(4)), 0.9);
  assert.equal(Number(attacking.recoveryMultiplier.toFixed(4)), 1.25);
  assert.equal(Number(defending.defenseMultiplier.toFixed(4)), 1.22);
});

test("friendly landed armies restore HP freely and consume Crew for manpower and stored transport Crew", () => {
  const army = createArmyUnit({
    id: "landed",
    ownerId: 0,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "planet", planetId: "world" },
    transportShipId: "transport",
  });
  army.hp = 50;
  army.manpower = 0;
  army.landedTransport = {
    id: "transport",
    speed: 1,
    hp: 100,
    maxHp: 100,
    shield: 0,
    maxShield: 0,
    armor: 0,
    maxArmor: 0,
    hull: 100,
    maxHull: 100,
    crew: 0,
    crewCapacity: 10_000,
  };
  const state = {
    armies: [army],
    groundBattles: [],
    leaders: [],
    fleets: [],
    ships: [],
    starbases: [],
    planetStates: [{ id: "world", ownerId: 0 }],
    factionEconomies: [{ factionId: 0, crewStockpile: 100_000 }],
  } as unknown as GameState;
  const changed = processArmyAndCrewReplenishment({ state } as RuntimeContext, 90);
  assert.equal(changed, true);
  assert.equal(army.hp, 100);
  assert.equal(army.manpower, 25_000);
  assert.equal(army.landedTransport.crew, 5_000);
  assert.equal(state.factionEconomies[0].crewStockpile, 70_000);
});

test("merging Army Fleets preserves unit linkage and resolves duplicate commanders", () => {
  const army = createArmyUnit({
    id: "army-source",
    ownerId: 0,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "fleet", fleetId: "source" },
    transportShipId: "army-ship",
  });
  const source = {
    id: "source",
    ownerId: 0,
    shipIds: ["army-ship"],
    currentStarId: 0,
    phase: "idle",
    systemPosition: { x: 5, y: 0, z: 5 },
    hyperlanePosition: null,
    movementPlan: null,
    mergeTargetFleetId: "target",
  };
  const target = {
    id: "target",
    ownerId: 0,
    shipIds: ["target-ship"],
    currentStarId: 0,
    phase: "idle",
    systemPosition: { x: 5, y: 0, z: 5 },
    hyperlanePosition: null,
    movementPlan: null,
    stationaryStarbaseId: null,
    stationaryPlanetId: null,
  };
  const sourceCommander = {
    id: "source-commander",
    status: "recruited",
    assignment: { kind: "fleet", targetId: "source" },
  };
  const targetCommander = {
    id: "target-commander",
    status: "recruited",
    assignment: { kind: "fleet", targetId: "target" },
  };
  const state = {
    clock: { year: 2200 },
    fleets: [source, target],
    ships: [
      { id: "army-ship", fleetId: "source" },
      { id: "target-ship", fleetId: "target" },
    ],
    armies: [army],
    leaders: [sourceCommander, targetCommander],
  } as unknown as GameState;
  const merged = completeMergeSourceFleet({
    state,
    syncFleetMembership: () => false,
  } as unknown as RuntimeContext, source as never);
  assert.equal(merged, true);
  assert.equal(state.fleets.some((fleet) => fleet.id === "source"), false);
  assert.deepEqual(target.shipIds, ["target-ship", "army-ship"]);
  assert.deepEqual(army.location, { kind: "fleet", fleetId: "target" });
  assert.equal(state.ships.find((ship) => ship.id === "army-ship")?.fleetId, "target");
  assert.equal(sourceCommander.assignment, null);
  assert.deepEqual(targetCommander.assignment, { kind: "fleet", targetId: "target" });
});

test("daily losses are simultaneous and a double wipe leaves the defender in control", () => {
  const attacker = createArmyUnit({
    id: "attacker",
    ownerId: 0,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "planet", planetId: "world" },
  });
  const defender = createArmyUnit({
    id: "defender",
    ownerId: 1,
    speciesId: "human",
    typeId: "lightInfantry",
    location: { kind: "planet", planetId: "world" },
  });
  attacker.hp = defender.hp = 1;
  attacker.manpower = defender.manpower = 100;
  const lastProcessedDay = 1_000;
  const planet = {
    id: "world",
    starId: 0,
    planetIndex: 0,
    ownerId: 1,
    isHabited: true,
    habitability: 80,
    population: 1_000_000,
    speciesPopulations: [{ speciesId: "human", population: 1_000_000 }],
    features: [],
    modifiers: [],
    buildings: { city: [], generator: [], mining: [], agriculture: [] },
    urbanSubDistricts: [],
    economy: { popGroups: [] },
    defense: { shipQueue: [] },
  };
  const battle = {
    id: "battle",
    planetId: "world",
    attackerFactionId: 0,
    defenderFactionId: 1,
    attackerArmyIds: [attacker.id],
    defenderArmyIds: [defender.id],
    startedAtYear: 0,
    lastProcessedDay,
    withdrawalRequestedAtYear: null,
    withdrawalDueYear: null,
  };
  const state = {
    clock: { year: (lastProcessedDay + 1) / GAME_DAYS_PER_YEAR },
    stars: [{ system: { planets: [{ type: PlanetType.Grassland }] } }],
    planetStates: [planet],
    armies: [attacker, defender],
    groundBattles: [battle],
    leaders: [],
    species: [],
    speciesRights: [],
    situations: [],
    factionTechnologies: [],
    governments: [],
    factionModifiers: [],
    diplomacy: {
      borders: [], treaties: [], proposals: [], chatMessages: [],
      wars: [{ id: "war", attackerFactionId: 0, defenderFactionId: 1, startedAtYear: 0, preWarOwnership: [] }],
    },
  } as unknown as GameState;
  assert.equal(processGroundBattles({ state } as RuntimeContext), true);
  assert.equal(state.armies.length, 0);
  assert.equal(state.groundBattles.length, 0);
  assert.equal(planet.ownerId, 1);
});

test("invasion blockers are limited to hostile armed forces at the target planet", () => {
  const attackerFleet = { id: "army-fleet", ownerId: 0, shipIds: ["army-ship"], currentStarId: 0 };
  const hostileFleet = {
    id: "hostile",
    ownerId: 1,
    shipIds: ["warship"],
    currentStarId: 0,
    stationaryPlanetId: "world",
    orbitTarget: null,
  };
  const state = {
    ships: [
      { id: "army-ship", shipKind: "armyShip", armyUnitId: "army", hull: 100 },
      { id: "warship", shipKind: "corvette", hull: 100 },
    ],
    fleets: [attackerFleet, hostileFleet],
    diplomacy: {
      borders: [], treaties: [], proposals: [], chatMessages: [],
      wars: [{ id: "war", attackerFactionId: 0, defenderFactionId: 1, startedAtYear: 0, preWarOwnership: [] }],
    },
  } as unknown as GameState;
  const planet = { id: "world", starId: 0 } as never;
  assert.match(getInvasionBlocker(state, attackerFleet as never, planet) ?? "", /Hostile naval forces/);
  hostileFleet.stationaryPlanetId = "another-world";
  assert.equal(getInvasionBlocker(state, attackerFleet as never, planet), null);
  hostileFleet.stationaryPlanetId = "world";
  state.ships[1].shipKind = "scienceShip";
  assert.equal(getInvasionBlocker(state, attackerFleet as never, planet), null);
  state.ships[1].shipKind = "defensePlatform";
  assert.match(getInvasionBlocker(state, attackerFleet as never, planet) ?? "", /planetary platforms/);
});
