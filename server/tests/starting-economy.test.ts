import assert from "node:assert/strict";
import test from "node:test";
import { STARTING_CREW_STOCKPILE, getPlanetBuildingKind } from "../../src/data/Economy";
import { createHeadlessGame } from "../game/headless-game";
import { getAiCandidates } from "../game/ai-candidates";

test("fresh empires start with usable crew and research production for human and AI play", () => {
  const game = createHeadlessGame({ worldSeed: 22, initialWorld: { starCount: 12, factionCount: 2 }, stepMs: 24000 });
  for (const faction of game.diagnosticState().factions) {
    const economy = game.diagnosticState().factionEconomies.find((entry) => entry.factionId === faction.id)!;
    assert.equal(economy.crewStockpile, STARTING_CREW_STOCKPILE);
    assert.ok(economy.monthlyDelta.research > 0);
    const home = game.diagnosticState().planetStates.find((planet) => planet.ownerId === faction.id && planet.isHabited)!;
    assert.equal(getPlanetBuildingKind(home.buildings.city[3]), "researchLabs");
    assert.ok(home.economy.popGroups.some((group) => group.job === "researcher" && group.population > 0));
  }
  const saved = game.exportCheckpoint();
  saved.state.starbases.find((base) => base.ownerId === 0)!.buildingSlots[1] = "shipyard";
  const ready = createHeadlessGame({ checkpoint: saved, stepMs: 24000 });
  ready.step(1); // Refresh the owner's remembered yard after the laboratory edit.
  const options = getAiCandidates(ready.observe(0));
  assert.ok(options.ships.some((action) => action.type === "buildStarbaseShip" && action.shipKind === "scienceShip"));
  const tech = options.research[0]; assert.ok(tech);
  assert.equal(ready.act(ready.createAiActor(0), tech).ok, true);
  const initialTech = structuredClone(ready.diagnosticState().factionTechnologies[0]);
  ready.step();
  assert.notDeepEqual(ready.diagnosticState().factionTechnologies[0], initialTech, "research advances without first constructing a lab");
});

test("restoring an existing empire never refills spent crew or replaces the player's homeworld layout", () => {
  const game = createHeadlessGame({ worldSeed: 22, initialWorld: { starCount: 12, factionCount: 2 } });
  const saved = game.exportCheckpoint();
  saved.state.factionEconomies[0].crewStockpile = 7;
  const home = saved.state.planetStates.find((planet) => planet.ownerId === 0 && planet.isHabited)!;
  home.buildings.city[3] = null;
  const restored = createHeadlessGame({ checkpoint: saved });
  assert.equal(restored.diagnosticState().factionEconomies[0].crewStockpile, 7);
  assert.equal(restored.diagnosticState().planetStates.find((planet) => planet.id === home.id)!.buildings.city[3], null);
});
