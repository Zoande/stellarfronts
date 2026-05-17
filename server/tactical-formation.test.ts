import assert from "node:assert/strict";
import { test } from "node:test";
import { getTacticalFormationOffset, getTacticalFormationPosition } from "../src/game/tacticalFormation";

test("tactical formation offsets spread ships across rings", () => {
  const shipIds = Array.from({ length: 24 }, (_, index) => `ship-${index}`);
  const offsets = shipIds.map((shipId) => getTacticalFormationOffset("group-a", shipIds, shipId));

  for (let i = 0; i < offsets.length; i += 1) {
    for (let j = i + 1; j < offsets.length; j += 1) {
      const distance = Math.hypot(offsets[i].x - offsets[j].x, offsets[i].z - offsets[j].z);
      assert.ok(distance > 0.55, `ships ${i} and ${j} are too close: ${distance}`);
    }
  }
});

test("tactical formation positions are stable for the same group and ship", () => {
  const shipIds = ["a", "b", "c", "d", "e", "f", "g"];
  const center = { x: 12, y: 4.8, z: -9 };
  const first = getTacticalFormationPosition(center, 5, "group-a", shipIds, "d");
  const second = getTacticalFormationPosition(center, 5, "group-a", shipIds, "d");

  assert.deepEqual(first, second);
  assert.notEqual(first.x, center.x);
  assert.notEqual(first.z, center.z);
});
