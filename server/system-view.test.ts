import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlanetStatesFromStars, generateStarMap } from "../src/data/StarMap";
import type { GalaxyPerspective } from "../src/data/Factions";
import type {
  FactionState,
  ServerCombatContact,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  SystemDetailPayload,
} from "../src/game/GameProtocol";
import {
  buildSystemDetailPayload,
  createSystemDetailRevision,
} from "./system-view";

function createStars() {
  return generateStarMap(220, 220, 18, 94031, 8, {
    innerRadiusFraction: 0.08,
    outerRadiusFraction: 0.92,
    spiralArms: 3,
    spiralTightness: 1.35,
    armSpread: 0.42,
  });
}

function createFaction(id = 1): FactionState {
  return {
    id,
    name: `Faction ${id}`,
    color: [0.4, 0.8, 1],
    homeStarId: 0,
    discoveredStarIds: [0, 1],
  };
}

function createFleet(id: string, starId: number, shipIds: string[]): ServerFleet {
  return {
    id,
    ownerId: 1,
    shipIds,
    currentStarId: starId,
    phase: "idle",
    systemPosition: { x: starId, y: 4.8, z: starId },
  } as ServerFleet;
}

function createShip(id: string, fleetId: string): ServerShip {
  return { id, ownerId: 1, fleetId, shipKind: "corvette" } as ServerShip;
}

function createStarbase(id: string, starId: number): ServerStarbase {
  return {
    id,
    ownerId: 1,
    starId,
    systemPosition: { x: 3.2, y: 4.8, z: -18 },
    status: "online",
    level: "outpost",
  } as ServerStarbase;
}

function createContact(id: string, sourceId: string, targetId: string): ServerCombatContact {
  return { id, sourceId, sourceKind: "fleet", targetId, targetKind: "starbase" } as ServerCombatContact;
}

function buildPayload(overrides: Partial<Parameters<typeof buildSystemDetailPayload>[0]> = {}) {
  const stars = createStars();
  const perspective: GalaxyPerspective = { mode: "faction", factionId: 1 };
  return buildSystemDetailPayload({
    perspective,
    starId: 0,
    stars,
    visibleStars: stars,
    knownStarIds: new Set([0, 1]),
    hyperlanes: [[0, 1], [1, 2]],
    planetStates: buildPlanetStatesFromStars(stars),
    fleets: [createFleet("fleet-a", 0, ["ship-a"]), createFleet("fleet-b", 1, ["ship-b"])],
    ships: [createShip("ship-a", "fleet-a"), createShip("ship-b", "fleet-b")],
    starbases: [createStarbase("starbase-a", 0), createStarbase("starbase-b", 1)],
    recentCombatContacts: [
      createContact("contact-a", "fleet-a", "starbase-a"),
      createContact("contact-b", "fleet-b", "starbase-b"),
    ],
    factions: [createFaction()],
    shipDesigns: [],
    technologies: [],
    starOwnership: [1, -1],
    ...overrides,
  });
}

function unwrap(result: ReturnType<typeof buildSystemDetailPayload>): SystemDetailPayload {
  assert.equal(result.ok, true, "expected a system payload");
  return result.payload;
}

test("system payload rejects inaccessible systems", () => {
  const stars = createStars();
  const result = buildPayload({
    stars,
    visibleStars: stars,
    starId: 2,
    knownStarIds: new Set([0, 1]),
  });

  assert.equal(result.ok, false);
});

test("system payload is scoped to one system", () => {
  const payload = unwrap(buildPayload());

  assert.equal(payload.star.id, 0);
  assert.deepEqual(payload.fleets.map((fleet) => fleet.id), ["fleet-a"]);
  assert.deepEqual(payload.ships.map((ship) => ship.id), ["ship-a"]);
  assert.deepEqual(payload.starbases.map((starbase) => starbase.id), ["starbase-a"]);
  assert.deepEqual(payload.recentCombatContacts.map((contact) => contact.id), ["contact-a"]);
  assert.deepEqual(payload.hyperlaneExits.map((exit) => exit.starId), [1]);
  assert.equal(payload.starOwnerId, 1);
});

test("system payload revision changes only when system data changes", () => {
  const base = unwrap(buildPayload());
  const unrelated = unwrap(buildPayload({
    fleets: [createFleet("fleet-a", 0, ["ship-a"]), createFleet("fleet-b", 1, ["ship-b", "ship-c"])],
    ships: [createShip("ship-a", "fleet-a"), createShip("ship-b", "fleet-b"), createShip("ship-c", "fleet-b")],
  }));
  const related = unwrap(buildPayload({
    fleets: [createFleet("fleet-a", 0, ["ship-a", "ship-c"]), createFleet("fleet-b", 1, ["ship-b"])],
    ships: [createShip("ship-a", "fleet-a"), createShip("ship-b", "fleet-b"), createShip("ship-c", "fleet-a")],
  }));

  assert.equal(createSystemDetailRevision(base), createSystemDetailRevision(unrelated));
  assert.notEqual(createSystemDetailRevision(base), createSystemDetailRevision(related));
});
