import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addResourceCounts,
  calculatePlanetEconomy,
  createEmptyResourceCounts,
  createPlanetStateFromSeed,
  isBuildingCompatible,
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
    habitability: null,
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
  assert.ok(planet.economy.popGroups.length > 0);
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

  assert.equal(economy.production.food, 6_000);
  assert.equal(economy.upkeep.food, 1_000);
  assert.equal(economy.net.food, 5_000);
  assert.equal(economy.upkeep.goods, 50);
  assert.equal(economy.deficit.goods, 50);
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
