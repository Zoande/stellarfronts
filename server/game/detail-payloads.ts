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
import { getVisibleSet, getKnownSet, isFleetVisible } from "./visibility";
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

export function getVisibleFullStarbases(ctx: RuntimeContext, perspective: GalaxyPerspective): ServerStarbase[] {
  const visibleSet = getVisibleSet(ctx, perspective);
  return visibleSet
    ? ctx.state.starbases.filter((starbase) => visibleSet.has(starbase.starId))
    : ctx.state.starbases;
}

export function getVisibleFullFleets(ctx: RuntimeContext, perspective: GalaxyPerspective): ServerFleet[] {
  const visibleSet = getVisibleSet(ctx, perspective);
  return ctx.state.fleets.filter((fleet) => isFleetVisible(fleet, visibleSet, perspective));
}

export function getVisibleFullShips(
  ctx: RuntimeContext,
  perspective: GalaxyPerspective,
  fleets = getVisibleFullFleets(ctx, perspective),
): ServerShip[] {
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  return ctx.state.ships.filter((ship) => visibleFleetIds.has(ship.fleetId));
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
  const ownerByStar = new Array<number>(ctx.state.stars.length).fill(-1);
  for (const [ownedStarId, ownerId] of visibleState.starOwnership) {
    if (ownedStarId >= 0 && ownedStarId < ownerByStar.length) ownerByStar[ownedStarId] = ownerId;
  }
  const visibleFleets = getVisibleFullFleets(ctx, perspective);
  const result = buildSystemDetailPayload({
    perspective,
    starId,
    stars: ctx.state.stars,
    visibleStars: createVisibleStars(ctx, perspective, knownSet),
    knownStarIds: knownSet,
    hyperlanes: visibleState.hyperlanes,
    planetStates: ctx.state.planetStates,
    fleets: visibleFleets,
    ships: getVisibleFullShips(ctx, perspective, visibleFleets),
    starbases: getVisibleFullStarbases(ctx, perspective),
    recentCombatContacts: visibleState.recentCombatContacts,
    factions: visibleState.factions,
    shipDesigns: visibleState.shipDesigns,
    technologies: visibleState.technologies,
    starOwnership: ownerByStar,
  });
  if (!result.ok) return { error: result.error };
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
    discoveredStarIds: ctx.state.discoveredByFaction[String(faction.id)] ?? [],
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
      discoveredStarIds: ctx.state.discoveredByFaction[String(playerFactionId)] ?? [],
    };
  const planets = ctx.state.planetStates
    .filter((planetState) => planetState.isHabited)
    .filter((planetState) => playerFactionId === null || (ctx.state.starOwnership[planetState.starId] ?? -1) === playerFactionId)
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
    const payload = { starId: planetState.starId, planet, planetState };
    return { payload, revision: createRevision(payload), normalizedId: planetId };
  }

  if (scope === "starbase") {
    const starbaseId = String(id ?? "");
    const starbase = ctx.state.starbases.find((candidate) => candidate.id === starbaseId);
    if (!starbase || !canAccessStarbase(ctx, perspective, starbase)) return { error: "Starbase is not available." };
    const payload = { starbase };
    return { payload, revision: createRevision(payload), normalizedId: starbaseId };
  }

  if (scope === "fleet") {
    const fleetId = String(id ?? "");
    const fleets = getVisibleFullFleets(ctx, perspective);
    const fleet = fleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return { error: "Fleet is not available." };
    const payload = {
      fleet,
      ships: getVisibleFullShips(ctx, perspective, fleets).filter((ship) => ship.fleetId === fleet.id),
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
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "planetManager") {
    const detailState = createVisibleDetailState(ctx, perspective);
    const ownerId = perspective.mode === "faction" ? perspective.factionId : null;
    const planets = ctx.state.planetStates
      .filter((planetState) => ownerId === null || (ctx.state.starOwnership[planetState.starId] ?? -1) === ownerId)
      .filter((planetState) => canAccessPlanet(ctx, perspective, planetState))
      .map((planetState) => {
        const star = ctx.state.stars[planetState.starId];
        const planet = getPlanetConfig(ctx, planetState);
        if (!star || !planet) return null;
        return {
          starId: planetState.starId,
          starName: star.name,
          ownerId: ctx.state.starOwnership[planetState.starId] ?? -1,
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
