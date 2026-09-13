import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SPECIES_RIGHTS,
  createDefaultSpeciesRightsState,
  getLegalSpeciesRightsOptions,
  getSpeciesEconomyEffects,
  normalizeSpeciesRights,
  normalizeSpeciesRightsForLaws,
  validateSpeciesTraits,
} from "../../src/data/Species";

test("species trait validation enforces duplicates, max traits, and point budget", () => {
  const valid = validateSpeciesTraits(["adaptive", "intelligent", "unruly"]);
  assert.equal(valid.valid, true);
  assert.equal(valid.remainingPoints, 0);
  assert.deepEqual(valid.normalizedTraitIds, ["adaptive", "intelligent", "unruly"]);

  const duplicate = validateSpeciesTraits(["adaptive", "adaptive"]);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.errors.join(" "), /Duplicate/);

  const tooMany = validateSpeciesTraits(["industrious", "agrarian", "ingenious", "communal", "charismatic", "resilient"]);
  assert.equal(tooMany.valid, false);
  assert.match(tooMany.errors.join(" "), /at most 5/);

  const tooExpensive = validateSpeciesTraits(["adaptive", "intelligent", "rapidBreeders"]);
  assert.equal(tooExpensive.valid, false);
  assert.match(tooExpensive.errors.join(" "), /point budget/);
});

test("default species rights state creates normalized rights per species", () => {
  const rights = createDefaultSpeciesRightsState(2, ["species-faction-2", "visitors"]);

  assert.equal(rights.factionId, 2);
  assert.deepEqual(rights.rightsBySpeciesId["species-faction-2"], DEFAULT_SPECIES_RIGHTS);
  assert.deepEqual(rights.rightsBySpeciesId.visitors, DEFAULT_SPECIES_RIGHTS);
});

test("legacy migration rights normalize and only affect happiness", () => {
  assert.equal(normalizeSpeciesRights({ migration: "prohibited" as never }).migration, "notAllowed");
  assert.equal(normalizeSpeciesRights({ migration: "controlled" as never }).migration, "internalOnly");
  assert.equal(normalizeSpeciesRights({ migration: "free" }).migration, "free");
  const notAllowed = getSpeciesEconomyEffects(undefined, { ...DEFAULT_SPECIES_RIGHTS, migration: "notAllowed" });
  const internal = getSpeciesEconomyEffects(undefined, { ...DEFAULT_SPECIES_RIGHTS, migration: "internalOnly" });
  const free = getSpeciesEconomyEffects(undefined, { ...DEFAULT_SPECIES_RIGHTS, migration: "free" });
  assert.deepEqual(
    [notAllowed.happinessAdd, internal.happinessAdd, free.happinessAdd],
    [free.happinessAdd - 4, free.happinessAdd - 2, free.happinessAdd],
  );
  assert.equal(notAllowed.growthMultiplier, free.growthMultiplier);
  assert.equal(internal.growthMultiplier, free.growthMultiplier);
});

test("species rights legal options and normalization follow government laws", () => {
  const pluralist = getLegalSpeciesRightsOptions({
    civilRights: "universalFranchise",
    speciesPolicy: "pluralistProtections",
    migrationPolicy: "freeMovement",
  });
  assert.equal(pluralist.livingStandards.find((option) => option.id === "oppressed")?.allowed, false);
  assert.equal(pluralist.citizenship.find((option) => option.id === "nonCitizen")?.allowed, false);
  assert.equal(pluralist.workEligibility.find((option) => option.id === "laborOnly")?.allowed, false);

  const clamped = normalizeSpeciesRightsForLaws({
    livingStandard: "oppressed",
    citizenship: "nonCitizen",
    migration: "notAllowed",
    workEligibility: "laborOnly",
  }, {
    civilRights: "universalFranchise",
    speciesPolicy: "pluralistProtections",
    migrationPolicy: "freeMovement",
  });
  assert.deepEqual(clamped, {
    livingStandard: "basic",
    citizenship: "fullCitizenship",
    migration: "internalOnly",
    workEligibility: "allJobs",
  });

  const stratified = normalizeSpeciesRightsForLaws({
    livingStandard: "oppressed",
    citizenship: "nonCitizen",
    migration: "notAllowed",
    workEligibility: "laborOnly",
  }, {
    civilRights: "martialRestrictions",
    speciesPolicy: "stratifiedSpeciesCodes",
    migrationPolicy: "managedMigration",
  });
  assert.equal(stratified.livingStandard, "oppressed");
  assert.equal(stratified.citizenship, "nonCitizen");
  assert.equal(stratified.workEligibility, "laborOnly");
});

test("migration policy is a legality matrix rather than a rate modifier", () => {
  const allowed = (migrationPolicy: string) => getLegalSpeciesRightsOptions({ migrationPolicy })
    .migration.filter((option) => option.allowed)
    .map((option) => option.id);
  assert.deepEqual(allowed("freeMovement"), ["internalOnly", "free"]);
  assert.deepEqual(allowed("managedMigration"), ["notAllowed", "internalOnly", "free"]);
  assert.deepEqual(allowed("migrationControls"), ["notAllowed", "internalOnly"]);
  assert.deepEqual(allowed("closedMovement"), ["notAllowed"]);
});
