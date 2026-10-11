import assert from "node:assert/strict";
import test from "node:test";
import { createHeadlessGame } from "../game/headless-game";
import { calculatePlanetEconomy, createPlanetBuildingState, DISTRICT_COSTS, DISTRICT_BUILD_DAYS } from "../../src/data/Economy";
import { createActiveEpisode, decideActive, recordActiveAcceptance } from "../game/active";
import { activeRecoveryAction, buildingKey, developmentForecast, improvesProduction, jobLockKey, protectDevelopmentWorkforce, workforceForecast } from "../game/active-economy";
import { getAiCandidates } from "../game/ai-candidates";
import { getRequiredTechIdsForBuildingLevel } from "../../src/data/Technology";

const game = createHeadlessGame({ worldSeed: 22, simulationSeed: 73, initialWorld: { starCount: 12, factionCount: 2 } });
function fixture() {
  const observation = structuredClone(game.observe(0));
  const planet = observation.planets.planets.find((entry) => entry.planetState.ownerId === 0)!;
  planet.planetState.buildings.city[4] = createPlanetBuildingState("alloyFoundries");
  const economy = observation.snapshot.factionEconomies.find((entry) => entry.factionId === 0)!;
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 3000; economy.monthlyDelta[resource] = 100;
  }
  economy.stockpiles.minerals = 50; economy.monthlyDelta.minerals = -100;
  return { observation, planet, economy, episode: createActiveEpisode(observation, null, 0, 0) };
}

test("peaceful mineral crisis pauses optional alloy demand without changing authoritative state", () => {
  const { observation, planet, economy, episode } = fixture();
  for (const resource of ["food", "goods", "alloys", "energy"] as const) economy.monthlyDelta[resource] = 0;
  const before = game.digest();
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.deepEqual(action, { type: "setPlanetBuildingEnabled", planetId: planet.planetState.id, area: "city", slotIndex: 4, subDistrictIndex: undefined, enabled: false });
  assert.equal(game.digest(), before);
});

test("wartime mineral recovery protects alloy factories and funds a whole mine", () => {
  const { observation, economy, episode } = fixture();
  observation.diplomacy.countries.find((country) => !country.isSelf)!.atWar = true;
  economy.stockpiles.energy = 10000;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "marketTrade");
  if (action?.type !== "marketTrade") return;
  assert.equal(action.resourceId, "minerals"); assert.equal(action.tradeType, "buy");
  assert.ok(action.amount + economy.stockpiles.minerals >= DISTRICT_COSTS.mining.minerals - economy.monthlyDelta.minerals * DISTRICT_BUILD_DAYS.mining / 30);
});

test("exhausted mine capacity funds a productive processing upgrade instead of daily rations", () => {
  const { observation, planet, economy, episode } = fixture();
  observation.diplomacy.countries.find((country) => !country.isSelf)!.atWar = true;
  planet.planet.objectDetails.districtLimits.mining = 2;
  planet.planetState.builtDistricts.mining = 2;
  planet.planet.objectDetails.districtLimits.city = 8;
  planet.planetState.builtDistricts.city = 8;
  planet.planetState.population = 20_000_000_000;
  planet.planetState.speciesPopulations[0].population = planet.planetState.population;
  planet.planetState.features = [];
  planet.planetState.buildings.mining[0] = createPlanetBuildingState("mineralPurificationPlant");
  planet.planetState.economy = calculatePlanetEconomy(planet.planetState);
  observation.snapshot.technologies.find((entry) => entry.factionId === 0)!.completedTechIds.push(...getRequiredTechIdsForBuildingLevel("mineralPurificationPlant", 2));
  economy.stockpiles.energy = 20000;
  const project = { type: "upgradePlanetBuilding" as const, planetId: planet.planetState.id, area: "mining" as const, slotIndex: 0 };
  assert.ok(improvesProduction(observation, project, "minerals"));
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "marketTrade");
  if (action?.type !== "marketTrade") return;
  assert.equal(action.resourceId, "minerals"); assert.equal(action.tradeType, "buy");
  assert.ok(action.amount + economy.stockpiles.minerals >= 2700, "funds the 2,000 mineral upgrade and the retained buffer: " + JSON.stringify(action));
  economy.stockpiles.minerals += action.amount;
  const next = decideActive(observation, episode);
  assert.ok(next.some(({ action }) => action.type === "upgradePlanetBuilding" && action.area === "mining" && action.slotIndex === 0), JSON.stringify(next));
});

test("an energy crisis can sell surplus output without shutting wartime alloy production", () => {
  const { observation, economy, episode } = fixture();
  observation.diplomacy.countries.find((country) => !country.isSelf)!.atWar = true;
  economy.stockpiles.minerals = 3000; economy.monthlyDelta.minerals = 100;
  economy.stockpiles.energy = 50; economy.monthlyDelta.energy = -100;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "marketTrade");
  if (action?.type !== "marketTrade") return;
  assert.equal(action.tradeType, "sell"); assert.notEqual(action.resourceId, "alloys");
});

test("a profitable importer sells available exports at its cash floor before pausing industry", () => {
  const { observation, economy, episode } = fixture();
  economy.stockpiles.energy = 499; economy.monthlyDelta.energy = -100;
  economy.stockpiles.minerals = 3000; economy.monthlyDelta.minerals = 100;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "marketTrade");
  if (action?.type === "marketTrade") assert.equal(action.tradeType, "sell");
});

test("recurring imports buy a buffer beyond the retained floor rather than one day's ration", () => {
  const { observation, economy, episode } = fixture();
  economy.stockpiles.minerals = 699; economy.monthlyDelta.minerals = -10;
  economy.stockpiles.energy = 20000;
  // An in-progress mine means this trade maintains supplies, not a new project.
  const owned = observation.planets.planets.find(({ planetState }) => planetState.ownerId === 0)!.planetState;
  owned.constructionQueue.push({ id: "pending-mine", kind: "district", label: "Mining", districtKind: "mining", totalDays: 180, remainingDays: 90, mineralCost: 1000, cost: DISTRICT_COSTS.mining });
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "marketTrade");
  if (action?.type === "marketTrade") { assert.equal(action.tradeType, "buy"); assert.ok(action.amount >= 21); }
});

test("restart requires an accepted AI pause, a cooldown, and sustainable inputs", () => {
  const { observation, planet, economy, episode } = fixture();
  for (const resource of ["food", "goods", "alloys", "energy"] as const) economy.monthlyDelta[resource] = 0;
  const pause = activeRecoveryAction(observation, episode, getAiCandidates(observation))!;
  assert.equal(pause.type, "setPlanetBuildingEnabled");
  planet.planetState.buildings.city[4] = createPlanetBuildingState("alloyFoundries", 1, false);
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 10000; economy.monthlyDelta[resource] = 500;
  }
  const action = () => activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action(), undefined); // Player-disabled production is not ours to restart.
  recordActiveAcceptance(episode, pause, observation.snapshot.clock.year);
  assert.equal(action(), undefined);
  observation.snapshot.clock.year += 0.1;
  const restart = action(); assert.equal(restart?.type, "setPlanetBuildingEnabled");
  if (restart?.type !== "setPlanetBuildingEnabled") return;
  assert.equal(restart.enabled, true);
  economy.monthlyDelta.minerals = 0;
  assert.equal(action()?.type, "setPlanetBuildingEnabled", "profitable exports can sustain the restarted inputs");
  economy.monthlyDelta.energy = -5000;
  assert.ok(action()?.type !== "setPlanetBuildingEnabled" || (action() as { enabled: boolean }).enabled === false);
  recordActiveAcceptance(episode, restart, observation.snapshot.clock.year);
  assert.deepEqual(episode.pausedBuildings, {});
});

test("an unstaffed generator expansion is not mistaken for effective energy production", () => {
  const { observation, planet } = fixture();
  planet.planetState.population = 5_000_000_000;
  planet.planetState.speciesPopulations[0].population = 5_000_000_000;
  planet.planetState.builtDistricts.agriculture = 8;
  const action = { type: "buildDistrict" as const, planetId: planet.planetState.id, districtKind: "generator" as const };
  assert.ok(developmentForecast(observation, action)!.energy <= 0);
  assert.equal(improvesProduction(observation, action, "energy"), false);
});

test("housing can be an energy recovery project when crowding suppresses production", () => {
  const { observation, planet, economy, episode } = fixture();
  // Existing urban buildings rule out empty-district residential rezoning.
  planet.planetState.urbanSubDistricts[1].buildings[0] = createPlanetBuildingState("civilianFabricators", 1, false);
  planet.planetState.population = 12_000_000_000;
  planet.planetState.speciesPopulations[0].population = 12_000_000_000;
  planet.planetState.economy.housing = 10_000_000_000;
  economy.stockpiles.minerals = 5000; economy.monthlyDelta.minerals = 100;
  economy.stockpiles.energy = 500; economy.monthlyDelta.energy = -100;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "buildDistrict");
  if (action?.type === "buildDistrict") assert.equal(action.districtKind, "city");
});

test("crew training infrastructure waits until the initial trained reserve needs replenishment", () => {
  const { observation, economy, episode } = fixture();
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) { economy.stockpiles[resource] = 10000; economy.monthlyDelta[resource] = 100; }
  economy.crewStockpile = 100000;
  const fortress = () => decideActive(observation, structuredClone(episode)).some(({ action }) => action.type === "buildPlanetBuilding" && action.buildingKind === "fortress");
  assert.equal(fortress(), false);
  economy.crewStockpile = 40000;
  assert.equal(fortress(), true);
});

test("restart protects technicians freed by a pause using the ordinary current-worker lock", () => {
  const { observation, planet, economy, episode } = fixture();
  const p = planet.planetState;
  p.population = 10_000_000_000; p.speciesPopulations[0].population = p.population;
  p.builtDistricts.mining = 3;
  p.buildings.city[3] = createPlanetBuildingState("researchLabs", 1, false);
  p.buildings.city[4] = createPlanetBuildingState("civilianFabricators", 1, false);
  p.economy = calculatePlanetEconomy(p);
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 10000; economy.monthlyDelta[resource] = 100;
  }
  economy.monthlyDelta.energy = 40;
  const restart = { type: "setPlanetBuildingEnabled" as const, planetId: p.id, area: "city" as const, slotIndex: 3, enabled: true };
  episode.pausedBuildings = { [buildingKey(restart)]: observation.snapshot.clock.year - 0.1 };
  const before = game.digest();
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.deepEqual(action, { type: "setPlanetJobLock", planetId: p.id, job: "technician", locked: true });
  if (action?.type !== "setPlanetJobLock") return;
  assert.ok(workforceForecast(observation, action, restart)!.energy >= -28.01); // upkeep, without stealing technicians
  assert.equal(game.digest(), before);
  recordActiveAcceptance(episode, action, observation.snapshot.clock.year);
  assert.deepEqual(episode.managedJobLocks, [jobLockKey(action)]);
  p.jobLocks.push({ job: "technician", allocations: p.economy.popGroups.filter((group) => group.job === "technician").map(({ speciesId, population }) => ({ speciesId, population })) });
  assert.deepEqual(activeRecoveryAction(observation, episode, getAiCandidates(observation)), { ...restart, subDistrictIndex: undefined });
});

test("workforce recovery preserves existing player locks and refuses locks on empty jobs", () => {
  const { observation, planet, economy, episode } = fixture();
  const p = planet.planetState;
  p.population = 5_000_000_000; p.speciesPopulations[0].population = p.population;
  p.economy = calculatePlanetEconomy(p);
  assert.equal(workforceForecast(observation, { type: "setPlanetJobLock", planetId: p.id, job: "technician", locked: true }), undefined);
  p.jobLocks.push({ job: "farmer", allocations: [{ speciesId: p.speciesPopulations[0].speciesId, population: 1_000_000_000 }] });
  economy.stockpiles.energy = 300; economy.monthlyDelta.energy = -100;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.notEqual(action?.type, "setPlanetJobLock");
  assert.equal(p.jobLocks.some((lock) => lock.job === "farmer"), true);
});

test("structural energy recovery frees workers when recurring exports cannot cover it", () => {
  const { observation, planet, economy, episode } = fixture();
  const p = planet.planetState;
  p.population = 10_000_000_000; p.speciesPopulations[0].population = p.population;
  p.builtDistricts.mining = 3;
  p.economy = calculatePlanetEconomy(p);
  economy.stockpiles.energy = 500; economy.monthlyDelta.energy = -100;
  economy.stockpiles.minerals = 10000;
  for (const resource of ["minerals", "food", "goods", "alloys"] as const) economy.monthlyDelta[resource] = 0;
  const action = activeRecoveryAction(observation, episode, getAiCandidates(observation));
  assert.equal(action?.type, "setPlanetBuildingEnabled");
  if (action?.type === "setPlanetBuildingEnabled") assert.equal(action.enabled, false);
});

test("new production protects staffed essential jobs before adding competing capacity", () => {
  const { observation, planet, economy } = fixture();
  const p = planet.planetState;
  p.population = 10_000_000_000; p.speciesPopulations[0].population = p.population;
  p.builtDistricts.mining = 3;
  p.buildings.city[3] = createPlanetBuildingState("researchLabs", 1, false);
  p.buildings.city[4] = createPlanetBuildingState("civilianFabricators", 1, false);
  p.economy = calculatePlanetEconomy(p);
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) economy.monthlyDelta[resource] = 100;
  economy.monthlyDelta.energy = 10;
  const project = { type: "buildDistrict" as const, planetId: p.id, districtKind: "mining" as const };
  const lock = protectDevelopmentWorkforce(observation, project);
  assert.deepEqual(lock, { type: "setPlanetJobLock", planetId: p.id, job: "technician", locked: true });
  assert.ok(workforceForecast(observation, lock!, project)!.energy > developmentForecast(observation, project)!.energy + 1);
});

test("active development does not build another factory to bypass a paused one", () => {
  const { observation, planet, economy, episode } = fixture();
  planet.planetState.buildings.city[4] = createPlanetBuildingState("civilianFabricators", 1, false);
  for (const resource of ["food", "energy", "minerals", "goods", "alloys"] as const) {
    economy.stockpiles[resource] = 10000; economy.monthlyDelta[resource] = 100;
  }
  economy.monthlyDelta.goods = -20;
  assert.equal(decideActive(observation, episode).some(({ action }) => action.type === "buildPlanetBuilding" && action.buildingKind === "civilianFabricators"), false);
});
