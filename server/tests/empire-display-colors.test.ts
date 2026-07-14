import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getEmpireDisplayColor,
  getEmpireSystemRelation,
} from "../../src/game/EmpireDisplayColors";

test("empire display relations distinguish own, foreign, hostile, and unowned systems", () => {
  const wars = new Set([3]);
  assert.equal(getEmpireSystemRelation(1, 1, wars), "own");
  assert.equal(getEmpireSystemRelation(2, 1, wars), "foreign");
  assert.equal(getEmpireSystemRelation(3, 1, wars), "hostile");
  assert.equal(getEmpireSystemRelation(-1, 1, wars), "unowned");
});

test("foreign empire colors retain their hue while becoming substantially greyer", () => {
  const source: [number, number, number] = [0.12, 0.82, 0.34];
  const tinted = getEmpireDisplayColor(source, "foreign");
  const sourceSpread = Math.max(...source) - Math.min(...source);
  const tintedSpread = Math.max(...tinted) - Math.min(...tinted);

  assert.ok(tintedSpread < sourceSpread * 0.4);
  assert.ok(tinted[1] > tinted[0], "the original green hue should remain identifiable");
});

test("hostile empire colors shift strongly toward red", () => {
  const source: [number, number, number] = [0.1, 0.55, 0.92];
  const tinted = getEmpireDisplayColor(source, "hostile");

  assert.ok(tinted[0] > 0.7);
  assert.ok(tinted[0] > tinted[1] * 2);
  assert.ok(tinted[0] > tinted[2] * 2);
});

test("own empire colors remain unchanged", () => {
  const source: [number, number, number] = [0.22, 0.66, 0.91];
  assert.deepEqual(getEmpireDisplayColor(source, "own"), source);
});
