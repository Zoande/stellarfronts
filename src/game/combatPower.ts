import { STARBASE_LEVEL_DEFINITIONS, STARBASE_SHIP_DEFINITIONS } from "../data/Starbase";
import type { CombatStats, WeaponMountDefinition } from "../data/Starbase";
import { calculateShipDesignStats } from "../data/ShipDesigns";
import type { ShipDesign } from "../data/ShipDesigns";
import type { ServerShip, ServerStarbaseSummary } from "./GameProtocol";

export const DEFAULT_ROUNDS_TO_KILL_ESTIMATE = 4;

function getCooldownHours(mount: WeaponMountDefinition): number {
  if (Number.isFinite(mount.cooldownHours) && Number(mount.cooldownHours) > 0) return Number(mount.cooldownHours);
  const cycles = Math.max(1, mount.cooldownRounds ?? 1);
  const base = mount.kind === "pointDefense" ? 0.5 : mount.kind === "laser" ? 18 : mount.kind === "railgun" ? 24 : 18;
  return base * cycles;
}

export function computeWeaponSustainedOutput(mounts: WeaponMountDefinition[]): number {
  return mounts.reduce((total, mount) => {
    const averageLayerEffect = (
      (mount.shieldDamageMultiplier ?? 1)
      + (mount.armorDamageMultiplier ?? 1)
      + (mount.hullDamageMultiplier ?? 1)
    ) / 3;
    return total + (mount.damage * mount.barrels * Math.max(0, mount.accuracy) * averageLayerEffect) / getCooldownHours(mount);
  }, 0);
}

export function computeCombatPowerFromStats(
  stats: CombatStats,
  roundsToKillEstimate = DEFAULT_ROUNDS_TO_KILL_ESTIMATE,
): number {
  return (
    stats.maxShield * 0.85
    + stats.maxArmor * 0.95
    + stats.maxHull
    + computeWeaponSustainedOutput(stats.weaponMounts) * roundsToKillEstimate * 24
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
  const functioningMounts = weaponMounts.filter((_, index) => !ship.subsystemState?.disabledWeaponKeys.includes(String(index)));
  const currentDurabilityRatio = (
    ship.shield + ship.armor + ship.hull
  ) / Math.max(1, ship.maxShield + ship.maxArmor + ship.maxHull);
  const crewRatio = ship.crewCapacity > 0 ? Math.max(0, Math.min(1, ship.crew / ship.crewCapacity)) : 1;
  const crewMultiplier = 0.5 + 0.5 * crewRatio;
  return (
    (ship.maxShield * 0.85 + ship.maxArmor * 0.95 + ship.maxHull) * (0.5 + 0.5 * currentDurabilityRatio)
    + computeWeaponSustainedOutput(functioningMounts) * roundsToKillEstimate * 24 * crewMultiplier
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
