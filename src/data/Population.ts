import type { JobClass, JobKind, PopGroup } from "./Economy";
import type { SpeciesId } from "./Species";

export const MIN_HABITED_POPULATION = 1_000_000;
export const BASE_POPULATION_GROWTH_RATE_PER_WEEK = 0.00025;
export const FAMINE_START_PROGRESS = 34;
export const FAMINE_LOWER_DEATH_RATE_PER_MONTH = 0.002;
export const FAMINE_MIDDLE_RATE_MULTIPLIER = 0.25;
export const FAMINE_UPPER_RATE_MULTIPLIER = 0.1;
export const FAMINE_FARMER_RATE_MULTIPLIER = 0.01;

export const MIGRATION_INTAKE_BY_CAPITAL_LEVEL: Record<number, number> = {
  1: 5_000_000,
  2: 10_000_000,
  3: 20_000_000,
  4: 40_000_000,
  5: 80_000_000,
};
export const MIGRATION_INTAKE_PER_CITY_DISTRICT = 2_500_000;

export interface PlanetPopulationGrowthFactors {
  housingScore: number;
  amenitiesScore: number;
  stabilityScore: number;
  safetyScore: number;
  qualityOfLifeMultiplier: number;
  capacityMultiplier: number;
  modifierMultiplier: number;
  speciesMultiplier: number;
}

export interface PlanetPopulationGrowth {
  capacity: number;
  capacityPressure: number;
  ratePerWeek: number;
  netPerWeek: number;
  speciesChanges: Array<{ speciesId: SpeciesId; deltaPerWeek: number }>;
  factors: PlanetPopulationGrowthFactors;
}

export interface PlanetPopulationDecline {
  active: boolean;
  cause: "famine" | null;
  netPerMonth: number;
  speciesChanges: Array<{ speciesId: SpeciesId; deltaPerMonth: number }>;
  classChanges: Array<{ class: JobClass; deltaPerMonth: number }>;
  foodDeficitRatio: number;
  shortageProgress: number;
  crisisFactor: number;
}

export interface PlanetMigrationLedger {
  monthIndex: number;
  inbound: number;
  outbound: number;
  intakeCapacity: number;
}

export interface PlanetMigrationAttractivenessFactors {
  happiness: number;
  stability: number;
  safety: number;
  amenities: number;
  jobs: number;
}

export interface PlanetMigrationSummary {
  attractiveness: number;
  factors: PlanetMigrationAttractivenessFactors;
  monthlyIntakeCapacity: number;
  lastMonthIntakeCapacity: number;
  lastMonthIndex: number;
  lastMonthInbound: number;
  lastMonthOutbound: number;
  lastMonthNet: number;
}

export interface PopulationQualityInputs {
  housingRatio: number;
  amenityRatio: number;
  stability: number;
  crime: number;
}

export interface MigrationAttractivenessInputs {
  happiness: number;
  stability: number;
  crime: number;
  amenityRatio: number;
  vacantProductiveJobs: number;
  population: number;
}

export interface FamineProjectionInputs {
  population: number;
  groups: PopGroup[];
  foodProduction: number;
  foodUpkeep: number;
  shortageProgress: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function interpolate(value: number, fromMin: number, fromMax: number, toMin: number, toMax: number): number {
  if (fromMax <= fromMin) return toMin;
  const fraction = clamp((value - fromMin) / (fromMax - fromMin), 0, 1);
  return toMin + (toMax - toMin) * fraction;
}

export function calculatePopulationCapacityMultiplier(capacityPressure: number): number {
  const pressure = Math.max(0, Number(capacityPressure) || 0);
  if (pressure <= 0.5) return 1.3;
  if (pressure <= 1) return interpolate(pressure, 0.5, 1, 1.3, 1);
  if (pressure <= 1.5) return interpolate(pressure, 1, 1.5, 1, 0.2);
  if (pressure <= 2) return interpolate(pressure, 1.5, 2, 0.2, 0.05);
  return 0.05;
}

export function calculateBlendedPlanetCapacity(
  potentialProductiveJobs: number,
  potentialHousing: number,
  currentVacantProductiveJobs: number,
): number {
  return Math.max(
    0,
    Math.max(0, potentialProductiveJobs) * 0.35
      + Math.max(0, potentialHousing) * 0.35
      + Math.max(0, currentVacantProductiveJobs) * 0.3,
  );
}

export function calculateWeeklyNaturalGrowthRate(
  capacityMultiplier: number,
  qualityOfLifeMultiplier: number,
  modifierMultiplier = 1,
  speciesMultiplier = 1,
): number {
  return Math.max(
    0,
    BASE_POPULATION_GROWTH_RATE_PER_WEEK
      * Math.max(0, capacityMultiplier)
      * Math.max(0, qualityOfLifeMultiplier)
      * Math.max(0, modifierMultiplier)
      * Math.max(0, speciesMultiplier),
  );
}

export function calculatePopulationQuality(inputs: PopulationQualityInputs): {
  score: number;
  multiplier: number;
  factors: Pick<PlanetPopulationGrowthFactors, "housingScore" | "amenitiesScore" | "stabilityScore" | "safetyScore">;
} {
  const factors = {
    housingScore: clamp(inputs.housingRatio, 0, 1),
    amenitiesScore: clamp(inputs.amenityRatio, 0, 1),
    stabilityScore: clamp(inputs.stability / 100, 0, 1),
    safetyScore: clamp(1 - inputs.crime / 100, 0, 1),
  };
  const score = (factors.housingScore + factors.amenitiesScore + factors.stabilityScore + factors.safetyScore) / 4;
  return {
    score,
    multiplier: 0.7 + score * 0.6,
    factors,
  };
}

export function calculateMigrationAttractiveness(inputs: MigrationAttractivenessInputs): {
  attractiveness: number;
  factors: PlanetMigrationAttractivenessFactors;
} {
  const vacancyTarget = Math.max(1, Math.max(0, inputs.population) * 0.2);
  const factors: PlanetMigrationAttractivenessFactors = {
    happiness: clamp(inputs.happiness / 100, 0, 1),
    stability: clamp(inputs.stability / 100, 0, 1),
    safety: clamp(1 - inputs.crime / 100, 0, 1),
    amenities: clamp(inputs.amenityRatio, 0, 1),
    jobs: clamp(inputs.vacantProductiveJobs / vacancyTarget, 0, 1),
  };
  const attractiveness = 100 * (
    factors.happiness * 0.25
    + factors.stability * 0.2
    + factors.safety * 0.15
    + factors.amenities * 0.15
    + factors.jobs * 0.25
  );
  return { attractiveness, factors };
}

export function calculateMigrationIntakeCapacity(capitalLevel: number, builtCityDistricts: number): number {
  const level = clamp(Math.round(Number(capitalLevel) || 1), 1, 5);
  return Math.round(
    MIGRATION_INTAKE_BY_CAPITAL_LEVEL[level]
      + Math.max(0, Math.round(Number(builtCityDistricts) || 0)) * MIGRATION_INTAKE_PER_CITY_DISTRICT,
  );
}

export function createEmptyPopulationGrowth(): PlanetPopulationGrowth {
  return {
    capacity: 0,
    capacityPressure: 0,
    ratePerWeek: 0,
    netPerWeek: 0,
    speciesChanges: [],
    factors: {
      housingScore: 0,
      amenitiesScore: 0,
      stabilityScore: 0,
      safetyScore: 0,
      qualityOfLifeMultiplier: 1,
      capacityMultiplier: 1,
      modifierMultiplier: 1,
      speciesMultiplier: 1,
    },
  };
}

export function createEmptyPopulationDecline(): PlanetPopulationDecline {
  return {
    active: false,
    cause: null,
    netPerMonth: 0,
    speciesChanges: [],
    classChanges: [],
    foodDeficitRatio: 0,
    shortageProgress: 0,
    crisisFactor: 0,
  };
}

export function createEmptyMigrationLedger(monthIndex = 0): PlanetMigrationLedger {
  return { monthIndex, inbound: 0, outbound: 0, intakeCapacity: 0 };
}

export function createEmptyMigrationSummary(): PlanetMigrationSummary {
  return {
    attractiveness: 0,
    factors: { happiness: 0, stability: 0, safety: 0, amenities: 0, jobs: 0 },
    monthlyIntakeCapacity: 0,
    lastMonthIntakeCapacity: 0,
    lastMonthIndex: 0,
    lastMonthInbound: 0,
    lastMonthOutbound: 0,
    lastMonthNet: 0,
  };
}

export function calculateFamineProjection(inputs: FamineProjectionInputs): PlanetPopulationDecline {
  const shortageProgress = clamp(Number(inputs.shortageProgress) || 0, 0, 100);
  const foodDeficit = Math.max(0, inputs.foodUpkeep - inputs.foodProduction);
  const foodDeficitRatio = inputs.foodUpkeep > 0 ? clamp(foodDeficit / inputs.foodUpkeep, 0, 1) : 0;
  const crisisFactor = clamp((shortageProgress - FAMINE_START_PROGRESS) / (100 - FAMINE_START_PROGRESS), 0, 1);
  if (
    inputs.population <= MIN_HABITED_POPULATION
    || shortageProgress < FAMINE_START_PROGRESS
    || foodDeficit <= 0
    || foodDeficitRatio <= 0
  ) {
    return {
      ...createEmptyPopulationDecline(),
      foodDeficitRatio,
      shortageProgress,
      crisisFactor,
    };
  }

  const lowerOrMiddlePopulation = inputs.groups
    .filter((group) => group.class === "lower" || group.class === "middle")
    .reduce((sum, group) => sum + group.population, 0);
  const upperCanDie = lowerOrMiddlePopulation <= 0;
  const requestedByGroup = inputs.groups.map((group) => {
    let rate = 0;
    if (group.job === "farmer") {
      rate = FAMINE_LOWER_DEATH_RATE_PER_MONTH * FAMINE_FARMER_RATE_MULTIPLIER;
    } else if (group.class === "lower") {
      rate = FAMINE_LOWER_DEATH_RATE_PER_MONTH;
    } else if (group.class === "middle") {
      rate = FAMINE_LOWER_DEATH_RATE_PER_MONTH * FAMINE_MIDDLE_RATE_MULTIPLIER;
    } else if (upperCanDie) {
      rate = FAMINE_LOWER_DEATH_RATE_PER_MONTH * FAMINE_UPPER_RATE_MULTIPLIER;
    }
    return {
      group,
      requested: Math.max(0, group.population * rate * foodDeficitRatio * crisisFactor),
    };
  });
  const requestedTotal = requestedByGroup.reduce((sum, entry) => sum + entry.requested, 0);
  const maximumDeaths = Math.max(0, inputs.population - MIN_HABITED_POPULATION);
  const targetDeaths = Math.min(maximumDeaths, Math.round(requestedTotal));
  if (targetDeaths <= 0 || requestedTotal <= 0) {
    return {
      ...createEmptyPopulationDecline(),
      active: true,
      cause: "famine",
      foodDeficitRatio,
      shortageProgress,
      crisisFactor,
    };
  }

  const deathsBySpecies = new Map<SpeciesId, number>();
  const deathsByClass = new Map<JobClass, number>();
  const allocations = requestedByGroup.map((entry, index) => {
    const exact = targetDeaths * (entry.requested / requestedTotal);
    const deaths = Math.min(entry.group.population, Math.max(0, Math.floor(exact)));
    return { group: entry.group, deaths, remainder: exact - Math.floor(exact), index, eligible: entry.requested > 0 };
  });
  let shortfall = targetDeaths - allocations.reduce((sum, entry) => sum + entry.deaths, 0);
  const remainderOrder = allocations
    .filter((allocation) => allocation.eligible)
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  while (shortfall > 0) {
    let assigned = 0;
    for (const allocation of remainderOrder) {
      if (shortfall <= 0) break;
      if (allocation.deaths >= allocation.group.population) continue;
      allocation.deaths += 1;
      shortfall -= 1;
      assigned += 1;
    }
    if (assigned === 0) break;
  }
  for (const allocation of allocations) {
    if (allocation.deaths <= 0) continue;
    deathsBySpecies.set(
      allocation.group.speciesId,
      (deathsBySpecies.get(allocation.group.speciesId) ?? 0) + allocation.deaths,
    );
    deathsByClass.set(
      allocation.group.class,
      (deathsByClass.get(allocation.group.class) ?? 0) + allocation.deaths,
    );
  }
  const actualDeaths = Array.from(deathsBySpecies.values()).reduce((sum, value) => sum + value, 0);
  return {
    active: true,
    cause: "famine",
    netPerMonth: -actualDeaths,
    speciesChanges: Array.from(deathsBySpecies.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([speciesId, deaths]) => ({ speciesId, deltaPerMonth: -deaths })),
    classChanges: (["lower", "middle", "upper"] as JobClass[])
      .map((jobClass) => {
        const deaths = deathsByClass.get(jobClass) ?? 0;
        return { class: jobClass, deltaPerMonth: deaths > 0 ? -deaths : 0 };
      }),
    foodDeficitRatio,
    shortageProgress,
    crisisFactor,
  };
}

export function getMigrationClassThreshold(job: JobKind): number {
  if (job === "unemployed") return 0;
  if (job === "ruler" || job === "administrator") return 30;
  if (["researcher", "artisan", "metallurgist", "entertainer", "enforcer"].includes(job)) return 20;
  return 10;
}
