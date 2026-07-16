import { SHIP_MODULE_DEFINITIONS } from "../../src/data/ShipDesigns";
import type { WeaponMountDefinition } from "../../src/data/Starbase";
import { applyWeaponDamage, getWeaponCooldownHours, rollWeaponShot } from "./combat";
import { computeFleetScreeningChance, computeStarbaseScreeningChance, computeStrayHitProbability } from "./fleet-combat";
import { createSeededRandom, simulateHeadlessCombat } from "./combat-simulator";
import type { HeadlessCombatSimulationResult } from "./combat-simulator";
import type { RuntimeContext } from "./types";

export interface BalanceTargetProfile {
  id: "shieldHeavy" | "armorHeavy" | "hullHeavy" | "evasive";
  shield: number;
  armor: number;
  hull: number;
  evasion: number;
}

export interface WeaponMatrixRow {
  moduleId: string;
  weaponId: string;
  weaponKind: string;
  targetProfile: BalanceTargetProfile["id"];
  expectedDamagePerGameHour: number;
  hitRate: number;
}

export const BALANCE_TARGET_PROFILES: BalanceTargetProfile[] = [
  { id: "shieldHeavy", shield: 1_000, armor: 250, hull: 250, evasion: 0.08 },
  { id: "armorHeavy", shield: 250, armor: 1_000, hull: 250, evasion: 0.08 },
  { id: "hullHeavy", shield: 250, armor: 250, hull: 1_000, evasion: 0.08 },
  { id: "evasive", shield: 500, armor: 500, hull: 500, evasion: 0.55 },
];

export function runWeaponMonteCarloMatrix(seed = 0x5f3759df, samples = 4_000): WeaponMatrixRow[] {
  const rows: WeaponMatrixRow[] = [];
  const weaponModules = Object.values(SHIP_MODULE_DEFINITIONS).filter((module) => module.slotType === "weapon" && module.weaponMount);
  for (const [moduleIndex, module] of weaponModules.entries()) {
    const mount = module.weaponMount as WeaponMountDefinition;
    for (const [profileIndex, profile] of BALANCE_TARGET_PROFILES.entries()) {
      const rng = createSeededRandom(seed + moduleIndex * 101 + profileIndex * 10_007);
      let hits = 0;
      let damage = 0;
      for (let sample = 0; sample < samples; sample += 1) {
        if (!rollWeaponShot(mount, profile.evasion, rng).hit) continue;
        hits += 1;
        const target = {
          shield: profile.shield, maxShield: profile.shield,
          armor: profile.armor, maxArmor: profile.armor,
          hull: profile.hull, maxHull: profile.hull,
        };
        const result = applyWeaponDamage(mount, target);
        damage += result.shieldDamage + result.armorDamage + result.hullDamage;
      }
      rows.push({
        moduleId: module.id,
        weaponId: mount.id ?? mount.kind,
        weaponKind: mount.kind,
        targetProfile: profile.id,
        expectedDamagePerGameHour: damage / samples / getWeaponCooldownHours(mount),
        hitRate: hits / samples,
      });
    }
  }
  return rows;
}

export function runSeededHeadlessMatrix(
  scenarios: Array<{ id: string; createContext: () => RuntimeContext; starId?: number }>,
  seeds: number[],
): Array<{ scenarioId: string; seed: number; result: HeadlessCombatSimulationResult }> {
  return scenarios.flatMap((scenario) => seeds.map((seed) => ({
    scenarioId: scenario.id,
    seed,
    result: simulateHeadlessCombat(scenario.createContext(), { seed, starId: scenario.starId }),
  })));
}

export function createGeometryRegressionSummary() {
  return {
    strayHit: {
      smallDispersed: computeStrayHitProbability(4),
      mediumMixed: computeStrayHitProbability(20),
      denseArmada: computeStrayHitProbability(100),
    },
    fleetScreening: {
      balancedEscort: computeFleetScreeningChance(12, 8),
      cap: computeFleetScreeningChance(10_000, 1),
    },
    platformScreening: {
      twoBaseline: computeStarbaseScreeningChance(2, 0.4),
      fortressFull: computeStarbaseScreeningChance(12, 0.9),
    },
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("combat-balance-matrix.ts")) {
  const rows = runWeaponMonteCarloMatrix();
  const invalid = rows.filter((row) => !Number.isFinite(row.expectedDamagePerGameHour) || row.expectedDamagePerGameHour < 0 || row.hitRate < 0 || row.hitRate > 1);
  const summary = {
    samplesPerWeaponProfile: 4_000,
    weaponProfileRows: rows.length,
    invalidRows: invalid.length,
    geometry: createGeometryRegressionSummary(),
    rows,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (invalid.length > 0) process.exitCode = 1;
}
