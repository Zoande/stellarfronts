import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addResourceCounts,
  applyPopulationGrowth,
  BUILDING_DEFINITIONS,
  BUILDING_MINERAL_COSTS,
  calculatePlanetEconomy,
  completePlanetConstructionQueueItem,
  createBuildingConstructionQueueItem,
  createBuildingUpgradeConstructionQueueItem,
  createEmptyResourceCounts,
  createDistrictConstructionQueueItem,
  createPlanetBuildingState,
  createPlanetStateFromSeed,
  getEffectiveSpeciesHabitability,
  getPlanetBuildingKind,
  getPlanetBuildingLevel,
  getHabitabilityProductionMultiplier,
  getHabitabilityUpkeepMultiplier,
  isBuildingCompatible,
  JOB_DEFINITIONS,
  PEOPLE_PER_MONTHLY_UNIT,
  PLANET_FEATURE_DEFINITIONS,
  progressPlanetConstructionQueue,
  recalculatePlanetStateEconomy,
  STARTING_HABITED_POPULATION,
} from "../../src/data/Economy";
import type { DistrictCounts, PlanetBuildingSlot, PlanetEconomySpeciesContext } from "../../src/data/Economy";
import type { SpeciesState } from "../../src/data/Species";
import {
  dailyToRealMinute,
  gameHourToRealMinute,
  monthlyToRealMinute,
  quarterlyToRealMinute,
  realMinuteToGameHour,
} from "../../src/game/ResourceRate";

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

test("economy display rates consistently convert to real minutes", () => {
  assert.equal(dailyToRealMinute(24), 60);
  assert.equal(monthlyToRealMinute(120), 10);
  assert.equal(quarterlyToRealMinute(48), 1);
  assert.equal(gameHourToRealMinute(2), 120);
  assert.equal(realMinuteToGameHour(120), 2);
});

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

function assertBuilding(slot: PlanetBuildingSlot, kind: string, level = 1): void {
  assert.equal(getPlanetBuildingKind(slot), kind);
  assert.equal(getPlanetBuildingLevel(slot), level);
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
  assertBuilding(planet.buildings.city[0], "planetaryCapital");
  assertBuilding(planet.buildings.city[1], "administrativeComplex");
  assertBuilding(planet.buildings.city[2], "housingComplex");
  assertBuilding(planet.buildings.generator[0], "energyGrid");
  assertBuilding(planet.buildings.mining[0], "mineralPurificationPlant");
  assertBuilding(planet.buildings.agriculture[0], "foodProcessingPlant");
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

test("disabled buildings suspend their jobs until re-enabled", () => {
  const planet = createHabitedPlanet();
  planet.population = 600_000_000;
  planet.buildings.city = [
    createPlanetBuildingState("administrativeComplex", 1, false),
    null,
    null,
    null,
    null,
    null,
  ];
  planet.urbanSubDistricts = [
    { kind: "residential", buildings: [null, null, null] },
    { kind: "mixedIndustry", buildings: [null, null, null] },
  ];

  const disabledEconomy = calculatePlanetEconomy(planet);
  assert.equal(disabledEconomy.jobCapacity.administrator, 0);

  planet.buildings.city[0] = createPlanetBuildingState("administrativeComplex", 1, true);
  const enabledEconomy = calculatePlanetEconomy(planet);
  assert.equal(enabledEconomy.jobCapacity.administrator, 300_000_000);
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
  assert.equal(economy.upkeep.food, (planet.population / PEOPLE_PER_MONTHLY_UNIT) * 1.1);
  assert.equal(economy.net.food, economy.production.food - economy.upkeep.food);
  assert.equal(economy.upkeep.goods, 80);
  assert.equal(economy.deficit.goods, economy.upkeep.goods);
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

  assertBuilding(normalized.urbanSubDistricts[0].buildings[0], "researchLabs");
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
  const buildingItem = createBuildingConstructionQueueItem("housingComplex", "city", 3, undefined, "building-test");
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
  assertBuilding(result.state.buildings.city[3], "housingComplex");
  assert.equal(result.state.constructionQueue.length, 0);
  assert.equal(result.completed.length, 2);
});

test("Dark Matter construction skips complete only the selected valid queue item", () => {
  const planet = createHabitedPlanet();
  const districtItem = createDistrictConstructionQueueItem("agriculture", "district-skip");
  const buildingItem = createBuildingConstructionQueueItem(
    "housingComplex",
    "city",
    3,
    undefined,
    "building-after-skip",
  );
  const queued = recalculatePlanetStateEconomy({
    ...planet,
    constructionQueue: [districtItem, buildingItem],
  }, DEFAULT_LIMITS);

  const skipped = completePlanetConstructionQueueItem(
    queued,
    districtItem.id,
    DEFAULT_LIMITS,
  );

  assert.ok(skipped);
  assert.equal(skipped.completed.id, districtItem.id);
  assert.equal(skipped.completed.remainingDays, 0);
  assert.equal(
    skipped.state.builtDistricts.agriculture,
    planet.builtDistricts.agriculture + 1,
  );
  assert.deepEqual(
    skipped.state.constructionQueue.map((item) => item.id),
    [buildingItem.id],
  );
});

test("Dark Matter construction skips reject missing or no-longer-valid targets", () => {
  const planet = createHabitedPlanet();
  const districtItem = createDistrictConstructionQueueItem("agriculture", "district-invalid");
  const queued = {
    ...planet,
    builtDistricts: {
      ...planet.builtDistricts,
      agriculture: DEFAULT_LIMITS.agriculture,
    },
    constructionQueue: [districtItem],
  };

  assert.equal(
    completePlanetConstructionQueueItem(queued, "missing-item", DEFAULT_LIMITS),
    null,
  );
  assert.equal(
    completePlanetConstructionQueueItem(queued, districtItem.id, DEFAULT_LIMITS),
    null,
  );
  assert.equal(queued.constructionQueue.length, 1);
});

test("building upgrades complete through construction and scale building effects", () => {
  const planet = createHabitedPlanet();
  const baseline = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS);
  const upgradeItem = createBuildingUpgradeConstructionQueueItem("housingComplex", 1, "city", 2, undefined, "upgrade-test");
  const queued = recalculatePlanetStateEconomy({
    ...planet,
    constructionQueue: [upgradeItem],
  }, DEFAULT_LIMITS);

  const result = progressPlanetConstructionQueue(queued, upgradeItem.totalDays, DEFAULT_LIMITS);
  const upgraded = recalculatePlanetStateEconomy(result.state, DEFAULT_LIMITS);

  assertBuilding(upgraded.buildings.city[2], "housingComplex", 2);
  assert.equal(result.completed.length, 1);
  assert.ok(upgraded.economy.housing > baseline.economy.housing);
});

test("building mineral costs are exposed for server validation and UI", () => {
  assert.equal(BUILDING_MINERAL_COSTS.housingComplex, BUILDING_DEFINITIONS.housingComplex.mineralCost);
  assert.ok(BUILDING_MINERAL_COSTS.alloyFoundries > BUILDING_MINERAL_COSTS.housingComplex);
});

test("species traits and living standards feed habitability, happiness, growth, and upkeep", () => {
  const species: SpeciesState = {
    id: "species-faction-0",
    name: "Asteri",
    archetypeId: "humanoid",
    traitIds: ["adaptive", "conservationist", "rapidBreeders"],
    originFactionId: 0,
  };
  const planet = {
    ...createHabitedPlanet(),
    speciesPopulations: [{ speciesId: species.id, population: STARTING_HABITED_POPULATION }],
  };
  planet.population = STARTING_HABITED_POPULATION;
  const baseline = recalculatePlanetStateEconomy(createHabitedPlanet(), DEFAULT_LIMITS);
  const context: PlanetEconomySpeciesContext = {
    species: [species],
    rightsBySpeciesId: {
      [species.id]: {
        livingStandard: "luxurious",
        citizenship: "fullCitizenship",
        migration: "free",
        workEligibility: "allJobs",
      },
    },
  };
  const modified = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS, [], context);

  assert.equal(getEffectiveSpeciesHabitability(modified, species.id, context), 90);
  assert.ok(modified.economy.happiness > baseline.economy.happiness);
  assert.ok(modified.economy.upkeep.goods > baseline.economy.upkeep.goods);
  assert.ok(modified.economy.populationGrowth.netPerQuarter > baseline.economy.populationGrowth.netPerQuarter);
});

test("work eligibility filters job assignment by species rights", () => {
  const species: SpeciesState = {
    id: "restricted",
    name: "Restricted",
    archetypeId: "reptilian",
    traitIds: [],
    originFactionId: 1,
  };
  const planet = createHabitedPlanet();
  planet.population = 300_000_000;
  planet.speciesPopulations = [{ speciesId: species.id, population: planet.population }];
  planet.builtDistricts = { city: 0, generator: 0, mining: 0, agriculture: 0 };
  planet.buildings = {
    city: ["administrativeComplex", null, null, null, null, null],
    generator: [null, null, null],
    mining: [null, null, null],
    agriculture: [null, null, null],
  };
  planet.urbanSubDistricts = [
    { kind: "residential", buildings: [null, null, null] },
    { kind: "mixedIndustry", buildings: [null, null, null] },
  ];
  const allJobs = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS, [], {
    species: [species],
    rightsBySpeciesId: {
      [species.id]: {
        livingStandard: "basic",
        citizenship: "fullCitizenship",
        migration: "controlled",
        workEligibility: "allJobs",
      },
    },
  });
  const laborOnly = recalculatePlanetStateEconomy(planet, DEFAULT_LIMITS, [], {
    species: [species],
    rightsBySpeciesId: {
      [species.id]: {
        livingStandard: "basic",
        citizenship: "limitedRights",
        migration: "controlled",
        workEligibility: "laborOnly",
      },
    },
  });

  assert.equal(allJobs.economy.popGroups.find((group) => group.job === "administrator")?.population, 300_000_000);
  assert.equal(laborOnly.economy.popGroups.find((group) => group.job === "administrator")?.population ?? 0, 0);
  assert.equal(
    laborOnly.economy.unemployedPopulation + (laborOnly.economy.popGroups.find((group) => group.job === "criminal")?.population ?? 0),
    300_000_000,
  );
});
