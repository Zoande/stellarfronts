import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_SPECIES_RIGHTS,
  createDefaultSpeciesRightsState,
  getLegalSpeciesRightsOptions,
  normalizeSpeciesRightsForLaws,
  validateSpeciesTraits,
} from "../src/data/Species";

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

test("species rights legal options and normalization follow government laws", () => {
  const pluralist = getLegalSpeciesRightsOptions({
    civilRights: "universalFranchise",
    speciesPolicy: "pluralistProtections",
  });
  assert.equal(pluralist.livingStandards.find((option) => option.id === "oppressed")?.allowed, false);
  assert.equal(pluralist.citizenship.find((option) => option.id === "nonCitizen")?.allowed, false);
  assert.equal(pluralist.workEligibility.find((option) => option.id === "laborOnly")?.allowed, false);

  const clamped = normalizeSpeciesRightsForLaws({
    livingStandard: "oppressed",
    citizenship: "nonCitizen",
    migration: "prohibited",
    workEligibility: "laborOnly",
  }, {
    civilRights: "universalFranchise",
    speciesPolicy: "pluralistProtections",
  });
  assert.deepEqual(clamped, {
    livingStandard: "basic",
    citizenship: "fullCitizenship",
    migration: "controlled",
    workEligibility: "allJobs",
  });

  const stratified = normalizeSpeciesRightsForLaws({
    livingStandard: "oppressed",
    citizenship: "nonCitizen",
    migration: "prohibited",
    workEligibility: "laborOnly",
  }, {
    civilRights: "martialRestrictions",
    speciesPolicy: "stratifiedSpeciesCodes",
  });
  assert.equal(stratified.livingStandard, "oppressed");
  assert.equal(stratified.citizenship, "nonCitizen");
  assert.equal(stratified.workEligibility, "laborOnly");
});
