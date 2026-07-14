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

export type { DistrictCounts, DistrictKind } from "./StarMap";
export type { SpeciesId } from "./Species";

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
  | "researcher"
  | "artisan"
  | "metallurgist"
  | "entertainer"
  | "enforcer"
  | "farmer"
  | "miner"
  | "technician"
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
  | "securityOffice";

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
}

export interface PlanetBuildingState {
  kind: BuildingKind;
  level: number;
}

export type PlanetBuildingSlot = BuildingKind | PlanetBuildingState | null;

export type PlanetConstructionKind = "district" | "building" | "buildingUpgrade";

export interface PlanetConstructionQueueItem {
  id: string;
  kind: PlanetConstructionKind;
  label: string;
  mineralCost: number;
  totalDays: number;
  remainingDays: number;
  districtKind?: DistrictKind;
  buildingKind?: BuildingKind;
  targetLevel?: number;
  area?: BuildingSlotArea;
  slotIndex?: number;
  subDistrictIndex?: number;
}

export interface PopGroup {
  job: JobKind;
  class: JobClass;
  speciesId: SpeciesId;
  speciesName: string;
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
  researcher: number;
  artisan: number;
  metallurgist: number;
  entertainer: number;
  enforcer: number;
  farmer: number;
  miner: number;
  technician: number;
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
  activeModifiers: PlanetModifier[];
}

export interface PlanetPopulationGrowthFactors {
  housing: number;
  amenities: number;
  stability: number;
  crime: number;
  employment: number;
  capacity: number;
}

export interface PlanetPopulationGrowth {
  capacity: number;
  capacityPressure: number;
  ratePerQuarter: number;
  netPerQuarter: number;
  factors: PlanetPopulationGrowthFactors;
}

export interface PlanetEconomySpeciesContext {
  species: SpeciesState[];
  rightsBySpeciesId?: Record<SpeciesId, SpeciesRights | undefined>;
}

export interface PlanetState {
  id: string;
  starId: number;
  planetIndex: number;
  isHabited: boolean;
  habitability: number | null;
  population: number;
  speciesPopulations: SpeciesPopulation[];
  features: PlanetFeatureKind[];
  builtDistricts: DistrictCounts;
  buildings: DistrictBuildingSlots;
  urbanSubDistricts: UrbanSubDistrictState[];
  constructionQueue: PlanetConstructionQueueItem[];
  modifiers: PlanetModifier[];
  economy: PlanetEconomySummary;
}

export interface FactionEconomyState {
  factionId: number;
  stockpiles: ResourceCounts;
  monthlyDelta: ResourceCounts;
  marketMonthlyDelta?: ResourceCounts;
  lastProcessedMonth: number;
  lastProcessedHour: number;
}

export interface PlanetEconomySeed {
  id: string;
  starId: number;
  planetIndex: number;
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
export const BUILDING_MAX_LEVEL = 5;
const BASE_POPULATION_GROWTH_RATE_PER_QUARTER = 0.01;
const POP_FOOD_UPKEEP_PER_UNIT = 1.1;
const UNEMPLOYED_GOODS_UPKEEP_PER_UNIT = 0.025;
const CRIMINAL_JOB_POPULATION_SHARE_AT_MAX_CRIME = 0.25;

export const DISTRICT_MINERAL_COSTS: Record<DistrictKind, number> = {
  city: 520,
  generator: 420,
  mining: 420,
  agriculture: 390,
};

export const DISTRICT_BUILD_DAYS: Record<DistrictKind, number> = {
  city: 14,
  generator: 10,
  mining: 10,
  agriculture: 9,
};

export const RESOURCE_KINDS: ResourceKind[] = ["food", "minerals", "energy", "goods", "alloys", "research"];

export const JOB_KINDS: JobKind[] = [
  "ruler",
  "administrator",
  "researcher",
  "artisan",
  "metallurgist",
  "entertainer",
  "enforcer",
  "farmer",
  "miner",
  "technician",
  "clerk",
  "criminal",
  "unemployed",
];

export const JOB_FILL_ORDER: JobKind[] = [
  "ruler",
  "administrator",
  "researcher",
  "enforcer",
  "entertainer",
  "artisan",
  "metallurgist",
  "farmer",
  "miner",
  "technician",
  "clerk",
];

export const JOB_CLASS_BY_KIND: Record<JobKind, JobClass> = {
  ruler: "upper",
  administrator: "upper",
  researcher: "middle",
  artisan: "middle",
  metallurgist: "middle",
  entertainer: "middle",
  enforcer: "middle",
  farmer: "lower",
  miner: "lower",
  technician: "lower",
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
    upkeep: { energy: 1, goods: 1.5 },
    amenities: 6,
    crimeReduction: 0.02,
  },
  administrator: {
    kind: "administrator",
    label: "Administrators",
    class: "upper",
    description: "Coordinates planetary bureaucracy, services, and strategic direction.",
    upkeep: { energy: 1, goods: 1 },
    amenities: 3,
  },
  researcher: {
    kind: "researcher",
    label: "Researchers",
    class: "middle",
    description: "Turns energy and goods into stockpiled research.",
    output: { research: 3 },
    upkeep: { energy: 2.5, goods: 1.2 },
  },
  artisan: {
    kind: "artisan",
    label: "Artisans",
    class: "middle",
    description: "Refines minerals into civilian goods.",
    output: { goods: 2.5 },
    upkeep: { minerals: 4.5, energy: 0.5 },
  },
  metallurgist: {
    kind: "metallurgist",
    label: "Metallurgists",
    class: "middle",
    description: "Refines minerals into military and industrial alloys.",
    output: { alloys: 1.6 },
    upkeep: { minerals: 5.5, energy: 0.6 },
  },
  entertainer: {
    kind: "entertainer",
    label: "Entertainers",
    class: "middle",
    description: "Provides culture, recreation, and morale services.",
    upkeep: { goods: 0.6 },
    amenities: 7,
  },
  enforcer: {
    kind: "enforcer",
    label: "Enforcers",
    class: "middle",
    description: "Maintains public order and suppresses organized crime.",
    upkeep: { energy: 0.6, goods: 0.25 },
    crimeReduction: 0.025,
  },
  farmer: {
    kind: "farmer",
    label: "Farmers",
    class: "lower",
    description: "Produces food from agricultural land and hydroponic infrastructure.",
    output: { food: 4.5 },
  },
  miner: {
    kind: "miner",
    label: "Miners",
    class: "lower",
    description: "Extracts minerals from planetary deposits.",
    output: { minerals: 4.5 },
  },
  technician: {
    kind: "technician",
    label: "Technicians",
    class: "lower",
    description: "Operates power grids, reactors, and energy collection systems.",
    output: { energy: 3.6 },
  },
  clerk: {
    kind: "clerk",
    label: "Clerks",
    class: "lower",
    description: "Handles services, commerce, and local administration.",
    output: { energy: 0.6 },
    amenities: 1.5,
  },
  criminal: {
    kind: "criminal",
    label: "Criminals",
    class: "lower",
    description: "Organized illicit work that consumes supplies and intensifies local crime.",
    upkeep: { energy: 0.15, goods: 0.08 },
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

export const BUILDING_DEFINITIONS: Record<BuildingKind, BuildingDefinition> = {
  planetaryCapital: {
    kind: "planetaryCapital",
    label: "Planetary Capital",
    initials: "CAP",
    description: "The seat of planetary government. Always anchors the first city slot, providing baseline rulers, entertainers, and enforcers so a young colony can stay stable while you build out its economy.",
    mineralCost: 0,
    buildDays: 1,
    compatibility: [{ area: "city" }],
    autoPlaced: true,
    jobs: [
      { job: "ruler", amount: 200_000_000 },
      { job: "entertainer", amount: 400_000_000 },
      { job: "enforcer", amount: 300_000_000 },
    ],
  },
  housingComplex: {
    kind: "housingComplex",
    label: "Housing Complex",
    initials: "HC",
    description: "Dense residential towers and life-support extensions that expand planetary housing.",
    mineralCost: 220,
    buildDays: 4,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    housing: 1_200_000_000,
  },
  administrativeComplex: {
    kind: "administrativeComplex",
    label: "Administrative Complex",
    initials: "AD",
    description: "Offices, courts, and planning bureaus that create administrator jobs.",
    mineralCost: 420,
    buildDays: 8,
    compatibility: [{ area: "city" }],
    jobs: [{ job: "administrator", amount: 300_000_000 }],
  },
  researchLabs: {
    kind: "researchLabs",
    label: "Research Labs",
    initials: "RL",
    description: "Laboratory campuses that create researcher jobs.",
    mineralCost: 620,
    buildDays: 14,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["researchCampus"] }],
    jobs: [{ job: "researcher", amount: 500_000_000 }],
  },
  civilianFabricators: {
    kind: "civilianFabricators",
    label: "Civilian Fabricators",
    initials: "CF",
    description: "Factory halls that create artisan jobs for civilian goods production.",
    mineralCost: 520,
    buildDays: 12,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "civilianIndustry"] }],
    jobs: [{ job: "artisan", amount: 500_000_000 }],
  },
  alloyFoundries: {
    kind: "alloyFoundries",
    label: "Alloy Foundries",
    initials: "AF",
    description: "Heavy furnace and forge facilities that create metallurgist jobs.",
    mineralCost: 680,
    buildDays: 15,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "heavyIndustry"] }],
    jobs: [{ job: "metallurgist", amount: 500_000_000 }],
  },
  commercialForum: {
    kind: "commercialForum",
    label: "Commercial Forum",
    initials: "CM",
    description: "Market districts and service hubs that create clerk jobs.",
    mineralCost: 260,
    buildDays: 5,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "clerk", amount: 500_000_000 }],
  },
  foodProcessingPlant: {
    kind: "foodProcessingPlant",
    label: "Food Processing Plant",
    initials: "FP",
    description: "Agricultural logistics and preservation plants that expand farmer jobs per agriculture district.",
    mineralCost: 210,
    buildDays: 4,
    compatibility: [{ area: "agriculture" }],
    jobs: [{ job: "farmer", amount: 250_000_000, perDistrict: "agriculture" }],
  },
  agroIndustrialKitchens: {
    kind: "agroIndustrialKitchens",
    label: "Agro-Industrial Kitchens",
    initials: "AK",
    description: "Food industry complexes that convert some farmer demand into artisan jobs.",
    mineralCost: 460,
    buildDays: 11,
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
    mineralCost: 230,
    buildDays: 4,
    compatibility: [{ area: "mining" }],
    jobs: [{ job: "miner", amount: 250_000_000, perDistrict: "mining" }],
  },
  oreSmelter: {
    kind: "oreSmelter",
    label: "Ore Smelter",
    initials: "OS",
    description: "Industrial smelters that convert some miner demand into metallurgist jobs.",
    mineralCost: 520,
    buildDays: 12,
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
    mineralCost: 230,
    buildDays: 4,
    compatibility: [{ area: "generator" }],
    jobs: [{ job: "technician", amount: 250_000_000, perDistrict: "generator" }],
  },
  capacitorWorkshops: {
    kind: "capacitorWorkshops",
    label: "Capacitor Workshops",
    initials: "CW",
    description: "Power component workshops that convert some technician demand into artisan jobs.",
    mineralCost: 460,
    buildDays: 11,
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
    mineralCost: 340,
    buildDays: 7,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "entertainer", amount: 500_000_000 }],
  },
  securityOffice: {
    kind: "securityOffice",
    label: "Security Office",
    initials: "SO",
    description: "Precincts and public safety offices that create enforcer jobs to reduce crime.",
    mineralCost: 340,
    buildDays: 7,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "enforcer", amount: 500_000_000 }],
  },
};

export const BUILDING_KINDS = Object.keys(BUILDING_DEFINITIONS) as BuildingKind[];

export const BUILDING_LABELS: Record<BuildingKind, string> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_DEFINITIONS[building].label]),
) as Record<BuildingKind, string>;

export const BUILDING_MINERAL_COSTS: Record<BuildingKind, number> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_DEFINITIONS[building].mineralCost]),
) as Record<BuildingKind, number>;

export const BUILDING_BUILD_DAYS: Record<BuildingKind, number> = Object.fromEntries(
  BUILDING_KINDS.map((building) => [building, BUILDING_DEFINITIONS[building].buildDays]),
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

export function createPlanetBuildingState(kind: BuildingKind, level = 1): PlanetBuildingState {
  return {
    kind,
    level: clampBuildingLevel(level),
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
  return clampBuildingLevel(slot.level);
}

export function getBuildingLevelEffectMultiplier(level: number): number {
  return BUILDING_LEVEL_EFFECT_MULTIPLIERS[clampBuildingLevel(level)] ?? 1;
}

export function getBuildingMineralCost(building: BuildingKind, targetLevel = 1): number {
  const definition = BUILDING_DEFINITIONS[building];
  const level = clampBuildingLevel(targetLevel);
  const multiplier = level <= 1 ? 1 : 1.35 * Math.pow(level, 1.35);
  return Math.round((definition?.mineralCost ?? 0) * multiplier);
}

export function getBuildingBuildDays(building: BuildingKind, targetLevel = 1): number {
  const definition = BUILDING_DEFINITIONS[building];
  const level = clampBuildingLevel(targetLevel);
  const multiplier = level <= 1 ? 1 : 1.9 * Math.pow(level, 1.45);
  return Math.max(1, Math.round((definition?.buildDays ?? 1) * multiplier));
}

export function getBuildingUpgradeTargetLevel(slot: PlanetBuildingSlot | undefined): number | null {
  const kind = getPlanetBuildingKind(slot);
  if (!kind) return null;
  const nextLevel = getPlanetBuildingLevel(slot) + 1;
  return nextLevel <= BUILDING_MAX_LEVEL ? nextLevel : null;
}

export function getBuildingUpgradeMineralCost(building: BuildingKind, currentLevel: number): number {
  const targetLevel = clampBuildingLevel(currentLevel + 1);
  return Math.max(0, getBuildingMineralCost(building, targetLevel) - Math.round(getBuildingMineralCost(building, currentLevel) * 0.35));
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
  2: 14_000_000_000,
  3: 28_000_000_000,
  4: 48_000_000_000,
  5: 72_000_000_000,
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
  if (existingIndex === 0) return buildings;

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
  food: 6_000,
  minerals: 6_000,
  energy: 6_000,
  goods: 2_500,
  alloys: 1_200,
  research: 0,
};

function emptyJobCapacity(): JobCapacity {
  return {
    ruler: 0,
    administrator: 0,
    researcher: 0,
    artisan: 0,
    metallurgist: 0,
    entertainer: 0,
    enforcer: 0,
    farmer: 0,
    miner: 0,
    technician: 0,
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

function createEmptyPopulationGrowth(): PlanetPopulationGrowth {
  return {
    capacity: 0,
    capacityPressure: 0,
    ratePerQuarter: 0,
    netPerQuarter: 0,
    factors: {
      housing: 0,
      amenities: 0,
      stability: 0,
      crime: 0,
      employment: 0,
      capacity: 0,
    },
  };
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
  return {
    id: modifier.id,
    label: modifier.label,
    source: modifier.source,
    target: modifier.target,
    operation: modifier.operation,
    value,
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
  state: Pick<PlanetState, "features" | "modifiers">,
  externalModifiers: PlanetModifier[] = [],
): PlanetModifier[] {
  return [
    ...normalizeModifiers(state.modifiers).map((modifier) => cloneModifier(modifier)),
    ...normalizeModifiers(externalModifiers).map((modifier) => cloneModifier(modifier)),
    ...getFeatureModifiers(state.features),
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
  if (!item?.id || !item.label || (item.kind !== "district" && item.kind !== "building" && item.kind !== "buildingUpgrade")) return null;
  const totalDays = Math.max(1, Number(item.totalDays) || 1);
  const remainingDays = Math.max(0, Math.min(totalDays, Number(item.remainingDays) || totalDays));
  const mineralCost = Math.max(0, Math.round(Number(item.mineralCost) || 0));
  if (item.kind === "district") {
    if (!item.districtKind || !["city", "generator", "mining", "agriculture"].includes(item.districtKind)) return null;
    return {
      id: item.id,
      kind: "district",
      label: item.label,
      mineralCost,
      totalDays,
      remainingDays,
      districtKind: item.districtKind,
    };
  }
  if (!item.buildingKind || !BUILDING_KINDS.includes(item.buildingKind)) return null;
  if (!item.area || !(item.area === "urbanSubDistrict" || ["city", "generator", "mining", "agriculture"].includes(item.area))) return null;
  const slotIndex = Math.max(0, Math.round(Number(item.slotIndex) || 0));
  const subDistrictIndex = item.subDistrictIndex === undefined ? undefined : Math.max(0, Math.round(Number(item.subDistrictIndex)));
  const targetLevel = item.targetLevel === undefined ? undefined : clampBuildingLevel(item.targetLevel);
  return {
    id: item.id,
    kind: item.kind,
    label: item.label,
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
      return createPlanetBuildingState(record.kind, record.level);
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
  const baseBuiltDistricts = normalizeDistrictCounts(existing?.builtDistricts ?? seed.builtDistricts, seed.districtLimits);
  const isHabited = (existing?.isHabited ?? false) || seed.isHabited;
  const useStarterInfrastructure = isHabited && seed.starterInfrastructure !== false;
  const builtDistricts = useStarterInfrastructure
    ? createStarterBuiltDistricts(seed.districtLimits, baseBuiltDistricts)
    : baseBuiltDistricts;
  const buildings = ensureCapitalBuilding(
    useStarterInfrastructure
      ? normalizeBuildings(existing?.buildings ?? createStarterBuildings(seed.districtLimits))
      : normalizeBuildings(existing?.buildings),
    isHabited,
  );
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
    isHabited,
    habitability: existing?.habitability ?? seed.habitability,
    population,
    speciesPopulations,
    features: normalizePlanetFeatures(existing?.features ?? seed.features),
    builtDistricts,
    buildings,
    urbanSubDistricts,
    constructionQueue: normalizeConstructionQueue(existing?.constructionQueue),
    modifiers: normalizeModifiers(existing?.modifiers),
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
    activeModifiers: [],
  };
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
  const upkeepPerUnit = perUnitOverride ?? (jobClass === "upper" ? 0.45 : jobClass === "middle" ? 0.25 : 0.08);
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
  const levelMultiplier = getBuildingLevelEffectMultiplier(level);
  const definition = BUILDING_DEFINITIONS[buildingKind];
  if (!definition) return context?.housing ?? 0;
  for (const effect of definition.jobs ?? []) {
    const multiplier = effect.perDistrict ? builtDistricts[effect.perDistrict] : 1;
    addJobCapacity(capacity, effect.job, effect.amount * multiplier * levelMultiplier, modifiers);
  }
  return (definition.housing ?? 0) * levelMultiplier;
}

interface PopAssignment {
  job: JobKind;
  class: JobClass;
  speciesId: SpeciesId;
  population: number;
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

  for (const job of JOB_KINDS) {
    capacity[job] = Math.max(0, Math.floor(capacity[job]));
  }

  housing = Math.max(0, applyModifiers(housing, activeModifiers, "housing"));

  const speciesPopulations = normalizeSpeciesPopulations(state.speciesPopulations, state.population, state.isHabited);
  const totalPopulation = sumSpeciesPopulation(speciesPopulations);
  const remainingBySpecies = new Map(speciesPopulations.map((entry) => [entry.speciesId, entry.population]));
  const assignments: PopAssignment[] = [];
  let employedPopulation = 0;

  for (const job of JOB_FILL_ORDER) {
    let capacityRemaining = capacity[job];
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

  const net = createEmptyResourceCounts();
  const deficit = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) {
    net[resource] = production[resource] - upkeep[resource];
    deficit[resource] = Math.max(0, -net[resource]);
  }

  const summaryWithoutGrowth: Omit<PlanetEconomySummary, "populationGrowth"> = {
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
    ...summaryWithoutGrowth,
    populationGrowth: calculatePopulationGrowth(state, summaryWithoutGrowth, districtLimits, externalModifiers, speciesContext),
  };
}

export function calculatePlanetCapacity(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
): number {
  if (!state.isHabited) return 0;
  const limits = districtLimits ?? state.builtDistricts;
  const sizeProxy = Math.max(1, limits.city, state.builtDistricts.city);
  const resourcePotential = Math.max(0, limits.generator + limits.mining + limits.agriculture);
  const baseCapacity = sizeProxy * 1_750_000_000;
  const resourceCapacity = resourcePotential * 260_000_000;
  const urbanizedCapacity = state.builtDistricts.city * 520_000_000;
  const infrastructureCapacity = calculateBuildingCapacityBonus(state);
  const modifiedCapacity = applyModifiers(
    baseCapacity + resourceCapacity + urbanizedCapacity + infrastructureCapacity,
    getActiveModifiers(state, externalModifiers),
    "planetCapacity",
  );
  return Math.max(3_000_000_000, Math.floor(modifiedCapacity));
}

function calculateBuildingCapacityBonus(state: PlanetState): number {
  let capacity = 0;
  const add = (building: PlanetBuildingSlot): void => {
    const kind = getPlanetBuildingKind(building);
    if (!kind) return;
    const levelMultiplier = getBuildingLevelEffectMultiplier(getPlanetBuildingLevel(building));
    if (kind === "housingComplex") {
      capacity += 650_000_000 * levelMultiplier;
      return;
    }
    if (
      kind === "administrativeComplex"
      || kind === "commercialForum"
      || kind === "entertainmentForum"
      || kind === "securityOffice"
    ) {
      capacity += 120_000_000 * levelMultiplier;
    }
  };
  for (const building of Object.values(state.buildings).flat()) add(building);
  for (const subDistrict of state.urbanSubDistricts) {
    for (const building of subDistrict.buildings) add(building);
  }
  return capacity;
}

export function calculatePopulationGrowth(
  state: PlanetState,
  economy: Omit<PlanetEconomySummary, "populationGrowth">,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetPopulationGrowth {
  if (!state.isHabited || state.population <= 0) return createEmptyPopulationGrowth();

  const capacity = calculatePlanetCapacity(state, districtLimits, externalModifiers);
  const capacityPressure = capacity > 0 ? state.population / capacity : 1;
  const capacityCurve = clamp(1 - capacityPressure, -0.75, 1.15);
  const speciesPopulations = normalizeSpeciesPopulations(state.speciesPopulations, state.population, state.isHabited);
  const housingNeedPopulation = getSpeciesHousingNeedPopulation(speciesPopulations, speciesContext);
  const housingRatio = housingNeedPopulation > 0 ? economy.housing / housingNeedPopulation : 1;
  const amenityNeed = getAmenityNeed(state.population);
  const amenityRatio = amenityNeed > 0 ? economy.amenities / amenityNeed : 1;
  const unemploymentRatio = state.population > 0 ? economy.unemployedPopulation / state.population : 0;

  const factors: PlanetPopulationGrowthFactors = {
    housing: clamp((housingRatio - 1) * 0.55, -0.35, 0.2),
    amenities: clamp((amenityRatio - 1) * 0.18, -0.18, 0.08),
    stability: clamp((economy.stability - 50) / 100 * 0.9, -0.45, 0.35),
    crime: clamp(-economy.crime / 100 * 0.2, -0.2, 0),
    employment: clamp(-unemploymentRatio * 0.72 + (unemploymentRatio <= 0.03 ? 0.04 : 0), -0.36, 0.04),
    capacity: capacityCurve,
  };
  const managementPressure = factors.housing + factors.amenities + factors.stability + factors.crime + factors.employment;
  const managementMultiplier = factors.capacity < 0
    ? clamp(1 - managementPressure, 0.35, 2.2)
    : clamp(1 + managementPressure, -0.6, 1.8);
  const ratePerQuarter = applyModifiers(
    BASE_POPULATION_GROWTH_RATE_PER_QUARTER * factors.capacity * managementMultiplier,
    getActiveModifiers(state, externalModifiers),
    "populationGrowth",
  ) * getWeightedSpeciesGrowthMultiplier(state.speciesPopulations, speciesContext);
  const netPerQuarter = Math.round(state.population * ratePerQuarter);

  return {
    capacity,
    capacityPressure,
    ratePerQuarter,
    netPerQuarter,
    factors,
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
  const normalized = {
    ...state,
    population: sumSpeciesPopulation(speciesPopulations),
    speciesPopulations,
    features: normalizePlanetFeatures(state.features),
    builtDistricts: cloneDistricts(state.builtDistricts),
    buildings: normalizeBuildings(state.buildings),
    urbanSubDistricts: normalizeUrbanSubDistricts(state.urbanSubDistricts),
    constructionQueue: normalizeConstructionQueue(state.constructionQueue),
    modifiers: normalizeModifiers(state.modifiers),
  };
  return {
    ...normalized,
    economy: calculatePlanetEconomy(normalized, districtLimits, externalModifiers, speciesContext),
  };
}

export function applyPopulationGrowth(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  quarters = 1,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetState {
  let next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers, speciesContext);
  if (!next.isHabited || quarters <= 0) return next;

  for (let i = 0; i < quarters; i++) {
    const growth = next.economy.populationGrowth.netPerQuarter;
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
  quarterFraction: number,
  externalModifiers: PlanetModifier[] = [],
  speciesContext?: PlanetEconomySpeciesContext,
): PlanetState {
  const next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers, speciesContext);
  if (!next.isHabited || quarterFraction <= 0) return next;

  const growth = Math.round(next.economy.populationGrowth.netPerQuarter * quarterFraction);
  const speciesPopulations = applyPopulationDeltaToSpecies(next.speciesPopulations, growth, speciesContext);
  return recalculatePlanetStateEconomy({
    ...next,
    population: sumSpeciesPopulation(speciesPopulations),
    speciesPopulations,
  }, districtLimits, externalModifiers, speciesContext);
}

function applyPopulationDeltaToSpecies(
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
  return {
    id,
    kind: "district",
    label: `${districtKind[0].toUpperCase()}${districtKind.slice(1)} District`,
    mineralCost: DISTRICT_MINERAL_COSTS[districtKind],
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
  return {
    id,
    kind: "building",
    label: BUILDING_LABELS[buildingKind],
    mineralCost: getBuildingMineralCost(buildingKind, 1),
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
  return {
    id,
    kind: "buildingUpgrade",
    label: `${BUILDING_LABELS[buildingKind]} Level ${targetLevel}`,
    mineralCost: getBuildingUpgradeMineralCost(buildingKind, currentLevel),
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

  if ((item.kind !== "building" && item.kind !== "buildingUpgrade") || !item.buildingKind || !item.area || item.slotIndex === undefined) return state;
  const completedBuilding = createPlanetBuildingState(item.buildingKind, item.targetLevel ?? 1);
  if (item.area === "urbanSubDistrict") {
    if (item.subDistrictIndex === undefined) return state;
    return {
      ...state,
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
    : kind === "building" || kind === "buildingUpgrade"
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
    monthlyDelta: createEmptyResourceCounts(),
    lastProcessedMonth: currentMonth,
    lastProcessedHour: currentMonth * 30 * 24,
  };
}
