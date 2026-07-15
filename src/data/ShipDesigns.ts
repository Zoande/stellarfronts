import { createEmptyResourceCounts } from "./Economy";
import type { ResourceCounts } from "./Economy";
import type { RangeBand } from "../game/CombatTypes";
import {
  STARBASE_SHIP_KINDS,
  WEAPON_KIND_DEFINITIONS,
} from "./Starbase";
import type {
  CombatStats,
  StarbaseShipKind,
  WeaponKind,
  WeaponMountDefinition,
} from "./Starbase";
import { RANGE_BAND_INDEX, rangeBandFromIndex } from "../game/CombatTypes";

export type ShipDesignStatus = "active" | "decommissioned";
export type ShipComponentSlotType = "weapon" | "defense" | "utility";
export type ShipSectionSlotType = "weaponSection" | "defenseSection";
export type ShipModuleSlotType = ShipComponentSlotType;
export type ShipDesignerModuleType = ShipComponentSlotType | ShipSectionSlotType;
export type ShipDefenseModuleKind = "shield" | "armor" | "hull";
export type WeaponSlotSize = "small" | "medium" | "large";

export interface ShipDesign {
  id: string;
  ownerId: number;
  shipKind: StarbaseShipKind;
  name: string;
  status: ShipDesignStatus;
  weaponSectionModuleIds: string[];
  defenseSectionModuleIds: string[];
  weaponModuleIds: string[];
  defenseModuleIds: string[];
  utilityModuleIds: string[];
  utilityModuleId: string | null;
  createdAtYear: number;
  updatedAtYear: number;
}

export interface ShipStatModifiers {
  maxShield?: number;
  maxArmor?: number;
  maxHull?: number;
  evasion?: number;
  sensorRange?: number;
  speed?: number;
  buildDays?: number;
  alloyUpkeepPerDay?: number;
  crewDemand?: number;
  weaponAccuracyBonus?: number;
  weaponDamageMultiplier?: number;
  weaponRangeBonusBands?: number;
  cost?: Partial<ResourceCounts>;
  upkeep?: Partial<ResourceCounts>;
}

export interface ShipComponentSlotDefinition {
  kind: ShipComponentSlotType;
  size?: WeaponSlotSize;
  label?: string;
}

export interface ShipModuleDefinition {
  id: string;
  label: string;
  description: string;
  slotType: ShipComponentSlotType;
  weaponKind?: WeaponKind;
  weaponSize?: WeaponSlotSize;
  defenseKind?: ShipDefenseModuleKind;
  weaponMount?: WeaponMountDefinition;
  modifiers?: ShipStatModifiers;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  shipKinds?: StarbaseShipKind[];
  iconKind?: string;
  availableInDesigner?: boolean;
  sensorSuiteIds?: import("./Intelligence").SensorSuiteId[];
}

export interface ShipSectionModuleDefinition {
  id: string;
  label: string;
  description: string;
  slotType: ShipSectionSlotType;
  shipKinds: StarbaseShipKind[];
  slots: ShipComponentSlotDefinition[];
  pairedDefenseSectionModuleId?: string;
  modifiers?: ShipStatModifiers;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  iconKind?: string;
}

export interface ShipHullDefinition {
  kind: StarbaseShipKind;
  label: string;
  baseClassName: string;
  description: string;
  weaponSectionSlots: number;
  defenseSectionSlots: number;
  utilitySlots: number;
  speed: number;
  buildDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  combat: CombatStats;
}

export interface ShipDesignStats {
  shipKind: StarbaseShipKind;
  label: string;
  className: string;
  speed: number;
  buildDays: number;
  alloyUpkeepPerDay: number;
  crewDemand: number;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
  combat: CombatStats;
}

export interface ShipDesignLayout {
  weaponSlots: ShipComponentSlotDefinition[];
  defenseSlots: ShipComponentSlotDefinition[];
  utilitySlots: ShipComponentSlotDefinition[];
}

function resources(values: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...values,
  };
}

function addResources(base: ResourceCounts, delta: Partial<ResourceCounts> | undefined): ResourceCounts {
  if (!delta) return base;
  const next = { ...base };
  for (const resource of Object.keys(next) as Array<keyof ResourceCounts>) {
    next[resource] += Number(delta[resource] ?? 0);
  }
  return next;
}

function createMount(
  kind: WeaponKind,
  mount: Omit<WeaponMountDefinition, "kind" | "minRangeBand" | "maxRangeBand" | "optimalRangeBand" | "cooldownRounds">,
): WeaponMountDefinition {
  const range = WEAPON_KIND_DEFINITIONS[kind];
  const mountId = mount.id ?? "";
  const ordnanceSize = mountId.includes("large") ? 2 : mountId.includes("medium") ? 1 : 0;
  const torpedo = mountId.includes("torpedo");
  const attackDefaults: Partial<WeaponMountDefinition> = kind === "laser"
    ? { attackClass: "beam", travelSpeed: 640, tracking: 0.15, shieldDamageMultiplier: 0.9, armorDamageMultiplier: 1.4, hullDamageMultiplier: 1 }
    : kind === "railgun"
      ? { attackClass: "kinetic", travelSpeed: 48, tracking: 0.05, shieldDamageMultiplier: 1.4, armorDamageMultiplier: 0.9, hullDamageMultiplier: 0.95 }
      : kind === "plasma"
        ? { attackClass: "plasma", travelSpeed: 16, tracking: 0.05, shieldDamageMultiplier: 0.9, armorDamageMultiplier: 1.45, hullDamageMultiplier: 1.2 }
        : kind === "missile"
          ? { attackClass: torpedo ? "torpedo" : "missile", travelSpeed: torpedo ? 6 : 9, tracking: 0.35, shieldDamageMultiplier: 1, armorDamageMultiplier: 1, hullDamageMultiplier: 1.1, interceptableBy: ["pointDefense"], projectileHp: torpedo ? 5 + ordnanceSize * 2 : 2 + ordnanceSize, projectileEvasion: (torpedo ? 0.62 : 0.78) - ordnanceSize * 0.04, guided: true }
          : { attackClass: "pointDefense", travelSpeed: 720, tracking: 0.7, shieldDamageMultiplier: 0.25, armorDamageMultiplier: 0.25, hullDamageMultiplier: 0.2, counterClass: "pointDefense", intercepts: ["missile", "torpedo"] };
  return {
    ...attackDefaults,
    ...mount,
    kind,
    minRangeBand: range.minRangeBand,
    maxRangeBand: range.maxRangeBand,
    optimalRangeBand: range.optimalRangeBand,
    cooldownRounds: range.cooldownRounds,
  };
}

export const WEAPON_SLOT_SIZE_LABELS: Record<WeaponSlotSize, string> = {
  small: "S",
  medium: "M",
  large: "L",
};

export const SHIP_HULL_DEFINITIONS: Record<StarbaseShipKind, ShipHullDefinition> = {
  corvette: {
    kind: "corvette",
    label: "Corvette",
    baseClassName: "Falcon",
    description: "Fast escort hull for patrols, interception, and early fleet operations.",
    weaponSectionSlots: 1,
    defenseSectionSlots: 1,
    utilitySlots: 5,
    speed: 1.22,
    buildDays: 5,
    alloyUpkeepPerDay: 10,
    crewDemand: 900,
    cost: resources({ minerals: 110, alloys: 80 }),
    upkeep: resources({ energy: 0.72, alloys: 0.07 }),
    combat: {
      maxShield: 30,
      maxArmor: 20,
      maxHull: 95,
      evasion: 0.28,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  destroyer: {
    kind: "destroyer",
    label: "Destroyer",
    baseClassName: "Vanguard",
    description: "Medium escort hull with larger hardpoints and enough protection for fleet-line duty.",
    weaponSectionSlots: 1,
    defenseSectionSlots: 1,
    utilitySlots: 6,
    speed: 0.98,
    buildDays: 16,
    alloyUpkeepPerDay: 30,
    crewDemand: 2_400,
    cost: resources({ minerals: 400, alloys: 330 }),
    upkeep: resources({ energy: 2.1, alloys: 0.28 }),
    combat: {
      maxShield: 160,
      maxArmor: 140,
      maxHull: 320,
      evasion: 0.17,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  cruiser: {
    kind: "cruiser",
    label: "Cruiser",
    baseClassName: "Resolute",
    description: "Heavy fleet hull with multiple section bays, strong endurance, and command reach.",
    weaponSectionSlots: 2,
    defenseSectionSlots: 2,
    utilitySlots: 7,
    speed: 0.78,
    buildDays: 34,
    alloyUpkeepPerDay: 58,
    crewDemand: 5_800,
    cost: resources({ minerals: 900, alloys: 820, goods: 100 }),
    upkeep: resources({ energy: 3.8, alloys: 0.54, goods: 0.16 }),
    combat: {
      maxShield: 340,
      maxArmor: 320,
      maxHull: 760,
      evasion: 0.1,
      sensorRange: 4,
      weaponMounts: [],
    },
  },
  battleship: {
    kind: "battleship",
    label: "Battleship",
    baseClassName: "Bulwark",
    description: "Capital combat hull built around redundant defenses and decisive battery fire.",
    weaponSectionSlots: 3,
    defenseSectionSlots: 3,
    utilitySlots: 8,
    speed: 0.62,
    buildDays: 68,
    alloyUpkeepPerDay: 112,
    crewDemand: 13_000,
    cost: resources({ minerals: 1_800, alloys: 1_750, goods: 220 }),
    upkeep: resources({ energy: 7.6, alloys: 1.08, goods: 0.34 }),
    combat: {
      maxShield: 720,
      maxArmor: 700,
      maxHull: 1700,
      evasion: 0.055,
      sensorRange: 4,
      weaponMounts: [],
    },
  },
  defensePlatform: {
    kind: "defensePlatform",
    label: "Defense Platform",
    baseClassName: "Sentinel",
    description: "Stationary defensive installation designed and armed through the standard ship designer.",
    weaponSectionSlots: 1,
    defenseSectionSlots: 1,
    utilitySlots: 5,
    speed: 0,
    buildDays: 12,
    alloyUpkeepPerDay: 24,
    crewDemand: 1_600,
    cost: resources({ minerals: 360, alloys: 300, goods: 40 }),
    upkeep: resources({ energy: 1.7, alloys: 0.26 }),
    combat: {
      maxShield: 220,
      maxArmor: 210,
      maxHull: 380,
      evasion: 0,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  scienceShip: {
    kind: "scienceShip",
    label: "Science Ship",
    baseClassName: "Pathfinder",
    description: "Dedicated research and survey hull with exclusive access to science-grade sensor arrays.",
    weaponSectionSlots: 0,
    defenseSectionSlots: 0,
    utilitySlots: 4,
    speed: 1.08,
    buildDays: 8,
    alloyUpkeepPerDay: 9,
    crewDemand: 800,
    cost: resources({ minerals: 180, alloys: 125, goods: 80, research: 20 }),
    upkeep: resources({ energy: 1, alloys: 0.09, goods: 0.07 }),
    combat: {
      maxShield: 55,
      maxArmor: 35,
      maxHull: 125,
      evasion: 0.15,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  armyShip: {
    kind: "armyShip",
    label: "Army Ship",
    baseClassName: "Legion",
    description: "Placeholder troop carrier awaiting the ground-army combat system.",
    weaponSectionSlots: 0,
    defenseSectionSlots: 0,
    utilitySlots: 3,
    speed: 0.88,
    buildDays: 11,
    alloyUpkeepPerDay: 15,
    crewDemand: 2_200,
    cost: resources({ minerals: 260, alloys: 210, goods: 120, food: 80 }),
    upkeep: resources({ energy: 1.25, alloys: 0.14, goods: 0.09 }),
    combat: {
      maxShield: 90,
      maxArmor: 80,
      maxHull: 230,
      evasion: 0.09,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  constructionShip: {
    kind: "constructionShip",
    label: "Construction Ship",
    baseClassName: "Pioneer",
    description: "Utility hull for construction fleets, survey logistics, and starbase deployment.",
    weaponSectionSlots: 0,
    defenseSectionSlots: 0,
    utilitySlots: 3,
    speed: 1.05,
    buildDays: 6,
    alloyUpkeepPerDay: 8,
    crewDemand: 650,
    cost: resources({ minerals: 140, alloys: 100 }),
    upkeep: resources({ energy: 0.78, alloys: 0.08 }),
    combat: {
      maxShield: 60,
      maxArmor: 40,
      maxHull: 130,
      evasion: 0.12,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
  colonizationShip: {
    kind: "colonizationShip",
    label: "Colonization Ship",
    baseClassName: "Odyssey",
    description: "Civilian settlement ark carrying colonists, prefab habitats, and orbital landing craft.",
    weaponSectionSlots: 0,
    defenseSectionSlots: 0,
    utilitySlots: 3,
    speed: 0.92,
    buildDays: 10,
    alloyUpkeepPerDay: 10,
    crewDemand: 1_000,
    cost: resources({ minerals: 220, alloys: 160, goods: 100, food: 100 }),
    upkeep: resources({ energy: 1, alloys: 0.1, goods: 0.08 }),
    combat: {
      maxShield: 45,
      maxArmor: 35,
      maxHull: 170,
      evasion: 0.08,
      sensorRange: 3,
      weaponMounts: [],
    },
  },
};

export const SHIP_SECTION_MODULE_DEFINITIONS: Record<string, ShipSectionModuleDefinition> = {
  weapon_section_corvette_swarmer: {
    id: "weapon_section_corvette_swarmer",
    label: "Swarmer Core",
    description: "Light attack section with two small hardpoints and one medium hardpoint.",
    slotType: "weaponSection",
    shipKinds: ["corvette"],
    pairedDefenseSectionModuleId: "defense_section_corvette_swarmer",
    slots: [
      { kind: "weapon", size: "small", label: "S Weapon" },
      { kind: "weapon", size: "small", label: "S Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
    ],
    modifiers: { evasion: 0.02, cost: { alloys: 18, minerals: 16 }, upkeep: { energy: 0.04 } },
    cost: resources({ alloys: 18, minerals: 16 }),
    upkeep: resources({ energy: 0.04 }),
    iconKind: "swarm",
  },
  weapon_section_corvette_tanker: {
    id: "weapon_section_corvette_tanker",
    label: "Tanker Core",
    description: "Heavy attack section with one large hardpoint and one medium hardpoint.",
    slotType: "weaponSection",
    shipKinds: ["corvette"],
    pairedDefenseSectionModuleId: "defense_section_corvette_tanker",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
    ],
    modifiers: { maxHull: 24, evasion: -0.02, cost: { alloys: 28, minerals: 22 }, upkeep: { alloys: 0.01 } },
    cost: resources({ alloys: 28, minerals: 22 }),
    upkeep: resources({ alloys: 0.01 }),
    iconKind: "tank",
  },
  defense_section_corvette_swarmer: {
    id: "defense_section_corvette_swarmer",
    label: "Swarmer Screen",
    description: "Light protection section with two defense slots.",
    slotType: "defenseSection",
    shipKinds: ["corvette"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { evasion: 0.01, cost: { alloys: 10, minerals: 12 } },
    cost: resources({ alloys: 10, minerals: 12 }),
    upkeep: resources({}),
    iconKind: "screen",
  },
  defense_section_corvette_tanker: {
    id: "defense_section_corvette_tanker",
    label: "Tanker Bulwark",
    description: "Heavy protection section with four defense slots.",
    slotType: "defenseSection",
    shipKinds: ["corvette"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxHull: 18, evasion: -0.01, cost: { alloys: 22, minerals: 24 }, upkeep: { alloys: 0.01 } },
    cost: resources({ alloys: 22, minerals: 24 }),
    upkeep: resources({ alloys: 0.01 }),
    iconKind: "bulwark",
  },
  weapon_section_defense_platform_battery: {
    id: "weapon_section_defense_platform_battery",
    label: "Platform Battery Core",
    description: "Stationary heavy battery with one large and two medium hardpoints.",
    slotType: "weaponSection",
    shipKinds: ["defensePlatform"],
    pairedDefenseSectionModuleId: "defense_section_defense_platform_bastion",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
    ],
    modifiers: { weaponAccuracyBonus: 0.03, cost: { alloys: 52, minerals: 48 }, upkeep: { energy: 0.1 } },
    cost: resources({ alloys: 52, minerals: 48 }),
    upkeep: resources({ energy: 0.1 }),
    iconKind: "platform",
  },
  defense_section_defense_platform_bastion: {
    id: "defense_section_defense_platform_bastion",
    label: "Bastion Frame",
    description: "Fixed armored frame with five defense slots and reinforced structure.",
    slotType: "defenseSection",
    shipKinds: ["defensePlatform"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxHull: 60, maxArmor: 40, cost: { alloys: 48, minerals: 54 }, upkeep: { alloys: 0.03 } },
    cost: resources({ alloys: 48, minerals: 54 }),
    upkeep: resources({ alloys: 0.03 }),
    iconKind: "bastion",
  },
  weapon_section_destroyer_line: {
    id: "weapon_section_destroyer_line",
    label: "Line Battery",
    description: "Destroyer section with two medium hardpoints and a light defensive weapon mount.",
    slotType: "weaponSection",
    shipKinds: ["destroyer"],
    pairedDefenseSectionModuleId: "defense_section_destroyer_line",
    slots: [
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "small", label: "S Weapon" },
    ],
    modifiers: { maxHull: 30, cost: { alloys: 42, minerals: 36 }, upkeep: { energy: 0.08 } },
    cost: resources({ alloys: 42, minerals: 36 }),
    upkeep: resources({ energy: 0.08 }),
    iconKind: "line",
  },
  defense_section_destroyer_line: {
    id: "defense_section_destroyer_line",
    label: "Layered Screen",
    description: "Destroyer protection section with four defense slots.",
    slotType: "defenseSection",
    shipKinds: ["destroyer"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxArmor: 24, cost: { alloys: 34, minerals: 38 }, upkeep: { alloys: 0.02 } },
    cost: resources({ alloys: 34, minerals: 38 }),
    upkeep: resources({ alloys: 0.02 }),
    iconKind: "screen",
  },
  weapon_section_destroyer_picket: {
    id: "weapon_section_destroyer_picket",
    label: "Picket Interceptor",
    description: "Destroyer section with a large bow hardpoint and two small escort mounts.",
    slotType: "weaponSection",
    shipKinds: ["destroyer"],
    pairedDefenseSectionModuleId: "defense_section_destroyer_picket",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "small", label: "S Weapon" },
      { kind: "weapon", size: "small", label: "S Weapon" },
    ],
    modifiers: { evasion: 0.01, weaponAccuracyBonus: 0.02, cost: { alloys: 52, minerals: 42 }, upkeep: { energy: 0.12 } },
    cost: resources({ alloys: 52, minerals: 42 }),
    upkeep: resources({ energy: 0.12 }),
    iconKind: "picket",
  },
  defense_section_destroyer_picket: {
    id: "defense_section_destroyer_picket",
    label: "Interceptor Screen",
    description: "Destroyer protection section tuned for speed and missile interception.",
    slotType: "defenseSection",
    shipKinds: ["destroyer"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { evasion: 0.015, speed: 0.04, maxHull: -10, cost: { alloys: 28, minerals: 30 }, upkeep: { energy: 0.04 } },
    cost: resources({ alloys: 28, minerals: 30 }),
    upkeep: resources({ energy: 0.04 }),
    iconKind: "screen",
  },
  weapon_section_cruiser_line: {
    id: "weapon_section_cruiser_line",
    label: "Broadside Battery",
    description: "Cruiser section with one large, two medium, and one small weapon hardpoint.",
    slotType: "weaponSection",
    shipKinds: ["cruiser"],
    pairedDefenseSectionModuleId: "defense_section_cruiser_line",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "small", label: "S Weapon" },
    ],
    modifiers: { weaponDamageMultiplier: 0.04, cost: { alloys: 76, minerals: 58 }, upkeep: { energy: 0.16 } },
    cost: resources({ alloys: 76, minerals: 58 }),
    upkeep: resources({ energy: 0.16 }),
    iconKind: "broadside",
  },
  defense_section_cruiser_line: {
    id: "defense_section_cruiser_line",
    label: "Cruiser Bulwark",
    description: "Cruiser protection section with three reinforced defense slots.",
    slotType: "defenseSection",
    shipKinds: ["cruiser"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxShield: 36, maxArmor: 28, cost: { alloys: 58, minerals: 64 }, upkeep: { energy: 0.08, alloys: 0.03 } },
    cost: resources({ alloys: 58, minerals: 64 }),
    upkeep: resources({ energy: 0.08, alloys: 0.03 }),
    iconKind: "bulwark",
  },
  weapon_section_cruiser_artillery: {
    id: "weapon_section_cruiser_artillery",
    label: "Artillery Battery",
    description: "Cruiser section with two large hardpoints and medium fire-control support.",
    slotType: "weaponSection",
    shipKinds: ["cruiser"],
    pairedDefenseSectionModuleId: "defense_section_cruiser_artillery",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
    ],
    modifiers: { weaponRangeBonusBands: 1, evasion: -0.01, cost: { alloys: 92, minerals: 70 }, upkeep: { energy: 0.22, alloys: 0.03 } },
    cost: resources({ alloys: 92, minerals: 70 }),
    upkeep: resources({ energy: 0.22, alloys: 0.03 }),
    iconKind: "artillery",
  },
  defense_section_cruiser_artillery: {
    id: "defense_section_cruiser_artillery",
    label: "Magazine Bulwark",
    description: "Cruiser protection section with reinforced armor around heavy magazines.",
    slotType: "defenseSection",
    shipKinds: ["cruiser"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxArmor: 54, maxHull: 30, evasion: -0.005, cost: { alloys: 72, minerals: 82 }, upkeep: { alloys: 0.04 } },
    cost: resources({ alloys: 72, minerals: 82 }),
    upkeep: resources({ alloys: 0.04 }),
    iconKind: "bulwark",
  },
  weapon_section_battleship_line: {
    id: "weapon_section_battleship_line",
    label: "Capital Battery",
    description: "Battleship section centered on large hardpoints with medium battery support.",
    slotType: "weaponSection",
    shipKinds: ["battleship"],
    pairedDefenseSectionModuleId: "defense_section_battleship_line",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
      { kind: "weapon", size: "medium", label: "M Weapon" },
    ],
    modifiers: { weaponDamageMultiplier: 0.08, evasion: -0.01, cost: { alloys: 130, minerals: 90 }, upkeep: { energy: 0.28, alloys: 0.04 } },
    cost: resources({ alloys: 130, minerals: 90 }),
    upkeep: resources({ energy: 0.28, alloys: 0.04 }),
    iconKind: "capital",
  },
  defense_section_battleship_line: {
    id: "defense_section_battleship_line",
    label: "Capital Citadel",
    description: "Battleship protection section with redundant shield, armor, and hull slots.",
    slotType: "defenseSection",
    shipKinds: ["battleship"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxShield: 72, maxArmor: 64, maxHull: 80, evasion: -0.005, cost: { alloys: 105, minerals: 118 }, upkeep: { energy: 0.16, alloys: 0.05 } },
    cost: resources({ alloys: 105, minerals: 118 }),
    upkeep: resources({ energy: 0.16, alloys: 0.05 }),
    iconKind: "citadel",
  },
  weapon_section_battleship_siege: {
    id: "weapon_section_battleship_siege",
    label: "Siege Battery",
    description: "Battleship section with three large hardpoints for long-range decisive fire.",
    slotType: "weaponSection",
    shipKinds: ["battleship"],
    pairedDefenseSectionModuleId: "defense_section_battleship_siege",
    slots: [
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "large", label: "L Weapon" },
      { kind: "weapon", size: "large", label: "L Weapon" },
    ],
    modifiers: { weaponDamageMultiplier: 0.12, weaponRangeBonusBands: 1, evasion: -0.02, cost: { alloys: 165, minerals: 118 }, upkeep: { energy: 0.34, alloys: 0.06 } },
    cost: resources({ alloys: 165, minerals: 118 }),
    upkeep: resources({ energy: 0.34, alloys: 0.06 }),
    iconKind: "artillery",
  },
  defense_section_battleship_siege: {
    id: "defense_section_battleship_siege",
    label: "Siege Citadel",
    description: "Battleship protection section with maximum armor and hull redundancy.",
    slotType: "defenseSection",
    shipKinds: ["battleship"],
    slots: [
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
      { kind: "defense", label: "Defense" },
    ],
    modifiers: { maxArmor: 96, maxHull: 120, evasion: -0.01, cost: { alloys: 132, minerals: 150 }, upkeep: { alloys: 0.08 } },
    cost: resources({ alloys: 132, minerals: 150 }),
    upkeep: resources({ alloys: 0.08 }),
    iconKind: "citadel",
  },
};

export const SHIP_MODULE_DEFINITIONS: Record<string, ShipModuleDefinition> = {
  weapon_laser_cannon: {
    id: "weapon_laser_cannon",
    label: "S Laser Cannon",
    description: "Small energy weapon with reliable armor penetration.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "small",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "laser-cannon-small",
      label: "S Laser Cannon",
      barrels: 1,
      damage: 8,
      shieldPenetration: 0.1,
      armorPenetration: 0.35,
      accuracy: 0.86,
    }),
    cost: resources({ alloys: 18, minerals: 10 }),
    upkeep: resources({ energy: 0.1, alloys: 0.012 }),
  },
  weapon_laser_cannon_medium: {
    id: "weapon_laser_cannon_medium",
    label: "M Laser Cannon",
    description: "Medium energy weapon with higher sustained damage.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "medium",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "laser-cannon-medium",
      label: "M Laser Cannon",
      barrels: 2,
      damage: 10,
      shieldPenetration: 0.1,
      armorPenetration: 0.35,
      accuracy: 0.84,
    }),
    cost: resources({ alloys: 24, minerals: 12 }),
    upkeep: resources({ energy: 0.16, alloys: 0.02 }),
  },
  weapon_laser_cannon_large: {
    id: "weapon_laser_cannon_large",
    label: "L Laser Cannon",
    description: "Large energy weapon with heavy armor penetration.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "large",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "laser-cannon-large",
      label: "L Laser Cannon",
      barrels: 2,
      damage: 16,
      shieldPenetration: 0.12,
      armorPenetration: 0.42,
      accuracy: 0.8,
    }),
    cost: resources({ alloys: 38, minerals: 20 }),
    upkeep: resources({ energy: 0.28, alloys: 0.035 }),
  },
  weapon_missile_rack_small: {
    id: "weapon_missile_rack_small",
    label: "S Missile Rack",
    description: "Small guided ordnance rack with good shield penetration.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "small",
    iconKind: "missile",
    weaponMount: createMount("missile", {
      id: "missile-rack-small",
      label: "S Missile Rack",
      barrels: 1,
      damage: 18,
      shieldPenetration: 0.35,
      armorPenetration: 0.18,
      accuracy: 0.74,
    }),
    cost: resources({ alloys: 26, minerals: 14 }),
    upkeep: resources({ energy: 0.06, alloys: 0.035 }),
  },
  weapon_missile_rack: {
    id: "weapon_missile_rack",
    label: "M Missile Rack",
    description: "Medium guided ordnance rack with heavy alpha damage.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "medium",
    iconKind: "missile",
    weaponMount: createMount("missile", {
      id: "missile-rack-medium",
      label: "M Missile Rack",
      barrels: 1,
      damage: 30,
      shieldPenetration: 0.35,
      armorPenetration: 0.18,
      accuracy: 0.72,
    }),
    cost: resources({ alloys: 34, minerals: 18 }),
    upkeep: resources({ energy: 0.08, alloys: 0.05 }),
  },
  weapon_missile_rack_large: {
    id: "weapon_missile_rack_large",
    label: "L Missile Rack",
    description: "Large guided ordnance rack with the highest volley damage.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "large",
    iconKind: "missile",
    weaponMount: createMount("missile", {
      id: "missile-rack-large",
      label: "L Missile Rack",
      barrels: 2,
      damage: 34,
      shieldPenetration: 0.38,
      armorPenetration: 0.2,
      accuracy: 0.68,
    }),
    cost: resources({ alloys: 52, minerals: 26 }),
    upkeep: resources({ energy: 0.14, alloys: 0.08 }),
  },
  weapon_point_defense: {
    id: "weapon_point_defense",
    label: "S Point Defense",
    description: "Small short-range rapid-fire weapon with excellent accuracy.",
    slotType: "weapon",
    weaponKind: "pointDefense",
    weaponSize: "small",
    iconKind: "pointDefense",
    weaponMount: createMount("pointDefense", {
      id: "point-defense-small",
      label: "S Point Defense",
      barrels: 3,
      damage: 0.8,
      shieldPenetration: 0.05,
      armorPenetration: 0.22,
      accuracy: 0.92,
    }),
    cost: resources({ alloys: 20, minerals: 16 }),
    upkeep: resources({ energy: 0.05, alloys: 0.035 }),
  },
  weapon_point_defense_medium: {
    id: "weapon_point_defense_medium",
    label: "M Flak Battery",
    description: "Medium rapid-fire flak system with broad defensive coverage.",
    slotType: "weapon",
    weaponKind: "pointDefense",
    weaponSize: "medium",
    iconKind: "pointDefense",
    weaponMount: createMount("pointDefense", {
      id: "point-defense-medium",
      label: "M Flak Battery",
      barrels: 5,
      damage: 1,
      shieldPenetration: 0.05,
      armorPenetration: 0.24,
      accuracy: 0.9,
    }),
    cost: resources({ alloys: 30, minerals: 20 }),
    upkeep: resources({ energy: 0.08, alloys: 0.05 }),
  },
  weapon_point_defense_large: {
    id: "weapon_point_defense_large",
    label: "L Flak Array",
    description: "Large rapid-fire array that saturates close range targets.",
    slotType: "weapon",
    weaponKind: "pointDefense",
    weaponSize: "large",
    iconKind: "pointDefense",
    weaponMount: createMount("pointDefense", {
      id: "point-defense-large",
      label: "L Flak Array",
      barrels: 8,
      damage: 1.2,
      shieldPenetration: 0.05,
      armorPenetration: 0.26,
      accuracy: 0.88,
    }),
    cost: resources({ alloys: 44, minerals: 26 }),
    upkeep: resources({ energy: 0.12, alloys: 0.07 }),
  },
  weapon_railgun_small: {
    id: "weapon_railgun_small",
    label: "S Railgun",
    description: "Small kinetic weapon with high shield disruption and accurate medium-range fire.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "small",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "railgun-small",
      label: "S Railgun",
      barrels: 1,
      damage: 10,
      shieldPenetration: 0.42,
      armorPenetration: 0.08,
      accuracy: 0.84,
    }),
    cost: resources({ alloys: 24, minerals: 20 }),
    upkeep: resources({ energy: 0.08, alloys: 0.025 }),
  },
  weapon_railgun_medium: {
    id: "weapon_railgun_medium",
    label: "M Railgun",
    description: "Medium kinetic battery for destroyers and larger fleet hulls.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "medium",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "railgun-medium",
      label: "M Railgun",
      barrels: 2,
      damage: 14,
      shieldPenetration: 0.45,
      armorPenetration: 0.1,
      accuracy: 0.82,
    }),
    cost: resources({ alloys: 36, minerals: 28 }),
    upkeep: resources({ energy: 0.12, alloys: 0.04 }),
  },
  weapon_railgun_large: {
    id: "weapon_railgun_large",
    label: "L Railgun",
    description: "Large spinal kinetic mount for heavy hulls that breaks shield lines.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "large",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "railgun-large",
      label: "L Railgun",
      barrels: 2,
      damage: 22,
      shieldPenetration: 0.48,
      armorPenetration: 0.12,
      accuracy: 0.78,
    }),
    cost: resources({ alloys: 58, minerals: 42 }),
    upkeep: resources({ energy: 0.2, alloys: 0.065 }),
  },
  weapon_plasma_projector_medium: {
    id: "weapon_plasma_projector_medium",
    label: "M Plasma Projector",
    description: "Medium plasma weapon that burns armor and hull at sustained combat ranges.",
    slotType: "weapon",
    weaponKind: "plasma",
    weaponSize: "medium",
    iconKind: "plasma",
    shipKinds: ["destroyer", "cruiser", "battleship"],
    weaponMount: createMount("plasma", {
      id: "plasma-projector-medium",
      label: "M Plasma Projector",
      barrels: 1,
      damage: 24,
      shieldPenetration: 0.08,
      armorPenetration: 0.55,
      accuracy: 0.76,
    }),
    cost: resources({ alloys: 42, minerals: 24, energy: 12 }),
    upkeep: resources({ energy: 0.22, alloys: 0.045 }),
  },
  weapon_plasma_projector_large: {
    id: "weapon_plasma_projector_large",
    label: "L Plasma Lance",
    description: "Large plasma lance for cruiser and battleship batteries.",
    slotType: "weapon",
    weaponKind: "plasma",
    weaponSize: "large",
    iconKind: "plasma",
    shipKinds: ["cruiser", "battleship"],
    weaponMount: createMount("plasma", {
      id: "plasma-projector-large",
      label: "L Plasma Lance",
      barrels: 1,
      damage: 42,
      shieldPenetration: 0.08,
      armorPenetration: 0.62,
      accuracy: 0.72,
    }),
    cost: resources({ alloys: 68, minerals: 36, energy: 20 }),
    upkeep: resources({ energy: 0.34, alloys: 0.075 }),
  },
  weapon_phase_laser_small: {
    id: "weapon_phase_laser_small",
    label: "S Phase Laser",
    description: "Compact phased beam emitter with stronger armor burn and reliable hit rates.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "small",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "phase-laser-small",
      label: "S Phase Laser",
      barrels: 1,
      damage: 11,
      shieldPenetration: 0.14,
      armorPenetration: 0.48,
      accuracy: 0.88,
    }),
    cost: resources({ alloys: 26, minerals: 14, energy: 8 }),
    upkeep: resources({ energy: 0.16, alloys: 0.018 }),
  },
  weapon_phase_laser_medium: {
    id: "weapon_phase_laser_medium",
    label: "M Phase Laser",
    description: "Medium phased beam battery for sustained anti-armor fire.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "medium",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "phase-laser-medium",
      label: "M Phase Laser",
      barrels: 2,
      damage: 13,
      shieldPenetration: 0.15,
      armorPenetration: 0.5,
      accuracy: 0.86,
    }),
    cost: resources({ alloys: 36, minerals: 18, energy: 12 }),
    upkeep: resources({ energy: 0.25, alloys: 0.03 }),
  },
  weapon_phase_laser_large: {
    id: "weapon_phase_laser_large",
    label: "L Phase Laser",
    description: "Large phase-lensed emitter for heavy armor cracking.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponSize: "large",
    iconKind: "laser",
    weaponMount: createMount("laser", {
      id: "phase-laser-large",
      label: "L Phase Laser",
      barrels: 2,
      damage: 22,
      shieldPenetration: 0.16,
      armorPenetration: 0.55,
      accuracy: 0.82,
    }),
    cost: resources({ alloys: 58, minerals: 30, energy: 18 }),
    upkeep: resources({ energy: 0.42, alloys: 0.05 }),
  },
  weapon_swarmer_missile_small: {
    id: "weapon_swarmer_missile_small",
    label: "S Swarmer Missiles",
    description: "Small saturation missile rack that overwhelms evasive screens.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "small",
    iconKind: "missile",
    weaponMount: createMount("missile", {
      id: "swarmer-missile-small",
      label: "S Swarmer Missiles",
      barrels: 2,
      damage: 11,
      shieldPenetration: 0.32,
      armorPenetration: 0.16,
      accuracy: 0.78,
    }),
    cost: resources({ alloys: 34, minerals: 18, goods: 6 }),
    upkeep: resources({ energy: 0.1, alloys: 0.05 }),
  },
  weapon_torpedo_medium: {
    id: "weapon_torpedo_medium",
    label: "M Torpedo Rack",
    description: "Heavy guided torpedo package with strong shield bypass and long cycle time.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "medium",
    iconKind: "missile",
    weaponMount: createMount("missile", {
      id: "torpedo-medium",
      label: "M Torpedo Rack",
      barrels: 1,
      damage: 42,
      shieldPenetration: 0.48,
      armorPenetration: 0.26,
      accuracy: 0.7,
    }),
    cost: resources({ alloys: 48, minerals: 24, goods: 8 }),
    upkeep: resources({ energy: 0.14, alloys: 0.07 }),
  },
  weapon_torpedo_large: {
    id: "weapon_torpedo_large",
    label: "L Siege Torpedoes",
    description: "Capital torpedo tubes for decisive volleys against shields and armor.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponSize: "large",
    iconKind: "missile",
    shipKinds: ["destroyer", "cruiser", "battleship"],
    weaponMount: createMount("missile", {
      id: "torpedo-large",
      label: "L Siege Torpedoes",
      barrels: 2,
      damage: 44,
      shieldPenetration: 0.52,
      armorPenetration: 0.28,
      accuracy: 0.66,
    }),
    cost: resources({ alloys: 76, minerals: 38, goods: 12 }),
    upkeep: resources({ energy: 0.24, alloys: 0.105 }),
  },
  weapon_gauss_small: {
    id: "weapon_gauss_small",
    label: "S Gauss Driver",
    description: "Advanced kinetic accelerator with improved shield disruption.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "small",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "gauss-small",
      label: "S Gauss Driver",
      barrels: 1,
      damage: 13,
      shieldPenetration: 0.55,
      armorPenetration: 0.12,
      accuracy: 0.86,
    }),
    cost: resources({ alloys: 36, minerals: 28, energy: 8 }),
    upkeep: resources({ energy: 0.13, alloys: 0.04 }),
  },
  weapon_gauss_medium: {
    id: "weapon_gauss_medium",
    label: "M Gauss Battery",
    description: "Medium gauss battery that shreds shield layers at fleet range.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "medium",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "gauss-medium",
      label: "M Gauss Battery",
      barrels: 2,
      damage: 18,
      shieldPenetration: 0.58,
      armorPenetration: 0.14,
      accuracy: 0.84,
    }),
    cost: resources({ alloys: 52, minerals: 40, energy: 12 }),
    upkeep: resources({ energy: 0.2, alloys: 0.06 }),
  },
  weapon_gauss_large: {
    id: "weapon_gauss_large",
    label: "L Gauss Cannon",
    description: "Large gauss cannon for capital shield-breaking volleys.",
    slotType: "weapon",
    weaponKind: "railgun",
    weaponSize: "large",
    iconKind: "railgun",
    weaponMount: createMount("railgun", {
      id: "gauss-large",
      label: "L Gauss Cannon",
      barrels: 2,
      damage: 29,
      shieldPenetration: 0.6,
      armorPenetration: 0.16,
      accuracy: 0.8,
    }),
    cost: resources({ alloys: 82, minerals: 58, energy: 18 }),
    upkeep: resources({ energy: 0.32, alloys: 0.095 }),
  },
  weapon_fusion_plasma_medium: {
    id: "weapon_fusion_plasma_medium",
    label: "M Fusion Plasma",
    description: "Late armor-burning plasma projector with improved containment and hit stability.",
    slotType: "weapon",
    weaponKind: "plasma",
    weaponSize: "medium",
    iconKind: "plasma",
    shipKinds: ["destroyer", "cruiser", "battleship"],
    weaponMount: createMount("plasma", {
      id: "fusion-plasma-medium",
      label: "M Fusion Plasma",
      barrels: 1,
      damage: 32,
      shieldPenetration: 0.1,
      armorPenetration: 0.68,
      accuracy: 0.78,
    }),
    cost: resources({ alloys: 62, minerals: 34, energy: 24 }),
    upkeep: resources({ energy: 0.34, alloys: 0.065 }),
  },
  weapon_fusion_plasma_large: {
    id: "weapon_fusion_plasma_large",
    label: "L Fusion Lance",
    description: "Capital plasma lance for burning through heavy armor and hull.",
    slotType: "weapon",
    weaponKind: "plasma",
    weaponSize: "large",
    iconKind: "plasma",
    shipKinds: ["cruiser", "battleship"],
    weaponMount: createMount("plasma", {
      id: "fusion-plasma-large",
      label: "L Fusion Lance",
      barrels: 1,
      damage: 58,
      shieldPenetration: 0.1,
      armorPenetration: 0.74,
      accuracy: 0.74,
    }),
    cost: resources({ alloys: 96, minerals: 52, energy: 36 }),
    upkeep: resources({ energy: 0.52, alloys: 0.11 }),
  },
  defense_shield_generator: {
    id: "defense_shield_generator",
    label: "Shield Generator",
    description: "Adds a regenerating shield layer.",
    slotType: "defense",
    defenseKind: "shield",
    iconKind: "shield",
    modifiers: { maxShield: 70, upkeep: { energy: 0.16 }, cost: { alloys: 22, minerals: 18 } },
    cost: resources({ alloys: 22, minerals: 18 }),
    upkeep: resources({ energy: 0.16 }),
  },
  defense_phase_shield: {
    id: "defense_phase_shield",
    label: "Phase Shield",
    description: "Advanced shield projector with high endurance and power draw.",
    slotType: "defense",
    defenseKind: "shield",
    iconKind: "shield",
    modifiers: { maxShield: 105, upkeep: { energy: 0.28 }, cost: { alloys: 38, minerals: 22, energy: 12 } },
    cost: resources({ alloys: 38, minerals: 22, energy: 12 }),
    upkeep: resources({ energy: 0.28 }),
  },
  defense_armor_plating: {
    id: "defense_armor_plating",
    label: "Armor Plating",
    description: "Adds durable armor that must be repaired after battle.",
    slotType: "defense",
    defenseKind: "armor",
    iconKind: "armor",
    modifiers: { maxArmor: 58, cost: { alloys: 26, minerals: 24 } },
    cost: resources({ alloys: 26, minerals: 24 }),
    upkeep: resources({ alloys: 0.015 }),
  },
  defense_composite_armor: {
    id: "defense_composite_armor",
    label: "Composite Armor",
    description: "Layered armor material that improves protection without excessive mass.",
    slotType: "defense",
    defenseKind: "armor",
    iconKind: "armor",
    modifiers: { maxArmor: 88, cost: { alloys: 42, minerals: 34, goods: 8 }, upkeep: { alloys: 0.025 } },
    cost: resources({ alloys: 42, minerals: 34, goods: 8 }),
    upkeep: resources({ alloys: 0.025 }),
  },
  defense_reinforced_hull: {
    id: "defense_reinforced_hull",
    label: "Reinforced Hull",
    description: "Adds extra structural hull points.",
    slotType: "defense",
    defenseKind: "hull",
    iconKind: "hull",
    modifiers: { maxHull: 52, cost: { alloys: 24, minerals: 26 } },
    cost: resources({ alloys: 24, minerals: 26 }),
    upkeep: resources({}),
  },
  defense_reactive_hull: {
    id: "defense_reactive_hull",
    label: "Reactive Hull",
    description: "Reactive structural bracing that increases hull survival in prolonged battles.",
    slotType: "defense",
    defenseKind: "hull",
    iconKind: "hull",
    modifiers: { maxHull: 78, buildDays: 1, cost: { alloys: 40, minerals: 42, goods: 6 } },
    cost: resources({ alloys: 40, minerals: 42, goods: 6 }),
    upkeep: resources({ goods: 0.015 }),
  },
  utility_ion_propulsors: {
    id: "utility_ion_propulsors",
    label: "Ion Propulsors",
    description: "Legacy propulsion component retained only for old saves.",
    slotType: "utility",
    iconKind: "speed",
    availableInDesigner: false,
    modifiers: { speed: 0.22, evasion: 0.03, cost: { alloys: 28, energy: 18 }, upkeep: { energy: 0.18 } },
    cost: resources({ alloys: 28, energy: 18 }),
    upkeep: resources({ energy: 0.18 }),
  },
  utility_optical_array: {
    id: "utility_optical_array",
    label: "Military Sensor",
    description: "Combat-grade array for military contacts, targeting telemetry, and basic planetary surveys.",
    slotType: "utility",
    iconKind: "sensor",
    shipKinds: ["corvette", "destroyer", "cruiser", "battleship", "defensePlatform", "armyShip"],
    modifiers: {
      sensorRange: 1,
      weaponRangeBonusBands: 1,
      cost: { alloys: 24, goods: 10 },
      upkeep: { energy: 0.1 },
    },
    cost: resources({ alloys: 24, goods: 10 }),
    upkeep: resources({ energy: 0.1 }),
    sensorSuiteIds: ["militaryShipSensors"],
  },
  utility_survey_array: {
    id: "utility_survey_array",
    label: "Science Sensor",
    description: "Science-ship-only array with precise local surveys and long-range stellar classification.",
    slotType: "utility",
    iconKind: "sensor",
    shipKinds: ["scienceShip"],
    modifiers: {
      cost: { alloys: 28, goods: 14, research: 4 },
      upkeep: { energy: 0.14 },
    },
    cost: resources({ alloys: 28, goods: 14, research: 4 }),
    upkeep: resources({ energy: 0.14 }),
    sensorSuiteIds: ["scienceShipSensors"],
  },
  utility_civilian_sensor: {
    id: "utility_civilian_sensor",
    label: "Civilian Sensor",
    description: "General navigation array that identifies stars, planets, and nearby traffic without military-grade classification.",
    slotType: "utility",
    iconKind: "sensor",
    modifiers: {
      cost: { alloys: 16, goods: 8 },
      upkeep: { energy: 0.07 },
    },
    cost: resources({ alloys: 16, goods: 8 }),
    upkeep: resources({ energy: 0.07 }),
    sensorSuiteIds: ["civilianShipSensors"],
  },
  utility_fire_control: {
    id: "utility_fire_control",
    label: "Fire Control",
    description: "Improves weapon accuracy at the cost of extra power draw.",
    slotType: "utility",
    iconKind: "targeting",
    modifiers: {
      weaponAccuracyBonus: 0.05,
      cost: { alloys: 22, goods: 12 },
      upkeep: { energy: 0.12 },
    },
    cost: resources({ alloys: 22, goods: 12 }),
    upkeep: resources({ energy: 0.12 }),
  },
  utility_reactor_capacitor: {
    id: "utility_reactor_capacitor",
    label: "Reactor Capacitor",
    description: "Adds reserve shield capacity and slightly improves weapon output.",
    slotType: "utility",
    iconKind: "power",
    modifiers: {
      maxShield: 25,
      weaponDamageMultiplier: 0.08,
      cost: { alloys: 26, energy: 22 },
      upkeep: { energy: 0.16 },
    },
    cost: resources({ alloys: 26, energy: 22 }),
    upkeep: resources({ energy: 0.16 }),
  },
  utility_repair_drones: {
    id: "utility_repair_drones",
    label: "Repair Drones",
    description: "Adds redundant maintenance systems and hull reinforcement.",
    slotType: "utility",
    iconKind: "repair",
    modifiers: {
      maxHull: 24,
      buildDays: 1,
      cost: { alloys: 24, goods: 8 },
    },
    cost: resources({ alloys: 24, goods: 8 }),
    upkeep: resources({}),
  },
  utility_shield_capacitor: {
    id: "utility_shield_capacitor",
    label: "Shield Capacitor",
    description: "Adds shield capacity without changing propulsion.",
    slotType: "utility",
    iconKind: "shield",
    modifiers: {
      maxShield: 32,
      cost: { alloys: 24, energy: 18 },
      upkeep: { energy: 0.14 },
    },
    cost: resources({ alloys: 24, energy: 18 }),
    upkeep: resources({ energy: 0.14 }),
  },
  utility_command_uplink: {
    id: "utility_command_uplink",
    label: "Command Uplink",
    description: "Fleet coordination suite for larger hulls that improves targeting and sensor reach.",
    slotType: "utility",
    iconKind: "command",
    shipKinds: ["destroyer", "cruiser", "battleship"],
    modifiers: {
      sensorRange: 1,
      weaponAccuracyBonus: 0.03,
      crewDemand: 120,
      cost: { alloys: 34, goods: 24 },
      upkeep: { energy: 0.18, goods: 0.03 },
    },
    cost: resources({ alloys: 34, goods: 24 }),
    upkeep: resources({ energy: 0.18, goods: 0.03 }),
  },
  utility_armor_nanites: {
    id: "utility_armor_nanites",
    label: "Armor Nanites",
    description: "Automated repair mesh that raises maximum armor and repairs it even during combat.",
    slotType: "utility",
    iconKind: "repair",
    shipKinds: ["cruiser", "battleship"],
    modifiers: {
      maxArmor: 48,
      buildDays: 2,
      cost: { alloys: 38, goods: 18 },
    },
    cost: resources({ alloys: 38, goods: 18 }),
    upkeep: resources({}),
  },
  utility_gravitic_drive: {
    id: "utility_gravitic_drive",
    label: "Gravitic Drive",
    description: "Advanced field drive that improves strategic speed and evasion at high power cost.",
    slotType: "utility",
    iconKind: "speed",
    modifiers: {
      speed: 0.18,
      evasion: 0.025,
      crewDemand: 80,
      cost: { alloys: 46, energy: 34, goods: 16 },
      upkeep: { energy: 0.28, goods: 0.02 },
    },
    cost: resources({ alloys: 46, energy: 34, goods: 16 }),
    upkeep: resources({ energy: 0.28, goods: 0.02 }),
  },
  utility_battle_ai: {
    id: "utility_battle_ai",
    label: "Battle AI",
    description: "Predictive combat computer that improves accuracy and coordinated fire.",
    slotType: "utility",
    iconKind: "command",
    shipKinds: ["destroyer", "cruiser", "battleship"],
    modifiers: {
      sensorRange: 1,
      weaponAccuracyBonus: 0.06,
      weaponDamageMultiplier: 0.06,
      crewDemand: -140,
      cost: { alloys: 48, goods: 38, research: 20 },
      upkeep: { energy: 0.24, goods: 0.06 },
    },
    cost: resources({ alloys: 48, goods: 38, research: 20 }),
    upkeep: resources({ energy: 0.24, goods: 0.06 }),
  },
};

export const SHIP_WEAPON_SECTION_MODULES = Object.values(SHIP_SECTION_MODULE_DEFINITIONS)
  .filter((module) => module.slotType === "weaponSection");
export const SHIP_DEFENSE_SECTION_MODULES = Object.values(SHIP_SECTION_MODULE_DEFINITIONS)
  .filter((module) => module.slotType === "defenseSection");
export const SHIP_WEAPON_MODULES = Object.values(SHIP_MODULE_DEFINITIONS)
  .filter((module) => module.slotType === "weapon" && module.availableInDesigner !== false);
export const SHIP_DEFENSE_MODULES = Object.values(SHIP_MODULE_DEFINITIONS)
  .filter((module) => module.slotType === "defense" && module.availableInDesigner !== false);
export const SHIP_UTILITY_MODULES = Object.values(SHIP_MODULE_DEFINITIONS)
  .filter((module) => module.slotType === "utility" && module.availableInDesigner !== false);

const DEFAULT_WEAPON_SECTIONS: Record<StarbaseShipKind, string[]> = {
  corvette: ["weapon_section_corvette_swarmer"],
  destroyer: ["weapon_section_destroyer_line"],
  cruiser: ["weapon_section_cruiser_line", "weapon_section_cruiser_line"],
  battleship: ["weapon_section_battleship_line", "weapon_section_battleship_line", "weapon_section_battleship_line"],
  defensePlatform: ["weapon_section_defense_platform_battery"],
  scienceShip: [],
  armyShip: [],
  constructionShip: [],
  colonizationShip: [],
};

const DEFAULT_DEFENSE_SECTIONS: Record<StarbaseShipKind, string[]> = {
  corvette: ["defense_section_corvette_swarmer"],
  destroyer: ["defense_section_destroyer_line"],
  cruiser: ["defense_section_cruiser_line", "defense_section_cruiser_line"],
  battleship: ["defense_section_battleship_line", "defense_section_battleship_line", "defense_section_battleship_line"],
  defensePlatform: ["defense_section_defense_platform_bastion"],
  scienceShip: [],
  armyShip: [],
  constructionShip: [],
  colonizationShip: [],
};

const DEFAULT_UTILITY_MODULES: Record<StarbaseShipKind, string[]> = {
  corvette: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  destroyer: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
    "utility_fire_control",
  ],
  cruiser: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
    "utility_reactor_capacitor",
    "utility_fire_control",
  ],
  battleship: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
    "utility_reactor_capacitor",
    "utility_fire_control",
    "utility_repair_drones",
  ],
  defensePlatform: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  scienceShip: [
    "utility_survey_array",
    "utility_civilian_sensor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  armyShip: [
    "utility_optical_array",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  constructionShip: [
    "utility_civilian_sensor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  colonizationShip: [
    "utility_civilian_sensor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
};

const DEFAULT_WEAPON_BY_SIZE: Record<WeaponSlotSize, string> = {
  small: "weapon_laser_cannon",
  medium: "weapon_missile_rack",
  large: "weapon_missile_rack_large",
};

const DEFAULT_WEAPON_MODULES_BY_KIND: Partial<Record<StarbaseShipKind, string[]>> = {
  // The baseline destroyer is deliberately an escort: useful direct kinetic
  // output plus one high-throughput flak battery for missile screening.
  destroyer: ["weapon_railgun_medium", "weapon_point_defense_medium", "weapon_phase_laser_small"],
};

const DEFAULT_DEFENSE_MODULES = [
  "defense_shield_generator",
  "defense_armor_plating",
  "defense_reinforced_hull",
  "defense_shield_generator",
];

export function createDefaultShipDesignId(ownerId: number, shipKind: StarbaseShipKind): string {
  return `design-${ownerId}-${shipKind}-default`;
}

export function isKnownShipKind(value: unknown): value is StarbaseShipKind {
  return typeof value === "string" && STARBASE_SHIP_KINDS.includes(value as StarbaseShipKind);
}

export function getShipModuleDefinition(moduleId: string | null | undefined): ShipModuleDefinition | null {
  if (!moduleId) return null;
  return SHIP_MODULE_DEFINITIONS[moduleId] ?? null;
}

export function getShipSectionModuleDefinition(moduleId: string | null | undefined): ShipSectionModuleDefinition | null {
  if (!moduleId) return null;
  return SHIP_SECTION_MODULE_DEFINITIONS[moduleId] ?? null;
}

export function getShipSectionModulesForKind(
  shipKind: StarbaseShipKind,
  slotType: ShipSectionSlotType,
): ShipSectionModuleDefinition[] {
  return Object.values(SHIP_SECTION_MODULE_DEFINITIONS)
    .filter((module) => module.slotType === slotType && module.shipKinds.includes(shipKind));
}

export function getShipModulesForComponentSlot(
  shipKind: StarbaseShipKind,
  slot: ShipComponentSlotDefinition,
): ShipModuleDefinition[] {
  return Object.values(SHIP_MODULE_DEFINITIONS)
    .filter((module) => (
      module.availableInDesigner !== false
      && module.slotType === slot.kind
      && (!module.shipKinds || module.shipKinds.includes(shipKind))
      && (slot.kind !== "weapon" || module.weaponSize === slot.size)
    ));
}

function getSectionSlots(design: ShipDesign, slotType: ShipSectionSlotType): ShipComponentSlotDefinition[] {
  const ids = slotType === "weaponSection" ? design.weaponSectionModuleIds : design.defenseSectionModuleIds;
  return ids.flatMap((moduleId) => {
    const section = getShipSectionModuleDefinition(moduleId);
    return section?.slotType === slotType ? section.slots : [];
  });
}

export function getShipDesignLayout(design: ShipDesign): ShipDesignLayout {
  const hull = SHIP_HULL_DEFINITIONS[design.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  return {
    weaponSlots: getSectionSlots(design, "weaponSection"),
    defenseSlots: getSectionSlots(design, "defenseSection"),
    utilitySlots: Array.from({ length: hull.utilitySlots }, () => ({ kind: "utility" as const, label: "Utility" })),
  };
}

function normalizeSectionModuleIds(
  moduleIds: unknown,
  slotType: ShipSectionSlotType,
  shipKind: StarbaseShipKind,
  slotCount: number,
  fallback: string[],
): string[] {
  const ids = Array.isArray(moduleIds) ? moduleIds : fallback;
  const validIds = ids
    .map((id) => (typeof id === "string" ? id : ""))
    .filter((id) => {
      const module = SHIP_SECTION_MODULE_DEFINITIONS[id];
      return module?.slotType === slotType && module.shipKinds.includes(shipKind);
    });
  while (validIds.length < slotCount) {
    validIds.push(fallback[validIds.length % Math.max(1, fallback.length)] ?? "");
  }
  return validIds.slice(0, slotCount).filter((id) => {
    const module = SHIP_SECTION_MODULE_DEFINITIONS[id];
    return module?.slotType === slotType && module.shipKinds.includes(shipKind);
  });
}

function getPairedDefenseSectionModuleIds(
  weaponSectionModuleIds: string[],
  shipKind: StarbaseShipKind,
  slotCount: number,
  fallback: string[],
  providedModuleIds?: unknown,
): string[] {
  const paired = weaponSectionModuleIds
    .flatMap((moduleId) => {
      const pairedModuleId = SHIP_SECTION_MODULE_DEFINITIONS[moduleId]?.pairedDefenseSectionModuleId;
      return pairedModuleId ? [pairedModuleId] : [];
    })
    .filter((pairedModuleId) => {
      const module = SHIP_SECTION_MODULE_DEFINITIONS[pairedModuleId];
      return module?.slotType === "defenseSection" && module.shipKinds.includes(shipKind);
    });
  const provided = normalizeSectionModuleIds(providedModuleIds, "defenseSection", shipKind, slotCount, fallback);
  const next = paired.slice(0, slotCount);
  while (next.length < slotCount) {
    next.push(provided[next.length] ?? fallback[next.length % Math.max(1, fallback.length)] ?? "");
  }
  return next.slice(0, slotCount).filter((moduleId) => {
    const module = SHIP_SECTION_MODULE_DEFINITIONS[moduleId];
    return module?.slotType === "defenseSection" && module.shipKinds.includes(shipKind);
  });
}

function isModuleCompatibleWithSlot(
  moduleId: string | null | undefined,
  shipKind: StarbaseShipKind,
  slot: ShipComponentSlotDefinition,
): boolean {
  const module = getShipModuleDefinition(moduleId);
  return Boolean(
    module
    && module.availableInDesigner !== false
    && module.slotType === slot.kind
    && (!module.shipKinds || module.shipKinds.includes(shipKind))
    && (slot.kind !== "weapon" || module.weaponSize === slot.size),
  );
}

function fallbackModuleForSlot(
  shipKind: StarbaseShipKind,
  slot: ShipComponentSlotDefinition,
  index: number,
): string {
  if (slot.kind === "weapon") {
    return DEFAULT_WEAPON_BY_SIZE[slot.size ?? "small"];
  }
  if (slot.kind === "defense") {
    return DEFAULT_DEFENSE_MODULES[index % DEFAULT_DEFENSE_MODULES.length];
  }
  const utilityFallback = DEFAULT_UTILITY_MODULES[shipKind] ?? DEFAULT_UTILITY_MODULES.corvette;
  return utilityFallback[index % utilityFallback.length];
}

function normalizeComponentModuleIds(
  moduleIds: unknown,
  shipKind: StarbaseShipKind,
  slots: ShipComponentSlotDefinition[],
  fallback?: string[],
): string[] {
  const ids = Array.isArray(moduleIds) ? moduleIds : fallback ?? [];
  return slots.map((slot, index) => {
    const candidate = typeof ids[index] === "string" ? ids[index] : null;
    if (isModuleCompatibleWithSlot(candidate, shipKind, slot)) return candidate!;
    const fallbackCandidate = fallback?.[index];
    if (isModuleCompatibleWithSlot(fallbackCandidate, shipKind, slot)) return fallbackCandidate!;
    const slotFallback = fallbackModuleForSlot(shipKind, slot, index);
    if (isModuleCompatibleWithSlot(slotFallback, shipKind, slot)) return slotFallback;
    return getShipModulesForComponentSlot(shipKind, slot)[0]?.id ?? "";
  }).filter((id, index) => isModuleCompatibleWithSlot(id, shipKind, slots[index]));
}

function getLegacyUtilityModuleIds(value: Partial<ShipDesign> | null | undefined): unknown {
  if (Array.isArray(value?.utilityModuleIds)) return value.utilityModuleIds;
  return typeof value?.utilityModuleId === "string" ? [value.utilityModuleId] : undefined;
}

export function createDefaultShipDesign(
  ownerId: number,
  shipKind: StarbaseShipKind = "corvette",
  year = 2100,
): ShipDesign {
  const hull = SHIP_HULL_DEFINITIONS[shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  const weaponSectionModuleIds = [...(DEFAULT_WEAPON_SECTIONS[hull.kind] ?? DEFAULT_WEAPON_SECTIONS.corvette)];
  const defenseSectionModuleIds = [...(DEFAULT_DEFENSE_SECTIONS[hull.kind] ?? DEFAULT_DEFENSE_SECTIONS.corvette)];
  const draftForLayout: ShipDesign = {
    id: createDefaultShipDesignId(ownerId, hull.kind),
    ownerId,
    shipKind: hull.kind,
    name: `${hull.baseClassName}-class ${hull.label}`,
    status: "active",
    weaponSectionModuleIds,
    defenseSectionModuleIds,
    weaponModuleIds: [],
    defenseModuleIds: [],
    utilityModuleIds: [],
    utilityModuleId: null,
    createdAtYear: year,
    updatedAtYear: year,
  };
  const layout = getShipDesignLayout(draftForLayout);
  const utilityModuleIds = normalizeComponentModuleIds(
    DEFAULT_UTILITY_MODULES[hull.kind],
    hull.kind,
    layout.utilitySlots,
    DEFAULT_UTILITY_MODULES[hull.kind],
  );
  return {
    ...draftForLayout,
    weaponModuleIds: normalizeComponentModuleIds(DEFAULT_WEAPON_MODULES_BY_KIND[hull.kind], hull.kind, layout.weaponSlots),
    defenseModuleIds: normalizeComponentModuleIds([], hull.kind, layout.defenseSlots),
    utilityModuleIds,
    utilityModuleId: utilityModuleIds[0] ?? null,
  };
}

export function normalizeShipDesign(
  value: Partial<ShipDesign> | null | undefined,
  ownerId: number,
  year = 2100,
): ShipDesign {
  const rawKind = value?.shipKind;
  const shipKind = isKnownShipKind(rawKind) ? rawKind : "corvette";
  const hull = SHIP_HULL_DEFINITIONS[shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  const fallback = createDefaultShipDesign(ownerId, shipKind, year);
  const weaponSectionModuleIds = normalizeSectionModuleIds(
    value?.weaponSectionModuleIds,
    "weaponSection",
    shipKind,
    hull.weaponSectionSlots,
    fallback.weaponSectionModuleIds,
  );
  const defenseSectionModuleIds = getPairedDefenseSectionModuleIds(
    weaponSectionModuleIds,
    shipKind,
    hull.defenseSectionSlots,
    fallback.defenseSectionModuleIds,
    value?.defenseSectionModuleIds,
  );
  const layoutDraft: ShipDesign = {
    ...fallback,
    weaponSectionModuleIds,
    defenseSectionModuleIds,
  };
  const layout = getShipDesignLayout(layoutDraft);
  const utilityModuleIds = normalizeComponentModuleIds(
    getLegacyUtilityModuleIds(value),
    shipKind,
    layout.utilitySlots,
    fallback.utilityModuleIds,
  );

  return {
    id: typeof value?.id === "string" && value.id.length > 0 ? value.id : fallback.id,
    ownerId: Number.isInteger(value?.ownerId) ? Number(value?.ownerId) : ownerId,
    shipKind,
    name: typeof value?.name === "string" && value.name.trim().length > 0
      ? value.name.trim().slice(0, 40)
      : fallback.name,
    status: value?.status === "decommissioned" ? "decommissioned" : "active",
    weaponSectionModuleIds,
    defenseSectionModuleIds,
    weaponModuleIds: normalizeComponentModuleIds(
      value?.weaponModuleIds,
      shipKind,
      layout.weaponSlots,
      fallback.weaponModuleIds,
    ),
    defenseModuleIds: normalizeComponentModuleIds(
      value?.defenseModuleIds,
      shipKind,
      layout.defenseSlots,
      fallback.defenseModuleIds,
    ),
    utilityModuleIds,
    utilityModuleId: utilityModuleIds[0] ?? null,
    createdAtYear: Number.isFinite(value?.createdAtYear) ? Number(value?.createdAtYear) : year,
    updatedAtYear: Number.isFinite(value?.updatedAtYear) ? Number(value?.updatedAtYear) : year,
  };
}

function adjustRangeBand(rangeBand: RangeBand | undefined, bonus: number): RangeBand | undefined {
  if (!rangeBand || bonus === 0) return rangeBand;
  // outOfRange is a sentinel, never an attainable weapon band. Stacking range
  // sections therefore tops out at extreme instead of producing Infinity.
  return rangeBandFromIndex(Math.min(RANGE_BAND_INDEX.extreme, RANGE_BAND_INDEX[rangeBand] + bonus));
}

function applyWeaponModifiers(mount: WeaponMountDefinition, modifiers: ShipStatModifiers): WeaponMountDefinition {
  const damageMultiplier = 1 + Math.max(-0.75, modifiers.weaponDamageMultiplier ?? 0);
  const rangeBonus = Math.round(modifiers.weaponRangeBonusBands ?? 0);
  return {
    ...mount,
    damage: mount.damage * damageMultiplier,
    accuracy: Math.max(0.05, Math.min(0.98, mount.accuracy + (modifiers.weaponAccuracyBonus ?? 0))),
    maxRangeBand: adjustRangeBand(mount.maxRangeBand, rangeBonus),
    optimalRangeBand: adjustRangeBand(mount.optimalRangeBand, rangeBonus),
  };
}

function applyModifiersToTotals(
  modifiers: ShipStatModifiers | undefined,
  totals: {
    speed: number;
    buildDays: number;
    alloyUpkeepPerDay: number;
    crewDemand: number;
    maxShield: number;
    maxArmor: number;
    maxHull: number;
    evasion: number;
    sensorRange: number;
    weaponModifiers: ShipStatModifiers;
  },
): void {
  if (!modifiers) return;
  totals.maxShield += modifiers.maxShield ?? 0;
  totals.maxArmor += modifiers.maxArmor ?? 0;
  totals.maxHull += modifiers.maxHull ?? 0;
  totals.evasion += modifiers.evasion ?? 0;
  totals.sensorRange += modifiers.sensorRange ?? 0;
  totals.speed += modifiers.speed ?? 0;
  totals.buildDays += modifiers.buildDays ?? 0;
  totals.alloyUpkeepPerDay += modifiers.alloyUpkeepPerDay ?? 0;
  totals.crewDemand += modifiers.crewDemand ?? 0;
  totals.weaponModifiers = {
    ...totals.weaponModifiers,
    weaponAccuracyBonus: (totals.weaponModifiers.weaponAccuracyBonus ?? 0) + (modifiers.weaponAccuracyBonus ?? 0),
    weaponDamageMultiplier: (totals.weaponModifiers.weaponDamageMultiplier ?? 0) + (modifiers.weaponDamageMultiplier ?? 0),
    weaponRangeBonusBands: (totals.weaponModifiers.weaponRangeBonusBands ?? 0) + (modifiers.weaponRangeBonusBands ?? 0),
  };
}

export function calculateShipDesignStats(design: ShipDesign): ShipDesignStats {
  const hull = SHIP_HULL_DEFINITIONS[design.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  const totals = {
    speed: hull.speed,
    buildDays: hull.buildDays,
    alloyUpkeepPerDay: hull.alloyUpkeepPerDay,
    crewDemand: hull.crewDemand,
    maxShield: hull.combat.maxShield,
    maxArmor: hull.combat.maxArmor,
    maxHull: hull.combat.maxHull,
    evasion: hull.combat.evasion,
    sensorRange: hull.combat.sensorRange,
    weaponModifiers: {} as ShipStatModifiers,
  };
  let cost = resources(hull.cost);
  let upkeep = resources(hull.upkeep);
  const weaponMounts: WeaponMountDefinition[] = [];

  const sectionModuleIds = [
    ...design.weaponSectionModuleIds,
    ...design.defenseSectionModuleIds,
  ];
  for (const moduleId of sectionModuleIds) {
    const module = SHIP_SECTION_MODULE_DEFINITIONS[moduleId];
    if (!module) continue;
    cost = addResources(cost, module.cost);
    upkeep = addResources(upkeep, module.upkeep);
    applyModifiersToTotals(module.modifiers, totals);
  }

  const componentModuleIds = [
    ...design.weaponModuleIds,
    ...design.defenseModuleIds,
    ...design.utilityModuleIds,
  ].filter((id): id is string => !!id);

  for (const moduleId of componentModuleIds) {
    const module = SHIP_MODULE_DEFINITIONS[moduleId];
    if (!module) continue;
    cost = addResources(cost, module.cost);
    upkeep = addResources(upkeep, module.upkeep);
    applyModifiersToTotals(module.modifiers, totals);
    if (module.weaponMount) {
      weaponMounts.push({ ...module.weaponMount });
    }
  }

  return {
    shipKind: hull.kind,
    label: hull.label,
    className: design.name,
    speed: design.shipKind === "defensePlatform" ? 0 : Math.max(0.05, totals.speed),
    buildDays: Math.max(1, totals.buildDays),
    alloyUpkeepPerDay: Math.max(0, totals.alloyUpkeepPerDay),
    crewDemand: Math.max(0, totals.crewDemand),
    cost,
    upkeep,
    combat: {
      maxShield: Math.max(0, totals.maxShield),
      maxArmor: Math.max(0, totals.maxArmor),
      maxHull: Math.max(1, totals.maxHull),
      evasion: Math.max(0, Math.min(0.9, totals.evasion)),
      sensorRange: Math.max(1, totals.sensorRange),
      weaponMounts: weaponMounts.map((mount) => applyWeaponModifiers(mount, totals.weaponModifiers)),
    },
  };
}
