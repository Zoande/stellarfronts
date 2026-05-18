import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getFleetFormationDimensions,
  getFleetTacticalRadius,
  getLayeredFleetFormationOffset,
  getLayeredFleetFormationPosition,
} from "../src/game/tacticalFormation";

function makeShipIds(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `ship-${index}`);
}

test("fleet formation renders small fleets in one centered row", () => {
  for (const count of [2, 5]) {
    const shipIds = makeShipIds(count);
    const offsets = shipIds.map((shipId) => getLayeredFleetFormationOffset(shipIds, shipId));
    const uniqueZ = new Set(offsets.map((offset) => offset.z.toFixed(4)));
    const uniqueY = new Set(offsets.map((offset) => offset.y.toFixed(4)));

    assert.equal(uniqueZ.size, 1);
    assert.equal(uniqueY.size, 1);
    assert.ok(Math.abs(offsets.reduce((total, offset) => total + offset.x, 0)) < 0.16);
  }
});

test("fleet formation uses a near-square horizontal grid up to 36 ships", () => {
  const ten = getFleetFormationDimensions(10);
  assert.equal(ten.layers, 1);
  assert.equal(ten.columns, 4);
  assert.equal(ten.rows, 3);

  const thirtySix = getFleetFormationDimensions(36);
  assert.equal(thirtySix.layers, 1);
  assert.equal(thirtySix.columns, 6);
  assert.equal(thirtySix.rows, 6);
});

test("fleet formation stacks large fleets in vertical layers", () => {
  const dimensions = getFleetFormationDimensions(100);
  assert.equal(dimensions.layers, 3);
  assert.equal(dimensions.columns, 6);
  assert.equal(dimensions.rows, 6);

  const shipIds = makeShipIds(100);
  const offsets = shipIds.map((shipId) => getLayeredFleetFormationOffset(shipIds, shipId));
  const layers = new Set(offsets.map((offset) => offset.y.toFixed(4)));
  assert.equal(layers.size, 3);
});

test("fleet formation slots are stable and non-overlapping", () => {
  const shipIds = makeShipIds(100);
  const center = { x: 12, y: 4.8, z: -9 };
  const first = getLayeredFleetFormationPosition(center, 5, shipIds, "ship-42");
  const second = getLayeredFleetFormationPosition(center, 5, shipIds, "ship-42");
  assert.deepEqual(first, second);

  const offsets = shipIds.map((shipId) => getLayeredFleetFormationOffset(shipIds, shipId));
  for (let i = 0; i < offsets.length; i += 1) {
    for (let j = i + 1; j < offsets.length; j += 1) {
      const distance = Math.hypot(
        offsets[i].x - offsets[j].x,
        offsets[i].y - offsets[j].y,
        offsets[i].z - offsets[j].z,
      );
      assert.ok(distance > 0.65, `ships ${i} and ${j} are too close: ${distance}`);
    }
  }
});

test("fleet tactical radius grows with horizontal footprint", () => {
  assert.ok(getFleetTacticalRadius(2) >= 1.2);
  assert.ok(getFleetTacticalRadius(10) > getFleetTacticalRadius(5));
  assert.ok(getFleetTacticalRadius(36) >= getFleetTacticalRadius(10));
  assert.equal(getFleetTacticalRadius(100), getFleetTacticalRadius(36));
});
