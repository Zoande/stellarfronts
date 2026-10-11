import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { createActiveEpisode } from "../game/active";
import { peaceAssessment, rememberWarBorders } from "../game/active-diplomacy";

function fixture() {
  const checkpoint = createHeadlessGame({ initialWorld: { starCount: 8, factionCount: 2 } }).exportCheckpoint();
  checkpoint.state.aiSettings = { allowWarDeclarations: true };
  const game = createHeadlessGame({ checkpoint });
  assert.equal(game.act(game.createAiActor(0), { type: "declareWar", targetFactionId: 1 }).ok, true);
  const observation = structuredClone(game.observe(0));
  const episode = createActiveEpisode(observation, null, 0, 0);
  rememberWarBorders(observation, episode);
  return { observation, episode };
}

test("fair status quo preserves useful conquests, while white peace would return them", () => {
  const { observation, episode } = fixture();
  const rivalSystem = observation.snapshot.starOwnership.find(([, owner]) => owner === 1)!;
  rivalSystem[1] = 0;
  const assessment = peaceAssessment(observation, episode, 1, true, true);
  assert.equal(assessment.gains, 1); assert.equal(assessment.losses, 0);
  assert.equal(assessment.acceptStatusQuo, true); assert.equal(assessment.proposeStatusQuo, true);
  assert.equal(assessment.acceptWhitePeace, false);
});

test("status quo protects an owned colony under occupation even after navy loss", () => {
  const { observation, episode } = fixture();
  const colony = observation.planets.planets.find(({ planetState }) => planetState.ownerId === 0 && planetState.isHabited)!;
  observation.snapshot.starOwnership.find(([id]) => id === colony.starId)![1] = 1;
  const assessment = peaceAssessment(observation, episode, 1, false, false);
  assert.equal(assessment.losses, 1); assert.equal(assessment.exhausted, true);
  assert.equal(assessment.acceptStatusQuo, false); assert.equal(assessment.proposeStatusQuo, false);
  assert.equal(assessment.acceptWhitePeace, true);
});

test("a healthy country declines net territorial loss and remembers its own pre-war borders", () => {
  const { observation, episode } = fixture();
  const war = observation.diplomacy.wars[0];
  episode.warBaselineSystems = { "pending:1": [900, 901] };
  rememberWarBorders(observation, episode);
  assert.deepEqual(episode.warBaselineSystems[war.id], [900, 901]);
  assert.equal(episode.warBaselineSystems["pending:1"], undefined);
  observation.snapshot.starOwnership = [[900, 1], [901, 1], [902, 0]];
  const assessment = peaceAssessment(observation, episode, 1, true, true);
  assert.equal(assessment.gains, 1); assert.equal(assessment.losses, 2);
  assert.equal(assessment.acceptStatusQuo, false); assert.equal(assessment.acceptWhitePeace, true);
});
