import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanetStatesFromStars, generateStarMap } from "../../src/data/StarMap";
import {
  DEFAULT_ORBIT_EPOCH_MS,
  getPlanetSystemPosition,
  getSystemOrbitLayout,
  SYSTEM_FLEET_Y,
} from "../../src/data/SystemCoordinates";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_DAY } from "../../src/game/GameTime";
import type { ServerFleet, ServerShip, SystemDetailPayload } from "../../src/game/GameProtocol";
import { SystemViewStore } from "../../src/scenes/system/SystemViewStore";

function createStars() {
  return generateStarMap(220, 220, 18, 12015, 8, {
    innerRadiusFraction: 0.08,
    outerRadiusFraction: 0.92,
    spiralArms: 3,
    spiralTightness: 1.35,
    armSpread: 0.42,
  });
}

function createFleet(id: string, overrides: Partial<ServerFleet> = {}): ServerFleet {
  return {
    id,
    ownerId: 1,
    shipIds: [],
    currentStarId: 0,
    phase: "idle",
    systemPosition: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
    ...overrides,
  } as ServerFleet;
}

function createPayload(fleets: ServerFleet[]): SystemDetailPayload {
  const stars = createStars();
  return {
    star: stars[0],
    planetStates: buildPlanetStatesFromStars(stars).filter((planetState) => planetState.starId === 0),
    fleets,
    ships: fleets.flatMap((fleet) => fleet.shipIds.map((shipId) => ({
      id: shipId,
      ownerId: fleet.ownerId,
      fleetId: fleet.id,
      shipKind: "corvette",
    } as ServerShip))),
    starbases: [],
    recentCombatContacts: [],
    hyperlaneExits: [],
    factions: [],
    shipDesigns: [],
    technology: null,
    starOwnerId: null,
  };
}

test("SystemViewStore interpolates fleet movement segments", () => {
  const fleet = createFleet("fleet-a", {
    movementPlan: {
      destinationStarId: 0,
      startedAtYear: 2100,
      endsAtYear: 2101,
      totalDays: GAME_DAYS_PER_YEAR,
      segments: [{
        kind: "system",
        fromStarId: 0,
        toStarId: 0,
        startYear: 2100,
        endYear: 2101,
        from: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
        to: { x: 10, y: SYSTEM_FLEET_Y, z: 20 },
      }],
    },
  });
  const store = new SystemViewStore(createPayload([fleet]), 2100.5);

  assert.deepEqual(store.getFleetSystemPosition(fleet), { x: 5, y: SYSTEM_FLEET_Y, z: 10 });
});

test("SystemViewStore lets active movement override destination orbit targets", () => {
  const fleet = createFleet("fleet-a", {
    orbitTarget: {
      kind: "starbase",
      starId: 0,
      starbaseId: "starbase-a",
      position: { x: 80, y: SYSTEM_FLEET_Y, z: 80 },
    },
    movementPlan: {
      destinationStarId: 0,
      destinationOrbitTarget: {
        kind: "starbase",
        starId: 0,
        starbaseId: "starbase-a",
        position: { x: 80, y: SYSTEM_FLEET_Y, z: 80 },
      },
      startedAtYear: 2100,
      endsAtYear: 2101,
      totalDays: GAME_DAYS_PER_YEAR,
      segments: [{
        kind: "system",
        fromStarId: 0,
        toStarId: 0,
        startYear: 2100,
        endYear: 2101,
        from: { x: 0, y: SYSTEM_FLEET_Y, z: 0 },
        to: { x: 10, y: SYSTEM_FLEET_Y, z: 20 },
      }],
    },
  });
  const store = new SystemViewStore(createPayload([fleet]), 2100.5);

  assert.deepEqual(store.getFleetSystemPosition(fleet), { x: 5, y: SYSTEM_FLEET_Y, z: 10 });
});

test("SystemViewStore resolves planet orbit positions", () => {
  const payload = createPayload([]);
  const planet = payload.star.system.planets[0];
  assert.ok(planet, "test system should contain a planet");
  const fleet = createFleet("fleet-a", {
    orbitTargetPlanetId: planet.id,
    orbitOffset: { x: 1, y: SYSTEM_FLEET_Y, z: 2 },
  });
  payload.fleets = [fleet];
  const year = 2102.25;
  const store = new SystemViewStore(payload, year);
  const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
  const planetPosition = getPlanetSystemPosition(planet, 0, nowMs, getSystemOrbitLayout(payload.star.type));

  assert.deepEqual(store.getFleetSystemPosition(fleet), {
    x: planetPosition.x + 1,
    y: SYSTEM_FLEET_Y,
    z: planetPosition.z + 2,
  });
});

test("SystemViewStore prunes deleted selected fleets", () => {
  const fleetA = createFleet("fleet-a");
  const fleetB = createFleet("fleet-b");
  const store = new SystemViewStore(createPayload([fleetA, fleetB]));
  store.setSelectedFleetIds(["fleet-a", "fleet-b"]);
  store.applyPayload(createPayload([fleetB]));

  assert.deepEqual(store.getSelectedFleetIds(), ["fleet-b"]);
});
