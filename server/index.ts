import { rm } from "node:fs/promises";
import { WebSocket } from "ws";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../src/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../src/data/Factions";
import { applyPlanetStatesToStars, createPlanetStateFromConfig } from "../src/data/StarMap";
import type { PlanetConfig, StarData } from "../src/data/StarMap";
import { getSystemStarbaseOrbitPosition } from "../src/data/SystemCoordinates";
import { addResourceCounts, BUILDING_DEFINITIONS, BUILDING_KINDS, completePlanetConstructionQueueItem, createBuildingConstructionQueueItem, createBuildingUpgradeConstructionQueueItem, createDistrictConstructionQueueItem, createEmptyResourceCounts, createPlanetBuildingState, filterInvalidQueuedBuildingsForSubDistrictChange, getEffectiveSpeciesHabitability, getBuildingUpgradeTargetLevel, getPlanetBuildingKind, getPlanetBuildingLevel, getQueuedDistrictCount, hasQueuedBuildingTarget, isBuildingCompatible, isPlanetBuildingEnabled, meetsCapitalUpgradePopulation, getCapitalUpgradePopulationThreshold, NEW_COLONY_POPULATION, recalculatePlanetStateEconomy, RESOURCE_KINDS, URBAN_SUB_DISTRICT_KINDS } from "../src/data/Economy";
import { MARKET_FEE_RATE } from "../src/data/Market";
import { countStarbaseShipyards, createStarbaseBuildingQueueItem, createStarbaseShipQueueItem, createStarbaseUpgradeQueueItem, hasQueuedStarbaseBuildingTarget, isStarbaseBuildingKind, isStarbaseShipKind, STARBASE_LEVEL_DEFINITIONS } from "../src/data/Starbase";
import { getNebulaGatedBuildingKinds, nebulaEnablesBuildingAtStar } from "../src/data/Nebula";
import type {
  StarbaseBuildingKind,
  StarbaseLevel,
  StarbaseShipKind,
  StarbaseShipQueueItem,
  WeaponMountDefinition,
} from "../src/data/Starbase";
import { calculateShipDesignStats, getShipDesignLayout, isKnownShipKind, normalizeShipDesign, SHIP_HULL_DEFINITIONS } from "../src/data/ShipDesigns";
import type { ShipDesign } from "../src/data/ShipDesigns";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  PlanetState,
  PlanetBuildingSlot,
  PlanetModifier,
  PlanetEconomySpeciesContext,
  ResourceKind,
  ResourceCounts,
  SpeciesPopulation,
  UrbanSubDistrictKind,
} from "../src/data/Economy";
import { createDefaultSpeciesRightsState, createSpeciesFromSetup, normalizeSpeciesRights, normalizeSpeciesRightsForLaws } from "../src/data/Species";
import type {
  FactionSpeciesRightsState,
  LegalSpeciesRightsOptions,
  SpeciesLawSelections,
  SpeciesId,
  SpeciesRights,
  SpeciesState,
} from "../src/data/Species";
import type {
  MarketAutoTradeOrder,
  MarketPlayerStats,
  MarketPriceSnapshot,
  MarketResourceState,
  MarketState,
  MarketTradeType,
} from "../src/data/Market";
import { buildHyperlaneAdjacency, buildHyperlanePairs } from "../src/data/Hyperlanes";
import { type CombatStance } from "../src/game/CombatTypes";
import type {
  ClientCommand,
  DiplomacyDetailPayload,
  DiplomacyEligiblePeaceTransferSystem,
  DiplomacyMovementPayload,
  FactionState,
  FleetFormation,
  GameClock,
  GameUpdate,
  GameSnapshot,
  GameDetailPayload,
  GameDetailScope,
  MarketDetailPayload,
  MarketResourceQuote,
  ServerFleet,
  FleetRetreatDestination,
  FleetMovementPlan,
  FleetMovementSegment,
  FleetOrbitTarget,
  FleetOrderType,
  FleetCombatSettings,
  FleetRetreatState,
  FleetTacticalOrder,
  ServerEvent,
  ServerShip,
  SocietyDetailPayload,
  ServerStarbase,
  ServerStarbaseSummary,
  SystemDetailPayload,
  ServerCombatContact,
  ServerUpdateField,
  ShipTransitPhase,
} from "../src/game/GameProtocol";
import {
  applyWeaponDamage,
  getWeaponId,
  getWeaponName,
  getWeaponCooldownRounds,
  getWeaponMaxSystemRange,
  getWeaponMinSystemRange,
  rollWeaponShot,
  weaponCanFireAtDistance,
} from "./game/combat";
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_HOUR, elapsedHoursToGameYear, gameYearToHourIndex, gameYearToWeekIndex } from "../src/game/GameTime";
import { DARK_MATTER_FLEET_COST_PER_MOVING_DAY, DARK_MATTER_FLEET_SPEED_MULTIPLIER, getConstructionDarkMatterCost } from "../src/game/DarkMatter";
import { gameHourToRealMinute } from "../src/game/ResourceRate";
import { getFirstRequiredTechName, getMissingPrerequisites, getRequiredTechIdsForBuilding, getRequiredTechIdsForBuildingLevel, getRequiredTechIdsForStarbaseBuilding, isTechnologyAvailable, isTechnologyCompleted, isUnlockedByAnyRequiredTech, TechId, TECHNOLOGY_BY_ID } from "../src/data/Technology";
import { formatLeaderClass, getLeaderAssignmentClass } from "../src/data/Leaders";
import type { LeaderAssignment, LeaderClass, LeaderFleetEffects, LeaderState } from "../src/data/Leaders";
import type { GameEffect, FactionModifierState } from "../src/data/GameEffects";
import {
  getEventDefinition,
  LEADER_OFFER_EVENT_ID,
  LOST_IN_TRANSIT_EVENT_ID,
} from "../src/data/Events";
import { SHORTAGE_SITUATION_ID, situationInstanceId } from "../src/data/Situations";
import type { ActiveSituation } from "../src/data/Situations";
import {
  buildSystemDetailPayload,
  createSystemDetailRevision,
} from "./game/system-view";
import { createInitialGovernmentState, GOVERNMENT_LAW_BY_ID, getGovernmentLawOption, getGovernmentPositionDefinition } from "../src/data/Government";
import type {
  FactionGovernmentState,
  GovernmentEffect,
  GovernmentLawId,
  GovernmentLawOption,
  GovernmentPositionDefinition,
  GovernmentPositionId,
} from "../src/data/Government";
import {
  TREATY_ARTICLE_DEFINITIONS,
  TRADE_PRIVILEGE_ARTICLE_ID,
  MIGRATION_PACT_ARTICLE_ID,
  areFactionsAtWar,
  clampTreatyDurationYears,
  createInitialDiplomacyState,
  getActiveTreatiesBetween,
  getActiveTreatyPartnersForArticle,
  getActiveWar,
  getBorderPolicy,
  isTreatyArticleSuspended,
  normalizeDiplomacyState,
  normalizePeaceTerms,
  normalizeTreatyArticleIds,
  setBorderPolicy,
} from "../src/data/Diplomacy";
import type {
  BorderPolicy,
  DiplomacyPeaceTerms,
  DiplomacyProposal,
  DiplomacyState,
  DiplomacySystemTransferTerm,
  DiplomacyTreaty,
  DiplomacyWar,
  TreatyArticleId,
} from "../src/data/Diplomacy";
import { parseAdminCommand } from "../src/game/AdminCommands";
import type { AdminCommandContext, AdminCommandResult, AdminCommandRow, ParsedAdminCommand } from "../src/game/AdminCommands";
import type { AuthAccount, DevGameRuntimeRow, DevGameRuntimeStats } from "../src/auth/types";
import { authStore } from "./auth-store";
import type { StoredGame } from "./auth-store";
import { getGameStateDirectory, getGameStatePath } from "./game-state-path";
import { VERSION_MANIFEST } from "./versionManifest";
import { SAVE_INTERVAL_MS, DEFAULT_TICK_SIZE_DAYS, DEFAULT_TICK_SPEED_SECONDS, EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION, EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION, EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION, EMERGENCY_RETREAT_SHIP_LOSS_CHANCE, EMERGENCY_RETREAT_MIN_MIA_DAYS, EMERGENCY_RETREAT_DISTANCE_MIA_DIVISOR, SHORTAGE_PROGRESS_RISE_PER_DAY, SHORTAGE_PROGRESS_FALL_PER_DAY } from "./game/constants";
import type {
  GameFleet,
  GameShip,
  GameState,
  DetailSubscription,
  ClientSession,
  GameRuntime,
  RuntimeContext,
} from "./game/types";
import { normalizeCombatStance, isDistrictKind, isValidSlotIndex } from "./game/validators";
import { computeSpeedMultiplier } from "./game/clock";
import { saveState, acquireOwnership, releaseOwnership } from "./game/persistence";
import { computeShortageSeverity, getLeaderDayIndex, getSpeciesRightsForFaction, getPlanetSpeciesContext, getPlanetDistrictLimitsFromState, getFactionSpeciesRightsState, getFactionTechnology, getPlanetTechnologyModifiers, getSpeciesLawSelections, getEmpireSpeciesIds, getPlanetState, getPlanetConfig, canAccessStar, canAccessPlanet, validateCommandPerspective } from "./game/state-queries";
import { findShipDesign, findShipDesignById, getNewestActiveShipDesign } from "./game/ship-designs";
import { calculateFactionResourceFlow, calculatePlayerMarketQuote, refreshFactionEconomyDeltas as applyFactionEconomyDeltas, recalculatePlanetEconomies as applyRecalculatePlanetEconomies, getMarketPlayerStats, getMarketResourceState, recordMarketTransaction, applyMarketTradePressure } from "./game/economy-market";
import type { FactionResourceFlow, PlayerMarketQuote } from "./game/economy-market";
import { refreshDiscovery as applyRefreshDiscovery } from "./game/visibility";
import { getKnownStarIds, hasCommandLink } from "./game/intelligence";
import { createSnapshot, createUpdate } from "./game/snapshot";
import { createDetailPayload } from "./game/detail-payloads";
import { calculateShipUpgradePlan, createDefaultFleetCombatSettings, normalizeFleetTacticalOrder } from "./game/fleet-factory";
import {
  processEconomyHours,
  processMarketTicks,
  processShipShortageEffects,
  processPlanetConstruction,
  processStarbaseConstruction,
  processStarbaseRepairs,
  processShipRepairs,
  processConstructionRepairs,
  processStarbaseShipQueues,
} from "./game/economy-tick";
import { normalizeResourceCounts, normalizeStarbase, syncFleetMembership, syncSystemOwnershipFromStarbases, fleetHasConstructionShip, getFleetColonizationShip, syncShipsForDesign, normalizeSpeciesRightsForFactions, assignFoundingSpeciesToOwnedPops, getFactionFoundingSpeciesId } from "./game/state-normalization";
import { initServer } from "./game/server-bootstrap";
import { executeAdminCommand } from "./game/admin-commands";
import { createInitialState, loadState } from "./game/state-bootstrap";
import { sendEvent, reject, accept } from "./game/socket-io";
import {
  handleSendDiplomacyMessage,
  handleSetBorderPolicy,
  handleDeclareWar,
  handleProposeTreaty,
  handleRespondDiplomacyProposal,
  handleCancelDiplomacyProposal,
  handleCancelTreaty,
  handleProposePeace,
} from "./game/diplomacy-handlers";
import { systemCenterPosition, gameDaysToYears } from "./game/pure-helpers";
import { expireFactionModifiers, fireSituationThresholds, processRandomEvents, resolveActiveEvent, processEventTimeouts } from "./game/leaders-events";
import {
  processPopulationWeeks,
  processLeaderDays,
} from "./game/population";
import { isShipDesignUnlockedForFaction, getShipDesignMissingTechnologyName } from "./game/research";
import { phaseDurationDays, hyperlaneTravelDays, createStarbaseOrbitTarget, clearFleetOrbit, prepareFleetForReplacementOrder, applyFleetOrbitTarget, findRoute, startMoveOrder, startAttackSystemOrder, startBuildOrder, startOrbitOrder, startMergeSourceOrder, isMergeSourceEligible, advanceFleet, processMissingInActionFleets, isHostileOwner, resolveFleetRetreatDestination, startFleetRetreat, retreatFleetByDoctrine, processContinuousFleetCombat, clearFleetMovementNow, processFleetCommandLinkLoss, rescaleFleetMovementPlan } from "./game/fleet-combat";

// Probe mode: the orchestrator runs each worktree with `--print-version` to read
// its committed identity (protocol/schema/migratesFrom) without booting a server.
if (process.argv.includes("--print-version")) {
  process.stdout.write(`${JSON.stringify(VERSION_MANIFEST)}\n`);
  process.exit(0);
}



async function createGameRuntime(game: StoredGame): Promise<GameRuntime> {
const ctx: RuntimeContext = {
  game,
  statePath: getGameStatePath(game.id),
  state: undefined as unknown as GameState,
  clients: new Set<ClientSession>(),
  pendingPlanetDetailRefreshes: new Set<string>(),
  hasDirtyState: false,
  lastSaveAt: 0,
  saveInFlight: null,
  saveQueued: false,
  runtimeIdCounter: 0,
  eventInstanceSeq: 0,
  setFleetPhase, // hoisted function declaration â€” safe to reference here
  recalculatePlanetEconomies, // hoisted
  refreshFactionEconomyDeltas, // hoisted
  queuePlanetDetailRefresh, // hoisted
  refreshDiscovery: () => refreshDiscovery(), // hoisted â€” wrapper needed for default param
  refreshIntelligence: () => refreshDiscovery(),
  syncSystemOwnershipFromStarbases: () => syncSystemOwnershipFromStarbases(ctx.state),
  syncFleetMembership: () => syncFleetMembership(ctx, ctx.state),
  createRuntimeId, // hoisted
  syncClockSpeedFields, // hoisted
  advanceState, // hoisted
  broadcastSnapshots, // hoisted
  broadcastUpdates, // hoisted
  createInitialState: () => createInitialState(ctx),
};

function createDetailKey(scope: GameDetailScope, id: string | number | null | undefined): string {
  return `${scope}:${id ?? ""}`;
}

function syncClockSpeedFields(): void {
  ctx.state.clock.tickSizeDays = Math.max(0.000001, Number(ctx.state.clock.tickSizeDays) || DEFAULT_TICK_SIZE_DAYS);
  ctx.state.clock.tickSpeedSeconds = Math.max(0.01, Number(ctx.state.clock.tickSpeedSeconds) || DEFAULT_TICK_SPEED_SECONDS);
  ctx.state.clock.paused = ctx.state.clock.paused === true;
  ctx.state.clock.speedMultiplier = computeSpeedMultiplier(
    ctx.state.clock.tickSizeDays,
    ctx.state.clock.tickSpeedSeconds,
    ctx.state.clock.paused,
  );
}


function createRuntimeId(prefix: string, parts: Array<string | number | undefined> = []): string {
  ctx.runtimeIdCounter += 1;
  const cleanParts = parts.filter((part) => part !== undefined && part !== "");
  return `${prefix}-${cleanParts.join("-")}-${Date.now().toString(36)}-${ctx.runtimeIdCounter.toString(36)}`;
}

function recalculatePlanetEconomies(nextState = ctx.state): void {
  applyRecalculatePlanetEconomies(nextState);
}

function refreshFactionEconomyDeltas(nextState = ctx.state): void {
  applyFactionEconomyDeltas(nextState);
}

function requireUnlocked(socket: WebSocket, factionId: number, requiredTechIds: TechId[]): boolean {
  if (requiredTechIds.length === 0) return true;
  const techState = getFactionTechnology(ctx.state, factionId);
  if (isUnlockedByAnyRequiredTech(techState, requiredTechIds)) return true;
  reject(socket, `Requires ${getFirstRequiredTechName(requiredTechIds)}.`);
  return false;
}

function queuePlanetDetailRefresh(planetId: string): void {
  ctx.pendingPlanetDetailRefreshes.add(planetId);
}

function flushPlanetDetailRefreshes(): void {
  if (ctx.pendingPlanetDetailRefreshes.size === 0) return;
  ctx.pendingPlanetDetailRefreshes.clear();
  broadcastSubscribedDetails();
}





function setFleetPhase(fleet: GameFleet, phase: ShipTransitPhase): void {
  fleet.phase = phase;
  fleet.phaseElapsedMs = 0;
  fleet.phaseProgress = 0;
  fleet.phaseStartedAtYear = ctx.state?.clock?.year ?? fleet.phaseStartedAtYear ?? GAME_START_YEAR;
  fleet.phaseDurationDays = phaseDurationDays(ctx, phase, fleet);
}

function refreshDiscovery(nextState = ctx.state): void {
  applyRefreshDiscovery(nextState);
}

function broadcastSnapshots(): void {
  for (const client of ctx.clients) {
    sendEvent(client.socket, createSnapshot(ctx, client.perspective));
  }
}

function broadcastUpdates(changed: ServerUpdateField[]): void {
  const deduped = Array.from(new Set(changed));
  if (deduped.length === 0) return;
  for (const client of ctx.clients) {
    sendEvent(client.socket, createUpdate(ctx, client.perspective, deduped));
  }
  broadcastSubscribedDetails();
}

function broadcastAccountDarkMatter(accountId: number, darkMatter: number): void {
  for (const client of ctx.clients) {
    if (client.account.id === accountId) {
      sendEvent(client.socket, { type: "accountResources", darkMatter });
    }
  }
}







function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

function hasFleetCommandLink(fleet: GameFleet): boolean {
  return !fleet.hyperlanePosition && hasCommandLink(ctx.state, fleet.ownerId, fleet.currentStarId);
}

function canFleetAcceptReplacementOrder(fleet: GameFleet): boolean {
  return !fleet.stationaryStarbaseId
    && fleet.phase !== "missingInAction"
    && fleet.combatStatus !== "destroyed"
    && fleet.shipIds.length > 0
    && hasFleetCommandLink(fleet);
}


















function resolveFleetForCommand(fleetId?: string, shipId?: string): GameFleet | null {
  if (fleetId) {
    return ctx.state.fleets.find((candidate) => candidate.id === fleetId) ?? null;
  }
  if (!shipId) return null;
  const ship = ctx.state.ships.find((candidate) => candidate.id === shipId);
  if (ship) {
    return ctx.state.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
  }
  return ctx.state.fleets.find((candidate) => candidate.id === shipId) ?? null;
}

function handleMove(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string | undefined,
  shipId: string | undefined,
  targetStarId: number,
  targetSystemPosition?: ReturnType<typeof systemCenterPosition>,
  orbitTarget?: FleetOrbitTarget | null,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, shipId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(socket, "Fleet cannot accept orders right now.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startMoveOrder(ctx, fleet, targetStarId, targetSystemPosition, orbitTarget);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Move order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Move order rejected.");
  }
}

function handleBuild(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string | undefined, shipId: string | undefined, targetStarId: number): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, shipId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(socket, "Fleet cannot accept orders right now.");
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) return reject(socket, "Invalid target system.");
  if (!fleetHasConstructionShip(ctx, fleet)) return reject(socket, "Requires a construction ship.");
  if (ctx.state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(socket, "System already has a starbase.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startBuildOrder(ctx, fleet, targetStarId);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Build order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Build order rejected.");
  }
}

function handleOrbitPlanet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, undefined);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(socket, "Fleet cannot accept orders right now.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startOrbitOrder(ctx, fleet, planetId);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Orbit order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Orbit order rejected.");
  }
}

function handleColonizePlanet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, undefined);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(socket, "Fleet command link unavailable.");

  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) return reject(socket, "Planet not found.");
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) return reject(socket, "Planet details are unavailable.");
  if (ctx.state.starOwnership[planetState.starId] !== factionId) {
    return reject(socket, "Planet must be in an owned system.");
  }
  if (planetState.isHabited || planet.isHabited === true) {
    return reject(socket, "Planet is already colonized.");
  }
  if (fleet.currentStarId !== planetState.starId || fleet.orbitTargetPlanetId !== planetState.id) {
    return reject(socket, "Fleet must be orbiting the target planet.");
  }

  const colonizationShip = getFleetColonizationShip(ctx, fleet);
  if (!colonizationShip) return reject(socket, "Requires a colonization ship.");

  const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId
    ?? getFactionFoundingSpeciesId(factionId);
  const prospectiveState = createPlanetStateFromConfig(
    planetState.starId,
    planetState.planetIndex,
    planet,
    {
      ...planetState,
      ownerId: factionId,
      isHabited: true,
      population: NEW_COLONY_POPULATION,
      speciesPopulations: [{ speciesId: foundingSpeciesId, population: NEW_COLONY_POPULATION }],
      builtDistricts: { city: 0, generator: 0, mining: 0, agriculture: 0 },
      buildings: undefined,
      constructionQueue: [],
    },
    planetState.features,
    { starterInfrastructure: false, startingPopulation: NEW_COLONY_POPULATION },
  );
  const habitability = getEffectiveSpeciesHabitability(
    prospectiveState,
    foundingSpeciesId,
    getPlanetSpeciesContext(ctx.state, prospectiveState),
  );
  if (habitability <= 0) return reject(socket, "Planet habitability is too low to colonize.");

  ctx.state.ships = ctx.state.ships.filter((ship) => ship.id !== colonizationShip.id);
  const fleetChanged = syncFleetMembership(ctx, ctx.state);
  ctx.state.planetStates = ctx.state.planetStates.map((candidate) => (
    candidate.id === prospectiveState.id ? prospectiveState : candidate
  ));
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  queuePlanetDetailRefresh(prospectiveState.id);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, `${planet.name} colonized.`);
  broadcastUpdates([
    "planetStates",
    "habitedPlanetSystems",
    "factionEconomies",
    "ships",
    ...(fleetChanged ? ["fleets" as const] : []),
  ]);
}

function handleMergeFleets(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFleetId: string,
  sourceFleetIds: string[],
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === targetFleetId);
  if (!targetFleet) return reject(socket, "Target fleet not found.");
  if (targetFleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(targetFleet)) return reject(socket, "Fleet command link unavailable.");

  const uniqueSourceIds = Array.from(new Set(sourceFleetIds)).filter((id) => id !== targetFleetId);
  if (uniqueSourceIds.length === 0) return reject(socket, "No fleets selected to merge.");

  const sourceFleets = uniqueSourceIds
    .map((id) => ctx.state.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is GameFleet => !!fleet);

  if (sourceFleets.length !== uniqueSourceIds.length) return reject(socket, "A source fleet was not found.");
  for (const fleet of sourceFleets) {
    if (fleet.ownerId !== factionId) return reject(socket, "You do not own all selected fleets.");
    if (!hasFleetCommandLink(fleet)) return reject(socket, "A selected fleet has no command link.");
    if (!isMergeSourceEligible(fleet)) return reject(socket, "A selected fleet cannot currently merge.");
    if (fleet.currentStarId !== targetFleet.currentStarId && !findRoute(ctx, fleet, targetFleet.currentStarId)) {
      return reject(socket, "No discovered safe route to the target fleet.");
    }
  }

  let mergedCount = 0;
  let movingCount = 0;
  for (const fleet of sourceFleets) {
    prepareFleetForReplacementOrder(ctx, fleet);
    startMergeSourceOrder(ctx, fleet, targetFleet);
    if (ctx.state.fleets.some((candidate) => candidate.id === fleet.id)) {
      movingCount += 1;
    } else {
      mergedCount += 1;
    }
  }

  ctx.hasDirtyState = true;
  accept(socket, movingCount > 0 ? `Merge rendezvous ordered for ${movingCount} fleet(s).` : `Merged ${mergedCount} fleet(s).`);
  broadcastUpdates(["clock", "ships", "fleets", "visibility"]);
}

function handleStopFleet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(socket, "Fleet command link unavailable.");
  if (fleet.phase === "missingInAction") return reject(socket, "Fleet is missing in action.");

  clearFleetMovementNow(ctx, fleet);
  ctx.hasDirtyState = true;
  refreshDiscovery();
  accept(socket, "Fleet stopped.");
  broadcastUpdates(["clock", "fleets", "visibility"]);
}

function handleSetFleetDarkMatterBoost(
  session: ClientSession,
  fleetId: string,
  enabled: boolean,
): void {
  const factionId = validateCommandPerspective(session.perspective);
  if (factionId === null) return reject(session.socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(session.socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(session.socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(session.socket, "Fleet command link unavailable.");
  if (typeof enabled !== "boolean") return reject(session.socket, "Invalid Dark Matter boost setting.");

  if (!enabled) {
    if (!fleet.darkMatterBoostActive) return reject(session.socket, "Dark Matter boost is not active.");
    rescaleFleetMovementPlan(ctx, fleet, DARK_MATTER_FLEET_SPEED_MULTIPLIER);
    fleet.darkMatterBoostActive = false;
    fleet.darkMatterBoostPaidUntilYear = null;
    ctx.hasDirtyState = true;
    accept(session.socket, "Dark Matter fleet boost disabled.");
    broadcastUpdates(["clock", "fleets"]);
    return;
  }

  if (fleet.darkMatterBoostActive) return reject(session.socket, "Dark Matter boost is already active.");
  if (!fleet.movementPlan || ctx.state.clock.year >= fleet.movementPlan.endsAtYear) {
    return reject(session.socket, "The fleet must be moving to activate a Dark Matter boost.");
  }

  const balance = authStore.spendPlayerDarkMatter(
    session.account.id,
    DARK_MATTER_FLEET_COST_PER_MOVING_DAY,
  );
  if (balance === null) return reject(session.socket, "Not enough Dark Matter.");

  fleet.darkMatterBoostActive = true;
  fleet.darkMatterBoostPaidUntilYear = ctx.state.clock.year + gameDaysToYears(1);
  rescaleFleetMovementPlan(ctx, fleet, 1 / DARK_MATTER_FLEET_SPEED_MULTIPLIER);
  ctx.hasDirtyState = true;
  broadcastAccountDarkMatter(session.account.id, balance);
  accept(session.socket, "Dark Matter boost active: fleet movement is 10x faster.");
  broadcastUpdates(["clock", "fleets"]);
}

function handleRetreatFleet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): void {
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  const destination = fleet ? resolveFleetRetreatDestination(ctx, fleet) : null;
  handleRetreatFleetTo(socket, perspective, fleetId, destination?.targetStarId ?? -1, destination?.targetSystemPosition ?? undefined);
}

function validateRetreatTarget(socket: WebSocket, perspective: GalaxyPerspective, fleet: GameFleet, targetStarId: number, requireRoute: boolean): boolean {
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) {
    reject(socket, "Invalid retreat target.");
    return false;
  }
  if (perspective.mode !== "observer") {
    const known = getKnownStarIds(ctx.state, perspective.factionId);
    if (!known.has(targetStarId)) {
      reject(socket, "Retreat target is not known.");
      return false;
    }
  }
  if (requireRoute && targetStarId !== fleet.currentStarId && !findRoute(ctx, fleet, targetStarId)) {
    reject(socket, "No reachable route to retreat target.");
    return false;
  }
  return true;
}

function handleRetreatFleetTo(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
  targetSystemPosition?: ReturnType<typeof systemCenterPosition>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(socket, "Fleet command link unavailable.");
  if (!validateRetreatTarget(socket, perspective, fleet, targetStarId, true)) return;

  fleet.retreatState = {
    mode: "system",
    status: "escaping",
    targetStarId,
    targetSystemPosition: targetSystemPosition ?? null,
    startedAtYear: ctx.state.clock.year,
  };
  fleet.combatSettings = {
    ...fleet.combatSettings,
    retreatDestination: {
      kind: "selectedSystem",
      targetStarId,
      targetSystemPosition: targetSystemPosition ?? null,
    },
  };
  fleet.currentTacticalOrder = { type: "retreat", issuedAtYear: ctx.state.clock.year };
  fleet.combatStatus = "retreating";
  startFleetRetreat(ctx, fleet);
  ctx.hasDirtyState = true;
  accept(socket, "Fleet ordered to retreat to target system.");
  broadcastUpdates(["fleets"]);
}

function estimateEmergencyMiaDays(fleet: GameFleet, targetStarId: number): number {
  const route = targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(ctx, fleet, targetStarId);
  if (route && route.length > 1) {
    let days = 0;
    for (let i = 0; i < route.length - 1; i += 1) {
      days += hyperlaneTravelDays(ctx, route[i], route[i + 1], fleet);
    }
    return Math.max(EMERGENCY_RETREAT_MIN_MIA_DAYS, days * 0.6);
  }
  const from = ctx.state.stars[fleet.currentStarId];
  const to = ctx.state.stars[targetStarId];
  const distance = from && to ? Math.hypot(to.x - from.x, to.z - from.z) : 0;
  return Math.max(EMERGENCY_RETREAT_MIN_MIA_DAYS, distance / EMERGENCY_RETREAT_DISTANCE_MIA_DIVISOR);
}

function handleEmergencyRetreatFleetTo(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(socket, "Fleet command link unavailable.");
  if (!validateRetreatTarget(socket, perspective, fleet, targetStarId, false)) return;

  const lostShipIds = new Set<string>();
  const activeShips = ctx.state.ships.filter((ship) => ship.fleetId === fleetId && ship.hull > 0);

  for (const ship of activeShips) {
    ship.shield = Math.max(0, ship.shield - ship.maxShield * EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION);
    const armorDamage = ship.maxArmor * EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION;
    const hullDamage = ship.maxHull * EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION;
    ship.armor = Math.max(0, ship.armor - armorDamage);
    ship.hull = Math.max(0, ship.hull - hullDamage);
    ship.hp = ship.hull;
    if (Math.random() < EMERGENCY_RETREAT_SHIP_LOSS_CHANCE || ship.hull <= 0) {
      lostShipIds.add(ship.id);
    }
  }

  const lostCount = lostShipIds.size;
  if (lostCount > 0) {
    ctx.state.ships = ctx.state.ships.filter((ship) => !lostShipIds.has(ship.id));
    syncFleetMembership(ctx, ctx.state);
  }

  const miaDays = estimateEmergencyMiaDays(fleet, targetStarId);
  fleet.retreatState = {
    mode: "emergencyFtl",
    status: "mia",
    targetStarId,
    startedAtYear: ctx.state.clock.year,
    miaUntilYear: ctx.state.clock.year + gameDaysToYears(miaDays),
    riskApplied: true,
  };
  fleet.targetStarId = targetStarId;
  fleet.orderType = "retreat";
  fleet.movementPlan = null;
  fleet.hyperlanePosition = null;
  clearFleetOrbit(fleet);
  setFleetPhase(fleet, "missingInAction");

  ctx.hasDirtyState = true;
  accept(socket, "Emergency retreat initiated.");
  broadcastUpdates(["ships", "fleets"]);
}

function handleAttackTarget(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetId: string,
  targetKind: "fleet" | "starbase",
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!hasFleetCommandLink(fleet)) return reject(socket, "Fleet command link unavailable.");
  const targetOwnerId = targetKind === "fleet"
    ? ctx.state.fleets.find((candidate) => candidate.id === targetId)?.ownerId
    : ctx.state.starbases.find((candidate) => candidate.id === targetId)?.ownerId;
  const targetStarId = targetKind === "fleet"
    ? ctx.state.fleets.find((candidate) => candidate.id === targetId)?.currentStarId
    : ctx.state.starbases.find((candidate) => candidate.id === targetId)?.starId;
  if (targetOwnerId === undefined || targetStarId === undefined) return reject(socket, "Target not found.");
  if (targetStarId !== fleet.currentStarId) return reject(socket, "Target is not in the same system.");
  if (!isHostileOwner(ctx, fleet.ownerId, targetOwnerId)) return reject(socket, "Target is not hostile.");
  prepareFleetForReplacementOrder(ctx, fleet);
  fleet.currentTacticalOrder = {
    type: "attack",
    targetId,
    targetKind,
    issuedAtYear: ctx.state.clock.year,
  };
  fleet.currentTargetId = targetId;
  fleet.currentTargetKind = targetKind;
  if (fleet.combatStance === "passive" || fleet.combatStance === "evade") {
    fleet.combatStance = "aggressive";
  }
  ctx.hasDirtyState = true;
  accept(socket, "Attack order accepted.");
  broadcastUpdates(["fleets"]);
}

function handleAttackSystem(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(socket, "Fleet cannot accept orders right now.");
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) return reject(socket, "Invalid target system.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startAttackSystemOrder(ctx, fleet, targetStarId);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Attack order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Attack order rejected.");
  }
}

function getOwnedFleetForCombatCommand(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): GameFleet | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId) ?? null;
  if (!fleet) {
    reject(socket, "Fleet not found.");
    return null;
  }
  if (fleet.ownerId !== factionId) {
    reject(socket, "You do not own that fleet.");
    return null;
  }
  if (!hasFleetCommandLink(fleet)) {
    reject(socket, "Fleet command link unavailable.");
    return null;
  }
  return fleet;
}

function commitFleetDoctrineChange(socket: WebSocket, message: string): void {
  ctx.hasDirtyState = true;
  accept(socket, message);
  broadcastUpdates(["fleets"]);
}

function handleSetFleetCombatSettings(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  combatSettings: Partial<FleetCombatSettings>,
  combatStance?: CombatStance,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  if (combatStance !== undefined) {
    fleet.combatStance = normalizeCombatStance(combatStance);
  }
  fleet.combatSettings = createDefaultFleetCombatSettings({
    ...fleet.combatSettings,
    ...combatSettings,
  });
  commitFleetDoctrineChange(socket, "Fleet doctrine updated.");
}

function handleIssueFleetTacticalOrder(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "issueFleetTacticalOrder" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const order = normalizeFleetTacticalOrder({
    ...command.order,
    issuedAtYear: ctx.state.clock.year,
  });
  if (!order) return reject(socket, "Invalid fleet tactical order.");
  if (order.type === "move" && !order.targetPosition) return reject(socket, "Move orders require a system position.");
  if (order.type === "attack" && (!order.targetId || !order.targetKind)) return reject(socket, "Attack orders require a target.");
  if (order.type === "guard" && !order.targetPosition && !order.guardPosition) return reject(socket, "Guard orders require a position.");
  if (order.type !== "retreat") {
    prepareFleetForReplacementOrder(ctx, fleet);
  }
  fleet.currentTacticalOrder = order;
  if (order.type === "hold") fleet.combatStance = "holdPosition";
  if (order.type === "guard") fleet.combatStance = "guardArea";
  if (order.type === "retreat") {
    retreatFleetByDoctrine(ctx, fleet);
  }
  ctx.hasDirtyState = true;
  accept(socket, "Fleet tactical order accepted.");
  broadcastUpdates(["fleets"]);
}

function handleRepairFleet(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "repairFleet" }>,
): void {
  const repairFleet = getOwnedFleetForCombatCommand(socket, perspective, command.constructionFleetId);
  if (!repairFleet) return;
  if (!fleetHasConstructionShip(ctx, repairFleet)) return reject(socket, "Selected fleet has no construction ship.");
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === command.targetFleetId);
  if (!targetFleet) return reject(socket, "Repair target fleet not found.");
  if (targetFleet.currentStarId !== repairFleet.currentStarId) return reject(socket, "Construction ship and target must be in the same system.");
  const alliedAccess = targetFleet.ownerId === repairFleet.ownerId || (
    getBorderPolicy(ctx.state.diplomacy, targetFleet.ownerId, repairFleet.ownerId) === "open"
    && getActiveTreatiesBetween(ctx.state.diplomacy, targetFleet.ownerId, repairFleet.ownerId).length > 0
  );
  if (!alliedAccess) return reject(socket, "Target fleet has not granted allied repair access.");
  repairFleet.repairOrder = {
    targetFleetId: targetFleet.id,
    targetShipId: null,
    stage: "emergencyMobility",
    progressHours: 0,
    startedAtYear: ctx.state.clock.year,
  };
  prepareFleetForReplacementOrder(ctx, repairFleet);
  ctx.hasDirtyState = true;
  accept(socket, "Construction fleet repair operation started.");
  broadcastUpdates(["fleets", "ships"]);
}

function sendPlanetDetails(socket: WebSocket, perspective: GalaxyPerspective, planetId: string): void {
  const planetState = getPlanetState(ctx, planetId);
  if (!planetState || !canAccessPlanet(ctx, perspective, planetState)) {
    reject(socket, "Planet is not available.");
    return;
  }
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) {
    reject(socket, "Planet details are unavailable.");
    return;
  }

  sendEvent(socket, {
    type: "planetDetails",
    starId: planetState.starId,
    planet,
    planetState,
  });
}

function sendDetailEvent(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  scope: GameDetailScope,
  id: string | number | null | undefined,
  knownRevision?: string | null,
): string | null {
  const detail = createDetailPayload(ctx, perspective, scope, id);
  if ("error" in detail) {
    sendEvent(socket, {
      type: "detail",
      scope,
      id: id ?? null,
      revision: "unavailable",
      status: "unavailable",
      message: "Information does not exist.",
    });
    return null;
  }
  const matchesKnownRevision = !!knownRevision && knownRevision === detail.revision;
  sendEvent(socket, {
    type: "detail",
    scope,
    id: detail.normalizedId,
    revision: detail.revision,
    status: matchesKnownRevision ? "notModified" : "full",
    payload: matchesKnownRevision ? undefined : detail.payload,
  });
  return detail.revision;
}

function handleRequestDetails(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  scope: GameDetailScope,
  id: string | number | null | undefined,
  knownRevision?: string | null,
): void {
  sendDetailEvent(socket, perspective, scope, id, knownRevision);
}

function handleSubscribeDetails(
  session: ClientSession,
  scope: GameDetailScope,
  id: string | number | null | undefined,
  knownRevision?: string | null,
): void {
  const detail = createDetailPayload(ctx, session.perspective, scope, id);
  if ("error" in detail) {
    sendEvent(session.socket, {
      type: "detail",
      scope,
      id: id ?? null,
      revision: "unavailable",
      status: "unavailable",
      message: "Information does not exist.",
    });
    return;
  }
  const key = createDetailKey(scope, detail.normalizedId);
  session.detailSubscriptions.set(key, {
    scope,
    id: detail.normalizedId,
    lastRevision: detail.revision,
  });
  const matchesKnownRevision = !!knownRevision && knownRevision === detail.revision;
  sendEvent(session.socket, {
    type: "detail",
    scope,
    id: detail.normalizedId,
    revision: detail.revision,
    status: matchesKnownRevision ? "notModified" : "full",
    payload: matchesKnownRevision ? undefined : detail.payload,
  });
}

function handleUnsubscribeDetails(
  session: ClientSession,
  scope: GameDetailScope,
  id: string | number | null | undefined,
): void {
  session.detailSubscriptions.delete(createDetailKey(scope, id));
}

function broadcastSubscribedDetails(): void {
  for (const client of ctx.clients) {
    for (const [key, subscription] of Array.from(client.detailSubscriptions.entries())) {
      const detail = createDetailPayload(ctx, client.perspective, subscription.scope, subscription.id);
      if ("error" in detail) {
        sendEvent(client.socket, {
          type: "detail",
          scope: subscription.scope,
          id: subscription.id,
          revision: "unavailable",
          status: "unavailable",
          message: "Information does not exist.",
        });
        client.detailSubscriptions.delete(key);
        continue;
      }
      if (detail.revision === subscription.lastRevision) continue;
      subscription.lastRevision = detail.revision;
      sendEvent(client.socket, {
        type: "detail",
        scope: subscription.scope,
        id: detail.normalizedId,
        revision: detail.revision,
        status: "full",
        payload: detail.payload,
      });
    }
  }
}

function getPlanetDistrictLimits(planetState: PlanetState) {
  return getPlanetDistrictLimitsFromState(ctx.state, planetState) ?? null;
}

function validatePlanetCommand(socket: WebSocket, perspective: GalaxyPerspective, planetId: string): PlanetState | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }

  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) {
    reject(socket, "Planet not found.");
    return null;
  }
  if (!planetState.isHabited) {
    reject(socket, "Only habited planets can be managed.");
    return null;
  }
  if (planetState.ownerId !== factionId) {
    reject(socket, "You do not own that planet.");
    return null;
  }
  if (!hasCommandLink(ctx.state, factionId, planetState.starId)) {
    reject(socket, "Planet command link unavailable.");
    return null;
  }
  return planetState;
}

function getFactionEconomy(factionId: number): FactionEconomyState | null {
  return ctx.state.factionEconomies.find((economy) => economy.factionId === factionId) ?? null;
}

function spendMinerals(socket: WebSocket, factionId: number, amount: number): boolean {
  return spendResources(socket, factionId, { minerals: amount });
}

function spendResources(socket: WebSocket, factionId: number, cost: Partial<ResourceCounts>): boolean {
  const economy = getFactionEconomy(factionId);
  if (!economy) {
    reject(socket, "Faction economy unavailable.");
    return false;
  }
  const normalizedCost = normalizeResourceCounts(cost);
  for (const resource of Object.keys(normalizedCost) as Array<keyof ResourceCounts>) {
    const amount = normalizedCost[resource];
    if (amount <= 0) continue;
    if (economy.stockpiles[resource] < amount) {
      reject(socket, `Need ${amount} ${resource}.`);
      return false;
    }
  }
  const negativeCost = createEmptyResourceCounts();
  for (const resource of Object.keys(normalizedCost) as Array<keyof ResourceCounts>) {
    negativeCost[resource] = -normalizedCost[resource];
  }
  economy.stockpiles = addResourceCounts(economy.stockpiles, negativeCost);
  ctx.hasDirtyState = true;
  return true;
}

function refundResources(factionId: number, refund: Partial<ResourceCounts>): void {
  const economy = getFactionEconomy(factionId);
  if (!economy) return;
  economy.stockpiles = addResourceCounts(economy.stockpiles, normalizeResourceCounts(refund));
  ctx.hasDirtyState = true;
}

function handleMarketTrade(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  resourceId: ResourceKind,
  tradeType: "buy" | "sell",
  rawAmount: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return;
  }

  if (!RESOURCE_KINDS.includes(resourceId)) {
    reject(socket, "Resource is not available on the market.");
    return;
  }
  const resource = getMarketResourceState(ctx, resourceId);
  if (!resource || !resource.marketEnabled) {
    reject(socket, "That resource is not market-enabled yet.");
    return;
  }

  const amount = Math.floor(Number(rawAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    reject(socket, "Enter a positive trade amount.");
    return;
  }
  if (amount > 1_000_000) {
    reject(socket, "Trade amount is too large.");
    return;
  }

  const economy = getFactionEconomy(factionId);
  if (!economy) {
    reject(socket, "Faction economy unavailable.");
    return;
  }

  const flows = calculateFactionResourceFlow(ctx.state, factionId);
  const quote = calculatePlayerMarketQuote(resource, factionId, flows, ctx.state);
  const grossEnergy = amount * quote.finalQuotePrice;
  const feePaid = grossEnergy * MARKET_FEE_RATE;
  const stats = getMarketPlayerStats(ctx, factionId);

  if (tradeType === "buy") {
    const buyCost = grossEnergy + feePaid;
    if (economy.stockpiles.energy < buyCost) {
      reject(socket, `Need ${formatEnergyAmount(buyCost)} Energy.`);
      return;
    }
    economy.stockpiles = {
      ...economy.stockpiles,
      energy: economy.stockpiles.energy - buyCost,
      [resourceId]: economy.stockpiles[resourceId] + amount,
    };
    stats.totalImportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, factionId, resourceId, "buy", amount, quote.finalQuotePrice, feePaid, -buyCost);
    applyMarketTradePressure(ctx, resource, "buy", amount);
    accept(socket, `Bought ${amount} ${resourceId} for ${formatEnergyAmount(buyCost)} Energy.`);
  } else {
    if (economy.stockpiles[resourceId] < amount) {
      reject(socket, `Need ${amount} ${resourceId}.`);
      return;
    }
    const sellPayout = grossEnergy - feePaid;
    economy.stockpiles = {
      ...economy.stockpiles,
      [resourceId]: economy.stockpiles[resourceId] - amount,
      energy: economy.stockpiles.energy + sellPayout,
    };
    stats.totalExportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, factionId, resourceId, "sell", amount, quote.finalQuotePrice, feePaid, sellPayout);
    applyMarketTradePressure(ctx, resource, "sell", amount);
    accept(socket, `Sold ${amount} ${resourceId} for ${formatEnergyAmount(sellPayout)} Energy.`);
  }

  ctx.hasDirtyState = true;
  refreshFactionEconomyDeltas();
  broadcastUpdates(["factionEconomies", "market"]);
}

function handleAddMarketAutoTrade(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  resourceId: ResourceKind,
  tradeType: "auto_buy" | "auto_sell",
  rawAmountPerHour: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return;
  }
  if (!RESOURCE_KINDS.includes(resourceId)) {
    reject(socket, "Resource is not available on the market.");
    return;
  }
  const resource = getMarketResourceState(ctx, resourceId);
  if (!resource?.marketEnabled) {
    reject(socket, "That resource is not market-enabled yet.");
    return;
  }
  const amountPerHour = Number(rawAmountPerHour);
  if (!Number.isFinite(amountPerHour) || amountPerHour <= 0) {
    reject(socket, "Enter a positive per-minute amount.");
    return;
  }
  if (amountPerHour > 1_000_000) {
    reject(socket, "Automatic trade amount is too large.");
    return;
  }

  const existing = ctx.state.market.autoTrades.find((order) => (
    order.playerId === factionId
    && order.resourceId === resourceId
    && order.type === tradeType
  ));
  if (existing) {
    existing.amountPerHour = amountPerHour;
    existing.enabled = true;
    existing.updatedAt = ctx.state.clock.year;
  } else {
    ctx.state.market.autoTrades.push({
      id: createRuntimeId("market-auto", [factionId, resourceId, tradeType]),
      playerId: factionId,
      resourceId,
      type: tradeType,
      amountPerHour,
      enabled: true,
      createdAt: ctx.state.clock.year,
      updatedAt: ctx.state.clock.year,
    });
  }

  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, `${tradeType === "auto_buy" ? "Auto-buy" : "Auto-sell"} set to ${formatEnergyAmount(gameHourToRealMinute(amountPerHour))} ${resourceId}/min.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function handleRemoveMarketAutoTrade(socket: WebSocket, perspective: GalaxyPerspective, orderId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return;
  }
  const index = ctx.state.market.autoTrades.findIndex((order) => order.id === orderId && order.playerId === factionId);
  if (index < 0) {
    reject(socket, "Automatic trade not found.");
    return;
  }
  const [removed] = ctx.state.market.autoTrades.splice(index, 1);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, `${removed?.type === "auto_buy" ? "Auto-buy" : "Auto-sell"} removed.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function formatEnergyAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(1);
}

function commitPlanetState(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  message: string,
  nextPlanetState: PlanetState,
): void {
  const index = ctx.state.planetStates.findIndex((planetState) => planetState.id === nextPlanetState.id);
  if (index < 0) {
    reject(socket, "Planet not found.");
    return;
  }
  ctx.state.planetStates[index] = recalculatePlanetStateEconomy(
    nextPlanetState,
    getPlanetDistrictLimitsFromState(ctx.state, nextPlanetState),
    getPlanetTechnologyModifiers(ctx.state, nextPlanetState),
    getPlanetSpeciesContext(ctx.state, nextPlanetState),
  );
  applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, message);
  sendPlanetDetails(socket, perspective, nextPlanetState.id);
  queuePlanetDetailRefresh(nextPlanetState.id);
  broadcastUpdates(["clock", "factionEconomies", "habitedPlanetSystems"]);
}

function validateStarbaseCommand(socket: WebSocket, perspective: GalaxyPerspective, starbaseId: string): ServerStarbase | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }

  const starbase = ctx.state.starbases.find((candidate) => candidate.id === starbaseId);
  if (!starbase) {
    reject(socket, "Starbase not found.");
    return null;
  }
  if (starbase.ownerId !== factionId) {
    reject(socket, "You do not own that starbase.");
    return null;
  }
  if (!hasCommandLink(ctx.state, factionId, starbase.starId)) {
    reject(socket, "Starbase command link unavailable.");
    return null;
  }
  if (!canAccessStar(ctx, perspective, starbase.starId)) {
    reject(socket, "Starbase is not available.");
    return null;
  }
  return starbase;
}

function commitStarbase(socket: WebSocket, message: string, nextStarbase: ServerStarbase): void {
  const index = ctx.state.starbases.findIndex((starbase) => starbase.id === nextStarbase.id);
  if (index < 0) {
    reject(socket, "Starbase not found.");
    return;
  }
  const normalized = normalizeStarbase(nextStarbase);
  ctx.state.starbases[index] = normalized;
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, message);
  broadcastUpdates(["clock", "starbases", "factionEconomies"]);
}

function handleUpgradeStarbase(socket: WebSocket, perspective: GalaxyPerspective, starbaseId: string): void {
  const starbase = validateStarbaseCommand(socket, perspective, starbaseId);
  if (!starbase) return;
  if (starbase.status !== "online") return reject(socket, "Starbase is not online.");
  if (!STARBASE_LEVEL_DEFINITIONS[starbase.level]?.upgrade) return reject(socket, "Starbase is already at maximum level.");
  if (starbase.constructionQueue.some((item) => item.kind === "upgrade")) {
    return reject(socket, "Starbase upgrade is already queued.");
  }
  const item = createStarbaseUpgradeQueueItem(starbase.level);
  if (!item) return reject(socket, "Starbase cannot upgrade.");
  if (!spendResources(socket, starbase.ownerId, item.cost)) return;
  commitStarbase(socket, "Starbase upgrade queued.", {
    ...starbase,
    constructionQueue: [...starbase.constructionQueue, item],
  });
}

function handleBuildStarbaseBuilding(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  starbaseId: string,
  slotIndex: number,
  buildingKind: StarbaseBuildingKind,
): void {
  const starbase = validateStarbaseCommand(socket, perspective, starbaseId);
  if (!starbase) return;
  if (!isStarbaseBuildingKind(buildingKind)) return reject(socket, "Invalid starbase building.");
  if (!requireUnlocked(socket, starbase.ownerId, getRequiredTechIdsForStarbaseBuilding(buildingKind))) return;
  if (getNebulaGatedBuildingKinds().has(buildingKind)
    && !nebulaEnablesBuildingAtStar(ctx.state.nebulae, starbase.starId, buildingKind)) {
    return reject(socket, "This building can only be built inside the right nebula.");
  }
  const unlockedSlots = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.buildingSlots ?? 0;
  if (!isValidSlotIndex(slotIndex, starbase.buildingSlots.length) || slotIndex >= unlockedSlots) {
    return reject(socket, "Invalid starbase building slot.");
  }
  if (starbase.buildingSlots[slotIndex]) return reject(socket, "Starbase building slot is occupied.");
  if (hasQueuedStarbaseBuildingTarget(starbase.constructionQueue, slotIndex)) {
    return reject(socket, "Starbase building slot is already queued.");
  }
  const item = createStarbaseBuildingQueueItem(buildingKind, slotIndex);
  if (!spendResources(socket, starbase.ownerId, item.cost)) return;
  commitStarbase(socket, "Starbase building queued.", {
    ...starbase,
    constructionQueue: [...starbase.constructionQueue, item],
  });
}

function handleBuildStarbaseShip(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  starbaseId: string,
  shipKind: StarbaseShipKind,
  designId?: string,
): void {
  const starbase = validateStarbaseCommand(socket, perspective, starbaseId);
  if (!starbase) return;
  if (!isStarbaseShipKind(shipKind)) return reject(socket, "Invalid ship design.");
  const shipyardCount = countStarbaseShipyards(starbase.buildingSlots);
  if (shipyardCount <= 0) return reject(socket, "Starbase has no completed shipyards.");
  if (shipKind === "defensePlatform") {
    const capacity = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.defensePlatformCapacity ?? 0;
    const built = ctx.state.fleets
      .filter((fleet) => fleet.stationaryStarbaseId === starbase.id && fleet.ownerId === starbase.ownerId)
      .reduce((total, fleet) => total + fleet.shipIds.length, 0);
    const queued = starbase.shipQueue.filter((item) => item.kind === "build" && item.shipKind === "defensePlatform").length;
    if (built + queued >= capacity) return reject(socket, "Defense platform capacity reached.");
  }
  const design = findShipDesign(ctx.state.shipDesigns, starbase.ownerId, shipKind, designId, false);
  if (!design) return reject(socket, "Ship design is unavailable.");
  if (!isShipDesignUnlockedForFaction(ctx, starbase.ownerId, design)) {
    return reject(socket, `Requires ${getShipDesignMissingTechnologyName(ctx, starbase.ownerId, design) ?? "required technology"}.`);
  }
  const stats = calculateShipDesignStats(design);
  const item = createStarbaseShipQueueItem(shipKind, {
    kind: "build",
    designId: design.id,
    label: design.name,
    cost: stats.cost,
    totalDays: stats.buildDays,
    remainingDays: stats.buildDays,
    alloyUpkeepPerDay: stats.alloyUpkeepPerDay,
    crewDemand: stats.crewDemand,
  });
  if (!spendResources(socket, starbase.ownerId, item.upfrontCost)) return;
  commitStarbase(socket, "Ship queued.", {
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
}

function handleUpgradeShip(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "upgradeShip" }>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const ship = ctx.state.ships.find((candidate) => candidate.id === command.shipId);
  if (!ship) return reject(socket, "Ship not found.");
  if (ship.ownerId !== factionId) return reject(socket, "You do not own that ship.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === ship.fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (!isFleetAvailableForOrders(fleet)) return reject(socket, "Fleet is already busy.");

  const starbase = validateStarbaseCommand(socket, perspective, command.starbaseId);
  if (!starbase) return;
  if (starbase.starId !== fleet.currentStarId) return reject(socket, "Move the fleet to a shipyard system before upgrading.");
  if (countStarbaseShipyards(starbase.buildingSlots) <= 0) return reject(socket, "Starbase has no completed shipyards.");
  const alreadyQueued = ctx.state.starbases.some((candidate) => (
    candidate.shipQueue.some((item) => item.kind === "upgrade" && item.shipId === ship.id)
  ));
  if (alreadyQueued) return reject(socket, "Ship upgrade is already queued.");

  const currentDesign = findShipDesign(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, true);
  if (!currentDesign) return reject(socket, "Current ship design is unavailable.");
  const explicitTarget = command.targetDesignId
    ? findShipDesignById(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, command.targetDesignId, false)
    : null;
  if (command.targetDesignId && !explicitTarget) return reject(socket, "Target ship design is unavailable.");
  const assignedTarget = ship.targetDesignId
    ? findShipDesignById(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, ship.targetDesignId, false)
    : null;
  const targetDesign = explicitTarget ?? assignedTarget ?? getNewestActiveShipDesign(ctx.state.shipDesigns, ship.ownerId, ship.shipKind);
  if (!targetDesign) return reject(socket, "No active target design is available.");
  if (!isShipDesignUnlockedForFaction(ctx, factionId, targetDesign)) {
    return reject(socket, `Requires ${getShipDesignMissingTechnologyName(ctx, factionId, targetDesign) ?? "required technology"}.`);
  }
  const isPlatformReactivation = ship.shipKind === "defensePlatform" && ship.disabled === true;
  if (targetDesign.id === currentDesign.id && !isPlatformReactivation) {
    return reject(socket, "Ship is already using the newest available design.");
  }

  const upgrade = isPlatformReactivation
    ? (() => {
      const stats = calculateShipDesignStats(currentDesign);
      const cost = createEmptyResourceCounts();
      for (const resource of RESOURCE_KINDS) cost[resource] = stats.cost[resource] * 0.15;
      const totalDays = Math.max(1, Math.ceil(stats.buildDays * 0.25));
      return { cost, totalDays, alloyUpkeepPerDay: cost.alloys / totalDays };
    })()
    : calculateShipUpgradePlan(currentDesign, targetDesign);
  const item = createStarbaseShipQueueItem(ship.shipKind, {
    kind: "upgrade",
    shipId: ship.id,
    designId: currentDesign.id,
    targetDesignId: targetDesign.id,
    label: isPlatformReactivation ? `Reactivate ${targetDesign.name}` : `Upgrade to ${targetDesign.name}`,
    cost: upgrade.cost,
    totalDays: upgrade.totalDays,
    remainingDays: upgrade.totalDays,
    alloyUpkeepPerDay: upgrade.alloyUpkeepPerDay,
    crewDemand: 0,
  });
  if (!spendResources(socket, factionId, item.upfrontCost)) return;

  ship.targetDesignId = targetDesign.id;
  fleet.systemPosition = getSystemStarbaseOrbitPosition(starbase.systemPosition);
  applyFleetOrbitTarget(fleet, createStarbaseOrbitTarget(starbase, fleet.systemPosition));
  setFleetPhase(fleet, "orbiting");
  const starbaseIndex = ctx.state.starbases.findIndex((candidate) => candidate.id === starbase.id);
  ctx.state.starbases[starbaseIndex] = normalizeStarbase({
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
  syncFleetMembership(ctx, ctx.state);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, isPlatformReactivation ? "Defense-platform reactivation queued." : "Ship upgrade queued.");
  broadcastUpdates(["clock", "starbases", "ships", "fleets", "factionEconomies"]);
}

function handleSaveShipDesign(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "saveShipDesign" }>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  if (!isKnownShipKind(command.shipKind)) return reject(socket, "Invalid ship hull.");
  const current = command.designId
    ? ctx.state.shipDesigns.find((design) => design.id === command.designId && design.ownerId === factionId)
    : null;
  if (command.designId && !current) return reject(socket, "Ship design not found.");

  const raw: Partial<ShipDesign> = {
    id: current?.id ?? createRuntimeId("design", [factionId, command.shipKind]),
    ownerId: factionId,
    shipKind: command.shipKind,
    name: command.name,
    status: "active",
    weaponSectionModuleIds: command.weaponSectionModuleIds,
    defenseSectionModuleIds: command.defenseSectionModuleIds,
    weaponModuleIds: command.weaponModuleIds,
    defenseModuleIds: command.defenseModuleIds,
    utilityModuleIds: command.utilityModuleIds,
    utilityModuleId: command.utilityModuleId ?? null,
    createdAtYear: current?.createdAtYear ?? ctx.state.clock.year,
    updatedAtYear: ctx.state.clock.year,
  };
  const nextDesign = normalizeShipDesign(raw, factionId, ctx.state.clock.year);
  const missingTechnology = getShipDesignMissingTechnologyName(ctx, factionId, nextDesign);
  if (missingTechnology) return reject(socket, `Requires ${missingTechnology}.`);
  const hull = SHIP_HULL_DEFINITIONS[nextDesign.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  const layout = getShipDesignLayout(nextDesign);
  if (
    nextDesign.weaponSectionModuleIds.length !== hull.weaponSectionSlots
    || nextDesign.defenseSectionModuleIds.length !== hull.defenseSectionSlots
    || nextDesign.weaponModuleIds.length !== layout.weaponSlots.length
    || nextDesign.defenseModuleIds.length !== layout.defenseSlots.length
    || nextDesign.utilityModuleIds.length !== layout.utilitySlots.length
  ) {
    return reject(socket, "Ship design slots are invalid.");
  }
  if (current) {
    ctx.state.shipDesigns = ctx.state.shipDesigns.map((design) => (design.id === current.id ? nextDesign : design));
  } else {
    ctx.state.shipDesigns.push(nextDesign);
  }
  const shipsChanged = syncShipsForDesign(ctx, ctx.state, nextDesign);
  ctx.hasDirtyState = true;
  accept(socket, "Ship design saved.");
  broadcastUpdates(shipsChanged ? ["shipDesigns", "ships", "fleets"] : ["shipDesigns"]);
}

function handleDecommissionShipDesign(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  designId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const design = ctx.state.shipDesigns.find((candidate) => candidate.id === designId && candidate.ownerId === factionId);
  if (!design) return reject(socket, "Ship design not found.");
  if (design.status === "decommissioned") return reject(socket, "Ship design is already decommissioned.");
  const activeCount = ctx.state.shipDesigns.filter((candidate) => (
    candidate.ownerId === factionId
    && candidate.shipKind === design.shipKind
    && candidate.status === "active"
  )).length;
  if (activeCount <= 1) return reject(socket, "At least one active design is required.");
  design.status = "decommissioned";
  design.updatedAtYear = ctx.state.clock.year;
  const targetDesign = getNewestActiveShipDesign(ctx.state.shipDesigns, factionId, design.shipKind);
  let shipsChanged = false;
  let starbasesChanged = false;
  if (targetDesign) {
    for (const ship of ctx.state.ships) {
      if (
        ship.ownerId !== factionId
        || ship.shipKind !== design.shipKind
        || (ship.designId !== design.id && ship.targetDesignId !== design.id)
      ) {
        continue;
      }
      ship.targetDesignId = targetDesign.id;
      shipsChanged = true;
    }
    ctx.state.starbases = ctx.state.starbases.map((starbase) => {
      let queueChanged = false;
      const shipQueue = starbase.shipQueue.map((item) => {
        if (item.kind !== "upgrade" || item.targetDesignId !== design.id) return item;
        const ship = item.shipId ? ctx.state.ships.find((candidate) => candidate.id === item.shipId) : null;
        const currentDesign = ship
          ? findShipDesignById(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, true)
          : design;
        const upgrade = currentDesign ? calculateShipUpgradePlan(currentDesign, targetDesign) : null;
        const replacement = upgrade ? createStarbaseShipQueueItem(item.shipKind, {
          ...item,
          cost: upgrade.cost,
          totalDays: upgrade.totalDays,
          remainingDays: Math.min(item.remainingDays, upgrade.totalDays),
          alloyUpkeepPerDay: upgrade.alloyUpkeepPerDay,
        }) : null;
        queueChanged = true;
        return {
          ...item,
          targetDesignId: targetDesign.id,
          cost: upgrade?.cost ?? item.cost,
          upfrontCost: replacement?.upfrontCost ?? item.upfrontCost,
          resourceUpkeepPerDay: replacement?.resourceUpkeepPerDay ?? item.resourceUpkeepPerDay,
          totalDays: upgrade?.totalDays ?? item.totalDays,
          remainingDays: Math.min(item.remainingDays, upgrade?.totalDays ?? item.remainingDays),
          alloyUpkeepPerDay: upgrade?.alloyUpkeepPerDay ?? item.alloyUpkeepPerDay,
        };
      });
      if (!queueChanged) return starbase;
      starbasesChanged = true;
      return normalizeStarbase({ ...starbase, shipQueue });
    });
  }
  ctx.hasDirtyState = true;
  accept(socket, "Ship design decommissioned.");
  const changed: ServerUpdateField[] = ["shipDesigns"];
  if (shipsChanged) changed.push("ships");
  if (starbasesChanged) changed.push("starbases");
  broadcastUpdates(changed);
}

function handleBuildDistrict(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  districtKind: DistrictKind,
): void {
  if (!isDistrictKind(districtKind)) return reject(socket, "Invalid district type.");
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  const limits = getPlanetDistrictLimits(planetState);
  if (!limits) return reject(socket, "Planet limits unavailable.");
  if (planetState.builtDistricts[districtKind] >= limits[districtKind]) {
    return reject(socket, "District limit reached.");
  }
  if (planetState.builtDistricts[districtKind] + getQueuedDistrictCount(planetState, districtKind) >= limits[districtKind]) {
    return reject(socket, "District is already queued to its limit.");
  }
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const item = createDistrictConstructionQueueItem(districtKind);
  if (!spendMinerals(socket, factionId, item.mineralCost)) return;

  commitPlanetState(socket, perspective, "District queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function handleBuildPlanetBuilding(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  buildingKind: BuildingKind,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  if (!BUILDING_KINDS.includes(buildingKind)) return reject(socket, "Invalid building.");
  if (BUILDING_DEFINITIONS[buildingKind].autoPlaced) return reject(socket, "This building cannot be constructed manually.");
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  if (!requireUnlocked(socket, factionId, getRequiredTechIdsForBuilding(buildingKind))) return;

  if (area === "urbanSubDistrict") {
    if (
      subDistrictIndex === undefined
      || !isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)
    ) {
      return reject(socket, "Invalid sub-district.");
    }
    const subDistrict = planetState.urbanSubDistricts[subDistrictIndex];
    if (!isValidSlotIndex(slotIndex, subDistrict.buildings.length)) return reject(socket, "Invalid building slot.");
    if (subDistrict.buildings[slotIndex]) return reject(socket, "Building slot is occupied.");
    if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
      return reject(socket, "Building slot is already queued.");
    }
    if (!isBuildingCompatible(buildingKind, area, subDistrict.kind)) {
      return reject(socket, "Building is incompatible with this sub-district.");
    }
    const item = createBuildingConstructionQueueItem(buildingKind, area, slotIndex, subDistrictIndex);
    if (!spendMinerals(socket, factionId, item.mineralCost)) return;
    commitPlanetState(socket, perspective, "Building queued.", {
      ...planetState,
      constructionQueue: [...planetState.constructionQueue, item],
    });
    return;
  }

  if (!isDistrictKind(area)) return reject(socket, "Invalid building area.");
  const slots = planetState.buildings[area];
  if (!isValidSlotIndex(slotIndex, slots.length)) return reject(socket, "Invalid building slot.");
  if (slots[slotIndex]) return reject(socket, "Building slot is occupied.");
  if (hasQueuedBuildingTarget(planetState, area, slotIndex)) return reject(socket, "Building slot is already queued.");
  if (!isBuildingCompatible(buildingKind, area)) return reject(socket, "Building is incompatible with this district.");
  const item = createBuildingConstructionQueueItem(buildingKind, area, slotIndex);
  if (!spendMinerals(socket, factionId, item.mineralCost)) return;

  commitPlanetState(socket, perspective, "Building queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function handleUpgradePlanetBuilding(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(socket, "Observer mode is read-only.");

  let buildingSlot: PlanetBuildingSlot | undefined;
  let subDistrictKind: UrbanSubDistrictKind | undefined;
  if (area === "urbanSubDistrict") {
    if (
      subDistrictIndex === undefined
      || !isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)
    ) {
      return reject(socket, "Invalid sub-district.");
    }
    const subDistrict = planetState.urbanSubDistricts[subDistrictIndex];
    if (!isValidSlotIndex(slotIndex, subDistrict.buildings.length)) return reject(socket, "Invalid building slot.");
    buildingSlot = subDistrict.buildings[slotIndex];
    subDistrictKind = subDistrict.kind;
  } else {
    if (!isDistrictKind(area)) return reject(socket, "Invalid building area.");
    const slots = planetState.buildings[area];
    if (!isValidSlotIndex(slotIndex, slots.length)) return reject(socket, "Invalid building slot.");
    buildingSlot = slots[slotIndex];
  }

  const buildingKind = getPlanetBuildingKind(buildingSlot);
  if (!buildingKind) return reject(socket, "Building slot is empty.");
  if (!isBuildingCompatible(buildingKind, area, subDistrictKind)) {
    return reject(socket, "Building is incompatible with this district.");
  }
  const currentLevel = getPlanetBuildingLevel(buildingSlot);
  const targetLevel = getBuildingUpgradeTargetLevel(buildingSlot);
  if (!targetLevel) return reject(socket, "Building is already at maximum level.");
  if (!requireUnlocked(socket, factionId, getRequiredTechIdsForBuildingLevel(buildingKind, targetLevel))) return;
  if (!meetsCapitalUpgradePopulation(buildingKind, targetLevel, planetState.population)) {
    return reject(socket, `Requires a population of at least ${getCapitalUpgradePopulationThreshold(targetLevel).toLocaleString()}.`);
  }
  if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
    return reject(socket, "Building slot is already queued.");
  }

  const item = createBuildingUpgradeConstructionQueueItem(
    buildingKind,
    currentLevel,
    area,
    slotIndex,
    subDistrictIndex,
  );
  if (!spendMinerals(socket, factionId, item.mineralCost)) return;
  commitPlanetState(socket, perspective, "Building upgrade queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function getPlanetBuildingAt(
  planetState: PlanetState,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): PlanetBuildingSlot | undefined {
  if (area === "urbanSubDistrict") {
    if (subDistrictIndex === undefined || !isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)) return undefined;
    const buildings = planetState.urbanSubDistricts[subDistrictIndex].buildings;
    return isValidSlotIndex(slotIndex, buildings.length) ? buildings[slotIndex] : undefined;
  }
  if (!isDistrictKind(area)) return undefined;
  const buildings = planetState.buildings[area];
  return isValidSlotIndex(slotIndex, buildings.length) ? buildings[slotIndex] : undefined;
}

function withPlanetBuildingAt(
  planetState: PlanetState,
  area: BuildingSlotArea,
  slotIndex: number,
  building: PlanetBuildingSlot,
  subDistrictIndex?: number,
): PlanetState {
  if (area === "urbanSubDistrict" && subDistrictIndex !== undefined) {
    return {
      ...planetState,
      urbanSubDistricts: planetState.urbanSubDistricts.map((subDistrict, index) => index === subDistrictIndex
        ? { ...subDistrict, buildings: subDistrict.buildings.map((slot, buildingIndex) => buildingIndex === slotIndex ? building : slot) }
        : subDistrict),
    };
  }
  if (area === "urbanSubDistrict") return planetState;
  return {
    ...planetState,
    buildings: {
      ...planetState.buildings,
      [area]: planetState.buildings[area].map((slot, index) => index === slotIndex ? building : slot),
    },
  };
}

function handleDowngradePlanetBuilding(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  const building = getPlanetBuildingAt(planetState, area, slotIndex, subDistrictIndex);
  const buildingKind = getPlanetBuildingKind(building);
  if (!buildingKind) return reject(socket, "Building slot is empty or invalid.");
  if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
    return reject(socket, "Cancel this building's queued construction first.");
  }
  const level = getPlanetBuildingLevel(building);
  if (level <= 1 && BUILDING_DEFINITIONS[buildingKind].autoPlaced) {
    return reject(socket, "This building cannot be demolished.");
  }
  const replacement = level > 1
    ? createPlanetBuildingState(buildingKind, level - 1, isPlanetBuildingEnabled(building))
    : null;
  commitPlanetState(
    socket,
    perspective,
    level > 1 ? "Building downgraded." : "Building demolished.",
    withPlanetBuildingAt(planetState, area, slotIndex, replacement, subDistrictIndex),
  );
}

function handleSetPlanetBuildingEnabled(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  enabled: boolean,
  subDistrictIndex?: number,
): void {
  if (typeof enabled !== "boolean") return reject(socket, "Invalid building status.");
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  const building = getPlanetBuildingAt(planetState, area, slotIndex, subDistrictIndex);
  const buildingKind = getPlanetBuildingKind(building);
  if (!buildingKind) return reject(socket, "Building slot is empty or invalid.");
  const replacement = createPlanetBuildingState(buildingKind, getPlanetBuildingLevel(building), enabled);
  commitPlanetState(
    socket,
    perspective,
    enabled ? "Building enabled." : "Building disabled.",
    withPlanetBuildingAt(planetState, area, slotIndex, replacement, subDistrictIndex),
  );
}

function handleCancelPlanetConstruction(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  queueItemId: string,
): void {
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  const item = planetState.constructionQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return reject(socket, "Construction item not found.");
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const remainingRatio = item.totalDays > 0 ? Math.max(0, Math.min(1, item.remainingDays / item.totalDays)) : 0;
  const mineralRefund = Math.floor(item.mineralCost * remainingRatio);
  if (mineralRefund > 0) refundResources(factionId, { minerals: mineralRefund });

  commitPlanetState(socket, perspective, "Construction cancelled.", {
    ...planetState,
    constructionQueue: planetState.constructionQueue.filter((candidate) => candidate.id !== queueItemId),
  });
}

function handleSkipPlanetConstruction(
  session: ClientSession,
  planetId: string,
  queueItemId: string,
): void {
  const planetState = validatePlanetCommand(session.socket, session.perspective, planetId);
  if (!planetState) return;
  const item = planetState.constructionQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return reject(session.socket, "Construction item not found.");

  const completed = completePlanetConstructionQueueItem(
    planetState,
    queueItemId,
    getPlanetDistrictLimitsFromState(ctx.state, planetState) ?? undefined,
    getPlanetTechnologyModifiers(ctx.state, planetState),
    getPlanetSpeciesContext(ctx.state, planetState),
  );
  if (!completed) return reject(session.socket, "This construction item can no longer be completed.");

  const cost = getConstructionDarkMatterCost(item.remainingDays);
  const balance = authStore.spendPlayerDarkMatter(session.account.id, cost);
  if (balance === null) return reject(session.socket, `Need ${cost} Dark Matter.`);

  broadcastAccountDarkMatter(session.account.id, balance);
  commitPlanetState(
    session.socket,
    session.perspective,
    `${item.label} completed instantly for ${cost} Dark Matter.`,
    completed.state,
  );
}

function handleSetUrbanSubDistrict(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  planetId: string,
  subDistrictIndex: number,
  subDistrictKind: UrbanSubDistrictKind,
): void {
  const planetState = validatePlanetCommand(socket, perspective, planetId);
  if (!planetState) return;
  if (!URBAN_SUB_DISTRICT_KINDS.includes(subDistrictKind)) return reject(socket, "Invalid sub-district type.");
  if (!isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)) {
    return reject(socket, "Invalid sub-district.");
  }

  const urbanSubDistricts = planetState.urbanSubDistricts.map((subDistrict, index) => {
    if (index !== subDistrictIndex) return subDistrict;
    return {
      kind: subDistrictKind,
      buildings: subDistrict.buildings.map((building) => {
        const buildingKind = getPlanetBuildingKind(building);
        return buildingKind && isBuildingCompatible(buildingKind, "urbanSubDistrict", subDistrictKind) ? building : null;
      }),
    };
  });

  const constructionQueue = filterInvalidQueuedBuildingsForSubDistrictChange(
    planetState,
    subDistrictIndex,
    subDistrictKind,
  );
  commitPlanetState(socket, perspective, "Sub-district changed.", { ...planetState, urbanSubDistricts, constructionQueue });
}




// ===========================================================================
// Events & Situations engine
// ===========================================================================
// Generic, data-driven framework: event choices and situation thresholds both
// emit GameEffect[] which `applyGameEffects` is the single place to apply. New
// content is data (Events.ts / Situations.ts) plus, occasionally, a new effect.

const SHORTAGE_SITUATION_RESOURCES: ResourceKind[] = ["food", "minerals", "energy", "goods", "alloys"];

function processSituations(elapsedGameDays: number): boolean {
  if (elapsedGameDays <= 0) return false;
  let changed = false;

  changed = expireFactionModifiers(ctx) || changed;

  for (const faction of ctx.state.factions) {
    const factionId = faction.id;
    const flows = calculateFactionResourceFlow(ctx.state, factionId);
    const economy = ctx.state.factionEconomies.find((e) => e.factionId === factionId);

    for (const resource of SHORTAGE_SITUATION_RESOURCES) {
      const stockpile = economy?.stockpiles[resource] ?? 0;
      const production = flows.production[resource] ?? 0;
      const consumption = flows.consumption[resource] ?? 0;
      const monthlyDelta = (production - consumption) * 30;
      const severity = computeShortageSeverity(stockpile, monthlyDelta, consumption);

      const instanceId = situationInstanceId(SHORTAGE_SITUATION_ID, factionId, resource);
      const existing = ctx.state.situations.find((candidate) => candidate.id === instanceId);

      if (severity > 0) {
        const delta = SHORTAGE_PROGRESS_RISE_PER_DAY * elapsedGameDays * severity;
        if (existing) {
          const previous = existing.progress;
          existing.progress = Math.min(100, existing.progress + delta);
          if (fireSituationThresholds(ctx, existing, previous)) changed = true;
          if (existing.progress !== previous) changed = true;
        } else {
          const situation: ActiveSituation = {
            id: instanceId,
            defId: SHORTAGE_SITUATION_ID,
            factionId,
            subject: resource,
            progress: Math.min(100, delta),
            lastThreshold: 0,
            startedAtYear: ctx.state.clock.year,
          };
          ctx.state.situations.push(situation);
          fireSituationThresholds(ctx, situation, 0);
          changed = true;
        }
      } else if (existing) {
        const previous = existing.progress;
        existing.progress = Math.max(0, existing.progress - SHORTAGE_PROGRESS_FALL_PER_DAY * elapsedGameDays);
        if (existing.progress !== previous) changed = true;
        if (existing.progress <= 0) {
          ctx.state.situations = ctx.state.situations.filter((candidate) => candidate.id !== instanceId);
          changed = true;
        }
      }
    }
  }

  if (changed) ctx.hasDirtyState = true;
  return changed;
}






































function fleetUpdateSignature(): string {
  return JSON.stringify(ctx.state.fleets.map((fleet) => ({
    id: fleet.id,
    ownerId: fleet.ownerId,
    shipIds: fleet.shipIds,
    formation: fleet.formation,
    currentStarId: fleet.currentStarId,
    targetStarId: fleet.targetStarId,
    phase: fleet.phase,
    phaseStartedAtYear: fleet.phaseStartedAtYear,
    phaseDurationDays: fleet.phaseDurationDays,
    route: fleet.route,
    routeIndex: fleet.routeIndex,
    orderType: fleet.orderType,
    speed: fleet.speed,
    combatStance: fleet.combatStance,
    retreatState: fleet.retreatState,
    movementPlan: fleet.movementPlan,
    darkMatterBoostActive: fleet.darkMatterBoostActive,
    darkMatterBoostPaidUntilYear: fleet.darkMatterBoostPaidUntilYear,
    orbitTargetPlanetId: fleet.orbitTargetPlanetId,
    orbitOffset: fleet.orbitOffset,
    orbitTarget: fleet.orbitTarget,
    mergeTargetFleetId: fleet.mergeTargetFleetId,
    combatSettings: fleet.combatSettings,
    currentTacticalOrder: fleet.currentTacticalOrder,
    tacticalRadius: fleet.tacticalRadius,
    maxWeaponRange: fleet.maxWeaponRange,
    minWeaponRange: fleet.minWeaponRange,
    currentTargetId: fleet.currentTargetId,
    currentTargetKind: fleet.currentTargetKind,
    combatStatus: fleet.combatStatus,
    lastCombatAtYear: fleet.lastCombatAtYear,
  })));
}

function processFleetDarkMatterBoostBilling(targetYear: number): boolean {
  const oneDayYears = 1 / GAME_DAYS_PER_YEAR;
  let changed = false;

  for (const fleet of ctx.state.fleets) {
    if (!fleet.darkMatterBoostActive) continue;
    const plan = fleet.movementPlan;
    const paidUntil = fleet.darkMatterBoostPaidUntilYear;
    if (!plan || paidUntil === null || ctx.state.clock.year >= plan.endsAtYear) {
      fleet.darkMatterBoostActive = false;
      fleet.darkMatterBoostPaidUntilYear = null;
      changed = true;
      continue;
    }

    const lastBillableYear = Math.min(targetYear, plan.endsAtYear - oneDayYears * 1e-6);
    if (lastBillableYear + Number.EPSILON < paidUntil) continue;
    const chargesDue = Math.max(
      0,
      Math.floor((lastBillableYear - paidUntil) / oneDayYears + 1 + 1e-7),
    );
    if (chargesDue === 0) continue;

    const accountId = authStore.getAccountIdForGameFaction(ctx.game.id, fleet.ownerId);
    const available = accountId === null ? 0 : authStore.getPlayerDarkMatter(accountId);
    const payableDays = Math.min(chargesDue, Math.floor(available / DARK_MATTER_FLEET_COST_PER_MOVING_DAY));
    if (accountId !== null && payableDays > 0) {
      const balance = authStore.spendPlayerDarkMatter(
        accountId,
        payableDays * DARK_MATTER_FLEET_COST_PER_MOVING_DAY,
      );
      if (balance !== null) broadcastAccountDarkMatter(accountId, balance);
    }

    const nextPaidUntil = paidUntil + payableDays * oneDayYears;
    if (payableDays < chargesDue) {
      rescaleFleetMovementPlan(ctx, fleet, DARK_MATTER_FLEET_SPEED_MULTIPLIER, nextPaidUntil);
      fleet.darkMatterBoostActive = false;
      fleet.darkMatterBoostPaidUntilYear = null;
    } else {
      fleet.darkMatterBoostPaidUntilYear = nextPaidUntil;
    }
    changed = true;
  }

  return changed;
}

function advanceState(now: number): Set<ServerUpdateField> {
  const changed = new Set<ServerUpdateField>();
  syncClockSpeedFields();
  const elapsedMs = Math.max(0, now - ctx.state.clock.lastUpdatedAt);
  if (elapsedMs <= 0) return changed;
  if (ctx.state.clock.paused) {
    ctx.state.clock.lastUpdatedAt = now;
    ctx.state.clock.syncedAtMs = now;
    return changed;
  }
  const previousFleetSignature = fleetUpdateSignature();
  const arrivingFleets: GameFleet[] = [];
  const elapsedRealSeconds = elapsedMs / 1000;
  const elapsedGameDays = elapsedRealSeconds * ctx.state.clock.tickSizeDays / Math.max(0.01, ctx.state.clock.tickSpeedSeconds);
  const elapsedGameHours = elapsedGameDays * 24;
  const scaledMs = elapsedGameHours * REAL_MS_PER_GAME_HOUR;
  const targetYear = ctx.state.clock.year + elapsedHoursToGameYear(elapsedGameHours);
  if (processFleetDarkMatterBoostBilling(targetYear)) {
    ctx.hasDirtyState = true;
    changed.add("fleets");
  }
  ctx.state.clock.year = targetYear;
  ctx.state.clock.lastUpdatedAt = now;
  ctx.state.clock.syncedAtMs = now;
  changed.add("clock");

  refreshDiscovery();
  if (processFleetCommandLinkLoss(ctx)) {
    changed.add("fleets");
    changed.add("visibility");
  }

  const movingBefore = ctx.state.fleets.some((fleet) => fleet.phase !== "idle");
  for (const fleet of ctx.state.fleets) {
    if (advanceFleet(ctx, fleet, scaledMs)) {
      arrivingFleets.push(fleet);
    }
  }
  if (processMissingInActionFleets(ctx)) {
    changed.add("fleets");
    changed.add("visibility");
  }
  const movingAfter = ctx.state.fleets.some((fleet) => fleet.phase !== "idle");
  if (movingBefore || movingAfter) {
    refreshDiscovery();
  }
  const combatResult = processContinuousFleetCombat(ctx, elapsedGameHours, elapsedGameDays);
  if (combatResult.combatContactsChanged) {
    ctx.hasDirtyState = true;
    changed.add("combatContacts");
    changed.add("combatProjectiles");
  }
  if (combatResult.shipsChanged) changed.add("ships");
  if (combatResult.fleetsChanged) {
    ctx.hasDirtyState = true;
    changed.add("fleets");
    changed.add("combatReports");
  }
  if (combatResult.starbasesChanged) changed.add("starbases");
  if (combatResult.factionEconomiesChanged) {
    refreshDiscovery();
    changed.add("visibility");
    changed.add("planetStates");
    changed.add("factionEconomies");
  }
  if (combatResult.visibilityChanged) {
    changed.add("visibility");
  }

  if (fleetUpdateSignature() !== previousFleetSignature) {
    ctx.hasDirtyState = true;
    changed.add("fleets");
    changed.add("visibility");
    changed.add("starbases");
  }

  const leaderResult = processLeaderDays(ctx, getLeaderDayIndex(ctx.state.clock.year));
  if (leaderResult.leadersChanged) changed.add("leaders");
  if (leaderResult.planetEconomiesChanged) {
    changed.add("planetStates");
    changed.add("factionEconomies");
  }
  if (leaderResult.fleetEffectsChanged) {
    changed.add("fleets");
    changed.add("factionEconomies");
  }
  if (leaderResult.governmentEffectsChanged) {
    changed.add("governments");
    changed.add("planetStates");
    changed.add("factionEconomies");
    changed.add("fleets");
    changed.add("technologies");
  }

  if (processPlanetConstruction(ctx, elapsedGameDays)) {
    changed.add("factionEconomies");
  }

  if (processStarbaseConstruction(ctx, elapsedGameDays)) {
    changed.add("starbases");
    changed.add("factionEconomies");
  }

  if (processStarbaseRepairs(ctx, elapsedGameDays)) {
    changed.add("starbases");
    changed.add("factionEconomies");
  }
  if (processShipRepairs(ctx, elapsedGameDays)) {
    changed.add("ships");
    changed.add("fleets");
    changed.add("factionEconomies");
  }
  if (processConstructionRepairs(ctx, elapsedGameDays)) {
    changed.add("ships");
    changed.add("fleets");
    changed.add("factionEconomies");
  }

  const shipQueueResult = processStarbaseShipQueues(ctx, elapsedGameDays);
  if (shipQueueResult.starbasesChanged || shipQueueResult.fleetsChanged) {
    changed.add("starbases");
    changed.add("factionEconomies");
    if (shipQueueResult.fleetsChanged) {
      changed.add("ships");
      changed.add("fleets");
      changed.add("visibility");
    }
  }

  const nextEconomyHour = gameYearToHourIndex(ctx.state.clock.year);
  const economyResult = processEconomyHours(ctx, nextEconomyHour);
  if (economyResult.economyChanged) {
    changed.add("factionEconomies");
  }
  if (economyResult.technologiesChanged) {
    changed.add("technologies");
    changed.add("factionEconomies");
  }
  const marketResult = processMarketTicks(ctx, nextEconomyHour);
  if (marketResult.marketChanged || marketResult.economyChanged) {
    refreshFactionEconomyDeltas();
  }
  if (marketResult.marketChanged) {
    changed.add("market");
    changed.add("tradeAlerts");
  }
  if (marketResult.economyChanged || (marketResult.marketChanged && ctx.state.market.autoTrades.length > 0)) {
    changed.add("factionEconomies");
  }
  const shortageShipEffects = processShipShortageEffects(ctx, elapsedGameDays);
  if (shortageShipEffects.shipsChanged) {
    changed.add("ships");
    changed.add("fleets");
  }
  if (shortageShipEffects.starbasesChanged) {
    changed.add("starbases");
  }

  const nextPopulationWeek = gameYearToWeekIndex(ctx.state.clock.year);
  if (processPopulationWeeks(ctx, nextPopulationWeek)) {
    changed.add("factionEconomies");
    changed.add("habitedPlanetSystems");
  }

  // Situations advance from the freshly-computed economy deltas; their progress
  // feeds shortage penalties on the next economy pass (one-tick lag is fine).
  if (processSituations(elapsedGameDays)) {
    changed.add("situations");
    changed.add("factionEconomies");
  }
  if (processRandomEvents(ctx, elapsedGameDays)) {
    changed.add("events");
    changed.add("fleets");
    changed.add("visibility");
  }
  if (processEventTimeouts(ctx)) {
    changed.add("events");
    changed.add("factionEconomies");
    changed.add("leaders");
  }

  return changed;
}


function adminResponse(
  command: Extract<ClientCommand, { type: "adminCommand" }>,
  parsed: ParsedAdminCommand | null,
  ok: boolean,
  message: string,
  options: Partial<Omit<AdminCommandResult, "type" | "requestId" | "ok" | "message">> = {},
): AdminCommandResult {
  return {
    type: "adminCommandResult",
    requestId: command.requestId,
    ok,
    input: command.input,
    command: parsed?.canonicalName ?? parsed?.name,
    message,
    ...options,
  };
}

function sendAdminResponse(socket: WebSocket, result: AdminCommandResult): void {
  sendEvent(socket, result);
}

function adminConfirmationRequired(
  command: Extract<ClientCommand, { type: "adminCommand" }>,
  parsed: ParsedAdminCommand,
): AdminCommandResult | null {
  if (!parsed.definition?.destructive || parsed.flags.has("confirm")) return null;
  return adminResponse(command, parsed, false, `Command "${parsed.canonicalName}" is destructive. Re-run with --confirm.`, {
    destructive: true,
    requiresConfirmation: true,
  });
}


async function handleAdminCommand(
  session: ClientSession,
  command: Extract<ClientCommand, { type: "adminCommand" }>,
): Promise<void> {
  if (!authStore.isAdminAccount(session.account)) {
    sendAdminResponse(session.socket, adminResponse(command, null, false, "Admin commands are not available for this account."));
    return;
  }

  const parsed = parseAdminCommand(command.input);
  if (!parsed) {
    sendAdminResponse(session.socket, adminResponse(command, parsed, false, "Enter an admin command."));
    return;
  }
  const confirmation = adminConfirmationRequired(command, parsed);
  if (confirmation) {
    sendAdminResponse(session.socket, confirmation);
    return;
  }
  try {
    const result = await executeAdminCommand(ctx, parsed, command, session.perspective);
    const changed = result.changed ? Array.from(new Set(result.changed)) : [];
    sendAdminResponse(session.socket, adminResponse(command, parsed, true, result.message, {
      rows: result.rows,
      changed,
      destructive: parsed.definition?.destructive === true,
    }));
    if (changed.length > 0) {
      broadcastUpdates(changed);
      flushPlanetDetailRefreshes();
    }
  } catch (error) {
    sendAdminResponse(session.socket, adminResponse(
      command,
      parsed,
      false,
      error instanceof Error ? error.message : "Admin command failed.",
      { destructive: parsed.definition?.destructive === true },
    ));
  }
}

function handleSetActiveTechnology(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  techId: TechId,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const tech = TECHNOLOGY_BY_ID[techId];
  if (!tech) return reject(socket, "Technology not found.");
  const techState = getFactionTechnology(ctx.state, factionId);
  if (!techState) return reject(socket, "Faction technology ctx.state unavailable.");
  if (isTechnologyCompleted(techState, techId)) return reject(socket, `${tech.name} is already completed.`);
  if (!isTechnologyAvailable(tech, techState)) {
    const missing = getMissingPrerequisites(tech, techState)
      .map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id)
      .join(", ");
    return reject(socket, missing ? `Requires ${missing}.` : "Technology is not available.");
  }
  techState.activeTechId = techId;
  ctx.hasDirtyState = true;
  accept(socket, `Research focus set to ${tech.name}.`);
  broadcastUpdates(["technologies"]);
}

function isGovernmentLawOptionUnlocked(factionId: number, option: GovernmentLawOption): boolean {
  if (!option.requiresTechId) return true;
  const techState = getFactionTechnology(ctx.state, factionId);
  return Boolean(techState && isTechnologyCompleted(techState, option.requiresTechId));
}

function handleResolveEvent(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  eventId: string,
  choiceId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const event = ctx.state.events.find((candidate) => candidate.id === eventId && candidate.factionId === factionId);
  if (!event) return reject(socket, "Event is no longer available.");
  if (!event.choices.some((choice) => choice.id === choiceId)) return reject(socket, "Unknown event choice.");
  resolveActiveEvent(ctx, event, choiceId);
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  // Resolving applies arbitrary GameEffects (spawn a leader, trigger another event,
  // grant resources, adjust a situation, lose a fleet, ...). Broadcast every scope
  // those can touch so the change reaches ctx.clients live â€” otherwise the resolved
  // event's notification lingers until a full reload (the leader-offer bug).
  broadcastUpdates(["events", "leaders", "situations", "fleets", "factionEconomies", "planetStates"]);
  accept(socket, "Decision recorded.");
}

function handleSetGovernmentLaw(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  lawId: GovernmentLawId,
  optionId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const law = GOVERNMENT_LAW_BY_ID[lawId];
  const option = law ? getGovernmentLawOption(lawId, optionId) : undefined;
  if (!law || !option) return reject(socket, "Government law option not found.");
  if (!isGovernmentLawOptionUnlocked(factionId, option)) {
    const required = option.requiresTechId ? TECHNOLOGY_BY_ID[option.requiresTechId]?.name ?? option.requiresTechId : "required technology";
    return reject(socket, `Requires ${required}.`);
  }
  let government = ctx.state.governments.find((candidate) => candidate.factionId === factionId);
  if (!government) {
    government = createInitialGovernmentState(factionId);
    ctx.state.governments.push(government);
  }
  if (government.selectedLawOptionIds[lawId] === option.id) {
    return accept(socket, `${law.name} already uses ${option.name}.`);
  }
  const previousRights = JSON.stringify(getFactionSpeciesRightsState(ctx.state, factionId));
  government.selectedLawOptionIds[lawId] = option.id;
  ctx.state.speciesRights = normalizeSpeciesRightsForFactions(ctx.state);
  const rightsChanged = previousRights !== JSON.stringify(getFactionSpeciesRightsState(ctx.state, factionId));
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, `${law.name} set to ${option.name}.`);
  const changed: ServerUpdateField[] = ["governments", "species", "planetStates", "factionEconomies", "fleets", "technologies"];
  if (rightsChanged) changed.push("visibility");
  broadcastUpdates(changed);
}

function handleSetSpeciesRights(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  speciesId: string,
  rightsInput: Partial<SpeciesRights>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const species = ctx.state.species.find((candidate) => candidate.id === speciesId);
  if (!species) return reject(socket, "Species not found.");
  if (!getEmpireSpeciesIds(ctx.state, factionId).includes(species.id)) {
    return reject(socket, "That species does not live in your empire.");
  }

  let rightsState = ctx.state.speciesRights.find((candidate) => candidate.factionId === factionId);
  if (!rightsState) {
    rightsState = createDefaultSpeciesRightsState(factionId, ctx.state.species.map((entry) => entry.id));
    ctx.state.speciesRights.push(rightsState);
  }
  const current = getSpeciesRightsForFaction(ctx.state, factionId, species.id);
  const requested = normalizeSpeciesRights({ ...current, ...rightsInput });
  const normalized = normalizeSpeciesRightsForLaws(requested, getSpeciesLawSelections(ctx.state, factionId));
  if (JSON.stringify(current) === JSON.stringify(normalized)) {
    return accept(socket, `${species.name} rights already match current law.`);
  }
  rightsState.rightsBySpeciesId = {
    ...rightsState.rightsBySpeciesId,
    [species.id]: normalized,
  };
  ctx.state.speciesRights = normalizeSpeciesRightsForFactions(ctx.state);
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, `${species.name} rights updated.`);
  broadcastUpdates(["species", "planetStates", "factionEconomies"]);
}

function validateLeaderCommand(socket: WebSocket, perspective: GalaxyPerspective, leaderId: string): {
  leader: LeaderState;
  factionId: number;
} | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }
  const leader = ctx.state.leaders.find((candidate) => candidate.id === leaderId);
  if (!leader || leader.factionId !== factionId || leader.status === "dead") {
    reject(socket, "Leader not found.");
    return null;
  }
  return { leader, factionId };
}

function validateLeaderAssignment(
  socket: WebSocket,
  factionId: number,
  leaderClass: LeaderClass,
  assignment: LeaderAssignment | null,
): boolean {
  if (!assignment) return true;
  if (assignment.kind === "government") {
    const position = getGovernmentPositionDefinition(assignment.targetId as GovernmentPositionId);
    if (!position) {
      reject(socket, "Government position not found.");
      return false;
    }
    if (position.requiredClass !== leaderClass) {
      reject(socket, `${formatLeaderClass(leaderClass)} cannot take that government position.`);
      return false;
    }
    return true;
  }
  if (assignment.kind !== "planet" && assignment.kind !== "fleet") {
    reject(socket, "Leader assignment target is invalid.");
    return false;
  }
  if (getLeaderAssignmentClass(assignment.kind) !== leaderClass) {
    reject(socket, `${formatLeaderClass(leaderClass)} cannot take that assignment.`);
    return false;
  }
  if (assignment.kind === "planet") {
    const planetState = ctx.state.planetStates.find((candidate) => candidate.id === assignment.targetId);
    if (!planetState || !planetState.isHabited) {
      reject(socket, "Planet not found.");
      return false;
    }
    if (planetState.ownerId !== factionId) {
      reject(socket, "You do not own that planet.");
      return false;
    }
    return true;
  }
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === assignment.targetId);
  if (!fleet) {
    reject(socket, "Fleet not found.");
    return false;
  }
  if (fleet.ownerId !== factionId) {
    reject(socket, "You do not own that fleet.");
    return false;
  }
  return true;
}

function commitLeaderChange(changed: ServerUpdateField[]): void {
  ctx.hasDirtyState = true;
  broadcastUpdates(Array.from(new Set(["leaders", ...changed])));
}

function handleRecruitLeader(socket: WebSocket, perspective: GalaxyPerspective, leaderId: string): void {
  const validated = validateLeaderCommand(socket, perspective, leaderId);
  if (!validated) return;
  const { leader } = validated;
  if (leader.status === "recruited") {
    accept(socket, `${leader.name} is already recruited.`);
    return;
  }
  leader.status = "recruited";
  leader.recruitedAtYear = ctx.state.clock.year;
  leader.assignment = null;
  leader.createdAtYear = Math.min(leader.createdAtYear, ctx.state.clock.year);
  accept(socket, `${leader.name} recruited.`);
  commitLeaderChange([]);
}

function handleAssignLeader(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  leaderId: string,
  assignment: LeaderAssignment | null,
): void {
  const validated = validateLeaderCommand(socket, perspective, leaderId);
  if (!validated) return;
  const { leader, factionId } = validated;
  if (!validateLeaderAssignment(socket, factionId, leader.class, assignment)) return;
  const previousAssignment = leader.assignment;
  if (assignment) {
    for (const candidate of ctx.state.leaders) {
      if (
        candidate.id !== leader.id
        && candidate.factionId === factionId
        && candidate.assignment?.kind === assignment.kind
        && candidate.assignment.targetId === assignment.targetId
      ) {
        candidate.assignment = null;
      }
    }
  }
  if (leader.status === "pool") {
    leader.status = "recruited";
    leader.recruitedAtYear = ctx.state.clock.year;
  }
  leader.assignment = assignment;
  const changed: ServerUpdateField[] = [];
  if (previousAssignment?.kind === "planet" || assignment?.kind === "planet") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("planetStates", "factionEconomies");
  }
  if (previousAssignment?.kind === "fleet" || assignment?.kind === "fleet") {
    refreshFactionEconomyDeltas();
    changed.push("fleets", "factionEconomies");
  }
  if (previousAssignment?.kind === "government" || assignment?.kind === "government") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("governments", "planetStates", "factionEconomies", "fleets", "technologies");
  }
  accept(socket, assignment ? `${leader.name} assigned.` : `${leader.name} unassigned.`);
  commitLeaderChange(changed);
}

function handleDismissLeader(socket: WebSocket, perspective: GalaxyPerspective, leaderId: string): void {
  const validated = validateLeaderCommand(socket, perspective, leaderId);
  if (!validated) return;
  const { leader } = validated;
  if (leader.status !== "recruited") {
    reject(socket, "Only recruited leaders can be dismissed.");
    return;
  }
  const oldAssignment = leader.assignment;
  leader.status = "dead";
  leader.assignment = null;
  leader.diedAtYear = ctx.state.clock.year;
  const changed: ServerUpdateField[] = [];
  if (oldAssignment?.kind === "planet") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("planetStates", "factionEconomies");
  }
  if (oldAssignment?.kind === "fleet") {
    refreshFactionEconomyDeltas();
    changed.push("fleets", "factionEconomies");
  }
  if (oldAssignment?.kind === "government") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("governments", "planetStates", "factionEconomies", "fleets", "technologies");
  }
  accept(socket, `${leader.name} dismissed.`);
  commitLeaderChange(changed);
}


function handleCommand(session: ClientSession, command: ClientCommand): void {
  if (command.type === "join") {
    if (!session.sentInitialSnapshot) {
      sendEvent(session.socket, createSnapshot(ctx, session.perspective));
      session.sentInitialSnapshot = true;
    }
    return;
  }
  if (command.type === "adminCommand") {
    void handleAdminCommand(session, command);
    return;
  }
  if (command.type === "setActiveTechnology") {
    handleSetActiveTechnology(session.socket, session.perspective, command.techId);
    return;
  }
  if (command.type === "setGovernmentLaw") {
    handleSetGovernmentLaw(session.socket, session.perspective, command.lawId, command.optionId);
    return;
  }
  if (command.type === "resolveEvent") {
    handleResolveEvent(session.socket, session.perspective, command.eventId, command.choiceId);
    return;
  }
  if (command.type === "setSpeciesRights") {
    handleSetSpeciesRights(session.socket, session.perspective, command.speciesId, command.rights);
    return;
  }
  if (command.type === "recruitLeader") {
    handleRecruitLeader(session.socket, session.perspective, command.leaderId);
    return;
  }
  if (command.type === "assignLeader") {
    handleAssignLeader(session.socket, session.perspective, command.leaderId, command.assignment);
    return;
  }
  if (command.type === "dismissLeader") {
    handleDismissLeader(session.socket, session.perspective, command.leaderId);
    return;
  }
  if (command.type === "marketTrade") {
    handleMarketTrade(session.socket, session.perspective, command.resourceId, command.tradeType, command.amount);
    return;
  }
  if (command.type === "addMarketAutoTrade") {
    handleAddMarketAutoTrade(session.socket, session.perspective, command.resourceId, command.tradeType, command.amountPerHour);
    return;
  }
  if (command.type === "removeMarketAutoTrade") {
    handleRemoveMarketAutoTrade(session.socket, session.perspective, command.orderId);
    return;
  }
  if (command.type === "sendDiplomacyMessage") {
    handleSendDiplomacyMessage(ctx, session.socket, session.perspective, command.targetFactionId, command.body);
    return;
  }
  if (command.type === "setBorderPolicy") {
    handleSetBorderPolicy(ctx, session.socket, session.perspective, command.targetFactionId, command.policy);
    return;
  }
  if (command.type === "declareWar") {
    handleDeclareWar(ctx, session.socket, session.perspective, command.targetFactionId);
    return;
  }
  if (command.type === "proposeTreaty") {
    handleProposeTreaty(ctx, 
      session.socket,
      session.perspective,
      command.targetFactionId,
      command.articleIds,
      command.durationYears,
      command.replacesTreatyId,
    );
    return;
  }
  if (command.type === "respondDiplomacyProposal") {
    handleRespondDiplomacyProposal(ctx, session.socket, session.perspective, command.proposalId, command.response);
    return;
  }
  if (command.type === "cancelTreaty") {
    handleCancelTreaty(ctx, session.socket, session.perspective, command.treatyId);
    return;
  }
  if (command.type === "cancelDiplomacyProposal") {
    handleCancelDiplomacyProposal(ctx, session.socket, session.perspective, command.proposalId);
    return;
  }
  if (command.type === "proposePeace") {
    handleProposePeace(ctx, session.socket, session.perspective, command.targetFactionId, command.terms);
    return;
  }
  if (command.type === "moveShip" || command.type === "moveFleet") {
    handleMove(
      session.socket,
      session.perspective,
      command.fleetId,
      command.shipId,
      command.targetStarId,
      command.targetSystemPosition,
      command.orbitTarget,
    );
    return;
  }
  if (command.type === "buildStarbase") {
    handleBuild(session.socket, session.perspective, command.fleetId, command.shipId, command.targetStarId);
    return;
  }
  if (command.type === "orbitPlanet") {
    handleOrbitPlanet(session.socket, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "colonizePlanet") {
    handleColonizePlanet(session.socket, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "mergeFleets") {
    handleMergeFleets(session.socket, session.perspective, command.targetFleetId, command.sourceFleetIds);
    return;
  }
  if (command.type === "stopFleet") {
    handleStopFleet(session.socket, session.perspective, command.fleetId);
    return;
  }
  if (command.type === "setFleetDarkMatterBoost") {
    handleSetFleetDarkMatterBoost(session, command.fleetId, command.enabled);
    return;
  }
  if (command.type === "buildDistrict") {
    handleBuildDistrict(session.socket, session.perspective, command.planetId, command.districtKind);
    return;
  }
  if (command.type === "buildPlanetBuilding") {
    handleBuildPlanetBuilding(
      session.socket,
      session.perspective,
      command.planetId,
      command.area,
      command.slotIndex,
      command.buildingKind,
      command.subDistrictIndex,
    );
    return;
  }
  if (command.type === "upgradePlanetBuilding") {
    handleUpgradePlanetBuilding(
      session.socket,
      session.perspective,
      command.planetId,
      command.area,
      command.slotIndex,
      command.subDistrictIndex,
    );
    return;
  }
  if (command.type === "downgradePlanetBuilding") {
    handleDowngradePlanetBuilding(
      session.socket,
      session.perspective,
      command.planetId,
      command.area,
      command.slotIndex,
      command.subDistrictIndex,
    );
    return;
  }
  if (command.type === "setPlanetBuildingEnabled") {
    handleSetPlanetBuildingEnabled(
      session.socket,
      session.perspective,
      command.planetId,
      command.area,
      command.slotIndex,
      command.enabled,
      command.subDistrictIndex,
    );
    return;
  }
  if (command.type === "cancelPlanetConstruction") {
    handleCancelPlanetConstruction(session.socket, session.perspective, command.planetId, command.queueItemId);
    return;
  }
  if (command.type === "skipPlanetConstruction") {
    handleSkipPlanetConstruction(session, command.planetId, command.queueItemId);
    return;
  }
  if (command.type === "upgradeStarbase") {
    handleUpgradeStarbase(session.socket, session.perspective, command.starbaseId);
    return;
  }
  if (command.type === "buildStarbaseBuilding") {
    handleBuildStarbaseBuilding(
      session.socket,
      session.perspective,
      command.starbaseId,
      command.slotIndex,
      command.buildingKind,
    );
    return;
  }
  if (command.type === "buildStarbaseShip") {
    handleBuildStarbaseShip(session.socket, session.perspective, command.starbaseId, command.shipKind, command.designId);
    return;
  }
  if (command.type === "upgradeShip") {
    handleUpgradeShip(session.socket, session.perspective, command);
    return;
  }
  if (command.type === "saveShipDesign") {
    handleSaveShipDesign(session.socket, session.perspective, command);
    return;
  }
  if (command.type === "decommissionShipDesign") {
    handleDecommissionShipDesign(session.socket, session.perspective, command.designId);
    return;
  }
  if (command.type === "setUrbanSubDistrict") {
    handleSetUrbanSubDistrict(
      session.socket,
      session.perspective,
      command.planetId,
      command.subDistrictIndex,
      command.subDistrictKind,
    );
    return;
  }
  if (command.type === "requestDetails") {
    handleRequestDetails(session.socket, session.perspective, command.scope, command.id, command.knownRevision);
    return;
  }
  if (command.type === "subscribeDetails") {
    handleSubscribeDetails(session, command.scope, command.id, command.knownRevision);
    return;
  }
  if (command.type === "unsubscribeDetails") {
    handleUnsubscribeDetails(session, command.scope, command.id);
    return;
  }
  if (command.type === "retreatFleet") {
    handleRetreatFleet(session.socket, session.perspective, command.fleetId);
    return;
  }
  if (command.type === "retreatFleetTo") {
    handleRetreatFleetTo(
      session.socket,
      session.perspective,
      command.fleetId,
      command.targetStarId,
      command.targetSystemPosition,
    );
    return;
  }
  if (command.type === "emergencyRetreatFleetTo") {
    handleEmergencyRetreatFleetTo(session.socket, session.perspective, command.fleetId, command.targetStarId);
    return;
  }
  if (command.type === "attackTarget") {
    handleAttackTarget(session.socket, session.perspective, command.fleetId, command.targetId, command.targetKind);
    return;
  }
  if (command.type === "attackSystem") {
    handleAttackSystem(session.socket, session.perspective, command.fleetId, command.targetStarId);
    return;
  }
  if (command.type === "setFleetCombatSettings") {
    handleSetFleetCombatSettings(session.socket, session.perspective, command.fleetId, command.combatSettings, command.combatStance);
    return;
  }
  if (command.type === "issueFleetTacticalOrder") {
    handleIssueFleetTacticalOrder(session.socket, session.perspective, command);
    return;
  }
  if (command.type === "repairFleet") {
    handleRepairFleet(session.socket, session.perspective, command);
    return;
  }
  if (command.type === "setSpeedMultiplier") {
    const multiplier = Math.max(0, Number(command.multiplier) || 0);
    ctx.state.clock.tickSpeedSeconds = DEFAULT_TICK_SPEED_SECONDS;
    ctx.state.clock.tickSizeDays = Math.max(0.000001, multiplier / 24);
    ctx.state.clock.paused = multiplier <= 0;
    syncClockSpeedFields();
    ctx.state.clock.syncedAtMs = Date.now();
    ctx.hasDirtyState = true;
    accept(session.socket, `Speed set to ${ctx.state.clock.speedMultiplier}x.`);
    broadcastUpdates(["clock"]);
  }
}

function touchMembershipNames(): void {
  let changed = false;
  let speciesChanged = false;
  for (const membership of authStore.listGameMemberships(ctx.game.id)) {
    const faction = ctx.state.factions.find((candidate) => candidate.id === membership.factionId);
    if (!faction) continue;
    const expectedSpeciesId = getFactionFoundingSpeciesId(faction.id);
    if (faction.foundingSpeciesId !== expectedSpeciesId) {
      faction.foundingSpeciesId = expectedSpeciesId;
      changed = true;
    }
    if (faction.name !== membership.countryName) {
      faction.name = membership.countryName;
      changed = true;
    }
    const currentFlag = JSON.stringify(faction.flagDesign ?? null);
    const nextFlag = JSON.stringify(membership.flagDesign ?? null);
    if (currentFlag !== nextFlag) {
      faction.flagDesign = membership.flagDesign;
      changed = true;
    }
    if (membership.speciesSetup) {
      const nextSpecies = createSpeciesFromSetup(faction.id, membership.speciesSetup);
      const index = ctx.state.species.findIndex((species) => species.id === nextSpecies.id);
      const current = index >= 0 ? ctx.state.species[index] : null;
      if (JSON.stringify(current) !== JSON.stringify(nextSpecies)) {
        if (index >= 0) {
          ctx.state.species[index] = nextSpecies;
        } else {
          ctx.state.species.push(nextSpecies);
        }
        speciesChanged = true;
        changed = true;
      }
    }
  }
  if (!changed) return;
  const speciesPopulationChanged = assignFoundingSpeciesToOwnedPops(ctx.state);
  if (speciesChanged || speciesPopulationChanged) {
    ctx.state.speciesRights = normalizeSpeciesRightsForFactions(ctx.state);
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
  }
  ctx.hasDirtyState = true;
  broadcastUpdates(speciesChanged || speciesPopulationChanged ? ["visibility", "species", "planetStates", "factionEconomies"] : ["visibility"]);
}

await acquireOwnership(ctx);
ctx.state = await loadState(ctx);
touchMembershipNames();
advanceState(Date.now());
await saveState(ctx);

function attachClient(socket: WebSocket, account: AuthAccount, perspective: GalaxyPerspective): void {
  const session: ClientSession = {
    socket,
    account,
    perspective,
    detailSubscriptions: new Map(),
    sentInitialSnapshot: false,
  };
  ctx.clients.add(session);
  touchMembershipNames();
  try {
    authStore.recordGameEnter(account, ctx.game.id);
  } catch (error) {
    console.error(`[GameServer] Failed to record ctx.game enter for ${ctx.game.id}`, error);
  }
  sendEvent(socket, { type: "serverInfo", message: `Connected to StellarFronts ctx.game ${ctx.game.name}.` });
  sendEvent(socket, {
    type: "accountResources",
    darkMatter: authStore.getPlayerDarkMatter(account.id),
  });
  // Runtime creation can outlive the client's first WebSocket message.
  sendEvent(socket, createSnapshot(ctx, perspective));
  session.sentInitialSnapshot = true;

  socket.on("message", (data) => {
    try {
      const command = JSON.parse(String(data)) as ClientCommand;
      handleCommand(session, command);
      flushPlanetDetailRefreshes();
    } catch (error) {
      reject(socket, error instanceof Error ? error.message : "Invalid command.");
    }
  });

  socket.on("close", () => {
    ctx.clients.delete(session);
  });
}

function tick(now: number): void {
  const changed = advanceState(now);
  broadcastUpdates(Array.from(changed));
  flushPlanetDetailRefreshes();
  if (ctx.hasDirtyState && now - ctx.lastSaveAt >= SAVE_INTERVAL_MS) {
    void saveState(ctx).catch((error) => console.error(`[GameServer] Failed to save ctx.state for ${ctx.game.id}`, error));
  }
}

function getStats(): DevGameRuntimeRow {
  const activeAccounts = Array.from(new Set(
    Array.from(ctx.clients).map((client) => client.account.username),
  )).sort((a, b) => a.localeCompare(b));
  return {
    id: ctx.game.id,
    name: ctx.game.name,
    seed: ctx.game.seed,
    countryCapacity: ctx.game.countryCapacity,
    controlledCountries: authStore.listGameMemberships(ctx.game.id).length,
    createdAt: ctx.game.createdAt,
    online: true,
    activeConnections: ctx.clients.size,
    activeAccounts,
    gameYear: ctx.state.clock.year,
    paused: ctx.state.clock.paused,
    speedMultiplier: ctx.state.clock.speedMultiplier,
    starCount: ctx.state.stars.length,
    factionCount: ctx.state.factions.length,
    fleetCount: ctx.state.fleets.length,
    shipCount: ctx.state.ships.length,
    starbaseCount: ctx.state.starbases.length,
    habitedPlanetCount: ctx.state.planetStates.filter((planetState) => planetState.isHabited).length,
    lastHeartbeatAt: Date.now(),
  };
}

async function dispose(message = "Game runtime stopped.", deleteState = false): Promise<void> {
  for (const client of ctx.clients) {
    sendEvent(client.socket, { type: "serverInfo", message });
    client.socket.close(1001, message);
  }
  ctx.clients.clear();
  if (deleteState) {
    await rm(getGameStateDirectory(ctx.game.id), { recursive: true, force: true });
    return;
  }
  await saveState(ctx);
  await releaseOwnership(ctx);
}

return {
  game: ctx.game,
  attachClient,
  touchMembershipNames,
  tick,
  save: () => saveState(ctx),
  dispose,
  getStats,
};
}

await initServer(createGameRuntime);
