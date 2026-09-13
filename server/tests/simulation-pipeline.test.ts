import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeContext } from "../game/types";
import { runSimulationPipeline } from "../game/simulation-pipeline";

test("simulation pipeline preserves order and aggregates effects deterministically", () => {
  const calls: string[] = [];
  const details: string[] = [];
  const ctx = {
    hasDirtyState: false,
    queuePlanetDetailRefresh: (planetId: string) => details.push(planetId),
  } as unknown as RuntimeContext;
  const changed = runSimulationPipeline(ctx, [
    {
      name: "clock",
      run: () => {
        calls.push("clock");
        return { changed: ["clock"], planetDetailIds: ["a"] };
      },
    },
    {
      name: "movement",
      run: () => {
        calls.push("movement");
        return { changed: ["fleets", "clock"], dirty: true, planetDetailIds: ["a", "b"] };
      },
    },
  ]);
  assert.deepEqual(calls, ["clock", "movement"]);
  assert.deepEqual(Array.from(changed), ["clock", "fleets"]);
  assert.deepEqual(details, ["a", "b"]);
  assert.equal(ctx.hasDirtyState, true);
});
