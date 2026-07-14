import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPlanetStatesToStars,
  buildPlanetStatesFromStars,
  createPlanetId,
  createPlanetStateFromConfig,
  ensureHabitedHomePlanets,
  generateStarMap,
  HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE,
  normalizePlanetStates,
  PlanetType,
} from "../../src/data/StarMap";
import type { DistrictKind, PlanetConfig } from "../../src/data/StarMap";
import {
  DEFAULT_ORBIT_EPOCH_MS,
  getPlanetOrbitAngularSpeed,
  getPlanetSystemOrbitRadius,
  normalizePlanetOrbitFields,
} from "../../src/data/SystemCoordinates";
import { getEffectiveSpeciesHabitability, getPlanetBuildingKind, NEW_COLONY_POPULATION } from "../../src/data/Economy";

const DISTRICT_KINDS: DistrictKind[] = ["city", "generator", "mining", "agriculture"];

function createTestStars() {
  return generateStarMap(260, 260, 18, 7331, 9, {
    innerRadiusFraction: 0.08,
    outerRadiusFraction: 0.92,
    spiralArms: 3,
    spiralTightness: 1.35,
    armSpread: 0.42,
  });
}

test("generated stars create stable planet states for every planet", () => {
  const stars = createTestStars();
  const planetStates = buildPlanetStatesFromStars(stars);
  const planetCount = stars.reduce((sum, star) => sum + star.system.planets.length, 0);

  assert.equal(planetStates.length, planetCount);
  assert.equal(new Set(planetStates.map((state) => state.id)).size, planetStates.length);

  for (const state of planetStates) {
    const planet = stars[state.starId]?.system.planets[state.planetIndex];
    assert.ok(planet, `missing planet for state ${state.id}`);
    assert.equal(state.id, createPlanetId(state.starId, state.planetIndex));
    assert.equal(planet.id, state.id);

    for (const kind of DISTRICT_KINDS) {
      assert.ok(
        state.builtDistricts[kind] <= planet.objectDetails.districtLimits[kind],
        `${state.id} ${kind} districts exceed limit`,
      );
    }
  }
});

test("home systems receive tagged 100 percent human homeworlds", () => {
  const stars = createTestStars();
  const homeStarIds = [stars.find((star) => star.system.planets.length > 0)?.id ?? 0];
  for (const starId of homeStarIds) {
    const star = stars[starId];
    star.system.planets = star.system.planets.filter((planet) => planet.isHabited !== true);
  }

  const changed = ensureHabitedHomePlanets(stars, homeStarIds);
  const normalized = normalizePlanetStates(stars, [], homeStarIds);
  const homeState = normalized.planetStates.find((state) => state.starId === homeStarIds[0] && state.isHabited);
  const homePlanet = homeState ? stars[homeState.starId].system.planets[homeState.planetIndex] : null;

  assert.equal(changed, true);
  assert.ok(homeState, "home system should have a habited state");
  assert.ok(homePlanet, "home system should have a habited planet config");
  assert.equal(homePlanet?.type, PlanetType.Grassland);
  assert.equal(homeState?.features.includes("homePlanet"), true);
  assert.equal(homeState?.habitability, HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE[PlanetType.Grassland]);
  assert.equal(homeState ? getEffectiveSpeciesHabitability(homeState) : 0, 100);
});

test("colonized planets can start with low population and no starter infrastructure", () => {
  const stars = createTestStars();
  const star = stars.find((candidate) => candidate.system.planets.some((planet) => planet.objectDetails.habitability && planet.objectDetails.habitability > 0));
  assert.ok(star, "test map should contain a colonizable planet");
  const planetIndex = star.system.planets.findIndex((planet) => planet.objectDetails.habitability && planet.objectDetails.habitability > 0);
  const planet = star.system.planets[planetIndex];

  const colony = createPlanetStateFromConfig(
    star.id,
    planetIndex,
    planet,
    {
      isHabited: true,
      population: NEW_COLONY_POPULATION,
      speciesPopulations: [{ speciesId: "species-faction-1", population: NEW_COLONY_POPULATION }],
      builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
      constructionQueue: [],
    },
    undefined,
    { starterInfrastructure: false, startingPopulation: NEW_COLONY_POPULATION },
  );

  assert.equal(colony.isHabited, true);
  assert.equal(colony.population, NEW_COLONY_POPULATION);
  assert.deepEqual(colony.builtDistricts, { city: 0, generator: 0, mining: 0, agriculture: 0 });
  // The Planetary Capital is auto-anchored to the first city slot on every
  // habited world, even one founded with no other starter infrastructure.
  assert.equal(getPlanetBuildingKind(colony.buildings.city[0]), "planetaryCapital");
  assert.equal(
    Object.values(colony.buildings).flat().filter((building) => building !== null).length,
    1,
  );
  assert.equal(colony.constructionQueue.length, 0);
});

test("legacy planet metadata migrates to stable IDs and clamped mutable state", () => {
  const stars = createTestStars();
  const star = stars.find((candidate) => candidate.system.planets.length > 0);
  assert.ok(star, "test map should contain at least one planet");

  const planet = star.system.planets[0] as Omit<PlanetConfig, "id"> & { id?: string };
  delete planet.id;
  planet.isHabited = true;
  planet.objectDetails.builtDistricts = {
    city: 999,
    generator: 999,
    mining: 999,
    agriculture: 999,
  };

  const normalized = normalizePlanetStates(stars, []);
  assert.equal(normalized.changed, true);

  const migratedPlanet = star.system.planets[0];
  const migratedState = normalized.planetStates.find((state) => state.id === migratedPlanet.id);
  assert.ok(migratedState, "migrated planet should have a matching mutable state");
  assert.equal(migratedPlanet.id, createPlanetId(star.id, 0));
  assert.equal(migratedState.isHabited, true);

  for (const kind of DISTRICT_KINDS) {
    assert.equal(
      migratedState.builtDistricts[kind],
      migratedPlanet.objectDetails.districtLimits[kind],
      `${kind} districts should be clamped to the planet limit`,
    );
  }

  applyPlanetStatesToStars(stars, normalized.planetStates);
  assert.equal(migratedPlanet.isHabited, true);
});

test("applying planet state tolerates sparse client-side planet detail caches", () => {
  const stars = createTestStars();
  const sourceStar = stars.find((candidate) => candidate.system.planets.length >= 2);
  assert.ok(sourceStar, "test map should contain a system with multiple planets");

  const planetIndex = sourceStar.system.planets.length - 1;
  const planet = sourceStar.system.planets[planetIndex];
  const planetState = buildPlanetStatesFromStars([sourceStar])
    .find((state) => state.planetIndex === planetIndex);
  assert.ok(planetState, "target planet should have mutable state");

  const sparsePlanets: PlanetConfig[] = [];
  sparsePlanets[planetIndex] = planet;
  const sparseStar = {
    ...sourceStar,
    system: { planets: sparsePlanets },
  };

  assert.doesNotThrow(() => applyPlanetStatesToStars([sparseStar], [planetState]));
  assert.equal(sparseStar.system.planets[planetIndex].id, planetState.id);
});

test("planet orbit phase fields are deterministic and migrate without ticking saves", () => {
  const stars = createTestStars();
  const star = stars.find((candidate) => candidate.system.planets.length > 0);
  assert.ok(star, "test map should contain at least one planet");

  const planet = star.system.planets[0];
  assert.equal(Number.isFinite(planet.orbitPhaseAtEpoch), true);
  assert.equal(planet.orbitEpochMs, DEFAULT_ORBIT_EPOCH_MS);

  const legacyPlanet = {
    ...planet,
    orbitPhaseAtEpoch: undefined as unknown as number,
    orbitEpochMs: undefined as unknown as number,
  };
  const changed = normalizePlanetOrbitFields(legacyPlanet, star.id, 0);
  const migratedPhase = legacyPlanet.orbitPhaseAtEpoch;
  const migratedEpoch = legacyPlanet.orbitEpochMs;

  assert.equal(changed, true);
  assert.equal(Number.isFinite(migratedPhase), true);
  assert.equal(migratedEpoch, DEFAULT_ORBIT_EPOCH_MS);
  assert.equal(normalizePlanetOrbitFields(legacyPlanet, star.id, 0), false);
  assert.equal(legacyPlanet.orbitPhaseAtEpoch, migratedPhase);
});

test("outer planet orbit speed scales down with system-view distance", () => {
  const stars = createTestStars();
  const star = stars.find((candidate) => candidate.system.planets.length > 0);
  assert.ok(star, "test map should contain at least one planet");

  const planet = star.system.planets[0];
  const innerRadius = getPlanetSystemOrbitRadius({ ...planet, orbitRadius: 7 }, 0);
  const outerRadius = getPlanetSystemOrbitRadius({ ...planet, orbitRadius: 70 }, 4);
  const innerSpeed = getPlanetOrbitAngularSpeed(planet, innerRadius);
  const outerSpeed = getPlanetOrbitAngularSpeed(planet, outerRadius);

  assert.ok(outerRadius > innerRadius);
  assert.ok(outerSpeed < innerSpeed * 0.25);
});
