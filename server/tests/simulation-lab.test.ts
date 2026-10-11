import assert from "node:assert/strict";
import test from "node:test";
import { runScenario, replay, type ReplayRecord } from "../game/simulation-lab";
import { SCENARIO_NAMES, prepareScenario, scriptedActions } from "../game/simulation-scenarios";
import { createHeadlessGame } from "../game/headless-game";

test("all laboratory scenarios run the production pipeline and replay exactly", async () => {
  for (const scenario of SCENARIO_NAMES) {
    const records: ReplayRecord[] = [];
    const result = await runScenario(scenario, { worldSeed: 19, simulationSeed: 71, days: 0.05, initialWorld: { starCount: 12, factionCount: 2 }, revision: "test" }, (r) => records.push(r));
    assert.equal(result.ticks, 12, "fractional horizons finish without floating-point tail loops");
    assert.equal(result.factions.length, 2);
    assert.ok(result.factions.every((m) => Number.isFinite(m.population)));
    assert.equal(replay(records).ok, true, scenario);
    if (["construction-research", "expansion", "combat-repair"].includes(scenario)) assert.ok(result.actionsAccepted >= 1, `${scenario} must actually exercise its domain`);
    assert.ok(result.factions.every((m) => m.shortageDays.research === 0), "an empty research stockpile without deficit is not a shortage");
    const damaged = structuredClone(records);
    const tick = damaged.find((r) => r.type === "tick") as Extract<ReplayRecord, { type: "tick" }>;
    tick.digest = "changed";
    const mismatch = replay(damaged);
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.tick, 1);
    assert.throws(() => replay(records.slice(0, -1)), /incomplete/);
  }
});

test("shortage recovery buys food before funding agriculture construction", async () => {
  const actions: Array<{ type: string; ok: boolean }> = [];
  await runScenario("shortage-recovery", { worldSeed: 19, simulationSeed: 71, days: 5, stepMs: 1000,
    initialWorld: { starCount: 12, factionCount: 2 }, revision: "test" }, (entry) => {
    if (entry.type === "action") actions.push({ type: entry.action.type, ok: entry.outcome.ok });
  });
  assert.deepEqual(actions, [{ type: "marketTrade", ok: true }, { type: "buildDistrict", ok: true }]);
});

test("checkpoints resume in-progress combat, colonization, construction, and daily leader pools", () => {
  for (const scenario of ["combat-repair", "expansion", "construction-research"] as const) {
    const checkpoint = prepareScenario(scenario, { worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } });
    const game = createHeadlessGame({ checkpoint });
    for (const action of scriptedActions(scenario, 0, game.observe(0))) assert.equal(game.act(game.createAiActor(0), action).ok, true);
    game.step(1000);
    const resumed = createHeadlessGame({ checkpoint: JSON.parse(JSON.stringify(game.exportCheckpoint())) });
    assert.equal(resumed.digest(), game.digest(), scenario);
    game.step(2000); resumed.step(2000);
    assert.equal(resumed.digest(), game.digest(), scenario);
  }
  const game = createHeadlessGame({ worldSeed: 19, initialWorld: { starCount: 4, factionCount: 2 }, stepMs: 1000 });
  game.step(48_000);
  const resumed = createHeadlessGame({ checkpoint: game.exportCheckpoint(), stepMs: 1000 });
  assert.equal(resumed.digest(), game.digest(), "daily leader pool timestamps survive restoration");
});

test("the laboratory rejects invalid configuration and permits zero elapsed time", async () => {
  assert.throws(() => createHeadlessGame({ stepMs: 0 }));
  assert.throws(() => createHeadlessGame({ simulationSeed: Number.NaN }));
  assert.throws(() => createHeadlessGame({ stepMs: 0.0001 }));
  assert.throws(() => createHeadlessGame({ initialWorld: { starCount: 2, factionCount: 3 } }));
  const game = createHeadlessGame({ initialWorld: { starCount: 4, factionCount: 2 } });
  const before = game.digest(); game.step(0); assert.equal(game.digest(), before);
  assert.throws(() => game.step(0.0001));
  await assert.rejects(() => runScenario("idle-economy", { days: -1 }), /positive/);
  const checkpoint = game.exportCheckpoint(); checkpoint.state.clock.paused = true;
  await assert.rejects(() => runScenario("idle-economy", { checkpoint, days: 0.01 }), /running game clock/);
  checkpoint.state.clock.paused = false; checkpoint.state.clock.tickSizeDays *= 2;
  const fast = await runScenario("idle-economy", { checkpoint, days: 0.05 });
  assert.equal(fast.ticks, 6, "horizons follow checkpoint clock speed instead of silently simulating twice the requested days");
});

test("laboratory failures retain their attempted tick and replay the same exception", async () => {
  const records: ReplayRecord[] = [];
  await assert.rejects(() => runScenario("idle-economy", { days: 0.01, epochMs: Number.MAX_SAFE_INTEGER - 50, initialWorld: { starCount: 4, factionCount: 2 } }, (r) => records.push(r)), /Elapsed duration/);
  assert.equal(records.at(-1)?.type, "failure");
  const result = replay(records);
  assert.equal(result.ok, true);
  assert.equal(result.tick, 1);
  assert.match(result.reproducedFailure!, /Elapsed duration/);
  const reordered = structuredClone(records);
  (reordered.at(-1) as Extract<ReplayRecord, { type: "failure" }>).tick = 8;
  assert.throws(() => replay(reordered), /record order/);
});
