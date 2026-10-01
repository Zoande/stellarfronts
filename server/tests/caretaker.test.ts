import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame, type GameCheckpoint } from "../game/headless-game";
import { CARETAKER_AFK_MS, createCaretakerEpisode, decideCaretaker } from "../game/caretaker";
import { getAiCandidates } from "../game/ai-candidates";
import { createGameCore } from "../game-runtime";
import { createMemoryAuth } from "../game/headless-game";
import { EventEmitter } from "node:events";
import type { WebSocket } from "ws";
import { buildHyperlaneAdjacency } from "../../src/data/Hyperlanes";
import { createAiObservation } from "../game/ai-observation";
import { prepareScenario } from "../game/simulation-scenarios";

let base: GameCheckpoint;
function checkpoint(): GameCheckpoint {
  base ??= createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 },
    accounts: { owners: { 0: 17, 1: 18 }, balances: { 17: 8, 18: 8 } } }).exportCheckpoint();
  return structuredClone(base);
}

test("caretaker starts at 48 real hours, persists past day five, and returns control on real activity", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint() });
  game.advanceRealTime(CARETAKER_AFK_MS - 1);
  assert.equal(game.diagnosticState().caretakerEpisodes?.[0], undefined);
  game.advanceRealTime(1);
  const episode = game.exportCheckpoint().state.caretakerEpisodes?.[0];
  assert.ok(episode);
  assert.equal(episode.accountId, 17);
  assert.ok(episode.fleets.length > 0);
  game.advanceRealTime(3 * 24 * 60 * 60 * 1000);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0], "caretaker continues at day five until passive mode exists");
  assert.equal(game.recordPlayerActivity(99, 0), false);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  assert.equal(game.recordPlayerActivity(17, 0), true);
  assert.equal(game.diagnosticState().caretakerEpisodes?.[0], undefined);
  game.advanceRealTime(CARETAKER_AFK_MS - 1);
  assert.equal(game.diagnosticState().caretakerEpisodes?.[0], undefined);
  game.advanceRealTime(1);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
});

test("accepted human gameplay commands end caretaker, rejected commands and observers do not", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint() });
  game.advanceRealTime(CARETAKER_AFK_MS);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  assert.equal(game.act(game.createHumanActor(17, 0), { type: "buildDistrict", planetId: "missing", districtKind: "mining" }).ok, false);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  assert.equal(game.act(game.createObserverActor(), { type: "playerActivity" }).ok, false);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  const action = getAiCandidates(game.observe(0)).economy.find((candidate) => candidate.type === "buildDistrict");
  assert.ok(action);
  assert.equal(game.act(game.createHumanActor(17, 0), action).ok, true);
  assert.equal(game.diagnosticState().caretakerEpisodes?.[0], undefined);
  assert.equal(game.exportCheckpoint().accounts.balances[17], 8);
});

test("connecting alone leaves caretaker active; actual WebSocket input hands back without clearing orders", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint() });
  game.advanceRealTime(CARETAKER_AFK_MS);
  const saved = game.exportCheckpoint();
  const pendingOrders = saved.state.fleets.filter((fleet) => fleet.ownerId === 0 && fleet.orderType === "build").map((fleet) => fleet.id);
  const core = createGameCore(saved.game, createMemoryAuth(saved.accounts), {
    initialState: saved.state, now: () => saved.nowMs, realNow: () => saved.realNowMs!,
  });
  const events: Array<Record<string, unknown>> = [];
  const socket = Object.assign(new EventEmitter(), { readyState: 1, send: (value: string) => events.push(JSON.parse(value)) });
  core.runtime.attachClient(socket as unknown as WebSocket, { id: 17, username: "caretaker-owner", accountType: "user", factionId: 0, createdAt: 0, updatedAt: 0 }, { mode: "faction", factionId: 0 });
  assert.ok(events.some((event) => event.type === "serverInfo" && Array.isArray(event.capabilities) && event.capabilities.includes("playerActivity")));
  assert.ok(core.context.state.caretakerEpisodes?.[0], "a socket is not meaningful activity");
  socket.emit("message", JSON.stringify({ type: "playerActivity", factionId: 1 }));
  assert.equal(core.context.state.caretakerEpisodes?.[0], undefined);
  assert.ok(core.context.state.caretakerEpisodes?.[1], "client-provided faction fields cannot hand back a different country");
  assert.deepEqual(core.context.state.fleets.filter((fleet) => fleet.ownerId === 0 && fleet.orderType === "build").map((fleet) => fleet.id), pendingOrders);
  assert.equal(events.some((event) => event.type === "commandResult" && event.ok === false), false);
});

test("an activity-store write failure does not turn an accepted human command into a rejection", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint() });
  game.advanceRealTime(CARETAKER_AFK_MS);
  const saved = game.exportCheckpoint();
  const auth = { ...createMemoryAuth(saved.accounts), recordGameActivity: () => { throw new Error("temporary storage failure"); } };
  const core = createGameCore(saved.game, auth, { initialState: saved.state, now: () => saved.nowMs, realNow: () => saved.realNowMs! });
  const action = getAiCandidates(createAiObservation(core.context, 0)).economy.find((candidate) => candidate.type === "buildDistrict");
  assert.ok(action);
  const previousLog = console.error;
  console.error = () => undefined;
  try {
    assert.equal(core.executeGameCommand(core.createHumanActor(17, 0), action).ok, true);
    core.processCaretakers();
    assert.equal(core.context.state.caretakerEpisodes?.[0], undefined);
  } finally { console.error = previousLog; }
});

test("caretaker state, independent real clock, and decisions survive checkpoint restore", () => {
  const original = createHeadlessGame({ checkpoint: checkpoint() });
  original.advanceRealTime(CARETAKER_AFK_MS);
  const resumed = createHeadlessGame({ checkpoint: original.exportCheckpoint() });
  assert.equal(resumed.realNow(), original.realNow());
  assert.equal(resumed.digest(), original.digest());
  original.step(2_400);
  resumed.step(2_400);
  assert.equal(resumed.digest(), original.digest());
  assert.deepEqual(resumed.exportCheckpoint().accounts, original.exportCheckpoint().accounts);
});

test("fleet snapshot caps replacement orders by exact design, including a destroyed fleet", () => {
  const starting = checkpoint();
  const homeBase = starting.state.starbases.find((base) => base.ownerId === 0)!;
  homeBase.buildingSlots[1] = "shipyard";
  starting.state.factionEconomies.find((economy) => economy.factionId === 0)!.stockpiles.alloys = 10_000;
  starting.state.factionEconomies.find((economy) => economy.factionId === 0)!.crewStockpile = 10_000;
  const active = createHeadlessGame({ checkpoint: starting });
  active.advanceRealTime(CARETAKER_AFK_MS);
  const taken = active.exportCheckpoint();
  const fleet = taken.state.fleets.find((entry) => entry.ownerId === 0 && entry.shipIds.some((id) => taken.state.ships.some((ship) => ship.id === id && ship.shipKind === "corvette")))!;
  const originalIds = [...fleet.shipIds];
  taken.state.ships = taken.state.ships.filter((ship) => !originalIds.includes(ship.id));
  taken.state.fleets = taken.state.fleets.filter((entry) => entry.id !== fleet.id);
  for (const id of originalIds) delete taken.state.intelligenceByFaction[0].entities[`ship:${id}`];
  delete taken.state.intelligenceByFaction[0].entities[`fleet:${fleet.id}`];
  taken.state.caretakerEpisodes![0].nextDecisionYear = taken.state.clock.year;
  const game = createHeadlessGame({ checkpoint: taken });
  game.advanceRealTime(0);
  const first = game.exportCheckpoint();
  const episode = first.state.caretakerEpisodes![0];
  assert.ok(episode.fleets.some((entry) => entry.fleetId === fleet.id && entry.ships.length === originalIds.length));
  assert.equal(Object.keys(episode.queuedShips).length, 1);
  assert.ok(first.state.starbases.some((base) => base.shipQueue.some((item) => item.id in episode.queuedShips)));
  for (let i = 0; i < originalIds.length + 2; i++) {
    const next = game.diagnosticState().caretakerEpisodes![0];
    next.nextDecisionYear = game.diagnosticState().clock.year;
    game.advanceRealTime(0);
  }
  const final = game.exportCheckpoint().state.caretakerEpisodes![0];
  const relevant = Object.values(final.queuedShips).filter((item) => item.fleetId === fleet.id);
  assert.equal(relevant.length, originalIds.length);
  assert.ok(relevant.every((item) => item.shipKind === "corvette"));
  const finishing = game.exportCheckpoint();
  const item = finishing.state.starbases.flatMap((base) => base.shipQueue).find((queued) => queued.id in final.queuedShips)!;
  item.remainingDays = 0.01;
  const completed = createHeadlessGame({ checkpoint: finishing, stepMs: 1_000 });
  completed.step(1_000);
  const completedEpisode = completed.diagnosticState().caretakerEpisodes![0];
  assert.equal(Object.keys(completedEpisode.queuedShips).length, 0);
  assert.equal(Object.keys(completedEpisode.reinforcements).length, 1);
  assert.ok(completed.diagnosticState().ships.some((ship) => ship.id in completedEpisode.reinforcements && ship.designId === relevant[0].designId));
  const delayed = completed.exportCheckpoint();
  const replacementId = Object.keys(delayed.state.caretakerEpisodes![0].reinforcements)[0];
  delete delayed.state.intelligenceByFaction[0].entities[`ship:${replacementId}`];
  delayed.state.caretakerEpisodes![0].nextDecisionYear = delayed.state.clock.year;
  const communicationGap = createHeadlessGame({ checkpoint: delayed });
  communicationGap.advanceRealTime(0);
  assert.equal(communicationGap.diagnosticState().starbases.find((entry) => entry.id === homeBase.id)?.shipQueue.length, 0,
    "a temporarily unobserved completed replacement must not be ordered again");
});

test("player ship orders already in a yard count against caretaker's country-wide fleet ceiling", () => {
  const starting = checkpoint();
  const base = starting.state.starbases.find((entry) => entry.ownerId === 0)!;
  base.buildingSlots[1] = "shipyard";
  const economy = starting.state.factionEconomies.find((entry) => entry.factionId === 0)!;
  economy.crewStockpile = 20_000;
  economy.stockpiles.alloys = 10_000;
  const ship = starting.state.ships.find((entry) => entry.ownerId === 0 && entry.shipKind === "corvette")!;
  const game = createHeadlessGame({ checkpoint: starting });
  assert.equal(game.act(game.createHumanActor(17, 0), { type: "buildStarbaseShip", starbaseId: base.id, shipKind: "corvette", designId: ship.designId }).ok, true);
  game.advanceRealTime(CARETAKER_AFK_MS);
  const taken = game.exportCheckpoint();
  taken.state.ships = taken.state.ships.filter((entry) => entry.id !== ship.id);
  taken.state.fleets = taken.state.fleets.filter((entry) => entry.id !== ship.fleetId);
  delete taken.state.intelligenceByFaction[0].entities[`ship:${ship.id}`];
  delete taken.state.intelligenceByFaction[0].entities[`fleet:${ship.fleetId}`];
  taken.state.caretakerEpisodes![0].nextDecisionYear = taken.state.clock.year;
  const resumed = createHeadlessGame({ checkpoint: taken });
  resumed.advanceRealTime(0);
  assert.equal(resumed.diagnosticState().starbases.find((entry) => entry.id === base.id)?.shipQueue.length, 1);
  assert.deepEqual(resumed.diagnosticState().caretakerEpisodes![0].queuedShips, {});
});

test("policy ignores hidden changes and stays within caretaker action boundaries", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint() });
  const observation = game.observe(0);
  const episode = createCaretakerEpisode(observation, 17, game.realNow(), game.realNow());
  const decisions = decideCaretaker(observation, episode);
  const permitted = new Set(["buildDistrict", "buildPlanetBuilding", "marketTrade", "repairFleet", "buildStarbaseShip", "buildPlanetShip", "moveFleet", "mergeFleets", "attackTarget", "buildStarbase"]);
  assert.ok(decisions.every((decision) => permitted.has(decision.action.type)));
  const changed = checkpoint();
  changed.state.factionEconomies.find((economy) => economy.factionId === 1)!.stockpiles.alloys += 500_000;
  const other = createHeadlessGame({ checkpoint: changed });
  assert.deepEqual(other.observe(0), observation);
  assert.deepEqual(decideCaretaker(other.observe(0), structuredClone(episode)), decisions);
});

test("food recovery funds imports from surplus goods before strategic minerals", () => {
  const saved = prepareScenario("shortage-recovery", { worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } });
  saved.accounts.owners = { 0: 17 };
  saved.accounts.activities = { 0: saved.realNowMs ?? saved.nowMs };
  const economy = saved.state.factionEconomies.find((entry) => entry.factionId === 0)!;
  economy.stockpiles.food = 0;
  economy.stockpiles.energy = 450;
  economy.monthlyDelta.food = -100;
  const game = createHeadlessGame({ checkpoint: saved });
  const observation = game.observe(0);
  const episode = createCaretakerEpisode(observation, 17, game.realNow(), game.realNow());
  const trade = decideCaretaker(observation, episode).map((entry) => entry.action).find((action) => action.type === "marketTrade");
  assert.ok(trade);
  assert.equal(trade.tradeType, "sell");
  assert.equal(trade.resourceId, "goods");
});

test("multiple construction fleets can claim distinct known frontier systems when affordable", () => {
  const saved = checkpoint();
  const state = saved.state;
  const home = state.factions.find((faction) => faction.id === 0)!.homeStarId;
  const frontier = state.starOwnership.flatMap((owner, id) => owner < 0 && id !== home ? [id] : []).slice(0, 2);
  assert.equal(frontier.length, 2);
  for (const target of frontier) state.hyperlanes.push([home, target]);
  state.adjacency = buildHyperlaneAdjacency(state.hyperlanes, state.stars.length);
  const original = state.fleets.find((fleet) => fleet.ownerId === 0 && fleet.shipIds.some((id) => state.ships.some((ship) => ship.id === id && ship.shipKind === "constructionShip")))!;
  const constructionShip = state.ships.find((ship) => original.shipIds.includes(ship.id) && ship.shipKind === "constructionShip")!;
  const duplicateShip = { ...structuredClone(constructionShip), id: "caretaker-extra-construction-ship", fleetId: "caretaker-extra-construction-fleet" };
  const duplicateFleet = { ...structuredClone(original), id: duplicateShip.fleetId, shipIds: [duplicateShip.id], currentStarId: home, targetStarId: null, phase: "idle" as const,
    orderType: null, route: [], movementPlan: null };
  state.ships.push(duplicateShip);
  state.fleets.push(duplicateFleet);
  const core = createGameCore(saved.game, createMemoryAuth(saved.accounts), { initialState: state, now: () => saved.nowMs });
  core.context.refreshDiscovery();
  const observation = createAiObservation(core.context, 0);
  const episode = createCaretakerEpisode(observation, 17, saved.realNowMs!, saved.realNowMs! + CARETAKER_AFK_MS);
  const orders = decideCaretaker(observation, episode).map((decision) => decision.action).filter((action) => action.type === "buildStarbase");
  assert.equal(orders.length, 2);
  assert.equal(new Set(orders.map((order) => order.fleetId)).size, 2);
  assert.equal(new Set(orders.map((order) => order.targetStarId)).size, 2);
  const actor = core.createAiActor(0, "caretaker-test");
  assert.ok(orders.every((order) => core.executeGameCommand(actor, order).ok));
});
