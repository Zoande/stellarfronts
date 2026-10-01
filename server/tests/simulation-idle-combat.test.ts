import assert from "node:assert/strict";
import test from "node:test";
import { createGameCore } from "../game-runtime";
import { createHeadlessGame, createMemoryAuth, stateDigest } from "../game/headless-game";
import { processContinuousFleetCombat, applyFleetSoftSeparation } from "../game/fleet-combat";
import { GAME_HOURS_PER_YEAR } from "../../src/game/GameTime";
import { prepareScenario } from "../game/simulation-scenarios";

test("idle combat shortcut matches every authoritative field and RNG counter of full substeps", () => {
  const saved = createHeadlessGame({ worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  for (const cooldown of [0, 1, 25]) {
    const starting = structuredClone(saved.state);
    const ship = starting.ships[0];
    ship.weaponCooldowns = { test: cooldown };
    starting.clock.year += 24 / GAME_HOURS_PER_YEAR;
    const fast = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(starting) });
    const slow = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(starting) });
    let skippedHours = 0;
    const fastEffects = processContinuousFleetCombat(fast.context, 24, 1, { onIdleSkip: (hours) => skippedHours += hours });
    const slowEffects = processContinuousFleetCombat(slow.context, 24, 1, { disableIdleSkip: true });
    assert.deepEqual(fastEffects, slowEffects);
    assert.equal(stateDigest(fast.context.state), stateDigest(slow.context.state), `cooldown ${cooldown}`);
    if (cooldown < 24) assert.ok(skippedHours > 20, "the shortcut actually skips settled substeps");
  }
});

test("soft separation reports no movement when a tiny push rounds to unchanged positions", () => {
  const saved = createHeadlessGame({ worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  const core = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: saved.state });
  processContinuousFleetCombat(core.context, 0.1, 0.1 / 24);
  const [left, right] = core.context.state.fleets.filter((fleet) => fleet.ownerId === 0);
  const minimum = (left.tacticalRadius + right.tacticalRadius) * 0.78;
  left.systemPosition = { x: 100, y: left.systemPosition.y, z: 0 };
  right.systemPosition = { x: 100 + minimum - Number.EPSILON * 100, y: right.systemPosition.y, z: 0 };
  const before = structuredClone([left.systemPosition, right.systemPosition]);
  assert.ok(right.systemPosition.x - left.systemPosition.x < minimum);
  const changed = applyFleetSoftSeparation(core.context, new Map(core.context.state.ships.map((ship) => [ship.id, ship])));
  assert.deepEqual([left.systemPosition, right.systemPosition], before);
  assert.equal(changed, false);
});

test("active combat keeps its ordinary substeps and identical authoritative outcomes", () => {
  const saved = prepareScenario("combat-repair", { worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } });
  const fast = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
  const slow = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: structuredClone(saved.state) });
  fast.context.state.clock.year += 1 / GAME_HOURS_PER_YEAR;
  slow.context.state.clock.year += 1 / GAME_HOURS_PER_YEAR;
  let skippedHours = 0;
  const fastEffects = processContinuousFleetCombat(fast.context, 1, 1 / 24, { onIdleSkip: (hours) => skippedHours += hours });
  const slowEffects = processContinuousFleetCombat(slow.context, 1, 1 / 24, { disableIdleSkip: true });
  assert.deepEqual(fastEffects, slowEffects);
  assert.equal(stateDigest(fast.context.state), stateDigest(slow.context.state));
  assert.equal(skippedHours, 0);
});
