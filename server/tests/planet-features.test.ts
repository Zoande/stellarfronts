import assert from "node:assert/strict";
import test from "node:test";
import {
  completePlanetConstructionQueueItem,
  createFeatureRemovalConstructionQueueItem,
  createPlanetStateFromSeed,
  getEffectivePlanetDistrictLimits,
} from "../../src/data/Economy";
import {
  PLANET_FEATURE_DEFINITIONS,
  PLANET_FEATURE_KINDS,
  PLANET_MAJOR_FEATURE_KINDS,
  PLANET_MINOR_FEATURE_KINDS,
  generatePlanetFeatures,
  isPlanetFeatureEligible,
} from "../../src/data/PlanetFeatures";
import { buildPlanetStatesFromStars, generateStarMap, normalizePlanetStates, PlanetType, StarType } from "../../src/data/StarMap";
import { getRequiredTechIdsForPlanetFeatureRemoval, TECHNOLOGY_BY_ID } from "../../src/data/Technology";

const BASE_LIMITS = { city: 10, generator: 4, mining: 4, agriculture: 4 };
const ZERO_DISTRICTS = { city: 0, generator: 0, mining: 0, agriculture: 0 };

test("planet feature catalog contains the agreed thirty minor and twenty major-slot definitions", () => {
  assert.equal(PLANET_FEATURE_KINDS.length, 50);
  assert.equal(new Set(PLANET_FEATURE_KINDS).size, 50);
  assert.equal(PLANET_MINOR_FEATURE_KINDS.length, 30);
  assert.equal(PLANET_MAJOR_FEATURE_KINDS.length, 20);
  assert.equal(PLANET_FEATURE_DEFINITIONS.homePlanet.tier, "special");
  assert.equal(PLANET_MAJOR_FEATURE_KINDS.includes("homePlanet"), true);
  assert.equal(PLANET_FEATURE_KINDS.filter((kind) => PLANET_FEATURE_DEFINITIONS[kind].negative).length, 12);
});

test("feature generation is deterministic, eligible, dense, and capped at three major slots", () => {
  for (const planetType of Object.values(PlanetType)) {
    for (const starType of Object.values(StarType)) {
      for (let index = 0; index < 20; index += 1) {
        const input = { planetId: `${planetType}-${starType}-${index}`, planetType, starType };
        const first = generatePlanetFeatures(input);
        const second = generatePlanetFeatures(input);
        assert.deepEqual(first, second);
        assert.equal(new Set(first).size, first.length);
        const definitions = first.map((kind) => PLANET_FEATURE_DEFINITIONS[kind]);
        assert.ok(definitions.filter((definition) => definition.tier === "minor").length >= 2);
        assert.ok(definitions.filter((definition) => definition.tier === "minor").length <= 5);
        assert.ok(definitions.filter((definition) => definition.tier !== "minor").length <= 3);
        assert.ok(definitions.every((definition) => isPlanetFeatureEligible(definition, planetType, starType)));
      }
    }
  }
});

test("home planet generation consumes one of the three major slots", () => {
  for (let index = 0; index < 100; index += 1) {
    const features = generatePlanetFeatures({
      planetId: `home-${index}`,
      planetType: PlanetType.Grassland,
      starType: StarType.G,
      isHomePlanet: true,
    });
    assert.equal(features.includes("homePlanet"), true);
    assert.ok(features.filter((kind) => PLANET_FEATURE_DEFINITIONS[kind].tier !== "minor").length <= 3);
  }
});

test("district feature modifiers alter category limits without introducing a total cap", () => {
  assert.deepEqual(getEffectivePlanetDistrictLimits(BASE_LIMITS, ["stableFoundations", "seasonalRains"]), {
    city: 12,
    generator: 4,
    mining: 4,
    agriculture: 6,
  });
});

test("feature remediation uses the shared queue and permanently removes the completed feature", () => {
  const state = createPlanetStateFromSeed({
    id: "remediation-world",
    starId: 0,
    planetIndex: 0,
    isHabited: true,
    habitability: 80,
    features: ["seismicFaults", "stableFoundations"],
    builtDistricts: ZERO_DISTRICTS,
    districtLimits: BASE_LIMITS,
    starterInfrastructure: false,
  });
  const item = createFeatureRemovalConstructionQueueItem("seismicFaults", "remove-faults");
  const queued = { ...state, constructionQueue: [...state.constructionQueue, item] };
  const completed = completePlanetConstructionQueueItem(
    queued,
    item.id,
    getEffectivePlanetDistrictLimits(BASE_LIMITS, queued.features),
  );
  assert.ok(completed);
  assert.equal(completed.state.features.includes("seismicFaults"), false);
  assert.equal(completed.state.features.includes("stableFoundations"), true);
  assert.equal(completed.state.constructionQueue.length, 0);
});

test("authored remediation technology gates resolve to real technologies", () => {
  for (const kind of PLANET_FEATURE_KINDS) {
    const definition = PLANET_FEATURE_DEFINITIONS[kind];
    if (!definition.removal) continue;
    for (const techId of getRequiredTechIdsForPlanetFeatureRemoval(kind)) {
      assert.ok(TECHNOLOGY_BY_ID[techId], `${kind} references missing technology ${techId}`);
    }
  }
  assert.deepEqual(getRequiredTechIdsForPlanetFeatureRemoval("flashFloods"), []);
  assert.ok(getRequiredTechIdsForPlanetFeatureRemoval("volatileTectonics").includes("geotechnical_remediation"));
});

test("generated features persist after removals while legacy planets receive one deterministic backfill", () => {
  const stars = generateStarMap(180, 180, 12, 9317, 7, {
    innerRadiusFraction: 0.08,
    outerRadiusFraction: 0.92,
    spiralArms: 3,
    spiralTightness: 1.2,
    armSpread: 0.4,
  });
  const generated = buildPlanetStatesFromStars(stars);
  const target = generated[0];
  assert.ok(target.features.length > 0);
  const removedKind = target.features[0];
  const afterRemoval = generated.map((state) => state.id === target.id
    ? { ...state, features: state.features.filter((kind) => kind !== removedKind) }
    : state);
  const persisted = normalizePlanetStates(stars, afterRemoval).planetStates.find((state) => state.id === target.id);
  assert.ok(persisted);
  assert.equal(persisted.features.includes(removedKind), false);

  const legacy = generated.map((state) => state.id === target.id
    ? { ...state, features: [], featureGenerationVersion: 0 }
    : state);
  const firstBackfill = normalizePlanetStates(stars, legacy).planetStates.find((state) => state.id === target.id);
  const secondBackfill = normalizePlanetStates(stars, legacy).planetStates.find((state) => state.id === target.id);
  assert.ok(firstBackfill && secondBackfill);
  assert.ok(firstBackfill.features.length > 0);
  assert.deepEqual(firstBackfill.features, secondBackfill.features);
});
