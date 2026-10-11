import assert from "node:assert/strict";
import test from "node:test";
import { prepareWarCampaign } from "../game/war-lab";
import { createHeadlessGame, createMemoryAuth, type GameCheckpoint } from "../game/headless-game";
import { createGameCore } from "../game-runtime";
import { processStarbaseShipQueues } from "../game/economy-tick";
import { captureStarbase } from "../game/fleet-combat";
import { processArmyAndCrewReplenishment, processGroundBattles } from "../game/ground-combat";
import { createAiObservation } from "../game/ai-observation";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";
import { activeArmyRecruitment, activeGroundOrders, groundAssessment } from "../game/active-ground";
import { createActiveEpisode, decideActive, recordActiveRejection } from "../game/active";
import { getAiCandidates, isAiFleetReady } from "../game/ai-candidates";
import { createArmyUnit, ARMY_TYPE_DEFINITIONS } from "../../src/data/Armies";
import { peaceAssessment, rememberWarBorders } from "../game/active-diplomacy";

let base: GameCheckpoint;
function fixture() { base ??= prepareWarCampaign(); return structuredClone(base); }
function observation() { return structuredClone(createHeadlessGame({ checkpoint: fixture(), enableActiveAi: false, enablePassiveAi: false }).observe(0)); }
function transport(obs: ReturnType<typeof observation>, id: string, count: number, starId: number) {
  const templateFleet = obs.fleets.fleets.find((fleet) => fleet.ownerId === 0)!;
  const templateShip = obs.fleets.ships.find((ship) => ship.ownerId === 0)!;
  const fleet = { ...structuredClone(templateFleet), id, currentStarId: starId, shipIds: [] as string[], phase: "orbiting" as const,
    orderType: null, combatStatus: "idle" as const, repairOrder: null, retreatState: null, orbitTarget: null };
  for (let index = 0; index < count; index++) {
    const shipId = `${id}-ship-${index}`;
    const army = createArmyUnit({ id: `${id}-army-${index}`, ownerId: 0, speciesId: "species-faction-0", typeId: "lightInfantry", location: { kind: "fleet", fleetId: id }, transportShipId: shipId });
    obs.snapshot.armies.push(army);
    obs.fleets.ships.push({ ...structuredClone(templateShip), id: shipId, fleetId: id, shipKind: "armyShip", armyUnitId: army.id });
    fleet.shipIds.push(shipId);
  }
  obs.fleets.fleets.push(fleet);
  return fleet;
}

test("three-country war fixture has matched colonies, ordinary defenses and three actual wars", () => {
  const saved = fixture();
  assert.deepEqual(saved.state.adjacency, saved.state.stars.map((star) => saved.state.hyperlanes.flatMap(([a, b]) => a === star.id ? [b] : b === star.id ? [a] : [])), "the fixture is consistent even before checkpoint normalization");
  const game = createHeadlessGame({ checkpoint: saved, enablePassiveAi: false, enableActiveAi: false });
  const state = game.diagnosticState();
  assert.equal(state.stars.length, 9); assert.equal(state.diplomacy.wars.length, 3);
  for (let id = 0; id < 3; id++) {
    const planets = state.planetStates.filter((planet) => planet.ownerId === id);
    assert.equal(planets.length, 2);
    assert.deepEqual(planets.map((planet) => planet.economy.net), state.planetStates.filter((planet) => planet.ownerId === 0).map((planet) => planet.economy.net));
    assert.ok(state.factionEconomies[id].crewStockpile > 1_000_000);
    assert.equal(state.armies.filter((army) => army.ownerId === id && army.mobility === "mobile").length, 0);
    assert.ok(Object.values(state.factionEconomies[id].monthlyDelta).every((value) => value >= 0), "matched economies can support their starting forces");
  }
  assert.ok(state.fleets.filter((fleet) => fleet.id.startsWith("war-navy")).every((fleet) => fleet.orderType), "ordinary attack orders are already underway");
});

test("ordinary recruitment, transport merging, fortified invasion, recovery and re-embarkation preserve persistent armies", (t) => {
  const saved = fixture();
  const core = createGameCore(saved.game, createMemoryAuth(), { initialState: saved.state, now: () => saved.nowMs });
  const ctx = core.context, actor = core.createAiActor(0);
  const initialCrew = ctx.state.factionEconomies[0].crewStockpile;
  for (let index = 0; index < 34; index++) {
    const outcome = core.executeGameCommand(actor, { type: "queueArmyRecruitment", yardKind: "starbase", yardId: "war-base-0", armyTypeId: "lightInfantry", speciesId: "species-faction-0" });
    assert.equal(outcome.ok, true, outcome.message);
  }
  assert.equal(ctx.state.factionEconomies[0].crewStockpile, initialCrew - 34 * 60_000);
  // This component integration test advances each training and ground-combat
  // day through the shared production processors. Naval ticks are tested by
  // the separate full-runtime war fixture, not approximated by this test.
  let day = Math.floor(ctx.state.clock.year * GAME_DAYS_PER_YEAR);
  for (let elapsed = 0; elapsed < 4000 && ctx.state.armies.filter((army) => army.ownerId === 0 && army.mobility === "mobile").length < 34; elapsed++) {
    ctx.state.clock.year = ++day / GAME_DAYS_PER_YEAR;
    processStarbaseShipQueues(ctx, 1);
  }
  const trained = ctx.state.armies.filter((army) => army.ownerId === 0 && army.mobility === "mobile");
  assert.equal(trained.length, 34);
  assert.ok(trained.every((army) => army.location.kind === "fleet" && army.transportShipId));
  const transports = ctx.state.fleets.filter((fleet) => fleet.shipIds.every((id) => ctx.state.ships.find((ship) => ship.id === id)?.shipKind === "armyShip"));
  const fleet = transports[0];
  const merge = core.executeGameCommand(actor, { type: "mergeFleets", targetFleetId: fleet.id, sourceFleetIds: transports.slice(1).map((fleet) => fleet.id) });
  assert.equal(merge.ok, true, merge.message);
  assert.equal(fleet.shipIds.length, 34);
  const planet = ctx.state.planetStates.find((planet) => planet.id === "star-4-planet-0")!;
  const base = ctx.state.starbases.find((base) => base.starId === 4)!;
  const queued = core.executeGameCommand(core.createAiActor(1), { type: "queueArmyRecruitment", yardKind: "starbase", yardId: "war-base-3", armyTypeId: "lightInfantry", speciesId: "species-faction-1" });
  assert.equal(queued.ok, true, queued.message);
  const inherited = structuredClone(ctx.state.starbases.find((yard) => yard.id === "war-base-3")!.shipQueue);
  base.shipQueue = structuredClone(inherited);
  planet.defense.shipQueue = structuredClone(inherited);
  captureStarbase(ctx, base, 0); ctx.syncSystemOwnershipFromStarbases();
  assert.deepEqual(base.shipQueue, inherited, "starbase conquest keeps queues exactly");
  // Explicit post-arrival setup isolates the ground phase from naval travel.
  fleet.currentStarId = 4; fleet.phase = "orbitingPlanet"; fleet.orderType = null;
  fleet.orbitTarget = { kind: "planet", starId: 4, planetId: planet.id, position: { x: 0, y: 0, z: 0 } };
  ctx.refreshDiscovery();
  const obs = createAiObservation(ctx, 0);
  const invasion = activeGroundOrders(obs, getAiCandidates(obs), new Set()).find((action) => action.type === "beginPlanetInvasion" && action.fleetId === fleet.id);
  assert.ok(invasion);
  const outcome = core.executeGameCommand(actor, invasion);
  assert.equal(outcome.ok, true, outcome.message);
  assert.equal(ctx.state.groundBattles.length, 1);
  assert.equal(ctx.state.groundBattles[0].defenderArmyIds.length, 10, "authored fortress garrisons remain intact");
  const before = trained.map((army) => army.id);
  let battleDays = 0;
  while (ctx.state.groundBattles.length && battleDays++ < 1000) {
    ctx.state.clock.year = ++day / GAME_DAYS_PER_YEAR;
    processGroundBattles(ctx);
  }
  assert.ok(battleDays > 1 && battleDays < 1000);
  assert.equal(ctx.state.planetStates.find((entry) => entry.id === planet.id)!.ownerId, 0);
  assert.deepEqual(ctx.state.planetStates.find((entry) => entry.id === planet.id)!.defense.shipQueue, inherited, "planet conquest keeps queues exactly");
  const survivors = ctx.state.armies.filter((army) => before.includes(army.id));
  assert.ok(survivors.length > 0 && survivors.some((army) => army.hp < army.maxHp || army.manpower < army.maxManpower), "real casualties occurred against the fortress");
  t.diagnostic(JSON.stringify({ battleDays, trained: 34, survivors: survivors.length,
    survivingManpower: survivors.reduce((sum, army) => sum + army.manpower, 0), planetOwner: 0 }));
  for (let elapsed = 0; elapsed < 720; elapsed++) {
    ctx.state.clock.year = ++day / GAME_DAYS_PER_YEAR;
    processArmyAndCrewReplenishment(ctx, 1);
  }
  assert.ok(survivors.every((army) => army.hp >= army.maxHp * 0.9 && army.manpower >= army.maxManpower * 0.9));
  ctx.recalculatePlanetEconomies(); ctx.refreshFactionEconomyDeltas(); ctx.refreshDiscovery();
  const recovered = createAiObservation(ctx, 0);
  const embark = activeGroundOrders(recovered, getAiCandidates(recovered), new Set()).find((action) => action.type === "embarkPlanetArmies" && action.planetId === planet.id);
  assert.ok(embark);
  const embarked = core.executeGameCommand(actor, embark);
  assert.equal(embarked.ok, true, embarked.message);
  assert.ok(survivors.every((army) => army.location.kind === "fleet" && ctx.state.ships.some((ship) => ship.armyUnitId === army.id)));
});

test("army recruitment scales beyond two units, respects species caps and crew reserves, and uses normal commands", () => {
  const obs = observation(), ep = createActiveEpisode(obs, null, 0, 0);
  const action = activeArmyRecruitment(obs, ep);
  assert.equal(action?.type, "queueArmyRecruitment");
  const game = createHeadlessGame({ checkpoint: fixture(), enableActiveAi: false, enablePassiveAi: false });
  const outcome = game.act(game.createAiActor(0), action);
  assert.equal(outcome.ok, true, outcome.message);
  transport(obs, "two-existing", 2, 0);
  assert.equal(activeArmyRecruitment(obs, ep)?.type, "queueArmyRecruitment");
  obs.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!.crewStockpile = 60_000;
  assert.equal(activeArmyRecruitment(obs, ep), undefined);
  obs.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!.crewStockpile = 1_000_000;
  for (const { planetState } of obs.planets.planets.filter(({ planetState }) => planetState.ownerId === 0)) planetState.speciesPopulations[0].population = 100_000_000;
  assert.equal(activeArmyRecruitment(obs, ep), undefined);
});

test("ground estimates ignore hidden enemy armies and recruit no new armies in peace", () => {
  const saved = fixture(), game = createHeadlessGame({ checkpoint: saved, enableActiveAi: false, enablePassiveAi: false });
  const before = groundAssessment(game.observe(0));
  saved.state.armies.push(createArmyUnit({ id: "secret", ownerId: 1, speciesId: "species-faction-1", typeId: "mechanizedArmy", location: { kind: "planet", planetId: "star-3-planet-0" } }));
  assert.deepEqual(groundAssessment(createHeadlessGame({ checkpoint: saved }).observe(0)), before);
  const obs = observation(); obs.diplomacy.countries.forEach((country) => { country.atWar = false; });
  assert.equal(activeArmyRecruitment(obs, createActiveEpisode(obs, null, 0, 0)), undefined);
});

test("transports assemble, avoid piecemeal invasions, and can land despite enemy support ships", () => {
  const obs = observation();
  obs.snapshot.starOwnership = obs.snapshot.starOwnership.map(([star, owner]) => [star, star === 4 ? 0 : owner]);
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0 || fleet.currentStarId !== 4);
  const small = transport(obs, "small", 1, 4);
  const orders = () => activeGroundOrders(obs, getAiCandidates(obs), new Set());
  assert.ok(!orders().some((action) => action.type === "beginPlanetInvasion" || action.type === "orbitPlanet" && action.fleetId === small.id));
  const large = transport(obs, "large", 40, 4);
  assert.ok(orders().some((action) => action.type === "mergeFleets" && action.sourceFleetIds.includes(large.id)));
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.id !== small.id);
  large.phase = "orbitingPlanet" as never; large.orbitTarget = { kind: "planet", planetId: "star-4-planet-0" } as never;
  const support = { ...structuredClone(large), id: "enemy-science", ownerId: 1, shipIds: ["enemy-science-ship"] };
  obs.fleets.fleets.push(support);
  obs.fleets.ships.push({ ...structuredClone(obs.fleets.ships[0]), id: "enemy-science-ship", ownerId: 1, fleetId: support.id, shipKind: "scienceShip" });
  obs.snapshot.intelligence.entities.push({ id: support.id, kind: "fleet", fields: { existence: { status: "current", value: true, observedAtYear: 2100, sourceIds: [] }, currentStarId: { status: "current", value: 4, observedAtYear: 2100, sourceIds: [] } } });
  assert.ok(orders().some((action) => action.type === "beginPlanetInvasion" && action.fleetId === large.id));
  obs.fleets.ships.find((ship) => ship.id === "enemy-science-ship")!.shipKind = "corvette";
  assert.ok(!orders().some((action) => action.type === "beginPlanetInvasion"));
  large.combatStatus = "evading" as never;
  assert.ok(orders().some((action) => action.type === "retreatFleetTo" && action.fleetId === large.id), "transports escape armed contact even while evading");
  const ep = createActiveEpisode(obs, null, 0, 0);
  for (const action of getAiCandidates(obs).movement) if (action.type === "moveFleet" && action.fleetId === large.id) {
    recordActiveRejection(ep, { type: "retreatFleetTo", fleetId: large.id, targetStarId: action.targetStarId }, obs.snapshot.clock.year, "No reachable route to retreat target.");
  }
  const blocked = () => activeGroundOrders(obs, getAiCandidates(obs), new Set(), false, ep.blockedScoutTargets);
  assert.ok(!blocked().some((action) => action.type === "retreatFleetTo"), "player feedback prevents daily retries of rejected routes");
  obs.snapshot.clock.year += 91 / GAME_DAYS_PER_YEAR;
  assert.ok(blocked().some((action) => action.type === "retreatFleetTo"), "a changed world can be retried after the normal route cooldown");
});

test("enabled conquest preparation is bounded by visible opportunities and declarations require assembled troops", () => {
  const obs = observation();
  obs.diplomacy.countries.forEach((country) => { country.atWar = false; country.activeTreatyCount = 0; });
  obs.snapshot.hyperlanes = [[0, 4]];
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0);
  const navy = obs.fleets.fleets.find((fleet) => fleet.id === "war-navy-0")!;
  navy.currentStarId = 0; navy.phase = "orbiting"; navy.orderType = null;
  navy.movementPlan = null; navy.targetStarId = null; navy.combatStatus = "idle";
  const ep = createActiveEpisode(obs, null, 0, 0);
  assert.equal(activeArmyRecruitment(obs, ep), undefined, "ordinary peaceful countries do not prepare conquest without the tag");
  assert.equal(activeArmyRecruitment(obs, ep, true)?.type, "queueArmyRecruitment");
  assert.ok(!decideActive(obs, structuredClone(ep), true).some(({ action }) => action.type === "declareWar"));
  const troops = transport(obs, "invasion-ready", 40, 0);
  troops.movementPlan = null; troops.targetStarId = null;
  assert.ok(decideActive(obs, structuredClone(ep), true).some(({ action }) => action.type === "declareWar" && action.targetFactionId === 1));
  assert.ok(!decideActive(obs, structuredClone(ep), false).some(({ action }) => action.type === "declareWar"));
  obs.diplomacy.countries.find((country) => country.faction.id === 1)!.activeTreatyCount = 1;
  assert.equal(groundAssessment(obs, true).requiredAttack, 0);
  assert.ok(!decideActive(obs, structuredClone(ep), true).some(({ action }) => action.type === "declareWar"));
});

test("transports reinforce a friendly ground defense and injured transports land to recover", () => {
  const obs = observation();
  const fleet = transport(obs, "defenders", 2, 0);
  fleet.phase = "orbitingPlanet" as never; fleet.orbitTarget = { kind: "planet", planetId: "star-0-planet-0" } as never;
  obs.snapshot.groundBattles.push({ id: "home-defense", planetId: "star-0-planet-0", attackerFactionId: 1, defenderFactionId: 0,
    attackerArmyIds: [], defenderArmyIds: [], startedAtYear: 2100, lastProcessedDay: 2100 * 360 });
  const orders = () => activeGroundOrders(obs, getAiCandidates(obs), new Set());
  assert.ok(orders().some((action) => action.type === "landArmyFleet" && action.fleetId === fleet.id && action.planetId === "star-0-planet-0"));
  obs.snapshot.groundBattles = [];
  obs.snapshot.armies.find((army) => army.id === "defenders-army-0")!.hp = 40;
  assert.ok(orders().some((action) => action.type === "landArmyFleet" && action.fleetId === fleet.id));
});

test("equal transport groups use one stable rally instead of swapping systems", () => {
  const obs = observation();
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0);
  transport(obs, "rally-a", 1, 0); transport(obs, "rally-b", 1, 1);
  const moves = activeGroundOrders(obs, getAiCandidates(obs), new Set()).filter((action) => action.type === "moveFleet");
  assert.deepEqual(moves, [{ type: "moveFleet", fleetId: "rally-b", targetStarId: 0 }]);
});

test("orbital transport rendezvous first anchors its carrier with a normal hold order", () => {
  const obs = observation();
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0);
  const anchor = transport(obs, "orbit-anchor", 1, 0);
  anchor.phase = "orbitingPlanet" as never; anchor.orbitTargetPlanetId = "star-0-planet-0";
  anchor.orbitTarget = { kind: "planet", planetId: "star-0-planet-0" } as never;
  transport(obs, "reinforcement", 1, 0);
  const orders = activeGroundOrders(obs, getAiCandidates(obs), new Set());
  assert.equal(orders[0].type, "issueFleetTacticalOrder");
  assert.deepEqual(orders[0], { type: "issueFleetTacticalOrder", fleetId: anchor.id, order: { type: "hold" } });
  assert.equal(orders[1].type, "mergeFleets");
});

test("peace can wait for an imminent invasion, but distress and threatened colonies take priority", () => {
  const obs = observation(), ep = createActiveEpisode(obs, null, 0, 0);
  rememberWarBorders(obs, ep);
  obs.snapshot.starOwnership.find(([id]) => id === 4)![1] = 0;
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0);
  const troops = transport(obs, "peace-expedition", 40, 0);
  const assessment = () => peaceAssessment(obs, ep, 1, true, true);
  assert.equal(assessment().deferForInvasion, true);
  assert.equal(assessment().acceptStatusQuo, false);
  assert.equal(peaceAssessment(obs, ep, 1, false, true).deferForInvasion, false);
  const home = obs.planets.planets.find(({ planetState }) => planetState.ownerId === 0)!.starId;
  obs.snapshot.starOwnership.find(([id]) => id === home)![1] = 1;
  assert.equal(assessment().deferForInvasion, false);
  obs.snapshot.starOwnership.find(([id]) => id === home)![1] = 0;
  troops.shipIds = [];
  obs.snapshot.armies = obs.snapshot.armies.filter((army) => !army.id.startsWith("peace-expedition"));
  const queue = Array.from({ length: 40 }, (_, index) => ({ id: `near-${index}`, kind: "armyBuild", armyTypeId: "lightInfantry", remainingDays: 2 })) as never;
  obs.fleets.starbases.find((base) => base.ownerId === 0)!.shipQueue = queue;
  assert.equal(assessment().deferForInvasion, true, "short queues can finish a viable force soon");
  for (const item of obs.fleets.starbases.find((base) => base.ownerId === 0)!.shipQueue) item.remainingDays = 180;
  assert.equal(assessment().deferForInvasion, false, "years of queued work are not near readiness");
});

test("forced-war peace suppression persists only in its isolated checkpoint", () => {
  const saved = fixture();
  assert.equal(saved.allowAiPeace, false);
  const obs = observation(), ep = createActiveEpisode(obs, null, 0, 0);
  obs.snapshot.clock.year += 4;
  assert.ok(decideActive(obs, structuredClone(ep), false, true).some(({ action }) => action.type === "proposePeace"));
  assert.ok(!decideActive(obs, structuredClone(ep), false, false).some(({ action }) => action.type === "proposePeace"));
  const game = createHeadlessGame({ checkpoint: saved });
  assert.equal(game.exportCheckpoint().allowAiPeace, false);
  assert.equal(createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 } }).exportCheckpoint().allowAiPeace, true);
});

test("completed orbit and tactical movement labels do not strand fleets, while real travel stays busy", () => {
  const obs = observation();
  const fleet = transport(obs, "available", 2, 0);
  fleet.movementPlan = null; fleet.hyperlanePosition = null; fleet.targetStarId = null;
  fleet.orderType = "orbit";
  fleet.phase = "orbitingPlanet" as never;
  fleet.orbitTarget = { kind: "planet", planetId: "star-0-planet-0" } as never;
  obs.snapshot.armies.find((army) => army.id === "available-army-0")!.hp = 40;
  assert.ok(isAiFleetReady(fleet));
  assert.ok(activeGroundOrders(obs, getAiCandidates(obs), new Set()).some((action) => action.type === "landArmyFleet" && action.fleetId === fleet.id));
  fleet.phase = "movingSystem" as never; fleet.orderType = "move"; fleet.orbitTarget = null;
  assert.ok(isAiFleetReady(fleet), "completed combat movement is replaceable");
  assert.ok(activeGroundOrders(obs, getAiCandidates(obs), new Set()).some((action) => action.type === "orbitPlanet" && action.fleetId === fleet.id));
  fleet.targetStarId = 1;
  assert.equal(isAiFleetReady(fleet), false);
  fleet.targetStarId = null; fleet.movementPlan = { id: "actual-transit" } as never;
  assert.equal(isAiFleetReady(fleet), false);
  assert.ok(!activeGroundOrders(obs, getAiCandidates(obs), new Set()).some((action) => "fleetId" in action && action.fleetId === fleet.id));
  fleet.movementPlan = null; fleet.orderType = "build";
  assert.equal(isAiFleetReady(fleet), false);
});

test("army scheduling survives checkpoints and older active episodes receive a default", () => {
  const saved = fixture(), game = createHeadlessGame({ checkpoint: saved });
  const ep = createActiveEpisode(game.observe(0), null, 0, 0);
  saved.state.activeEpisodes = { 0: ep };
  delete ep.nextArmyYear;
  const restored = createHeadlessGame({ checkpoint: saved });
  assert.equal(restored.diagnosticState().activeEpisodes![0].nextArmyYear, saved.state.clock.year);
  const next = restored.exportCheckpoint(); next.state.activeEpisodes![0].nextArmyYear! += 1;
  assert.equal(createHeadlessGame({ checkpoint: next }).diagnosticState().activeEpisodes![0].nextArmyYear, saved.state.clock.year + 1);
});

test("healthy landed troops are reused; damaged troops recover and badly losing attacks withdraw", () => {
  const obs = observation();
  const army = createArmyUnit({ id: "veteran", ownerId: 0, speciesId: "species-faction-0", typeId: "lightInfantry", location: { kind: "planet", planetId: "star-0-planet-0" } });
  obs.snapshot.armies.push(army);
  const orders = () => activeGroundOrders(obs, getAiCandidates(obs), new Set());
  assert.ok(orders().some((action) => action.type === "embarkPlanetArmies" && action.armyIds.includes(army.id)));
  army.hp = 50;
  assert.ok(!orders().some((action) => action.type === "embarkPlanetArmies" && action.armyIds.includes(army.id)));
  const defender = createArmyUnit({ id: "strong-defender", ownerId: 1, speciesId: "species-faction-1", typeId: "mechanizedArmy", location: { kind: "planet", planetId: "star-4-planet-0" } });
  obs.snapshot.armies.push(defender);
  obs.snapshot.groundBattles.push({ id: "losing", planetId: "star-4-planet-0", attackerFactionId: 0, defenderFactionId: 1, attackerArmyIds: [army.id], defenderArmyIds: [defender.id], startedAtYear: 2100, lastProcessedDay: 2100 * 360 });
  assert.ok(orders().some((action) => action.type === "withdrawGroundBattle" && action.battleId === "losing"));
  obs.snapshot.groundBattles[0].withdrawalDueYear = 2100.1;
  assert.ok(!orders().some((action) => action.type === "withdrawGroundBattle"));
});

test("a stranded scout cannot block assembly of a stronger group at home", () => {
  const obs = observation();
  obs.diplomacy.countries.forEach((country) => { country.atWar = false; country.theirBorderPolicy = "closed"; });
  obs.fleets.fleets = obs.fleets.fleets.filter((fleet) => fleet.ownerId === 0);
  const scout = obs.fleets.fleets.find((fleet) => fleet.id === "war-navy-0")!;
  scout.phase = "orbiting"; scout.movementPlan = null; scout.currentTacticalOrder = null;
  scout.shipIds = [scout.shipIds[0]]; scout.combatStatus = "idle"; scout.orderType = null;
  const template = obs.fleets.ships.find((ship) => ship.id === scout.shipIds[0])!;
  for (let index = 0; index < 3; index++) {
    const id = `home-${index}`, shipId = `${id}-ship`;
    obs.fleets.fleets.push({ ...structuredClone(scout), id, currentStarId: 0, shipIds: [shipId] });
    obs.fleets.ships.push({ ...structuredClone(template), id: shipId, fleetId: id });
  }
  const decisions = decideActive(obs, createActiveEpisode(obs, null, 0, 0));
  assert.ok(decisions.some(({ action }) => action.type === "mergeFleets" && action.targetFleetId.startsWith("home-") && action.sourceFleetIds.length === 2));
  assert.equal(ARMY_TYPE_DEFINITIONS.lightInfantry.cost.alloys, 450);
});
