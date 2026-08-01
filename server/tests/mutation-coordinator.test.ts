import assert from "node:assert/strict";
import test from "node:test";
import type { ClientCommand } from "../../src/game/GameProtocol";
import { applyMutationEffects, runAuthoritativeCommand } from "../game/mutation-coordinator";
import type { RuntimeContext } from "../game/types";

function command(type: ClientCommand["type"]): ClientCommand {
  return { type } as ClientCommand;
}

test("successful authoritative mutations become durable while read-only commands do not", () => {
  for (const type of ["join", "requestDetails", "subscribeDetails", "unsubscribeDetails"] as const) {
    const ctx = { hasDirtyState: false } as RuntimeContext;
    runAuthoritativeCommand(ctx, command(type), () => ({ ok: true, effects: {} }));
    assert.equal(ctx.hasDirtyState, false, type);
  }
  const ctx = { hasDirtyState: false } as RuntimeContext;
  runAuthoritativeCommand(ctx, command("moveFleet"), () => ({ ok: true, effects: {} }));
  assert.equal(ctx.hasDirtyState, true);
});

test("rejected mutations do not dirty state", () => {
  const ctx = { hasDirtyState: false } as RuntimeContext;
  runAuthoritativeCommand(ctx, command("buildDistrict"), () => ({ ok: false, message: "rejected" }));
  assert.equal(ctx.hasDirtyState, false);
});

test("mutation aftermath runs in deterministic order and de-duplicates broadcasts", () => {
  const calls: string[] = [];
  const ctx = {
    hasDirtyState: false,
    recalculatePlanetEconomies: () => calls.push("planets"),
    refreshFactionEconomyDeltas: () => calls.push("economy"),
    refreshDiscovery: () => calls.push("discovery"),
    refreshIntelligence: () => calls.push("intelligence"),
    queuePlanetDetailRefresh: (id: string) => calls.push(`detail:${id}`),
    broadcastUpdates: (changed: string[]) => calls.push(`broadcast:${changed.join(",")}`),
  } as unknown as RuntimeContext;
  applyMutationEffects(ctx, {
    recalculatePlanets: true,
    refreshFactionEconomy: true,
    refreshDiscovery: true,
    refreshIntelligence: true,
    planetDetailIds: ["a", "b"],
    changed: ["fleets", "fleets", "ships"],
  });
  assert.deepEqual(calls, [
    "planets", "economy", "discovery", "intelligence",
    "detail:a", "detail:b", "broadcast:fleets,ships",
  ]);
  assert.equal(ctx.hasDirtyState, true);
});

test("mutation effects can explicitly avoid dirtying and broadcasting", () => {
  let broadcasts = 0;
  const ctx = {
    hasDirtyState: false,
    broadcastUpdates: () => { broadcasts += 1; },
  } as unknown as RuntimeContext;
  applyMutationEffects(ctx, { dirty: false, changed: [] });
  assert.equal(ctx.hasDirtyState, false);
  assert.equal(broadcasts, 0);
});
