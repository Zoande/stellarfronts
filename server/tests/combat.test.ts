import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWeaponDamage,
  combatEngagementProfilesCanInteract,
  getWeaponMaxSystemRange,
  getWeaponMinSystemRange,
  getWeaponCooldownHours,
  getWeaponInterceptableBy,
  getWeaponMaxRangeBand,
  getWeaponTravelSpeed,
  getPreferredRangeBand,
  rangeBandForSystemDistance,
  rollWeaponShot,
  weaponCanFireAtDistance,
  weaponCanFireAtRange,
} from "../game/combat";
import type { WeaponMountDefinition } from "../../src/data/Starbase";
import { createSeededRandom } from "../game/combat-simulator";
import { calculateShipDesignStats, createDefaultShipDesign, getShipModuleDefinition } from "../../src/data/ShipDesigns";
import { computeWeaponSustainedOutput } from "../../src/game/combatPower";
import { normalizeShip } from "../game/state-normalization";
import {
  computeFleetScreeningChance,
  computeShipCriticalChances,
  computeStarbaseScreeningChance,
  computeStrayHitProbability,
  getCommanderOverageMultipliers,
} from "../game/fleet-combat";

function weapon(overrides: Partial<WeaponMountDefinition> = {}): WeaponMountDefinition {
  return {
    id: "test-laser",
    kind: "laser",
    label: "Test Laser",
    barrels: 1,
    damage: 100,
    shieldPenetration: 0,
    armorPenetration: 0,
    accuracy: 1,
    minRangeBand: "close",
    maxRangeBand: "medium",
    optimalRangeBand: "medium",
    cooldownRounds: 1,
    ...overrides,
  };
}

test("weapon damage applies shield and armor penetration with overflow", () => {
  const target = {
    shield: 100,
    maxShield: 100,
    armor: 100,
    maxArmor: 100,
    hull: 100,
    maxHull: 100,
  };

  const result = applyWeaponDamage(weapon({ shieldPenetration: 0.5, armorPenetration: 0.5 }), target);
  assert.equal(result.shieldDamage, 50);
  assert.equal(result.armorDamage, 25);
  assert.equal(result.hullDamage, 25);
  assert.equal(target.shield, 50);
  assert.equal(target.armor, 75);
  assert.equal(target.hull, 75);
});

test("weapon damage overflows depleted shield and armor into hull", () => {
  const target = {
    shield: 20,
    maxShield: 100,
    armor: 30,
    maxArmor: 100,
    hull: 100,
    maxHull: 100,
  };

  const result = applyWeaponDamage(weapon(), target);
  assert.equal(result.shieldDamage, 20);
  assert.equal(result.armorDamage, 30);
  assert.equal(result.hullDamage, 50);
  assert.equal(target.hull, 50);
});

test("accuracy miss and evasion dodge are separate rolls", () => {
  const accurate = weapon({ accuracy: 0.75 });
  assert.deepEqual(rollWeaponShot(accurate, 0.5, () => 0.8), {
    hit: false,
    accuracyMiss: true,
    dodged: false,
  });

  const dodgeRolls = [0.2, 0.1];
  assert.deepEqual(rollWeaponShot(accurate, 0.5, () => dodgeRolls.shift() ?? 0), {
    hit: false,
    accuracyMiss: false,
    dodged: true,
  });

  const hitRolls = [0.2, 0.9];
  assert.deepEqual(rollWeaponShot(accurate, 0.5, () => hitRolls.shift() ?? 0), {
    hit: true,
    accuracyMiss: false,
    dodged: false,
  });
});

test("range bands gate weapon fire and preferred range", () => {
  const short = weapon({ minRangeBand: "pointBlank", maxRangeBand: "close", optimalRangeBand: "close" });
  const long = weapon({ minRangeBand: "medium", maxRangeBand: "extreme", optimalRangeBand: "long" });

  assert.equal(weaponCanFireAtRange(short, "close"), true);
  assert.equal(weaponCanFireAtRange(short, "long"), false);
  assert.equal(weaponCanFireAtRange(long, "long"), true);
  assert.equal(weaponCanFireAtRange(long, "close"), false);
  assert.equal(getPreferredRangeBand([long]), "long");
});

test("long-range weapons can outrange short-range stationary defenses", () => {
  const artillery = weapon({ minRangeBand: "long", maxRangeBand: "extreme", optimalRangeBand: "extreme" });
  const stationLaser = weapon({ minRangeBand: "close", maxRangeBand: "medium", optimalRangeBand: "medium" });

  assert.equal(weaponCanFireAtRange(artillery, "long"), true);
  assert.equal(weaponCanFireAtRange(stationLaser, "long"), false);
});

test("real system distance gates weapon fire with minimum range", () => {
  const artillery = weapon({ minRangeBand: "long", maxRangeBand: "extreme", optimalRangeBand: "extreme" });
  const pointDefense = weapon({ minRangeBand: "pointBlank", maxRangeBand: "close", optimalRangeBand: "close" });

  assert.equal(getWeaponMinSystemRange(artillery), 30);
  assert.equal(getWeaponMaxSystemRange(artillery), 64);
  assert.equal(weaponCanFireAtDistance(artillery, 46), true);
  assert.equal(weaponCanFireAtDistance(artillery, 10), false);
  assert.equal(weaponCanFireAtDistance(pointDefense, 10), true);
  assert.equal(weaponCanFireAtDistance(pointDefense, 30), false);
  assert.equal(rangeBandForSystemDistance(5), "pointBlank");
  assert.equal(rangeBandForSystemDistance(47), "extreme");
});

test("combat engagement profiles use real system distance", () => {
  const left = [{ position: { x: 0, z: 0 }, range: 30 }];
  const close = [{ position: { x: 24, z: 0 }, range: 16 }];
  const far = [{ position: { x: 80, z: 0 }, range: 64 }];

  assert.equal(combatEngagementProfilesCanInteract(left, close), true);
  assert.equal(combatEngagementProfilesCanInteract(left, far), false);
  assert.equal(combatEngagementProfilesCanInteract(far, [{ position: { x: 20, z: 0 }, range: 64 }]), true);
});

test("layer multipliers preserve base-damage overflow before the next layer", () => {
  const target = { shield: 10, maxShield: 10, armor: 100, maxArmor: 100, hull: 100, maxHull: 100 };
  const result = applyWeaponDamage(weapon({ shieldDamageMultiplier: 2, armorDamageMultiplier: 0.5 }), target);
  assert.equal(result.shieldDamage, 10);
  assert.equal(result.armorDamage, 47.5);
  assert.equal(result.hullDamage, 0);
});

test("penetrating base damage is unaffected by shield effectiveness", () => {
  const target = { shield: 100, maxShield: 100, armor: 100, maxArmor: 100, hull: 100, maxHull: 100 };
  const result = applyWeaponDamage(weapon({ shieldPenetration: 0.5, shieldDamageMultiplier: 0.1 }), target);
  assert.equal(result.shieldDamage, 5);
  assert.equal(result.armorDamage, 50);
});

test("outOfRange is always a sentinel and finite weapon stats are derived", () => {
  const sentinel = weapon({ maxRangeBand: "outOfRange", optimalRangeBand: "outOfRange" });
  assert.equal(getWeaponMaxRangeBand(sentinel), "extreme");
  assert.equal(getWeaponMaxSystemRange(sentinel), 64);
  assert.equal(weaponCanFireAtRange(sentinel, "outOfRange"), false);
  assert.equal(Number.isFinite(getWeaponTravelSpeed(sentinel)), true);
  assert.equal(getWeaponCooldownHours(sentinel) > 0, true);
});

test("counter registry initially exposes missile interception without making beams interceptable by point defense", () => {
  assert.deepEqual(getWeaponInterceptableBy(weapon({ kind: "missile", attackClass: "missile" })), ["pointDefense"]);
  assert.deepEqual(getWeaponInterceptableBy(weapon({ kind: "laser", attackClass: "beam" })), ["beamDiffraction"]);
});

test("preferred engagement range is weighted by sustained effective output", () => {
  const mainBattery = weapon({ damage: 100, cooldownHours: 2, optimalRangeBand: "close" });
  const tokenLongMount = weapon({ damage: 1, cooldownHours: 20, optimalRangeBand: "extreme" });
  assert.equal(getPreferredRangeBand([mainBattery, tokenLongMount]), "close");
});

test("tracking counters projectile evasion without altering the accuracy roll", () => {
  const pointDefense = weapon({ kind: "pointDefense", accuracy: 0.95, tracking: 0.7 });
  const rolls = [0.5, 0.2];
  assert.deepEqual(rollWeaponShot(pointDefense, 0.8, () => rolls.shift() ?? 0), {
    hit: true,
    accuracyMiss: false,
    dodged: false,
  });
});

test("headless combat seed source is reproducible", () => {
  const left = createSeededRandom(42);
  const right = createSeededRandom(42);
  assert.deepEqual(Array.from({ length: 20 }, () => left()), Array.from({ length: 20 }, () => right()));
});

test("density curve matches dispersed, mixed, and armada targets", () => {
  assert.equal(computeStrayHitProbability(4) < 0.1, true);
  assert.equal(computeStrayHitProbability(20) > 0.25 && computeStrayHitProbability(20) < 0.45, true);
  assert.equal(computeStrayHitProbability(100) >= 0.85, true);
  assert.equal(computeStrayHitProbability(1_000), 0.95);
});

test("screening formulas respect fleet and starbase caps", () => {
  assert.equal(computeFleetScreeningChance(1_000, 1) > 0.299, true);
  assert.equal(computeFleetScreeningChance(10, 10, 0.5), 0.05);
  assert.equal(computeStarbaseScreeningChance(2, 0.4), 0.2);
  assert.equal(computeStarbaseScreeningChance(20, 0.9), 0.9);
});

test("commander overage penalties are smooth and clamped", () => {
  assert.deepEqual(getCommanderOverageMultipliers(40, 20), {
    accuracyMultiplier: 0.8,
    cooldownMultiplier: 1.25,
    coordinationMultiplier: 0.75,
  });
  assert.deepEqual(getCommanderOverageMultipliers(200, 20), {
    accuracyMultiplier: 0.6,
    cooldownMultiplier: 1.5,
    coordinationMultiplier: 0.5,
  });
});

test("critical chances are damage-scaled, weapon-led, and cannot explode healthy ships", () => {
  const healthy = computeShipCriticalChances(300, 1_000, 600);
  assert.equal(healthy.explosion, 0);
  const crippled = computeShipCriticalChances(100, 1_000, 50);
  assert.equal(crippled.weapon > crippled.engine, true);
  assert.equal(crippled.explosion > 0 && crippled.explosion <= 0.03, true);
  const scratch = computeShipCriticalChances(1, 1_000, 50);
  assert.equal(scratch.weapon < crippled.weapon / 50, true);
});

test("save normalization preserves zero-valued combat layers", () => {
  const design = createDefaultShipDesign(0, "corvette", 2100);
  const ship = normalizeShip({
    id: "destroyed", ownerId: 0, fleetId: "fleet", shipKind: "corvette", designId: design.id,
    shield: 0, armor: 0, hull: 0, hp: 0,
    maxShield: 100, maxArmor: 100, maxHull: 100, maxHp: 100,
  }, "fleet", [design]);
  assert.equal(ship.shield, 0);
  assert.equal(ship.armor, 0);
  assert.equal(ship.hull, 0);
  assert.equal(ship.hp, 0);
});

test("baseline mobile hulls sit in the three-to-six minute sustained duel envelope", () => {
  for (const kind of ["corvette", "destroyer", "cruiser", "battleship"] as const) {
    const stats = calculateShipDesignStats(createDefaultShipDesign(0, kind, 2100));
    const durability = stats.combat.maxShield + stats.combat.maxArmor + stats.combat.maxHull;
    const realMinutes = durability / computeWeaponSustainedOutput(stats.combat.weaponMounts) / 60;
    assert.equal(realMinutes >= 3 && realMinutes <= 6, true, `${kind}: ${realMinutes.toFixed(2)} minutes`);
  }
});

test("specialized layer counters stay in the forty-to-sixty percent effectiveness band", () => {
  const rail = getShipModuleDefinition("weapon_railgun_medium")!.weaponMount!;
  const laser = getShipModuleDefinition("weapon_laser_cannon_medium")!.weaponMount!;
  const plasma = getShipModuleDefinition("weapon_plasma_projector_medium")!.weaponMount!;
  for (const multiplier of [rail.shieldDamageMultiplier!, laser.armorDamageMultiplier!, plasma.armorDamageMultiplier!]) {
    assert.equal(multiplier >= 1.4 && multiplier <= 1.6, true);
  }
  assert.equal(rail.armorDamageMultiplier! >= 0.85, true);
  assert.equal(laser.shieldDamageMultiplier! >= 0.85, true);
  assert.equal(plasma.shieldDamageMultiplier! >= 0.85, true);
});
