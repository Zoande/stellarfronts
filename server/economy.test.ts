import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addResourceCounts,
  applyPopulationGrowth,
  BUILDING_DEFINITIONS,
  BUILDING_MINERAL_COSTS,
  calculatePlanetEconomy,
  createBuildingConstructionQueueItem,
  createEmptyResourceCounts,
  createDistrictConstructionQueueItem,
  createPlanetStateFromSeed,
  getEffectiveSpeciesHabitability,
  getHabitabilityProductionMultiplier,
  getHabitabilityUpkeepMultiplier,
  isBuildingCompatible,
  JOB_DEFINITIONS,
  PLANET_FEATURE_DEFINITIONS,
  progressPlanetConstructionQueue,
  recalculatePlanetStateEconomy,
  STARTING_HABITED_POPULATION,
} from "../src/data/Economy";
import type { DistrictCounts } from "../src/data/Economy";

const DEFAULT_LIMITS: DistrictCounts = {
  city: 12,
  generator: 6,
  mining: 6,
  agriculture: 6,
};

const ZERO_DISTRICTS: DistrictCounts = {
  city: 0,
  generator: 0,
  mining: 0,
  agriculture: 0,
};

function createHabitedPlanet() {
  return createPlanetStateFromSeed({
    id: "test-planet",
    starId: 1,
    planetIndex: 0,
    isHabited: true,
    habitability: 80,
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: DEFAULT_LIMITS,
  });
}

test("starter habited planets receive population, starter districts, buildings, and economy", () => {
  const planet = createHabitedPlanet();

  assert.equal(planet.population, STARTING_HABITED_POPULATION);
  assert.deepEqual(planet.builtDistricts, {
    city: 4,
    generator: 2,
    mining: 2,
    agriculture: 2,
  });
  assert.equal(planet.buildings.city[0], "administrativeComplex");
  assert.equal(planet.buildings.city[1], "housingComplex");
  assert.equal(planet.buildings.generator[0], "energyGrid");
  assert.equal(planet.buildings.mining[0], "mineralPurificationPlant");
  assert.equal(planet.buildings.agriculture[0], "foodProcessingPlant");
  assert.equal(planet.urbanSubDistricts[0].kind, "residential");
  assert.equal(planet.urbanSubDistricts[1].kind, "mixedIndustry");
  assert.deepEqual(planet.speciesPopulations, [{ speciesId: "human", population: STARTING_HABITED_POPULATION }]);
  assert.ok(planet.economy.popGroups.length > 0);
  assert.ok(planet.economy.popGroups.every((group) => group.speciesId === "human" && Number.isInteger(group.happiness)));
});

test("job assignment fills upper and middle jobs before lower jobs", () => {
  const planet = createHabitedPlanet();
  planet.population = 1_200_000_000;
  planet.builtDistricts = {
    city: 1,
    generator: 1,
    mining: 1,
    agriculture: 1,
  };
  planet.buildings.city = ["administrativeComplex", "researchLabs", null, null, null, null];
  planet.urbanSubDistricts = [
    { kind: "residential", buildings: [null, null, null] },
    { kind: "mixedIndustry", buildings: [null, null, null] },
  ];

  const economy = calculatePlanetEconomy(planet);
  const administrators = economy.popGroups.find((group) => group.job === "administrator")?.population ?? 0;
  const researchers = economy.popGroups.find((group) => group.job === "researcher")?.population ?? 0;
  const farmers = economy.popGroups.find((group) => group.job === "farmer")?.population ?? 0;

  assert.equal(administrators, 300_000_000);
  assert.equal(researchers, 500_000_000);
  assert.equal(farmers, 0);
  assert.equal(economy.employedPopulation, 1_200_000_000);
});

test("resource deltas and deficits are computed from assigned population", () => {
  const planet = createHabitedPlanet();
  planet.population = 1_000_000_000;
  planet.builtDistricts = {
    city: 0,
    generator: 0,
    mining: 0,
    agriculture: 1,
  };
  planet.buildings = {
    city: [null, null, null, null, null, null],
    generator: [null, null, null],
    mining: [null, null, null],
    agriculture: [null, null, null],
  };
  planet.urbanSubDistricts = [
    { kind: "residential", buildings: [null, null, null] },
    { kind: "mixedIndustry", buildings: [null, null, null] },
  ];

  const economy = calculatePlanetEconomy(planet);

  assert.ok(economy.production.food > 0);
  assert.equal(economy.upkeep.food, 1_000);
  assert.equal(economy.net.food, economy.production.food - economy.upkeep.food);
  assert.equal(economy.upkeep.goods, 50);
  assert.equal(economy.deficit.goods, 50);
  assert.ok(economy.stability < 50);
  assert.ok(economy.crime > 0);
});

test("resource stockpile math allows negative stockpiles", () => {
  const stockpile = createEmptyResourceCounts();
  const monthlyDelta = createEmptyResourceCounts();
  monthlyDelta.goods = -250;

  const nextStockpile = addResourceCounts(stockpile, monthlyDelta);

  assert.equal(nextStockpile.goods, -250);
});

test("building compatibility rules enforce district and city sub-district slots", () => {
  assert.equal(isBuildingCompatible("researchLabs", "city"), true);
  assert.equal(isBuildingCompatible("researchLabs", "urbanSubDistrict", "researchCampus"), true);
  assert.equal(isBuildingCompatible("researchLabs", "urbanSubDistrict", "civilianIndustry"), false);
  assert.equal(isBuildingCompatible("foodProcessingPlant", "agriculture"), true);
  assert.equal(isBuildingCompatible("foodProcessingPlant", "mining"), false);
  assert.equal(isBuildingCompatible("alloyFoundries", "urbanSubDistrict", "heavyIndustry"), true);
  assert.equal(isBuildingCompatible("alloyFoundries", "urbanSubDistrict", "residential"), false);
  assert.equal(isBuildingCompatible("entertainmentForum", "city"), true);
  assert.equal(isBuildingCompatible("securityOffice", "urbanSubDistrict", "residential"), true);
  assert.equal(isBuildingCompatible("securityOffice", "urbanSubDistrict", "heavyIndustry"), false);
});

test("building and job definitions drive amenities and crime control", () => {
  assert.equal(BUILDING_DEFINITIONS.entertainmentForum.jobs?.[0].job, "entertainer");
  assert.equal(BUILDING_DEFINITIONS.securityOffice.jobs?.[0].job, "enforcer");
  assert.ok((JOB_DEFINITIONS.entertainer.amenities ?? 0) > 0);
  assert.ok((JOB_DEFINITIONS.enforcer.crimeReduction ?? 0) > 0);

  const baseline = recalculatePlanetStateEconomy({
    ...createHabitedPlanet(),
    population: 6_000_000_000,
    builtDistricts: { city: 2, generator: 0, mining: 0, agriculture: 0 },
    buildings: {
      city: [null, null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
  }, DEFAULT_LIMITS);
  const serviced = recalculatePlanetStateEconomy({
    ...baseline,
    buildings: {
      ...baseline.buildings,
      city: ["entertainmentForum", "securityOffice", null, null, null, null],
    },
  }, DEFAULT_LIMITS);

  assert.ok(serviced.economy.jobCapacity.entertainer > 0);
  assert.ok(serviced.economy.jobCapacity.enforcer > 0);
  assert.ok(serviced.economy.amenities > baseline.economy.amenities);
  assert.ok(serviced.economy.crime < baseline.economy.crime);
});

test("changing city sub-district kind drops incompatible buildings during normalization", () => {
  const planet = createHabitedPlanet();
  planet.urbanSubDistricts[0] = {
    kind: "researchCampus",
    buildings: ["researchLabs", "commercialForum", null],
  };

  const normalized = recalculatePlanetStateEconomy(planet);

  assert.equal(normalized.urbanSubDistricts[0].buildings[0], "researchLabs");
  assert.equal(normalized.urbanSubDistricts[0].buildings[1], null);
});

test("population growth increases managed planets under capacity", () => {
  const planet = createHabitedPlanet();
  const next = applyPopulationGrowth(planet, DEFAULT_LIMITS, 1);

  assert.ok(planet.economy.populationGrowth.netPerQuarter > 0);
  assert.ok(next.population > planet.population);
});

test("housing pressure slows growth without fully stopping it alone", () => {
  const planet = createHabitedPlanet();
  const baseline = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS);
  const cramped = recalculatePlanetStateEconomy({
    ...planet,
    buildings: {
      ...planet.buildings,
      city: ["administrativeComplex", null, null, null, null, null],
    },
  }, DEFAULT_LIMITS);

  assert.ok(cramped.economy.populationGrowth.netPerQuarter > 0);
  assert.ok(cramped.economy.populationGrowth.netPerQuarter < baseline.economy.populationGrowth.netPerQuarter);
});

test("overcrowding and unemployment can cause population decline", () => {
  const planet = createHabitedPlanet();
  const stressed = recalculatePlanetStateEconomy({
    ...planet,
    population: 40_000_000_000,
    builtDistricts: {
      city: 1,
      generator: 0,
      mining: 0,
      agriculture: 0,
    },
    buildings: {
      city: [null, null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
    urbanSubDistricts: [
      { kind: "mixedIndustry", buildings: [null, null, null] },
      { kind: "heavyIndustry", buildings: [null, null, null] },
    ],
  }, DEFAULT_LIMITS);
  const next = applyPopulationGrowth(stressed, DEFAULT_LIMITS, 1);

  assert.ok(stressed.economy.populationGrowth.netPerQuarter < 0);
  assert.ok(next.population < stressed.population);
});

test("existing habited population below starter value persists during normalization", () => {
  const planet = createPlanetStateFromSeed({
    id: "test-planet",
    starId: 1,
    planetIndex: 0,
    isHabited: true,
    habitability: null,
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: DEFAULT_LIMITS,
  }, {
    population: 8_500_000_000,
  });

  assert.equal(planet.population, 8_500_000_000);
  assert.deepEqual(planet.speciesPopulations, [{ speciesId: "human", population: 8_500_000_000 }]);
});

test("home planet feature raises effective human habitability", () => {
  const planet = createPlanetStateFromSeed({
    id: "test-planet",
    starId: 1,
    planetIndex: 0,
    isHabited: true,
    habitability: 80,
    features: ["homePlanet"],
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: DEFAULT_LIMITS,
  });

  assert.equal(getEffectiveSpeciesHabitability(planet), 100);
  assert.equal(PLANET_FEATURE_DEFINITIONS.homePlanet.modifiers[0].target, "habitability:human");
});

test("habitability multipliers cover hostile, normal, and ideal worlds", () => {
  assert.equal(getHabitabilityProductionMultiplier(0), 0.5);
  assert.equal(getHabitabilityProductionMultiplier(80), 1);
  assert.equal(getHabitabilityProductionMultiplier(100), 1.3);
  assert.equal(getHabitabilityUpkeepMultiplier(0), 1.5);
  assert.equal(getHabitabilityUpkeepMultiplier(80), 1);
  assert.equal(getHabitabilityUpkeepMultiplier(100), 0.7);
});

test("habitability, happiness, crime, and stability alter job throughput", () => {
  const hostile = recalculatePlanetStateEconomy({
    ...createHabitedPlanet(),
    habitability: 0,
    population: 1_000_000_000,
    builtDistricts: { city: 1, generator: 0, mining: 0, agriculture: 1 },
    buildings: {
      city: [null, null, null, null, null, null],
      generator: [null, null, null],
      mining: [null, null, null],
      agriculture: [null, null, null],
    },
  }, DEFAULT_LIMITS);
  const ideal = recalculatePlanetStateEconomy({
    ...hostile,
    habitability: 80,
    features: ["homePlanet"],
  }, DEFAULT_LIMITS);

  assert.ok(ideal.economy.happiness > hostile.economy.happiness);
  assert.ok(ideal.economy.crime < hostile.economy.crime);
  assert.ok(ideal.economy.stability > hostile.economy.stability);
  assert.ok(ideal.economy.production.food > hostile.economy.production.food);
  assert.ok(ideal.economy.upkeep.food < hostile.economy.upkeep.food);
});

test("planet modifiers alter job output, capacity, and growth", () => {
  const planet = createHabitedPlanet();
  planet.modifiers = [
    {
      id: "rich-soil",
      label: "Rich Soil",
      source: "test",
      target: "jobOutput:farmer:food",
      operation: "multiply",
      value: 0.5,
    },
    {
      id: "dense-cities",
      label: "Dense Cities",
      source: "test",
      target: "planetCapacity",
      operation: "multiply",
      value: 0.25,
    },
    {
      id: "growth-drive",
      label: "Growth Drive",
      source: "test",
      target: "populationGrowth",
      operation: "multiply",
      value: 0.25,
    },
  ];

  const baseline = recalculatePlanetStateEconomy(createHabitedPlanet(), DEFAULT_LIMITS);
  const modified = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS);

  assert.ok(modified.economy.production.food > baseline.economy.production.food);
  assert.ok(modified.economy.populationGrowth.capacity > baseline.economy.populationGrowth.capacity);
  assert.ok(modified.economy.populationGrowth.netPerQuarter > baseline.economy.populationGrowth.netPerQuarter);
  assert.equal(modified.economy.activeModifiers.length, 3);
});

test("construction queue completes districts and buildings over time", () => {
  const planet = createHabitedPlanet();
  const districtItem = createDistrictConstructionQueueItem("agriculture", "district-test");
  const buildingItem = createBuildingConstructionQueueItem("housingComplex", "city", 2, undefined, "building-test");
  const queued = recalculatePlanetStateEconomy({
    ...planet,
    constructionQueue: [districtItem, buildingItem],
  }, DEFAULT_LIMITS);

  const result = progressPlanetConstructionQueue(
    queued,
    districtItem.totalDays + buildingItem.totalDays,
    DEFAULT_LIMITS,
  );

  assert.equal(result.state.builtDistricts.agriculture, planet.builtDistricts.agriculture + 1);
  assert.equal(result.state.buildings.city[2], "housingComplex");
  assert.equal(result.state.constructionQueue.length, 0);
  assert.equal(result.completed.length, 2);
});

test("building mineral costs are exposed for server validation and UI", () => {
  assert.equal(BUILDING_MINERAL_COSTS.housingComplex, 450);
  assert.ok(BUILDING_MINERAL_COSTS.alloyFoundries > BUILDING_MINERAL_COSTS.housingComplex);
});
