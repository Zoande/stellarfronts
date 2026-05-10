import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyPlanetStatesToStars,
  buildPlanetStatesFromStars,
  createPlanetId,
  ensureHabitedHomePlanets,
  generateStarMap,
  HUMAN_BASE_HABITABILITY_BY_PLANET_TYPE,
  normalizePlanetStates,
  PlanetType,
} from "../src/data/StarMap";
import type { DistrictKind, PlanetConfig } from "../src/data/StarMap";
import { getEffectiveSpeciesHabitability } from "../src/data/Economy";

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
