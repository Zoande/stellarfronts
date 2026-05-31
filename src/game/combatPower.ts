import { STARBASE_LEVEL_DEFINITIONS, STARBASE_SHIP_DEFINITIONS } from "../data/Starbase";
import type { CombatStats, WeaponMountDefinition } from "../data/Starbase";
import { calculateShipDesignStats } from "../data/ShipDesigns";
import type { ShipDesign } from "../data/ShipDesigns";
import type { ServerShip, ServerStarbaseSummary } from "./GameProtocol";

export const DEFAULT_ROUNDS_TO_KILL_ESTIMATE = 4;

export function computeWeaponDamage(mounts: WeaponMountDefinition[]): number {
  return mounts.reduce((total, mount) => total + mount.damage * mount.barrels, 0);
}

export function computeCombatPowerFromStats(
  stats: CombatStats,
  roundsToKillEstimate = DEFAULT_ROUNDS_TO_KILL_ESTIMATE,
): number {
  return (
    stats.maxShield * 0.5
    + stats.maxArmor * 0.8
    + stats.maxHull * 1.0
    + computeWeaponDamage(stats.weaponMounts) * roundsToKillEstimate
  );
}

export function computeShipPower(
  ship: ServerShip,
  roundsToKillEstimate = DEFAULT_ROUNDS_TO_KILL_ESTIMATE,
  shipDesigns: ShipDesign[] = [],
): number {
  const design = ship.designId
    ? shipDesigns.find((candidate) => candidate.id === ship.designId && candidate.ownerId === ship.ownerId)
    : null;
  const weaponMounts = design
    ? calculateShipDesignStats(design).combat.weaponMounts
    : (STARBASE_SHIP_DEFINITIONS[ship.shipKind] ?? STARBASE_SHIP_DEFINITIONS.corvette).combat.weaponMounts;
  return (
    ship.maxShield * 0.5
    + ship.maxArmor * 0.8
    + ship.maxHull * 1.0
    + computeWeaponDamage(weaponMounts) * roundsToKillEstimate
  );
}

export function computeFleetPower(
  ships: ServerShip[],
  shipCountFallback = 0,
  roundsToKillEstimate = DEFAULT_ROUNDS_TO_KILL_ESTIMATE,
  shipDesigns: ShipDesign[] = [],
): number {
  if (ships.length === 0) {
    if (shipCountFallback <= 0) return 0;
    return computeCombatPowerFromStats(STARBASE_SHIP_DEFINITIONS.corvette.combat, roundsToKillEstimate)
      * shipCountFallback;
  }
  return ships.reduce(
    (total, ship) => total + computeShipPower(ship, roundsToKillEstimate, shipDesigns),
    0,
  );
}

export function computeStarbasePower(
  starbase: ServerStarbaseSummary,
  roundsToKillEstimate = DEFAULT_ROUNDS_TO_KILL_ESTIMATE,
): number {
  const definition = STARBASE_LEVEL_DEFINITIONS[starbase.level] ?? STARBASE_LEVEL_DEFINITIONS.outpost;
  const power = computeCombatPowerFromStats(definition.combat, roundsToKillEstimate);
  return starbase.status === "building" ? power * 0.6 : power;
}
