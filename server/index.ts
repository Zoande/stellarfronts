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
  BUILDING_MINERAL_COSTS,
  cloneResourceCounts,
  createBuildingConstructionQueueItem,
  createDistrictConstructionQueueItem,
  createEmptyResourceCounts,
  createInitialFactionEconomyState,
  DISTRICT_MINERAL_COSTS,
  filterInvalidQueuedBuildingsForSubDistrictChange,
  getEffectiveSpeciesHabitability,
  getQueuedDistrictCount,
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
  PlanetModifier,
  PlanetEconomySpeciesContext,
  ResourceKind,
  ResourceCounts,
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
  formatLeaderClass,
  getLeaderAssignmentClass,
  getLeaderTraitDefinition,
  LEADER_POOL_PER_CLASS,
  normalizeLeadersForFactions,
  refreshLeaderPool,
} from "../src/data/Leaders";
import type { LeaderAssignment, LeaderClass, LeaderFleetEffects, LeaderState } from "../src/data/Leaders";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
const DISCOVERY_JUMPS = 2;
const DEPART_DURATION_MS = 20_000;
const JUMP_DURATION_MS = 10_000;
const ARRIVE_DURATION_MS = 30_000;
const BUILD_DURATION_MS = 180_000;
const SAVE_INTERVAL_MS = 5_000;
const SERVER_TICK_INTERVAL_MS = 100;
const RUNTIME_STATS_INTERVAL_MS = 5_000;
const RUNTIME_CATALOG_SYNC_INTERVAL_MS = 1_000;
const GAME_SERVER_STARTED_AT = Date.now();
const DEFAULT_TICK_SIZE_DAYS = 1 / 24;
const DEFAULT_TICK_SPEED_SECONDS = 1;
const DEFAULT_SHIP_SPEED = STARBASE_SHIP_DEFINITIONS.corvette.speed;
const STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY = 0.025;
const STARBASE_HULL_REPAIR_FRACTION_PER_DAY = 0.012;
const STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT = 0.035;
const STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT = 0.06;
const STARBASE_REPAIR_ENERGY_COST_PER_POINT = 0.015;
const EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION = 1;
const EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION = 0.18;
const EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION = 0.12;
const EMERGENCY_RETREAT_SHIP_LOSS_CHANCE = 0.06;
const EMERGENCY_RETREAT_MIN_MIA_DAYS = 8;
const EMERGENCY_RETREAT_DISTANCE_MIA_DIVISOR = 14;
const SYSTEM_FLEET_SPEED_UNITS_PER_DAY = 10.4;
const SYSTEM_PLANET_ORBIT_DISTANCE = 3.4;
const STARBASE_TACTICAL_RADIUS = 7;
const RECENT_COMBAT_CONTACT_HISTORY = 160;
const FLEET_GUARD_RADIUS = 72;
const FLEET_EVADE_DISTANCE = 34;
const FLEET_SOFT_SEPARATION_FACTOR = 0.35;
const FLEET_RETREAT_THRESHOLDS: Record<FleetRetreatPolicy, number> = {
  none: 0,
  low: 0.25,
  medium: 0.5,
  high: 0.75,
};

interface GameFleet extends ServerFleet {
  phaseElapsedMs: number;
}

interface GameShip extends ServerShip {}

interface GameState {
  schemaVersion: 20;
  stars: StarData[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  factionTechnologies: FactionTechState[];
  governments: FactionGovernmentState[];
  species: SpeciesState[];
  speciesRights: FactionSpeciesRightsState[];
  diplomacy: DiplomacyState;
  market: MarketState;
  leaders: LeaderState[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  shipDesigns: ShipDesign[];
  ships: GameShip[];
  fleets: GameFleet[];
  recentCombatContacts: ServerCombatContact[];
  discoveredByFaction: Record<string, number[]>;
  lastKnownOwnershipByFaction: Record<string, number[]>;
  clock: GameClock & { lastUpdatedAt: number; lastProcessedPopulationWeek: number; lastProcessedLeaderDay: number };
}

interface DetailSubscription {
  scope: GameDetailScope;
  id: string | number | null;
  lastRevision: string | null;
}

interface ClientSession {
  socket: WebSocket;
  account: AuthAccount;
  perspective: GalaxyPerspective;
  detailSubscriptions: Map<string, DetailSubscription>;
  sentInitialSnapshot: boolean;
}

interface GameRuntime {
  game: StoredGame;
  attachClient: (socket: WebSocket, account: AuthAccount, perspective: GalaxyPerspective) => void;
  touchMembershipNames: () => void;
  tick: (now: number) => void;
  save: () => Promise<void>;
  dispose: (message?: string, deleteState?: boolean) => Promise<void>;
  getStats: () => DevGameRuntimeRow;
}

const FLEET_FORMATIONS: FleetFormation[] = ["line", "vanguard", "echelon", "defensive"];
const COMBAT_STANCES: CombatStance[] = ["passive", "evade", "holdPosition", "guardArea", "defendSystem", "aggressive", "hunt"];
const FLEET_BEHAVIORS: FleetBehavior[] = ["artillery", "line", "brawler", "swarm", "defender"];
const FLEET_CHASE_POLICIES: FleetChasePolicy[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
const FLEET_RETREAT_POLICIES: FleetRetreatPolicy[] = ["none", "low", "medium", "high"];
const FLEET_TACTICAL_ORDER_TYPES: FleetTacticalOrderType[] = ["move", "attack", "hold", "guard", "retreat"];

function computeSpeedMultiplier(tickSizeDays: number, tickSpeedSeconds: number, paused: boolean): number {
  if (paused) return 0;
  return Math.max(0, tickSizeDays * 24 / Math.max(0.01, tickSpeedSeconds));
}

function normalizeClock(clock: Partial<GameState["clock"]> | undefined, now = Date.now()): GameState["clock"] {
  const tickSizeDays = Math.max(0.000001, Number(clock?.tickSizeDays) || DEFAULT_TICK_SIZE_DAYS);
  const tickSpeedSeconds = Math.max(0.01, Number(clock?.tickSpeedSeconds) || DEFAULT_TICK_SPEED_SECONDS);
  const paused = clock?.paused === true;
  return {
    year: Number.isFinite(clock?.year) ? Number(clock?.year) : GAME_START_YEAR,
    tickSizeDays,
    tickSpeedSeconds,
    paused,
    speedMultiplier: computeSpeedMultiplier(tickSizeDays, tickSpeedSeconds, paused),
    syncedAtMs: Number(clock?.syncedAtMs) || now,
    lastUpdatedAt: Number(clock?.lastUpdatedAt) || now,
    lastProcessedPopulationWeek: Number(clock?.lastProcessedPopulationWeek) || gameYearToWeekIndex(Number(clock?.year) || GAME_START_YEAR),
    lastProcessedLeaderDay: Number(clock?.lastProcessedLeaderDay) || Math.floor((Number(clock?.year) || GAME_START_YEAR) * GAME_DAYS_PER_YEAR),
  };
}

async function createGameRuntime(game: StoredGame): Promise<GameRuntime> {
const statePath = getGameStatePath(game.id);
const clients = new Set<ClientSession>();
const pendingPlanetDetailRefreshes = new Set<string>();
let state: GameState;
let lastSaveAt = 0;
let hasDirtyState = false;
let runtimeIdCounter = 0;

function createDetailKey(scope: GameDetailScope, id: string | number | null | undefined): string {
  return `${scope}:${id ?? ""}`;
}

function syncClockSpeedFields(): void {
  state.clock.tickSizeDays = Math.max(0.000001, Number(state.clock.tickSizeDays) || DEFAULT_TICK_SIZE_DAYS);
  state.clock.tickSpeedSeconds = Math.max(0.01, Number(state.clock.tickSpeedSeconds) || DEFAULT_TICK_SPEED_SECONDS);
  state.clock.paused = state.clock.paused === true;
  state.clock.speedMultiplier = computeSpeedMultiplier(
    state.clock.tickSizeDays,
    state.clock.tickSpeedSeconds,
    state.clock.paused,
  );
}

function isFleetFormation(value: string | undefined): value is FleetFormation {
  return !!value && FLEET_FORMATIONS.includes(value as FleetFormation);
}

function isCombatStance(value: string | undefined): value is CombatStance {
  return !!value && COMBAT_STANCES.includes(value as CombatStance);
}

function normalizeCombatStance(value: unknown): CombatStance {
  if (value === "defensive") return "defendSystem";
  if (typeof value === "string" && isCombatStance(value)) return value;
  return "aggressive";
}

function isFleetBehavior(value: unknown): value is FleetBehavior {
  return typeof value === "string" && FLEET_BEHAVIORS.includes(value as FleetBehavior);
}

function isFleetChasePolicy(value: unknown): value is FleetChasePolicy {
  return typeof value === "string" && FLEET_CHASE_POLICIES.includes(value as FleetChasePolicy);
}

function isFleetRetreatPolicy(value: unknown): value is FleetRetreatPolicy {
  return typeof value === "string" && FLEET_RETREAT_POLICIES.includes(value as FleetRetreatPolicy);
}

function isFleetTacticalOrderType(value: unknown): value is FleetTacticalOrderType {
  return typeof value === "string" && FLEET_TACTICAL_ORDER_TYPES.includes(value as FleetTacticalOrderType);
}

function createRuntimeId(prefix: string, parts: Array<string | number | undefined> = []): string {
  runtimeIdCounter += 1;
  const cleanParts = parts.filter((part) => part !== undefined && part !== "");
  return `${prefix}-${cleanParts.join("-")}-${Date.now().toString(36)}-${runtimeIdCounter.toString(36)}`;
}

function systemCenterPosition() {
  return getSystemFleetStagingPosition();
}

function systemExitPosition(fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">) {
  const fromStar = state.stars[fleet.currentStarId];
  const toStarId = fleet.route[fleet.routeIndex + 1];
  const toStar = Number.isInteger(toStarId) ? state.stars[toStarId] : undefined;
  return fromStar && toStar ? getSystemHyperlaneExitPosition(fromStar, toStar) : getSystemFleetStagingPosition();
}

function systemEntryPosition(fleet: Pick<GameFleet, "currentStarId" | "route" | "routeIndex">) {
  const toStar = state.stars[fleet.currentStarId];
  const fromStarId = fleet.route[fleet.routeIndex - 1];
  const fromStar = Number.isInteger(fromStarId) ? state.stars[fromStarId] : undefined;
  return fromStar && toStar ? getSystemHyperlaneEntryPosition(fromStar, toStar) : getSystemFleetStagingPosition();
}

function getPlanetDistrictLimitsFromState(nextState: GameState, planetState: PlanetState) {
  return nextState.stars[planetState.starId]?.system.planets[planetState.planetIndex]?.objectDetails.districtLimits ?? undefined;
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

function getSpeciesLawSelections(nextState: GameState, factionId: number): SpeciesLawSelections {
  const government = getFactionGovernment(nextState, factionId);
  const selected = getSelectedGovernmentLawOptions(government);
  return {
    civilRights: selected.find((entry) => entry.law.id === "civilRights")?.option.id,
    speciesPolicy: selected.find((entry) => entry.law.id === "speciesPolicy")?.option.id,
  };
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

function getFactionSpeciesRightsState(nextState: GameState, factionId: number): FactionSpeciesRightsState {
  return nextState.speciesRights.find((rights) => rights.factionId === factionId)
    ?? createDefaultSpeciesRightsState(factionId, nextState.species.map((species) => species.id));
}

function getSpeciesRightsForFaction(nextState: GameState, factionId: number, speciesId: SpeciesId): SpeciesRights {
  const rightsState = getFactionSpeciesRightsState(nextState, factionId);
  return normalizeSpeciesRightsForLaws(
    rightsState.rightsBySpeciesId?.[speciesId] ?? DEFAULT_SPECIES_RIGHTS,
    getSpeciesLawSelections(nextState, factionId),
  );
}

function getPlanetSpeciesContext(nextState: GameState, planetState: PlanetState): PlanetEconomySpeciesContext | undefined {
  const ownerId = nextState.starOwnership[planetState.starId] ?? -1;
  if (!Number.isInteger(ownerId) || ownerId < 0) {
    return { species: nextState.species, rightsBySpeciesId: {} };
  }
  const rightsState = getFactionSpeciesRightsState(nextState, ownerId);
  return {
    species: nextState.species,
    rightsBySpeciesId: rightsState.rightsBySpeciesId,
  };
}

function getEmpireSpeciesIds(nextState: GameState, factionId: number): SpeciesId[] {
  const ids = new Set<SpeciesId>();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited || (nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const population of planetState.speciesPopulations ?? []) {
      if (population.population > 0) ids.add(population.speciesId);
    }
  }
  const foundingSpeciesId = nextState.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId;
  if (foundingSpeciesId && ids.size === 0) ids.add(foundingSpeciesId);
  return Array.from(ids).sort((a, b) => a.localeCompare(b));
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

function recalculatePlanetEconomies(nextState = state): void {
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

function getPlanetDetailSignature(planetState: PlanetState): string {
  return JSON.stringify(planetState);
}

function queueChangedPlanetDetailRefreshes(previousSignatures: Map<string, string>): boolean {
  let changed = false;
  for (const planetState of state.planetStates) {
    if (previousSignatures.get(planetState.id) === getPlanetDetailSignature(planetState)) continue;
    queuePlanetDetailRefresh(planetState.id);
    changed = true;
  }
  return changed;
}

function calculateFactionMonthlyDelta(nextState: GameState, factionId: number) {
  let delta = createEmptyResourceCounts();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    delta = addResourceCounts(delta, planetState.economy.net);
  }
  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId || starbase.status !== "online") continue;
    delta = addResourceCounts(delta, starbase.economy.net);
  }
  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId || ship.hull <= 0) continue;
    const design = resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId);
    const fleet = nextState.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const upkeepMultiplier = fleet
      ? getFleetLeaderEffects(nextState, fleet.id).upkeepMultiplier
        * getGovernmentFleetEffects(nextState, fleet.ownerId).upkeepMultiplier
      : getGovernmentFleetEffects(nextState, ship.ownerId).upkeepMultiplier;
    delta = addResourceCounts(delta, scaleResourceCounts(calculateShipDesignStats(design).upkeep, -upkeepMultiplier));
  }
  return delta;
}

function calculateFactionMarketMonthlyDelta(nextState: GameState, factionId: number): ResourceCounts {
  const delta = createEmptyResourceCounts();
  const flows = calculateFactionResourceFlow(nextState, factionId);
  const orders = nextState.market?.autoTrades ?? [];
  for (const order of orders) {
    if (!order.enabled || order.playerId !== factionId || order.amountPerHour <= 0) continue;
    const resource = nextState.market.resources.find((candidate) => candidate.resourceId === order.resourceId);
    if (!resource?.marketEnabled) continue;
    const quote = calculatePlayerMarketQuote(resource, factionId, flows, nextState);
    const amountPerMonth = order.amountPerHour * GAME_HOURS_PER_MONTH;
    if (order.type === "auto_buy") {
      delta[order.resourceId] += amountPerMonth;
      delta.energy -= amountPerMonth * quote.buyPrice;
    } else {
      delta[order.resourceId] -= amountPerMonth;
      delta.energy += amountPerMonth * quote.sellPrice;
    }
  }
  return delta;
}

function getFactionResourceShortageSeverity(nextState: GameState, factionId: number, resource: ResourceKind): number {
  const economy = nextState.factionEconomies.find((candidate) => candidate.factionId === factionId);
  if (!economy) return 0;
  const shortage = Math.max(0, -economy.stockpiles[resource]);
  if (shortage <= 0) return 0;
  const monthlyPressure = Math.max(250, Math.abs(economy.monthlyDelta[resource]) * 0.5);
  return clamp(Math.sqrt(shortage / monthlyPressure), 0, 1);
}

function shortageModifier(
  resource: ResourceKind,
  id: string,
  label: string,
  target: PlanetModifier["target"],
  operation: PlanetModifier["operation"],
  value: number,
): PlanetModifier {
  return {
    id: `shortage-${resource}-${id}`,
    label,
    source: `shortage:${resource}`,
    target,
    operation,
    value,
  };
}

function getFactionShortagePlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const food = getFactionResourceShortageSeverity(nextState, factionId, "food");
  const goods = getFactionResourceShortageSeverity(nextState, factionId, "goods");
  const energy = getFactionResourceShortageSeverity(nextState, factionId, "energy");
  const minerals = getFactionResourceShortageSeverity(nextState, factionId, "minerals");
  const alloys = getFactionResourceShortageSeverity(nextState, factionId, "alloys");
  const modifiers: PlanetModifier[] = [];

  if (food > 0) {
    modifiers.push(
      shortageModifier("food", "happiness", "Food Shortage", "happiness", "add", -50 * food),
      shortageModifier("food", "stability", "Food Shortage", "stability", "add", -28 * food),
      shortageModifier("food", "growth", "Food Shortage", "populationGrowth", "multiply", -0.8 * food),
      shortageModifier("food", "output", "Food Shortage", "jobOutput", "multiply", -0.2 * food),
    );
  }
  if (goods > 0) {
    modifiers.push(
      shortageModifier("goods", "happiness", "Goods Shortage", "happiness", "add", -24 * goods),
      shortageModifier("goods", "stability", "Goods Shortage", "stability", "add", -18 * goods),
      shortageModifier("goods", "research", "Goods Shortage", "jobOutput:researcher:research", "multiply", -0.35 * goods),
      shortageModifier("goods", "amenities", "Goods Shortage", "jobAmenities:entertainer", "multiply", -0.45 * goods),
    );
  }
  if (energy > 0) {
    modifiers.push(
      shortageModifier("energy", "stability", "Energy Shortage", "stability", "add", -20 * energy),
      shortageModifier("energy", "output", "Energy Shortage", "jobOutput", "multiply", -0.35 * energy),
      shortageModifier("energy", "construction", "Energy Shortage", "constructionSpeed", "multiply", -0.25 * energy),
    );
  }
  if (minerals > 0) {
    modifiers.push(
      shortageModifier("minerals", "construction", "Mineral Shortage", "constructionSpeed", "multiply", -0.55 * minerals),
      shortageModifier("minerals", "goods", "Mineral Shortage", "jobOutput:artisan:goods", "multiply", -0.4 * minerals),
      shortageModifier("minerals", "alloys", "Mineral Shortage", "jobOutput:metallurgist:alloys", "multiply", -0.4 * minerals),
    );
  }
  if (alloys > 0) {
    modifiers.push(
      shortageModifier("alloys", "stability", "Alloy Shortage", "stability", "add", -8 * alloys),
      shortageModifier("alloys", "construction", "Alloy Shortage", "constructionSpeed", "multiply", -0.2 * alloys),
    );
  }
  return modifiers;
}

function getFactionFleetShortageEffects(nextState: GameState, factionId: number): {
  attackMultiplier: number;
  speedMultiplier: number;
  shieldMultiplier: number;
} {
  const food = getFactionResourceShortageSeverity(nextState, factionId, "food");
  const goods = getFactionResourceShortageSeverity(nextState, factionId, "goods");
  const energy = getFactionResourceShortageSeverity(nextState, factionId, "energy");
  const alloys = getFactionResourceShortageSeverity(nextState, factionId, "alloys");
  return {
    attackMultiplier: clamp(1 - energy * 0.35 - alloys * 0.3 - goods * 0.15 - food * 0.1, 0.35, 1),
    speedMultiplier: clamp(1 - energy * 0.3 - alloys * 0.2 - food * 0.1, 0.4, 1),
    shieldMultiplier: clamp(1 - energy * 0.75, 0.2, 1),
  };
}

function getLeaderDayIndex(year: number): number {
  return Math.floor(year * GAME_DAYS_PER_YEAR);
}

function getLeaderLevelScale(leader: Pick<LeaderState, "level">): number {
  return 1 + Math.max(0, leader.level - 1) * 0.01;
}

function getAssignedLeader(
  nextState: GameState,
  assignmentKind: LeaderAssignment["kind"],
  targetId: string,
): LeaderState | null {
  return nextState.leaders.find((leader) => (
    leader.status === "recruited"
    && leader.assignment?.kind === assignmentKind
    && leader.assignment.targetId === targetId
  )) ?? null;
}

interface GovernmentEffectInstance {
  sourceId: string;
  label: string;
  effect: GovernmentEffect;
  scale: number;
}

function getFactionGovernment(nextState: GameState, factionId: number): FactionGovernmentState {
  return nextState.governments.find((government) => government.factionId === factionId)
    ?? createInitialGovernmentState(factionId);
}

function getAssignedGovernmentLeader(
  nextState: GameState,
  factionId: number,
  positionId: GovernmentPositionId,
): LeaderState | null {
  return nextState.leaders.find((leader) => (
    leader.factionId === factionId
    && leader.status === "recruited"
    && leader.assignment?.kind === "government"
    && leader.assignment.targetId === positionId
  )) ?? null;
}

function addGovernmentEffectInstances(
  instances: GovernmentEffectInstance[],
  sourceId: string,
  label: string,
  effects: GovernmentEffect[],
  scale = 1,
): void {
  effects.forEach((effect, index) => {
    instances.push({
      sourceId: `${sourceId}-${index}`,
      label,
      effect,
      scale,
    });
  });
}

function getGovernmentEffectInstances(nextState: GameState, factionId: number): GovernmentEffectInstance[] {
  const instances: GovernmentEffectInstance[] = [];
  const government = getFactionGovernment(nextState, factionId);
  for (const { law, option } of getSelectedGovernmentLawOptions(government)) {
    addGovernmentEffectInstances(instances, `law-${law.id}-${option.id}`, `${law.name}: ${option.name}`, option.effects);
  }

  for (const position of Object.values(getGovernmentPositionDefinitionMap())) {
    const leader = getAssignedGovernmentLeader(nextState, factionId, position.id);
    if (!leader || leader.class !== position.requiredClass) continue;
    addGovernmentEffectInstances(
      instances,
      `cabinet-${position.id}-${leader.id}-level`,
      `${position.title}: ${leader.name}`,
      position.levelEffects,
      Math.max(1, leader.level),
    );
    const leaderScale = getLeaderLevelScale(leader);
    for (const traitId of leader.traits) {
      const trait = getLeaderTraitDefinition(traitId);
      for (const traitEffect of trait.governmentEffects ?? []) {
        if (traitEffect.positionId && traitEffect.positionId !== "any" && traitEffect.positionId !== position.id) continue;
        addGovernmentEffectInstances(
          instances,
          `cabinet-${position.id}-${leader.id}-${trait.id}`,
          `${leader.name}: ${trait.name}`,
          traitEffect.effects,
          leaderScale,
        );
      }
    }
  }
  return instances;
}

function getGovernmentPositionDefinitionMap(): Record<GovernmentPositionId, GovernmentPositionDefinition> {
  return {
    president: getGovernmentPositionDefinition("president")!,
    headOfResearch: getGovernmentPositionDefinition("headOfResearch")!,
    headOfDevelopment: getGovernmentPositionDefinition("headOfDevelopment")!,
    ministerOfDefense: getGovernmentPositionDefinition("ministerOfDefense")!,
  };
}

function getGovernmentPlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const modifiers: PlanetModifier[] = [];
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    const effect = instance.effect;
    if (effect.type !== "planetModifier") continue;
    modifiers.push({
        id: `government-${instance.sourceId}-${effect.target}`,
        label: instance.label,
        source: `government:${factionId}`,
        target: effect.target,
        operation: effect.operation,
        value: effect.value * instance.scale,
    });
  }
  return modifiers;
}

function getGovernmentFleetEffects(nextState: GameState, factionId: number): Required<LeaderFleetEffects> {
  const totals: Required<LeaderFleetEffects> = {
    attackMultiplier: 1,
    speedMultiplier: 1,
    shieldMultiplier: 1,
    upkeepMultiplier: 1,
    evasionBonus: 0,
  };
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type !== "fleetModifier") continue;
    const value = instance.effect.value * instance.scale;
    if (instance.effect.target === "attack") totals.attackMultiplier += value;
    if (instance.effect.target === "speed") totals.speedMultiplier += value;
    if (instance.effect.target === "shield") totals.shieldMultiplier += value;
    if (instance.effect.target === "upkeep") totals.upkeepMultiplier += value;
    if (instance.effect.target === "evasion") totals.evasionBonus += value;
  }
  return {
    attackMultiplier: clamp(totals.attackMultiplier, 0.25, 2.5),
    speedMultiplier: clamp(totals.speedMultiplier, 0.25, 2.5),
    shieldMultiplier: clamp(totals.shieldMultiplier, 0.25, 2.5),
    upkeepMultiplier: clamp(totals.upkeepMultiplier, 0.25, 2.5),
    evasionBonus: clamp(totals.evasionBonus, -0.25, 0.25),
  };
}

function getGovernmentResearchSpeedMultiplier(nextState: GameState, factionId: number): number {
  let multiplier = 1;
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type === "researchSpeed") {
      multiplier += instance.effect.value * instance.scale;
    }
  }
  return clamp(multiplier, 0.25, 3);
}

function getGovernmentResearchAllocation(nextState: GameState, factionId: number): { activeFraction: number; passiveFraction: number } {
  let activeFraction = ACTIVE_RESEARCH_FRACTION;
  let passiveFraction = PASSIVE_RESEARCH_FRACTION;
  for (const instance of getGovernmentEffectInstances(nextState, factionId)) {
    if (instance.effect.type !== "researchAllocation") continue;
    activeFraction = instance.effect.activeFraction;
    passiveFraction = instance.effect.passiveFraction;
  }
  const total = Math.max(0.000001, activeFraction + passiveFraction);
  return {
    activeFraction: clamp(activeFraction / total, 0, 1),
    passiveFraction: clamp(passiveFraction / total, 0, 1),
  };
}

function getPlanetLeaderModifiers(nextState: GameState, planetState: PlanetState, ownerId: number): PlanetModifier[] {
  const leader = getAssignedLeader(nextState, "planet", planetState.id);
  if (!leader || leader.factionId !== ownerId || leader.class !== "civilian") return [];
  const scale = getLeaderLevelScale(leader);
  const modifiers: PlanetModifier[] = [];
  for (const traitId of leader.traits) {
    const trait = getLeaderTraitDefinition(traitId);
    for (const effect of trait.planetEffects ?? []) {
      modifiers.push({
        id: `leader-${leader.id}-${trait.id}-${effect.target}`,
        label: `${leader.name}: ${trait.name}`,
        source: `leader:${leader.id}`,
        target: effect.target,
        operation: effect.operation,
        value: effect.value * scale,
      });
    }
  }
  return modifiers;
}

function getFleetLeaderEffects(nextState: GameState, fleetId: string): Required<LeaderFleetEffects> {
  const leader = getAssignedLeader(nextState, "fleet", fleetId);
  const totals: Required<LeaderFleetEffects> = {
    attackMultiplier: 1,
    speedMultiplier: 1,
    shieldMultiplier: 1,
    upkeepMultiplier: 1,
    evasionBonus: 0,
  };
  if (!leader || leader.class !== "military") return totals;
  const scale = getLeaderLevelScale(leader);
  for (const traitId of leader.traits) {
    const effects = getLeaderTraitDefinition(traitId).fleetEffects;
    if (!effects) continue;
    totals.attackMultiplier += (effects.attackMultiplier ?? 0) * scale;
    totals.speedMultiplier += (effects.speedMultiplier ?? 0) * scale;
    totals.shieldMultiplier += (effects.shieldMultiplier ?? 0) * scale;
    totals.upkeepMultiplier += (effects.upkeepMultiplier ?? 0) * scale;
    totals.evasionBonus += (effects.evasionBonus ?? 0) * scale;
  }
  return {
    attackMultiplier: clamp(totals.attackMultiplier, 0.25, 2.25),
    speedMultiplier: clamp(totals.speedMultiplier, 0.25, 2.25),
    shieldMultiplier: clamp(totals.shieldMultiplier, 0.25, 2.25),
    upkeepMultiplier: clamp(totals.upkeepMultiplier, 0.25, 2),
    evasionBonus: clamp(totals.evasionBonus, -0.25, 0.25),
  };
}

function getFleetSpeedMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).speedMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).speedMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).speedMultiplier;
}

function getFleetAttackMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).attackMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).attackMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).attackMultiplier;
}

function getFleetShieldMultiplier(nextState: GameState, fleet: Pick<ServerFleet, "id" | "ownerId">): number {
  return getFactionFleetShortageEffects(nextState, fleet.ownerId).shieldMultiplier
    * getFleetLeaderEffects(nextState, fleet.id).shieldMultiplier
    * getGovernmentFleetEffects(nextState, fleet.ownerId).shieldMultiplier;
}

function refreshFactionEconomyDeltas(nextState = state): void {
  for (const economy of nextState.factionEconomies) {
    const baseMonthlyDelta = calculateFactionMonthlyDelta(nextState, economy.factionId);
    const marketMonthlyDelta = calculateFactionMarketMonthlyDelta(nextState, economy.factionId);
    economy.marketMonthlyDelta = marketMonthlyDelta;
    economy.monthlyDelta = addResourceCounts(baseMonthlyDelta, marketMonthlyDelta);
  }
}

function getFactionTechnology(nextState: GameState, factionId: number): FactionTechState | undefined {
  return nextState.factionTechnologies.find((techState) => techState.factionId === factionId);
}

function addInferredTechIdsFromBuilding(techIds: Set<TechId>, buildingKind: BuildingKind): void {
  for (const techId of getRequiredTechIdsForBuilding(buildingKind)) techIds.add(techId);
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
    for (const buildingKind of Object.values(planetState.buildings).flat()) {
      if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind);
    }
    for (const subDistrict of planetState.urbanSubDistricts) {
      for (const buildingKind of subDistrict.buildings) {
        if (buildingKind) addInferredTechIdsFromBuilding(techIds, buildingKind);
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

function getTechnologyPlanetModifiers(nextState: GameState, factionId: number): PlanetModifier[] {
  const techState = getFactionTechnology(nextState, factionId);
  if (!techState) return [];
  const modifiers: PlanetModifier[] = [];
  for (const techId of techState.completedTechIds) {
    const tech = TECHNOLOGY_BY_ID[techId];
    if (!tech) continue;
    for (const effect of tech.effects) {
      if (effect.type === "job_output_mult") {
        modifiers.push({
          id: `tech-${tech.id}-${effect.job}-${effect.resource}`,
          label: tech.name,
          source: `technology:${tech.id}`,
          target: `jobOutput:${effect.job}:${effect.resource}`,
          operation: "multiply",
          value: effect.value,
        });
      } else if (effect.type === "construction_speed_mult") {
        modifiers.push({
          id: `tech-${tech.id}-construction-speed`,
          label: tech.name,
          source: `technology:${tech.id}`,
          target: "constructionSpeed",
          operation: "multiply",
          value: effect.value,
        });
      }
    }
  }
  return modifiers;
}

function getPlanetTechnologyModifiers(nextState: GameState, planetState: PlanetState): PlanetModifier[] {
  const ownerId = nextState.starOwnership[planetState.starId] ?? -1;
  return ownerId >= 0
    ? [
      ...getTechnologyPlanetModifiers(nextState, ownerId),
      ...getGovernmentPlanetModifiers(nextState, ownerId),
      ...getFactionShortagePlanetModifiers(nextState, ownerId),
      ...getPlanetLeaderModifiers(nextState, planetState, ownerId),
    ]
    : [];
}

function getFactionStarbaseShipBuildSpeedMultiplier(nextState: GameState, factionId: number): number {
  const techState = getFactionTechnology(nextState, factionId);
  if (!techState) return 1;
  let multiplier = 1;
  for (const effect of getCompletedTechnologyEffects(techState)) {
    if (effect.type === "starbase_ship_build_speed_mult") multiplier *= 1 + effect.value;
  }
  return Math.max(0.1, multiplier);
}

function getFactionResearchPerHour(factionId: number): number {
  const economy = getFactionEconomy(factionId);
  const base = BASELINE_RESEARCH_PER_HOUR + Math.max(0, (economy?.monthlyDelta.research ?? 0) / GAME_HOURS_PER_MONTH);
  return base * getGovernmentResearchSpeedMultiplier(state, factionId);
}

function countOwnedPlanetBuildings(factionId: number, buildingKind: BuildingKind): number {
  let count = 0;
  for (const planetState of state.planetStates) {
    if ((state.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const building of Object.values(planetState.buildings).flat()) {
      if (building === buildingKind) count += 1;
    }
    for (const subDistrict of planetState.urbanSubDistricts) {
      for (const building of subDistrict.buildings) {
        if (building === buildingKind) count += 1;
      }
    }
  }
  return count;
}

function buildResearchContext(factionId: number): ResearchContext {
  const economy = getFactionEconomy(factionId);
  const jobs: Record<string, number> = {
    farmer: 0,
    miner: 0,
    researcher: 0,
    artisan: 0,
    metallurgist: 0,
    technician: 0,
  };
  for (const planetState of state.planetStates) {
    if ((state.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const group of planetState.economy.popGroups) {
      if (Object.prototype.hasOwnProperty.call(jobs, group.job)) {
        jobs[group.job] += group.population / PEOPLE_PER_MONTHLY_UNIT;
      }
    }
  }
  const factionFleets = state.fleets.filter((fleet) => fleet.ownerId === factionId);
  const factionShips = state.ships.filter((ship) => ship.ownerId === factionId);
  const shipsByFleetId = new Map<string, GameShip[]>();
  for (const ship of factionShips) {
    const list = shipsByFleetId.get(ship.fleetId) ?? [];
    list.push(ship);
    shipsByFleetId.set(ship.fleetId, list);
  }
  const fleetPower = factionFleets.reduce((sum, fleet) => (
    sum + computeFleetPower(shipsByFleetId.get(fleet.id) ?? [], fleet.shipIds.length, undefined, state.shipDesigns)
  ), 0);
  const recentCombatCutoff = state.clock.year - 1;
  const atWar = state.recentCombatContacts.some((contact) => (
    contact.year >= recentCombatCutoff
    && (contact.sourceOwnerId === factionId || contact.targetOwnerId === factionId)
  ));
  const foodStockpile = economy?.stockpiles.food ?? 0;
  const foodIncome = economy?.monthlyDelta.food ?? 0;
  return {
    farmerJobs: jobs.farmer,
    minerJobs: jobs.miner,
    researcherJobs: jobs.researcher,
    artisanJobs: jobs.artisan,
    metallurgistJobs: jobs.metallurgist,
    technicianJobs: jobs.technician,
    fleetPower,
    shipCount: factionShips.length,
    atWar,
    famine: foodStockpile < 0 || (foodStockpile < 250 && foodIncome < 0),
    lowFoodStockpile: foodStockpile < 1000 || foodIncome < 0,
    foodIncome,
    mineralsIncome: economy?.monthlyDelta.minerals ?? 0,
    alloyIncome: economy?.monthlyDelta.alloys ?? 0,
    energyIncome: economy?.monthlyDelta.energy ?? 0,
    goodsIncome: economy?.monthlyDelta.goods ?? 0,
    researchIncome: economy?.monthlyDelta.research ?? 0,
    researchLabs: countOwnedPlanetBuildings(factionId, "researchLabs"),
    starbaseResearchAnnexes: state.starbases
      .filter((starbase) => starbase.ownerId === factionId)
      .reduce((count, starbase) => count + starbase.buildingSlots.filter((building) => building === "researchAnnex").length, 0),
  };
}

function selectNextActiveTechnology(techState: FactionTechState): TechId | undefined {
  return TECHNOLOGY_DEFINITIONS
    .filter((tech) => isTechnologyAvailable(tech, techState))
    .sort((a, b) => a.tier - b.tier || a.positionInTree.y - b.positionInTree.y || a.name.localeCompare(b.name))[0]?.id;
}

function ensureActiveTechnology(techState: FactionTechState): boolean {
  if (
    techState.activeTechId
    && TECHNOLOGY_BY_ID[techState.activeTechId]
    && !isTechnologyCompleted(techState, techState.activeTechId)
    && isTechnologyAvailable(TECHNOLOGY_BY_ID[techState.activeTechId], techState)
  ) {
    return false;
  }
  const nextActive = selectNextActiveTechnology(techState);
  if (techState.activeTechId === nextActive) return false;
  techState.activeTechId = nextActive;
  return true;
}

function completeTechnology(techState: FactionTechState, techId: TechId): boolean {
  const tech = TECHNOLOGY_BY_ID[techId];
  if (!tech || isTechnologyCompleted(techState, techId)) return false;
  const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
  techState.progressByTechId[techId] = {
    ...progress,
    totalProgress: tech.cost,
    completed: true,
  };
  techState.completedTechIds = Array.from(new Set([...techState.completedTechIds, techId]));
  if (techState.activeTechId === techId) techState.activeTechId = undefined;
  return true;
}

function applyActiveResearchPool(
  techState: FactionTechState,
  context: ResearchContext,
  activeResearchPool: number,
): boolean {
  let pool = Math.max(0, activeResearchPool);
  let changed = false;
  let guard = 0;
  while (pool > 0.000001 && guard < TECHNOLOGY_DEFINITIONS.length) {
    guard += 1;
    changed = ensureActiveTechnology(techState) || changed;
    const techId = techState.activeTechId;
    if (!techId) break;
    const tech = TECHNOLOGY_BY_ID[techId];
    if (!tech || tech.cost <= 0 || isTechnologyCompleted(techState, techId)) {
      techState.activeTechId = undefined;
      continue;
    }
    const progress = techState.progressByTechId[techId] ?? createEmptyTechProgress();
    const evaluation = evaluateTechnologyResearch(tech, context);
    const remainingProgress = Math.max(0, tech.cost - progress.totalProgress);
    const poolToComplete = remainingProgress / Math.max(0.000001, evaluation.multiplier);
    const consumedPool = Math.min(pool, poolToComplete);
    const gainedProgress = consumedPool * evaluation.multiplier;
    if (gainedProgress <= 0) break;
    progress.activeProgress += gainedProgress;
    progress.totalProgress = Math.min(tech.cost, progress.totalProgress + gainedProgress);
    techState.progressByTechId[techId] = progress;
    pool -= consumedPool;
    changed = true;
    if (progress.totalProgress >= tech.cost - 0.000001) {
      completeTechnology(techState, techId);
      changed = true;
      continue;
    }
    break;
  }
  return changed;
}

function applyPassiveResearchPool(
  techState: FactionTechState,
  context: ResearchContext,
  passiveResearchPool: number,
): boolean {
  let pool = Math.max(0, passiveResearchPool);
  if (pool <= 0) return false;
  const candidates = TECHNOLOGY_DEFINITIONS
    .filter((tech) => isTechnologyAvailable(tech, techState))
    .map((tech) => {
      const progress = techState.progressByTechId[tech.id] ?? createEmptyTechProgress();
      const capRemaining = Math.max(0, getPassiveProgressCap(tech) - progress.passiveProgress);
      const totalRemaining = Math.max(0, tech.cost - progress.totalProgress);
      const remaining = Math.min(capRemaining, totalRemaining);
      const evaluation = evaluateTechnologyResearch(tech, context);
      return { tech, progress, evaluation, remaining };
    })
    .filter((entry) => entry.remaining > 0 && entry.evaluation.passiveScore > 0);
  const totalScore = candidates.reduce((sum, entry) => sum + entry.evaluation.passiveScore, 0);
  if (totalScore <= 0) return false;

  let changed = false;
  for (const entry of candidates) {
    const share = pool * (entry.evaluation.passiveScore / totalScore);
    const gain = Math.min(share, entry.remaining);
    if (gain <= 0) continue;
    entry.progress.passiveProgress += gain;
    entry.progress.totalProgress = Math.min(entry.tech.cost, entry.progress.totalProgress + gain);
    entry.progress.completed = false;
    techState.progressByTechId[entry.tech.id] = entry.progress;
    changed = true;
  }
  return changed;
}

function applyTechnologyResearchForFaction(factionId: number, elapsedHours: number, researchPerHour: number): boolean {
  const techState = getFactionTechnology(state, factionId);
  if (!techState || elapsedHours <= 0) return false;
  const context = buildResearchContext(factionId);
  let changed = ensureActiveTechnology(techState);
  const researchPool = Math.max(0, researchPerHour) * elapsedHours;
  const allocation = getGovernmentResearchAllocation(state, factionId);
  changed = applyActiveResearchPool(techState, context, researchPool * allocation.activeFraction) || changed;
  changed = applyPassiveResearchPool(techState, context, researchPool * allocation.passiveFraction) || changed;
  changed = ensureActiveTechnology(techState) || changed;
  if (changed) {
    hasDirtyState = true;
  }
  return changed;
}

function createFactionTechnologyView(factionId: number): FactionTechnologyView {
  const techState = getFactionTechnology(state, factionId) ?? normalizeFactionTechState(factionId, undefined);
  const context = buildResearchContext(factionId);
  const researchPerHour = getFactionResearchPerHour(factionId);
  const allocation = getGovernmentResearchAllocation(state, factionId);
  return {
    factionId,
    activeTechId: techState.activeTechId,
    completedTechIds: [...techState.completedTechIds],
    researchPerHour,
    activeResearchPerHour: researchPerHour * allocation.activeFraction,
    passiveResearchPerHour: researchPerHour * allocation.passiveFraction,
    technologies: TECHNOLOGY_DEFINITIONS.map((tech) => {
      const progress = techState.progressByTechId[tech.id] ?? createEmptyTechProgress(isTechnologyCompleted(techState, tech.id));
      const missingPrerequisites = getMissingPrerequisites(tech, techState);
      const completed = isTechnologyCompleted(techState, tech.id);
      const available = !completed && missingPrerequisites.length === 0;
      return {
        id: tech.id,
        completed,
        available,
        locked: !completed && !available,
        active: techState.activeTechId === tech.id,
        progress,
        passiveCap: getPassiveProgressCap(tech),
        evaluation: evaluateTechnologyResearch(tech, context),
        missingPrerequisites,
      };
    }),
  };
}

function getVisibleTechnologyViews(perspective: GalaxyPerspective): FactionTechnologyView[] {
  if (perspective.mode === "faction") return [createFactionTechnologyView(perspective.factionId)];
  return state.factions.map((faction) => createFactionTechnologyView(faction.id));
}

function requireUnlocked(socket: WebSocket, factionId: number, requiredTechIds: TechId[]): boolean {
  if (requiredTechIds.length === 0) return true;
  const techState = getFactionTechnology(state, factionId);
  if (isUnlockedByAnyRequiredTech(techState, requiredTechIds)) return true;
  reject(socket, `Requires ${getFirstRequiredTechName(requiredTechIds)}.`);
  return false;
}

function isShipDesignUnlockedForFaction(factionId: number, design: ShipDesign): boolean {
  const techState = getFactionTechnology(state, factionId);
  if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipHull(design.shipKind))) return false;
  for (const sectionModuleId of [...design.weaponSectionModuleIds, ...design.defenseSectionModuleIds]) {
    if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipSection(sectionModuleId))) return false;
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    if (!isUnlockedByAnyRequiredTech(techState, getRequiredTechIdsForShipModule(moduleId))) return false;
  }
  return true;
}

function getShipDesignMissingTechnologyName(factionId: number, design: ShipDesign): string | null {
  const techState = getFactionTechnology(state, factionId);
  const hullTechs = getRequiredTechIdsForShipHull(design.shipKind);
  if (!isUnlockedByAnyRequiredTech(techState, hullTechs)) return getFirstRequiredTechName(hullTechs);
  for (const sectionModuleId of [...design.weaponSectionModuleIds, ...design.defenseSectionModuleIds]) {
    const required = getRequiredTechIdsForShipSection(sectionModuleId);
    if (!isUnlockedByAnyRequiredTech(techState, required)) return getFirstRequiredTechName(required);
  }
  for (const moduleId of [...design.weaponModuleIds, ...design.defenseModuleIds, ...design.utilityModuleIds]) {
    const required = getRequiredTechIdsForShipModule(moduleId);
    if (!isUnlockedByAnyRequiredTech(techState, required)) return getFirstRequiredTechName(required);
  }
  return null;
}

function queuePlanetDetailRefresh(planetId: string): void {
  pendingPlanetDetailRefreshes.add(planetId);
}

function flushPlanetDetailRefreshes(): void {
  if (pendingPlanetDetailRefreshes.size === 0) return;
  pendingPlanetDetailRefreshes.clear();
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

function getShipDefinition(shipKind?: string) {
  const kind = shipKind && isStarbaseShipKind(shipKind) ? shipKind : "corvette";
  return STARBASE_SHIP_DEFINITIONS[kind];
}

function findShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId?: string | null,
  includeDecommissioned = true,
): ShipDesign | null {
  if (designId) {
    const explicit = findShipDesignById(shipDesigns, ownerId, shipKind, designId, includeDecommissioned);
    if (explicit) return explicit;
  }
  return shipDesigns.find((design) => (
    design.ownerId === ownerId
    && design.shipKind === shipKind
    && design.status === "active"
  )) ?? shipDesigns.find((design) => (
    design.ownerId === ownerId
    && design.shipKind === shipKind
    && includeDecommissioned
  )) ?? null;
}

function findShipDesignById(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId: string | null | undefined,
  includeDecommissioned = true,
): ShipDesign | null {
  if (!designId) return null;
  return shipDesigns.find((design) => (
    design.id === designId
    && design.ownerId === ownerId
    && design.shipKind === shipKind
    && (includeDecommissioned || design.status === "active")
  )) ?? null;
}

function getNewestActiveShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
): ShipDesign | null {
  return shipDesigns
    .filter((design) => design.ownerId === ownerId && design.shipKind === shipKind && design.status === "active")
    .sort((a, b) => {
      const yearDelta = (b.updatedAtYear ?? b.createdAtYear) - (a.updatedAtYear ?? a.createdAtYear);
      if (yearDelta !== 0) return yearDelta;
      return b.createdAtYear - a.createdAtYear;
    })[0] ?? null;
}

function resolveShipDesign(
  shipDesigns: ShipDesign[],
  ownerId: number,
  shipKind: StarbaseShipKind,
  designId?: string | null,
): ShipDesign {
  return findShipDesign(shipDesigns, ownerId, shipKind, designId, true)
    ?? createDefaultShipDesign(ownerId, shipKind, state?.clock?.year ?? GAME_START_YEAR);
}

function getShipDesignForShip(ship: Pick<ServerShip, "ownerId" | "shipKind" | "designId">): ShipDesign {
  return resolveShipDesign(state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId);
}

function calculateShipUpgradePlan(fromDesign: ShipDesign, targetDesign: ShipDesign): {
  cost: ResourceCounts;
  totalDays: number;
  alloyUpkeepPerDay: number;
} {
  const fromStats = calculateShipDesignStats(fromDesign);
  const targetStats = calculateShipDesignStats(targetDesign);
  const cost = createEmptyResourceCounts();
  let positiveCost = 0;
  let targetCost = 0;
  for (const resource of RESOURCE_KINDS) {
    const delta = Math.max(0, targetStats.cost[resource] - fromStats.cost[resource]);
    cost[resource] = delta;
    positiveCost += delta;
    targetCost += Math.max(0, targetStats.cost[resource]);
  }
  const refitAlloyCost = Math.max(5, targetStats.cost.alloys * 0.15);
  cost.alloys = Math.max(cost.alloys, refitAlloyCost);
  const costRatio = targetCost > 0 ? Math.max(0.2, Math.min(1, positiveCost / targetCost)) : 0.35;
  const totalDays = Math.max(1, Math.ceil(targetStats.buildDays * Math.max(0.25, costRatio)));
  return {
    cost,
    totalDays,
    alloyUpkeepPerDay: cost.alloys / totalDays,
  };
}

function applyShipDesignToShip(ship: GameShip, design: ShipDesign): void {
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  const shieldRatio = ship.maxShield > 0 ? ship.shield / ship.maxShield : 1;
  const armorRatio = ship.maxArmor > 0 ? ship.armor / ship.maxArmor : 1;
  const hullRatio = ship.maxHull > 0 ? ship.hull / ship.maxHull : 1;
  ship.shipKind = design.shipKind;
  ship.designId = design.id;
  ship.targetDesignId = null;
  ship.speed = stats.speed;
  ship.maxShield = combat.maxShield;
  ship.maxArmor = combat.maxArmor;
  ship.maxHull = combat.maxHull;
  ship.maxHp = combat.maxHull;
  ship.shield = clamp(combat.maxShield * shieldRatio, 0, combat.maxShield);
  ship.armor = clamp(combat.maxArmor * armorRatio, 0, combat.maxArmor);
  ship.hull = clamp(combat.maxHull * hullRatio, 1, combat.maxHull);
  ship.hp = ship.hull;
  ship.weaponCooldowns = {};
}

function createShipFromDesign(
  ownerId: number,
  fleetId: string,
  design: ShipDesign,
  id = createRuntimeId("ship", [ownerId, design.shipKind]),
): GameShip {
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  return {
    id,
    ownerId,
    fleetId,
    shipKind: design.shipKind,
    designId: design.id,
    targetDesignId: null,
    speed: stats.speed,
    hp: combat.maxHull,
    maxHp: combat.maxHull,
    shield: combat.maxShield,
    maxShield: combat.maxShield,
    armor: combat.maxArmor,
    maxArmor: combat.maxArmor,
    hull: combat.maxHull,
    maxHull: combat.maxHull,
    weaponCooldowns: {},
  };
}

function createShip(
  ownerId: number,
  fleetId: string,
  shipKind: StarbaseShipKind = "corvette",
  id = createRuntimeId("ship", [ownerId, shipKind]),
  designId?: string | null,
): GameShip {
  const design = resolveShipDesign(state.shipDesigns, ownerId, shipKind, designId);
  return createShipFromDesign(ownerId, fleetId, design, id);
}

function createFleet(
  ownerId: number,
  currentStarId: number,
  shipIds: string[],
  id = createRuntimeId("fleet", [ownerId, currentStarId]),
): GameFleet {
  return {
    id,
    ownerId,
    shipIds,
    formation: "line",
    currentStarId,
    targetStarId: null,
    phase: "idle",
    phaseStartedAtYear: GAME_START_YEAR,
    phaseDurationDays: 0,
    route: [currentStarId],
    routeIndex: 0,
    phaseProgress: 0,
    phaseElapsedMs: 0,
    orderType: null,
    speed: DEFAULT_SHIP_SPEED,
    combatStance: "aggressive",
    retreatState: null,
    systemPosition: systemCenterPosition(),
    hyperlanePosition: null,
    movementPlan: null,
    orbitTargetPlanetId: null,
    orbitOffset: null,
    orbitTarget: null,
    mergeTargetFleetId: null,
    combatSettings: createDefaultFleetCombatSettings(),
    currentTacticalOrder: null,
    tacticalRadius: getFleetTacticalRadius(shipIds.length),
    maxWeaponRange: 0,
    minWeaponRange: 0,
    currentTargetId: null,
    currentTargetKind: null,
    combatStatus: "idle",
    lastCombatAtYear: null,
  };
}

function syncStarbaseCombatHealth(starbase: ServerStarbase): ServerStarbase {
  const combat = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat ?? STARBASE_LEVEL_DEFINITIONS.outpost.combat;
  const maxShield = Math.max(0, combat.maxShield);
  const maxArmor = Math.max(0, combat.maxArmor);
  const maxHull = Math.max(1, combat.maxHull);
  const shieldRatio = starbase.maxShield > 0 ? starbase.shield / starbase.maxShield : 1;
  const armorRatio = starbase.maxArmor > 0 ? starbase.armor / starbase.maxArmor : 1;
  const hullRatio = starbase.maxHull > 0 ? starbase.hull / starbase.maxHull : 1;
  return {
    ...starbase,
    maxShield,
    maxArmor,
    maxHull,
    shield: clamp(maxShield * shieldRatio, 0, maxShield),
    armor: clamp(maxArmor * armorRatio, 0, maxArmor),
    hull: clamp(maxHull * hullRatio, 1, maxHull),
  };
}

function normalizeFleetRetreatState(retreatState: Partial<FleetRetreatState> | null | undefined): FleetRetreatState | null {
  if (!retreatState || !Number.isInteger(retreatState.targetStarId)) return null;
  const targetStarId = retreatState.targetStarId as number;
  const mode = retreatState.mode === "emergencyFtl" ? "emergencyFtl" : "system";
  const status = retreatState.status === "escaping" || retreatState.status === "mia" || retreatState.status === "completed"
    ? retreatState.status
    : "ordered";
  return {
    mode,
    status,
    targetStarId,
    targetSystemPosition: retreatState.targetSystemPosition ?? null,
    startedAtYear: Number(retreatState.startedAtYear) || GAME_START_YEAR,
    miaUntilYear: Number.isFinite(retreatState.miaUntilYear) ? retreatState.miaUntilYear ?? null : null,
    riskApplied: retreatState.riskApplied === true,
  };
}

function normalizeSystemPositionValue(
  position: Partial<ReturnType<typeof systemCenterPosition>> | null | undefined,
  fallback: ReturnType<typeof systemCenterPosition> | null = null,
): ReturnType<typeof systemCenterPosition> | null {
  if (!position) return fallback ? cloneSystemPosition(fallback) : null;
  const x = Number(position.x);
  const y = Number(position.y);
  const z = Number(position.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return fallback ? cloneSystemPosition(fallback) : null;
  }
  return { x, y, z };
}

function normalizeFleetRetreatDestination(
  value: Partial<FleetRetreatDestination> | null | undefined,
): FleetRetreatDestination | null {
  if (!value) return null;
  if (value.kind === "selectedSystem") {
    const targetStarId = Number(value.targetStarId);
    if (!Number.isInteger(targetStarId) || targetStarId < 0) return null;
    return {
      kind: "selectedSystem",
      targetStarId,
      targetSystemPosition: normalizeSystemPositionValue(value.targetSystemPosition),
    };
  }
  if (value.kind === "nearestFriendlyStarbase") {
    return { kind: "nearestFriendlyStarbase" };
  }
  return null;
}

function createDefaultFleetCombatSettings(
  overrides: Partial<FleetCombatSettings> | null | undefined = null,
): FleetCombatSettings {
  return {
    behavior: isFleetBehavior(overrides?.behavior) ? overrides!.behavior! : "line",
    chasePolicy: isFleetChasePolicy(overrides?.chasePolicy) ? overrides!.chasePolicy! : "system",
    retreatPolicy: isFleetRetreatPolicy(overrides?.retreatPolicy) ? overrides!.retreatPolicy! : "medium",
    retreatDestination: normalizeFleetRetreatDestination(overrides?.retreatDestination),
  };
}

function normalizeFleetTacticalOrder(order: Partial<FleetTacticalOrder> | null | undefined): FleetTacticalOrder | null {
  if (!order || !isFleetTacticalOrderType(order.type)) return null;
  const targetKind = order.targetKind === "fleet" || order.targetKind === "starbase" ? order.targetKind : null;
  return {
    type: order.type,
    targetId: typeof order.targetId === "string" ? order.targetId : null,
    targetKind,
    targetPosition: normalizeSystemPositionValue(order.targetPosition),
    guardPosition: normalizeSystemPositionValue(order.guardPosition),
    issuedAtYear: Number.isFinite(order.issuedAtYear) ? Number(order.issuedAtYear) : null,
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
    phaseDurationDays: fleet.phaseDurationDays ?? phaseDurationDays(phase),
    route: Array.isArray(fleet.route) && fleet.route.length > 0 ? fleet.route : [currentStarId],
    routeIndex: Math.max(0, Number(fleet.routeIndex) || 0),
    phaseProgress: Math.max(0, Math.min(1, Number(fleet.phaseProgress) || 0)),
    phaseElapsedMs: fleet.phaseElapsedMs ?? Math.round((fleet.phaseProgress ?? 0) * phaseDuration(phase)),
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
    phaseDurationDays: ship.phaseDurationDays ?? phaseDurationDays(ship.phase ?? "idle"),
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
      fleet = createFleet(ship.ownerId, ownerHomeStarId, [], ship.fleetId);
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

function syncSystemOwnershipFromStarbases(nextState = state): boolean {
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
  return state.ships.some((ship) => shipIds.has(ship.id) && ship.shipKind === "constructionShip" && ship.hull > 0);
}

function getFleetColonizationShip(fleet: Pick<GameFleet, "shipIds">): GameShip | null {
  const shipIds = new Set(fleet.shipIds);
  return state.ships.find((ship) => shipIds.has(ship.id) && ship.shipKind === "colonizationShip" && ship.hull > 0) ?? null;
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
  const cfg = { ...GALAXY_MAP, seed: game.seed };
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
    const corvette = createShipFromDesign(faction.id, combatFleetId, corvetteDesign, `ship-${faction.id}-1`);
    ships.push(corvette);
    const combatFleet = createFleet(faction.id, faction.homeStarId, [corvette.id], combatFleetId);
    combatFleet.phaseStartedAtYear = GAME_START_YEAR;
    combatFleet.speed = corvette.speed;

    const constructionFleetId = `fleet-${faction.id}-construction-1`;
    const constructionDesign = resolveShipDesign(shipDesigns, faction.id, "constructionShip");
    const constructionShip = createShipFromDesign(
      faction.id,
      constructionFleetId,
      constructionDesign,
      `ship-${faction.id}-construction-1`,
    );
    ships.push(constructionShip);
    const constructionFleet = createFleet(faction.id, faction.homeStarId, [constructionShip.id], constructionFleetId);
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
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as GameState;
    parsed.schemaVersion = 20;
    delete (parsed as GameState & { battles?: unknown }).battles;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
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
    if (normalizedMarket.changed) hasDirtyState = true;
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
      hasDirtyState = true;
    } else {
      parsed.fleets = rawFleets.map((fleet) => normalizeFleet(fleet));
      const fallbackFleetId = parsed.fleets[0]?.id ?? "fleet-0";
      parsed.ships = rawShips.map((ship) => normalizeShip(ship, ship.fleetId || fallbackFleetId, parsed.shipDesigns));
    }
    if (syncFleetMembership(parsed)) {
      hasDirtyState = true;
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
      hasDirtyState = true;
    }
    refreshDiscovery(parsed);
    return parsed;
  } catch {
    const initial = createInitialState();
    await saveState(initial);
    return initial;
  }
}

async function saveState(nextState = state): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  lastSaveAt = Date.now();
  hasDirtyState = false;
}

function phaseDuration(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed">): number {
  const fleetSpeed = fleet ? getFleetSpeedMultiplier(state, fleet) : 1;
  const speed = Math.max(0.05, (fleet?.speed ?? DEFAULT_SHIP_SPEED) * fleetSpeed);
  const travelScale = 1 / speed;
  switch (phase) {
    case "departingSystem":
      return DEPART_DURATION_MS * travelScale;
    case "jumpingHyperlane":
      return JUMP_DURATION_MS * travelScale;
    case "arrivingSystem":
      return ARRIVE_DURATION_MS * travelScale;
    case "buildingStarbase":
      return BUILD_DURATION_MS;
    case "movingSystem":
    case "orbitingPlanet":
    case "orbiting":
      return 1;
    default:
      return 1;
  }
}

function phaseDurationDays(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed">): number {
  if (phase === "idle") return 0;
  return phaseDuration(phase, fleet) / REAL_MS_PER_GAME_DAY;
}

function phaseDurationYears(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "id" | "ownerId" | "speed">): number {
  return phaseDurationDays(phase, fleet) / GAME_DAYS_PER_YEAR;
}

function setFleetPhase(fleet: GameFleet, phase: ShipTransitPhase): void {
  fleet.phase = phase;
  fleet.phaseElapsedMs = 0;
  fleet.phaseProgress = 0;
  fleet.phaseStartedAtYear = state?.clock?.year ?? fleet.phaseStartedAtYear ?? GAME_START_YEAR;
  fleet.phaseDurationDays = phaseDurationDays(phase, fleet);
}

function addDiscoveryFrom(nextState: GameState, sourceStarId: number, visible: Set<number>): void {
  if (sourceStarId < 0 || sourceStarId >= nextState.adjacency.length) return;
  for (const starId of computeVisibleStarIds(nextState.adjacency, sourceStarId, DISCOVERY_JUMPS)) {
    visible.add(starId);
  }
}

function computeCurrentVisibleSet(nextState: GameState, factionId: number): Set<number> {
  const visible = new Set<number>();
  const faction = nextState.factions.find((candidate) => candidate.id === factionId);
  if (faction) addDiscoveryFrom(nextState, faction.homeStarId, visible);

  for (const starbase of nextState.starbases) {
    if (starbase.ownerId === factionId && starbase.status === "online") {
      addDiscoveryFrom(nextState, starbase.starId, visible);
    }
  }

  for (const fleet of nextState.fleets) {
    if (fleet.ownerId !== factionId) continue;
    addDiscoveryFrom(nextState, fleet.currentStarId, visible);
    if (fleet.hyperlanePosition) {
      addDiscoveryFrom(nextState, fleet.hyperlanePosition.fromStarId, visible);
      addDiscoveryFrom(nextState, fleet.hyperlanePosition.toStarId, visible);
    }
  }

  return visible;
}

function refreshDiscovery(nextState = state): void {
  for (const faction of nextState.factions) {
    const visible = computeCurrentVisibleSet(nextState, faction.id);
    const discovered = new Set<number>(nextState.discoveredByFaction[String(faction.id)] ?? []);
    for (const starId of visible) discovered.add(starId);
    nextState.discoveredByFaction[String(faction.id)] = Array.from(discovered).sort((a, b) => a - b);

    const lastKnown = nextState.lastKnownOwnershipByFaction[String(faction.id)] ?? [];
    while (lastKnown.length < nextState.stars.length) lastKnown.push(-1);
    for (const starId of visible) {
      lastKnown[starId] = nextState.starOwnership[starId] ?? -1;
    }
    nextState.lastKnownOwnershipByFaction[String(faction.id)] = lastKnown.slice(0, nextState.stars.length);
  }
}

function getVisibleSet(perspective: GalaxyPerspective): Set<number> | null {
  if (perspective.mode === "observer") return null;
  return computeCurrentVisibleSet(state, perspective.factionId);
}

function getKnownSet(perspective: GalaxyPerspective): Set<number> | null {
  if (perspective.mode === "observer") return null;
  return new Set(state.discoveredByFaction[String(perspective.factionId)] ?? []);
}

function getKnownOwnership(ownerId: number, starId: number): number {
  const knownOwnership = state.lastKnownOwnershipByFaction[String(ownerId)] ?? [];
  return knownOwnership[starId] ?? -1;
}

function isFleetVisible(fleet: ServerFleet, visible: Set<number> | null, perspective: GalaxyPerspective): boolean {
  if (visible === null) return true;
  if (perspective.mode === "faction" && fleet.ownerId === perspective.factionId) return true;
  if (visible.has(fleet.currentStarId)) return true;
  return !!fleet.hyperlanePosition
    && (visible.has(fleet.hyperlanePosition.fromStarId) || visible.has(fleet.hyperlanePosition.toStarId));
}

function createRedactedStar(star: StarData): StarData {
  return {
    id: star.id,
    name: "Unknown Signal",
    type: StarType.G,
    x: star.x,
    z: star.z,
    luminosity: 0.6,
    color: [0.42, 0.62, 0.58],
    galaxyPulseAmplitude: 0.01,
    galaxyPulseFrequency: 0.4,
    objectDetails: undefined as unknown as StarData["objectDetails"],
    system: { planets: [] },
  };
}

function createMapStar(star: StarData): StarData {
  return {
    ...star,
    objectDetails: undefined as unknown as StarData["objectDetails"],
    system: { planets: [] },
  };
}

function createVisibleStars(perspective: GalaxyPerspective, knownSet: Set<number> | null): StarData[] {
  if (perspective.mode === "observer" || knownSet === null) {
    return state.stars.map((star) => createMapStar(star));
  }
  return state.stars.map((star) => (knownSet.has(star.id) ? createMapStar(star) : createRedactedStar(star)));
}

function createVisiblePlanetStates(knownSet: Set<number> | null, includeDetails: boolean): PlanetState[] {
  if (!includeDetails) return [];
  if (knownSet === null) return state.planetStates;
  return state.planetStates.filter((planetState) => knownSet.has(planetState.starId));
}

function createHabitedPlanetSystemIds(knownSet: Set<number> | null): number[] {
  const systemIds = new Set<number>();
  for (const planetState of state.planetStates) {
    if (!planetState.isHabited) continue;
    if (knownSet !== null && !knownSet.has(planetState.starId)) continue;
    systemIds.add(planetState.starId);
  }
  return Array.from(systemIds).sort((a, b) => a - b);
}

function toOwnershipEntries(ownership: number[]): Array<[number, number]> {
  const entries: Array<[number, number]> = [];
  ownership.forEach((ownerId, starId) => {
    if (ownerId >= 0) entries.push([starId, ownerId]);
  });
  return entries;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function createRevision(payload: unknown): string {
  const input = stableStringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function summarizeStarbase(starbase: ServerStarbase): ServerStarbaseSummary {
  const {
    economy: _economy,
    buildingSlots: _buildingSlots,
    constructionQueue: _constructionQueue,
    shipQueue: _shipQueue,
    ...summary
  } = starbase;
  return summary;
}

function createSnapshot(perspective: GalaxyPerspective): GameSnapshot {
  const visibleState = createVisibleState(perspective);
  const knownSet = getKnownSet(perspective);

  return {
    type: "snapshot",
    protocolVersion: 2,
    perspective,
    ...visibleState,
    stars: createVisibleStars(perspective, knownSet),
  };
}

function createUpdate(perspective: GalaxyPerspective, changed: ServerUpdateField[]): GameUpdate {
  const visibleState = createVisibleState(perspective);
  const knownSet = getKnownSet(perspective);
  const update: GameUpdate = {
    type: "update",
    protocolVersion: 2,
    perspective,
    changed,
  };

  if (changed.includes("clock")) {
    update.clock = visibleState.clock;
  }
  if (changed.includes("visibility")) {
    update.stars = createVisibleStars(perspective, knownSet);
    update.hyperlanes = visibleState.hyperlanes;
    update.factions = visibleState.factions;
    update.starOwnership = visibleState.starOwnership;
    update.visibleStarIds = visibleState.visibleStarIds;
    update.knownStarIds = visibleState.knownStarIds;
    update.habitedPlanetSystemIds = visibleState.habitedPlanetSystemIds;
  }
  if (changed.includes("planetStates")) {
    update.planetStates = visibleState.planetStates;
  }
  if (changed.includes("habitedPlanetSystems")) {
    update.habitedPlanetSystemIds = visibleState.habitedPlanetSystemIds;
  }
  if (changed.includes("factionEconomies")) {
    update.factionEconomies = visibleState.factionEconomies;
  }
  if (changed.includes("ships")) {
    update.ships = visibleState.ships;
  }
  if (changed.includes("shipDesigns")) {
    update.shipDesigns = visibleState.shipDesigns;
  }
  if (changed.includes("fleets")) {
    update.fleets = visibleState.fleets;
  }
  if (changed.includes("starbases")) {
    update.starbases = visibleState.starbases;
  }
  if (changed.includes("technologies")) {
    update.technologies = visibleState.technologies;
  }
  if (changed.includes("leaders")) {
    update.leaders = visibleState.leaders;
  }
  if (changed.includes("governments")) {
    update.governments = visibleState.governments;
  }
  if (changed.includes("species")) {
    update.species = visibleState.species;
  }
  if (changed.includes("diplomacy")) {
    update.diplomacy = visibleState.diplomacy;
  }
  if (changed.includes("combatContacts") || changed.includes("visibility")) {
    update.recentCombatContacts = visibleState.recentCombatContacts;
  }
  return update;
}

function createVisibleState(perspective: GalaxyPerspective): Omit<GameSnapshot, "type" | "perspective" | "stars"> {
  const visibleSet = getVisibleSet(perspective);
  const knownSet = getKnownSet(perspective);
  const visibleStarIds = visibleSet ? Array.from(visibleSet).sort((a, b) => a - b) : null;
  const knownStarIds = knownSet ? Array.from(knownSet).sort((a, b) => a - b) : null;
  const factions: FactionState[] = state.factions.map((faction) => {
    const isOwnFaction = perspective.mode === "faction" && perspective.factionId === faction.id;
    return {
      ...faction,
      homeStarId: visibleSet === null || isOwnFaction ? faction.homeStarId : -1,
      discoveredStarIds: visibleSet === null || isOwnFaction
        ? state.discoveredByFaction[String(faction.id)] ?? []
        : [],
    };
  });
  const visibleStarbases = visibleSet
    ? state.starbases.filter((starbase) => visibleSet.has(starbase.starId))
    : state.starbases;
  const fleets = state.fleets.filter((fleet) => isFleetVisible(fleet, visibleSet, perspective));
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  const ships = state.ships.filter((ship) => visibleFleetIds.has(ship.fleetId));
  const shipDesigns = perspective.mode === "faction"
    ? state.shipDesigns.filter((design) => design.ownerId === perspective.factionId)
    : state.shipDesigns;
  const hyperlanes = visibleSet
    ? state.hyperlanes.filter(([a, b]) => knownSet?.has(a) || knownSet?.has(b))
    : state.hyperlanes;
  const starOwnership = perspective.mode === "faction"
    ? (state.lastKnownOwnershipByFaction[String(perspective.factionId)] ?? [])
      .slice(0, state.stars.length)
    : state.starOwnership;
  while (starOwnership.length < state.stars.length) starOwnership.push(-1);
  const factionEconomies = perspective.mode === "faction"
    ? state.factionEconomies.filter((economy) => economy.factionId === perspective.factionId)
    : [];
  const governments = perspective.mode === "faction"
    ? state.governments.filter((government) => government.factionId === perspective.factionId)
    : state.governments;
  const leaders = perspective.mode === "faction"
    ? state.leaders.filter((leader) => leader.factionId === perspective.factionId && leader.status !== "dead")
    : state.leaders.filter((leader) => leader.status !== "dead");
  const species = state.species;
  const recentCombatContacts = visibleSet
    ? state.recentCombatContacts.filter((contact) => {
      const sourceStarId = contact.sourceKind === "fleet"
        ? state.fleets.find((fleet) => fleet.id === contact.sourceId)?.currentStarId
        : state.starbases.find((starbase) => starbase.id === contact.sourceId)?.starId;
      const targetStarId = contact.targetKind === "fleet"
        ? state.fleets.find((fleet) => fleet.id === contact.targetId)?.currentStarId
        : state.starbases.find((starbase) => starbase.id === contact.targetId)?.starId;
      return (sourceStarId !== undefined && visibleSet.has(sourceStarId)) || (targetStarId !== undefined && visibleSet.has(targetStarId));
    })
    : state.recentCombatContacts;

  return {
    clock: {
      year: state.clock.year,
      speedMultiplier: state.clock.speedMultiplier,
      tickSizeDays: state.clock.tickSizeDays,
      tickSpeedSeconds: state.clock.tickSpeedSeconds,
      paused: state.clock.paused,
      syncedAtMs: state.clock.syncedAtMs,
    },
    hyperlanes,
    factions,
    starOwnership: toOwnershipEntries(starOwnership),
    visibleStarIds,
    knownStarIds,
    ships,
    shipDesigns,
    fleets,
    starbases: visibleStarbases.map(summarizeStarbase),
    technologies: getVisibleTechnologyViews(perspective),
    leaders,
    governments,
    species,
    recentCombatContacts,
    diplomacy: createDiplomacyMovementPayload(perspective),
    planetStates: createVisiblePlanetStates(knownSet, perspective.mode === "observer"),
    factionEconomies,
    habitedPlanetSystemIds: createHabitedPlanetSystemIds(knownSet),
  };
}

function sendEvent(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

function broadcastSnapshots(): void {
  for (const client of clients) {
    sendEvent(client.socket, createSnapshot(client.perspective));
  }
}

function broadcastUpdates(changed: ServerUpdateField[]): void {
  const deduped = Array.from(new Set(changed));
  if (deduped.length === 0) return;
  for (const client of clients) {
    sendEvent(client.socket, createUpdate(client.perspective, deduped));
  }
  broadcastSubscribedDetails();
}

function reject(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: false, message });
}

function accept(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: true, message });
}

function routeIsAllowed(route: number[], ownerId: number): boolean {
  if (!Number.isInteger(ownerId)) return false;
  return route.slice(1).every((starId) => canEnterSystem(ownerId, starId));
}

function getStarOwnerId(starId: number): number {
  return state.starOwnership[starId] ?? -1;
}

function canEnterSystem(fleetOwnerId: number, starId: number): boolean {
  const ownerId = getStarOwnerId(starId);
  if (ownerId < 0 || ownerId === fleetOwnerId) return true;
  if (areFactionsAtWar(state.diplomacy, fleetOwnerId, ownerId)) return true;
  return getBorderPolicy(state.diplomacy, ownerId, fleetOwnerId) === "open";
}

function gameDaysToYears(days: number): number {
  return days / GAME_DAYS_PER_YEAR;
}

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function systemTravelDays(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, fleet: Pick<ServerFleet, "id" | "ownerId" | "speed">): number {
  const speedScale = Math.max(0.05, fleet.speed * getFleetSpeedMultiplier(state, fleet));
  return Math.max(0.1, distance3(from, to) / (SYSTEM_FLEET_SPEED_UNITS_PER_DAY * speedScale));
}

function isSameSystemPosition(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return distance3(a, b) <= 0.05;
}

function cloneSystemPosition(position: { x: number; y: number; z: number }): ReturnType<typeof systemCenterPosition> {
  return { x: position.x, y: position.y, z: position.z };
}

function hyperlaneTravelDays(fromStarId: number, toStarId: number, fleet: Pick<ServerFleet, "id" | "ownerId" | "speed">): number {
  const from = state.stars[fromStarId];
  const to = state.stars[toStarId];
  if (!from || !to) return phaseDurationDays("jumpingHyperlane", fleet);
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const speed = Math.max(0.05, fleet.speed * getFleetSpeedMultiplier(state, fleet) * 2);
  return Math.max(0.1, distance / speed);
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

function getPlanetConfigById(planetId: string): { star: StarData; planet: PlanetConfig; planetIndex: number } | null {
  for (const star of state.stars) {
    const planetIndex = star.system.planets.findIndex((planet) => planet.id === planetId);
    if (planetIndex < 0) continue;
    return { star, planet: star.system.planets[planetIndex], planetIndex };
  }
  return null;
}

function getPlanetSystemPositionAt(star: StarData, planet: PlanetConfig, planetIndex: number, year: number) {
  const nowMs = DEFAULT_ORBIT_EPOCH_MS + ((year - GAME_START_YEAR) * GAME_DAYS_PER_YEAR * REAL_MS_PER_GAME_DAY);
  return getPlanetSystemPosition(planet, planetIndex, nowMs, getSystemOrbitLayout(star.type));
}

function getFleetAuthoritativeSystemPosition(fleet: GameFleet, year = state.clock.year): ReturnType<typeof systemCenterPosition> {
  if (fleet.movementPlan) {
    const segment = fleet.movementPlan.segments.find((candidate) => (
      year >= candidate.startYear && year < candidate.endYear
    ));
    if (segment) {
      const progress = Math.max(
        0,
        Math.min(1, (year - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)),
      );
      return interpolateSystemPosition(segment.from, segment.to, progress);
    }
    const finalSegment = fleet.movementPlan.segments[fleet.movementPlan.segments.length - 1];
    if (finalSegment) return cloneSystemPosition(finalSegment.to);
  }
  if (fleet.orbitTargetPlanetId) {
    const star = state.stars[fleet.currentStarId];
    const planetIndex = star?.system.planets.findIndex((planet) => planet.id === fleet.orbitTargetPlanetId) ?? -1;
    const planet = planetIndex >= 0 ? star.system.planets[planetIndex] : null;
    if (star && planet) {
      const planetPosition = getPlanetSystemPositionAt(star, planet, planetIndex, year);
      const offset = fleet.orbitOffset ?? { x: SYSTEM_PLANET_ORBIT_DISTANCE, y: SYSTEM_FLEET_Y, z: 0 };
      return {
        x: planetPosition.x + offset.x,
        y: offset.y,
        z: planetPosition.z + offset.z,
      };
    }
  }
  return cloneSystemPosition(fleet.systemPosition ?? systemCenterPosition());
}

function getStarbaseInSystem(starId: number): ServerStarbase | null {
  return state.starbases.find((starbase) => starbase.starId === starId) ?? null;
}

function createStarOrbitTarget(starId: number, position = getSystemStarOrbitPosition()): FleetOrbitTarget {
  return { kind: "star", starId, position: cloneSystemPosition(position) };
}

function createStarbaseOrbitTarget(starbase: ServerStarbase, position?: ReturnType<typeof systemCenterPosition>): FleetOrbitTarget {
  const starbasePosition = starbase.systemPosition ?? getSystemStarbasePosition();
  const orbitPosition = position ?? getSystemStarbaseOrbitPosition(starbasePosition);
  return {
    kind: "starbase",
    starId: starbase.starId,
    starbaseId: starbase.id,
    position: cloneSystemPosition(orbitPosition),
  };
}

function getDefaultMoveDestination(starId: number): { position: ReturnType<typeof systemCenterPosition>; orbitTarget: FleetOrbitTarget } {
  const starbase = getStarbaseInSystem(starId);
  if (starbase) {
    const position = getSystemStarbaseOrbitPosition(starbase.systemPosition);
    return { position, orbitTarget: createStarbaseOrbitTarget(starbase, position) };
  }
  const position = getSystemStarOrbitPosition();
  return { position, orbitTarget: createStarOrbitTarget(starId, position) };
}

function movePointToward(
  from: ReturnType<typeof systemCenterPosition>,
  to: ReturnType<typeof systemCenterPosition>,
  maxDistance: number,
): ReturnType<typeof systemCenterPosition> {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001 || distance <= maxDistance) return cloneSystemPosition(to);
  const scale = maxDistance / distance;
  return { x: from.x + dx * scale, y: SYSTEM_FLEET_Y, z: from.z + dz * scale };
}

function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

function canFleetAcceptReplacementOrder(fleet: GameFleet): boolean {
  return fleet.phase !== "missingInAction" && fleet.combatStatus !== "destroyed" && fleet.shipIds.length > 0;
}

function clearFleetOrbit(fleet: GameFleet): void {
  fleet.orbitTargetPlanetId = null;
  fleet.orbitOffset = null;
  fleet.orbitTarget = null;
  fleet.mergeTargetFleetId = null;
}

function clearFleetCombatIntent(fleet: GameFleet): void {
  fleet.retreatState = null;
  fleet.currentTacticalOrder = null;
  fleet.currentTargetId = null;
  fleet.currentTargetKind = null;
  if (fleet.combatStatus !== "destroyed") fleet.combatStatus = "idle";
}

function prepareFleetForReplacementOrder(fleet: GameFleet): void {
  fleet.systemPosition = getFleetAuthoritativeSystemPosition(fleet);
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.orderType = null;
  fleet.hyperlanePosition = null;
  fleet.movementPlan = null;
  fleet.mergeTargetFleetId = null;
  clearFleetOrbit(fleet);
  clearFleetCombatIntent(fleet);
  setFleetPhase(fleet, "idle");
  fleet.phaseProgress = 0;
  fleet.phaseElapsedMs = 0;
}

function applyFleetOrbitTarget(fleet: GameFleet, orbitTarget: FleetOrbitTarget | null): void {
  fleet.orbitTarget = orbitTarget;
  fleet.orbitTargetPlanetId = orbitTarget?.kind === "planet" && orbitTarget.planetId ? orbitTarget.planetId : null;
  fleet.orbitOffset = orbitTarget?.kind === "planet"
    ? { x: SYSTEM_PLANET_ORBIT_DISTANCE, y: SYSTEM_FLEET_Y, z: 0 }
    : null;
}

function isFleetOrbitingStar(fleet: GameFleet, starId: number): boolean {
  return fleet.currentStarId === starId
    && (fleet.phase === "orbiting" || fleet.phase === "orbitingPlanet")
    && fleet.orbitTarget?.kind === "star"
    && fleet.orbitTarget.starId === starId;
}

function createFleetMovementPlan(
  fleet: GameFleet,
  route: number[],
  orderType: Exclude<FleetOrderType, null>,
  destinationPosition: ReturnType<typeof systemCenterPosition>,
  destinationOrbitTarget: FleetOrbitTarget | null = null,
  destinationPlanetId: string | null = null,
): FleetMovementPlan {
  const segments: FleetMovementSegment[] = [];
  let cursorYear = state.clock.year;
  let cursorPosition = getFleetAuthoritativeSystemPosition(fleet);

  for (let i = 0; i < route.length - 1; i++) {
    const fromStarId = route[i];
    const toStarId = route[i + 1];
    const fromStar = state.stars[fromStarId];
    const toStar = state.stars[toStarId];
    if (!fromStar || !toStar) continue;

    const exit = getSystemHyperlaneExitPosition(fromStar, toStar);
    cursorYear = addMovementSegment(
      segments,
      "system",
      fromStarId,
      fromStarId,
      cursorPosition,
      exit,
      cursorYear,
      systemTravelDays(cursorPosition, exit, fleet),
    );

    const entry = getSystemHyperlaneEntryPosition(fromStar, toStar);
    cursorYear = addMovementSegment(
      segments,
      "hyperlane",
      fromStarId,
      toStarId,
      exit,
      entry,
      cursorYear,
      hyperlaneTravelDays(fromStarId, toStarId, fleet),
    );

    cursorPosition = entry;
  }

  const destinationStarId = route[route.length - 1] ?? fleet.currentStarId;
  let finalDestinationPosition = destinationPosition;
  let finalOrbitTarget = destinationOrbitTarget;
  if (destinationOrbitTarget?.kind === "planet" && destinationOrbitTarget.planetId) {
    const target = getPlanetConfigById(destinationOrbitTarget.planetId);
    if (target) {
      const planetPosition = getPlanetSystemPositionAt(target.star, target.planet, target.planetIndex, cursorYear);
      finalDestinationPosition = {
        x: planetPosition.x + SYSTEM_PLANET_ORBIT_DISTANCE,
        y: SYSTEM_FLEET_Y,
        z: planetPosition.z,
      };
      finalOrbitTarget = { ...destinationOrbitTarget, position: finalDestinationPosition };
    }
  }

  if (!isSameSystemPosition(cursorPosition, finalDestinationPosition)) {
    cursorYear = addMovementSegment(
      segments,
      finalOrbitTarget?.kind === "planet" ? "orbit" : "system",
      destinationStarId,
      destinationStarId,
      cursorPosition,
      finalDestinationPosition,
      cursorYear,
      systemTravelDays(cursorPosition, finalDestinationPosition, fleet),
      destinationPlanetId,
    );
  }

  return {
    destinationStarId,
    destinationPlanetId,
    destinationPosition: finalDestinationPosition,
    destinationOrbitTarget: finalOrbitTarget,
    startedAtYear: state.clock.year,
    endsAtYear: cursorYear,
    totalDays: Math.max(0, (cursorYear - state.clock.year) * GAME_DAYS_PER_YEAR),
    segments,
  };
}

function findRoute(fleet: GameFleet, targetStarId: number): number[] | null {
  const discovered = new Set(state.discoveredByFaction[String(fleet.ownerId)] ?? []);
  if (!discovered.has(targetStarId)) return null;
  const startStarId = fleet.currentStarId;
  const distances = new Map<number, number>([[startStarId, 0]]);
  const previous = new Map<number, number | null>([[startStarId, null]]);
  const unsettled = new Set<number>([startStarId]);

  while (unsettled.size > 0) {
    let current = -1;
    let currentDistance = Number.POSITIVE_INFINITY;
    for (const candidate of unsettled) {
      const distance = distances.get(candidate) ?? Number.POSITIVE_INFINITY;
      if (distance < currentDistance) {
        current = candidate;
        currentDistance = distance;
      }
    }
    if (current < 0) break;
    unsettled.delete(current);
    if (current === targetStarId) break;

    for (const neighbor of state.adjacency[current] ?? []) {
      if (!discovered.has(neighbor)) continue;
      if (neighbor !== startStarId && !canEnterSystem(fleet.ownerId, neighbor)) continue;
      const nextDistance = currentDistance + hyperlaneTravelDays(current, neighbor, fleet);
      if (nextDistance >= (distances.get(neighbor) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(neighbor, nextDistance);
      previous.set(neighbor, current);
      unsettled.add(neighbor);
    }
  }

  if (!previous.has(targetStarId)) return null;
  const route: number[] = [];
  let cursor: number | null = targetStarId;
  while (cursor !== null) {
    route.push(cursor);
    cursor = previous.get(cursor) ?? null;
  }
  route.reverse();
  return route.length > 1 && routeIsAllowed(route, fleet.ownerId) ? route : null;
}

function startPositionOrder(
  fleet: GameFleet,
  targetStarId: number,
  orderType: Exclude<FleetOrderType, null>,
  targetPosition: ReturnType<typeof systemCenterPosition>,
  orbitTarget: FleetOrbitTarget | null = null,
  routeOverride: number[] | null = null,
): void {
  const route = routeOverride ?? (targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(fleet, targetStarId));
  if (!route || !routeIsAllowed(route, fleet.ownerId)) throw new Error("No discovered safe route to target.");
  fleet.targetStarId = targetStarId;
  fleet.orderType = orderType;
  fleet.route = route;
  fleet.routeIndex = 0;
  fleet.movementPlan = createFleetMovementPlan(fleet, route, orderType, targetPosition, orbitTarget, orbitTarget?.planetId ?? null);
  fleet.hyperlanePosition = null;
  applyFleetOrbitTarget(fleet, null);
  if (fleet.movementPlan.segments.length === 0) {
    fleet.currentStarId = targetStarId;
    fleet.systemPosition = cloneSystemPosition(targetPosition);
    if (orderType === "build") {
      applyFleetOrbitTarget(fleet, createStarOrbitTarget(targetStarId, targetPosition));
      setFleetPhase(fleet, "buildingStarbase");
    } else if (orbitTarget?.kind === "planet") {
      applyFleetOrbitTarget(fleet, orbitTarget);
      setFleetPhase(fleet, "orbitingPlanet");
    } else if (orbitTarget) {
      applyFleetOrbitTarget(fleet, orbitTarget);
      setFleetPhase(fleet, "orbiting");
    } else {
      setFleetPhase(fleet, "idle");
    }
    fleet.movementPlan = null;
    return;
  }

  const firstSegment = fleet.movementPlan.segments[0];
  setFleetPhase(fleet, firstSegment.kind === "hyperlane" ? "jumpingHyperlane" : "movingSystem");
  fleet.phaseStartedAtYear = firstSegment.startYear;
  fleet.phaseDurationDays = Math.max(0.1, (firstSegment.endYear - firstSegment.startYear) * GAME_DAYS_PER_YEAR);
}

function startMoveOrder(
  fleet: GameFleet,
  targetStarId: number,
  targetPosition?: ReturnType<typeof systemCenterPosition>,
  orbitTarget?: FleetOrbitTarget | null,
): void {
  const destination = targetPosition
    ? {
      position: cloneSystemPosition(targetPosition),
      orbitTarget: orbitTarget
        ? { ...orbitTarget, starId: targetStarId, position: cloneSystemPosition(targetPosition) }
        : null,
    }
    : getDefaultMoveDestination(targetStarId);

  const routeOverride = destination.orbitTarget?.kind === "hyperlane"
    && fleet.currentStarId !== targetStarId
    && state.adjacency[fleet.currentStarId]?.includes(targetStarId)
    ? [fleet.currentStarId, targetStarId]
    : null;
  startPositionOrder(fleet, targetStarId, "move", destination.position, destination.orbitTarget, routeOverride);
}

function startAttackSystemOrder(fleet: GameFleet, targetStarId: number): void {
  const hostileStarbase = state.starbases.find((starbase) => (
    starbase.starId === targetStarId
    && isHostileOwner(fleet.ownerId, starbase.ownerId)
  ));
  const hostileFleet = state.fleets.find((candidate) => (
    candidate.id !== fleet.id
    && candidate.currentStarId === targetStarId
    && isHostileOwner(fleet.ownerId, candidate.ownerId)
  ));
  const destination = hostileStarbase
    ? {
      position: cloneSystemPosition(hostileStarbase.systemPosition ?? getSystemStarbasePosition()),
      orbitTarget: createStarbaseOrbitTarget(hostileStarbase),
    }
    : hostileFleet
      ? {
        position: getFleetAuthoritativeSystemPosition(hostileFleet),
        orbitTarget: {
          kind: "fleet" as const,
          starId: hostileFleet.currentStarId,
          targetFleetId: hostileFleet.id,
          position: getFleetAuthoritativeSystemPosition(hostileFleet),
        },
      }
      : getDefaultMoveDestination(targetStarId);

  startPositionOrder(fleet, targetStarId, "attack", destination.position, destination.orbitTarget);
  fleet.currentTacticalOrder = { type: "attack", issuedAtYear: state.clock.year };
  if (fleet.combatStance === "passive" || fleet.combatStance === "evade") {
    fleet.combatStance = "aggressive";
  }
}

function startBuildOrder(fleet: GameFleet, targetStarId: number): void {
  const starPosition = getSystemStarOrbitPosition();
  if (isFleetOrbitingStar(fleet, targetStarId)) {
    fleet.targetStarId = targetStarId;
    fleet.orderType = "build";
    fleet.route = [targetStarId];
    fleet.routeIndex = 0;
    fleet.movementPlan = null;
    fleet.hyperlanePosition = null;
    fleet.systemPosition = starPosition;
    applyFleetOrbitTarget(fleet, createStarOrbitTarget(targetStarId, starPosition));
    setFleetPhase(fleet, "buildingStarbase");
    return;
  }
  startPositionOrder(fleet, targetStarId, "build", starPosition, createStarOrbitTarget(targetStarId, starPosition));
}

function startOrbitOrder(fleet: GameFleet, planetId: string): void {
  const target = getPlanetConfigById(planetId);
  if (!target) throw new Error("Planet not found.");
  const route = target.star.id === fleet.currentStarId ? [fleet.currentStarId] : findRoute(fleet, target.star.id);
  if (!route) throw new Error("No discovered safe route to planet.");
  const planetPosition = getPlanetSystemPositionAt(target.star, target.planet, target.planetIndex, state.clock.year);
  const orbitPosition = {
    x: planetPosition.x + SYSTEM_PLANET_ORBIT_DISTANCE,
    y: SYSTEM_FLEET_Y,
    z: planetPosition.z,
  };
  const orbitTarget: FleetOrbitTarget = {
    kind: "planet",
    starId: target.star.id,
    planetId,
    position: orbitPosition,
  };

  startPositionOrder(fleet, target.star.id, "orbit", orbitPosition, orbitTarget, route);
}

function completeMergeSourceFleet(sourceFleet: GameFleet): boolean {
  const targetFleetId = sourceFleet.mergeTargetFleetId;
  if (!targetFleetId) return false;
  const targetFleet = state.fleets.find((fleet) => fleet.id === targetFleetId);
  if (!targetFleet || targetFleet.id === sourceFleet.id) {
    cancelMergeSourceOrder(sourceFleet);
    return false;
  }
  if (targetFleet.currentStarId !== sourceFleet.currentStarId) return false;

  const sourcePosition = getFleetAuthoritativeSystemPosition(sourceFleet);
  const targetPosition = getFleetAuthoritativeSystemPosition(targetFleet);
  if (!isSameSystemPosition(sourcePosition, targetPosition)) {
    return false;
  }

  for (const shipId of sourceFleet.shipIds) {
    if (!targetFleet.shipIds.includes(shipId)) targetFleet.shipIds.push(shipId);
  }
  for (const fleet of state.fleets) {
    if (fleet.mergeTargetFleetId === sourceFleet.id) {
      fleet.mergeTargetFleetId = targetFleet.id;
    }
  }
  state.ships = state.ships.map((ship) => (
    ship.fleetId === sourceFleet.id ? { ...ship, fleetId: targetFleet.id } : ship
  ));
  state.fleets = state.fleets.filter((fleet) => fleet.id !== sourceFleet.id);
  syncFleetMembership(state);
  return true;
}

function cancelMergeSourceOrder(sourceFleet: GameFleet): void {
  sourceFleet.targetStarId = null;
  sourceFleet.orderType = null;
  sourceFleet.route = [sourceFleet.currentStarId];
  sourceFleet.routeIndex = 0;
  sourceFleet.movementPlan = null;
  sourceFleet.mergeTargetFleetId = null;
  sourceFleet.hyperlanePosition = null;
  applyFleetOrbitTarget(sourceFleet, null);
  setFleetPhase(sourceFleet, "idle");
}

function startMergeSourceOrder(sourceFleet: GameFleet, targetFleet: GameFleet): void {
  sourceFleet.mergeTargetFleetId = targetFleet.id;
  if (completeMergeSourceFleet(sourceFleet)) return;

  const targetPosition = getFleetAuthoritativeSystemPosition(targetFleet);
  const orbitTarget: FleetOrbitTarget = {
    kind: "fleet",
    starId: targetFleet.currentStarId,
    targetFleetId: targetFleet.id,
    position: targetPosition,
  };
  const routeOverride = sourceFleet.currentStarId === targetFleet.currentStarId ? [sourceFleet.currentStarId] : null;
  startPositionOrder(sourceFleet, targetFleet.currentStarId, "merge", targetPosition, orbitTarget, routeOverride);
  sourceFleet.mergeTargetFleetId = targetFleet.id;
}

function isMergeSourceEligible(fleet: GameFleet): boolean {
  return fleet.phase !== "missingInAction" && fleet.phase !== "buildingStarbase" && fleet.retreatState === null;
}

function advanceMergeSourceFleet(sourceFleet: GameFleet, scaledMs: number): boolean {
  if (sourceFleet.orderType !== "merge" || !sourceFleet.mergeTargetFleetId) return false;
  const targetFleet = state.fleets.find((fleet) => fleet.id === sourceFleet.mergeTargetFleetId);
  if (!targetFleet || targetFleet.id === sourceFleet.id || targetFleet.ownerId !== sourceFleet.ownerId) {
    cancelMergeSourceOrder(sourceFleet);
    return true;
  }

  if (completeMergeSourceFleet(sourceFleet)) return true;

  const targetPosition = getFleetAuthoritativeSystemPosition(targetFleet);
  const sourcePosition = getFleetAuthoritativeSystemPosition(sourceFleet);
  if (sourceFleet.currentStarId === targetFleet.currentStarId && !sourceFleet.hyperlanePosition) {
    const elapsedDays = Math.max(0, scaledMs / REAL_MS_PER_GAME_DAY);
    const fleetSpeed = getFleetSpeedMultiplier(state, sourceFleet);
    const maxDistance = elapsedDays * SYSTEM_FLEET_SPEED_UNITS_PER_DAY * Math.max(0.15, sourceFleet.speed * fleetSpeed);
    const nextPosition = movePointToward(sourcePosition, targetPosition, maxDistance);
    sourceFleet.targetStarId = targetFleet.currentStarId;
    sourceFleet.route = [targetFleet.currentStarId];
    sourceFleet.routeIndex = 0;
    sourceFleet.movementPlan = null;
    sourceFleet.hyperlanePosition = null;
    sourceFleet.systemPosition = nextPosition;
    sourceFleet.orbitTarget = {
      kind: "fleet",
      starId: targetFleet.currentStarId,
      targetFleetId: targetFleet.id,
      position: cloneSystemPosition(targetPosition),
    };
    sourceFleet.orbitTargetPlanetId = null;
    sourceFleet.orbitOffset = null;
    sourceFleet.phase = "movingSystem";
    sourceFleet.phaseStartedAtYear = state.clock.year;
    sourceFleet.phaseDurationDays = Math.max(0.1, systemTravelDays(nextPosition, targetPosition, sourceFleet));
    sourceFleet.phaseProgress = isSameSystemPosition(nextPosition, targetPosition) ? 1 : 0;
    if (completeMergeSourceFleet(sourceFleet)) return true;
    return false;
  }

  const plan = sourceFleet.movementPlan;
  const finalDestination = plan?.destinationPosition ?? null;
  const destinationMoved = sourceFleet.currentStarId === targetFleet.currentStarId
    && finalDestination
    && !isSameSystemPosition(finalDestination, targetPosition);
  if (!plan || plan.destinationStarId !== targetFleet.currentStarId || destinationMoved) {
    startMergeSourceOrder(sourceFleet, targetFleet);
  }
  return false;
}

function validateCommandPerspective(perspective: GalaxyPerspective): number | null {
  return perspective.mode === "faction" ? perspective.factionId : null;
}

function resolveFleetForCommand(fleetId?: string, shipId?: string): GameFleet | null {
  if (fleetId) {
    return state.fleets.find((candidate) => candidate.id === fleetId) ?? null;
  }
  if (!shipId) return null;
  const ship = state.ships.find((candidate) => candidate.id === shipId);
  if (ship) {
    return state.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
  }
  return state.fleets.find((candidate) => candidate.id === shipId) ?? null;
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
    prepareFleetForReplacementOrder(fleet);
    startMoveOrder(fleet, targetStarId, targetSystemPosition, orbitTarget);
    hasDirtyState = true;
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
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= state.stars.length) return reject(socket, "Invalid target system.");
  if (!fleetHasConstructionShip(fleet)) return reject(socket, "Requires a construction ship.");
  if (state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(socket, "System already has a starbase.");
  try {
    prepareFleetForReplacementOrder(fleet);
    startBuildOrder(fleet, targetStarId);
    hasDirtyState = true;
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
    prepareFleetForReplacementOrder(fleet);
    startOrbitOrder(fleet, planetId);
    hasDirtyState = true;
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

  const planetState = getPlanetState(planetId);
  if (!planetState) return reject(socket, "Planet not found.");
  const planet = getPlanetConfig(planetState);
  if (!planet) return reject(socket, "Planet details are unavailable.");
  if ((state.starOwnership[planetState.starId] ?? -1) !== factionId) {
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

  const foundingSpeciesId = state.factions.find((faction) => faction.id === factionId)?.foundingSpeciesId
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
    getPlanetSpeciesContext(state, prospectiveState),
  );
  if (habitability <= 0) return reject(socket, "Planet habitability is too low to colonize.");

  state.ships = state.ships.filter((ship) => ship.id !== colonizationShip.id);
  const fleetChanged = syncFleetMembership(state);
  state.planetStates = state.planetStates.map((candidate) => (
    candidate.id === prospectiveState.id ? prospectiveState : candidate
  ));
  applyPlanetStatesToStars(state.stars, state.planetStates);
  queuePlanetDetailRefresh(prospectiveState.id);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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
  const targetFleet = state.fleets.find((fleet) => fleet.id === targetFleetId);
  if (!targetFleet) return reject(socket, "Target fleet not found.");
  if (targetFleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");

  const uniqueSourceIds = Array.from(new Set(sourceFleetIds)).filter((id) => id !== targetFleetId);
  if (uniqueSourceIds.length === 0) return reject(socket, "No fleets selected to merge.");

  const sourceFleets = uniqueSourceIds
    .map((id) => state.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is GameFleet => !!fleet);

  if (sourceFleets.length !== uniqueSourceIds.length) return reject(socket, "A source fleet was not found.");
  for (const fleet of sourceFleets) {
    if (fleet.ownerId !== factionId) return reject(socket, "You do not own all selected fleets.");
    if (!isMergeSourceEligible(fleet)) return reject(socket, "A selected fleet cannot currently merge.");
    if (fleet.currentStarId !== targetFleet.currentStarId && !findRoute(fleet, targetFleet.currentStarId)) {
      return reject(socket, "No discovered safe route to the target fleet.");
    }
  }

  let mergedCount = 0;
  let movingCount = 0;
  for (const fleet of sourceFleets) {
    prepareFleetForReplacementOrder(fleet);
    startMergeSourceOrder(fleet, targetFleet);
    if (state.fleets.some((candidate) => candidate.id === fleet.id)) {
      movingCount += 1;
    } else {
      mergedCount += 1;
    }
  }

  hasDirtyState = true;
  accept(socket, movingCount > 0 ? `Merge rendezvous ordered for ${movingCount} fleet(s).` : `Merged ${mergedCount} fleet(s).`);
  broadcastUpdates(["clock", "ships", "fleets", "visibility"]);
}

function handleStopFleet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (fleet.phase === "missingInAction") return reject(socket, "Fleet is missing in action.");

  clearFleetMovementNow(fleet);
  hasDirtyState = true;
  refreshDiscovery();
  accept(socket, "Fleet stopped.");
  broadcastUpdates(["clock", "fleets", "visibility"]);
}

function handleRetreatFleet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): void {
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  const destination = fleet ? resolveFleetRetreatDestination(fleet) : null;
  handleRetreatFleetTo(socket, perspective, fleetId, destination?.targetStarId ?? -1, destination?.targetSystemPosition ?? undefined);
}

function validateRetreatTarget(socket: WebSocket, perspective: GalaxyPerspective, fleet: GameFleet, targetStarId: number, requireRoute: boolean): boolean {
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= state.stars.length) {
    reject(socket, "Invalid retreat target.");
    return false;
  }
  if (perspective.mode !== "observer") {
    const known = state.discoveredByFaction[String(perspective.factionId)] ?? [];
    if (!known.includes(targetStarId)) {
      reject(socket, "Retreat target is not known.");
      return false;
    }
  }
  if (requireRoute && targetStarId !== fleet.currentStarId && !findRoute(fleet, targetStarId)) {
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
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!validateRetreatTarget(socket, perspective, fleet, targetStarId, true)) return;

  fleet.retreatState = {
    mode: "system",
    status: "escaping",
    targetStarId,
    targetSystemPosition: targetSystemPosition ?? null,
    startedAtYear: state.clock.year,
  };
  fleet.combatSettings = {
    ...fleet.combatSettings,
    retreatDestination: {
      kind: "selectedSystem",
      targetStarId,
      targetSystemPosition: targetSystemPosition ?? null,
    },
  };
  fleet.currentTacticalOrder = { type: "retreat", issuedAtYear: state.clock.year };
  fleet.combatStatus = "retreating";
  startFleetRetreat(fleet);
  hasDirtyState = true;
  accept(socket, "Fleet ordered to retreat to target system.");
  broadcastUpdates(["fleets"]);
}

function estimateEmergencyMiaDays(fleet: GameFleet, targetStarId: number): number {
  const route = targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(fleet, targetStarId);
  if (route && route.length > 1) {
    let days = 0;
    for (let i = 0; i < route.length - 1; i += 1) {
      days += hyperlaneTravelDays(route[i], route[i + 1], fleet);
    }
    return Math.max(EMERGENCY_RETREAT_MIN_MIA_DAYS, days * 0.6);
  }
  const from = state.stars[fleet.currentStarId];
  const to = state.stars[targetStarId];
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
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!validateRetreatTarget(socket, perspective, fleet, targetStarId, false)) return;

  const lostShipIds = new Set<string>();
  const activeShips = state.ships.filter((ship) => ship.fleetId === fleetId && ship.hull > 0);

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
    state.ships = state.ships.filter((ship) => !lostShipIds.has(ship.id));
    syncFleetMembership(state);
  }

  const miaDays = estimateEmergencyMiaDays(fleet, targetStarId);
  fleet.retreatState = {
    mode: "emergencyFtl",
    status: "mia",
    targetStarId,
    startedAtYear: state.clock.year,
    miaUntilYear: state.clock.year + gameDaysToYears(miaDays),
    riskApplied: true,
  };
  fleet.targetStarId = targetStarId;
  fleet.orderType = "retreat";
  fleet.movementPlan = null;
  fleet.hyperlanePosition = null;
  clearFleetOrbit(fleet);
  setFleetPhase(fleet, "missingInAction");

  hasDirtyState = true;
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
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  const targetOwnerId = targetKind === "fleet"
    ? state.fleets.find((candidate) => candidate.id === targetId)?.ownerId
    : state.starbases.find((candidate) => candidate.id === targetId)?.ownerId;
  const targetStarId = targetKind === "fleet"
    ? state.fleets.find((candidate) => candidate.id === targetId)?.currentStarId
    : state.starbases.find((candidate) => candidate.id === targetId)?.starId;
  if (targetOwnerId === undefined || targetStarId === undefined) return reject(socket, "Target not found.");
  if (targetStarId !== fleet.currentStarId) return reject(socket, "Target is not in the same system.");
  if (!isHostileOwner(fleet.ownerId, targetOwnerId)) return reject(socket, "Target is not hostile.");
  prepareFleetForReplacementOrder(fleet);
  fleet.currentTacticalOrder = {
    type: "attack",
    targetId,
    targetKind,
    issuedAtYear: state.clock.year,
  };
  fleet.currentTargetId = targetId;
  fleet.currentTargetKind = targetKind;
  if (fleet.combatStance === "passive" || fleet.combatStance === "evade") {
    fleet.combatStance = "aggressive";
  }
  hasDirtyState = true;
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
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");
  if (!canFleetAcceptReplacementOrder(fleet)) return reject(socket, "Fleet cannot accept orders right now.");
  if (!Number.isInteger(targetStarId) || targetStarId < 0 || targetStarId >= state.stars.length) return reject(socket, "Invalid target system.");
  try {
    prepareFleetForReplacementOrder(fleet);
    startAttackSystemOrder(fleet, targetStarId);
    hasDirtyState = true;
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
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId) ?? null;
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
  return state.ships.filter((ship) => shipIds.has(ship.id));
}

function commitFleetDoctrineChange(socket: WebSocket, message: string): void {
  hasDirtyState = true;
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
    issuedAtYear: state.clock.year,
  });
  if (!order) return reject(socket, "Invalid fleet tactical order.");
  if (order.type === "move" && !order.targetPosition) return reject(socket, "Move orders require a system position.");
  if (order.type === "attack" && (!order.targetId || !order.targetKind)) return reject(socket, "Attack orders require a target.");
  if (order.type === "guard" && !order.targetPosition && !order.guardPosition) return reject(socket, "Guard orders require a position.");
  if (order.type !== "retreat") {
    prepareFleetForReplacementOrder(fleet);
  }
  fleet.currentTacticalOrder = order;
  if (order.type === "hold") fleet.combatStance = "holdPosition";
  if (order.type === "guard") fleet.combatStance = "guardArea";
  if (order.type === "retreat") {
    retreatFleetByDoctrine(fleet);
  }
  hasDirtyState = true;
  accept(socket, "Fleet tactical order accepted.");
  broadcastUpdates(["fleets"]);
}

function getPlanetState(planetId: string): PlanetState | null {
  return state.planetStates.find((planetState) => planetState.id === planetId) ?? null;
}

function getPlanetConfig(planetState: PlanetState): PlanetConfig | null {
  return state.stars[planetState.starId]?.system.planets[planetState.planetIndex] ?? null;
}

function canAccessStar(perspective: GalaxyPerspective, starId: number): boolean {
  if (starId < 0 || starId >= state.stars.length) return false;
  if (perspective.mode === "observer") return true;
  const known = state.discoveredByFaction[String(perspective.factionId)] ?? [];
  return known.includes(starId);
}

function canAccessPlanet(perspective: GalaxyPerspective, planetState: PlanetState): boolean {
  return canAccessStar(perspective, planetState.starId);
}

function sendPlanetDetails(socket: WebSocket, perspective: GalaxyPerspective, planetId: string): void {
  const planetState = getPlanetState(planetId);
  if (!planetState || !canAccessPlanet(perspective, planetState)) {
    reject(socket, "Planet is not available.");
    return;
  }
  const planet = getPlanetConfig(planetState);
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

function canAccessStarbase(perspective: GalaxyPerspective, starbase: ServerStarbase): boolean {
  return canAccessStar(perspective, starbase.starId);
}

function getVisibleFullStarbases(perspective: GalaxyPerspective): ServerStarbase[] {
  const visibleSet = getVisibleSet(perspective);
  return visibleSet
    ? state.starbases.filter((starbase) => visibleSet.has(starbase.starId))
    : state.starbases;
}

function getVisibleFullFleets(perspective: GalaxyPerspective): ServerFleet[] {
  const visibleSet = getVisibleSet(perspective);
  return state.fleets.filter((fleet) => isFleetVisible(fleet, visibleSet, perspective));
}

function getVisibleFullShips(perspective: GalaxyPerspective, fleets = getVisibleFullFleets(perspective)): ServerShip[] {
  const visibleFleetIds = new Set(fleets.map((fleet) => fleet.id));
  return state.ships.filter((ship) => visibleFleetIds.has(ship.fleetId));
}

function createVisibleDetailState(perspective: GalaxyPerspective) {
  const visibleState = createVisibleState(perspective);
  const fleets = getVisibleFullFleets(perspective);
  return {
    ...visibleState,
    fleets,
    ships: getVisibleFullShips(perspective, fleets),
    starbases: getVisibleFullStarbases(perspective),
  };
}

function createDiplomacyMovementPayload(perspective: GalaxyPerspective): DiplomacyMovementPayload {
  if (perspective.mode !== "faction") {
    return {
      playerFactionId: null,
      openBorderFactionIds: [],
      warFactionIds: [],
    };
  }
  const playerFactionId = perspective.factionId;
  const openBorderFactionIds: number[] = [];
  const warFactionIds: number[] = [];
  for (const faction of state.factions) {
    if (faction.id === playerFactionId) continue;
    if (getBorderPolicy(state.diplomacy, faction.id, playerFactionId) === "open") {
      openBorderFactionIds.push(faction.id);
    }
    if (areFactionsAtWar(state.diplomacy, playerFactionId, faction.id)) {
      warFactionIds.push(faction.id);
    }
  }
  return {
    playerFactionId,
    openBorderFactionIds: openBorderFactionIds.sort((a, b) => a - b),
    warFactionIds: warFactionIds.sort((a, b) => a - b),
  };
}

function createSystemDetailPayload(
  perspective: GalaxyPerspective,
  starId: number,
): { payload: SystemDetailPayload; revision: string; normalizedId: number } | { error: string } {
  const knownSet = getKnownSet(perspective);
  const visibleState = createVisibleState(perspective);
  const ownerByStar = new Array<number>(state.stars.length).fill(-1);
  for (const [ownedStarId, ownerId] of visibleState.starOwnership) {
    if (ownedStarId >= 0 && ownedStarId < ownerByStar.length) ownerByStar[ownedStarId] = ownerId;
  }
  const visibleFleets = getVisibleFullFleets(perspective);
  const result = buildSystemDetailPayload({
    perspective,
    starId,
    stars: state.stars,
    visibleStars: createVisibleStars(perspective, knownSet),
    knownStarIds: knownSet,
    hyperlanes: visibleState.hyperlanes,
    planetStates: state.planetStates,
    fleets: visibleFleets,
    ships: getVisibleFullShips(perspective, visibleFleets),
    starbases: getVisibleFullStarbases(perspective),
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

interface FactionResourceFlow {
  production: ResourceCounts;
  consumption: ResourceCounts;
}

interface PlayerMarketQuote {
  finalQuotePrice: number;
  buyPrice: number;
  sellPrice: number;
  productionPerHour: number;
  consumptionPerHour: number;
  internalSupply: number;
  internalDemand: number;
  playerInternalModifier: number;
  ownedAmount: number;
}

function calculateFactionResourceFlow(nextState: GameState, factionId: number): FactionResourceFlow {
  const production = createEmptyResourceCounts();
  const consumption = createEmptyResourceCounts();

  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    for (const resource of RESOURCE_KINDS) {
      production[resource] += Math.max(0, planetState.economy.production[resource]);
      consumption[resource] += Math.max(0, planetState.economy.upkeep[resource]);
    }
  }

  for (const starbase of nextState.starbases) {
    if (starbase.ownerId !== factionId || starbase.status !== "online") continue;
    for (const resource of RESOURCE_KINDS) {
      production[resource] += Math.max(0, starbase.economy.production[resource]);
      consumption[resource] += Math.max(0, starbase.economy.upkeep[resource]);
    }
  }

  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId || ship.hull <= 0) continue;
    const design = resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId);
    const fleet = nextState.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const upkeepMultiplier = fleet
      ? getFleetLeaderEffects(nextState, fleet.id).upkeepMultiplier
        * getGovernmentFleetEffects(nextState, fleet.ownerId).upkeepMultiplier
      : getGovernmentFleetEffects(nextState, ship.ownerId).upkeepMultiplier;
    const upkeep = scaleResourceCounts(calculateShipDesignStats(design).upkeep, upkeepMultiplier);
    for (const resource of RESOURCE_KINDS) {
      consumption[resource] += Math.max(0, upkeep[resource]);
    }
  }

  return { production, consumption };
}

function getMarketPlayerStats(factionId: number): MarketPlayerStats {
  let stats = state.market.playerStats.find((candidate) => candidate.playerId === factionId);
  if (!stats) {
    stats = {
      playerId: factionId,
      totalImportsEnergy: 0,
      totalExportsEnergy: 0,
    };
    state.market.playerStats.push(stats);
    hasDirtyState = true;
  }
  return stats;
}

function getReadonlyMarketPlayerStats(factionId: number | null): MarketPlayerStats | null {
  if (factionId === null) return null;
  return state.market.playerStats.find((candidate) => candidate.playerId === factionId) ?? {
    playerId: factionId,
    totalImportsEnergy: 0,
    totalExportsEnergy: 0,
  };
}

function getMarketResourceState(resourceId: ResourceKind): MarketResourceState | null {
  return state.market.resources.find((resource) => resource.resourceId === resourceId) ?? null;
}

function getMarketPriceHistory(resourceId: ResourceKind): MarketPriceSnapshot[] {
  return state.market.priceSnapshots
    .filter((snapshot) => snapshot.resourceId === resourceId)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function getMarketTrend(resourceId: ResourceKind, currentPrice: number): MarketResourceQuote["trend"] {
  const history = getMarketPriceHistory(resourceId);
  const previous = history.length >= 2 ? history[history.length - 2]?.price : history[0]?.price;
  if (!Number.isFinite(previous) || !previous) return "flat";
  const change = (currentPrice - previous) / Math.max(0.000001, previous);
  if (change > 0.005) return "up";
  if (change < -0.005) return "down";
  return "flat";
}

function appendMarketPriceSnapshot(resource: MarketResourceState, timestamp = state.clock.year): void {
  state.market.priceSnapshots.push({
    resourceId: resource.resourceId,
    price: resource.currentPrice,
    temporaryPressure: resource.temporaryPressure,
    persistentPressure: resource.persistentPressure,
    timestamp,
  });
  state.market.priceSnapshots = trimMarketPriceSnapshots(state.market.priceSnapshots);
}

function calculatePlayerMarketQuote(
  resource: MarketResourceState,
  factionId: number | null,
  flows?: FactionResourceFlow,
  nextState = state,
): PlayerMarketQuote {
  const economy = factionId === null
    ? null
    : nextState.factionEconomies.find((candidate) => candidate.factionId === factionId) ?? null;
  const productionPerHour = factionId === null || !flows
    ? 0
    : Math.max(0, flows.production[resource.resourceId]) / GAME_HOURS_PER_MONTH;
  const consumptionPerHour = factionId === null || !flows
    ? 0
    : Math.max(0, flows.consumption[resource.resourceId]) / GAME_HOURS_PER_MONTH;
  let effectiveProductionPerHour = productionPerHour;
  let effectiveConsumptionPerHour = consumptionPerHour;

  if (factionId !== null) {
    const tradePrivilege = TREATY_ARTICLE_DEFINITIONS.find((article) => article.id === TRADE_PRIVILEGE_ARTICLE_ID);
    const shareFraction = tradePrivilege?.effects.find((effect) => effect.type === "marketSharedSupply")?.shareFraction ?? 0;
    if (shareFraction > 0) {
      for (const partnerId of getActiveTreatyPartnersForArticle(nextState.diplomacy, factionId, TRADE_PRIVILEGE_ARTICLE_ID)) {
        const partnerFlows = calculateFactionResourceFlow(nextState, partnerId);
        effectiveProductionPerHour += (Math.max(0, partnerFlows.production[resource.resourceId]) / GAME_HOURS_PER_MONTH) * shareFraction;
        effectiveConsumptionPerHour += (Math.max(0, partnerFlows.consumption[resource.resourceId]) / GAME_HOURS_PER_MONTH) * shareFraction;
      }
    }
  }

  const internalSupply = effectiveProductionPerHour;
  let internalDemand = effectiveConsumptionPerHour * 0.85;

  if (effectiveConsumptionPerHour > effectiveProductionPerHour) {
    const deficitRatio = clamp(
      (effectiveConsumptionPerHour - effectiveProductionPerHour) / Math.max(effectiveConsumptionPerHour, 1),
      0,
      1,
    );
    internalDemand *= 1 - (0.12 * deficitRatio);
  }

  const ratio = (internalDemand + 10) / (internalSupply + 10);
  const playerInternalModifier = factionId === null
    ? 1
    : clamp(
      Math.pow(ratio, 0.18),
      PLAYER_INTERNAL_MODIFIER_MIN,
      PLAYER_INTERNAL_MODIFIER_MAX,
    );
  const finalQuotePrice = resource.currentPrice * playerInternalModifier;

  return {
    finalQuotePrice,
    buyPrice: finalQuotePrice * (1 + MARKET_FEE_RATE),
    sellPrice: finalQuotePrice * (1 - MARKET_FEE_RATE),
    productionPerHour,
    consumptionPerHour,
    internalSupply,
    internalDemand,
    playerInternalModifier,
    ownedAmount: economy?.stockpiles[resource.resourceId] ?? 0,
  };
}

function createMarketDetailPayload(perspective: GalaxyPerspective): MarketDetailPayload {
  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  const flows = factionId === null ? undefined : calculateFactionResourceFlow(state, factionId);
  const playerStats = getReadonlyMarketPlayerStats(factionId);
  const resources = state.market.resources.map<MarketResourceQuote>((resource) => {
    const quote = calculatePlayerMarketQuote(resource, factionId, flows);
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
      priceHistory: getMarketPriceHistory(resource.resourceId),
      trend: getMarketTrend(resource.resourceId, resource.currentPrice),
    };
  });

  return {
    resources,
    playerStats,
    autoTrades: factionId === null
      ? []
      : state.market.autoTrades.filter((order) => order.playerId === factionId),
    transactions: factionId === null
      ? state.market.transactions.slice(-24)
      : state.market.transactions.filter((transaction) => transaction.playerId === factionId).slice(-24),
    marketFee: MARKET_FEE_RATE,
  };
}

function createDiplomacyDetailPayload(perspective: GalaxyPerspective): DiplomacyDetailPayload {
  const playerFactionId = perspective.mode === "faction" ? perspective.factionId : null;
  const factions: FactionState[] = state.factions.map((faction) => ({
    ...faction,
    discoveredStarIds: state.discoveredByFaction[String(faction.id)] ?? [],
  }));
  const activeWars = state.diplomacy.wars.filter((war) => !Number.isFinite(war.endedAtYear ?? Number.NaN));
  const activeTreaties = state.diplomacy.treaties.filter((treaty) => !Number.isFinite(treaty.cancelledAtYear ?? Number.NaN));
  const pendingProposals = state.diplomacy.proposals.filter((proposal) => proposal.status === "pending");
  const pairRelevant = (factionA: number, factionB: number): boolean => (
    playerFactionId === null || factionA === playerFactionId || factionB === playerFactionId
  );
  const countries = factions.map((faction) => {
    const activeBetween = playerFactionId === null
      ? []
      : getActiveTreatiesBetween(state.diplomacy, playerFactionId, faction.id);
    const tradePrivilegeTreaty = activeBetween.some((treaty) => treaty.articleIds.includes(TRADE_PRIVILEGE_ARTICLE_ID));
    return {
      faction,
      isSelf: playerFactionId === faction.id,
      atWar: playerFactionId !== null && areFactionsAtWar(state.diplomacy, playerFactionId, faction.id),
      ourBorderPolicy: playerFactionId === null ? "closed" as BorderPolicy : getBorderPolicy(state.diplomacy, playerFactionId, faction.id),
      theirBorderPolicy: playerFactionId === null ? "closed" as BorderPolicy : getBorderPolicy(state.diplomacy, faction.id, playerFactionId),
      activeTreatyCount: activeBetween.length,
      pendingProposalCount: playerFactionId === null
        ? 0
        : pendingProposals.filter((proposal) => (
          (proposal.fromFactionId === playerFactionId && proposal.toFactionId === faction.id)
          || (proposal.fromFactionId === faction.id && proposal.toFactionId === playerFactionId)
        )).length,
      tradePrivilegeActive: playerFactionId !== null
        && tradePrivilegeTreaty
        && !isTreatyArticleSuspended(state.diplomacy, TRADE_PRIVILEGE_ARTICLE_ID, playerFactionId, faction.id),
      tradePrivilegeSuspended: playerFactionId !== null
        && tradePrivilegeTreaty
        && isTreatyArticleSuspended(state.diplomacy, TRADE_PRIVILEGE_ARTICLE_ID, playerFactionId, faction.id),
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
    ? state.diplomacy.chatMessages
    : state.diplomacy.chatMessages.filter((message) => (
      message.fromFactionId === playerFactionId || message.toFactionId === playerFactionId
    ));
  const eligiblePeaceTransferSystems = createEligiblePeaceTransferSystems(playerFactionId, wars);

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

function createEligiblePeaceTransferSystems(
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
    for (const starbase of state.starbases) {
      if (starbase.ownerId !== war.attackerFactionId && starbase.ownerId !== war.defenderFactionId) continue;
      const toFactionId = starbase.ownerId === war.attackerFactionId ? war.defenderFactionId : war.attackerFactionId;
      const star = state.stars[starbase.starId];
      rows.push({
        starbaseId: starbase.id,
        starId: starbase.starId,
        starName: star?.name ?? `System ${starbase.starId}`,
        ownerId: starbase.ownerId,
        ownerName: state.factions.find((faction) => faction.id === starbase.ownerId)?.name ?? `Faction ${starbase.ownerId}`,
        fromFactionId: starbase.ownerId,
        toFactionId,
      });
    }
  }
  return rows.sort((a, b) => a.starName.localeCompare(b.starName));
}

function createSocietyDetailPayload(perspective: GalaxyPerspective): SocietyDetailPayload {
  const playerFactionId = perspective.mode === "faction" ? perspective.factionId : null;
  const laws = playerFactionId === null
    ? { civilRights: "civicRegistry", speciesPolicy: "managedResidency" }
    : {
      civilRights: getSpeciesLawSelections(state, playerFactionId).civilRights ?? "civicRegistry",
      speciesPolicy: getSpeciesLawSelections(state, playerFactionId).speciesPolicy ?? "managedResidency",
    };
  const speciesIds = playerFactionId === null
    ? state.species.map((species) => species.id)
    : getEmpireSpeciesIds(state, playerFactionId);
  const speciesIdSet = new Set(speciesIds);
  const species = state.species.filter((entry) => speciesIdSet.has(entry.id));
  const rights = playerFactionId === null
    ? null
    : {
      factionId: playerFactionId,
      rightsBySpeciesId: Object.fromEntries(species.map((entry) => [
        entry.id,
        getSpeciesRightsForFaction(state, playerFactionId, entry.id),
      ])),
    };
  const faction = playerFactionId === null
    ? null
    : {
      ...state.factions.find((candidate) => candidate.id === playerFactionId)!,
      discoveredStarIds: state.discoveredByFaction[String(playerFactionId)] ?? [],
    };
  const planets = state.planetStates
    .filter((planetState) => planetState.isHabited)
    .filter((planetState) => playerFactionId === null || (state.starOwnership[planetState.starId] ?? -1) === playerFactionId)
    .map((planetState) => {
      const star = state.stars[planetState.starId];
      const planet = getPlanetConfig(planetState);
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
    government: playerFactionId === null ? null : getFactionGovernment(state, playerFactionId),
    factionEconomy: playerFactionId === null ? null : state.factionEconomies.find((economy) => economy.factionId === playerFactionId) ?? null,
    planets,
    laws,
  };
}

function createDetailPayload(
  perspective: GalaxyPerspective,
  scope: GameDetailScope,
  id: string | number | null | undefined,
): { payload: GameDetailPayload; revision: string; normalizedId: string | number | null } | { error: string } {
  if (scope === "system") {
    const starId = Number(id);
    if (!Number.isInteger(starId)) return { error: "System is not available." };
    return createSystemDetailPayload(perspective, starId);
  }

  if (scope === "planet") {
    const planetId = String(id ?? "");
    const planetState = getPlanetState(planetId);
    if (!planetState || !canAccessPlanet(perspective, planetState)) return { error: "Planet is not available." };
    const planet = getPlanetConfig(planetState);
    if (!planet) return { error: "Planet details are unavailable." };
    const payload = { starId: planetState.starId, planet, planetState };
    return { payload, revision: createRevision(payload), normalizedId: planetId };
  }

  if (scope === "starbase") {
    const starbaseId = String(id ?? "");
    const starbase = state.starbases.find((candidate) => candidate.id === starbaseId);
    if (!starbase || !canAccessStarbase(perspective, starbase)) return { error: "Starbase is not available." };
    const payload = { starbase };
    return { payload, revision: createRevision(payload), normalizedId: starbaseId };
  }

  if (scope === "fleet") {
    const fleetId = String(id ?? "");
    const fleets = getVisibleFullFleets(perspective);
    const fleet = fleets.find((candidate) => candidate.id === fleetId);
    if (!fleet) return { error: "Fleet is not available." };
    const payload = {
      fleet,
      ships: getVisibleFullShips(perspective, fleets).filter((ship) => ship.fleetId === fleet.id),
    };
    return { payload, revision: createRevision(payload), normalizedId: fleetId };
  }

  if (scope === "fleetManager") {
    const detailState = createVisibleDetailState(perspective);
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
    const detailState = createVisibleDetailState(perspective);
    const ownerId = perspective.mode === "faction" ? perspective.factionId : null;
    const planets = state.planetStates
      .filter((planetState) => ownerId === null || (state.starOwnership[planetState.starId] ?? -1) === ownerId)
      .filter((planetState) => canAccessPlanet(perspective, planetState))
      .map((planetState) => {
        const star = state.stars[planetState.starId];
        const planet = getPlanetConfig(planetState);
        if (!star || !planet) return null;
        return {
          starId: planetState.starId,
          starName: star.name,
          ownerId: state.starOwnership[planetState.starId] ?? -1,
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
    const payload = createMarketDetailPayload(perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "technology") {
    const detailState = createVisibleDetailState(perspective);
    const payload = {
      technologies: detailState.technologies,
      factionEconomies: detailState.factionEconomies,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "leaders") {
    const detailState = createVisibleDetailState(perspective);
    const payload = {
      leaders: detailState.leaders,
      fleets: detailState.fleets,
      planetStates: detailState.planetStates,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "government") {
    const detailState = createVisibleDetailState(perspective);
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
    const payload = createSocietyDetailPayload(perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "diplomacy") {
    const payload = createDiplomacyDetailPayload(perspective);
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "selection") {
    const detailState = createVisibleDetailState(perspective);
    const payload = {
      fleets: detailState.fleets,
      ships: detailState.ships,
      starbases: detailState.starbases,
      leaders: detailState.leaders,
    };
    return { payload, revision: createRevision(payload), normalizedId: null };
  }

  if (scope === "hud") {
    const detailState = createVisibleState(perspective);
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

function sendDetailEvent(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  scope: GameDetailScope,
  id: string | number | null | undefined,
  knownRevision?: string | null,
): string | null {
  const detail = createDetailPayload(perspective, scope, id);
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
  const detail = createDetailPayload(session.perspective, scope, id);
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
  for (const client of clients) {
    for (const [key, subscription] of Array.from(client.detailSubscriptions.entries())) {
      const detail = createDetailPayload(client.perspective, subscription.scope, subscription.id);
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
  return getPlanetDistrictLimitsFromState(state, planetState) ?? null;
}

function validatePlanetCommand(socket: WebSocket, perspective: GalaxyPerspective, planetId: string): PlanetState | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }

  const planetState = getPlanetState(planetId);
  if (!planetState) {
    reject(socket, "Planet not found.");
    return null;
  }
  if (!planetState.isHabited) {
    reject(socket, "Only habited planets can be managed.");
    return null;
  }
  if ((state.starOwnership[planetState.starId] ?? -1) !== factionId) {
    reject(socket, "You do not own that planet.");
    return null;
  }
  return planetState;
}

function getFactionEconomy(factionId: number): FactionEconomyState | null {
  return state.factionEconomies.find((economy) => economy.factionId === factionId) ?? null;
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
  hasDirtyState = true;
  return true;
}

function refundResources(factionId: number, refund: Partial<ResourceCounts>): void {
  const economy = getFactionEconomy(factionId);
  if (!economy) return;
  economy.stockpiles = addResourceCounts(economy.stockpiles, normalizeResourceCounts(refund));
  hasDirtyState = true;
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
  const resource = getMarketResourceState(resourceId);
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

  const flows = calculateFactionResourceFlow(state, factionId);
  const quote = calculatePlayerMarketQuote(resource, factionId, flows);
  const grossEnergy = amount * quote.finalQuotePrice;
  const feePaid = grossEnergy * MARKET_FEE_RATE;
  const stats = getMarketPlayerStats(factionId);

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
    recordMarketTransaction(factionId, resourceId, "buy", amount, quote.finalQuotePrice, feePaid, -buyCost);
    applyMarketTradePressure(resource, "buy", amount);
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
    recordMarketTransaction(factionId, resourceId, "sell", amount, quote.finalQuotePrice, feePaid, sellPayout);
    applyMarketTradePressure(resource, "sell", amount);
    accept(socket, `Sold ${amount} ${resourceId} for ${formatEnergyAmount(sellPayout)} Energy.`);
  }

  hasDirtyState = true;
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
  const resource = getMarketResourceState(resourceId);
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

  const existing = state.market.autoTrades.find((order) => (
    order.playerId === factionId
    && order.resourceId === resourceId
    && order.type === tradeType
  ));
  if (existing) {
    existing.amountPerHour = amountPerHour;
    existing.enabled = true;
    existing.updatedAt = state.clock.year;
  } else {
    state.market.autoTrades.push({
      id: createRuntimeId("market-auto", [factionId, resourceId, tradeType]),
      playerId: factionId,
      resourceId,
      type: tradeType,
      amountPerHour,
      enabled: true,
      createdAt: state.clock.year,
      updatedAt: state.clock.year,
    });
  }

  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  accept(socket, `${tradeType === "auto_buy" ? "Auto-buy" : "Auto-sell"} set to ${formatEnergyAmount(amountPerHour)} ${resourceId} per game hour.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function handleRemoveMarketAutoTrade(socket: WebSocket, perspective: GalaxyPerspective, orderId: string): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return;
  }
  const index = state.market.autoTrades.findIndex((order) => order.id === orderId && order.playerId === factionId);
  if (index < 0) {
    reject(socket, "Automatic trade not found.");
    return;
  }
  const [removed] = state.market.autoTrades.splice(index, 1);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  accept(socket, `${removed?.type === "auto_buy" ? "Auto-buy" : "Auto-sell"} removed.`);
  broadcastUpdates(["factionEconomies", "market"]);
}

function recordMarketTransaction(
  playerId: number,
  resourceId: ResourceKind,
  type: MarketTradeType,
  amount: number,
  unitPrice: number,
  feePaid: number,
  totalEnergyDelta: number,
): void {
  state.market.transactions.push({
    playerId,
    resourceId,
    type,
    amount,
    unitPrice,
    feeRate: MARKET_FEE_RATE,
    feePaid,
    totalEnergyDelta,
    timestamp: state.clock.year,
  });
  state.market.transactions = state.market.transactions.slice(-MARKET_TRANSACTION_LIMIT);
}

function applyMarketTradePressure(resource: MarketResourceState, type: MarketTradeType, amount: number): void {
  const direction = type === "buy" || type === "auto_buy" ? 1 : -1;
  const factor = type === "buy" || type === "sell"
    ? MARKET_MANUAL_PRESSURE_FACTOR
    : MARKET_AUTO_PRESSURE_FACTOR;
  const pressure = direction * calculateMarketPressureDelta(amount, resource.liquidity, factor);

  if (type === "buy" || type === "sell") {
    resource.temporaryPressure += pressure;
  } else {
    resource.persistentPressure += pressure;
  }

  Object.assign(resource, recomputeMarketResourcePrice(resource, state.clock.year));
  appendMarketPriceSnapshot(resource, state.clock.year);
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
  const index = state.planetStates.findIndex((planetState) => planetState.id === nextPlanetState.id);
  if (index < 0) {
    reject(socket, "Planet not found.");
    return;
  }
  state.planetStates[index] = recalculatePlanetStateEconomy(
    nextPlanetState,
    getPlanetDistrictLimitsFromState(state, nextPlanetState),
    getPlanetTechnologyModifiers(state, nextPlanetState),
    getPlanetSpeciesContext(state, nextPlanetState),
  );
  applyPlanetStatesToStars(state.stars, state.planetStates);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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

  const starbase = state.starbases.find((candidate) => candidate.id === starbaseId);
  if (!starbase) {
    reject(socket, "Starbase not found.");
    return null;
  }
  if (starbase.ownerId !== factionId) {
    reject(socket, "You do not own that starbase.");
    return null;
  }
  if (!canAccessStar(perspective, starbase.starId)) {
    reject(socket, "Starbase is not available.");
    return null;
  }
  return starbase;
}

function commitStarbase(socket: WebSocket, message: string, nextStarbase: ServerStarbase): void {
  const index = state.starbases.findIndex((starbase) => starbase.id === nextStarbase.id);
  if (index < 0) {
    reject(socket, "Starbase not found.");
    return;
  }
  const normalized = normalizeStarbase(nextStarbase);
  state.starbases[index] = normalized;
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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
  const design = findShipDesign(state.shipDesigns, starbase.ownerId, shipKind, designId, false);
  if (!design) return reject(socket, "Ship design is unavailable.");
  if (!isShipDesignUnlockedForFaction(starbase.ownerId, design)) {
    return reject(socket, `Requires ${getShipDesignMissingTechnologyName(starbase.ownerId, design) ?? "required technology"}.`);
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
  const ship = state.ships.find((candidate) => candidate.id === command.shipId);
  if (!ship) return reject(socket, "Ship not found.");
  if (ship.ownerId !== factionId) return reject(socket, "You do not own that ship.");
  const fleet = state.fleets.find((candidate) => candidate.id === ship.fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (!isFleetAvailableForOrders(fleet)) return reject(socket, "Fleet is already busy.");

  const starbase = validateStarbaseCommand(socket, perspective, command.starbaseId);
  if (!starbase) return;
  if (starbase.starId !== fleet.currentStarId) return reject(socket, "Move the fleet to a shipyard system before upgrading.");
  if (countStarbaseShipyards(starbase.buildingSlots) <= 0) return reject(socket, "Starbase has no completed shipyards.");
  const alreadyQueued = state.starbases.some((candidate) => (
    candidate.shipQueue.some((item) => item.kind === "upgrade" && item.shipId === ship.id)
  ));
  if (alreadyQueued) return reject(socket, "Ship upgrade is already queued.");

  const currentDesign = findShipDesign(state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, true);
  if (!currentDesign) return reject(socket, "Current ship design is unavailable.");
  const explicitTarget = command.targetDesignId
    ? findShipDesignById(state.shipDesigns, ship.ownerId, ship.shipKind, command.targetDesignId, false)
    : null;
  if (command.targetDesignId && !explicitTarget) return reject(socket, "Target ship design is unavailable.");
  const assignedTarget = ship.targetDesignId
    ? findShipDesignById(state.shipDesigns, ship.ownerId, ship.shipKind, ship.targetDesignId, false)
    : null;
  const targetDesign = explicitTarget ?? assignedTarget ?? getNewestActiveShipDesign(state.shipDesigns, ship.ownerId, ship.shipKind);
  if (!targetDesign) return reject(socket, "No active target design is available.");
  if (!isShipDesignUnlockedForFaction(factionId, targetDesign)) {
    return reject(socket, `Requires ${getShipDesignMissingTechnologyName(factionId, targetDesign) ?? "required technology"}.`);
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
  const starbaseIndex = state.starbases.findIndex((candidate) => candidate.id === starbase.id);
  state.starbases[starbaseIndex] = normalizeStarbase({
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
  syncFleetMembership(state);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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
    ? state.shipDesigns.find((design) => design.id === command.designId && design.ownerId === factionId)
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
    createdAtYear: current?.createdAtYear ?? state.clock.year,
    updatedAtYear: state.clock.year,
  };
  const nextDesign = normalizeShipDesign(raw, factionId, state.clock.year);
  const missingTechnology = getShipDesignMissingTechnologyName(factionId, nextDesign);
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
    state.shipDesigns = state.shipDesigns.map((design) => (design.id === current.id ? nextDesign : design));
  } else {
    state.shipDesigns.push(nextDesign);
  }
  const shipsChanged = syncShipsForDesign(state, nextDesign);
  hasDirtyState = true;
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
  const design = state.shipDesigns.find((candidate) => candidate.id === designId && candidate.ownerId === factionId);
  if (!design) return reject(socket, "Ship design not found.");
  if (design.status === "decommissioned") return reject(socket, "Ship design is already decommissioned.");
  const activeCount = state.shipDesigns.filter((candidate) => (
    candidate.ownerId === factionId
    && candidate.shipKind === design.shipKind
    && candidate.status === "active"
  )).length;
  if (activeCount <= 1) return reject(socket, "At least one active design is required.");
  design.status = "decommissioned";
  design.updatedAtYear = state.clock.year;
  const targetDesign = getNewestActiveShipDesign(state.shipDesigns, factionId, design.shipKind);
  let shipsChanged = false;
  let starbasesChanged = false;
  if (targetDesign) {
    for (const ship of state.ships) {
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
    state.starbases = state.starbases.map((starbase) => {
      let queueChanged = false;
      const shipQueue = starbase.shipQueue.map((item) => {
        if (item.kind !== "upgrade" || item.targetDesignId !== design.id) return item;
        const ship = item.shipId ? state.ships.find((candidate) => candidate.id === item.shipId) : null;
        const currentDesign = ship
          ? findShipDesignById(state.shipDesigns, ship.ownerId, ship.shipKind, ship.designId, true)
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
  hasDirtyState = true;
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
      buildings: subDistrict.buildings.map((building) => (
        building && isBuildingCompatible(building, "urbanSubDistrict", subDistrictKind) ? building : null
      )),
    };
  });

  const constructionQueue = filterInvalidQueuedBuildingsForSubDistrictChange(
    planetState,
    subDistrictIndex,
    subDistrictKind,
  );
  commitPlanetState(socket, perspective, "Sub-district changed.", { ...planetState, urbanSubDistricts, constructionQueue });
}

function completeFleetOrder(fleet: GameFleet): void {
  let finalOrbitTarget: FleetOrbitTarget | null = fleet.orbitTarget;
  if (fleet.orderType === "build" && fleet.targetStarId !== null) {
    const starId = fleet.targetStarId;
    let starbase = state.starbases.find((candidate) => candidate.starId === starId) ?? null;
    if (!starbase) {
      const combat = STARBASE_LEVEL_DEFINITIONS.outpost.combat;
      starbase = {
        id: createRuntimeId("starbase", [fleet.ownerId, starId]),
        ownerId: fleet.ownerId,
        starId,
        systemPosition: getSystemStarbasePosition(),
        status: "online",
        buildProgress: 1,
        shield: combat.maxShield,
        maxShield: combat.maxShield,
        armor: combat.maxArmor,
        maxArmor: combat.maxArmor,
        hull: combat.maxHull,
        maxHull: combat.maxHull,
        lastShieldDamageAtYear: null,
        level: "outpost",
        economy: calculateStarbaseEconomy("outpost"),
        buildingSlots: createEmptyStarbaseSlots(),
        constructionQueue: [],
        shipQueue: [],
      };
      state.starbases.push(starbase);
      state.starOwnership[starId] = fleet.ownerId;
      syncSystemOwnershipFromStarbases();
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
    }
    finalOrbitTarget = createStarbaseOrbitTarget(starbase);
    fleet.systemPosition = finalOrbitTarget.position;
  }

  fleet.targetStarId = null;
  fleet.orderType = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.movementPlan = null;
  fleet.mergeTargetFleetId = null;
  fleet.hyperlanePosition = null;
  applyFleetOrbitTarget(fleet, finalOrbitTarget);
  setFleetPhase(fleet, finalOrbitTarget?.kind === "planet" ? "orbitingPlanet" : (finalOrbitTarget ? "orbiting" : "idle"));
}

function advanceFleet(fleet: GameFleet, scaledMs: number): boolean {
  if (fleet.phase === "missingInAction") {
    return false;
  }
  if (fleet.orderType === "merge" && fleet.mergeTargetFleetId) {
    const mergeChanged = advanceMergeSourceFleet(fleet, scaledMs);
    if (mergeChanged || !state.fleets.includes(fleet)) return true;
    if (!fleet.movementPlan) return false;
  }
  if (fleet.movementPlan && fleet.phase !== "idle" && fleet.phase !== "buildingStarbase" && fleet.phase !== "orbitingPlanet" && fleet.phase !== "orbiting") {
    const plan = fleet.movementPlan;
    const nextYear = state.clock.year;
    const segment = plan.segments.find((candidate) => nextYear >= candidate.startYear && nextYear < candidate.endYear)
      ?? plan.segments[plan.segments.length - 1];

    if (segment && nextYear < plan.endsAtYear) {
      const progress = Math.max(0, Math.min(1, (nextYear - segment.startYear) / Math.max(0.000001, segment.endYear - segment.startYear)));
      fleet.currentStarId = segment.kind === "hyperlane" ? segment.fromStarId : segment.toStarId;
      fleet.routeIndex = Math.max(0, fleet.route.indexOf(segment.toStarId));
      fleet.phaseStartedAtYear = segment.startYear;
      fleet.phaseDurationDays = Math.max(0.1, (segment.endYear - segment.startYear) * GAME_DAYS_PER_YEAR);
      fleet.phaseProgress = progress;

      if (segment.kind === "hyperlane") {
        fleet.phase = "jumpingHyperlane";
        fleet.hyperlanePosition = { fromStarId: segment.fromStarId, toStarId: segment.toStarId, progress };
        fleet.systemPosition = interpolateSystemPosition(segment.from, segment.to, progress);
      } else {
        fleet.phase = "movingSystem";
        fleet.hyperlanePosition = null;
        fleet.systemPosition = interpolateSystemPosition(segment.from, segment.to, progress);
      }
      return false;
    }

    fleet.phaseProgress = 1;
    fleet.currentStarId = plan.destinationStarId;
    fleet.routeIndex = Math.max(0, fleet.route.length - 1);
    fleet.hyperlanePosition = null;
    fleet.systemPosition = plan.segments[plan.segments.length - 1]?.to ?? systemCenterPosition();
    fleet.movementPlan = null;

    if (fleet.orderType === "merge") {
      if (!completeMergeSourceFleet(fleet)) {
        const targetFleet = fleet.mergeTargetFleetId
          ? state.fleets.find((candidate) => candidate.id === fleet.mergeTargetFleetId)
          : null;
        if (targetFleet) {
          startMergeSourceOrder(fleet, targetFleet);
        } else {
          cancelMergeSourceOrder(fleet);
        }
      }
      return true;
    }

    if (fleet.orderType === "orbit" && plan.destinationOrbitTarget?.kind === "planet") {
      applyFleetOrbitTarget(fleet, plan.destinationOrbitTarget);
      fleet.orderType = "orbit";
      fleet.targetStarId = null;
      fleet.route = [fleet.currentStarId];
      fleet.routeIndex = 0;
      setFleetPhase(fleet, "orbitingPlanet");
      fleet.phaseDurationDays = 0;
      return true;
    }

    if (fleet.orderType === "build") {
      applyFleetOrbitTarget(fleet, createStarOrbitTarget(fleet.currentStarId, plan.destinationPosition ?? getSystemStarOrbitPosition()));
      setFleetPhase(fleet, "buildingStarbase");
      fleet.systemPosition = plan.destinationPosition ?? getSystemStarOrbitPosition();
      return true;
    }

    const finalOrbitTarget = plan.destinationOrbitTarget ?? null;
    if (fleet.orderType === "retreat") {
      fleet.retreatState = null;
      fleet.currentTacticalOrder = null;
      fleet.combatStatus = "idle";
    }
    fleet.targetStarId = null;
    fleet.orderType = null;
    fleet.route = [fleet.currentStarId];
    fleet.routeIndex = 0;
    fleet.mergeTargetFleetId = null;
    applyFleetOrbitTarget(fleet, finalOrbitTarget);
    setFleetPhase(fleet, finalOrbitTarget?.kind === "planet" ? "orbitingPlanet" : (finalOrbitTarget ? "orbiting" : "idle"));
    return true;
  }

  if (fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting") {
    return false;
  }

  let arrivedSystem = false;
  let remaining = scaledMs;
  while (remaining > 0 && fleet.phase !== "idle") {
    const duration = phaseDuration(fleet.phase, fleet);
    const available = duration - fleet.phaseElapsedMs;
    const step = Math.min(remaining, available);
    fleet.phaseElapsedMs += step;
    fleet.phaseProgress = Math.max(0, Math.min(1, fleet.phaseElapsedMs / duration));
    remaining -= step;

    if (fleet.phase === "departingSystem") {
      fleet.systemPosition = interpolateSystemPosition(systemCenterPosition(), systemExitPosition(fleet), fleet.phaseProgress);
    } else if (fleet.phase === "jumpingHyperlane") {
      const fromStarId = fleet.route[fleet.routeIndex];
      const toStarId = fleet.route[fleet.routeIndex + 1];
      fleet.hyperlanePosition = { fromStarId, toStarId, progress: fleet.phaseProgress };
    } else if (fleet.phase === "arrivingSystem") {
      fleet.systemPosition = interpolateSystemPosition(systemEntryPosition(fleet), systemCenterPosition(), fleet.phaseProgress);
    }

    if (fleet.phaseElapsedMs < duration) break;

    fleet.phaseElapsedMs = 0;
    fleet.phaseProgress = 0;

    if (fleet.phase === "departingSystem") {
      setFleetPhase(fleet, "jumpingHyperlane");
      const fromStarId = fleet.route[fleet.routeIndex];
      const toStarId = fleet.route[fleet.routeIndex + 1];
      fleet.hyperlanePosition = { fromStarId, toStarId, progress: 0 };
    } else if (fleet.phase === "jumpingHyperlane") {
      fleet.currentStarId = fleet.route[fleet.routeIndex + 1];
      fleet.routeIndex += 1;
      fleet.hyperlanePosition = null;
      setFleetPhase(fleet, "arrivingSystem");
      fleet.systemPosition = systemEntryPosition(fleet);
    } else if (fleet.phase === "arrivingSystem") {
      arrivedSystem = true;
      if (fleet.routeIndex < fleet.route.length - 1) {
        setFleetPhase(fleet, "departingSystem");
        fleet.systemPosition = systemCenterPosition();
      } else if (fleet.orderType === "build") {
        setFleetPhase(fleet, "buildingStarbase");
        fleet.systemPosition = systemCenterPosition();
      } else {
        completeFleetOrder(fleet);
      }
    } else if (fleet.phase === "buildingStarbase") {
      completeFleetOrder(fleet);
    }
  }
  return arrivedSystem;
}

function processMissingInActionFleets(): boolean {
  let changed = false;
  for (const fleet of state.fleets) {
    if (fleet.phase !== "missingInAction" || fleet.retreatState?.mode !== "emergencyFtl") continue;
    const miaUntilYear = fleet.retreatState.miaUntilYear ?? state.clock.year;
    if (state.clock.year < miaUntilYear) continue;
    const targetStarId = fleet.retreatState.targetStarId;
    fleet.currentStarId = targetStarId;
    fleet.targetStarId = null;
    fleet.route = [targetStarId];
    fleet.routeIndex = 0;
    fleet.orderType = null;
    fleet.retreatState = null;
    fleet.hyperlanePosition = null;
    fleet.movementPlan = null;
    const destination = getDefaultMoveDestination(targetStarId);
    fleet.systemPosition = destination.position;
    applyFleetOrbitTarget(fleet, destination.orbitTarget);
    setFleetPhase(fleet, destination.orbitTarget?.kind === "planet" ? "orbitingPlanet" : "orbiting");
    changed = true;
  }
  if (changed) {
    refreshDiscovery();
    hasDirtyState = true;
  }
  return changed;
}

const FORMATION_EVASION_BONUS: Record<FleetFormation, number> = {
  line: 0,
  vanguard: -0.02,
  echelon: 0.04,
  defensive: 0.02,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface CombatLayerState {
  shield: number;
  armor: number;
  hull: number;
  maxShield: number;
  maxArmor: number;
  maxHull: number;
}

function applyWeaponHit(
  mount: WeaponMountDefinition,
  target: CombatLayerState,
): { destroyed: boolean; shieldDamage: number; armorDamage: number; hullDamage: number } {
  return applyWeaponDamage(mount, target);
}

function applyFleetAttackShortagePenalty(mount: WeaponMountDefinition, attackMultiplier: number): WeaponMountDefinition {
  if (Math.abs(attackMultiplier - 1) < 0.001) return mount;
  const accuracyScale = attackMultiplier < 1
    ? 0.78 + attackMultiplier * 0.22
    : 1 + (attackMultiplier - 1) * 0.18;
  return {
    ...mount,
    damage: mount.damage * attackMultiplier,
    accuracy: clamp(mount.accuracy * accuracyScale, 0.05, 1),
  };
}

function getStarbaseWeaponMounts(starbase: ServerStarbase): WeaponMountDefinition[] {
  return STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
}

function getFleetWeaponMounts(fleet: GameFleet, shipsById: Map<string, GameShip>): WeaponMountDefinition[] {
  return fleet.shipIds
    .map((shipId) => shipsById.get(shipId))
    .filter((ship): ship is GameShip => !!ship)
    .flatMap((ship) => calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts);
}

function getMaxWeaponSystemRange(mounts: WeaponMountDefinition[]): number {
  return mounts.reduce((max, mount) => Math.max(max, getWeaponMaxSystemRange(mount)), 0);
}

function isHostileOwner(ownerA: number, ownerB: number): boolean {
  return ownerA !== ownerB && areFactionsAtWar(state.diplomacy, ownerA, ownerB);
}

function resetFleetTacticalMovement(fleet: GameFleet): void {
  const currentPosition = getFleetAuthoritativeSystemPosition(fleet);
  fleet.movementPlan = null;
  clearFleetOrbit(fleet);
  setFleetPhase(fleet, "idle");
  fleet.hyperlanePosition = null;
  fleet.systemPosition = currentPosition;
}
function findNearestFriendlyStarbase(fleet: GameFleet): ServerStarbase | null {
  const friendly = state.starbases.filter((starbase) => (
    starbase.ownerId === fleet.ownerId
    && starbase.status === "online"
  ));
  if (friendly.length === 0) return null;
  const from = state.stars[fleet.currentStarId];
  friendly.sort((a, b) => {
    const starA = state.stars[a.starId];
    const starB = state.stars[b.starId];
    const distanceA = from && starA ? Math.hypot(starA.x - from.x, starA.z - from.z) : Number.POSITIVE_INFINITY;
    const distanceB = from && starB ? Math.hypot(starB.x - from.x, starB.z - from.z) : Number.POSITIVE_INFINITY;
    return distanceA - distanceB;
  });
  return friendly[0] ?? null;
}

function resolveFleetRetreatDestination(
  fleet: GameFleet,
): { targetStarId: number; targetSystemPosition?: ReturnType<typeof systemCenterPosition> | null } {
  const destination = fleet.combatSettings.retreatDestination ?? { kind: "nearestFriendlyStarbase" as const };
  if (destination.kind === "selectedSystem" && Number.isInteger(destination.targetStarId)) {
    return {
      targetStarId: destination.targetStarId!,
      targetSystemPosition: normalizeSystemPositionValue(destination.targetSystemPosition),
    };
  }
  const starbase = findNearestFriendlyStarbase(fleet);
  if (starbase) {
    return {
      targetStarId: starbase.starId,
      targetSystemPosition: getSystemStarbaseOrbitPosition(starbase.systemPosition),
    };
  }
  const route = computeRetreatRoute(fleet);
  return { targetStarId: route?.at(-1) ?? fleet.currentStarId, targetSystemPosition: null };
}

function computeRetreatRoute(fleet: GameFleet): number[] | null {
  if (fleet.route.length > 1 && fleet.routeIndex > 0) {
    const routeBack = fleet.route.slice(0, fleet.routeIndex + 1).reverse();
    if (routeIsAllowed(routeBack, fleet.ownerId)) return routeBack;
  }

  const homeStarId = state.factions.find((faction) => faction.id === fleet.ownerId)?.homeStarId ?? fleet.currentStarId;
  const routeToHome = findRoute(fleet, homeStarId);
  if (routeToHome) return routeToHome;

  const neighbors = state.adjacency[fleet.currentStarId] ?? [];
  const fallback = neighbors.find((starId) => {
    const owner = getKnownOwnership(fleet.ownerId, starId);
    return owner === -1 || owner === fleet.ownerId;
  });
  if (fallback !== undefined) return [fleet.currentStarId, fallback];
  return [fleet.currentStarId];
}

function startFleetRetreat(fleet: GameFleet): void {
  const targetStarId = fleet.retreatState?.mode === "system" ? fleet.retreatState.targetStarId : null;
  const route = targetStarId !== null && targetStarId !== undefined
    ? (targetStarId === fleet.currentStarId ? [fleet.currentStarId] : findRoute(fleet, targetStarId))
    : computeRetreatRoute(fleet);
  if (!route || route.length <= 1) {
    resetFleetTacticalMovement(fleet);
    fleet.retreatState = null;
    return;
  }
  fleet.route = route;
  fleet.routeIndex = 0;
  fleet.targetStarId = route[route.length - 1];
  fleet.orderType = "retreat";
  const retreatPosition = fleet.retreatState?.targetSystemPosition ?? null;
  const destination = retreatPosition
    ? { position: retreatPosition, orbitTarget: createStarOrbitTarget(fleet.targetStarId, retreatPosition) }
    : getDefaultMoveDestination(fleet.targetStarId);
  fleet.movementPlan = createFleetMovementPlan(fleet, route, "move", destination.position, destination.orbitTarget);
  if (fleet.retreatState) fleet.retreatState.status = "completed";
  applyFleetOrbitTarget(fleet, null);
  const firstSegment = fleet.movementPlan.segments[0];
  setFleetPhase(fleet, firstSegment?.kind === "hyperlane" ? "jumpingHyperlane" : "movingSystem");
  fleet.hyperlanePosition = null;
}

type ContinuousCombatActor =
  | {
    kind: "fleet";
    id: string;
    ownerId: number;
    starId: number;
    position: ReturnType<typeof systemCenterPosition>;
    radius: number;
    minWeaponRange: number;
    maxWeaponRange: number;
    fleet: GameFleet;
  }
  | {
    kind: "starbase";
    id: string;
    ownerId: number;
    starId: number;
    position: ReturnType<typeof systemCenterPosition>;
    radius: number;
    minWeaponRange: number;
    maxWeaponRange: number;
    starbase: ServerStarbase;
  };

function getFleetLivingShips(fleet: GameFleet, shipsById: Map<string, GameShip>): GameShip[] {
  return fleet.shipIds
    .map((shipId) => shipsById.get(shipId))
    .filter((ship): ship is GameShip => !!ship && ship.hull > 0);
}

function getFleetHealthRatio(fleet: GameFleet, shipsById: Map<string, GameShip>): number {
  const ships = getFleetLivingShips(fleet, shipsById);
  const maxTotal = ships.reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0);
  if (maxTotal <= 0) return 0;
  const current = ships.reduce((total, ship) => total + ship.shield + ship.armor + ship.hull, 0);
  return current / maxTotal;
}

function getMountRangeSummary(mounts: WeaponMountDefinition[]): { min: number; max: number } {
  if (mounts.length === 0) return { min: 0, max: 0 };
  const min = mounts.reduce((lowest, mount) => Math.min(lowest, getWeaponMinSystemRange(mount)), Number.POSITIVE_INFINITY);
  const max = mounts.reduce((highest, mount) => Math.max(highest, getWeaponMaxSystemRange(mount)), 0);
  return { min: Number.isFinite(min) ? min : 0, max };
}

function updateFleetTacticalProfile(fleet: GameFleet, shipsById: Map<string, GameShip>): boolean {
  const ships = getFleetLivingShips(fleet, shipsById);
  const mounts = ships.flatMap((ship) => calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts);
  const range = getMountRangeSummary(mounts);
  const nextRadius = getFleetTacticalRadius(Math.max(1, ships.length));
  const nextStatus = ships.length === 0 ? "destroyed" : fleet.combatStatus;
  const changed = fleet.tacticalRadius !== nextRadius
    || fleet.minWeaponRange !== range.min
    || fleet.maxWeaponRange !== range.max
    || fleet.combatStatus !== nextStatus;
  fleet.tacticalRadius = nextRadius;
  fleet.minWeaponRange = range.min;
  fleet.maxWeaponRange = range.max;
  fleet.combatStatus = nextStatus;
  if (ships.length === 0) {
    fleet.currentTargetId = null;
    fleet.currentTargetKind = null;
  }
  return changed;
}

function effectiveActorDistance(a: ContinuousCombatActor, b: ContinuousCombatActor): number {
  const centerDistance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
  return Math.max(0, centerDistance - a.radius - b.radius);
}

function getActorValue(actor: ContinuousCombatActor, shipsById: Map<string, GameShip>): number {
  if (actor.kind === "starbase") return actor.starbase.maxShield + actor.starbase.maxArmor + actor.starbase.maxHull;
  return getFleetLivingShips(actor.fleet, shipsById)
    .reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0);
}

function isFleetAvailableForContinuousCombat(fleet: GameFleet, shipsById: Map<string, GameShip>): boolean {
  if (fleet.phase === "jumpingHyperlane" || fleet.phase === "missingInAction" || fleet.phase === "buildingStarbase") return false;
  return getFleetLivingShips(fleet, shipsById).length > 0 && fleet.maxWeaponRange > 0;
}

function buildContinuousCombatActors(shipsById: Map<string, GameShip>): ContinuousCombatActor[] {
  const actors: ContinuousCombatActor[] = [];
  for (const fleet of state.fleets) {
    updateFleetTacticalProfile(fleet, shipsById);
    if (!isFleetAvailableForContinuousCombat(fleet, shipsById)) continue;
    actors.push({
      kind: "fleet",
      id: fleet.id,
      ownerId: fleet.ownerId,
      starId: fleet.currentStarId,
      position: getFleetAuthoritativeSystemPosition(fleet),
      radius: fleet.tacticalRadius,
      minWeaponRange: fleet.minWeaponRange,
      maxWeaponRange: fleet.maxWeaponRange,
      fleet,
    });
  }
  for (const starbase of state.starbases) {
    const mounts = getStarbaseWeaponMounts(starbase);
    const range = getMountRangeSummary(mounts);
    if (starbase.status !== "online" || starbase.hull <= 0 || range.max <= 0) continue;
    actors.push({
      kind: "starbase",
      id: starbase.id,
      ownerId: starbase.ownerId,
      starId: starbase.starId,
      position: cloneSystemPosition(starbase.systemPosition ?? getSystemStarbasePosition()),
      radius: STARBASE_TACTICAL_RADIUS,
      minWeaponRange: range.min,
      maxWeaponRange: range.max,
      starbase,
    });
  }
  return actors;
}

function actorIsInFleetWeaponRange(source: ContinuousCombatActor, target: ContinuousCombatActor): boolean {
  const distance = effectiveActorDistance(source, target);
  return distance >= source.minWeaponRange && distance <= source.maxWeaponRange;
}

function selectFleetCombatTarget(
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  actors: ContinuousCombatActor[],
  shipsById: Map<string, GameShip>,
): ContinuousCombatActor | null {
  const fleet = actor.fleet;
  const order = fleet.currentTacticalOrder;
  const hostiles = actors.filter((target) => (
    target.id !== actor.id
    && target.starId === actor.starId
    && isHostileOwner(actor.ownerId, target.ownerId)
  ));
  if (order?.type === "attack" && order.targetId && order.targetKind) {
    return hostiles.find((target) => target.id === order.targetId && target.kind === order.targetKind) ?? null;
  }
  if (fleet.combatStance === "passive") return null;
  const guardPosition = order?.type === "guard"
    ? order.guardPosition ?? order.targetPosition ?? actor.position
    : actor.position;
  const candidates = hostiles.filter((target) => {
    if (fleet.combatStance === "holdPosition") return actorIsInFleetWeaponRange(actor, target);
    if (fleet.combatStance === "guardArea" || fleet.combatSettings.behavior === "defender") {
      return Math.hypot(target.position.x - guardPosition.x, target.position.z - guardPosition.z) <= FLEET_GUARD_RADIUS + target.radius;
    }
    return true;
  });
  return candidates
    .map((target) => {
      const distance = effectiveActorDistance(actor, target);
      const targetHp = target.kind === "fleet" ? getFleetHealthRatio(target.fleet, shipsById) : (target.starbase.hull / Math.max(1, target.starbase.maxHull));
      let score = Math.max(0, 120 - distance) + (1 - targetHp) * 45 + getActorValue(target, shipsById) * 0.01;
      if (target.kind === "starbase") score += fleet.combatSettings.behavior === "artillery" ? 35 : 12;
      if (fleet.combatStance === "hunt" && target.kind === "fleet" && target.fleet.retreatState) score += 70;
      if (fleet.combatSettings.behavior === "swarm") score += Math.max(0, 80 - distance * 1.4);
      if (actorIsInFleetWeaponRange(actor, target)) score += 35;
      return { target, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.target ?? null;
}

function selectStarbaseCombatTarget(
  actor: Extract<ContinuousCombatActor, { kind: "starbase" }>,
  actors: ContinuousCombatActor[],
  shipsById: Map<string, GameShip>,
): ContinuousCombatActor | null {
  return actors
    .filter((target) => target.kind === "fleet" && target.starId === actor.starId && isHostileOwner(actor.ownerId, target.ownerId))
    .filter((target) => actorIsInFleetWeaponRange(actor, target))
    .map((target) => ({
      target,
      score: Math.max(0, 140 - effectiveActorDistance(actor, target)) + getActorValue(target, shipsById) * 0.01,
    }))
    .sort((a, b) => b.score - a.score)[0]?.target ?? null;
}

function desiredEffectiveRangeForFleet(fleet: GameFleet): number {
  const maxRange = Math.max(0, fleet.maxWeaponRange);
  if (fleet.combatSettings.behavior === "artillery") return Math.max(fleet.minWeaponRange, maxRange * 0.9);
  if (fleet.combatSettings.behavior === "line") return Math.max(fleet.minWeaponRange, maxRange * 0.62);
  if (fleet.combatSettings.behavior === "defender") return Math.max(fleet.minWeaponRange, maxRange * 0.55);
  if (fleet.combatSettings.behavior === "brawler") return Math.min(maxRange, 8);
  return 0;
}

function positionAtRangeFromTarget(
  currentPosition: ReturnType<typeof systemCenterPosition>,
  targetPosition: ReturnType<typeof systemCenterPosition>,
  desiredCenterDistance: number,
): ReturnType<typeof systemCenterPosition> {
  const dx = currentPosition.x - targetPosition.x;
  const dz = currentPosition.z - targetPosition.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= 0.0001) {
    return { x: targetPosition.x + desiredCenterDistance, y: SYSTEM_FLEET_Y, z: targetPosition.z };
  }
  const scale = desiredCenterDistance / distance;
  return { x: targetPosition.x + dx * scale, y: SYSTEM_FLEET_Y, z: targetPosition.z + dz * scale };
}

function positionAtEffectiveRangeFromTarget(
  source: ContinuousCombatActor,
  target: ContinuousCombatActor,
  desiredEffectiveDistance: number,
): ReturnType<typeof systemCenterPosition> {
  return positionAtRangeFromTarget(source.position, target.position, desiredEffectiveDistance + source.radius + target.radius);
}

function retreatFleetByDoctrine(fleet: GameFleet): boolean {
  if (fleet.retreatState) return false;
  const destination = resolveFleetRetreatDestination(fleet);
  fleet.retreatState = {
    mode: "system",
    status: "escaping",
    targetStarId: destination.targetStarId,
    targetSystemPosition: destination.targetSystemPosition ?? null,
    startedAtYear: state.clock.year,
  };
  fleet.currentTacticalOrder = { type: "retreat", issuedAtYear: state.clock.year };
  fleet.combatStatus = "retreating";
  startFleetRetreat(fleet);
  return true;
}

function updateFleetCombatMovement(
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  target: ContinuousCombatActor | null,
  elapsedDays: number,
  shipsById: Map<string, GameShip>,
): boolean {
  const fleet = actor.fleet;
  const threshold = FLEET_RETREAT_THRESHOLDS[fleet.combatSettings.retreatPolicy] ?? 0;
  if (threshold > 0 && getFleetHealthRatio(fleet, shipsById) <= threshold) {
    return retreatFleetByDoctrine(fleet);
  }
  const order = fleet.currentTacticalOrder;
  if (order?.type === "retreat") return retreatFleetByDoctrine(fleet);
  const fleetSpeed = getFleetSpeedMultiplier(state, fleet);
  const step = Math.max(0, elapsedDays) * SYSTEM_FLEET_SPEED_UNITS_PER_DAY * Math.max(0.15, fleet.speed * fleetSpeed);
  if (step <= 0) return false;
  let destination: ReturnType<typeof systemCenterPosition> | null = null;
  if ((order?.type === "move" || order?.type === "guard") && order.targetPosition) {
    destination = cloneSystemPosition(order.targetPosition);
  } else if (fleet.combatStance === "evade" && target) {
    destination = positionAtRangeFromTarget(actor.position, target.position, FLEET_EVADE_DISTANCE + actor.radius + target.radius);
  } else if (target && fleet.combatStance !== "holdPosition" && fleet.combatStance !== "passive") {
    const effectiveDistance = effectiveActorDistance(actor, target);
    const desired = desiredEffectiveRangeForFleet(fleet);
    if (fleet.combatSettings.behavior === "artillery" && effectiveDistance < desired * 0.75) {
      destination = positionAtEffectiveRangeFromTarget(actor, target, desired);
    } else if (effectiveDistance < fleet.minWeaponRange || effectiveDistance > fleet.maxWeaponRange * 0.92) {
      destination = positionAtEffectiveRangeFromTarget(actor, target, desired);
    }
  }
  if (!destination) {
    fleet.combatStatus = target && actorIsInFleetWeaponRange(actor, target) ? "firing" : "idle";
    return false;
  }
  const next = movePointToward(actor.position, destination, step);
  if (isSameSystemPosition(actor.position, next)) {
    if (order?.type === "move") fleet.currentTacticalOrder = null;
    return false;
  }
  clearFleetOrbit(fleet);
  fleet.movementPlan = null;
  fleet.route = [fleet.currentStarId];
  fleet.targetStarId = null;
  fleet.orderType = "move";
  fleet.systemPosition = next;
  fleet.combatStatus = "maneuvering";
  return true;
}

function applyFleetSoftSeparation(shipsById: Map<string, GameShip>): boolean {
  let changed = false;
  const fleets = state.fleets.filter((fleet) => isFleetAvailableForContinuousCombat(fleet, shipsById));
  for (let i = 0; i < fleets.length; i += 1) {
    for (let j = i + 1; j < fleets.length; j += 1) {
      const left = fleets[i];
      const right = fleets[j];
      if (left.currentStarId !== right.currentStarId) continue;
      const leftPos = getFleetAuthoritativeSystemPosition(left);
      const rightPos = getFleetAuthoritativeSystemPosition(right);
      const dx = rightPos.x - leftPos.x;
      const dz = rightPos.z - leftPos.z;
      const distance = Math.hypot(dx, dz);
      const minimum = (left.tacticalRadius + right.tacticalRadius) * 0.78;
      if (distance <= 0.001 || distance >= minimum) continue;
      const push = ((minimum - distance) * FLEET_SOFT_SEPARATION_FACTOR) / 2;
      const ux = dx / distance;
      const uz = dz / distance;
      left.systemPosition = { x: left.systemPosition.x - ux * push, y: SYSTEM_FLEET_Y, z: left.systemPosition.z - uz * push };
      right.systemPosition = { x: right.systemPosition.x + ux * push, y: SYSTEM_FLEET_Y, z: right.systemPosition.z + uz * push };
      changed = true;
    }
  }
  return changed;
}

function getShipEvasionForFleetCombat(ship: GameShip, fleet: GameFleet): number {
  const stats = calculateShipDesignStats(getShipDesignForShip(ship));
  const bonus = FORMATION_EVASION_BONUS[fleet.formation] ?? 0;
  const leaderBonus = getFleetLeaderEffects(state, fleet.id).evasionBonus;
  const governmentBonus = getGovernmentFleetEffects(state, fleet.ownerId).evasionBonus;
  return clamp(stats.combat.evasion + bonus + leaderBonus + governmentBonus, 0, 0.9);
}

function chooseTargetShip(targetFleet: GameFleet, shipsById: Map<string, GameShip>): GameShip | null {
  return getFleetLivingShips(targetFleet, shipsById)
    .sort((a, b) => {
      const aRatio = (a.shield + a.armor + a.hull) / Math.max(1, a.maxShield + a.maxArmor + a.maxHull);
      const bRatio = (b.shield + b.armor + b.hull) / Math.max(1, b.maxShield + b.maxArmor + b.maxHull);
      if (Math.abs(aRatio - bRatio) > 0.001) return aRatio - bRatio;
      return a.id.localeCompare(b.id);
    })[0] ?? null;
}

function decrementWeaponCooldowns(elapsedGameHours: number): void {
  for (const ship of state.ships) {
    if (!ship.weaponCooldowns) continue;
    for (const key of Object.keys(ship.weaponCooldowns)) {
      ship.weaponCooldowns[key] = Math.max(0, (ship.weaponCooldowns[key] ?? 0) - elapsedGameHours);
    }
  }
  for (const starbase of state.starbases) {
    if (!starbase.weaponCooldowns) continue;
    for (const key of Object.keys(starbase.weaponCooldowns)) {
      starbase.weaponCooldowns[key] = Math.max(0, (starbase.weaponCooldowns[key] ?? 0) - elapsedGameHours);
    }
  }
}

function recordContinuousCombatContact(contact: Omit<ServerCombatContact, "id" | "year">): void {
  state.recentCombatContacts.push({
    id: createRuntimeId("contact", [contact.sourceId, contact.targetId]),
    year: state.clock.year,
    ...contact,
  });
  state.recentCombatContacts = state.recentCombatContacts.slice(-RECENT_COMBAT_CONTACT_HISTORY);
}

function captureStarbase(starbase: ServerStarbase, ownerId: number): boolean {
  if (starbase.ownerId === ownerId) return false;
  starbase.ownerId = ownerId;
  starbase.status = "online";
  starbase.shield = 0;
  starbase.armor = 0;
  starbase.hull = Math.max(1, Math.round(starbase.maxHull * 0.25));
  starbase.lastShieldDamageAtYear = null;
  starbase.weaponCooldowns = {};
  state.starOwnership[starbase.starId] = ownerId;
  syncSystemOwnershipFromStarbases();
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  return true;
}

function fireFleetWeaponsAtTarget(
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  target: ContinuousCombatActor,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; starbasesChanged: boolean; contactsChanged: boolean; factionEconomiesChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  let contactsChanged = false;
  let factionEconomiesChanged = false;
  if (target.kind === "fleet" && !isHostileOwner(actor.ownerId, target.fleet.ownerId)) {
    return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
  }
  if (target.kind === "starbase" && !isHostileOwner(actor.ownerId, target.starbase.ownerId)) {
    return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
  }
  const distance = effectiveActorDistance(actor, target);
  const attackMultiplier = getFleetAttackMultiplier(state, actor.fleet);
  for (const ship of getFleetLivingShips(actor.fleet, shipsById)) {
    const mounts = calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts;
    ship.weaponCooldowns ??= {};
    for (let index = 0; index < mounts.length; index += 1) {
      const mount = applyFleetAttackShortagePenalty(mounts[index], attackMultiplier);
      const cooldownKey = `${index}:${getWeaponId(mount)}`;
      if ((ship.weaponCooldowns[cooldownKey] ?? 0) > 0) continue;
      if (!weaponCanFireAtDistance(mount, distance)) continue;
      ship.weaponCooldowns[cooldownKey] = getWeaponCooldownRounds(mount);
      let targetShip: GameShip | null = null;
      let targetLayer: GameShip | ServerStarbase | null = null;
      let targetEvasion = 0;
      if (target.kind === "fleet") {
        targetShip = chooseTargetShip(target.fleet, shipsById);
        targetLayer = targetShip;
        targetEvasion = targetShip ? getShipEvasionForFleetCombat(targetShip, target.fleet) : 0;
      } else {
        targetLayer = target.starbase;
        targetEvasion = STARBASE_LEVEL_DEFINITIONS[target.starbase.level]?.combat.evasion ?? 0;
      }
      if (!targetLayer) continue;
      const roll = rollWeaponShot(mount, targetEvasion);
      let shieldDamage = 0;
      let armorDamage = 0;
      let hullDamage = 0;
      let destroyed = false;
      let capturedStarbase = false;
      if (roll.hit) {
        const shieldAdjustedMount = target.kind === "fleet" && targetLayer.shield > 0
          ? { ...mount, damage: mount.damage / Math.max(0.25, getFleetShieldMultiplier(state, target.fleet)) }
          : mount;
        const result = applyWeaponHit(shieldAdjustedMount, targetLayer);
        shieldDamage = result.shieldDamage;
        armorDamage = result.armorDamage;
        hullDamage = result.hullDamage;
        destroyed = result.destroyed;
        if (targetShip) {
          targetShip.hp = targetShip.hull;
          shipsChanged = true;
        } else if (target.kind === "starbase") {
          target.starbase.lastShieldDamageAtYear = state.clock.year;
          if (destroyed) {
            capturedStarbase = captureStarbase(target.starbase, actor.ownerId);
            factionEconomiesChanged ||= capturedStarbase;
          }
          starbasesChanged = true;
        }
      }
      recordContinuousCombatContact({
        sourceId: actor.id,
        sourceKind: "fleet",
        sourceOwnerId: actor.ownerId,
        targetId: target.id,
        targetKind: target.kind,
        targetOwnerId: target.ownerId,
        weaponId: getWeaponId(mount),
        weaponName: getWeaponName(mount),
        hit: roll.hit,
        accuracyMiss: roll.accuracyMiss,
        dodged: roll.dodged,
        shieldDamage,
        armorDamage,
        hullDamage,
        targetDestroyed: destroyed,
        sourcePosition: cloneSystemPosition(actor.position),
        targetPosition: cloneSystemPosition(target.position),
      });
      contactsChanged = true;
      if (capturedStarbase) {
        return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
      }
    }
  }
  return { shipsChanged, starbasesChanged, contactsChanged, factionEconomiesChanged };
}

function fireStarbaseWeaponsAtTarget(
  actor: Extract<ContinuousCombatActor, { kind: "starbase" }>,
  target: ContinuousCombatActor,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; contactsChanged: boolean } {
  let shipsChanged = false;
  let contactsChanged = false;
  if (target.kind !== "fleet") return { shipsChanged, contactsChanged };
  const distance = effectiveActorDistance(actor, target);
  const mounts = getStarbaseWeaponMounts(actor.starbase);
  actor.starbase.weaponCooldowns ??= {};
  for (let index = 0; index < mounts.length; index += 1) {
    const mount = mounts[index];
    const cooldownKey = `${index}:${getWeaponId(mount)}`;
    if ((actor.starbase.weaponCooldowns[cooldownKey] ?? 0) > 0) continue;
    if (!weaponCanFireAtDistance(mount, distance)) continue;
    const targetShip = chooseTargetShip(target.fleet, shipsById);
    if (!targetShip) continue;
    actor.starbase.weaponCooldowns[cooldownKey] = getWeaponCooldownRounds(mount);
    const roll = rollWeaponShot(mount, getShipEvasionForFleetCombat(targetShip, target.fleet));
    let shieldDamage = 0;
    let armorDamage = 0;
    let hullDamage = 0;
    let destroyed = false;
    if (roll.hit) {
      const shieldAdjustedMount = targetShip.shield > 0
        ? { ...mount, damage: mount.damage / Math.max(0.25, getFleetShieldMultiplier(state, target.fleet)) }
        : mount;
      const result = applyWeaponHit(shieldAdjustedMount, targetShip);
      shieldDamage = result.shieldDamage;
      armorDamage = result.armorDamage;
      hullDamage = result.hullDamage;
      destroyed = result.destroyed;
      targetShip.hp = targetShip.hull;
      shipsChanged = true;
    }
    recordContinuousCombatContact({
      sourceId: actor.id,
      sourceKind: "starbase",
      sourceOwnerId: actor.ownerId,
      targetId: target.id,
      targetKind: "fleet",
      targetOwnerId: target.ownerId,
      weaponId: getWeaponId(mount),
      weaponName: getWeaponName(mount),
      hit: roll.hit,
      accuracyMiss: roll.accuracyMiss,
      dodged: roll.dodged,
      shieldDamage,
      armorDamage,
      hullDamage,
      targetDestroyed: destroyed,
      sourcePosition: cloneSystemPosition(actor.position),
      targetPosition: cloneSystemPosition(target.position),
    });
    contactsChanged = true;
  }
  return { shipsChanged, contactsChanged };
}

function processContinuousFleetCombat(elapsedGameHours: number, elapsedGameDays: number): {
  combatContactsChanged: boolean;
  shipsChanged: boolean;
  fleetsChanged: boolean;
  starbasesChanged: boolean;
  factionEconomiesChanged: boolean;
  visibilityChanged: boolean;
} {
  let combatContactsChanged = false;
  let shipsChanged = false;
  let fleetsChanged = false;
  let starbasesChanged = false;
  let factionEconomiesChanged = false;
  let visibilityChanged = false;
  const shipsById = new Map(state.ships.map((ship) => [ship.id, ship]));
  decrementWeaponCooldowns(elapsedGameHours);
  for (const fleet of state.fleets) {
    if (updateFleetTacticalProfile(fleet, shipsById)) fleetsChanged = true;
  }
  let actors = buildContinuousCombatActors(shipsById);
  for (const actor of actors.filter((candidate): candidate is Extract<ContinuousCombatActor, { kind: "fleet" }> => candidate.kind === "fleet")) {
    const target = selectFleetCombatTarget(actor, actors, shipsById);
    actor.fleet.currentTargetId = target?.id ?? null;
    actor.fleet.currentTargetKind = target?.kind ?? null;
    if (target) actor.fleet.lastCombatAtYear = state.clock.year;
    if (updateFleetCombatMovement(actor, target, elapsedGameDays, shipsById)) fleetsChanged = true;
  }
  if (applyFleetSoftSeparation(shipsById)) fleetsChanged = true;
  actors = buildContinuousCombatActors(shipsById);
  const targetByFleetId = new Map<string, ContinuousCombatActor | null>();
  for (const actor of actors.filter((candidate): candidate is Extract<ContinuousCombatActor, { kind: "fleet" }> => candidate.kind === "fleet")) {
    targetByFleetId.set(actor.id, selectFleetCombatTarget(actor, actors, shipsById));
  }
  for (const actor of actors) {
    if (actor.kind === "fleet") {
      const target = targetByFleetId.get(actor.id) ?? null;
      actor.fleet.currentTargetId = target?.id ?? null;
      actor.fleet.currentTargetKind = target?.kind ?? null;
      if (!target || !actorIsInFleetWeaponRange(actor, target)) continue;
      const result = fireFleetWeaponsAtTarget(actor, target, shipsById);
      shipsChanged ||= result.shipsChanged;
      starbasesChanged ||= result.starbasesChanged;
      factionEconomiesChanged ||= result.factionEconomiesChanged;
      combatContactsChanged ||= result.contactsChanged;
      if (result.contactsChanged) {
        actor.fleet.combatStatus = "firing";
        actor.fleet.lastCombatAtYear = state.clock.year;
      }
      continue;
    }
    if (actor.ownerId !== actor.starbase.ownerId || actor.starbase.hull <= 0) continue;
    const target = selectStarbaseCombatTarget(actor, actors, shipsById);
    if (!target) continue;
    const result = fireStarbaseWeaponsAtTarget(actor, target, shipsById);
    shipsChanged ||= result.shipsChanged;
    combatContactsChanged ||= result.contactsChanged;
  }
  const destroyedShipIds = new Set(state.ships.filter((ship) => ship.hull <= 0).map((ship) => ship.id));
  if (destroyedShipIds.size > 0) {
    state.ships = state.ships.filter((ship) => !destroyedShipIds.has(ship.id));
    if (syncFleetMembership(state)) fleetsChanged = true;
    shipsChanged = true;
  }
  if (starbasesChanged) {
    refreshDiscovery();
    visibilityChanged = true;
  }
  if (combatContactsChanged || shipsChanged || fleetsChanged || starbasesChanged) {
    hasDirtyState = true;
  }
  return { combatContactsChanged, shipsChanged, fleetsChanged, starbasesChanged, factionEconomiesChanged, visibilityChanged };
}

function fleetUpdateSignature(): string {
  return JSON.stringify(state.fleets.map((fleet) => ({
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

function scaleResourceCounts(counts: ResourceCounts, scale: number): ResourceCounts {
  return {
    food: counts.food * scale,
    minerals: counts.minerals * scale,
    energy: counts.energy * scale,
    goods: counts.goods * scale,
    alloys: counts.alloys * scale,
    research: counts.research * scale,
  };
}

function processEconomyHours(targetHour: number): { economyChanged: boolean; technologiesChanged: boolean } {
  const previousPlanetSignatures = new Map(
    state.planetStates.map((planetState) => [planetState.id, getPlanetDetailSignature(planetState)]),
  );
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  let economyChanged = false;
  let technologiesChanged = false;
  for (const economy of state.factionEconomies) {
    const processedHour = economy.lastProcessedHour ?? targetHour;
    const elapsedHours = Math.max(0, targetHour - processedHour);
    if (elapsedHours <= 0) continue;
    const researchPerHour = getFactionResearchPerHour(economy.factionId);
    technologiesChanged = applyTechnologyResearchForFaction(economy.factionId, elapsedHours, researchPerHour) || technologiesChanged;
    const resourceGain = scaleResourceCounts(
      calculateFactionMonthlyDelta(state, economy.factionId),
      elapsedHours / GAME_HOURS_PER_MONTH,
    );
    resourceGain.research = 0;
    economy.stockpiles = addResourceCounts(
      economy.stockpiles,
      resourceGain,
    );
    economy.stockpiles.research = 0;
    economy.lastProcessedHour = targetHour;
    economy.lastProcessedMonth = gameYearToMonthIndex(elapsedHoursToGameYear(targetHour));
    economyChanged = true;
  }
  if (technologiesChanged) {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
  }
  const planetDetailsChanged = queueChangedPlanetDetailRefreshes(previousPlanetSignatures);
  if (economyChanged || technologiesChanged) {
    hasDirtyState = true;
  }
  if (planetDetailsChanged) hasDirtyState = true;
  return { economyChanged, technologiesChanged };
}

function processMarketTicks(targetHour: number): { marketChanged: boolean; economyChanged: boolean } {
  const processedHour = Number.isFinite(state.market.lastProcessedHour)
    ? state.market.lastProcessedHour
    : targetHour;
  const elapsedHours = Math.max(0, targetHour - processedHour);
  let marketChanged = false;
  let economyChanged = false;

  if (elapsedHours > 0) {
    const temporaryDecay = Math.pow(MARKET_TEMPORARY_DECAY_PER_HOUR, elapsedHours);
    const persistentDecay = Math.pow(MARKET_PERSISTENT_DECAY_PER_HOUR, elapsedHours);
    state.market.resources = state.market.resources.map((resource) => {
      const temporaryPressure = roundTinyPressure(resource.temporaryPressure * temporaryDecay);
      const persistentPressure = roundTinyPressure(resource.persistentPressure * persistentDecay);
      const next = recomputeMarketResourcePrice({
        ...resource,
        temporaryPressure,
        persistentPressure,
      }, state.clock.year);
      const resourceChanged = (
        next.temporaryPressure !== resource.temporaryPressure
        || next.persistentPressure !== resource.persistentPressure
        || Math.abs(next.currentPrice - resource.currentPrice) > 0.000001
      );
      if (!resourceChanged) return resource;
      marketChanged = true;
      return next;
    });
    for (const order of state.market.autoTrades) {
      const executed = executeMarketAutoTrade(order, elapsedHours);
      marketChanged = executed || marketChanged;
      economyChanged = executed || economyChanged;
    }
    state.market.lastProcessedHour = targetHour;
  }

  const snapshotHour = Number.isFinite(state.market.lastSnapshotHour)
    ? state.market.lastSnapshotHour
    : targetHour;
  if (targetHour - snapshotHour >= MARKET_PRICE_SNAPSHOT_INTERVAL_HOURS) {
    for (const resource of state.market.resources) {
      appendMarketPriceSnapshot(resource, state.clock.year);
    }
    state.market.lastSnapshotHour = targetHour;
    marketChanged = true;
  }

  if (marketChanged || economyChanged) hasDirtyState = true;
  return { marketChanged, economyChanged };
}

function executeMarketAutoTrade(order: MarketAutoTradeOrder, elapsedHours: number): boolean {
  if (!order.enabled || order.amountPerHour <= 0 || elapsedHours <= 0) return false;
  const resource = getMarketResourceState(order.resourceId);
  if (!resource?.marketEnabled) return false;
  const economy = getFactionEconomy(order.playerId);
  if (!economy) return false;

  const requestedAmount = order.amountPerHour * elapsedHours;
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return false;

  const flows = calculateFactionResourceFlow(state, order.playerId);
  const quote = calculatePlayerMarketQuote(resource, order.playerId, flows);
  const stats = getMarketPlayerStats(order.playerId);
  let amount = requestedAmount;

  if (order.type === "auto_buy") {
    const unitCost = quote.finalQuotePrice * (1 + MARKET_FEE_RATE);
    amount = Math.min(amount, unitCost > 0 ? economy.stockpiles.energy / unitCost : 0);
    if (amount <= 0.000001) return false;
    const grossEnergy = amount * quote.finalQuotePrice;
    const feePaid = grossEnergy * MARKET_FEE_RATE;
    const buyCost = grossEnergy + feePaid;
    economy.stockpiles = {
      ...economy.stockpiles,
      energy: economy.stockpiles.energy - buyCost,
      [order.resourceId]: economy.stockpiles[order.resourceId] + amount,
    };
    stats.totalImportsEnergy += grossEnergy;
    recordMarketTransaction(order.playerId, order.resourceId, "auto_buy", amount, quote.finalQuotePrice, feePaid, -buyCost);
    applyMarketTradePressure(resource, "auto_buy", amount);
  } else {
    amount = Math.min(amount, economy.stockpiles[order.resourceId]);
    if (amount <= 0.000001) return false;
    const grossEnergy = amount * quote.finalQuotePrice;
    const feePaid = grossEnergy * MARKET_FEE_RATE;
    const sellPayout = grossEnergy - feePaid;
    economy.stockpiles = {
      ...economy.stockpiles,
      [order.resourceId]: economy.stockpiles[order.resourceId] - amount,
      energy: economy.stockpiles.energy + sellPayout,
    };
    stats.totalExportsEnergy += grossEnergy;
    recordMarketTransaction(order.playerId, order.resourceId, "auto_sell", amount, quote.finalQuotePrice, feePaid, sellPayout);
    applyMarketTradePressure(resource, "auto_sell", amount);
  }

  order.updatedAt = state.clock.year;
  return true;
}

function roundTinyPressure(value: number): number {
  return Math.abs(value) < 0.000001 ? 0 : value;
}

function processShipShortageEffects(): { shipsChanged: boolean; starbasesChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  for (const ship of state.ships) {
    if (ship.maxShield <= 0 || ship.shield <= 0) continue;
    const fleet = state.fleets.find((candidate) => candidate.id === ship.fleetId) ?? null;
    const shieldCap = ship.maxShield * (fleet ? getFleetShieldMultiplier(state, fleet) : getFactionFleetShortageEffects(state, ship.ownerId).shieldMultiplier);
    if (ship.shield <= shieldCap) continue;
    ship.shield = Math.max(0, shieldCap);
    shipsChanged = true;
  }
  for (const starbase of state.starbases) {
    if (starbase.status !== "online" || starbase.maxShield <= 0 || starbase.shield <= 0) continue;
    const shieldCap = starbase.maxShield * getFactionFleetShortageEffects(state, starbase.ownerId).shieldMultiplier;
    if (starbase.shield <= shieldCap) continue;
    starbase.shield = Math.max(0, shieldCap);
    starbasesChanged = true;
  }
  if (shipsChanged || starbasesChanged) hasDirtyState = true;
  return { shipsChanged, starbasesChanged };
}

function processPlanetConstruction(elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  state.planetStates = state.planetStates.map((planetState) => {
    if (!planetState.isHabited || planetState.constructionQueue.length === 0) return planetState;
    const result = progressPlanetConstructionQueue(
      planetState,
      elapsedDays,
      getPlanetDistrictLimitsFromState(state, planetState),
      getPlanetTechnologyModifiers(state, planetState),
      getPlanetSpeciesContext(state, planetState),
    );
    if (!result.changed) return planetState;
    changed = true;
    queuePlanetDetailRefresh(planetState.id);
    return result.state;
  });

  if (!changed) return false;
  applyPlanetStatesToStars(state.stars, state.planetStates);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  return true;
}

function processStarbaseConstruction(elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  state.starbases = state.starbases.map((starbase) => {
    if (starbase.constructionQueue.length === 0) return starbase;
    const result = progressStarbaseConstructionQueue(starbase, elapsedDays);
    if (!result.changed) return starbase;
    changed = true;
    return syncStarbaseCombatHealth(result.starbase);
  });

  if (!changed) return false;
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  return true;
}

function trySpendStarbaseRepairResources(ownerId: number, repairPoints: number, alloyCostPerPoint: number): boolean {
  const economy = getFactionEconomy(ownerId);
  if (!economy || repairPoints <= 0) return false;
  const alloys = repairPoints * alloyCostPerPoint;
  const energy = repairPoints * STARBASE_REPAIR_ENERGY_COST_PER_POINT;
  if (economy.stockpiles.alloys < alloys || economy.stockpiles.energy < energy) return false;
  economy.stockpiles = addResourceCounts(economy.stockpiles, {
    ...createEmptyResourceCounts(),
    alloys: -alloys,
    energy: -energy,
  });
  return true;
}

function processStarbaseRepairs(elapsedDays: number): boolean {
  if (elapsedDays <= 0) return false;
  let changed = false;
  state.starbases = state.starbases.map((starbase) => {
    if (starbase.status !== "online") return starbase;
    let next = starbase;
    if (next.armor < next.maxArmor) {
      const repair = Math.min(next.maxArmor - next.armor, next.maxArmor * STARBASE_ARMOR_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(next.ownerId, repair, STARBASE_ARMOR_REPAIR_ALLOY_COST_PER_POINT)) {
        next = { ...next, armor: next.armor + repair };
        changed = true;
      }
    }
    if (next.hull < next.maxHull) {
      const repair = Math.min(next.maxHull - next.hull, next.maxHull * STARBASE_HULL_REPAIR_FRACTION_PER_DAY * elapsedDays);
      if (trySpendStarbaseRepairResources(next.ownerId, repair, STARBASE_HULL_REPAIR_ALLOY_COST_PER_POINT)) {
        next = { ...next, hull: next.hull + repair };
        changed = true;
      }
    }
    return next;
  });
  if (changed) {
    refreshFactionEconomyDeltas();
    hasDirtyState = true;
  }
  return changed;
}

function spawnCompletedShip(starbase: ServerStarbase, item: { shipKind: StarbaseShipKind; designId?: string | null }): void {
  const fleetId = createRuntimeId("fleet", [starbase.ownerId, starbase.starId]);
  const ship = createShip(
    starbase.ownerId,
    fleetId,
    item.shipKind,
    createRuntimeId("ship", [starbase.ownerId, item.shipKind]),
    item.designId,
  );
  const fleet = createFleet(starbase.ownerId, starbase.starId, [ship.id], fleetId);
  fleet.phaseStartedAtYear = state.clock.year;
  fleet.speed = ship.speed;
  fleet.systemPosition = getSystemStarbaseOrbitPosition(starbase.systemPosition);
  applyFleetOrbitTarget(fleet, createStarbaseOrbitTarget(starbase, fleet.systemPosition));
  setFleetPhase(fleet, "orbiting");
  state.ships.push(ship);
  state.fleets.push(fleet);
}

function completeQueuedShipUpgrade(item: StarbaseShipQueueItem): boolean {
  if (item.kind !== "upgrade" || !item.shipId) return false;
  const ship = state.ships.find((candidate) => candidate.id === item.shipId);
  if (!ship) return false;
  const targetDesign = findShipDesignById(
    state.shipDesigns,
    ship.ownerId,
    ship.shipKind,
    item.targetDesignId ?? item.designId,
    true,
  );
  if (!targetDesign) return false;
  applyShipDesignToShip(ship, targetDesign);
  syncFleetMembership(state);
  return true;
}

function processStarbaseShipQueues(elapsedDays: number): { starbasesChanged: boolean; fleetsChanged: boolean } {
  if (elapsedDays <= 0) return { starbasesChanged: false, fleetsChanged: false };
  let starbasesChanged = false;
  let fleetsChanged = false;
  state.starbases = state.starbases.map((starbase) => {
    if (starbase.shipQueue.length === 0) return starbase;
    const speed = getFactionStarbaseShipBuildSpeedMultiplier(state, starbase.ownerId);
    const economy = getFactionEconomy(starbase.ownerId);
    const result = progressStarbaseShipQueue(starbase, elapsedDays * speed, economy?.stockpiles);
    if (!result.changed) return starbase;

    if (economy) {
      economy.stockpiles = addResourceCounts(economy.stockpiles, scaleResourceCounts(result.resourcesConsumed, -1));
    }
    for (const completed of result.completed) {
      if (completed.kind === "upgrade") {
        fleetsChanged = completeQueuedShipUpgrade(completed) || fleetsChanged;
      } else {
        spawnCompletedShip(starbase, completed);
        fleetsChanged = true;
      }
    }
    starbasesChanged = true;
    return result.starbase;
  });

  if (!starbasesChanged && !fleetsChanged) return { starbasesChanged: false, fleetsChanged: false };
  if (fleetsChanged) {
    refreshDiscovery();
  }
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  return { starbasesChanged, fleetsChanged };
}

function processPopulationWeeks(targetWeek: number): boolean {
  const previousWeek = state.clock.lastProcessedPopulationWeek ?? targetWeek;
  const weeks = Math.max(0, targetWeek - previousWeek);
  if (weeks <= 0) return false;

  let changed = false;
  state.planetStates = state.planetStates.map((planetState) => {
    if (!planetState.isHabited) return planetState;
    const nextPlanetState = applyPopulationGrowthFraction(
      planetState,
      getPlanetDistrictLimitsFromState(state, planetState),
      (GAME_DAYS_PER_WEEK * weeks) / GAME_DAYS_PER_QUARTER,
      getPlanetTechnologyModifiers(state, planetState),
      getPlanetSpeciesContext(state, planetState),
    );
    if (nextPlanetState.population !== planetState.population) changed = true;
    if (nextPlanetState.population !== planetState.population) queuePlanetDetailRefresh(planetState.id);
    return nextPlanetState;
  });

  state.clock.lastProcessedPopulationWeek = targetWeek;
  hasDirtyState = true;
  if (!changed) return false;
  applyPlanetStatesToStars(state.stars, state.planetStates);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  return true;
}

function getLeaderDailyDeathChance(age: number, lifespan: number): number {
  if (age < lifespan - 8) return 0.000002;
  if (age < lifespan) return 0.00002;
  const overdue = Math.max(0, age - lifespan);
  return clamp(0.00025 + overdue * overdue * 0.000025, 0.00025, 0.03);
}

function processLeaderDays(targetDay: number): {
  leadersChanged: boolean;
  planetEconomiesChanged: boolean;
  fleetEffectsChanged: boolean;
  governmentEffectsChanged: boolean;
} {
  const previousDay = state.clock.lastProcessedLeaderDay ?? targetDay;
  const days = Math.max(0, targetDay - previousDay);
  const factionIds = state.factions.map((faction) => faction.id);
  if (days <= 0) {
    const expectedPoolCount = factionIds.length * LEADER_POOL_PER_CLASS * 2;
    if (state.leaders.filter((leader) => leader.status === "pool").length >= expectedPoolCount) {
      return { leadersChanged: false, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
    }
    state.leaders = refreshLeaderPool(state.leaders, factionIds, targetDay, state.clock.year);
    state.clock.lastProcessedLeaderDay = targetDay;
    hasDirtyState = true;
    return { leadersChanged: true, planetEconomiesChanged: false, fleetEffectsChanged: false, governmentEffectsChanged: false };
  }

  let leadersChanged = false;
  let planetEconomiesChanged = false;
  let fleetEffectsChanged = false;
  let governmentEffectsChanged = false;
  const ageIncrease = days / GAME_DAYS_PER_YEAR;
  for (const leader of state.leaders) {
    if (leader.status !== "recruited") continue;
    const previousLevel = leader.level;
    leader.age += ageIncrease;
    const dailyXp = leader.assignment ? (leader.class === "military" ? 0.2 : 0.16) : 0.03;
    leader.xp += dailyXp * days;
    leader.level = calculateLeaderLevel(leader.xp);
    leadersChanged = true;
    if (leader.level !== previousLevel && leader.assignment) {
      if (leader.assignment.kind === "planet") planetEconomiesChanged = true;
      if (leader.assignment.kind === "fleet") fleetEffectsChanged = true;
      if (leader.assignment.kind === "government") governmentEffectsChanged = true;
    }

    const dailyDeathChance = getLeaderDailyDeathChance(leader.age, leader.lifespan);
    const deathChance = 1 - Math.pow(1 - dailyDeathChance, days);
    if (Math.random() >= deathChance) continue;
    const oldAssignment = leader.assignment;
    leader.status = "dead";
    leader.assignment = null;
    leader.diedAtYear = state.clock.year;
    leadersChanged = true;
    if (oldAssignment?.kind === "planet") planetEconomiesChanged = true;
    if (oldAssignment?.kind === "fleet") fleetEffectsChanged = true;
    if (oldAssignment?.kind === "government") governmentEffectsChanged = true;
  }

  state.leaders = refreshLeaderPool(state.leaders, factionIds, targetDay, state.clock.year);
  state.clock.lastProcessedLeaderDay = targetDay;
  leadersChanged = true;
  hasDirtyState = true;
  if (planetEconomiesChanged || governmentEffectsChanged) {
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
  } else if (fleetEffectsChanged) {
    refreshFactionEconomyDeltas();
  }
  return { leadersChanged, planetEconomiesChanged, fleetEffectsChanged, governmentEffectsChanged };
}

function advanceState(now: number): Set<ServerUpdateField> {
  const changed = new Set<ServerUpdateField>();
  syncClockSpeedFields();
  const elapsedMs = Math.max(0, now - state.clock.lastUpdatedAt);
  if (elapsedMs <= 0) return changed;
  if (state.clock.paused) {
    state.clock.lastUpdatedAt = now;
    state.clock.syncedAtMs = now;
    return changed;
  }
  const previousFleetSignature = fleetUpdateSignature();
  const arrivingFleets: GameFleet[] = [];
  const elapsedRealSeconds = elapsedMs / 1000;
  const elapsedGameDays = elapsedRealSeconds * state.clock.tickSizeDays / Math.max(0.01, state.clock.tickSpeedSeconds);
  const elapsedGameHours = elapsedGameDays * 24;
  const scaledMs = elapsedGameHours * REAL_MS_PER_GAME_HOUR;
  state.clock.year += elapsedHoursToGameYear(elapsedGameHours);
  state.clock.lastUpdatedAt = now;
  state.clock.syncedAtMs = now;
  changed.add("clock");

  const movingBefore = state.fleets.some((fleet) => fleet.phase !== "idle");
  for (const fleet of state.fleets) {
    if (advanceFleet(fleet, scaledMs)) {
      arrivingFleets.push(fleet);
    }
  }
  if (processMissingInActionFleets()) {
    changed.add("fleets");
    changed.add("visibility");
  }
  const movingAfter = state.fleets.some((fleet) => fleet.phase !== "idle");
  if (movingBefore || movingAfter) {
    refreshDiscovery();
  }
  const combatResult = processContinuousFleetCombat(elapsedGameHours, elapsedGameDays);
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
    hasDirtyState = true;
    changed.add("fleets");
    changed.add("visibility");
    changed.add("starbases");
  }

  const leaderResult = processLeaderDays(getLeaderDayIndex(state.clock.year));
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

  if (processPlanetConstruction(elapsedGameDays)) {
    changed.add("factionEconomies");
  }

  if (processStarbaseConstruction(elapsedGameDays)) {
    changed.add("starbases");
    changed.add("factionEconomies");
  }

  if (processStarbaseRepairs(elapsedGameDays)) {
    changed.add("starbases");
    changed.add("factionEconomies");
  }

  const shipQueueResult = processStarbaseShipQueues(elapsedGameDays);
  if (shipQueueResult.starbasesChanged || shipQueueResult.fleetsChanged) {
    changed.add("starbases");
    changed.add("factionEconomies");
    if (shipQueueResult.fleetsChanged) {
      changed.add("ships");
      changed.add("fleets");
      changed.add("visibility");
    }
  }

  const nextEconomyHour = gameYearToHourIndex(state.clock.year);
  const economyResult = processEconomyHours(nextEconomyHour);
  if (economyResult.economyChanged) {
    changed.add("factionEconomies");
  }
  if (economyResult.technologiesChanged) {
    changed.add("technologies");
    changed.add("factionEconomies");
  }
  const marketResult = processMarketTicks(nextEconomyHour);
  if (marketResult.marketChanged || marketResult.economyChanged) {
    refreshFactionEconomyDeltas();
  }
  if (marketResult.marketChanged) {
    changed.add("market");
  }
  if (marketResult.economyChanged || (marketResult.marketChanged && state.market.autoTrades.length > 0)) {
    changed.add("factionEconomies");
  }
  const shortageShipEffects = processShipShortageEffects();
  if (shortageShipEffects.shipsChanged) {
    changed.add("ships");
    changed.add("fleets");
  }
  if (shortageShipEffects.starbasesChanged) {
    changed.add("starbases");
  }

  const nextPopulationWeek = gameYearToWeekIndex(state.clock.year);
  if (processPopulationWeeks(nextPopulationWeek)) {
    changed.add("factionEconomies");
    changed.add("habitedPlanetSystems");
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
  const ownerId = integerArg(value, "owner id", 0, state.factions.length - 1);
  if (!state.factions.some((faction) => faction.id === ownerId)) throw new Error("Owner not found.");
  return ownerId;
}

function resolveCurrentStarId(context: AdminCommandContext | undefined): number {
  if (Number.isInteger(context?.currentStarId)) return context!.currentStarId!;
  const selectedFleetId = context?.selectedFleetId ?? context?.selectedFleetIds?.[0];
  const selectedFleet = selectedFleetId ? state.fleets.find((fleet) => fleet.id === selectedFleetId) : null;
  if (selectedFleet) return selectedFleet.currentStarId;
  return state.factions[0]?.homeStarId ?? 0;
}

function resolveSystemToken(token: string | undefined, context: AdminCommandContext | undefined): number {
  const value = token ?? "current";
  if (value === "current" || value === "selected") return resolveCurrentStarId(context);
  const starId = integerArg(value, "system id", 0, state.stars.length - 1);
  if (!state.stars[starId]) throw new Error("System not found.");
  return starId;
}

function resolveFleetToken(token: string | undefined, context: AdminCommandContext | undefined): GameFleet {
  const fleetId = token === "selected" || !token ? context?.selectedFleetId ?? context?.selectedFleetIds?.[0] : token;
  const fleet = fleetId ? state.fleets.find((candidate) => candidate.id === fleetId) : null;
  if (!fleet) throw new Error("Fleet not found.");
  return fleet;
}

function resolveShipToken(token: string | undefined, context: AdminCommandContext | undefined): GameShip {
  const shipId = token === "selected" || !token ? context?.selectedShipId : token;
  const ship = shipId ? state.ships.find((candidate) => candidate.id === shipId) : null;
  if (!ship) throw new Error("Ship not found.");
  return ship;
}

function resolveStarbaseToken(token: string | undefined, context: AdminCommandContext | undefined): ServerStarbase {
  const starbaseId = token === "selected" || !token ? context?.selectedStarbaseId : token;
  const starbase = starbaseId ? state.starbases.find((candidate) => candidate.id === starbaseId) : null;
  if (!starbase) throw new Error("Starbase not found.");
  return starbase;
}

function resolvePlanetToken(token: string | undefined, context: AdminCommandContext | undefined): PlanetState {
  const planetId = token === "selected" || !token ? context?.selectedPlanetId : token;
  const planet = planetId ? state.planetStates.find((candidate) => candidate.id === planetId) : null;
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

function removeDestroyedShips(): boolean {
  const destroyed = new Set(state.ships.filter((ship) => ship.hull <= 0).map((ship) => ship.id));
  if (destroyed.size === 0) return false;
  state.ships = state.ships.filter((ship) => !destroyed.has(ship.id));
  syncFleetMembership(state);
  return true;
}

function clearFleetMovementNow(fleet: GameFleet): void {
  const currentPosition = getFleetAuthoritativeSystemPosition(fleet);
  fleet.systemPosition = currentPosition;
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.orderType = null;
  fleet.hyperlanePosition = null;
  fleet.movementPlan = null;
  fleet.mergeTargetFleetId = null;
  clearFleetOrbit(fleet);
  clearFleetCombatIntent(fleet);
  setFleetPhase(fleet, "idle");
  fleet.phaseProgress = 0;
  fleet.phaseElapsedMs = 0;
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
  const design = resolveShipDesign(state.shipDesigns, ownerId, "corvette", designId === "default" ? undefined : designId);
  const fleet = createFleet(ownerId, starId, [], createRuntimeId("fleet", [ownerId, starId]));
  fleet.systemPosition = cloneSystemPosition(position);
  clearFleetMovementNow(fleet);
  const ships = Array.from({ length: Math.max(1, count) }, () => createShipFromDesign(ownerId, fleet.id, design));
  fleet.shipIds = ships.map((ship) => ship.id);
  fleet.tacticalRadius = getFleetTacticalRadius(fleet.shipIds.length);
  fleet.speed = Math.min(...ships.map((ship) => ship.speed));
  state.fleets.push(fleet);
  state.ships.push(...ships);
  return fleet;
}

function changedResult(
  message: string,
  changed: ServerUpdateField[],
  rows?: AdminCommandResult["rows"],
): { message: string; changed: ServerUpdateField[]; rows?: AdminCommandResult["rows"] } {
  hasDirtyState = true;
  return { message, changed: Array.from(new Set(changed)), rows };
}

function forceAdvanceGameDays(days: number): Set<ServerUpdateField> {
  const originalPaused = state.clock.paused;
  state.clock.paused = false;
  syncClockSpeedFields();
  const now = Date.now();
  const realMs = (Math.max(0, days) * Math.max(0.01, state.clock.tickSpeedSeconds) / Math.max(0.000001, state.clock.tickSizeDays)) * 1000;
  state.clock.lastUpdatedAt = now - realMs;
  const changed = advanceState(now);
  state.clock.paused = originalPaused;
  syncClockSpeedFields();
  state.clock.syncedAtMs = Date.now();
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
  const view = createFactionTechnologyView(factionId);
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
        const star = state.stars[starId];
        return { message: "System.", rows: [{ id: star.id, name: star.name, owner: state.starOwnership[starId] ?? -1, planets: star.system.planets.length, fleets: state.fleets.filter((fleet) => fleet.currentStarId === starId).length }] };
      }
      if (kind === "owner") {
        const owner = resolveOwnerToken(id, context, perspective);
        const faction = state.factions.find((candidate) => candidate.id === owner);
        return { message: "Owner.", rows: [{ id: owner, name: faction?.name ?? "Unknown", homeSystem: faction?.homeStarId ?? null }] };
      }
      throw new Error("Inspect kind must be fleet, ship, starbase, planet, system, or owner.");
    }
    case "list_fleets": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const system = commandOption(parsed, "system");
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(system, context) : null;
      const fleets = state.fleets.filter((fleet) => (
        (ownerFilter === null || fleet.ownerId === ownerFilter)
        && (systemFilter === null || fleet.currentStarId === systemFilter)
      ));
      return { message: `${fleets.length} fleets.`, rows: adminRowsForFleets(fleets) };
    }
    case "list_ships": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      return { message: `${fleet.shipIds.length} ships.`, rows: adminRowsForShips(state.ships.filter((ship) => ship.fleetId === fleet.id)) };
    }
    case "list_designs": {
      const owner = commandOption(parsed, "owner") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const designs = state.shipDesigns.filter((design) => ownerFilter === null || design.ownerId === ownerFilter);
      return { message: `${designs.length} designs.`, rows: designs.map((design) => ({ id: design.id, owner: design.ownerId, kind: design.shipKind, name: design.name, status: design.status })) };
    }
    case "list_starbases": {
      const owner = commandOption(parsed, "owner");
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const ownerFilter = owner && owner !== "all" ? resolveOwnerToken(owner, context, perspective) : null;
      const systemFilter = system ? resolveSystemToken(system, context) : null;
      const starbases = state.starbases.filter((starbase) => (
        (ownerFilter === null || starbase.ownerId === ownerFilter)
        && (systemFilter === null || starbase.starId === systemFilter)
      ));
      return { message: `${starbases.length} starbases.`, rows: starbases.map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, status: starbase.status, hull: Math.round(starbase.hull) })) };
    }
    case "list_planets": {
      const systemId = resolveSystemToken(commandOption(parsed, "system") ?? parsed.args[0], context);
      return {
        message: `Planets in system ${systemId}.`,
        rows: state.planetStates
          .filter((planet) => planet.starId === systemId)
          .map((planet) => ({ id: planet.id, index: planet.planetIndex, habited: planet.isHabited, population: Math.round(planet.population), habitability: planet.habitability })),
      };
    }
    case "where": {
      const id = parsed.args[0];
      const fleet = state.fleets.find((candidate) => candidate.id === id);
      if (fleet) return { message: "Found fleet.", rows: adminRowsForFleets([fleet]) };
      const ship = state.ships.find((candidate) => candidate.id === id);
      if (ship) return { message: "Found ship.", rows: adminRowsForShips([ship]) };
      const starbase = state.starbases.find((candidate) => candidate.id === id);
      if (starbase) return { message: "Found starbase.", rows: [{ id: starbase.id, system: starbase.starId, owner: starbase.ownerId }] };
      const planet = state.planetStates.find((candidate) => candidate.id === id);
      if (planet) return { message: "Found planet.", rows: [{ id: planet.id, system: planet.starId, index: planet.planetIndex }] };
      throw new Error("Entity not found.");
    }
    case "combat_status": {
      const system = commandOption(parsed, "system") ?? parsed.args[0];
      const systemId = system ? resolveSystemToken(system, context) : resolveCurrentStarId(context);
      return {
        message: `Combat status for system ${systemId}.`,
        rows: [
          ...adminRowsForFleets(state.fleets.filter((fleet) => fleet.currentStarId === systemId)),
          ...state.starbases.filter((starbase) => starbase.starId === systemId).map((starbase) => ({ id: starbase.id, owner: starbase.ownerId, system: starbase.starId, level: starbase.level, hull: Math.round(starbase.hull), status: starbase.status })),
        ],
      };
    }
    case "economy_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const economies = ownerArg === "all"
        ? state.factionEconomies
        : state.factionEconomies.filter((economy) => economy.factionId === resolveOwnerToken(ownerArg, context, perspective));
      return { message: `${economies.length} economies.`, rows: economies.map((economy) => ({ owner: economy.factionId, ...economy.stockpiles })) };
    }
    case "tech_status": {
      const ownerArg = parsed.args[0] ?? "me";
      const ownerIds = ownerArg === "all"
        ? state.factions.map((faction) => faction.id)
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
          year: state.clock.year.toFixed(3),
          systems: state.stars.length,
          factions: state.factions.length,
          fleets: state.fleets.length,
          ships: state.ships.length,
          starbases: state.starbases.length,
          combatContacts: state.recentCombatContacts.length,
        }],
      };
    case "tick_size": {
      state.clock.tickSizeDays = numberArg(parsed.args[0], "tick size days", 0.000001);
      syncClockSpeedFields();
      state.clock.syncedAtMs = Date.now();
      return changedResult(`Tick size set to ${state.clock.tickSizeDays} game days.`, ["clock"]);
    }
    case "tick_speed": {
      state.clock.tickSpeedSeconds = numberArg(parsed.args[0], "tick speed seconds", 0.01);
      syncClockSpeedFields();
      state.clock.syncedAtMs = Date.now();
      return changedResult(`Tick speed set to ${state.clock.tickSpeedSeconds} real seconds.`, ["clock"]);
    }
    case "pause":
      state.clock.paused = true;
      syncClockSpeedFields();
      state.clock.syncedAtMs = Date.now();
      return changedResult("Simulation paused.", ["clock"]);
    case "resume":
      state.clock.paused = false;
      syncClockSpeedFields();
      state.clock.syncedAtMs = Date.now();
      return changedResult("Simulation resumed.", ["clock"]);
    case "step": {
      const ticks = integerArg(parsed.args[0] ?? "1", "ticks", 1, 10000);
      const changed = Array.from(forceAdvanceGameDays(state.clock.tickSizeDays * ticks));
      return changedResult(`Advanced ${ticks} tick(s).`, changed);
    }
    case "advance_hours": {
      const hours = numberArg(parsed.args[0], "hours", 0);
      return changedResult(`Advanced ${hours} game hours.`, Array.from(forceAdvanceGameDays(hours / 24)));
    }
    case "advance_days": {
      const days = numberArg(parsed.args[0], "days", 0);
      return changedResult(`Advanced ${days} game days.`, Array.from(forceAdvanceGameDays(days)));
    }
    case "set_year": {
      state.clock.year = numberArg(parsed.args[0], "year", 0);
      state.clock.lastUpdatedAt = Date.now();
      state.clock.syncedAtMs = state.clock.lastUpdatedAt;
      state.clock.lastProcessedPopulationWeek = gameYearToWeekIndex(state.clock.year);
      state.clock.lastProcessedLeaderDay = getLeaderDayIndex(state.clock.year);
      return changedResult(`Year set to ${state.clock.year}.`, ["clock"]);
    }
    case "speed_preset": {
      const preset = SPEED_PRESETS[parsed.args[0] ?? ""];
      if (!preset) throw new Error("Speed preset must be 1-9.");
      state.clock.tickSizeDays = preset.tickSizeDays;
      state.clock.tickSpeedSeconds = preset.tickSpeedSeconds;
      state.clock.paused = false;
      syncClockSpeedFields();
      state.clock.syncedAtMs = Date.now();
      return changedResult(`Speed preset ${parsed.args[0]} applied.`, ["clock"]);
    }
    case "save":
      await saveState(state);
      return { message: "Game state saved." };
    case "reset_galaxy": {
      state = createInitialState();
      await saveState(state);
      broadcastSnapshots();
      return { message: "Galaxy reset.", changed: ["clock", "visibility", "planetStates", "factionEconomies", "species", "ships", "shipDesigns", "fleets", "starbases", "combatContacts"] };
    }
    case "clear_recent_combat":
      state.recentCombatContacts = [];
      return changedResult("Recent combat contacts cleared.", ["combatContacts"]);
    case "clear_orders": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all" ? state.fleets : [resolveFleetToken(token, context)];
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
      const fleets = token === "all" ? state.fleets : [resolveFleetToken(token, context)];
      for (const fleet of fleets) clearFleetMovementNow(fleet);
      return changedResult(`Stopped ${fleets.length} fleet(s).`, ["fleets", "visibility"]);
    }
    case "clear_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned"
        ? state.planetStates.filter((planet) => state.starOwnership[planet.starId] === owner)
        : [resolvePlanetToken(token, context)];
      for (const planet of planets) planet.constructionQueue = [];
      refreshFactionEconomyDeltas();
      return changedResult(`Cleared ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies"]);
    }
    case "clear_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned"
        ? state.starbases.filter((starbase) => starbase.ownerId === owner)
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
      const jumps = integerArg(commandOption(parsed, "jumps") ?? parsed.args[2] ?? "0", "jumps", 0, state.stars.length);
      const current = new Set(state.discoveredByFaction[String(owner)] ?? []);
      const addSystem = (starId: number) => {
        current.add(starId);
        if (jumps > 0) {
          for (const visible of computeVisibleStarIds(state.adjacency, starId, jumps)) current.add(visible);
        }
      };
      if (target === "all") {
        state.stars.forEach((_, starId) => current.add(starId));
      } else {
        addSystem(resolveSystemToken(target, context));
      }
      state.discoveredByFaction[String(owner)] = Array.from(current).sort((a, b) => a - b);
      refreshDiscovery();
      return changedResult("Discovery updated.", ["visibility"]);
    }
    case "forget": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const target = parsed.args[1] ?? "current";
      if (target === "all") {
        state.discoveredByFaction[String(owner)] = [];
      } else {
        const starId = resolveSystemToken(target, context);
        state.discoveredByFaction[String(owner)] = (state.discoveredByFaction[String(owner)] ?? []).filter((id) => id !== starId);
      }
      refreshDiscovery();
      return changedResult("Discovery removed.", ["visibility"]);
    }
    case "reveal_all": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      state.discoveredByFaction[String(owner)] = state.stars.map((_, index) => index);
      refreshDiscovery();
      return changedResult("All systems revealed.", ["visibility"]);
    }
    case "reset_visibility": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const faction = state.factions.find((candidate) => candidate.id === owner);
      state.discoveredByFaction[String(owner)] = faction ? Array.from(computeVisibleStarIds(state.adjacency, faction.homeStarId, DISCOVERY_JUMPS)) : [];
      refreshDiscovery();
      return changedResult("Visibility reset.", ["visibility"]);
    }
    case "own_system": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const ownerToken = parsed.args[1] ?? "me";
      state.starOwnership[starId] = ownerToken === "none" ? -1 : resolveOwnerToken(ownerToken, context, perspective);
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      refreshDiscovery();
      return changedResult(`System ${starId} ownership changed.`, ["visibility", "planetStates", "factionEconomies"]);
    }
    case "set_home_system": {
      const owner = resolveOwnerToken(parsed.args[0], context, perspective);
      const starId = resolveSystemToken(parsed.args[1], context);
      const faction = state.factions.find((candidate) => candidate.id === owner);
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
      const economy = state.factionEconomies.find((candidate) => candidate.factionId === owner);
      if (!economy) throw new Error("Economy not found.");
      const resources = resource === "all" ? RESOURCE_KINDS : [resource as ResourceKind];
      for (const kind of resources) {
        if (!RESOURCE_KINDS.includes(kind)) throw new Error("Invalid resource.");
        economy.stockpiles[kind] = name === "add_resource" ? economy.stockpiles[kind] + amount : amount;
      }
      refreshFactionEconomyDeltas();
      return changedResult("Resources updated.", ["factionEconomies"]);
    }
    case "complete_planet_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const planets = token === "all_owned" ? state.planetStates.filter((planet) => state.starOwnership[planet.starId] === owner) : [resolvePlanetToken(token, context)];
      for (const planet of planets) {
        const result = progressPlanetConstructionQueue(
          planet,
          1_000_000,
          getPlanetDistrictLimitsFromState(state, planet),
          getPlanetTechnologyModifiers(state, planet),
          getPlanetSpeciesContext(state, planet),
        );
        Object.assign(planet, result.state);
      }
      applyPlanetStatesToStars(state.stars, state.planetStates);
      refreshFactionEconomyDeltas();
      return changedResult(`Completed ${planets.length} planet queue(s).`, ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "complete_starbase_queue": {
      const token = parsed.args[0] ?? "selected";
      const owner = resolvePerspectiveOwner(context, perspective);
      const starbases = token === "all_owned" ? state.starbases.filter((starbase) => starbase.ownerId === owner) : [resolveStarbaseToken(token, context)];
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
      const ownerId = state.starOwnership[planet.starId] ?? -1;
      const foundingSpeciesId = state.factions.find((faction) => faction.id === ownerId)?.foundingSpeciesId ?? HUMAN_SPECIES_ID;
      planet.speciesPopulations = [{ speciesId: foundingSpeciesId, population: planet.population }];
      const recalculated = recalculatePlanetStateEconomy(
        planet,
        getPlanetDistrictLimitsFromState(state, planet),
        getPlanetTechnologyModifiers(state, planet),
        getPlanetSpeciesContext(state, planet),
      );
      Object.assign(planet, recalculated);
      applyPlanetStatesToStars(state.stars, state.planetStates);
      refreshFactionEconomyDeltas();
      return changedResult("Population updated.", ["planetStates", "factionEconomies", "habitedPlanetSystems"]);
    }
    case "set_habitability": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      planet.habitability = numberArg(parsed.args[1], "habitability", 0, 100);
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(state, planet), getPlanetTechnologyModifiers(state, planet), getPlanetSpeciesContext(state, planet)));
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
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(state, planet), getPlanetTechnologyModifiers(state, planet), getPlanetSpeciesContext(state, planet)));
      refreshFactionEconomyDeltas();
      return changedResult("Stability test modifier updated.", ["planetStates", "factionEconomies"]);
    }
    case "build_district_now": {
      const planet = resolvePlanetToken(parsed.args[0], context);
      const district = parsed.args[1] as DistrictKind;
      if (!isDistrictKind(district)) throw new Error("Invalid district.");
      planet.builtDistricts[district] += 1;
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(state, planet), getPlanetTechnologyModifiers(state, planet), getPlanetSpeciesContext(state, planet)));
      applyPlanetStatesToStars(state.stars, state.planetStates);
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
      Object.assign(planet, recalculatePlanetStateEconomy(planet, getPlanetDistrictLimitsFromState(state, planet), getPlanetTechnologyModifiers(state, planet), getPlanetSpeciesContext(state, planet)));
      refreshFactionEconomyDeltas();
      return changedResult("Building built.", ["planetStates", "factionEconomies"]);
    }
    case "set_active_tech": {
      const ownerId = resolveOwnerToken(parsed.args[0], context, perspective);
      const techId = resolveTechnologyToken(parsed.args[1]);
      const tech = TECHNOLOGY_BY_ID[techId];
      const techState = getFactionTechnology(state, ownerId);
      if (!techState) throw new Error("Faction technology state unavailable.");
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
      const techState = getFactionTechnology(state, ownerId);
      if (!techState) throw new Error("Faction technology state unavailable.");
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
      const techState = getFactionTechnology(state, ownerId);
      if (!techState) throw new Error("Faction technology state unavailable.");
      const completed = completeTechnology(techState, techId);
      ensureActiveTechnology(techState);
      return changedTechnologyResult(`${tech.name} completed.`, completed, adminRowsForTechnologies(ownerId, techId));
    }
    case "create_design":
    case "set_design_modules": {
      const isCreate = name === "create_design";
      const owner = isCreate ? resolveOwnerToken(parsed.args[0], context, perspective) : 0;
      const design = isCreate ? null : state.shipDesigns.find((candidate) => candidate.id === parsed.args[0]);
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
        createdAtYear: design?.createdAtYear ?? state.clock.year,
        updatedAtYear: state.clock.year,
      }, design?.ownerId ?? owner, state.clock.year);
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
      if (design) state.shipDesigns = state.shipDesigns.map((candidate) => candidate.id === design.id ? normalized : candidate);
      else state.shipDesigns.push(normalized);
      const shipsChanged = syncShipsForDesign(state, normalized);
      return changedResult("Ship design updated.", shipsChanged ? ["shipDesigns", "ships", "fleets"] : ["shipDesigns"], [{ id: normalized.id, owner: normalized.ownerId, name: normalized.name }]);
    }
    case "clone_design": {
      const source = state.shipDesigns.find((design) => design.id === parsed.args[0]);
      if (!source) throw new Error("Design not found.");
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const clone = normalizeShipDesign({
        ...source,
        id: createRuntimeId("design", [owner, source.shipKind]),
        ownerId: owner,
        name: commandOption(parsed, "name") ?? `${source.name} Copy`,
        createdAtYear: state.clock.year,
        updatedAtYear: state.clock.year,
      }, owner, state.clock.year);
      state.shipDesigns.push(clone);
      return changedResult("Ship design cloned.", ["shipDesigns"], [{ id: clone.id, owner: clone.ownerId, name: clone.name }]);
    }
    case "delete_design": {
      const designId = parsed.args[0];
      const before = state.shipDesigns.length;
      state.shipDesigns = state.shipDesigns.filter((design) => design.id !== designId);
      if (state.shipDesigns.length === before) throw new Error("Design not found.");
      return changedResult("Ship design deleted.", ["shipDesigns"]);
    }
    case "create_fleet": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      const fleet = createFleet(owner, starId, [], createRuntimeId("fleet", [owner, starId]));
      fleet.systemPosition = position;
      state.fleets.push(fleet);
      return changedResult("Empty fleet created. Add ships to keep it after membership sync.", ["fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "create_ship": {
      const target = parsed.args[0] ?? "current";
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const designToken = parsed.args[2] ?? "default";
      const count = integerArg(commandOption(parsed, "count") ?? "1", "count", 1, 1000);
      let fleet = target === "selected" ? resolveFleetToken(target, context) : state.fleets.find((candidate) => candidate.id === target) ?? null;
      let starId = fleet?.currentStarId ?? resolveSystemToken(target, context);
      const { position } = parseSystemPosition(parsed.args, 3, fleet?.systemPosition ?? systemCenterPosition());
      if (!fleet || fleet.ownerId !== owner) {
        fleet = createFleet(owner, starId, [], createRuntimeId("fleet", [owner, starId]));
        fleet.systemPosition = position;
        state.fleets.push(fleet);
      }
      const design = resolveShipDesign(state.shipDesigns, owner, "corvette", designToken === "default" ? undefined : designToken);
      const ships = Array.from({ length: count }, () => createShipFromDesign(owner, fleet!.id, design));
      state.ships.push(...ships);
      syncFleetMembership(state);
      return changedResult(`Created ${count} ship(s).`, ["ships", "fleets", "visibility"], adminRowsForFleets([fleet]));
    }
    case "delete_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      state.ships = state.ships.filter((candidate) => candidate.id !== ship.id);
      syncFleetMembership(state);
      return changedResult("Ship deleted.", ["ships", "fleets", "visibility"]);
    }
    case "delete_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      state.ships = state.ships.filter((ship) => ship.fleetId !== fleet.id);
      state.fleets = state.fleets.filter((candidate) => candidate.id !== fleet.id);
      return changedResult("Fleet deleted.", ["ships", "fleets", "visibility"]);
    }
    case "kill_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      removeDestroyedShips();
      return changedResult("Ship killed.", ["ships", "fleets", "visibility"]);
    }
    case "kill_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        ship.shield = 0; ship.armor = 0; ship.hull = 0; ship.hp = 0;
      }
      removeDestroyedShips();
      return changedResult("Fleet killed.", ["ships", "fleets", "visibility"]);
    }
    case "repair_ship": {
      repairShip(resolveShipToken(parsed.args[0], context));
      return changedResult("Ship repaired.", ["ships", "fleets"]);
    }
    case "repair_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) repairShip(ship);
      return changedResult("Fleet repaired.", ["ships", "fleets"]);
    }
    case "damage_ship": {
      const ship = resolveShipToken(parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips();
      return changedResult("Ship damaged.", ["ships", "fleets", "visibility"]);
    }
    case "damage_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const layer = parsed.args[1];
      if (!isHealthLayer(layer)) throw new Error("Invalid health layer.");
      for (const ship of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) damageShipLayer(ship, layer, parsed.args[2] ?? "0");
      removeDestroyedShips();
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
      removeDestroyedShips();
      return changedResult("Ship health set.", ["ships", "fleets", "visibility"]);
    }
    case "set_fleet_health": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      for (const ship of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) {
        const shield = commandOption(parsed, "shield");
        const armor = commandOption(parsed, "armor");
        const hull = commandOption(parsed, "hull");
        if (shield) ship.shield = parseLayerValue(shield, ship.maxShield);
        if (armor) ship.armor = parseLayerValue(armor, ship.maxArmor);
        if (hull) { ship.hull = parseLayerValue(hull, ship.maxHull); ship.hp = ship.hull; }
      }
      removeDestroyedShips();
      return changedResult("Fleet health set.", ["ships", "fleets", "visibility"]);
    }
    case "move_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const starId = resolveSystemToken(parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, getDefaultMoveDestination(starId).position);
      startMoveOrder(fleet, starId, position);
      return changedResult("Fleet move order started.", ["clock", "fleets", "visibility"]);
    }
    case "teleport_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const starId = resolveSystemToken(parsed.args[1], context);
      const { position } = parseSystemPosition(parsed.args, 2, systemCenterPosition());
      clearFleetMovementNow(fleet);
      fleet.currentStarId = starId;
      fleet.route = [starId];
      fleet.systemPosition = position;
      refreshDiscovery();
      return changedResult("Fleet teleported.", ["fleets", "visibility"]);
    }
    case "set_fleet_position": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const { position } = parseSystemPosition(parsed.args, 1, fleet.systemPosition);
      clearFleetMovementNow(fleet);
      fleet.systemPosition = position;
      return changedResult("Fleet position set.", ["fleets"]);
    }
    case "set_fleet_owner": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      fleet.ownerId = owner;
      for (const ship of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) ship.ownerId = owner;
      refreshDiscovery();
      return changedResult("Fleet owner set.", ["ships", "fleets", "visibility"]);
    }
    case "split_fleet": {
      const fleet = resolveFleetToken(parsed.args[0], context);
      const spec = parsed.args[1];
      const sourceShips = state.ships.filter((ship) => ship.fleetId === fleet.id);
      const movingIds = spec?.includes(",")
        ? new Set(splitList(spec))
        : new Set(sourceShips.slice(0, integerArg(spec, "split count", 1, sourceShips.length - 1)).map((ship) => ship.id));
      const newFleet = createFleet(fleet.ownerId, fleet.currentStarId, [], createRuntimeId("fleet", [fleet.ownerId, fleet.currentStarId]));
      newFleet.systemPosition = { ...fleet.systemPosition, x: fleet.systemPosition.x + 2 };
      state.fleets.push(newFleet);
      for (const ship of sourceShips) if (movingIds.has(ship.id)) ship.fleetId = newFleet.id;
      syncFleetMembership(state);
      return changedResult("Fleet split.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleet, newFleet]));
    }
    case "merge_fleets": {
      const target = resolveFleetToken(parsed.args[0], context);
      const sourceIds = splitList(parsed.args[1]);
      for (const ship of state.ships) {
        if (sourceIds.includes(ship.fleetId)) ship.fleetId = target.id;
      }
      state.fleets = state.fleets.filter((fleet) => !sourceIds.includes(fleet.id));
      syncFleetMembership(state);
      return changedResult("Fleets merged.", ["ships", "fleets", "visibility"]);
    }
    case "set_cooldowns": {
      const id = parsed.args[0] === "selected" ? context?.selectedFleetId : parsed.args[0];
      const value = parsed.args[1] === "ready" ? 0 : numberArg(parsed.args[1], "cooldown hours", 0);
      const fleet = id ? state.fleets.find((candidate) => candidate.id === id) : null;
      const ship = id ? state.ships.find((candidate) => candidate.id === id) : null;
      const starbase = id ? state.starbases.find((candidate) => candidate.id === id) : null;
      if (fleet) for (const fleetShip of state.ships.filter((candidate) => candidate.fleetId === fleet.id)) fleetShip.weaponCooldowns = Object.fromEntries(Object.keys(fleetShip.weaponCooldowns ?? {}).map((key) => [key, value]));
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
        fleet.currentTacticalOrder = { type: order, issuedAtYear: state.clock.year };
      } else if (order === "attack") {
        const targetId = parsed.args[2];
        const targetKind = state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
        fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: state.clock.year };
      } else if (order === "guard" || order === "move") {
        const { position } = parseSystemPosition(parsed.args, 2, fleet.systemPosition);
        fleet.currentTacticalOrder = order === "guard"
          ? { type: "guard", guardPosition: position, issuedAtYear: state.clock.year }
          : { type: "move", targetPosition: position, issuedAtYear: state.clock.year };
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
      fleetA.currentTacticalOrder = { type: "attack", targetId: fleetB.id, targetKind: "fleet", issuedAtYear: state.clock.year };
      fleetB.currentTacticalOrder = { type: "attack", targetId: fleetA.id, targetKind: "fleet", issuedAtYear: state.clock.year };
      refreshDiscovery();
      return changedResult("Duel started.", ["ships", "fleets", "visibility"], adminRowsForFleets([fleetA, fleetB]));
    }
    case "spawn_encounter": {
      const scenario = parsed.args[0];
      const starId = resolveSystemToken(parsed.args[1], context);
      const ownerA = resolvePerspectiveOwner(context, perspective);
      const ownerB = (ownerA + 1) % Math.max(1, state.factions.length);
      if (scenario === "artillery_vs_starbase") {
        const fleet = createAdminFleetWithShips(ownerA, starId, undefined, 6, { x: -48, y: SYSTEM_FLEET_Y, z: 0 });
        fleet.combatSettings.behavior = "artillery";
        state.starbases = state.starbases.filter((starbase) => starbase.starId !== starId);
        state.starbases.push(createAdminStarbase(starId, ownerB, "starbase", getSystemStarbasePosition()));
      } else if (scenario === "swarm_vs_line") {
        const a = createAdminFleetWithShips(ownerA, starId, undefined, 16, { x: -30, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ownerB, starId, undefined, 10, { x: 30, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.behavior = "swarm"; b.combatSettings.behavior = "line";
      } else if (scenario === "retreat_test") {
        const a = createAdminFleetWithShips(ownerA, starId, undefined, 4, { x: -22, y: SYSTEM_FLEET_Y, z: 0 });
        const b = createAdminFleetWithShips(ownerB, starId, undefined, 12, { x: 22, y: SYSTEM_FLEET_Y, z: 0 });
        a.combatSettings.retreatPolicy = "high"; b.combatSettings.behavior = "brawler";
      } else if (scenario === "orbit_defense") {
        state.starbases.push(createAdminStarbase(starId, ownerA, "starbase", getSystemStarbasePosition()));
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
      const targetKind = state.starbases.some((starbase) => starbase.id === targetId) ? "starbase" : "fleet";
      fleet.currentTacticalOrder = { type: "attack", targetId, targetKind, issuedAtYear: state.clock.year };
      return changedResult("Force attack order set.", ["fleets"]);
    }
    case "stop_combat": {
      const token = parsed.args[0] ?? "selected";
      const fleets = token === "all"
        ? state.fleets
        : token === "system"
          ? state.fleets.filter((fleet) => fleet.currentStarId === resolveCurrentStarId(context))
          : [resolveFleetToken(token, context)];
      for (const fleet of fleets) {
        fleet.currentTacticalOrder = null;
        fleet.currentTargetId = null;
        fleet.currentTargetKind = null;
        fleet.combatStatus = "idle";
      }
      return changedResult("Combat state cleared.", ["fleets"]);
    }
    case "set_weapon_cooldown": {
      const id = parsed.args[0];
      const mount = parsed.args[1] ?? "all";
      const value = parsed.args[2] === "ready" ? 0 : numberArg(parsed.args[2], "cooldown hours", 0);
      const ship = state.ships.find((candidate) => candidate.id === id);
      const starbase = state.starbases.find((candidate) => candidate.id === id);
      if (ship) {
        const mounts = calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts;
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
      const sourceFleet = state.fleets.find((fleet) => fleet.id === sourceId);
      const sourceStarbase = state.starbases.find((starbase) => starbase.id === sourceId);
      const targetFleet = state.fleets.find((fleet) => fleet.id === targetId);
      const targetStarbase = state.starbases.find((starbase) => starbase.id === targetId);
      const sourcePosition = sourceFleet?.systemPosition ?? sourceStarbase?.systemPosition;
      const targetPosition = targetFleet?.systemPosition ?? targetStarbase?.systemPosition;
      if (!sourcePosition || !targetPosition) throw new Error("Source or target not found.");
      const hitMode = name === "effect_test" ? "hit" : parsed.args[3] ?? "hit";
      state.recentCombatContacts.push({
        id: createRuntimeId("contact", [sourceId, targetId]),
        year: state.clock.year,
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
      state.recentCombatContacts = state.recentCombatContacts.slice(-RECENT_COMBAT_CONTACT_HISTORY);
      return changedResult("Test contact added.", ["combatContacts"]);
    }
    case "create_starbase": {
      const starId = resolveSystemToken(parsed.args[0], context);
      const owner = resolveOwnerToken(parsed.args[1], context, perspective);
      const level = (commandOption(parsed, "level") ?? parsed.args[2] ?? "outpost") as StarbaseLevel;
      if (!STARBASE_LEVEL_DEFINITIONS[level]) throw new Error("Invalid starbase level.");
      state.starbases = state.starbases.filter((starbase) => starbase.starId !== starId);
      const starbase = createAdminStarbase(starId, owner, level);
      state.starbases.push(starbase);
      state.starOwnership[starId] = owner;
      syncSystemOwnershipFromStarbases();
      recalculatePlanetEconomies();
      refreshFactionEconomyDeltas();
      refreshDiscovery();
      return changedResult("Starbase created.", ["starbases", "planetStates", "factionEconomies", "visibility"], [{ id: starbase.id, owner, system: starId, level }]);
    }
    case "delete_starbase": {
      const starbase = resolveStarbaseToken(parsed.args[0], context);
      state.starbases = state.starbases.filter((candidate) => candidate.id !== starbase.id);
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
  const techState = getFactionTechnology(state, factionId);
  if (!techState) return reject(socket, "Faction technology state unavailable.");
  if (isTechnologyCompleted(techState, techId)) return reject(socket, `${tech.name} is already completed.`);
  if (!isTechnologyAvailable(tech, techState)) {
    const missing = getMissingPrerequisites(tech, techState)
      .map((id) => TECHNOLOGY_BY_ID[id]?.name ?? id)
      .join(", ");
    return reject(socket, missing ? `Requires ${missing}.` : "Technology is not available.");
  }
  techState.activeTechId = techId;
  hasDirtyState = true;
  accept(socket, `Research focus set to ${tech.name}.`);
  broadcastUpdates(["technologies"]);
}

function isGovernmentLawOptionUnlocked(factionId: number, option: GovernmentLawOption): boolean {
  if (!option.requiresTechId) return true;
  const techState = getFactionTechnology(state, factionId);
  return Boolean(techState && isTechnologyCompleted(techState, option.requiresTechId));
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
  let government = state.governments.find((candidate) => candidate.factionId === factionId);
  if (!government) {
    government = createInitialGovernmentState(factionId);
    state.governments.push(government);
  }
  if (government.selectedLawOptionIds[lawId] === option.id) {
    return accept(socket, `${law.name} already uses ${option.name}.`);
  }
  const previousRights = JSON.stringify(getFactionSpeciesRightsState(state, factionId));
  government.selectedLawOptionIds[lawId] = option.id;
  state.speciesRights = normalizeSpeciesRightsForFactions(state);
  const rightsChanged = previousRights !== JSON.stringify(getFactionSpeciesRightsState(state, factionId));
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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
  const species = state.species.find((candidate) => candidate.id === speciesId);
  if (!species) return reject(socket, "Species not found.");
  if (!getEmpireSpeciesIds(state, factionId).includes(species.id)) {
    return reject(socket, "That species does not live in your empire.");
  }

  let rightsState = state.speciesRights.find((candidate) => candidate.factionId === factionId);
  if (!rightsState) {
    rightsState = createDefaultSpeciesRightsState(factionId, state.species.map((entry) => entry.id));
    state.speciesRights.push(rightsState);
  }
  const current = getSpeciesRightsForFaction(state, factionId, species.id);
  const requested = normalizeSpeciesRights({ ...current, ...rightsInput });
  const normalized = normalizeSpeciesRightsForLaws(requested, getSpeciesLawSelections(state, factionId));
  if (JSON.stringify(current) === JSON.stringify(normalized)) {
    return accept(socket, `${species.name} rights already match current law.`);
  }
  rightsState.rightsBySpeciesId = {
    ...rightsState.rightsBySpeciesId,
    [species.id]: normalized,
  };
  state.speciesRights = normalizeSpeciesRightsForFactions(state);
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
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
  const leader = state.leaders.find((candidate) => candidate.id === leaderId);
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
    const planetState = state.planetStates.find((candidate) => candidate.id === assignment.targetId);
    if (!planetState || !planetState.isHabited) {
      reject(socket, "Planet not found.");
      return false;
    }
    if ((state.starOwnership[planetState.starId] ?? -1) !== factionId) {
      reject(socket, "You do not own that planet.");
      return false;
    }
    return true;
  }
  const fleet = state.fleets.find((candidate) => candidate.id === assignment.targetId);
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
  hasDirtyState = true;
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
  leader.recruitedAtYear = state.clock.year;
  leader.assignment = null;
  leader.createdAtYear = Math.min(leader.createdAtYear, state.clock.year);
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
    for (const candidate of state.leaders) {
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
    leader.recruitedAtYear = state.clock.year;
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
  leader.diedAtYear = state.clock.year;
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
  return state.factions.find((faction) => faction.id === factionId)?.name ?? `Faction ${factionId}`;
}

function getDiplomacyCommandFaction(socket: WebSocket, perspective: GalaxyPerspective): number | null {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) {
    reject(socket, "Observer mode is read-only.");
    return null;
  }
  if (!state.factions.some((faction) => faction.id === factionId)) {
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
  const target = state.factions.find((faction) => faction.id === targetFactionId);
  if (!target) {
    reject(socket, "Country not found.");
    return null;
  }
  return target;
}

function normalizeDiplomacyAfterMutation(): void {
  const normalized = normalizeDiplomacyState(
    state.diplomacy,
    state.factions.map((faction) => faction.id),
  );
  state.diplomacy = normalized.state;
}

function commitDiplomacyChange(socket: WebSocket, message: string, changed: ServerUpdateField[] = ["diplomacy"]): void {
  normalizeDiplomacyAfterMutation();
  hasDirtyState = true;
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
  state.diplomacy.chatMessages.push({
    id: createRuntimeId("diplomacy-message", [factionId, target.id]),
    fromFactionId: factionId,
    toFactionId: target.id,
    body: normalizedBody,
    createdAtYear: state.clock.year,
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
  setBorderPolicy(state.diplomacy, factionId, target.id, normalizedPolicy);
  commitDiplomacyChange(socket, `Borders ${normalizedPolicy === "open" ? "opened" : "closed"} to ${target.name}.`);
}

function handleDeclareWar(socket: WebSocket, perspective: GalaxyPerspective, targetFactionId: number): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const target = getDiplomacyTarget(socket, factionId, Number(targetFactionId));
  if (!target) return;
  if (areFactionsAtWar(state.diplomacy, factionId, target.id)) {
    return reject(socket, `You are already at war with ${target.name}.`);
  }
  state.diplomacy.wars.push({
    id: createRuntimeId("war", [factionId, target.id]),
    attackerFactionId: factionId,
    defenderFactionId: target.id,
    startedAtYear: state.clock.year,
    endedAtYear: null,
    preWarOwnership: toOwnershipEntries(state.starOwnership),
  });
  commitDiplomacyChange(
    socket,
    `War declared on ${target.name}.`,
    ["diplomacy", "market", "fleets", "starbases", "combatContacts"],
  );
}

function getPendingDiplomacyProposal(proposalId: string): DiplomacyProposal | null {
  return state.diplomacy.proposals.find((proposal) => (
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
  const startedAtYear = state.clock.year;
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
  const replacements = state.diplomacy.treaties.filter((treaty) => {
    if (Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return false;
    if (!getActiveTreatiesBetween(state.diplomacy, nextTreaty.factionIds[0], nextTreaty.factionIds[1]).includes(treaty)) return false;
    if (requestedReplacesTreatyId && treaty.id === requestedReplacesTreatyId) return true;
    return treaty.articleIds.some((articleId) => nextTreaty.articleIds.includes(articleId));
  });
  for (const treaty of replacements) {
    treaty.cancelledAtYear = state.clock.year;
    treaty.earlyCancelled = state.clock.year < treaty.minimumEndYear;
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
    const treaty = state.diplomacy.treaties.find((candidate) => candidate.id === replacesTreatyId);
    if (
      !treaty
      || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)
      || !getActiveTreatiesBetween(state.diplomacy, factionId, target.id).includes(treaty)
    ) {
      return reject(socket, "Treaty to renegotiate is not active.");
    }
  }
  state.diplomacy.proposals.push({
    id: createRuntimeId("treaty-proposal", [factionId, target.id]),
    kind: "treaty",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedArticleIds,
    durationYears: normalizedDuration,
    peaceTerms: null,
    status: "pending",
    createdAtYear: state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: replacesTreatyId ?? null,
  });
  commitDiplomacyChange(socket, `Treaty proposed to ${target.name}.`);
}

function cancelOtherPendingPeaceProposals(war: DiplomacyWar, acceptedProposalId: string): void {
  for (const proposal of state.diplomacy.proposals) {
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
      proposal.resolvedAtYear = state.clock.year;
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
    const starbase = state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
    if (!starbase || starbase.ownerId !== transfer.fromFactionId) continue;
    starbase.ownerId = transfer.toFactionId;
  }

  war.endedAtYear = state.clock.year;
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
    state.diplomacy.treaties.push(treaty);
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
    proposal.resolvedAtYear = state.clock.year;
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
    state.diplomacy.treaties.push(treaty);
  } else {
    const war = getActiveWar(state.diplomacy, proposal.fromFactionId, proposal.toFactionId);
    if (!war) return reject(socket, "There is no active war to end.");
    changed = applyPeaceTerms(war, proposal, factionId);
  }

  proposal.status = "accepted";
  proposal.resolvedAtYear = state.clock.year;
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
  proposal.resolvedAtYear = state.clock.year;
  proposal.responseByFactionId = factionId;
  commitDiplomacyChange(socket, "Proposal cancelled.");
}

function handleCancelTreaty(socket: WebSocket, perspective: GalaxyPerspective, treatyId: string): void {
  const factionId = getDiplomacyCommandFaction(socket, perspective);
  if (factionId === null) return;
  const treaty = state.diplomacy.treaties.find((candidate) => candidate.id === String(treatyId ?? ""));
  if (!treaty || Number.isFinite(treaty.cancelledAtYear ?? Number.NaN)) return reject(socket, "Active treaty not found.");
  if (treaty.factionIds[0] !== factionId && treaty.factionIds[1] !== factionId) {
    return reject(socket, "You are not part of this treaty.");
  }
  const partnerId = treaty.factionIds[0] === factionId ? treaty.factionIds[1] : treaty.factionIds[0];
  const war = getActiveWar(state.diplomacy, factionId, partnerId);
  treaty.cancelledAtYear = state.clock.year;
  treaty.earlyCancelled = state.clock.year < treaty.minimumEndYear;
  treaty.cancellationReason = war?.defenderFactionId === factionId ? "defenderWarCancel" : treaty.earlyCancelled ? "earlyCancellation" : "cancelled";
  commitDiplomacyChange(socket, "Treaty cancelled.", ["diplomacy", "market"]);
}

function isValidPeaceTransferTerm(transfer: DiplomacySystemTransferTerm, war: DiplomacyWar): boolean {
  const participants = new Set([war.attackerFactionId, war.defenderFactionId]);
  if (!participants.has(transfer.fromFactionId) || !participants.has(transfer.toFactionId)) return false;
  if (transfer.fromFactionId === transfer.toFactionId) return false;
  const starbase = state.starbases.find((candidate) => candidate.id === transfer.starbaseId);
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
    if (!state.starbases.some((starbase) => starbase.id === transfer.starbaseId)) {
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
  const war = getActiveWar(state.diplomacy, factionId, target.id);
  if (!war) return reject(socket, `You are not at war with ${target.name}.`);
  const normalizedTerms = validatePeaceTerms(socket, war, terms);
  if (!normalizedTerms) return;
  const existing = state.diplomacy.proposals.some((proposal) => (
    proposal.kind === "peace"
    && proposal.status === "pending"
    && (
      (proposal.fromFactionId === factionId && proposal.toFactionId === target.id)
      || (proposal.fromFactionId === target.id && proposal.toFactionId === factionId)
    )
  ));
  if (existing) return reject(socket, "A peace proposal is already pending.");
  state.diplomacy.proposals.push({
    id: createRuntimeId("peace-proposal", [factionId, target.id]),
    kind: "peace",
    fromFactionId: factionId,
    toFactionId: target.id,
    articleIds: normalizedTerms.enforcedArticleIds,
    durationYears: normalizedTerms.enforcedDurationYears,
    peaceTerms: normalizedTerms,
    status: "pending",
    createdAtYear: state.clock.year,
    resolvedAtYear: null,
    responseByFactionId: null,
    replacesTreatyId: null,
  });
  commitDiplomacyChange(socket, `Peace proposed to ${target.name}.`);
}

function handleCommand(session: ClientSession, command: ClientCommand): void {
  if (command.type === "join") {
    if (!session.sentInitialSnapshot) {
      sendEvent(session.socket, createSnapshot(session.perspective));
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
    state.clock.tickSpeedSeconds = DEFAULT_TICK_SPEED_SECONDS;
    state.clock.tickSizeDays = Math.max(0.000001, multiplier / 24);
    state.clock.paused = multiplier <= 0;
    syncClockSpeedFields();
    state.clock.syncedAtMs = Date.now();
    hasDirtyState = true;
    accept(session.socket, `Speed set to ${state.clock.speedMultiplier}x.`);
    broadcastUpdates(["clock"]);
  }
}

function touchMembershipNames(): void {
  let changed = false;
  let speciesChanged = false;
  for (const membership of authStore.listGameMemberships(game.id)) {
    const faction = state.factions.find((candidate) => candidate.id === membership.factionId);
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
      const index = state.species.findIndex((species) => species.id === nextSpecies.id);
      const current = index >= 0 ? state.species[index] : null;
      if (JSON.stringify(current) !== JSON.stringify(nextSpecies)) {
        if (index >= 0) {
          state.species[index] = nextSpecies;
        } else {
          state.species.push(nextSpecies);
        }
        speciesChanged = true;
        changed = true;
      }
    }
  }
  if (!changed) return;
  const speciesPopulationChanged = assignFoundingSpeciesToOwnedPops(state);
  if (speciesChanged || speciesPopulationChanged) {
    state.speciesRights = normalizeSpeciesRightsForFactions(state);
    recalculatePlanetEconomies();
    refreshFactionEconomyDeltas();
  }
  hasDirtyState = true;
  broadcastUpdates(speciesChanged || speciesPopulationChanged ? ["visibility", "species", "planetStates", "factionEconomies"] : ["visibility"]);
}

state = await loadState();
touchMembershipNames();
advanceState(Date.now());
await saveState(state);

function attachClient(socket: WebSocket, account: AuthAccount, perspective: GalaxyPerspective): void {
  const session: ClientSession = {
    socket,
    account,
    perspective,
    detailSubscriptions: new Map(),
    sentInitialSnapshot: false,
  };
  clients.add(session);
  touchMembershipNames();
  try {
    authStore.recordGameEnter(account, game.id);
  } catch (error) {
    console.error(`[GameServer] Failed to record game enter for ${game.id}`, error);
  }
  sendEvent(socket, { type: "serverInfo", message: `Connected to StellarFronts game ${game.name}.` });
  // Runtime creation can outlive the client's first WebSocket message.
  sendEvent(socket, createSnapshot(perspective));
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
    clients.delete(session);
  });
}

function tick(now: number): void {
  const changed = advanceState(now);
  broadcastUpdates(Array.from(changed));
  flushPlanetDetailRefreshes();
  if (hasDirtyState && now - lastSaveAt >= SAVE_INTERVAL_MS) {
    void saveState().catch((error) => console.error(`[GameServer] Failed to save state for ${game.id}`, error));
  }
}

function getStats(): DevGameRuntimeRow {
  const activeAccounts = Array.from(new Set(
    Array.from(clients).map((client) => client.account.username),
  )).sort((a, b) => a.localeCompare(b));
  return {
    id: game.id,
    name: game.name,
    seed: game.seed,
    countryCapacity: game.countryCapacity,
    controlledCountries: authStore.listGameMemberships(game.id).length,
    createdAt: game.createdAt,
    online: true,
    activeConnections: clients.size,
    activeAccounts,
    gameYear: state.clock.year,
    paused: state.clock.paused,
    speedMultiplier: state.clock.speedMultiplier,
    starCount: state.stars.length,
    factionCount: state.factions.length,
    fleetCount: state.fleets.length,
    shipCount: state.ships.length,
    starbaseCount: state.starbases.length,
    habitedPlanetCount: state.planetStates.filter((planetState) => planetState.isHabited).length,
    lastHeartbeatAt: Date.now(),
  };
}

async function dispose(message = "Game runtime stopped.", deleteState = false): Promise<void> {
  for (const client of clients) {
    sendEvent(client.socket, { type: "serverInfo", message });
    client.socket.close(1001, message);
  }
  clients.clear();
  if (deleteState) {
    await rm(getGameStateDirectory(game.id), { recursive: true, force: true });
    return;
  }
  await saveState(state);
}

return {
  game,
  attachClient,
  touchMembershipNames,
  tick,
  save: () => saveState(state),
  dispose,
  getStats,
};
}

// Parse comma-separated allowed WebSocket origins from environment
// Default: localhost dev environments
const DEFAULT_WS_ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function parseWsAllowedOrigins(): Set<string> {
  const envOrigins = process.env.WS_ALLOWED_ORIGINS;
  if (envOrigins) {
    return new Set(envOrigins.split(',').map((o) => o.trim()).filter(Boolean));
  }
  return new Set(DEFAULT_WS_ALLOWED_ORIGINS);
}

const wsAllowedOrigins = parseWsAllowedOrigins();

function isWebSocketOriginAllowed(origin: string | undefined): boolean {
  // Allow requests without Origin header (for CLI/server-side tests)
  if (!origin) return true;
  return wsAllowedOrigins.has(origin);
}

const runtimes = new Map<string, GameRuntime>();
const runtimeLoads = new Map<string, Promise<GameRuntime>>();
let lastRuntimeStatsAt = 0;
let lastRuntimeSyncAt = 0;
let runtimeSyncing = false;

function sendServerEvent(socket: WebSocket, event: ServerEvent): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(event));
}

async function ensureRuntime(game: StoredGame): Promise<GameRuntime> {
  const current = runtimes.get(game.id);
  if (current) return current;
  const loading = runtimeLoads.get(game.id);
  if (loading) return loading;

  const load = createGameRuntime(game)
    .then((runtime) => {
      runtimes.set(game.id, runtime);
      runtimeLoads.delete(game.id);
      return runtime;
    })
    .catch((error) => {
      runtimeLoads.delete(game.id);
      throw error;
    });
  runtimeLoads.set(game.id, load);
  return load;
}

async function syncGameRuntimes(): Promise<void> {
  if (runtimeSyncing) return;
  runtimeSyncing = true;
  try {
    const games = authStore.listGames();
    const gameById = new Map(games.map((game) => [game.id, game]));
    await Promise.all(games.map((game) => ensureRuntime(game)));
    await Promise.all(Array.from(runtimes.entries()).map(async ([gameId, runtime]) => {
      if (gameById.has(gameId)) return;
      runtimes.delete(gameId);
      await runtime.dispose("This game was deleted.", true);
    }));
  } finally {
    lastRuntimeSyncAt = Date.now();
    runtimeSyncing = false;
  }
}

function buildRuntimeStats(): DevGameRuntimeStats {
  const games = Array.from(runtimes.values()).map((runtime) => runtime.getStats());
  const activeAccounts = Array.from(new Set(games.flatMap((game) => game.activeAccounts)))
    .sort((a, b) => a.localeCompare(b));
  return {
    online: true,
    activeConnections: games.reduce((sum, game) => sum + game.activeConnections, 0),
    activeAccounts,
    serverStartedAt: GAME_SERVER_STARTED_AT,
    lastHeartbeatAt: Date.now(),
    gameYear: games.length === 1 ? games[0].gameYear : null,
    paused: games.length > 0 && games.every((game) => game.paused),
    speedMultiplier: games.length === 1 ? games[0].speedMultiplier : 0,
    starCount: games.reduce((sum, game) => sum + game.starCount, 0),
    factionCount: games.reduce((sum, game) => sum + game.factionCount, 0),
    fleetCount: games.reduce((sum, game) => sum + game.fleetCount, 0),
    shipCount: games.reduce((sum, game) => sum + game.shipCount, 0),
    starbaseCount: games.reduce((sum, game) => sum + game.starbaseCount, 0),
    planetCount: 0,
    habitedPlanetCount: games.reduce((sum, game) => sum + game.habitedPlanetCount, 0),
    combatContactCount: 0,
    gameCount: games.length,
    games,
  };
}

function publishRuntimeStats(force = false): void {
  const now = Date.now();
  if (!force && now - lastRuntimeStatsAt < RUNTIME_STATS_INTERVAL_MS) return;
  lastRuntimeStatsAt = now;
  try {
    authStore.setGameRuntimeStats(buildRuntimeStats());
  } catch (error) {
    console.error("[GameServer] Failed to publish runtime stats", error);
  }
}

await syncGameRuntimes();
publishRuntimeStats(true);

async function handleConnection(socket: WebSocket, request: Parameters<NonNullable<Parameters<WebSocketServer["on"]>[1]>>[1]): Promise<void> {
  const origin = request.headers.origin;
  if (!isWebSocketOriginAllowed(origin)) {
    console.warn(`[GameServer] Rejected WebSocket connection from disallowed origin: ${origin}`);
    socket.close(1008, "Origin not allowed");
    return;
  }

  const token = parseSessionTokenFromCookie(request.headers.cookie);
  const account = token ? authStore.getAccountFromSessionToken(token) : null;
  if (!account) {
    sendServerEvent(socket, { type: "serverInfo", message: "Authentication required." });
    socket.close();
    return;
  }

  const url = new URL(request.url ?? "/", `ws://${request.headers.host ?? "localhost"}`);
  const gameId = url.searchParams.get("gameId") ?? "";
  const game = authStore.getGameById(gameId);
  const perspective = game ? authStore.getGamePerspective(account, game.id) : null;
  if (!game) {
    sendServerEvent(socket, { type: "serverInfo", message: "Game not found." });
    socket.close();
    return;
  }
  if (!perspective) {
    sendServerEvent(socket, { type: "serverInfo", message: "Join this game before entering it." });
    socket.close();
    return;
  }

  const runtime = await ensureRuntime(game);
  runtime.attachClient(socket, account, perspective);
  publishRuntimeStats(true);
}

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", (socket, request) => {
  void handleConnection(socket, request).catch((error) => {
    console.error("[GameServer] Failed to accept connection", error);
    sendServerEvent(socket, { type: "serverInfo", message: "Could not enter game." });
    socket.close();
  });
});

setInterval(() => {
  const now = Date.now();
  for (const runtime of runtimes.values()) runtime.tick(now);
  publishRuntimeStats();
  if (now - lastRuntimeSyncAt >= RUNTIME_CATALOG_SYNC_INTERVAL_MS) {
    void syncGameRuntimes().then(() => publishRuntimeStats(true))
      .catch((error) => console.error("[GameServer] Failed to sync game runtimes", error));
  }
}, SERVER_TICK_INTERVAL_MS);

console.log(`[GameServer] Listening on ws://localhost:${PORT}`);


