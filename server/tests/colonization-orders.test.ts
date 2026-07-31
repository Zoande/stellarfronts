import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPlanetStatesToStars,
  PlanetType,
} from "../../src/data/StarMap";
import { GAME_START_YEAR } from "../../src/game/GameTime";
import type { PlanetManagerDetailPayload } from "../../src/game/GameProtocol";
import { createDetailPayload } from "../game/detail-payloads";
import {
  advanceFleet,
  prepareFleetForReplacementOrder,
  startColonizationOrder,
} from "../game/fleet-combat";
import { createFleet, createShipFromDesign } from "../game/fleet-factory";
import { createInitialState } from "../game/state-bootstrap";
import { resolveShipDesign } from "../game/ship-designs";
import type { GameFleet, RuntimeContext } from "../game/types";

function createTestContext(): RuntimeContext {
  let runtimeId = 0;
  const detailRefreshes = new Set<string>();
  const ctx = {
    game: { id: "colonization-test", seed: 90210 },
    state: undefined,
    hasDirtyState: false,
    pendingPlanetDetailRefreshes: detailRefreshes,
    createRuntimeId: (prefix: string) => `${prefix}-test-${runtimeId += 1}`,
    setFleetPhase: (fleet: GameFleet, phase: GameFleet["phase"]) => {
      fleet.phase = phase;
      fleet.phaseProgress = 0;
      fleet.phaseElapsedMs = 0;
      fleet.phaseStartedAtYear = ctx.state?.clock.year ?? GAME_START_YEAR;
    },
    queuePlanetDetailRefresh: (planetId: string) => detailRefreshes.add(planetId),
    refreshFactionEconomyDeltas: () => undefined,
  } as unknown as RuntimeContext;
  ctx.state = createInitialState(ctx);
  return ctx;
}

test("colonization orders travel, found authoritatively, cancel, and fail safely", () => {
  const ctx = createTestContext();
  const faction = ctx.state.factions[0];
  const star = ctx.state.stars[faction.homeStarId];
  const targetIndex = star.system.planets.findIndex((planet, index) => {
    const state = ctx.state.planetStates.find((candidate) => (
      candidate.starId === star.id && candidate.planetIndex === index
    ));
    return state?.isHabited === false;
  });
  assert.ok(targetIndex >= 0, "home system should contain an uninhabited colony target");
  const targetPlanet = star.system.planets[targetIndex];
  const targetStateIndex = ctx.state.planetStates.findIndex((candidate) => candidate.id === targetPlanet.id);
  assert.ok(targetStateIndex >= 0);
  const originalState = structuredClone(ctx.state.planetStates[targetStateIndex]);
  targetPlanet.type = PlanetType.Grassland;
  targetPlanet.isHabited = false;
  ctx.state.planetStates[targetStateIndex] = {
    ...originalState,
    ownerId: null,
    isHabited: false,
    habitability: 80,
    population: 0,
    speciesPopulations: [],
    features: [],
    builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
    modifiers: [],
    jobLocks: [],
  };
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);

  const managerDetail = createDetailPayload(ctx, { mode: "faction", factionId: faction.id }, "planetManager", null);
  assert.ok("payload" in managerDetail);
  const managerPlanets = (managerDetail as { payload: PlanetManagerDetailPayload }).payload.planets;
  const targetEntry = managerPlanets.find((entry) => entry.planetState.id === targetPlanet.id);
  assert.ok(targetEntry, "Planet Operations should include uninhabited planets in an owned system");
  assert.equal(targetEntry?.systemOwnerId, faction.id);
  assert.equal(targetEntry?.foundingSpeciesId, faction.foundingSpeciesId);
  assert.equal(targetEntry?.foundingSpeciesHabitability, 90);
  assert.equal(targetEntry?.colonizationEligibility?.eligible, true);

  const design = resolveShipDesign(ctx.state.shipDesigns, faction.id, "colonizationShip");
  const makeFleet = (suffix: string): { fleet: GameFleet; shipId: string } => {
    const fleetId = `colonization-fleet-${suffix}`;
    const ship = createShipFromDesign(ctx, faction.id, fleetId, design, `colonization-ship-${suffix}`);
    const fleet = createFleet(ctx, faction.id, star.id, [ship.id], fleetId);
    fleet.speed = ship.speed;
    fleet.systemPosition = { x: 500, y: 0, z: 500 };
    ctx.state.ships.push(ship);
    ctx.state.fleets.push(fleet);
    return { fleet, shipId: ship.id };
  };
  const resetTarget = () => {
    ctx.state.planetStates[targetStateIndex] = {
      ...ctx.state.planetStates[targetStateIndex],
      ownerId: null,
      isHabited: false,
      habitability: 80,
      population: 0,
      speciesPopulations: [],
      features: [],
      builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
      modifiers: [],
      jobLocks: [],
    };
    targetPlanet.isHabited = false;
    targetPlanet.objectDetails.builtDistricts = { city: 0, generator: 0, mining: 0, agriculture: 0 };
    ctx.state.starOwnership[star.id] = faction.id;
  };
  const arrive = (fleet: GameFleet) => {
    assert.ok(fleet.movementPlan);
    ctx.state.clock.year = fleet.movementPlan!.endsAtYear;
    assert.equal(advanceFleet(ctx, fleet, 0), true);
  };

  const immediate = makeFleet("immediate");
  startColonizationOrder(ctx, immediate.fleet, targetPlanet.id);
  const exactOrbitPosition = structuredClone(immediate.fleet.movementPlan!.destinationPosition!);
  prepareFleetForReplacementOrder(ctx, immediate.fleet);
  immediate.fleet.systemPosition = exactOrbitPosition;
  startColonizationOrder(ctx, immediate.fleet, targetPlanet.id);
  assert.equal(ctx.state.planetStates[targetStateIndex].isHabited, true);
  assert.equal(ctx.state.ships.some((ship) => ship.id === immediate.shipId), false);

  resetTarget();
  const routed = makeFleet("routed");
  startColonizationOrder(ctx, routed.fleet, targetPlanet.id);
  assert.equal(routed.fleet.orderType, "colonize");
  assert.equal(routed.fleet.movementPlan?.destinationPlanetId, targetPlanet.id);
  arrive(routed.fleet);
  const founded = ctx.state.planetStates[targetStateIndex];
  assert.equal(founded.isHabited, true);
  assert.equal(founded.ownerId, faction.id);
  assert.deepEqual(founded.builtDistricts, { city: 0, generator: 0, mining: 0, agriculture: 0 });
  assert.equal(founded.modifiers.filter((modifier) => modifier.source === "colony:frontierSettlement").length, 5);
  assert.equal(ctx.state.ships.some((ship) => ship.id === routed.shipId), false);

  resetTarget();
  const cancelled = makeFleet("cancelled");
  startColonizationOrder(ctx, cancelled.fleet, targetPlanet.id);
  prepareFleetForReplacementOrder(ctx, cancelled.fleet);
  assert.equal(cancelled.fleet.orderType, null);
  assert.equal(cancelled.fleet.movementPlan, null);
  assert.equal(ctx.state.ships.some((ship) => ship.id === cancelled.shipId), true);

  resetTarget();
  const shipLost = makeFleet("lost");
  startColonizationOrder(ctx, shipLost.fleet, targetPlanet.id);
  ctx.state.ships = ctx.state.ships.filter((ship) => ship.id !== shipLost.shipId);
  arrive(shipLost.fleet);
  assert.equal(ctx.state.planetStates[targetStateIndex].isHabited, false);
  assert.equal(shipLost.fleet.orderType, null);
  assert.equal(shipLost.fleet.phase, "orbitingPlanet");

  resetTarget();
  const ownershipChanged = makeFleet("ownership");
  startColonizationOrder(ctx, ownershipChanged.fleet, targetPlanet.id);
  ctx.state.starOwnership[star.id] = faction.id + 1;
  arrive(ownershipChanged.fleet);
  assert.equal(ctx.state.planetStates[targetStateIndex].isHabited, false);
  assert.equal(ctx.state.ships.some((ship) => ship.id === ownershipChanged.shipId), true);

  resetTarget();
  const first = makeFleet("race-first");
  const second = makeFleet("race-second");
  startColonizationOrder(ctx, first.fleet, targetPlanet.id);
  startColonizationOrder(ctx, second.fleet, targetPlanet.id);
  ctx.state.clock.year = Math.max(first.fleet.movementPlan!.endsAtYear, second.fleet.movementPlan!.endsAtYear);
  assert.equal(advanceFleet(ctx, first.fleet, 0), true);
  assert.equal(advanceFleet(ctx, second.fleet, 0), true);
  assert.equal(ctx.state.planetStates[targetStateIndex].isHabited, true);
  assert.equal(ctx.state.ships.some((ship) => ship.id === first.shipId), false);
  assert.equal(ctx.state.ships.some((ship) => ship.id === second.shipId), true);
});
