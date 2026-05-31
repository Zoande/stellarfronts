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
  return {
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
    speed: 1,
    buildDays: 6,
    alloyUpkeepPerDay: 12,
    crewDemand: 900,
    cost: resources({ minerals: 120, alloys: 90 }),
    upkeep: resources({ energy: 0.8, alloys: 0.08 }),
    combat: {
      maxShield: 0,
      maxArmor: 0,
      maxHull: 80,
      evasion: 0.24,
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
    speed: 0.85,
    buildDays: 8,
    alloyUpkeepPerDay: 10,
    crewDemand: 650,
    cost: resources({ minerals: 160, alloys: 120 }),
    upkeep: resources({ energy: 0.9, alloys: 0.1 }),
    combat: {
      maxShield: 45,
      maxArmor: 35,
      maxHull: 120,
      evasion: 0.1,
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
      damage: 4,
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
      damage: 5,
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
      damage: 6,
      shieldPenetration: 0.05,
      armorPenetration: 0.26,
      accuracy: 0.88,
    }),
    cost: resources({ alloys: 44, minerals: 26 }),
    upkeep: resources({ energy: 0.12, alloys: 0.07 }),
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
    label: "Optical Array",
    description: "Extends weapon engagement profiles and sensor reach.",
    slotType: "utility",
    iconKind: "sensor",
    modifiers: {
      sensorRange: 1,
      weaponRangeBonusBands: 1,
      cost: { alloys: 24, goods: 10 },
      upkeep: { energy: 0.1 },
    },
    cost: resources({ alloys: 24, goods: 10 }),
    upkeep: resources({ energy: 0.1 }),
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
      upkeep: { energy: 0.08, goods: 0.02 },
    },
    cost: resources({ alloys: 24, goods: 8 }),
    upkeep: resources({ energy: 0.08, goods: 0.02 }),
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
  constructionShip: [],
};

const DEFAULT_DEFENSE_SECTIONS: Record<StarbaseShipKind, string[]> = {
  corvette: ["defense_section_corvette_swarmer"],
  constructionShip: [],
};

const DEFAULT_UTILITY_MODULES: Record<StarbaseShipKind, string[]> = {
  corvette: [
    "utility_fire_control",
    "utility_optical_array",
    "utility_reactor_capacitor",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
  constructionShip: [
    "utility_optical_array",
    "utility_repair_drones",
    "utility_shield_capacitor",
  ],
};

const DEFAULT_WEAPON_BY_SIZE: Record<WeaponSlotSize, string> = {
  small: "weapon_laser_cannon",
  medium: "weapon_missile_rack",
  large: "weapon_missile_rack_large",
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
    weaponModuleIds: normalizeComponentModuleIds([], hull.kind, layout.weaponSlots),
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
  return rangeBandFromIndex(RANGE_BAND_INDEX[rangeBand] + bonus);
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
    speed: Math.max(0.05, totals.speed),
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
