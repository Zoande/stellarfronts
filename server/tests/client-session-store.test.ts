import assert from "node:assert/strict";
import test from "node:test";
import { adaptSnapshot } from "../../src/game/ProtocolAdapter";
import { CleanupRegistry } from "../../src/game/CleanupRegistry";
import { GameSessionStore } from "../../src/game/GameSessionStore";
import type { ServerFleet } from "../../src/game/GameProtocol";

function emptySnapshot() {
  return adaptSnapshot({
    type: "snapshot",
    protocolVersion: 8,
    perspective: { mode: "observer" },
    clock: { year: 2200 },
    stars: [],
    planetStates: [],
    factions: [],
    hyperlanes: [],
  });
}

test("game session store rebuilds indexes, prunes selection, and filters subscriptions", () => {
  const store = new GameSessionStore();
  const first = emptySnapshot();
  first.fleets = [{ id: "fleet-a" } as ServerFleet, { id: "fleet-b" } as ServerFleet];
  store.applySnapshot(first);
  store.setSelectedFleetIds(["fleet-a", "fleet-b"]);

  let fleetCalls = 0;
  let clockCalls = 0;
  store.subscribe(["fleets"], () => { fleetCalls += 1; });
  store.subscribe(["clock"], () => { clockCalls += 1; });

  const next = { ...first, fleets: [{ id: "fleet-b" } as ServerFleet] };
  store.applySnapshot(next, ["fleets"]);
  assert.equal(store.getFleet("fleet-a"), undefined);
  assert.ok(store.getFleet("fleet-b"));
  assert.deepEqual(Array.from(store.getSelectedFleetIds()), ["fleet-b"]);
  assert.equal(fleetCalls, 1);
  assert.equal(clockCalls, 0);
});

test("cleanup registry disposes once in reverse order", () => {
  const calls: string[] = [];
  const cleanup = new CleanupRegistry();
  cleanup.add(() => calls.push("first"));
  cleanup.add(() => calls.push("second"));
  cleanup.dispose();
  cleanup.dispose();
  assert.deepEqual(calls, ["second", "first"]);
});
