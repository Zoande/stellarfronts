import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { createActiveEpisode, recordActiveAcceptance } from "../game/active";
import { decidePassive } from "../game/passive";
import { getAiCandidates } from "../game/ai-candidates";
import { hasPeaceExpansionGoal, hasVisibleMilitaryThreat } from "../game/active-strategy";

const game = createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } });
function fixture() {
  const observation = structuredClone(game.observe(0));
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) { economy.stockpiles[resource] = 10000; economy.monthlyDelta[resource] = 100; }
  for (const entry of observation.planets.planets) {
    if (entry.colonizationEligibility) entry.colonizationEligibility.eligible = false;
    if (entry.planetState.ownerId === 0) {
      entry.planetState.economy.housing = entry.planetState.population * 2;
      entry.planetState.economy.unemployedPopulation = 0;
      entry.planetState.economy.production.energy = entry.planetState.economy.production.alloys = 10000;
    }
  }
  const base = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  base.buildingSlots[0] = "shipyard";
  const own = observation.fleets.ships.find((ship) => ship.ownerId === 0 && ship.shipKind === "corvette")!;
  observation.fleets.ships.push({ ...structuredClone(own), id: "science-present", shipKind: "scienceShip" });
  return { observation, economy, episode: createActiveEpisode(observation, null, 0, 0) };
}
const military = (action: {type:string;shipKind?:string}) => (action.type === "buildStarbaseShip" || action.type === "buildPlanetShip") && action.shipKind === "corvette";

test("peace expansion is ordered before discretionary military ships when funded", () => {
  const { observation, episode } = fixture();
  assert.equal(hasPeaceExpansionGoal(observation), true);
  assert.ok(getAiCandidates(observation).expansion.length);
  const active = decidePassive(observation, structuredClone(episode), true);
  assert.ok(active.some(({ action }) => action.type === "buildStarbase"));
  assert.ok(!active.some(({ action }) => military(action)));
  assert.ok(decidePassive(observation, structuredClone(episode)).some(({ action }) => military(action)));
});

test("one military order is allowed while saving, then savings are protected until an outpost", () => {
  const { observation, economy, episode } = fixture(); economy.stockpiles.minerals = 1900;
  const first = decidePassive(observation, episode, true).find(({ action }) => military(action));
  assert.ok(first);
  recordActiveAcceptance(episode, first.action, observation.snapshot.clock.year);
  assert.equal(episode.militaryOrdersSinceOutpost, 1);
  assert.ok(!decidePassive(observation, episode, true).some(({ action }) => military(action)));
  const saved = structuredClone(episode);
  assert.ok(!decidePassive(observation, saved, true).some(({ action }) => military(action)));
  observation.diplomacy.countries.find((country) => !country.isSelf)!.atWar = true;
  observation.snapshot.clock.year += 0.1;
  assert.ok(decidePassive(observation, episode, true).some(({ action }) => military(action)));
  recordActiveAcceptance(episode, { type: "buildStarbase", fleetId: "builder", targetStarId: 1 }, observation.snapshot.clock.year);
  assert.equal(episode.militaryOrdersSinceOutpost, 0);
});

test("savings do not target territory beyond closed borders", () => {
  const { observation } = fixture();
  const builder = observation.fleets.fleets.find((fleet) => fleet.shipIds.some((id) => observation.fleets.ships.some((ship) => ship.id === id && ship.shipKind === "constructionShip")))!;
  const home = builder.currentStarId, foreign = 10001, exclave = 10002, neutral = 10003;
  observation.snapshot.knownStarIds = [home, foreign, exclave, neutral];
  observation.snapshot.starOwnership = [[home, 0], [foreign, 1], [exclave, 0], [neutral, -1]];
  observation.snapshot.hyperlanes = [[home, foreign], [foreign, exclave], [exclave, neutral]];
  const rival = observation.diplomacy.countries.find((country) => country.faction.id === 1)!;
  rival.theirBorderPolicy = "closed";
  assert.equal(hasPeaceExpansionGoal(observation), false);
  rival.theirBorderPolicy = "open";
  assert.equal(hasPeaceExpansionGoal(observation), true);
});

test("a stronger currently visible border force overrides expansion savings", () => {
  const { observation, economy, episode } = fixture(); economy.stockpiles.minerals = 1900;
  episode.militaryOrdersSinceOutpost = 1;
  const own = observation.fleets.fleets.find((fleet) => fleet.ownerId === 0)!;
  const ship = observation.fleets.ships.find((entry) => own.shipIds.includes(entry.id))!;
  observation.fleets.fleets.push({ ...structuredClone(own), id: "threat", ownerId: 1, shipIds: ["threat-ship"] });
  observation.fleets.ships.push({ ...structuredClone(ship), id: "threat-ship", fleetId: "threat", ownerId: 1, shipKind: "corvette", hull: 100000 });
  const entity = structuredClone(observation.snapshot.intelligence.entities.find((entry) => entry.kind === "fleet")!);
  entity.id = "threat";
  assert.ok(entity.fields.existence && "value" in entity.fields.existence);
  assert.ok(entity.fields.currentStarId && "value" in entity.fields.currentStarId);
  entity.fields.existence.status = "current"; entity.fields.existence.value = true;
  entity.fields.currentStarId.status = "current"; entity.fields.currentStarId.value = own.currentStarId;
  observation.snapshot.intelligence.entities.push(entity);
  assert.equal(hasVisibleMilitaryThreat(observation), true);
  assert.equal(hasPeaceExpansionGoal(observation), false);
  assert.ok(decidePassive(observation, episode, true).some(({ action }) => military(action)));
});
