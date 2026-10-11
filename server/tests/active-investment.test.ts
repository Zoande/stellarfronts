import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { createActiveEpisode, decideActive } from "../game/active";
import { activeAllocationAction, activeInvestmentProject, fundActiveProject, resourceAllocation } from "../game/active-investment";
import { calculatePlanetEconomy, createPlanetBuildingState } from "../../src/data/Economy";
import { getRequiredTechIdsForBuildingLevel } from "../../src/data/Technology";
import { jobLockKey, workforceForecast } from "../game/active-economy";
import { decidePassive } from "../game/passive";

const game = createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } });
function fixture() {
  const observation = structuredClone(game.observe(0));
  // A fully claimed frontier isolates development choices from expansion.
  observation.snapshot.starOwnership = observation.snapshot.knownStarIds!.map((id) => [id, 0]);
  const planet = observation.planets.planets.find(({ planetState }) => planetState.ownerId === 0)!.planetState;
  planet.builtDistricts.city = 8;
  planet.economy = calculatePlanetEconomy(planet);
  planet.economy.production.energy = planet.economy.production.alloys = 10000;
  const ship = observation.fleets.ships.find((entry) => entry.ownerId === 0)!;
  observation.fleets.ships.push({ ...structuredClone(ship), id: "support-science", shipKind: "scienceShip", designId: "design-0-scienceShip-default" });
  observation.fleets.fleets.find((fleet) => fleet.id === ship.fleetId)!.shipIds.push("support-science");
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 5000; economy.monthlyDelta[resource] = 100;
  }
  return { observation, planet, economy, episode: createActiveEpisode(observation, null, 0, 0) };
}

test("project funding sells excess stocks while reserving project inputs, without mutating state", () => {
  const { observation, economy } = fixture();
  economy.stockpiles.minerals = 100;
  economy.stockpiles.energy = 1000;
  economy.stockpiles.food = 20000;
  const base = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  const before = structuredClone(observation), digest = game.digest();
  const action = fundActiveProject(observation, { type: "buildStarbaseBuilding", starbaseId: base.id, slotIndex: 1, buildingKind: "shipyard" });
  assert.equal(action?.type, "marketTrade");
  if (action?.type !== "marketTrade") return;
  assert.equal(action.tradeType, "sell"); assert.equal(action.resourceId, "food");
  assert.ok(action.amount > 100 && economy.stockpiles.food - action.amount >= resourceAllocation(observation).food.threshold);
  assert.deepEqual(observation, before); assert.equal(game.digest(), digest);
});

test("project funding buys a complete missing input and buffer rather than daily rations", () => {
  const { observation, economy } = fixture();
  economy.stockpiles.minerals = 100; economy.stockpiles.energy = 100000;
  const base = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  const action = fundActiveProject(observation, { type: "buildStarbaseBuilding", starbaseId: base.id, slotIndex: 1, buildingKind: "shipyard" });
  assert.equal(action?.type, "marketTrade");
  if (action?.type !== "marketTrade") return;
  assert.equal(action.tradeType, "buy"); assert.equal(action.resourceId, "minerals");
  assert.ok(action.amount + economy.stockpiles.minerals >= 4200);
});

test("project funding protects outstanding ship installments and declines unsustainable upkeep", () => {
  const { observation, economy } = fixture();
  economy.stockpiles.minerals = 100; economy.stockpiles.energy = 1000;
  const base = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  base.shipQueue.push({ id: "reserved", kind: "build", remainingDays: 100, alloyUpkeepPerDay: 50 } as typeof base.shipQueue[number]);
  economy.stockpiles.food = 600; economy.stockpiles.goods = 600;
  assert.equal(fundActiveProject(observation, { type: "buildStarbaseBuilding", starbaseId: base.id, slotIndex: 1, buildingKind: "shipyard" }), undefined);
  economy.monthlyDelta.energy = -10000;
  economy.stockpiles.food = 50000;
  assert.equal(fundActiveProject(observation, { type: "buildStarbaseBuilding", starbaseId: base.id, slotIndex: 1, buildingKind: "shipyard" }), undefined);
});

test("healthy economies with exceptional mineral abundance develop another resource or research", () => {
  const { observation, planet, economy, episode } = fixture();
  economy.stockpiles.minerals = 50000;
  observation.fleets.starbases.find((base) => base.ownerId === 0)!.buildingSlots[1] = "shipyard";
  planet.population = 15_000_000_000; planet.speciesPopulations[0].population = planet.population;
  planet.builtDistricts.city = 8; planet.features = [];
  planet.economy = calculatePlanetEconomy(planet);
  planet.economy.production.energy = planet.economy.production.alloys = 10000;
  observation.snapshot.technologies.find((entry) => entry.factionId === 0)!.completedTechIds.push(...getRequiredTechIdsForBuildingLevel("researchLabs", 2));
  const project = activeInvestmentProject(observation, episode);
  assert.ok(project, "a positive economy still has a development goal");
  assert.ok(project?.type === "buildDistrict" || project?.type === "buildPlanetBuilding" || project?.type === "upgradePlanetBuilding", JSON.stringify(project));
  if (project?.type === "buildDistrict") assert.notEqual(project.districtKind, "mining");
  if (project?.type === "buildPlanetBuilding") assert.notEqual(project.buildingKind, "mineralPurificationPlant");
  episode.nextInvestmentYear = observation.snapshot.clock.year + 1;
  assert.notDeepEqual(activeInvestmentProject(observation, episode), project, "optional development has a cooldown so naval investment can continue");
});

test("healthy allocation releases only AI worker locks when excess output can become research", () => {
  const { observation, planet, economy, episode } = fixture();
  planet.population = 3_000_000_000; planet.speciesPopulations[0].population = planet.population;
  planet.builtDistricts.mining = 3;
  planet.buildings.city[3] = createPlanetBuildingState("researchLabs");
  planet.jobLocks = [{ job: "miner", allocations: [{ speciesId: planet.speciesPopulations[0].speciesId, population: 2_000_000_000 }] }];
  planet.economy = calculatePlanetEconomy(planet);
  economy.stockpiles.minerals = 50000;
  economy.monthlyDelta.minerals = 1000;
  const unlock = { type: "setPlanetJobLock", planetId: planet.id, job: "miner", locked: false } as const;
  assert.ok(workforceForecast(observation, unlock)!.research > 1);
  assert.equal(activeAllocationAction(observation, episode), undefined, "a player's lock is preserved");
  episode.managedJobLocks = [jobLockKey(unlock)];
  assert.deepEqual(activeAllocationAction(observation, episode), unlock);
  economy.monthlyDelta.minerals = 1;
  assert.equal(activeAllocationAction(observation, episode), undefined, "do not create a deficit just to rebalance stocks");
});

test("investment keeps ship assignment receipts when the ordinary ship order is retained", () => {
  const { observation, episode } = fixture();
  episode.nextInvestmentYear = observation.snapshot.clock.year + 1;
  const base = observation.fleets.starbases.find((entry) => entry.ownerId === 0)!;
  base.buildingSlots[1] = "shipyard";
  const ordinary = decidePassive(observation, structuredClone(episode), true).find(({ action }) => action.type === "buildStarbaseShip");
  assert.ok(ordinary?.replacementForFleetId, JSON.stringify(ordinary));
  const selected = decideActive(observation, structuredClone(episode)).find(({ action }) => action.type === "buildStarbaseShip");
  assert.deepEqual(selected, ordinary);
});
