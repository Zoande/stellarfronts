import type { DistrictCounts, DistrictKind } from "./StarMap";
import {
  DEFAULT_SPECIES_RIGHTS,
  HUMAN_SPECIES_ID,
  canRightsWorkJob,
  getSpeciesEconomyEffects,
  getSpeciesJobOutputMultiplier,
  normalizeSpeciesRights,
} from "./Species";
import type { SpeciesId, SpeciesRights, SpeciesState } from "./Species";
import {
  MIN_HABITED_POPULATION,
  calculateFamineProjection,
  calculateBlendedPlanetCapacity,
  calculateMigrationAttractiveness,
  calculateMigrationIntakeCapacity,
  calculatePopulationCapacityMultiplier,
  calculatePopulationQuality,
  calculateWeeklyNaturalGrowthRate,
  createEmptyMigrationLedger,
  createEmptyMigrationSummary,
  createEmptyPopulationDecline,
  createEmptyPopulationGrowth,
} from "./Population";
import type {
  PlanetMigrationLedger,
  PlanetMigrationSummary,
  PlanetPopulationDecline,
  PlanetPopulationGrowth,
  PlanetPopulationGrowthFactors,
} from "./Population";

export type { DistrictCounts, DistrictKind } from "./StarMap";
export type { SpeciesId } from "./Species";
export type {
  PlanetMigrationLedger,
  PlanetMigrationSummary,
  PlanetPopulationDecline,
  PlanetPopulationGrowth,
  PlanetPopulationGrowthFactors,
} from "./Population";

export type ResourceKind = "food" | "minerals" | "energy" | "goods" | "alloys" | "research";

export type ResourceCounts = Record<ResourceKind, number>;

export interface SpeciesPopulation {
  speciesId: SpeciesId;
  population: number;
}

export type JobClass = "upper" | "middle" | "lower";

export type JobKind =
  | "ruler"
  | "administrator"
  | "sensorManager"
  | "shieldOperator"
  | "researcher"
  | "artisan"
  | "metallurgist"
  | "entertainer"
  | "enforcer"
  | "soldier"
  | "trainee"
  | "farmer"
  | "miner"
  | "technician"
  | "colonizer"
  | "clerk"
  | "criminal"
  | "unemployed";

export type BuildingKind =
  | "planetaryCapital"
  | "housingComplex"
  | "administrativeComplex"
  | "researchLabs"
  | "civilianFabricators"
  | "alloyFoundries"
  | "commercialForum"
  | "foodProcessingPlant"
  | "agroIndustrialKitchens"
  | "mineralPurificationPlant"
  | "oreSmelter"
  | "energyGrid"
  | "capacitorWorkshops"
  | "entertainmentForum"
  | "securityOffice"
  | "fortress";

export type PlanetDefenseSection = "defense" | "shipyard";

export type PlanetDefenseBuildingKind =
  | "sensorArray"
  | "planetaryShield"
  | "barracks"
  | "platformSupport"
  | "orbitalShipyard";

export interface PlanetDefenseBuildingState {
  kind: PlanetDefenseBuildingKind;
  level: number;
  enabled?: boolean;
}

export interface PlanetDefenseBuildingDefinition {
  kind: PlanetDefenseBuildingKind;
  label: string;
  initials: string;
  description: string;
  sections: PlanetDefenseSection[];
  unique?: boolean;
  maxLevel: number;
  levels: Record<number, BuildingLevelDefinition>;
  jobs?: Record<number, BuildingJobEffect[]>;
  platformCapacity?: number;
  shipyards?: number;
  sensorSuiteIds?: Record<number, import("./Intelligence").SensorSuiteId>;
}

export interface PlanetTraineeRemainder {
  speciesId: SpeciesId;
  population: number;
}

export interface PlanetDefenseState {
  defenseSlots: Array<PlanetDefenseBuildingState | null>;
  shipyardSlots: Array<PlanetDefenseBuildingState | null>;
  shipQueue: import("./Starbase").StarbaseShipQueueItem[];
  stationedArmies: number;
  traineeRemainders: PlanetTraineeRemainder[];
}

export type UrbanSubDistrictKind =
  | "residential"
  | "researchCampus"
  | "mixedIndustry"
  | "civilianIndustry"
  | "heavyIndustry";

export type BuildingSlotArea = DistrictKind | "urbanSubDistrict";

export type PlanetFeatureKind = "homePlanet";

export type PlanetModifierOperation = "add" | "multiply";

export type PlanetModifierTarget =
  | "housing"
  | "amenities"
  | "crime"
  | "stability"
  | "happiness"
  | "planetCapacity"
  | "populationGrowth"
  | "jobOutput"
  | "jobUpkeep"
  | "constructionSpeed"
  | "districtConstructionSpeed"
  | "buildingConstructionSpeed"
  | "migrationAttractiveness"
  | "migrationIntakeCapacity"
  | `habitability:${SpeciesId}`
  | `jobCapacity:${JobKind}`
  | `jobOutput:${JobKind}:${ResourceKind}`
  | `jobUpkeep:${JobKind}:${ResourceKind}`
  | `jobAmenities:${JobKind}`
  | `popUpkeep:${ResourceKind}`
  | `goodsUpkeep:${JobClass}`;

export interface PlanetModifier {
  id: string;
  label: string;
  source: string;
  target: PlanetModifierTarget;
  operation: PlanetModifierOperation;
  value: number;
  expiresAtYear?: number;
}

export interface PlanetJobLockAllocation {
  speciesId: SpeciesId;
  population: number;
}

export interface PlanetJobLock {
  job: Exclude<JobKind, "criminal" | "unemployed">;
  allocations: PlanetJobLockAllocation[];
}

export interface PlanetFeatureDefinition {
  kind: PlanetFeatureKind;
  label: string;
  description: string;
  modifiers: PlanetModifier[];
}

export type ResourceDelta = Partial<Record<ResourceKind, number>>;

export interface JobDefinition {
  kind: JobKind;
  label: string;
  class: JobClass;
  description: string;
  output?: ResourceDelta;
  upkeep?: ResourceDelta;
  amenities?: number;
  crimeReduction?: number;
}

export interface BuildingCompatibility {
  area: BuildingSlotArea;
  subDistrictKinds?: UrbanSubDistrictKind[];
}

export interface BuildingJobEffect {
  job: JobKind;
  amount: number;
  perDistrict?: DistrictKind;
}

export interface BuildingDefinition {
  kind: BuildingKind;
  label: string;
  initials: string;
  description: string;
  mineralCost: number;
  buildDays: number;
  compatibility: BuildingCompatibility[];
  housing?: number;
  jobs?: BuildingJobEffect[];
  /**
   * Auto-placed buildings (e.g. the Planetary Capital) are anchored to a planet
   * slot by the simulation and cannot be queued or demolished by players.
   */
  autoPlaced?: boolean;
  sensorSuiteIds?: import("./Intelligence").SensorSuiteId[];
}

export interface BuildingLevelDefinition {
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  buildDays: number;
}

export interface PlanetBuildingState {
  kind: BuildingKind;
  level: number;
  enabled?: boolean;
}

export type PlanetBuildingSlot = BuildingKind | PlanetBuildingState | null;

export type PlanetConstructionKind =
  | "district"
  | "building"
  | "buildingUpgrade"
  | "defenseBuilding"
  | "defenseBuildingUpgrade";

export interface PlanetConstructionQueueItem {
  id: string;
  kind: PlanetConstructionKind;
  label: string;
  cost: ResourceCounts;
  /** Legacy mirror retained so older clients and saves remain readable. */
  mineralCost: number;
  totalDays: number;
  remainingDays: number;
  districtKind?: DistrictKind;
  buildingKind?: BuildingKind;
  targetLevel?: number;
  area?: BuildingSlotArea;
  slotIndex?: number;
  subDistrictIndex?: number;
  defenseBuildingKind?: PlanetDefenseBuildingKind;
  defenseSection?: PlanetDefenseSection;
}

export interface PopGroup {
  job: JobKind;
  class: JobClass;
  speciesId: SpeciesId;
  speciesName: string;
  portraitUrl?: string | null;
  habitability: number;
  happiness: number;
  population: number;
}

export interface UrbanSubDistrictState {
  kind: UrbanSubDistrictKind;
  buildings: PlanetBuildingSlot[];
}

export type DistrictBuildingSlots = Record<DistrictKind, PlanetBuildingSlot[]>;

export interface JobCapacity {
  ruler: number;
  administrator: number;
  sensorManager: number;
  shieldOperator: number;
  researcher: number;
  artisan: number;
  metallurgist: number;
  entertainer: number;
  enforcer: number;
  soldier: number;
  trainee: number;
  farmer: number;
  miner: number;
  technician: number;
  colonizer: number;
  clerk: number;
  criminal: number;
  unemployed: number;
}

export interface PlanetEconomySummary {
  production: ResourceCounts;
  upkeep: ResourceCounts;
  net: ResourceCounts;
  deficit: ResourceCounts;
  jobCapacity: JobCapacity;
  popGroups: PopGroup[];
  employedPopulation: number;
  unemployedPopulation: number;
  housing: number;
  amenities: number;
  happiness: number;
  crime: number;
  stability: number;
  populationGrowth: PlanetPopulationGrowth;
  populationDecline: PlanetPopulationDecline;
  migration: PlanetMigrationSummary;
  activeModifiers: PlanetModifier[];
}

export interface PlanetEconomySpeciesContext {
  species: SpeciesState[];
  rightsBySpeciesId?: Record<SpeciesId, SpeciesRights | undefined>;
  foodShortageProgress?: number;
}

export interface PlanetState {
  id: string;
  starId: number;
  planetIndex: number;
  ownerId: number | null;
  isHabited: boolean;
  habitability: number | null;
  population: number;
  speciesPopulations: SpeciesPopulation[];
  features: PlanetFeatureKind[];
  builtDistricts: DistrictCounts;
  buildings: DistrictBuildingSlots;
  urbanSubDistricts: UrbanSubDistrictState[];
  constructionQueue: PlanetConstructionQueueItem[];
  defense: PlanetDefenseState;
  modifiers: PlanetModifier[];
  populationMigration: PlanetMigrationLedger;
  jobLocks: PlanetJobLock[];
  economy: PlanetEconomySummary;
}

export interface FactionEconomyState {
  factionId: number;
  stockpiles: ResourceCounts;
  crewStockpile: number;
  monthlyDelta: ResourceCounts;
  marketMonthlyDelta?: ResourceCounts;
  lastProcessedMonth: number;
  lastProcessedHour: number;
}

export interface PlanetEconomySeed {
  id: string;
  starId: number;
  planetIndex: number;
  ownerId?: number | null;
  isHabited: boolean;
  habitability: number | null;
  features?: PlanetFeatureKind[];
  builtDistricts: DistrictCounts;
  districtLimits: DistrictCounts;
  starterInfrastructure?: boolean;
  startingPopulation?: number;
}

export const PEOPLE_PER_MONTHLY_UNIT = 1_000_000;
// Amenity demand per monthly population unit. Below 1 so amenity need scales more gently
// with population (a developed planet should not need ~20% of its pop in amenity jobs).
export const AMENITY_NEED_PER_UNIT = 0.5;
export function getAmenityNeed(population: number): number {
  return (Math.max(0, population) / PEOPLE_PER_MONTHLY_UNIT) * AMENITY_NEED_PER_UNIT;
}
export const STARTING_HABITED_POPULATION = 10_000_000_000;
export const NEW_COLONY_POPULATION = 500_000_000;
export const FRONTIER_SETTLEMENT_DURATION_YEARS = 10;
export const BUILDING_MAX_LEVEL = 5;
const POP_FOOD_UPKEEP_PER_UNIT = 0.022;
const UNEMPLOYED_GOODS_UPKEEP_PER_UNIT = 0.0005;
const CRIMINAL_JOB_POPULATION_SHARE_AT_MAX_CRIME = 0.25;

export function createFrontierSettlementModifiers(foundedAtYear: number): PlanetModifier[] {
  const expiresAtYear = foundedAtYear + FRONTIER_SETTLEMENT_DURATION_YEARS;
  const create = (
    id: string,
    label: string,
    target: PlanetModifierTarget,
    operation: PlanetModifierOperation,
    value: number,
  ): PlanetModifier => ({
    id,
    label,
    source: "colony:frontierSettlement",
    target,
    operation,
    value,
    expiresAtYear,
  });
  return [
    create("frontier-settlement-attractiveness", "Frontier Settlement", "migrationAttractiveness", "add", 20),
    create("frontier-settlement-intake", "Frontier Settlement", "migrationIntakeCapacity", "add", 20_000_000),
    create("frontier-settlement-stability", "Frontier Settlement", "stability", "add", 10),
    create("frontier-settlement-construction", "Frontier Settlement", "constructionSpeed", "multiply", 0.25),
    create("frontier-settlement-growth", "Frontier Settlement", "populationGrowth", "multiply", 0.25),
  ];
}

export function removeExpiredPlanetModifiers(
  state: PlanetState,
  currentYear: number,
): { state: PlanetState; changed: boolean } {
  const modifiers = (state.modifiers ?? []).filter((modifier) => (
    modifier.expiresAtYear === undefined || currentYear < modifier.expiresAtYear
  ));
  if (modifiers.length === (state.modifiers ?? []).length) return { state, changed: false };
  return { state: { ...state, modifiers }, changed: true };
}

export const DISTRICT_COSTS: Record<DistrictKind, ResourceCounts> = {
  city: { food: 0, minerals: 800, energy: 200, goods: 50, alloys: 0, research: 0 },
  generator: { food: 0, minerals: 600, energy: 150, goods: 0, alloys: 0, research: 0 },
  mining: { food: 0, minerals: 650, energy: 150, goods: 0, alloys: 0, research: 0 },
  agriculture: { food: 50, minerals: 550, energy: 100, goods: 0, alloys: 0, research: 0 },
};

export const DISTRICT_MINERAL_COSTS: Record<DistrictKind, number> = {
  city: DISTRICT_COSTS.city.minerals,
  generator: DISTRICT_COSTS.generator.minerals,
  mining: DISTRICT_COSTS.mining.minerals,
  agriculture: DISTRICT_COSTS.agriculture.minerals,
};

export const DISTRICT_BUILD_DAYS: Record<DistrictKind, number> = {
  city: 240,
  generator: 180,
  mining: 180,
  agriculture: 180,
};

export const RESOURCE_KINDS: ResourceKind[] = ["food", "minerals", "energy", "goods", "alloys", "research"];

export const JOB_KINDS: JobKind[] = [
  "ruler",
  "administrator",
  "sensorManager",
  "shieldOperator",
  "researcher",
  "artisan",
  "metallurgist",
  "entertainer",
  "enforcer",
  "soldier",
  "trainee",
  "farmer",
  "miner",
  "technician",
  "colonizer",
  "clerk",
  "criminal",
  "unemployed",
];

export const JOB_FILL_ORDER: JobKind[] = [
  "ruler",
  "administrator",
  "sensorManager",
  "shieldOperator",
  "researcher",
  "enforcer",
  "soldier",
  "trainee",
  "entertainer",
  "artisan",
  "metallurgist",
  "farmer",
  "miner",
  "technician",
  "colonizer",
  "clerk",
];

export const JOB_CLASS_BY_KIND: Record<JobKind, JobClass> = {
  ruler: "upper",
  administrator: "upper",
  sensorManager: "middle",
  shieldOperator: "middle",
  researcher: "middle",
  artisan: "middle",
  metallurgist: "middle",
  entertainer: "middle",
  enforcer: "middle",
  soldier: "middle",
  trainee: "lower",
  farmer: "lower",
  miner: "lower",
  technician: "lower",
  colonizer: "lower",
  clerk: "lower",
  criminal: "lower",
  unemployed: "lower",
};

export const RESOURCE_LABELS: Record<ResourceKind, string> = {
  food: "Food",
  minerals: "Minerals",
  energy: "Energy",
  goods: "Goods",
  alloys: "Alloys",
  research: "Research",
};

export { HUMAN_SPECIES_ID };

export const JOB_DEFINITIONS: Record<JobKind, JobDefinition> = {
  ruler: {
    kind: "ruler",
    label: "Rulers",
    class: "upper",
    description: "The planetary governing council and its household. Sets policy, upholds public order, and keeps the populace content.",
    upkeep: { energy: 0.02, goods: 0.03 },
    amenities: 6,
    crimeReduction: 0.02,
  },
  administrator: {
    kind: "administrator",
    label: "Administrators",
    class: "upper",
    description: "Coordinates planetary bureaucracy, services, and strategic direction.",
    upkeep: { energy: 0.02, goods: 0.02 },
    amenities: 3,
  },
  sensorManager: {
    kind: "sensorManager",
    label: "Sensor Managers",
    class: "middle",
    description: "Coordinates planetary sensor arrays and intelligence processing.",
    upkeep: { energy: 0.01, goods: 0.005 },
  },
  shieldOperator: {
    kind: "shieldOperator",
    label: "Shield Operators",
    class: "middle",
    description: "Maintains the planetary shield grid and its alloy-intensive field hardware.",
    upkeep: { alloys: 0.01 },
  },
  researcher: {
    kind: "researcher",
    label: "Researchers",
    class: "middle",
    description: "Turns energy and goods into stockpiled research.",
    output: { research: 0.06 },
    upkeep: { energy: 0.05, goods: 0.024 },
  },
  artisan: {
    kind: "artisan",
    label: "Artisans",
    class: "middle",
    description: "Refines minerals into civilian goods.",
    output: { goods: 0.05 },
    upkeep: { minerals: 0.09, energy: 0.01 },
  },
  metallurgist: {
    kind: "metallurgist",
    label: "Metallurgists",
    class: "middle",
    description: "Refines minerals into military and industrial alloys.",
    output: { alloys: 0.032 },
    upkeep: { minerals: 0.11, energy: 0.012 },
  },
  entertainer: {
    kind: "entertainer",
    label: "Entertainers",
    class: "middle",
    description: "Provides culture, recreation, and morale services.",
    upkeep: { goods: 0.012 },
    amenities: 7,
  },
  enforcer: {
    kind: "enforcer",
    label: "Enforcers",
    class: "middle",
    description: "Maintains public order and suppresses organized crime.",
    upkeep: { energy: 0.012, goods: 0.005 },
    crimeReduction: 0.025,
  },
  soldier: {
    kind: "soldier",
    label: "Soldiers",
    class: "middle",
    description: "Planetary defense personnel maintained by fortress infrastructure.",
    upkeep: { goods: 0.005, alloys: 0.002 },
  },
  trainee: {
    kind: "trainee",
    label: "Trainees",
    class: "lower",
    description: "Personnel undergoing training before entering the faction Crew reserve.",
    upkeep: { goods: 0.003, alloys: 0.001 },
  },
  farmer: {
    kind: "farmer",
    label: "Farmers",
    class: "lower",
    description: "Produces food from agricultural land and hydroponic infrastructure.",
    output: { food: 0.09 },
  },
  miner: {
    kind: "miner",
    label: "Miners",
    class: "lower",
    description: "Extracts minerals from planetary deposits.",
    output: { minerals: 0.09 },
  },
  technician: {
    kind: "technician",
    label: "Technicians",
    class: "lower",
    description: "Operates power grids, reactors, and energy collection systems.",
    output: { energy: 0.072 },
  },
  colonizer: {
    kind: "colonizer",
    label: "Colonizers",
    class: "lower",
    description: "Frontier settlers who maintain the first communal services and small local food plots while relying on the wider empire for development.",
    output: { food: 0.016 },
    amenities: 0.75,
  },
  clerk: {
    kind: "clerk",
    label: "Clerks",
    class: "lower",
    description: "Handles services, commerce, and local administration.",
    output: { energy: 0.012 },
    amenities: 1.5,
  },
  criminal: {
    kind: "criminal",
    label: "Criminals",
    class: "lower",
    description: "Organized illicit work that consumes supplies and intensifies local crime.",
    upkeep: { energy: 0.003, goods: 0.0016 },
    crimeReduction: -0.01,
  },
  unemployed: {
    kind: "unemployed",
    label: "Unemployed",
    class: "lower",
    description: "Population without assigned productive work.",
  },
};

export const JOB_LABELS: Record<JobKind, string> = Object.fromEntries(
  JOB_KINDS.map((job) => [job, JOB_DEFINITIONS[job].label]),
) as Record<JobKind, string>;

export const URBAN_SUB_DISTRICT_LABELS: Record<UrbanSubDistrictKind, string> = {
  residential: "Residential Arcology",
  researchCampus: "Research Campus",
  mixedIndustry: "Mixed Industry",
  civilianIndustry: "Civilian Industry",
  heavyIndustry: "Heavy Industry",
};

export const PLANET_FEATURE_DEFINITIONS: Record<PlanetFeatureKind, PlanetFeatureDefinition> = {
  homePlanet: {
    kind: "homePlanet",
    label: "Home Planet",
    description: "The species' cradle world, with familiar biospheres, culture, infrastructure, and settlement patterns.",
    modifiers: [
      {
        id: "feature-home-planet-human-habitability",
        label: "Home Planet",
        source: "planetFeature:homePlanet",
        target: "habitability:human",
        operation: "add",
        value: 20,
      },
    ],
  },
};

export const PLANET_FEATURE_KINDS: PlanetFeatureKind[] = ["homePlanet"];

export interface CapitalTierDefinition {
  level: number;
  label: string;
  description: string;
  jobs: BuildingJobEffect[];
  housing: number;
  modifiers: PlanetModifier[];
}

function capitalTierModifier(
  level: number,
  suffix: string,
  label: string,
  target: PlanetModifierTarget,
  operation: PlanetModifierOperation,
  value: number,
): PlanetModifier {
  return {
    id: `capital-tier-${level}-${suffix}`,
    label,
    source: `building:planetaryCapital:${level}`,
    target,
    operation,
    value,
  };
}

export const CAPITAL_TIER_DEFINITIONS: Record<number, CapitalTierDefinition> = {
  1: {
    level: 1,
    label: "Colony Headquarters",
    description: "A prefabricated frontier hub that houses and organizes the first colonists while the settlement remains dependent on imperial supply.",
    jobs: [
      { job: "colonizer", amount: 500_000_000 },
      { job: "sensorManager", amount: 1_000_000 },
    ],
    housing: 750_000_000,
    modifiers: [],
  },
  2: {
    level: 2,
    label: "Planetary Administration",
    description: "A permanent seat of planetary government centered on a ruler-heavy civil administration.",
    jobs: [
      { job: "ruler", amount: 500_000_000 },
      { job: "sensorManager", amount: 2_000_000 },
      { job: "enforcer", amount: 100_000_000 },
      { job: "entertainer", amount: 100_000_000 },
    ],
    housing: 0,
    modifiers: [],
  },
  3: {
    level: 3,
    label: "Planetary Capital",
    description: "A mature planetary government that coordinates large public works and stabilizes a developed world.",
    jobs: [
      { job: "ruler", amount: 900_000_000 },
      { job: "sensorManager", amount: 3_000_000 },
      { job: "enforcer", amount: 150_000_000 },
      { job: "entertainer", amount: 150_000_000 },
    ],
    housing: 0,
    modifiers: [
      capitalTierModifier(3, "stability", "Planetary Capital", "stability", "add", 5),
      capitalTierModifier(3, "construction", "Planetary Capital", "constructionSpeed", "multiply", 0.1),
    ],
  },
  4: {
    level: 4,
    label: "Planetary Directorate",
    description: "An expansive directorate that directs planetary institutions and major construction programs.",
    jobs: [
      { job: "ruler", amount: 1_500_000_000 },
      { job: "sensorManager", amount: 4_000_000 },
      { job: "enforcer", amount: 200_000_000 },
      { job: "entertainer", amount: 200_000_000 },
    ],
    housing: 0,
    modifiers: [
      capitalTierModifier(4, "stability", "Planetary Directorate", "stability", "add", 8),
      capitalTierModifier(4, "construction", "Planetary Directorate", "constructionSpeed", "multiply", 0.15),
    ],
  },
  5: {
    level: 5,
    label: "Planetary Nexus",
    description: "A planet-spanning governing nexus with the authority and logistics to coordinate the largest inhabited worlds.",
    jobs: [
      { job: "ruler", amount: 2_400_000_000 },
      { job: "sensorManager", amount: 5_000_000 },
      { job: "enforcer", amount: 250_000_000 },
      { job: "entertainer", amount: 250_000_000 },
    ],
    housing: 0,
    modifiers: [
      capitalTierModifier(5, "stability", "Planetary Nexus", "stability", "add", 12),
      capitalTierModifier(5, "construction", "Planetary Nexus", "constructionSpeed", "multiply", 0.25),
    ],
  },
};

export const BUILDING_DEFINITIONS: Record<BuildingKind, BuildingDefinition> = {
  planetaryCapital: {
    kind: "planetaryCapital",
    label: "Colony Headquarters",
    initials: "CAP",
    description: CAPITAL_TIER_DEFINITIONS[1].description,
    mineralCost: 0,
    buildDays: 1,
    compatibility: [{ area: "city" }],
    autoPlaced: true,
    sensorSuiteIds: ["planetaryCapitalSensors"],
    jobs: CAPITAL_TIER_DEFINITIONS[1].jobs,
    housing: CAPITAL_TIER_DEFINITIONS[1].housing,
  },
  housingComplex: {
    kind: "housingComplex",
    label: "Housing Complex",
    initials: "HC",
    description: "Dense residential towers and life-support extensions that expand planetary housing.",
    mineralCost: 220,
    buildDays: 30,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    housing: 1_200_000_000,
  },
  administrativeComplex: {
    kind: "administrativeComplex",
    label: "Administrative Complex",
    initials: "AD",
    description: "Offices, courts, and planning bureaus that create administrator jobs.",
    mineralCost: 350,
    buildDays: 45,
    compatibility: [{ area: "city" }],
    jobs: [{ job: "administrator", amount: 300_000_000 }],
  },
  researchLabs: {
    kind: "researchLabs",
    label: "Research Labs",
    initials: "RL",
    description: "Laboratory campuses that create researcher jobs.",
    mineralCost: 500,
    buildDays: 60,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["researchCampus"] }],
    jobs: [{ job: "researcher", amount: 500_000_000 }],
  },
  civilianFabricators: {
    kind: "civilianFabricators",
    label: "Civilian Fabricators",
    initials: "CF",
    description: "Factory halls that create artisan jobs for civilian goods production.",
    mineralCost: 450,
    buildDays: 60,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "civilianIndustry"] }],
    jobs: [{ job: "artisan", amount: 500_000_000 }],
  },
  alloyFoundries: {
    kind: "alloyFoundries",
    label: "Alloy Foundries",
    initials: "AF",
    description: "Heavy furnace and forge facilities that create metallurgist jobs.",
    mineralCost: 550,
    buildDays: 75,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "heavyIndustry"] }],
    jobs: [{ job: "metallurgist", amount: 500_000_000 }],
  },
  commercialForum: {
    kind: "commercialForum",
    label: "Commercial Forum",
    initials: "CM",
    description: "Market districts and service hubs that create clerk jobs.",
    mineralCost: 250,
    buildDays: 30,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "clerk", amount: 500_000_000 }],
  },
  foodProcessingPlant: {
    kind: "foodProcessingPlant",
    label: "Food Processing Plant",
    initials: "FP",
    description: "Agricultural logistics and preservation plants that expand farmer jobs per agriculture district.",
    mineralCost: 250,
    buildDays: 30,
    compatibility: [{ area: "agriculture" }],
    jobs: [{ job: "farmer", amount: 250_000_000, perDistrict: "agriculture" }],
  },
  agroIndustrialKitchens: {
    kind: "agroIndustrialKitchens",
    label: "Agro-Industrial Kitchens",
    initials: "AK",
    description: "Food industry complexes that convert some farmer demand into artisan jobs.",
    mineralCost: 450,
    buildDays: 60,
    compatibility: [{ area: "agriculture" }],
    jobs: [
      { job: "farmer", amount: -250_000_000, perDistrict: "agriculture" },
      { job: "artisan", amount: 250_000_000, perDistrict: "agriculture" },
    ],
  },
  mineralPurificationPlant: {
    kind: "mineralPurificationPlant",
    label: "Mineral Purification Plant",
    initials: "MP",
    description: "Ore sorting and purification works that expand miner jobs per mining district.",
    mineralCost: 270,
    buildDays: 30,
    compatibility: [{ area: "mining" }],
    jobs: [{ job: "miner", amount: 250_000_000, perDistrict: "mining" }],
  },
  oreSmelter: {
    kind: "oreSmelter",
    label: "Ore Smelter",
    initials: "OS",
    description: "Industrial smelters that convert some miner demand into metallurgist jobs.",
    mineralCost: 500,
    buildDays: 60,
    compatibility: [{ area: "mining" }],
    jobs: [
      { job: "miner", amount: -250_000_000, perDistrict: "mining" },
      { job: "metallurgist", amount: 250_000_000, perDistrict: "mining" },
    ],
  },
  energyGrid: {
    kind: "energyGrid",
    label: "Energy Grid",
    initials: "EG",
    description: "Planetary power routing that expands technician jobs per generator district.",
    mineralCost: 270,
    buildDays: 30,
    compatibility: [{ area: "generator" }],
    jobs: [{ job: "technician", amount: 250_000_000, perDistrict: "generator" }],
  },
  capacitorWorkshops: {
    kind: "capacitorWorkshops",
    label: "Capacitor Workshops",
    initials: "CW",
    description: "Power component workshops that convert some technician demand into artisan jobs.",
    mineralCost: 450,
    buildDays: 60,
    compatibility: [{ area: "generator" }],
    jobs: [
      { job: "technician", amount: -250_000_000, perDistrict: "generator" },
      { job: "artisan", amount: 250_000_000, perDistrict: "generator" },
    ],
  },
  entertainmentForum: {
    kind: "entertainmentForum",
    label: "Entertainment Forum",
    initials: "EF",
    description: "Theaters, parks, and media venues that create entertainer jobs for amenities.",
    mineralCost: 300,
    buildDays: 45,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "entertainer", amount: 500_000_000 }],
  },
  securityOffice: {
    kind: "securityOffice",
    label: "Security Office",
    initials: "SO",
    description: "Precincts and public safety offices that create enforcer jobs to reduce crime.",
    mineralCost: 300,
    buildDays: 45,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "enforcer", amount: 500_000_000 }],
  },
  fortress: {
    kind: "fortress",
    label: "Fortress",
    initials: "FT",
    description: "A hardened planetary garrison that creates soldier jobs and unlocks two planetary defense slots.",
    mineralCost: 1_200,
    buildDays: 120,
    compatibility: [{ area: "city" }],
    jobs: [{ job: "soldier", amount: 10_000_000 }],
  },
};

function authoredBuildingLevel(
  cost: ResourceDelta,
  energyUpkeep: number,
  buildDays: number,
): BuildingLevelDefinition {
  return {
    cost: {
      food: cost.food ?? 0,
      minerals: cost.minerals ?? 0,
      energy: cost.energy ?? 0,
      goods: cost.goods ?? 0,
      alloys: cost.alloys ?? 0,
      research: cost.research ?? 0,
    },
    upkeep: {
      food: 0,
      minerals: 0,
      energy: energyUpkeep,
      goods: 0,
      alloys: 0,
      research: 0,
    },
    buildDays,
  };
}

/**
 * Authored independently by building and target level. These values deliberately
 * avoid formula-driven scaling so later tiers can introduce distinct resource
 * requirements without changing earlier construction.
 */
export const BUILDING_LEVEL_DEFINITIONS: Record<BuildingKind, Record<number, BuildingLevelDefinition>> = {
  planetaryCapital: {
    1: authoredBuildingLevel({}, 0, 1),
    2: authoredBuildingLevel({ food: 200, minerals: 1_200, energy: 800, goods: 200, alloys: 100 }, 2, 240),
    3: authoredBuildingLevel({ food: 500, minerals: 3_000, energy: 2_000, goods: 600, alloys: 300 }, 5, 720),
    4: authoredBuildingLevel({ food: 1_000, minerals: 7_000, energy: 5_000, goods: 1_500, alloys: 800 }, 10, 1_800),
    5: authoredBuildingLevel({ food: 2_000, minerals: 15_000, energy: 10_000, goods: 3_500, alloys: 2_000 }, 18, 3_600),
  },
  housingComplex: {
    1: authoredBuildingLevel({ minerals: 220, energy: 60 }, 1, 30),
    2: authoredBuildingLevel({ minerals: 1_800, energy: 600, goods: 150 }, 2, 180),
    3: authoredBuildingLevel({ minerals: 6_000, energy: 2_000, goods: 600 }, 4, 540),
    4: authoredBuildingLevel({ minerals: 18_000, energy: 6_000, goods: 2_000, alloys: 300 }, 7, 1_440),
    5: authoredBuildingLevel({ minerals: 50_000, energy: 16_000, goods: 6_000, alloys: 1_200 }, 11, 3_600),
  },
  administrativeComplex: {
    1: authoredBuildingLevel({ minerals: 350, energy: 100, goods: 25 }, 2, 45),
    2: authoredBuildingLevel({ minerals: 2_500, energy: 900, goods: 300 }, 4, 240),
    3: authoredBuildingLevel({ minerals: 8_000, energy: 2_800, goods: 1_000 }, 7, 720),
    4: authoredBuildingLevel({ minerals: 24_000, energy: 8_000, goods: 3_000, alloys: 400 }, 11, 1_800),
    5: authoredBuildingLevel({ minerals: 65_000, energy: 20_000, goods: 8_000, alloys: 1_500 }, 16, 3_600),
  },
  researchLabs: {
    1: authoredBuildingLevel({ minerals: 500, energy: 150, goods: 50 }, 3, 60),
    2: authoredBuildingLevel({ minerals: 3_500, energy: 1_200, goods: 500, alloys: 100 }, 6, 300),
    3: authoredBuildingLevel({ minerals: 11_000, energy: 3_500, goods: 1_800, alloys: 400 }, 10, 900),
    4: authoredBuildingLevel({ minerals: 32_000, energy: 10_000, goods: 5_000, alloys: 1_200 }, 16, 2_160),
    5: authoredBuildingLevel({ minerals: 90_000, energy: 28_000, goods: 14_000, alloys: 4_000 }, 24, 3_600),
  },
  civilianFabricators: {
    1: authoredBuildingLevel({ minerals: 450, energy: 120 }, 3, 60),
    2: authoredBuildingLevel({ minerals: 3_200, energy: 1_000, goods: 200 }, 6, 300),
    3: authoredBuildingLevel({ minerals: 10_000, energy: 3_000, goods: 900, alloys: 200 }, 11, 900),
    4: authoredBuildingLevel({ minerals: 30_000, energy: 9_000, goods: 3_000, alloys: 1_000 }, 18, 2_160),
    5: authoredBuildingLevel({ minerals: 80_000, energy: 24_000, goods: 8_000, alloys: 3_000 }, 27, 3_600),
  },
  alloyFoundries: {
    1: authoredBuildingLevel({ minerals: 550, energy: 180, alloys: 25 }, 4, 75),
    2: authoredBuildingLevel({ minerals: 4_000, energy: 1_200, alloys: 500 }, 8, 360),
    3: authoredBuildingLevel({ minerals: 13_000, energy: 4_000, alloys: 1_800 }, 14, 1_080),
    4: authoredBuildingLevel({ minerals: 38_000, energy: 12_000, goods: 1_000, alloys: 6_000 }, 23, 2_400),
    5: authoredBuildingLevel({ minerals: 100_000, energy: 30_000, goods: 4_000, alloys: 18_000 }, 35, 3_600),
  },
  commercialForum: {
    1: authoredBuildingLevel({ minerals: 250, energy: 60, goods: 15 }, 2, 30),
    2: authoredBuildingLevel({ minerals: 2_000, energy: 700, goods: 250 }, 4, 180),
    3: authoredBuildingLevel({ minerals: 6_500, energy: 2_200, goods: 800 }, 7, 600),
    4: authoredBuildingLevel({ minerals: 19_000, energy: 6_500, goods: 2_500, alloys: 250 }, 11, 1_500),
    5: authoredBuildingLevel({ minerals: 52_000, energy: 17_000, goods: 7_000, alloys: 1_000 }, 16, 3_600),
  },
  foodProcessingPlant: {
    1: authoredBuildingLevel({ minerals: 250, energy: 60 }, 2, 30),
    2: authoredBuildingLevel({ minerals: 1_800, energy: 600, goods: 100 }, 4, 180),
    3: authoredBuildingLevel({ minerals: 6_000, energy: 2_000, goods: 400 }, 7, 600),
    4: authoredBuildingLevel({ minerals: 18_000, energy: 6_000, goods: 1_500, alloys: 200 }, 11, 1_500),
    5: authoredBuildingLevel({ minerals: 50_000, energy: 16_000, goods: 4_500, alloys: 800 }, 17, 3_600),
  },
  agroIndustrialKitchens: {
    1: authoredBuildingLevel({ minerals: 450, energy: 120, goods: 25 }, 3, 60),
    2: authoredBuildingLevel({ minerals: 3_000, energy: 1_000, goods: 350 }, 6, 300),
    3: authoredBuildingLevel({ minerals: 9_500, energy: 3_000, goods: 1_200, alloys: 150 }, 10, 900),
    4: authoredBuildingLevel({ minerals: 28_000, energy: 9_000, goods: 3_500, alloys: 700 }, 17, 2_040),
    5: authoredBuildingLevel({ minerals: 75_000, energy: 23_000, goods: 10_000, alloys: 2_500 }, 25, 3_600),
  },
  mineralPurificationPlant: {
    1: authoredBuildingLevel({ minerals: 270, energy: 60 }, 2, 30),
    2: authoredBuildingLevel({ minerals: 2_000, energy: 650, goods: 100 }, 4, 180),
    3: authoredBuildingLevel({ minerals: 6_500, energy: 2_100, goods: 450 }, 7, 600),
    4: authoredBuildingLevel({ minerals: 19_000, energy: 6_200, goods: 1_500, alloys: 250 }, 11, 1_500),
    5: authoredBuildingLevel({ minerals: 52_000, energy: 17_000, goods: 4_500, alloys: 900 }, 17, 3_600),
  },
  oreSmelter: {
    1: authoredBuildingLevel({ minerals: 500, energy: 140, alloys: 20 }, 4, 60),
    2: authoredBuildingLevel({ minerals: 3_500, energy: 1_100, alloys: 400 }, 8, 360),
    3: authoredBuildingLevel({ minerals: 11_000, energy: 3_500, alloys: 1_500 }, 14, 1_080),
    4: authoredBuildingLevel({ minerals: 32_000, energy: 10_000, goods: 800, alloys: 5_000 }, 22, 2_400),
    5: authoredBuildingLevel({ minerals: 88_000, energy: 27_000, goods: 3_000, alloys: 15_000 }, 34, 3_600),
  },
  energyGrid: {
    1: authoredBuildingLevel({ minerals: 270, energy: 60 }, 1, 30),
    2: authoredBuildingLevel({ minerals: 2_000, energy: 700, goods: 100 }, 2, 180),
    3: authoredBuildingLevel({ minerals: 6_500, energy: 2_200, goods: 450 }, 4, 600),
    4: authoredBuildingLevel({ minerals: 19_000, energy: 6_500, goods: 1_500, alloys: 250 }, 7, 1_500),
    5: authoredBuildingLevel({ minerals: 52_000, energy: 18_000, goods: 4_500, alloys: 900 }, 11, 3_600),
  },
  capacitorWorkshops: {
    1: authoredBuildingLevel({ minerals: 450, energy: 120, goods: 20 }, 3, 60),
    2: authoredBuildingLevel({ minerals: 3_000, energy: 1_000, goods: 300 }, 6, 300),
    3: authoredBuildingLevel({ minerals: 9_500, energy: 3_200, goods: 1_000, alloys: 150 }, 10, 900),
    4: authoredBuildingLevel({ minerals: 28_000, energy: 9_500, goods: 3_200, alloys: 700 }, 17, 2_040),
    5: authoredBuildingLevel({ minerals: 75_000, energy: 25_000, goods: 9_000, alloys: 2_500 }, 25, 3_600),
  },
  entertainmentForum: {
    1: authoredBuildingLevel({ minerals: 300, energy: 80, goods: 20 }, 2, 45),
    2: authoredBuildingLevel({ minerals: 2_200, energy: 750, goods: 300 }, 4, 240),
    3: authoredBuildingLevel({ minerals: 7_000, energy: 2_400, goods: 1_000 }, 7, 720),
    4: authoredBuildingLevel({ minerals: 21_000, energy: 7_000, goods: 3_000, alloys: 300 }, 12, 1_680),
    5: authoredBuildingLevel({ minerals: 58_000, energy: 19_000, goods: 8_500, alloys: 1_200 }, 18, 3_600),
  },
  securityOffice: {
    1: authoredBuildingLevel({ minerals: 300, energy: 80, goods: 20 }, 2, 45),
    2: authoredBuildingLevel({ minerals: 2_200, energy: 750, goods: 300 }, 4, 240),
    3: authoredBuildingLevel({ minerals: 7_000, energy: 2_400, goods: 1_000 }, 7, 720),
    4: authoredBuildingLevel({ minerals: 21_000, energy: 7_000, goods: 3_000, alloys: 300 }, 12, 1_680),
    5: authoredBuildingLevel({ minerals: 58_000, energy: 19_000, goods: 8_500, alloys: 1_200 }, 18, 3_600),
  },
  fortress: {
    1: authoredBuildingLevel({ minerals: 1_200, goods: 100, alloys: 150 }, 4, 120),
  },
};

function authoredDefenseLevel(
  cost: ResourceDelta,
  upkeep: ResourceDelta,
  buildDays: number,
): BuildingLevelDefinition {
  return {
    cost: { ...createEmptyResourceCounts(), ...cost },
    upkeep: { ...createEmptyResourceCounts(), ...upkeep },
    buildDays,
  };
}

export const PLANET_DEFENSE_BUILDING_DEFINITIONS: Record<PlanetDefenseBuildingKind, PlanetDefenseBuildingDefinition> = {
  sensorArray: {
    kind: "sensorArray",
    label: "Planetary Sensor Array",
    initials: "SA",
    description: "A dedicated planetary intelligence array with progressively wider hyperlane coverage.",
    sections: ["defense"],
    unique: true,
    maxLevel: 3,
    levels: {
      1: authoredDefenseLevel({ minerals: 2_500, goods: 150, alloys: 300 }, { energy: 3, goods: 0.25 }, 120),
      2: authoredDefenseLevel({ minerals: 6_000, goods: 600, alloys: 1_200 }, { energy: 7, goods: 0.75 }, 360),
      3: authoredDefenseLevel({ minerals: 15_000, goods: 1_800, alloys: 4_000 }, { energy: 15, goods: 1.5, alloys: 0.25 }, 900),
    },
    jobs: {
      1: [{ job: "sensorManager", amount: 2_000_000 }],
      2: [{ job: "sensorManager", amount: 4_000_000 }],
      3: [{ job: "sensorManager", amount: 6_000_000 }],
    },
    sensorSuiteIds: {
      1: "planetarySensorArray1",
      2: "planetarySensorArray2",
      3: "planetarySensorArray3",
    },
  },
  planetaryShield: {
    kind: "planetaryShield",
    label: "Planetary Shield",
    initials: "PS",
    description: "A planet-spanning shield grid. Its defensive effect will be activated with planetary invasions.",
    sections: ["defense"],
    unique: true,
    maxLevel: 1,
    levels: {
      1: authoredDefenseLevel({ minerals: 3_000, goods: 250, alloys: 800 }, { energy: 10 }, 180),
    },
    jobs: { 1: [{ job: "shieldOperator", amount: 2_000_000 }] },
  },
  barracks: {
    kind: "barracks",
    label: "Barracks",
    initials: "BR",
    description: "Military training grounds that turn employed trainees into faction Crew.",
    sections: ["defense"],
    maxLevel: 1,
    levels: {
      1: authoredDefenseLevel({ minerals: 1_500, goods: 250, alloys: 200 }, { energy: 3, goods: 0.25 }, 120),
    },
    jobs: { 1: [{ job: "trainee", amount: 5_000_000 }] },
  },
  platformSupport: {
    kind: "platformSupport",
    label: "Platform Support",
    initials: "PF",
    description: "Orbital control and supply infrastructure that supports two defense platforms.",
    sections: ["defense", "shipyard"],
    maxLevel: 1,
    levels: {
      1: authoredDefenseLevel({ minerals: 2_500, alloys: 400 }, { energy: 3, alloys: 0.25 }, 150),
    },
    platformCapacity: 2,
  },
  orbitalShipyard: {
    kind: "orbitalShipyard",
    label: "Orbital Shipyard",
    initials: "OY",
    description: "A planetary orbital construction slip capable of assembling any unlocked hull.",
    sections: ["shipyard"],
    maxLevel: 1,
    levels: {
      1: authoredDefenseLevel({ minerals: 3_500, alloys: 500 }, { energy: 3, goods: 0.5, alloys: 0.25 }, 180),
    },
    shipyards: 1,
  },
};

export const PLANET_DEFENSE_BUILDING_KINDS = Object.keys(
  PLANET_DEFENSE_BUILDING_DEFINITIONS,
) as PlanetDefenseBuildingKind[];

export function createEmptyPlanetDefenseState(): PlanetDefenseState {
  return {
    defenseSlots: Array<PlanetDefenseBuildingState | null>(6).fill(null),
    shipyardSlots: Array<PlanetDefenseBuildingState | null>(3).fill(null),
    shipQueue: [],
    stationedArmies: 0,
    traineeRemainders: [],
  };
}

export function normalizePlanetDefenseBuilding(
  value: unknown,
  section: PlanetDefenseSection,
): PlanetDefenseBuildingState | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Partial<PlanetDefenseBuildingState>;
  if (!source.kind || !PLANET_DEFENSE_BUILDING_KINDS.includes(source.kind)) return null;
  const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[source.kind];
  if (!definition.sections.includes(section)) return null;
  return {
    kind: source.kind,
    level: Math.max(1, Math.min(definition.maxLevel, Math.round(Number(source.level) || 1))),
    enabled: source.enabled !== false,
  };
}

export function normalizePlanetDefenseState(value?: Partial<PlanetDefenseState>): PlanetDefenseState {
  const defaults = createEmptyPlanetDefenseState();
  const normalizeSlots = (
    slots: Array<PlanetDefenseBuildingState | null> | undefined,
    section: PlanetDefenseSection,
    length: number,
  ) => Array.from({ length }, (_, index) => normalizePlanetDefenseBuilding(slots?.[index], section));
  const traineeRemainders = (value?.traineeRemainders ?? [])
    .filter((item) => item && typeof item.speciesId === "string")
    .map((item) => ({
      speciesId: item.speciesId,
      population: Math.max(0, Math.min(PEOPLE_PER_MONTHLY_UNIT - 1, Math.floor(Number(item.population) || 0))),
    }))
    .filter((item) => item.population > 0)
    .sort((left, right) => left.speciesId.localeCompare(right.speciesId));
  return {
    ...defaults,
    defenseSlots: normalizeSlots(value?.defenseSlots, "defense", 6),
    shipyardSlots: normalizeSlots(value?.shipyardSlots, "shipyard", 3),
    shipQueue: Array.isArray(value?.shipQueue)
      ? value.shipQueue.flatMap((rawItem, index) => {
        if (!rawItem || typeof rawItem !== "object") return [];
        const item = rawItem as Partial<import("./Starbase").StarbaseShipQueueItem>;
        const validShipKinds: import("./Starbase").StarbaseShipKind[] = [
          "corvette",
          "destroyer",
          "cruiser",
          "battleship",
          "defensePlatform",
          "scienceShip",
          "armyShip",
          "constructionShip",
          "colonizationShip",
        ];
        if (!item.shipKind || !validShipKinds.includes(item.shipKind)) return [];
        const normalizeCounts = (counts: Partial<ResourceCounts> | undefined): ResourceCounts => {
          const normalized = createEmptyResourceCounts();
          for (const resource of RESOURCE_KINDS) {
            normalized[resource] = Math.max(0, Number(counts?.[resource]) || 0);
          }
          return normalized;
        };
        const totalDays = Math.max(1, Number(item.totalDays) || 1);
        const cost = normalizeCounts(item.cost);
        const upfrontCost = item.upfrontCost
          ? normalizeCounts(item.upfrontCost)
          : Object.fromEntries(RESOURCE_KINDS.map((resource) => [resource, cost[resource] * 0.05])) as unknown as ResourceCounts;
        const resourceUpkeepPerDay = item.resourceUpkeepPerDay
          ? normalizeCounts(item.resourceUpkeepPerDay)
          : Object.fromEntries(RESOURCE_KINDS.map((resource) => [
            resource,
            Math.max(0, cost[resource] - upfrontCost[resource]) / totalDays,
          ])) as unknown as ResourceCounts;
        const crewDemand = Math.max(0, Math.floor(Number(item.crewDemand) || 0));
        return [{
          id: typeof item.id === "string" && item.id ? item.id : `planet-ship-queue-${index}`,
          kind: item.kind === "upgrade" ? "upgrade" as const : "build" as const,
          shipKind: item.shipKind,
          designId: typeof item.designId === "string" ? item.designId : null,
          targetDesignId: typeof item.targetDesignId === "string" ? item.targetDesignId : null,
          shipId: typeof item.shipId === "string" ? item.shipId : null,
          label: typeof item.label === "string" && item.label ? item.label : `Queued ${item.shipKind}`,
          cost,
          upfrontCost,
          resourceUpkeepPerDay,
          totalDays,
          remainingDays: Math.max(0, Math.min(totalDays, Number(item.remainingDays) || 0)),
          alloyUpkeepPerDay: Math.max(0, Number(item.alloyUpkeepPerDay) || resourceUpkeepPerDay.alloys),
          crewDemand,
          reservedCrew: Math.max(0, Math.floor(Number(item.reservedCrew ?? crewDemand) || 0)),
        }];
      })
      : [],
    stationedArmies: Math.max(0, Math.floor(Number(value?.stationedArmies) || 0)),
    traineeRemainders,
  };
}

export function getUnlockedPlanetDefenseSlots(state: Pick<PlanetState, "buildings" | "urbanSubDistricts">): number {
  const fortresses = [
    ...Object.values(state.buildings).flat(),
    ...state.urbanSubDistricts.flatMap((subDistrict) => subDistrict.buildings),
  ].filter((building) => (
    getPlanetBuildingKind(building) === "fortress" && isPlanetBuildingEnabled(building)
  )).length;
  return Math.min(6, fortresses * 2);
}

export function getUnlockedPlanetShipyardSlots(state: Pick<PlanetState, "buildings" | "urbanSubDistricts">): number {
  const foundries = [
    ...Object.values(state.buildings).flat(),
    ...state.urbanSubDistricts.flatMap((subDistrict) => subDistrict.buildings),
  ].filter((building) => (
    getPlanetBuildingKind(building) === "alloyFoundries" && isPlanetBuildingEnabled(building)
  )).length;
  return Math.min(3, foundries);
}

export function getActivePlanetDefenseBuildings(
  state: Pick<PlanetState, "buildings" | "urbanSubDistricts" | "defense">,
): Array<PlanetDefenseBuildingState & { section: PlanetDefenseSection; slotIndex: number }> {
  const active: Array<PlanetDefenseBuildingState & { section: PlanetDefenseSection; slotIndex: number }> = [];
  const collect = (
    slots: Array<PlanetDefenseBuildingState | null>,
    section: PlanetDefenseSection,
    unlocked: number,
  ): void => {
    slots.forEach((building, slotIndex) => {
      if (building && slotIndex < unlocked && building.enabled !== false) {
        active.push({ ...building, section, slotIndex });
      }
    });
  };
  collect(state.defense.defenseSlots, "defense", getUnlockedPlanetDefenseSlots(state));
  collect(state.defense.shipyardSlots, "shipyard", getUnlockedPlanetShipyardSlots(state));
  return active;
}

export function getPlanetDefensePlatformCapacity(
  state: Pick<PlanetState, "buildings" | "urbanSubDistricts" | "defense">,
): number {
  return getActivePlanetDefenseBuildings(state).reduce((total, building) => (
    total + (PLANET_DEFENSE_BUILDING_DEFINITIONS[building.kind].platformCapacity ?? 0)
  ), 0);
}

export function countPlanetShipyards(
  state: Pick<PlanetState, "buildings" | "urbanSubDistricts" | "defense">,
): number {
  return getActivePlanetDefenseBuildings(state).reduce((total, building) => (
    total + (PLANET_DEFENSE_BUILDING_DEFINITIONS[building.kind].shipyards ?? 0)
  ), 0);
}

export const BUILDING_KINDS = Object.keys(BUILDING_DEFINITIONS) as BuildingKind[];

export const BUILDING_LABELS: Record<BuildingKind, string> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_DEFINITIONS[building].label]),
) as Record<BuildingKind, string>;

export const BUILDING_MINERAL_COSTS: Record<BuildingKind, number> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_LEVEL_DEFINITIONS[building][1].cost.minerals]),
) as Record<BuildingKind, number>;

export const BUILDING_BUILD_DAYS: Record<BuildingKind, number> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_LEVEL_DEFINITIONS[building][1].buildDays]),
) as Record<BuildingKind, number>;

export const BUILDING_LEVEL_EFFECT_MULTIPLIERS: Record<number, number> = {
  1: 1,
  2: 1.8,
  3: 2.9,
  4: 4.4,
  5: 6.4,
};

export function clampBuildingLevel(level: unknown): number {
  const numeric = Math.round(Number(level) || 1);
  return Math.max(1, Math.min(BUILDING_MAX_LEVEL, numeric));
}

export function getBuildingMaxLevel(building: BuildingKind): number {
  return Math.max(...Object.keys(BUILDING_LEVEL_DEFINITIONS[building]).map(Number));
}

function clampLevelForBuilding(building: BuildingKind, level: unknown): number {
  return Math.max(1, Math.min(getBuildingMaxLevel(building), Math.round(Number(level) || 1)));
}

export function createPlanetBuildingState(kind: BuildingKind, level = 1, enabled = true): PlanetBuildingState {
  return {
    kind,
    level: clampLevelForBuilding(kind, level),
    enabled,
  };
}

export function getPlanetBuildingKind(slot: PlanetBuildingSlot | undefined): BuildingKind | null {
  if (!slot) return null;
  if (typeof slot === "string") return BUILDING_KINDS.includes(slot) ? slot : null;
  return BUILDING_KINDS.includes(slot.kind) ? slot.kind : null;
}

export function getPlanetBuildingLevel(slot: PlanetBuildingSlot | undefined): number {
  if (!slot) return 0;
  if (typeof slot === "string") return 1;
  return clampLevelForBuilding(slot.kind, slot.level);
}

export function isPlanetBuildingEnabled(slot: PlanetBuildingSlot | undefined): boolean {
  if (!slot || typeof slot === "string") return Boolean(slot);
  return slot.enabled !== false;
}

export function getBuildingLevelEffectMultiplier(level: number): number {
  return BUILDING_LEVEL_EFFECT_MULTIPLIERS[clampBuildingLevel(level)] ?? 1;
}

export function getCapitalTierDefinition(level: number): CapitalTierDefinition {
  return CAPITAL_TIER_DEFINITIONS[clampBuildingLevel(level)];
}

export function getBuildingDisplayLabel(building: BuildingKind, level = 1): string {
  return building === CAPITAL_BUILDING_KIND
    ? getCapitalTierDefinition(level).label
    : BUILDING_DEFINITIONS[building].label;
}

export function getBuildingDisplayDescription(building: BuildingKind, level = 1): string {
  return building === CAPITAL_BUILDING_KIND
    ? getCapitalTierDefinition(level).description
    : BUILDING_DEFINITIONS[building].description;
}

export function getBuildingJobEffects(building: BuildingKind, level = 1): BuildingJobEffect[] {
  if (building === CAPITAL_BUILDING_KIND) {
    return getCapitalTierDefinition(level).jobs.map((effect) => ({ ...effect }));
  }
  const multiplier = getBuildingLevelEffectMultiplier(level);
  return (BUILDING_DEFINITIONS[building].jobs ?? []).map((effect) => ({
    ...effect,
    amount: effect.amount * multiplier,
  }));
}

export function getBuildingHousing(building: BuildingKind, level = 1): number {
  if (building === CAPITAL_BUILDING_KIND) return getCapitalTierDefinition(level).housing;
  return (BUILDING_DEFINITIONS[building].housing ?? 0) * getBuildingLevelEffectMultiplier(level);
}

export function getBuildingLevelModifiers(building: BuildingKind, level = 1): PlanetModifier[] {
  return building === CAPITAL_BUILDING_KIND
    ? getCapitalTierDefinition(level).modifiers.map((modifier) => cloneModifier(modifier))
    : [];
}

export function getBuildingCost(building: BuildingKind, targetLevel = 1): ResourceCounts {
  const level = clampLevelForBuilding(building, targetLevel);
  return { ...BUILDING_LEVEL_DEFINITIONS[building][level].cost };
}

export function getBuildingUpkeep(building: BuildingKind, level = 1): ResourceCounts {
  return { ...BUILDING_LEVEL_DEFINITIONS[building][clampLevelForBuilding(building, level)].upkeep };
}

export function getBuildingMineralCost(building: BuildingKind, targetLevel = 1): number {
  return getBuildingCost(building, targetLevel).minerals;
}

export function getBuildingBuildDays(building: BuildingKind, targetLevel = 1): number {
  const level = clampLevelForBuilding(building, targetLevel);
  return BUILDING_LEVEL_DEFINITIONS[building][level].buildDays;
}

export function getBuildingUpgradeTargetLevel(slot: PlanetBuildingSlot | undefined): number | null {
  const kind = getPlanetBuildingKind(slot);
  if (!kind) return null;
  const nextLevel = getPlanetBuildingLevel(slot) + 1;
  return nextLevel <= getBuildingMaxLevel(kind) ? nextLevel : null;
}

export function getBuildingUpgradeMineralCost(building: BuildingKind, currentLevel: number): number {
  return getBuildingUpgradeCost(building, currentLevel).minerals;
}

export function getBuildingUpgradeCost(building: BuildingKind, currentLevel: number): ResourceCounts {
  return getBuildingCost(building, clampBuildingLevel(currentLevel + 1));
}

export function getBuildingUpgradeBuildDays(building: BuildingKind, currentLevel: number): number {
  return getBuildingBuildDays(building, currentLevel + 1);
}

/** The auto-placed governing building that anchors every habited planet's first city slot. */
export const CAPITAL_BUILDING_KIND: BuildingKind = "planetaryCapital";

/**
 * Minimum planetary population required before the Planetary Capital can be
 * upgraded to a given level. Higher tiers represent a larger governing
 * apparatus that only makes sense once a world is sufficiently populous.
 */
export const CAPITAL_UPGRADE_POPULATION_THRESHOLDS: Record<number, number> = {
  2: 5_000_000_000,
  3: 15_000_000_000,
  4: 35_000_000_000,
  5: 65_000_000_000,
};

export function getCapitalUpgradePopulationThreshold(targetLevel: number): number {
  return CAPITAL_UPGRADE_POPULATION_THRESHOLDS[clampBuildingLevel(targetLevel)] ?? 0;
}

/**
 * Population gate for capital upgrades. Non-capital buildings have no population
 * requirement, so this always returns true for them.
 */
export function meetsCapitalUpgradePopulation(
  buildingKind: BuildingKind,
  targetLevel: number,
  population: number,
): boolean {
  if (buildingKind !== CAPITAL_BUILDING_KIND) return true;
  return population >= getCapitalUpgradePopulationThreshold(targetLevel);
}

/**
 * Guarantees the Planetary Capital occupies the first city slot on a habited
 * planet. Existing occupants of slot 0 are relocated to the next free city slot
 * where possible so player-built structures are preserved. Runs server-side as
 * the migration path for planets created before the capital existed.
 */
export function ensureCapitalBuilding(buildings: DistrictBuildingSlots, isHabited: boolean): DistrictBuildingSlots {
  if (!isHabited) return buildings;
  const city = buildings.city;
  const existingIndex = city.findIndex((slot) => getPlanetBuildingKind(slot) === CAPITAL_BUILDING_KIND);
  if (existingIndex === 0) {
    if (isPlanetBuildingEnabled(city[0])) return buildings;
    const nextCity = [...city];
    nextCity[0] = createPlanetBuildingState(
      CAPITAL_BUILDING_KIND,
      getPlanetBuildingLevel(city[0]),
      true,
    );
    return { ...buildings, city: nextCity };
  }

  const nextCity = [...city];
  if (existingIndex > 0) {
    const capital = nextCity[existingIndex];
    nextCity[existingIndex] = nextCity[0];
    nextCity[0] = capital;
    return { ...buildings, city: nextCity };
  }

  const occupant = nextCity[0];
  if (occupant) {
    const emptyIndex = nextCity.findIndex((slot, index) => index > 0 && !slot);
    if (emptyIndex > 0) nextCity[emptyIndex] = occupant;
  }
  nextCity[0] = createPlanetBuildingState(CAPITAL_BUILDING_KIND, 1);
  return { ...buildings, city: nextCity };
}

export const URBAN_SUB_DISTRICT_KINDS: UrbanSubDistrictKind[] = [
  "residential",
  "researchCampus",
  "mixedIndustry",
  "civilianIndustry",
  "heavyIndustry",
];

export const STARTING_RESOURCE_STOCKPILES: ResourceCounts = {
  food: 3_000,
  minerals: 6_000,
  energy: 4_000,
  goods: 1_200,
  alloys: 800,
  research: 0,
};

function emptyJobCapacity(): JobCapacity {
  return {
    ruler: 0,
    administrator: 0,
    sensorManager: 0,
    shieldOperator: 0,
    researcher: 0,
    artisan: 0,
    metallurgist: 0,
    entertainer: 0,
    enforcer: 0,
    soldier: 0,
    trainee: 0,
    farmer: 0,
    miner: 0,
    technician: 0,
    colonizer: 0,
    clerk: 0,
    criminal: 0,
    unemployed: 0,
  };
}

export function createEmptyResourceCounts(): ResourceCounts {
  return {
    food: 0,
    minerals: 0,
    energy: 0,
    goods: 0,
    alloys: 0,
    research: 0,
  };
}

export function cloneResourceCounts(counts: ResourceCounts): ResourceCounts {
  return {
    food: counts.food,
    minerals: counts.minerals,
    energy: counts.energy,
    goods: counts.goods,
    alloys: counts.alloys,
    research: counts.research,
  };
}

function normalizeResourceCost(
  counts: Partial<ResourceCounts> | undefined,
  legacyMineralCost = 0,
): ResourceCounts {
  const normalized = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) {
    const fallback = resource === "minerals" ? legacyMineralCost : 0;
    normalized[resource] = Math.max(0, Math.round(Number(counts?.[resource]) || fallback));
  }
  return normalized;
}

export function addResourceCounts(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return {
    food: a.food + b.food,
    minerals: a.minerals + b.minerals,
    energy: a.energy + b.energy,
    goods: a.goods + b.goods,
    alloys: a.alloys + b.alloys,
    research: a.research + b.research,
  };
}

export function createEmptyDistrictBuildingSlots(): DistrictBuildingSlots {
  return {
    city: Array<PlanetBuildingSlot>(6).fill(null),
    generator: Array<PlanetBuildingSlot>(3).fill(null),
    mining: Array<PlanetBuildingSlot>(3).fill(null),
    agriculture: Array<PlanetBuildingSlot>(3).fill(null),
  };
}

export function createEmptyUrbanSubDistricts(): UrbanSubDistrictState[] {
  return [
    { kind: "residential", buildings: Array<PlanetBuildingSlot>(3).fill(null) },
    { kind: "mixedIndustry", buildings: Array<PlanetBuildingSlot>(3).fill(null) },
  ];
}

function cloneDistricts(counts: DistrictCounts): DistrictCounts {
  return {
    city: counts.city,
    generator: counts.generator,
    mining: counts.mining,
    agriculture: counts.agriculture,
  };
}

function normalizeDistrictCounts(counts: Partial<DistrictCounts> | undefined, limits: DistrictCounts): DistrictCounts {
  return {
    city: clampInt(counts?.city ?? 0, 0, limits.city),
    generator: clampInt(counts?.generator ?? 0, 0, limits.generator),
    mining: clampInt(counts?.mining ?? 0, 0, limits.mining),
    agriculture: clampInt(counts?.agriculture ?? 0, 0, limits.agriculture),
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cloneModifier(modifier: PlanetModifier): PlanetModifier {
  return { ...modifier };
}

function cloneSpeciesPopulation(population: SpeciesPopulation): SpeciesPopulation {
  return {
    speciesId: population.speciesId,
    population: population.population,
  };
}

function normalizeModifier(modifier: Partial<PlanetModifier> | undefined): PlanetModifier | null {
  if (!modifier?.id || !modifier.label || !modifier.source || !modifier.target) return null;
  if (modifier.operation !== "add" && modifier.operation !== "multiply") return null;
  const value = Number(modifier.value);
  if (!Number.isFinite(value)) return null;
  const expiresAtYear = modifier.expiresAtYear === undefined || modifier.expiresAtYear === null
    ? Number.NaN
    : Number(modifier.expiresAtYear);
  return {
    id: modifier.id,
    label: modifier.label,
    source: modifier.source,
    target: modifier.target,
    operation: modifier.operation,
    value,
    ...(Number.isFinite(expiresAtYear) ? { expiresAtYear } : {}),
  };
}

function normalizeModifiers(modifiers: PlanetModifier[] | undefined): PlanetModifier[] {
  return (modifiers ?? [])
    .map((modifier) => normalizeModifier(modifier))
    .filter((modifier): modifier is PlanetModifier => modifier !== null);
}

export function normalizePlanetFeatures(features: PlanetFeatureKind[] | undefined): PlanetFeatureKind[] {
  const seen = new Set<PlanetFeatureKind>();
  const normalized: PlanetFeatureKind[] = [];
  for (const feature of features ?? []) {
    if (!PLANET_FEATURE_KINDS.includes(feature) || seen.has(feature)) continue;
    seen.add(feature);
    normalized.push(feature);
  }
  return normalized;
}

function normalizeSpeciesPopulations(
  populations: SpeciesPopulation[] | undefined,
  fallbackPopulation: number,
  isHabited: boolean,
): SpeciesPopulation[] {
  if (!isHabited) return [];

  const bySpecies = new Map<SpeciesId, number>();
  for (const entry of populations ?? []) {
    if (!entry || typeof entry.speciesId !== "string" || !entry.speciesId.trim()) continue;
    const speciesId = entry.speciesId.trim();
    const population = Math.max(0, Math.floor(Number(entry.population) || 0));
    if (population <= 0) continue;
    bySpecies.set(speciesId, (bySpecies.get(speciesId) ?? 0) + population);
  }

  if (bySpecies.size === 0 && fallbackPopulation > 0) {
    bySpecies.set(HUMAN_SPECIES_ID, Math.max(0, Math.floor(fallbackPopulation)));
  }

  const targetPopulation = Math.max(0, Math.floor(fallbackPopulation));
  const currentPopulation = Array.from(bySpecies.values()).reduce((sum, population) => sum + population, 0);
  if (currentPopulation > 0 && targetPopulation > 0 && currentPopulation !== targetPopulation) {
    let runningTotal = 0;
    for (const [speciesId, current] of bySpecies) {
      if (current <= 0) continue;
      const scaled = Math.max(0, Math.round(targetPopulation * (current / currentPopulation)));
      bySpecies.set(speciesId, scaled);
      runningTotal += scaled;
    }
    let remainder = targetPopulation - runningTotal;
    for (const speciesId of bySpecies.keys()) {
      if (remainder === 0) break;
      const step = remainder > 0 ? 1 : -1;
      const current = bySpecies.get(speciesId) ?? 0;
      if (step < 0 && current <= 0) continue;
      bySpecies.set(speciesId, current + step);
      remainder -= step;
    }
  }

  return Array.from(bySpecies.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((speciesId) => ({
      speciesId,
      population: bySpecies.get(speciesId) ?? 0,
    }))
    .filter((entry) => entry.population > 0);
}

export function sumSpeciesPopulation(populations: SpeciesPopulation[]): number {
  return populations.reduce((sum, entry) => sum + entry.population, 0);
}

export function getFeatureModifiers(features: PlanetFeatureKind[] | undefined): PlanetModifier[] {
  const modifiers: PlanetModifier[] = [];
  for (const feature of normalizePlanetFeatures(features)) {
    modifiers.push(...PLANET_FEATURE_DEFINITIONS[feature].modifiers.map((modifier) => cloneModifier(modifier)));
  }
  return modifiers;
}

function getActiveModifiers(
  state: Pick<PlanetState, "features" | "modifiers"> & Partial<Pick<PlanetState, "buildings">>,
  externalModifiers: PlanetModifier[] = [],
): PlanetModifier[] {
  const capital = state.buildings?.city.find((building) => getPlanetBuildingKind(building) === CAPITAL_BUILDING_KIND);
  return [
    ...normalizeModifiers(state.modifiers).map((modifier) => cloneModifier(modifier)),
    ...normalizeModifiers(externalModifiers).map((modifier) => cloneModifier(modifier)),
    ...getFeatureModifiers(state.features),
    ...(capital && isPlanetBuildingEnabled(capital)
      ? getBuildingLevelModifiers(CAPITAL_BUILDING_KIND, getPlanetBuildingLevel(capital))
      : []),
  ];
}

function applyModifiers(value: number, modifiers: PlanetModifier[], target: PlanetModifierTarget): number {
  let next = value;
  for (const modifier of modifiers) {
    if (modifier.target === target && modifier.operation === "add") next += modifier.value;
  }
  for (const modifier of modifiers) {
    if (modifier.target === target && modifier.operation === "multiply") next *= 1 + modifier.value;
  }
  return next;
}

function getModifierMultiplier(modifiers: PlanetModifier[], target: PlanetModifierTarget): number {
  return applyModifiers(1, modifiers, target);
}

function getContextSpecies(context: PlanetEconomySpeciesContext | undefined, speciesId: SpeciesId): SpeciesState | undefined {
  return context?.species.find((species) => species.id === speciesId)
    ?? (speciesId === HUMAN_SPECIES_ID ? { id: HUMAN_SPECIES_ID, name: "Human", archetypeId: "humanoid", traitIds: [], originFactionId: null } : undefined);
}

function getContextRights(context: PlanetEconomySpeciesContext | undefined, speciesId: SpeciesId): SpeciesRights {
  return normalizeSpeciesRights(context?.rightsBySpeciesId?.[speciesId] ?? DEFAULT_SPECIES_RIGHTS);
}

function getContextEffects(context: PlanetEconomySpeciesContext | undefined, speciesId: SpeciesId) {
  return getSpeciesEconomyEffects(getContextSpecies(context, speciesId), getContextRights(context, speciesId));
}

function getContextSpeciesName(context: PlanetEconomySpeciesContext | undefined, speciesId: SpeciesId): string {
  return getContextSpecies(context, speciesId)?.name ?? speciesId;
}

function canSpeciesWorkJob(speciesId: SpeciesId, jobClass: JobClass, context: PlanetEconomySpeciesContext | undefined): boolean {
  return canRightsWorkJob(getContextRights(context, speciesId), jobClass);
}

function getSpeciesHousingNeedPopulation(populations: SpeciesPopulation[], context: PlanetEconomySpeciesContext | undefined): number {
  return populations.reduce((sum, species) => (
    sum + species.population * getContextEffects(context, species.speciesId).housingUsageMultiplier
  ), 0);
}

function getWeightedSpeciesGrowthMultiplier(populations: SpeciesPopulation[], context: PlanetEconomySpeciesContext | undefined): number {
  const total = sumSpeciesPopulation(populations);
  if (total <= 0) return 1;
  return populations.reduce((sum, species) => (
    sum + (species.population / total) * getContextEffects(context, species.speciesId).growthMultiplier
  ), 0);
}

function interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number {
  if (inputMax === inputMin) return outputMin;
  const t = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
  return outputMin + (outputMax - outputMin) * t;
}

export function getEffectiveSpeciesHabitability(
  state: Pick<PlanetState, "habitability" | "features" | "modifiers">,
  speciesId: SpeciesId = HUMAN_SPECIES_ID,
  context?: PlanetEconomySpeciesContext,
): number {
  const base = clamp(state.habitability ?? 0, 0, 100);
  const modified = applyModifiers(base, getActiveModifiers(state), `habitability:${speciesId}`)
    + getContextEffects(context, speciesId).habitabilityAdd;
  return clamp(Math.round(modified), 0, 100);
}

export function getHabitabilityProductionMultiplier(habitability: number): number {
  if (habitability <= 80) return interpolate(habitability, 0, 80, 0.5, 1);
  return interpolate(habitability, 80, 100, 1, 1.3);
}

export function getHabitabilityUpkeepMultiplier(habitability: number): number {
  if (habitability <= 80) return interpolate(habitability, 0, 80, 1.5, 1);
  return interpolate(habitability, 80, 100, 1, 0.7);
}

function getHabitabilityHappinessModifier(habitability: number): number {
  if (habitability <= 80) return interpolate(habitability, 0, 80, -30, 0);
  return interpolate(habitability, 80, 100, 0, 30);
}

function normalizeConstructionQueueItem(
  item: Partial<PlanetConstructionQueueItem> | undefined,
): PlanetConstructionQueueItem | null {
  if (
    !item?.id
    || !item.label
    || !["district", "building", "buildingUpgrade", "defenseBuilding", "defenseBuildingUpgrade"].includes(item.kind ?? "")
  ) return null;
  const totalDays = Math.max(1, Number(item.totalDays) || 1);
  const remainingDays = Math.max(0, Math.min(totalDays, Number(item.remainingDays) || totalDays));
  const legacyMineralCost = Math.max(0, Math.round(Number(item.mineralCost) || 0));
  const cost = normalizeResourceCost(item.cost, legacyMineralCost);
  const mineralCost = cost.minerals;
  if (item.kind === "district") {
    if (!item.districtKind || !["city", "generator", "mining", "agriculture"].includes(item.districtKind)) return null;
    return {
      id: item.id,
      kind: "district",
      label: item.label,
      cost,
      mineralCost,
      totalDays,
      remainingDays,
      districtKind: item.districtKind,
    };
  }
  if (item.kind === "defenseBuilding" || item.kind === "defenseBuildingUpgrade") {
    if (
      !item.defenseBuildingKind
      || !PLANET_DEFENSE_BUILDING_KINDS.includes(item.defenseBuildingKind)
      || (item.defenseSection !== "defense" && item.defenseSection !== "shipyard")
    ) return null;
    const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[item.defenseBuildingKind];
    if (!definition.sections.includes(item.defenseSection)) return null;
    const slotIndex = Math.max(0, Math.round(Number(item.slotIndex) || 0));
    const targetLevel = Math.max(1, Math.min(
      definition.maxLevel,
      Math.round(Number(item.targetLevel) || 1),
    ));
    return {
      id: item.id,
      kind: item.kind,
      label: item.label,
      cost,
      mineralCost,
      totalDays,
      remainingDays,
      defenseBuildingKind: item.defenseBuildingKind,
      defenseSection: item.defenseSection,
      slotIndex,
      targetLevel,
    };
  }
  if (!item.buildingKind || !BUILDING_KINDS.includes(item.buildingKind)) return null;
  if (!item.area || !(item.area === "urbanSubDistrict" || ["city", "generator", "mining", "agriculture"].includes(item.area))) return null;
  const slotIndex = Math.max(0, Math.round(Number(item.slotIndex) || 0));
  const subDistrictIndex = item.subDistrictIndex === undefined ? undefined : Math.max(0, Math.round(Number(item.subDistrictIndex)));
  const targetLevel = item.targetLevel === undefined ? undefined : clampBuildingLevel(item.targetLevel);
  return {
    id: item.id,
    kind: item.kind as "building" | "buildingUpgrade",
    label: item.label,
    cost,
    mineralCost,
    totalDays,
    remainingDays,
    buildingKind: item.buildingKind,
    targetLevel,
    area: item.area,
    slotIndex,
    subDistrictIndex,
  };
}

export function normalizeConstructionQueue(
  queue: PlanetConstructionQueueItem[] | undefined,
): PlanetConstructionQueueItem[] {
  return (queue ?? [])
    .map((item) => normalizeConstructionQueueItem(item))
    .filter((item): item is PlanetConstructionQueueItem => item !== null);
}

function normalizeBuildingSlot(value: unknown): PlanetBuildingSlot {
  if (typeof value === "string" && BUILDING_KINDS.includes(value as BuildingKind)) {
    return createPlanetBuildingState(value as BuildingKind, 1);
  }
  if (value && typeof value === "object") {
    const record = value as Partial<PlanetBuildingState>;
    if (record.kind && BUILDING_KINDS.includes(record.kind)) {
      return createPlanetBuildingState(record.kind, record.level, record.enabled !== false);
    }
  }
  return null;
}

function normalizeBuildingSlots(
  slots: PlanetBuildingSlot[] | undefined,
  length: number,
): PlanetBuildingSlot[] {
  const out = Array<PlanetBuildingSlot>(length).fill(null);
  for (let i = 0; i < length; i++) {
    out[i] = normalizeBuildingSlot(slots?.[i] ?? null);
  }
  return out;
}

function normalizeBuildings(buildings: Partial<DistrictBuildingSlots> | undefined): DistrictBuildingSlots {
  return {
    city: normalizeBuildingSlots(buildings?.city, 6),
    generator: normalizeBuildingSlots(buildings?.generator, 3),
    mining: normalizeBuildingSlots(buildings?.mining, 3),
    agriculture: normalizeBuildingSlots(buildings?.agriculture, 3),
  };
}

function normalizeUrbanSubDistricts(
  subDistricts: UrbanSubDistrictState[] | undefined,
): UrbanSubDistrictState[] {
  const defaults = createEmptyUrbanSubDistricts();
  return [0, 1].map((index) => {
    const source = subDistricts?.[index];
    const kind = source?.kind && URBAN_SUB_DISTRICT_KINDS.includes(source.kind)
      ? source.kind
      : defaults[index].kind;
    const buildings = normalizeBuildingSlots(source?.buildings, 3)
      .map((building) => {
        const buildingKind = getPlanetBuildingKind(building);
        return buildingKind && isBuildingCompatible(buildingKind, "urbanSubDistrict", kind) ? building : null;
      });
    return { kind, buildings };
  });
}

function createStarterBuiltDistricts(limits: DistrictCounts, existing: DistrictCounts): DistrictCounts {
  return {
    city: Math.max(existing.city, Math.min(4, limits.city)),
    generator: Math.max(existing.generator, Math.min(2, limits.generator)),
    mining: Math.max(existing.mining, Math.min(2, limits.mining)),
    agriculture: Math.max(existing.agriculture, Math.min(2, limits.agriculture)),
  };
}

function createStarterBuildings(limits: DistrictCounts): DistrictBuildingSlots {
  const buildings = createEmptyDistrictBuildingSlots();
  buildings.city[0] = createPlanetBuildingState(CAPITAL_BUILDING_KIND);
  buildings.city[1] = createPlanetBuildingState("administrativeComplex");
  buildings.city[2] = createPlanetBuildingState("housingComplex");
  if (limits.generator > 0) buildings.generator[0] = createPlanetBuildingState("energyGrid");
  if (limits.mining > 0) buildings.mining[0] = createPlanetBuildingState("mineralPurificationPlant");
  if (limits.agriculture > 0) buildings.agriculture[0] = createPlanetBuildingState("foodProcessingPlant");
  return buildings;
}

export function createPlanetStateFromSeed(
  seed: PlanetEconomySeed,
  existing?: Partial<PlanetState>,
): PlanetState {
  const features = normalizePlanetFeatures(existing?.features ?? seed.features);
  const baseBuiltDistricts = normalizeDistrictCounts(existing?.builtDistricts ?? seed.builtDistricts, seed.districtLimits);
  const isHabited = (existing?.isHabited ?? false) || seed.isHabited;
  const useStarterInfrastructure = isHabited && seed.starterInfrastructure !== false;
  const builtDistricts = useStarterInfrastructure
    ? createStarterBuiltDistricts(seed.districtLimits, baseBuiltDistricts)
    : baseBuiltDistricts;
  let buildings = ensureCapitalBuilding(
    useStarterInfrastructure
      ? normalizeBuildings(existing?.buildings ?? createStarterBuildings(seed.districtLimits))
      : normalizeBuildings(existing?.buildings),
    isHabited,
  );
  if (isHabited && features.includes("homePlanet")) {
    const capital = buildings.city[0];
    if (getPlanetBuildingKind(capital) === CAPITAL_BUILDING_KIND && getPlanetBuildingLevel(capital) < 2) {
      buildings = {
        ...buildings,
        city: [
          createPlanetBuildingState(CAPITAL_BUILDING_KIND, 2, true),
          ...buildings.city.slice(1),
        ],
      };
    }
  }
  const urbanSubDistricts = isHabited
    ? normalizeUrbanSubDistricts(existing?.urbanSubDistricts)
    : normalizeUrbanSubDistricts([]);
  const fallbackPopulation = isHabited
    ? existing?.population === undefined
      ? Math.max(0, Math.floor(seed.startingPopulation ?? STARTING_HABITED_POPULATION))
      : Math.max(0, Math.floor(existing.population))
    : 0;
  const speciesPopulations = normalizeSpeciesPopulations(
    existing?.speciesPopulations,
    fallbackPopulation,
    isHabited,
  );
  const population = sumSpeciesPopulation(speciesPopulations);
  const state: PlanetState = {
    id: seed.id,
    starId: seed.starId,
    planetIndex: seed.planetIndex,
    ownerId: existing?.ownerId ?? seed.ownerId ?? null,
    isHabited,
    habitability: existing?.habitability ?? seed.habitability,
    population,
    speciesPopulations,
    features,
    builtDistricts,
    buildings,
    urbanSubDistricts,
    constructionQueue: normalizeConstructionQueue(existing?.constructionQueue),
    defense: normalizePlanetDefenseState(existing?.defense),
    modifiers: normalizeModifiers(existing?.modifiers),
    jobLocks: normalizePlanetJobLocks(existing?.jobLocks),
    populationMigration: {
      monthIndex: Math.max(0, Math.floor(existing?.populationMigration?.monthIndex ?? 0)),
      inbound: Math.max(0, Math.floor(existing?.populationMigration?.inbound ?? 0)),
      outbound: Math.max(0, Math.floor(existing?.populationMigration?.outbound ?? 0)),
      intakeCapacity: Math.max(0, Math.floor(existing?.populationMigration?.intakeCapacity ?? 0)),
    },
    economy: createEmptyPlanetEconomySummary(),
  };
  state.economy = calculatePlanetEconomy(state, seed.districtLimits);
  return state;
}

export function createEmptyPlanetEconomySummary(): PlanetEconomySummary {
  return {
    production: createEmptyResourceCounts(),
    upkeep: createEmptyResourceCounts(),
    net: createEmptyResourceCounts(),
    deficit: createEmptyResourceCounts(),
    jobCapacity: emptyJobCapacity(),
    popGroups: [],
    employedPopulation: 0,
    unemployedPopulation: 0,
    housing: 0,
    amenities: 0,
    happiness: 50,
    crime: 0,
    stability: 50,
    populationGrowth: createEmptyPopulationGrowth(),
    populationDecline: createEmptyPopulationDecline(),
    migration: createEmptyMigrationSummary(),
    activeModifiers: [],
  };
}

export function normalizePlanetJobLocks(locks: PlanetJobLock[] | undefined): PlanetJobLock[] {
  const byJob = new Map<PlanetJobLock["job"], Map<SpeciesId, number>>();
  for (const lock of locks ?? []) {
    const runtimeJob = (lock as { job?: JobKind }).job;
    if (
      !lock
      || !runtimeJob
      || !JOB_KINDS.includes(runtimeJob)
      || runtimeJob === "criminal"
      || runtimeJob === "unemployed"
    ) continue;
    const job = runtimeJob as PlanetJobLock["job"];
    const allocations = byJob.get(job) ?? new Map<SpeciesId, number>();
    for (const allocation of lock.allocations ?? []) {
      if (!allocation || typeof allocation.speciesId !== "string" || !allocation.speciesId.trim()) continue;
      const population = Math.max(0, Math.floor(Number(allocation.population) || 0));
      if (population <= 0) continue;
      const speciesId = allocation.speciesId.trim();
      allocations.set(speciesId, (allocations.get(speciesId) ?? 0) + population);
    }
    if (allocations.size > 0) byJob.set(job, allocations);
  }
  return Array.from(byJob.entries())
    .sort(([left], [right]) => JOB_FILL_ORDER.indexOf(left) - JOB_FILL_ORDER.indexOf(right))
    .map(([job, allocations]) => ({
      job,
      allocations: Array.from(allocations.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([speciesId, population]) => ({ speciesId, population })),
    }));
}

function addJobCapacity(capacity: JobCapacity, job: JobKind, amount: number, modifiers: PlanetModifier[] = []): void {
  const modifiedAmount = applyModifiers(amount, modifiers, `jobCapacity:${job}`);
  capacity[job] = Math.max(0, capacity[job] + modifiedAmount);
}

function addResource(counts: ResourceCounts, kind: ResourceKind, amount: number): void {
  counts[kind] += amount;
}

function applyJobResourceEffect(
  production: ResourceCounts,
  upkeep: ResourceCounts,
  job: JobKind,
  jobClass: JobClass,
  speciesId: SpeciesId,
  population: number,
  modifiers: PlanetModifier[],
  productionMultiplier: number,
  upkeepMultiplier: number,
  context?: PlanetEconomySpeciesContext,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const addJobOutput = (resource: ResourceKind, amount: number): void => {
    const generic = applyModifiers(amount, modifiers, "jobOutput");
    const species = getContextSpecies(context, speciesId);
    const speciesMultiplier = getSpeciesJobOutputMultiplier(species, job, resource, jobClass);
    addResource(production, resource, applyModifiers(generic, modifiers, `jobOutput:${job}:${resource}`) * productionMultiplier * speciesMultiplier);
  };
  const addJobUpkeep = (resource: ResourceKind, amount: number): void => {
    const generic = applyModifiers(amount, modifiers, "jobUpkeep");
    addResource(upkeep, resource, applyModifiers(generic, modifiers, `jobUpkeep:${job}:${resource}`) * upkeepMultiplier);
  };
  const definition = JOB_DEFINITIONS[job];
  for (const [resource, amount] of Object.entries(definition.output ?? {}) as Array<[ResourceKind, number]>) {
    addJobOutput(resource, units * amount);
  }
  for (const [resource, amount] of Object.entries(definition.upkeep ?? {}) as Array<[ResourceKind, number]>) {
    addJobUpkeep(resource, units * amount);
  }
  return getJobAmenityEffect(job, speciesId, population, modifiers, productionMultiplier, context);
}

function applyGoodsUpkeep(
  upkeep: ResourceCounts,
  jobClass: JobClass,
  speciesId: SpeciesId,
  population: number,
  modifiers: PlanetModifier[],
  upkeepMultiplier: number,
  perUnitOverride?: number,
  context?: PlanetEconomySpeciesContext,
): void {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const upkeepPerUnit = perUnitOverride ?? (jobClass === "upper" ? 0.009 : jobClass === "middle" ? 0.005 : 0.0016);
  addResource(
    upkeep,
    "goods",
    applyModifiers(units * upkeepPerUnit, modifiers, `goodsUpkeep:${jobClass}`)
      * upkeepMultiplier
      * getContextEffects(context, speciesId).goodsUpkeepMultiplier,
  );
}

function getJobAmenityEffect(
  job: JobKind,
  speciesId: SpeciesId,
  population: number,
  modifiers: PlanetModifier[],
  productionMultiplier: number,
  context?: PlanetEconomySpeciesContext,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const amenities = JOB_DEFINITIONS[job].amenities ?? 0;
  return applyModifiers(units * amenities, modifiers, `jobAmenities:${job}`)
    * productionMultiplier
    * getContextEffects(context, speciesId).amenitiesMultiplier;
}

function getJobCrimeReductionEffect(
  job: JobKind,
  population: number,
  productionMultiplier: number,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  return units * (JOB_DEFINITIONS[job].crimeReduction ?? 0) * productionMultiplier;
}

function applyBuildingEffect(
  building: PlanetBuildingSlot,
  capacity: JobCapacity,
  builtDistricts: DistrictCounts,
  modifiers: PlanetModifier[] = [],
  context?: { housing: number },
): number {
  const buildingKind = getPlanetBuildingKind(building);
  if (!buildingKind) return 0;
  const level = getPlanetBuildingLevel(building);
  const definition = BUILDING_DEFINITIONS[buildingKind];
  if (!definition) return context?.housing ?? 0;
  if (isPlanetBuildingEnabled(building)) {
    for (const effect of getBuildingJobEffects(buildingKind, level)) {
      const multiplier = effect.perDistrict ? builtDistricts[effect.perDistrict] : 1;
      addJobCapacity(capacity, effect.job, effect.amount * multiplier, modifiers);
    }
  }
  return getBuildingHousing(buildingKind, level);
}

interface PopAssignment {
  job: JobKind;
  class: JobClass;
  speciesId: SpeciesId;
  population: number;
}

function allocateIntegerProportionally(
  requests: Array<{ id: string; amount: number }>,
  limit: number,
): Map<string, number> {
  const normalized = requests
    .map((request) => ({ ...request, amount: Math.max(0, Math.floor(request.amount)) }))
    .filter((request) => request.amount > 0)
    .sort((left, right) => left.id.localeCompare(right.id));
  const total = normalized.reduce((sum, request) => sum + request.amount, 0);
  const cappedLimit = Math.max(0, Math.min(total, Math.floor(limit)));
  if (total <= cappedLimit) return new Map(normalized.map((request) => [request.id, request.amount]));
  const minimumPerRequest = cappedLimit >= normalized.length ? 1 : 0;
  const residualLimit = cappedLimit - minimumPerRequest * normalized.length;
  const residualTotal = total - minimumPerRequest * normalized.length;
  const shares = normalized.map((request) => {
    const residualAmount = request.amount - minimumPerRequest;
    const exact = residualTotal > 0 ? residualAmount * residualLimit / residualTotal : 0;
    return {
      ...request,
      allocated: minimumPerRequest + Math.floor(exact),
      remainder: exact - Math.floor(exact),
    };
  });
  let remainder = cappedLimit - shares.reduce((sum, share) => sum + share.allocated, 0);
  shares.sort((left, right) => right.remainder - left.remainder || left.id.localeCompare(right.id));
  for (const share of shares) {
    if (remainder <= 0) break;
    share.allocated += 1;
    remainder -= 1;
  }
  return new Map(shares.map((share) => [share.id, share.allocated]));
}

function getHousingHappinessModifier(housingRatio: number): number {
  if (!Number.isFinite(housingRatio)) return 0;
  if (housingRatio >= 1) return clamp((housingRatio - 1) / 0.5 * 20, 0, 20);
  if (housingRatio <= 0.1) return -40;
  return interpolate(housingRatio, 0.1, 1, -40, 0);
}

function getAmenitiesHappinessModifier(amenityRatio: number): number {
  if (!Number.isFinite(amenityRatio)) return 0;
  return clamp((amenityRatio - 1) * 10, -10, 10);
}

function getEmploymentHappinessModifier(unemploymentRatio: number): number {
  return clamp(5 - unemploymentRatio * 40, -28, 5);
}

function getHappinessCrimePressure(happiness: number): number {
  if (happiness >= 100) return 0;
  if (happiness >= 80) return (100 - happiness) * 0.25;
  return 5 + ((80 - happiness) / 80) * 95;
}

function getJobHappinessPenalty(job: JobKind): number {
  if (job === "unemployed") return -25;
  if (job === "criminal") return -18;
  return 0;
}

function getStabilityHappinessModifier(stability: number): number {
  if (stability < 50) return -(50 - stability) * 0.3;
  if (stability > 75) return Math.min(5, (stability - 75) * 0.08);
  return 0;
}

function getStabilityProductionMultiplier(stability: number): number {
  if (stability <= 50) return interpolate(stability, 0, 50, 0.35, 1);
  return interpolate(stability, 50, 100, 1, 1.25);
}

function calculateStabilityValue(
  happiness: number,
  crime: number,
  housingRatio: number,
  amenityRatio: number,
  unemploymentRatio: number,
  highHappinessStability: number,
  modifiers: PlanetModifier[],
): number {
  const housingShortfall = clamp(1 - housingRatio, 0, 1);
  const amenityShortfall = clamp(1 - amenityRatio, 0, 1);
  const lowHappinessPressure = clamp((55 - happiness) / 55, 0, 1);
  const base = 58
    + highHappinessStability * 0.6
    - crime * 0.55
    - housingShortfall * 34
    - amenityShortfall * 34
    - unemploymentRatio * 24
    - lowHappinessPressure * 24;
  return clamp(applyModifiers(base, modifiers, "stability"), 0, 100);
}

function mergePopGroup(groups: PopGroup[], next: PopGroup): void {
  const existing = groups.find((group) => (
    group.job === next.job
    && group.class === next.class
    && group.speciesId === next.speciesId
    && group.habitability === next.habitability
    && group.happiness === next.happiness
  ));
  if (existing) {
    existing.population += next.population;
    return;
  }
  groups.push({ ...next });
}

export function calculatePlanetEconomy(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetEconomySummary {
  if (!state.isHabited) return createEmptyPlanetEconomySummary();

  const activeModifiers = getActiveModifiers(state, externalModifiers);
  const capacity = emptyJobCapacity();
  const built = state.builtDistricts;
  let housing = built.city * 1_600_000_000;

  addJobCapacity(capacity, "farmer", built.agriculture * 1_000_000_000, activeModifiers);
  addJobCapacity(capacity, "miner", built.mining * 1_000_000_000, activeModifiers);
  addJobCapacity(capacity, "technician", built.generator * 1_000_000_000, activeModifiers);
  addJobCapacity(capacity, "clerk", built.city * 100_000_000, activeModifiers);

  for (const subDistrict of state.urbanSubDistricts) {
    switch (subDistrict.kind) {
      case "residential":
        housing += built.city * 1_100_000_000;
        addJobCapacity(capacity, "clerk", built.city * 100_000_000, activeModifiers);
        break;
      case "researchCampus":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "researcher", built.city * 500_000_000, activeModifiers);
        break;
      case "mixedIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "artisan", built.city * 250_000_000, activeModifiers);
        addJobCapacity(capacity, "metallurgist", built.city * 250_000_000, activeModifiers);
        break;
      case "civilianIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "artisan", built.city * 500_000_000, activeModifiers);
        break;
      case "heavyIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "metallurgist", built.city * 500_000_000, activeModifiers);
        break;
      default:
        break;
    }

    for (const building of subDistrict.buildings) {
      housing += applyBuildingEffect(building, capacity, built, activeModifiers);
    }
  }

  for (const building of state.buildings.city) {
    housing += applyBuildingEffect(building, capacity, built, activeModifiers);
  }
  for (const building of state.buildings.generator) {
    applyBuildingEffect(building, capacity, built, activeModifiers);
  }
  for (const building of state.buildings.mining) {
    applyBuildingEffect(building, capacity, built, activeModifiers);
  }
  for (const building of state.buildings.agriculture) {
    applyBuildingEffect(building, capacity, built, activeModifiers);
  }
  const defenseState = normalizePlanetDefenseState(state.defense);
  const activeDefenseBuildings = getActivePlanetDefenseBuildings({ ...state, defense: defenseState });
  for (const building of activeDefenseBuildings) {
    const jobs = PLANET_DEFENSE_BUILDING_DEFINITIONS[building.kind].jobs?.[building.level] ?? [];
    for (const effect of jobs) addJobCapacity(capacity, effect.job, effect.amount, activeModifiers);
  }

  for (const job of JOB_KINDS) {
    capacity[job] = Math.max(0, Math.floor(capacity[job]));
  }

  housing = Math.max(0, applyModifiers(housing, activeModifiers, "housing"));

  const speciesPopulations = normalizeSpeciesPopulations(state.speciesPopulations, state.population, state.isHabited);
  const totalPopulation = sumSpeciesPopulation(speciesPopulations);
  const remainingBySpecies = new Map(speciesPopulations.map((entry) => [entry.speciesId, entry.population]));
  const assignments: PopAssignment[] = [];
  let employedPopulation = 0;
  const lockedAssignedByJob = new Map<JobKind, number>();
  const normalizedJobLocks = normalizePlanetJobLocks(state.jobLocks);
  const scaledLocksBySpecies = new Map<SpeciesId, Map<string, number>>();

  for (const species of speciesPopulations) {
    const requests = normalizedJobLocks.flatMap((lock) => {
      const allocation = lock.allocations.find((candidate) => candidate.speciesId === species.speciesId);
      if (!allocation || !canSpeciesWorkJob(species.speciesId, JOB_CLASS_BY_KIND[lock.job], speciesContext)) return [];
      return [{ id: lock.job, amount: allocation.population }];
    });
    scaledLocksBySpecies.set(
      species.speciesId,
      allocateIntegerProportionally(requests, species.population),
    );
  }
  for (const lock of normalizedJobLocks) {
    const capacityRemaining = capacity[lock.job];
    if (capacityRemaining <= 0) continue;
    const requests = lock.allocations.map((allocation) => ({
      id: allocation.speciesId,
      amount: scaledLocksBySpecies.get(allocation.speciesId)?.get(lock.job) ?? 0,
    }));
    const allocated = allocateIntegerProportionally(requests, capacityRemaining);
    let jobAssigned = 0;
    for (const allocation of lock.allocations) {
      const population = Math.min(
        allocated.get(allocation.speciesId) ?? 0,
        remainingBySpecies.get(allocation.speciesId) ?? 0,
      );
      if (population <= 0) continue;
      assignments.push({
        job: lock.job,
        class: JOB_CLASS_BY_KIND[lock.job],
        speciesId: allocation.speciesId,
        population,
      });
      remainingBySpecies.set(
        allocation.speciesId,
        (remainingBySpecies.get(allocation.speciesId) ?? 0) - population,
      );
      jobAssigned += population;
      employedPopulation += population;
    }
    lockedAssignedByJob.set(lock.job, jobAssigned);
  }

  for (const job of JOB_FILL_ORDER) {
    let capacityRemaining = capacity[job] - (lockedAssignedByJob.get(job) ?? 0);
    if (capacityRemaining <= 0) continue;
    const jobClass = JOB_CLASS_BY_KIND[job];
    for (const species of speciesPopulations) {
      if (capacityRemaining <= 0) break;
      if (!canSpeciesWorkJob(species.speciesId, jobClass, speciesContext)) continue;
      const available = remainingBySpecies.get(species.speciesId) ?? 0;
      const population = Math.min(available, capacityRemaining);
      if (population <= 0) continue;
      assignments.push({ job, class: jobClass, speciesId: species.speciesId, population });
      remainingBySpecies.set(species.speciesId, available - population);
      capacityRemaining -= population;
      employedPopulation += population;
    }
  }

  let unemployedPopulation = 0;
  for (const species of speciesPopulations) {
    const population = Math.max(0, remainingBySpecies.get(species.speciesId) ?? 0);
    if (population <= 0) continue;
    assignments.push({ job: "unemployed", class: "lower", speciesId: species.speciesId, population });
    unemployedPopulation += population;
  }
  capacity.unemployed = unemployedPopulation;

  const housingNeedPopulation = getSpeciesHousingNeedPopulation(speciesPopulations, speciesContext);
  const housingRatio = housingNeedPopulation > 0 ? housing / housingNeedPopulation : 1;
  const sharedHousingHappiness = getHousingHappinessModifier(housingRatio);
  const calculateAssignmentEffects = (sourceAssignments: PopAssignment[]) => {
    let assignmentAmenities = 0;
    let assignmentCrimeReduction = 0;
    for (const assignment of sourceAssignments) {
      if (assignment.job === "unemployed") continue;
      const habitability = getEffectiveSpeciesHabitability(state, assignment.speciesId, speciesContext);
      const productionMultiplier = getHabitabilityProductionMultiplier(habitability);
      assignmentAmenities += getJobAmenityEffect(
        assignment.job,
        assignment.speciesId,
        assignment.population,
        activeModifiers,
        productionMultiplier,
        speciesContext,
      );
      assignmentCrimeReduction += getJobCrimeReductionEffect(assignment.job, assignment.population, productionMultiplier);
    }
    return {
      amenities: applyModifiers(assignmentAmenities, activeModifiers, "amenities"),
      crimeReduction: assignmentCrimeReduction,
    };
  };

  let { amenities, crimeReduction } = calculateAssignmentEffects(assignments);
  const amenityNeed = getAmenityNeed(totalPopulation);
  const amenityRatio = amenityNeed > 0 ? amenities / amenityNeed : 1;
  const sharedAmenitiesHappiness = getAmenitiesHappinessModifier(amenityRatio);
  let unemploymentRatio = totalPopulation > 0 ? unemployedPopulation / totalPopulation : 0;
  let sharedEmploymentHappiness = getEmploymentHappinessModifier(unemploymentRatio);

  const buildSocialMetrics = (sourceAssignments: PopAssignment[], stabilityHappinessModifier = 0) => {
    const groups: PopGroup[] = [];
    let weightedHappiness = 0;
    let weightedCrimePressure = 0;
    let weightedHighHappinessStability = 0;

    for (const assignment of sourceAssignments) {
      const habitability = getEffectiveSpeciesHabitability(state, assignment.speciesId, speciesContext);
      const speciesEffects = getContextEffects(speciesContext, assignment.speciesId);
      const happiness = clamp(Math.round(applyModifiers(
        50
          + getHabitabilityHappinessModifier(habitability)
          + sharedHousingHappiness
          + sharedAmenitiesHappiness
          + sharedEmploymentHappiness
          + stabilityHappinessModifier
          + getJobHappinessPenalty(assignment.job),
        activeModifiers,
        "happiness",
      ) + speciesEffects.happinessAdd), 0, 100);
      const speciesName = getContextSpeciesName(speciesContext, assignment.speciesId);
      mergePopGroup(groups, {
        job: assignment.job,
        class: assignment.class,
        speciesId: assignment.speciesId,
        speciesName,
        habitability,
        happiness,
        population: assignment.population,
      });
      weightedHappiness += happiness * assignment.population;
      weightedCrimePressure += Math.max(0, getHappinessCrimePressure(happiness) + speciesEffects.crimeAdd) * assignment.population;
      weightedHighHappinessStability += (Math.max(0, happiness - 80) / 20 * 15 + speciesEffects.stabilityAdd) * assignment.population;
    }

    return {
      popGroups: groups,
      happiness: totalPopulation > 0 ? weightedHappiness / totalPopulation : 50,
      rawCrime: totalPopulation > 0 ? weightedCrimePressure / totalPopulation : 0,
      highHappinessStability: totalPopulation > 0 ? weightedHighHappinessStability / totalPopulation : 0,
    };
  };

  const preliminaryMetrics = buildSocialMetrics(assignments);
  const preliminaryCrime = clamp(applyModifiers(preliminaryMetrics.rawCrime - crimeReduction, activeModifiers, "crime"), 0, 100);
  const criminalJobCapacity = Math.floor(totalPopulation * (preliminaryCrime / 100) * CRIMINAL_JOB_POPULATION_SHARE_AT_MAX_CRIME);
  let criminalPopulation = 0;
  let criminalPopulationRemaining = Math.min(unemployedPopulation, criminalJobCapacity);
  if (criminalPopulationRemaining > 0) {
    for (const assignment of assignments) {
      if (assignment.job !== "unemployed" || criminalPopulationRemaining <= 0) continue;
      const converted = Math.min(assignment.population, criminalPopulationRemaining);
      assignment.population -= converted;
      criminalPopulationRemaining -= converted;
      criminalPopulation += converted;
      assignments.push({ job: "criminal", class: "lower", speciesId: assignment.speciesId, population: converted });
    }
    for (let index = assignments.length - 1; index >= 0; index -= 1) {
      if (assignments[index].population <= 0) assignments.splice(index, 1);
    }
    unemployedPopulation -= criminalPopulation;
    employedPopulation += criminalPopulation;
  }
  capacity.criminal = criminalJobCapacity;
  capacity.unemployed = unemployedPopulation;
  unemploymentRatio = totalPopulation > 0 ? unemployedPopulation / totalPopulation : 0;
  sharedEmploymentHappiness = getEmploymentHappinessModifier(unemploymentRatio);
  ({ amenities, crimeReduction } = calculateAssignmentEffects(assignments));

  let metrics = buildSocialMetrics(assignments);
  let happiness = metrics.happiness;
  let crime = clamp(applyModifiers(metrics.rawCrime - crimeReduction, activeModifiers, "crime"), 0, 100);
  let highHappinessStability = metrics.highHappinessStability;
  let stability = calculateStabilityValue(
    happiness,
    crime,
    housingRatio,
    amenityRatio,
    unemploymentRatio,
    highHappinessStability,
    activeModifiers,
  );
  const stabilityHappinessModifier = getStabilityHappinessModifier(stability);
  if (Math.abs(stabilityHappinessModifier) > 0.0001) {
    metrics = buildSocialMetrics(assignments, stabilityHappinessModifier);
    happiness = metrics.happiness;
    crime = clamp(applyModifiers(metrics.rawCrime - crimeReduction, activeModifiers, "crime"), 0, 100);
    highHappinessStability = metrics.highHappinessStability;
    stability = calculateStabilityValue(
      happiness,
      crime,
      housingRatio,
      amenityRatio,
      unemploymentRatio,
      highHappinessStability,
      activeModifiers,
    );
  }
  const popGroups = metrics.popGroups;
  const stabilityProductionMultiplier = getStabilityProductionMultiplier(stability);

  const production = createEmptyResourceCounts();
  const upkeep = createEmptyResourceCounts();
  addResource(
    upkeep,
    "food",
    defenseState.stationedArmies / PEOPLE_PER_MONTHLY_UNIT * POP_FOOD_UPKEEP_PER_UNIT,
  );

  for (const group of popGroups) {
    const habitabilityProductionMultiplier = getHabitabilityProductionMultiplier(group.habitability);
    const habitabilityUpkeepMultiplier = getHabitabilityUpkeepMultiplier(group.habitability);
    if (group.job !== "unemployed") {
      applyJobResourceEffect(
        production,
        upkeep,
        group.job,
        group.class,
        group.speciesId,
        group.population,
        activeModifiers,
        habitabilityProductionMultiplier * stabilityProductionMultiplier,
        habitabilityUpkeepMultiplier,
        speciesContext,
      );
      applyGoodsUpkeep(upkeep, group.class, group.speciesId, group.population, activeModifiers, habitabilityUpkeepMultiplier, undefined, speciesContext);
    } else {
      applyGoodsUpkeep(
        upkeep,
        group.class,
        group.speciesId,
        group.population,
        activeModifiers,
        habitabilityUpkeepMultiplier,
        UNEMPLOYED_GOODS_UPKEEP_PER_UNIT,
        speciesContext,
      );
    }
  }

  for (const species of speciesPopulations) {
    const habitability = getEffectiveSpeciesHabitability(state, species.speciesId, speciesContext);
    addResource(upkeep, "food", applyModifiers(
      (species.population / PEOPLE_PER_MONTHLY_UNIT)
        * POP_FOOD_UPKEEP_PER_UNIT
        * getHabitabilityUpkeepMultiplier(habitability),
      activeModifiers,
      "popUpkeep:food",
    ));
  }

  const applyDirectBuildingUpkeep = (building: PlanetBuildingSlot): void => {
    const buildingKind = getPlanetBuildingKind(building);
    if (!buildingKind || !isPlanetBuildingEnabled(building)) return;
    const buildingUpkeep = getBuildingUpkeep(buildingKind, getPlanetBuildingLevel(building));
    for (const resource of RESOURCE_KINDS) addResource(upkeep, resource, buildingUpkeep[resource]);
  };
  for (const building of Object.values(state.buildings).flat()) applyDirectBuildingUpkeep(building);
  for (const subDistrict of state.urbanSubDistricts) {
    for (const building of subDistrict.buildings) applyDirectBuildingUpkeep(building);
  }
  for (const building of activeDefenseBuildings) {
    const buildingUpkeep = PLANET_DEFENSE_BUILDING_DEFINITIONS[building.kind].levels[building.level].upkeep;
    for (const resource of RESOURCE_KINDS) addResource(upkeep, resource, buildingUpkeep[resource]);
  }

  const net = createEmptyResourceCounts();
  const deficit = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) {
    net[resource] = production[resource] - upkeep[resource];
    deficit[resource] = Math.max(0, -net[resource]);
  }

  const summaryWithoutDemographics: Omit<
    PlanetEconomySummary,
    "populationGrowth" | "populationDecline" | "migration"
  > = {
    production,
    upkeep,
    net,
    deficit,
    jobCapacity: capacity,
    popGroups,
    employedPopulation,
    unemployedPopulation,
    housing: Math.max(0, Math.floor(housing)),
    amenities,
    happiness,
    crime,
    stability,
    activeModifiers,
  };

  return {
    ...summaryWithoutDemographics,
    populationGrowth: calculatePopulationGrowth(
      state,
      summaryWithoutDemographics,
      districtLimits,
      externalModifiers,
      speciesContext,
    ),
    populationDecline: calculateFamineProjection({
      population: state.population,
      groups: popGroups,
      foodProduction: production.food,
      foodUpkeep: upkeep.food,
      shortageProgress: speciesContext?.foodShortageProgress ?? 0,
    }),
    migration: calculatePlanetMigrationSummary(state, summaryWithoutDemographics),
  };
}

type PlanetEconomyDemographicInputs = Omit<
  PlanetEconomySummary,
  "populationGrowth" | "populationDecline" | "migration"
>;

const PRODUCTIVE_JOB_KINDS = JOB_KINDS.filter(
  (job): job is Exclude<JobKind, "criminal" | "unemployed"> => job !== "criminal" && job !== "unemployed",
);

export function calculateVacantProductiveJobs(economy: Pick<PlanetEconomySummary, "jobCapacity" | "popGroups">): number {
  const occupiedByJob = new Map<JobKind, number>();
  for (const group of economy.popGroups) {
    if (group.job === "criminal" || group.job === "unemployed") continue;
    occupiedByJob.set(group.job, (occupiedByJob.get(group.job) ?? 0) + group.population);
  }
  return PRODUCTIVE_JOB_KINDS.reduce(
    (total, job) => total + Math.max(0, economy.jobCapacity[job] - (occupiedByJob.get(job) ?? 0)),
    0,
  );
}

function getPotentialBuildingJobs(
  area: BuildingSlotArea,
  limits: DistrictCounts,
  subDistrictKind?: UrbanSubDistrictKind,
): number {
  let best = 0;
  for (const definition of Object.values(BUILDING_DEFINITIONS)) {
    if (definition.kind === "planetaryCapital") continue;
    const compatible = definition.compatibility.some((rule) => (
      rule.area === area
      && (
        area !== "urbanSubDistrict"
        || !rule.subDistrictKinds
        || (subDistrictKind !== undefined && rule.subDistrictKinds.includes(subDistrictKind))
      )
    ));
    if (!compatible) continue;
    const jobs = (definition.jobs ?? []).reduce((total, effect) => {
      if (effect.job === "criminal" || effect.job === "unemployed") return total;
      return total + effect.amount * (effect.perDistrict ? limits[effect.perDistrict] : 1);
    }, 0);
    best = Math.max(best, jobs);
  }
  return best;
}

function calculatePotentialProductiveJobs(state: PlanetState, limits: DistrictCounts): number {
  let total = limits.agriculture * 1_000_000_000
    + limits.mining * 1_000_000_000
    + limits.generator * 1_000_000_000
    + limits.city * 100_000_000;

  const citySlots = Math.max(1, state.buildings.city.length);
  total += 900_000_000;
  total += Math.max(0, citySlots - 1) * getPotentialBuildingJobs("city", limits);
  for (const area of ["generator", "mining", "agriculture"] as DistrictKind[]) {
    total += state.buildings[area].length * getPotentialBuildingJobs(area, limits);
  }

  const subDistrictSlots = state.urbanSubDistricts[0]?.buildings.length ?? 3;
  for (let index = 0; index < state.urbanSubDistricts.length; index += 1) {
    let best = 0;
    for (const kind of URBAN_SUB_DISTRICT_KINDS) {
      let baseJobs = 0;
      if (kind === "residential") baseJobs = limits.city * 100_000_000;
      if (kind === "researchCampus") baseJobs = limits.city * 500_000_000;
      if (kind === "mixedIndustry" || kind === "civilianIndustry" || kind === "heavyIndustry") {
        baseJobs = limits.city * 500_000_000;
      }
      best = Math.max(
        best,
        baseJobs + subDistrictSlots * getPotentialBuildingJobs("urbanSubDistrict", limits, kind),
      );
    }
    total += best;
  }
  return Math.max(0, total);
}

function calculatePotentialHousing(state: PlanetState, limits: DistrictCounts): number {
  const citySlots = Math.max(1, state.buildings.city.length);
  const cityHousing = limits.city * 1_600_000_000
    + Math.max(0, citySlots - 1) * (BUILDING_DEFINITIONS.housingComplex.housing ?? 0);
  const subDistrictSlots = state.urbanSubDistricts[0]?.buildings.length ?? 3;
  const residentialHousing = limits.city * 1_100_000_000
    + subDistrictSlots * (BUILDING_DEFINITIONS.housingComplex.housing ?? 0);
  return Math.max(0, cityHousing + state.urbanSubDistricts.length * residentialHousing);
}

export function calculatePlanetCapacity(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  currentEconomy?: Pick<PlanetEconomySummary, "jobCapacity" | "popGroups">,
): number {
  if (!state.isHabited) return 0;
  const limits = districtLimits ?? state.builtDistricts;
  const potentialJobs = calculatePotentialProductiveJobs(state, limits);
  const potentialHousing = calculatePotentialHousing(state, limits);
  const economy = currentEconomy ?? state.economy;
  const vacantJobs = economy ? calculateVacantProductiveJobs(economy) : 0;
  const modifiedCapacity = applyModifiers(
    calculateBlendedPlanetCapacity(potentialJobs, potentialHousing, vacantJobs),
    getActiveModifiers(state, externalModifiers),
    "planetCapacity",
  );
  return Math.max(MIN_HABITED_POPULATION, Math.floor(modifiedCapacity));
}

export function calculatePopulationGrowth(
  state: PlanetState,
  economy: PlanetEconomyDemographicInputs,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetPopulationGrowth {
  if (!state.isHabited || state.population <= 0) return createEmptyPopulationGrowth();

  const capacity = calculatePlanetCapacity(state, districtLimits, externalModifiers, economy);
  const capacityPressure = capacity > 0 ? state.population / capacity : 1;
  const speciesPopulations = normalizeSpeciesPopulations(state.speciesPopulations, state.population, state.isHabited);
  const housingNeedPopulation = getSpeciesHousingNeedPopulation(speciesPopulations, speciesContext);
  const housingRatio = housingNeedPopulation > 0 ? economy.housing / housingNeedPopulation : 1;
  const amenityNeed = getAmenityNeed(state.population);
  const amenityRatio = amenityNeed > 0 ? economy.amenities / amenityNeed : 1;
  const quality = calculatePopulationQuality({
    housingRatio,
    amenityRatio,
    stability: economy.stability,
    crime: economy.crime,
  });
  const capacityMultiplier = calculatePopulationCapacityMultiplier(capacityPressure);
  const modifierMultiplier = Math.max(
    0,
    getModifierMultiplier(getActiveModifiers(state, externalModifiers), "populationGrowth"),
  );
  const speciesMultiplier = Math.max(0, getWeightedSpeciesGrowthMultiplier(state.speciesPopulations, speciesContext));
  const factors: PlanetPopulationGrowthFactors = {
    ...quality.factors,
    qualityOfLifeMultiplier: quality.multiplier,
    capacityMultiplier,
    modifierMultiplier,
    speciesMultiplier,
  };
  const ratePerWeek = calculateWeeklyNaturalGrowthRate(
    capacityMultiplier,
    quality.multiplier,
    modifierMultiplier,
    speciesMultiplier,
  );
  const netPerWeek = Math.max(0, Math.round(state.population * ratePerWeek));
  const projectedPopulations = applyPopulationDeltaToSpecies(speciesPopulations, netPerWeek, speciesContext);
  const projectedBySpecies = new Map(projectedPopulations.map((entry) => [entry.speciesId, entry.population]));
  const currentBySpecies = new Map(speciesPopulations.map((entry) => [entry.speciesId, entry.population]));
  const speciesIds = new Set([...currentBySpecies.keys(), ...projectedBySpecies.keys()]);
  const speciesChanges = [...speciesIds].map((speciesId) => ({
    speciesId,
    deltaPerWeek: (projectedBySpecies.get(speciesId) ?? 0) - (currentBySpecies.get(speciesId) ?? 0),
  }));

  return {
    capacity,
    capacityPressure,
    ratePerWeek,
    netPerWeek,
    speciesChanges,
    factors,
  };
}

function calculatePlanetMigrationSummary(
  state: PlanetState,
  economy: PlanetEconomyDemographicInputs,
): PlanetMigrationSummary {
  if (!state.isHabited) return createEmptyMigrationSummary();
  const amenityNeed = getAmenityNeed(state.population);
  const calculated = calculateMigrationAttractiveness({
    happiness: economy.happiness,
    stability: economy.stability,
    crime: economy.crime,
    amenityRatio: amenityNeed > 0 ? economy.amenities / amenityNeed : 1,
    vacantProductiveJobs: calculateVacantProductiveJobs(economy),
    population: state.population,
  });
  const activeModifiers = getActiveModifiers(state);
  const attractiveness = clamp(
    applyModifiers(calculated.attractiveness, activeModifiers, "migrationAttractiveness"),
    0,
    100,
  );
  const capital = state.buildings.city.find((building) => getPlanetBuildingKind(building) === "planetaryCapital");
  const monthlyIntakeCapacity = Math.max(0, Math.round(applyModifiers(
    calculateMigrationIntakeCapacity(
      capital ? getPlanetBuildingLevel(capital) : 1,
      state.builtDistricts.city,
    ),
    activeModifiers,
    "migrationIntakeCapacity",
  )));
  const ledger = state.populationMigration ?? createEmptyMigrationLedger();
  return {
    attractiveness,
    factors: calculated.factors,
    monthlyIntakeCapacity,
    lastMonthIntakeCapacity: ledger.intakeCapacity,
    lastMonthIndex: ledger.monthIndex,
    lastMonthInbound: ledger.inbound,
    lastMonthOutbound: ledger.outbound,
    lastMonthNet: ledger.inbound - ledger.outbound,
  };
}

export function recalculatePlanetStateEconomy(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetState {
  const speciesPopulations = normalizeSpeciesPopulations(
    state.speciesPopulations,
    state.population,
    state.isHabited,
  );
  const populationBySpecies = new Map(speciesPopulations.map((entry) => [entry.speciesId, entry.population]));
  const defense = normalizePlanetDefenseState(state.defense);
  defense.traineeRemainders = defense.traineeRemainders.filter((entry) => (
    entry.population > 0
    && entry.population <= (populationBySpecies.get(entry.speciesId) ?? 0)
  ));
  const jobLocks = normalizePlanetJobLocks(state.jobLocks)
    .filter((lock) => lock.job !== "trainee");
  if (defense.traineeRemainders.length > 0) {
    jobLocks.push({
      job: "trainee",
      allocations: defense.traineeRemainders.map((entry) => ({ ...entry })),
    });
  }
  const normalized = {
    ...state,
    population: sumSpeciesPopulation(speciesPopulations),
    speciesPopulations,
    features: normalizePlanetFeatures(state.features),
    builtDistricts: cloneDistricts(state.builtDistricts),
    buildings: normalizeBuildings(state.buildings),
    urbanSubDistricts: normalizeUrbanSubDistricts(state.urbanSubDistricts),
    constructionQueue: normalizeConstructionQueue(state.constructionQueue),
    defense,
    modifiers: normalizeModifiers(state.modifiers),
    jobLocks,
    populationMigration: {
      monthIndex: Math.max(0, Math.floor(state.populationMigration?.monthIndex ?? 0)),
      inbound: Math.max(0, Math.floor(state.populationMigration?.inbound ?? 0)),
      outbound: Math.max(0, Math.floor(state.populationMigration?.outbound ?? 0)),
      intakeCapacity: Math.max(0, Math.floor(state.populationMigration?.intakeCapacity ?? 0)),
    },
  };
  return {
    ...normalized,
    economy: calculatePlanetEconomy(normalized, districtLimits, externalModifiers, speciesContext),
  };
}

export function applyPopulationGrowth(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  weeks = 1,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetState {
  let next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers, speciesContext);
  if (!next.isHabited || weeks <= 0) return next;

  for (let i = 0; i < weeks; i++) {
    const growth = next.economy.populationGrowth.netPerWeek;
    const speciesPopulations = applyPopulationDeltaToSpecies(next.speciesPopulations, growth, speciesContext);
    next = recalculatePlanetStateEconomy({
      ...next,
      population: sumSpeciesPopulation(speciesPopulations),
      speciesPopulations,
    }, districtLimits, externalModifiers, speciesContext);
  }

  return next;
}

export function applyPopulationGrowthFraction(
  state: PlanetState,
  districtLimits: DistrictCounts | undefined,
  weekFraction: number,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetState {
  const next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers, speciesContext);
  if (!next.isHabited || weekFraction <= 0) return next;

  const growth = Math.round(next.economy.populationGrowth.netPerWeek * weekFraction);
  const speciesPopulations = applyPopulationDeltaToSpecies(next.speciesPopulations, growth, speciesContext);
  return recalculatePlanetStateEconomy({
    ...next,
    population: sumSpeciesPopulation(speciesPopulations),
    speciesPopulations,
  }, districtLimits, externalModifiers, speciesContext);
}

export function applyPopulationDeltaToSpecies(
  populations: SpeciesPopulation[],
  delta: number,
  speciesContext?: PlanetEconomySpeciesContext,
): SpeciesPopulation[] {
  if (delta === 0 || populations.length === 0) return populations.map((entry) => cloneSpeciesPopulation(entry));
  const total = sumSpeciesPopulation(populations);
  if (total <= 0) {
    return delta > 0
      ? [{ speciesId: HUMAN_SPECIES_ID, population: delta }]
      : [];
  }

  const targetTotal = Math.max(0, total + delta);
  const growthWeights = delta > 0
    ? populations.map((entry) => entry.population * getContextEffects(speciesContext, entry.speciesId).growthMultiplier)
    : populations.map((entry) => entry.population);
  const totalWeight = growthWeights.reduce((sum, weight) => sum + Math.max(0, weight), 0);
  let runningTotal = 0;
  const next = populations.map((entry, index) => {
    const weight = totalWeight > 0 ? Math.max(0, growthWeights[index]) / totalWeight : entry.population / total;
    const population = Math.max(0, Math.round(targetTotal * weight));
    runningTotal += population;
    return { speciesId: entry.speciesId, population };
  });

  let remainder = targetTotal - runningTotal;
  for (let i = 0; remainder !== 0 && i < next.length; i++) {
    const step = remainder > 0 ? 1 : -1;
    if (step < 0 && next[i].population <= 0) continue;
    next[i].population += step;
    remainder -= step;
  }

  return next.filter((entry) => entry.population > 0);
}

function createConstructionId(prefix: string, parts: Array<string | number | undefined>): string {
  return `${prefix}-${parts.filter((part) => part !== undefined).join("-")}-${Date.now().toString(36)}`;
}

export function createDistrictConstructionQueueItem(
  districtKind: DistrictKind,
  id = createConstructionId("district", [districtKind]),
): PlanetConstructionQueueItem {
  const cost = { ...DISTRICT_COSTS[districtKind] };
  return {
    id,
    kind: "district",
    label: `${districtKind[0].toUpperCase()}${districtKind.slice(1)} District`,
    cost,
    mineralCost: cost.minerals,
    totalDays: DISTRICT_BUILD_DAYS[districtKind],
    remainingDays: DISTRICT_BUILD_DAYS[districtKind],
    districtKind,
  };
}

export function createBuildingConstructionQueueItem(
  buildingKind: BuildingKind,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
  id = createConstructionId("building", [buildingKind, area, subDistrictIndex, slotIndex]),
): PlanetConstructionQueueItem {
  const cost = getBuildingCost(buildingKind, 1);
  return {
    id,
    kind: "building",
    label: BUILDING_LABELS[buildingKind],
    cost,
    mineralCost: cost.minerals,
    totalDays: getBuildingBuildDays(buildingKind, 1),
    remainingDays: getBuildingBuildDays(buildingKind, 1),
    buildingKind,
    targetLevel: 1,
    area,
    slotIndex,
    subDistrictIndex,
  };
}

export function createBuildingUpgradeConstructionQueueItem(
  buildingKind: BuildingKind,
  currentLevel: number,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
  id = createConstructionId("building-upgrade", [buildingKind, area, subDistrictIndex, slotIndex, currentLevel + 1]),
): PlanetConstructionQueueItem {
  const targetLevel = clampBuildingLevel(currentLevel + 1);
  const totalDays = getBuildingUpgradeBuildDays(buildingKind, currentLevel);
  const cost = getBuildingUpgradeCost(buildingKind, currentLevel);
  return {
    id,
    kind: "buildingUpgrade",
    label: `${getBuildingDisplayLabel(buildingKind, targetLevel)} (Level ${targetLevel})`,
    cost,
    mineralCost: cost.minerals,
    totalDays,
    remainingDays: totalDays,
    buildingKind,
    targetLevel,
    area,
    slotIndex,
    subDistrictIndex,
  };
}

export function getQueuedDistrictCount(state: PlanetState, districtKind: DistrictKind): number {
  return state.constructionQueue.filter((item) => item.kind === "district" && item.districtKind === districtKind).length;
}

export function hasQueuedBuildingTarget(
  state: PlanetState,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): boolean {
  return state.constructionQueue.some((item) => (
    (item.kind === "building" || item.kind === "buildingUpgrade")
    && item.area === area
    && item.slotIndex === slotIndex
    && item.subDistrictIndex === subDistrictIndex
  ));
}

function getSubDistrictKindForItem(
  state: PlanetState,
  item: PlanetConstructionQueueItem,
): UrbanSubDistrictKind | undefined {
  if (item.area !== "urbanSubDistrict" || item.subDistrictIndex === undefined) return undefined;
  return state.urbanSubDistricts[item.subDistrictIndex]?.kind;
}

function canCompleteConstructionItem(
  state: PlanetState,
  item: PlanetConstructionQueueItem,
  districtLimits: DistrictCounts,
): boolean {
  if (item.kind === "district") {
    return Boolean(item.districtKind && state.builtDistricts[item.districtKind] < districtLimits[item.districtKind]);
  }
  if (item.kind === "defenseBuilding" || item.kind === "defenseBuildingUpgrade") {
    if (!item.defenseBuildingKind || !item.defenseSection || item.slotIndex === undefined) return false;
    const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[item.defenseBuildingKind];
    if (!definition?.sections.includes(item.defenseSection)) return false;
    const unlocked = item.defenseSection === "defense"
      ? getUnlockedPlanetDefenseSlots(state)
      : getUnlockedPlanetShipyardSlots(state);
    const slots = item.defenseSection === "defense"
      ? state.defense.defenseSlots
      : state.defense.shipyardSlots;
    if (item.slotIndex < 0 || item.slotIndex >= slots.length || item.slotIndex >= unlocked) return false;
    const existing = slots[item.slotIndex];
    if (item.kind === "defenseBuildingUpgrade") {
      return existing?.kind === item.defenseBuildingKind
        && existing.level + 1 === item.targetLevel
        && (item.targetLevel ?? 1) <= definition.maxLevel;
    }
    if (existing) return false;
    if (definition.unique) {
      const allSlots = [...state.defense.defenseSlots, ...state.defense.shipyardSlots];
      if (allSlots.some((building) => building?.kind === item.defenseBuildingKind)) return false;
    }
    return true;
  }
  if (!item.buildingKind || !item.area || item.slotIndex === undefined) return false;
  if (item.area === "urbanSubDistrict") {
    if (item.subDistrictIndex === undefined) return false;
    const subDistrict = state.urbanSubDistricts[item.subDistrictIndex];
    if (!subDistrict || item.slotIndex < 0 || item.slotIndex >= subDistrict.buildings.length) return false;
    const existing = subDistrict.buildings[item.slotIndex];
    if (item.kind === "buildingUpgrade") {
      return getPlanetBuildingKind(existing) === item.buildingKind
        && getPlanetBuildingLevel(existing) + 1 === item.targetLevel
        && isBuildingCompatible(item.buildingKind, item.area, subDistrict.kind);
    }
    if (existing) return false;
    return item.kind === "building" && isBuildingCompatible(item.buildingKind, item.area, subDistrict.kind);
  }
  const slots = state.buildings[item.area];
  if (!slots || item.slotIndex < 0 || item.slotIndex >= slots.length) return false;
  const existing = slots[item.slotIndex];
  if (item.kind === "buildingUpgrade") {
    return getPlanetBuildingKind(existing) === item.buildingKind
      && getPlanetBuildingLevel(existing) + 1 === item.targetLevel
      && isBuildingCompatible(item.buildingKind, item.area);
  }
  if (existing) return false;
  return item.kind === "building" && isBuildingCompatible(item.buildingKind, item.area);
}

function completeConstructionItem(
  state: PlanetState,
  item: PlanetConstructionQueueItem,
): PlanetState {
  if (item.kind === "district" && item.districtKind) {
    return {
      ...state,
      builtDistricts: {
        ...state.builtDistricts,
        [item.districtKind]: state.builtDistricts[item.districtKind] + 1,
      },
    };
  }
  if (
    (item.kind === "defenseBuilding" || item.kind === "defenseBuildingUpgrade")
    && item.defenseBuildingKind
    && item.defenseSection
    && item.slotIndex !== undefined
  ) {
    const slots = item.defenseSection === "defense"
      ? state.defense.defenseSlots
      : state.defense.shipyardSlots;
    const existing = slots[item.slotIndex];
    const completed: PlanetDefenseBuildingState = {
      kind: item.defenseBuildingKind,
      level: item.targetLevel ?? 1,
      enabled: item.kind === "defenseBuildingUpgrade" ? existing?.enabled !== false : true,
    };
    return {
      ...state,
      defense: {
        ...state.defense,
        [item.defenseSection === "defense" ? "defenseSlots" : "shipyardSlots"]: slots.map(
          (building, index) => index === item.slotIndex ? completed : building,
        ),
      },
    };
  }

  if ((item.kind !== "building" && item.kind !== "buildingUpgrade") || !item.buildingKind || !item.area || item.slotIndex === undefined) return state;
  const existingBuilding = item.area === "urbanSubDistrict"
    ? item.subDistrictIndex === undefined
      ? undefined
      : state.urbanSubDistricts[item.subDistrictIndex]?.buildings[item.slotIndex]
    : state.buildings[item.area]?.[item.slotIndex];
  const completedBuilding = createPlanetBuildingState(
    item.buildingKind,
    item.targetLevel ?? 1,
    item.kind === "buildingUpgrade" ? isPlanetBuildingEnabled(existingBuilding) : true,
  );
  const jobLocks = item.buildingKind === CAPITAL_BUILDING_KIND
    && (item.targetLevel ?? 1) >= 2
    ? state.jobLocks.filter((lock) => lock.job !== "colonizer")
    : state.jobLocks;
  if (item.area === "urbanSubDistrict") {
    if (item.subDistrictIndex === undefined) return state;
    return {
      ...state,
      jobLocks,
      urbanSubDistricts: state.urbanSubDistricts.map((subDistrict, index) => (
        index === item.subDistrictIndex
          ? {
            ...subDistrict,
            buildings: subDistrict.buildings.map((building, buildingIndex) => (
              buildingIndex === item.slotIndex ? completedBuilding : building
            )),
          }
          : subDistrict
      )),
    };
  }

  return {
    ...state,
    jobLocks,
    buildings: {
      ...state.buildings,
      [item.area]: state.buildings[item.area].map((building, index) => (
        index === item.slotIndex ? completedBuilding : building
      )),
    },
  };
}

export function getConstructionSpeedMultiplier(
  state: PlanetState,
  kind?: PlanetConstructionKind,
  externalModifiers: PlanetModifier[] = [],
): number {
  const activeModifiers = getActiveModifiers(state, externalModifiers);
  const base = getModifierMultiplier(activeModifiers, "constructionSpeed");
  const typed = kind === "district"
    ? getModifierMultiplier(activeModifiers, "districtConstructionSpeed")
    : kind === "building" || kind === "buildingUpgrade" || kind === "defenseBuilding" || kind === "defenseBuildingUpgrade"
      ? getModifierMultiplier(activeModifiers, "buildingConstructionSpeed")
      : 1;
  return Math.max(0.1, base * typed);
}

export function progressPlanetConstructionQueue(
  state: PlanetState,
  elapsedDays: number,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): { state: PlanetState; changed: boolean; completed: PlanetConstructionQueueItem[] } {
  let next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers, speciesContext);
  const limits = districtLimits ?? next.builtDistricts;
  let days = Math.max(0, elapsedDays);
  const completed: PlanetConstructionQueueItem[] = [];
  let changed = false;

  while (days > 0 && next.constructionQueue.length > 0) {
    const [current, ...rest] = next.constructionQueue;
    if (
      (current.kind === "defenseBuilding" || current.kind === "defenseBuildingUpgrade")
      && !canCompleteConstructionItem(next, current, limits)
    ) break;
    const speed = getConstructionSpeedMultiplier(next, current.kind, externalModifiers);
    const workDays = days * speed;
    if (workDays < current.remainingDays) {
      current.remainingDays -= workDays;
      next = { ...next, constructionQueue: [current, ...rest] };
      changed = true;
      days = 0;
      break;
    }

    const consumedRealDays = current.remainingDays / speed;
    days = Math.max(0, days - consumedRealDays);
    const completedItem = { ...current, remainingDays: 0 };
    let withoutItem = { ...next, constructionQueue: rest };
    if (canCompleteConstructionItem(withoutItem, completedItem, limits)) {
      withoutItem = completeConstructionItem(withoutItem, completedItem);
      completed.push(completedItem);
    }
    next = recalculatePlanetStateEconomy(withoutItem, limits, externalModifiers, speciesContext);
    changed = true;
  }

  return { state: next, changed, completed };
}

export function createDefenseBuildingConstructionQueueItem(
  buildingKind: PlanetDefenseBuildingKind,
  section: PlanetDefenseSection,
  slotIndex: number,
  targetLevel = 1,
  id = createConstructionId("defense-building", [buildingKind, section, slotIndex, targetLevel]),
): PlanetConstructionQueueItem {
  const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[buildingKind];
  const level = Math.max(1, Math.min(definition.maxLevel, Math.round(targetLevel)));
  const authored = definition.levels[level];
  return {
    id,
    kind: level > 1 ? "defenseBuildingUpgrade" : "defenseBuilding",
    label: level > 1 ? `${definition.label} (Level ${level})` : definition.label,
    cost: { ...authored.cost },
    mineralCost: authored.cost.minerals,
    totalDays: authored.buildDays,
    remainingDays: authored.buildDays,
    defenseBuildingKind: buildingKind,
    defenseSection: section,
    slotIndex,
    targetLevel: level,
  };
}

export function hasQueuedDefenseBuildingTarget(
  state: PlanetState,
  section: PlanetDefenseSection,
  slotIndex: number,
): boolean {
  return state.constructionQueue.some((item) => (
    (item.kind === "defenseBuilding" || item.kind === "defenseBuildingUpgrade")
    && item.defenseSection === section
    && item.slotIndex === slotIndex
  ));
}

export function completePlanetConstructionQueueItem(
  state: PlanetState,
  queueItemId: string,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): { state: PlanetState; completed: PlanetConstructionQueueItem } | null {
  const item = state.constructionQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return null;
  const limits = districtLimits ?? state.builtDistricts;
  const withoutItem = {
    ...state,
    constructionQueue: state.constructionQueue.filter((candidate) => candidate.id !== queueItemId),
  };
  const completed = { ...item, remainingDays: 0 };
  if (!canCompleteConstructionItem(withoutItem, completed, limits)) return null;
  return {
    state: recalculatePlanetStateEconomy(
      completeConstructionItem(withoutItem, completed),
      limits,
      externalModifiers,
      speciesContext,
    ),
    completed,
  };
}

export function filterInvalidQueuedBuildingsForSubDistrictChange(
  state: PlanetState,
  subDistrictIndex: number,
  nextKind: UrbanSubDistrictKind,
): PlanetConstructionQueueItem[] {
  return state.constructionQueue.filter((item) => {
    if (
      (item.kind !== "building" && item.kind !== "buildingUpgrade")
      || item.area !== "urbanSubDistrict"
      || item.subDistrictIndex !== subDistrictIndex
    ) {
      return true;
    }
    return Boolean(item.buildingKind && isBuildingCompatible(item.buildingKind, "urbanSubDistrict", nextKind));
  });
}

export function isBuildingCompatible(
  building: BuildingKind,
  area: BuildingSlotArea,
  subDistrictKind?: UrbanSubDistrictKind,
): boolean {
  return BUILDING_DEFINITIONS[building]?.compatibility.some((rule) => {
    if (rule.area !== area) return false;
    if (area !== "urbanSubDistrict") return true;
    return Boolean(subDistrictKind && rule.subDistrictKinds?.includes(subDistrictKind));
  }) ?? false;
}

export function getCompatibleBuildings(
  area: BuildingSlotArea,
  subDistrictKind?: UrbanSubDistrictKind,
): BuildingKind[] {
  return BUILDING_KINDS.filter((building) => isBuildingCompatible(building, area, subDistrictKind));
}

export function createInitialFactionEconomyState(factionId: number, currentMonth: number): FactionEconomyState {
  return {
    factionId,
    stockpiles: cloneResourceCounts(STARTING_RESOURCE_STOCKPILES),
    crewStockpile: 0,
    monthlyDelta: createEmptyResourceCounts(),
    lastProcessedMonth: currentMonth,
    lastProcessedHour: currentMonth * 30 * 24,
  };
}
