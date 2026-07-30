import assert from "node:assert/strict";
import { test } from "node:test";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  getShipDesignLayout,
  normalizeShipDesign,
} from "../../src/data/ShipDesigns";

test("default corvette design uses section modules and five utility slots", () => {
  const design = createDefaultShipDesign(1, "corvette", 2100);
  const layout = getShipDesignLayout(design);
  const stats = calculateShipDesignStats(design);
  const weaponKinds = stats.combat.weaponMounts.map((mount) => mount.kind).sort();

  assert.deepEqual(design.weaponSectionModuleIds, ["weapon_section_corvette_swarmer"]);
  assert.deepEqual(design.defenseSectionModuleIds, ["defense_section_corvette_swarmer"]);
  assert.deepEqual(layout.weaponSlots.map((slot) => slot.size), ["small", "small", "medium"]);
  assert.equal(layout.defenseSlots.length, 2);
  assert.equal(design.utilityModuleIds.length, 5);
  assert.equal(design.utilityModuleIds.includes("utility_ion_propulsors"), false);
  assert.deepEqual(weaponKinds, ["laser", "laser", "missile"].sort());
  assert.ok(stats.combat.maxHull > 0);
  assert.ok(stats.combat.maxShield > 0);
  assert.equal(stats.buildDays, 45);
  assert.equal(stats.cost.minerals, 327);
  assert.equal(stats.cost.alloys, 519);
  assert.ok(Math.abs(stats.upkeep.energy - 0.86) < 0.000001);
  assert.ok(Math.abs(stats.upkeep.alloys - 0.0795) < 0.000001);
});

test("default construction ship design has utility systems and no weapons", () => {
  const design = createDefaultShipDesign(1, "constructionShip", 2100);
  const layout = getShipDesignLayout(design);
  const stats = calculateShipDesignStats(design);

  assert.deepEqual(design.weaponSectionModuleIds, []);
  assert.deepEqual(design.defenseSectionModuleIds, []);
  assert.equal(layout.weaponSlots.length, 0);
  assert.equal(layout.defenseSlots.length, 0);
  assert.equal(layout.utilitySlots.length, 3);
  assert.equal(stats.combat.weaponMounts.length, 0);
  assert.ok(stats.combat.maxHull > 0);
});

test("default colonization ship design has utility systems and no weapons", () => {
  const design = createDefaultShipDesign(1, "colonizationShip", 2100);
  const layout = getShipDesignLayout(design);
  const stats = calculateShipDesignStats(design);

  assert.deepEqual(design.weaponSectionModuleIds, []);
  assert.deepEqual(design.defenseSectionModuleIds, []);
  assert.equal(layout.weaponSlots.length, 0);
  assert.equal(layout.defenseSlots.length, 0);
  assert.equal(layout.utilitySlots.length, 3);
  assert.equal(stats.combat.weaponMounts.length, 0);
  assert.ok(stats.combat.maxHull > 0);
  assert.ok(stats.cost.goods > 0);
});

test("new specialist hulls receive their dedicated sensors and platform sections", () => {
  const platform = createDefaultShipDesign(1, "defensePlatform", 2100);
  const science = createDefaultShipDesign(1, "scienceShip", 2100);
  const army = createDefaultShipDesign(1, "armyShip", 2100);

  assert.deepEqual(platform.weaponSectionModuleIds, ["weapon_section_defense_platform_battery"]);
  assert.deepEqual(platform.defenseSectionModuleIds, ["defense_section_defense_platform_bastion"]);
  assert.equal(calculateShipDesignStats(platform).speed, 0);
  assert.equal(platform.utilityModuleIds.includes("utility_optical_array"), true);
  assert.equal(science.utilityModuleIds.includes("utility_survey_array"), true);
  assert.equal(science.utilityModuleIds.includes("utility_optical_array"), false);
  assert.equal(army.weaponSectionModuleIds.length, 0);
  assert.equal(calculateShipDesignStats(army).combat.weaponMounts.length, 0);
});

test("default larger combat hulls produce valid scaled layouts", () => {
  const cases = [
    { kind: "destroyer" as const, weaponSections: 1, defenseSections: 1, utilities: 6, weapons: 3, defenses: 4 },
    { kind: "cruiser" as const, weaponSections: 2, defenseSections: 2, utilities: 7, weapons: 8, defenses: 6 },
    { kind: "battleship" as const, weaponSections: 3, defenseSections: 3, utilities: 8, weapons: 12, defenses: 9 },
  ];

  for (const expected of cases) {
    const design = createDefaultShipDesign(1, expected.kind, 2100);
    const layout = getShipDesignLayout(design);
    const stats = calculateShipDesignStats(design);

    assert.equal(design.weaponSectionModuleIds.length, expected.weaponSections);
    assert.equal(design.defenseSectionModuleIds.length, expected.defenseSections);
    assert.equal(layout.weaponSlots.length, expected.weapons);
    assert.equal(layout.defenseSlots.length, expected.defenses);
    assert.equal(layout.utilitySlots.length, expected.utilities);
    assert.equal(design.weaponModuleIds.length, expected.weapons);
    assert.equal(design.defenseModuleIds.length, expected.defenses);
    assert.equal(design.utilityModuleIds.length, expected.utilities);
    assert.equal(stats.combat.weaponMounts.length, expected.weapons);
    assert.ok(stats.combat.maxHull > 0);
    assert.ok(stats.cost.alloys > 0);
  }
});

test("tanker corvette sections define large and medium weapon slots plus four defenses", () => {
  const normalized = normalizeShipDesign({
    id: "tanker",
    ownerId: 7,
    shipKind: "corvette",
    name: "Tanker Corvette",
    weaponSectionModuleIds: ["weapon_section_corvette_tanker"],
    defenseSectionModuleIds: ["defense_section_corvette_tanker"],
    weaponModuleIds: ["weapon_missile_rack_large", "weapon_laser_cannon_medium"],
    defenseModuleIds: ["defense_shield_generator"],
    utilityModuleIds: ["utility_fire_control"],
  }, 7, 2100);
  const layout = getShipDesignLayout(normalized);

  assert.deepEqual(layout.weaponSlots.map((slot) => slot.size), ["large", "medium"]);
  assert.equal(layout.defenseSlots.length, 4);
  assert.equal(normalized.weaponModuleIds.length, 2);
  assert.equal(normalized.defenseModuleIds.length, 4);
  assert.equal(normalized.utilityModuleIds.length, 5);
});

test("corvette core selection owns the matching defense section", () => {
  const normalized = normalizeShipDesign({
    id: "swarmer",
    ownerId: 7,
    shipKind: "corvette",
    name: "Swarmer Corvette",
    weaponSectionModuleIds: ["weapon_section_corvette_swarmer"],
    defenseSectionModuleIds: ["defense_section_corvette_tanker"],
  }, 7, 2100);

  assert.deepEqual(normalized.weaponSectionModuleIds, ["weapon_section_corvette_swarmer"]);
  assert.deepEqual(normalized.defenseSectionModuleIds, ["defense_section_corvette_swarmer"]);
  assert.equal(getShipDesignLayout(normalized).defenseSlots.length, 2);
});

test("weapon normalization respects selected section slot sizes", () => {
  const normalized = normalizeShipDesign({
    id: "custom",
    ownerId: 7,
    shipKind: "corvette",
    name: "Custom Corvette",
    weaponSectionModuleIds: ["weapon_section_corvette_swarmer"],
    weaponModuleIds: ["weapon_missile_rack_large", "weapon_point_defense", "weapon_missile_rack"],
    defenseModuleIds: ["defense_reinforced_hull"],
    utilityModuleId: "utility_fire_control",
  }, 7, 2100);

  assert.equal(normalized.weaponModuleIds[0], "weapon_laser_cannon");
  assert.equal(normalized.weaponModuleIds[1], "weapon_point_defense");
  assert.equal(normalized.weaponModuleIds[2], "weapon_missile_rack");
  assert.equal(normalized.defenseModuleIds.length, 2);
  assert.equal(normalized.utilityModuleIds[0], "utility_fire_control");
});

test("optical targeting utility extends weapon range bands", () => {
  const design = normalizeShipDesign({
    ...createDefaultShipDesign(1, "corvette", 2100),
    utilityModuleIds: [
      "utility_optical_array",
      "utility_fire_control",
      "utility_reactor_capacitor",
      "utility_repair_drones",
      "utility_shield_capacitor",
    ],
  }, 1, 2100);
  const stats = calculateShipDesignStats(design);
  const missile = stats.combat.weaponMounts.find((mount) => mount.kind === "missile");

  assert.equal(missile?.maxRangeBand, "extreme");
  assert.equal(stats.combat.sensorRange, 4);
});

test("new heavy sections and advanced modules calculate combat stats", () => {
  const design = normalizeShipDesign({
    id: "siege",
    ownerId: 7,
    shipKind: "battleship",
    name: "Siege Battleship",
    weaponSectionModuleIds: [
      "weapon_section_battleship_siege",
      "weapon_section_battleship_line",
      "weapon_section_battleship_line",
    ],
    defenseSectionModuleIds: [
      "defense_section_battleship_siege",
      "defense_section_battleship_line",
      "defense_section_battleship_line",
    ],
    weaponModuleIds: [
      "weapon_plasma_projector_large",
      "weapon_railgun_large",
      "weapon_missile_rack_large",
      "weapon_laser_cannon_large",
      "weapon_laser_cannon_large",
      "weapon_railgun_medium",
      "weapon_railgun_medium",
      "weapon_plasma_projector_large",
      "weapon_missile_rack_large",
      "weapon_missile_rack",
      "weapon_laser_cannon_medium",
    ],
    defenseModuleIds: ["defense_armor_plating"],
    utilityModuleIds: [
      "utility_command_uplink",
      "utility_armor_nanites",
      "utility_optical_array",
      "utility_fire_control",
      "utility_reactor_capacitor",
      "utility_repair_drones",
      "utility_shield_capacitor",
      "utility_command_uplink",
    ],
  }, 7, 2100);
  const layout = getShipDesignLayout(design);
  const stats = calculateShipDesignStats(design);
  const weaponKinds = new Set(stats.combat.weaponMounts.map((mount) => mount.kind));

  assert.equal(layout.weaponSlots.length, 11);
  assert.equal(layout.defenseSlots.length, 10);
  assert.equal(stats.combat.weaponMounts.length, 11);
  assert.equal(weaponKinds.has("plasma"), true);
  assert.equal(weaponKinds.has("railgun"), true);
  assert.ok(stats.combat.sensorRange >= 6);
});
