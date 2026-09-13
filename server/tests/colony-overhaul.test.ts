import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILDING_DEFINITIONS,
  CAPITAL_TIER_DEFINITIONS,
  CAPITAL_UPGRADE_POPULATION_THRESHOLDS,
  FRONTIER_SETTLEMENT_DURATION_YEARS,
  JOB_CLASS_BY_KIND,
  JOB_DEFINITIONS,
  JOB_FILL_ORDER,
  calculatePlanetEconomy,
  completePlanetConstructionQueueItem,
  createBuildingUpgradeConstructionQueueItem,
  createFrontierSettlementModifiers,
  createPlanetBuildingState,
  createPlanetStateFromSeed,
  getBuildingBuildDays,
  getBuildingCost,
  getBuildingDisplayDescription,
  getBuildingDisplayLabel,
  getBuildingHousing,
  getBuildingJobEffects,
  getBuildingLevelModifiers,
  getBuildingUpkeep,
  getConstructionSpeedMultiplier,
  getPlanetBuildingLevel,
  recalculatePlanetStateEconomy,
  removeExpiredPlanetModifiers,
} from "../../src/data/Economy";
import type {
  DistrictCounts,
  PlanetEconomySpeciesContext,
  PlanetJobLock,
  PlanetState,
} from "../../src/data/Economy";
import { getPlanetColonizationEligibility } from "../../src/data/Colonization";
import {
  MIGRATION_INTAKE_BY_CAPITAL_LEVEL,
  calculateMigrationIntakeCapacity,
} from "../../src/data/Population";
import { PLANET_TYPES, PlanetType } from "../../src/data/StarMap";
import type { PlanetConfig } from "../../src/data/StarMap";
import type { SpeciesState } from "../../src/data/Species";

const LIMITS: DistrictCounts = { city: 12, generator: 8, mining: 8, agriculture: 8 };
const ZERO_DISTRICTS: DistrictCounts = { city: 0, generator: 0, mining: 0, agriculture: 0 };

const CAPITAL_COSTS = [
  {},
  { food: 200, minerals: 1_200, energy: 800, goods: 200, alloys: 100 },
  { food: 500, minerals: 3_000, energy: 2_000, goods: 600, alloys: 300 },
  { food: 1_000, minerals: 7_000, energy: 5_000, goods: 1_500, alloys: 800 },
  { food: 2_000, minerals: 15_000, energy: 10_000, goods: 3_500, alloys: 2_000 },
] as const;
const CAPITAL_UPKEEP = [0, 2, 5, 10, 18] as const;
const CAPITAL_BUILD_DAYS = [1, 240, 720, 1_800, 3_600] as const;

function resourceCounts(partial: Partial<ReturnType<typeof getBuildingCost>>) {
  return {
    food: 0,
    minerals: 0,
    energy: 0,
    goods: 0,
    alloys: 0,
    research: 0,
    ...partial,
  };
}

function makePlanet(
  population = 500_000_000,
  speciesPopulations = [{ speciesId: "a", population }],
  capitalLevel = 1,
): PlanetState {
  return createPlanetStateFromSeed({
    id: "colony-test",
    starId: 0,
    planetIndex: 0,
    isHabited: true,
    habitability: 80,
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: LIMITS,
    starterInfrastructure: false,
    startingPopulation: population,
  }, {
    isHabited: true,
    population,
    speciesPopulations,
    builtDistricts: ZERO_DISTRICTS,
    buildings: {
      city: [createPlanetBuildingState("planetaryCapital", capitalLevel), null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
  });
}

test("all five capital tiers use authored totals and retain authored costs and sensors", () => {
  const expected = [
    {
      label: "Colony Headquarters",
      jobs: [
        { job: "colonizer", amount: 500_000_000 },
        { job: "sensorManager", amount: 1_000_000 },
      ],
      housing: 750_000_000,
      modifiers: [],
      migration: 5_000_000,
    },
    {
      label: "Planetary Administration",
      jobs: [
        { job: "ruler", amount: 500_000_000 },
        { job: "sensorManager", amount: 2_000_000 },
        { job: "enforcer", amount: 100_000_000 },
        { job: "entertainer", amount: 100_000_000 },
      ],
      housing: 0,
      modifiers: [],
      migration: 10_000_000,
    },
    {
      label: "Planetary Capital",
      jobs: [
        { job: "ruler", amount: 900_000_000 },
        { job: "sensorManager", amount: 3_000_000 },
        { job: "enforcer", amount: 150_000_000 },
        { job: "entertainer", amount: 150_000_000 },
      ],
      housing: 0,
      modifiers: [["stability", "add", 5], ["constructionSpeed", "multiply", 0.1]],
      migration: 20_000_000,
    },
    {
      label: "Planetary Directorate",
      jobs: [
        { job: "ruler", amount: 1_500_000_000 },
        { job: "sensorManager", amount: 4_000_000 },
        { job: "enforcer", amount: 200_000_000 },
        { job: "entertainer", amount: 200_000_000 },
      ],
      housing: 0,
      modifiers: [["stability", "add", 8], ["constructionSpeed", "multiply", 0.15]],
      migration: 40_000_000,
    },
    {
      label: "Planetary Nexus",
      jobs: [
        { job: "ruler", amount: 2_400_000_000 },
        { job: "sensorManager", amount: 5_000_000 },
        { job: "enforcer", amount: 250_000_000 },
        { job: "entertainer", amount: 250_000_000 },
      ],
      housing: 0,
      modifiers: [["stability", "add", 12], ["constructionSpeed", "multiply", 0.25]],
      migration: 80_000_000,
    },
  ] as const;

  assert.deepEqual(BUILDING_DEFINITIONS.planetaryCapital.sensorSuiteIds, ["planetaryCapitalSensors"]);
  for (let level = 1; level <= 5; level += 1) {
    const tier = expected[level - 1];
    assert.equal(CAPITAL_TIER_DEFINITIONS[level].label, tier.label);
    assert.equal(getBuildingDisplayLabel("planetaryCapital", level), tier.label);
    assert.ok(getBuildingDisplayDescription("planetaryCapital", level).length > 0);
    assert.deepEqual(getBuildingJobEffects("planetaryCapital", level), tier.jobs);
    assert.equal(getBuildingHousing("planetaryCapital", level), tier.housing);
    assert.deepEqual(
      getBuildingLevelModifiers("planetaryCapital", level).map((modifier) => [
        modifier.target,
        modifier.operation,
        modifier.value,
      ]),
      tier.modifiers,
    );
    assert.equal(MIGRATION_INTAKE_BY_CAPITAL_LEVEL[level], tier.migration);
    assert.equal(calculateMigrationIntakeCapacity(level, 2), tier.migration + 5_000_000);
    assert.deepEqual(getBuildingCost("planetaryCapital", level), resourceCounts(CAPITAL_COSTS[level - 1]));
    assert.deepEqual(getBuildingUpkeep("planetaryCapital", level), resourceCounts({ energy: CAPITAL_UPKEEP[level - 1] }));
    assert.equal(getBuildingBuildDays("planetaryCapital", level), CAPITAL_BUILD_DAYS[level - 1]);
  }
  assert.deepEqual(CAPITAL_UPGRADE_POPULATION_THRESHOLDS, {
    2: 5_000_000_000,
    3: 15_000_000_000,
    4: 35_000_000_000,
    5: 65_000_000_000,
  });
});

test("homeworlds normalize to administration while ordinary new colonies remain headquarters", () => {
  const homeworld = createPlanetStateFromSeed({
    id: "home",
    starId: 0,
    planetIndex: 0,
    isHabited: true,
    habitability: 90,
    features: ["homePlanet"],
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: LIMITS,
  }, {
    buildings: {
      city: [createPlanetBuildingState("planetaryCapital", 1), null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
  });
  const colony = makePlanet();
  assert.equal(getPlanetBuildingLevel(homeworld.buildings.city[0]), 2);
  assert.equal(getPlanetBuildingLevel(colony.buildings.city[0]), 1);
  assert.deepEqual(colony.builtDistricts, ZERO_DISTRICTS);
  assert.deepEqual(colony.jobLocks, []);
});

test("colonizers are lower-class frontier support workers in the intended fill position", () => {
  assert.equal(JOB_CLASS_BY_KIND.colonizer, "lower");
  assert.deepEqual(JOB_DEFINITIONS.colonizer.output, { food: 0.016 });
  assert.equal(JOB_DEFINITIONS.colonizer.amenities, 0.75);
  assert.equal(Object.hasOwn(JOB_DEFINITIONS.colonizer.output ?? {}, "energy"), false);
  assert.equal(Object.hasOwn(JOB_DEFINITIONS.colonizer.output ?? {}, "minerals"), false);
  assert.equal(JOB_FILL_ORDER.indexOf("colonizer"), JOB_FILL_ORDER.indexOf("technician") + 1);
  assert.equal(JOB_FILL_ORDER.indexOf("clerk"), JOB_FILL_ORDER.indexOf("colonizer") + 1);

  const colony = makePlanet();
  assert.equal(colony.economy.jobCapacity.colonizer, 500_000_000);
  assert.equal(colony.economy.popGroups.find((group) => group.job === "sensorManager")?.population, 1_000_000);
  assert.equal(colony.economy.popGroups.find((group) => group.job === "colonizer")?.population, 499_000_000);
  assert.equal(colony.economy.production.energy, 0);
  assert.equal(colony.economy.production.minerals, 0);
});

test("Frontier Settlement carries the complete authored effect set and expires at exactly ten years", () => {
  const foundedAt = 2250.25;
  const modifiers = createFrontierSettlementModifiers(foundedAt);
  assert.equal(FRONTIER_SETTLEMENT_DURATION_YEARS, 10);
  assert.equal(modifiers.length, 5);
  assert.ok(modifiers.every((modifier) => modifier.label === "Frontier Settlement"));
  assert.ok(modifiers.every((modifier) => modifier.expiresAtYear === 2260.25));
  assert.deepEqual(
    modifiers.map((modifier) => [modifier.target, modifier.operation, modifier.value]),
    [
      ["migrationAttractiveness", "add", 20],
      ["migrationIntakeCapacity", "add", 20_000_000],
      ["stability", "add", 10],
      ["constructionSpeed", "multiply", 0.25],
      ["populationGrowth", "multiply", 0.25],
    ],
  );

  const baseline = makePlanet();
  const supported = recalculatePlanetStateEconomy({ ...baseline, modifiers }, LIMITS);
  assert.ok(
    supported.economy.migration.attractiveness
      >= Math.min(100, baseline.economy.migration.attractiveness + 20),
  );
  assert.equal(
    supported.economy.migration.monthlyIntakeCapacity,
    baseline.economy.migration.monthlyIntakeCapacity + 20_000_000,
  );
  assert.equal(getConstructionSpeedMultiplier(supported, "district"), 1.25);
  assert.equal(supported.economy.populationGrowth.factors.modifierMultiplier, 1.25);
  assert.ok(supported.economy.stability >= baseline.economy.stability);

  const roundTripped = JSON.parse(JSON.stringify(supported)) as PlanetState;
  assert.ok(roundTripped.modifiers.every((modifier) => modifier.expiresAtYear === 2260.25));
  assert.equal(removeExpiredPlanetModifiers(roundTripped, 2260.249999).changed, false);
  const expired = removeExpiredPlanetModifiers(roundTripped, 2260.25);
  assert.equal(expired.changed, true);
  assert.equal(expired.state.modifiers.length, 0);
  const refreshed = recalculatePlanetStateEconomy(expired.state, LIMITS);
  assert.equal(refreshed.economy.migration.monthlyIntakeCapacity, baseline.economy.migration.monthlyIntakeCapacity);
});

test("all planet types expose authored default-colonization flags and a future override path", () => {
  const restricted = new Set([
    PlanetType.Gaseous,
    PlanetType.Methane,
    PlanetType.Barren,
    PlanetType.Dusty,
    PlanetType.Martian,
  ]);
  assert.equal(Object.values(PlanetType).length, 12);
  for (const type of Object.values(PlanetType)) {
    assert.equal(PLANET_TYPES[type].colonizableByDefault, !restricted.has(type), type);
  }

  const state = makePlanet();
  state.isHabited = false;
  state.population = 0;
  state.speciesPopulations = [];
  state.habitability = 55;
  const planet = { type: PlanetType.Methane, isHabited: false } as PlanetConfig;
  const base = {
    planet,
    planetState: state,
    systemOwnerId: 3,
    factionId: 3,
    foundingSpeciesId: "founders",
  };
  assert.equal(getPlanetColonizationEligibility(base).reason, "restrictedPlanetType");
  assert.equal(getPlanetColonizationEligibility({ ...base, allowRestrictedPlanetType: true }).eligible, true);
  assert.equal(getPlanetColonizationEligibility({ ...base, systemOwnerId: 4 }).reason, "systemNotOwned");
  assert.equal(
    getPlanetColonizationEligibility({
      ...base,
      allowRestrictedPlanetType: true,
      planetState: { ...state, habitability: 0 },
    }).reason,
    "zeroHabitability",
  );
  assert.equal(
    getPlanetColonizationEligibility({
      ...base,
      allowRestrictedPlanetType: true,
      planetState: { ...state, habitability: 60, isHabited: true },
    }).reason,
    "alreadyHabited",
  );
});

test("colonization eligibility uses founding-species trait-adjusted habitability", () => {
  const state = makePlanet();
  state.isHabited = false;
  state.population = 0;
  state.speciesPopulations = [];
  state.habitability = 5;
  const founders: SpeciesState = {
    id: "founders",
    name: "Founders",
    archetypeId: "humanoid",
    traitIds: ["nonadaptive"],
    originFactionId: 1,
  };
  const result = getPlanetColonizationEligibility({
    planet: { type: PlanetType.Grassland, isHabited: false } as PlanetConfig,
    planetState: state,
    systemOwnerId: 1,
    factionId: 1,
    foundingSpeciesId: founders.id,
    speciesContext: { species: [founders] },
  });
  assert.equal(result.foundingSpeciesHabitability, 0);
  assert.equal(result.reason, "zeroHabitability");
});

function speciesContext(workEligibilityB: "allJobs" | "laborOnly" = "allJobs"): PlanetEconomySpeciesContext {
  const species: SpeciesState[] = [
    { id: "a", name: "A", archetypeId: "humanoid", traitIds: [], originFactionId: 0 },
    { id: "b", name: "B", archetypeId: "reptilian", traitIds: [], originFactionId: 0 },
  ];
  return {
    species,
    rightsBySpeciesId: {
      a: {
        livingStandard: "basic",
        citizenship: "fullCitizenship",
        migration: "free",
        workEligibility: "allJobs",
      },
      b: {
        livingStandard: "basic",
        citizenship: "fullCitizenship",
        migration: "free",
        workEligibility: workEligibilityB,
      },
    },
  };
}

function rulerPopulation(economy: ReturnType<typeof calculatePlanetEconomy>, speciesId: string): number {
  return economy.popGroups
    .filter((group) => group.job === "ruler" && group.speciesId === speciesId)
    .reduce((sum, group) => sum + group.population, 0);
}

test("multi-species job locks clamp proportionally, preserve targets, and allow spare hiring", () => {
  const planet = makePlanet(
    700_000_000,
    [
      { speciesId: "a", population: 350_000_000 },
      { speciesId: "b", population: 350_000_000 },
    ],
    2,
  );
  const lock: PlanetJobLock = {
    job: "ruler",
    allocations: [
      { speciesId: "a", population: 350_000_000 },
      { speciesId: "b", population: 350_000_000 },
    ],
  };
  planet.jobLocks = [lock];
  const clamped = recalculatePlanetStateEconomy(planet, LIMITS, [], speciesContext());
  assert.equal(rulerPopulation(clamped.economy, "a"), 250_000_000);
  assert.equal(rulerPopulation(clamped.economy, "b"), 250_000_000);
  assert.deepEqual(clamped.jobLocks, [lock]);

  const spareLock: PlanetJobLock = {
    job: "ruler",
    allocations: [
      { speciesId: "a", population: 100_000_000 },
      { speciesId: "b", population: 100_000_000 },
    ],
  };
  const spare = recalculatePlanetStateEconomy({ ...planet, jobLocks: [spareLock] }, LIMITS, [], speciesContext());
  assert.equal(rulerPopulation(spare.economy, "a") + rulerPopulation(spare.economy, "b"), 500_000_000);
  assert.ok(rulerPopulation(spare.economy, "a") > 100_000_000);

  const roundingPlanet = makePlanet(
    500_000_001,
    [
      { speciesId: "a", population: 1 },
      { speciesId: "b", population: 500_000_000 },
    ],
    2,
  );
  roundingPlanet.jobLocks = [{
    job: "ruler",
    allocations: [
      { speciesId: "a", population: 1 },
      { speciesId: "b", population: 500_000_000 },
    ],
  }];
  const rounded = recalculatePlanetStateEconomy(roundingPlanet, LIMITS, [], speciesContext());
  assert.equal(rulerPopulation(rounded.economy, "a"), 1);
  assert.equal(rulerPopulation(rounded.economy, "b"), 499_999_999);
});

test("ineligible locked allocations remain recorded and refill when work rights return", () => {
  const lock: PlanetJobLock = {
    job: "ruler",
    allocations: [
      { speciesId: "a", population: 250_000_000 },
      { speciesId: "b", population: 250_000_000 },
    ],
  };
  const planet = makePlanet(
    500_000_000,
    [
      { speciesId: "a", population: 250_000_000 },
      { speciesId: "b", population: 250_000_000 },
    ],
    2,
  );
  planet.jobLocks = [lock];
  const restricted = recalculatePlanetStateEconomy(planet, LIMITS, [], speciesContext("laborOnly"));
  assert.equal(rulerPopulation(restricted.economy, "a"), 250_000_000);
  assert.equal(rulerPopulation(restricted.economy, "b"), 0);
  assert.deepEqual(restricted.jobLocks, [lock]);

  const restored = recalculatePlanetStateEconomy(restricted, LIMITS, [], speciesContext());
  assert.equal(rulerPopulation(restored.economy, "a"), 250_000_000);
  assert.equal(rulerPopulation(restored.economy, "b"), 250_000_000);
});

test("upgrading a headquarters permanently removes its colonizer lock", () => {
  const planet = makePlanet(5_000_000_000, [{ speciesId: "a", population: 5_000_000_000 }], 1);
  planet.jobLocks = [{
    job: "colonizer",
    allocations: [{ speciesId: "a", population: 500_000_000 }],
  }];
  const item = createBuildingUpgradeConstructionQueueItem(
    "planetaryCapital",
    1,
    "city",
    0,
    undefined,
    "capital-upgrade",
  );
  planet.constructionQueue = [item];
  const completed = completePlanetConstructionQueueItem(planet, item.id, LIMITS);
  assert.ok(completed);
  assert.equal(getPlanetBuildingLevel(completed?.state.buildings.city[0]), 2);
  assert.equal(completed?.state.jobLocks.some((lock) => lock.job === "colonizer"), false);
});
