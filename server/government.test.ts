import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GOVERNMENT_LAW_BY_ID,
  createInitialGovernmentState,
  normalizeGovernmentState,
} from "../src/data/Government";

test("initial government state includes migration policy law", () => {
  const state = createInitialGovernmentState(1);

  assert.equal(GOVERNMENT_LAW_BY_ID.migrationPolicy.defaultOptionId, "managedMigration");
  assert.equal(state.selectedLawOptionIds.migrationPolicy, "managedMigration");
});

test("government normalization preserves valid migration policy and repairs invalid values", () => {
  const valid = normalizeGovernmentState(1, {
    factionId: 1,
    selectedLawOptionIds: { migrationPolicy: "freeMovement" },
  });
  const repaired = normalizeGovernmentState(1, {
    factionId: 1,
    selectedLawOptionIds: { migrationPolicy: "not-real" },
  });

  assert.equal(valid.selectedLawOptionIds.migrationPolicy, "freeMovement");
  assert.equal(repaired.selectedLawOptionIds.migrationPolicy, "managedMigration");
});
