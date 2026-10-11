import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHeadlessGame, createMemoryAuth, stateDigest } from "../game/headless-game";
import { createGameCore } from "../game-runtime";
import { createAiObservation } from "../game/ai-observation";
import { refreshIntelligence, getIntelEntityView, getAllIntelEntityViews } from "../game/intelligence";
import { refreshLeaderPool } from "../../src/data/Leaders";
import { campaignStep } from "../game/campaign-schedule";
import { prepareScenario } from "../game/simulation-scenarios";
import { createCampaignTelemetry } from "../game/campaign-telemetry";

test("shared sensor sets preserve every observed field and source; expired own leader leaves stay bounded", () => {
  const saved = createHeadlessGame({ worldSeed: 19, initialWorld: { starCount: 8, factionCount: 2 } }).exportCheckpoint();
  const fast = structuredClone(saved.state), reference = structuredClone(saved.state);
  refreshIntelligence(fast); refreshIntelligence(reference, false, { disableSharedSources: true });
  assert.equal(stateDigest(fast), stateDigest(reference));
  for (const faction of fast.factions) assert.deepEqual(getAllIntelEntityViews(fast, faction.id), getAllIntelEntityViews(reference, faction.id));
  const oldLeaderIds = fast.leaders.filter((leader) => leader.factionId === 0 && leader.status === "pool").map((leader) => leader.id);
  const recruited = fast.leaders.find((leader) => leader.factionId === 0 && leader.status === "recruited")!;
  const foreign = fast.intelligenceByFaction[0].entities["faction:1"];
  // A remembered foreign fact must not be pruned just because it is old.
  foreign.fields["leaders.id:old-foreign.name"] = { value: "Remembered", observedAtYear: fast.clock.year, sourceIds: ["historical-report"] };
  const fieldCounts = [];
  for (let day = 1; day <= 12; day++) {
    fast.leaders = refreshLeaderPool(fast.leaders, [0, 1], 800000 + day, fast.clock.year + day / 360);
    fast.clock.year += 1 / 360; refreshIntelligence(fast);
    const ledger = fast.intelligenceByFaction[0].entities["faction:0"].fields;
    fieldCounts.push(Object.keys(ledger).filter((key) => key.startsWith("leaders.")).length);
    assert.ok(!Object.keys(ledger).some((key) => oldLeaderIds.some((id) => key.startsWith(`leaders.id:${id}.`))));
    assert.ok(Object.keys(ledger).some((key) => key.startsWith(`leaders.id:${recruited.id}.`)));
  }
  assert.ok(Math.max(...fieldCounts) - Math.min(...fieldCounts) < 20, "roster metadata does not grow by a whole pool every day");
  assert.ok(foreign.fields["leaders.id:old-foreign.name"]);
});

test("AI diagnostics do not change commands, RNG or authoritative outcomes", () => {
  const saved = createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 } }).exportCheckpoint();
  let turns = 0;
  const options = { checkpoint: saved, stepMs: 24000, enableActiveAi: true, enablePassiveAi: true, activeFactionIds: [0] };
  const plain = createHeadlessGame(options);
  const logged = createHeadlessGame({ ...options, onAiDecision: (record) => { turns++; assert.equal(record.warTag, false); } });
  for (let day = 0; day < 3; day++) { plain.step(); logged.step(); }
  assert.ok(turns >= 6);
  assert.equal(plain.digest(), logged.digest());
});

test("adaptive scheduling keeps hostile contact on production cadence and bounds travel", () => {
  const saved = prepareScenario("combat-repair", { initialWorld: { starCount: 8, factionCount: 2 } });
  assert.deepEqual(campaignStep(saved.state, 24000, 24000), { ms: 100, reason: "combat-production-cadence" });
  saved.state.diplomacy.wars = [];
  const fleet = saved.state.fleets[0];
  fleet.movementPlan = { destinationStarId: 2, startedAtYear: saved.state.clock.year, endsAtYear: saved.state.clock.year + 0.25 / 360, totalDays: 0.25,
    segments: [{ kind: "system", fromStarId: 0, toStarId: 2, startYear: saved.state.clock.year, endYear: saved.state.clock.year + 0.25 / 360, from: fleet.systemPosition, to: fleet.systemPosition }] };
  assert.equal(campaignStep(saved.state, 24000, 24000).ms, 6000);
});

test("planet manager hides rival worker locks in controlled systems and retains owned planets under occupation", () => {
  const saved = createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 } }).exportCheckpoint();
  const core = createGameCore(saved.game, createMemoryAuth(), { initialState: saved.state, now: () => saved.nowMs });
  const own = core.context.state.planetStates.find((planet) => planet.ownerId === 0)!;
  const home = own.starId;
  own.ownerId = 1;
  own.jobLocks = [{ job: "miner", allocations: [{ speciesId: own.speciesPopulations[0].speciesId, population: 123456 }] }];
  core.context.refreshDiscovery();
  const rival = createAiObservation(core.context, 0).planets.planets.find((entry) => entry.planetState.id === own.id)!;
  assert.notDeepEqual(rival.planetState.jobLocks, own.jobLocks);
  own.ownerId = 0;
  core.context.state.starOwnership[home] = 1;
  const base = core.context.state.starbases.find((entry) => entry.starId === home)!; base.ownerId = 1;
  core.context.refreshDiscovery();
  const occupied = createAiObservation(core.context, 0).planets.planets.find((entry) => entry.planetState.id === own.id)!;
  assert.ok(occupied);
  assert.deepEqual(occupied.planetState.jobLocks, own.jobLocks);
});

test("market telemetry retains distinct transactions with identical timestamps and avoids re-logging them", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "stellarfronts-telemetry-"));
  try {
    const game = createHeadlessGame({ initialWorld: { starCount: 6, factionCount: 2 } });
    const recorder = createCampaignTelemetry(directory, game.diagnosticState());
    for (let i = 0; i < 2; i++) assert.equal(game.act(game.createAiActor(0), { type: "marketTrade", tradeType: "buy", resourceId: "minerals", amount: 2 }).ok, true);
    recorder.step(game.diagnosticState(), 0, 0, 1, "test");
    recorder.step(game.diagnosticState(), 0, 0, 1, "test");
    const records = readFileSync(path.join(directory, "market.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 2); assert.equal(records[0].timestamp, records[1].timestamp);
    assert.ok(records.every((entry) => entry.feePaid > 0 && entry.totalEnergyDelta < 0));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
