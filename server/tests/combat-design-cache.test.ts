import assert from "node:assert/strict";
import test from "node:test";
import { createGameCore } from "../game-runtime";
import { createHeadlessGame, createMemoryAuth, stateDigest } from "../game/headless-game";
import { processContinuousFleetCombat } from "../game/fleet-combat";
import { prepareScenario } from "../game/simulation-scenarios";
import { GAME_HOURS_PER_YEAR } from "../../src/game/GameTime";

test("per-update design caching preserves orbit and battle state, effects, and RNG", () => {
  const idle = createHeadlessGame({ worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  const battle = prepareScenario("combat-repair", { worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } });
  for (const saved of [idle, battle]) {
    const fast = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
    const slow = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
    const hours = saved === idle ? 24 : 2;
    fast.context.state.clock.year += hours / GAME_HOURS_PER_YEAR;
    slow.context.state.clock.year += hours / GAME_HOURS_PER_YEAR;
    const fastEffects = processContinuousFleetCombat(fast.context, hours, hours / 24, { disableIdleSkip: true });
    const slowEffects = processContinuousFleetCombat(slow.context, hours, hours / 24, { disableIdleSkip: true, disableDesignCache: true });
    assert.deepEqual(fastEffects, slowEffects);
    assert.equal(stateDigest(fast.context.state), stateDigest(slow.context.state));
  }
});

test("in-place design edits between updates cannot reuse stale combat stats", () => {
  const saved = createHeadlessGame({ worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  const fast = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
  const slow = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
  for (const core of [fast, slow]) {
    processContinuousFleetCombat(core.context, 0.1, 0.1 / 24);
    const design = core.context.state.shipDesigns.find((entry) => entry.ownerId === 0 && entry.shipKind === "corvette")!;
    design.weaponModuleIds.length = 0;
  }
  const fastEffects = processContinuousFleetCombat(fast.context, 1, 1 / 24);
  const slowEffects = processContinuousFleetCombat(slow.context, 1, 1 / 24, { disableDesignCache: true });
  assert.deepEqual(fastEffects, slowEffects);
  assert.equal(stateDigest(fast.context.state), stateDigest(slow.context.state));
  const fleet = fast.context.state.fleets.find((entry) => entry.ownerId === 0 && entry.shipIds.some((id) => fast.context.state.ships.find((ship) => ship.id === id)?.shipKind === "corvette"))!;
  assert.equal(fleet.maxWeaponRange, 0);
});
