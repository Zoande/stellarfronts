import assert from "node:assert/strict";
import { test } from "node:test";
import { computeVisibleStarIds } from "../../src/data/Factions";
import {
  NEBULA_DEFINITIONS,
  buildNebulaStarIdSet,
  connectNebulaeWithHyperlanes,
  findNebulaForStar,
  generateNebulae,
  getNebulaGatedBuildingKinds,
  nebulaEnablesBuildingAtStar,
  nebulaTravelSpeedMultiplier,
  stampNebulaIds,
} from "../../src/data/Nebula";
import { buildHyperlaneAdjacency } from "../../src/data/Hyperlanes";
import type { NebulaRegion } from "../../src/data/Nebula";
import { findRoute } from "../game/fleet-combat";
import type { GameFleet, RuntimeContext } from "../game/types";

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

test("connectNebulaeWithHyperlanes welds disconnected members into one component", () => {
  // Five members of one nebula, but the base lanes only link {0,1} and {2,3}; 4 is loose.
  const stars = [0, 1, 2, 3, 4].map((id) => ({ id, x: id * 10, z: 0 }));
  const nebula: NebulaRegion[] = [
    { id: 0, kind: "standard", centerX: 20, centerZ: 0, radiusWorld: 30, starIds: [0, 1, 2, 3, 4] },
  ];
  const base: Array<[number, number]> = [[0, 1], [2, 3]];

  const connected = connectNebulaeWithHyperlanes(base, nebula, stars);
  assert.ok(connected.length > base.length, "should add bridging lanes");

  // Every member must now be reachable from member 0 across the lane graph.
  const adjacency = buildHyperlaneAdjacency(connected, stars.length);
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length) {
    const current = queue.shift() as number;
    for (const neighbor of adjacency[current]) {
      if (!seen.has(neighbor)) {
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  for (const member of nebula[0].starIds) {
    assert.ok(seen.has(member), `member ${member} should be connected`);
  }

  // Deterministic and a no-op once already connected.
  assert.deepEqual(connectNebulaeWithHyperlanes(base, nebula, stars), connected);
  assert.deepEqual(connectNebulaeWithHyperlanes(connected, nebula, stars), connected);
});

// --- Routing into nebulas (findRoute) ------------------------------------
// 0 - 1 - 2 - 3 - 4 line; stars 2 & 3 sit inside a nebula, so faction 0 (home at
// 0) has charted only {0,1}. A fleet should still be able to *enter* the nebula
// one jump at a time, but never path blindly through an uncharted system.
function buildRoutingCtx(discovered: number[], fleetStarId: number): { ctx: RuntimeContext; fleet: GameFleet } {
  const stars = [0, 1, 2, 3, 4].map((id) => ({ id, x: id * 10, z: 0 }));
  const adjacency = [[1], [0, 2], [1, 3], [2, 4], [3]];
  const nebulae: NebulaRegion[] = [
    { id: 0, kind: "standard", centerX: 25, centerZ: 0, radiusWorld: 12, starIds: [2, 3] },
  ];
  const state = {
    stars,
    adjacency,
    nebulae,
    starOwnership: [-1, -1, -1, -1, -1],
    discoveredByFaction: { "0": [...discovered] },
    diplomacy: { wars: [], borders: [] },
    situations: [],
    leaders: [],
    governments: [],
  };
  const ctx = { state } as unknown as RuntimeContext;
  const fleet = { id: "f1", ownerId: 0, currentStarId: fleetStarId, speed: 1 } as unknown as GameFleet;
  return { ctx, fleet };
}

test("a fleet can be routed one jump into an undiscovered nebula system", () => {
  const { ctx, fleet } = buildRoutingCtx([0, 1], 1);
  // Star 2 is uncharted (inside the nebula) but adjacent to charted star 1.
  assert.deepEqual(findRoute(ctx, fleet, 2), [1, 2]);
});

test("an uncharted system cannot be a stepping stone to a deeper one", () => {
  const { ctx, fleet } = buildRoutingCtx([0, 1], 1);
  // Star 3 sits two hops in, only reachable by blindly crossing uncharted star 2.
  assert.equal(findRoute(ctx, fleet, 3), null);
  // And a charted system on the far side of the nebula is likewise unreachable.
  assert.equal(findRoute(ctx, fleet, 4), null);
});

test("once inside the nebula, a fleet can grope to the next nebula system", () => {
  // Fleet now sits at star 2 (discovered by occupying it); star 3 is its neighbour.
  const { ctx, fleet } = buildRoutingCtx([0, 1, 2], 2);
  assert.deepEqual(findRoute(ctx, fleet, 3), [2, 3]);
});

test("ion storms slow travel; standard nebulas do not", () => {
  const ionStorm: NebulaRegion[] = [
    { id: 0, kind: "ionStorm", centerX: 0, centerZ: 0, radiusWorld: 1, starIds: [3] },
  ];
  assert.ok(nebulaTravelSpeedMultiplier(ionStorm, 2, 3) < 1);
  assert.equal(nebulaTravelSpeedMultiplier(NEBULA_AT_2, 1, 2), 1);
  assert.equal(findNebulaForStar(ionStorm, 3)?.kind, "ionStorm");
});
