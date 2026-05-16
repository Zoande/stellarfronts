import {
  RANGE_BAND_INDEX,
  rangeBandFromIndex,
  type RangeBand,
} from "../src/game/CombatTypes";
import type {
  BattleLayerDamage,
  BattleParticipantStats,
  BattleStats,
  BattleWeaponStats,
} from "../src/game/GameProtocol";
import { WEAPON_KIND_DEFINITIONS } from "../src/data/Starbase";
import type { StarbaseShipKind, WeaponMountDefinition } from "../src/data/Starbase";

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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function createEmptyLayerDamage(): BattleLayerDamage {
  return { shield: 0, armor: 0, hull: 0 };
}

export function createEmptyParticipantStats(): BattleParticipantStats {
  return {
    damageDealt: createEmptyLayerDamage(),
    damageReceived: createEmptyLayerDamage(),
    shotsFired: 0,
    shotsHit: 0,
    shotsMissed: 0,
    shotsDodged: 0,
    shipsDestroyed: 0,
    shipsLost: 0,
    retreatingShips: 0,
    escapedShips: 0,
  };
}

export function createEmptyBattleStats(): BattleStats {
  return { byParticipant: {}, byOwner: {}, weapons: {} };
}

export function ensureParticipantStats(stats: BattleStats, participantId: string): BattleParticipantStats {
  stats.byParticipant[participantId] ??= createEmptyParticipantStats();
  return stats.byParticipant[participantId];
}

export function ensureOwnerStats(stats: BattleStats, ownerId: number): BattleParticipantStats {
  const key = String(ownerId);
  stats.byOwner[key] ??= createEmptyParticipantStats();
  return stats.byOwner[key];
}

export function addLayerDamage(total: BattleLayerDamage, damage: BattleLayerDamage): void {
  total.shield += damage.shield;
  total.armor += damage.armor;
  total.hull += damage.hull;
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

export function getWeaponMinRangeBand(mount: WeaponMountDefinition): RangeBand {
  return mount.minRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.minRangeBand ?? "pointBlank";
}

export function getWeaponMaxRangeBand(mount: WeaponMountDefinition): RangeBand {
  return mount.maxRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.maxRangeBand ?? "close";
}

export function getWeaponOptimalRangeBand(mount: WeaponMountDefinition): RangeBand {
  return mount.optimalRangeBand ?? WEAPON_KIND_DEFINITIONS[mount.kind]?.optimalRangeBand ?? getWeaponMaxRangeBand(mount);
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

export function getLegacyWeaponRange(mount: WeaponMountDefinition): number {
  return WEAPON_KIND_DEFINITIONS[mount.kind]?.range ?? Math.max(1, RANGE_BAND_INDEX[getWeaponMaxRangeBand(mount)]);
}

export function getPreferredRangeBand(mounts: WeaponMountDefinition[]): RangeBand {
  if (mounts.length === 0) return "close";
  const average = mounts.reduce((total, mount) => total + RANGE_BAND_INDEX[getWeaponOptimalRangeBand(mount)], 0) / mounts.length;
  return rangeBandFromIndex(average);
}

export function getCombatGroupMaxSize(shipKind?: StarbaseShipKind | null): number {
  if (shipKind === "corvette") return 20;
  return 10;
}

export function getCombatGroupMinSize(shipKind?: StarbaseShipKind | null): number {
  if (shipKind === "corvette") return 5;
  return 3;
}

export function getCombatGroupSizeRules(shipKind?: StarbaseShipKind | null): { min: number; max: number } {
  return {
    min: getCombatGroupMinSize(shipKind),
    max: getCombatGroupMaxSize(shipKind),
  };
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
  if (rng() < clamp(targetEvasion, 0, 0.95)) {
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

  const shieldComponent = damage * (1 - shieldPen);
  const shieldDamage = Math.min(target.shield, shieldComponent);
  target.shield = Math.max(0, target.shield - shieldDamage);
  const shieldOverflow = Math.max(0, shieldComponent - shieldDamage);
  const afterShield = damage * shieldPen + shieldOverflow;

  const armorComponent = afterShield * (1 - armorPen);
  const armorDamage = Math.min(target.armor, armorComponent);
  target.armor = Math.max(0, target.armor - armorDamage);
  const armorOverflow = Math.max(0, armorComponent - armorDamage);
  const afterArmor = afterShield * armorPen + armorOverflow;

  const hullDamage = Math.min(target.hull, afterArmor);
  target.hull = Math.max(0, target.hull - hullDamage);

  return {
    destroyed: target.hull <= 0,
    shieldDamage,
    armorDamage,
    hullDamage,
  };
}

export function ensureWeaponStats(
  stats: BattleStats,
  participantId: string,
  mount: WeaponMountDefinition,
): BattleWeaponStats {
  const weaponId = getWeaponId(mount);
  const key = `${participantId}:${weaponId}`;
  stats.weapons[key] ??= {
    weaponId,
    weaponName: getWeaponName(mount),
    ownerParticipantId: participantId,
    shotsFired: 0,
    shotsHit: 0,
    damageDealt: 0,
    kills: 0,
  };
  return stats.weapons[key];
}
