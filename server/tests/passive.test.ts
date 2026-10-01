import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame, createMemoryAuth, type GameCheckpoint } from "../game/headless-game";
import { createGameCore } from "../game-runtime";
import { CARETAKER_AFK_MS } from "../game/caretaker";
import { PASSIVE_AFK_MS, createPassiveEpisode, decidePassive, recordPassiveAcceptance } from "../game/passive";
import { getAiCandidates } from "../game/ai-candidates";
import { calculateShipDesignStats } from "../../src/data/ShipDesigns";
import { RESOURCE_KINDS } from "../../src/data/Economy";
import { GAME_DAYS_PER_YEAR } from "../../src/game/GameTime";

let base: GameCheckpoint;
function checkpoint(): GameCheckpoint {
  base ??= createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } }).exportCheckpoint();
  return structuredClone(base);
}
function healthyObservation() {
  const observation = structuredClone(createHeadlessGame({ checkpoint: checkpoint() }).observe(0));
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of RESOURCE_KINDS) { economy.stockpiles[resource] = 100_000; economy.monthlyDelta[resource] = 100; }
  economy.crewStockpile = 1_000_000;
  observation.snapshot.situations = [];
  for (const entry of observation.planets.planets) if (entry.planetState.ownerId === 0) entry.planetState.economy.housing = entry.planetState.population * 2;
  for (const entry of observation.planets.planets) if (!entry.planetState.isHabited) entry.colonizationEligibility = undefined;
  const home = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  home.buildingSlots[1] = "shipyard";
  return observation;
}

test("unclaimed countries start passive and stay passive beyond the future 72-hour active boundary", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint(), enablePassiveAi: true });
  game.advanceRealTime(0);
  assert.ok(game.diagnosticState().passiveEpisodes?.[0]);
  assert.ok(game.diagnosticState().passiveEpisodes?.[1]);
  assert.equal(game.diagnosticState().passiveEpisodes?.[0].source, "unclaimed");
  game.advanceRealTime(72 * 60 * 60 * 1000);
  assert.ok(game.diagnosticState().passiveEpisodes?.[0]);
  assert.deepEqual(game.exportCheckpoint().accounts.balances, {});
});

test("claimed countries follow human to caretaker at 48 hours to passive at day five and return immediately", () => {
  const saved = checkpoint();
  saved.accounts = { owners: { 0: 17 }, balances: { 17: 8 }, activities: { 0: saved.realNowMs! } };
  const game = createHeadlessGame({ checkpoint: saved, enablePassiveAi: true });
  game.advanceRealTime(CARETAKER_AFK_MS);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  assert.equal(game.diagnosticState().passiveEpisodes?.[0], undefined);
  const caretaker = game.diagnosticState().caretakerEpisodes![0];
  caretaker.queuedShips["handoff-receipt"] = { fleetId: caretaker.fleets[0].fleetId, shipKind: "corvette", designId: null };
  game.advanceRealTime(PASSIVE_AFK_MS - CARETAKER_AFK_MS - 1);
  assert.ok(game.diagnosticState().caretakerEpisodes?.[0]);
  game.advanceRealTime(1);
  assert.equal(game.diagnosticState().caretakerEpisodes?.[0], undefined);
  assert.equal(game.diagnosticState().passiveEpisodes?.[0].source, "afk");
  assert.ok(game.diagnosticState().passiveEpisodes?.[0].queuedShips["handoff-receipt"]);
  game.advanceRealTime(2 * 24 * 60 * 60 * 1000);
  assert.ok(game.diagnosticState().passiveEpisodes?.[0]);
  assert.equal(game.recordPlayerActivity(99, 0), false);
  assert.ok(game.diagnosticState().passiveEpisodes?.[0]);
  assert.equal(game.recordPlayerActivity(17, 0), true);
  assert.equal(game.diagnosticState().passiveEpisodes?.[0], undefined);
  assert.equal(game.exportCheckpoint().accounts.balances[17], 8);
});

test("claiming an unclaimed country removes passive control and retains accepted orders", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint(), enablePassiveAi: true });
  game.advanceRealTime(0);
  const saved = game.exportCheckpoint();
  saved.accounts.owners[0] = 17; saved.accounts.activities![0] = saved.realNowMs!;
  const orders = structuredClone(saved.state.planetStates.filter((planet) => planet.ownerId === 0).map((planet) => planet.constructionQueue));
  const claimed = createHeadlessGame({ checkpoint: saved });
  claimed.advanceRealTime(0);
  assert.equal(claimed.diagnosticState().passiveEpisodes?.[0], undefined);
  assert.deepEqual(claimed.diagnosticState().planetStates.filter((planet) => planet.ownerId === 0).map((planet) => planet.constructionQueue), orders);
});

test("passive policy is reproducible through checkpoints and independent interleaved games", () => {
  const game = createHeadlessGame({ checkpoint: checkpoint(), enablePassiveAi: true, stepMs: 24_000 });
  game.advanceRealTime(0);
  const resumed = createHeadlessGame({ checkpoint: game.exportCheckpoint(), stepMs: 24_000 });
  const other = createHeadlessGame({ checkpoint: checkpoint(), enablePassiveAi: true, stepMs: 24_000 });
  for (let i = 0; i < 3; i++) { game.step(); other.step(); resumed.step(); }
  assert.equal(game.digest(), resumed.digest());
  assert.equal(game.exportCheckpoint().enablePassiveAi, true);
});

test("passive preserves active research, selects new focus when it finishes, and does not redesign ships", () => {
  const observation = healthyObservation();
  const tech = observation.snapshot.technologies.find((entry) => entry.factionId === 0)!;
  const available = tech.technologies.find((entry) => entry.available && !entry.completed)!;
  tech.activeTechId = available.id;
  const episode = createPassiveEpisode(observation, null, 0, 0);
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "setActiveTechnology"), false);
  available.completed = true;
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "setActiveTechnology"), true);
  assert.equal(decidePassive(observation, episode).some(({ action }) => /Design|Retrofit|War|Treaty|Diplomacy|DarkMatter/.test(action.type)), false);
});

test("military reserve is capped by recurring production and includes queued ship upkeep", () => {
  const observation = healthyObservation();
  const planet = observation.planets.planets.find((entry) => entry.planetState.ownerId === 0 && entry.planetState.isHabited)!.planetState;
  planet.economy.production.energy = 10_000; planet.economy.production.alloys = 10_000;
  const episode = createPassiveEpisode(observation, null, 0, 0);
  const decisions = decidePassive(observation, episode);
  const build = decisions.find(({ action }) => action.type === "buildStarbaseShip" && action.shipKind === "corvette");
  assert.ok(build, `a healthy economy may build its reserve: ${JSON.stringify({ decisions, ships: getAiCandidates(observation).ships })}`);
  const design = observation.fleets.shipDesigns.find((entry) => entry.id === (build.action as { designId?: string }).designId)!;
  const cost = calculateShipDesignStats(design).upkeep;
  planet.economy.production.energy = cost.energy / 0.2;
  planet.economy.production.alloys = cost.alloys / 0.2;
  for (const base of observation.fleets.starbases) base.economy.production.energy = base.economy.production.alloys = 0;
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "buildStarbaseShip"), false);
  planet.economy.production.energy = planet.economy.production.alloys = 10_000;
  episode.queuedShips.a = { fleetId: episode.fleets[0].fleetId, shipKind: "corvette", designId: design.id };
  episode.queuedShips.b = { fleetId: episode.fleets[0].fleetId, shipKind: "corvette", designId: design.id };
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "buildStarbaseShip"), false);
});

test("mineral deficits with insufficient reserves also pause colony expansion", () => {
  const observation = healthyObservation();
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  const planet = observation.planets.planets.find((entry) => entry.planetState.ownerId === 0)!;
  planet.planetState.isHabited = false;
  planet.colonizationEligibility = { eligible: true, reason: "colonizable", foundingSpeciesHabitability: 80 };
  const ship = observation.fleets.ships.find((entry) => entry.ownerId === 0)!;
  ship.shipKind = "colonizationShip";
  const episode = createPassiveEpisode(observation, null, 0, 0);
  episode.nextShipYear = episode.nextDevelopmentYear = observation.snapshot.clock.year + 1;
  assert.ok(decidePassive(observation, episode).some(({ action }) => action.type === "colonizePlanet"));
  // Five months of minerals avoids emergency spending but is insufficient for growth.
  economy.monthlyDelta.minerals = -20_000;
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "colonizePlanet"), false);
});

test("a claim between membership polls prevents an extra passive turn and persists the handback", () => {
  const saved = checkpoint();
  const accounts = { owners: {} as Record<number, number>, balances: {}, activities: {} as Record<number, number> };
  const core = createGameCore(saved.game, createMemoryAuth(accounts), { initialState: saved.state, enablePassiveAi: true,
    now: () => saved.nowMs, realNow: () => saved.realNowMs! });
  core.processAiControllers();
  assert.ok(core.context.state.passiveEpisodes?.[0]);
  core.context.hasDirtyState = false;
  accounts.owners[0] = 17; accounts.activities[0] = saved.realNowMs!;
  const records = core.processAiControllers();
  assert.equal(records.some((record) => record.factionId === 0), false);
  assert.equal(core.context.state.passiveEpisodes?.[0], undefined);
  assert.equal(core.context.hasDirtyState, true);
});

test("famine funding reserves enough food to start another district instead of buying tiny rations", () => {
  const observation = healthyObservation();
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  economy.stockpiles.food = 0; economy.stockpiles.energy = 500; economy.monthlyDelta.food = -100;
  const planet = observation.planets.planets.find((entry) => entry.planetState.ownerId === 0 && entry.planetState.isHabited)!.planetState;
  planet.builtDistricts.agriculture = 0;
  planet.economy.populationDecline.active = true; planet.economy.populationDecline.cause = "famine";
  const episode = createPassiveEpisode(observation, null, 0, 0);
  const funding = decidePassive(observation, episode).find(({ action }) => action.type === "marketTrade" && action.resourceId === "food" && action.tradeType === "buy");
  assert.ok(funding && funding.action.type === "marketTrade");
  assert.ok(funding.action.amount >= 75);
  economy.stockpiles.energy = 100;
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "marketTrade" && action.tradeType === "buy" && action.resourceId === "food"), false);
  economy.stockpiles.energy = 300; economy.stockpiles.food = 80;
  economy.stockpiles.goods = 0; economy.monthlyDelta.goods = -100;
  assert.ok(decidePassive(observation, episode).some(({ action }) => action.type === "buildDistrict" && action.districtKind === "agriculture"));
});

test("a recovered economy can resume development while its old shortage marker recedes", () => {
  const observation = healthyObservation();
  observation.snapshot.situations = [{ id: "old-food-shortage", defId: "resourceShortage", factionId: 0, subject: "food", progress: 60,
    startedAtYear: observation.snapshot.clock.year, lastThreshold: 0 }];
  for (const entry of observation.planets.planets.filter((entry) => entry.planetState.ownerId === 0)) {
    entry.planetState.economy.populationDecline.active = false;
    entry.planetState.economy.production.energy = entry.planetState.economy.production.alloys = 10_000;
  }
  const episode = createPassiveEpisode(observation, null, 0, 0);
  assert.ok(decidePassive(observation, episode).some(({ action }) => action.type === "buildStarbaseShip"));
});

test("expansion and colony cooldowns apply only to accepted orders and persist in planner state", () => {
  const observation = healthyObservation();
  const episode = createPassiveEpisode(observation, null, 0, 0);
  const year = observation.snapshot.clock.year;
  assert.equal(episode.nextOutpostYear, year);
  recordPassiveAcceptance(episode, { type: "buildStarbase", fleetId: "construction", targetStarId: 1 }, year);
  recordPassiveAcceptance(episode, { type: "colonizePlanet", fleetId: "colonizer", planetId: "planet" }, year);
  assert.equal(episode.nextOutpostYear, year + 90 / GAME_DAYS_PER_YEAR);
  assert.equal(episode.nextColonyYear, year + 360 / GAME_DAYS_PER_YEAR);
  const clone = structuredClone(episode);
  assert.equal(clone.nextColonyYear, episode.nextColonyYear);
  observation.diplomacy.countries.find((country) => !country.isSelf)!.atWar = true;
  episode.nextOutpostYear = episode.nextColonyYear = year;
  assert.equal(decidePassive(observation, episode).some(({ action }) => action.type === "buildStarbase" || action.type === "colonizePlanet"), false);
});

test("passive observes no hidden truth, consumes no randomness on queries, and does not explore unknown systems", () => {
  const first = createHeadlessGame({ checkpoint: checkpoint() });
  const saved = first.exportCheckpoint();
  const hidden = saved.state.ships.find((ship) => ship.ownerId === 1)!;
  hidden.hull *= 0.5;
  saved.state.factionEconomies.find((economy) => economy.factionId === 1)!.stockpiles.food += 9999;
  const second = createHeadlessGame({ checkpoint: saved });
  const observation = first.observe(0);
  assert.deepEqual(second.observe(0), observation);
  const episode = createPassiveEpisode(observation, null, 0, 0);
  const before = first.digest();
  const actions = decidePassive(observation, structuredClone(episode));
  assert.deepEqual(decidePassive(second.observe(0), structuredClone(episode)), actions);
  getAiCandidates(observation);
  assert.equal(first.digest(), before);
  const known = new Set(observation.snapshot.knownStarIds ?? []);
  for (const { action } of actions) if (action.type === "moveFleet" || action.type === "buildStarbase") assert.ok(known.has(action.targetStarId));
});
