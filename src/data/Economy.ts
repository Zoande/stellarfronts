import type { DistrictCounts, DistrictKind } from "./StarMap";

export type { DistrictCounts, DistrictKind } from "./StarMap";

export type ResourceKind = "food" | "minerals" | "energy" | "goods" | "alloys" | "research";

export type ResourceCounts = Record<ResourceKind, number>;

export type SpeciesId = "human";

export interface SpeciesDefinition {
  id: SpeciesId;
  name: string;
}

export interface SpeciesPopulation {
  speciesId: SpeciesId;
  population: number;
}

export type JobClass = "upper" | "middle" | "lower";

export type JobKind =
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
  | "unemployed";

export type BuildingKind =
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
}

export type PlanetConstructionKind = "district" | "building";

export interface PlanetConstructionQueueItem {
  id: string;
  kind: PlanetConstructionKind;
  label: string;
  mineralCost: number;
  totalDays: number;
  remainingDays: number;
  districtKind?: DistrictKind;
  buildingKind?: BuildingKind;
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
  buildings: Array<BuildingKind | null>;
}

export type DistrictBuildingSlots = Record<DistrictKind, Array<BuildingKind | null>>;

export interface JobCapacity {
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
}

export const PEOPLE_PER_MONTHLY_UNIT = 1_000_000;
export const STARTING_HABITED_POPULATION = 10_000_000_000;
const BASE_POPULATION_GROWTH_RATE_PER_QUARTER = 0.01;
const POP_FOOD_UPKEEP_PER_UNIT = 1.1;

export const DISTRICT_MINERAL_COSTS: Record<DistrictKind, number> = {
  city: 900,
  generator: 750,
  mining: 750,
  agriculture: 750,
};

export const DISTRICT_BUILD_DAYS: Record<DistrictKind, number> = {
  city: 90,
  generator: 90,
  mining: 90,
  agriculture: 90,
};

export const RESOURCE_KINDS: ResourceKind[] = ["food", "minerals", "energy", "goods", "alloys", "research"];

export const JOB_KINDS: JobKind[] = [
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
  "unemployed",
];

export const JOB_FILL_ORDER: JobKind[] = [
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

export const HUMAN_SPECIES_ID: SpeciesId = "human";

export const SPECIES_DEFINITIONS: Record<SpeciesId, SpeciesDefinition> = {
  human: {
    id: "human",
    name: "Human",
  },
};

export const SPECIES_IDS: SpeciesId[] = ["human"];

export const JOB_DEFINITIONS: Record<JobKind, JobDefinition> = {
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
    amenities: 5,
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
  housingComplex: {
    kind: "housingComplex",
    label: "Housing Complex",
    initials: "HC",
    description: "Dense residential towers and life-support extensions that expand planetary housing.",
    mineralCost: 350,
    buildDays: 18,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    housing: 1_200_000_000,
  },
  administrativeComplex: {
    kind: "administrativeComplex",
    label: "Administrative Complex",
    initials: "AD",
    description: "Offices, courts, and planning bureaus that create administrator jobs.",
    mineralCost: 600,
    buildDays: 60,
    compatibility: [{ area: "city" }],
    jobs: [{ job: "administrator", amount: 300_000_000 }],
  },
  researchLabs: {
    kind: "researchLabs",
    label: "Research Labs",
    initials: "RL",
    description: "Laboratory campuses that create researcher jobs.",
    mineralCost: 800,
    buildDays: 90,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["researchCampus"] }],
    jobs: [{ job: "researcher", amount: 500_000_000 }],
  },
  civilianFabricators: {
    kind: "civilianFabricators",
    label: "Civilian Fabricators",
    initials: "CF",
    description: "Factory halls that create artisan jobs for civilian goods production.",
    mineralCost: 700,
    buildDays: 60,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "civilianIndustry"] }],
    jobs: [{ job: "artisan", amount: 500_000_000 }],
  },
  alloyFoundries: {
    kind: "alloyFoundries",
    label: "Alloy Foundries",
    initials: "AF",
    description: "Heavy furnace and forge facilities that create metallurgist jobs.",
    mineralCost: 850,
    buildDays: 90,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["mixedIndustry", "heavyIndustry"] }],
    jobs: [{ job: "metallurgist", amount: 500_000_000 }],
  },
  commercialForum: {
    kind: "commercialForum",
    label: "Commercial Forum",
    initials: "CM",
    description: "Market districts and service hubs that create clerk jobs.",
    mineralCost: 400,
    buildDays: 18,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "clerk", amount: 500_000_000 }],
  },
  foodProcessingPlant: {
    kind: "foodProcessingPlant",
    label: "Food Processing Plant",
    initials: "FP",
    description: "Agricultural logistics and preservation plants that expand farmer jobs per agriculture district.",
    mineralCost: 350,
    buildDays: 18,
    compatibility: [{ area: "agriculture" }],
    jobs: [{ job: "farmer", amount: 250_000_000, perDistrict: "agriculture" }],
  },
  agroIndustrialKitchens: {
    kind: "agroIndustrialKitchens",
    label: "Agro-Industrial Kitchens",
    initials: "AK",
    description: "Food industry complexes that convert some farmer demand into artisan jobs.",
    mineralCost: 550,
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
    mineralCost: 350,
    buildDays: 18,
    compatibility: [{ area: "mining" }],
    jobs: [{ job: "miner", amount: 250_000_000, perDistrict: "mining" }],
  },
  oreSmelter: {
    kind: "oreSmelter",
    label: "Ore Smelter",
    initials: "OS",
    description: "Industrial smelters that convert some miner demand into metallurgist jobs.",
    mineralCost: 650,
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
    mineralCost: 350,
    buildDays: 18,
    compatibility: [{ area: "generator" }],
    jobs: [{ job: "technician", amount: 250_000_000, perDistrict: "generator" }],
  },
  capacitorWorkshops: {
    kind: "capacitorWorkshops",
    label: "Capacitor Workshops",
    initials: "CW",
    description: "Power component workshops that convert some technician demand into artisan jobs.",
    mineralCost: 550,
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
    mineralCost: 550,
    buildDays: 60,
    compatibility: [{ area: "city" }, { area: "urbanSubDistrict", subDistrictKinds: ["residential"] }],
    jobs: [{ job: "entertainer", amount: 500_000_000 }],
  },
  securityOffice: {
    kind: "securityOffice",
    label: "Security Office",
    initials: "SO",
    description: "Precincts and public safety offices that create enforcer jobs to reduce crime.",
    mineralCost: 550,
    buildDays: 60,
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
    city: Array<BuildingKind | null>(6).fill(null),
    generator: Array<BuildingKind | null>(3).fill(null),
    mining: Array<BuildingKind | null>(3).fill(null),
    agriculture: Array<BuildingKind | null>(3).fill(null),
  };
}

export function createEmptyUrbanSubDistricts(): UrbanSubDistrictState[] {
  return [
    { kind: "residential", buildings: Array<BuildingKind | null>(3).fill(null) },
    { kind: "mixedIndustry", buildings: Array<BuildingKind | null>(3).fill(null) },
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
    if (!entry || !SPECIES_IDS.includes(entry.speciesId)) continue;
    const population = Math.max(0, Math.floor(Number(entry.population) || 0));
    if (population <= 0) continue;
    bySpecies.set(entry.speciesId, (bySpecies.get(entry.speciesId) ?? 0) + population);
  }

  if (bySpecies.size === 0 && fallbackPopulation > 0) {
    bySpecies.set(HUMAN_SPECIES_ID, Math.max(0, Math.floor(fallbackPopulation)));
  }

  const targetPopulation = Math.max(0, Math.floor(fallbackPopulation));
  const currentPopulation = Array.from(bySpecies.values()).reduce((sum, population) => sum + population, 0);
  if (currentPopulation > 0 && targetPopulation > 0 && currentPopulation !== targetPopulation) {
    let runningTotal = 0;
    for (const speciesId of SPECIES_IDS) {
      const current = bySpecies.get(speciesId) ?? 0;
      if (current <= 0) continue;
      const scaled = Math.max(0, Math.round(targetPopulation * (current / currentPopulation)));
      bySpecies.set(speciesId, scaled);
      runningTotal += scaled;
    }
    let remainder = targetPopulation - runningTotal;
    for (const speciesId of SPECIES_IDS) {
      if (remainder === 0) break;
      if (!bySpecies.has(speciesId)) continue;
      const step = remainder > 0 ? 1 : -1;
      const current = bySpecies.get(speciesId) ?? 0;
      if (step < 0 && current <= 0) continue;
      bySpecies.set(speciesId, current + step);
      remainder -= step;
    }
  }

  return SPECIES_IDS
    .map((speciesId) => ({
      speciesId,
      population: bySpecies.get(speciesId) ?? 0,
    }))
    .filter((entry) => entry.population > 0);
}

function sumSpeciesPopulation(populations: SpeciesPopulation[]): number {
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

function interpolate(value: number, inputMin: number, inputMax: number, outputMin: number, outputMax: number): number {
  if (inputMax === inputMin) return outputMin;
  const t = clamp((value - inputMin) / (inputMax - inputMin), 0, 1);
  return outputMin + (outputMax - outputMin) * t;
}

export function getEffectiveSpeciesHabitability(
  state: Pick<PlanetState, "habitability" | "features" | "modifiers">,
  speciesId: SpeciesId = HUMAN_SPECIES_ID,
): number {
  const base = clamp(state.habitability ?? 0, 0, 100);
  const modified = applyModifiers(base, getActiveModifiers(state), `habitability:${speciesId}`);
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
  if (!item?.id || !item.label || (item.kind !== "district" && item.kind !== "building")) return null;
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
  return {
    id: item.id,
    kind: "building",
    label: item.label,
    mineralCost,
    totalDays,
    remainingDays,
    buildingKind: item.buildingKind,
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

function normalizeBuildingSlots(
  slots: Array<BuildingKind | null> | undefined,
  length: number,
): Array<BuildingKind | null> {
  const out = Array<BuildingKind | null>(length).fill(null);
  for (let i = 0; i < length; i++) {
    const value = slots?.[i] ?? null;
    out[i] = value && BUILDING_KINDS.includes(value) ? value : null;
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
      .map((building) => (building && isBuildingCompatible(building, "urbanSubDistrict", kind) ? building : null));
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
  buildings.city[0] = "administrativeComplex";
  buildings.city[1] = "housingComplex";
  if (limits.generator > 0) buildings.generator[0] = "energyGrid";
  if (limits.mining > 0) buildings.mining[0] = "mineralPurificationPlant";
  if (limits.agriculture > 0) buildings.agriculture[0] = "foodProcessingPlant";
  return buildings;
}

export function createPlanetStateFromSeed(
  seed: PlanetEconomySeed,
  existing?: Partial<PlanetState>,
): PlanetState {
  const baseBuiltDistricts = normalizeDistrictCounts(existing?.builtDistricts ?? seed.builtDistricts, seed.districtLimits);
  const isHabited = (existing?.isHabited ?? false) || seed.isHabited;
  const builtDistricts = isHabited
    ? createStarterBuiltDistricts(seed.districtLimits, baseBuiltDistricts)
    : baseBuiltDistricts;
  const buildings = isHabited
    ? normalizeBuildings(existing?.buildings ?? createStarterBuildings(seed.districtLimits))
    : normalizeBuildings(existing?.buildings);
  const urbanSubDistricts = isHabited
    ? normalizeUrbanSubDistricts(existing?.urbanSubDistricts)
    : normalizeUrbanSubDistricts([]);
  const fallbackPopulation = isHabited
    ? existing?.population === undefined
      ? STARTING_HABITED_POPULATION
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
  population: number,
  modifiers: PlanetModifier[],
  productionMultiplier: number,
  upkeepMultiplier: number,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const addJobOutput = (resource: ResourceKind, amount: number): void => {
    const generic = applyModifiers(amount, modifiers, "jobOutput");
    addResource(production, resource, applyModifiers(generic, modifiers, `jobOutput:${job}:${resource}`) * productionMultiplier);
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
  return getJobAmenityEffect(job, population, modifiers, productionMultiplier);
}

function applyGoodsUpkeep(
  upkeep: ResourceCounts,
  jobClass: JobClass,
  population: number,
  modifiers: PlanetModifier[],
  upkeepMultiplier: number,
): void {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const upkeepPerUnit = jobClass === "upper" ? 0.45 : jobClass === "middle" ? 0.25 : 0.08;
  addResource(upkeep, "goods", applyModifiers(units * upkeepPerUnit, modifiers, `goodsUpkeep:${jobClass}`) * upkeepMultiplier);
}

function getJobAmenityEffect(
  job: JobKind,
  population: number,
  modifiers: PlanetModifier[],
  productionMultiplier: number,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const amenities = JOB_DEFINITIONS[job].amenities ?? 0;
  return applyModifiers(units * amenities, modifiers, `jobAmenities:${job}`) * productionMultiplier;
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
  building: BuildingKind | null,
  capacity: JobCapacity,
  builtDistricts: DistrictCounts,
  modifiers: PlanetModifier[] = [],
  context?: { housing: number },
): number {
  if (!building) return 0;
  const definition = BUILDING_DEFINITIONS[building];
  if (!definition) return context?.housing ?? 0;
  for (const effect of definition.jobs ?? []) {
    const multiplier = effect.perDistrict ? builtDistricts[effect.perDistrict] : 1;
    addJobCapacity(capacity, effect.job, effect.amount * multiplier, modifiers);
  }
  return definition.housing ?? 0;
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
  return clamp(5 - unemploymentRatio * 25, -20, 5);
}

function getHappinessCrimePressure(happiness: number): number {
  if (happiness >= 100) return 0;
  if (happiness >= 80) return (100 - happiness) * 0.25;
  return 5 + ((80 - happiness) / 80) * 95;
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

  const unemploymentRatio = totalPopulation > 0 ? unemployedPopulation / totalPopulation : 0;
  const housingRatio = totalPopulation > 0 ? housing / totalPopulation : 1;
  let amenities = 0;
  let crimeReduction = 0;

  for (const assignment of assignments) {
    if (assignment.job === "unemployed") continue;
    const habitability = getEffectiveSpeciesHabitability(state, assignment.speciesId);
    const productionMultiplier = getHabitabilityProductionMultiplier(habitability);
    amenities += getJobAmenityEffect(
      assignment.job,
      assignment.population,
      activeModifiers,
      productionMultiplier,
    );
    crimeReduction += getJobCrimeReductionEffect(assignment.job, assignment.population, productionMultiplier);
  }

  amenities = applyModifiers(amenities, activeModifiers, "amenities");
  const amenityNeed = totalPopulation / PEOPLE_PER_MONTHLY_UNIT;
  const amenityRatio = amenityNeed > 0 ? amenities / amenityNeed : 1;
  const sharedHousingHappiness = getHousingHappinessModifier(housingRatio);
  const sharedAmenitiesHappiness = getAmenitiesHappinessModifier(amenityRatio);
  const sharedEmploymentHappiness = getEmploymentHappinessModifier(unemploymentRatio);
  const popGroups: PopGroup[] = [];
  let weightedHappiness = 0;
  let weightedCrimePressure = 0;
  let weightedHighHappinessStability = 0;

  for (const assignment of assignments) {
    const habitability = getEffectiveSpeciesHabitability(state, assignment.speciesId);
    const jobPenalty = assignment.job === "unemployed" ? -12 : 0;
    const happiness = clamp(Math.round(applyModifiers(
      50
        + getHabitabilityHappinessModifier(habitability)
        + sharedHousingHappiness
        + sharedAmenitiesHappiness
        + sharedEmploymentHappiness
        + jobPenalty,
      activeModifiers,
      "happiness",
    )), 0, 100);
    const speciesName = SPECIES_DEFINITIONS[assignment.speciesId].name;
    mergePopGroup(popGroups, {
      job: assignment.job,
      class: assignment.class,
      speciesId: assignment.speciesId,
      speciesName,
      habitability,
      happiness,
      population: assignment.population,
    });
    weightedHappiness += happiness * assignment.population;
    weightedCrimePressure += getHappinessCrimePressure(happiness) * assignment.population;
    weightedHighHappinessStability += Math.max(0, happiness - 80) / 20 * 15 * assignment.population;
  }

  const happiness = totalPopulation > 0 ? weightedHappiness / totalPopulation : 50;
  const rawCrime = totalPopulation > 0 ? weightedCrimePressure / totalPopulation : 0;
  const crime = clamp(applyModifiers(rawCrime - crimeReduction, activeModifiers, "crime"), 0, 100);
  const highHappinessStability = totalPopulation > 0 ? weightedHighHappinessStability / totalPopulation : 0;
  const stability = clamp(
    applyModifiers(50 + (20 - crime * 0.5) + highHappinessStability, activeModifiers, "stability"),
    0,
    100,
  );
  const stabilityProductionMultiplier = Math.max(0, 1 + (stability - 50) * 0.005);

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
        group.population,
        activeModifiers,
        habitabilityProductionMultiplier * stabilityProductionMultiplier,
        habitabilityUpkeepMultiplier,
      );
      applyGoodsUpkeep(upkeep, group.class, group.population, activeModifiers, habitabilityUpkeepMultiplier);
    }
  }

  for (const species of speciesPopulations) {
    const habitability = getEffectiveSpeciesHabitability(state, species.speciesId);
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
    populationGrowth: calculatePopulationGrowth(state, summaryWithoutGrowth, districtLimits, externalModifiers),
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
  const baseCapacity = sizeProxy * 1_800_000_000;
  const resourceCapacity = resourcePotential * 300_000_000;
  const urbanizedCapacity = state.builtDistricts.city * 450_000_000;
  const modifiedCapacity = applyModifiers(baseCapacity + resourceCapacity + urbanizedCapacity, getActiveModifiers(state, externalModifiers), "planetCapacity");
  return Math.max(3_000_000_000, Math.floor(modifiedCapacity));
}

export function calculatePopulationGrowth(
  state: PlanetState,
  economy: Omit<PlanetEconomySummary, "populationGrowth">,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
): PlanetPopulationGrowth {
  if (!state.isHabited || state.population <= 0) return createEmptyPopulationGrowth();

  const capacity = calculatePlanetCapacity(state, districtLimits, externalModifiers);
  const capacityPressure = capacity > 0 ? state.population / capacity : 1;
  const capacityCurve = clamp(1 - capacityPressure, -0.75, 1.15);
  const housingRatio = state.population > 0 ? economy.housing / state.population : 1;
  const amenityNeed = state.population / PEOPLE_PER_MONTHLY_UNIT;
  const amenityRatio = amenityNeed > 0 ? economy.amenities / amenityNeed : 1;
  const unemploymentRatio = state.population > 0 ? economy.unemployedPopulation / state.population : 0;

  const factors: PlanetPopulationGrowthFactors = {
    housing: clamp((housingRatio - 1) * 0.55, -0.35, 0.2),
    amenities: clamp((amenityRatio - 1) * 0.12, -0.1, 0.08),
    stability: clamp((economy.stability - 50) / 100 * 0.6, -0.3, 0.3),
    crime: clamp(-economy.crime / 100 * 0.12, -0.12, 0),
    employment: clamp(-unemploymentRatio * 0.56 + (unemploymentRatio <= 0.03 ? 0.04 : 0), -0.28, 0.04),
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
  );
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
    economy: calculatePlanetEconomy(normalized, districtLimits, externalModifiers),
  };
}

export function applyPopulationGrowth(
  state: PlanetState,
  districtLimits?: DistrictCounts,
  quarters = 1,
  externalModifiers: PlanetModifier[] = [],
): PlanetState {
  let next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers);
  if (!next.isHabited || quarters <= 0) return next;

  for (let i = 0; i < quarters; i++) {
    const growth = next.economy.populationGrowth.netPerQuarter;
    const speciesPopulations = applyPopulationDeltaToSpecies(next.speciesPopulations, growth);
    next = recalculatePlanetStateEconomy({
      ...next,
      population: sumSpeciesPopulation(speciesPopulations),
      speciesPopulations,
    }, districtLimits, externalModifiers);
  }

  return next;
}

export function applyPopulationGrowthFraction(
  state: PlanetState,
  districtLimits: DistrictCounts | undefined,
  quarterFraction: number,
  externalModifiers: PlanetModifier[] = [],
): PlanetState {
  const next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers);
  if (!next.isHabited || quarterFraction <= 0) return next;

  const growth = Math.round(next.economy.populationGrowth.netPerQuarter * quarterFraction);
  const speciesPopulations = applyPopulationDeltaToSpecies(next.speciesPopulations, growth);
  return recalculatePlanetStateEconomy({
    ...next,
    population: sumSpeciesPopulation(speciesPopulations),
    speciesPopulations,
  }, districtLimits, externalModifiers);
}

function applyPopulationDeltaToSpecies(populations: SpeciesPopulation[], delta: number): SpeciesPopulation[] {
  if (delta === 0 || populations.length === 0) return populations.map((entry) => cloneSpeciesPopulation(entry));
  const total = sumSpeciesPopulation(populations);
  if (total <= 0) {
    return delta > 0
      ? [{ speciesId: HUMAN_SPECIES_ID, population: delta }]
      : [];
  }

  const targetTotal = Math.max(0, total + delta);
  let runningTotal = 0;
  const next = populations.map((entry) => {
    const population = Math.max(0, Math.round(targetTotal * (entry.population / total)));
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
    mineralCost: BUILDING_MINERAL_COSTS[buildingKind],
    totalDays: BUILDING_BUILD_DAYS[buildingKind],
    remainingDays: BUILDING_BUILD_DAYS[buildingKind],
    buildingKind,
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
    item.kind === "building"
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
    if (subDistrict.buildings[item.slotIndex]) return false;
    return isBuildingCompatible(item.buildingKind, item.area, subDistrict.kind);
  }
  const slots = state.buildings[item.area];
  if (!slots || item.slotIndex < 0 || item.slotIndex >= slots.length) return false;
  if (slots[item.slotIndex]) return false;
  return isBuildingCompatible(item.buildingKind, item.area);
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

  if (item.kind !== "building" || !item.buildingKind || !item.area || item.slotIndex === undefined) return state;
  if (item.area === "urbanSubDistrict") {
    if (item.subDistrictIndex === undefined) return state;
    return {
      ...state,
      urbanSubDistricts: state.urbanSubDistricts.map((subDistrict, index) => (
        index === item.subDistrictIndex
          ? {
            ...subDistrict,
            buildings: subDistrict.buildings.map((building, buildingIndex) => (
              buildingIndex === item.slotIndex ? item.buildingKind! : building
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
        index === item.slotIndex ? item.buildingKind! : building
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
    : kind === "building"
      ? getModifierMultiplier(activeModifiers, "buildingConstructionSpeed")
      : 1;
  return Math.max(0.1, base * typed);
}

export function progressPlanetConstructionQueue(
  state: PlanetState,
  elapsedDays: number,
  districtLimits?: DistrictCounts,
  externalModifiers: PlanetModifier[] = [],
): { state: PlanetState; changed: boolean; completed: PlanetConstructionQueueItem[] } {
  let next = recalculatePlanetStateEconomy(state, districtLimits, externalModifiers);
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
    next = recalculatePlanetStateEconomy(withoutItem, limits, externalModifiers);
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
    if (item.kind !== "building" || item.area !== "urbanSubDistrict" || item.subDistrictIndex !== subDistrictIndex) {
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
