import assert from "node:assert/strict";
import test from "node:test";
import { createGameCore } from "../game-runtime";
import { createHeadlessGame, createMemoryAuth, stateDigest } from "../game/headless-game";
import { createAiObservation } from "../game/ai-observation";
import { createActiveEpisode, decideActive } from "../game/active";
import { getIntelEntityView, withIntelViewAssembly } from "../game/intelligence";

test("scoped views preserve full observations and compact observations preserve decisions", () => {
  const checkpoint = createHeadlessGame({ worldSeed: 19, initialWorld: { starCount: 12, factionCount: 3 } }).exportCheckpoint();
  const core = createGameCore(checkpoint.game, createMemoryAuth(), { initialState: checkpoint.state, now: () => checkpoint.nowMs });
  for (const faction of core.context.state.factions) createAiObservation(core.context, faction.id);
  const before = stateDigest(core.context.state);
  for (const faction of core.context.state.factions) {
    const reference = createAiObservation(core.context, faction.id, { disableViewCache: true, fullMetadata: true });
    const cached = createAiObservation(core.context, faction.id, { fullMetadata: true });
    const compact = createAiObservation(core.context, faction.id);
    assert.deepEqual(cached, reference);
    assert.deepEqual(compact, createAiObservation(core.context, faction.id, { disableViewCache: true }));
    const episode = createActiveEpisode(reference, null, 0, 0);
    assert.deepEqual(decideActive(compact, structuredClone(episode), true), decideActive(reference, structuredClone(episode), true));
    assert.ok(Object.isFrozen(compact.planets.planets[0].planetState));
    assert.throws(() => { compact.planets.planets[0].planetState.population = 0; });
    assert.deepEqual(structuredClone(compact), compact, "no lazy view or borrowed value escapes assembly");
  }
  assert.equal(stateDigest(core.context.state), before);
  assert.throws(() => withIntelViewAssembly(core.context.state, () => { throw new Error("assembly failed"); }));
  const planet = core.context.state.planetStates.find((entry) => entry.ownerId === 0)!;
  const view = getIntelEntityView(core.context.state, 0, "planet", planet.id)!;
  const population = view.fields.population;
  assert.notEqual(population.status, "unknown");
  if (population.status !== "unknown") population.value = 0;
  const fresh = getIntelEntityView(core.context.state, 0, "planet", planet.id)!.fields.population;
  assert.notEqual(fresh.status !== "unknown" ? fresh.value : undefined, 0, "ordinary client views remain detached after a failed assembly");
});
