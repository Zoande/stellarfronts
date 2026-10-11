import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame, type GameCheckpoint } from "../game/headless-game";
import { getAiCandidates } from "../game/ai-candidates";
import { createSeededRandom, createDeterministicState, normalizeDeterministicState } from "../game/determinism";
import { decodeClientCommand } from "../game/client-command-codec";
import type { GameAction, GameActor } from "../game/actions";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { createGameCore } from "../game-runtime";
import { createMemoryAuth } from "../game/headless-game";
import { prepareScenario } from "../game/simulation-scenarios";

let initial: GameCheckpoint;
function fresh() {
  initial ??= createHeadlessGame({ worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 }, accounts: { owners: { 0: 17 }, balances: { 17: 50 } } }).exportCheckpoint();
  return createHeadlessGame({ checkpoint: initial });
}
function district(game: ReturnType<typeof fresh>): GameAction {
  const command = getAiCandidates(game.observe(0)).economy.find((a) => a.type === "buildDistrict");
  assert.ok(command, "starter country has an affordable district candidate");
  return command;
}

test("stateful PRNG restores its exact sequence, including seed zero", () => {
  const random = createSeededRandom(0);
  random(); const saved = random.state();
  const expected = [random(), random(), random()];
  random.restore(saved);
  assert.deepEqual([random(), random(), random()], expected);
  assert.deepEqual(createDeterministicState(7), createDeterministicState(7));
  assert.throws(() => normalizeDeterministicState({ version: 9 }));
});

test("ordinary human and AI commands share costs, IDs, effects, and authoritative outcomes", () => {
  const human = fresh(); const ai = fresh(); const command = district(ai);
  const humanResult = human.act(human.createHumanActor(17, 0), command);
  const aiResult = ai.act(ai.createAiActor(0), command);
  assert.equal(aiResult.ok, true);
  assert.deepEqual(humanResult, aiResult);
  assert.equal(human.digest(), ai.digest());
  const checkpoint = ai.exportCheckpoint();
  const queue = checkpoint.state.planetStates.find((p) => p.ownerId === 0 && p.isHabited)!.constructionQueue;
  assert.equal(queue.length, 1);
  const second = district(ai);
  assert.equal(ai.act(ai.createAiActor(0), second).ok, true);
  const ids = ai.exportCheckpoint().state.planetStates.flatMap((p) => p.constructionQueue.map((item) => item.id));
  assert.equal(ids.length, new Set(ids).size);
});

test("actors are bound to their game, observers are read-only, and AI cannot spend account resources or change time", () => {
  const game = fresh(); const other = fresh(); const before = game.digest();
  const forged = { kind: "ai", factionId: 0, controllerId: "forged" } as GameActor;
  for (const actor of [forged, other.createAiActor(0), game.createObserverActor(), game.createHumanActor(99, 0)]) {
    assert.equal(game.act(actor, district(game)).ok, false);
  }
  const actor = game.createAiActor(0);
  for (const action of [
    { type: "setSpeedMultiplier", multiplier: 20 }, { type: "adminCommand", input: "time speed 10" },
    { type: "setFleetDarkMatterBoost", fleetId: "fleet-0-1", enabled: true },
    { type: "skipPlanetConstruction", planetId: "p", queueItemId: "q" },
  ]) assert.equal(game.act(actor, action).ok, false);
  assert.equal(game.digest(), before);
  assert.equal(game.exportCheckpoint().accounts.balances[17], 50);
});

test("malformed, foreign-owned, and unaffordable commands leave state and deterministic counters unchanged", () => {
  const original = fresh(); const checkpoint = original.exportCheckpoint();
  checkpoint.state.factionEconomies.find((e) => e.factionId === 0)!.stockpiles.minerals = 0;
  const game = createHeadlessGame({ checkpoint }); const actor = game.createAiActor(0); const before = game.digest();
  const planetId = checkpoint.state.planetStates.find((p) => p.ownerId === 0 && p.isHabited)!.id;
  const enemyPlanet = checkpoint.state.planetStates.find((p) => p.ownerId === 1 && p.isHabited)!.id;
  for (const action of [
    { type: "buildDistrict", planetId, districtKind: "mining" },
    { type: "buildDistrict", planetId: enemyPlanet, districtKind: "mining" },
    { type: "buildDistrict", planetId, districtKind: "invented" },
    { type: "marketTrade", resourceId: "food", tradeType: "buy", amount: Number.NaN },
    { type: "setFleetCombatSettings", fleetId: "fleet-0-1", combatSettings: { behavior: "brawler", retreatDestination: { kind: "selectedSystem", targetStarId: -1 } } },
  ]) { assert.equal(game.act(actor, action).ok, false); assert.equal(game.digest(), before); }
});

test("nested decoders reject nonfinite vectors, wrong enums, oversized arrays, and incomplete peace terms", () => {
  for (const action of [
    { type: "moveFleet", fleetId: "f", targetStarId: 1, targetSystemPosition: { x: Infinity, y: 0, z: 0 } },
    { type: "assignLeader", leaderId: "l", assignment: { kind: "fleet", targetId: 4 } },
    { type: "setSpeciesRights", speciesId: "s", rights: { migration: "anything" } },
    { type: "saveShipDesign", shipKind: "corvette", name: "test", weaponModuleIds: Array(257).fill("weapon"), defenseModuleIds: [] },
    { type: "proposePeace", targetFactionId: 1, terms: { mode: "whitePeace" } },
    { type: "issueFleetTacticalOrder", fleetId: "f", order: { type: "attack", targetKind: "planet" } },
  ]) assert.throws(() => decodeClientCommand(action));
  assert.doesNotThrow(() => decodeClientCommand({ type: "setSpeciesRights", speciesId: "s", rights: { migration: "internalOnly" } }));
  assert.doesNotThrow(() => decodeClientCommand({ type: "subscribeDetails", scope: "technology" }));
});

test("rejected replacement orders preserve the previous movement and reserved build resources", () => {
  const checkpoint = fresh().exportCheckpoint();
  const fleet = checkpoint.state.fleets.find((f) => f.ownerId === 0 && !f.stationaryStarbaseId)!;
  fleet.orderType = "build";
  fleet.pendingStarbaseBuildCost = { energy: 0, minerals: 25, food: 0, goods: 0, alloys: 25, research: 0 };
  const game = createHeadlessGame({ checkpoint }); const actor = game.createAiActor(0);
  const before = game.digest();
  for (const action of [
    { type: "moveFleet", fleetId: fleet.id, targetStarId: 99999 },
    { type: "orbitPlanet", fleetId: fleet.id, planetId: "missing-planet" },
    { type: "attackSystem", fleetId: fleet.id, targetStarId: 99999 },
  ]) { assert.equal(game.act(actor, action).ok, false); assert.equal(game.digest(), before); }
});

test("WebSocket adapters correlate accepted and malformed commands and retain planet detail responses", () => {
  const checkpoint = fresh().exportCheckpoint();
  const core = createGameCore(checkpoint.game, createMemoryAuth(checkpoint.accounts), { initialState: checkpoint.state, now: () => checkpoint.nowMs });
  const events: Array<Record<string, unknown>> = [];
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: (value: string) => events.push(JSON.parse(value)) });
  core.runtime.attachClient(socket as unknown as WebSocket, { id: 17, username: "test", accountType: "user", factionId: 0, createdAt: 0, updatedAt: 0 }, { mode: "faction", factionId: 0 });
  socket.emit("message", JSON.stringify({ ...district(fresh()), requestId: "ordinary" }));
  assert.ok(events.some((e) => e.type === "commandResult" && e.requestId === "ordinary" && e.ok === true));
  assert.ok(events.some((e) => e.type === "planetDetails"));
  socket.emit("message", JSON.stringify({ type: "moveFleet", targetStarId: "bad", requestId: "malformed" }));
  assert.ok(events.some((e) => e.type === "commandResult" && e.requestId === "malformed" && e.ok === false));
  const observer = Object.assign(new EventEmitter(), { readyState: 1, send: (value: string) => events.push(JSON.parse(value)) });
  core.runtime.attachClient(observer as unknown as WebSocket, { id: 18, username: "observer", accountType: "observer", factionId: null, createdAt: 0, updatedAt: 0 }, { mode: "observer" });
  const before = structuredClone(core.context.state.clock);
  observer.emit("message", JSON.stringify({ type: "setSpeedMultiplier", multiplier: 10, requestId: "observer-time" }));
  assert.deepEqual(core.context.state.clock, before);
  assert.ok(events.some((e) => e.requestId === "observer-time" && e.ok === false));
});

test("a rejected multi-source merge restores immediate ship transfers and every fleet order", () => {
  const checkpoint = fresh().exportCheckpoint();
  const target = checkpoint.state.fleets.find((f) => f.id === "fleet-0-1")!;
  const immediate = checkpoint.state.fleets.find((f) => f.id === "fleet-0-construction-1")!;
  immediate.systemPosition = structuredClone(target.systemPosition);
  const broken = checkpoint.state.fleets.find((f) => f.id === "fleet-1-1")!;
  broken.ownerId = 0; broken.currentStarId = 4;
  for (const ship of checkpoint.state.ships.filter((s) => broken.shipIds.includes(s.id))) {
    ship.ownerId = 0; ship.subsystemState!.engineDisabled = true; ship.subsystemState!.emergencyMobility = false;
  }
  const game = createHeadlessGame({ checkpoint }); const before = game.digest();
  const result = game.act(game.createAiActor(0), { type: "mergeFleets", targetFleetId: target.id, sourceFleetIds: [immediate.id, broken.id] });
  assert.equal(result.ok, false);
  assert.match(result.message!, /engine-crippled/);
  assert.equal(game.digest(), before);
});

test("observations are detached and frozen; queries consume no IDs or RNG", () => {
  const game = fresh(); const before = game.digest();
  const observation = game.observe(0);
  assert.throws(() => { observation.snapshot.factionEconomies[0].stockpiles.food = 9_999_999; }, TypeError);
  assert.throws(() => { observation.planets.planets.push(observation.planets.planets[0]); }, TypeError);
  const candidates = getAiCandidates(observation);
  assert.deepEqual(getAiCandidates(game.observe(0)), candidates);
  assert.equal(game.digest(), before);
  assert.equal("determinism" in observation.snapshot, false);
  const controller = game.controllerAccess(0);
  assert.deepEqual(Object.keys(controller), ["observe", "executeGameCommand"]);
  assert.deepEqual(controller.observe(), observation);
  assert.equal(controller.executeGameCommand(district(game)).ok, true);
});

test("hidden enemy resources, fleets, and private RNG do not affect observations or queries", () => {
  const reference = fresh(); const checkpoint = reference.exportCheckpoint();
  const enemy = checkpoint.state.fleets.find((f) => f.ownerId === 1)!;
  const ship = checkpoint.state.ships.find((s) => s.fleetId === enemy.id)!;
  ship.hull = 1; ship.hp = 1;
  checkpoint.state.factionEconomies.find((e) => e.factionId === 1)!.stockpiles.food += 999_999;
  checkpoint.state.determinism!.streams.combat = 789;
  const changed = createHeadlessGame({ checkpoint });
  assert.deepEqual(changed.observe(0), reference.observe(0));
  assert.deepEqual(getAiCandidates(changed.observe(0)), getAiCandidates(reference.observe(0)));
});

test("hidden fleet and starbase losses preserve stale observations and candidates", () => {
  const checkpoint = prepareScenario("combat-repair", { worldSeed: 19, simulationSeed: 71, initialWorld: { starCount: 12, factionCount: 2 } });
  const enemy = checkpoint.state.fleets.find((f) => f.ownerId === 1)!;
  enemy.currentStarId = 9;
  const reference = createHeadlessGame({ checkpoint });
  assert.ok(reference.observe(0).fleets.fleets.some((f) => f.id === enemy.id), "previously observed fleet remains remembered");
  checkpoint.state.fleets = checkpoint.state.fleets.filter((f) => f.id !== enemy.id);
  checkpoint.state.ships = checkpoint.state.ships.filter((s) => s.fleetId !== enemy.id);
  const destroyed = createHeadlessGame({ checkpoint });
  assert.deepEqual(destroyed.observe(0), reference.observe(0));
  assert.deepEqual(getAiCandidates(destroyed.observe(0)), getAiCandidates(reference.observe(0)));
  reference.step(100); destroyed.step(100);
  assert.deepEqual(destroyed.observe(0), reference.observe(0), "a scan of the old location must disclose the same absence whether the hidden fleet moved or died");

  const baseReference = createHeadlessGame({ worldSeed: 42, initialWorld: { starCount: 12, factionCount: 2 } });
  const baseCheckpoint = baseReference.exportCheckpoint();
  baseCheckpoint.state.starbases = baseCheckpoint.state.starbases.filter((s) => s.ownerId !== 1);
  const baseDestroyed = createHeadlessGame({ checkpoint: baseCheckpoint });
  assert.deepEqual(baseDestroyed.observe(0), baseReference.observe(0));
  assert.deepEqual(getAiCandidates(baseDestroyed.observe(0)), getAiCandidates(baseReference.observe(0)));
  assert.ok(reference.observe(0).diplomacy.countries.filter((c) => !c.isSelf).every((c) => c.faction.discoveredStarIds.length === 0));
  const ledger = reference.exportCheckpoint().state.intelligenceByFaction[0].entities["faction:0"];
  assert.ok(Object.entries(ledger.fields).filter(([key]) => key.endsWith(".preWarOwnership")).every(([, field]) => Array.isArray(field.value) && field.value.length === 0));
  const privateWarMap = reference.exportCheckpoint();
  privateWarMap.state.diplomacy.wars[0].preWarOwnership = privateWarMap.state.diplomacy.wars[0].preWarOwnership.map(([starId, ownerId]) =>
    reference.observe(0).snapshot.factions[0].discoveredStarIds.includes(starId) ? [starId, ownerId] : [starId, ownerId === 1 ? -1 : 1]);
  assert.deepEqual(createHeadlessGame({ checkpoint: privateWarMap }).observe(0), reference.observe(0));
  assert.deepEqual(getAiCandidates(createHeadlessGame({ checkpoint: privateWarMap }).observe(0)), getAiCandidates(reference.observe(0)));
});

test("recorded combat contact history does not depend on surviving actor membership", () => {
  const checkpoint = fresh().exportCheckpoint();
  const source = checkpoint.state.fleets.find((f) => f.id === "fleet-0-1")!;
  const target = checkpoint.state.fleets.find((f) => f.id === "fleet-1-1")!;
  checkpoint.state.recentCombatContacts.push({ id: "recorded-hit", year: checkpoint.state.clock.year, starId: source.currentStarId, sourceId: source.id, sourceKind: "fleet", sourceOwnerId: 0,
    targetId: target.id, targetKind: "fleet", targetOwnerId: 1, hit: true, shieldDamage: 1, armorDamage: 0, hullDamage: 0, targetDestroyed: false,
    sourcePosition: { x: 0, y: 0, z: 0 }, targetPosition: { x: 1, y: 0, z: 0 } });
  const expected = createHeadlessGame({ checkpoint }).observe(0).snapshot.recentCombatContacts;
  checkpoint.state.fleets = checkpoint.state.fleets.filter((f) => f.id !== source.id && f.id !== target.id);
  checkpoint.state.ships = checkpoint.state.ships.filter((s) => s.fleetId !== source.id && s.fleetId !== target.id);
  assert.deepEqual(createHeadlessGame({ checkpoint }).observe(0).snapshot.recentCombatContacts, expected);
  assert.equal(expected.length, 1);
});

test("seeded runs remain identical with interleaved games and checkpoint restoration", () => {
  const uninterrupted = fresh(); const interrupted = fresh(); const unrelated = createHeadlessGame({ worldSeed: 5, simulationSeed: 9, initialWorld: { starCount: 12, factionCount: 2 } });
  const command = district(uninterrupted);
  uninterrupted.act(uninterrupted.createAiActor(0), command);
  interrupted.act(interrupted.createAiActor(0), command);
  uninterrupted.step(5000);
  interrupted.step(2000); unrelated.step(2000);
  const resumed = createHeadlessGame({ checkpoint: interrupted.exportCheckpoint() });
  resumed.step(3000);
  assert.equal(resumed.digest(), uninterrupted.digest());
  const next = district(resumed);
  resumed.act(resumed.createAiActor(0), next); uninterrupted.act(uninterrupted.createAiActor(0), next);
  assert.equal(resumed.digest(), uninterrupted.digest());
  assert.throws(() => resumed.step(-1));
});

test("legacy saves gain deterministic state while preserving existing entity IDs", () => {
  const checkpoint = fresh().exportCheckpoint();
  checkpoint.state.ships[0].id = "legacy-ship-sim1-zzz";
  delete checkpoint.state.determinism;
  const ids = checkpoint.state.ships.map((s) => s.id);
  const game = createHeadlessGame({ checkpoint, simulationSeed: 77 });
  assert.ok(game.exportCheckpoint().state.determinism);
  assert.deepEqual(game.exportCheckpoint().state.ships.map((s) => s.id), ids);
  assert.ok(game.exportCheckpoint().state.determinism!.idCounter >= Number.parseInt("zzz", 36));
});
