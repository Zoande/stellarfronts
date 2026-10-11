import { createHeadlessGame, createMemoryAuth, type GameCheckpoint } from "./headless-game";
import { createGameCore } from "../game-runtime";
import { createFleet, createShipFromDesign } from "./fleet-factory";
import { resolveShipDesign } from "./ship-designs";
import { createPlanetBuildingState, RESOURCE_KINDS } from "../../src/data/Economy";
import { STARBASE_LEVEL_DEFINITIONS, calculateStarbaseEconomy } from "../../src/data/Starbase";
import { StarType } from "../../src/data/StarMap";
import { syncPlanetGarrisons } from "./ground-combat";
import { buildHyperlaneAdjacency } from "../../src/data/Hyperlanes";

/** Explicit test setup only. Matched planets, ordinary designs/defenses, no live
 * runtime, accounts or saves. Three equal expeditions begin at rival outposts;
 * home shipyards remain available to train the initially absent mobile armies. */
export function prepareWarCampaign(seed = 42): GameCheckpoint {
  const saved = createHeadlessGame({ worldSeed: seed, simulationSeed: seed, initialWorld: { starCount: 12, factionCount: 3 } }).exportCheckpoint();
  const state = saved.state;
  const templatePlanet = structuredClone(state.planetStates.find((planet) => planet.ownerId === 0 && planet.isHabited)!);
  const templateConfig = structuredClone(state.stars[templatePlanet.starId].system.planets[templatePlanet.planetIndex]);
  const templateGovernment = structuredClone(state.governments[0]);
  const templateTech = structuredClone(state.factionTechnologies[0]);
  state.stars = state.stars.slice(0, 9); state.nebulae = [];
  state.hyperlanes = []; state.starOwnership = []; state.planetStates = []; state.fleets = []; state.ships = [];
  state.armies = []; state.groundBattles = []; state.intelligenceByFaction = {};
  state.startingIntelligenceSeeded = false;
  state.aiSettings = { allowWarDeclarations: true };
  state.leaders = []; // Matched unled forces remove random starting commander bonuses.
  state.caretakerEpisodes = {}; state.passiveEpisodes = {}; state.activeEpisodes = {};
  const baseTemplate = structuredClone(state.starbases[0]); state.starbases = [];
  for (const star of state.stars) {
    const angle = star.id / 9 * Math.PI * 2;
    star.x = Math.cos(angle) * 12; star.z = Math.sin(angle) * 12;
    star.type = StarType.G; delete star.nebulaId;
    star.system.planets = [];
    state.starOwnership[star.id] = Math.floor(star.id / 3);
  }
  for (const faction of state.factions) {
    const id = faction.id, home = id * 3;
    faction.homeStarId = home;
    const speciesId = faction.foundingSpeciesId!;
    const species = state.species.find((entry) => entry.id === speciesId)!;
    species.traitIds = [];
    state.governments[id] = { ...structuredClone(templateGovernment), factionId: id };
    state.factionTechnologies[id] = { ...structuredClone(templateTech), factionId: id };
    for (let offset = 0; offset < 3; offset++) {
      const starId = home + offset;
      const level = offset === 0 ? "starbase" : "outpost";
      const combat = STARBASE_LEVEL_DEFINITIONS[level].combat;
      const slots = [...baseTemplate.buildingSlots]; slots.fill(null); if (!offset) { slots[0] = "shipyard"; slots[1] = "shipyard"; }
      state.starbases.push({ ...structuredClone(baseTemplate), id: `war-base-${starId}`, ownerId: id, starId, level,
        shield: combat.maxShield, maxShield: combat.maxShield, armor: combat.maxArmor, maxArmor: combat.maxArmor,
        hull: combat.maxHull, maxHull: combat.maxHull, buildingSlots: slots, economy: calculateStarbaseEconomy(level, slots) });
      if (offset === 2) continue;
      const planetId = `star-${starId}-planet-0`;
      const config = { ...structuredClone(templateConfig), id: planetId, name: `${faction.name} ${offset ? "Colony" : "Home"}` };
      config.objectDetails.districtLimits = { city: 15, generator: 8, mining: 8, agriculture: 8 };
      config.objectDetails.habitability = 100;
      state.stars[starId].system.planets = [config];
      const planet = { ...structuredClone(templatePlanet), id: planetId, starId, planetIndex: 0, ownerId: id,
        habitability: 100, features: [], population: 18_000_000_000, speciesPopulations: [{ speciesId, population: 18_000_000_000 }] };
      planet.builtDistricts = { city: 6, generator: 3, mining: 4, agriculture: 5 };
      planet.buildings.city[2] = createPlanetBuildingState("housingComplex", 3);
      planet.buildings.city[4] = createPlanetBuildingState("fortress");
      planet.buildings.city[5] = createPlanetBuildingState("civilianFabricators", 3);
      planet.urbanSubDistricts = [
        { kind: "residential", buildings: [createPlanetBuildingState("housingComplex"), createPlanetBuildingState("housingComplex"), null] },
        { kind: "mixedIndustry", buildings: [createPlanetBuildingState("alloyFoundries"), null, null] },
        { kind: "civilianIndustry", buildings: [null, null, null] },
      ];
      planet.jobLocks = ([ ["farmer", 5_988_000_000], ["miner", 5_000_000_000], ["technician", 2_500_000_000],
        ["artisan", 2_500_000_000], ["metallurgist", 500_000_000], ["researcher", 500_000_000], ["soldier", 10_000_000], ["ruler", 500_000_000], ["administrator", 300_000_000], ["sensorManager", 2_000_000], ["enforcer", 100_000_000], ["entertainer", 100_000_000] ] as const)
        .map(([job, population]) => ({ job, allocations: [{ speciesId, population }] }));
      planet.defense.shipyardSlots[0] = { kind: "orbitalShipyard", level: 1, enabled: true };
      state.planetStates.push(planet);
    }
    state.hyperlanes.push([home, home + 1], [home + 1, home + 2], [home + 2, ((id + 1) % 3) * 3]);
    const economy = state.factionEconomies.find((entry) => entry.factionId === id)!;
    for (const resource of RESOURCE_KINDS) economy.stockpiles[resource] = resource === "research" ? 0 : 100_000;
    economy.crewStockpile = 4_000_000;
  }
  state.adjacency = buildHyperlaneAdjacency(state.hyperlanes, state.stars.length);
  const core = createGameCore(saved.game, createMemoryAuth(), { initialState: state, now: () => saved.nowMs });
  for (const faction of state.factions) {
    const id = faction.id;
    const fleetId = `war-navy-${id}`;
    const ships = Array.from({ length: 24 }, () => createShipFromDesign(core.context, id, fleetId, resolveShipDesign(state.shipDesigns, id, "corvette")));
    state.ships.push(...ships);
    const fleet = createFleet(core.context, id, ((id + 1) % 3) * 3 + 1, ships.map((ship) => ship.id), fleetId);
    const opposingBase = state.starbases.find((base) => base.starId === fleet.currentStarId)!;
    fleet.systemPosition = { ...opposingBase.systemPosition, x: opposingBase.systemPosition.x + 1 };
    fleet.combatSettings.engagementRule = "engageSystem";
    state.fleets.push(fleet);
    for (const kind of ["constructionShip", "scienceShip"] as const) {
      const supportId = `war-${kind}-${id}`;
      const ship = createShipFromDesign(core.context, id, supportId, resolveShipDesign(state.shipDesigns, id, kind));
      state.ships.push(ship); state.fleets.push(createFleet(core.context, id, faction.homeStarId, [ship.id], supportId));
    }
  }
  core.context.recalculatePlanetEconomies(); core.context.refreshFactionEconomyDeltas(); syncPlanetGarrisons(core.context);
  core.context.refreshDiscovery();
  for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const outcome = core.executeGameCommand(core.createAiActor(a), { type: "declareWar", targetFactionId: b });
    if (!outcome.ok) throw new Error(`War fixture declaration failed: ${outcome.message}`);
  }
  // Seed ordinary attack orders against the already in-range hostile bases;
  // subsequent runtime ticks perform all targeting and damage calculations.
  for (const faction of state.factions) {
    const outcome = core.executeGameCommand(core.createAiActor(faction.id), { type: "attackSystem", fleetId: `war-navy-${faction.id}`, targetStarId: ((faction.id + 1) % 3) * 3 + 1 });
    if (!outcome.ok) throw new Error(`War fixture attack failed: ${outcome.message}`);
  }
  saved.state = core.context.state;
  saved.enablePassiveAi = true; saved.enableActiveAi = true; saved.activeFactionIds = [0, 1, 2];
  saved.allowAiPeace = false;
  return saved;
}
