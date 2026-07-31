import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BASE_POPULATION_GROWTH_RATE_PER_WEEK,
  calculateFamineProjection,
  calculateBlendedPlanetCapacity,
  calculateMigrationAttractiveness,
  calculateMigrationIntakeCapacity,
  calculatePopulationCapacityMultiplier,
  calculatePopulationQuality,
  calculateWeeklyNaturalGrowthRate,
} from "../../src/data/Population";
import type { PopGroup } from "../../src/data/Economy";
import {
  createPlanetStateFromSeed,
  recalculatePlanetStateEconomy,
  sumSpeciesPopulation,
} from "../../src/data/Economy";
import { MIGRATION_PACT_ARTICLE_ID, createInitialDiplomacyState } from "../../src/data/Diplomacy";
import { createInitialGovernmentState } from "../../src/data/Government";
import { processMonthlyMigration } from "../game/population-migration";
import type { RuntimeContext } from "../game/types";
import { SHORTAGE_EFFECTS } from "../../src/data/ShortageConsequences";

test("weekly natural growth has the neutral 0.025% base and can never be negative", () => {
  assert.equal(BASE_POPULATION_GROWTH_RATE_PER_WEEK, 0.00025);
  assert.equal(calculateWeeklyNaturalGrowthRate(1, 1, 1, 1), 0.00025);
  assert.equal(calculateWeeklyNaturalGrowthRate(-1, 1, 1, 1), 0);
  assert.equal(calculateWeeklyNaturalGrowthRate(1, 1, -2, 1), 0);
});

test("population pressure curve matches all authored anchors", () => {
  assert.equal(calculatePopulationCapacityMultiplier(0), 1.3);
  assert.equal(calculatePopulationCapacityMultiplier(0.5), 1.3);
  assert.equal(calculatePopulationCapacityMultiplier(1), 1);
  assert.ok(Math.abs(calculatePopulationCapacityMultiplier(1.5) - 0.2) < 1e-12);
  assert.ok(Math.abs(calculatePopulationCapacityMultiplier(2) - 0.05) < 1e-12);
  assert.equal(calculatePopulationCapacityMultiplier(3), 0.05);
});

test("capacity blend is 35/35/30 and falls as current vacancies fill", () => {
  assert.equal(calculateBlendedPlanetCapacity(100, 200, 300), 195);
  assert.equal(
    calculateBlendedPlanetCapacity(100, 200, 100),
    calculateBlendedPlanetCapacity(100, 200, 300) - 60,
  );
});

test("quality of life equally weights housing, amenities, stability, and safety", () => {
  const perfect = calculatePopulationQuality({ housingRatio: 1, amenityRatio: 1, stability: 100, crime: 0 });
  const disastrous = calculatePopulationQuality({ housingRatio: 0, amenityRatio: 0, stability: 0, crime: 100 });
  const mixed = calculatePopulationQuality({ housingRatio: 1, amenityRatio: 0, stability: 100, crime: 100 });
  assert.ok(Math.abs(perfect.multiplier - 1.3) < 1e-12);
  assert.equal(disastrous.multiplier, 0.7);
  assert.equal(mixed.score, 0.5);
  assert.equal(mixed.multiplier, 1);
});

test("migration attractiveness and intake use the authored weights and capital table", () => {
  const result = calculateMigrationAttractiveness({
    happiness: 100,
    stability: 100,
    crime: 0,
    amenityRatio: 1,
    vacantProductiveJobs: 20_000_000,
    population: 100_000_000,
  });
  assert.equal(result.attractiveness, 100);
  assert.equal(calculateMigrationIntakeCapacity(1, 0), 5_000_000);
  assert.equal(calculateMigrationIntakeCapacity(3, 4), 30_000_000);
  assert.equal(calculateMigrationIntakeCapacity(5, 2), 85_000_000);
});

test("food shortage UI penalties use the reduced caps and no growth penalty", () => {
  const effects = SHORTAGE_EFFECTS.food ?? [];
  assert.deepEqual(
    effects.map((effect) => [effect.label, effect.full]),
    [
      ["Population happiness", -40],
      ["Planet stability", -22],
      ["All job output", -0.15],
      ["Fleet speed", -0.08],
      ["Fleet weapon damage", -0.08],
    ],
  );
  assert.equal(effects.some((effect) => effect.label.includes("growth")), false);
});

function group(
  speciesId: string,
  job: PopGroup["job"],
  jobClass: PopGroup["class"],
  population: number,
): PopGroup {
  return {
    speciesId,
    speciesName: speciesId,
    job,
    class: jobClass,
    habitability: 100,
    happiness: 50,
    population,
  };
}

test("famine gates at 34, scales by local deficit and crisis, and protects farmers and upper class", () => {
  const groups = [
    group("laborers", "miner", "lower", 100_000_000),
    group("farmers", "farmer", "lower", 100_000_000),
    group("specialists", "researcher", "middle", 100_000_000),
    group("rulers", "ruler", "upper", 100_000_000),
  ];
  const below = calculateFamineProjection({
    population: 400_000_000,
    groups,
    foodProduction: 0,
    foodUpkeep: 100,
    shortageProgress: 33,
  });
  const threshold = calculateFamineProjection({
    population: 400_000_000,
    groups,
    foodProduction: 0,
    foodUpkeep: 100,
    shortageProgress: 34,
  });
  const full = calculateFamineProjection({
    population: 400_000_000,
    groups,
    foodProduction: 0,
    foodUpkeep: 100,
    shortageProgress: 100,
  });
  assert.equal(below.active, false);
  assert.equal(threshold.active, true);
  assert.equal(threshold.netPerMonth, 0);
  assert.equal(full.classChanges.find((entry) => entry.class === "lower")?.deltaPerMonth, -202_000);
  assert.equal(full.classChanges.find((entry) => entry.class === "middle")?.deltaPerMonth, -50_000);
  assert.equal(full.classChanges.find((entry) => entry.class === "upper")?.deltaPerMonth, 0);
});

test("upper-class famine deaths begin only when lower and middle classes were already absent", () => {
  const projection = calculateFamineProjection({
    population: 100_000_000,
    groups: [group("rulers", "ruler", "upper", 100_000_000)],
    foodProduction: 0,
    foodUpkeep: 100,
    shortageProgress: 100,
  });
  assert.equal(projection.netPerMonth, -20_000);
});

function migrationContext(reverse = false): RuntimeContext {
  const limits = { city: 12, generator: 6, mining: 6, agriculture: 6 };
  const districts = { city: 0, generator: 0, mining: 0, agriculture: 0 };
  const sourceSeed = createPlanetStateFromSeed({
    id: "source",
    starId: 0,
    planetIndex: 0,
    ownerId: 0,
    isHabited: true,
    habitability: 80,
    builtDistricts: districts,
    districtLimits: limits,
  });
  const targetSeed = createPlanetStateFromSeed({
    id: "target",
    starId: 1,
    planetIndex: 0,
    ownerId: 0,
    isHabited: true,
    habitability: 80,
    builtDistricts: districts,
    districtLimits: limits,
  });
  const source = recalculatePlanetStateEconomy({
    ...sourceSeed,
    population: 30_000_000_000,
    speciesPopulations: [{ speciesId: "human", population: 30_000_000_000 }],
  }, limits);
  const target = recalculatePlanetStateEconomy({
    ...targetSeed,
    population: 1_000_000_000,
    speciesPopulations: [{ speciesId: "human", population: 1_000_000_000 }],
  }, limits);
  const planetStates = reverse ? [target, source] : [source, target];
  return {
    state: {
      planetStates,
      stars: [],
      species: [],
      speciesRights: [],
      governments: [createInitialGovernmentState(0)],
      diplomacy: createInitialDiplomacyState([0]),
      situations: [],
      adjacency: [[1], [0]],
    },
    queuePlanetDetailRefresh: () => undefined,
    hasDirtyState: false,
  } as unknown as RuntimeContext;
}

test("monthly migration conserves population, respects intake, records ledgers, and ignores array order", () => {
  const run = (reverse: boolean) => {
    const ctx = migrationContext(reverse);
    const before = ctx.state.planetStates.reduce((sum, planet) => sum + planet.population, 0);
    assert.equal(processMonthlyMigration(ctx, 25_201), true);
    const after = ctx.state.planetStates.reduce((sum, planet) => sum + planet.population, 0);
    const source = ctx.state.planetStates.find((planet) => planet.id === "source")!;
    const target = ctx.state.planetStates.find((planet) => planet.id === "target")!;
    assert.equal(after, before);
    assert.equal(sumSpeciesPopulation(source.speciesPopulations), source.population);
    assert.equal(sumSpeciesPopulation(target.speciesPopulations), target.population);
    assert.equal(target.populationMigration.inbound, source.populationMigration.outbound);
    assert.ok(target.populationMigration.inbound > 0);
    assert.ok(target.populationMigration.inbound <= target.economy.migration.monthlyIntakeCapacity);
    assert.equal(target.populationMigration.intakeCapacity, target.economy.migration.monthlyIntakeCapacity);
    assert.ok(source.population >= 1_000_000);
    assert.equal(target.populationMigration.monthIndex, 25_201);
    return target.populationMigration.inbound;
  };
  assert.equal(run(false), run(true));
});

function foreignMigrationContext(withPact: boolean, atWar = false): RuntimeContext {
  const ctx = migrationContext();
  const targetIndex = ctx.state.planetStates.findIndex((planet) => planet.id === "target");
  ctx.state.planetStates[targetIndex] = { ...ctx.state.planetStates[targetIndex], ownerId: 1 };
  ctx.state.governments = [createInitialGovernmentState(0), createInitialGovernmentState(1)];
  ctx.state.speciesRights = [0, 1].map((factionId) => ({
    factionId,
    rightsBySpeciesId: {
      human: {
        livingStandard: "basic",
        citizenship: "fullCitizenship",
        migration: "free",
        workEligibility: "allJobs",
      },
    },
  }));
  ctx.state.diplomacy = createInitialDiplomacyState([0, 1]);
  ctx.state.diplomacy.borders.forEach((border) => {
    border.policy = "open";
  });
  if (withPact) {
    ctx.state.diplomacy.treaties.push({
      id: "migration-pact",
      factionIds: [0, 1],
      articleIds: [MIGRATION_PACT_ARTICLE_ID],
      proposedByFactionId: 0,
      acceptedByFactionId: 1,
      startedAtYear: 2100,
      minimumEndYear: 2110,
    });
  }
  if (atWar) {
    ctx.state.diplomacy.wars.push({
      id: "war",
      attackerFactionId: 0,
      defenderFactionId: 1,
      startedAtYear: 2101,
      endedAtYear: null,
      preWarOwnership: [],
    });
  }
  return ctx;
}

test("foreign migration requires an unsuspended pact; open borders alone are insufficient", () => {
  const openBordersOnly = foreignMigrationContext(false);
  processMonthlyMigration(openBordersOnly, 1);
  assert.equal(
    openBordersOnly.state.planetStates.find((planet) => planet.id === "target")!.populationMigration.inbound,
    0,
  );

  const pact = foreignMigrationContext(true);
  processMonthlyMigration(pact, 1);
  assert.ok(pact.state.planetStates.find((planet) => planet.id === "target")!.populationMigration.inbound > 0);

  const suspended = foreignMigrationContext(true, true);
  processMonthlyMigration(suspended, 1);
  assert.equal(
    suspended.state.planetStates.find((planet) => planet.id === "target")!.populationMigration.inbound,
    0,
  );
});
