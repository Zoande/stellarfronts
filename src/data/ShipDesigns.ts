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
export type ShipModuleSlotType = "weapon" | "defense" | "utility";
export type ShipDefenseModuleKind = "shield" | "armor" | "hull";

export interface ShipDesign {
  id: string;
  ownerId: number;
  shipKind: StarbaseShipKind;
  name: string;
  status: ShipDesignStatus;
  weaponModuleIds: string[];
  defenseModuleIds: string[];
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

export interface ShipModuleDefinition {
  id: string;
  label: string;
  description: string;
  slotType: ShipModuleSlotType;
  weaponKind?: WeaponKind;
  defenseKind?: ShipDefenseModuleKind;
  weaponMount?: WeaponMountDefinition;
  modifiers?: ShipStatModifiers;
  cost: ResourceCounts;
  upkeep: ResourceCounts;
}

export interface ShipHullDefinition {
  kind: StarbaseShipKind;
  label: string;
  baseClassName: string;
  description: string;
  weaponSlots: number;
  defenseSlots: number;
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

export const SHIP_HULL_DEFINITIONS: Record<StarbaseShipKind, ShipHullDefinition> = {
  corvette: {
    kind: "corvette",
    label: "Corvette",
    baseClassName: "Falcon",
    description: "Fast escort hull for patrols, interception, and early fleet operations.",
    weaponSlots: 3,
    defenseSlots: 4,
    utilitySlots: 1,
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
};

export const SHIP_MODULE_DEFINITIONS: Record<string, ShipModuleDefinition> = {
  weapon_laser_cannon: {
    id: "weapon_laser_cannon",
    label: "Laser Cannon",
    description: "Reliable medium-range energy weapon with strong armor penetration.",
    slotType: "weapon",
    weaponKind: "laser",
    weaponMount: createMount("laser", {
      id: "laser-cannon",
      label: "Laser Cannon",
      barrels: 2,
      damage: 10,
      shieldPenetration: 0.1,
      armorPenetration: 0.35,
      accuracy: 0.84,
    }),
    cost: resources({ alloys: 24, minerals: 12 }),
    upkeep: resources({ energy: 0.16, alloys: 0.02 }),
  },
  weapon_missile_rack: {
    id: "weapon_missile_rack",
    label: "Missile Rack",
    description: "Longer-range guided ordnance with heavy alpha damage and slower reloads.",
    slotType: "weapon",
    weaponKind: "missile",
    weaponMount: createMount("missile", {
      id: "missile-rack",
      label: "Missile Rack",
      barrels: 1,
      damage: 30,
      shieldPenetration: 0.35,
      armorPenetration: 0.18,
      accuracy: 0.72,
    }),
    cost: resources({ alloys: 34, minerals: 18 }),
    upkeep: resources({ energy: 0.08, alloys: 0.05 }),
  },
  weapon_point_defense: {
    id: "weapon_point_defense",
    label: "Point Defense",
    description: "Short-range rapid-fire ammunition system with excellent accuracy.",
    slotType: "weapon",
    weaponKind: "pointDefense",
    weaponMount: createMount("pointDefense", {
      id: "point-defense",
      label: "Point Defense",
      barrels: 4,
      damage: 4,
      shieldPenetration: 0.05,
      armorPenetration: 0.22,
      accuracy: 0.92,
    }),
    cost: resources({ alloys: 20, minerals: 16 }),
    upkeep: resources({ energy: 0.05, alloys: 0.035 }),
  },
  defense_shield_generator: {
    id: "defense_shield_generator",
    label: "Shield Generator",
    description: "Adds a regenerating shield layer.",
    slotType: "defense",
    defenseKind: "shield",
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
    modifiers: { maxHull: 52, cost: { alloys: 24, minerals: 26 } },
    cost: resources({ alloys: 24, minerals: 26 }),
    upkeep: resources({}),
  },
  utility_ion_propulsors: {
    id: "utility_ion_propulsors",
    label: "Ion Propulsors",
    description: "Improves strategic speed and evasive combat movement.",
    slotType: "utility",
    modifiers: { speed: 0.22, evasion: 0.03, cost: { alloys: 28, energy: 18 }, upkeep: { energy: 0.18 } },
    cost: resources({ alloys: 28, energy: 18 }),
    upkeep: resources({ energy: 0.18 }),
  },
  utility_optical_array: {
    id: "utility_optical_array",
    label: "Optical Targeting Array",
    description: "Extends weapon engagement profiles and sensor reach.",
    slotType: "utility",
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
    label: "Fire Control Computer",
    description: "Improves weapon accuracy at the cost of extra power draw.",
    slotType: "utility",
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
    modifiers: {
      maxShield: 25,
      weaponDamageMultiplier: 0.08,
      cost: { alloys: 26, energy: 22 },
      upkeep: { energy: 0.16 },
    },
    cost: resources({ alloys: 26, energy: 22 }),
    upkeep: resources({ energy: 0.16 }),
  },
};

export const SHIP_WEAPON_MODULES = Object.values(SHIP_MODULE_DEFINITIONS).filter((module) => module.slotType === "weapon");
export const SHIP_DEFENSE_MODULES = Object.values(SHIP_MODULE_DEFINITIONS).filter((module) => module.slotType === "defense");
export const SHIP_UTILITY_MODULES = Object.values(SHIP_MODULE_DEFINITIONS).filter((module) => module.slotType === "utility");

export function createDefaultShipDesignId(ownerId: number, shipKind: StarbaseShipKind): string {
  return `design-${ownerId}-${shipKind}-default`;
}

export function createDefaultShipDesign(
  ownerId: number,
  shipKind: StarbaseShipKind = "corvette",
  year = 2100,
): ShipDesign {
  const hull = SHIP_HULL_DEFINITIONS[shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  return {
    id: createDefaultShipDesignId(ownerId, hull.kind),
    ownerId,
    shipKind: hull.kind,
    name: `${hull.baseClassName}-class ${hull.label}`,
    status: "active",
    weaponModuleIds: ["weapon_laser_cannon", "weapon_missile_rack", "weapon_point_defense"],
    defenseModuleIds: [
      "defense_shield_generator",
      "defense_armor_plating",
      "defense_reinforced_hull",
      "defense_shield_generator",
    ],
    utilityModuleId: "utility_ion_propulsors",
    createdAtYear: year,
    updatedAtYear: year,
  };
}

export function isKnownShipKind(value: unknown): value is StarbaseShipKind {
  return typeof value === "string" && STARBASE_SHIP_KINDS.includes(value as StarbaseShipKind);
}

export function getShipModuleDefinition(moduleId: string | null | undefined): ShipModuleDefinition | null {
  if (!moduleId) return null;
  return SHIP_MODULE_DEFINITIONS[moduleId] ?? null;
}

function normalizeModuleIds(
  moduleIds: unknown,
  slotType: ShipModuleSlotType,
  slotCount: number,
  fallback: string[],
): string[] {
  const ids = Array.isArray(moduleIds) ? moduleIds : fallback;
  const validIds = ids
    .map((id) => (typeof id === "string" ? id : ""))
    .filter((id) => SHIP_MODULE_DEFINITIONS[id]?.slotType === slotType);
  while (validIds.length < slotCount) {
    validIds.push(fallback[validIds.length % Math.max(1, fallback.length)] ?? "");
  }
  return validIds.slice(0, slotCount).filter((id) => SHIP_MODULE_DEFINITIONS[id]?.slotType === slotType);
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
  const utilityModuleId = typeof value?.utilityModuleId === "string"
    && SHIP_MODULE_DEFINITIONS[value.utilityModuleId]?.slotType === "utility"
    ? value.utilityModuleId
    : fallback.utilityModuleId;

  return {
    id: typeof value?.id === "string" && value.id.length > 0 ? value.id : fallback.id,
    ownerId: Number.isInteger(value?.ownerId) ? Number(value?.ownerId) : ownerId,
    shipKind,
    name: typeof value?.name === "string" && value.name.trim().length > 0
      ? value.name.trim().slice(0, 40)
      : fallback.name,
    status: value?.status === "decommissioned" ? "decommissioned" : "active",
    weaponModuleIds: normalizeModuleIds(value?.weaponModuleIds, "weapon", hull.weaponSlots, fallback.weaponModuleIds),
    defenseModuleIds: normalizeModuleIds(value?.defenseModuleIds, "defense", hull.defenseSlots, fallback.defenseModuleIds),
    utilityModuleId,
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

export function calculateShipDesignStats(design: ShipDesign): ShipDesignStats {
  const hull = SHIP_HULL_DEFINITIONS[design.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  let speed = hull.speed;
  let buildDays = hull.buildDays;
  let alloyUpkeepPerDay = hull.alloyUpkeepPerDay;
  let crewDemand = hull.crewDemand;
  let maxShield = hull.combat.maxShield;
  let maxArmor = hull.combat.maxArmor;
  let maxHull = hull.combat.maxHull;
  let evasion = hull.combat.evasion;
  let sensorRange = hull.combat.sensorRange;
  let cost = resources(hull.cost);
  let upkeep = resources(hull.upkeep);
  let weaponModifiers: ShipStatModifiers = {};
  const weaponMounts: WeaponMountDefinition[] = [];

  const moduleIds = [
    ...design.weaponModuleIds,
    ...design.defenseModuleIds,
    design.utilityModuleId,
  ].filter((id): id is string => !!id);

  for (const moduleId of moduleIds) {
    const module = SHIP_MODULE_DEFINITIONS[moduleId];
    if (!module) continue;
    cost = addResources(cost, module.cost);
    upkeep = addResources(upkeep, module.upkeep);
    const modifiers = module.modifiers;
    if (modifiers) {
      maxShield += modifiers.maxShield ?? 0;
      maxArmor += modifiers.maxArmor ?? 0;
      maxHull += modifiers.maxHull ?? 0;
      evasion += modifiers.evasion ?? 0;
      sensorRange += modifiers.sensorRange ?? 0;
      speed += modifiers.speed ?? 0;
      buildDays += modifiers.buildDays ?? 0;
      alloyUpkeepPerDay += modifiers.alloyUpkeepPerDay ?? 0;
      crewDemand += modifiers.crewDemand ?? 0;
      weaponModifiers = {
        ...weaponModifiers,
        weaponAccuracyBonus: (weaponModifiers.weaponAccuracyBonus ?? 0) + (modifiers.weaponAccuracyBonus ?? 0),
        weaponDamageMultiplier: (weaponModifiers.weaponDamageMultiplier ?? 0) + (modifiers.weaponDamageMultiplier ?? 0),
        weaponRangeBonusBands: (weaponModifiers.weaponRangeBonusBands ?? 0) + (modifiers.weaponRangeBonusBands ?? 0),
      };
    }
    if (module.weaponMount) {
      weaponMounts.push({ ...module.weaponMount });
    }
  }

  return {
    shipKind: hull.kind,
    label: hull.label,
    className: design.name,
    speed: Math.max(0.05, speed),
    buildDays: Math.max(1, buildDays),
    alloyUpkeepPerDay: Math.max(0, alloyUpkeepPerDay),
    crewDemand: Math.max(0, crewDemand),
    cost,
    upkeep,
    combat: {
      maxShield: Math.max(0, maxShield),
      maxArmor: Math.max(0, maxArmor),
      maxHull: Math.max(1, maxHull),
      evasion: Math.max(0, Math.min(0.9, evasion)),
      sensorRange: Math.max(1, sensorRange),
      weaponMounts: weaponMounts.map((mount) => applyWeaponModifiers(mount, weaponModifiers)),
    },
  };
}
