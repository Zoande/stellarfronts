import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { getAiCandidates } from "../game/ai-candidates";
import { refreshIntelligence, getIntelEntityView } from "../game/intelligence";
import { createDetailPayload } from "../game/detail-payloads";
import type { GameState, RuntimeContext } from "../game/types";
import { getPlanetSystemPositionAt } from "../game/system-positions";
import { getPlanetSystemOrbitRadius, getSystemOrbitLayout } from "../../src/data/SystemCoordinates";

function isolatedGame() {
  const checkpoint = createHeadlessGame({
    worldSeed: 19, simulationSeed: 71,
    initialWorld: { starCount: 12, factionCount: 2 },
    accounts: { owners: { 0: 17 }, balances: { 17: 50 } },
  }).exportCheckpoint();
  const game = createHeadlessGame({ checkpoint });
  const state = game.diagnosticState() as GameState;
  // Prepare the live fixture after normalization so capitals are not restored.
  for (const planet of state.planetStates) {
    planet.buildings.city.fill(null);
    planet.defense.defenseSlots.fill(null);
    planet.defense.shipyardSlots.fill(null);
  }
  for (const starbase of state.starbases) starbase.status = "building";
  for (const design of state.shipDesigns) design.utilityModuleIds = [];
  state.intelligenceByFaction = {};
  state.startingIntelligenceSeeded = true;
  refreshIntelligence(state);
  return game;
}

test("owned assets stay current without sensors while foreign assets remain hidden", () => {
  const game = isolatedGame();
  const state = game.exportCheckpoint().state;
  refreshIntelligence(state);
  const ctx = { state } as RuntimeContext;
  const perspective = { mode: "faction", factionId: 0 } as const;
  for (const [kind, assets, field] of [
    ["planet", state.planetStates, "economy"],
    ["starbase", state.starbases, "status"],
    ["fleet", state.fleets, "telemetry"],
    ["ship", state.ships, "telemetry"],
  ] as const) {
    const owned = assets.filter((asset) => asset.ownerId === 0);
    assert.ok(owned.length > 0);
    for (const asset of owned) {
      const view = getIntelEntityView(state, 0, kind, asset.id)!;
      assert.equal(view.fields.existence.status, "current");
      assert.equal(view.fields[field].status, "current");
      if (kind !== "ship") {
        const detail = createDetailPayload(ctx, perspective, kind, asset.id);
        assert.ok("payload" in detail, `${kind} detail is accessible`);
      }
    }
    const foreign = assets.find((asset) => asset.ownerId === 1);
    assert.ok(foreign);
    assert.deepEqual(getIntelEntityView(state, 0, kind, foreign.id)?.fields ?? {}, {});
  }
});

test("human and AI can manage isolated planets, starbases, and fleets with the same ownership checks", () => {
  for (const actorKind of ["human", "ai"] as const) {
    const game = isolatedGame();
    const observation = game.observe(0);
    const actor = actorKind === "human" ? game.createHumanActor(17, 0) : game.createAiActor(0);
    const candidates = getAiCandidates(observation);
    const district = candidates.economy.find((action) => action.type === "buildDistrict");
    assert.ok(district, "AI includes isolated planet construction");
    assert.equal(game.act(actor, district).ok, true);
    const fleet = observation.fleets.fleets.find((entry) => entry.ownerId === 0 && !entry.stationaryStarbaseId)!;
    const move = { type: "moveFleet", fleetId: fleet.id, targetStarId: fleet.currentStarId, targetSystemPosition: { x: 25, y: 0, z: 25 } };
    assert.equal(game.act(actor, move).ok, true);
    assert.equal(game.act(actor, { type: "stopFleet", fleetId: fleet.id }).ok, true);
    assert.equal(game.act(actor, { type: "setFleetCombatSettings", fleetId: fleet.id, combatSettings: { behavior: "line" } }).ok, true);
    const starbase = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
    const upgrade = game.act(actor, { type: "upgradeStarbase", starbaseId: starbase.id });
    assert.equal(upgrade.ok, false);
    assert.match(upgrade.message!, /online/);
    const enemy = game.exportCheckpoint().state.fleets.find((entry) => entry.ownerId === 1)!;
    assert.equal(game.act(actor, { type: "stopFleet", fleetId: enemy.id }).ok, false);
  }
});

test("isolated fleet movement survives simulation ticks and replacement orders work in transit", () => {
  const game = isolatedGame();
  const actor = game.createHumanActor(17, 0);
  const fleet = game.observe(0).fleets.fleets.find((entry) => entry.ownerId === 0 && !entry.stationaryStarbaseId)!;
  assert.equal(game.act(actor, { type: "moveFleet", fleetId: fleet.id, targetStarId: fleet.currentStarId, targetSystemPosition: { x: 1000, y: 0, z: 1000 } }).ok, true);
  game.step(1000);
  const moving = game.exportCheckpoint().state.fleets.find((entry) => entry.id === fleet.id)!;
  assert.equal(moving.orderType, "move");
  assert.ok(moving.movementPlan);

  const checkpoint = game.exportCheckpoint();
  const inTransit = checkpoint.state.fleets.find((entry) => entry.id === fleet.id)!;
  inTransit.hyperlanePosition = { fromStarId: fleet.currentStarId, toStarId: (fleet.currentStarId + 1) % checkpoint.state.stars.length, progress: 0.5 };
  inTransit.phase = "jumpingHyperlane";
  const transit = createHeadlessGame({ checkpoint });
  const liveFleet = transit.diagnosticState().fleets.find((entry) => entry.id === fleet.id)!;
  liveFleet.hyperlanePosition = inTransit.hyperlanePosition;
  liveFleet.phase = "jumpingHyperlane";
  refreshIntelligence(transit.diagnosticState());
  const observation = transit.observe(0);
  const reported = observation.fleets.fleets.find((entry) => entry.id === fleet.id)!;
  assert.ok(reported.hyperlanePosition);
  assert.equal(reported.shipIds.length, fleet.shipIds.length);
  const result = transit.act(transit.createHumanActor(17, 0), { type: "moveFleet", fleetId: fleet.id, targetStarId: fleet.currentStarId, targetSystemPosition: { x: 10, y: 0, z: 10 } });
  assert.equal(result.ok, true, result.message);
});

test("sensorless ships reveal only close contacts, which become stale after moving away", () => {
  const game = isolatedGame();
  const state = game.diagnosticState();
  const fleet = state.fleets.find((entry) => entry.ownerId === 0 && !entry.stationaryStarbaseId)!;
  const enemy = state.fleets.find((entry) => entry.ownerId === 1 && !entry.stationaryStarbaseId)!;
  const star = state.stars.find((entry) => state.starOwnership[entry.id] < 0 && entry.system.planets.length > 1)!;
  const planet = state.planetStates.find((entry) => entry.starId === star.id && entry.planetIndex === 1)!;
  fleet.currentStarId = star.id;
  fleet.systemPosition = { x: 1000, y: 4.8, z: 1000 };
  enemy.currentStarId = star.id;
  enemy.systemPosition = { x: -1000, y: 4.8, z: -1000 };
  refreshIntelligence(state);
  assert.equal(getIntelEntityView(state, 0, "star", star.id)?.fields.type, undefined);

  assert.equal(getIntelEntityView(state, 0, "planet", planet.id)?.fields.type, undefined);
  assert.equal(getIntelEntityView(state, 0, "fleet", enemy.id)?.fields.existence, undefined);
  const system = createDetailPayload({ state } as RuntimeContext, { mode: "faction", factionId: 0 }, "system", star.id);
  assert.ok("payload" in system, "own fleet allows opening its unknown system for commands");
  if ("payload" in system) {
    const detail = system.payload as import("../../src/game/GameProtocol").SystemDetailPayload;
    assert.equal(detail.star.name, "Unknown Signal");
    assert.equal(detail.planetStates.length, 0);
    assert.ok(detail.fleets.some((entry) => entry.id === fleet.id));
  }

  const position = getPlanetSystemPositionAt(star, star.system.planets[planet.planetIndex], planet.planetIndex, state.clock.year);
  fleet.systemPosition = { x: position.x + 3.4, y: 4.8, z: position.z };
  enemy.systemPosition = { x: position.x + 5, y: 4.8, z: position.z };
  refreshIntelligence(state);
  const contact = getIntelEntityView(state, 0, "planet", planet.id)!;
  assert.equal(contact.fields.type.status, "current");
  assert.equal(contact.fields.name.status, "current");
  assert.equal(contact.fields.economy, undefined);
  assert.equal(getIntelEntityView(state, 0, "fleet", enemy.id)!.fields.existence.status, "current");
  assert.equal(getIntelEntityView(state, 0, "ship", enemy.shipIds[0])!.fields.telemetry.status, "current");
  assert.equal(getIntelEntityView(state, 0, "star", star.id)?.fields.type, undefined);

  const nearby = createDetailPayload({ state } as RuntimeContext, { mode: "faction", factionId: 0 }, "system", star.id);
  assert.ok("payload" in nearby);
  if ("payload" in nearby) {
    const detail = nearby.payload as import("../../src/game/GameProtocol").SystemDetailPayload;
    const projectedIndex = detail.star.system.planets.findIndex((entry) => entry.id === planet.id);
    assert.ok(projectedIndex >= 0);
    const expectedRadius = getPlanetSystemOrbitRadius(star.system.planets[planet.planetIndex], planet.planetIndex, getSystemOrbitLayout(star.type));
    assert.equal(getPlanetSystemOrbitRadius(detail.star.system.planets[projectedIndex], projectedIndex, getSystemOrbitLayout(detail.star.type)), expectedRadius);
  }

  fleet.systemPosition = { x: 1000, y: 4.8, z: 1000 };
  state.clock.year += 0.01;
  refreshIntelligence(state);
  assert.equal(getIntelEntityView(state, 0, "planet", planet.id)!.fields.type.status, "stale");
  assert.equal(getIntelEntityView(state, 0, "fleet", enemy.id)!.fields.existence.status, "stale");
  assert.equal(getIntelEntityView(state, 0, "ship", enemy.shipIds[0])!.fields.telemetry.status, "stale");
  const result = game.act(game.createHumanActor(17, 0), { type: "moveFleet", fleetId: fleet.id, targetStarId: star.id, targetSystemPosition: { x: 900, y: 4.8, z: 900 } });
  assert.equal(result.ok, true, result.message);
});
