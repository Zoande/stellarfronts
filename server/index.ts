import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { GALAXY_MAP } from "../src/data/GalaxyMap";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../src/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../src/data/Factions";
import {
  applyPlanetStatesToStars,
  buildPlanetStatesFromStars,
  createPlanetStateFromConfig,
  ensureHabitedHomePlanets,
  generateStarMap,
  normalizeCelestialObjectDetails,
  normalizePlanetStates,
  StarType,
} from "../src/data/StarMap";
import type { PlanetConfig, StarData } from "../src/data/StarMap";
import {
  getSystemFleetStagingPosition,
  getSystemHyperlaneEntryPosition,
  getSystemHyperlaneExitPosition,
  getSystemStarOrbitPosition,
  getSystemStarbasePosition,
  getSystemStarbaseOrbitPosition,
  getPlanetSystemPosition,
  getSystemOrbitLayout,
  DEFAULT_ORBIT_EPOCH_MS,
  SYSTEM_FLEET_Y,
  interpolateSystemPosition,
  normalizeSystemStarbasePosition,
} from "../src/data/SystemCoordinates";
import {
  addResourceCounts,
  applyPopulationGrowthFraction,
  BUILDING_KINDS,
  calculatePlanetCapacity,
  cloneResourceCounts,
  createBuildingConstructionQueueItem,
  createBuildingUpgradeConstructionQueueItem,
  createDistrictConstructionQueueItem,
  createEmptyResourceCounts,
  createInitialFactionEconomyState,
  filterInvalidQueuedBuildingsForSubDistrictChange,
  getEffectiveSpeciesHabitability,
  getBuildingUpgradeTargetLevel,
  getPlanetBuildingKind,
  getPlanetBuildingLevel,
  getQueuedDistrictCount,
  getAmenityNeed,
  hasQueuedBuildingTarget,
  isBuildingCompatible,
  NEW_COLONY_POPULATION,
  PEOPLE_PER_MONTHLY_UNIT,
  progressPlanetConstructionQueue,
  recalculatePlanetStateEconomy,
  RESOURCE_KINDS,
  sumSpeciesPopulation,
  URBAN_SUB_DISTRICT_KINDS,
} from "../src/data/Economy";
import {
  MARKET_AUTO_PRESSURE_FACTOR,
  MARKET_FEE_RATE,
  MARKET_MANUAL_PRESSURE_FACTOR,
  MARKET_PERSISTENT_DECAY_PER_HOUR,
  MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS,
  MARKET_TEMPORARY_DECAY_PER_HOUR,
  MARKET_TRANSACTION_LIMIT,
  PLAYER_INTERNAL_MODIFIER_MAX,
  PLAYER_INTERNAL_MODIFIER_MIN,
  calculateMarketPressureDelta,
  createInitialMarketState,
  normalizeMarketState,
  recomputeMarketResourcePrice,
  trimMarketPriceSnapshots,
} from "../src/data/Market";
import {
  calculateStarbaseEconomy,
  countStarbaseShipyards,
  createStarbaseBuildingQueueItem,
  createStarbaseShipQueueItem,
  createStarbaseUpgradeQueueItem,
  createEmptyStarbaseSlots,
  hasQueuedStarbaseBuildingTarget,
  isStarbaseBuildingKind,
  isStarbaseShipKind,
  progressStarbaseConstructionQueue,
  progressStarbaseShipQueue,
  STARBASE_LEVEL_DEFINITIONS,
  STARBASE_SHIP_DEFINITIONS,
  STARBASE_SHIP_KINDS,
} from "../src/data/Starbase";
import type {
  StarbaseBuildingKind,
  StarbaseLevel,
  StarbaseShipKind,
  StarbaseShipQueueItem,
  WeaponMountDefinition,
} from "../src/data/Starbase";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  getShipDesignLayout,
  isKnownShipKind,
  normalizeShipDesign,
  SHIP_MODULE_DEFINITIONS,
  SHIP_HULL_DEFINITIONS,
} from "../src/data/ShipDesigns";
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
import {
  DEFAULT_SPECIES_RIGHTS,
  HUMAN_SPECIES_ID,
  createDefaultSpeciesForFaction,
  createDefaultSpeciesRightsState,
  createSpeciesFromSetup,
  getLegalSpeciesRightsOptions,
  normalizeSpeciesRights,
  normalizeSpeciesRightsForLaws,
  normalizeSpeciesState,
} from "../src/data/Species";
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
import {
  type CombatStance,
  type CombatTargetKind,
  type FleetBehavior,
  type FleetChasePolicy,
  type FleetRetreatPolicy,
  type FleetTacticalOrderType,
} from "../src/game/CombatTypes";
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
} from "./combat";
import {
  GAME_DAYS_PER_QUARTER,
  GAME_DAYS_PER_WEEK,
  GAME_DAYS_PER_YEAR,
  GAME_HOURS_PER_MONTH,
  GAME_HOURS_PER_YEAR,
  GAME_START_YEAR,
  REAL_MS_PER_GAME_DAY,
  REAL_MS_PER_GAME_HOUR,
  elapsedHoursToGameYear,
  gameYearToHourIndex,
  gameYearToMonthIndex,
  gameYearToWeekIndex,
} from "../src/game/GameTime";
import { getFleetTacticalRadius } from "../src/game/tacticalFormation";
import { computeFleetPower } from "../src/game/combatPower";
import {
  ACTIVE_RESEARCH_FRACTION,
  BASELINE_RESEARCH_PER_HOUR,
  createEmptyTechProgress,
  DEFAULT_COMPLETED_TECH_IDS,
  evaluateTechnologyResearch,
  FactionTechState,
  FactionTechnologyView,
  getCompletedTechnologyEffects,
  getFirstRequiredTechName,
  getMissingPrerequisites,
  getPassiveProgressCap,
  getRequiredTechIdsForBuilding,
  getRequiredTechIdsForBuildingLevel,
  getRequiredTechIdsForShipHull,
  getRequiredTechIdsForShipModule,
  getRequiredTechIdsForShipSection,
  getRequiredTechIdsForStarbaseBuilding,
  isTechnologyAvailable,
  isTechnologyCompleted,
  isUnlockedByAnyRequiredTech,
  normalizeFactionTechState,
  PASSIVE_RESEARCH_FRACTION,
  ResearchContext,
  TechId,
  TECHNOLOGY_BY_ID,
  TECHNOLOGY_DEFINITIONS,
} from "../src/data/Technology";
import {
  calculateLeaderLevel,
  createInitialLeaders,
  createLegendaryLeaderCandidate,
  formatLeaderClass,
  getLeaderAssignmentClass,
  getLeaderTraitDefinition,
  LEADER_POOL_PER_CLASS,
  normalizeLeadersForFactions,
  refreshLeaderPool,
} from "../src/data/Leaders";
import type { LeaderAssignment, LeaderClass, LeaderFleetEffects, LeaderState } from "../src/data/Leaders";
import type { GameEffect, FactionModifierState } from "../src/data/GameEffects";
import {
  getEventDefinition,
  LEADER_OFFER_EVENT_ID,
  LOST_IN_TRANSIT_EVENT_ID,
} from "../src/data/Events";
import type { ActiveEvent } from "../src/data/Events";
import {
  SHORTAGE_SITUATION_ID,
  getSituationDefinition,
  situationInstanceId,
} from "../src/data/Situations";
import type { ActiveSituation } from "../src/data/Situations";
import {
  buildSystemDetailPayload,
  createSystemDetailRevision,
} from "./system-view";
import {
  createInitialGovernmentState,
  createInitialGovernmentStates,
  GOVERNMENT_LAW_BY_ID,
  getGovernmentLawOption,
  getGovernmentPositionDefinition,
  getSelectedGovernmentLawOptions,
  normalizeGovernmentStatesForFactions,
} from "../src/data/Government";
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
import {
  ADMIN_COMMAND_DEFINITIONS,
  formatAdminCommandHelp,
  getAdminCommandDefinition,
  parseAdminCommand,
} from "../src/game/AdminCommands";
import type { AdminCommandContext, AdminCommandResult, AdminCommandRow, ParsedAdminCommand } from "../src/game/AdminCommands";
import type { AuthAccount, DevGameRuntimeRow, DevGameRuntimeStats } from "../src/auth/types";
import { authStore, parseSessionTokenFromCookie } from "./auth-store";
import type { StoredGame } from "./auth-store";
import { getGameStateDirectory, getGameStatePath } from "./game-state-path";
import { VERSION_MANIFEST, canMigrateFromSchema } from "./versionManifest";
import {
  DISCOVERY_JUMPS,
  DEPART_DURATION_MS,
  JUMP_DURATION_MS,
  ARRIVE_DURATION_MS,
  BUILD_DURATION_MS,
  SAVE_INTERVAL_MS,
  SERVER_TICK_INTERVAL_MS,
  RUNTIME_STATS_INTERVAL_MS,
  RUNTIME_CATALOG_SYNC_INTERVAL_MS,
  DEFAULT_TICK_SIZE_DAYS,
  DEFAULT_TICK_SPEED_SECONDS,
  DEFAULT_SHIP_SPEED,
  STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY,
  STARBASE_HULL_REPAIR_FRACTION_PER_DAY,
  STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT,
  STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT,
  STARBASE_REPAIR_ENERGY_COST_PER_POINT,
  EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION,
  EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION,
  EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION,
  EMERGENCY_RETREAT_SHIP_LOSS_CHANCE,
  EMERGENCY_RETREAT_MIN_MIA_DAYS,
  EMERGENCY_RETREAT_DISTANCE_MIA_DIVISOR,
  SYSTEM_FLEET_SPEED_UNITS_PER_DAY,
  SYSTEM_PLANET_ORBIT_DISTANCE,
  STARBASE_TACTICAL_RADIUS,
  RECENT_COMBAT_CONTACT_HISTORY,
  FLEET_GUARD_RADIUS,
  FLEET_EVADE_DISTANCE,
  FLEET_SOFT_SEPARATION_FACTOR,
  FLEET_RETREAT_THRESHOLDS,
  MIGRATION_BASE_WEEKLY_RATE,
  MIGRATION_PRESSURE_WEEKLY_RATE,
  MIGRATION_FOREIGN_MET_MULTIPLIER,
  MIGRATION_FOREIGN_OPEN_BORDER_MULTIPLIER,
  MIGRATION_PACT_MULTIPLIER,
  MIGRATION_MIN_SOURCE_POPULATION,
  MIGRATION_MIN_FLOW_POPULATION,
  MIGRATION_DESTINATION_CAPACITY_BUFFER,
  MIGRATION_DISTANCE_DECAY,
  MIGRATION_DISTANCE_FLOOR,
  MIGRATION_DISTANCE_MAX_JUMPS,
  SHORTAGE_GRACE_MONTHS,
  SHORTAGE_PROGRESS_RISE_PER_DAY,
  SHORTAGE_PROGRESS_FALL_PER_DAY,
  LOST_IN_TRANSIT_CHANCE_PER_DAY,
  LOST_IN_TRANSIT_MIN_DAYS,
  LOST_IN_TRANSIT_MAX_DAYS,
  LEADER_OFFER_CHANCE_PER_DAY,
} from "./game/constants";
import type {
  GameFleet,
  GameShip,
  GameState,
  DetailSubscription,
  ClientSession,
  GameRuntime,
  RuntimeContext,
} from "./game/types";
import {
  FLEET_FORMATIONS,
  COMBAT_STANCES,
  FLEET_BEHAVIORS,
  FLEET_CHASE_POLICIES,
  FLEET_RETREAT_POLICIES,
  FLEET_TACTICAL_ORDER_TYPES,
  isFleetFormation,
  isCombatStance,
  normalizeCombatStance,
  isFleetBehavior,
  isFleetChasePolicy,
  isFleetRetreatPolicy,
  isFleetTacticalOrderType,
} from "./game/validators";
import { computeSpeedMultiplier, normalizeClock } from "./game/clock";
import { saveState, acquireOwnership, releaseOwnership } from "./game/persistence";
import {
  computeShortageSeverity,
  getFactionShortageSeverities,
  getFactionShortagePlanetModifiers,
  getFactionFleetShortageEffects,
  getLeaderDayIndex,
  getLeaderLevelScale,
  getAssignedLeader,
  getFactionGovernment,
  getAssignedGovernmentLeader,
  getGovernmentEffectInstances,
  getGovernmentPositionDefinitionMap,
  getGovernmentPlanetModifiers,
  getGovernmentFleetEffects,
  getGovernmentResearchSpeedMultiplier,
  getGovernmentResearchAllocation,
  getPlanetLeaderModifiers,
  getFleetLeaderEffects,
  getFleetSpeedMultiplier,
  getFleetAttackMultiplier,
  getFleetShieldMultiplier,
  getActiveFactionPlanetModifiers,
  getSpeciesRightsForFaction,
  getPlanetSpeciesContext,
  getPlanetDistrictLimitsFromState,
  getFactionSpeciesRightsState,
  haveFactionsMet,
  getFactionTechnology,
  getTechnologyPlanetModifiers,
  getPlanetTechnologyModifiers,
  getFactionStarbaseShipBuildSpeedMultiplier,
  getSpeciesLawSelections,
  getEmpireSpeciesIds,
  getPlanetState,
  getPlanetConfig,
  canAccessStar,
  canAccessPlanet,
  canAccessStarbase,
} from "./game/state-queries";
import type { GovernmentEffectInstance } from "./game/state-queries";
import {
  getShipDefinition,
  findShipDesign,
  findShipDesignById,
  getNewestActiveShipDesign,
  resolveShipDesign,
  getShipDesignForShip,
} from "./game/ship-designs";
import {
  calculateFactionResourceFlow,
  calculateFactionMonthlyDelta,
  calculatePlayerMarketQuote,
  refreshFactionEconomyDeltas as applyFactionEconomyDeltas,
  getMarketPlayerStats,
  getReadonlyMarketPlayerStats,
  getMarketResourceState,
  getMarketPriceHistory,
  getMarketTrend,
  appendMarketPriceSnapshot,
  recordMarketTransaction,
  applyMarketTradePressure,
} from "./game/economy-market";
import type { FactionResourceFlow, PlayerMarketQuote } from "./game/economy-market";
import {
  refreshDiscovery as applyRefreshDiscovery,
  getVisibleSet,
  getKnownSet,
  isFleetVisible,
} from "./game/visibility";
import {
  createVisibleStars,
  toOwnershipEntries,
  createRevision,
  createVisibleState,
  createSnapshot,
  createUpdate,
} from "./game/snapshot";
import { createDetailPayload } from "./game/detail-payloads";
import {
  calculateShipUpgradePlan,
  applyShipDesignToShip,
  createShipFromDesign,
  createShip,
  createFleet,
  syncStarbaseCombatHealth,
  normalizeFleetRetreatState,
  normalizeSystemPositionValue,
  normalizeFleetRetreatDestination,
  createDefaultFleetCombatSettings,
  normalizeFleetTacticalOrder,
} from "./game/fleet-factory";
import {
  processEconomyHours,
  processMarketTicks,
  processShipShortageEffects,
  processPlanetConstruction,
  processStarbaseConstruction,
  processStarbaseRepairs,
  processStarbaseShipQueues,
} from "./game/economy-tick";
import { initServer } from "./game/server-bootstrap";
import {
  clamp,
  roundTinyPressure,
  systemCenterPosition,
  cloneSystemPosition,
  movePointToward,
  computeJumpDistances,
  getMigrationDistanceMultiplier,
  getMaxWeaponSystemRange,
  getMountRangeSummary,
  gameDaysToYears,
  scaleResourceCounts,
} from "./game/pure-helpers";
import {
  nextEventInstanceId,
  probabilityOverDays,
  resolveEventTokens,
  fleetDisplayName,
  queueFactionEvent,
  addFactionModifierState,
  expireFactionModifiers,
  generatePowerfulLeaderCandidate,
  buildLeaderOfferContext,
  spawnLeaderFromEffect,
  sendFleetMissing,
  applyGameEffects,
  fireSituationThresholds,
  processRandomEvents,
  resolveActiveEvent,
  processEventTimeouts,
} from "./game/leaders-events";
import {
  processPopulationWeeks,
  processLeaderDays,
} from "./game/population";
import {
  getFactionResearchPerHour,
  applyTechnologyResearchForFaction,
  createFactionTechnologyView,
  getVisibleTechnologyViews,
  isShipDesignUnlockedForFaction,
  getShipDesignMissingTechnologyName,
  completeTechnology,
  ensureActiveTechnology,
} from "./game/research";
import {
  phaseDuration, phaseDurationDays, phaseDurationYears,
  distance3, isSameSystemPosition,
  systemTravelDays, hyperlaneTravelDays,
  getFleetAuthoritativeSystemPosition,
  createStarOrbitTarget, createStarbaseOrbitTarget, getDefaultMoveDestination,
  clearFleetOrbit, clearFleetCombatIntent, prepareFleetForReplacementOrder,
  applyFleetOrbitTarget, isFleetOrbitingStar,
  routeIsAllowed, canEnterSystem, findRoute,
  createFleetMovementPlan,
  startPositionOrder, startMoveOrder, startAttackSystemOrder, startBuildOrder, startOrbitOrder,
  completeMergeSourceFleet, cancelMergeSourceOrder, startMergeSourceOrder, isMergeSourceEligible, advanceMergeSourceFleet,
  completeFleetOrder, advanceFleet, processMissingInActionFleets,
  isHostileOwner, resetFleetTacticalMovement, findNearestFriendlyStarbase,
  resolveFleetRetreatDestination, computeRetreatRoute, startFleetRetreat,
  getFleetLivingShips, getFleetHealthRatio, updateFleetTacticalProfile,
  effectiveActorDistance, getActorValue, isFleetAvailableForContinuousCombat, buildContinuousCombatActors,
  actorIsInFleetWeaponRange, selectFleetCombatTarget, selectStarbaseCombatTarget,
  desiredEffectiveRangeForFleet, positionAtRangeFromTarget, positionAtEffectiveRangeFromTarget,
  retreatFleetByDoctrine, updateFleetCombatMovement, applyFleetSoftSeparation,
  getShipEvasionForFleetCombat, chooseTargetShip,
  decrementWeaponCooldowns, recordContinuousCombatContact, captureStarbase,
  fireFleetWeaponsAtTarget, fireStarbaseWeaponsAtTarget, processContinuousFleetCombat,
  applyWeaponHit, applyFleetAttackShortagePenalty, getStarbaseWeaponMounts, getFleetWeaponMounts,
  removeDestroyedShips, clearFleetMovementNow,
} from "./game/fleet-combat";
import type { ContinuousCombatActor } from "./game/fleet-combat";

// Probe mode: the orchestrator runs each worktree with `--print-version` to read
// its committed identity (protocol/schema/migratesFrom) without booting a server.
if (process.argv.includes("--print-version")) {
  process.stdout.write(`${JSON.stringify(VERSION_MANIFEST)}\n`);
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
const SF_VERSION_ID = VERSION_MANIFEST.versionId;
const GAME_SERVER_STARTED_AT = Date.now();



async function createGameRuntime(game: StoredGame): Promise<GameRuntime> {
const ctx: RuntimeContext = {
  game,
  statePath: getGameStatePath(game.id),
  state: undefined as unknown as GameState,
  clients: new Set<ClientSession>(),
  pendingPlanetDetailRefreshes: new Set<string>(),
  hasDirtyState: false,
  lastSaveAt: 0,
  runtimeIdCounter: 0,
  eventInstanceSeq: 0,
  setFleetPhase, // hoisted function declaration â€” safe to reference here
  recalculatePlanetEconomies, // hoisted
  refreshFactionEconomyDeltas, // hoisted
  queuePlanetDetailRefresh, // hoisted
  refreshDiscovery: () => refreshDiscovery(), // hoisted â€” wrapper needed for default param
  syncSystemOwnershipFromStarbases: () => syncSystemOwnershipFromStarbases(), // hoisted
  syncFleetMembership: () => syncFleetMembership(ctx.state), // hoisted â€” thin wrapper
  createRuntimeId, // hoisted
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

function systemExitPosition(fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">) {
  const fromStar = ctx.state.stars[fleet.currentStarId];
  const toStarId = fleet.route[fleet.routeIndex + 1];
  const toStar = Number.isInteger(toStarId) ? ctx.state.stars[toStarId] : undefined;
  return fromStar && toStar ? getSystemHyperlaneExitPosition(fromStar, toStar) : getSystemFleetStagingPosition();
}

function systemEntryPosition(fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">) {
  const toStar = ctx.state.stars[fleet.currentStarId];
  const fromStarId = fleet.route[fleet.routeIndex - 1];
  const fromStar = Number.isInteger(fromStarId) ? ctx.state.stars[fromStarId] : undefined;
  return fromStar && toStar ? getSystemHyperlaneEntryPosition(fromStar, toStar) : getSystemFleetStagingPosition();
}

function getFactionFoundingSpeciesId(factionId: number): SpeciesId {
  return `species-faction-${factionId}`;
}

function getFallbackHumanSpecies(): SpeciesState {
  return {
    id: HUMAN_SPECIES_ID,
    name: "Human",
    archetypeId: "humanoid",
    traitIds: [],
    originFactionId: null,
  };
}

function ensureFactionFoundingSpeciesIds(factions: FactionInfo[]): boolean {
  let changed = false;
  for (const faction of factions) {
    const expected = getFactionFoundingSpeciesId(faction.id);
    if (faction.foundingSpeciesId === expected) continue;
    faction.foundingSpeciesId = expected;
    changed = true;
  }
  return changed;
}

function normalizeSpeciesForFactions(factions: FactionInfo[], rawSpecies: unknown): SpeciesState[] {
  ensureFactionFoundingSpeciesIds(factions);
  const rawById = new Map<string, Partial<SpeciesState>>();
  if (Array.isArray(rawSpecies)) {
    for (const raw of rawSpecies) {
      const candidate = raw as Partial<SpeciesState>;
      if (typeof candidate?.id !== "string" || !candidate.id.trim()) continue;
      rawById.set(candidate.id.trim(), candidate);
    }
  }

  const usedIds = new Set<SpeciesId>();
  const species: SpeciesState[] = [];
  const human = normalizeSpeciesState(rawById.get(HUMAN_SPECIES_ID), getFallbackHumanSpecies());
  species.push(human);
  usedIds.add(human.id);

  for (const faction of factions) {
    const fallback = createDefaultSpeciesForFaction(faction.id, faction.name);
    const normalized = normalizeSpeciesState(rawById.get(fallback.id), fallback);
    normalized.id = fallback.id;
    normalized.originFactionId = faction.id;
    faction.foundingSpeciesId = normalized.id;
    if (usedIds.has(normalized.id)) continue;
    usedIds.add(normalized.id);
    species.push(normalized);
  }

  for (const [speciesId, raw] of rawById) {
    if (usedIds.has(speciesId)) continue;
    const fallback: SpeciesState = {
      id: speciesId,
      name: typeof raw.name === "string" && raw.name.trim() ? raw.name : speciesId,
      archetypeId: "humanoid",
      traitIds: [],
      originFactionId: Number.isInteger(raw.originFactionId) ? Number(raw.originFactionId) : null,
    };
    const normalized = normalizeSpeciesState(raw, fallback);
    usedIds.add(normalized.id);
    species.push(normalized);
  }

  return species;
}

function normalizeSpeciesRightsForFactions(nextState: GameState, rawRights: unknown = nextState.speciesRights): FactionSpeciesRightsState[] {
  const rawByFaction = new Map<number, FactionSpeciesRightsState>();
  if (Array.isArray(rawRights)) {
    for (const raw of rawRights) {
      const candidate = raw as Partial<FactionSpeciesRightsState>;
      if (!Number.isInteger(candidate?.factionId)) continue;
      rawByFaction.set(Number(candidate.factionId), {
        factionId: Number(candidate.factionId),
        rightsBySpeciesId: candidate.rightsBySpeciesId ?? {},
      });
    }
  }
  const speciesIds = nextState.species.map((species) => species.id);
  return nextState.factions.map((faction) => {
    const existing = rawByFaction.get(faction.id) ?? createDefaultSpeciesRightsState(faction.id, speciesIds);
    const laws = getSpeciesLawSelections(nextState, faction.id);
    const rightsBySpeciesId: Record<SpeciesId, SpeciesRights> = {};
    for (const speciesId of speciesIds) {
      rightsBySpeciesId[speciesId] = normalizeSpeciesRightsForLaws(existing.rightsBySpeciesId?.[speciesId], laws);
    }
    return { factionId: faction.id, rightsBySpeciesId };
  });
}

function assignFoundingSpeciesToOwnedPops(nextState: GameState): boolean {
  let changed = false;
  const factionById = new Map(nextState.factions.map((faction) => [faction.id, faction]));
  nextState.planetStates = nextState.planetStates.map((planetState) => {
    if (!planetState.isHabited) return planetState;
    const ownerId = nextState.starOwnership[planetState.starId] ?? -1;
    const faction = factionById.get(ownerId);
    const foundingSpeciesId = faction?.foundingSpeciesId ?? (faction ? getFactionFoundingSpeciesId(faction.id) : null);
    if (!foundingSpeciesId) return planetState;

    const source = planetState.speciesPopulations?.length
      ? planetState.speciesPopulations
      : planetState.population > 0
        ? [{ speciesId: foundingSpeciesId, population: planetState.population }]
        : [];
    const bySpecies = new Map<SpeciesId, number>();
    for (const entry of source) {
      const nextSpeciesId = entry.speciesId === HUMAN_SPECIES_ID ? foundingSpeciesId : entry.speciesId;
      if (nextSpeciesId !== entry.speciesId) changed = true;
      bySpecies.set(nextSpeciesId, (bySpecies.get(nextSpeciesId) ?? 0) + Math.max(0, Math.floor(entry.population)));
    }
    const speciesPopulations = Array.from(bySpecies.entries())
      .filter(([, population]) => population > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([speciesId, population]) => ({ speciesId, population }));
    const population = sumSpeciesPopulation(speciesPopulations);
    if (population !== planetState.population || JSON.stringify(speciesPopulations) !== JSON.stringify(planetState.speciesPopulations ?? [])) {
      changed = true;
      return { ...planetState, population, speciesPopulations };
    }
    return planetState;
  });
  return changed;
}

function recalculatePlanetEconomies(nextState = ctx.state): void {
  nextState.planetStates = nextState.planetStates.map((planetState) => (
    recalculatePlanetStateEconomy(
      planetState,
      getPlanetDistrictLimitsFromState(nextState, planetState),
      getPlanetTechnologyModifiers(nextState, planetState),
      getPlanetSpeciesContext(nextState, planetState),
    )
  ));
  applyPlanetStatesToStars(nextState.stars, nextState.planetStates);
}

function refreshFactionEconomyDeltas(nextState = ctx.state): void {
  applyFactionEconomyDeltas(nextState);
}

function addInferredTechIdsFromBuilding(techIds: Set<TechId>, buildingKind: BuildingKind, level = 1): void {
  for (const techId of getRequiredTechIdsForBuilding(buildingKind)) techIds.add(techId);
  for (let buildingLevel = 2; buildingLevel <= level; buildingLevel += 1) {
    for (const techId of getRequiredTechIdsForBuildingLevel(buildingKind, buildingLevel)) techIds.add(techId);
  }
}

function addInferredTechIdsFromStarbaseBuilding(techIds: Set<TechId>, buildingKind: StarbaseBuildingKind): void {
  for (const techId of getRequiredTechIdsForStarbaseBuilding(buildingKind)) techIds.add(techId);
}

function addInferredTechIdsFromShipDesign(techIds: Set<TechId>, design: ShipDesign): void {
  for (const techId of getRequiredTechIdsForShipHull(design.shipKind)) techIds.add(techId);
  for (const moduleId of design.weaponSectionModuleIds) {
    for (const techId of getRequiredTechIdsForShipSection(moduleId)) techIds.add(techId);
  }
  for (const moduleId of design.defenseSectionModuleIds) {
    for (const techId of getRequiredTechIdsForShipSection(moduleId)) techIds.add(techId);
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    for (const techId of getRequiredTechIdsForShipModule(moduleId)) techIds.add(techId);
  }
}

function inferCompletedTechIdsFromExistingAssets(nextState: GameState, factionId: number): TechId[] {
  const techIds = new Set<TechId>();
  for (const planetState of nextState.planetStates) {
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const building of Object.values(planetState.buildings).flat()) {
      const buildingKind = getPlanetBuildingKind(building);
      if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind, getPlanetBuildingLevel(building));
    }
    for (const subDistrict of planetState.urbanSubDistricts) {
      for (const building of subDistrict.buildings) {
        const buildingKind = getPlanetBuildingKind(building);
        if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind, getPlanetBuildingLevel(building));
      }
    }
    for (const queued of planetState.constructionQueue) {
      if (queued.buildingKind) addInferredTechIdsFromBuilding(techIds, queued.buildingKind);
    }
  }
  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId) continue;
    for (const buildingKind of starbase.buildingSlots) {
      if (buildingKind) addInferredTechIdsFromStarbaseBuilding(techIds, buildingKind);
    }
    for (const queued of starbase.constructionQueue) {
      if (queued.buildingKind) addInferredTechIdsFromStarbaseBuilding(techIds, queued.buildingKind);
    }
  }
  for (const design of nextState.shipDesigns) {
    if (design.ownerId === factionId) addInferredTechIdsFromShipDesign(techIds, design);
  }
  return Array.from(techIds);
}

function normalizeFactionTechnologies(nextState: Omit<GameState, "factionTechnologies"> & { factionTechnologies?: FactionTechState[] }): FactionTechState[] {
  const byFaction = new Map((nextState.factionTechnologies ?? []).map((techState) => [techState.factionId, techState]));
  return nextState.factions.map((faction) => {
    const raw = byFaction.get(faction.id);
    const inferred = inferCompletedTechIdsFromExistingAssets(nextState as GameState, faction.id);
    return normalizeFactionTechState(faction.id, raw, inferred);
  });
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

function normalizeResourceCounts(counts?: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...counts,
  };
}

function normalizeStarbase(starbase: Partial<ServerStarbase> & Pick<ServerStarbase, "id" | "ownerId" | "starId">): ServerStarbase {
  const level = (starbase.level ?? "outpost") as StarbaseLevel;
  const combat = STARBASE_LEVEL_DEFINITIONS[level]?.combat ?? STARBASE_LEVEL_DEFINITIONS.outpost.combat;
  const maxShieldValue = Number(starbase.maxShield);
  const maxArmorValue = Number(starbase.maxArmor);
  const maxHullValue = Number(starbase.maxHull);
  const maxShield = Math.max(0, Number.isFinite(maxShieldValue) ? maxShieldValue : combat.maxShield);
  const maxArmor = Math.max(0, Number.isFinite(maxArmorValue) ? maxArmorValue : combat.maxArmor);
  const maxHull = Math.max(1, Number.isFinite(maxHullValue) ? maxHullValue : combat.maxHull);
  const shieldValue = Number(starbase.shield);
  const armorValue = Number(starbase.armor);
  const hullValue = Number(starbase.hull);
  const buildingSlots = Array.isArray(starbase.buildingSlots)
    ? createEmptyStarbaseSlots().map((_, index) => {
      const building = starbase.buildingSlots?.[index] ?? null;
      return building && isStarbaseBuildingKind(building) ? building : null;
    })
    : createEmptyStarbaseSlots();
  return {
    id: starbase.id,
    ownerId: starbase.ownerId,
    starId: starbase.starId,
    systemPosition: normalizeSystemStarbasePosition(starbase.systemPosition ?? getSystemStarbasePosition()),
    status: starbase.status ?? "online",
    buildProgress: starbase.buildProgress ?? 1,
    shield: Math.max(0, Math.min(maxShield, Number.isFinite(shieldValue) ? shieldValue : maxShield)),
    maxShield,
    armor: Math.max(0, Math.min(maxArmor, Number.isFinite(armorValue) ? armorValue : maxArmor)),
    maxArmor,
    hull: Math.max(0, Math.min(maxHull, Number.isFinite(hullValue) ? hullValue : maxHull)),
    maxHull,
    weaponCooldowns: typeof starbase.weaponCooldowns === "object" && starbase.weaponCooldowns
      ? Object.fromEntries(Object.entries(starbase.weaponCooldowns).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
      : {},
    lastShieldDamageAtYear: starbase.lastShieldDamageAtYear ?? null,
    level,
    economy: calculateStarbaseEconomy(level, buildingSlots),
    buildingSlots,
    constructionQueue: Array.isArray(starbase.constructionQueue)
      ? starbase.constructionQueue.map((item) => ({
        ...item,
        cost: normalizeResourceCounts(item.cost),
      }))
      : [],
    shipQueue: Array.isArray(starbase.shipQueue)
      ? starbase.shipQueue
        .filter((item) => item.shipKind && isStarbaseShipKind(item.shipKind))
        .map((item) => {
          const totalDays = Math.max(1, Number(item.totalDays) || 1);
          const cost = normalizeResourceCounts(item.cost);
          const fallbackUpfrontCost = scaleResourceCounts(cost, 0.05);
          const upfrontCost = normalizeResourceCounts(item.upfrontCost ?? fallbackUpfrontCost);
          const fallbackDaily = scaleResourceCounts(addResourceCounts(cost, scaleResourceCounts(upfrontCost, -1)), 1 / totalDays);
          const resourceUpkeepPerDay = normalizeResourceCounts(item.resourceUpkeepPerDay ?? fallbackDaily);
          return {
            ...item,
            kind: item.kind === "upgrade" ? "upgrade" : "build",
            designId: typeof item.designId === "string" ? item.designId : null,
            targetDesignId: typeof item.targetDesignId === "string" ? item.targetDesignId : null,
            shipId: typeof item.shipId === "string" ? item.shipId : null,
            cost,
            upfrontCost,
            resourceUpkeepPerDay,
            remainingDays: Math.max(0, Number(item.remainingDays) || 0),
            totalDays,
            alloyUpkeepPerDay: Math.max(0, Number(item.alloyUpkeepPerDay) || resourceUpkeepPerDay.alloys),
            crewDemand: Math.max(0, Number(item.crewDemand) || 0),
          };
        })
      : [],
  };
}

function normalizeShip(
  ship: Partial<ServerShip> & { id: string; ownerId: number },
  fallbackFleetId: string,
  shipDesigns: ShipDesign[],
): GameShip {
  const definition = getShipDefinition(ship.shipKind);
  const shipKind = definition.kind;
  const ownerId = Number.isInteger(ship.ownerId) ? ship.ownerId : 0;
  const design = resolveShipDesign(shipDesigns, ownerId, shipKind, ship.designId);
  const explicitTarget = typeof ship.targetDesignId === "string"
    ? findShipDesignById(shipDesigns, ownerId, shipKind, ship.targetDesignId, false)
    : null;
  const fallbackTarget = design.status === "decommissioned"
    ? getNewestActiveShipDesign(shipDesigns, ownerId, shipKind)
    : null;
  const targetDesign = explicitTarget ?? fallbackTarget;
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  const maxHull = Math.max(1, Number(ship.maxHull ?? ship.maxHp) || combat.maxHull);
  const maxShield = Math.max(0, Number(ship.maxShield) || combat.maxShield);
  const maxArmor = Math.max(0, Number(ship.maxArmor) || combat.maxArmor);
  const hull = Math.max(0, Math.min(maxHull, Number(ship.hull ?? ship.hp) || maxHull));
  const shield = Math.max(0, Math.min(maxShield, Number(ship.shield) || maxShield));
  const armor = Math.max(0, Math.min(maxArmor, Number(ship.armor) || maxArmor));
  return {
    id: ship.id,
    ownerId,
    fleetId: ship.fleetId || fallbackFleetId,
    shipKind,
    designId: design.id,
    targetDesignId: targetDesign && targetDesign.id !== design.id ? targetDesign.id : null,
    speed: Math.max(0.05, Number(ship.speed) || stats.speed),
    hp: hull,
    maxHp: maxHull,
    shield,
    maxShield,
    armor,
    maxArmor,
    hull,
    maxHull,
    weaponCooldowns: typeof ship.weaponCooldowns === "object" && ship.weaponCooldowns
      ? Object.fromEntries(Object.entries(ship.weaponCooldowns).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]))
      : {},
  };
}

function normalizeFleet(
  fleet: Partial<ServerFleet> & {
    id: string;
    ownerId: number;
    currentStarId: number;
    phaseElapsedMs?: number;
  },
  normalizeCtx: typeof ctx = ctx,
): GameFleet {
  const currentStarId = Number.isInteger(fleet.currentStarId) ? fleet.currentStarId : 0;
  const phase = (fleet.phase ?? "idle") as ShipTransitPhase;
  const targetStarId = Number.isInteger(fleet.targetStarId) ? Number(fleet.targetStarId) : null;
  const formation = isFleetFormation(fleet.formation) ? fleet.formation : "line";
  const orderType: FleetOrderType = fleet.orderType === "move" || fleet.orderType === "build" || fleet.orderType === "attack" || fleet.orderType === "orbit" || fleet.orderType === "merge" || fleet.orderType === "retreat"
    ? fleet.orderType
    : null;
  const shipIds = Array.isArray(fleet.shipIds) ? fleet.shipIds.filter((id) => typeof id === "string") : [];
  const combatSettings = createDefaultFleetCombatSettings(fleet.combatSettings);
  const systemPosition = fleet.systemPosition ?? systemCenterPosition();
  return {
    id: fleet.id,
    ownerId: Number.isInteger(fleet.ownerId) ? fleet.ownerId : 0,
    shipIds,
    formation,
    currentStarId,
    targetStarId,
    phase,
    phaseStartedAtYear: fleet.phaseStartedAtYear ?? GAME_START_YEAR,
    phaseDurationDays: fleet.phaseDurationDays ?? phaseDurationDays(normalizeCtx, phase),
    route: Array.isArray(fleet.route) && fleet.route.length > 0 ? fleet.route : [currentStarId],
    routeIndex: Math.max(0, Number(fleet.routeIndex) || 0),
    phaseProgress: Math.max(0, Math.min(1, Number(fleet.phaseProgress) || 0)),
    phaseElapsedMs: fleet.phaseElapsedMs ?? Math.round((fleet.phaseProgress ?? 0) * phaseDuration(normalizeCtx, phase)),
    orderType,
    speed: Math.max(0.05, Number(fleet.speed) || DEFAULT_SHIP_SPEED),
    combatStance: normalizeCombatStance(fleet.combatStance),
    retreatState: normalizeFleetRetreatState(fleet.retreatState),
    systemPosition,
    hyperlanePosition: fleet.hyperlanePosition ?? null,
    movementPlan: fleet.movementPlan ?? null,
    orbitTargetPlanetId: typeof fleet.orbitTargetPlanetId === "string" ? fleet.orbitTargetPlanetId : null,
    orbitOffset: fleet.orbitOffset ?? null,
    orbitTarget: fleet.orbitTarget ?? null,
    mergeTargetFleetId: typeof fleet.mergeTargetFleetId === "string" ? fleet.mergeTargetFleetId : null,
    combatSettings,
    currentTacticalOrder: normalizeFleetTacticalOrder(fleet.currentTacticalOrder),
    tacticalRadius: getFleetTacticalRadius(shipIds.length),
    maxWeaponRange: Math.max(0, Number(fleet.maxWeaponRange) || 0),
    minWeaponRange: Math.max(0, Number(fleet.minWeaponRange) || 0),
    currentTargetId: typeof fleet.currentTargetId === "string" ? fleet.currentTargetId : null,
    currentTargetKind: fleet.currentTargetKind === "fleet" || fleet.currentTargetKind === "starbase" ? fleet.currentTargetKind : null,
    combatStatus: fleet.combatStatus === "maneuvering"
      || fleet.combatStatus === "engaging"
      || fleet.combatStatus === "firing"
      || fleet.combatStatus === "evading"
      || fleet.combatStatus === "retreating"
      || fleet.combatStatus === "destroyed"
      ? fleet.combatStatus
      : "idle",
    lastCombatAtYear: Number.isFinite(fleet.lastCombatAtYear) ? Number(fleet.lastCombatAtYear) : null,
  };
}

function createLegacyFleetFromShip(ship: Partial<ServerShip> & {
  id: string;
  ownerId: number;
  currentStarId?: number;
  targetStarId?: number | null;
  phase?: ShipTransitPhase;
  phaseStartedAtYear?: number;
  phaseDurationDays?: number;
  route?: number[];
  routeIndex?: number;
  phaseProgress?: number;
  phaseElapsedMs?: number;
  orderType?: FleetOrderType;
  systemPosition?: ReturnType<typeof systemCenterPosition>;
  hyperlanePosition?: ServerFleet["hyperlanePosition"];
}): GameFleet {
  const currentStarId = Number.isInteger(ship.currentStarId) ? ship.currentStarId! : 0;
  return normalizeFleet({
    id: ship.fleetId || ship.id.replace(/^ship/, "fleet"),
    ownerId: Number.isInteger(ship.ownerId) ? ship.ownerId : 0,
    shipIds: [ship.id],
    formation: "line",
    currentStarId,
    targetStarId: Number.isInteger(ship.targetStarId) ? ship.targetStarId! : null,
    phase: ship.phase ?? "idle",
    phaseStartedAtYear: ship.phaseStartedAtYear ?? GAME_START_YEAR,
    phaseDurationDays: ship.phaseDurationDays ?? phaseDurationDays(ctx, ship.phase ?? "idle"),
    route: ship.route ?? [currentStarId],
    routeIndex: ship.routeIndex ?? 0,
    phaseProgress: ship.phaseProgress ?? 0,
    phaseElapsedMs: ship.phaseElapsedMs,
    orderType: ship.orderType ?? null,
    systemPosition: ship.systemPosition ?? systemCenterPosition(),
    hyperlanePosition: ship.hyperlanePosition ?? null,
  });
}

function syncFleetMembership(nextState: GameState): boolean {
  let changed = false;
  const fleetsById = new Map(nextState.fleets.map((fleet) => [fleet.id, fleet]));
  const shipsByFleet = new Map<string, GameShip[]>();

  for (const ship of nextState.ships) {
    let fleet = fleetsById.get(ship.fleetId);
    if (!fleet) {
      const ownerHomeStarId = nextState.factions.find((faction) => faction.id === ship.ownerId)?.homeStarId ?? 0;
      fleet = createFleet(ctx, ship.ownerId, ownerHomeStarId, [], ship.fleetId);
      nextState.fleets.push(fleet);
      fleetsById.set(fleet.id, fleet);
      changed = true;
    }
    if (fleet.ownerId !== ship.ownerId) {
      ship.ownerId = fleet.ownerId;
      changed = true;
    }
    const ships = shipsByFleet.get(ship.fleetId) ?? [];
    ships.push(ship);
    shipsByFleet.set(ship.fleetId, ships);
  }

  nextState.fleets = nextState.fleets.filter((fleet) => {
    const ships = shipsByFleet.get(fleet.id) ?? [];
    if (ships.length === 0) {
      changed = true;
      return false;
    }
    const shipIds = ships.map((ship) => ship.id);
    if (
      shipIds.length !== fleet.shipIds.length
      || shipIds.some((id, index) => id !== fleet.shipIds[index])
    ) {
      fleet.shipIds = shipIds;
      changed = true;
    }
    const nextSpeed = Math.min(...ships.map((ship) => Math.max(0.05, ship.speed)));
    if (Math.abs(fleet.speed - nextSpeed) > 0.0001) {
      fleet.speed = nextSpeed;
      changed = true;
    }
    return true;
  });

  return changed;
}

function syncSystemOwnershipFromStarbases(nextState = ctx.state): boolean {
  const ownerByStar = new Array(nextState.stars.length).fill(-1);
  for (const starbase of nextState.starbases) {
    if (!Number.isInteger(starbase.starId) || starbase.starId < 0 || starbase.starId >= ownerByStar.length) continue;
    ownerByStar[starbase.starId] = starbase.ownerId;
  }

  let changed = nextState.starOwnership.length !== ownerByStar.length;
  for (let starId = 0; starId < ownerByStar.length; starId += 1) {
    if ((nextState.starOwnership[starId] ?? -1) !== ownerByStar[starId]) {
      changed = true;
      break;
    }
  }
  if (changed) {
    nextState.starOwnership = ownerByStar;
  }
  return changed;
}

function fleetHasConstructionShip(fleet: Pick<GameFleet, "shipIds">): boolean {
  const shipIds = new Set(fleet.shipIds);
  return ctx.state.ships.some((ship) => shipIds.has(ship.id) && ship.shipKind === "constructionShip" && ship.hull > 0);
}

function getFleetColonizationShip(fleet: Pick<GameFleet, "shipIds">): GameShip | null {
  const shipIds = new Set(fleet.shipIds);
  return ctx.state.ships.find((ship) => shipIds.has(ship.id) && ship.shipKind === "colonizationShip" && ship.hull > 0) ?? null;
}

function syncShipsForDesign(nextState: GameState, design: ShipDesign): boolean {
  let changed = false;
  for (const ship of nextState.ships) {
    if (ship.designId !== design.id) continue;
    applyShipDesignToShip(ship, design);
    changed = true;
  }
  if (changed) syncFleetMembership(nextState);
  return changed;
}

function normalizeFactionEconomies(
  nextState: Omit<GameState, "factionEconomies"> & { factionEconomies?: FactionEconomyState[] },
): FactionEconomyState[] {
  const byFaction = new Map((nextState.factionEconomies ?? []).map((economy) => [economy.factionId, economy]));
  const month = gameYearToMonthIndex(nextState.clock.year);
  return nextState.factions.map((faction) => {
    const existing = byFaction.get(faction.id);
    const economy = existing ?? createInitialFactionEconomyState(faction.id, month);
    return {
      factionId: faction.id,
      stockpiles: existing?.stockpiles ? cloneResourceCounts(normalizeResourceCounts(existing.stockpiles)) : economy.stockpiles,
      monthlyDelta: existing?.monthlyDelta ? cloneResourceCounts(normalizeResourceCounts(existing.monthlyDelta)) : economy.monthlyDelta,
      lastProcessedMonth: existing?.lastProcessedMonth ?? month,
      lastProcessedHour: existing?.lastProcessedHour ?? gameYearToHourIndex(nextState.clock.year),
    };
  });
}

function uniqueShipDesignId(baseId: string, usedIds: Set<string>): string {
  if (!usedIds.has(baseId)) return baseId;
  let index = 2;
  while (usedIds.has(`${baseId}-${index}`)) index += 1;
  return `${baseId}-${index}`;
}

function normalizeShipDesignsForFactions(
  factions: FactionInfo[],
  rawDesigns: unknown,
  year = GAME_START_YEAR,
): ShipDesign[] {
  const factionIds = new Set(factions.map((faction) => faction.id));
  const usedIds = new Set<string>();
  const designs: ShipDesign[] = [];
  if (Array.isArray(rawDesigns)) {
    for (const raw of rawDesigns) {
      const partial = raw as Partial<ShipDesign>;
      const ownerId = Number.isInteger(partial.ownerId) ? Number(partial.ownerId) : NaN;
      if (!factionIds.has(ownerId)) continue;
      const normalized = normalizeShipDesign(partial, ownerId, year);
      normalized.id = uniqueShipDesignId(normalized.id, usedIds);
      usedIds.add(normalized.id);
      designs.push(normalized);
    }
  }

  for (const faction of factions) {
    for (const shipKind of STARBASE_SHIP_KINDS) {
      const hasActive = designs.some((design) => (
        design.ownerId === faction.id
        && design.shipKind === shipKind
        && design.status === "active"
      ));
      if (hasActive) continue;
      const fallback = createDefaultShipDesign(faction.id, shipKind, year);
      fallback.id = uniqueShipDesignId(fallback.id, usedIds);
      usedIds.add(fallback.id);
      designs.push(fallback);
    }
  }
  return designs;
}

function createInitialState(): GameState {
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
    schemaVersion: 20,
    stars,
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
  refreshDiscovery(created);
  return created;
}

async function loadState(): Promise<GameState> {
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
    parsed.schemaVersion = 20;
    delete (parsed as GameState & { battles?: unknown }).battles;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
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
      parsed.fleets = rawShips.map((ship) => createLegacyFleetFromShip(ship as Parameters<typeof createLegacyFleetFromShip>[0]));
      parsed.ships = rawShips.map((ship) => {
        const legacyFleetId = (ship as Partial<ServerShip>).fleetId || ship.id.replace(/^ship/, "fleet");
        return normalizeShip(ship, legacyFleetId, parsed.shipDesigns);
      });
      ctx.hasDirtyState = true;
    } else {
      parsed.fleets = rawFleets.map((fleet) => normalizeFleet(fleet));
      const fallbackFleetId = parsed.fleets[0]?.id ?? "fleet-0";
      parsed.ships = rawShips.map((ship) => normalizeShip(ship, ship.fleetId || fallbackFleetId, parsed.shipDesigns));
    }
    if (syncFleetMembership(parsed)) {
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
    const initial = createInitialState();
    await saveState(ctx, initial);
    return initial;
  }
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

function sendEvent(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
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

function reject(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: false, message });
}

function accept(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: true, message });
}


function getStarOwnerId(starId: number): number {
  return ctx.state.starOwnership[starId] ?? -1;
}






function addMovementSegment(
  segments: FleetMovementSegment[],
  kind: FleetMovementSegment["kind"],
  fromStarId: number,
  toStarId: number,
  from: ReturnType<typeof systemCenterPosition>,
  to: ReturnType<typeof systemCenterPosition>,
  startYear: number,
  days: number,
  targetPlanetId: string | null = null,
): number {
  const endYear = startYear + gameDaysToYears(days);
  segments.push({
    kind,
    fromStarId,
    toStarId,
    from,
    to,
    startYear,
    endYear,
    targetPlanetId,
  });
  return endYear;
}


function getPlanetSystemPositionAt(star: StarData, planet: PlanetConfig, planetIndex: number, year: number) {
  const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
  return getPlanetSystemPosition(planet, planetIndex, nowMs, getSystemOrbitLayout(star.type));
}


function getStarbaseInSystem(starId: number): ServerStarbase | null {
  return ctx.state.starbases.find((starbase) => starbase.starId === starId) ?? null;
}




function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

function canFleetAcceptReplacementOrder(fleet: GameFleet): boolean {
  return fleet.phase !== "missingInAction" && fleet.combatStatus !== "destroyed" && fleet.shipIds.length > 0;
}


















function validateCommandPerspective(perspective: GalaxyPerspective): number | null {
  return perspective.mode === "faction" ? perspective.factionId : null;
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
  if (!fleetHasConstructionShip(fleet)) return reject(socket, "Requires a construction ship.");
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

  const planetState = getPlanetState(ctx, planetId);
  if (!planetState) return reject(socket, "Planet not found.");
  const planet = getPlanetConfig(ctx, planetState);
  if (!planet) return reject(socket, "Planet details are unavailable.");
  if ((ctx.state.starOwnership[planetState.starId] ?? -1) !== factionId) {
    return reject(socket, "Planet must be in an owned system.");
  }
  if (planetState.isHabited || planet.isHabited === true) {
    return reject(socket, "Planet is already colonized.");
  }
  if (fleet.currentStarId !== planetState.starId || fleet.orbitTargetPlanetId !== planetState.id) {
    return reject(socket, "Fleet must be orbiting the target planet.");
  }

  const colonizationShip = getFleetColonizationShip(fleet);
  if (!colonizationShip) return reject(socket, "Requires a colonization ship.");

  const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId
    ?? getFactionFoundingSpeciesId(factionId);
  const prospectiveState = createPlanetStateFromConfig(
    planetState.starId,
    planetState.planetIndex,
    planet,
    {
      ...planetState,
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
  const fleetChanged = syncFleetMembership(ctx.state);
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

  const uniqueSourceIds = Array.from(new Set(sourceFleetIds)).filter((id) => id !== targetFleetId);
  if (uniqueSourceIds.length === 0) return reject(socket, "No fleets selected to merge.");

  const sourceFleets = uniqueSourceIds
    .map((id) => ctx.state.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is GameFleet => !!fleet);

  if (sourceFleets.length !== uniqueSourceIds.length) return reject(socket, "A source fleet was not found.");
  for (const fleet of sourceFleets) {
    if (fleet.ownerId !== factionId) return reject(socket, "You do not own all selected fleets.");
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
  if (fleet.phase === "missingInAction") return reject(socket, "Fleet is missing in action.");

  clearFleetMovementNow(ctx, fleet);
  ctx.hasDirtyState = true;
  refreshDiscovery();
  accept(socket, "Fleet stopped.");
  broadcastUpdates(["clock", "fleets", "visibility"]);
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
    const known = ctx.state.discoveredByFaction[String(perspective.factionId)] ?? [];
    if (!known.includes(targetStarId)) {
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
    syncFleetMembership(ctx.state);
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
  return fleet;
}

function getFleetShips(fleet: GameFleet): GameShip[] {
  const shipIds = new Set(fleet.shipIds);
  return ctx.state.ships.filter((ship) => shipIds.has(ship.id));
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
    reject(socket, detail.error);
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
    reject(session.socket, detail.error);
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
  if ((ctx.state.starOwnership[planetState.starId] ?? -1) !== factionId) {
    reject(socket, "You do not own that planet.");
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
    reject(socket, "Enter a positive hourly amount.");
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
  accept(socket, `${tradeType === "auto_buy" ? "Auto-buy" : "Auto-sell"} set to ${formatEnergyAmount(amountPerHour)} ${resourceId} per ctx.game hour.`);
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
  if (targetDesign.id === currentDesign.id) return reject(socket, "Ship is already using the newest available design.");

  const upgrade = calculateShipUpgradePlan(currentDesign, targetDesign);
  const item = createStarbaseShipQueueItem(ship.shipKind, {
    kind: "upgrade",
    shipId: ship.id,
    designId: currentDesign.id,
    targetDesignId: targetDesign.id,
    label: `Upgrade to ${targetDesign.name}`,
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
  syncFleetMembership(ctx.state);
  refreshFactionEconomyDeltas();
  ctx.hasDirtyState = true;
  accept(socket, "Ship upgrade queued.");
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
  const shipsChanged = syncShipsForDesign(ctx.state, nextDesign);
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

function isDistrictKind(value: string): value is DistrictKind {
  return value === "city" || value === "generator" || value === "mining" || value === "agriculture";
}

function isValidSlotIndex(value: number, length: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < length;
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
  ctx.state.clock.year += elapsedHoursToGameYear(elapsedGameHours);
  ctx.state.clock.lastUpdatedAt = now;
  ctx.state.clock.syncedAtMs = now;
  changed.add("clock");

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
  if (combatResult.combatContactsChanged) changed.add("combatContacts");
  if (combatResult.shipsChanged) changed.add("ships");
  if (combatResult.fleetsChanged) changed.add("fleets");
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
  }
  if (marketResult.economyChanged || (marketResult.marketChanged && ctx.state.market.autoTrades.length > 0)) {
    changed.add("factionEconomies");
  }
  const shortageShipEffects = processShipShortageEffects(ctx);
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

const SPEED_PRESETS: Record<string, { tickSizeDays: number; tickSpeedSeconds: number }> = {
  "1": { tickSizeDays: 1 / 24, tickSpeedSeconds: 1 },
  "2": { tickSizeDays: 0.25, tickSpeedSeconds: 1 },
  "3": { tickSizeDays: 1, tickSpeedSeconds: 1 },
  "4": { tickSizeDays: 3, tickSpeedSeconds: 1 },
  "5": { tickSizeDays: 10, tickSpeedSeconds: 1 },
  "6": { tickSizeDays: 30, tickSpeedSeconds: 1 },
  "7": { tickSizeDays: 90, tickSpeedSeconds: 1 },
  "8": { tickSizeDays: 180, tickSpeedSeconds: 1 },
  "9": { tickSizeDays: 360, tickSpeedSeconds: 1 },
};

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

function commandOption(parsed: ParsedAdminCommand, key: string): string | undefined {
  const value = parsed.options[key];
  return typeof value === "string" ? value : undefined;
}

function numberArg(value: string | undefined, label: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`Invalid ${label}.`);
  }
  return number;
}

function integerArg(value: string | undefined, label: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): number {
  const number = numberArg(value, label, min, max);
  if (!Number.isInteger(number)) throw new Error(`Invalid ${label}.`);
  return number;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function resolvePerspectiveOwner(context: AdminCommandContext | undefined, perspective: GalaxyPerspective): number {
  if (typeof context?.perspectiveOwnerId === "number") return context.perspectiveOwnerId;
  return perspective.mode === "faction" ? perspective.factionId : 0;
}

function resolveOwnerToken(token: string | undefined, context: AdminCommandContext | undefined, perspective: GalaxyPerspective): number {
  const value = token ?? "me";
  if (value === "me" || value === "selected") return resolvePerspectiveOwner(context, perspective);
  const ownerId = integerArg(value, "owner id", 0, ctx.state.factions.length - 1);
  if (!ctx.state.factions.some((faction) => faction.id === ownerId)) throw new Error("Owner not found.");
  return ownerId;
}

function resolveCurrentStarId(context: AdminCommandContext | undefined): number {
  if (Number.isInteger(context?.currentStarId)) return context!.currentStarId!;
  const selectedFleetId = context?.selectedFleetId ?? context?.selectedFleetIds?.[0];
  const selectedFleet = selectedFleetId ? ctx.state.fleets.find((fleet) => fleet.id === selectedFleetId) : null;
  if (selectedFleet) return selectedFleet.currentStarId;
  return ctx.state.factions[0]?.homeStarId ?? 0;
}

function resolveSystemToken(token: string | undefined, context: AdminCommandContext | undefined): number {
  const value = token ?? "current";
  if (value === "current" || value === "selected") return resolveCurrentStarId(context);
  const starId = integerArg(value, "system id", 0, ctx.state.stars.length - 1);
  if (!ctx.state.stars[starId]) throw new Error("System not found.");
  return starId;
}

function resolveFleetToken(token: string | undefined, context: AdminCommandContext | undefined): GameFleet {
  const fleetId = token === "selected" || !token ? context?.selectedFleetId ?? context?.selectedFleetIds?.[0] : token;
  const fleet = fleetId ? ctx.state.fleets.find((candidate) => candidate.id === fleetId) : null;
  if (!fleet) throw new Error("Fleet not found.");
  return fleet;
}

function resolveShipToken(token: string | undefined, context: AdminCommandContext | undefined): GameShip {
  const shipId = token === "selected" || !token ? context?.selectedShipId : token;
  const ship = shipId ? ctx.state.ships.find((candidate) => candidate.id === shipId) : null;
  if (!ship) throw new Error("Ship not found.");
  return ship;
}

function resolveStarbaseToken(token: string | undefined, context: AdminCommandContext | undefined): ServerStarbase {
  const starbaseId = token === "selected" || !token ? context?.selectedStarbaseId : token;
  const starbase = starbaseId ? ctx.state.starbases.find((candidate) => candidate.id === starbaseId) : null;
  if (!starbase) throw new Error("Starbase not found.");
  return starbase;
}

function resolvePlanetToken(token: string | undefined, context: AdminCommandContext | undefined): PlanetState {
  const planetId = token === "selected" || !token ? context?.selectedPlanetId : token;
  const planet = planetId ? ctx.state.planetStates.find((candidate) => candidate.id === planetId) : null;
  if (!planet) throw new Error("Planet not found.");
  return planet;
}

function parseSystemPosition(tokens: string[], startIndex: number, fallback: ReturnType<typeof systemCenterPosition>): {
  position: ReturnType<typeof systemCenterPosition>;
  nextIndex: number;
} {
  const token = tokens[startIndex];
  if (!token) return { position: cloneSystemPosition(fallback), nextIndex: startIndex };
  if (token.includes(",")) {
    const [xRaw, zRaw] = token.split(",");
    return {
      position: { x: numberArg(xRaw, "x coordinate"), y: SYSTEM_FLEET_Y, z: numberArg(zRaw, "z coordinate") },
      nextIndex: startIndex + 1,
    };
  }
  const next = tokens[startIndex + 1];
  if (next !== undefined && Number.isFinite(Number(token)) && Number.isFinite(Number(next))) {
    return {
      position: { x: Number(token), y: SYSTEM_FLEET_Y, z: Number(next) },
      nextIndex: startIndex + 2,
    };
  }
  return { position: cloneSystemPosition(fallback), nextIndex: startIndex };
}

function parseLayerValue(value: string, max: number): number {
  if (value.endsWith("%")) {
    return clamp((Number(value.slice(0, -1)) / 100) * max, 0, max);
  }
  return clamp(Number(value), 0, max);
}

type HealthLayer = "shield" | "armor" | "hull" | "all";

function isHealthLayer(value: string): value is HealthLayer {
  return value === "shield" || value === "armor" || value === "hull" || value === "all";
}

function damageShipLayer(ship: GameShip, layer: HealthLayer, amountToken: string): void {
  const apply = (key: "shield" | "armor" | "hull", maxKey: "maxShield" | "maxArmor" | "maxHull") => {
    const max = Math.max(0, ship[maxKey]);
    const amount = amountToken.endsWith("%") ? (Number(amountToken.slice(0, -1)) / 100) * max : Number(amountToken);
    ship[key] = clamp(ship[key] - Math.max(0, amount), 0, max);
    if (key === "hull") ship.hp = ship.hull;
  };
  if (layer === "shield" || layer === "all") apply("shield", "maxShield");
  if (layer === "armor" || layer === "all") apply("armor", "maxArmor");
  if (layer === "hull" || layer === "all") apply("hull", "maxHull");
}

function repairShip(ship: GameShip): void {
  ship.shield = ship.maxShield;
  ship.armor = ship.maxArmor;
  ship.hull = ship.maxHull;
  ship.hp = ship.maxHp;
  ship.weaponCooldowns = {};
}



function createAdminStarbase(starId: number, ownerId: number, level: StarbaseLevel, position = getSystemStarbasePosition()): ServerStarbase {
  const combat = STARBASE_LEVEL_DEFINITIONS[level].combat;
  return normalizeStarbase({
    id: createRuntimeId("starbase", [ownerId, starId]),
    ownerId,
    starId,
    systemPosition: position,
    status: "online",
    buildProgress: 1,
    shield: combat.maxShield,
    maxShield: combat.maxShield,
    armor: combat.maxArmor,
    maxArmor: combat.maxArmor,
    hull: combat.maxHull,
    maxHull: combat.maxHull,
    weaponCooldowns: {},
    lastShieldDamageAtYear: null,
    level,
    economy: calculateStarbaseEconomy(level),
    buildingSlots: createEmptyStarbaseSlots(),
    constructionQueue: [],
    shipQueue: [],
  });
}

function createAdminFleetWithShips(
  ownerId: number,
  starId: number,
  designId: string | undefined,
  count: number,
  position: ReturnType<typeof systemCenterPosition>,
): GameFleet {
  const design = resolveShipDesign(ctx.state.shipDesigns, ownerId, "corvette", designId === "default" ? undefined : designId, ctx.state.clock.year);
  const fleet = createFleet(ctx, ownerId, starId, [], createRuntimeId("fleet", [ownerId, starId]));
  fleet.systemPosition = cloneSystemPosition(position);
  clearFleetMovementNow(ctx, fleet);
  const ships = Array.from({ length: Math.max(1, count) }, () => createShipFromDesign(ctx, ownerId, fleet.id, design));
  fleet.shipIds = ships.map((ship) => ship.id);
  fleet.tacticalRadius = getFleetTacticalRadius(fleet.shipIds.length);
  fleet.speed = Math.min(...ships.map((ship) => ship.speed));
  ctx.state.fleets.push(fleet);
  ctx.state.ships.push(...ships);
  return fleet;
}

function changedResult(
  message: string,
  changed: ServerUpdateField[],
  rows?: AdminCommandResult["rows"],
): { message: string; changed: ServerUpdateField[]; rows?: AdminCommandResult["rows"] } {
  ctx.hasDirtyState = true;
  return { message, changed: Array.from(new Set(changed)), rows };
}

function forceAdvanceGameDays(days: number): Set<ServerUpdateField> {
  const originalPaused = ctx.state.clock.paused;
  ctx.state.clock.paused = false;
  syncClockSpeedFields();
  const now = Date.now();
  const realMs = (Math.max(0, days) * Math.max(0.01, ctx.state.clock.tickSpeedSeconds) / Math.max(0.000001, ctx.state.clock.tickSizeDays)) * 1000;
  ctx.state.clock.lastUpdatedAt = now - realMs;
  const changed = advanceState(now);
  ctx.state.clock.paused = originalPaused;
  syncClockSpeedFields();
  ctx.state.clock.syncedAtMs = Date.now();
  changed.add("clock");
  return changed;
}

function adminRowsForFleets(fleets: GameFleet[]): AdminCommandRow[] {
  return fleets.map((fleet) => ({
    id: fleet.id,
    owner: fleet.ownerId,
    system: fleet.currentStarId,
    ships: fleet.shipIds.length,
    phase: fleet.phase,
    stance: fleet.combatStance,
    behavior: fleet.combatSettings.behavior,
    status: fleet.combatStatus,
  }));
}

function adminRowsForShips(ships: GameShip[]): AdminCommandRow[] {
  return ships.map((ship) => ({
    id: ship.id,
    owner: ship.ownerId,
    fleet: ship.fleetId,
    design: ship.designId,
    shield: Math.round(ship.shield),
    armor: Math.round(ship.armor),
    hull: Math.round(ship.hull),
  }));
}

function resolveTechnologyToken(token: string | undefined): TechId {
  const value = token?.trim();
  if (!value) throw new Error("Technology id is required.");
  if (TECHNOLOGY_BY_ID[value]) return value;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  const tech = TECHNOLOGY_DEFINITIONS.find((candidate) => (
    candidate.id.toLowerCase() === normalized
    || candidate.name.toLowerCase() === value.toLowerCase()
    || candidate.name.toLowerCase().replace(/[\s-]+/g, "_") === normalized
  ));
  if (!tech) throw new Error(`Technology "${value}" not found.`);
  return tech.id;
}

function adminRowsForTechnologies(factionId: number, onlyTechId?: TechId): AdminCommandRow[] {
  const view = createFactionTechnologyView(ctx, factionId);
  return view.technologies
    .filter((status) => !onlyTechId || status.id === onlyTechId)
    .map((status) => {
      const tech = TECHNOLOGY_BY_ID[status.id];
      const progressPercent = tech.cost <= 0
        ? 100
        : Math.min(100, (status.progress.totalProgress / tech.cost) * 100);
      const stateLabel = status.completed
        ? "completed"
        : status.active
          ? "active"
          : status.available
            ? "available"
            : "locked";
      return {
        faction: factionId,
        id: tech.id,
        name: tech.name,
        category: tech.category,
        tier: tech.tier,
        state: stateLabel,
        progress: `${progressPercent.toFixed(1)}%`,
        total: Math.round(status.progress.totalProgress),
        cost: tech.cost,
        passive: Math.round(status.progress.passiveProgress),
        passiveCap: Math.round(status.passiveCap),
        multiplier: `${status.evaluation.multiplier.toFixed(2)}x`,
        missing: status.missingPrerequisites.join(", "),
      };
    });
}

function changedTechnologyResult(
  message: string,
  completedTech: boolean,
  rows?: AdminCommandResult["rows"],
): { message: string; changed: ServerUpdateField[]; rows?: AdminCommandResult["rows"] } {
  const changed: ServerUpdateField[] = ["technologies"];
  if (completedTech) {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
    changed.push("planetStates", "factionEconomies");
  }
  return changedResult(message, changed, rows);
}

async function executeAdminCommand(
  parsed: ParsedAdminCommand,
  command: Extract<ClientCommand, { type: "adminCommand" }>,
  perspective: GalaxyPerspective,
): Promise<{ message: string; changed?: ServerUpdateField[]; rows?: AdminCommandResult["rows"] }> {
  const context = command.context;
  const name = parsed.canonicalName;

  if (!parsed.definition) throw new Error(`Unknown admin command "${parsed.name}".`);
  if (parsed.definition.localOnly) return { message: `"${name}" is a client-local command.` };

  switch (name) {
    case "help": {
      const key = parsed.args[0];
      if (!key) return { message: "Admin command help.", rows: ADMIN_COMMAND_DEFINITIONS.slice(0, 40).map(formatAdminCommandHelp) };
      const definition = getAdminCommandDefinition(key);
      if (definition) return { message: `Help for ${definition.name}.`, rows: [formatAdminCommandHelp(definition)] };
      return {
        message: `Commands in ${key}.`,
        rows: ADMIN_COMMAND_DEFINITIONS.filter((definition) => definition.category === key).map(formatAdminCommandHelp),
      };
    }
    case "commands": {
      const category = parsed.args[0];
      const definitions = category
        ? ADMIN_COMMAND_DEFINITIONS.filter((definition) => definition.category === category)
        : ADMIN_COMMAND_DEFINITIONS;
      return { message: `${definitions.length} admin commands.`, rows: definitions.map(formatAdminCommandHelp) };
    }
    case "inspect": {
      const kind = parsed.args[0];
      const id = parsed.args[1];
      if (kind === "fleet") return { message: "Fleet.", rows: adminRowsForFleets([resolveFleetToken(id, context)]) };
      if (kind === "ship") return { message: "Ship.", rows: adminRowsForShips([resolveShipToken(id, context)]) };
      if (kind === "starbase") {
        const starbase = resolveStarbaseToken(id, context);
        return { message: "Starbase.", rows: [{ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, hull: Math.round(starbase.hull), status: starbase.status }] };
      }
      if (kind === "planet") {
        const planet = resolvePlanetToken(id, context);
        return { message: "Planet.", rows: [{ id: planet.id, system: planet.starId, index: planet.planetIndex, population: Math.round(planet.population), habitability: planet.habitability, stability: Math.round(planet.economy.stability) }] };
      }
      if (kind === "system") {
        const starId = resolveSystemToken(id, context);
        const star = ctx.state.stars[starId];
        return { message: "System.", rows: [{ id: star.id, name: star.name, owner: ctx.state.starOwnership[starId] ?? -1, planets: star.system.planets.length, fleets: ctx.state.fleets.filter((fleet) => fleet.currentStarId === starId).length }] };
      }
      if (kind === "owner") {
        const owner = resolveOwnerToken(id, context, perspective);
        const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
        return { message: "Owner.", rows: [{ id: owner, name: faction?.name ?? "Unknown", homeSystem: faction?.homeStarId ?? null }] };
      }
      throw new Error("Inspect kind must be fleet, ship, starbase, planet, system, or owner.");
    }
    case "list_fleets": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const system = commandOption(parsed, "system");
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(system, context) : null;
      const fleets = ctx.state.fleets.filter((fleet) => (
        (ownerFilter === null || fleet.ownerId === ownerFilter)
        && (systemFilter === null || fleet.currentStarId === systemFilter)
      ));
      return { message: `${fleets.length} fleets.`, rows: adminRowsForFleets(fleets) };
    }
    case "list_ships": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      return { message: `${fleet.shipIds.length} ships.`, rows: adminRowsForShips(ctx.state.ships.filter((ship) => ship.fleetId === fleet.id)) };
    }
    case "list_designs": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const designs = ctx.state.shipDesigns.filter((design) => ownerFilter === null || design.ownerId === ownerFilter);
      return { message: `${designs.length} designs.`, rows: designs.map((design) => ({ id: design.id, owner: design.ownerId, kind: design.shipKind, name: design.name, status: design.status })) };
    }
    case "list_starbases": {
      const owner = commandOption(parsed, "owner");
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(system, context) : null;
      const starbases = ctx.state.starbases.filter((starbase) => (
        (ownerFilter === null || starbase.ownerId === ownerFilter)
        && (systemFilter === null || starbase.starId === systemFilter)
      ));
      return { message: `${starbases.length} starbases.`, rows: starbases.map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, status: starbase.status, hull: Math.round(starbase.hull) })) };
    }
    case "list_planets": {
      const systemId = resolveSystemToken(commandOption(parsed, "system") ?? parsed.args[0], context);
      return {
        message: `Planets in system ${systemId}.`,
        rows: ctx.state.planetStates
          .filter((planet) => planet.starId === systemId)
          .map((planet) => ({ id: planet.id, index: planet.planetIndex, habited: planet.isHabited, population: Math.round(planet.population), habitability: planet.habitability })),
      };
    }
    case "where": {
      const id = parsed.args[0];
      const fleet = ctx.state.fleets.find((candidate) => candidate.id === id);
      if (fleet) return { message: "Found fleet.", rows: adminRowsForFleets([fleet]) };
      const ship = ctx.state.ships.find((candidate) => candidate.id === id);
      if (ship) return { message: "Found ship.", rows: adminRowsForShips([ship]) };
      const starbase = ctx.state.starbases.find((candidate) => candidate.id === id);
      if (starbase) return { message: "Found starbase.", rows: [{ id: starbase.id, system: starbase.starId, owner: starbase.ownerId }] };
      const planet = ctx.state.planetStates.find((candidate) => candidate.id === id);
      if (planet) return { message: "Found planet.", rows: [{ id: planet.id, system: planet.starId, index: planet.planetIndex }] };
      throw new Error("Entity not found.");
    }
    case "combat_status": {
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const systemId = system ? resolveSystemToken(system, context) : resolveCurrentStarId(context);
      return {
        message: `Combat status for system ${systemId}.`,
        rows: [
          ...adminRowsForFleets(ctx.state.fleets.filter((fleet) => fleet.currentStarId === systemId)),
          ...ctx.state.starbases.filter((starbase) => starbase.starId === systemId).map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, hull: Math.round(starbase.hull), status: starbase.status })),
        ],
      };
    }
    case "economy_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const economies = ownerArg === "all"
        ? ctx.state.factionEconomies
        : ctx.state.factionEconomies.filter((economy) => economy.factionId === resolveOwnerToken(ownerArg, context, perspective));
      return { message: `${economies.length} economies.`, rows: economies.map((economy) => ({ owner: economy.factionId, ...economy.stockpiles })) };
    }
    case "tech_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const ownerIds = ownerArg === "all"
        ? ctx.state.factions.map((faction) => faction.id)
        : [resolveOwnerToken(ownerArg, context, perspective)];
      return {
        message: `Technology status for ${ownerIds.length} faction${ownerIds.length === 1 ? "" : "s"}.`,
        rows: ownerIds.flatMap((ownerId) => adminRowsForTechnologies(ownerId)),
      };
    }
    case "state_summary":
      return {
        message: "State summary.",
        rows: [{
          year: ctx.state.clock.year.toFixed(3),
          systems: ctx.state.stars.length,
          factions: ctx.state.factions.length,
          fleets: ctx.state.fleets.length,
          ships: ctx.state.ships.length,
          starbases: ctx.state.starbases.length,
          combatContacts: ctx.state.recentCombatContacts.length,
        }],
      };
    case "tick_size": {
      ctx.state.clock.tickSizeDays = numberArg(parsed.args[0], "tick size days", 0.000001);
      syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(`Tick size set to ${ctx.state.clock.tickSizeDays} ctx.game days.`, ["clock"]);
    }
    case "tick_speed": {
      ctx.state.clock.tickSpeedSeconds = numberArg(parsed.args[0], "tick speed seconds", 0.01);
      syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(`Tick speed set to ${ctx.state.clock.tickSpeedSeconds} real seconds.`, ["clock"]);
    }
    case "pause":
      ctx.state.clock.paused = true;
      syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult("Simulation paused.", ["clock"]);
    case "resume":
      ctx.state.clock.paused = false;
      syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult("Simulation resumed.", ["clock"]);
    case "step": {
      const ticks = integerArg(parsed.args[0] ?? "1", "ticks", 1, 10000);
      const changed = Array.from(forceAdvanceGameDays(ctx.state.clock.tickSizeDays * ticks));
      return changedResult(`Advanced ${ticks} tick(s).`, changed);
    }
    case "advance_hours": {
      const hours = numberArg(parsed.args[0], "hours", 0);
      return changedResult(`Advanced ${hours} ctx.game hours.`, Array.from(forceAdvanceGameDays(hours / 24)));
    }
    case "advance_days": {
      const days = numberArg(parsed.args[0], "days", 0);
      return changedResult(`Advanced ${days} ctx.game days.`, Array.from(forceAdvanceGameDays(days)));
    }
    case "set_year": {
      ctx.state.clock.year = numberArg(parsed.args[0], "year", 0);
      ctx.state.clock.lastUpdatedAt = Date.now();
      ctx.state.clock.syncedAtMs = ctx.state.clock.lastUpdatedAt;
      ctx.state.clock.lastProcessedPopulationWeek = gameYearToWeekIndex(ctx.state.clock.year);
      ctx.state.clock.lastProcessedLeaderDay = getLeaderDayIndex(ctx.state.clock.year);
      return changedResult(`Year set to ${ctx.state.clock.year}.`, ["clock"]);
    }
    case "speed_preset": {
      const preset = SPEED_PRESETS[parsed.args[0] ?? ""];
      if (!preset) throw new Error("Speed preset must be 1-9.");
      ctx.state.clock.tickSizeDays = preset.tickSizeDays;
      ctx.state.clock.tickSpeedSeconds = preset.tickSpeedSeconds;
      ctx.state.clock.paused = false;
      syncClockSpeedFields();
      ctx.state.clock.syncedAtMs = Date.now();
      return changedResult(`Speed preset ${parsed.args[0]} applied.`, ["clock"]);
    }
    case "save":
      await saveState(ctx);
      return { message: "Game ctx.state saved." };
    case "reset_galaxy": {
      ctx.state = createInitialState();
      await saveState(ctx);
      broadcastSnapshots();
      return { message: "Galaxy reset.", changed: ["clock", "visibility", "planetStates", "factionEconomies", "species", "ships", "shipDesigns", "fleets", "starbases", "combatContacts"] };
    }
    case "clear_recent_combat":
      ctx.state.recentCombatContacts = [];
      return changedResult("Recent combat contacts cleared.", ["combatContacts"]);
    case "clear_orders": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all" ? ctx.state.fleets : [resolveFleetToken(token, context)];
      for (const fleet of fleets) {
        fleet.currentTacticalOrder = null;
        fleet.currentTargetId = null;
        fleet.currentTargetKind = null;
        fleet.combatStatus = "idle";
      }
      return changedResult(`Cleared orders on ${fleets.length} fleet(s).`, ["fleets"]);
    }
    case "clear_fleet_movement": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all" ? ctx.state.fleets : [resolveFleetToken(token, context)];
      for (const fleet of fleets) clearFleetMovementNow(ctx, fleet);
      return changedResult(`Stopped ${fleets.length} fleet(s).`, ["fleets", "visibility"]);
    }
    case "clear_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned"
        ? ctx.state.planetStates.filter((planet) => ctx.state.starOwnership[planet.starId] === owner)
        : [resolvePlanetToken(token, context)];
      for (const planet of planets) planet.constructionQueue = [];
      refreshFactionEconomyDeltas();
      return changedResult(`Cleared ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies"]);
    }
    case "clear_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned"
        ? ctx.state.starbases.filter((starbase) => starbase.ownerId === owner)
        : [resolveStarbaseToken(token, context)];
      for (const starbase of starbases) {
        starbase.constructionQueue = [];
        starbase.shipQueue = [];
      }
      refreshFactionEconomyDeltas();
      return changedResult(`Cleared ${starbases.length} starbase queue(s).`, ["starbases", "factionEconomies"]);
    }
    case "discover": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const target = parsed.args[1] ?? "current";
      const jumps = integerArg(commandOption(parsed, "jumps") ?? parsed.args[2] ?? "0", "jumps", 0, ctx.state.stars.length);
      const current = new Set(ctx.state.discoveredByFaction[String(owner)] ?? []);
      const addSystem = (starId: number) => {
        current.add(starId);
        if (jumps > 0) {
          for (const visible of computeVisibleStarIds(ctx.state.adjacency, starId, jumps)) current.add(visible);
        }
      };
      if (target === "all") {
        ctx.state.stars.forEach((_, starId) => current.add(starId));
      } else {
        addSystem(resolveSystemToken(target, context));
      }
      ctx.state.discoveredByFaction[String(owner)] = Array.from(current).sort((a, b) => a - b);
      refreshDiscovery();
      return changedResult("Discovery updated.", ["visibility"]);
    }
    case "forget": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const target = parsed.args[1] ?? "current";
      if (target === "all") {
        ctx.state.discoveredByFaction[String(owner)] = [];
      } else {
        const starId = resolveSystemToken(target, context);
        ctx.state.discoveredByFaction[String(owner)] = (ctx.state.discoveredByFaction[String(owner)] ?? []).filter((id) => id !== starId);
      }
      refreshDiscovery();
      return changedResult("Discovery removed.", ["visibility"]);
    }
    case "reveal_all": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      ctx.state.discoveredByFaction[String(owner)] = ctx.state.stars.map((_, index) => index);
      refreshDiscovery();
      return changedResult("All systems revealed.", ["visibility"]);
    }
    case "reset_visibility": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
      ctx.state.discoveredByFaction[String(owner)] = faction ? Array.from(computeVisibleStarIds(ctx.state.adjacency, faction.homeStarId, DISCOVERY_JUMPS)) : [];
      refreshDiscovery();
      return changedResult("Visibility reset.", ["visibility"]);
    }
    case "own_system": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const ownerToken = parsed.args[1] ?? "me";
      ctx.state.starOwnership[starId] = ownerToken === "none" ? -1 : resolveOwnerToken(ownerToken, context, perspective);
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      refreshDiscovery();
      return changedResult(`System ${starId} ownership changed.`, ["visibility", "planetStates", "factionEconomies"]);
    }
    case "set_home_system": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const starId = resolveSystemToken(parsed.args[1], context);
      const faction = ctx.state.factions.find((candidate) => candidate.id === owner);
      if (!faction) throw new Error("Faction not found.");
      faction.homeStarId = starId;
      refreshDiscovery();
      return changedResult(`Faction ${owner} home system set to ${starId}.`, ["visibility"]);
    }
    case "add_resource":
    case "set_resource": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const resource = parsed.args[1] as ResourceKind | "all" | undefined;
      const amount = numberArg(parsed.args[2], "amount");
      const economy = ctx.state.factionEconomies.find((candidate) => candidate.factionId === owner);
      if (!economy) throw new Error("Economy not found.");
      const resources = resource === "all" ? RESOURCE_KINDS : [resource as ResourceKind];
      for (const kind of resources) {
        if (!RESOURCE_KINDS.includes(kind)) throw new Error("Invalid resource.");
        economy.stockpiles[kind] = name === "add_resource" ? economy.stockpiles[kind] + amount : amount;
      }
      refreshFactionEconomyDeltas();
      return changedResult("Resources updated.", ["factionEconomies"]);
    }
    case "trigger_event": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const eventId = parsed.args[1];
      if (!eventId || !getEventDefinition(eventId)) throw new Error("Unknown event id.");
      const eventContext = eventId === LEADER_OFFER_EVENT_ID ? buildLeaderOfferContext(ctx, owner) : undefined;
      if (!queueFactionEvent(ctx, owner, eventId, eventContext)) throw new Error("Failed to queue event.");
      return changedResult(`Queued event ${eventId}.`, ["events"]);
    }
    case "set_situation": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const resource = parsed.args[1] as ResourceKind;
      if (!RESOURCE_KINDS.includes(resource)) throw new Error("Invalid resource.");
      const progress = numberArg(parsed.args[2], "progress", 0, 100);
      const instanceId = situationInstanceId(SHORTAGE_SITUATION_ID, owner, resource);
      const existing = ctx.state.situations.find((candidate) => candidate.id === instanceId);
      if (existing) {
        existing.progress = progress;
        existing.lastThreshold = Math.max(existing.lastThreshold, progress);
      } else {
        ctx.state.situations.push({
          id: instanceId,
          defId: SHORTAGE_SITUATION_ID,
          factionId: owner,
          subject: resource,
          progress,
          startedAtYear: ctx.state.clock.year,
          lastThreshold: progress,
        });
      }
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      return changedResult(`Shortage(${resource}) progress set to ${progress}.`, ["situations", "factionEconomies"]);
    }
    case "lose_fleet": {
      const fleet = resolveFleetToken(parsed.args[0] ?? "selected", context);
      const days = parsed.args[1] ? numberArg(parsed.args[1], "days", 0) : 60;
      if (!sendFleetMissing(ctx, fleet.id, days)) throw new Error("Fleet cannot be sent missing.");
      refreshDiscovery();
      return changedResult("Fleet sent missing in transit.", ["fleets", "visibility"]);
    }
    case "complete_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned" ? ctx.state.planetStates.filter((planet) => ctx.state.starOwnership[planet.starId] === owner) : [resolvePlanetToken(token, context)];
      for (const planet of planets) {
        const result = progressPlanetConstructionQueue(
          planet,
          1_000_000,
          getPlanetDistrictLimitsFromState(ctx.state, planet),
          getPlanetTechnologyModifiers(ctx.state, planet),
          getPlanetSpeciesContext(ctx.state, planet),
        );
        Object.assign(planet, result.state);
      }
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      refreshFactionEconomyDeltas();
      return changedResult(`Completed ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "complete_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned" ? ctx.state.starbases.filter((starbase) => starbase.ownerId === owner) : [resolveStarbaseToken(token, context)];
      for (const starbase of starbases) {
        const result = progressStarbaseConstructionQueue(starbase, 1_000_000);
        Object.assign(starbase, normalizeStarbase(result.starbase));
        starbase.shipQueue = [];
      }
      refreshFactionEconomyDeltas();
      return changedResult(`Completed ${starbases.length} starbase queue(s).`, ["starbases", "factionEconomies"]);
    }
    case "set_population":
    case "add_population": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      const amount = numberArg(parsed.args[1], "population", name === "set_population" ? 0 : Number.NEGATIVE_INFINITY);
      planet.population = name === "add_population" ? Math.max(0, planet.population + amount) : amount;
      const ownerId = ctx.state.starOwnership[planet.starId] ?? -1;
      const foundingSpeciesId = ctx.state.factions.find((faction) => faction.id === ownerId)?.foundingSpeciesId ?? HUMAN_SPECIES_ID;
      planet.speciesPopulations = [{ speciesId: foundingSpeciesId, population: planet.population }];
      const recalculated = recalculatePlanetStateEconomy(
        planet,
        getPlanetDistrictLimitsFromState(ctx.state, planet),
        getPlanetTechnologyModifiers(ctx.state, planet),
        getPlanetSpeciesContext(ctx.state, planet),
      );
      Object.assign(planet, recalculated);
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      refreshFactionEconomyDeltas();
      return changedResult("Population updated.", ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "set_habitability": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      planet.habitability = numberArg(parsed.args[1], "habitability", 0, 100);
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      refreshFactionEconomyDeltas();
      return changedResult("Habitability updated.", ["planetStates", "factionEconomies"]);
    }
    case "set_stability": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      const value = numberArg(parsed.args[1], "stability", 0, 100);
      planet.modifiers = [
        ...planet.modifiers.filter((modifier) => modifier.id !== "admin-stability"),
        { id: "admin-stability", label: "Admin Stability", source: "Admin", target: "stability", operation: "add", value: value - 50 },
      ];
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      refreshFactionEconomyDeltas();
      return changedResult("Stability test modifier updated.", ["planetStates", "factionEconomies"]);
    }
    case "build_district_now": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      const district = parsed.args[1] as DistrictKind;
      if (!isDistrictKind(district)) throw new Error("Invalid district.");
      planet.builtDistricts[district] += 1;
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      applyPlanetStatesToStars(ctx.state.stars, ctx.state.planetStates);
      refreshFactionEconomyDeltas();
      return changedResult("District built.", ["planetStates", "factionEconomies"]);
    }
    case "build_planet_building_now": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      const area = parsed.args[1] as BuildingSlotArea;
      const slotIndex = integerArg(parsed.args[2], "slot index", 0);
      const building = parsed.args[3] as BuildingKind;
      if (!BUILDING_KINDS.includes(building)) throw new Error("Invalid building.");
      if (area === "urbanSubDistrict") {
        const subIndex = integerArg(parsed.args[4], "sub-district index", 0);
        const sub = planet.urbanSubDistricts[subIndex];
        if (!sub || !isValidSlotIndex(slotIndex, sub.buildings.length)) throw new Error("Invalid urban slot.");
        sub.buildings[slotIndex] = building;
      } else {
        if (!isDistrictKind(area) || !isValidSlotIndex(slotIndex, planet.buildings[area].length)) throw new Error("Invalid building slot.");
        planet.buildings[area][slotIndex] = building;
      }
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(ctx.state, planet), getPlanetTechnologyModifiers(ctx.state, planet), getPlanetSpeciesContext(ctx.state, planet)));
      refreshFactionEconomyDeltas();
      return changedResult("Building built.", ["planetStates", "factionEconomies"]);
    }
    case "set_active_tech": {
      const ownerId = resolveOwnerToken(parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      if (isTechnologyCompleted(techState, techId)) throw new Error(`${tech.name} is already completed.`);
      const missing = getMissingPrerequisites(tech, techState);
      if (missing.length > 0) {
        throw new Error(`Missing prerequisites: ${missing.map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id).join(", ")}.`);
      }
      techState.activeTechId = techId;
      return changedTechnologyResult(`Active research set to ${tech.name}.`, false, adminRowsForTechnologies(ownerId, techId));
    }
    case "add_tech_progress": {
      const ownerId = resolveOwnerToken(parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const amount = numberArg(parsed.args[2], "research progress", 0);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      if (isTechnologyCompleted(techState, techId)) {
        return { message: `${tech.name} is already completed.`, rows: adminRowsForTechnologies(ownerId, techId) };
      }
      const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
      progress.activeProgress = Math.min(tech.cost, progress.activeProgress + amount);
      progress.totalProgress = Math.min(tech.cost, progress.totalProgress + amount);
      progress.completed = false;
      techState.progressByTechId[techId] = progress;
      const completed = progress.totalProgress >= tech.cost - 0.000001 && completeTechnology(techState, techId);
      ensureActiveTechnology(techState);
      return changedTechnologyResult(`Added ${Math.round(amount)} progress to ${tech.name}.`, completed, adminRowsForTechnologies(ownerId, techId));
    }
    case "complete_tech": {
      const ownerId = resolveOwnerToken(parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(ctx.state, ownerId);
      if (!techState) throw new Error("Faction technology ctx.state unavailable.");
      const completed = completeTechnology(techState, techId);
      ensureActiveTechnology(techState);
      return changedTechnologyResult(`${tech.name} completed.`, completed, adminRowsForTechnologies(ownerId, techId));
    }
    case "create_design":
    case "set_design_modules": {
      const isCreate = name === "create_design";
      const owner = isCreate ? resolveOwnerToken(parsed.args[0], context, perspective) : 0;
      const design = isCreate ? null : ctx.state.shipDesigns.find((candidate) => candidate.id === parsed.args[0]);
      if (!isCreate && !design) throw new Error("Design not found.");
      const shipKind = (isCreate ? parsed.args[1] : design!.shipKind) as StarbaseShipKind;
      if (!isKnownShipKind(shipKind)) throw new Error("Invalid ship kind.");
      const utilityOption = commandOption(parsed, "utility");
      const utilityModuleIds = utilityOption === "null" ? [] : splitList(utilityOption);
      const normalized = normalizeShipDesign({
        id: design?.id ?? createRuntimeId("design", [owner, shipKind]),
        ownerId: design?.ownerId ?? owner,
        shipKind,
        name: commandOption(parsed, "name") ?? design?.name ?? "Admin Design",
        status: "active",
        weaponSectionModuleIds: splitList(commandOption(parsed, "weapon_sections")),
        defenseSectionModuleIds: splitList(commandOption(parsed, "defense_sections")),
        weaponModuleIds: splitList(commandOption(parsed, "weapons")),
        defenseModuleIds: splitList(commandOption(parsed, "defenses")),
        utilityModuleIds,
        utilityModuleId: utilityModuleIds[0] ?? null,
        createdAtYear: design?.createdAtYear ?? ctx.state.clock.year,
        updatedAtYear: ctx.state.clock.year,
      }, design?.ownerId ?? owner, ctx.state.clock.year);
      const hull = SHIP_HULL_DEFINITIONS[normalized.shipKind];
      const layout = getShipDesignLayout(normalized);
      if (
        normalized.weaponSectionModuleIds.length !== hull.weaponSectionSlots
        || normalized.defenseSectionModuleIds.length !== hull.defenseSectionSlots
        || normalized.weaponModuleIds.length !== layout.weaponSlots.length
        || normalized.defenseModuleIds.length !== layout.defenseSlots.length
        || normalized.utilityModuleIds.length !== layout.utilitySlots.length
      ) {
        throw new Error("Design module counts do not match hull slots.");
      }
      if (design) ctx.state.shipDesigns = ctx.state.shipDesigns.map((candidate) => candidate.id === design.id ? normalized : candidate);
      else ctx.state.shipDesigns.push(normalized);
      const shipsChanged = syncShipsForDesign(ctx.state, normalized);
      return changedResult("Ship design updated.", shipsChanged ? ["shipDesigns", "ships", "fleets"] : ["shipDesigns"], [{ id: normalized.id, owner: normalized.ownerId, name: normalized.name }]);
    }
    case "clone_design": {
      const source = ctx.state.shipDesigns.find((design) => design.id === parsed.args[0]);
      if (!source) throw new Error("Design not found.");
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const clone = normalizeShipDesign({
        ...source,
        id: createRuntimeId("design", [owner, source.shipKind]),
        ownerId: owner,
        name: commandOption(parsed, "name") ?? `${source.name} Copy`,
        createdAtYear: ctx.state.clock.year,
        updatedAtYear: ctx.state.clock.year,
      }, owner, ctx.state.clock.year);
      ctx.state.shipDesigns.push(clone);
      return changedResult("Ship design cloned.", ["shipDesigns"], [{ id: clone.id, owner: clone.ownerId, name: clone.name }]);
    }
    case "delete_design": {
      const designId = parsed.args[0];
      const before = ctx.state.shipDesigns.length;
      ctx.state.shipDesigns = ctx.state.shipDesigns.filter((design) => design.id !== designId);
      if (ctx.state.shipDesigns.length === before) throw new Error("Design not found.");
      return changedResult("Ship design deleted.", ["shipDesigns"]);
    }
    case "create_fleet": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      const fleet = createFleet(ctx, owner, starId, [], createRuntimeId("fleet", [owner, starId]));
      fleet.systemPosition = position;
      ctx.state.fleets.push(fleet);
      return changedResult("Empty fleet created. Add ships to keep it after membership sync.", ["fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "create_ship": {
      const target = parsed.args[0] ?? "current";
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const designToken = parsed.args[2] ?? "default";
      const count = integerArg(commandOption(parsed, "count") ?? "1", "count", 1, 1000);
      let fleet = target === "selected" ? resolveFleetToken(target, context) : ctx.state.fleets.find((candidate) => candidate.id === target) ?? null;
      let starId = fleet?.currentStarId ?? resolveSystemToken(target, context);
      const { position } = parseSystemPosition(parsed.args, 3, fleet?.systemPosition ?? systemCenterPosition());
      if (!fleet || fleet.ownerId !== owner) {
        fleet = createFleet(ctx, owner, starId, [], createRuntimeId("fleet", [owner, starId]));
        fleet.systemPosition = position;
        ctx.state.fleets.push(fleet);
      }
      const design = resolveShipDesign(ctx.state.shipDesigns, owner, "corvette", designToken === "default" ? undefined : designToken, ctx.state.clock.year);
      const ships = Array.from({ length: count }, () => createShipFromDesign(ctx, owner, fleet!.id, design));
      ctx.state.ships.push(...ships);
      syncFleetMembership(ctx.state);
      return changedResult(`Created ${count} ship(s).`, ["ships", "fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "delete_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      ctx.state.ships = ctx.state.ships.filter((candidate) => candidate.id !== ship.id);
      syncFleetMembership(ctx.state);
      return changedResult("Ship deleted.", ["ships", "fleets", "visibility"]);
    }
    case "delete_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      ctx.state.ships = ctx.state.ships.filter((ship) => ship.fleetId !== fleet.id);
      ctx.state.fleets = ctx.state.fleets.filter((candidate) => candidate.id !== fleet.id);
      return changedResult("Fleet deleted.", ["ships", "fleets", "visibility"]);
    }
    case "kill_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      removeDestroyedShips(ctx);
      return changedResult("Ship killed.", ["ships", "fleets", "visibility"]);
    }
    case "kill_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      }
      removeDestroyedShips(ctx);
      return changedResult("Fleet killed.", ["ships", "fleets", "visibility"]);
    }
    case "repair_ship": {
      repairShip(resolveShipToken(parsed.args[0], context));
      return changedResult("Ship repaired.", ["ships", "fleets"]);
    }
    case "repair_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) repairShip(ship);
      return changedResult("Fleet repaired.", ["ships", "fleets"]);
    }
    case "damage_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips(ctx);
      return changedResult("Ship damaged.", ["ships", "fleets", "visibility"]);
    }
    case "damage_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips(ctx);
      return changedResult("Fleet damaged.", ["ships", "fleets", "visibility"]);
    }
    case "set_ship_health": {
      const ship = resolveShipToken(parsed.args[0], context);
      const shield = commandOption(parsed, "shield");
      const armor = commandOption(parsed, "armor");
      const hull = commandOption(parsed, "hull");
      if (shield) ship.shield = parseLayerValue(shield, ship.maxShield);
      if (armor) ship.armor = parseLayerValue(armor, ship.maxArmor);
      if (hull) { ship.hull = parseLayerValue(hull, ship.maxHull); ship.hp = ship.hull; }
      removeDestroyedShips(ctx);
      return changedResult("Ship health set.", ["ships", "fleets", "visibility"]);
    }
    case "set_fleet_health": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        const shield = commandOption(parsed, "shield");
        const armor = commandOption(parsed, "armor");
        const hull = commandOption(parsed, "hull");
        if (shield) ship.shield = parseLayerValue(shield, ship.maxShield);
        if (armor) ship.armor = parseLayerValue(armor, ship.maxArmor);
        if (hull) { ship.hull = parseLayerValue(hull, ship.maxHull); ship.hp = ship.hull; }
      }
      removeDestroyedShips(ctx);
      return changedResult("Fleet health set.", ["ships", "fleets", "visibility"]);
    }
    case "move_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const starId = resolveSystemToken(parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, getDefaultMoveDestination(ctx, starId).position);
      startMoveOrder(ctx, fleet, starId, position);
      return changedResult("Fleet move order started.", ["clock", "fleets", "visibility"]);
    }
    case "teleport_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const starId = resolveSystemToken(parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      clearFleetMovementNow(ctx, fleet);
      fleet.currentStarId = starId;
      fleet.route = [starId];
      fleet.systemPosition = position;
      refreshDiscovery();
      return changedResult("Fleet teleported.", ["fleets", "visibility"]);
    }
    case "set_fleet_position": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const { position } = parseSystemPosition(parsed.args, 1, fleet.systemPosition);
      clearFleetMovementNow(ctx, fleet);
      fleet.systemPosition = position;
      return changedResult("Fleet position set.", ["fleets"]);
    }
    case "set_fleet_owner": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      fleet.ownerId = owner;
      for (const ship of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) ship.ownerId = owner;
      refreshDiscovery();
      return changedResult("Fleet owner set.", ["ships", "fleets", "visibility"]);
    }
    case "split_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const spec = parsed.args[1];
      const sourceShips = ctx.state.ships.filter((ship) => ship.fleetId === fleet.id);
      const movingIds = spec?.includes(",")
        ? new Set(splitList(spec))
        : new Set(sourceShips.slice(0, integerArg(spec, "split count", 1, sourceShips.length - 1)).map((ship) => ship.id));
      const newFleet = createFleet(ctx, fleet.ownerId, fleet.currentStarId, [], createRuntimeId("fleet", [fleet.ownerId, fleet.currentStarId]));
      newFleet.systemPosition = { ...fleet.systemPosition, x: fleet.systemPosition.x + 2 };
      ctx.state.fleets.push(newFleet);
      for (const ship of sourceShips) if (movingIds.has(ship.id)) ship.fleetId = newFleet.id;
      syncFleetMembership(ctx.state);
      return changedResult("Fleet split.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleet, newFleet]));
    }
    case "merge_fleets": {
      const target = resolveFleetToken(parsed.args[0], context);
      const sourceIds = splitList(parsed.args[1]);
      for (const ship of ctx.state.ships) {
        if (sourceIds.includes(ship.fleetId)) ship.fleetId = target.id;
      }
      ctx.state.fleets = ctx.state.fleets.filter((fleet) => !sourceIds.includes(fleet.id));
      syncFleetMembership(ctx.state);
      return changedResult("Fleets merged.", ["ships", "fleets", "visibility"]);
    }
    case "set_cooldowns": {
      const id = parsed.args[0] === "selected" ? context?.selectedFleetId : parsed.args[0];
      const value = parsed.args[1] === "ready" ? 0 : numberArg(parsed.args[1], "cooldown hours", 0);
      const fleet = id ? ctx.state.fleets.find((candidate) => candidate.id === id) : null;
      const ship = id ? ctx.state.ships.find((candidate) => candidate.id === id) : null;
      const starbase = id ? ctx.state.starbases.find((candidate) => candidate.id === id) : null;
      if (fleet) for (const fleetShip of ctx.state.ships.filter((candidate) => candidate.fleetId === fleet.id)) fleetShip.weaponCooldowns = Object.fromEntries(Object.keys(fleetShip.weaponCooldowns ?? {}).map((key) => [key, value]));
      else if (ship) ship.weaponCooldowns = Object.fromEntries(Object.keys(ship.weaponCooldowns ?? {}).map((key) => [key, value]));
      else if (starbase) starbase.weaponCooldowns = Object.fromEntries(Object.keys(starbase.weaponCooldowns ?? {}).map((key) => [key, value]));
      else throw new Error("Cooldown target not found.");
      return changedResult("Cooldowns updated.", ["ships", "starbases"]);
    }
    case "set_fleet_doctrine": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const stance = commandOption(parsed, "stance");
      const behavior = commandOption(parsed, "behavior");
      const chase = commandOption(parsed, "chase");
      const retreat = commandOption(parsed, "retreat");
      if (stance) fleet.combatStance = normalizeCombatStance(stance);
      fleet.combatSettings = createDefaultFleetCombatSettings({
        ...fleet.combatSettings,
        behavior: isFleetBehavior(behavior) ? behavior : fleet.combatSettings.behavior,
        chasePolicy: isFleetChasePolicy(chase) ? chase : fleet.combatSettings.chasePolicy,
        retreatPolicy: isFleetRetreatPolicy(retreat) ? retreat : fleet.combatSettings.retreatPolicy,
      });
      return changedResult("Fleet doctrine updated.", ["fleets"]);
    }
    case "set_retreat_destination": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const kind = parsed.args[1];
      if (kind === "nearest_friendly_starbase" || kind === "nearestFriendlyStarbase") {
        fleet.combatSettings.retreatDestination = { kind: "nearestFriendlyStarbase" };
      } else if (kind === "selected_system" || kind === "selectedSystem") {
        fleet.combatSettings.retreatDestination = { kind: "selectedSystem", targetStarId: resolveSystemToken(parsed.args[2], context) };
      } else {
        throw new Error("Invalid retreat destination.");
      }
      return changedResult("Retreat destination updated.", ["fleets"]);
    }
    case "order_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const order = parsed.args[1];
      if (order === "hold" || order === "retreat") {
        fleet.currentTacticalOrder = { type: order, issuedAtYear: ctx.state.clock.year };
      } else if (order === "attack") {
        const targetId = parsed.args[2];
        const targetKind = ctx.state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
        fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: ctx.state.clock.year };
      } else if (order === "guard" || order === "move") {
        const { position } = parseSystemPosition(parsed.args, 2, fleet.systemPosition);
        fleet.currentTacticalOrder = order === "guard"
          ? { type: "guard", guardPosition: position, issuedAtYear: ctx.state.clock.year }
          : { type: "move", targetPosition: position, issuedAtYear: ctx.state.clock.year };
      } else {
        throw new Error("Invalid fleet order.");
      }
      return changedResult("Fleet order issued.", ["fleets"]);
    }
    case "clear_order": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      fleet.currentTacticalOrder = null;
      fleet.currentTargetId = null;
      fleet.currentTargetKind = null;
      return changedResult("Fleet order cleared.", ["fleets"]);
    }
    case "start_duel": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const ownerA = resolveOwnerToken(parsed.args[1], context, perspective);
      const ownerB = resolveOwnerToken(parsed.args[2], context, perspective);
      const distance = numberArg(commandOption(parsed, "distance") ?? "40", "distance", 1);
      const countA = integerArg(commandOption(parsed, "countA") ?? "1", "countA", 1, 1000);
      const countB = integerArg(commandOption(parsed, "countB") ?? "1", "countB", 1, 1000);
      const center = systemCenterPosition();
      const left = { x: center.x - distance / 2, y: SYSTEM_FLEET_Y, z: center.z };
      const right = { x: center.x + distance / 2, y: SYSTEM_FLEET_Y, z: center.z };
      const fleetA = createAdminFleetWithShips(ownerA, starId, commandOption(parsed, "designA"), countA, left);
      const fleetB = createAdminFleetWithShips(ownerB, starId, commandOption(parsed, "designB"), countB, right);
      fleetA.currentTacticalOrder = { type: "attack", targetId: fleetB.id, targetKind: "fleet", issuedAtYear: ctx.state.clock.year };
      fleetB.currentTacticalOrder = { type: "attack", targetId: fleetA.id, targetKind: "fleet", issuedAtYear: ctx.state.clock.year };
      refreshDiscovery();
      return changedResult("Duel started.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleetA, fleetB]));
    }
    case "spawn_encounter": {
      const scenario = parsed.args[0];
      const starId = resolveSystemToken(parsed.args[1], context);
      const ownerA = resolvePerspectiveOwner(context, perspective);
      const ownerB = (ownerA + 1) % Math.max(1, ctx.state.factions.length);
      if (scenario === "artillery_vs_starbase") {
        const fleet = createAdminFleetWithShips(ownerA, starId, undefined, 6, { x: -48, y: SYSTEM_FLEET_Y, z: 0 });
        fleet.combatSettings.behavior = "artillery";
        ctx.state.starbases = ctx.state.starbases.filter((starbase) => starbase.starId !== starId);
        ctx.state.starbases.push(createAdminStarbase(starId, ownerB, "starbase", getSystemStarbasePosition()));
      } else if (scenario === "swarm_vs_line") {
        const a = createAdminFleetWithShips(ownerA, starId, undefined, 16, { x: -30, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ownerB, starId, undefined, 10, { x: 30, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.behavior = "swarm"; b.combatSettings.behavior = "line";
      } else if (scenario === "retreat_test") {
        const a = createAdminFleetWithShips(ownerA, starId, undefined, 4, { x: -22, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ownerB, starId, undefined, 12, { x: 22, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.retreatPolicy = "high"; b.combatSettings.behavior = "brawler";
      } else if (scenario === "orbit_defense") {
        ctx.state.starbases.push(createAdminStarbase(starId, ownerA, "starbase", getSystemStarbasePosition()));
        createAdminFleetWithShips(ownerB, starId, undefined, 8, { x: 44, y: SYSTEM_FLEET_Y, z: 0 });
      } else {
        createAdminFleetWithShips(ownerA, starId, undefined, 5, { x: -26, y: SYSTEM_FLEET_Y, z: 0 });
        createAdminFleetWithShips(ownerB, starId, undefined, 5, { x: 26, y: SYSTEM_FLEET_Y, z: 0 });
      }
      refreshDiscovery();
      return changedResult(`Encounter ${scenario} spawned.`, ["ships", "fleets", "starbases", "visibility"]);
    }
    case "force_attack": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const targetId = parsed.args[1];
      const targetKind = ctx.state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
      fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: ctx.state.clock.year };
      return changedResult("Force attack order set.", ["fleets"]);
    }
    case "stop_combat": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all"
        ? ctx.state.fleets
        : token === "system"
          ? ctx.state.fleets.filter((fleet) => fleet.currentStarId === resolveCurrentStarId(context))
          : [resolveFleetToken(token, context)];
      for (const fleet of fleets) {
        fleet.currentTacticalOrder = null;
        fleet.currentTargetId = null;
        fleet.currentTargetKind = null;
        fleet.combatStatus = "idle";
      }
      return changedResult("Combat ctx.state cleared.", ["fleets"]);
    }
    case "set_weapon_cooldown": {
      const id = parsed.args[0];
      const mount = parsed.args[1] ?? "all";
      const value = parsed.args[2] === "ready" ? 0 : numberArg(parsed.args[2], "cooldown hours", 0);
      const ship = ctx.state.ships.find((candidate) => candidate.id === id);
      const starbase = ctx.state.starbases.find((candidate) => candidate.id === id);
      if (ship) {
        const mounts = calculateShipDesignStats(getShipDesignForShip(ctx, ship)).combat.weaponMounts;
        const keys = mount === "all"
          ? mounts.map((m, index) => `${index}:${getWeaponId(m)}`)
          : (() => {
            const mountIndex = integerArg(mount, "mount index", 0, mounts.length - 1);
            return [`${mountIndex}:${getWeaponId(mounts[mountIndex])}`];
          })();
        ship.weaponCooldowns = { ...(ship.weaponCooldowns ?? {}) };
        for (const key of keys) ship.weaponCooldowns[key] = value;
      } else if (starbase) {
        const mounts = getStarbaseWeaponMounts(starbase);
        const keys = mount === "all"
          ? mounts.map((m, index) => `${index}:${getWeaponId(m)}`)
          : (() => {
            const mountIndex = integerArg(mount, "mount index", 0, mounts.length - 1);
            return [`${mountIndex}:${getWeaponId(mounts[mountIndex])}`];
          })();
        starbase.weaponCooldowns = { ...(starbase.weaponCooldowns ?? {}) };
        for (const key of keys) starbase.weaponCooldowns[key] = value;
      } else {
        throw new Error("Weapon cooldown target not found.");
      }
      return changedResult("Weapon cooldown updated.", ["ships", "starbases"]);
    }
    case "effect_test":
    case "fire_test_contact": {
      const sourceId = name === "effect_test" ? parsed.args[1] : parsed.args[0];
      const targetId = name === "effect_test" ? parsed.args[2] : parsed.args[1];
      const sourceFleet = ctx.state.fleets.find((fleet) => fleet.id === sourceId);
      const sourceStarbase = ctx.state.starbases.find((starbase) => starbase.id === sourceId);
      const targetFleet = ctx.state.fleets.find((fleet) => fleet.id === targetId);
      const targetStarbase = ctx.state.starbases.find((starbase) => starbase.id === targetId);
      const sourcePosition = sourceFleet?.systemPosition ?? sourceStarbase?.systemPosition;
      const targetPosition = targetFleet?.systemPosition ?? targetStarbase?.systemPosition;
      if (!sourcePosition || !targetPosition) throw new Error("Source or target not found.");
      const hitMode = name === "effect_test" ? "hit" : parsed.args[3] ?? "hit";
      ctx.state.recentCombatContacts.push({
        id: createRuntimeId("contact", [sourceId, targetId]),
        year: ctx.state.clock.year,
        sourceId,
        sourceKind: sourceFleet ? "fleet" : "starbase",
        sourceOwnerId: sourceFleet?.ownerId ?? sourceStarbase!.ownerId,
        targetId,
        targetKind: targetFleet ? "fleet" : "starbase",
        targetOwnerId: targetFleet?.ownerId ?? targetStarbase!.ownerId,
        weaponId: name === "effect_test" ? parsed.args[0] : parsed.args[2],
        weaponName: name === "effect_test" ? parsed.args[0] : parsed.args[2],
        hit: hitMode === "hit",
        accuracyMiss: hitMode === "miss",
        dodged: hitMode === "dodge",
        shieldDamage: hitMode === "hit" ? 10 : 0,
        armorDamage: 0,
        hullDamage: 0,
        targetDestroyed: false,
        sourcePosition,
        targetPosition,
      });
      ctx.state.recentCombatContacts = ctx.state.recentCombatContacts.slice(-RECENT_COMBAT_CONTACT_HISTORY);
      return changedResult("Test contact added.", ["combatContacts"]);
    }
    case "create_starbase": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const level = (commandOption(parsed, "level") ?? parsed.args[2] ?? "outpost") as StarbaseLevel;
      if (!STARBASE_LEVEL_DEFINITIONS[level]) throw new Error("Invalid starbase level.");
      ctx.state.starbases = ctx.state.starbases.filter((starbase) => starbase.starId !== starId);
      const starbase = createAdminStarbase(starId, owner, level);
      ctx.state.starbases.push(starbase);
      ctx.state.starOwnership[starId] = owner;
      syncSystemOwnershipFromStarbases();
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      refreshDiscovery();
      return changedResult("Starbase created.", ["starbases", "planetStates", "factionEconomies", "visibility"], [{ id: starbase.id, owner, system: starId, level }]);
    }
    case "delete_starbase": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      ctx.state.starbases = ctx.state.starbases.filter((candidate) => candidate.id !== starbase.id);
      syncSystemOwnershipFromStarbases();
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      refreshDiscovery();
      return changedResult("Starbase deleted.", ["starbases", "planetStates", "factionEconomies", "visibility"]);
    }
    case "upgrade_starbase_now": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const level = (parsed.args[1] ?? STARBASE_LEVEL_DEFINITIONS[starbase.level].upgrade?.targetLevel ?? starbase.level) as StarbaseLevel;
      if (!STARBASE_LEVEL_DEFINITIONS[level]) throw new Error("Invalid starbase level.");
      Object.assign(starbase, syncStarbaseCombatHealth({ ...starbase, level, economy: calculateStarbaseEconomy(level, starbase.buildingSlots), constructionQueue: [] }));
      return changedResult("Starbase upgraded.", ["starbases", "factionEconomies"]);
    }
    case "set_starbase_position": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const { position } = parseSystemPosition(parsed.args, 1, starbase.systemPosition);
      starbase.systemPosition = position;
      return changedResult("Starbase position set.", ["starbases"]);
    }
    case "repair_starbase": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      starbase.shield = starbase.maxShield;
      starbase.armor = starbase.maxArmor;
      starbase.hull = starbase.maxHull;
      starbase.weaponCooldowns = {};
      return changedResult("Starbase repaired.", ["starbases"]);
    }
    case "damage_starbase": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      const apply = (key: "shield" | "armor" | "hull", maxKey: "maxShield" | "maxArmor" | "maxHull") => {
        const amount = (parsed.args[2] ?? "0").endsWith("%")
          ? Number((parsed.args[2] ?? "0").slice(0, -1)) / 100 * starbase[maxKey]
          : Number(parsed.args[2] ?? "0");
        starbase[key] = clamp(starbase[key] - Math.max(0, amount), 0, starbase[maxKey]);
      };
      if (layer === "shield" || layer === "all") apply("shield", "maxShield");
      if (layer === "armor" || layer === "all") apply("armor", "maxArmor");
      if (layer === "hull" || layer === "all") apply("hull", "maxHull");
      return changedResult("Starbase damaged.", ["starbases"]);
    }
    case "set_starbase_health": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const shield = commandOption(parsed, "shield");
      const armor = commandOption(parsed, "armor");
      const hull = commandOption(parsed, "hull");
      if (shield) starbase.shield = parseLayerValue(shield, starbase.maxShield);
      if (armor) starbase.armor = parseLayerValue(armor, starbase.maxArmor);
      if (hull) starbase.hull = parseLayerValue(hull, starbase.maxHull);
      return changedResult("Starbase health set.", ["starbases"]);
    }
    case "add_starbase_building": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const slotIndex = integerArg(parsed.args[1], "slot index", 0, starbase.buildingSlots.length - 1);
      const building = parsed.args[2] as StarbaseBuildingKind;
      if (!isStarbaseBuildingKind(building)) throw new Error("Invalid starbase building.");
      starbase.buildingSlots[slotIndex] = building;
      starbase.economy = calculateStarbaseEconomy(starbase.level, starbase.buildingSlots);
      refreshFactionEconomyDeltas();
      return changedResult("Starbase building added.", ["starbases", "factionEconomies"]);
    }
    case "remove_starbase_building": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      const slotIndex = integerArg(parsed.args[1], "slot index", 0, starbase.buildingSlots.length - 1);
      starbase.buildingSlots[slotIndex] = null;
      starbase.economy = calculateStarbaseEconomy(starbase.level, starbase.buildingSlots);
      refreshFactionEconomyDeltas();
      return changedResult("Starbase building removed.", ["starbases", "factionEconomies"]);
    }
    default:
      throw new Error(`Command "${name}" is registered but not implemented.`);
  }
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
    const result = await executeAdminCommand(parsed, command, session.perspective);
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
    if ((ctx.state.starOwnership[planetState.starId] ?? -1) !== factionId) {
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

function getFactionName(factionId: number): string {
  return ctx.state.factions.find((faction) => faction.id === factionId)?.name ?? `Faction ${factionId}`;
}

function getDiplomacyCommandFaction(socket: WebSocket, perspective: GalaxyPerspective): number | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }
  if (!ctx.state.factions.some((faction) => faction.id === factionId)) {
    reject(socket, "Your country is not available.");
    return null;
  }
  return factionId;
}

function getDiplomacyTarget(socket: WebSocket, actorFactionId: number, targetFactionId: number): FactionInfo | null {
  if (!Number.isInteger(targetFactionId) || targetFactionId === actorFactionId) {
    reject(socket, "Select another country.");
    return null;
  }
  const target = ctx.state.factions.find((faction) => faction.id === targetFactionId);
  if (!target) {
    reject(socket, "Country not found.");
    return null;
  }
  return target;
}

function normalizeDiplomacyAfterMutation(): void {
  const normalized = normalizeDiplomacyState(
    ctx.state.diplomacy,
    ctx.state.factions.map((faction) => faction.id),
  );
  ctx.state.diplomacy = normalized.state;
}

function commitDiplomacyChange(socket: WebSocket, message: string, changed: ServerUpdateField[] = ["diplomacy"]): void {
  normalizeDiplomacyAfterMutation();
  ctx.hasDirtyState = true;
  accept(socket, message);
  broadcastUpdates(changed);
}

function handleSendDiplomacyMessage(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  body: string,
): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedBody = String(body ?? "").trim().slice(0, 500);
  if (!normalizedBody) return reject(socket, "Message is empty.");
  ctx.state.diplomacy.chatMessages.push({
    id: createRuntimeId("diplomacy-message", [factionId, target.id]),
    fromFactionId: factionId,
    toFactionId: target.id,
    body: normalizedBody,
    createdAtYear: ctx.state.clock.year,
  });
  commitDiplomacyChange(socket, "Message sent.");
}

function handleSetBorderPolicy(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  policy: BorderPolicy,
): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedPolicy: BorderPolicy = policy === "open" ? "open" : "closed";
  setBorderPolicy(ctx.state.diplomacy, factionId, target.id, normalizedPolicy);
  commitDiplomacyChange(socket, `Borders ${normalizedPolicy === "open" ? "opened" : "closed"} to ${target.name}.`);
}

function handleDeclareWar(socket: WebSocket, perspective: GalaxyPerspective, targetFactionId: number): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  if (areFactionsAtWar(ctx.state.diplomacy, factionId, target.id)) {
    return reject(socket, `You are already at war with ${target.name}.`);
  }
  ctx.state.diplomacy.wars.push({
    id: createRuntimeId("war", [factionId, target.id]),
    attackerFactionId: factionId,
    defenderFactionId: target.id,
    startedAtYear: ctx.state.clock.year,
    endedAtYear: null,
    preWarOwnership: toOwnershipEntries(ctx.state.starOwnership),
  });
  commitDiplomacyChange(
    socket,
    `War declared on ${target.name}.`,
    ["diplomacy", "market", "fleets", "starbases", "combatContacts"],
  );
}

function getPendingDiplomacyProposal(proposalId: string): DiplomacyProposal | null {
  return ctx.state.diplomacy.proposals.find((proposal) => (
    proposal.id === proposalId && proposal.status === "pending"
  )) ?? null;
}

function createDiplomacyTreaty(
  factionA: number,
  factionB: number,
  articleIds: TreatyArticleId[],
  proposedByFactionId: number,
  acceptedByFactionId: number,
  durationYears: number,
  id = createRuntimeId("treaty", [factionA, factionB]),
): DiplomacyTreaty {
  const factionIds: [number, number] = factionA < factionB ? [factionA, factionB] : [factionB, factionA];
  const startedAtYear = ctx.state.clock.year;
  return {
    id,
    factionIds,
    articleIds,
    proposedByFactionId,
    acceptedByFactionId,
    startedAtYear,
    minimumEndYear: startedAtYear + clampTreatyDurationYears(durationYears),
    cancelledAtYear: null,
    earlyCancelled: false,
    cancellationReason: null,
    replacedByTreatyId: null,
  };
}

function replaceOverlappingTreaties(nextTreaty: DiplomacyTreaty, requestedReplacesTreatyId?: string | null): void {
  const replacements = ctx.state.diplomacy.treaties.filter((treaty) => {
    if (Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return false;
    if (!getActiveTreatiesBetween(ctx.state.diplomacy, nextTreaty.factionIds[0], nextTreaty.factionIds[1]).includes(treaty)) return false;
    if (requestedReplacesTreatyId && treaty.id === requestedReplacesTreatyId) return true;
    return treaty.articleIds.some((articleId) => nextTreaty.articleIds.includes(articleId));
  });
  for (const treaty of replacements) {
    treaty.cancelledAtYear = ctx.state.clock.year;
    treaty.earlyCancelled = ctx.state.clock.year < treaty.minimumEndYear;
    treaty.cancellationReason = "renegotiated";
    treaty.replacedByTreatyId = nextTreaty.id;
  }
}

function handleProposeTreaty(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  articleIds: TreatyArticleId[],
  durationYears?: number,
  replacesTreatyId?: string | null,
): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  const normalizedArticleIds = normalizeTreatyArticleIds(articleIds);
  if (normalizedArticleIds.length === 0) return reject(socket, "Select at least one treaty article.");
  const normalizedDuration = clampTreatyDurationYears(durationYears);
  if (replacesTreatyId) {
    const treaty = ctx.state.diplomacy.treaties.find((candidate) => candidate.id === replacesTreatyId);
    if (
      !treaty
      || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)
      || !getActiveTreatiesBetween(ctx.state.diplomacy, factionId, target.id).includes(treaty)
    ) {
      return reject(socket, "Treaty to renegotiate is not active.");
    }
  }
  ctx.state.diplomacy.proposals.push({
    id: createRuntimeId("treaty-proposal", [factionId, target.id]),
    kind: "treaty",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedArticleIds,
    durationYears: normalizedDuration,
    peaceTerms: null,
    status: "pending",
    createdAtYear: ctx.state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: replacesTreatyId ?? null,
  });
  commitDiplomacyChange(socket, `Treaty proposed to ${target.name}.`);
}

function cancelOtherPendingPeaceProposals(war: DiplomacyWar, acceptedProposalId: string): void {
  for (const proposal of ctx.state.diplomacy.proposals) {
    if (
      proposal.id !== acceptedProposalId
      && proposal.kind === "peace"
      && proposal.status === "pending"
      && (
        (proposal.fromFactionId === war.attackerFactionId && proposal.toFactionId === war.defenderFactionId)
        || (proposal.fromFactionId === war.defenderFactionId && proposal.toFactionId === war.attackerFactionId)
      )
    ) {
      proposal.status = "cancelled";
      proposal.resolvedAtYear = ctx.state.clock.year;
    }
  }
}

function applyPeaceTerms(war: DiplomacyWar, proposal: DiplomacyProposal, responseFactionId: number): ServerUpdateField[] {
  const terms = normalizePeaceTerms(proposal.peaceTerms);
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  if (terms.mode === "whitePeace") {
    for (const [starId, ownerId] of war.preWarOwnership) {
      if (!participants.has(ownerId)) continue;
      const starbase = getStarbaseInSystem(starId);
      if (!starbase || !participants.has(starbase.ownerId)) continue;
      starbase.ownerId = ownerId;
    }
  }

  for (const transfer of terms.transfers) {
    if (!isValidPeaceTransferTerm(transfer, war)) continue;
    const starbase = ctx.state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
    if (!starbase || starbase.ownerId !== transfer.fromFactionId) continue;
    starbase.ownerId = transfer.toFactionId;
  }

  war.endedAtYear = ctx.state.clock.year;
  cancelOtherPendingPeaceProposals(war, proposal.id);

  if (terms.enforcedArticleIds.length > 0) {
    const treaty = createDiplomacyTreaty(
      war.attackerFactionId,
      war.defenderFactionId,
      terms.enforcedArticleIds,
      proposal.fromFactionId,
      responseFactionId,
      terms.enforcedDurationYears,
    );
    replaceOverlappingTreaties(treaty, null);
    ctx.state.diplomacy.treaties.push(treaty);
  }

  syncSystemOwnershipFromStarbases();
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  refreshDiscovery();
  return ["diplomacy", "starbases", "visibility", "planetStates", "factionEconomies", "market", "fleets", "combatContacts"];
}

function handleRespondDiplomacyProposal(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  proposalId: string,
  response: "accept" | "decline",
): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const proposal = getPendingDiplomacyProposal(String(proposalId ?? ""));
  if (!proposal) return reject(socket, "Proposal is not pending.");
  if (proposal.toFactionId !== factionId) return reject(socket, "Only the recipient can respond to this proposal.");
  if (response !== "accept") {
    proposal.status = "declined";
    proposal.resolvedAtYear = ctx.state.clock.year;
    proposal.responseByFactionId = factionId;
    return commitDiplomacyChange(socket, "Proposal declined.");
  }

  let changed: ServerUpdateField[] = ["diplomacy", "market"];
  if (proposal.kind === "treaty") {
    const treaty = createDiplomacyTreaty(
      proposal.fromFactionId,
      proposal.toFactionId,
      proposal.articleIds,
      proposal.fromFactionId,
      factionId,
      proposal.durationYears,
    );
    replaceOverlappingTreaties(treaty, proposal.replacesTreatyId);
    ctx.state.diplomacy.treaties.push(treaty);
  } else {
    const war = getActiveWar(ctx.state.diplomacy, proposal.fromFactionId, proposal.toFactionId);
    if (!war) return reject(socket, "There is no active war to end.");
    changed = applyPeaceTerms(war, proposal, factionId);
  }

  proposal.status = "accepted";
  proposal.resolvedAtYear = ctx.state.clock.year;
  proposal.responseByFactionId = factionId;
  commitDiplomacyChange(socket, proposal.kind === "peace" ? "Peace accepted." : "Treaty accepted.", changed);
}

function handleCancelDiplomacyProposal(socket: WebSocket, perspective: GalaxyPerspective, proposalId: string): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const proposal = getPendingDiplomacyProposal(String(proposalId ?? ""));
  if (!proposal) return reject(socket, "Proposal is not pending.");
  if (proposal.fromFactionId !== factionId) return reject(socket, "Only the proposer can cancel this proposal.");
  proposal.status = "cancelled";
  proposal.resolvedAtYear = ctx.state.clock.year;
  proposal.responseByFactionId = factionId;
  commitDiplomacyChange(socket, "Proposal cancelled.");
}

function handleCancelTreaty(socket: WebSocket, perspective: GalaxyPerspective, treatyId: string): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const treaty = ctx.state.diplomacy.treaties.find((candidate) => candidate.id === String(treatyId ?? ""));
  if (!treaty || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return reject(socket, "Active treaty not found.");
  if (treaty.factionIds[0] !== factionId && treaty.factionIds[1] !== factionId) {
    return reject(socket, "You are not part of this treaty.");
  }
  const partnerId = treaty.factionIds[0] === factionId ? treaty.factionIds[1] : treaty.factionIds[0];
  const war = getActiveWar(ctx.state.diplomacy, factionId, partnerId);
  treaty.cancelledAtYear = ctx.state.clock.year;
  treaty.earlyCancelled = ctx.state.clock.year < treaty.minimumEndYear;
  treaty.cancellationReason = war?.defenderFactionId === factionId ? "defenderWarCancel" : treaty.earlyCancelled ? "earlyCancellation" : "cancelled";
  commitDiplomacyChange(socket, "Treaty cancelled.", ["diplomacy", "market"]);
}

function isValidPeaceTransferTerm(transfer: DiplomacySystemTransferTerm, war: DiplomacyWar): boolean {
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  if (!participants.has(transfer.fromFactionId) || !participants.has(transfer.toFactionId)) return false;
  if (transfer.fromFactionId === transfer.toFactionId) return false;
  const starbase = ctx.state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
  return !!starbase && starbase.ownerId === transfer.fromFactionId;
}

function validatePeaceTerms(socket: WebSocket, war: DiplomacyWar, terms: DiplomacyPeaceTerms): DiplomacyPeaceTerms | null {
  const normalized = normalizePeaceTerms(terms);
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  for (const transfer of normalized.transfers) {
    if (!participants.has(transfer.fromFactionId) || !participants.has(transfer.toFactionId)) {
      reject(socket, "Peace transfer must stay between war participants.");
      return null;
    }
    if (!ctx.state.starbases.some((starbase) => starbase.id === transfer.starbaseId)) {
      reject(socket, "Peace transfer starbase not found.");
      return null;
    }
  }
  return normalized;
}

function handleProposePeace(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  targetFactionId: number,
  terms: DiplomacyPeaceTerms,
): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  const war = getActiveWar(ctx.state.diplomacy, factionId, target.id);
  if (!war) return reject(socket, `You are not at war with ${target.name}.`);
  const normalizedTerms = validatePeaceTerms(socket, war, terms);
  if (!normalizedTerms) return;
  const existing = ctx.state.diplomacy.proposals.some((proposal) => (
    proposal.kind === "peace"
    && proposal.status === "pending"
    && (
      (proposal.fromFactionId === factionId && proposal.toFactionId === target.id)
      || (proposal.fromFactionId === target.id && proposal.toFactionId === factionId)
    )
  ));
  if (existing) return reject(socket, "A peace proposal is already pending.");
  ctx.state.diplomacy.proposals.push({
    id: createRuntimeId("peace-proposal", [factionId, target.id]),
    kind: "peace",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedTerms.enforcedArticleIds,
    durationYears: normalizedTerms.enforcedDurationYears,
    peaceTerms: normalizedTerms,
    status: "pending",
    createdAtYear: ctx.state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: null,
  });
  commitDiplomacyChange(socket, `Peace proposed to ${target.name}.`);
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
    handleSendDiplomacyMessage(session.socket, session.perspective, command.targetFactionId, command.body);
    return;
  }
  if (command.type === "setBorderPolicy") {
    handleSetBorderPolicy(session.socket, session.perspective, command.targetFactionId, command.policy);
    return;
  }
  if (command.type === "declareWar") {
    handleDeclareWar(session.socket, session.perspective, command.targetFactionId);
    return;
  }
  if (command.type === "proposeTreaty") {
    handleProposeTreaty(
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
    handleRespondDiplomacyProposal(session.socket, session.perspective, command.proposalId, command.response);
    return;
  }
  if (command.type === "cancelTreaty") {
    handleCancelTreaty(session.socket, session.perspective, command.treatyId);
    return;
  }
  if (command.type === "cancelDiplomacyProposal") {
    handleCancelDiplomacyProposal(session.socket, session.perspective, command.proposalId);
    return;
  }
  if (command.type === "proposePeace") {
    handleProposePeace(session.socket, session.perspective, command.targetFactionId, command.terms);
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
  if (command.type === "cancelPlanetConstruction") {
    handleCancelPlanetConstruction(session.socket, session.perspective, command.planetId, command.queueItemId);
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
ctx.state = await loadState();
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


