import assert from "node:assert/strict";
import test from "node:test";

import {
  createLeaderCandidate,
  createLegendaryLeaderCandidate,
  getLeaderArchetypesByFaction,
  normalizeLeaderState,
} from "../../src/data/Leaders";
import type { SpeciesArchetypeId, SpeciesState } from "../../src/data/Species";

const ARCHETYPES: SpeciesArchetypeId[] = ["humanoid", "avian", "reptilian", "aquatic", "fungoid"];

test("normal leaders receive gender and founding-species portraits", () => {
  for (const archetypeId of ARCHETYPES) {
    const slug = archetypeId === "humanoid" ? "human" : archetypeId;
    for (let index = 0; index < 20; index += 1) {
      const leader = createLeaderCandidate(1, "civilian", 10, index, 2200, "pool", archetypeId);
      assert.equal(leader.speciesArchetypeId, archetypeId);
      assert.match(
        leader.portraitUrl ?? "",
        new RegExp(`^/textures/leaders/${leader.gender}_${slug}_leader_[1-5]\\.webp$`),
      );
    }
  }
});

test("leader normalization migrates managed portraits when faction archetype changes", () => {
  const human = createLeaderCandidate(1, "military", 10, 1, 2200, "recruited", "humanoid");
  const avianFallback = createLeaderCandidate(1, "military", 10, 1, 2200, "recruited", "avian");
  const migrated = normalizeLeaderState(human, avianFallback);

  assert.equal(migrated.speciesArchetypeId, "avian");
  assert.match(migrated.portraitUrl ?? "", /^\/textures\/leaders\/(?:female|male)_avian_leader_[1-5]\.webp$/);
});

test("legendary leaders retain the placeholder for every archetype", () => {
  for (const archetypeId of ARCHETYPES) {
    assert.equal(createLegendaryLeaderCandidate(1, "military", 10, 1, 2200, archetypeId).portraitUrl, null);
  }
});

test("faction leader archetypes follow founding species", () => {
  const species: SpeciesState[] = ARCHETYPES.map((archetypeId, index) => ({
    id: `species-faction-${index}`,
    name: archetypeId,
    archetypeId,
    traitIds: [],
    originFactionId: index,
  }));
  const factions = ARCHETYPES.map((_archetypeId, index) => ({
    id: index,
    foundingSpeciesId: `species-faction-${index}`,
  }));

  const mapped = getLeaderArchetypesByFaction(factions, species);
  for (let index = 0; index < ARCHETYPES.length; index += 1) {
    assert.equal(mapped.get(index), ARCHETYPES[index]);
  }
});
