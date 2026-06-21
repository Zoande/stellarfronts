// =============================================================================
// Game state birth & rehydration — extracted from server/index.ts
//
// createInitialState builds a fresh galaxy; loadState reads persisted JSON,
// migrates/normalizes it (falling back to a fresh galaxy on any read failure).
// Both take RuntimeContext for game config (seed, statePath) and dirty-flagging;
// they delegate all shaping to the already-extracted normalizer modules.
// =============================================================================

import { readFile } from "node:fs/promises";
import { GALAXY_MAP } from "../../src/data/GalaxyMap";
import {
  generateStarMap,
  buildPlanetStatesFromStars,
  applyPlanetStatesToStars,
  ensureHabitedHomePlanets,
  normalizeCelestialObjectDetails,
  normalizePlanetStates,
} from "../../src/data/StarMap";
import { buildHyperlanePairs, buildHyperlaneAdjacency } from "../../src/data/Hyperlanes";
import { getSystemStarbasePosition } from "../../src/data/SystemCoordinates";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../../src/data/Factions";
import { buildNebulaStarIdSet, generateNebulae, stampNebulaIds } from "../../src/data/Nebula";
import {
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_SHIP_KINDS,
  calculateStarbaseEconomy,
  createEmptyStarbaseSlots,
} from "../../src/data/Starbase";
import type { StarbaseLevel } from "../../src/data/Starbase";
import { createDefaultShipDesign } from "../../src/data/ShipDesigns";
import { createInitialFactionEconomyState } from "../../src/data/Economy";
import { normalizeFactionTechState } from "../../src/data/Technology";
import { createInitialGovernmentStates, normalizeGovernmentStatesForFactions } from "../../src/data/Government";
import { createDefaultSpeciesRightsState } from "../../src/data/Species";
import { createInitialDiplomacyState, normalizeDiplomacyState } from "../../src/data/Diplomacy";
import { createInitialMarketState, normalizeMarketState } from "../../src/data/Market";
import { createInitialLeaders, normalizeLeadersForFactions } from "../../src/data/Leaders";
import {
  GAME_START_YEAR,
  gameYearToMonthIndex,
  gameYearToHourIndex,
  gameYearToWeekIndex,
} from "../../src/game/GameTime";
import type { ServerShip, ServerStarbase } from "../../src/game/GameProtocol";
import { VERSION_MANIFEST, canMigrateFromSchema } from "../versionManifest";
import {
  DEFAULT_TICK_SIZE_DAYS,
  DEFAULT_TICK_SPEED_SECONDS,
} from "./constants";
import { computeSpeedMultiplier, normalizeClock } from "./clock";
import { saveState } from "./persistence";
import { getLeaderDayIndex } from "./state-queries";
import { resolveShipDesign } from "./ship-designs";
import { createFleet, createShipFromDesign } from "./fleet-factory";
import {
  normalizeSpeciesForFactions,
  normalizeSpeciesRightsForFactions,
  assignFoundingSpeciesToOwnedPops,
  normalizeFactionTechnologies,
  normalizeFactionEconomies,
  normalizeShipDesignsForFactions,
  normalizeStarbase,
  normalizeShip,
  normalizeFleet,
  createLegacyFleetFromShip,
  syncFleetMembership,
  syncSystemOwnershipFromStarbases,
} from "./state-normalization";
import { recalculatePlanetEconomies, refreshFactionEconomyDeltas } from "./economy-market";
import { refreshDiscovery } from "./visibility";
import type { GameFleet, GameShip, GameState, RuntimeContext } from "./types";

const SF_VERSION_ID = VERSION_MANIFEST.versionId;

// === EXTRACTED BODY BELOW (ctx threaded as first parameter) ===
export function createInitialState(ctx: RuntimeContext): GameState {
  const cfg = { ...GALAXY_MAP, seed: ctx.game.seed };
  const stars = generateStarMap(
    cfg.width,
    cfg.height,
    cfg.starCount,
    cfg.seed,
    cfg.minStarSpacing,
    cfg.shape,
  );
  const hyperlanes = buildHyperlanePairs(stars, cfg.width, cfg.height, cfg.shape, cfg.seed);
  const adjacency = buildHyperlaneAdjacency(hyperlanes, stars.length);
  const factions = buildFactions(stars, cfg);
  const species = normalizeSpeciesForFactions(factions, []);
  ensureHabitedHomePlanets(stars, factions.map((faction) => faction.homeStarId));
  const homeStarIds = factions.map((faction) => faction.homeStarId);
  const nebulae = generateNebulae(stars, cfg.seed, { avoidStarIds: homeStarIds });
  stampNebulaIds(stars, nebulae);
  const planetStates = buildPlanetStatesFromStars(stars, homeStarIds);
  applyPlanetStatesToStars(stars, planetStates);
  const starOwnership = buildHomeSystemOwnership(stars, factions);
  const starbaseCombat = STARBASE_LEVEL_DEFINITIONS.starbase.combat;
  const starbases = factions.map<ServerStarbase>((faction) => ({
    id: `starbase-${faction.id}`,
    ownerId: faction.id,
    starId: faction.homeStarId,
    systemPosition: getSystemStarbasePosition(),
    status: "online",
    buildProgress: 1,
    shield: starbaseCombat.maxShield,
    maxShield: starbaseCombat.maxShield,
    armor: starbaseCombat.maxArmor,
    maxArmor: starbaseCombat.maxArmor,
    hull: starbaseCombat.maxHull,
    maxHull: starbaseCombat.maxHull,
    lastShieldDamageAtYear: null,
    level: "starbase",
    economy: calculateStarbaseEconomy("starbase"),
    buildingSlots: createEmptyStarbaseSlots(),
    constructionQueue: [],
    shipQueue: [],
  }));
  const shipDesigns = factions.flatMap((faction) => (
    STARBASE_SHIP_KINDS.map((shipKind) => createDefaultShipDesign(faction.id, shipKind, GAME_START_YEAR))
  ));
  const ships: GameShip[] = [];
  const fleets = factions.flatMap<GameFleet>((faction) => {
    const combatFleetId = `fleet-${faction.id}-1`;
    const corvetteDesign = resolveShipDesign(shipDesigns, faction.id, "corvette");
    const corvette = createShipFromDesign(ctx, faction.id, combatFleetId, corvetteDesign, `ship-${faction.id}-1`);
    ships.push(corvette);
    const combatFleet = createFleet(ctx, faction.id, faction.homeStarId, [corvette.id], combatFleetId);
    combatFleet.phaseStartedAtYear = GAME_START_YEAR;
    combatFleet.speed = corvette.speed;

    const constructionFleetId = `fleet-${faction.id}-construction-1`;
    const constructionDesign = resolveShipDesign(shipDesigns, faction.id, "constructionShip");
    const constructionShip = createShipFromDesign(ctx, 
      faction.id,
      constructionFleetId,
      constructionDesign,
      `ship-${faction.id}-construction-1`,
    );
    ships.push(constructionShip);
    const constructionFleet = createFleet(ctx, faction.id, faction.homeStarId, [constructionShip.id], constructionFleetId);
    constructionFleet.phaseStartedAtYear = GAME_START_YEAR;
    constructionFleet.speed = constructionShip.speed;

    return [combatFleet, constructionFleet];
  });

  const now = Date.now();
  const startMonth = gameYearToMonthIndex(GAME_START_YEAR);
  const startHour = gameYearToHourIndex(GAME_START_YEAR);
  const startPopulationWeek = gameYearToWeekIndex(GAME_START_YEAR);
  const startLeaderDay = getLeaderDayIndex(GAME_START_YEAR);
  const created: GameState = {
    schemaVersion: 22,
    stars,
    nebulae,
    planetStates,
    factionEconomies: factions.map((faction) => createInitialFactionEconomyState(faction.id, startMonth)),
    factionTechnologies: factions.map((faction) => normalizeFactionTechState(faction.id, undefined)),
    governments: createInitialGovernmentStates(factions.map((faction) => faction.id)),
    species,
    speciesRights: factions.map((faction) => createDefaultSpeciesRightsState(faction.id, species.map((entry) => entry.id))),
    diplomacy: createInitialDiplomacyState(factions.map((faction) => faction.id)),
    market: createInitialMarketState(factions.map((faction) => faction.id), startHour, GAME_START_YEAR),
    leaders: createInitialLeaders(factions.map((faction) => faction.id), startLeaderDay, GAME_START_YEAR),
    situations: [],
    events: [],
    factionModifiers: [],
    hyperlanes,
    adjacency,
    factions,
    starOwnership,
    starbases,
    shipDesigns,
    ships,
    fleets,
    recentCombatContacts: [],
    discoveredByFaction: {},
    metByFaction: {},
    lastKnownOwnershipByFaction: {},
    clock: {
      year: GAME_START_YEAR,
      tickSizeDays: DEFAULT_TICK_SIZE_DAYS,
      tickSpeedSeconds: DEFAULT_TICK_SPEED_SECONDS,
      paused: false,
      speedMultiplier: computeSpeedMultiplier(DEFAULT_TICK_SIZE_DAYS, DEFAULT_TICK_SPEED_SECONDS, false),
      syncedAtMs: now,
      lastUpdatedAt: now,
      lastProcessedPopulationWeek: startPopulationWeek,
      lastProcessedLeaderDay: startLeaderDay,
    },
  };
  syncSystemOwnershipFromStarbases(created);
  assignFoundingSpeciesToOwnedPops(created);
  created.speciesRights = normalizeSpeciesRightsForFactions(created);
  recalculatePlanetEconomies(created);
  refreshFactionEconomyDeltas(created);

  // Seed each faction's discovery with all other factions' capitals + their adjacent systems.
  // This gives players immediate intel on where rivals started without granting ongoing vision.
  // Nebula systems stay hidden (sensors don't reach inside even at game start).
  const nebulaStarIds = buildNebulaStarIdSet(created.nebulae);
  for (const faction of created.factions) {
    const key = String(faction.id);
    const seeded = new Set<number>(created.discoveredByFaction[key] ?? []);
    for (const other of created.factions) {
      if (other.id === faction.id) continue;
      for (const starId of computeVisibleStarIds(created.adjacency, other.homeStarId, 1, nebulaStarIds)) {
        seeded.add(starId);
      }
    }
    created.discoveredByFaction[key] = Array.from(seeded).sort((a, b) => a - b);
  }

  refreshDiscovery(created);
  return created;
}

export async function loadState(ctx: RuntimeContext): Promise<GameState> {
  try {
    const raw = await readFile(ctx.statePath, "utf8");
    const parsed = JSON.parse(raw) as GameState;
    // Refuse to load a ctx.state this build cannot migrate (e.g. a newer schema
    // opened by an older version). The orchestrator gates updates so this is a
    // last-line guard against save corruption.
    const onDiskSchema = Number(parsed.schemaVersion);
    if (Number.isFinite(onDiskSchema) && !canMigrateFromSchema(VERSION_MANIFEST, onDiskSchema)) {
      throw new Error(
        `Game ${ctx.game.id} ctx.state schema ${onDiskSchema} is not loadable by version ${SF_VERSION_ID} (supports ${VERSION_MANIFEST.migratesFromSchema.join(",")}).`,
      );
    }
    parsed.schemaVersion = 22;
    delete (parsed as GameState & { battles?: unknown }).battles;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    // Backfill nebulas for pre-nebula saves: regenerate deterministically from the
    // game seed and re-stamp each star's nebulaId, then let refreshDiscovery (run by
    // the caller) recompute visibility with nebula blocking applied.
    if (!Array.isArray(parsed.nebulae)) {
      parsed.nebulae = generateNebulae(parsed.stars, ctx.game.seed, {
        avoidStarIds: parsed.factions.map((faction) => faction.homeStarId),
      });
    }
    stampNebulaIds(parsed.stars, parsed.nebulae);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
    parsed.metByFaction = parsed.metByFaction ?? {};
    parsed.situations = Array.isArray(parsed.situations) ? parsed.situations : [];
    parsed.events = Array.isArray(parsed.events) ? parsed.events : [];
    parsed.factionModifiers = Array.isArray(parsed.factionModifiers) ? parsed.factionModifiers : [];
    parsed.lastKnownOwnershipByFaction = parsed.lastKnownOwnershipByFaction ?? {};
    parsed.recentCombatContacts = [];
    parsed.shipDesigns = normalizeShipDesignsForFactions(parsed.factions, parsed.shipDesigns, parsed.clock?.year ?? GAME_START_YEAR);
    parsed.clock = normalizeClock(parsed.clock);
    const factionsBeforeSpecies = JSON.stringify(parsed.factions ?? []);
    const rawSpecies = (parsed as GameState & { species?: unknown }).species;
    parsed.species = normalizeSpeciesForFactions(parsed.factions, rawSpecies);
    const speciesChanged = JSON.stringify(rawSpecies ?? []) !== JSON.stringify(parsed.species)
      || factionsBeforeSpecies !== JSON.stringify(parsed.factions ?? []);
    const normalizedMarket = normalizeMarketState(
      parsed.market,
      parsed.factions.map((faction) => faction.id),
      gameYearToHourIndex(parsed.clock.year),
      parsed.clock.year,
    );
    parsed.market = normalizedMarket.state;
    if (normalizedMarket.changed) ctx.hasDirtyState = true;
    const homeStarIds = new Set(parsed.factions.map((faction) => faction.homeStarId));
    let homeStarbaseChanged = false;
    parsed.starbases = (parsed.starbases ?? []).map((starbase) => {
      const normalized = normalizeStarbase(starbase);
      if (homeStarIds.has(normalized.starId) && normalized.level === "outpost") {
        homeStarbaseChanged = true;
        return {
          ...normalized,
          level: "starbase" as StarbaseLevel,
          economy: calculateStarbaseEconomy("starbase", normalized.buildingSlots),
        };
      }
      return normalized;
    });
    const rawShips = Array.isArray(parsed.ships) ? parsed.ships : [];
    const rawFleets = Array.isArray(parsed.fleets) ? parsed.fleets : [];
    if (rawFleets.length === 0 && rawShips.length > 0) {
      parsed.fleets = rawShips.map((ship) => createLegacyFleetFromShip(ctx, ship as Parameters<typeof createLegacyFleetFromShip>[1]));
      parsed.ships = rawShips.map((ship) => {
        const legacyFleetId = (ship as Partial<ServerShip>).fleetId || ship.id.replace(/^ship/, "fleet");
        return normalizeShip(ship, legacyFleetId, parsed.shipDesigns);
      });
      ctx.hasDirtyState = true;
    } else {
      parsed.fleets = rawFleets.map((fleet) => normalizeFleet(ctx, fleet));
      const fallbackFleetId = parsed.fleets[0]?.id ?? "fleet-0";
      parsed.ships = rawShips.map((ship) => normalizeShip(ship, ship.fleetId || fallbackFleetId, parsed.shipDesigns));
    }
    if (syncFleetMembership(ctx, parsed)) {
      ctx.hasDirtyState = true;
    }
    const ownershipChanged = syncSystemOwnershipFromStarbases(parsed);
    const metadataChanged = normalizeCelestialObjectDetails(parsed.stars);
    const habitationChanged = ensureHabitedHomePlanets(
      parsed.stars,
      parsed.factions.map((faction) => faction.homeStarId),
    );
    const normalizedPlanetStates = normalizePlanetStates(
      parsed.stars,
      parsed.planetStates ?? [],
      parsed.factions.map((faction) => faction.homeStarId),
    );
    parsed.planetStates = normalizedPlanetStates.planetStates;
    const normalizedGovernments = normalizeGovernmentStatesForFactions(
      parsed.factions.map((faction) => faction.id),
      parsed.governments,
    );
    const governmentsChanged = JSON.stringify(parsed.governments ?? []) !== JSON.stringify(normalizedGovernments);
    parsed.governments = normalizedGovernments;
    const rawSpeciesRights = (parsed as GameState & { speciesRights?: unknown }).speciesRights;
    parsed.speciesRights = normalizeSpeciesRightsForFactions(parsed, rawSpeciesRights);
    const speciesRightsChanged = JSON.stringify(rawSpeciesRights ?? []) !== JSON.stringify(parsed.speciesRights);
    const speciesPopulationChanged = assignFoundingSpeciesToOwnedPops(parsed);
    recalculatePlanetEconomies(parsed);
    const normalizedFactionEconomies = normalizeFactionEconomies(parsed);
    const factionEconomiesChanged = JSON.stringify(parsed.factionEconomies ?? []) !== JSON.stringify(normalizedFactionEconomies);
    parsed.factionEconomies = normalizedFactionEconomies;
    const normalizedFactionTechnologies = normalizeFactionTechnologies(parsed);
    const factionTechnologiesChanged = JSON.stringify(parsed.factionTechnologies ?? []) !== JSON.stringify(normalizedFactionTechnologies);
    parsed.factionTechnologies = normalizedFactionTechnologies;
    const normalizedDiplomacy = normalizeDiplomacyState(
      parsed.diplomacy,
      parsed.factions.map((faction) => faction.id),
    );
    parsed.diplomacy = normalizedDiplomacy.state;
    const normalizedLeaders = normalizeLeadersForFactions(
      parsed.factions.map((faction) => faction.id),
      parsed.leaders,
      getLeaderDayIndex(parsed.clock.year),
      parsed.clock.year,
    );
    const leadersChanged = JSON.stringify(parsed.leaders ?? []) !== JSON.stringify(normalizedLeaders);
    parsed.leaders = normalizedLeaders;
    recalculatePlanetEconomies(parsed);
    refreshFactionEconomyDeltas(parsed);
    const planetStateApplied = applyPlanetStatesToStars(parsed.stars, parsed.planetStates);
    if (metadataChanged || habitationChanged || normalizedPlanetStates.changed || planetStateApplied || factionEconomiesChanged || factionTechnologiesChanged || governmentsChanged || speciesChanged || speciesRightsChanged || speciesPopulationChanged || normalizedDiplomacy.changed || leadersChanged || homeStarbaseChanged || ownershipChanged) {
      ctx.hasDirtyState = true;
    }
    refreshDiscovery(parsed);
    return parsed;
  } catch {
    const initial = createInitialState(ctx);
    await saveState(ctx, initial);
    return initial;
  }
}
