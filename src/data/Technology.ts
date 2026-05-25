import type { BuildingKind, JobKind, ResourceKind } from "./Economy";
import type { StarbaseBuildingKind, StarbaseShipKind } from "./Starbase";

export type TechId = string;

export type TechCategory =
  | "agriculture"
  | "industry"
  | "military"
  | "logistics"
  | "energy"
  | "computing"
  | "society";

export type ResearchModifierOperation = "flatBonus" | "multiplyBy";

export interface TechnologyResearchModifier {
  id: string;
  label: string;
  source: string;
  operation: ResearchModifierOperation;
  value: number;
  cap: number;
}

export interface TechnologyPassiveResearchRules {
  baseWeight?: number;
  passiveCapFraction?: number;
  allowPassiveCompletion?: boolean;
}

export type TechnologyEffect =
  | { type: "unlock_building"; building: BuildingKind }
  | { type: "unlock_starbase_building"; building: StarbaseBuildingKind }
  | { type: "unlock_ship_hull"; shipKind: StarbaseShipKind }
  | { type: "unlock_ship_module"; moduleId: string }
  | { type: "unlock_ship_section"; sectionModuleId: string }
  | { type: "job_output_mult"; job: JobKind; resource: ResourceKind; value: number }
  | { type: "construction_speed_mult"; value: number }
  | { type: "starbase_ship_build_speed_mult"; value: number };

export interface TechnologyDefinition {
  id: TechId;
  name: string;
  description: string;
  category: TechCategory;
  tier: number;
  cost: number;
  prerequisites: TechId[];
  positionInTree: { x: number; y: number };
  effects: TechnologyEffect[];
  researchModifiers: TechnologyResearchModifier[];
  passiveResearchRules?: TechnologyPassiveResearchRules;
  defaultUnlocked?: boolean;
}

export interface TechProgress {
  totalProgress: number;
  activeProgress: number;
  passiveProgress: number;
  completed: boolean;
}

export interface FactionTechState {
  factionId: number;
  activeTechId?: TechId;
  completedTechIds: TechId[];
  progressByTechId: Record<TechId, TechProgress>;
}

export interface ResearchContext {
  farmerJobs: number;
  minerJobs: number;
  researcherJobs: number;
  artisanJobs: number;
  metallurgistJobs: number;
  technicianJobs: number;
  fleetPower: number;
  shipCount: number;
  atWar: boolean;
  famine: boolean;
  lowFoodStockpile: boolean;
  foodIncome: number;
  mineralsIncome: number;
  alloyIncome: number;
  energyIncome: number;
  goodsIncome: number;
  researchIncome: number;
  researchLabs: number;
  starbaseResearchAnnexes: number;
}

export interface TechnologyModifierBreakdown {
  id: string;
  label: string;
  source: string;
  operation: ResearchModifierOperation;
  rawValue: number | boolean;
  bonus: number;
  cap: number;
}

export interface TechnologyResearchEvaluation {
  multiplier: number;
  bonus: number;
  passiveScore: number;
  breakdown: TechnologyModifierBreakdown[];
}

export interface TechnologyStatusView {
  id: TechId;
  completed: boolean;
  available: boolean;
  locked: boolean;
  active: boolean;
  progress: TechProgress;
  passiveCap: number;
  evaluation: TechnologyResearchEvaluation;
  missingPrerequisites: TechId[];
}

export interface FactionTechnologyView {
  factionId: number;
  activeTechId?: TechId;
  completedTechIds: TechId[];
  researchPerHour: number;
  activeResearchPerHour: number;
  passiveResearchPerHour: number;
  technologies: TechnologyStatusView[];
}

export const ACTIVE_RESEARCH_FRACTION = 0.8;
export const PASSIVE_RESEARCH_FRACTION = 0.2;
export const DEFAULT_PASSIVE_RESEARCH_CAP_FRACTION = 0.8;
export const MIN_TECH_RESEARCH_MULTIPLIER = 1;
export const MAX_TECH_RESEARCH_MULTIPLIER = 2;
export const BASELINE_RESEARCH_PER_HOUR = 0.25;

const passive = (baseWeight = 0.1): TechnologyPassiveResearchRules => ({
  baseWeight,
  passiveCapFraction: DEFAULT_PASSIVE_RESEARCH_CAP_FRACTION,
  allowPassiveCompletion: false,
});

const modifier = (
  id: string,
  label: string,
  source: keyof ResearchContext,
  operation: ResearchModifierOperation,
  value: number,
  cap: number,
): TechnologyResearchModifier => ({ id, label, source, operation, value, cap });

export const TECHNOLOGY_DEFINITIONS: TechnologyDefinition[] = [
  {
    id: "spacefaring_foundations",
    name: "Spacefaring Foundations",
    description: "Baseline orbital navigation, corvette hulls, and light swarmer combat layouts.",
    category: "logistics",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 3 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_ship_hull", shipKind: "corvette" },
      { type: "unlock_ship_section", sectionModuleId: "weapon_section_corvette_swarmer" },
      { type: "unlock_ship_section", sectionModuleId: "defense_section_corvette_swarmer" },
    ],
  },
  {
    id: "directed_energy_weapons",
    name: "Directed Energy Weapons",
    description: "Baseline laser emitters for small, medium, and large ship hardpoints.",
    category: "military",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 2 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_ship_module", moduleId: "weapon_laser_cannon" },
      { type: "unlock_ship_module", moduleId: "weapon_laser_cannon_medium" },
      { type: "unlock_ship_module", moduleId: "weapon_laser_cannon_large" },
    ],
  },
  {
    id: "missile_ordnance",
    name: "Missile Ordnance",
    description: "Baseline guided ordnance racks for standard ship hardpoints.",
    category: "military",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 2.35 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_ship_module", moduleId: "weapon_missile_rack_small" },
      { type: "unlock_ship_module", moduleId: "weapon_missile_rack" },
      { type: "unlock_ship_module", moduleId: "weapon_missile_rack_large" },
    ],
  },
  {
    id: "defensive_ship_systems",
    name: "Defensive Ship Systems",
    description: "Baseline shields, armor, hull reinforcement, sensors, targeting, and utility systems.",
    category: "military",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 2.7 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_ship_module", moduleId: "defense_shield_generator" },
      { type: "unlock_ship_module", moduleId: "defense_armor_plating" },
      { type: "unlock_ship_module", moduleId: "defense_reinforced_hull" },
      { type: "unlock_ship_module", moduleId: "utility_ion_propulsors" },
      { type: "unlock_ship_module", moduleId: "utility_optical_array" },
      { type: "unlock_ship_module", moduleId: "utility_fire_control" },
      { type: "unlock_ship_module", moduleId: "utility_reactor_capacitor" },
      { type: "unlock_ship_module", moduleId: "utility_repair_drones" },
      { type: "unlock_ship_module", moduleId: "utility_shield_capacitor" },
    ],
  },
  {
    id: "planetary_infrastructure",
    name: "Planetary Infrastructure",
    description: "Baseline settlement, services, agriculture, mining, power, and civilian industry.",
    category: "society",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 6 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_building", building: "housingComplex" },
      { type: "unlock_building", building: "administrativeComplex" },
      { type: "unlock_building", building: "researchLabs" },
      { type: "unlock_building", building: "civilianFabricators" },
      { type: "unlock_building", building: "alloyFoundries" },
      { type: "unlock_building", building: "commercialForum" },
      { type: "unlock_building", building: "foodProcessingPlant" },
      { type: "unlock_building", building: "mineralPurificationPlant" },
      { type: "unlock_building", building: "oreSmelter" },
      { type: "unlock_building", building: "energyGrid" },
      { type: "unlock_building", building: "capacitorWorkshops" },
      { type: "unlock_building", building: "entertainmentForum" },
      { type: "unlock_building", building: "securityOffice" },
    ],
  },
  {
    id: "orbital_operations",
    name: "Orbital Operations",
    description: "Baseline starbase logistics, shipyards, resource stations, and research annexes.",
    category: "logistics",
    tier: 0,
    cost: 0,
    prerequisites: [],
    positionInTree: { x: 0, y: 3.35 },
    defaultUnlocked: true,
    researchModifiers: [],
    effects: [
      { type: "unlock_starbase_building", building: "shipyard" },
      { type: "unlock_starbase_building", building: "solarArray" },
      { type: "unlock_starbase_building", building: "hydroponicsBay" },
      { type: "unlock_starbase_building", building: "alloyAssemblyDock" },
      { type: "unlock_starbase_building", building: "researchAnnex" },
      { type: "unlock_starbase_building", building: "logisticsDepot" },
    ],
  },
  {
    id: "field_biochemistry",
    name: "Field Biochemistry",
    description: "Crop chemistry and soil microbiome management improve agricultural throughput.",
    category: "agriculture",
    tier: 1,
    cost: 1200,
    prerequisites: ["planetary_infrastructure"],
    positionInTree: { x: 1, y: 0 },
    passiveResearchRules: passive(0.15),
    researchModifiers: [
      modifier("farmer_job_bonus", "Farmers", "farmerJobs", "multiplyBy", 0.0001, 0.35),
      modifier("low_food_pressure", "Low food stockpile", "lowFoodStockpile", "flatBonus", 0.08, 0.08),
      modifier("famine_pressure", "Famine pressure", "famine", "flatBonus", 0.15, 0.15),
    ],
    effects: [{ type: "job_output_mult", job: "farmer", resource: "food", value: 0.1 }],
  },
  {
    id: "agro_industrial_supply_chains",
    name: "Agro-Industrial Supply Chains",
    description: "Large-scale food processing networks support industrial kitchens.",
    category: "agriculture",
    tier: 2,
    cost: 2400,
    prerequisites: ["field_biochemistry"],
    positionInTree: { x: 2, y: 0 },
    passiveResearchRules: passive(0.12),
    researchModifiers: [
      modifier("farmer_job_bonus", "Farmers", "farmerJobs", "multiplyBy", 0.00008, 0.28),
      modifier("artisan_job_bonus", "Artisans", "artisanJobs", "multiplyBy", 0.00005, 0.18),
      modifier("low_food_pressure", "Low food stockpile", "lowFoodStockpile", "flatBonus", 0.08, 0.08),
    ],
    effects: [{ type: "unlock_building", building: "agroIndustrialKitchens" }],
  },
  {
    id: "industrial_tooling",
    name: "Industrial Tooling",
    description: "Standardized mining tools and plant automation increase mineral output.",
    category: "industry",
    tier: 1,
    cost: 1200,
    prerequisites: ["planetary_infrastructure"],
    positionInTree: { x: 1, y: 1 },
    passiveResearchRules: passive(0.15),
    researchModifiers: [
      modifier("miner_job_bonus", "Miners", "minerJobs", "multiplyBy", 0.0001, 0.35),
      modifier("mineral_income_bonus", "Mineral income", "mineralsIncome", "multiplyBy", 0.00003, 0.2),
    ],
    effects: [{ type: "job_output_mult", job: "miner", resource: "minerals", value: 0.1 }],
  },
  {
    id: "predictive_ore_sorting",
    name: "Predictive Ore Sorting",
    description: "Process models route higher-grade input into alloy production.",
    category: "industry",
    tier: 2,
    cost: 2200,
    prerequisites: ["industrial_tooling"],
    positionInTree: { x: 2, y: 1 },
    passiveResearchRules: passive(0.12),
    researchModifiers: [
      modifier("metallurgist_job_bonus", "Metallurgists", "metallurgistJobs", "multiplyBy", 0.00009, 0.32),
      modifier("alloy_income_bonus", "Alloy income", "alloyIncome", "multiplyBy", 0.00005, 0.25),
    ],
    effects: [{ type: "job_output_mult", job: "metallurgist", resource: "alloys", value: 0.1 }],
  },
  {
    id: "microgravity_fabrication",
    name: "Microgravity Fabrication",
    description: "Orbital workshops exploit low-gravity manufacturing conditions.",
    category: "industry",
    tier: 2,
    cost: 2400,
    prerequisites: ["industrial_tooling", "orbital_operations"],
    positionInTree: { x: 2, y: 1.35 },
    passiveResearchRules: passive(0.1),
    researchModifiers: [
      modifier("research_annex_bonus", "Research annexes", "starbaseResearchAnnexes", "multiplyBy", 0.05, 0.25),
      modifier("miner_job_bonus", "Miners", "minerJobs", "multiplyBy", 0.00005, 0.18),
    ],
    effects: [{ type: "unlock_starbase_building", building: "orbitalFabricator" }],
  },
  {
    id: "grid_harmonics",
    name: "Grid Harmonics",
    description: "Power routing algorithms stabilize and improve technician output.",
    category: "energy",
    tier: 1,
    cost: 1200,
    prerequisites: ["planetary_infrastructure"],
    positionInTree: { x: 1, y: 4 },
    passiveResearchRules: passive(0.15),
    researchModifiers: [
      modifier("technician_job_bonus", "Technicians", "technicianJobs", "multiplyBy", 0.0001, 0.35),
      modifier("energy_income_bonus", "Energy income", "energyIncome", "multiplyBy", 0.00003, 0.2),
    ],
    effects: [{ type: "job_output_mult", job: "technician", resource: "energy", value: 0.1 }],
  },
  {
    id: "applied_research_methods",
    name: "Applied Research Methods",
    description: "Repeatable lab protocols increase researcher throughput.",
    category: "computing",
    tier: 1,
    cost: 1200,
    prerequisites: ["planetary_infrastructure"],
    positionInTree: { x: 1, y: 5 },
    passiveResearchRules: passive(0.15),
    researchModifiers: [
      modifier("researcher_job_bonus", "Researchers", "researcherJobs", "multiplyBy", 0.0001, 0.35),
      modifier("research_lab_bonus", "Research labs", "researchLabs", "multiplyBy", 0.06, 0.3),
      modifier("research_annex_bonus", "Research annexes", "starbaseResearchAnnexes", "multiplyBy", 0.05, 0.25),
    ],
    effects: [{ type: "job_output_mult", job: "researcher", resource: "research", value: 0.1 }],
  },
  {
    id: "civilian_fabrication_models",
    name: "Civilian Fabrication Models",
    description: "Factory planning models improve advanced goods production.",
    category: "industry",
    tier: 1,
    cost: 1200,
    prerequisites: ["planetary_infrastructure"],
    positionInTree: { x: 1, y: 1.7 },
    passiveResearchRules: passive(0.12),
    researchModifiers: [
      modifier("artisan_job_bonus", "Artisans", "artisanJobs", "multiplyBy", 0.0001, 0.35),
      modifier("goods_income_bonus", "Goods income", "goodsIncome", "multiplyBy", 0.00004, 0.2),
    ],
    effects: [{ type: "job_output_mult", job: "artisan", resource: "goods", value: 0.1 }],
  },
  {
    id: "logistics_accounting",
    name: "Logistics Accounting",
    description: "Shared construction ledgers reduce waste and idle time in planetary projects.",
    category: "logistics",
    tier: 1,
    cost: 1300,
    prerequisites: ["orbital_operations"],
    positionInTree: { x: 1, y: 3.2 },
    passiveResearchRules: passive(0.1),
    researchModifiers: [
      modifier("administrator_pressure", "Research income", "researchIncome", "multiplyBy", 0.00004, 0.2),
      modifier("ship_count_bonus", "Ship operations", "shipCount", "multiplyBy", 0.01, 0.2),
    ],
    effects: [{ type: "construction_speed_mult", value: 0.1 }],
  },
  {
    id: "integrated_fleet_logistics",
    name: "Integrated Fleet Logistics",
    description: "Standardized docking, supply, and assembly practices speed starbase ship queues.",
    category: "logistics",
    tier: 2,
    cost: 2400,
    prerequisites: ["logistics_accounting"],
    positionInTree: { x: 2, y: 3.2 },
    passiveResearchRules: passive(0.1),
    researchModifiers: [
      modifier("ship_count_bonus", "Ships", "shipCount", "multiplyBy", 0.012, 0.25),
      modifier("fleet_power_bonus", "Fleet power", "fleetPower", "multiplyBy", 0.00004, 0.25),
    ],
    effects: [{ type: "starbase_ship_build_speed_mult", value: 0.1 }],
  },
  {
    id: "point_defense_networks",
    name: "Point Defense Networks",
    description: "Short-range tracking systems unlock point-defense weapon modules.",
    category: "military",
    tier: 1,
    cost: 1500,
    prerequisites: ["directed_energy_weapons"],
    positionInTree: { x: 1, y: 2.4 },
    passiveResearchRules: passive(0.12),
    researchModifiers: [
      modifier("at_war_bonus", "At war", "atWar", "flatBonus", 0.15, 0.15),
      modifier("fleet_power_bonus", "Fleet power", "fleetPower", "multiplyBy", 0.00005, 0.3),
    ],
    effects: [
      { type: "unlock_ship_module", moduleId: "weapon_point_defense" },
      { type: "unlock_ship_module", moduleId: "weapon_point_defense_medium" },
      { type: "unlock_ship_module", moduleId: "weapon_point_defense_large" },
    ],
  },
  {
    id: "heavy_corvette_frames",
    name: "Heavy Corvette Frames",
    description: "Reinforced corvette cores unlock the Tanker Core and its paired defensive frame.",
    category: "military",
    tier: 2,
    cost: 2600,
    prerequisites: ["spacefaring_foundations"],
    positionInTree: { x: 2, y: 2.8 },
    passiveResearchRules: passive(0.1),
    researchModifiers: [
      modifier("at_war_bonus", "At war", "atWar", "flatBonus", 0.12, 0.12),
      modifier("fleet_power_bonus", "Fleet power", "fleetPower", "multiplyBy", 0.00005, 0.35),
      modifier("alloy_income_bonus", "Alloy income", "alloyIncome", "multiplyBy", 0.00004, 0.2),
    ],
    effects: [
      { type: "unlock_ship_section", sectionModuleId: "weapon_section_corvette_tanker" },
      { type: "unlock_ship_section", sectionModuleId: "defense_section_corvette_tanker" },
    ],
  },
];

export const TECHNOLOGY_BY_ID: Record<TechId, TechnologyDefinition> = Object.fromEntries(
  TECHNOLOGY_DEFINITIONS.map((tech) => [tech.id, tech]),
);

export const DEFAULT_COMPLETED_TECH_IDS: TechId[] = TECHNOLOGY_DEFINITIONS
  .filter((tech) => tech.defaultUnlocked)
  .map((tech) => tech.id);

export function createEmptyTechProgress(completed = false): TechProgress {
  return {
    totalProgress: 0,
    activeProgress: 0,
    passiveProgress: 0,
    completed,
  };
}

export function getPassiveCapFraction(tech: TechnologyDefinition): number {
  return tech.passiveResearchRules?.passiveCapFraction ?? DEFAULT_PASSIVE_RESEARCH_CAP_FRACTION;
}

export function getPassiveProgressCap(tech: TechnologyDefinition): number {
  if (tech.passiveResearchRules?.allowPassiveCompletion) return tech.cost;
  return tech.cost * getPassiveCapFraction(tech);
}

export function normalizeFactionTechState(
  factionId: number,
  raw: Partial<FactionTechState> | undefined,
  extraCompletedTechIds: Iterable<TechId> = [],
): FactionTechState {
  const validTechIds = new Set(TECHNOLOGY_DEFINITIONS.map((tech) => tech.id));
  const completed = new Set<TechId>(DEFAULT_COMPLETED_TECH_IDS);
  for (const techId of raw?.completedTechIds ?? []) {
    if (validTechIds.has(techId)) completed.add(techId);
  }
  for (const techId of extraCompletedTechIds) {
    if (validTechIds.has(techId)) completed.add(techId);
  }

  const progressByTechId: Record<TechId, TechProgress> = {};
  const rawProgress = raw?.progressByTechId ?? {};
  for (const tech of TECHNOLOGY_DEFINITIONS) {
    const progress = rawProgress[tech.id];
    const isCompleted = completed.has(tech.id) || progress?.completed === true || tech.cost <= 0;
    progressByTechId[tech.id] = {
      totalProgress: isCompleted ? tech.cost : Math.max(0, Math.min(tech.cost, Number(progress?.totalProgress) || 0)),
      activeProgress: Math.max(0, Math.min(tech.cost, Number(progress?.activeProgress) || 0)),
      passiveProgress: Math.max(0, Math.min(getPassiveProgressCap(tech), Number(progress?.passiveProgress) || 0)),
      completed: isCompleted,
    };
    if (isCompleted) {
      progressByTechId[tech.id].totalProgress = tech.cost;
      completed.add(tech.id);
    }
  }

  const activeTechId = raw?.activeTechId && validTechIds.has(raw.activeTechId)
    ? raw.activeTechId
    : undefined;

  return {
    factionId,
    activeTechId,
    completedTechIds: Array.from(completed).filter((techId) => validTechIds.has(techId)),
    progressByTechId,
  };
}

export function isTechnologyCompleted(state: FactionTechState | undefined, techId: TechId): boolean {
  return state?.completedTechIds.includes(techId) === true || state?.progressByTechId[techId]?.completed === true;
}

export function getMissingPrerequisites(tech: TechnologyDefinition, state: FactionTechState): TechId[] {
  return tech.prerequisites.filter((techId) => !isTechnologyCompleted(state, techId));
}

export function isTechnologyAvailable(tech: TechnologyDefinition, state: FactionTechState): boolean {
  return !isTechnologyCompleted(state, tech.id) && getMissingPrerequisites(tech, state).length === 0;
}

function getContextValue(context: ResearchContext, source: string): number | boolean {
  return (context as unknown as Record<string, number | boolean>)[source] ?? 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function evaluateResearchModifier(
  modifier: TechnologyResearchModifier,
  context: ResearchContext,
): TechnologyModifierBreakdown {
  const rawValue = getContextValue(context, modifier.source);
  const numericValue = typeof rawValue === "boolean" ? (rawValue ? 1 : 0) : Number(rawValue) || 0;
  const unclamped = modifier.operation === "flatBonus"
    ? (numericValue > 0 ? modifier.value : 0)
    : numericValue * modifier.value;
  const cap = Math.abs(modifier.cap);
  return {
    id: modifier.id,
    label: modifier.label,
    source: modifier.source,
    operation: modifier.operation,
    rawValue,
    bonus: clamp(unclamped, -cap, cap),
    cap,
  };
}

export function evaluateTechnologyResearch(
  tech: TechnologyDefinition,
  context: ResearchContext,
): TechnologyResearchEvaluation {
  const breakdown = tech.researchModifiers.map((modifierDef) => evaluateResearchModifier(modifierDef, context));
  const bonus = breakdown.reduce((sum, entry) => sum + entry.bonus, 0);
  const multiplier = clamp(1 + bonus, MIN_TECH_RESEARCH_MULTIPLIER, MAX_TECH_RESEARCH_MULTIPLIER);
  const positiveAffinity = breakdown.reduce((sum, entry) => sum + Math.max(0, entry.bonus), 0);
  const passiveScore = Math.max(0, (tech.passiveResearchRules?.baseWeight ?? 0.1) + positiveAffinity);
  return { multiplier, bonus: multiplier - 1, passiveScore, breakdown };
}

function requiredTechIdsForEffect(predicate: (effect: TechnologyEffect) => boolean): TechId[] {
  return TECHNOLOGY_DEFINITIONS
    .filter((tech) => tech.effects.some(predicate))
    .map((tech) => tech.id);
}

export function getRequiredTechIdsForBuilding(building: BuildingKind): TechId[] {
  return requiredTechIdsForEffect((effect) => effect.type === "unlock_building" && effect.building === building);
}

export function getRequiredTechIdsForStarbaseBuilding(building: StarbaseBuildingKind): TechId[] {
  return requiredTechIdsForEffect((effect) => effect.type === "unlock_starbase_building" && effect.building === building);
}

export function getRequiredTechIdsForShipModule(moduleId: string): TechId[] {
  return requiredTechIdsForEffect((effect) => effect.type === "unlock_ship_module" && effect.moduleId === moduleId);
}

export function getRequiredTechIdsForShipSection(sectionModuleId: string): TechId[] {
  return requiredTechIdsForEffect((effect) => effect.type === "unlock_ship_section" && effect.sectionModuleId === sectionModuleId);
}

export function getRequiredTechIdsForShipHull(shipKind: StarbaseShipKind): TechId[] {
  return requiredTechIdsForEffect((effect) => effect.type === "unlock_ship_hull" && effect.shipKind === shipKind);
}

export function isUnlockedByAnyRequiredTech(state: FactionTechState | undefined, requiredTechIds: TechId[]): boolean {
  if (requiredTechIds.length === 0) return true;
  return requiredTechIds.some((techId) => isTechnologyCompleted(state, techId));
}

export function getFirstRequiredTechName(requiredTechIds: TechId[]): string {
  return TECHNOLOGY_BY_ID[requiredTechIds[0]]?.name ?? "required technology";
}

export function getCompletedTechnologyEffects(state: FactionTechState | undefined): TechnologyEffect[] {
  if (!state) return [];
  return state.completedTechIds.flatMap((techId) => TECHNOLOGY_BY_ID[techId]?.effects ?? []);
}
