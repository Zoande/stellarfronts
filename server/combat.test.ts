import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyWeaponDamage,
  getCombatGroupMaxSize,
  getPreferredRangeBand,
  rollWeaponShot,
  weaponCanFireAtRange,
} from "./combat";
import type { WeaponMountDefinition } from "../src/data/Starbase";

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

test("combat group caps preserve small ship detail", () => {
  assert.equal(getCombatGroupMaxSize("corvette"), 20);
  assert.equal(getCombatGroupMaxSize(null), 10);
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
