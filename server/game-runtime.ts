import { random, nextRuntimeId, createDeterministicState } from "./game/determinism";
import { accept, reject, ADAPTER_COMMANDS } from "./game/actions";
import type { GameAction, GameActor, ActionSession, CommandReply } from "./game/actions";
import type { CommandOutcome, MutationEffects } from "./game/mutation-coordinator";
import { rm } from "node:fs/promises";
import { WebSocket } from "ws";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../src/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../src/data/Factions";
import { applyPlanetStatesToStars, createPlanetStateFromConfig } from "../src/data/StarMap";
import type { PlanetConfig, StarData } from "../src/data/StarMap";
import { getSystemStarbaseOrbitPosition } from "../src/data/SystemCoordinates";
import { addResourceCounts, BUILDING_DEFINITIONS, BUILDING_KINDS, completePlanetConstructionQueueItem, countPlanetShipyards, createBuildingConstructionQueueItem, createBuildingUpgradeConstructionQueueItem, createDefenseBuildingConstructionQueueItem, createDistrictConstructionQueueItem, createEmptyResourceCounts, createFeatureRemovalConstructionQueueItem, createPlanetBuildingState, filterInvalidQueuedBuildingsForSubDistrictChange, getBuildingUpgradeTargetLevel, getPlanetBuildingKind, getPlanetBuildingLevel, getPlanetDefensePlatformCapacity, getQueuedDistrictCount, getUnlockedPlanetDefenseSlots, getUnlockedPlanetShipyardSlots, hasQueuedBuildingTarget, hasQueuedDefenseBuildingTarget, hasQueuedFeatureRemoval, isBuildingCompatible, isPlanetBuildingEnabled, meetsCapitalUpgradePopulation, getCapitalUpgradePopulationThreshold, JOB_FILL_ORDER, PLANET_DEFENSE_BUILDING_DEFINITIONS, PLANET_DEFENSE_BUILDING_KINDS, PLANET_FEATURE_DEFINITIONS, recalculatePlanetStateEconomy, RESOURCE_KINDS, URBAN_SUB_DISTRICT_KINDS } from "../src/data/Economy";
import { isMarketResourceKind } from "../src/data/Market";
import { countStarbaseShipyards, createStarbaseBuildingQueueItem, createStarbaseShipQueueItem, createStarbaseUpgradeQueueItem, getStarbaseShipConstructionCostMultiplier, hasQueuedStarbaseBuildingTarget, isStarbaseBuildingKind, isStarbaseShipKind, OUTPOST_CONSTRUCTION_COST, STARBASE_LEVEL_DEFINITIONS } from "../src/data/Starbase";
import { ARMY_TOTAL_CREW_DEMAND, ARMY_TRANSPORT_BUILD_DAYS, ARMY_TYPE_DEFINITIONS, MOBILE_ARMY_TYPE_IDS, isArmyTypeId } from "../src/data/Armies";
import { getNebulaGatedBuildingKinds, nebulaEnablesBuildingAtStar } from "../src/data/Nebula";
import type {
  StarbaseBuildingKind,
  StarbaseLevel,
  StarbaseShipKind,
  StarbaseShipQueueItem,
  WeaponMountDefinition,
} from "../src/data/Starbase";
import { calculateShipDesignStats, getShipDesignLayout, isKnownShipKind, normalizeShipDesign, SHIP_HULL_DEFINITIONS } from "../src/data/ShipDesigns";
import { scaleResourceCounts } from "./game/pure-helpers";
import type { ShipDesign } from "../src/data/ShipDesigns";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  JobKind,
  PlanetState,
  PlanetBuildingSlot,
  PlanetModifier,
  PlanetFeatureKind,
  PlanetEconomySpeciesContext,
  PlanetDefenseBuildingKind,
  PlanetDefenseSection,
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
import { GAME_DAYS_PER_YEAR, GAME_START_YEAR, REAL_MS_PER_GAME_HOUR, elapsedHoursToGameYear, gameYearToHourIndex, gameYearToMonthIndex, gameYearToWeekIndex } from "../src/game/GameTime";
import { DARK_MATTER_FLEET_COST_PER_MOVING_DAY, DARK_MATTER_FLEET_SPEED_MULTIPLIER, getConstructionDarkMatterCost, getFleetDarkMatterBillingPlan } from "../src/game/DarkMatter";
import { gameHourToRealMinute } from "../src/game/ResourceRate";
import { getFirstRequiredTechName, getMissingPrerequisites, getRequiredTechIdsForBuilding, getRequiredTechIdsForBuildingLevel, getRequiredTechIdsForPlanetDefenseBuilding, getRequiredTechIdsForPlanetDefenseBuildingLevel, getRequiredTechIdsForPlanetFeatureRemoval, getRequiredTechIdsForStarbaseBuilding, isTechnologyAvailable, isTechnologyCompleted, isUnlockedByAnyRequiredTech, TechId, TECHNOLOGY_BY_ID } from "../src/data/Technology";
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
import type { GameRuntimeAuthPort, StoredGame } from "./auth-store";
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
import { calculateFactionResourceFlow, calculateTradeQuote, refreshFactionEconomyDeltas as applyFactionEconomyDeltas, recalculatePlanetEconomies as applyRecalculatePlanetEconomies, getMarketPlayerStats, recordMarketTransaction, recordMarketTradeVolume } from "./game/economy-market";
import { refreshDiscovery as applyRefreshDiscovery } from "./game/visibility";
import { getKnownStarIds } from "./game/intelligence";
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
  processPlanetShipQueues,
  processStarbaseShipQueues,
} from "./game/economy-tick";
import { normalizeResourceCounts, normalizeStarbase, syncFleetMembership, syncSystemOwnershipFromStarbases, fleetHasConstructionShip, getFleetColonizationShip, syncShipsForDesign, normalizeSpeciesRightsForFactions, assignFoundingSpeciesToOwnedPops, getFactionFoundingSpeciesId } from "./game/state-normalization";
import { decodeClientCommand } from "./game/client-command-codec";
import { createAiObservation } from "./game/ai-observation";
import { CARETAKER_AFK_MS, createCaretakerEpisode, decideCaretaker } from "./game/caretaker";
import {
  applyMutationEffects,
} from "./game/mutation-coordinator";
import { executeAdminCommand } from "./game/admin-commands";
import { createInitialState, loadState } from "./game/state-bootstrap";
import {
  reject as rejectSocket,
  sendEvent,
} from "./game/socket-io";
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
  processPopulationPeriods,
} from "./game/population";
import { processLeaderDays } from "./game/leader-lifecycle";
import { isShipDesignUnlockedForFaction, getShipDesignMissingTechnologyName } from "./game/research";
import { getFactionPlanetColonizationEligibility } from "./game/colonization";
import { phaseDurationDays, hyperlaneTravelDays, createStarbaseOrbitTarget, clearFleetOrbit, prepareFleetForReplacementOrder, applyFleetOrbitTarget, findRoute, startMoveOrder, startAttackSystemOrder, startBuildOrder, startOrbitOrder, startColonizationOrder, startMergeSourceOrder, isMergeSourceEligible, advanceFleet, processMissingInActionFleets, isHostileOwner, resolveFleetRetreatDestination, startFleetRetreat, retreatFleetByDoctrine, processContinuousFleetCombat, clearFleetMovementNow, rescaleFleetMovementPlan } from "./game/fleet-combat";
import { runSimulationPipeline } from "./game/simulation-pipeline";
import { PASSIVE_AFK_MS, createPassiveEpisode, decidePassive, recordPassiveAcceptance } from "./game/passive";
import { beginPlanetInvasion, embarkPlanetArmies, getArmyRecruitmentCap, isArmyFleet, processArmyAndCrewReplenishment, processGroundBattles, reinforceOwnedPlanet, requestGroundWithdrawal } from "./game/ground-combat";

export interface GameCore {
  context: RuntimeContext;
  runtime: GameRuntime;
  createAiActor: (factionId: number, controllerId?: string) => GameActor;
  createHumanActor: (accountId: number, factionId: number) => GameActor;
  createObserverActor: () => GameActor;
  executeGameCommand: (actor: GameActor, action: unknown) => CommandOutcome;
  processCaretakers: () => Array<{ factionId: number; action: GameAction; outcome: CommandOutcome }>;
  processAiControllers: () => Array<{ factionId: number; mode: "caretaker" | "passive"; action: GameAction; outcome: CommandOutcome }>;
  recordPlayerActivity: (accountId: number, factionId: number) => boolean;
}
export function createGameCore(
  game: StoredGame,
  authStore: GameRuntimeAuthPort,
  options: { now?: () => number; realNow?: () => number; simulationSeed?: number; initialState?: GameState; initialWorld?: { starCount: number; factionCount: number }; deferInitialState?: boolean; enablePassiveAi?: boolean } = {},
): GameCore {
let commandEffects: MutationEffects | null = null;
let accountNotifications: Map<number, number> | null = null;
const issuedActors = new WeakSet<object>();
const ctx: RuntimeContext = {
  game,
  statePath: getGameStatePath(game.id),
  state: options.initialState ?? { determinism: createDeterministicState(options.simulationSeed) } as GameState,
  clients: new Set<ClientSession>(),
  pendingPlanetDetailRefreshes: new Set<string>(),
  hasDirtyState: false,
  lastSaveAt: 0,
  saveInFlight: null,
  saveQueued: false,
  ownershipToken: null,
  runtimeIdCounter: 0,
  eventInstanceSeq: 0,
  services: {
    authStore,
    now: options.now ?? (() => Date.now()),
    realNow: options.realNow ?? (() => Date.now()),
    simulationSeed: options.simulationSeed,
    initialWorld: options.initialWorld,
  },
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
  return nextRuntimeId(ctx, prefix, parts);
}

function recalculatePlanetEconomies(nextState = ctx.state): void {
  if (commandEffects && nextState === ctx.state) { commandEffects.recalculatePlanets = true; return; }
  applyRecalculatePlanetEconomies(nextState);
}

function refreshFactionEconomyDeltas(nextState = ctx.state): void {
  if (commandEffects && nextState === ctx.state) { commandEffects.refreshFactionEconomy = true; return; }
  applyFactionEconomyDeltas(nextState);
}

function requireUnlocked(reply: CommandReply, factionId: number, requiredTechIds: TechId[]): boolean {
  if (requiredTechIds.length === 0) return true;
  const techState = getFactionTechnology(ctx.state, factionId);
  if (isUnlockedByAnyRequiredTech(techState, requiredTechIds)) return true;
  reject(reply, `Requires ${getFirstRequiredTechName(requiredTechIds)}.`);
  return false;
}

function queuePlanetDetailRefresh(planetId: string): void {
  if (commandEffects) { (commandEffects.planetDetailIds ??= []).push(planetId); return; }
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
  if (commandEffects && nextState === ctx.state) { commandEffects.refreshDiscovery = true; return; }
  applyRefreshDiscovery(nextState);
}

function broadcastSnapshots(): void {
  for (const client of ctx.clients) {
    sendEvent(client.socket, createSnapshot(ctx, client.perspective));
  }
}

function broadcastUpdates(changed: ServerUpdateField[]): void {
  if (commandEffects) { (commandEffects.changed ??= []).push(...changed); return; }
  const deduped = Array.from(new Set(changed));
  if (deduped.length === 0) return;
  for (const client of ctx.clients) {
    sendEvent(client.socket, createUpdate(ctx, client.perspective, deduped));
  }
  broadcastSubscribedDetails();
}

function broadcastAccountDarkMatter(accountId: number, darkMatter: number): void {
  if (accountNotifications) { accountNotifications.set(accountId, darkMatter); return; }
  for (const client of ctx.clients) {
    if (client.account.id === accountId) {
      sendEvent(client.socket, { type: "accountResources", darkMatter });
    }
  }
}







function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

function canFleetAcceptReplacementOrder(fleet: GameFleet): boolean {
  return !fleet.stationaryStarbaseId
    && fleet.phase !== "missingInAction"
    && fleet.combatStatus !== "destroyed"
    && fleet.shipIds.length > 0;
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
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string | undefined,
  shipId: string | undefined,
  targetStarId: number,
  targetSystemPosition?: ReturnType<typeof systemCenterPosition>,
  orbitTarget?: FleetOrbitTarget | null,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, shipId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(reply, "Fleet cannot accept orders right now.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startMoveOrder(ctx, fleet, targetStarId, targetSystemPosition, orbitTarget);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(reply, "Move order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(reply, error instanceof Error ? error.message : "Move order rejected.");
  }
}

function handleBuild(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string | undefined, shipId: string | undefined, targetStarId: number): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, shipId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(reply, "Fleet cannot accept orders right now.");
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) return reject(reply, "Invalid target system.");
  if (!fleetHasConstructionShip(ctx, fleet)) return reject(reply, "Requires a construction ship.");
  if (ctx.state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(reply, "System already has a starbase.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    if (!spendResources(reply, factionId, OUTPOST_CONSTRUCTION_COST)) return;
    startBuildOrder(ctx, fleet, targetStarId);
    fleet.pendingStarbaseBuildCost = { ...OUTPOST_CONSTRUCTION_COST };
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(reply, "Build order accepted.");
    broadcastUpdates(["clock", "fleets", "factionEconomies", "visibility"]);
  } catch (error) {
    refundResources(factionId, OUTPOST_CONSTRUCTION_COST);
    fleet.pendingStarbaseBuildCost = null;
    reject(reply, error instanceof Error ? error.message : "Build order rejected.");
  }
}

function handleOrbitPlanet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, undefined);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(reply, "Fleet cannot accept orders right now.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startOrbitOrder(ctx, fleet, planetId);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(reply, "Orbit order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(reply, error instanceof Error ? error.message : "Orbit order rejected.");
  }
}

function handleColonizePlanet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = resolveFleetForCommand(fleetId, undefined);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(reply, "Fleet cannot accept orders right now.");
  const eligibility = getFactionPlanetColonizationEligibility(ctx, factionId, planetId, fleet);
  if (!eligibility) return reject(reply, "Planet not found.");
  if (!eligibility.eligible) {
    const messages = {
      alreadyHabited: "Planet is already colonized.",
      systemNotOwned: "Planet must be in an owned system.",
      restrictedPlanetType: "This planet type cannot currently be colonized.",
      zeroHabitability: "Founding species habitability is too low to colonize.",
      noColonizationShip: "Requires a colonization ship.",
      fleetUnavailable: "Fleet cannot colonize in its current state.",
      colonizable: "Planet cannot be colonized.",
    } as const;
    return reject(reply, messages[eligibility.reason]);
  }
  const targetState = getPlanetState(ctx, planetId);
  if (!targetState) return reject(reply, "Planet not found.");
  if (targetState.starId !== fleet.currentStarId && !findRoute(ctx, fleet, targetState.starId)) {
    return reject(reply, "No discovered safe route to planet.");
  }
  if (
    targetState.starId !== fleet.currentStarId
    && fleet.shipIds.some((shipId) => {
      const ship = ctx.state.ships.find((candidate) => candidate.id === shipId);
      return ship?.subsystemState?.engineDisabled && !ship.subsystemState.emergencyMobility;
    })
  ) {
    return reject(reply, "Fleet contains an engine-crippled ship that requires construction assistance.");
  }
  const inhabitedBefore = ctx.state.planetStates.filter((planet) => planet.isHabited).length;
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startColonizationOrder(ctx, fleet, planetId);
    const foundedImmediately = ctx.state.planetStates.filter((planet) => planet.isHabited).length > inhabitedBefore;
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(reply, foundedImmediately ? "Colony founded." : "Colonization order accepted.");
    broadcastUpdates(foundedImmediately
      ? ["clock", "fleets", "ships", "planetStates", "habitedPlanetSystems", "factionEconomies", "visibility"]
      : ["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(reply, error instanceof Error ? error.message : "Colonization order rejected.");
  }
}

function handleMergeFleets(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  targetFleetId: string,
  sourceFleetIds: string[],
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === targetFleetId);
  if (!targetFleet) return reject(reply, "Target fleet not found.");
  if (targetFleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  const targetIsArmy = isArmyFleet(ctx.state, targetFleet);

  const uniqueSourceIds = Array.from(new Set(sourceFleetIds)).filter((id) => id !== targetFleetId);
  if (uniqueSourceIds.length === 0) return reject(reply, "No fleets selected to merge.");

  const sourceFleets = uniqueSourceIds
    .map((id) => ctx.state.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is GameFleet => !!fleet);

  if (sourceFleets.length !== uniqueSourceIds.length) return reject(reply, "A source fleet was not found.");
  for (const fleet of sourceFleets) {
    if (fleet.ownerId !== factionId) return reject(reply, "You do not own all selected fleets.");
    if (!isMergeSourceEligible(fleet)) return reject(reply, "A selected fleet cannot currently merge.");
    if (isArmyFleet(ctx.state, fleet) !== targetIsArmy) return reject(reply, "Naval and Army Fleets cannot merge.");
    if (fleet.currentStarId !== targetFleet.currentStarId && !findRoute(ctx, fleet, targetFleet.currentStarId)) {
      return reject(reply, "No discovered safe route to the target fleet.");
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
  accept(reply, movingCount > 0 ? `Merge rendezvous ordered for ${movingCount} fleet(s).` : `Merged ${mergedCount} fleet(s).`);
  broadcastUpdates(["clock", "ships", "fleets", "armies", "leaders", "visibility"]);
}

function handleStopFleet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (fleet.phase === "missingInAction") return reject(reply, "Fleet is missing in action.");

  clearFleetMovementNow(ctx, fleet);
  ctx.hasDirtyState = true;
  refreshDiscovery();
  accept(reply, "Fleet stopped.");
  broadcastUpdates(["clock", "fleets", "factionEconomies", "visibility"]);
}

function handleSetFleetDarkMatterBoost(
  session: ActionSession,
  fleetId: string,
  enabled: boolean,
): void {
  const factionId = validateCommandPerspective(session.perspective);
  if (factionId === null) return reject(session.reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(session.reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(session.reply, "You do not own that fleet.");
  if (typeof enabled !== "boolean") return reject(session.reply, "Invalid Dark Matter boost setting.");

  if (!enabled) {
    if (!fleet.darkMatterBoostActive) return reject(session.reply, "Dark Matter boost is not active.");
    rescaleFleetMovementPlan(ctx, fleet, DARK_MATTER_FLEET_SPEED_MULTIPLIER);
    fleet.darkMatterBoostActive = false;
    fleet.darkMatterBoostPaidUntilYear = null;
    ctx.hasDirtyState = true;
    accept(session.reply, "Dark Matter fleet boost disabled.");
    broadcastUpdates(["clock", "fleets"]);
    return;
  }

  if (fleet.darkMatterBoostActive) return reject(session.reply, "Dark Matter boost is already active.");
  if (!fleet.movementPlan || ctx.state.clock.year >= fleet.movementPlan.endsAtYear) {
    return reject(session.reply, "The fleet must be moving to activate a Dark Matter boost.");
  }

  const balance = authStore.spendPlayerDarkMatter(
    (session.actor as Extract<GameActor, { kind: "human" }>).accountId,
    DARK_MATTER_FLEET_COST_PER_MOVING_DAY,
  );
  if (balance === null) return reject(session.reply, "Not enough Dark Matter.");

  fleet.darkMatterBoostActive = true;
  fleet.darkMatterBoostPaidUntilYear = ctx.state.clock.year + gameDaysToYears(1);
  rescaleFleetMovementPlan(ctx, fleet, 1 / DARK_MATTER_FLEET_SPEED_MULTIPLIER);
  ctx.hasDirtyState = true;
  broadcastAccountDarkMatter((session.actor as Extract<GameActor, { kind: "human" }>).accountId, balance);
  accept(session.reply, "Dark Matter boost active: fleet movement is 10x faster.");
  broadcastUpdates(["clock", "fleets"]);
}

function handleRetreatFleet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string): void {
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  const destination = fleet ? resolveFleetRetreatDestination(ctx, fleet) : null;
  handleRetreatFleetTo(reply, perspective, fleetId, destination?.targetStarId ?? -1, destination?.targetSystemPosition ?? undefined);
}

function validateRetreatTarget(reply: CommandReply, perspective: GalaxyPerspective, fleet: GameFleet, targetStarId: number, requireRoute: boolean): boolean {
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) {
    reject(reply, "Invalid retreat target.");
    return false;
  }
  if (perspective.mode !== "observer") {
    const known = getKnownStarIds(ctx.state, perspective.factionId);
    if (!known.has(targetStarId)) {
      reject(reply, "Retreat target is not known.");
      return false;
    }
  }
  if (requireRoute && targetStarId !== fleet.currentStarId && !findRoute(ctx, fleet, targetStarId)) {
    reject(reply, "No reachable route to retreat target.");
    return false;
  }
  return true;
}

function handleRetreatFleetTo(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
  targetSystemPosition?: ReturnType<typeof systemCenterPosition>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!validateRetreatTarget(reply, perspective, fleet, targetStarId, true)) return;

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
  fleet.currentTacticalOrder = normalizeFleetTacticalOrder({ type: "retreat", issuedAtYear: ctx.state.clock.year });
  fleet.combatStatus = "retreating";
  startFleetRetreat(ctx, fleet);
  ctx.hasDirtyState = true;
  accept(reply, "Fleet ordered to retreat to target system.");
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
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!validateRetreatTarget(reply, perspective, fleet, targetStarId, false)) return;

  const lostShipIds = new Set<string>();
  const activeShips = ctx.state.ships.filter((ship) => ship.fleetId === fleetId && ship.hull > 0);

  for (const ship of activeShips) {
    ship.shield = Math.max(0, ship.shield - ship.maxShield * EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION);
    const armorDamage = ship.maxArmor * EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION;
    const hullDamage = ship.maxHull * EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION;
    ship.armor = Math.max(0, ship.armor - armorDamage);
    ship.hull = Math.max(0, ship.hull - hullDamage);
    ship.hp = ship.hull;
    ship.crew = Math.max(0, ship.crew - ship.crewCapacity * hullDamage / Math.max(1, ship.maxHull) * 0.5);
    if (random(ctx, "combat") < EMERGENCY_RETREAT_SHIP_LOSS_CHANCE || ship.hull <= 0) {
      ship.crew = 0;
      lostShipIds.add(ship.id);
    }
  }

  const lostCount = lostShipIds.size;
  if (lostCount > 0) {
    const lostArmyIds = new Set(ctx.state.ships.filter((ship) => lostShipIds.has(ship.id) && ship.armyUnitId).map((ship) => ship.armyUnitId!));
    if (lostArmyIds.size > 0) ctx.state.armies = ctx.state.armies.filter((army) => !lostArmyIds.has(army.id));
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
  accept(reply, "Emergency retreat initiated.");
  broadcastUpdates(["ships", "fleets", "armies"]);
}

function handleAttackTarget(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetId: string,
  targetKind: "fleet" | "starbase",
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  const targetOwnerId = targetKind === "fleet"
    ? ctx.state.fleets.find((candidate) => candidate.id === targetId)?.ownerId
    : ctx.state.starbases.find((candidate) => candidate.id === targetId)?.ownerId;
  const targetStarId = targetKind === "fleet"
    ? ctx.state.fleets.find((candidate) => candidate.id === targetId)?.currentStarId
    : ctx.state.starbases.find((candidate) => candidate.id === targetId)?.starId;
  if (targetOwnerId === undefined || targetStarId === undefined) return reject(reply, "Target not found.");
  if (targetStarId !== fleet.currentStarId) return reject(reply, "Target is not in the same system.");
  if (!isHostileOwner(ctx, fleet.ownerId, targetOwnerId)) return reject(reply, "Target is not hostile.");
  prepareFleetForReplacementOrder(ctx, fleet);
  fleet.currentTacticalOrder = normalizeFleetTacticalOrder({
    type: "attack",
    targetId,
    targetKind,
    issuedAtYear: ctx.state.clock.year,
  });
  fleet.currentTargetId = targetId;
  fleet.currentTargetKind = targetKind;
  if (fleet.combatStance === "passive" || fleet.combatStance === "evade") {
    fleet.combatStance = "aggressive";
  }
  ctx.hasDirtyState = true;
  accept(reply, "Attack order accepted.");
  broadcastUpdates(["fleets"]);
}

function handleAttackSystem(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string,
  targetStarId: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(reply, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(reply, "Fleet cannot accept orders right now.");
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= ctx.state.stars.length) return reject(reply, "Invalid target system.");
  try {
    prepareFleetForReplacementOrder(ctx, fleet);
    startAttackSystemOrder(ctx, fleet, targetStarId);
    ctx.hasDirtyState = true;
    refreshDiscovery();
    accept(reply, "Attack order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(reply, error instanceof Error ? error.message : "Attack order rejected.");
  }
}

function getOwnedFleetForCombatCommand(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string): GameFleet | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return null;
  }
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId) ?? null;
  if (!fleet) {
    reject(reply, "Fleet not found.");
    return null;
  }
  if (fleet.ownerId !== factionId) {
    reject(reply, "You do not own that fleet.");
    return null;
  }
  return fleet;
}

function commitFleetDoctrineChange(reply: CommandReply, message: string): void {
  ctx.hasDirtyState = true;
  accept(reply, message);
  broadcastUpdates(["fleets"]);
}

function handleSetFleetCombatSettings(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  fleetId: string,
  combatSettings: Partial<FleetCombatSettings>,
  combatStance?: CombatStance,
): void {
  const fleet = getOwnedFleetForCombatCommand(reply, perspective, fleetId);
  if (!fleet) return;
  if (combatStance !== undefined) {
    fleet.combatStance = normalizeCombatStance(combatStance);
  }
  fleet.combatSettings = createDefaultFleetCombatSettings({
    ...fleet.combatSettings,
    ...combatSettings,
  });
  commitFleetDoctrineChange(reply, "Fleet doctrine updated.");
}

function handleIssueFleetTacticalOrder(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "issueFleetTacticalOrder" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(reply, perspective, command.fleetId);
  if (!fleet) return;
  const order = normalizeFleetTacticalOrder({
    ...command.order,
    issuedAtYear: ctx.state.clock.year,
  });
  if (!order) return reject(reply, "Invalid fleet tactical order.");
  if (order.type === "move" && !order.targetPosition) return reject(reply, "Move orders require a system position.");
  if (order.type === "attack" && (!order.targetId || !order.targetKind)) return reject(reply, "Attack orders require a target.");
  if (order.type === "guard" && !order.targetPosition && !order.guardPosition) return reject(reply, "Guard orders require a position.");
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
  accept(reply, "Fleet tactical order accepted.");
  broadcastUpdates(["fleets"]);
}

function handleRepairFleet(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "repairFleet" }>,
): void {
  const repairFleet = getOwnedFleetForCombatCommand(reply, perspective, command.constructionFleetId);
  if (!repairFleet) return;
  if (!fleetHasConstructionShip(ctx, repairFleet)) return reject(reply, "Selected fleet has no construction ship.");
  const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === command.targetFleetId);
  if (!targetFleet) return reject(reply, "Repair target fleet not found.");
  if (targetFleet.currentStarId !== repairFleet.currentStarId) return reject(reply, "Construction ship and target must be in the same system.");
  const alliedAccess = targetFleet.ownerId === repairFleet.ownerId || (
    getBorderPolicy(ctx.state.diplomacy, targetFleet.ownerId, repairFleet.ownerId) === "open"
    && getActiveTreatiesBetween(ctx.state.diplomacy, targetFleet.ownerId, repairFleet.ownerId).length > 0
  );
  if (!alliedAccess) return reject(reply, "Target fleet has not granted allied repair access.");
  repairFleet.repairOrder = {
    targetFleetId: targetFleet.id,
    targetShipId: null,
    stage: "emergencyMobility",
    progressHours: 0,
    startedAtYear: ctx.state.clock.year,
  };
  prepareFleetForReplacementOrder(ctx, repairFleet);
  ctx.hasDirtyState = true;
  accept(reply, "Construction fleet repair operation started.");
  broadcastUpdates(["fleets", "ships"]);
}

function sendPlanetDetails(socket: WebSocket, perspective: GalaxyPerspective, planetId: string): void {
  const planetState = getPlanetState(ctx, planetId);
  if (!planetState || !canAccessPlanet(ctx, perspective, planetState)) {
    rejectSocket(socket, "Planet is not available.");
    return;
  }
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) {
    rejectSocket(socket, "Planet details are unavailable.");
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

function validatePlanetCommand(reply: CommandReply, perspective: GalaxyPerspective, planetId: string): PlanetState | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return null;
  }

  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) {
    reject(reply, "Planet not found.");
    return null;
  }
  if (!planetState.isHabited) {
    reject(reply, "Only habited planets can be managed.");
    return null;
  }
  if (planetState.ownerId !== factionId) {
    reject(reply, "You do not own that planet.");
    return null;
  }
  return planetState;
}

function getFactionEconomy(factionId: number): FactionEconomyState | null {
  return ctx.state.factionEconomies.find((economy) => economy.factionId === factionId) ?? null;
}

function spendMinerals(reply: CommandReply, factionId: number, amount: number): boolean {
  return spendResources(reply, factionId, { minerals: amount });
}

function spendResources(reply: CommandReply, factionId: number, cost: Partial<ResourceCounts>): boolean {
  const economy = getFactionEconomy(factionId);
  if (!economy) {
    reject(reply, "Faction economy unavailable.");
    return false;
  }
  const normalizedCost = normalizeResourceCounts(cost);
  for (const resource of Object.keys(normalizedCost) as Array<keyof ResourceCounts>) {
    const amount = normalizedCost[resource];
    if (amount <= 0) continue;
    if (economy.stockpiles[resource] < amount) {
      reject(reply, `Need ${amount} ${resource}.`);
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

function hasAvailableCrew(reply: CommandReply, factionId: number, amount: number): boolean {
  const economy = getFactionEconomy(factionId);
  if (!economy) {
    reject(reply, "Faction economy unavailable.");
    return false;
  }
  const required = Math.max(0, Math.floor(amount));
  if (economy.crewStockpile < required) {
    reject(reply, `Need ${required} Crew.`);
    return false;
  }
  return true;
}

function reserveCrew(factionId: number, amount: number): void {
  const economy = getFactionEconomy(factionId);
  if (!economy) return;
  economy.crewStockpile = Math.max(0, economy.crewStockpile - Math.max(0, Math.floor(amount)));
  ctx.hasDirtyState = true;
}

function refundCrew(factionId: number, amount: number): void {
  const economy = getFactionEconomy(factionId);
  if (!economy) return;
  economy.crewStockpile += Math.max(0, Math.floor(amount));
  ctx.hasDirtyState = true;
}

function handleMarketTrade(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  resourceId: ResourceKind,
  tradeType: "buy" | "sell",
  rawAmount: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return;
  }

  if (!isMarketResourceKind(resourceId)) {
    reject(reply, "Resource is not available on the market.");
    return;
  }

  const amount = Math.floor(Number(rawAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    reject(reply, "Enter a positive trade amount.");
    return;
  }
  if (amount > 1_000_000) {
    reject(reply, "Trade amount is too large.");
    return;
  }

  const economy = getFactionEconomy(factionId);
  if (!economy) {
    reject(reply, "Faction economy unavailable.");
    return;
  }

  const quote = calculateTradeQuote(ctx.state, factionId, resourceId, tradeType, amount).trade;
  const grossEnergy = amount * quote.averageUnitPrice;
  const feePaid = quote.feePaid;

  if (tradeType === "buy") {
    const buyCost = quote.totalEnergy;
    if (economy.stockpiles.energy < buyCost) {
      reject(reply, `Need ${formatEnergyAmount(buyCost)} Energy.`);
      return;
    }
    economy.stockpiles = {
      ...economy.stockpiles,
      energy: economy.stockpiles.energy - buyCost,
      [resourceId]: economy.stockpiles[resourceId] + amount,
    };
    getMarketPlayerStats(ctx, factionId).totalImportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, factionId, resourceId, "buy", amount, quote.averageUnitPrice, feePaid, -buyCost);
    recordMarketTradeVolume(ctx, factionId, resourceId, "buy", amount);
    accept(reply, `Bought ${amount} ${resourceId} for ${formatEnergyAmount(buyCost)} Energy.`);
  } else {
    if (economy.stockpiles[resourceId] < amount) {
      reject(reply, `Need ${amount} ${resourceId}.`);
      return;
    }
    const sellPayout = quote.totalEnergy;
    economy.stockpiles = {
      ...economy.stockpiles,
      [resourceId]: economy.stockpiles[resourceId] - amount,
      energy: economy.stockpiles.energy + sellPayout,
    };
    getMarketPlayerStats(ctx, factionId).totalExportsEnergy += grossEnergy;
    recordMarketTransaction(ctx, factionId, resourceId, "sell", amount, quote.averageUnitPrice, feePaid, sellPayout);
    recordMarketTradeVolume(ctx, factionId, resourceId, "sell", amount);
    accept(reply, `Sold ${amount} ${resourceId} for ${formatEnergyAmount(sellPayout)} Energy.`);
  }

  ctx.hasDirtyState = true;
  refreshFactionEconomyDeltas();
  broadcastUpdates(["factionEconomies", "market"]);
}

function handleAddMarketAutoTrade(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  resourceId: ResourceKind,
  tradeType: "auto_buy" | "auto_sell",
  rawAmountPerHour: number,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return;
  }
  if (!isMarketResourceKind(resourceId)) {
    reject(reply, "Resource is not available on the market.");
    return;
  }
  const amountPerHour = Number(rawAmountPerHour);
  if (!Number.isFinite(amountPerHour) || amountPerHour <= 0) {
    reject(reply, "Enter a positive per-minute amount.");
    return;
  }
  if (amountPerHour > 1_000_000) {
    reject(reply, "Automatic trade amount is too large.");
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
  accept(reply, `${tradeType === "auto_buy" ? "Auto-buy" : "Auto-sell"} set to ${formatEnergyAmount(gameHourToRealMinute(amountPerHour))} ${resourceId}/min.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function handleRemoveMarketAutoTrade(reply: CommandReply, perspective: GalaxyPerspective, orderId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return;
  }
  const index = ctx.state.market.autoTrades.findIndex((order) => order.id === orderId && order.playerId === factionId);
  if (index < 0) {
    reject(reply, "Automatic trade not found.");
    return;
  }
  const [removed] = ctx.state.market.autoTrades.splice(index, 1);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(reply, `${removed?.type === "auto_buy" ? "Auto-buy" : "Auto-sell"} removed.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function formatEnergyAmount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(1);
}

function commitPlanetState(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  message: string,
  nextPlanetState: PlanetState,
): void {
  const index = ctx.state.planetStates.findIndex((planetState) => planetState.id === nextPlanetState.id);
  if (index < 0) {
    reject(reply, "Planet not found.");
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
  accept(reply, message);
  queuePlanetDetailRefresh(nextPlanetState.id);
  broadcastUpdates(["clock", "planetStates", "factionEconomies", "habitedPlanetSystems"]);
}

function validateStarbaseCommand(reply: CommandReply, perspective: GalaxyPerspective, starbaseId: string): ServerStarbase | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return null;
  }

  const starbase = ctx.state.starbases.find((candidate) => candidate.id === starbaseId);
  if (!starbase) {
    reject(reply, "Starbase not found.");
    return null;
  }
  if (starbase.ownerId !== factionId) {
    reject(reply, "You do not own that starbase.");
    return null;
  }
  if (!canAccessStar(ctx, perspective, starbase.starId)) {
    reject(reply, "Starbase is not available.");
    return null;
  }
  return starbase;
}

function commitStarbase(reply: CommandReply, message: string, nextStarbase: ServerStarbase): void {
  const index = ctx.state.starbases.findIndex((starbase) => starbase.id === nextStarbase.id);
  if (index < 0) {
    reject(reply, "Starbase not found.");
    return;
  }
  const normalized = normalizeStarbase(nextStarbase);
  ctx.state.starbases[index] = normalized;
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(reply, message);
  broadcastUpdates(["clock", "starbases", "factionEconomies"]);
}

function handleUpgradeStarbase(reply: CommandReply, perspective: GalaxyPerspective, starbaseId: string): void {
  const starbase = validateStarbaseCommand(reply, perspective, starbaseId);
  if (!starbase) return;
  if (starbase.status !== "online") return reject(reply, "Starbase is not online.");
  if (!STARBASE_LEVEL_DEFINITIONS[starbase.level]?.upgrade) return reject(reply, "Starbase is already at maximum level.");
  if (starbase.constructionQueue.some((item) => item.kind === "upgrade")) {
    return reject(reply, "Starbase upgrade is already queued.");
  }
  const item = createStarbaseUpgradeQueueItem(starbase.level, createRuntimeId("construction"));
  if (!item) return reject(reply, "Starbase cannot upgrade.");
  if (!spendResources(reply, starbase.ownerId, item.cost)) return;
  commitStarbase(reply, "Starbase upgrade queued.", {
    ...starbase,
    constructionQueue: [...starbase.constructionQueue, item],
  });
}

function handleBuildStarbaseBuilding(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  starbaseId: string,
  slotIndex: number,
  buildingKind: StarbaseBuildingKind,
): void {
  const starbase = validateStarbaseCommand(reply, perspective, starbaseId);
  if (!starbase) return;
  if (!isStarbaseBuildingKind(buildingKind)) return reject(reply, "Invalid starbase building.");
  if (!requireUnlocked(reply, starbase.ownerId, getRequiredTechIdsForStarbaseBuilding(buildingKind))) return;
  if (getNebulaGatedBuildingKinds().has(buildingKind)
    && !nebulaEnablesBuildingAtStar(ctx.state.nebulae, starbase.starId, buildingKind)) {
    return reject(reply, "This building can only be built inside the right nebula.");
  }
  if (
    (buildingKind === "listeningStation" || buildingKind === "logisticsDepot")
    && (
      starbase.buildingSlots.includes(buildingKind)
      || starbase.constructionQueue.some((item) => item.kind === "building" && item.buildingKind === buildingKind)
    )
  ) {
    return reject(reply, `${buildingKind === "listeningStation" ? "Listening Station" : "Logistics Depot"} is unique per starbase.`);
  }
  const unlockedSlots = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.buildingSlots ?? 0;
  if (!isValidSlotIndex(slotIndex, starbase.buildingSlots.length) || slotIndex >= unlockedSlots) {
    return reject(reply, "Invalid starbase building slot.");
  }
  if (starbase.buildingSlots[slotIndex]) return reject(reply, "Starbase building slot is occupied.");
  if (hasQueuedStarbaseBuildingTarget(starbase.constructionQueue, slotIndex)) {
    return reject(reply, "Starbase building slot is already queued.");
  }
  const item = createStarbaseBuildingQueueItem(buildingKind, slotIndex, createRuntimeId("construction"));
  if (!spendResources(reply, starbase.ownerId, item.cost)) return;
  commitStarbase(reply, "Starbase building queued.", {
    ...starbase,
    constructionQueue: [...starbase.constructionQueue, item],
  });
}

function handleBuildStarbaseShip(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  starbaseId: string,
  shipKind: StarbaseShipKind,
  designId?: string,
): void {
  const starbase = validateStarbaseCommand(reply, perspective, starbaseId);
  if (!starbase) return;
  if (!isStarbaseShipKind(shipKind)) return reject(reply, "Invalid ship design.");
  if (shipKind === "armyShip") return reject(reply, "Army transports are commissioned through Army recruitment.");
  const shipyardCount = countStarbaseShipyards(starbase.buildingSlots);
  if (shipyardCount <= 0) return reject(reply, "Starbase has no completed shipyards.");
  if (shipKind === "defensePlatform") {
    const capacity = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.defensePlatformCapacity ?? 0;
    const built = ctx.state.fleets
      .filter((fleet) => fleet.stationaryStarbaseId === starbase.id && fleet.ownerId === starbase.ownerId)
      .reduce((total, fleet) => total + fleet.shipIds.length, 0);
    const queued = starbase.shipQueue.filter((item) => item.kind === "build" && item.shipKind === "defensePlatform").length;
    if (built + queued >= capacity) return reject(reply, "Defense platform capacity reached.");
  }
  const design = findShipDesign(ctx.state.shipDesigns, starbase.ownerId, shipKind, designId, false);
  if (!design) return reject(reply, "Ship design is unavailable.");
  if (!isShipDesignUnlockedForFaction(ctx, starbase.ownerId, design)) {
    return reject(reply, `Requires ${getShipDesignMissingTechnologyName(ctx, starbase.ownerId, design) ?? "required technology"}.`);
  }
  const stats = calculateShipDesignStats(design);
  const constructionCostMultiplier = getStarbaseShipConstructionCostMultiplier(starbase.buildingSlots);
  const item = createStarbaseShipQueueItem(shipKind, {
    kind: "build",
    designId: design.id,
    label: design.name,
    cost: scaleResourceCounts(stats.cost, constructionCostMultiplier),
    totalDays: stats.buildDays,
    remainingDays: stats.buildDays,
    alloyUpkeepPerDay: stats.alloyUpkeepPerDay,
    crewDemand: stats.crewDemand,
  }, createRuntimeId("construction"));
  if (!hasAvailableCrew(reply, starbase.ownerId, item.reservedCrew)) return;
  if (!spendResources(reply, starbase.ownerId, item.upfrontCost)) return;
  reserveCrew(starbase.ownerId, item.reservedCrew);
  commitStarbase(reply, "Ship queued.", {
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
}

function handleBuildPlanetShip(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  shipKind: StarbaseShipKind,
  designId?: string,
): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet || planet.ownerId === null) return;
  if (!isStarbaseShipKind(shipKind)) return reject(reply, "Invalid ship design.");
  if (shipKind === "armyShip") return reject(reply, "Army transports are commissioned through Army recruitment.");
  if (countPlanetShipyards(planet) <= 0) return reject(reply, "Planet has no completed orbital shipyards.");

  if (shipKind === "defensePlatform") {
    const capacity = getPlanetDefensePlatformCapacity(planet);
    const built = ctx.state.fleets
      .filter((fleet) => (
        fleet.stationaryPlanetId === planet.id
        && fleet.ownerId === planet.ownerId
        && fleet.combatStatus !== "destroyed"
      ))
      .reduce((total, fleet) => total + fleet.shipIds.filter((shipId) => (
        ctx.state.ships.some((ship) => ship.id === shipId && ship.shipKind === "defensePlatform")
      )).length, 0);
    const queued = planet.defense.shipQueue.filter((item) => (
      item.kind === "build" && item.shipKind === "defensePlatform"
    )).length;
    if (built + queued >= capacity) return reject(reply, "Planetary defense platform capacity reached.");
  }

  const design = findShipDesign(ctx.state.shipDesigns, planet.ownerId, shipKind, designId, false);
  if (!design) return reject(reply, "Ship design is unavailable.");
  if (!isShipDesignUnlockedForFaction(ctx, planet.ownerId, design)) {
    return reject(reply, `Requires ${getShipDesignMissingTechnologyName(ctx, planet.ownerId, design) ?? "required technology"}.`);
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
  }, createRuntimeId("construction"));
  if (!hasAvailableCrew(reply, planet.ownerId, item.reservedCrew)) return;
  if (!spendResources(reply, planet.ownerId, item.upfrontCost)) return;
  reserveCrew(planet.ownerId, item.reservedCrew);
  commitPlanetState(reply, perspective, `${design.name} queued.`, {
    ...planet,
    defense: {
      ...planet.defense,
      shipQueue: [...planet.defense.shipQueue, item],
    },
  });
}

function getPlanetDefenseSlots(planet: PlanetState, section: PlanetDefenseSection) {
  return section === "defense" ? planet.defense.defenseSlots : planet.defense.shipyardSlots;
}

function isPlanetDefenseSection(value: unknown): value is PlanetDefenseSection {
  return value === "defense" || value === "shipyard";
}

function handleBuildPlanetDefenseBuilding(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  section: PlanetDefenseSection,
  slotIndex: number,
  buildingKind: PlanetDefenseBuildingKind,
): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet) return;
  if (!isPlanetDefenseSection(section)) return reject(reply, "Invalid defense section.");
  if (!PLANET_DEFENSE_BUILDING_KINDS.includes(buildingKind)) return reject(reply, "Invalid defense building.");
  const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[buildingKind];
  if (!definition.sections.includes(section)) return reject(reply, "Building is incompatible with this defense section.");
  const unlocked = section === "defense" ? getUnlockedPlanetDefenseSlots(planet) : getUnlockedPlanetShipyardSlots(planet);
  const slots = getPlanetDefenseSlots(planet, section);
  if (!isValidSlotIndex(slotIndex, slots.length) || slotIndex >= unlocked) return reject(reply, "Defense slot is locked.");
  if (slots[slotIndex]) return reject(reply, "Defense slot is occupied.");
  if (hasQueuedDefenseBuildingTarget(planet, section, slotIndex)) return reject(reply, "Defense slot is already queued.");
  if (definition.unique && [...planet.defense.defenseSlots, ...planet.defense.shipyardSlots].some((building) => building?.kind === buildingKind)) return reject(reply, `${definition.label} is unique per planet.`);
  if (!requireUnlocked(reply, planet.ownerId!, getRequiredTechIdsForPlanetDefenseBuilding(buildingKind))) return;
  const item = createDefenseBuildingConstructionQueueItem(buildingKind, section, slotIndex, undefined, createRuntimeId("construction"));
  if (!spendResources(reply, planet.ownerId!, item.cost)) return;
  commitPlanetState(reply, perspective, `${definition.label} queued.`, { ...planet, constructionQueue: [...planet.constructionQueue, item] });
}

function handleUpgradePlanetDefenseBuilding(reply: CommandReply, perspective: GalaxyPerspective, planetId: string, section: PlanetDefenseSection, slotIndex: number): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet) return;
  if (!isPlanetDefenseSection(section)) return reject(reply, "Invalid defense section.");
  const slots = getPlanetDefenseSlots(planet, section);
  if (!isValidSlotIndex(slotIndex, slots.length)) return reject(reply, "Invalid defense slot.");
  const building = slots[slotIndex];
  if (!building) return reject(reply, "Defense slot is empty.");
  if (hasQueuedDefenseBuildingTarget(planet, section, slotIndex)) return reject(reply, "Defense slot is already queued.");
  const definition = PLANET_DEFENSE_BUILDING_DEFINITIONS[building.kind];
  const targetLevel = building.level + 1;
  if (targetLevel > definition.maxLevel) return reject(reply, `${definition.label} is already at maximum level.`);
  if (!requireUnlocked(reply, planet.ownerId!, getRequiredTechIdsForPlanetDefenseBuildingLevel(building.kind, targetLevel))) return;
  const item = createDefenseBuildingConstructionQueueItem(building.kind, section, slotIndex, targetLevel, createRuntimeId("construction"));
  if (!spendResources(reply, planet.ownerId!, item.cost)) return;
  commitPlanetState(reply, perspective, `${definition.label} upgrade queued.`, { ...planet, constructionQueue: [...planet.constructionQueue, item] });
}

function handleSetPlanetDefenseBuildingEnabled(reply: CommandReply, perspective: GalaxyPerspective, planetId: string, section: PlanetDefenseSection, slotIndex: number, enabled: boolean): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet) return;
  if (!isPlanetDefenseSection(section)) return reject(reply, "Invalid defense section.");
  const slots = getPlanetDefenseSlots(planet, section);
  if (!isValidSlotIndex(slotIndex, slots.length) || !slots[slotIndex]) return reject(reply, "Defense building not found.");
  const nextSlots = slots.map((building, index) => index === slotIndex && building ? { ...building, enabled } : building);
  commitPlanetState(reply, perspective, `Defense building ${enabled ? "enabled" : "disabled"}.`, {
    ...planet,
    defense: { ...planet.defense, [section === "defense" ? "defenseSlots" : "shipyardSlots"]: nextSlots },
  });
}

function handleDemolishPlanetDefenseBuilding(reply: CommandReply, perspective: GalaxyPerspective, planetId: string, section: PlanetDefenseSection, slotIndex: number): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet) return;
  if (!isPlanetDefenseSection(section)) return reject(reply, "Invalid defense section.");
  const slots = getPlanetDefenseSlots(planet, section);
  if (!isValidSlotIndex(slotIndex, slots.length) || !slots[slotIndex]) return reject(reply, "Defense building not found.");
  if (hasQueuedDefenseBuildingTarget(planet, section, slotIndex)) return reject(reply, "Cancel the queued upgrade before demolition.");
  const nextSlots = slots.map((building, index) => index === slotIndex ? null : building);
  commitPlanetState(reply, perspective, "Defense building demolished.", {
    ...planet,
    defense: { ...planet.defense, [section === "defense" ? "defenseSlots" : "shipyardSlots"]: nextSlots },
  });
}

function handleQueueArmyRecruitment(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  yardKind: "planet" | "starbase",
  yardId: string,
  armyTypeId: string,
  speciesId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  if (yardKind !== "planet" && yardKind !== "starbase") return reject(reply, "Invalid Army recruitment yard.");
  if (!isArmyTypeId(armyTypeId) || !MOBILE_ARMY_TYPE_IDS.includes(armyTypeId)) return reject(reply, "Invalid mobile army type.");
  const definition = ARMY_TYPE_DEFINITIONS[armyTypeId];
  const speciesPopulation = ctx.state.planetStates
    .filter((planet) => planet.isHabited && planet.ownerId === factionId)
    .flatMap((planet) => planet.speciesPopulations)
    .filter((entry) => entry.speciesId === speciesId)
    .reduce((total, entry) => total + entry.population, 0);
  if (speciesPopulation <= 0 || !ctx.state.species.some((species) => species.id === speciesId)) return reject(reply, "That species has no resident population in your empire.");
  if (definition.requiredTechnologyId && !isTechnologyCompleted(getFactionTechnology(ctx.state, factionId), definition.requiredTechnologyId as TechId)) {
    return reject(reply, `Requires ${TECHNOLOGY_BY_ID[definition.requiredTechnologyId as TechId]?.name ?? "the required technology"}.`);
  }
  const cap = getArmyRecruitmentCap(ctx.state, factionId, speciesId);
  if (cap.used >= cap.cap) return reject(reply, `Army cap reached for this species (${cap.used}/${cap.cap}).`);
  const starbase = yardKind === "starbase" ? validateStarbaseCommand(reply, perspective, yardId) : null;
  const planet = yardKind === "planet" ? validatePlanetCommand(reply, perspective, yardId) : null;
  if (yardKind === "starbase" && (!starbase || countStarbaseShipyards(starbase.buildingSlots) <= 0)) {
    if (starbase) reject(reply, "Starbase has no completed shipyards.");
    return;
  }
  if (yardKind === "planet" && (!planet || planet.ownerId === null || countPlanetShipyards(planet) <= 0)) {
    if (planet) reject(reply, "Planet has no completed orbital shipyards.");
    return;
  }
  const totalDays = ARMY_TRANSPORT_BUILD_DAYS + definition.trainingDays;
  const item = createStarbaseShipQueueItem("armyShip", {
    kind: "armyBuild",
    armyTypeId,
    speciesId,
    label: `${definition.name} (${ctx.state.species.find((species) => species.id === speciesId)?.name ?? speciesId})`,
    cost: definition.cost,
    totalDays,
    remainingDays: totalDays,
    crewDemand: ARMY_TOTAL_CREW_DEMAND,
    reservedCrew: ARMY_TOTAL_CREW_DEMAND,
  }, createRuntimeId("construction"));
  if (!hasAvailableCrew(reply, factionId, item.reservedCrew)) return;
  if (!spendResources(reply, factionId, item.upfrontCost)) return;
  reserveCrew(factionId, item.reservedCrew);
  if (yardKind === "starbase") {
    commitStarbase(reply, `${definition.name} recruitment queued.`, { ...starbase!, shipQueue: [...starbase!.shipQueue, item] });
    return;
  }
  commitPlanetState(reply, perspective, `${definition.name} recruitment queued.`, {
    ...planet!,
    defense: { ...planet!.defense, shipQueue: [...planet!.defense.shipQueue, item] },
  });
}

function validateOwnedArmyFleet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string): GameFleet | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return null;
  }
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet || fleet.ownerId !== factionId) {
    reject(reply, "Army Fleet not found.");
    return null;
  }
  if (!isArmyFleet(ctx.state, fleet)) {
    reject(reply, "The selected fleet is not a pure Army Fleet.");
    return null;
  }
  if (fleet.combatStatus !== "idle" || fleet.hyperlanePosition) {
    reject(reply, "Army Fleet is not available for landing.");
    return null;
  }
  return fleet;
}

function handleLandArmyFleet(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const fleet = validateOwnedArmyFleet(reply, perspective, fleetId);
  if (!fleet) return;
  const planet = ctx.state.planetStates.find((candidate) => candidate.id === planetId);
  if (!planet || !planet.isHabited || planet.ownerId !== fleet.ownerId) return reject(reply, "Armies may land only on an owned inhabited planet.");
  if (fleet.phase !== "orbitingPlanet" || fleet.orbitTarget?.kind !== "planet" || fleet.orbitTarget.planetId !== planet.id) return reject(reply, "Army Fleet must be orbiting the planet.");
  try {
    reinforceOwnedPlanet(ctx, fleet, planet);
  } catch (error) {
    return reject(reply, error instanceof Error ? error.message : "Army landing failed.");
  }
  ctx.hasDirtyState = true;
  ctx.queuePlanetDetailRefresh(planet.id);
  accept(reply, "Armies landed.");
  broadcastUpdates(["armies", "fleets", "ships", "leaders", "groundBattles", "planetStates", "factionEconomies"]);
}

function handleEmbarkPlanetArmies(reply: CommandReply, perspective: GalaxyPerspective, planetId: string, armyIds: string[], embarkCommander: boolean): void {
  const planet = validatePlanetCommand(reply, perspective, planetId);
  if (!planet || planet.ownerId === null) return;
  if (!Array.isArray(armyIds) || armyIds.some((id) => typeof id !== "string")) return reject(reply, "Invalid Army selection.");
  try {
    embarkPlanetArmies(ctx, planet, armyIds, planet.ownerId, embarkCommander);
  } catch (error) {
    return reject(reply, error instanceof Error ? error.message : "Army embarkation failed.");
  }
  ctx.hasDirtyState = true;
  ctx.queuePlanetDetailRefresh(planet.id);
  accept(reply, "Selected armies embarked.");
  broadcastUpdates(["armies", "fleets", "ships", "leaders", "planetStates", "factionEconomies"]);
}

function handleBeginPlanetInvasion(reply: CommandReply, perspective: GalaxyPerspective, fleetId: string, planetId: string): void {
  const fleet = validateOwnedArmyFleet(reply, perspective, fleetId);
  if (!fleet) return;
  const planet = ctx.state.planetStates.find((candidate) => candidate.id === planetId);
  if (!planet) return reject(reply, "Planet not found.");
  try {
    beginPlanetInvasion(ctx, fleet, planet);
  } catch (error) {
    return reject(reply, error instanceof Error ? error.message : "Invasion failed.");
  }
  ctx.hasDirtyState = true;
  ctx.queuePlanetDetailRefresh(planet.id);
  accept(reply, "Planetary invasion begun.");
  broadcastUpdates(["armies", "groundBattles", "fleets", "ships", "leaders", "planetStates", "factionEconomies"]);
}

function handleWithdrawGroundBattle(reply: CommandReply, perspective: GalaxyPerspective, battleId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const battle = ctx.state.groundBattles.find((candidate) => candidate.id === battleId);
  if (!battle || battle.attackerFactionId !== factionId) return reject(reply, "Ground battle not found.");
  requestGroundWithdrawal(ctx.state, battle);
  ctx.hasDirtyState = true;
  ctx.queuePlanetDetailRefresh(battle.planetId);
  accept(reply, "Withdrawal ordered; extraction completes in 30 days.");
  broadcastUpdates(["groundBattles", "armies"]);
}

function handleCancelShipConstruction(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  yardKind: "planet" | "starbase",
  yardId: string,
  queueItemId: string,
): void {
  if (yardKind === "starbase") {
    const starbase = validateStarbaseCommand(reply, perspective, yardId);
    if (!starbase) return;
    const item = starbase.shipQueue.find((candidate) => candidate.id === queueItemId);
    if (!item) return reject(reply, "Ship construction not found.");
    refundCrew(starbase.ownerId, item.reservedCrew);
    if (item.kind === "upgrade" && item.shipId) {
      const ship = ctx.state.ships.find((candidate) => candidate.id === item.shipId);
      if (ship) ship.targetDesignId = null;
    }
    commitStarbase(reply, "Ship construction cancelled.", {
      ...starbase,
      shipQueue: starbase.shipQueue.filter((candidate) => candidate.id !== queueItemId),
    });
    return;
  }

  const planet = validatePlanetCommand(reply, perspective, yardId);
  if (!planet || planet.ownerId === null) return;
  const item = planet.defense.shipQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return reject(reply, "Ship construction not found.");
  refundCrew(planet.ownerId, item.reservedCrew);
  commitPlanetState(reply, perspective, "Ship construction cancelled.", {
    ...planet,
    defense: {
      ...planet.defense,
      shipQueue: planet.defense.shipQueue.filter((candidate) => candidate.id !== queueItemId),
    },
  });
}

function handleUpgradeShip(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "upgradeShip" }>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const ship = ctx.state.ships.find((candidate) => candidate.id === command.shipId);
  if (!ship) return reject(reply, "Ship not found.");
  if (ship.ownerId !== factionId) return reject(reply, "You do not own that ship.");
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === ship.fleetId);
  if (!fleet) return reject(reply, "Fleet not found.");
  if (!isFleetAvailableForOrders(fleet)) return reject(reply, "Fleet is already busy.");

  const starbase = validateStarbaseCommand(reply, perspective, command.starbaseId);
  if (!starbase) return;
  if (starbase.starId !== fleet.currentStarId) return reject(reply, "Move the fleet to a shipyard system before upgrading.");
  if (countStarbaseShipyards(starbase.buildingSlots) <= 0) return reject(reply, "Starbase has no completed shipyards.");
  const alreadyQueued = ctx.state.starbases.some((candidate) => (
    candidate.shipQueue.some((item) => item.kind === "upgrade" && item.shipId === ship.id)
  ));
  if (alreadyQueued) return reject(reply, "Ship upgrade is already queued.");

  const currentDesign = findShipDesign(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, true);
  if (!currentDesign) return reject(reply, "Current ship design is unavailable.");
  const explicitTarget = command.targetDesignId
    ? findShipDesignById(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, command.targetDesignId, false)
    : null;
  if (command.targetDesignId && !explicitTarget) return reject(reply, "Target ship design is unavailable.");
  const assignedTarget = ship.targetDesignId
    ? findShipDesignById(ctx.state.shipDesigns, ship.ownerId, ship.shipKind, ship.targetDesignId, false)
    : null;
  const targetDesign = explicitTarget ?? assignedTarget ?? getNewestActiveShipDesign(ctx.state.shipDesigns, ship.ownerId, ship.shipKind);
  if (!targetDesign) return reject(reply, "No active target design is available.");
  if (!isShipDesignUnlockedForFaction(ctx, factionId, targetDesign)) {
    return reject(reply, `Requires ${getShipDesignMissingTechnologyName(ctx, factionId, targetDesign) ?? "required technology"}.`);
  }
  const isPlatformReactivation = ship.shipKind === "defensePlatform" && ship.disabled === true;
  if (targetDesign.id === currentDesign.id && !isPlatformReactivation) {
    return reject(reply, "Ship is already using the newest available design.");
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
  const targetCrewCapacity = Math.max(0, Math.round(calculateShipDesignStats(targetDesign).crewDemand));
  const reservedCrewGrowth = Math.max(0, targetCrewCapacity - ship.crewCapacity);
  const item = createStarbaseShipQueueItem(ship.shipKind, {
    kind: "upgrade",
    shipId: ship.id,
    designId: currentDesign.id,
    targetDesignId: targetDesign.id,
    label: isPlatformReactivation ? `Reactivate ${targetDesign.name}` : `Upgrade to ${targetDesign.name}`,
    cost: scaleResourceCounts(
      upgrade.cost,
      getStarbaseShipConstructionCostMultiplier(starbase.buildingSlots),
    ),
    totalDays: upgrade.totalDays,
    remainingDays: upgrade.totalDays,
    alloyUpkeepPerDay: upgrade.alloyUpkeepPerDay,
    crewDemand: reservedCrewGrowth,
    reservedCrew: reservedCrewGrowth,
  }, createRuntimeId("construction"));
  if (!hasAvailableCrew(reply, factionId, item.reservedCrew)) return;
  if (!spendResources(reply, factionId, item.upfrontCost)) return;
  reserveCrew(factionId, item.reservedCrew);

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
  accept(reply, isPlatformReactivation ? "Defense-platform reactivation queued." : "Ship upgrade queued.");
  broadcastUpdates(["clock", "starbases", "ships", "fleets", "factionEconomies"]);
}

function handleSaveShipDesign(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "saveShipDesign" }>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  if (!isKnownShipKind(command.shipKind)) return reject(reply, "Invalid ship hull.");
  if (command.shipKind === "armyShip") return reject(reply, "Army Ships are fixed transports commissioned through Army recruitment.");
  const current = command.designId
    ? ctx.state.shipDesigns.find((design) => design.id === command.designId && design.ownerId === factionId)
    : null;
  if (command.designId && !current) return reject(reply, "Ship design not found.");

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
  if (missingTechnology) return reject(reply, `Requires ${missingTechnology}.`);
  const hull = SHIP_HULL_DEFINITIONS[nextDesign.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
  const layout = getShipDesignLayout(nextDesign);
  if (
    nextDesign.weaponSectionModuleIds.length !== hull.weaponSectionSlots
    || nextDesign.defenseSectionModuleIds.length !== hull.defenseSectionSlots
    || nextDesign.weaponModuleIds.length !== layout.weaponSlots.length
    || nextDesign.defenseModuleIds.length !== layout.defenseSlots.length
    || nextDesign.utilityModuleIds.length !== layout.utilitySlots.length
  ) {
    return reject(reply, "Ship design slots are invalid.");
  }
  if (current) {
    ctx.state.shipDesigns = ctx.state.shipDesigns.map((design) => (design.id === current.id ? nextDesign : design));
  } else {
    ctx.state.shipDesigns.push(nextDesign);
  }
  const shipsChanged = syncShipsForDesign(ctx, ctx.state, nextDesign);
  ctx.hasDirtyState = true;
  accept(reply, "Ship design saved.");
  broadcastUpdates(shipsChanged ? ["shipDesigns", "ships", "fleets"] : ["shipDesigns"]);
}

function handleDecommissionShipDesign(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  designId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const design = ctx.state.shipDesigns.find((candidate) => candidate.id === designId && candidate.ownerId === factionId);
  if (!design) return reject(reply, "Ship design not found.");
  if (design.status === "decommissioned") return reject(reply, "Ship design is already decommissioned.");
  const activeCount = ctx.state.shipDesigns.filter((candidate) => (
    candidate.ownerId === factionId
    && candidate.shipKind === design.shipKind
    && candidate.status === "active"
  )).length;
  if (activeCount <= 1) return reject(reply, "At least one active design is required.");
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
        }, item.id) : null;
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
  accept(reply, "Ship design decommissioned.");
  const changed: ServerUpdateField[] = ["shipDesigns"];
  if (shipsChanged) changed.push("ships");
  if (starbasesChanged) changed.push("starbases");
  broadcastUpdates(changed);
}

function handleBuildDistrict(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  districtKind: DistrictKind,
): void {
  if (!isDistrictKind(districtKind)) return reject(reply, "Invalid district type.");
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const limits = getPlanetDistrictLimits(planetState);
  if (!limits) return reject(reply, "Planet limits unavailable.");
  if (planetState.builtDistricts[districtKind] >= limits[districtKind]) {
    return reject(reply, "District limit reached.");
  }
  if (planetState.builtDistricts[districtKind] + getQueuedDistrictCount(planetState, districtKind) >= limits[districtKind]) {
    return reject(reply, "District is already queued to its limit.");
  }
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const item = createDistrictConstructionQueueItem(districtKind, createRuntimeId("construction"));
  if (!spendResources(reply, factionId, item.cost)) return;

  commitPlanetState(reply, perspective, "District queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function handleQueuePlanetFeatureRemoval(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  featureKind: PlanetFeatureKind,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const definition = PLANET_FEATURE_DEFINITIONS[featureKind];
  if (!definition || !planetState.features.includes(featureKind)) return reject(reply, "Planet feature not found.");
  if (!definition.removal) return reject(reply, `${definition.label} cannot be removed.`);
  if (hasQueuedFeatureRemoval(planetState, featureKind)) return reject(reply, `${definition.label} removal is already queued.`);
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  if (!requireUnlocked(reply, factionId, getRequiredTechIdsForPlanetFeatureRemoval(featureKind))) return;
  const item = createFeatureRemovalConstructionQueueItem(featureKind, createRuntimeId("construction"));
  if (!spendResources(reply, factionId, item.cost)) return;
  commitPlanetState(reply, perspective, `${definition.label} removal queued.`, {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function handleBuildPlanetBuilding(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  buildingKind: BuildingKind,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  if (!BUILDING_KINDS.includes(buildingKind)) return reject(reply, "Invalid building.");
  if (BUILDING_DEFINITIONS[buildingKind].autoPlaced) return reject(reply, "This building cannot be constructed manually.");
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  if (!requireUnlocked(reply, factionId, getRequiredTechIdsForBuilding(buildingKind))) return;

  if (area === "urbanSubDistrict") {
    if (
      subDistrictIndex === undefined
      || !isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)
    ) {
      return reject(reply, "Invalid sub-district.");
    }
    const subDistrict = planetState.urbanSubDistricts[subDistrictIndex];
    if (!isValidSlotIndex(slotIndex, subDistrict.buildings.length)) return reject(reply, "Invalid building slot.");
    if (subDistrict.buildings[slotIndex]) return reject(reply, "Building slot is occupied.");
    if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
      return reject(reply, "Building slot is already queued.");
    }
    if (!isBuildingCompatible(buildingKind, area, subDistrict.kind)) {
      return reject(reply, "Building is incompatible with this sub-district.");
    }
    const item = createBuildingConstructionQueueItem(buildingKind, area, slotIndex, subDistrictIndex, createRuntimeId("construction"));
    if (!spendResources(reply, factionId, item.cost)) return;
    commitPlanetState(reply, perspective, "Building queued.", {
      ...planetState,
      constructionQueue: [...planetState.constructionQueue, item],
    });
    return;
  }

  if (!isDistrictKind(area)) return reject(reply, "Invalid building area.");
  const slots = planetState.buildings[area];
  if (!isValidSlotIndex(slotIndex, slots.length)) return reject(reply, "Invalid building slot.");
  if (slots[slotIndex]) return reject(reply, "Building slot is occupied.");
  if (hasQueuedBuildingTarget(planetState, area, slotIndex)) return reject(reply, "Building slot is already queued.");
  if (!isBuildingCompatible(buildingKind, area)) return reject(reply, "Building is incompatible with this district.");
  const item = createBuildingConstructionQueueItem(buildingKind, area, slotIndex, undefined, createRuntimeId("construction"));
  if (!spendResources(reply, factionId, item.cost)) return;

  commitPlanetState(reply, perspective, "Building queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
  });
}

function handleUpgradePlanetBuilding(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(reply, "Observer mode is read-only.");

  let buildingSlot: PlanetBuildingSlot | undefined;
  let subDistrictKind: UrbanSubDistrictKind | undefined;
  if (area === "urbanSubDistrict") {
    if (
      subDistrictIndex === undefined
      || !isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)
    ) {
      return reject(reply, "Invalid sub-district.");
    }
    const subDistrict = planetState.urbanSubDistricts[subDistrictIndex];
    if (!isValidSlotIndex(slotIndex, subDistrict.buildings.length)) return reject(reply, "Invalid building slot.");
    buildingSlot = subDistrict.buildings[slotIndex];
    subDistrictKind = subDistrict.kind;
  } else {
    if (!isDistrictKind(area)) return reject(reply, "Invalid building area.");
    const slots = planetState.buildings[area];
    if (!isValidSlotIndex(slotIndex, slots.length)) return reject(reply, "Invalid building slot.");
    buildingSlot = slots[slotIndex];
  }

  const buildingKind = getPlanetBuildingKind(buildingSlot);
  if (!buildingKind) return reject(reply, "Building slot is empty.");
  if (!isBuildingCompatible(buildingKind, area, subDistrictKind)) {
    return reject(reply, "Building is incompatible with this district.");
  }
  const currentLevel = getPlanetBuildingLevel(buildingSlot);
  const targetLevel = getBuildingUpgradeTargetLevel(buildingSlot);
  if (!targetLevel) return reject(reply, "Building is already at maximum level.");
  if (!requireUnlocked(reply, factionId, getRequiredTechIdsForBuildingLevel(buildingKind, targetLevel))) return;
  if (!meetsCapitalUpgradePopulation(buildingKind, targetLevel, planetState.population)) {
    return reject(reply, `Requires a population of at least ${getCapitalUpgradePopulationThreshold(targetLevel).toLocaleString()}.`);
  }
  if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
    return reject(reply, "Building slot is already queued.");
  }

  const item = createBuildingUpgradeConstructionQueueItem(buildingKind, currentLevel, area, slotIndex, subDistrictIndex, createRuntimeId("construction"));
  if (!spendResources(reply, factionId, item.cost)) return;
  commitPlanetState(reply, perspective, "Building upgrade queued.", {
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
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  subDistrictIndex?: number,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const building = getPlanetBuildingAt(planetState, area, slotIndex, subDistrictIndex);
  const buildingKind = getPlanetBuildingKind(building);
  if (!buildingKind) return reject(reply, "Building slot is empty or invalid.");
  if (buildingKind === "planetaryCapital") {
    return reject(reply, "The planetary capital cannot be downgraded or demolished.");
  }
  if (hasQueuedBuildingTarget(planetState, area, slotIndex, subDistrictIndex)) {
    return reject(reply, "Cancel this building's queued construction first.");
  }
  const level = getPlanetBuildingLevel(building);
  if (level <= 1 && BUILDING_DEFINITIONS[buildingKind].autoPlaced) {
    return reject(reply, "This building cannot be demolished.");
  }
  const replacement = level > 1
    ? createPlanetBuildingState(buildingKind, level - 1, isPlanetBuildingEnabled(building))
    : null;
  commitPlanetState(
    reply,
    perspective,
    level > 1 ? "Building downgraded." : "Building demolished.",
    withPlanetBuildingAt(planetState, area, slotIndex, replacement, subDistrictIndex),
  );
}

function handleSetPlanetBuildingEnabled(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  area: BuildingSlotArea,
  slotIndex: number,
  enabled: boolean,
  subDistrictIndex?: number,
): void {
  if (typeof enabled !== "boolean") return reject(reply, "Invalid building status.");
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const building = getPlanetBuildingAt(planetState, area, slotIndex, subDistrictIndex);
  const buildingKind = getPlanetBuildingKind(building);
  if (!buildingKind) return reject(reply, "Building slot is empty or invalid.");
  if (!enabled && buildingKind === "planetaryCapital") {
    return reject(reply, "The mandatory planetary capital cannot be disabled.");
  }
  const replacement = createPlanetBuildingState(buildingKind, getPlanetBuildingLevel(building), enabled);
  commitPlanetState(
    reply,
    perspective,
    enabled ? "Building enabled." : "Building disabled.",
    withPlanetBuildingAt(planetState, area, slotIndex, replacement, subDistrictIndex),
  );
}

function handleSetPlanetJobLock(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  job: Exclude<JobKind, "criminal" | "unemployed">,
  locked: boolean,
): void {
  if (typeof locked !== "boolean" || !JOB_FILL_ORDER.includes(job)) {
    return reject(reply, "Invalid job lock.");
  }
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  if (!locked) {
    commitPlanetState(reply, perspective, "Job unlocked.", {
      ...planetState,
      jobLocks: (planetState.jobLocks ?? []).filter((candidate) => candidate.job !== job),
    });
    return;
  }
  const bySpecies = new Map<string, number>();
  for (const group of planetState.economy.popGroups) {
    if (group.job !== job || group.population <= 0) continue;
    bySpecies.set(group.speciesId, (bySpecies.get(group.speciesId) ?? 0) + group.population);
  }
  if (bySpecies.size === 0) return reject(reply, "Only a staffed productive job can be locked.");
  const lock = {
    job,
    allocations: Array.from(bySpecies.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([speciesId, population]) => ({ speciesId, population })),
  };
  commitPlanetState(reply, perspective, "Job locked.", {
    ...planetState,
    jobLocks: [
      ...(planetState.jobLocks ?? []).filter((candidate) => candidate.job !== job),
      lock,
    ],
  });
}

function handleCancelPlanetConstruction(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  queueItemId: string,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  const item = planetState.constructionQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return reject(reply, "Construction item not found.");
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const remainingRatio = item.totalDays > 0 ? Math.max(0, Math.min(1, item.remainingDays / item.totalDays)) : 0;
  const refund = createEmptyResourceCounts();
  for (const resource of RESOURCE_KINDS) refund[resource] = Math.floor(item.cost[resource] * remainingRatio);
  refundResources(factionId, refund);

  commitPlanetState(reply, perspective, "Construction cancelled.", {
    ...planetState,
    constructionQueue: planetState.constructionQueue.filter((candidate) => candidate.id !== queueItemId),
  });
}

function handleSkipPlanetConstruction(
  session: ActionSession,
  planetId: string,
  queueItemId: string,
): void {
  const planetState = validatePlanetCommand(session.reply, session.perspective, planetId);
  if (!planetState) return;
  const item = planetState.constructionQueue.find((candidate) => candidate.id === queueItemId);
  if (!item) return reject(session.reply, "Construction item not found.");

  const completed = completePlanetConstructionQueueItem(
    planetState,
    queueItemId,
    getPlanetDistrictLimitsFromState(ctx.state, planetState) ?? undefined,
    getPlanetTechnologyModifiers(ctx.state, planetState),
    getPlanetSpeciesContext(ctx.state, planetState),
  );
  if (!completed) return reject(session.reply, "This construction item can no longer be completed.");

  const cost = getConstructionDarkMatterCost(item.remainingDays);
  const balance = authStore.spendPlayerDarkMatter((session.actor as Extract<GameActor, { kind: "human" }>).accountId, cost);
  if (balance === null) return reject(session.reply, `Need ${cost} Dark Matter.`);

  broadcastAccountDarkMatter((session.actor as Extract<GameActor, { kind: "human" }>).accountId, balance);
  commitPlanetState(
    session.reply,
    session.perspective,
    `${item.label} completed instantly for ${cost} Dark Matter.`,
    completed.state,
  );
}

function handleSetUrbanSubDistrict(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  planetId: string,
  subDistrictIndex: number,
  subDistrictKind: UrbanSubDistrictKind,
): void {
  const planetState = validatePlanetCommand(reply, perspective, planetId);
  if (!planetState) return;
  if (!URBAN_SUB_DISTRICT_KINDS.includes(subDistrictKind)) return reject(reply, "Invalid sub-district type.");
  if (!isValidSlotIndex(subDistrictIndex, planetState.urbanSubDistricts.length)) {
    return reject(reply, "Invalid sub-district.");
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
  commitPlanetState(reply, perspective, "Sub-district changed.", { ...planetState, urbanSubDistricts, constructionQueue });
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

    const accountId = authStore.getAccountIdForGameFaction(ctx.game.id, fleet.ownerId);
    const available = accountId === null ? 0 : authStore.getPlayerDarkMatter(accountId);
    const billing = getFleetDarkMatterBillingPlan(
      paidUntil,
      targetYear,
      plan.endsAtYear,
      available,
    );
    if (billing.chargesDue === 0) continue;
    if (accountId !== null && billing.darkMatterCost > 0) {
      const balance = authStore.spendPlayerDarkMatter(
        accountId,
        billing.darkMatterCost,
      );
      if (balance !== null) broadcastAccountDarkMatter(accountId, balance);
    }

    if (billing.exhaustedAtYear !== null) {
      rescaleFleetMovementPlan(ctx, fleet, DARK_MATTER_FLEET_SPEED_MULTIPLIER, billing.exhaustedAtYear);
      fleet.darkMatterBoostActive = false;
      fleet.darkMatterBoostPaidUntilYear = null;
    } else {
      fleet.darkMatterBoostPaidUntilYear = billing.nextPaidUntilYear;
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
  const previousArmyLocationSignature = ctx.state.armies.map((army) => `${army.id}:${army.location.kind}:${army.location.kind === "fleet" ? army.location.fleetId : army.location.planetId}`).sort().join("|");
  const previousLeaderAssignmentSignature = ctx.state.leaders.map((leader) => `${leader.id}:${leader.assignment?.kind ?? ""}:${leader.assignment?.targetId ?? ""}`).sort().join("|");
  const habitedPlanetCountBefore = ctx.state.planetStates.filter((planet) => planet.isHabited).length;
  const shipCountBeforeFleetAdvance = ctx.state.ships.length;
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

  const movingBefore = ctx.state.fleets.some((fleet) => fleet.phase !== "idle");
  for (const fleet of ctx.state.fleets) {
    if (advanceFleet(ctx, fleet, scaledMs)) {
      arrivingFleets.push(fleet);
    }
  }
  if (
    ctx.state.planetStates.filter((planet) => planet.isHabited).length !== habitedPlanetCountBefore
    || ctx.state.ships.length !== shipCountBeforeFleetAdvance
  ) {
    changed.add("planetStates");
    changed.add("habitedPlanetSystems");
    changed.add("factionEconomies");
    changed.add("ships");
    changed.add("fleets");
    changed.add("visibility");
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
  if (combatResult.shipsChanged) {
    changed.add("ships");
    changed.add("armies");
  }
  const nextArmyLocationSignature = ctx.state.armies.map((army) => `${army.id}:${army.location.kind}:${army.location.kind === "fleet" ? army.location.fleetId : army.location.planetId}`).sort().join("|");
  const nextLeaderAssignmentSignature = ctx.state.leaders.map((leader) => `${leader.id}:${leader.assignment?.kind ?? ""}:${leader.assignment?.targetId ?? ""}`).sort().join("|");
  if (nextArmyLocationSignature !== previousArmyLocationSignature) changed.add("armies");
  if (nextLeaderAssignmentSignature !== previousLeaderAssignmentSignature) changed.add("leaders");
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
      changed.add("armies");
      changed.add("ships");
      changed.add("fleets");
      changed.add("visibility");
    }
  }

  const planetShipQueueResult = processPlanetShipQueues(ctx, elapsedGameDays);
  if (planetShipQueueResult.planetsChanged || planetShipQueueResult.fleetsChanged) {
    changed.add("planetStates");
    changed.add("factionEconomies");
    if (planetShipQueueResult.fleetsChanged) {
      changed.add("armies");
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
  const nextPopulationMonth = gameYearToMonthIndex(ctx.state.clock.year);
  if (processPopulationPeriods(ctx, nextPopulationWeek, nextPopulationMonth)) {
    changed.add("factionEconomies");
    changed.add("habitedPlanetSystems");
  }

  if (processGroundBattles(ctx)) {
    ctx.hasDirtyState = true;
    refreshFactionEconomyDeltas();
    for (const field of ["armies", "groundBattles", "planetStates", "factionEconomies", "leaders", "fleets", "ships"] as ServerUpdateField[]) changed.add(field);
  }
  if (processArmyAndCrewReplenishment(ctx, elapsedGameDays)) {
    ctx.hasDirtyState = true;
    refreshFactionEconomyDeltas();
    for (const field of ["armies", "ships", "fleets", "factionEconomies"] as ServerUpdateField[]) changed.add(field);
  }

  // Situations advance from the freshly-computed economy deltas; their progress
  // feeds shortage penalties on the next economy pass (one-tick lag is fine).
  const finalPhaseChanges = runSimulationPipeline(ctx, [
    {
      name: "situations",
      run: () => processSituations(elapsedGameDays)
        ? { changed: ["situations", "factionEconomies"] }
        : {},
    },
    {
      name: "random-events",
      run: () => processRandomEvents(ctx, elapsedGameDays)
        ? { changed: ["events", "fleets", "visibility"] }
        : {},
    },
    {
      name: "event-timeouts",
      run: () => processEventTimeouts(ctx)
        ? { changed: ["events", "factionEconomies", "leaders"] }
        : {},
    },
  ]);
  for (const field of finalPhaseChanges) changed.add(field);

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
  reply: CommandReply,
  perspective: GalaxyPerspective,
  techId: TechId,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const tech = TECHNOLOGY_BY_ID[techId];
  if (!tech) return reject(reply, "Technology not found.");
  const techState = getFactionTechnology(ctx.state, factionId);
  if (!techState) return reject(reply, "Faction technology ctx.state unavailable.");
  if (isTechnologyCompleted(techState, techId)) return reject(reply, `${tech.name} is already completed.`);
  if (!isTechnologyAvailable(tech, techState)) {
    const missing = getMissingPrerequisites(tech, techState)
      .map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id)
      .join(", ");
    return reject(reply, missing ? `Requires ${missing}.` : "Technology is not available.");
  }
  techState.activeTechId = techId;
  ctx.hasDirtyState = true;
  accept(reply, `Research focus set to ${tech.name}.`);
  broadcastUpdates(["technologies"]);
}

function isGovernmentLawOptionUnlocked(factionId: number, option: GovernmentLawOption): boolean {
  if (!option.requiresTechId) return true;
  const techState = getFactionTechnology(ctx.state, factionId);
  return Boolean(techState && isTechnologyCompleted(techState, option.requiresTechId));
}

function handleResolveEvent(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  eventId: string,
  choiceId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const event = ctx.state.events.find((candidate) => candidate.id === eventId && candidate.factionId === factionId);
  if (!event) return reject(reply, "Event is no longer available.");
  if (!event.choices.some((choice) => choice.id === choiceId)) return reject(reply, "Unknown event choice.");
  resolveActiveEvent(ctx, event, choiceId);
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  // Resolving applies arbitrary GameEffects (spawn a leader, trigger another event,
  // grant resources, adjust a situation, lose a fleet, ...). Broadcast every scope
  // those can touch so the change reaches ctx.clients live â€” otherwise the resolved
  // event's notification lingers until a full reload (the leader-offer bug).
  broadcastUpdates(["events", "leaders", "situations", "fleets", "factionEconomies", "planetStates"]);
  accept(reply, "Decision recorded.");
}

function handleSetGovernmentLaw(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  lawId: GovernmentLawId,
  optionId: string,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const law = GOVERNMENT_LAW_BY_ID[lawId];
  const option = law ? getGovernmentLawOption(lawId, optionId) : undefined;
  if (!law || !option) return reject(reply, "Government law option not found.");
  if (!isGovernmentLawOptionUnlocked(factionId, option)) {
    const required = option.requiresTechId ? TECHNOLOGY_BY_ID[option.requiresTechId]?.name ?? option.requiresTechId : "required technology";
    return reject(reply, `Requires ${required}.`);
  }
  let government = ctx.state.governments.find((candidate) => candidate.factionId === factionId);
  if (!government) {
    government = createInitialGovernmentState(factionId);
    ctx.state.governments.push(government);
  }
  if (government.selectedLawOptionIds[lawId] === option.id) {
    return accept(reply, `${law.name} already uses ${option.name}.`);
  }
  const previousRights = JSON.stringify(getFactionSpeciesRightsState(ctx.state, factionId));
  government.selectedLawOptionIds[lawId] = option.id;
  ctx.state.speciesRights = normalizeSpeciesRightsForFactions(ctx.state);
  const rightsChanged = previousRights !== JSON.stringify(getFactionSpeciesRightsState(ctx.state, factionId));
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(reply, `${law.name} set to ${option.name}.`);
  const changed: ServerUpdateField[] = ["governments", "species", "planetStates", "factionEconomies", "fleets", "technologies"];
  if (rightsChanged) changed.push("visibility");
  broadcastUpdates(changed);
}

function handleSetSpeciesRights(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  speciesId: string,
  rightsInput: Partial<SpeciesRights>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(reply, "Observer mode is read-only.");
  const species = ctx.state.species.find((candidate) => candidate.id === speciesId);
  if (!species) return reject(reply, "Species not found.");
  if (!getEmpireSpeciesIds(ctx.state, factionId).includes(species.id)) {
    return reject(reply, "That species does not live in your empire.");
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
    return accept(reply, `${species.name} rights already match current law.`);
  }
  rightsState.rightsBySpeciesId = {
    ...rightsState.rightsBySpeciesId,
    [species.id]: normalized,
  };
  ctx.state.speciesRights = normalizeSpeciesRightsForFactions(ctx.state);
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(reply, `${species.name} rights updated.`);
  broadcastUpdates(["species", "planetStates", "factionEconomies"]);
}

function validateLeaderCommand(reply: CommandReply, perspective: GalaxyPerspective, leaderId: string): {
  leader: LeaderState;
  factionId: number;
} | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(reply, "Observer mode is read-only.");
    return null;
  }
  const leader = ctx.state.leaders.find((candidate) => candidate.id === leaderId);
  if (!leader || leader.factionId !== factionId || leader.status === "dead") {
    reject(reply, "Leader not found.");
    return null;
  }
  return { leader, factionId };
}

function validateLeaderAssignment(
  reply: CommandReply,
  factionId: number,
  leaderClass: LeaderClass,
  assignment: LeaderAssignment | null,
): boolean {
  if (!assignment) return true;
  if (assignment.kind === "government") {
    const position = getGovernmentPositionDefinition(assignment.targetId as GovernmentPositionId);
    if (!position) {
      reject(reply, "Government position not found.");
      return false;
    }
    if (position.requiredClass !== leaderClass) {
      reject(reply, `${formatLeaderClass(leaderClass)} cannot take that government position.`);
      return false;
    }
    return true;
  }
  if (assignment.kind !== "planet" && assignment.kind !== "fleet" && assignment.kind !== "planetMilitary" && assignment.kind !== "groundBattle") {
    reject(reply, "Leader assignment target is invalid.");
    return false;
  }
  if (getLeaderAssignmentClass(assignment.kind) !== leaderClass) {
    reject(reply, `${formatLeaderClass(leaderClass)} cannot take that assignment.`);
    return false;
  }
  if (assignment.kind === "planet" || assignment.kind === "planetMilitary") {
    const planetState = ctx.state.planetStates.find((candidate) => candidate.id === assignment.targetId);
    if (!planetState || !planetState.isHabited) {
      reject(reply, "Planet not found.");
      return false;
    }
    if (planetState.ownerId !== factionId) {
      reject(reply, "You do not own that planet.");
      return false;
    }
    return true;
  }
  if (assignment.kind === "groundBattle") {
    const battle = ctx.state.groundBattles.find((candidate) => candidate.id === assignment.targetId);
    if (!battle || battle.attackerFactionId !== factionId) {
      reject(reply, "Ground battle command not found.");
      return false;
    }
    return true;
  }
  const fleet = ctx.state.fleets.find((candidate) => candidate.id === assignment.targetId);
  if (!fleet) {
    reject(reply, "Fleet not found.");
    return false;
  }
  if (fleet.ownerId !== factionId) {
    reject(reply, "You do not own that fleet.");
    return false;
  }
  return true;
}

function commitLeaderChange(changed: ServerUpdateField[]): void {
  ctx.hasDirtyState = true;
  broadcastUpdates(Array.from(new Set(["leaders", ...changed])));
}

function handleRecruitLeader(reply: CommandReply, perspective: GalaxyPerspective, leaderId: string): void {
  const validated = validateLeaderCommand(reply, perspective, leaderId);
  if (!validated) return;
  const { leader } = validated;
  if (leader.status === "recruited") {
    accept(reply, `${leader.name} is already recruited.`);
    return;
  }
  leader.status = "recruited";
  leader.recruitedAtYear = ctx.state.clock.year;
  leader.assignment = null;
  leader.createdAtYear = Math.min(leader.createdAtYear, ctx.state.clock.year);
  accept(reply, `${leader.name} recruited.`);
  commitLeaderChange([]);
}

function handleAssignLeader(
  reply: CommandReply,
  perspective: GalaxyPerspective,
  leaderId: string,
  assignment: LeaderAssignment | null,
): void {
  const validated = validateLeaderCommand(reply, perspective, leaderId);
  if (!validated) return;
  const { leader, factionId } = validated;
  if (!validateLeaderAssignment(reply, factionId, leader.class, assignment)) return;
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
  if (previousAssignment?.kind === "fleet" || assignment?.kind === "fleet" || previousAssignment?.kind === "planetMilitary" || assignment?.kind === "planetMilitary" || previousAssignment?.kind === "groundBattle" || assignment?.kind === "groundBattle") {
    refreshFactionEconomyDeltas();
    changed.push("fleets", "armies", "groundBattles", "planetStates", "factionEconomies");
  }
  if (previousAssignment?.kind === "government" || assignment?.kind === "government") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("governments", "planetStates", "factionEconomies", "fleets", "technologies");
  }
  accept(reply, assignment ? `${leader.name} assigned.` : `${leader.name} unassigned.`);
  commitLeaderChange(changed);
}

function handleDismissLeader(reply: CommandReply, perspective: GalaxyPerspective, leaderId: string): void {
  const validated = validateLeaderCommand(reply, perspective, leaderId);
  if (!validated) return;
  const { leader } = validated;
  if (leader.status !== "recruited") {
    reject(reply, "Only recruited leaders can be dismissed.");
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
  if (oldAssignment?.kind === "fleet" || oldAssignment?.kind === "planetMilitary" || oldAssignment?.kind === "groundBattle") {
    refreshFactionEconomyDeltas();
    changed.push("fleets", "armies", "groundBattles", "planetStates", "factionEconomies");
  }
  if (oldAssignment?.kind === "government") {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("governments", "planetStates", "factionEconomies", "fleets", "technologies");
  }
  accept(reply, `${leader.name} dismissed.`);
  commitLeaderChange(changed);
}


function dispatchCommand(session: ActionSession, command: GameAction): void {
  if (command.type === "setActiveTechnology") {
    handleSetActiveTechnology(session.reply, session.perspective, command.techId);
    return;
  }
  if (command.type === "setGovernmentLaw") {
    handleSetGovernmentLaw(session.reply, session.perspective, command.lawId, command.optionId);
    return;
  }
  if (command.type === "resolveEvent") {
    handleResolveEvent(session.reply, session.perspective, command.eventId, command.choiceId);
    return;
  }
  if (command.type === "setSpeciesRights") {
    handleSetSpeciesRights(session.reply, session.perspective, command.speciesId, command.rights);
    return;
  }
  if (command.type === "recruitLeader") {
    handleRecruitLeader(session.reply, session.perspective, command.leaderId);
    return;
  }
  if (command.type === "assignLeader") {
    handleAssignLeader(session.reply, session.perspective, command.leaderId, command.assignment);
    return;
  }
  if (command.type === "dismissLeader") {
    handleDismissLeader(session.reply, session.perspective, command.leaderId);
    return;
  }
  if (command.type === "marketTrade") {
    handleMarketTrade(session.reply, session.perspective, command.resourceId, command.tradeType, command.amount);
    return;
  }
  if (command.type === "addMarketAutoTrade") {
    handleAddMarketAutoTrade(session.reply, session.perspective, command.resourceId, command.tradeType, command.amountPerHour);
    return;
  }
  if (command.type === "removeMarketAutoTrade") {
    handleRemoveMarketAutoTrade(session.reply, session.perspective, command.orderId);
    return;
  }
  if (command.type === "sendDiplomacyMessage") {
    handleSendDiplomacyMessage(ctx, session.reply, session.perspective, command.targetFactionId, command.body);
    return;
  }
  if (command.type === "setBorderPolicy") {
    handleSetBorderPolicy(ctx, session.reply, session.perspective, command.targetFactionId, command.policy);
    return;
  }
  if (command.type === "declareWar") {
    handleDeclareWar(ctx, session.reply, session.perspective, command.targetFactionId);
    return;
  }
  if (command.type === "proposeTreaty") {
    handleProposeTreaty(ctx, 
      session.reply,
      session.perspective,
      command.targetFactionId,
      command.articleIds,
      command.durationYears,
      command.replacesTreatyId,
    );
    return;
  }
  if (command.type === "respondDiplomacyProposal") {
    handleRespondDiplomacyProposal(ctx, session.reply, session.perspective, command.proposalId, command.response);
    return;
  }
  if (command.type === "cancelTreaty") {
    handleCancelTreaty(ctx, session.reply, session.perspective, command.treatyId);
    return;
  }
  if (command.type === "cancelDiplomacyProposal") {
    handleCancelDiplomacyProposal(ctx, session.reply, session.perspective, command.proposalId);
    return;
  }
  if (command.type === "proposePeace") {
    handleProposePeace(ctx, session.reply, session.perspective, command.targetFactionId, command.terms);
    return;
  }
  if (command.type === "moveShip" || command.type === "moveFleet") {
    handleMove(
      session.reply,
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
    handleBuild(session.reply, session.perspective, command.fleetId, command.shipId, command.targetStarId);
    return;
  }
  if (command.type === "orbitPlanet") {
    handleOrbitPlanet(session.reply, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "colonizePlanet") {
    handleColonizePlanet(session.reply, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "mergeFleets") {
    handleMergeFleets(session.reply, session.perspective, command.targetFleetId, command.sourceFleetIds);
    return;
  }
  if (command.type === "stopFleet") {
    handleStopFleet(session.reply, session.perspective, command.fleetId);
    return;
  }
  if (command.type === "setFleetDarkMatterBoost") {
    handleSetFleetDarkMatterBoost(session, command.fleetId, command.enabled);
    return;
  }
  if (command.type === "buildDistrict") {
    handleBuildDistrict(session.reply, session.perspective, command.planetId, command.districtKind);
    return;
  }

  if (command.type === "queuePlanetFeatureRemoval") {
    handleQueuePlanetFeatureRemoval(session.reply, session.perspective, command.planetId, command.featureKind);
    return;
  }
  if (command.type === "buildPlanetBuilding") {
    handleBuildPlanetBuilding(
      session.reply,
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
      session.reply,
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
      session.reply,
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
      session.reply,
      session.perspective,
      command.planetId,
      command.area,
      command.slotIndex,
      command.enabled,
      command.subDistrictIndex,
    );
    return;
  }
  if (command.type === "setPlanetJobLock") {
    handleSetPlanetJobLock(
      session.reply,
      session.perspective,
      command.planetId,
      command.job,
      command.locked,
    );
    return;
  }
  if (command.type === "cancelPlanetConstruction") {
    handleCancelPlanetConstruction(session.reply, session.perspective, command.planetId, command.queueItemId);
    return;
  }
  if (command.type === "skipPlanetConstruction") {
    handleSkipPlanetConstruction(session, command.planetId, command.queueItemId);
    return;
  }
  if (command.type === "upgradeStarbase") {
    handleUpgradeStarbase(session.reply, session.perspective, command.starbaseId);
    return;
  }
  if (command.type === "buildStarbaseBuilding") {
    handleBuildStarbaseBuilding(
      session.reply,
      session.perspective,
      command.starbaseId,
      command.slotIndex,
      command.buildingKind,
    );
    return;
  }
  if (command.type === "buildStarbaseShip") {
    handleBuildStarbaseShip(session.reply, session.perspective, command.starbaseId, command.shipKind, command.designId);
    return;
  }
  if (command.type === "buildPlanetShip") {
    handleBuildPlanetShip(
      session.reply,
      session.perspective,
      command.planetId,
      command.shipKind,
      command.designId,
    );
    return;
  }
  if (command.type === "buildPlanetDefenseBuilding") {
    handleBuildPlanetDefenseBuilding(session.reply, session.perspective, command.planetId, command.section, command.slotIndex, command.buildingKind);
    return;
  }
  if (command.type === "upgradePlanetDefenseBuilding") {
    handleUpgradePlanetDefenseBuilding(session.reply, session.perspective, command.planetId, command.section, command.slotIndex);
    return;
  }
  if (command.type === "setPlanetDefenseBuildingEnabled") {
    handleSetPlanetDefenseBuildingEnabled(session.reply, session.perspective, command.planetId, command.section, command.slotIndex, command.enabled);
    return;
  }
  if (command.type === "demolishPlanetDefenseBuilding") {
    handleDemolishPlanetDefenseBuilding(session.reply, session.perspective, command.planetId, command.section, command.slotIndex);
    return;
  }
  if (command.type === "queueArmyRecruitment") {
    handleQueueArmyRecruitment(session.reply, session.perspective, command.yardKind, command.yardId, command.armyTypeId, command.speciesId);
    return;
  }
  if (command.type === "landArmyFleet") {
    handleLandArmyFleet(session.reply, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "embarkPlanetArmies") {
    handleEmbarkPlanetArmies(session.reply, session.perspective, command.planetId, command.armyIds, command.embarkCommander);
    return;
  }
  if (command.type === "beginPlanetInvasion") {
    handleBeginPlanetInvasion(session.reply, session.perspective, command.fleetId, command.planetId);
    return;
  }
  if (command.type === "withdrawGroundBattle") {
    handleWithdrawGroundBattle(session.reply, session.perspective, command.battleId);
    return;
  }
  if (command.type === "cancelShipConstruction") {
    handleCancelShipConstruction(
      session.reply,
      session.perspective,
      command.yardKind,
      command.yardId,
      command.queueItemId,
    );
    return;
  }
  if (command.type === "upgradeShip") {
    handleUpgradeShip(session.reply, session.perspective, command);
    return;
  }
  if (command.type === "saveShipDesign") {
    handleSaveShipDesign(session.reply, session.perspective, command);
    return;
  }
  if (command.type === "decommissionShipDesign") {
    handleDecommissionShipDesign(session.reply, session.perspective, command.designId);
    return;
  }
  if (command.type === "setUrbanSubDistrict") {
    handleSetUrbanSubDistrict(
      session.reply,
      session.perspective,
      command.planetId,
      command.subDistrictIndex,
      command.subDistrictKind,
    );
    return;
  }



  if (command.type === "retreatFleet") {
    handleRetreatFleet(session.reply, session.perspective, command.fleetId);
    return;
  }
  if (command.type === "retreatFleetTo") {
    handleRetreatFleetTo(
      session.reply,
      session.perspective,
      command.fleetId,
      command.targetStarId,
      command.targetSystemPosition,
    );
    return;
  }
  if (command.type === "emergencyRetreatFleetTo") {
    handleEmergencyRetreatFleetTo(session.reply, session.perspective, command.fleetId, command.targetStarId);
    return;
  }
  if (command.type === "attackTarget") {
    handleAttackTarget(session.reply, session.perspective, command.fleetId, command.targetId, command.targetKind);
    return;
  }
  if (command.type === "attackSystem") {
    handleAttackSystem(session.reply, session.perspective, command.fleetId, command.targetStarId);
    return;
  }
  if (command.type === "setFleetCombatSettings") {
    handleSetFleetCombatSettings(session.reply, session.perspective, command.fleetId, command.combatSettings, command.combatStance);
    return;
  }
  if (command.type === "issueFleetTacticalOrder") {
    handleIssueFleetTacticalOrder(session.reply, session.perspective, command);
    return;
  }
  if (command.type === "repairFleet") {
    handleRepairFleet(session.reply, session.perspective, command);
    return;
  }

}

function issueActor<T extends GameActor>(actor: T): T {
  issuedActors.add(actor);
  return Object.freeze(actor);
}
let lastMembershipPollAt = Number.NEGATIVE_INFINITY;
let caretakerMemberships: ReturnType<GameRuntimeAuthPort["listGameMemberships"]> = [];
const recentPlayerActivity = new Map<number, { accountId: number; atMs: number }>();

function recordPlayerActivity(accountId: number, factionId: number): boolean {
  let ownerId: number | null;
  try { ownerId = authStore.getAccountIdForGameFaction(game.id, factionId); }
  catch (error) { console.error(`[GameServer] Failed to verify activity for ${game.id}/${factionId}`, error); return false; }
  if (ownerId !== accountId) return false;
  const atMs = ctx.services.realNow();
  recentPlayerActivity.set(factionId, { accountId, atMs });
  try { authStore.recordGameActivity(game.id, accountId, atMs); }
  catch (error) { console.error(`[GameServer] Failed to record activity for ${game.id}/${factionId}`, error); }
  if (ctx.state.caretakerEpisodes?.[factionId]) {
    delete ctx.state.caretakerEpisodes[factionId];
    ctx.hasDirtyState = true;
  }
  if (ctx.state.passiveEpisodes?.[factionId]) {
    delete ctx.state.passiveEpisodes[factionId];
    ctx.hasDirtyState = true;
  }
  lastMembershipPollAt = Number.NEGATIVE_INFINITY;
  return true;
}

function shipQueueIds(factionId: number): Set<string> {
  return new Set([
    ...ctx.state.starbases.filter((base) => base.ownerId === factionId).flatMap((base) => base.shipQueue.map((item) => item.id)),
    ...ctx.state.planetStates.filter((planet) => planet.ownerId === factionId).flatMap((planet) => planet.defense.shipQueue.map((item) => item.id)),
  ]);
}

function processAiControllers(): Array<{ factionId: number; mode: "caretaker" | "passive"; action: GameAction; outcome: CommandOutcome }> {
  const records: Array<{ factionId: number; mode: "caretaker" | "passive"; action: GameAction; outcome: CommandOutcome }> = [];
  const realNow = ctx.services.realNow();
  if (realNow - lastMembershipPollAt >= 5_000) {
    caretakerMemberships = authStore.listGameMemberships(game.id);
    for (const membership of caretakerMemberships) {
      const recent = recentPlayerActivity.get(membership.factionId);
      if (!recent) continue;
      if (recent.accountId !== membership.accountId || membership.lastActivityAt >= recent.atMs) {
        recentPlayerActivity.delete(membership.factionId);
        continue;
      }
      try { authStore.recordGameActivity(game.id, membership.accountId, recent.atMs); }
      catch (error) { console.error(`[GameServer] Activity retry failed for ${game.id}/${membership.factionId}`, error); }
      membership.lastActivityAt = recent.atMs;
    }
    lastMembershipPollAt = realNow;
  }
  const episodes = ctx.state.caretakerEpisodes ??= {};
  const passiveEpisodes = ctx.state.passiveEpisodes ?? (options.enablePassiveAi ? ctx.state.passiveEpisodes = {} : {});
  const memberships = new Map(caretakerMemberships.map((membership) => [membership.factionId, membership]));
  const currentFactions = new Set(ctx.state.factions.map((faction) => String(faction.id)));
  for (const store of [episodes, passiveEpisodes]) for (const id of Object.keys(store)) {
    if (!currentFactions.has(id)) { delete store[id]; ctx.hasDirtyState = true; }
  }
  for (const faction of ctx.state.factions) {
    const factionId = faction.id;
    const membership = memberships.get(factionId);
    const accountId = membership?.accountId ?? -1;
    const lastActivityAt = membership?.lastActivityAt ?? 0;
    const afkMs = realNow - lastActivityAt;
    const mode = options.enablePassiveAi && (!membership || afkMs >= PASSIVE_AFK_MS) ? "passive"
      : membership && afkMs >= CARETAKER_AFK_MS ? "caretaker" : null;
    const handoff = mode === "passive" ? episodes[factionId] : undefined;
    for (const [store, storeMode] of [[episodes, "caretaker"], [passiveEpisodes, "passive"]] as const) {
      const entry = store[factionId];
      if (entry && (mode !== storeMode || entry.accountId !== accountId || entry.lastActivityAt !== lastActivityAt)) {
        delete store[factionId]; ctx.hasDirtyState = true;
      }
    }
    if (!mode) continue;
    // A claim can arrive between membership polls. Never give an unclaimed bot
    // an extra turn after ownership has already changed in account storage.
    if (!membership && authStore.getAccountIdForGameFaction(game.id, factionId) !== null) {
      if (passiveEpisodes[factionId]) { delete passiveEpisodes[factionId]; ctx.hasDirtyState = true; }
      lastMembershipPollAt = Number.NEGATIVE_INFINITY; continue;
    }
    const previous = mode === "passive" ? passiveEpisodes[factionId] : episodes[factionId];
    if (previous && ctx.state.clock.year + 1e-9 < previous.nextDecisionYear) continue;
    const observation = createAiObservation(ctx, factionId);
    const episode = previous ?? (mode === "passive"
      ? passiveEpisodes[factionId] = createPassiveEpisode(observation, membership ? accountId : null, lastActivityAt, realNow)
      : episodes[factionId] = createCaretakerEpisode(observation, accountId, lastActivityAt, realNow));
    if (!previous && handoff && handoff.accountId === accountId) {
      episode.queuedShips = handoff.queuedShips; episode.reinforcements = handoff.reinforcements; episode.repairOrders = handoff.repairOrders;
      for (const fleet of handoff.fleets) if (!episode.fleets.some((entry) => entry.fleetId === fleet.fleetId)) episode.fleets.push(fleet);
    }
    if (!previous) ctx.hasDirtyState = true;
    episode.nextDecisionYear = ctx.state.clock.year + 1 / GAME_DAYS_PER_YEAR;
    ctx.hasDirtyState = true;
    const actor = issueActor({ kind: "ai" as const, factionId, controllerId: `${mode}-${factionId}` });
    const decisions = mode === "passive" ? decidePassive(observation, passiveEpisodes[factionId]) : decideCaretaker(observation, episode);
    for (const decision of decisions) {
      const queuedBefore = decision.replacementForFleetId ? shipQueueIds(factionId) : null;
      const result = executeGameCommand(actor, decision.action);
      records.push({ factionId, mode, action: decision.action, outcome: result });
      if (result.ok && mode === "passive") recordPassiveAcceptance(passiveEpisodes[factionId], decision.action, ctx.state.clock.year);
      if (result.ok && decision.action.type === "repairFleet") {
        (episode.repairOrders ??= {})[decision.action.constructionFleetId] = {
          targetFleetId: decision.action.targetFleetId, issuedAtYear: ctx.state.clock.year,
        };
        ctx.hasDirtyState = true;
      }
      if (!result.ok || !queuedBefore || !decision.replacementForFleetId) continue;
      const queueId = Array.from(shipQueueIds(factionId)).find((id) => !queuedBefore.has(id));
      if (!queueId || (decision.action.type !== "buildStarbaseShip" && decision.action.type !== "buildPlanetShip")) continue;
      episode.queuedShips[queueId] = {
        fleetId: decision.replacementForFleetId,
        shipKind: decision.action.shipKind,
        designId: decision.action.designId ?? null,
      };
      ctx.hasDirtyState = true;
    }
  }
  return records;
}
function executeGameCommand(actor: GameActor, input: unknown): CommandOutcome {
  if (!issuedActors.has(actor)) return { ok: false, message: "Actor is not authorized for this game." };
  if (actor.kind === "observer") return { ok: false, message: "Observer mode is read-only." };
  if (!ctx.state.factions.some((f) => f.id === actor.factionId)) return { ok: false, message: "Your country is not available." };
  if (actor.kind === "human" && authStore.getAccountIdForGameFaction(game.id, actor.factionId) !== actor.accountId) {
    return { ok: false, message: "You do not control that country." };
  }
  let action: ClientCommand;
  try { action = decodeClientCommand(input); }
  catch (error) { return { ok: false, message: error instanceof Error ? error.message : "Invalid command." }; }
  if (ADAPTER_COMMANDS.has(action.type)) return { ok: false, message: "This command requires a session adapter." };
  if (actor.kind === "ai" && (action.type === "skipPlanetConstruction" || action.type === "setFleetDarkMatterBoost")) {
    return { ok: false, message: "AI cannot use account currency." };
  }
  const session: ActionSession = { actor, perspective: { mode: "faction", factionId: actor.factionId }, reply: {} };
  if (commandEffects) throw new Error("Reentrant gameplay command execution.");
  const previousDeterminism = structuredClone(ctx.state.determinism);
  const previouslyDirty = ctx.hasDirtyState;
  // Replacement orders refund reservations and clear the old order before path
  // planning. Keep their small mutable domain atomic if planning rejects.
  const replacementOrder = ["moveShip", "moveFleet", "buildStarbase", "orbitPlanet", "attackSystem", "mergeFleets"].includes(action.type);
  const previousOrders = replacementOrder ? structuredClone({ fleets: ctx.state.fleets, economies: ctx.state.factionEconomies }) : null;
  // A multi-source merge can immediately reassign ships, armies, and leaders
  // before a later rendezvous fails; those relations belong to the same order.
  const previousMerge = action.type === "mergeFleets" ? structuredClone({ ships: ctx.state.ships, armies: ctx.state.armies, leaders: ctx.state.leaders }) : null;
  const effects: MutationEffects = {};
  const notifications = new Map<number, number>();
  commandEffects = effects;
  accountNotifications = notifications;
  ctx.commandEffects = effects;
  try { dispatchCommand(session, action as GameAction); }
  catch (error) {
    if (!previousOrders) throw error;
    reject(session.reply, error instanceof Error ? error.message : "Order rejected.");
  }
  finally { commandEffects = null; accountNotifications = null; ctx.commandEffects = undefined; }
  const outcome = session.reply.outcome ?? { ok: false as const, message: "Command produced no result." };
  if (outcome.ok) {
    // Discovery already refreshes intelligence in this runtime.
    if (effects.refreshDiscovery) delete effects.refreshIntelligence;
    outcome.effects = { ...effects, dirty: true };
    applyMutationEffects(ctx, outcome.effects);
    for (const [id, balance] of notifications) broadcastAccountDarkMatter(id, balance);
    if (actor.kind === "human") recordPlayerActivity(actor.accountId, actor.factionId);
  }
  if (!outcome.ok) {
    if (previousOrders) { ctx.state.fleets = previousOrders.fleets; ctx.state.factionEconomies = previousOrders.economies; }
    if (previousMerge) { ctx.state.ships = previousMerge.ships; ctx.state.armies = previousMerge.armies; ctx.state.leaders = previousMerge.leaders; }
    ctx.state.determinism = previousDeterminism; ctx.hasDirtyState = previouslyDirty;
  }
  return outcome;
}
function handleCommand(session: ClientSession, command: ClientCommand): void {
  if (command.type === "join") {
    if (!session.sentInitialSnapshot) { sendEvent(session.socket, createSnapshot(ctx, session.perspective)); session.sentInitialSnapshot = true; }
    return;
  }
  if (command.type === "playerActivity") {
    const realNow = ctx.services.realNow();
    if (session.perspective.mode === "faction" && realNow - (session.lastActivitySignalAt ?? Number.NEGATIVE_INFINITY) >= 15_000) {
      session.lastActivitySignalAt = realNow;
      recordPlayerActivity(session.account.id, session.perspective.factionId);
    }
    return;
  }
  if (command.type === "adminCommand") { void handleAdminCommand(session, command); return; }
  if (command.type === "requestDetails") { handleRequestDetails(session.socket, session.perspective, command.scope, command.id, command.knownRevision); return; }
  if (command.type === "subscribeDetails") { handleSubscribeDetails(session, command.scope, command.id, command.knownRevision); return; }
  if (command.type === "unsubscribeDetails") { handleUnsubscribeDetails(session, command.scope, command.id); return; }
  if (!command.requestId) {
    sendEvent(session.socket, { type: "commandResult", ok: false, message: "This command requires a valid request ID." }); return;
  }
  if (command.type === "setSpeedMultiplier") {
    if (session.perspective.mode === "observer" && !authStore.isAdminAccount(session.account)) {
      sendEvent(session.socket, { type: "commandResult", ok: false, message: "Observer mode is read-only.", requestId: command.requestId }); return;
    }
    const multiplier = command.multiplier;
    ctx.state.clock.tickSpeedSeconds = DEFAULT_TICK_SPEED_SECONDS;
    ctx.state.clock.tickSizeDays = Math.max(0.000001, multiplier / 24);
    ctx.state.clock.paused = multiplier <= 0;
    syncClockSpeedFields();
    ctx.state.clock.syncedAtMs = ctx.services.now();
    applyMutationEffects(ctx, { changed: ["clock"] });
    sendEvent(session.socket, { type: "commandResult", ok: true, message: `Speed set to ${ctx.state.clock.speedMultiplier}x.`, requestId: command.requestId }); return;
  }
  const actor = session.perspective.mode === "observer"
    ? issueActor({ kind: "observer" })
    : issueActor({ kind: "human", accountId: session.account.id, factionId: session.perspective.factionId });
  const result = executeGameCommand(actor, command);
  sendEvent(session.socket, { type: "commandResult", ok: result.ok, message: result.message ?? "Command accepted.", requestId: command.requestId });
  if (result.ok) for (const id of new Set(result.effects.planetDetailIds ?? [])) sendPlanetDetails(session.socket, session.perspective, id);
}

function touchMembershipNames(): void {
  lastMembershipPollAt = Number.NEGATIVE_INFINITY;
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
  sendEvent(socket, { type: "serverInfo", message: `Connected to StellarFronts ctx.game ${ctx.game.name}.`, capabilities: ["playerActivity"] });
  sendEvent(socket, {
    type: "accountResources",
    darkMatter: authStore.getPlayerDarkMatter(account.id),
  });
  // Runtime creation can outlive the client's first WebSocket message.
  sendEvent(socket, createSnapshot(ctx, perspective));
  session.sentInitialSnapshot = true;

  socket.on("message", (data) => {
    let requestId: string | undefined;
    try {
      const input: unknown = JSON.parse(String(data));
      if (input && typeof input === "object" && "requestId" in input && typeof input.requestId === "string" && input.requestId.length >= 1 && input.requestId.length <= 128) requestId = input.requestId;
      const command = decodeClientCommand(input);
      handleCommand(session, command);
      flushPlanetDetailRefreshes();
    } catch (error) {
      sendEvent(socket, { type: "commandResult", ok: false, message: error instanceof Error ? error.message : "Invalid command.", requestId });
    }
  });

  socket.on("close", () => {
    ctx.clients.delete(session);
  });
}

function tick(now: number): void {
  const changed = advanceState(now);
  processAiControllers();
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
    lastHeartbeatAt: ctx.services.now(),
    versionId: VERSION_MANIFEST.versionId,
    health: "healthy",
    error: null,
    lastSaveAt: ctx.lastSaveAt || null,
  };
}

async function dispose(message = "Game runtime stopped.", deleteState = false, saveBeforeRelease = true): Promise<void> {
  for (const client of ctx.clients) {
    sendEvent(client.socket, { type: "serverInfo", message });
    client.socket.close(1001, message);
  }
  ctx.clients.clear();
  try {
    if (deleteState) {
      await rm(getGameStateDirectory(ctx.game.id), { recursive: true, force: true });
    } else if (saveBeforeRelease) {
      await saveState(ctx);
    }
  } finally {
    await releaseOwnership(ctx);
  }
}

const runtime: GameRuntime = {
  game: ctx.game,
  attachClient,
  touchMembershipNames,
  tick,
  save: () => saveState(ctx),
  dispose,
  getStats,
};
if (!options.initialState && !options.deferInitialState) ctx.state = createInitialState(ctx);
return {
  context: ctx, runtime, executeGameCommand,
  processCaretakers: processAiControllers, processAiControllers, recordPlayerActivity,
  createAiActor: (factionId, controllerId = `ai-${factionId}`) => issueActor({ kind: "ai", factionId, controllerId }),
  createHumanActor: (accountId, factionId) => issueActor({ kind: "human", accountId, factionId }),
  createObserverActor: () => issueActor({ kind: "observer" }),
};
}

export async function createGameRuntime(game: StoredGame, authStore: GameRuntimeAuthPort): Promise<GameRuntime> {
  const core = createGameCore(game, authStore, { deferInitialState: true, enablePassiveAi: true });
  const ctx = core.context;
  await acquireOwnership(ctx);
  try {
    ctx.state = await loadState(ctx);
    core.runtime.touchMembershipNames();
    ctx.advanceState(ctx.services.now());
    await saveState(ctx);
    return core.runtime;
  } catch (error) {
    await releaseOwnership(ctx);
    throw error;
  }
}
