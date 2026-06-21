import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVisibleStarIds } from "../../src/data/Factions";
import {
  NEBULA_DEFINITIONS,
  buildNebulaStarIdSet,
  findNebulaForStar,
  generateNebulae,
  getNebulaGatedBuildingKinds,
  nebulaEnablesBuildingAtStar,
  nebulaTravelSpeedMultiplier,
  stampNebulaIds,
} from "../../src/data/Nebula";
import type { NebulaRegion } from "../../src/data/Nebula";

// 0 - 1 - 2 - 3 - 4 line, with star 2 inside a nebula.
const LINE_ADJACENCY = [[1], [0, 2], [1, 3], [2, 4], [3]];
const NEBULA_AT_2: NebulaRegion[] = [
  { id: 0, kind: "standard", centerX: 0, centerZ: 0, radiusWorld: 1, starIds: [2] },
];

test("nebula systems block coverage from outside and do not relay it onward", () => {
  const nebulaStarIds = buildNebulaStarIdSet(NEBULA_AT_2);
  const visible = computeVisibleStarIds(LINE_ADJACENCY, 0, 5, nebulaStarIds);
  // Sees 0 and 1, but never 2 (the nebula) nor 3/4 beyond it.
  assert.deepEqual([...visible].sort((a, b) => a - b), [0, 1]);
});

test("a unit inside a nebula sees only its own system", () => {
  const nebulaStarIds = buildNebulaStarIdSet(NEBULA_AT_2);
  const visible = computeVisibleStarIds(LINE_ADJACENCY, 2, 5, nebulaStarIds);
  assert.deepEqual([...visible], [2]);
});

test("without a nebula set, coverage propagates normally", () => {
  const visible = computeVisibleStarIds(LINE_ADJACENCY, 0, 5);
  assert.deepEqual([...visible].sort((a, b) => a - b), [0, 1, 2, 3, 4]);
});

test("generateNebulae produces regions of 5-10 systems and never covers a capital", () => {
  // Grid of 100 stars spaced 10 apart.
  const stars = Array.from({ length: 100 }, (_, id) => ({
    id,
    x: (id % 10) * 10,
    z: Math.floor(id / 10) * 10,
  }));
  const capitals = [0, 99];
  const nebulae = generateNebulae(stars, 12345, { avoidStarIds: capitals });

  assert.ok(nebulae.length >= 4 && nebulae.length <= 6, `expected 4-6 nebulae, got ${nebulae.length}`);
  const seen = new Set<number>();
  for (const nebula of nebulae) {
    assert.ok(nebula.starIds.length >= 5 && nebula.starIds.length <= 10);
    for (const starId of nebula.starIds) {
      assert.ok(!capitals.includes(starId), "nebula must not contain a capital");
      assert.ok(!seen.has(starId), "a star belongs to at most one nebula");
      seen.add(starId);
    }
  }
});

test("generateNebulae is deterministic for a given seed", () => {
  const stars = Array.from({ length: 60 }, (_, id) => ({ id, x: (id % 10) * 10, z: Math.floor(id / 10) * 10 }));
  const a = generateNebulae(stars, 999, {});
  const b = generateNebulae(stars, 999, {});
  assert.deepEqual(a, b);
});

test("stampNebulaIds tags member stars and clears others", () => {
  const stars: Array<{ id: number; nebulaId?: number }> = [{ id: 0 }, { id: 1 }, { id: 2 }];
  stampNebulaIds(stars, NEBULA_AT_2);
  assert.equal(stars[2].nebulaId, 0);
  assert.equal(stars[0].nebulaId, undefined);
});

test("mineral harvester is gated to dust-cloud nebulas", () => {
  const gated = getNebulaGatedBuildingKinds();
  assert.ok(gated.has("mineralHarvester"));
  assert.equal(NEBULA_DEFINITIONS.dustCloud.enablesStarbaseBuilding, "mineralHarvester");

  const dustCloud: NebulaRegion[] = [
    { id: 0, kind: "dustCloud", centerX: 0, centerZ: 0, radiusWorld: 1, starIds: [5] },
  ];
  assert.equal(nebulaEnablesBuildingAtStar(dustCloud, 5, "mineralHarvester"), true);
  assert.equal(nebulaEnablesBuildingAtStar(dustCloud, 6, "mineralHarvester"), false);
  assert.equal(nebulaEnablesBuildingAtStar(NEBULA_AT_2, 2, "mineralHarvester"), false);
});

test("ion storms slow travel; standard nebulas do not", () => {
  const ionStorm: NebulaRegion[] = [
    { id: 0, kind: "ionStorm", centerX: 0, centerZ: 0, radiusWorld: 1, starIds: [3] },
  ];
  assert.ok(nebulaTravelSpeedMultiplier(ionStorm, 2, 3) < 1);
  assert.equal(nebulaTravelSpeedMultiplier(NEBULA_AT_2, 1, 2), 1);
  assert.equal(findNebulaForStar(ionStorm, 3)?.kind, "ionStorm");
});
