import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  normalizeShipDesign,
} from "../src/data/ShipDesigns";

test("default corvette design has distinct weapon, defense, and utility modules", () => {
  const design = createDefaultShipDesign(1, "corvette", 2100);
  const stats = calculateShipDesignStats(design);
  const weaponKinds = stats.combat.weaponMounts.map((mount) => mount.kind).sort();

  assert.equal(design.weaponModuleIds.length, 3);
  assert.equal(design.defenseModuleIds.length, 4);
  assert.equal(design.utilityModuleId, "utility_ion_propulsors");
  assert.deepEqual(weaponKinds, ["laser", "missile", "pointDefense"].sort());
  assert.ok(stats.combat.maxHull > 0);
  assert.ok(stats.combat.maxShield > 0);
  assert.ok(stats.combat.maxArmor > 0);
});

test("optical targeting utility extends weapon range bands", () => {
  const design = {
    ...createDefaultShipDesign(1, "corvette", 2100),
    utilityModuleId: "utility_optical_array",
  };
  const stats = calculateShipDesignStats(design);
  const missile = stats.combat.weaponMounts.find((mount) => mount.kind === "missile");

  assert.equal(missile?.maxRangeBand, "extreme");
  assert.equal(stats.combat.sensorRange, 4);
});

test("ship design normalization preserves required corvette slot counts", () => {
  const normalized = normalizeShipDesign({
    id: "custom",
    ownerId: 7,
    shipKind: "corvette",
    name: "Custom Corvette",
    weaponModuleIds: ["weapon_missile_rack"],
    defenseModuleIds: ["defense_reinforced_hull"],
    utilityModuleId: "utility_fire_control",
  }, 7, 2100);

  assert.equal(normalized.weaponModuleIds.length, 3);
  assert.equal(normalized.defenseModuleIds.length, 4);
  assert.equal(normalized.utilityModuleId, "utility_fire_control");
});
