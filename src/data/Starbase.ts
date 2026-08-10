import { createEmptyResourceCounts, RESOURCE_KINDS } from "./Economy";
import type { ResourceCounts } from "./Economy";
import type { CombatAttackClass, CombatCounterClass, RangeBand } from "../game/CombatTypes";

export type StarbaseLevel = "outpost" | "starbase" | "starhold" | "starFortress";
export type StarbaseBuildingKind =
  | "listeningStation"
  | "shipyard"
  | "solarArray"
  | "hydroponicsBay"
  | "orbitalFabricator"
  | "alloyAssemblyDock"
  | "researchAnnex"
  | "logisticsDepot"
  | "mineralHarvester";
export type StarbaseShipKind =
  | "corvette"
  | "destroyer"
  | "cruiser"
  | "battleship"
  | "defensePlatform"
  | "scienceShip"
  | "armyShip"
  | "constructionShip"
  | "colonizationShip";

export type WeaponKind = "laser" | "missile" | "pointDefense" | "railgun" | "plasma";

export interface WeaponMountDefinition {
  id?: string;
  kind: WeaponKind;
  label?: string;
  barrels: number;
  damage: number;
  shieldPenetration: number;
  armorPenetration: number;
  accuracy: number;
  tracking?: number;
  minRangeBand?: RangeBand;
  maxRangeBand?: RangeBand;
  optimalRangeBand?: RangeBand;
  cooldownRounds?: number;
  /** Sustained cooldown in game hours. Falls back to cooldownRounds for legacy mounts. */
  cooldownHours?: number;
  attackClass?: CombatAttackClass;
  travelSpeed?: number;
  shieldDamageMultiplier?: number;
  armorDamageMultiplier?: number;
  hullDamageMultiplier?: number;
  interceptableBy?: CombatCounterClass[];
  counterClass?: CombatCounterClass;
  intercepts?: CombatAttackClass[];
  projectileHp?: number;
  projectileEvasion?: number;
  guided?: boolean;
}

export interface CombatStats {
  maxShield: number;
  maxArmor: number;
  maxHull: number;
  evasion: number;
  sensorRange: number;
  weaponMounts: WeaponMountDefinition[];
}

export const WEAPON_KIND_DEFINITIONS: Record<WeaponKind, {
  range: number;
  minRangeBand: RangeBand;
  maxRangeBand: RangeBand;
  optimalRangeBand: RangeBand;
  cooldownRounds: number;
}> = {
  laser: {
    range: 2,
    minRangeBand: "close",
    maxRangeBand: "medium",
    optimalRangeBand: "medium",
    cooldownRounds: 1,
  },
  missile: {
    range: 4,
    minRangeBand: "medium",
    maxRangeBand: "long",
    optimalRangeBand: "long",
    cooldownRounds: 2,
  },
  pointDefense: {
    range: 1,
    minRangeBand: "pointBlank",
    maxRangeBand: "close",
    optimalRangeBand: "close",
    cooldownRounds: 1,
  },
  railgun: {
    range: 3,
    minRangeBand: "close",
    maxRangeBand: "long",
    optimalRangeBand: "medium",
    cooldownRounds: 1,
  },
  plasma: {
    range: 3,
    minRangeBand: "medium",
    maxRangeBand: "long",
    optimalRangeBand: "medium",
    cooldownRounds: 2,
  },
};

export interface StarbaseEconomy {
  production: ResourceCounts;
  upkeep: ResourceCounts;
  net: ResourceCounts;
}

export interface StarbaseUpgradeDefinition {
  targetLevel: StarbaseLevel;
  alloyCost: number;
  cost: ResourceCounts;
  buildDays: number;
}

export interface StarbaseLevelDefinition {
  level: StarbaseLevel;
  label: string;
  description: string;
  buildingSlots: number;
  defensePlatformCapacity: number;
  production: ResourceCounts;
  upkeep: ResourceCounts;
  combat: CombatStats;
  upgrade?: StarbaseUpgradeDefinition;
}

export interface StarbaseConstructionQueueItem {
  id: string;
  label: string;
  kind: "upgrade" | "building";
  cost: ResourceCounts;
  remainingDays: number;
  totalDays: number;
  targetLevel?: StarbaseLevel;
  buildingKind?: StarbaseBuildingKind;
  slotIndex?: number;
}

export type StarbaseShipQueueKind = "build" | "upgrade" | "armyBuild";

export interface StarbaseShipQueueItem {
  id: string;
  kind: StarbaseShipQueueKind;
  shipKind: StarbaseShipKind;
  designId?: string | null;
  targetDesignId?: string | null;
  shipId?: string | null;
  label: string;
  cost: ResourceCounts;
  upfrontCost: ResourceCounts;
  resourceUpkeepPerDay: ResourceCounts;
  totalDays: number;
  remainingDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
  reservedCrew: number;
  armyTypeId?: import("./Armies").ArmyTypeId;
  speciesId?: string;
}

export interface StarbaseBuildingDefinition {
  kind: StarbaseBuildingKind;
  label: string;
  description: string;
  production: ResourceCounts;
  upkeep: ResourceCounts;
  cost: ResourceCounts;
  buildDays: number;
  shipyards?: number;
  sensorSuiteIds?: import("./Intelligence").SensorSuiteId[];
}

export interface StarbaseShipDefinition {
  kind: StarbaseShipKind;
  label: string;
  className: string;
  description: string;
  speed: number;
  buildDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
  upkeep: ResourceCounts;
  combat: CombatStats;
}

function resources(values: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...values,
  };
}

function scaleResources(values: ResourceCounts, scale: number): ResourceCounts {
  return {
    food: values.food * scale,
    minerals: values.minerals * scale,
    energy: values.energy * scale,
    goods: values.goods * scale,
    alloys: values.alloys * scale,
    research: values.research * scale,
  };
}

function subtractResources(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return {
    food: a.food - b.food,
    minerals: a.minerals - b.minerals,
    energy: a.energy - b.energy,
    goods: a.goods - b.goods,
    alloys: a.alloys - b.alloys,
    research: a.research - b.research,
  };
}

function addResources(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  return {
    food: a.food + b.food,
    minerals: a.minerals + b.minerals,
    energy: a.energy + b.energy,
    goods: a.goods + b.goods,
    alloys: a.alloys + b.alloys,
    research: a.research + b.research,
  };
}

function createConstructionId(prefix: string, parts: Array<string | number | undefined>): string {
  return `${prefix}-${parts.filter((part) => part !== undefined).join("-")}-${Date.now().toString(36)}`;
}

function createLaserMount(overrides: Partial<WeaponMountDefinition> = {}): WeaponMountDefinition {
  return {
    id: "laser",
    kind: "laser",
    label: "Laser Battery",
    barrels: 2,
    damage: 12,
    shieldPenetration: 0.12,
    armorPenetration: 0.35,
    accuracy: 0.82,
    minRangeBand: WEAPON_KIND_DEFINITIONS.laser.minRangeBand,
    maxRangeBand: WEAPON_KIND_DEFINITIONS.laser.maxRangeBand,
    optimalRangeBand: WEAPON_KIND_DEFINITIONS.laser.optimalRangeBand,
    cooldownRounds: WEAPON_KIND_DEFINITIONS.laser.cooldownRounds,
    ...overrides,
  };
}

function repeatMount(mount: WeaponMountDefinition, count: number): WeaponMountDefinition[] {
  return Array.from({ length: Math.max(1, count) }, () => ({ ...mount }));
}

export const STARBASE_LEVEL_ORDER: StarbaseLevel[] = ["outpost", "starbase", "starhold", "starFortress"];

export const STARBASE_LEVEL_DEFINITIONS: Record<StarbaseLevel, StarbaseLevelDefinition> = {
  outpost: {
    level: "outpost",
    label: "Outpost",
    description: "A minimal orbital foothold with basic command, docking, and claim projection.",
    buildingSlots: 2,
    defensePlatformCapacity: 2,
    production: resources({}),
    upkeep: resources({ energy: 4, food: 0.25, goods: 0.5, alloys: 0.3 }),
    combat: {
      maxShield: 700,
      maxArmor: 500,
      maxHull: 1600,
      evasion: 0.05,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 20, barrels: 3, accuracy: 0.8, armorPenetration: 0.4 }), 3),
    },
    upgrade: { targetLevel: "starbase", alloyCost: 1_200, cost: resources({ minerals: 2_500, alloys: 1_200, goods: 150 }), buildDays: 360 },
  },
  starbase: {
    level: "starbase",
    label: "Starbase",
    description: "A permanent orbital base with expanded logistics and defensive operations.",
    buildingSlots: 4,
    defensePlatformCapacity: 4,
    production: resources({}),
    upkeep: resources({ energy: 10, food: 1, goods: 1.5, alloys: 1 }),
    combat: {
      maxShield: 1500,
      maxArmor: 1100,
      maxHull: 6000,
      evasion: 0.04,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 26, barrels: 4, accuracy: 0.82, armorPenetration: 0.4 }), 5),
    },
    upgrade: { targetLevel: "starhold", alloyCost: 4_000, cost: resources({ minerals: 8_000, alloys: 4_000, goods: 600 }), buildDays: 900 },
  },
  starhold: {
    level: "starhold",
    label: "Starhold",
    description: "A hardened system command node with heavy docking and fleet support infrastructure.",
    buildingSlots: 6,
    defensePlatformCapacity: 8,
    production: resources({}),
    upkeep: resources({ energy: 22, food: 3, goods: 4, alloys: 3, minerals: 1 }),
    combat: {
      maxShield: 2500,
      maxArmor: 1800,
      maxHull: 12000,
      evasion: 0.04,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 30, barrels: 4, accuracy: 0.84, armorPenetration: 0.45 }), 8),
    },
    upgrade: { targetLevel: "starFortress", alloyCost: 10_000, cost: resources({ minerals: 20_000, alloys: 10_000, goods: 1_500 }), buildDays: 1_800 },
  },
  starFortress: {
    level: "starFortress",
    label: "Star Fortress",
    description: "A major military installation with deep reserves and large-scale defensive systems.",
    buildingSlots: 9,
    defensePlatformCapacity: 12,
    production: resources({}),
    upkeep: resources({ energy: 45, food: 7, goods: 8, alloys: 7, minerals: 4 }),
    combat: {
      maxShield: 3500,
      maxArmor: 2600,
      maxHull: 18000,
      evasion: 0.03,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 34, barrels: 4, accuracy: 0.86, armorPenetration: 0.5 }), 10),
    },
  },
};

export const STARBASE_BUILDING_KINDS: StarbaseBuildingKind[] = [
  "listeningStation",
  "shipyard",
  "solarArray",
  "hydroponicsBay",
  "orbitalFabricator",
  "alloyAssemblyDock",
  "researchAnnex",
  "logisticsDepot",
  "mineralHarvester",
];

export const STARBASE_BUILDING_DEFINITIONS: Record<StarbaseBuildingKind, StarbaseBuildingDefinition> = {
  listeningStation: {
    kind: "listeningStation",
    label: "Listening Station",
    description: "Long-baseline arrays catalogue distant systems and maintain command telemetry across friendly space.",
    production: resources({}),
    upkeep: resources({ energy: 2, goods: 0.25 }),
    cost: resources({ minerals: 2_500, alloys: 300, goods: 150 }),
    buildDays: 120,
    sensorSuiteIds: ["listeningStationSensors"],
  },
  shipyard: {
    kind: "shipyard",
    label: "Shipyard",
    description: "Dedicated construction slip for assembling military and utility hulls in orbit.",
    production: resources({}),
    upkeep: resources({ energy: 3, goods: 0.5, alloys: 0.25 }),
    cost: resources({ minerals: 3_500, alloys: 500 }),
    buildDays: 180,
    shipyards: 1,
  },
  solarArray: {
    kind: "solarArray",
    label: "Solar Array",
    description: "Wide collector wings convert stellar radiation into station power.",
    production: resources({ energy: 10 }),
    upkeep: resources({ alloys: 0.1 }),
    cost: resources({ minerals: 3_000, alloys: 300 }),
    buildDays: 120,
  },
  hydroponicsBay: {
    kind: "hydroponicsBay",
    label: "Hydroponics Bay",
    description: "Pressurized cultivation decks grow food for crews and passing fleets.",
    production: resources({ food: 8 }),
    upkeep: resources({ energy: 1, goods: 0.2 }),
    cost: resources({ minerals: 2_500, goods: 200 }),
    buildDays: 120,
  },
  orbitalFabricator: {
    kind: "orbitalFabricator",
    label: "Orbital Fabricator",
    description: "Microgravity workshops turn imported minerals into advanced goods.",
    production: resources({ goods: 4 }),
    upkeep: resources({ minerals: 5, energy: 2 }),
    cost: resources({ minerals: 4_500, alloys: 350 }),
    buildDays: 240,
  },
  alloyAssemblyDock: {
    kind: "alloyAssemblyDock",
    label: "Alloy Assembly Dock",
    description: "Heavy orbital foundries refine imported minerals into ship-grade alloys.",
    production: resources({ alloys: 3 }),
    upkeep: resources({ minerals: 7, energy: 3 }),
    cost: resources({ minerals: 6_000, alloys: 700 }),
    buildDays: 300,
  },
  researchAnnex: {
    kind: "researchAnnex",
    label: "Research Annex",
    description: "Observation labs and test bays generate research from orbital operations.",
    production: resources({ research: 5 }),
    upkeep: resources({ energy: 3, goods: 0.5 }),
    cost: resources({ minerals: 5_000, goods: 400 }),
    buildDays: 240,
  },
  logisticsDepot: {
    kind: "logisticsDepot",
    label: "Logistics Depot",
    description: "Storage, docking, and maintenance facilities reduce starbase upkeep by 15% and ship-construction resource demand by 5%.",
    production: resources({}),
    upkeep: resources({ energy: 1, goods: 0.25 }),
    cost: resources({ minerals: 3_500, alloys: 300 }),
    buildDays: 180,
  },
  mineralHarvester: {
    kind: "mineralHarvester",
    label: "Mineral Harvester",
    description: "Electrostatic collectors scrape mineral-rich dust straight from the nebula. Only buildable inside a dust cloud.",
    production: resources({ minerals: 10 }),
    upkeep: resources({ energy: 2 }),
    cost: resources({ minerals: 4_500, alloys: 400 }),
    buildDays: 240,
  },
};

export interface ShipModelDefinition {
  modelPath: string;
  modelFile: string;
  modelFormat: "obj" | "glb";
  systemTargetSize: number;
  tacticalTargetSize: number;
  previewTargetSize: number;
  scaleMultiplier?: number;
  modelPitch?: number;
  modelRoll?: number;
  modelYawOffset?: number;
  trailSocketName?: string;
  trailAxis?: "+X" | "-X" | "+Y" | "-Y" | "+Z" | "-Z";
  trailSocketOffset?: number;
  trailSocketLift?: number;
  trailOffsetY?: number;
}

export interface StarbaseModelDefinition {
  level: StarbaseLevel;
  modelPath: string;
  modelFile: string;
  modelFormat: "glb";
  targetSize: number;
  modelPitch?: number;
  modelRoll?: number;
  modelYawOffset?: number;
}

export const SHIP_MODEL_DEFINITIONS: Record<StarbaseShipKind, ShipModelDefinition> = {
  corvette: {
    modelPath: "/ships/corvette/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 0.82,
    tacticalTargetSize: 0.64,
    previewTargetSize: 3.6,
    trailOffsetY: -0.18,
  },
  constructionShip: {
    modelPath: "/ships/construction_ship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.02,
    tacticalTargetSize: 0.82,
    previewTargetSize: 3.7,
    trailOffsetY: -0.12,
  },
  colonizationShip: {
    modelPath: "/ships/colonization_ship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.12,
    tacticalTargetSize: 0.9,
    previewTargetSize: 3.9,
    trailOffsetY: -0.14,
  },
  destroyer: {
    modelPath: "/ships/destroyer/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.08,
    tacticalTargetSize: 0.86,
    previewTargetSize: 3.85,
    trailOffsetY: -0.14,
  },
  cruiser: {
    modelPath: "/ships/cruiser/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.32,
    tacticalTargetSize: 1.08,
    previewTargetSize: 4.05,
    trailOffsetY: -0.16,
  },
  battleship: {
    modelPath: "/ships/battleship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.68,
    tacticalTargetSize: 1.36,
    previewTargetSize: 4.35,
    trailOffsetY: -0.2,
  },
  defensePlatform: {
    modelPath: "/ships/defense_platform/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.3,
    tacticalTargetSize: 1.08,
    previewTargetSize: 4.1,
  },
  scienceShip: {
    modelPath: "/ships/science_ship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.08,
    tacticalTargetSize: 0.86,
    previewTargetSize: 3.9,
    trailOffsetY: -0.14,
  },
  armyShip: {
    modelPath: "/ships/army_ship/",
    modelFile: "model.glb",
    modelFormat: "glb",
    systemTargetSize: 1.18,
    tacticalTargetSize: 0.94,
    previewTargetSize: 4,
    trailOffsetY: -0.16,
  },
};

export const STARBASE_MODEL_DEFINITIONS: Record<StarbaseLevel, StarbaseModelDefinition> = {
  outpost: {
    level: "outpost",
    modelPath: "/starbases/outpost/",
    modelFile: "model.glb",
    modelFormat: "glb",
    targetSize: 7,
  },
  starbase: {
    level: "starbase",
    modelPath: "/starbases/starbase/",
    modelFile: "model.glb",
    modelFormat: "glb",
    targetSize: 9.7,
  },
  starhold: {
    level: "starhold",
    modelPath: "/starbases/starhold/",
    modelFile: "model.glb",
    modelFormat: "glb",
    targetSize: 11.7,
  },
  starFortress: {
    level: "starFortress",
    modelPath: "/starbases/star_fortress/",
    modelFile: "model.glb",
    modelFormat: "glb",
    targetSize: 14,
  },
};

export const STARBASE_SHIP_KINDS: StarbaseShipKind[] = [
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

/** Fixed Army Ships are commissioned only through Army recruitment. */
export const PLAYER_DESIGNABLE_SHIP_KINDS: StarbaseShipKind[] = STARBASE_SHIP_KINDS.filter((kind) => kind !== "armyShip");

export const STARBASE_SHIP_DEFINITIONS: Record<StarbaseShipKind, StarbaseShipDefinition> = {
  corvette: {
    kind: "corvette",
    label: "Corvette",
    className: "Falcon-class",
    description: "Fast escort hull for patrols, interception, and early fleet operations.",
    speed: 1.22,
    buildDays: 45,
    alloyUpkeepPerDay: 11.53,
    crewDemand: 10_000,
    upkeep: resources({ energy: 0.86, alloys: 0.08 }),
    combat: {
      maxShield: 140,
      maxArmor: 95,
      maxHull: 120,
      evasion: 0.24,
      sensorRange: 3,
      weaponMounts: [createLaserMount({ damage: 12, barrels: 2, accuracy: 0.82 })],
    },
  },
  constructionShip: {
    kind: "constructionShip",
    label: "Construction Ship",
    className: "Pioneer-class",
    description: "Utility hull fitted for deep-space construction and starbase deployment.",
    speed: 1.05,
    buildDays: 60,
    alloyUpkeepPerDay: 4.1,
    crewDemand: 10_000,
    upkeep: resources({ energy: 0.5, alloys: 0.04 }),
    combat: {
      maxShield: 90,
      maxArmor: 55,
      maxHull: 150,
      evasion: 0.1,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  colonizationShip: {
    kind: "colonizationShip",
    label: "Colonization Ship",
    className: "Odyssey-class",
    description: "Civilian settlement ark carrying colonists, prefab habitats, and orbital landing craft.",
    speed: 0.92,
    buildDays: 120,
    alloyUpkeepPerDay: 2.8,
    crewDemand: 25_000,
    upkeep: resources({ energy: 0.61, alloys: 0.05, goods: 0.04 }),
    combat: {
      maxShield: 75,
      maxArmor: 50,
      maxHull: 190,
      evasion: 0.07,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  destroyer: {
    kind: "destroyer",
    label: "Destroyer",
    className: "Vanguard-class",
    description: "Medium escort hull with heavier weapons and defenses for fleet-line combat.",
    speed: 0.98,
    buildDays: 120,
    alloyUpkeepPerDay: 9.18,
    crewDemand: 25_000,
    upkeep: resources({ energy: 1.75, alloys: 0.21 }),
    combat: {
      maxShield: 320,
      maxArmor: 280,
      maxHull: 460,
      evasion: 0.16,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 18, barrels: 3, accuracy: 0.8 }), 2),
    },
  },
  cruiser: {
    kind: "cruiser",
    label: "Cruiser",
    className: "Resolute-class",
    description: "Heavy fleet hull with broadside hardpoints, strong defenses, and command endurance.",
    speed: 0.78,
    buildDays: 300,
    alloyUpkeepPerDay: 8.37,
    crewDemand: 60_000,
    upkeep: resources({ energy: 3.18, alloys: 0.51, goods: 0.08 }),
    combat: {
      maxShield: 740,
      maxArmor: 660,
      maxHull: 1100,
      evasion: 0.09,
      sensorRange: 4,
      weaponMounts: repeatMount(createLaserMount({ damage: 24, barrels: 4, accuracy: 0.78 }), 4),
    },
  },
  battleship: {
    kind: "battleship",
    label: "Battleship",
    className: "Bulwark-class",
    description: "Capital hull for decisive engagements with the highest firepower and durability.",
    speed: 0.62,
    buildDays: 720,
    alloyUpkeepPerDay: 7.03,
    crewDemand: 150_000,
    upkeep: resources({ energy: 5.92, alloys: 1.08, goods: 0.17 }),
    combat: {
      maxShield: 1500,
      maxArmor: 1380,
      maxHull: 2350,
      evasion: 0.045,
      sensorRange: 4,
      weaponMounts: repeatMount(createLaserMount({ damage: 32, barrels: 4, accuracy: 0.76 }), 6),
    },
  },
  defensePlatform: {
    kind: "defensePlatform",
    label: "Defense Platform",
    className: "Sentinel-class",
    description: "Stationary starbase defense hull with heavy batteries and no strategic drive.",
    speed: 0,
    buildDays: 90,
    alloyUpkeepPerDay: 12.6,
    crewDemand: 10_000,
    upkeep: resources({ energy: 1.55, alloys: 0.24 }),
    combat: {
      maxShield: 280,
      maxArmor: 260,
      maxHull: 420,
      evasion: 0,
      sensorRange: 3,
      weaponMounts: repeatMount(createLaserMount({ damage: 20, barrels: 3, accuracy: 0.84 }), 2),
    },
  },
  scienceShip: {
    kind: "scienceShip",
    label: "Science Ship",
    className: "Pathfinder-class",
    description: "Dedicated survey vessel carrying high-resolution stellar and planetary instruments.",
    speed: 1.08,
    buildDays: 60,
    alloyUpkeepPerDay: 5.43,
    crewDemand: 10_000,
    upkeep: resources({ energy: 0.68, alloys: 0.05, goods: 0.04 }),
    combat: {
      maxShield: 75,
      maxArmor: 45,
      maxHull: 140,
      evasion: 0.14,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  armyShip: {
    kind: "armyShip",
    label: "Army Ship",
    className: "Legion-class",
    description: "A fixed expeditionary transport assigned permanently to one mobile army.",
    speed: 0.88,
    buildDays: 90,
    alloyUpkeepPerDay: 4.7,
    crewDemand: 10_000,
    upkeep: resources({ energy: 0.75, alloys: 0.07, goods: 0.05 }),
    combat: {
      maxShield: 0,
      maxArmor: 0,
      maxHull: 260,
      evasion: 0.08,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
};

export function calculateStarbaseEconomy(
  level: StarbaseLevel,
  buildingSlots: Array<StarbaseBuildingKind | null> = [],
): StarbaseEconomy {
  const definition = STARBASE_LEVEL_DEFINITIONS[level] ?? STARBASE_LEVEL_DEFINITIONS.outpost;
  const production = resources(definition.production);
  const hasLogisticsDepot = buildingSlots.includes("logisticsDepot");
  const upkeep = scaleResources(resources(definition.upkeep), hasLogisticsDepot ? 0.85 : 1);
  for (const buildingKind of buildingSlots) {
    if (!buildingKind) continue;
    const building = STARBASE_BUILDING_DEFINITIONS[buildingKind];
    if (!building) continue;
    for (const resource of Object.keys(production) as Array<keyof ResourceCounts>) {
      production[resource] += building.production[resource];
      upkeep[resource] += building.upkeep[resource];
    }
  }
  const net = createEmptyResourceCounts();
  for (const resource of Object.keys(net) as Array<keyof ResourceCounts>) {
    net[resource] = production[resource] - upkeep[resource];
  }
  return { production, upkeep, net };
}

export const OUTPOST_CONSTRUCTION_COST: ResourceCounts = resources({
  minerals: 2_000,
  goods: 100,
  alloys: 250,
});

export function getStarbaseShipConstructionCostMultiplier(
  buildingSlots: Array<StarbaseBuildingKind | null>,
): number {
  return buildingSlots.includes("logisticsDepot") ? 0.95 : 1;
}

export function getNextStarbaseLevel(level: StarbaseLevel): StarbaseLevel | null {
  return STARBASE_LEVEL_DEFINITIONS[level]?.upgrade?.targetLevel ?? null;
}

export function createEmptyStarbaseSlots(): Array<StarbaseBuildingKind | null> {
  const slots = Array<StarbaseBuildingKind | null>(9).fill(null);
  slots[0] = "listeningStation";
  return slots;
}

export function createStarbaseBuildingQueueItem(
  buildingKind: StarbaseBuildingKind,
  slotIndex: number,
  id = createConstructionId("starbase-building", [buildingKind, slotIndex]),
): StarbaseConstructionQueueItem {
  const definition = STARBASE_BUILDING_DEFINITIONS[buildingKind];
  return {
    id,
    kind: "building",
    label: definition.label,
    cost: resources(definition.cost),
    totalDays: definition.buildDays,
    remainingDays: definition.buildDays,
    buildingKind,
    slotIndex,
  };
}

export function createStarbaseUpgradeQueueItem(
  level: StarbaseLevel,
  id = createConstructionId("starbase-upgrade", [level]),
): StarbaseConstructionQueueItem | null {
  const upgrade = STARBASE_LEVEL_DEFINITIONS[level]?.upgrade;
  if (!upgrade) return null;
  const target = STARBASE_LEVEL_DEFINITIONS[upgrade.targetLevel];
  return {
    id,
    kind: "upgrade",
    label: `Upgrade to ${target.label}`,
    cost: resources(upgrade.cost),
    totalDays: upgrade.buildDays,
    remainingDays: upgrade.buildDays,
    targetLevel: upgrade.targetLevel,
  };
}

export function isStarbaseBuildingKind(value: string): value is StarbaseBuildingKind {
  return STARBASE_BUILDING_KINDS.includes(value as StarbaseBuildingKind);
}

export function hasQueuedStarbaseBuildingTarget(
  queue: StarbaseConstructionQueueItem[],
  slotIndex: number,
): boolean {
  return queue.some((item) => item.kind === "building" && item.slotIndex === slotIndex);
}

export function countStarbaseShipyards(buildingSlots: Array<StarbaseBuildingKind | null>): number {
  return buildingSlots.reduce((total, buildingKind) => (
    total + (buildingKind ? STARBASE_BUILDING_DEFINITIONS[buildingKind]?.shipyards ?? 0 : 0)
  ), 0);
}

export function createStarbaseShipQueueItem(
  shipKind: StarbaseShipKind,
  overrides: Partial<Omit<StarbaseShipQueueItem, "id" | "shipKind">> = {},
  id = createConstructionId("starbase-ship", [shipKind]),
): StarbaseShipQueueItem {
  const definition = STARBASE_SHIP_DEFINITIONS[shipKind];
  const totalDays = overrides.totalDays ?? definition.buildDays;
  const cost = resources(overrides.cost ?? { alloys: definition.alloyUpkeepPerDay * totalDays });
  const upfrontCost = resources(overrides.upfrontCost ?? scaleResources(cost, 0.05));
  const deferredCost = subtractResources(cost, upfrontCost);
  const resourceUpkeepPerDay = resources(overrides.resourceUpkeepPerDay ?? scaleResources(deferredCost, 1 / Math.max(1, totalDays)));
  const alloyUpkeepPerDay = overrides.alloyUpkeepPerDay ?? resourceUpkeepPerDay.alloys;
  return {
    id,
    kind: overrides.kind ?? "build",
    shipKind,
    designId: overrides.designId ?? null,
    targetDesignId: overrides.targetDesignId ?? null,
    shipId: overrides.shipId ?? null,
    label: overrides.label ?? definition.label,
    cost,
    upfrontCost,
    resourceUpkeepPerDay,
    totalDays,
    remainingDays: overrides.remainingDays ?? totalDays,
    alloyUpkeepPerDay,
    crewDemand: overrides.crewDemand ?? definition.crewDemand,
    reservedCrew: overrides.reservedCrew ?? overrides.crewDemand ?? definition.crewDemand,
    armyTypeId: overrides.armyTypeId,
    speciesId: overrides.speciesId,
  };
}

export function isStarbaseShipKind(value: string): value is StarbaseShipKind {
  return STARBASE_SHIP_KINDS.includes(value as StarbaseShipKind);
}

function completeStarbaseConstructionItem<T extends {
  level: StarbaseLevel;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  economy: StarbaseEconomy;
}>(starbase: T, item: StarbaseConstructionQueueItem): T {
  let next: T = starbase;
  if (item.kind === "upgrade" && item.targetLevel && STARBASE_LEVEL_DEFINITIONS[item.targetLevel]) {
    next = { ...next, level: item.targetLevel };
  }
  if (
    item.kind === "building"
    && item.buildingKind
    && item.slotIndex !== undefined
    && item.slotIndex >= 0
    && item.slotIndex < next.buildingSlots.length
    && item.slotIndex < STARBASE_LEVEL_DEFINITIONS[next.level].buildingSlots
    && !next.buildingSlots[item.slotIndex]
  ) {
    next = {
      ...next,
      buildingSlots: next.buildingSlots.map((building, index) => (
        index === item.slotIndex ? item.buildingKind! : building
      )),
    };
  }
  return {
    ...next,
    economy: calculateStarbaseEconomy(next.level, next.buildingSlots),
  };
}

export function progressStarbaseConstructionQueue<T extends {
  level: StarbaseLevel;
  buildingSlots: Array<StarbaseBuildingKind | null>;
  constructionQueue: StarbaseConstructionQueueItem[];
  economy: StarbaseEconomy;
}>(
  starbase: T,
  elapsedDays: number,
): { starbase: T; changed: boolean; completed: StarbaseConstructionQueueItem[] } {
  let next = {
    ...starbase,
    economy: calculateStarbaseEconomy(starbase.level, starbase.buildingSlots),
  };
  let days = Math.max(0, elapsedDays);
  const completed: StarbaseConstructionQueueItem[] = [];
  let changed = false;

  while (days > 0 && next.constructionQueue.length > 0) {
    const [current, ...rest] = next.constructionQueue;
    if (days < current.remainingDays) {
      current.remainingDays -= days;
      next = { ...next, constructionQueue: [current, ...rest] };
      changed = true;
      break;
    }

    days = Math.max(0, days - current.remainingDays);
    const completedItem = { ...current, remainingDays: 0 };
    next = completeStarbaseConstructionItem({ ...next, constructionQueue: rest }, completedItem);
    completed.push(completedItem);
    changed = true;
  }

  return { starbase: next, changed, completed };
}

export function progressStarbaseShipQueue<T extends {
  buildingSlots: Array<StarbaseBuildingKind | null>;
  shipQueue: StarbaseShipQueueItem[];
}>(
  starbase: T,
  elapsedDays: number,
  availableResources?: ResourceCounts,
  shipyardCountOverride?: number,
): { starbase: T; changed: boolean; completed: StarbaseShipQueueItem[]; resourcesConsumed: ResourceCounts; alloysConsumed: number } {
  const shipyardCount = shipyardCountOverride ?? countStarbaseShipyards(starbase.buildingSlots);
  if (shipyardCount <= 0 || elapsedDays <= 0 || starbase.shipQueue.length === 0) {
    return { starbase, changed: false, completed: [], resourcesConsumed: createEmptyResourceCounts(), alloysConsumed: 0 };
  }

  let queue = starbase.shipQueue
    .filter((item) => item.remainingDays > 0)
    .map((item) => ({ ...item }));
  let days = Math.max(0, elapsedDays);
  const completed: StarbaseShipQueueItem[] = [];
  let resourcesConsumed = createEmptyResourceCounts();
  let remainingResources = availableResources ? resources(availableResources) : null;
  let changed = false;

  while (days > 0 && queue.length > 0) {
    const active = queue.slice(0, shipyardCount);
    if (active.length === 0) break;
    const activeDemandPerDay = active.reduce(
      (total, item) => addResources(total, item.resourceUpkeepPerDay ?? resources({ alloys: item.alloyUpkeepPerDay })),
      createEmptyResourceCounts(),
    );
    let step = Math.min(days, ...active.map((item) => Math.max(0, item.remainingDays)));
    if (remainingResources) {
      let affordableDays = Number.POSITIVE_INFINITY;
      for (const resource of RESOURCE_KINDS) {
        const dailyDemand = activeDemandPerDay[resource];
        if (dailyDemand <= 0) continue;
        affordableDays = Math.min(affordableDays, Math.max(0, remainingResources[resource]) / dailyDemand);
      }
      step = Math.min(step, affordableDays);
    }
    if (step <= 0) break;

    for (let index = 0; index < active.length; index += 1) {
      const item = queue[index];
      item.remainingDays = Math.max(0, item.remainingDays - step);
    }
    const stepDemand = scaleResources(activeDemandPerDay, step);
    resourcesConsumed = addResources(resourcesConsumed, stepDemand);
    if (remainingResources) remainingResources = subtractResources(remainingResources, stepDemand);
    days = Math.max(0, days - step);
    changed = true;

    const remaining: StarbaseShipQueueItem[] = [];
    for (const item of queue) {
      if (item.remainingDays <= 0) {
        completed.push({ ...item, remainingDays: 0 });
      } else {
        remaining.push(item);
      }
    }
    queue = remaining;
  }

  return {
    starbase: { ...starbase, shipQueue: queue },
    changed,
    completed,
    resourcesConsumed,
    alloysConsumed: resourcesConsumed.alloys,
  };
}
