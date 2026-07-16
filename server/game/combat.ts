import {
  RANGE_BAND_INDEX,
  rangeBandFromIndex,
  type RangeBand,
  type CombatAttackClass,
  type CombatCounterClass,
} from "../../src/game/CombatTypes";
import { WEAPON_KIND_DEFINITIONS } from "../../src/data/Starbase";
import type { WeaponMountDefinition } from "../../src/data/Starbase";

export interface CombatLayerState {
  shield: number;
  armor: number;
  hull: number;
  maxShield: number;
  maxArmor: number;
  maxHull: number;
}

export interface WeaponDamageResult {
  destroyed: boolean;
  shieldDamage: number;
  armorDamage: number;
  hullDamage: number;
}

export interface WeaponShotRoll {
  hit: boolean;
  accuracyMiss: boolean;
  dodged: boolean;
}

export interface CombatEngagementProfile {
  position: { x: number; z: number };
  range: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getWeaponId(mount: WeaponMountDefinition): string {
  return mount.id ?? mount.kind;
}

export function getWeaponName(mount: WeaponMountDefinition): string {
  return mount.label ?? mount.kind;
}

export function getWeaponCooldownRounds(mount: WeaponMountDefinition): number {
  return Math.max(1, Math.round(mount.cooldownRounds ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.cooldownRounds ?? 1));
}

export function getWeaponCooldownHours(mount: WeaponMountDefinition): number {
  if (Number.isFinite(mount.cooldownHours) && Number(mount.cooldownHours) > 0) return Number(mount.cooldownHours);
  const cycles = Math.max(1, Number(mount.cooldownRounds ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.cooldownRounds ?? 1));
  const base = mount.kind === "pointDefense" ? 0.5
    : mount.kind === "laser" ? 18
      : mount.kind === "railgun" ? 24
        : 18;
  return base * cycles;
}

export function getWeaponAttackClass(mount: WeaponMountDefinition): CombatAttackClass {
  if (mount.attackClass) return mount.attackClass;
  if (mount.kind === "laser") return "beam";
  if (mount.kind === "railgun") return "kinetic";
  if (mount.kind === "plasma") return "plasma";
  if (mount.kind === "pointDefense") return "pointDefense";
  return (mount.id ?? "").includes("torpedo") ? "torpedo" : "missile";
}

export function getWeaponTravelSpeed(mount: WeaponMountDefinition): number {
  if (Number.isFinite(mount.travelSpeed) && Number(mount.travelSpeed) > 0) return Number(mount.travelSpeed);
  switch (getWeaponAttackClass(mount)) {
    case "beam": return 640;
    case "pointDefense": return 720;
    case "kinetic": return 48;
    case "plasma": return 16;
    case "torpedo": return 6;
    case "missile": return 9;
  }
}

export function getWeaponInterceptableBy(mount: WeaponMountDefinition): CombatCounterClass[] {
  if (mount.interceptableBy) return [...mount.interceptableBy];
  const attackClass = getWeaponAttackClass(mount);
  if (attackClass === "missile" || attackClass === "torpedo") return ["pointDefense"];
  if (attackClass === "beam") return ["beamDiffraction"];
  if (attackClass === "kinetic") return ["kineticDeflection"];
  if (attackClass === "plasma") return ["plasmaDispersion"];
  if (attackClass === "pointDefense") return ["closeDefenseSuppression"];
  return [];
}

export function getWeaponCounterClass(mount: WeaponMountDefinition): CombatCounterClass | null {
  return mount.counterClass ?? (mount.kind === "pointDefense" ? "pointDefense" : null);
}

export function getWeaponMinRangeBand(mount: WeaponMountDefinition): RangeBand {
  return mount.minRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.minRangeBand ?? "pointBlank";
}

export function getWeaponMaxRangeBand(mount: WeaponMountDefinition): RangeBand {
  const band = mount.maxRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.maxRangeBand ?? "close";
  return band === "outOfRange" ? "extreme" : band;
}

export function getWeaponOptimalRangeBand(mount: WeaponMountDefinition): RangeBand {
  const band = mount.optimalRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.optimalRangeBand ?? getWeaponMaxRangeBand(mount);
  return band === "outOfRange" ? "extreme" : band;
}

export function weaponCanFireAtRange(mount: WeaponMountDefinition, rangeBand: RangeBand): boolean {
  const range = RANGE_BAND_INDEX[rangeBand];
  if (rangeBand === "outOfRange") return false;
  return range >= RANGE_BAND_INDEX[getWeaponMinRangeBand(mount)] && range <= RANGE_BAND_INDEX[getWeaponMaxRangeBand(mount)];
}

export const RANGE_BAND_SYSTEM_DISTANCE: Record<RangeBand, number> = {
  pointBlank: 6,
  close: 16,
  medium: 30,
  long: 46,
  extreme: 64,
  outOfRange: Number.POSITIVE_INFINITY,
};

export const RANGE_BAND_MIN_SYSTEM_DISTANCE: Record<RangeBand, number> = {
  pointBlank: 0,
  close: RANGE_BAND_SYSTEM_DISTANCE.pointBlank,
  medium: RANGE_BAND_SYSTEM_DISTANCE.close,
  long: RANGE_BAND_SYSTEM_DISTANCE.medium,
  extreme: RANGE_BAND_SYSTEM_DISTANCE.long,
  outOfRange: RANGE_BAND_SYSTEM_DISTANCE.extreme,
};

export function getWeaponMinSystemRange(mount: WeaponMountDefinition): number {
  return RANGE_BAND_MIN_SYSTEM_DISTANCE[getWeaponMinRangeBand(mount)] ?? 0;
}

export function getWeaponMaxSystemRange(mount: WeaponMountDefinition): number {
  return RANGE_BAND_SYSTEM_DISTANCE[getWeaponMaxRangeBand(mount)] ?? RANGE_BAND_SYSTEM_DISTANCE.close;
}

export function weaponCanFireAtDistance(mount: WeaponMountDefinition, distance: number): boolean {
  const normalized = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  return normalized >= getWeaponMinSystemRange(mount) && normalized <= getWeaponMaxSystemRange(mount);
}

export function rangeBandForSystemDistance(distance: number): RangeBand {
  const normalized = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  if (normalized <= RANGE_BAND_SYSTEM_DISTANCE.pointBlank) return "pointBlank";
  if (normalized <= RANGE_BAND_SYSTEM_DISTANCE.close) return "close";
  if (normalized <= RANGE_BAND_SYSTEM_DISTANCE.medium) return "medium";
  if (normalized <= RANGE_BAND_SYSTEM_DISTANCE.long) return "long";
  if (normalized <= RANGE_BAND_SYSTEM_DISTANCE.extreme) return "extreme";
  return "outOfRange";
}

export function combatEngagementProfilesCanInteract(
  a: CombatEngagementProfile[],
  b: CombatEngagementProfile[],
): boolean {
  for (const left of a) {
    for (const right of b) {
      const dx = left.position.x - right.position.x;
      const dz = left.position.z - right.position.z;
      if (Math.hypot(dx, dz) <= Math.max(left.range, right.range)) return true;
    }
  }
  return false;
}

export function getLegacyWeaponRange(mount: WeaponMountDefinition): number {
  return WEAPON_KIND_DEFINITIONS[mount.kind]?.range ?? Math.max(1, RANGE_BAND_INDEX[getWeaponMaxRangeBand(mount)]);
}

export function getPreferredRangeBand(mounts: WeaponMountDefinition[]): RangeBand {
  if (mounts.length === 0) return "close";
  const weights = mounts.map((mount) => Math.max(0.001, mount.damage * mount.barrels * clamp(mount.accuracy, 0, 1) / getWeaponCooldownHours(mount)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const average = mounts.reduce((total, mount, index) => total + RANGE_BAND_INDEX[getWeaponOptimalRangeBand(mount)] * weights[index], 0) / weightTotal;
  return rangeBandFromIndex(average);
}

export function rollWeaponShot(
  mount: WeaponMountDefinition,
  targetEvasion: number,
  rng: () => number = Math.random,
): WeaponShotRoll {
  const accuracy = clamp(mount.accuracy, 0, 1);
  if (rng() >= accuracy) {
    return { hit: false, accuracyMiss: true, dodged: false };
  }
  if (rng() < clamp(targetEvasion - (mount.tracking ?? 0), 0, 0.95)) {
    return { hit: false, accuracyMiss: false, dodged: true };
  }
  return { hit: true, accuracyMiss: false, dodged: false };
}

export function applyWeaponDamage(
  mount: WeaponMountDefinition,
  target: CombatLayerState,
): WeaponDamageResult {
  const shieldPen = clamp(mount.shieldPenetration, 0, 1);
  const armorPen = clamp(mount.armorPenetration, 0, 1);
  const damage = Math.max(0, mount.damage * mount.barrels);
  const shieldMultiplier = Math.max(0.01, mount.shieldDamageMultiplier ?? 1);
  const armorMultiplier = Math.max(0.01, mount.armorDamageMultiplier ?? 1);
  const hullMultiplier = Math.max(0.01, mount.hullDamageMultiplier ?? 1);

  const shieldComponentBase = damage * (1 - shieldPen);
  const shieldPotential = shieldComponentBase * shieldMultiplier;
  const shieldDamage = Math.min(target.shield, shieldPotential);
  target.shield = Math.max(0, target.shield - shieldDamage);
  const shieldConsumedBase = shieldDamage / shieldMultiplier;
  const shieldOverflowBase = Math.max(0, shieldComponentBase - shieldConsumedBase);
  const afterShieldBase = damage * shieldPen + shieldOverflowBase;

  const armorComponentBase = afterShieldBase * (1 - armorPen);
  const armorPotential = armorComponentBase * armorMultiplier;
  const armorDamage = Math.min(target.armor, armorPotential);
  target.armor = Math.max(0, target.armor - armorDamage);
  const armorConsumedBase = armorDamage / armorMultiplier;
  const armorOverflowBase = Math.max(0, armorComponentBase - armorConsumedBase);
  const afterArmorBase = afterShieldBase * armorPen + armorOverflowBase;

  const hullDamage = Math.min(target.hull, afterArmorBase * hullMultiplier);
  target.hull = Math.max(0, target.hull - hullDamage);

  return {
    destroyed: target.hull <= 0,
    shieldDamage,
    armorDamage,
    hullDamage,
  };
}
