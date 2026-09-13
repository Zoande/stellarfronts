import test from "node:test";
import assert from "node:assert/strict";
import { createPlanetStateFromConfig, PlanetType, StarType } from "../../src/data/StarMap";
import type { PlanetConfig, StarData } from "../../src/data/StarMap";
import { createInitialDiplomacyState } from "../../src/data/Diplomacy";
import { createInitialMarketState } from "../../src/data/Market";
import { calculateStarbaseEconomy, createEmptyStarbaseSlots } from "../../src/data/Starbase";
import { SENSOR_SUITE_DEFINITIONS } from "../../src/data/Intelligence";
import type { GameState } from "../game/types";
import {
  getGalaxyIntelligenceView,
  getIntelEntityView,
  getKnownLanePairs,
  grantOneShotIntelReport,
  hasCommandLink,
  refreshIntelligence,
} from "../game/intelligence";
import { createSnapshot, createUpdate } from "../game/snapshot";
import { createDetailPayload, createSystemDetailPayload } from "../game/detail-payloads";
import type { RuntimeContext } from "../game/types";

function planet(id: string, name: string, orbitRadius = 10): PlanetConfig {
  return {
    id,
    name,
    type: PlanetType.Grassland,
    textureVariation: 0,
    diameter: 1.5,
    orbitRadius,
    orbitSpeed: 0.2,
    orbitPhaseAtEpoch: 0,
    orbitEpochMs: 0,
    isHabited: true,
    objectDetails: {
      size: 15,
      typeName: "Grassland",
      description: "Test world",
      habitability: 100,
      districtLimits: { city: 4, generator: 4, mining: 4, agriculture: 4 },
      builtDistricts: { city: 1, generator: 0, mining: 0, agriculture: 0 },
    },
  };
}

function star(id: number, name: string, planets: PlanetConfig[] = []): StarData {
  return {
    id, name, type: StarType.G, x: id * 20, z: 0, luminosity: 1,
    color: [1, 0.9, 0.7], galaxyPulseAmplitude: 0.01, galaxyPulseFrequency: 0.5,
    objectDetails: {
      size: 5, typeName: "G", description: "Test star", habitability: null,
      districtLimits: { city: 0, generator: 0, mining: 0, agriculture: 0 },
      builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
    },
    system: { planets },
  };
}

function stateFixture(): GameState {
  const home = planet("p0", "Home");
  const target = planet("p1", "Target");
  const stars = [star(0, "Sol", [home]), star(1, "Beta", [target]), star(2, "Gamma")];
  const homeState = createPlanetStateFromConfig(0, 0, home, { ownerId: 0 });
  homeState.buildings.city[0] = "planetaryCapital";
  const targetState = createPlanetStateFromConfig(1, 0, target, { ownerId: null });
  return {
    schemaVersion: 30,
    stars,
    nebulae: [],
    planetStates: [homeState, targetState],
    factionEconomies: [], factionTechnologies: [], governments: [], species: [], speciesRights: [],
    diplomacy: createInitialDiplomacyState([0]),
    market: createInitialMarketState([0], 0, 2100),
    leaders: [], situations: [], events: [], factionModifiers: [],
    hyperlanes: [[0, 1], [1, 2]], adjacency: [[1], [0, 2], [1]],
    factions: [{ id: 0, name: "Player", color: [0.2, 0.7, 1], homeStarId: 0 }],
    starOwnership: [0, -1, -1], starbases: [], shipDesigns: [], armies: [], groundBattles: [], ships: [], fleets: [], recentCombatContacts: [], combatProjectiles: [], combatReports: [],
    intelligenceByFaction: {}, startingIntelligenceSeeded: false,
    clock: {
      year: 2100, tickSizeDays: 1, tickSpeedSeconds: 1, paused: false, speedMultiplier: 1,
      syncedAtMs: 0, lastUpdatedAt: 0, lastProcessedPopulationWeek: 0, lastProcessedPopulationMonth: 0, lastProcessedLeaderDay: 0,
    },
  };
}

test("field intelligence transitions unknown/current/stale/refreshed independently", () => {
  const state = stateFixture();
  refreshIntelligence(state);
  const current = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(current.fields.name.status, "current");
  assert.equal(current.fields.population.status, "current");

  state.planetStates[0].buildings.city[0] = null;
  state.clock.year = 2100.25;
  refreshIntelligence(state);
  const stale = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(stale.fields.name.status, "stale");
  assert.equal(stale.fields.name.observedAtYear, 2100);

  state.planetStates[0].buildings.city[0] = "planetaryCapital";
  state.clock.year = 2100.5;
  refreshIntelligence(state);
  const refreshed = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(refreshed.fields.name.status, "current");
  assert.equal(refreshed.fields.name.observedAtYear, 2100.5);
});

test("capital coverage reveals only lanes wholly inside one covered network", () => {
  const state = stateFixture();
  refreshIntelligence(state);
  assert.deepEqual(getKnownLanePairs(state, 0), [[0, 1]]);
  assert.equal(hasCommandLink(state, 0, 0), true);
  assert.equal(hasCommandLink(state, 0, 1), true);
  assert.equal(hasCommandLink(state, 0, 2), false);
});

test("galaxy intelligence remains sparse and does not enumerate unknown truth fields", () => {
  const state = stateFixture();
  state.planetStates[0].buildings.city[0] = null;
  refreshIntelligence(state);
  const view = getGalaxyIntelligenceView(state, { mode: "faction", factionId: 0 });
  const target = view.entities.find((entity) => entity.kind === "planet" && entity.id === "p1");
  assert.equal(target, undefined);
});

test("one-shot intelligence can reveal only a planet population field", () => {
  const state = stateFixture();
  state.planetStates[0].buildings.city[0] = null;
  refreshIntelligence(state);
  assert.equal(grantOneShotIntelReport(state, 0, "planet", "p1", ["population"]), true);

  const view = getIntelEntityView(state, 0, "planet", "p1")!;
  const population = view.fields.population;
  assert.notEqual(population.status, "unknown");
  assert.equal(population.status === "unknown" ? null : population.value, state.planetStates[1].population);
  assert.equal(view.fields.name, undefined);
  assert.equal(view.fields.ownerId, undefined);
  assert.equal(view.fields.economy, undefined);
  assert.deepEqual(Object.keys(view.fields), ["population"]);
});

test("system tooltip facts remain independently revealable intelligence fields", () => {
  const state = stateFixture();
  state.planetStates[0].buildings.city[0] = null;
  refreshIntelligence(state);

  assert.equal(grantOneShotIntelReport(state, 0, "star", 2, ["type"]), true);
  assert.equal(grantOneShotIntelReport(state, 0, "system", 2, ["planetCount"]), true);

  const starView = getIntelEntityView(state, 0, "star", 2)!;
  assert.deepEqual(Object.keys(starView.fields), ["type"]);
  assert.equal(starView.fields.name, undefined);

  const systemView = getIntelEntityView(state, 0, "system", 2)!;
  assert.deepEqual(Object.keys(systemView.fields), ["planetCount"]);
  assert.equal(systemView.fields.ownerId, undefined);
  assert.equal(systemView.fields.planetCount.status, "stale");
  assert.equal(systemView.fields.planetCount.value, 0);
});

test("sensor suite table preserves the agreed ranges and tactical planet exclusions", () => {
  assert.equal(SENSOR_SUITE_DEFINITIONS.planetaryCapitalSensors.maxRange, 1);
  assert.equal(SENSOR_SUITE_DEFINITIONS.listeningStationSensors.maxRange, 3);
  assert.equal(SENSOR_SUITE_DEFINITIONS.surveyArraySensors.maxRange, 2);
  assert.equal(SENSOR_SUITE_DEFINITIONS.tacticalArraySensors.maxRange, 2);
  assert.equal(SENSOR_SUITE_DEFINITIONS.tacticalArraySensors.bands[0].bundles.includes("planetCivilian"), false);
  assert.equal(SENSOR_SUITE_DEFINITIONS.tacticalArraySensors.bands[0].bundles.includes("fleetTelemetry"), true);
  assert.equal(SENSOR_SUITE_DEFINITIONS.starbaseSensors.maxRange, 1);
  assert.equal(SENSOR_SUITE_DEFINITIONS.starbaseSensors.bands[0].bundles.includes("planetCivilian"), false);
  assert.equal(SENSOR_SUITE_DEFINITIONS.militaryShipSensors.maxRange, 3);
  assert.equal(SENSOR_SUITE_DEFINITIONS.militaryShipSensors.bands[3].fleetDetection, "militaryOnly");
  assert.deepEqual(SENSOR_SUITE_DEFINITIONS.scienceShipSensors.bands[3].fieldsByKind?.star, ["existence", "type"]);
  assert.deepEqual(SENSOR_SUITE_DEFINITIONS.scienceShipSensors.bands[3].bundles, []);
  assert.deepEqual(SENSOR_SUITE_DEFINITIONS.civilianShipSensors.bands[1].fieldsByKind?.fleet, ["existence", "currentStarId", "hyperlanePosition"]);
  assert.equal(SENSOR_SUITE_DEFINITIONS.civilianShipSensors.bands[1].fieldsByKind?.fleet?.includes("shipCount"), false);
});

test("rival starting intelligence contains identity but no economy or defenses", () => {
  const state = stateFixture();
  const hiddenPlanet = planet("p2", "Classified World", 18);
  hiddenPlanet.isHabited = false;
  state.stars[1].system.planets.push(hiddenPlanet);
  state.planetStates.push(createPlanetStateFromConfig(1, 1, hiddenPlanet, { ownerId: null }));
  state.factions.push({ id: 1, name: "Rival", color: [1, 0.3, 0.2], homeStarId: 1 });
  state.planetStates[1].ownerId = 1;
  state.planetStates[0].buildings.city[0] = null;
  state.diplomacy = createInitialDiplomacyState([0, 1]);
  state.market = createInitialMarketState([0, 1], 0, 2100);
  state.starOwnership[1] = 1;
  state.starbases.push({
    id: "rival-capital-base", ownerId: 1, starId: 1,
    systemPosition: { x: 0, y: 0, z: 0 }, status: "online", buildProgress: 1,
    shield: 100, maxShield: 100, armor: 100, maxArmor: 100, hull: 100, maxHull: 100,
    level: "starbase", economy: calculateStarbaseEconomy("starbase"),
    buildingSlots: createEmptyStarbaseSlots(), constructionQueue: [], shipQueue: [],
  });
  refreshIntelligence(state);
  const capital = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(capital.fields.name.status, "stale");
  assert.equal(capital.fields.type.status, "stale");
  assert.equal(capital.fields.ownerId.status, "stale");
  assert.equal(capital.fields.population, undefined);
  assert.equal(capital.fields.economy, undefined);
  assert.equal(capital.fields["defenses.soldiers"], undefined);
  const capitalSystem = getIntelEntityView(state, 0, "system", 1)!;
  assert.equal(capitalSystem.fields.ownerId.status, "stale");
  assert.equal(capitalSystem.fields.ownerId.value, 1);
  const capitalStarbase = getIntelEntityView(state, 0, "starbase", "rival-capital-base")!;
  assert.equal(capitalStarbase.fields.existence.status, "stale");
  const starbaseOwner = capitalStarbase.fields.ownerId;
  assert.ok(starbaseOwner.status !== "unknown");
  assert.equal(starbaseOwner.value, 1);
  assert.equal(capitalStarbase.fields.status, undefined);
  assert.equal(capitalStarbase.fields.shield, undefined);
  const snapshot = createSnapshot({ state } as RuntimeContext, { mode: "faction", factionId: 0 });
  assert.ok(snapshot.starOwnership.some(([starId, ownerId]) => starId === 1 && ownerId === 1));
  assert.ok(snapshot.starbases.some((starbase) => starbase.id === "rival-capital-base"));
  const reportedSystem = createSystemDetailPayload(
    { state } as RuntimeContext,
    { mode: "faction", factionId: 0 },
    1,
  );
  assert.ok(!("error" in reportedSystem), "reported rival systems should be openable");
  if (!("error" in reportedSystem)) {
    const greyPlanet = reportedSystem.payload.star.system.planets.find((candidate) => candidate.id === "p2");
    assert.equal(greyPlanet?.name, "????");
    assert.equal(greyPlanet?.type, PlanetType.Barren);
  }
  assert.deepEqual(getKnownLanePairs(state, 0), [[1, 0], [1, 2]]);
});

test("detail requests without entity intelligence return unavailable immediately", () => {
  const state = stateFixture();
  state.planetStates[0].buildings.city[0] = null;
  refreshIntelligence(state);
  const result = createDetailPayload(
    { state } as RuntimeContext,
    { mode: "faction", factionId: 0 },
    "planet",
    "p1",
  );
  assert.deepEqual(result, { error: "Planet is not available." });
});

test("trade privilege civilian fields freeze stale when the article is cancelled", () => {
  const state = stateFixture();
  state.factions.push({ id: 1, name: "Rival", color: [1, 0.3, 0.2], homeStarId: 1 });
  state.planetStates[1].ownerId = 1;
  state.planetStates[0].buildings.city[0] = null;
  state.diplomacy = createInitialDiplomacyState([0, 1]);
  state.diplomacy.treaties.push({
    id: "trade-1", factionIds: [0, 1], articleIds: ["tradePrivilege"],
    proposedByFactionId: 0, acceptedByFactionId: 1, startedAtYear: 2100, minimumEndYear: 2101,
  });
  state.market = createInitialMarketState([0, 1], 0, 2100);
  refreshIntelligence(state);
  const shared = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(shared.fields.economy.status, "current");
  assert.equal(shared.fields["defenses.soldiers"], undefined);

  state.clock.year = 2100.4;
  state.diplomacy.treaties[0].cancelledAtYear = state.clock.year;
  refreshIntelligence(state);
  const frozen = getIntelEntityView(state, 0, "planet", "p1")!;
  assert.equal(frozen.fields.economy.status, "stale");
  assert.equal(frozen.fields.economy.observedAtYear, 2100);
});

test("faction snapshot serialization does not bypass the intelligence materializer", () => {
  const state = stateFixture();
  state.factions.push({ id: 1, name: "Rival", color: [1, 0.3, 0.2], homeStarId: 1 });
  state.planetStates[1].ownerId = 1;
  state.planetStates[1].population = 987_654_321;
  state.planetStates[0].buildings.city[0] = null;
  state.diplomacy = createInitialDiplomacyState([0, 1]);
  state.market = createInitialMarketState([0, 1], 0, 2100);
  refreshIntelligence(state);
  const snapshot = createSnapshot({ state } as RuntimeContext, { mode: "faction", factionId: 0 });
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("987654321"), false);
  assert.equal(snapshot.planetStates.length, 0);
});

test("clock-only updates retain cached client intelligence instead of resending the graph", () => {
  const state = stateFixture();
  refreshIntelligence(state);
  const ctx = { state } as RuntimeContext;
  const perspective = { mode: "faction", factionId: 0 } as const;

  const clockUpdate = createUpdate(ctx, perspective, ["clock"]);
  assert.equal(clockUpdate.intelligence, undefined);
  assert.ok(clockUpdate.clock);

  const visibilityUpdate = createUpdate(ctx, perspective, ["visibility"]);
  assert.ok(visibilityUpdate.intelligence);
  assert.ok(visibilityUpdate.intelligence.entities.length > 0);
});

test("active projectile snapshots hide launch-time hit locks and unrelated attacker fields", () => {
  const state = stateFixture();
  state.combatProjectiles.push({
    id: "projectile-1", ownerId: 1, sourceActorId: "secret-fleet", sourceActorKind: "fleet", sourceShipId: "secret-ship",
    sourceMountKey: "secret-weapon", targetActorId: "player-fleet", targetActorKind: "fleet", targetShipId: "player-ship", targetProjectileId: null,
    starId: 0, attackClass: "missile", interceptableBy: ["pointDefense"], launchYear: 2100, impactYear: 2100.01,
    sourcePosition: { x: 20, y: 0, z: 0 }, targetPosition: { x: 0, y: 0, z: 0 }, damage: 99,
    shieldPenetration: 0.8, armorPenetration: 0.7, shieldDamageMultiplier: 1.5, armorDamageMultiplier: 1.6, hullDamageMultiplier: 1.7,
    lockedHit: true, accuracyMiss: false, dodged: false, guided: true, reacquired: false, hp: 2, maxHp: 2, evasion: 0.8, status: "inFlight",
  });
  refreshIntelligence(state);
  const projectile = createSnapshot({ state } as RuntimeContext, { mode: "faction", factionId: 0 }).combatProjectiles[0];
  assert.equal(projectile.lockedHit, false);
  assert.equal(projectile.damage, 0);
  assert.equal(projectile.ownerId, -1);
  assert.equal(projectile.sourceActorId.startsWith("track:"), true);
  assert.equal(projectile.attackClass, "missile");
});

test("a type-only stellar report does not disclose the star name or other stellar fields", () => {
  const state = stateFixture();
  state.stars[2].type = StarType.M;
  state.stars[2].luminosity = 2.75;
  state.planetStates[0].buildings.city[0] = null;
  refreshIntelligence(state);
  assert.equal(grantOneShotIntelReport(state, 0, "star", 2, ["type"]), true);

  const snapshot = createSnapshot({ state } as RuntimeContext, { mode: "faction", factionId: 0 });
  const materialized = snapshot.stars.find((candidate) => candidate.id === 2)!;
  assert.equal(materialized.type, StarType.M);
  assert.equal(materialized.name, "Unknown Signal");
  assert.equal(materialized.luminosity, 0.6);
});
