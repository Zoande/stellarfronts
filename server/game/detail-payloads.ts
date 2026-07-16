// =============================================================================
// Detail / sub-panel payload builders — extracted from server/index.ts
//
// These assemble the on-demand detail payloads (system, market, diplomacy,
// society, fleet/planet managers, HUD, …) requested via subscriptions. They
// read RuntimeContext and reuse the snapshot/visibility/economy view helpers;
// the socket dispatch (sendDetailEvent / handleRequestDetails) stays in index.ts.
// =============================================================================

import { MARKET_FEE_RATE } from "../../src/data/Market";
import {
  TREATY_ARTICLE_DEFINITIONS,
  TRADE_PRIVILEGE_ARTICLE_ID,
  MIGRATION_PACT_ARTICLE_ID,
  getBorderPolicy,
  areFactionsAtWar,
  getActiveTreatiesBetween,
  isTreatyArticleSuspended,
} from "../../src/data/Diplomacy";
import type { BorderPolicy, DiplomacyWar } from "../../src/data/Diplomacy";
import type { GalaxyPerspective } from "../../src/data/Factions";
import { PlanetType, createPlanetStateFromConfig } from "../../src/data/StarMap";
import type { PlanetConfig } from "../../src/data/StarMap";
import type { PlanetState } from "../../src/data/Economy";
import type { IntelEntityView, IntelValue } from "../../src/data/Intelligence";
import { getLegalSpeciesRightsOptions } from "../../src/data/Species";
import type {
  DiplomacyDetailPayload,
  DiplomacyEligiblePeaceTransferSystem,
  FactionState,
  GameDetailPayload,
  GameDetailScope,
  MarketDetailPayload,
  MarketResourceQuote,
  ServerFleet,
  ServerShip,
  ServerStarbase,
  SocietyDetailPayload,
  SystemDetailPayload,
} from "../../src/game/GameProtocol";
import { buildSystemDetailPayload, createSystemDetailRevision } from "./system-view";
import {
  calculateFactionResourceFlow,
  calculatePlayerMarketQuote,
  getReadonlyMarketPlayerStats,
  getMarketPriceHistory,
  getMarketTrend,
} from "./economy-market";
import { getKnownSet } from "./visibility";
import { getIntelEntityView, getKnownStarIds, getPerspectiveEntityView, hasCommandLink } from "./intelligence";
import { createVisibleState, createVisibleStars, createRevision } from "./snapshot";
import {
  getSpeciesLawSelections,
  getEmpireSpeciesIds,
  getSpeciesRightsForFaction,
  getFactionGovernment,
  getPlanetConfig,
  getPlanetState,
  canAccessPlanet,
  canAccessStarbase,
} from "./state-queries";
import type { RuntimeContext } from "./types";

function intelValue<T>(view: IntelEntityView | null, fieldId: string, fallback: T): T {
  const field = view?.fields[fieldId] as IntelValue<T> | undefined;
  return field && field.status !== "unknown" ? field.value : fallback;
}

function createPartialPlanetDetail(
  ctx: RuntimeContext,
  perspective: GalaxyPerspective,
  sourceState: PlanetState,
  sourcePlanet: PlanetConfig,
) {
  if (perspective.mode === "observer") {
    return { planet: sourcePlanet, planetState: sourceState, intelligence: [getPerspectiveEntityView(ctx.state, perspective, "planet", sourceState.id)!], commandLinked: true };
  }
  const view = getIntelEntityView(ctx.state, perspective.factionId, "planet", sourceState.id);
  if (!view || !view.fields.existence) return null;
  const zeroDistricts = { city: 0, generator: 0, mining: 0, agriculture: 0 };
  const limits = intelValue(view, "districtLimits", zeroDistricts);
  const planet: PlanetConfig = {
    id: sourceState.id,
    type: intelValue(view, "type", PlanetType.Barren),
    textureVariation: intelValue(view, "textureVariation", 0),
    diameter: intelValue(view, "diameter", 1),
    orbitRadius: intelValue(view, "orbitRadius", 1),
    orbitSpeed: intelValue(view, "orbitSpeed", 0),
    orbitPhaseAtEpoch: intelValue(view, "orbitPhaseAtEpoch", 0),
    orbitEpochMs: intelValue(view, "orbitEpochMs", 0),
    name: intelValue(view, "name", "????"),
    isHabited: intelValue(view, "isHabited", false),
    objectDetails: {
      size: intelValue(view, "objectDetails.size", intelValue(view, "diameter", 1)),
      typeName: intelValue(view, "objectDetails.typeName", "?"),
      description: intelValue(view, "objectDetails.description", "No intelligence available."),
      habitability: intelValue(view, "habitability", null),
      districtLimits: limits,
      builtDistricts: intelValue(view, "builtDistricts", zeroDistricts),
    },
  };
  const empty = createPlanetStateFromConfig(sourceState.starId, sourceState.planetIndex, planet, {
    id: sourceState.id,
    ownerId: intelValue(view, "ownerId", null),
    isHabited: intelValue(view, "isHabited", false),
    population: 0,
  }, [], { starterInfrastructure: false, startingPopulation: 0 });
  const planetState: PlanetState = {
    ...empty,
    ownerId: intelValue(view, "ownerId", null),
    isHabited: intelValue(view, "isHabited", false),
    habitability: intelValue(view, "habitability", null),
    population: intelValue(view, "population", 0),
    speciesPopulations: intelValue(view, "speciesPopulations", []),
    features: intelValue(view, "features", []),
    builtDistricts: intelValue(view, "builtDistricts", zeroDistricts),
    buildings: intelValue(view, "buildings", empty.buildings),
    urbanSubDistricts: intelValue(view, "urbanSubDistricts", []),
    constructionQueue: intelValue(view, "constructionQueue", []),
    modifiers: intelValue(view, "modifiers", []),
    economy: intelValue(view, "economy", empty.economy),
  };
  return {
    planet,
    planetState,
    intelligence: [view],
    commandLinked: hasCommandLink(ctx.state, perspective.factionId, sourceState.starId),
  };
}

function createPartialStarbase(source: ServerStarbase, view: IntelEntityView): ServerStarbase {
  return {
    id: source.id,
    ownerId: intelValue(view, "ownerId", -1),
    starId: intelValue(view, "starId", -1),
    systemPosition: intelValue(view, "systemPosition", { x: 0, y: 0, z: 0 }),
    status: intelValue(view, "status", "building"),
    buildProgress: intelValue(view, "buildProgress", 0),
    level: intelValue(view, "level", "outpost"),
    economy: intelValue(view, "economy", {
      production: { energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 },
      consumption: { energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 },
      net: { energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 },
      upkeep: { energy: 0, minerals: 0, food: 0, goods: 0, alloys: 0, research: 0 },
    }),
    buildingSlots: intelValue(view, "buildingSlots", []),
    constructionQueue: intelValue(view, "constructionQueue", []),
    shipQueue: intelValue(view, "shipQueue", []),
    shield: intelValue(view, "shield", 0),
    maxShield: intelValue(view, "maxShield", 0),
    armor: intelValue(view, "armor", 0),
    maxArmor: intelValue(view, "maxArmor", 0),
    hull: intelValue(view, "hull", 0),
    maxHull: intelValue(view, "maxHull", 0),
    weaponCooldowns: intelValue(view, "weaponCooldowns", {}),
    lastShieldDamageAtYear: null,
  };
}

function createPartialFleet(source: ServerFleet, view: IntelEntityView): ServerFleet {
  const telemetry = view.fields.telemetry as IntelValue<ServerFleet> | undefined;
  if (telemetry && telemetry.status !== "unknown") return telemetry.value;
  const shipCountIntel = view.fields.shipCount as IntelValue<number> | undefined;
  const placeholderShipCount = shipCountIntel && shipCountIntel.status !== "unknown" ? Math.max(0, Number(shipCountIntel.value) || 0) : 1;
  return {
    id: source.id,
    ownerId: intelValue(view, "ownerId", -1),
    stationaryStarbaseId: intelValue(view, "stationaryStarbaseId", null),
    shipIds: Array.from({ length: placeholderShipCount }, (_, index) => `unknown:${source.id}:${index}`),
    formation: intelValue(view, "formation", "line"),
    currentStarId: intelValue(view, "currentStarId", -1),
    targetStarId: null,
    phase: "idle",
    phaseStartedAtYear: 0,
    phaseDurationDays: 0,
    route: [],
    routeIndex: 0,
    phaseProgress: 0,
    orderType: null,
    speed: 0,
    combatStance: "passive",
    retreatState: null,
    systemPosition: { x: 0, y: 0, z: 0 },
    hyperlanePosition: intelValue(view, "hyperlanePosition", null),
    movementPlan: null,
    orbitTargetPlanetId: null,
    orbitOffset: null,
    orbitTarget: null,
    mergeTargetFleetId: null,
    combatSettings: {
      behavior: "line",
      chasePolicy: "none",
      retreatPolicy: "none",
    },
    currentTacticalOrder: null,
    tacticalRadius: 0,
    maxWeaponRange: 0,
    minWeaponRange: 0,
    currentTargetId: null,
    currentTargetKind: null,
    combatStatus: "idle",
    lastCombatAtYear: null,
  };
}

function createPartialShip(source: ServerShip, view: IntelEntityView): ServerShip {
  const telemetry = view.fields.telemetry as IntelValue<ServerShip> | undefined;
  if (telemetry && telemetry.status !== "unknown") return telemetry.value;
  return {
    id: source.id,
    ownerId: intelValue(view, "ownerId", -1),
    fleetId: intelValue(view, "fleetId", ""),
    shipKind: intelValue(view, "shipKind", "corvette"),
    speed: 0, hp: 0, maxHp: 0, shield: 0, maxShield: 0,
    armor: 0, maxArmor: 0, hull: 0, maxHull: 0,
  };
}

export function getVisibleFullStarbases(ctx: RuntimeContext, perspective: GalaxyPerspective): ServerStarbase[] {
  if (perspective.mode === "observer") return ctx.state.starbases;
  return ctx.state.starbases.flatMap((starbase) => {
    const view = getIntelEntityView(ctx.state, perspective.factionId, "starbase", starbase.id);
    return view?.fields.existence ? [createPartialStarbase(starbase, view)] : [];
  });
}

export function getVisibleFullFleets(ctx: RuntimeContext, perspective: GalaxyPerspective): ServerFleet[] {
  if (perspective.mode === "observer") return ctx.state.fleets;
  return ctx.state.fleets.flatMap((fleet) => {
    const view = getIntelEntityView(ctx.state, perspective.factionId, "fleet", fleet.id);
    return view?.fields.existence ? [createPartialFleet(fleet, view)] : [];
  });
}

export function getVisibleFullShips(
  ctx: RuntimeContext,
  perspective: GalaxyPerspective,
  fleets = getVisibleFullFleets(ctx, perspective),
): ServerShip[] {
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  if (perspective.mode === "observer") return ctx.state.ships.filter((ship) => visibleFleetIds.has(ship.fleetId));
  return ctx.state.ships.flatMap((ship) => {
    if (!visibleFleetIds.has(ship.fleetId)) return [];
    const view = getIntelEntityView(ctx.state, perspective.factionId, "ship", ship.id);
    return view?.fields.existence ? [createPartialShip(ship, view)] : [];
  });
}

export function createVisibleDetailState(ctx: RuntimeContext, perspective: GalaxyPerspective) {
  const visibleState = createVisibleState(ctx, perspective);
  const fleets = getVisibleFullFleets(ctx, perspective);
  return {
    ...visibleState,
    fleets,
    ships: getVisibleFullShips(ctx, perspective, fleets),
    starbases: getVisibleFullStarbases(ctx, perspective),
  };
}

export function createSystemDetailPayload(
  ctx: RuntimeContext,
  perspective: GalaxyPerspective,
  starId: number,
): { payload: SystemDetailPayload; revision: string; normalizedId: number } | { error: string } {
  const knownSet = getKnownSet(ctx, perspective);
  const visibleState = createVisibleState(ctx, perspective);
  const visibleStars = createVisibleStars(ctx, perspective, knownSet);
  const ownerByStar = new Array<number>(ctx.state.stars.length).fill(-1);
  for (const [ownedStarId, ownerId] of visibleState.starOwnership) {
    if (ownedStarId >= 0 && ownedStarId < ownerByStar.length) ownerByStar[ownedStarId] = ownerId;
  }
  const visibleFleets = getVisibleFullFleets(ctx, perspective);
  const result = buildSystemDetailPayload({
    perspective,
    starId,
    stars: ctx.state.stars,
    visibleStars,
    knownStarIds: knownSet,
    hyperlanes: visibleState.hyperlanes,
    planetStates: ctx.state.planetStates,
    fleets: visibleFleets,
    ships: getVisibleFullShips(ctx, perspective, visibleFleets),
    starbases: getVisibleFullStarbases(ctx, perspective),
    recentCombatContacts: visibleState.recentCombatContacts,
    combatProjectiles: visibleState.combatProjectiles,
    combatReports: visibleState.combatReports,
    factions: visibleState.factions,
    shipDesigns: visibleState.shipDesigns,
    technologies: visibleState.technologies,
    starOwnership: ownerByStar,
  });
  if (!result.ok) return { error: result.error };
  if (perspective.mode === "faction") {
    const partials = ctx.state.planetStates
      .filter((planetState) => planetState.starId === starId)
      .map((planetState) => {
        const planet = getPlanetConfig(ctx, planetState);
        return planet ? createPartialPlanetDetail(ctx, perspective, planetState, planet) : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    result.payload.star = {
      ...visibleStars[starId],
      system: { planets: partials.map((entry) => entry.planet) },
    };
    result.payload.planetStates = partials.map((entry) => entry.planetState);
    result.payload.intelligence = [
      getPerspectiveEntityView(ctx.state, perspective, "star", starId),
      getPerspectiveEntityView(ctx.state, perspective, "system", starId),
      ...partials.flatMap((entry) => entry.intelligence),
    ].filter((entry): entry is IntelEntityView => entry !== null);
    result.payload.commandLinked = hasCommandLink(ctx.state, perspective.factionId, starId);
  } else {
    result.payload.intelligence = [
      getPerspectiveEntityView(ctx.state, perspective, "star", starId)!,
      getPerspectiveEntityView(ctx.state, perspective, "system", starId)!,
    ];
    result.payload.commandLinked = true;
  }
  return {
    payload: result.payload,
    revision: createSystemDetailRevision(result.payload),
    normalizedId: starId,
  };
}

export function createMarketDetailPayload(ctx: RuntimeContext, perspective: GalaxyPerspective): MarketDetailPayload {
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  const flows = factionId === null ? undefined : calculateFactionResourceFlow(ctx.state, factionId);
  const playerStats = getReadonlyMarketPlayerStats(ctx, factionId);
  const resources = ctx.state.market.resources.map<MarketResourceQuote>((resource) => {
    const quote = calculatePlayerMarketQuote(resource, factionId, flows, ctx.state);
    return {
      resourceId: resource.resourceId,
      basePrice: resource.basePrice,
      currentPrice: resource.currentPrice,
      liquidity: resource.liquidity,
      temporaryPressure: resource.temporaryPressure,
      persistentPressure: resource.persistentPressure,
      marketEnabled: resource.marketEnabled,
      lastUpdatedAt: resource.lastUpdatedAt,
      finalQuotePrice: quote.finalQuotePrice,
      buyPrice: quote.buyPrice,
      sellPrice: quote.sellPrice,
      marketFee: MARKET_FEE_RATE,
      ownedAmount: quote.ownedAmount,
      productionPerHour: quote.productionPerHour,
      consumptionPerHour: quote.consumptionPerHour,
      internalSupply: quote.internalSupply,
      internalDemand: quote.internalDemand,
      playerInternalModifier: quote.playerInternalModifier,
      totalExportsEnergy: playerStats?.totalExportsEnergy ?? 0,
      totalImportsEnergy: playerStats?.totalImportsEnergy ?? 0,
      priceHistory: getMarketPriceHistory(ctx, resource.resourceId),
      trend: getMarketTrend(ctx, resource.resourceId, resource.currentPrice),
    };
  });

  return {
    resources,
    playerStats,
    autoTrades: factionId === null
      ? []
      : ctx.state.market.autoTrades.filter((order) => order.playerId === factionId),
    transactions: factionId === null
      ? ctx.state.market.transactions.slice(-24)
      : ctx.state.market.transactions.filter((transaction) => transaction.playerId === factionId).slice(-24),
    marketFee: MARKET_FEE_RATE,
  };
}

export function createDiplomacyDetailPayload(ctx: RuntimeContext, perspective: GalaxyPerspective): DiplomacyDetailPayload {
  const playerFactionId = perspective.mode === "faction" ? perspective.factionId : null;
  const factions: FactionState[] = ctx.state.factions.map((faction) => ({
    ...faction,
    discoveredStarIds: Array.from(getKnownStarIds(ctx.state, faction.id)),
  }));
  const activeWars = ctx.state.diplomacy.wars.filter((war) => !Number.isFinite(war.endedAtYear ?? Number.NaN));
  const activeTreaties = ctx.state.diplomacy.treaties.filter((treaty) => !Number.isFinite(treaty.cancelledAtYear ?? Number.NaN));
  const pendingProposals = ctx.state.diplomacy.proposals.filter((proposal) => proposal.status === "pending");
  const pairRelevant = (factionA: number, factionB: number): boolean => (
    playerFactionId === null || factionA === playerFactionId || factionB === playerFactionId
  );
  const countries = factions.map((faction) => {
    const activeBetween = playerFactionId === null
      ? []
      : getActiveTreatiesBetween(ctx.state.diplomacy, playerFactionId, faction.id);
    const tradePrivilegeTreaty = activeBetween.some((treaty) => treaty.articleIds.includes(TRADE_PRIVILEGE_ARTICLE_ID));
    const migrationPactTreaty = activeBetween.some((treaty) => treaty.articleIds.includes(MIGRATION_PACT_ARTICLE_ID));
    return {
      faction,
      isSelf: playerFactionId === faction.id,
      atWar: playerFactionId !== null && areFactionsAtWar(ctx.state.diplomacy, playerFactionId, faction.id),
      ourBorderPolicy: playerFactionId === null ? "closed" as BorderPolicy : getBorderPolicy(ctx.state.diplomacy, playerFactionId, faction.id),
      theirBorderPolicy: playerFactionId === null ? "closed" as BorderPolicy : getBorderPolicy(ctx.state.diplomacy, faction.id, playerFactionId),
      activeTreatyCount: activeBetween.length,
      pendingProposalCount: playerFactionId === null
        ? 0
        : pendingProposals.filter((proposal) => (
          (proposal.fromFactionId === playerFactionId && proposal.toFactionId === faction.id)
          || (proposal.fromFactionId === faction.id && proposal.toFactionId === playerFactionId)
        )).length,
      tradePrivilegeActive: playerFactionId !== null
        && tradePrivilegeTreaty
        && !isTreatyArticleSuspended(ctx.state.diplomacy, TRADE_PRIVILEGE_ARTICLE_ID, playerFactionId, faction.id),
      tradePrivilegeSuspended: playerFactionId !== null
        && tradePrivilegeTreaty
        && isTreatyArticleSuspended(ctx.state.diplomacy, TRADE_PRIVILEGE_ARTICLE_ID, playerFactionId, faction.id),
      migrationPactActive: playerFactionId !== null
        && migrationPactTreaty
        && !isTreatyArticleSuspended(ctx.state.diplomacy, MIGRATION_PACT_ARTICLE_ID, playerFactionId, faction.id),
      migrationPactSuspended: playerFactionId !== null
        && migrationPactTreaty
        && isTreatyArticleSuspended(ctx.state.diplomacy, MIGRATION_PACT_ARTICLE_ID, playerFactionId, faction.id),
    };
  });
  const wars = playerFactionId === null
    ? activeWars
    : activeWars.filter((war) => pairRelevant(war.attackerFactionId, war.defenderFactionId));
  const treaties = playerFactionId === null
    ? activeTreaties
    : activeTreaties.filter((treaty) => pairRelevant(treaty.factionIds[0], treaty.factionIds[1]));
  const proposals = playerFactionId === null
    ? pendingProposals
    : pendingProposals.filter((proposal) => pairRelevant(proposal.fromFactionId, proposal.toFactionId));
  const chatMessages = playerFactionId === null
    ? ctx.state.diplomacy.chatMessages
    : ctx.state.diplomacy.chatMessages.filter((message) => (
      message.fromFactionId === playerFactionId || message.toFactionId === playerFactionId
    ));
  const eligiblePeaceTransferSystems = createEligiblePeaceTransferSystems(ctx, playerFactionId, wars);

  return {
    countries,
    wars,
    treaties,
    proposals,
    chatMessages,
    eligiblePeaceTransferSystems,
    treatyArticles: TREATY_ARTICLE_DEFINITIONS,
    playerFactionId,
  };
}

export function createEligiblePeaceTransferSystems(
  ctx: RuntimeContext,
  playerFactionId: number | null,
  wars: DiplomacyWar[],
): DiplomacyEligiblePeaceTransferSystem[] {
  const rows: DiplomacyEligiblePeaceTransferSystem[] = [];
  for (const war of wars) {
    if (
      playerFactionId !== null
      && war.attackerFactionId !== playerFactionId
      && war.defenderFactionId !== playerFactionId
    ) {
      continue;
    }
    for (const starbase of ctx.state.starbases) {
      if (starbase.ownerId !== war.attackerFactionId && starbase.ownerId !== war.defenderFactionId) continue;
      const toFactionId = starbase.ownerId === war.attackerFactionId ? war.defenderFactionId : war.attackerFactionId;
      const star = ctx.state.stars[starbase.starId];
      rows.push({
        starbaseId: starbase.id,
        starId: starbase.starId,
        starName: star?.name ?? `System ${starbase.starId}`,
        ownerId: starbase.ownerId,
        ownerName: ctx.state.factions.find((faction) => faction.id === starbase.ownerId)?.name ?? `Faction ${starbase.ownerId}`,
        fromFactionId: starbase.ownerId,
        toFactionId,
      });
    }
  }
  return rows.sort((a, b) => a.starName.localeCompare(b.starName));
}

export function createSocietyDetailPayload(ctx: RuntimeContext, perspective: GalaxyPerspective): SocietyDetailPayload {
  const playerFactionId = perspective.mode === "faction" ? perspective.factionId : null;
  const laws = playerFactionId === null
    ? { civilRights: "civicRegistry", speciesPolicy: "managedResidency" }
    : {
      civilRights: getSpeciesLawSelections(ctx.state, playerFactionId).civilRights ?? "civicRegistry",
      speciesPolicy: getSpeciesLawSelections(ctx.state, playerFactionId).speciesPolicy ?? "managedResidency",
    };
  const speciesIds = playerFactionId === null
    ? ctx.state.species.map((species) => species.id)
    : getEmpireSpeciesIds(ctx.state, playerFactionId);
  const speciesIdSet = new Set(speciesIds);
  const species = ctx.state.species.filter((entry) => speciesIdSet.has(entry.id));
  const rights = playerFactionId === null
    ? null
    : {
      factionId: playerFactionId,
      rightsBySpeciesId: Object.fromEntries(species.map((entry) => [
        entry.id,
        getSpeciesRightsForFaction(ctx.state, playerFactionId, entry.id),
      ])),
    };
  const faction = playerFactionId === null
    ? null
    : {
      ...ctx.state.factions.find((candidate) => candidate.id === playerFactionId)!,
      discoveredStarIds: Array.from(getKnownStarIds(ctx.state, playerFactionId)),
    };
  const planets = ctx.state.planetStates
    .filter((planetState) => planetState.isHabited)
    .filter((planetState) => playerFactionId === null || planetState.ownerId === playerFactionId)
    .map((planetState) => {
      const star = ctx.state.stars[planetState.starId];
      const planet = getPlanetConfig(ctx, planetState);
      const groups = planetState.economy.popGroups;
      const groupPopulation = groups.reduce((sum, group) => sum + group.population, 0);
      const averageHappiness = groupPopulation > 0
        ? groups.reduce((sum, group) => sum + group.happiness * group.population, 0) / groupPopulation
        : planetState.economy.happiness;
      const averageHabitability = groupPopulation > 0
        ? groups.reduce((sum, group) => sum + Number(group.habitability ?? planetState.habitability ?? 0) * group.population, 0) / groupPopulation
        : Number(planetState.habitability ?? 0);
      return {
        planetId: planetState.id,
        planetName: planet?.name ?? planetState.id,
        starId: planetState.starId,
        starName: star?.name ?? `System ${planetState.starId}`,
        population: planetState.population,
        speciesPopulations: (planetState.speciesPopulations ?? []).filter((population) => speciesIdSet.has(population.speciesId)),
        averageHappiness,
        averageHabitability,
      };
    });

  return {
    playerFactionId,
    faction,
    species,
    rights,
    legalOptions: getLegalSpeciesRightsOptions(laws),
    government: playerFactionId === null ? null : getFactionGovernment(ctx.state, playerFactionId),
    factionEconomy: playerFactionId === null ? null : ctx.state.factionEconomies.find((economy) => economy.factionId === playerFactionId) ?? null,
    planets,
    laws,
  };
}

export function createDetailPayload(
  ctx: RuntimeContext,
  perspective: GalaxyPerspective,
  scope: GameDetailScope,
  id: string | number | null | undefined,
): { payload: GameDetailPayload; revision: string; normalizedId: string | number | null } | { error: string } {
  if (scope === "system") {
    const starId = Number(id);
    if (!Number.isInteger(starId)) return { error: "System is not available." };
    return createSystemDetailPayload(ctx, perspective, starId);
  }

  if (scope === "planet") {
    const planetId = String(id ?? "");
    const planetState = getPlanetState(ctx, planetId);
    if (!planetState || !canAccessPlanet(ctx, perspective, planetState)) return { error: "Planet is not available." };
    const planet = getPlanetConfig(ctx, planetState);
    if (!planet) return { error: "Planet details are unavailable." };
    const partial = createPartialPlanetDetail(ctx, perspective, planetState, planet);
    if (!partial) return { error: "Planet is not available." };
    const payload = { starId: planetState.starId, ...partial };
    return { payload, revision: createRevision(payload), normalizedId: planetId };
  }

  if (scope === "starbase") {
    const starbaseId = String(id ?? "");
    const starbase = ctx.state.starbases.find((candidate) => candidate.id === starbaseId);
    if (!starbase || !canAccessStarbase(ctx, perspective, starbase)) return { error: "Starbase is not available." };
    const view = getPerspectiveEntityView(ctx.state, perspective, "starbase", starbaseId);
    if (!view || !view.fields.existence) return { error: "Starbase is not available." };
    const payload = {
      starbase: perspective.mode === "observer" ? starbase : createPartialStarbase(starbase, view),
      intelligence: [view],
      commandLinked: perspective.mode === "observer" || hasCommandLink(ctx.state, perspective.factionId, starbase.starId),
    };
    return { payload, revision: createRevision(payload), normalizedId: starbaseId };
  }

  if (scope === "fleet") {
    const fleetId = String(id ?? "");
    const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
    const view = getPerspectiveEntityView(ctx.state, perspective, "fleet", fleetId);
    if (!fleet || !view || !view.fields.existence) return { error: "Fleet is not available." };
    const partialFleet = perspective.mode === "observer" ? fleet : createPartialFleet(fleet, view);
    const shipViews = fleet.shipIds
      .map((shipId) => getPerspectiveEntityView(ctx.state, perspective, "ship", shipId))
      .filter((entry): entry is IntelEntityView => entry !== null && !!entry.fields.existence);
    const payload = {
      fleet: partialFleet,
      ships: ctx.state.ships.filter((ship) => ship.fleetId === fleet.id).flatMap((ship) => {
        if (perspective.mode === "observer") return [ship];
        const shipView = getIntelEntityView(ctx.state, perspective.factionId, "ship", ship.id);
        return shipView?.fields.existence ? [createPartialShip(ship, shipView)] : [];
      }),
      intelligence: [view, ...shipViews],
      commandLinked: perspective.mode === "observer"
        || (!fleet.hyperlanePosition && hasCommandLink(ctx.state, perspective.factionId, fleet.currentStarId)),
    };
    return { payload, revision: createRevision(payload), normalizedId: fleetId };
  }

  if (scope === "fleetManager") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const payload = {
      fleets: detailState.fleets,
      ships: detailState.ships,
      shipDesigns: detailState.shipDesigns,
      starbases: detailState.starbases,
      technologies: detailState.technologies,
      leaders: detailState.leaders,
      factionEconomies: detailState.factionEconomies,
      combatReports: detailState.combatReports,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "planetManager") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const ownerId = perspective.mode === "faction" ? perspective.factionId : null;
    const planets = ctx.state.planetStates
      .filter((planetState) => ownerId === null || planetState.ownerId === ownerId)
      .filter((planetState) => canAccessPlanet(ctx, perspective, planetState))
      .map((planetState) => {
        const star = ctx.state.stars[planetState.starId];
        const planet = getPlanetConfig(ctx, planetState);
        if (!star || !planet) return null;
        return {
          starId: planetState.starId,
          starName: star.name,
          ownerId: planetState.ownerId ?? -1,
          planet,
          planetState,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const payload = {
      planets,
      leaders: detailState.leaders,
      factionEconomies: detailState.factionEconomies,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "market") {
    const payload = createMarketDetailPayload(ctx, perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "technology") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const payload = {
      technologies: detailState.technologies,
      factionEconomies: detailState.factionEconomies,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "leaders") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const payload = {
      leaders: detailState.leaders,
      fleets: detailState.fleets,
      planetStates: detailState.planetStates,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "government") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const factionId = perspective.mode === "faction" ? perspective.factionId : null;
    const payload = {
      government: factionId === null
        ? null
        : detailState.governments.find((government) => government.factionId === factionId) ?? null,
      leaders: detailState.leaders,
      technologies: detailState.technologies,
      factionEconomies: detailState.factionEconomies,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "society") {
    const payload = createSocietyDetailPayload(ctx, perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "diplomacy") {
    const payload = createDiplomacyDetailPayload(ctx, perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "selection") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const payload = {
      fleets: detailState.fleets,
      ships: detailState.ships,
      starbases: detailState.starbases,
      leaders: detailState.leaders,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "hud") {
    const detailState = createVisibleState(ctx, perspective);
    const payload = {
      clock: detailState.clock,
      factionEconomies: detailState.factionEconomies,
      habitedPlanetSystemIds: detailState.habitedPlanetSystemIds,
      starOwnership: detailState.starOwnership,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  return { error: "Details are not available." };
}
