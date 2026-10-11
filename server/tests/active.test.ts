import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame, createMemoryAuth, type GameCheckpoint } from "../game/headless-game";
import { createGameCore } from "../game-runtime";
import { ACTIVE_AFK_MS, ACTIVE_UNCLAIMED_MS, createActiveEpisode, decideActive, recordActiveRejection } from "../game/active";
import { PASSIVE_AFK_MS } from "../game/passive";
import { executeAdminCommand } from "../game/admin-commands";
import { parseAdminCommand } from "../../src/game/AdminCommands";
import { getAiCandidates } from "../game/ai-candidates";

let base: GameCheckpoint;
function checkpoint() {
  base ??= createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  return structuredClone(base);
}

test("unclaimed transitions at 72 hours; claimed transitions at day seven and immediately hands back", () => {
  const saved = checkpoint();
  saved.accounts = { owners: { 0: 17 }, balances: { 17: 8 }, activities: { 0: saved.realNowMs! } };
  const game = createHeadlessGame({ checkpoint: saved, enablePassiveAi: true, enableActiveAi: true });
  game.advanceRealTime(ACTIVE_UNCLAIMED_MS - 1);
  assert.ok(game.diagnosticState().passiveEpisodes?.[1]);
  assert.equal(game.diagnosticState().activeEpisodes?.[1], undefined);
  game.advanceRealTime(1);
  assert.ok(game.diagnosticState().activeEpisodes?.[1]);
  game.advanceRealTime(PASSIVE_AFK_MS - ACTIVE_UNCLAIMED_MS);
  const passive = game.diagnosticState().passiveEpisodes![0];
  passive.queuedShips.receipt = { fleetId: passive.fleets[0].fleetId, shipKind: "corvette", designId: null };
  passive.pausedBuildings = { "recovery-pause": saved.state.clock.year };
  passive.managedJobLocks = ["recovery-lock"];
  game.advanceRealTime(ACTIVE_AFK_MS - PASSIVE_AFK_MS - 1);
  assert.ok(game.diagnosticState().passiveEpisodes?.[0]);
  game.advanceRealTime(1);
  assert.ok(game.diagnosticState().activeEpisodes?.[0]?.queuedShips.receipt);
  assert.deepEqual(game.diagnosticState().activeEpisodes?.[0]?.managedJobLocks, ["recovery-lock"]);
  assert.deepEqual(game.diagnosticState().activeEpisodes?.[0]?.pausedBuildings, passive.pausedBuildings);
  assert.equal(game.diagnosticState().passiveEpisodes?.[0], undefined);
  assert.equal(game.recordPlayerActivity(99, 0), false);
  assert.equal(game.recordPlayerActivity(17, 0), true);
  assert.equal(game.diagnosticState().activeEpisodes?.[0], undefined);
  assert.equal(game.exportCheckpoint().accounts.balances[17], 8);
});

test("AI war tag defaults off, blocks every AI identity, persists, and never blocks a human declaration", () => {
  const saved = checkpoint();
  saved.accounts.owners[0] = 17;
  const game = createHeadlessGame({ checkpoint: saved });
  const before = game.digest();
  assert.equal(game.act(game.createAiActor(0, "custom"), { type: "declareWar", targetFactionId: 1 }).ok, false);
  assert.equal(game.digest(), before);
  assert.equal(game.act(game.createHumanActor(17, 0), { type: "declareWar", targetFactionId: 1 }).ok, true);
  const tagged = checkpoint(); tagged.state.aiSettings = { allowWarDeclarations: true };
  const enabled = createHeadlessGame({ checkpoint: tagged });
  assert.equal(enabled.act(enabled.createAiActor(0), { type: "declareWar", targetFactionId: 1 }).ok, true);
  assert.equal(createHeadlessGame({ checkpoint: enabled.exportCheckpoint() }).diagnosticState().aiSettings?.allowWarDeclarations, true);
});

test("admin can toggle the persisted war tag without changing wars already in progress", async () => {
  const saved = checkpoint();
  const core = createGameCore(saved.game, createMemoryAuth(), { initialState: saved.state, now: () => saved.nowMs });
  await executeAdminCommand(core.context, parseAdminCommand("ai_wars on")!, { type: "adminCommand", input: "ai_wars on" }, { mode: "observer" });
  assert.equal(core.executeGameCommand(core.createAiActor(0), { type: "declareWar", targetFactionId: 1 }).ok, true);
  await executeAdminCommand(core.context, parseAdminCommand("ai_wars off")!, { type: "adminCommand", input: "ai_wars off" }, { mode: "observer" });
  assert.equal(core.context.state.aiSettings?.allowWarDeclarations, false);
  assert.equal(core.context.state.diplomacy.wars.length, 1);
});

test("active planner is deterministic and cannot learn hidden rival stockpiles or hull damage", () => {
  const starting = checkpoint();
  for (const planet of starting.state.planetStates.filter((planet) => planet.ownerId === 0)) planet.buildings.city[3] = null;
  const first = createHeadlessGame({ checkpoint: starting });
  const saved = first.exportCheckpoint();
  saved.state.factionEconomies[1].stockpiles.alloys += 50000;
  saved.state.ships.find((ship) => ship.ownerId === 1)!.hull *= 0.5;
  const second = createHeadlessGame({ checkpoint: saved });
  const observation = first.observe(0);
  assert.deepEqual(second.observe(0), observation);
  const episode = createActiveEpisode(observation, null, 0, 0);
  const decisions = decideActive(observation, structuredClone(episode), false);
  assert.deepEqual(decideActive(second.observe(0), structuredClone(episode), false), decisions);
  assert.ok(!decisions.some(({ action }) => action.type === "declareWar"));
  assert.ok(decisions.some(({ action }) => action.type === "setActiveTechnology"));
  assert.ok(decisions.some(({ action }) => action.type === "buildPlanetBuilding" && action.buildingKind === "researchLabs"));
});

test("active declares only with the tag, a neighboring known weaker force, and healthy reserves", () => {
  const observation = structuredClone(createHeadlessGame({ checkpoint: checkpoint() }).observe(0));
  const economy = observation.snapshot.factionEconomies[0];
  for (const resource of ["energy", "minerals", "food", "goods", "alloys"] as const) { economy.stockpiles[resource] = 100000; economy.monthlyDelta[resource] = 100; }
  const own = observation.fleets.fleets.find((fleet) => fleet.ownerId === 0 && fleet.shipIds.some((id) => observation.fleets.ships.some((ship) => ship.id === id && ship.shipKind === "corvette")))!;
  const ship = observation.fleets.ships.find((ship) => own.shipIds.includes(ship.id))!;
  ship.hull = ship.maxHull = 10000;
  const foreignStar = own.currentStarId === 0 ? 1 : 0;
  observation.snapshot.hyperlanes.push([own.currentStarId, foreignStar]);
  observation.snapshot.starOwnership = [[own.currentStarId, 0], [foreignStar, 1]];
  const enemy = { ...structuredClone(own), id: "known-enemy", ownerId: 1, currentStarId: foreignStar, shipIds: ["known-enemy-ship"] };
  observation.fleets.fleets.push(enemy);
  observation.fleets.ships.push({ ...structuredClone(ship), id: "known-enemy-ship", fleetId: enemy.id, ownerId: 1, hull: 100, maxHull: 100 });
  const base = structuredClone(observation.fleets.starbases.find((base) => base.ownerId === 0)!);
  observation.fleets.starbases.push({ ...base, id: "border-outpost", ownerId: 1, starId: foreignStar, level: "outpost", hull: 1600, armor: 500, shield: 700 });
  observation.snapshot.habitedPlanetSystemIds = observation.snapshot.habitedPlanetSystemIds.filter((id) => id !== foreignStar);
  const episode = createActiveEpisode(observation, null, 0, 0);
  const war = (allow: boolean) => decideActive(observation, structuredClone(episode), allow).find(({ action }) => action.type === "declareWar");
  assert.equal(war(false), undefined);
  assert.equal(war(true)?.action.type, "declareWar");
  assert.ok(!decideActive(observation, structuredClone(episode), true).some(({ action }) => action.type === "moveFleet" && action.fleetId === own.id));
  economy.stockpiles.food = 0;
  assert.equal(war(true), undefined);
});

test("a navy on the move does not trigger surrender, while losing the navy does", () => {
  const saved = checkpoint(); saved.state.aiSettings = { allowWarDeclarations: true };
  const game = createHeadlessGame({ checkpoint: saved });
  assert.equal(game.act(game.createAiActor(0), { type: "declareWar", targetFactionId: 1 }).ok, true);
  const observation = structuredClone(game.observe(0));
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of ["energy", "minerals", "food", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 100000; economy.monthlyDelta[resource] = 100;
  }
  for (const fleet of observation.fleets.fleets.filter((entry) => entry.ownerId === 0)) fleet.phase = "jumpingHyperlane";
  const episode = createActiveEpisode(observation, null, 0, 0);
  const peace = () => decideActive(observation, structuredClone(episode)).some(({ action }) => action.type === "proposePeace");
  assert.equal(peace(), false);
  for (const ship of observation.fleets.ships.filter((entry) => entry.ownerId === 0)) ship.hull = ship.armor = ship.shield = 0;
  assert.equal(peace(), true);
});

test("idle reinforcements regroup with the navy through a known safe route", () => {
  const observation = structuredClone(createHeadlessGame({ checkpoint: checkpoint() }).observe(0));
  const main = observation.fleets.fleets.find((fleet) => fleet.ownerId === 0 && fleet.shipIds.includes("ship-0-1"))!;
  const ship = observation.fleets.ships.find((ship) => main.shipIds.includes(ship.id))!;
  const next = observation.snapshot.hyperlanes.find(([a, b]) => a === main.currentStarId || b === main.currentStarId)!;
  const starId = next[0] === main.currentStarId ? next[1] : next[0];
  observation.snapshot.starOwnership = [[main.currentStarId, 0], [starId, 0]];
  observation.snapshot.knownStarIds ??= [];
  if (!observation.snapshot.knownStarIds.includes(starId)) observation.snapshot.knownStarIds.push(starId);
  ship.hull = ship.maxHull = 5000;
  observation.fleets.fleets.push({ ...structuredClone(main), id: "reinforcements", currentStarId: starId, shipIds: ["reinforcement"] });
  observation.fleets.ships.push({ ...structuredClone(ship), id: "reinforcement", fleetId: "reinforcements", hull: 100, maxHull: 100 });
  const decisions = decideActive(observation, createActiveEpisode(observation, null, 0, 0));
  assert.ok(decisions.some(({ action }) => action.type === "moveFleet" && action.fleetId === "reinforcements" && action.targetStarId === main.currentStarId));
});

test("a newly claimed active country cannot take another turn between membership polls", () => {
  const saved = checkpoint();
  const accounts = { owners: {} as Record<number, number>, balances: {}, activities: {} as Record<number, number> };
  const core = createGameCore(saved.game, createMemoryAuth(accounts), { initialState: saved.state, enablePassiveAi: true, enableActiveAi: true,
    activeFactionIds: [0], now: () => saved.nowMs, realNow: () => saved.realNowMs! });
  core.processAiControllers();
  assert.ok(core.context.state.activeEpisodes?.[0]);
  accounts.owners[0] = 17; accounts.activities[0] = saved.realNowMs!;
  assert.equal(core.processAiControllers().some((record) => record.factionId === 0), false);
  assert.equal(core.context.state.activeEpisodes?.[0], undefined);
});

test("mixed active/passive laboratory assignment and checkpoint continuation are reproducible", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint(), enablePassiveAi: true, enableActiveAi: true, activeFactionIds: [0], stepMs: 24000 });
  game.advanceRealTime(0);
  assert.ok(game.diagnosticState().activeEpisodes?.[0]);
  assert.ok(game.diagnosticState().passiveEpisodes?.[1]);
  const resumed = createHeadlessGame({ checkpoint: game.exportCheckpoint(), stepMs: 24000 });
  for (let tick = 0; tick < 3; tick++) { game.step(); resumed.step(); }
  assert.equal(game.digest(), resumed.digest());
});

test("orbiting builders and colony ships retain the same candidates as idle fleets", () => {
  const observation = structuredClone(createHeadlessGame({ checkpoint: checkpoint() }).observe(0));
  const before = getAiCandidates(observation);
  assert.ok(before.movement.length > 0);
  assert.ok(before.expansion.length > 0);
  for (const phase of ["orbiting", "orbitingPlanet"] as const) {
    for (const fleet of observation.fleets.fleets.filter((fleet) => fleet.ownerId === 0)) fleet.phase = phase;
    const after = getAiCandidates(observation);
    assert.deepEqual(after.movement, before.movement);
    assert.deepEqual(after.expansion, before.expansion);
    assert.deepEqual(after.colonization, before.colonization);
  }
});

test("a rejected scouting route is remembered across saves and does not repeat every turn", () => {
  const observation = structuredClone(createHeadlessGame({ checkpoint: checkpoint() }).observe(0));
  const episode = createActiveEpisode(observation, null, 0, 0);
  const move = decideActive(observation, episode).find(({ action }) => action.type === "moveFleet")!.action;
  assert.equal(move.type, "moveFleet");
  if (move.type !== "moveFleet") return;
  recordActiveRejection(episode, move, observation.snapshot.clock.year, "No discovered safe route to target.");
  const restored = JSON.parse(JSON.stringify(episode));
  assert.ok(!decideActive(observation, restored).some(({ action }) => action.type === "moveFleet" && action.fleetId === move.fleetId && action.targetStarId === move.targetStarId));
  assert.ok(restored.blockedScoutTargets[`${move.fleetId}:${move.targetStarId}`] > observation.snapshot.clock.year);
  observation.snapshot.clock.year += 0.3;
  decideActive(observation, restored);
  assert.deepEqual(restored.blockedScoutTargets, {});
});
