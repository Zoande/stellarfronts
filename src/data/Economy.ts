import type { DistrictCounts, DistrictKind } from "./StarMap";

export type { DistrictCounts, DistrictKind } from "./StarMap";

export type ResourceKind = "food" | "minerals" | "energy" | "goods" | "alloys" | "research";

export type ResourceCounts = Record<ResourceKind, number>;

export type JobClass = "upper" | "middle" | "lower";

export type JobKind =
  | "administrator"
  | "researcher"
  | "artisan"
  | "metallurgist"
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
  | "capacitorWorkshops";

export type UrbanSubDistrictKind =
  | "residential"
  | "researchCampus"
  | "mixedIndustry"
  | "civilianIndustry"
  | "heavyIndustry";

export type BuildingSlotArea = DistrictKind | "urbanSubDistrict";

export interface PopGroup {
  job: JobKind;
  class: JobClass;
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
  crime: number;
  stability: number;
}

export interface PlanetState {
  id: string;
  starId: number;
  planetIndex: number;
  isHabited: boolean;
  habitability: number | null;
  population: number;
  builtDistricts: DistrictCounts;
  buildings: DistrictBuildingSlots;
  urbanSubDistricts: UrbanSubDistrictState[];
  economy: PlanetEconomySummary;
}

export interface FactionEconomyState {
  factionId: number;
  stockpiles: ResourceCounts;
  monthlyDelta: ResourceCounts;
  lastProcessedMonth: number;
}

export interface PlanetEconomySeed {
  id: string;
  starId: number;
  planetIndex: number;
  isHabited: boolean;
  habitability: number | null;
  builtDistricts: DistrictCounts;
  districtLimits: DistrictCounts;
}

export const PEOPLE_PER_MONTHLY_UNIT = 1_000_000;
export const STARTING_HABITED_POPULATION = 10_000_000_000;

export const RESOURCE_KINDS: ResourceKind[] = ["food", "minerals", "energy", "goods", "alloys", "research"];

export const JOB_KINDS: JobKind[] = [
  "administrator",
  "researcher",
  "artisan",
  "metallurgist",
  "farmer",
  "miner",
  "technician",
  "clerk",
  "unemployed",
];

export const JOB_FILL_ORDER: JobKind[] = [
  "administrator",
  "researcher",
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

export const JOB_LABELS: Record<JobKind, string> = {
  administrator: "Administrators",
  researcher: "Researchers",
  artisan: "Artisans",
  metallurgist: "Metallurgists",
  farmer: "Farmers",
  miner: "Miners",
  technician: "Technicians",
  clerk: "Clerks",
  unemployed: "Unemployed",
};

export const BUILDING_LABELS: Record<BuildingKind, string> = {
  housingComplex: "Housing Complex",
  administrativeComplex: "Administrative Complex",
  researchLabs: "Research Labs",
  civilianFabricators: "Civilian Fabricators",
  alloyFoundries: "Alloy Foundries",
  commercialForum: "Commercial Forum",
  foodProcessingPlant: "Food Processing Plant",
  agroIndustrialKitchens: "Agro-Industrial Kitchens",
  mineralPurificationPlant: "Mineral Purification Plant",
  oreSmelter: "Ore Smelter",
  energyGrid: "Energy Grid",
  capacitorWorkshops: "Capacitor Workshops",
};

export const URBAN_SUB_DISTRICT_LABELS: Record<UrbanSubDistrictKind, string> = {
  residential: "Residential Arcology",
  researchCampus: "Research Campus",
  mixedIndustry: "Mixed Industry",
  civilianIndustry: "Civilian Industry",
  heavyIndustry: "Heavy Industry",
};

export const BUILDING_KINDS: BuildingKind[] = [
  "housingComplex",
  "administrativeComplex",
  "researchLabs",
  "civilianFabricators",
  "alloyFoundries",
  "commercialForum",
  "foodProcessingPlant",
  "agroIndustrialKitchens",
  "mineralPurificationPlant",
  "oreSmelter",
  "energyGrid",
  "capacitorWorkshops",
];

export const URBAN_SUB_DISTRICT_KINDS: UrbanSubDistrictKind[] = [
  "residential",
  "researchCampus",
  "mixedIndustry",
  "civilianIndustry",
  "heavyIndustry",
];

export const STARTING_RESOURCE_STOCKPILES: ResourceCounts = {
  food: 100_000,
  minerals: 100_000,
  energy: 100_000,
  goods: 50_000,
  alloys: 20_000,
  research: 0,
};

function emptyJobCapacity(): JobCapacity {
  return {
    administrator: 0,
    researcher: 0,
    artisan: 0,
    metallurgist: 0,
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
  const state: PlanetState = {
    id: seed.id,
    starId: seed.starId,
    planetIndex: seed.planetIndex,
    isHabited,
    habitability: existing?.habitability ?? seed.habitability,
    population: isHabited ? Math.max(existing?.population ?? STARTING_HABITED_POPULATION, STARTING_HABITED_POPULATION) : 0,
    builtDistricts,
    buildings,
    urbanSubDistricts,
    economy: createEmptyPlanetEconomySummary(),
  };
  state.economy = calculatePlanetEconomy(state);
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
    crime: 0,
    stability: 50,
  };
}

function addJobCapacity(capacity: JobCapacity, job: JobKind, amount: number): void {
  capacity[job] = Math.max(0, capacity[job] + amount);
}

function addResource(counts: ResourceCounts, kind: ResourceKind, amount: number): void {
  counts[kind] += amount;
}

function applyJobResourceEffect(
  production: ResourceCounts,
  upkeep: ResourceCounts,
  job: JobKind,
  population: number,
): number {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  switch (job) {
    case "farmer":
      addResource(production, "food", units * 6);
      return 0;
    case "miner":
      addResource(production, "minerals", units * 5);
      return 0;
    case "technician":
      addResource(production, "energy", units * 5);
      return 0;
    case "clerk":
      addResource(production, "energy", units * 1);
      return units * 2;
    case "artisan":
      addResource(upkeep, "minerals", units * 4);
      addResource(production, "goods", units * 3);
      return 0;
    case "metallurgist":
      addResource(upkeep, "minerals", units * 5);
      addResource(production, "alloys", units * 2);
      return 0;
    case "researcher":
      addResource(upkeep, "energy", units * 2);
      addResource(upkeep, "goods", units * 1);
      addResource(production, "research", units * 3);
      return 0;
    case "administrator":
      addResource(upkeep, "energy", units * 1);
      addResource(upkeep, "goods", units * 1);
      return units * 3;
    default:
      return 0;
  }
}

function applyGoodsUpkeep(upkeep: ResourceCounts, jobClass: JobClass, population: number): void {
  const units = population / PEOPLE_PER_MONTHLY_UNIT;
  const upkeepPerUnit = jobClass === "upper" ? 0.4 : jobClass === "middle" ? 0.2 : 0.05;
  addResource(upkeep, "goods", units * upkeepPerUnit);
}

function applyBuildingEffect(
  building: BuildingKind | null,
  capacity: JobCapacity,
  builtDistricts: DistrictCounts,
  context?: { housing: number },
): number {
  if (!building) return 0;
  switch (building) {
    case "housingComplex":
      return 1_000_000_000;
    case "administrativeComplex":
      addJobCapacity(capacity, "administrator", 300_000_000);
      return 0;
    case "researchLabs":
      addJobCapacity(capacity, "researcher", 500_000_000);
      return 0;
    case "civilianFabricators":
      addJobCapacity(capacity, "artisan", 500_000_000);
      return 0;
    case "alloyFoundries":
      addJobCapacity(capacity, "metallurgist", 500_000_000);
      return 0;
    case "commercialForum":
      addJobCapacity(capacity, "clerk", 500_000_000);
      return 0;
    case "foodProcessingPlant":
      addJobCapacity(capacity, "farmer", builtDistricts.agriculture * 250_000_000);
      return 0;
    case "agroIndustrialKitchens":
      addJobCapacity(capacity, "farmer", -builtDistricts.agriculture * 250_000_000);
      addJobCapacity(capacity, "artisan", builtDistricts.agriculture * 250_000_000);
      return 0;
    case "mineralPurificationPlant":
      addJobCapacity(capacity, "miner", builtDistricts.mining * 250_000_000);
      return 0;
    case "oreSmelter":
      addJobCapacity(capacity, "miner", -builtDistricts.mining * 250_000_000);
      addJobCapacity(capacity, "metallurgist", builtDistricts.mining * 250_000_000);
      return 0;
    case "energyGrid":
      addJobCapacity(capacity, "technician", builtDistricts.generator * 250_000_000);
      return 0;
    case "capacitorWorkshops":
      addJobCapacity(capacity, "technician", -builtDistricts.generator * 250_000_000);
      addJobCapacity(capacity, "artisan", builtDistricts.generator * 250_000_000);
      return 0;
    default:
      return context?.housing ?? 0;
  }
}

export function calculatePlanetEconomy(state: PlanetState): PlanetEconomySummary {
  if (!state.isHabited) return createEmptyPlanetEconomySummary();

  const capacity = emptyJobCapacity();
  const built = state.builtDistricts;
  let housing = built.city * 1_500_000_000;

  addJobCapacity(capacity, "farmer", built.agriculture * 1_000_000_000);
  addJobCapacity(capacity, "miner", built.mining * 1_000_000_000);
  addJobCapacity(capacity, "technician", built.generator * 1_000_000_000);
  addJobCapacity(capacity, "clerk", built.city * 100_000_000);

  for (const subDistrict of state.urbanSubDistricts) {
    switch (subDistrict.kind) {
      case "residential":
        housing += built.city * 1_000_000_000;
        addJobCapacity(capacity, "clerk", built.city * 100_000_000);
        break;
      case "researchCampus":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "researcher", built.city * 500_000_000);
        break;
      case "mixedIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "artisan", built.city * 250_000_000);
        addJobCapacity(capacity, "metallurgist", built.city * 250_000_000);
        break;
      case "civilianIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "artisan", built.city * 500_000_000);
        break;
      case "heavyIndustry":
        housing -= built.city * 500_000_000;
        addJobCapacity(capacity, "metallurgist", built.city * 500_000_000);
        break;
      default:
        break;
    }

    for (const building of subDistrict.buildings) {
      housing += applyBuildingEffect(building, capacity, built);
    }
  }

  for (const building of state.buildings.city) {
    housing += applyBuildingEffect(building, capacity, built);
  }
  for (const building of state.buildings.generator) {
    applyBuildingEffect(building, capacity, built);
  }
  for (const building of state.buildings.mining) {
    applyBuildingEffect(building, capacity, built);
  }
  for (const building of state.buildings.agriculture) {
    applyBuildingEffect(building, capacity, built);
  }

  for (const job of JOB_KINDS) {
    capacity[job] = Math.max(0, Math.floor(capacity[job]));
  }

  let remaining = Math.floor(state.population);
  const popGroups: PopGroup[] = [];
  let employedPopulation = 0;
  const production = createEmptyResourceCounts();
  const upkeep = createEmptyResourceCounts();
  let amenities = 0;

  for (const job of JOB_FILL_ORDER) {
    const population = Math.min(remaining, capacity[job]);
    if (population <= 0) continue;
    const jobClass = JOB_CLASS_BY_KIND[job];
    popGroups.push({ job, class: jobClass, population });
    remaining -= population;
    employedPopulation += population;
    amenities += applyJobResourceEffect(production, upkeep, job, population);
    applyGoodsUpkeep(upkeep, jobClass, population);
  }

  const unemployedPopulation = Math.max(0, remaining);
  if (unemployedPopulation > 0) {
    popGroups.push({ job: "unemployed", class: "lower", population: unemployedPopulation });
  }
  capacity.unemployed = unemployedPopulation;

  addResource(upkeep, "food", (state.population / PEOPLE_PER_MONTHLY_UNIT) * 1);

  const net = createEmptyResourceCounts();
  const deficit = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) {
    net[resource] = production[resource] - upkeep[resource];
    deficit[resource] = Math.max(0, -net[resource]);
  }

  const unemploymentPercent = state.population > 0 ? (unemployedPopulation / state.population) * 100 : 0;
  const housingShortage = Math.max(0, state.population - housing);
  const housingShortagePercent = state.population > 0 ? (housingShortage / state.population) * 100 : 0;
  const crime = clamp(unemploymentPercent + housingShortagePercent, 0, 100);
  const amenityBalance = amenities - state.population / PEOPLE_PER_MONTHLY_UNIT;
  const stability = clamp(50 + clamp(amenityBalance / 500, -20, 20) - crime * 0.2, 0, 100);

  return {
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
    crime,
    stability,
  };
}

export function recalculatePlanetStateEconomy(state: PlanetState): PlanetState {
  const normalized = {
    ...state,
    builtDistricts: cloneDistricts(state.builtDistricts),
    buildings: normalizeBuildings(state.buildings),
    urbanSubDistricts: normalizeUrbanSubDistricts(state.urbanSubDistricts),
  };
  return {
    ...normalized,
    economy: calculatePlanetEconomy(normalized),
  };
}

export function isBuildingCompatible(
  building: BuildingKind,
  area: BuildingSlotArea,
  subDistrictKind?: UrbanSubDistrictKind,
): boolean {
  switch (building) {
    case "housingComplex":
      return area === "city" || (area === "urbanSubDistrict" && subDistrictKind === "residential");
    case "administrativeComplex":
      return area === "city";
    case "researchLabs":
      return area === "city" || (area === "urbanSubDistrict" && subDistrictKind === "researchCampus");
    case "civilianFabricators":
      return area === "city"
        || (area === "urbanSubDistrict" && (subDistrictKind === "mixedIndustry" || subDistrictKind === "civilianIndustry"));
    case "alloyFoundries":
      return area === "city"
        || (area === "urbanSubDistrict" && (subDistrictKind === "mixedIndustry" || subDistrictKind === "heavyIndustry"));
    case "commercialForum":
      return area === "city" || (area === "urbanSubDistrict" && subDistrictKind === "residential");
    case "foodProcessingPlant":
    case "agroIndustrialKitchens":
      return area === "agriculture";
    case "mineralPurificationPlant":
    case "oreSmelter":
      return area === "mining";
    case "energyGrid":
    case "capacitorWorkshops":
      return area === "generator";
    default:
      return false;
  }
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
  };
}

export function gameYearToMonthIndex(year: number): number {
  return Math.floor(year * 12);
}
