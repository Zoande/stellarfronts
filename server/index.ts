import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { GALAXY_MAP } from "../src/data/GalaxyMap";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../src/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../src/data/Factions";
import {
  applyPlanetStatesToStars,
  buildPlanetStatesFromStars,
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
  getQueuedDistrictCount,
  hasQueuedBuildingTarget,
  isBuildingCompatible,
  progressPlanetConstructionQueue,
  recalculatePlanetStateEconomy,
  URBAN_SUB_DISTRICT_KINDS,
} from "../src/data/Economy";
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
import type { StarbaseBuildingKind, StarbaseLevel, StarbaseShipKind, WeaponMountDefinition } from "../src/data/Starbase";
import {
  calculateShipDesignStats,
  createDefaultShipDesign,
  isKnownShipKind,
  normalizeShipDesign,
  SHIP_HULL_DEFINITIONS,
} from "../src/data/ShipDesigns";
import type { ShipDesign } from "../src/data/ShipDesigns";
import type {
  BuildingKind,
  BuildingSlotArea,
  DistrictKind,
  FactionEconomyState,
  PlanetState,
  ResourceCounts,
  UrbanSubDistrictKind,
} from "../src/data/Economy";
import { buildHyperlaneAdjacency, buildHyperlanePairs } from "../src/data/Hyperlanes";
import {
  RANGE_BAND_INDEX,
  type BattleGroupBehavior,
  type BattleGroupChaseSetting,
  type BattleGroupOrderType,
  type CombatStance,
  type CombatTargetKind,
  type FleetBehavior,
  type FleetChasePolicy,
  type FleetRetreatPolicy,
  type FleetTacticalOrderType,
  type RangeBand,
} from "../src/game/CombatTypes";
import type {
  BattleGroupConfig,
  BattleGroupProtectedTarget,
  BattleGroupRetreatDestination,
  BattleGroupRetreatPolicy,
  BattleGroupTacticalOrder,
  BattleHostilityEdge,
  BattleParticipant,
  ClientCommand,
  CombatGroup,
  BattleSide,
  BattleZone,
  FactionState,
  FleetFormation,
  GameClock,
  GameUpdate,
  GameSnapshot,
  ServerBattle,
  ServerBattleAction,
  ServerBattleRound,
  ServerBattleShipState,
  ServerBattleStarbaseState,
  ServerBattleWeaponEffect,
  ServerFleet,
  FleetRetreatOrder,
  FleetMovementPlan,
  FleetMovementSegment,
  FleetOrbitTarget,
  FleetOrderType,
  FleetCombatSettings,
  FleetRetreatState,
  FleetTacticalOrder,
  ServerEvent,
  ServerShip,
  ServerStarbase,
  ServerCombatContact,
  ServerUpdateField,
  ShipTransitPhase,
} from "../src/game/GameProtocol";
import {
  addLayerDamage,
  applyWeaponDamage,
  combatEngagementProfilesCanInteract,
  createEmptyBattleStats,
  createEmptyLayerDamage,
  createEmptyParticipantStats,
  ensureOwnerStats,
  ensureParticipantStats,
  ensureWeaponStats,
  getCombatGroupMinSize,
  getCombatGroupMaxSize,
  getLegacyWeaponRange,
  getPreferredRangeBand,
  getWeaponId,
  getWeaponName,
  getWeaponCooldownRounds,
  getWeaponMaxSystemRange,
  getWeaponMinSystemRange,
  rangeBandForSystemDistance,
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
import type { AuthAccount } from "../src/auth/types";
import { authStore, getPerspectiveFromAccount, parseSessionTokenFromCookie } from "./auth-store";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "state", "game-state.json");
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
const DISCOVERY_JUMPS = 2;
const DEPART_DURATION_MS = 20_000;
const JUMP_DURATION_MS = 10_000;
const ARRIVE_DURATION_MS = 30_000;
const BUILD_DURATION_MS = 180_000;
const SAVE_INTERVAL_MS = 5_000;
const SERVER_TICK_INTERVAL_MS = REAL_MS_PER_GAME_HOUR;
const DEFAULT_SHIP_SPEED = STARBASE_SHIP_DEFINITIONS.corvette.speed;
const BATTLE_ROUNDS_HISTORY = 4;
const SHIELD_REGEN_DELAY_ROUNDS = 2;
const SHIELD_REGEN_FRACTION = 0.25;
const RETREAT_HULL_RATIO = 0.3;
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
const BATTLE_GROUP_SPEED_UNITS_PER_DAY = 7.2;
const DEFAULT_BATTLE_GROUP_LEASH_RADIUS = 42;
const DEFENDER_BATTLE_GROUP_LEASH_RADIUS = 36;
const RETREAT_ESCAPE_DISTANCE = 78;
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

interface GameBattle extends ServerBattle {
  retreatingFleetIds: string[];
  fleetStartingHull: Record<string, number>;
  participantShipIds: string[];
  resolvedAtRound?: number;
}

interface GameState {
  schemaVersion: 13;
  stars: StarData[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  shipDesigns: ShipDesign[];
  ships: GameShip[];
  fleets: GameFleet[];
  battles: GameBattle[];
  recentCombatContacts: ServerCombatContact[];
  discoveredByFaction: Record<string, number[]>;
  lastKnownOwnershipByFaction: Record<string, number[]>;
  clock: GameClock & { lastUpdatedAt: number; lastProcessedPopulationWeek: number };
}

interface ClientSession {
  socket: WebSocket;
  account: AuthAccount;
  perspective: GalaxyPerspective;
  openPlanetId?: string | null;
}

const clients = new Set<ClientSession>();
const pendingPlanetDetailRefreshes = new Set<string>();
let state: GameState;
let lastSaveAt = 0;
let hasDirtyState = false;
let runtimeIdCounter = 0;

const FLEET_FORMATIONS: FleetFormation[] = ["line", "vanguard", "echelon", "defensive"];
const COMBAT_STANCES: CombatStance[] = ["passive", "evade", "holdPosition", "guardArea", "defendSystem", "aggressive", "hunt"];
const FLEET_BEHAVIORS: FleetBehavior[] = ["artillery", "line", "brawler", "swarm", "defender"];
const FLEET_CHASE_POLICIES: FleetChasePolicy[] = ["none", "system", "friendlySystems", "neutralSystems", "enemySystems"];
const FLEET_RETREAT_POLICIES: FleetRetreatPolicy[] = ["none", "low", "medium", "high"];
const FLEET_TACTICAL_ORDER_TYPES: FleetTacticalOrderType[] = ["move", "attack", "hold", "guard", "retreat"];
const BATTLE_GROUP_BEHAVIORS: BattleGroupBehavior[] = ["screen", "brawler", "line", "artillery", "defender"];
const BATTLE_GROUP_CHASE_SETTINGS: BattleGroupChaseSetting[] = [
  "none",
  "system",
  "friendlySystems",
  "neutralSystems",
  "enemySystems",
];
const BATTLE_GROUP_ORDER_TYPES: BattleGroupOrderType[] = ["move", "attack", "hold", "protect", "retreat"];

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

function isBattleGroupBehavior(value: unknown): value is BattleGroupBehavior {
  return typeof value === "string" && BATTLE_GROUP_BEHAVIORS.includes(value as BattleGroupBehavior);
}

function isBattleGroupChaseSetting(value: unknown): value is BattleGroupChaseSetting {
  return typeof value === "string" && BATTLE_GROUP_CHASE_SETTINGS.includes(value as BattleGroupChaseSetting);
}

function isBattleGroupOrderType(value: unknown): value is BattleGroupOrderType {
  return typeof value === "string" && BATTLE_GROUP_ORDER_TYPES.includes(value as BattleGroupOrderType);
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

function recalculatePlanetEconomies(nextState = state): void {
  nextState.planetStates = nextState.planetStates.map((planetState) => (
    recalculatePlanetStateEconomy(planetState, getPlanetDistrictLimitsFromState(nextState, planetState))
  ));
  applyPlanetStatesToStars(nextState.stars, nextState.planetStates);
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
  return delta;
}

function refreshFactionEconomyDeltas(nextState = state): void {
  for (const economy of nextState.factionEconomies) {
    economy.monthlyDelta = calculateFactionMonthlyDelta(nextState, economy.factionId);
  }
}

function queuePlanetDetailRefresh(planetId: string): void {
  pendingPlanetDetailRefreshes.add(planetId);
}

function flushPlanetDetailRefreshes(): void {
  if (pendingPlanetDetailRefreshes.size === 0) return;
  const planetIds = new Set(pendingPlanetDetailRefreshes);
  pendingPlanetDetailRefreshes.clear();
  for (const client of clients) {
    const planetId = client.openPlanetId;
    if (!planetId || !planetIds.has(planetId)) continue;
    sendPlanetDetails(client.socket, client.perspective, planetId);
  }
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
    systemPosition: starbase.systemPosition ?? getSystemStarbasePosition(),
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
        .map((item) => ({
          ...item,
          remainingDays: Math.max(0, Number(item.remainingDays) || 0),
          totalDays: Math.max(1, Number(item.totalDays) || 1),
          alloyUpkeepPerDay: Math.max(0, Number(item.alloyUpkeepPerDay) || 0),
          crewDemand: Math.max(0, Number(item.crewDemand) || 0),
        }))
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
    const explicit = shipDesigns.find((design) => (
      design.id === designId
      && design.ownerId === ownerId
      && design.shipKind === shipKind
      && (includeDecommissioned || design.status === "active")
    ));
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
    battleGroups: [],
    alertMode: false,
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

function normalizeBattleGroupRetreatPolicy(value: Partial<BattleGroupRetreatPolicy> | null | undefined): BattleGroupRetreatPolicy {
  const mode = value?.mode === "none" ? "none" : "hpPercent";
  if (mode === "none") return { mode: "none", thresholdPercent: null };
  const threshold = Number(value?.thresholdPercent);
  return {
    mode: "hpPercent",
    thresholdPercent: clamp(Number.isFinite(threshold) ? threshold : 30, 1, 99),
  };
}

function normalizeBattleGroupRetreatDestination(
  value: Partial<BattleGroupRetreatDestination> | null | undefined,
): BattleGroupRetreatDestination | null {
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

function normalizeBattleGroupProtectedTarget(
  value: Partial<BattleGroupProtectedTarget> | null | undefined,
): BattleGroupProtectedTarget | null {
  if (!value) return null;
  if (value.kind !== "battleGroup" && value.kind !== "fleet" && value.kind !== "starbase" && value.kind !== "planet" && value.kind !== "position") {
    return null;
  }
  return {
    kind: value.kind,
    id: typeof value.id === "string" ? value.id : null,
    position: normalizeSystemPositionValue(value.position),
  };
}

function normalizeBattleGroupOrder(
  order: Partial<BattleGroupTacticalOrder> | null | undefined,
): BattleGroupTacticalOrder | null {
  if (!order || !isBattleGroupOrderType(order.type)) return null;
  return {
    type: order.type,
    targetGroupId: typeof order.targetGroupId === "string" ? order.targetGroupId : null,
    targetObjectId: typeof order.targetObjectId === "string" ? order.targetObjectId : null,
    targetPosition: normalizeSystemPositionValue(order.targetPosition),
    protectedTarget: normalizeBattleGroupProtectedTarget(order.protectedTarget),
    issuedAtYear: Number.isFinite(order.issuedAtYear) ? Number(order.issuedAtYear) : null,
  };
}

function createDefaultFleetCombatSettings(
  overrides: Partial<FleetCombatSettings> | null | undefined = null,
): FleetCombatSettings {
  const legacy = overrides as Partial<FleetCombatSettings> & {
    defaultBehavior?: BattleGroupBehavior;
    defaultChaseSetting?: BattleGroupChaseSetting;
    retreatOrder?: FleetRetreatOrder;
  } | null | undefined;
  const legacyBehavior: BattleGroupBehavior = legacy?.defaultBehavior === "artillery"
    ? "artillery"
    : legacy?.defaultBehavior === "brawler"
      ? "brawler"
      : legacy?.defaultBehavior === "defender"
        ? "defender"
        : "line";
  return {
    behavior: isFleetBehavior(overrides?.behavior) ? overrides!.behavior! : legacyBehavior,
    chasePolicy: isFleetChasePolicy(overrides?.chasePolicy)
      ? overrides!.chasePolicy!
      : (isFleetChasePolicy(legacy?.defaultChaseSetting) ? legacy!.defaultChaseSetting! : "system"),
    retreatPolicy: legacy?.retreatOrder === "retreat"
      ? "medium"
      : (isFleetRetreatPolicy(overrides?.retreatPolicy) ? overrides!.retreatPolicy! : "medium"),
    retreatDestination: normalizeBattleGroupRetreatDestination(overrides?.retreatDestination),
    retreatOrder: "none",
    defaultBehavior: legacyBehavior,
    defaultChaseSetting: isFleetChasePolicy(overrides?.chasePolicy)
      ? overrides!.chasePolicy!
      : (isFleetChasePolicy(legacy?.defaultChaseSetting) ? legacy!.defaultChaseSetting! : "system"),
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

function getDefaultChaseForBehavior(behavior: BattleGroupBehavior): BattleGroupChaseSetting {
  if (behavior === "artillery" || behavior === "defender" || behavior === "line") return "none";
  return "system";
}

function getDefaultRetreatPolicyForBehavior(behavior: BattleGroupBehavior): BattleGroupRetreatPolicy {
  if (behavior === "artillery") return { mode: "hpPercent", thresholdPercent: 70 };
  if (behavior === "line") return { mode: "hpPercent", thresholdPercent: 40 };
  if (behavior === "screen") return { mode: "hpPercent", thresholdPercent: 20 };
  if (behavior === "defender") return { mode: "hpPercent", thresholdPercent: 35 };
  return { mode: "hpPercent", thresholdPercent: 30 };
}

function getDefaultBehaviorForMounts(mounts: WeaponMountDefinition[]): BattleGroupBehavior {
  const preferred = getPreferredRangeBand(mounts);
  if (preferred === "long" || preferred === "extreme") return "artillery";
  if (preferred === "pointBlank" || preferred === "close") return "brawler";
  return "line";
}

function normalizeBattleGroupConfig(
  value: Partial<BattleGroupConfig> | null | undefined,
  fleet: Pick<GameFleet, "id" | "systemPosition" | "combatSettings">,
  fallbackId: string,
  fallbackName: string,
  fallbackBehavior: BattleGroupBehavior,
  validShipIds: Set<string>,
): BattleGroupConfig {
  const behavior = isBattleGroupBehavior(value?.behavior)
    ? value!.behavior!
    : (fallbackBehavior ?? fleet.combatSettings.defaultBehavior);
  const origin = normalizeSystemPositionValue(value?.originPosition);
  const deployed = normalizeSystemPositionValue(value?.deployedPosition, origin ?? fleet.systemPosition ?? systemCenterPosition());
  const leash = Number(value?.leashRadius);
  return {
    id: typeof value?.id === "string" && value.id.trim().length > 0 ? value.id : fallbackId,
    name: typeof value?.name === "string" && value.name.trim().length > 0
      ? value.name.trim().slice(0, 48)
      : fallbackName,
    shipIds: Array.isArray(value?.shipIds)
      ? Array.from(new Set(value.shipIds.filter((shipId): shipId is string => validShipIds.has(shipId))))
      : [],
    behavior,
    retreatPolicy: normalizeBattleGroupRetreatPolicy(value?.retreatPolicy ?? getDefaultRetreatPolicyForBehavior(behavior)),
    retreatDestination: normalizeBattleGroupRetreatDestination(value?.retreatDestination),
    chaseSetting: isBattleGroupChaseSetting(value?.chaseSetting)
      ? value!.chaseSetting!
      : getDefaultChaseForBehavior(behavior),
    protectedTarget: normalizeBattleGroupProtectedTarget(value?.protectedTarget),
    originPosition: origin,
    deployedPosition: deployed,
    leashRadius: Number.isFinite(leash) && leash > 0 ? clamp(leash, 8, 160) : (behavior === "defender" ? DEFENDER_BATTLE_GROUP_LEASH_RADIUS : DEFAULT_BATTLE_GROUP_LEASH_RADIUS),
    currentOrder: normalizeBattleGroupOrder(value?.currentOrder),
  };
}

function normalizeShip(
  ship: Partial<ServerShip> & { id: string; ownerId: number },
  fallbackFleetId: string,
  shipDesigns: ShipDesign[],
): GameShip {
  const definition = getShipDefinition(ship.shipKind);
  const shipKind = definition.kind;
  const design = resolveShipDesign(shipDesigns, Number.isInteger(ship.ownerId) ? ship.ownerId : 0, shipKind, ship.designId);
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
    ownerId: Number.isInteger(ship.ownerId) ? ship.ownerId : 0,
    fleetId: ship.fleetId || fallbackFleetId,
    shipKind,
    designId: design.id,
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
  const orderType: FleetOrderType = fleet.orderType === "move" || fleet.orderType === "build" || fleet.orderType === "orbit" || fleet.orderType === "merge" || fleet.orderType === "retreat"
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
    battleGroups: [],
    alertMode: false,
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

function getShipDesignForStateShip(
  nextState: Pick<GameState, "shipDesigns" | "clock">,
  ship: Pick<ServerShip, "ownerId" | "shipKind" | "designId">,
): ShipDesign {
  return resolveShipDesign(nextState.shipDesigns, ship.ownerId, ship.shipKind, ship.designId);
}

function getBattleGroupCompatibilityKey(
  nextState: Pick<GameState, "shipDesigns" | "clock">,
  ship: GameShip,
): string {
  const design = getShipDesignForStateShip(nextState, ship);
  return `${ship.ownerId}:${ship.shipKind}:${design.id}`;
}

function chunkShipIdsForBattleGroups(shipIds: string[], shipKind: StarbaseShipKind | null | undefined): string[][] {
  const count = shipIds.length;
  if (count === 0) return [];
  const minSize = getCombatGroupMinSize(shipKind);
  const maxSize = getCombatGroupMaxSize(shipKind);
  if (count <= maxSize) return [shipIds];
  let groupCount = Math.ceil(count / maxSize);
  while (groupCount > 1 && Math.floor(count / groupCount) < minSize) {
    groupCount -= 1;
  }
  const baseSize = Math.floor(count / groupCount);
  let remainder = count % groupCount;
  const chunks: string[][] = [];
  let cursor = 0;
  for (let index = 0; index < groupCount; index += 1) {
    const size = baseSize + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    chunks.push(shipIds.slice(cursor, cursor + size));
    cursor += size;
  }
  return chunks;
}

function createAutoBattleGroupsForShips(
  nextState: Pick<GameState, "shipDesigns" | "clock">,
  fleet: GameFleet,
  ships: GameShip[],
  namePrefix = "Battle Group",
): BattleGroupConfig[] {
  const byCompatibility = new Map<string, GameShip[]>();
  for (const ship of ships) {
    const key = getBattleGroupCompatibilityKey(nextState, ship);
    const list = byCompatibility.get(key) ?? [];
    list.push(ship);
    byCompatibility.set(key, list);
  }

  const groups: BattleGroupConfig[] = [];
  let nextIndex = 1;
  for (const compatibleShips of byCompatibility.values()) {
    compatibleShips.sort((a, b) => a.id.localeCompare(b.id));
    const firstShip = compatibleShips[0];
    if (!firstShip) continue;
    const design = getShipDesignForStateShip(nextState, firstShip);
    const behavior = getDefaultBehaviorForMounts(calculateShipDesignStats(design).combat.weaponMounts);
    const chunks = chunkShipIdsForBattleGroups(compatibleShips.map((ship) => ship.id), firstShip.shipKind);
    for (const chunk of chunks) {
      const id = `bg-${fleet.id}-${design.id}-${nextIndex}`;
      groups.push(normalizeBattleGroupConfig(
        {
          id,
          name: `${namePrefix} ${nextIndex}`,
          shipIds: chunk,
          behavior,
          retreatPolicy: getDefaultRetreatPolicyForBehavior(behavior),
          chaseSetting: getDefaultChaseForBehavior(behavior),
        },
        fleet,
        id,
        `${namePrefix} ${nextIndex}`,
        behavior,
        new Set(fleet.shipIds),
      ));
      nextIndex += 1;
    }
  }
  return groups;
}

function getBattleGroupShipKind(group: BattleGroupConfig, shipsById: Map<string, GameShip>): StarbaseShipKind | null {
  const firstShip = group.shipIds.map((shipId) => shipsById.get(shipId)).find((ship): ship is GameShip => !!ship);
  return firstShip?.shipKind ?? null;
}

function battleGroupAssignmentsSignature(groups: BattleGroupConfig[]): string {
  return JSON.stringify(groups.map((group) => ({
    id: group.id,
    name: group.name,
    shipIds: group.shipIds,
    behavior: group.behavior,
    retreatPolicy: group.retreatPolicy,
    retreatDestination: group.retreatDestination ?? null,
    chaseSetting: group.chaseSetting,
    protectedTarget: group.protectedTarget ?? null,
    originPosition: group.originPosition ?? null,
    deployedPosition: group.deployedPosition ?? null,
    leashRadius: group.leashRadius ?? null,
    currentOrder: group.currentOrder ?? null,
  })));
}

function syncFleetBattleGroups(nextState: GameState, fleet: GameFleet, ships: GameShip[]): boolean {
  const before = battleGroupAssignmentsSignature(fleet.battleGroups ?? []);
  const validShipIds = new Set(ships.map((ship) => ship.id));
  const assigned = new Set<string>();
  const shipsById = new Map(ships.map((ship) => [ship.id, ship]));

  let groups = (fleet.battleGroups ?? []).map((group, index) => normalizeBattleGroupConfig(
    group,
    fleet,
    group.id || `bg-${fleet.id}-${index}`,
    group.name || `Battle Group ${index + 1}`,
    group.behavior,
    validShipIds,
  ));

  groups = groups.map((group) => {
    const nextShipIds: string[] = [];
    for (const shipId of group.shipIds) {
      if (!validShipIds.has(shipId) || assigned.has(shipId)) continue;
      nextShipIds.push(shipId);
      assigned.add(shipId);
    }
    return { ...group, shipIds: nextShipIds };
  });

  const unassignedShips = ships.filter((ship) => !assigned.has(ship.id));
  if (groups.length === 0) {
    groups = createAutoBattleGroupsForShips(nextState, fleet, ships);
  } else if (unassignedShips.length > 0) {
    groups.push(...createAutoBattleGroupsForShips(nextState, fleet, unassignedShips, "Reserve Group"));
  }

  const splitGroups: BattleGroupConfig[] = [];
  for (const group of groups) {
    const shipKind = getBattleGroupShipKind(group, shipsById);
    const maxSize = getCombatGroupMaxSize(shipKind);
    if (group.shipIds.length <= maxSize) {
      splitGroups.push(group);
      continue;
    }
    const chunks = chunkShipIdsForBattleGroups(group.shipIds, shipKind);
    chunks.forEach((chunk, index) => {
      splitGroups.push({
        ...group,
        id: index === 0 ? group.id : `${group.id}-${index + 1}`,
        name: index === 0 ? group.name : `${group.name} ${index + 1}`,
        shipIds: chunk,
      });
    });
  }

  fleet.battleGroups = splitGroups;
  return before !== battleGroupAssignmentsSignature(fleet.battleGroups);
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
    if ((fleet.battleGroups ?? []).length > 0) {
      fleet.battleGroups = [];
      changed = true;
    }
    return true;
  });

  return changed;
}

function syncShipsForDesign(nextState: GameState, design: ShipDesign): boolean {
  const stats = calculateShipDesignStats(design);
  const combat = stats.combat;
  let changed = false;
  for (const ship of nextState.ships) {
    if (ship.designId !== design.id) continue;
    const shieldRatio = ship.maxShield > 0 ? ship.shield / ship.maxShield : 1;
    const armorRatio = ship.maxArmor > 0 ? ship.armor / ship.maxArmor : 1;
    const hullRatio = ship.maxHull > 0 ? ship.hull / ship.maxHull : 1;
    ship.shipKind = design.shipKind;
    ship.speed = stats.speed;
    ship.maxShield = combat.maxShield;
    ship.maxArmor = combat.maxArmor;
    ship.maxHull = combat.maxHull;
    ship.maxHp = combat.maxHull;
    ship.shield = clamp(combat.maxShield * shieldRatio, 0, combat.maxShield);
    ship.armor = clamp(combat.maxArmor * armorRatio, 0, combat.maxArmor);
    ship.hull = clamp(combat.maxHull * hullRatio, 1, combat.maxHull);
    ship.hp = ship.hull;
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
  const cfg = GALAXY_MAP;
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
  const fleets = factions.map<GameFleet>((faction) => {
    const fleetId = `fleet-${faction.id}-1`;
    const design = resolveShipDesign(shipDesigns, faction.id, "corvette");
    const ship = createShipFromDesign(faction.id, fleetId, design, `ship-${faction.id}-1`);
    ships.push(ship);
    const fleet = createFleet(faction.id, faction.homeStarId, [ship.id], fleetId);
    fleet.phaseStartedAtYear = GAME_START_YEAR;
    fleet.speed = ship.speed;
    return fleet;
  });

  const now = Date.now();
  const startMonth = gameYearToMonthIndex(GAME_START_YEAR);
  const startPopulationWeek = gameYearToWeekIndex(GAME_START_YEAR);
  const created: GameState = {
    schemaVersion: 13,
    stars,
    planetStates,
    factionEconomies: factions.map((faction) => createInitialFactionEconomyState(faction.id, startMonth)),
    hyperlanes,
    adjacency,
    factions,
    starOwnership,
    starbases,
    shipDesigns,
    ships,
    fleets,
    battles: [],
    recentCombatContacts: [],
    discoveredByFaction: {},
    lastKnownOwnershipByFaction: {},
    clock: {
      year: GAME_START_YEAR,
      speedMultiplier: 1,
      syncedAtMs: now,
      lastUpdatedAt: now,
      lastProcessedPopulationWeek: startPopulationWeek,
    },
  };
  recalculatePlanetEconomies(created);
  refreshFactionEconomyDeltas(created);
  refreshDiscovery(created);
  return created;
}

async function loadState(): Promise<GameState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as GameState;
    parsed.schemaVersion = 13;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
    parsed.lastKnownOwnershipByFaction = parsed.lastKnownOwnershipByFaction ?? {};
    parsed.battles = [];
    parsed.recentCombatContacts = [];
    parsed.shipDesigns = normalizeShipDesignsForFactions(parsed.factions, parsed.shipDesigns, parsed.clock?.year ?? GAME_START_YEAR);
    parsed.clock.lastUpdatedAt = parsed.clock.lastUpdatedAt ?? Date.now();
    parsed.clock.syncedAtMs = parsed.clock.syncedAtMs ?? parsed.clock.lastUpdatedAt;
    parsed.clock.lastProcessedPopulationWeek = parsed.clock.lastProcessedPopulationWeek ?? gameYearToWeekIndex(parsed.clock.year);
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
    recalculatePlanetEconomies(parsed);
    const normalizedFactionEconomies = normalizeFactionEconomies(parsed);
    const factionEconomiesChanged = JSON.stringify(parsed.factionEconomies ?? []) !== JSON.stringify(normalizedFactionEconomies);
    parsed.factionEconomies = normalizedFactionEconomies;
    refreshFactionEconomyDeltas(parsed);
    const planetStateApplied = applyPlanetStatesToStars(parsed.stars, parsed.planetStates);
    if (metadataChanged || habitationChanged || normalizedPlanetStates.changed || planetStateApplied || factionEconomiesChanged || homeStarbaseChanged) {
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
  await mkdir(path.dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
  lastSaveAt = Date.now();
  hasDirtyState = false;
}

function phaseDuration(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "speed">): number {
  const speed = Math.max(0.05, fleet?.speed ?? DEFAULT_SHIP_SPEED);
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

function phaseDurationDays(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "speed">): number {
  if (phase === "idle") return 0;
  return phaseDuration(phase, fleet) / REAL_MS_PER_GAME_DAY;
}

function phaseDurationYears(phase: ShipTransitPhase, fleet?: Pick<ServerFleet, "speed">): number {
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

function toServerBattle(battle: GameBattle): ServerBattle {
  const { retreatingFleetIds, fleetStartingHull, participantShipIds, resolvedAtRound, ...rest } = battle;
  return rest;
}

function createVisibleBattles(visibleSet: Set<number> | null): ServerBattle[] {
  const battles = visibleSet
    ? state.battles.filter((battle) => visibleSet.has(battle.starId))
    : state.battles;
  return battles.map((battle) => toServerBattle(battle));
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

function createSnapshot(perspective: GalaxyPerspective): GameSnapshot {
  const visibleState = createVisibleState(perspective);
  const knownSet = getKnownSet(perspective);

  return {
    type: "snapshot",
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
  if (changed.includes("battles") || changed.includes("visibility")) {
    update.battles = visibleState.battles;
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
  const starbases = visibleSet
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
  const battles = createVisibleBattles(visibleSet);
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
    starbases,
    battles,
    recentCombatContacts,
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
}

function reject(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: false, message });
}

function accept(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: true, message });
}

function routeIsAllowed(route: number[], ownerId: number): boolean {
  return true;
}

function gameDaysToYears(days: number): number {
  return days / GAME_DAYS_PER_YEAR;
}

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

function systemTravelDays(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, fleet: Pick<ServerFleet, "speed">): number {
  const speedScale = Math.max(0.05, fleet.speed);
  return Math.max(0.1, distance3(from, to) / (SYSTEM_FLEET_SPEED_UNITS_PER_DAY * speedScale));
}

function isSameSystemPosition(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return distance3(a, b) <= 0.05;
}

function cloneSystemPosition(position: { x: number; y: number; z: number }): ReturnType<typeof systemCenterPosition> {
  return { x: position.x, y: position.y, z: position.z };
}

function hyperlaneTravelDays(fromStarId: number, toStarId: number, fleet: Pick<ServerFleet, "speed">): number {
  const from = state.stars[fromStarId];
  const to = state.stars[toStarId];
  if (!from || !to) return phaseDurationDays("jumpingHyperlane", fleet);
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const speed = Math.max(0.05, fleet.speed * 2);
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

function offsetSystemPosition(
  position: ReturnType<typeof systemCenterPosition>,
  dx: number,
  dz: number,
): ReturnType<typeof systemCenterPosition> {
  return { x: position.x + dx, y: SYSTEM_FLEET_Y, z: position.z + dz };
}

function getBattleGroupDeploymentOffset(
  group: BattleGroupConfig,
  index: number,
  total: number,
): { dx: number; dz: number } {
  const lane = index - (total - 1) / 2;
  const spread = Math.min(18, Math.max(7, total * 2.8));
  const behaviorDz: Record<BattleGroupBehavior, number> = {
    screen: -14,
    brawler: -8,
    line: 0,
    artillery: 14,
    defender: 6,
  };
  return {
    dx: lane * spread,
    dz: behaviorDz[group.behavior] ?? 0,
  };
}

function deployFleetBattleGroups(fleet: GameFleet, force = false): boolean {
  let changed = false;
  const groups = fleet.battleGroups.filter((group) => group.shipIds.length > 0);
  const base = getFleetAuthoritativeSystemPosition(fleet);
  groups.forEach((group, index) => {
    const offset = getBattleGroupDeploymentOffset(group, index, groups.length);
    const position = offsetSystemPosition(base, offset.dx, offset.dz);
    if (force || !group.deployedPosition) {
      group.deployedPosition = cloneSystemPosition(position);
      changed = true;
    }
    if (force || !group.originPosition) {
      group.originPosition = cloneSystemPosition(group.deployedPosition ?? position);
      changed = true;
    }
    if (!group.leashRadius || group.leashRadius <= 0) {
      group.leashRadius = group.behavior === "defender" ? DEFENDER_BATTLE_GROUP_LEASH_RADIUS : DEFAULT_BATTLE_GROUP_LEASH_RADIUS;
      changed = true;
    }
  });
  return changed;
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

function clampPositionToLeash(
  position: ReturnType<typeof systemCenterPosition>,
  origin: ReturnType<typeof systemCenterPosition>,
  radius: number,
): ReturnType<typeof systemCenterPosition> {
  const dx = position.x - origin.x;
  const dz = position.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= radius || radius <= 0) return position;
  const scale = radius / distance;
  return { x: origin.x + dx * scale, y: SYSTEM_FLEET_Y, z: origin.z + dz * scale };
}

function isFleetAvailableForOrders(fleet: GameFleet): boolean {
  return fleet.phase === "idle" || fleet.phase === "orbitingPlanet" || fleet.phase === "orbiting";
}

function clearFleetOrbit(fleet: GameFleet): void {
  fleet.orbitTargetPlanetId = null;
  fleet.orbitOffset = null;
  fleet.orbitTarget = null;
  fleet.mergeTargetFleetId = null;
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
  if (!route) throw new Error("No discovered safe route to target.");
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
  if (!targetFleet || targetFleet.id === sourceFleet.id || targetFleet.currentStarId !== sourceFleet.currentStarId) {
    sourceFleet.orderType = null;
    sourceFleet.mergeTargetFleetId = null;
    setFleetPhase(sourceFleet, "idle");
    return false;
  }

  for (const shipId of sourceFleet.shipIds) {
    if (!targetFleet.shipIds.includes(shipId)) targetFleet.shipIds.push(shipId);
  }
  state.ships = state.ships.map((ship) => (
    ship.fleetId === sourceFleet.id ? { ...ship, fleetId: targetFleet.id } : ship
  ));
  state.fleets = state.fleets.filter((fleet) => fleet.id !== sourceFleet.id);
  syncFleetMembership(state);
  return true;
}

function startMergeSourceOrder(sourceFleet: GameFleet, targetFleet: GameFleet): void {
  sourceFleet.mergeTargetFleetId = targetFleet.id;
  const targetPosition = getFleetAuthoritativeSystemPosition(targetFleet);
  const orbitTarget: FleetOrbitTarget = {
    kind: "fleet",
    starId: targetFleet.currentStarId,
    targetFleetId: targetFleet.id,
    position: targetPosition,
  };
  startPositionOrder(sourceFleet, targetFleet.currentStarId, "merge", targetPosition, orbitTarget, [sourceFleet.currentStarId]);
  sourceFleet.mergeTargetFleetId = targetFleet.id;
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
  if (isFleetInBattle(fleet.id)) return reject(socket, "Fleet is engaged in battle.");
  if (!isFleetAvailableForOrders(fleet)) return reject(socket, "Fleet is already busy.");
  try {
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
  if (isFleetInBattle(fleet.id)) return reject(socket, "Fleet is engaged in battle.");
  if (!isFleetAvailableForOrders(fleet)) return reject(socket, "Fleet is already busy.");
  if (getKnownOwnership(factionId, targetStarId) !== -1) return reject(socket, "Can only build in unowned systems.");
  if (state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(socket, "System already has a starbase.");
  try {
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
  if (isFleetInBattle(fleet.id)) return reject(socket, "Fleet is engaged in battle.");
  if (!isFleetAvailableForOrders(fleet)) return reject(socket, "Fleet is already busy.");
  try {
    startOrbitOrder(fleet, planetId);
    hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Orbit order accepted.");
    broadcastUpdates(["clock", "fleets", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Orbit order rejected.");
  }
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
  if (isFleetInBattle(targetFleet.id)) return reject(socket, "Target fleet is engaged in battle.");
  if (!isFleetAvailableForOrders(targetFleet)) return reject(socket, "Target fleet is busy.");

  const uniqueSourceIds = Array.from(new Set(sourceFleetIds)).filter((id) => id !== targetFleetId);
  if (uniqueSourceIds.length === 0) return reject(socket, "No fleets selected to merge.");

  const sourceFleets = uniqueSourceIds
    .map((id) => state.fleets.find((fleet) => fleet.id === id))
    .filter((fleet): fleet is GameFleet => !!fleet);

  if (sourceFleets.length !== uniqueSourceIds.length) return reject(socket, "A source fleet was not found.");
  for (const fleet of sourceFleets) {
    if (fleet.ownerId !== factionId) return reject(socket, "You do not own all selected fleets.");
    if (isFleetInBattle(fleet.id)) return reject(socket, "A selected fleet is engaged in battle.");
    if (!isFleetAvailableForOrders(fleet)) return reject(socket, "All fleets must be idle or orbiting to merge.");
    if (fleet.currentStarId !== targetFleet.currentStarId) {
      return reject(socket, "Fleets must be in the same system to merge.");
    }
  }

  const immediateSourceFleets: GameFleet[] = [];
  const movingSourceFleets: GameFleet[] = [];
  const targetPosition = getFleetAuthoritativeSystemPosition(targetFleet);
  for (const fleet of sourceFleets) {
    if (isSameSystemPosition(getFleetAuthoritativeSystemPosition(fleet), targetPosition)) {
      immediateSourceFleets.push(fleet);
    } else {
      movingSourceFleets.push(fleet);
      startMergeSourceOrder(fleet, targetFleet);
    }
  }

  if (immediateSourceFleets.length > 0) {
    const removedFleetIds = new Set(immediateSourceFleets.map((fleet) => fleet.id));
    for (const fleet of immediateSourceFleets) {
      for (const shipId of fleet.shipIds) {
        if (!targetFleet.shipIds.includes(shipId)) targetFleet.shipIds.push(shipId);
      }
    }
    state.ships = state.ships.map((ship) => (
      removedFleetIds.has(ship.fleetId) ? { ...ship, fleetId: targetFleet.id } : ship
    ));
    state.fleets = state.fleets.filter((fleet) => !removedFleetIds.has(fleet.id));
    syncFleetMembership(state);
  }

  hasDirtyState = true;
  accept(socket, movingSourceFleets.length > 0 ? "Merge rendezvous ordered." : "Fleets merged.");
  broadcastUpdates(["clock", "ships", "fleets", "visibility"]);
}

function handleRetreatFleet(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string): void {
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  const destination = fleet ? resolveBattleGroupRetreatDestinationForFleet(fleet, null) : null;
  handleRetreatFleetTo(socket, perspective, fleetId, destination?.targetStarId ?? -1, destination?.targetSystemPosition ?? undefined);
}

function getActiveBattleForFleetId(fleetId: string): GameBattle | null {
  return state.battles.find((candidate) => (
    candidate.phase !== "resolved"
    && (candidate.attackerFleetIds.includes(fleetId) || candidate.defenderFleetIds.includes(fleetId))
  )) ?? null;
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
    retreatOrder: "retreat",
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

  const battle = getActiveBattleForFleetId(fleetId);
  if (!battle) return reject(socket, "Fleet is not engaged in battle.");
  const participantId = getFleetParticipantId(fleetId);
  const lostShipIds = new Set<string>();
  const activeStates = battle.ships.filter((ship) => ship.fleetId === fleetId && !ship.destroyed);

  for (const shipState of activeStates) {
    const ship = state.ships.find((candidate) => candidate.id === shipState.shipId);
    if (!ship) continue;
    ship.shield = Math.max(0, ship.shield - ship.maxShield * EMERGENCY_RETREAT_SHIELD_LOSS_FRACTION);
    shipState.shield = ship.shield;
    const armorDamage = ship.maxArmor * EMERGENCY_RETREAT_ARMOR_DAMAGE_FRACTION;
    const hullDamage = ship.maxHull * EMERGENCY_RETREAT_HULL_DAMAGE_FRACTION;
    ship.armor = Math.max(0, ship.armor - armorDamage);
    ship.hull = Math.max(0, ship.hull - hullDamage);
    ship.hp = ship.hull;
    shipState.armor = ship.armor;
    shipState.hull = ship.hull;
    if (Math.random() < EMERGENCY_RETREAT_SHIP_LOSS_CHANCE || ship.hull <= 0) {
      shipState.destroyed = true;
      lostShipIds.add(ship.id);
    }
  }

  const lostCount = lostShipIds.size;
  if (lostCount > 0) {
    ensureParticipantStats(battle.stats, participantId).shipsLost += lostCount;
    ensureOwnerStats(battle.stats, fleet.ownerId).shipsLost += lostCount;
    state.ships = state.ships.filter((ship) => !lostShipIds.has(ship.id));
    syncFleetMembership(state);
  }

  const survivingCount = activeStates.length - lostCount;
  ensureParticipantStats(battle.stats, participantId).escapedShips += Math.max(0, survivingCount);
  ensureOwnerStats(battle.stats, fleet.ownerId).escapedShips += Math.max(0, survivingCount);
  battle.attackerFleetIds = battle.attackerFleetIds.filter((id) => id !== fleetId);
  battle.defenderFleetIds = battle.defenderFleetIds.filter((id) => id !== fleetId);
  battle.retreatingFleetIds = battle.retreatingFleetIds.filter((id) => id !== fleetId);
  battle.ships = battle.ships.filter((ship) => ship.fleetId !== fleetId);

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
  broadcastUpdates(["battles", "ships", "fleets"]);
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

function getBattleGroupById(fleet: GameFleet, battleGroupId: string): BattleGroupConfig | null {
  return fleet.battleGroups.find((group) => group.id === battleGroupId) ?? null;
}

function getShipCompatibilityKeys(shipIds: string[]): Set<string> {
  return new Set(shipIds.map((shipId) => {
    const ship = state.ships.find((candidate) => candidate.id === shipId);
    return ship ? getBattleGroupCompatibilityKey(state, ship) : "";
  }).filter(Boolean));
}

function canBattleGroupAcceptShips(
  group: BattleGroupConfig,
  shipIds: string[],
): { ok: boolean; message?: string } {
  const nextShipIds = Array.from(new Set([...group.shipIds, ...shipIds]));
  const ships = nextShipIds
    .map((shipId) => state.ships.find((candidate) => candidate.id === shipId))
    .filter((ship): ship is GameShip => !!ship);
  if (ships.length !== nextShipIds.length) return { ok: false, message: "A ship was not found." };
  const compatibilityKeys = getShipCompatibilityKeys(nextShipIds);
  if (compatibilityKeys.size > 1) return { ok: false, message: "Battle groups can only mix compatible ship designs." };
  const shipKind = ships[0]?.shipKind ?? null;
  const maxSize = getCombatGroupMaxSize(shipKind);
  if (nextShipIds.length > maxSize) return { ok: false, message: `Battle group exceeds maximum size ${maxSize}.` };
  return { ok: true };
}

function commitBattleGroupChange(socket: WebSocket, message: string, fleet: GameFleet): void {
  syncFleetBattleGroups(state, fleet, getFleetShips(fleet));
  if (fleet.alertMode) deployFleetBattleGroups(fleet);
  hasDirtyState = true;
  accept(socket, message);
  broadcastUpdates(["fleets", "battles"]);
}

function commitFleetDoctrineChange(socket: WebSocket, message: string): void {
  hasDirtyState = true;
  accept(socket, message);
  broadcastUpdates(["fleets"]);
}

function removeShipsFromBattleGroups(fleet: GameFleet, shipIds: Set<string>): void {
  fleet.battleGroups = fleet.battleGroups.map((group) => ({
    ...group,
    shipIds: group.shipIds.filter((shipId) => !shipIds.has(shipId)),
  }));
}

function handleCreateBattleGroup(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "createBattleGroup" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const selectedShipIds = Array.from(new Set(command.shipIds ?? [])).filter((shipId) => fleet.shipIds.includes(shipId));
  const behavior = isBattleGroupBehavior(command.behavior) ? command.behavior : fleet.combatSettings.defaultBehavior;
  if (selectedShipIds.length > 0) {
    const validation = canBattleGroupAcceptShips({
      id: "new",
      name: "New",
      shipIds: [],
      behavior,
      retreatPolicy: getDefaultRetreatPolicyForBehavior(behavior),
      chaseSetting: getDefaultChaseForBehavior(behavior),
    }, selectedShipIds);
    if (!validation.ok) return reject(socket, validation.message ?? "Invalid battle group.");
    removeShipsFromBattleGroups(fleet, new Set(selectedShipIds));
  }
  const id = createRuntimeId("bg", [fleet.id]);
  fleet.battleGroups.push(normalizeBattleGroupConfig(
    {
      id,
      name: command.name ?? `Battle Group ${fleet.battleGroups.length + 1}`,
      shipIds: selectedShipIds,
      behavior,
      retreatPolicy: getDefaultRetreatPolicyForBehavior(behavior),
      chaseSetting: getDefaultChaseForBehavior(behavior),
    },
    fleet,
    id,
    `Battle Group ${fleet.battleGroups.length + 1}`,
    behavior,
    new Set(fleet.shipIds),
  ));
  commitBattleGroupChange(socket, "Battle group created.", fleet);
}

function handleDeleteBattleGroup(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, battleGroupId: string): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  fleet.battleGroups = fleet.battleGroups.filter((candidate) => candidate.id !== battleGroupId);
  if (fleet.battleGroups.length === 0) {
    fleet.battleGroups = createAutoBattleGroupsForShips(state, fleet, getFleetShips(fleet));
  } else if (group.shipIds.length > 0) {
    fleet.battleGroups.push(...createAutoBattleGroupsForShips(
      state,
      fleet,
      group.shipIds.map((shipId) => state.ships.find((ship) => ship.id === shipId)).filter((ship): ship is GameShip => !!ship),
      "Reserve Group",
    ));
  }
  commitBattleGroupChange(socket, "Battle group deleted.", fleet);
}

function handleRenameBattleGroup(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, battleGroupId: string, name: string): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  const nextName = name.trim().slice(0, 48);
  if (!nextName) return reject(socket, "Battle group name is required.");
  group.name = nextName;
  commitBattleGroupChange(socket, "Battle group renamed.", fleet);
}

function handleMoveShipsToBattleGroup(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "moveShipsToBattleGroup" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const target = getBattleGroupById(fleet, command.toBattleGroupId);
  if (!target) return reject(socket, "Target battle group not found.");
  const shipIds = Array.from(new Set(command.shipIds)).filter((shipId) => fleet.shipIds.includes(shipId));
  if (shipIds.length === 0) return reject(socket, "No valid ships selected.");
  const validation = canBattleGroupAcceptShips(target, shipIds);
  if (!validation.ok) return reject(socket, validation.message ?? "Ships are not compatible with that battle group.");
  removeShipsFromBattleGroups(fleet, new Set(shipIds));
  target.shipIds = Array.from(new Set([...target.shipIds, ...shipIds]));
  commitBattleGroupChange(socket, "Ships moved between battle groups.", fleet);
}

function handleSplitBattleGroup(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "splitBattleGroup" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const source = getBattleGroupById(fleet, command.battleGroupId);
  if (!source) return reject(socket, "Battle group not found.");
  const shipIds = Array.from(new Set(command.shipIds)).filter((shipId) => source.shipIds.includes(shipId));
  if (shipIds.length === 0 || shipIds.length >= source.shipIds.length) return reject(socket, "Select a subset of ships to split.");
  const validation = canBattleGroupAcceptShips({ ...source, id: "split", shipIds: [] }, shipIds);
  if (!validation.ok) return reject(socket, validation.message ?? "Split group is invalid.");
  source.shipIds = source.shipIds.filter((shipId) => !shipIds.includes(shipId));
  const id = createRuntimeId("bg", [fleet.id]);
  fleet.battleGroups.push({
    ...source,
    id,
    name: command.name?.trim().slice(0, 48) || `${source.name} Split`,
    shipIds,
    originPosition: source.originPosition ? cloneSystemPosition(source.originPosition) : null,
    deployedPosition: source.deployedPosition ? cloneSystemPosition(source.deployedPosition) : null,
  });
  commitBattleGroupChange(socket, "Battle group split.", fleet);
}

function handleMergeBattleGroups(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "mergeBattleGroups" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const source = getBattleGroupById(fleet, command.sourceBattleGroupId);
  const target = getBattleGroupById(fleet, command.targetBattleGroupId);
  if (!source || !target || source.id === target.id) return reject(socket, "Battle groups not found.");
  const validation = canBattleGroupAcceptShips(target, source.shipIds);
  if (!validation.ok) return reject(socket, validation.message ?? "Battle groups are not compatible.");
  target.shipIds = Array.from(new Set([...target.shipIds, ...source.shipIds]));
  fleet.battleGroups = fleet.battleGroups.filter((group) => group.id !== source.id);
  commitBattleGroupChange(socket, "Battle groups merged.", fleet);
}

function handleSetBattleGroupBehavior(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, battleGroupId: string, behavior: BattleGroupBehavior): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  if (!isBattleGroupBehavior(behavior)) return reject(socket, "Invalid battle group behavior.");
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  group.behavior = behavior;
  group.chaseSetting = getDefaultChaseForBehavior(behavior);
  commitBattleGroupChange(socket, "Battle group behavior updated.", fleet);
}

function handleSetBattleGroupRetreatPolicy(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  battleGroupId: string,
  retreatPolicy: BattleGroupRetreatPolicy,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  group.retreatPolicy = normalizeBattleGroupRetreatPolicy(retreatPolicy);
  commitBattleGroupChange(socket, "Battle group retreat policy updated.", fleet);
}

function handleSetBattleGroupChaseSetting(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  battleGroupId: string,
  chaseSetting: BattleGroupChaseSetting,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  if (!isBattleGroupChaseSetting(chaseSetting)) return reject(socket, "Invalid chase setting.");
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  group.chaseSetting = chaseSetting;
  commitBattleGroupChange(socket, "Battle group chase setting updated.", fleet);
}

function handleSetBattleGroupRetreatDestination(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  fleetId: string,
  battleGroupId: string,
  retreatDestination: BattleGroupRetreatDestination | null,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  const group = getBattleGroupById(fleet, battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  group.retreatDestination = normalizeBattleGroupRetreatDestination(retreatDestination);
  commitBattleGroupChange(socket, "Battle group retreat destination updated.", fleet);
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

function handleSetFleetAlertMode(socket: WebSocket, perspective: GalaxyPerspective, fleetId: string, alertMode: boolean): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, fleetId);
  if (!fleet) return;
  fleet.alertMode = false;
  commitFleetDoctrineChange(socket, "Alert mode is retired; fleet doctrine now controls readiness.");
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

function handleIssueBattleGroupOrder(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "issueBattleGroupOrder" }>,
): void {
  const fleet = getOwnedFleetForCombatCommand(socket, perspective, command.fleetId);
  if (!fleet) return;
  const group = getBattleGroupById(fleet, command.battleGroupId);
  if (!group) return reject(socket, "Battle group not found.");
  const order = normalizeBattleGroupOrder({
    ...command.order,
    issuedAtYear: state.clock.year,
  });
  if (!order) return reject(socket, "Invalid battle group order.");
  if (order.type === "move" && !order.targetPosition) return reject(socket, "Move orders require a system position.");
  if (order.type === "attack" && !order.targetGroupId && !order.targetObjectId) return reject(socket, "Attack orders require a target.");
  if (order.type === "protect" && !order.protectedTarget) return reject(socket, "Protect orders require a target.");
  if (!group.deployedPosition) deployFleetBattleGroups(fleet);
  group.currentOrder = order;
  if (order.type === "move" && !fleet.alertMode && !isFleetInBattle(fleet.id)) {
    fleet.alertMode = true;
  }
  commitBattleGroupChange(socket, "Battle group order accepted.", fleet);
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

function sendSystemDetails(socket: WebSocket, perspective: GalaxyPerspective, starId: number): void {
  if (!Number.isInteger(starId) || !canAccessStar(perspective, starId)) {
    reject(socket, "System is not available.");
    return;
  }

  sendEvent(socket, {
    type: "systemDetails",
    star: state.stars[starId],
    planetStates: state.planetStates.filter((planetState) => planetState.starId === starId),
  });
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
  const stats = calculateShipDesignStats(design);
  const item = createStarbaseShipQueueItem(shipKind, {
    designId: design.id,
    label: design.name,
    totalDays: stats.buildDays,
    remainingDays: stats.buildDays,
    alloyUpkeepPerDay: stats.alloyUpkeepPerDay,
    crewDemand: stats.crewDemand,
  });
  commitStarbase(socket, "Ship queued.", {
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
}

function handleSaveShipDesign(
  socket: WebSocket,
  perspective: GalaxyPerspective,
  command: Extract<ClientCommand, { type: "saveShipDesign" }>,
): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  if (!isKnownShipKind(command.shipKind)) return reject(socket, "Invalid ship hull.");
  const hull = SHIP_HULL_DEFINITIONS[command.shipKind] ?? SHIP_HULL_DEFINITIONS.corvette;
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
    weaponModuleIds: command.weaponModuleIds,
    defenseModuleIds: command.defenseModuleIds,
    utilityModuleId: command.utilityModuleId ?? null,
    createdAtYear: current?.createdAtYear ?? state.clock.year,
    updatedAtYear: state.clock.year,
  };
  const nextDesign = normalizeShipDesign(raw, factionId, state.clock.year);
  if (nextDesign.weaponModuleIds.length !== hull.weaponSlots || nextDesign.defenseModuleIds.length !== hull.defenseSlots) {
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
  hasDirtyState = true;
  accept(socket, "Ship design decommissioned.");
  broadcastUpdates(["shipDesigns"]);
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

    const factionId = perspective.mode === "faction" ? perspective.factionId : null;
    if (factionId === null) return reject(socket, "Observer mode is read-only.");
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

  const factionId = perspective.mode === "faction" ? perspective.factionId : null;
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const item = createBuildingConstructionQueueItem(buildingKind, area, slotIndex);
  if (!spendMinerals(socket, factionId, item.mineralCost)) return;

  commitPlanetState(socket, perspective, "Building queued.", {
    ...planetState,
    constructionQueue: [...planetState.constructionQueue, item],
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
      completeMergeSourceFleet(fleet);
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
      fleet.combatSettings = { ...fleet.combatSettings, retreatOrder: "none" };
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

function processAlertBattleGroups(elapsedGameDays: number): boolean {
  let changed = false;
  const stepBase = Math.max(0, elapsedGameDays) * BATTLE_GROUP_SPEED_UNITS_PER_DAY;
  for (const fleet of state.fleets) {
    if (!fleet.alertMode || isFleetInBattle(fleet.id)) continue;
    if (deployFleetBattleGroups(fleet)) changed = true;
    const step = stepBase * Math.max(0.2, fleet.speed);
    for (const group of fleet.battleGroups) {
      if (group.shipIds.length === 0) continue;
      const current = group.deployedPosition ?? group.originPosition ?? getFleetAuthoritativeSystemPosition(fleet);
      if (!group.originPosition) {
        group.originPosition = cloneSystemPosition(current);
        changed = true;
      }
      if (!group.deployedPosition) {
        group.deployedPosition = cloneSystemPosition(current);
        changed = true;
      }
      if (group.currentOrder?.type !== "move" || !group.currentOrder.targetPosition || step <= 0) continue;
      const nextPosition = movePointToward(current, group.currentOrder.targetPosition, step);
      if (!isSameSystemPosition(nextPosition, current)) {
        group.deployedPosition = nextPosition;
        group.originPosition = cloneSystemPosition(nextPosition);
        changed = true;
      }
      if (isSameSystemPosition(nextPosition, group.currentOrder.targetPosition)) {
        group.currentOrder = { type: "hold", issuedAtYear: state.clock.year };
        changed = true;
      }
    }
  }
  if (changed) hasDirtyState = true;
  return changed;
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

function getWeaponRange(mount: WeaponMountDefinition): number {
  return getLegacyWeaponRange(mount);
}

function getFormationZones(formation: FleetFormation, side: BattleSide, shipCount: number): BattleZone[] {
  const frontZone: BattleZone = side === "attacker" ? 2 : 0;
  const rearZone: BattleZone = side === "attacker" ? 3 : 1;
  const zones: BattleZone[] = [];
  const count = Math.max(0, shipCount);

  if (formation === "echelon") {
    const stagger: BattleZone[] = [0, 1, 2, 3];
    for (let i = 0; i < count; i += 1) {
      zones.push(stagger[i % stagger.length]);
    }
    return zones;
  }

  if (formation === "vanguard") {
    const frontCount = Math.ceil(count * 0.7);
    for (let i = 0; i < count; i += 1) {
      zones.push(i < frontCount ? frontZone : rearZone);
    }
    return zones;
  }

  if (formation === "defensive") {
    const rearCount = Math.ceil(count * 0.7);
    for (let i = 0; i < count; i += 1) {
      zones.push(i < rearCount ? rearZone : frontZone);
    }
    return zones;
  }

  for (let i = 0; i < count; i += 1) {
    zones.push(i % 2 === 0 ? frontZone : rearZone);
  }
  return zones;
}

function getActiveBattleForStar(starId: number): GameBattle | null {
  return state.battles.find((battle) => battle.starId === starId && battle.phase !== "resolved") ?? null;
}

const SYSTEM_COMBAT_FLEET_PHASES = new Set<ShipTransitPhase>([
  "idle",
  "buildingStarbase",
  "movingSystem",
  "departingSystem",
  "arrivingSystem",
  "orbiting",
  "orbitingPlanet",
]);

function isFleetEligibleForSystemCombat(fleet: GameFleet, starId = fleet.currentStarId): boolean {
  return fleet.currentStarId === starId
    && SYSTEM_COMBAT_FLEET_PHASES.has(fleet.phase)
    && fleet.shipIds.length > 0
    && !isFleetInBattle(fleet.id);
}

function isFleetInBattle(fleetId: string): boolean {
  return state.battles.some((battle) => (
    battle.phase !== "resolved"
    && (battle.attackerFleetIds.includes(fleetId) || battle.defenderFleetIds.includes(fleetId))
  ));
}

function getBattleSideForFleet(battle: GameBattle, fleet: GameFleet): BattleSide {
  if (fleet.ownerId === battle.attackerFactionId) return "attacker";
  if (fleet.ownerId === battle.defenderFactionId) return "defender";
  return "defender";
}

function buildBattleShipState(
  ship: GameShip,
  side: BattleSide,
  zone: BattleZone,
): ServerBattleShipState {
  return {
    shipId: ship.id,
    fleetId: ship.fleetId,
    ownerId: ship.ownerId,
    side,
    participantId: `fleet:${ship.fleetId}`,
    groupId: undefined,
    rangeBand: side === "attacker" ? "long" : "medium",
    zone,
    targetId: null,
    shield: ship.shield,
    maxShield: ship.maxShield,
    armor: ship.armor,
    maxArmor: ship.maxArmor,
    hull: ship.hull,
    maxHull: ship.maxHull,
    destroyed: false,
    lastHitRound: -999,
  };
}

function buildBattleStarbaseState(starbase: ServerStarbase): ServerBattleStarbaseState {
  return {
    starbaseId: starbase.id,
    ownerId: starbase.ownerId,
    participantId: `starbase:${starbase.id}`,
    groupId: `group:starbase:${starbase.id}`,
    rangeBand: "long",
    zone: 0,
    shield: starbase.shield,
    maxShield: starbase.maxShield,
    armor: starbase.armor,
    maxArmor: starbase.maxArmor,
    hull: starbase.hull,
    maxHull: starbase.maxHull,
    destroyed: starbase.hull <= 0,
    lastHitRound: -999,
  };
}

function getShipStatsById(shipId: string, shipsById: Map<string, GameShip>) {
  const ship = shipsById.get(shipId);
  if (!ship) return null;
  return calculateShipDesignStats(getShipDesignForShip(ship));
}

function getShipEvasion(shipState: ServerBattleShipState, fleetsById: Map<string, GameFleet>, shipsById: Map<string, GameShip>): number {
  const stats = getShipStatsById(shipState.shipId, shipsById);
  if (!stats) return 0;
  const fleet = fleetsById.get(shipState.fleetId);
  const bonus = fleet ? FORMATION_EVASION_BONUS[fleet.formation] ?? 0 : 0;
  return clamp(stats.combat.evasion + bonus, 0, 0.9);
}

function getShipSensorRange(shipState: ServerBattleShipState, shipsById: Map<string, GameShip>): number {
  const stats = getShipStatsById(shipState.shipId, shipsById);
  return Math.max(1, stats?.combat.sensorRange ?? 1);
}

function getShipWeaponMounts(shipState: ServerBattleShipState, shipsById: Map<string, GameShip>): WeaponMountDefinition[] {
  const stats = getShipStatsById(shipState.shipId, shipsById);
  return stats?.combat.weaponMounts ?? [];
}

function getStarbaseWeaponMounts(starbase: ServerStarbase): WeaponMountDefinition[] {
  return STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
}

function getWeaponMountSystemRange(mount: WeaponMountDefinition): number {
  return getWeaponMaxSystemRange(mount);
}

function getFleetWeaponMounts(fleet: GameFleet, shipsById: Map<string, GameShip>): WeaponMountDefinition[] {
  return fleet.shipIds.flatMap((shipId) => {
    const ship = shipsById.get(shipId);
    return ship ? calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts : [];
  });
}

function getMaxWeaponSystemRange(mounts: WeaponMountDefinition[]): number {
  return mounts.reduce((max, mount) => Math.max(max, getWeaponMountSystemRange(mount)), 0);
}

function getFleetEngagementProfiles(
  fleet: GameFleet,
  shipsById: Map<string, GameShip>,
): Array<{ position: ReturnType<typeof systemCenterPosition>; range: number }> {
  if (fleet.battleGroups.length > 0) {
    deployFleetBattleGroups(fleet);
    const profiles = fleet.battleGroups
      .filter((group) => group.shipIds.length > 0)
      .map((group) => {
        const mounts = group.shipIds.flatMap((shipId) => {
          const ship = shipsById.get(shipId);
          return ship ? calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts : [];
        });
        return {
          position: group.deployedPosition ?? group.originPosition ?? getFleetAuthoritativeSystemPosition(fleet),
          range: getMaxWeaponSystemRange(mounts),
        };
      })
      .filter((profile) => profile.range > 0);
    if (profiles.length > 0) return profiles;
  }
  return [{
    position: getFleetAuthoritativeSystemPosition(fleet),
    range: getMaxWeaponSystemRange(getFleetWeaponMounts(fleet, shipsById)),
  }];
}

function engagementProfilesCanInteract(
  a: Array<{ position: ReturnType<typeof systemCenterPosition>; range: number }>,
  b: Array<{ position: ReturnType<typeof systemCenterPosition>; range: number }>,
): boolean {
  return combatEngagementProfilesCanInteract(a, b);
}

function canFleetInitiateCombat(fleet: GameFleet): boolean {
  return fleet.combatStance === "aggressive"
    || fleet.combatStance === "hunt"
    || fleet.combatStance === "defendSystem"
    || fleet.combatStance === "guardArea"
    || fleet.combatStance === "holdPosition";
}

function canFleetStartCombat(fleet: GameFleet): boolean {
  return canFleetInitiateCombat(fleet) || fleet.alertMode;
}

function canFleetEngageFleet(fleet: GameFleet, target: GameFleet, shipsById: Map<string, GameShip>): boolean {
  if (!isHostileOwner(fleet.ownerId, target.ownerId)) return false;
  if (!canFleetStartCombat(fleet) && !canFleetStartCombat(target)) return false;
  return engagementProfilesCanInteract(
    getFleetEngagementProfiles(fleet, shipsById),
    getFleetEngagementProfiles(target, shipsById),
  );
}

function canFleetEngageStarbase(fleet: GameFleet, starbase: ServerStarbase, shipsById: Map<string, GameShip>): boolean {
  if (!isHostileOwner(fleet.ownerId, starbase.ownerId)) return false;
  if (!canFleetInitiateCombat(fleet) && starbase.status !== "online") return false;
  const starbaseRange = getMaxWeaponSystemRange(getStarbaseWeaponMounts(starbase));
  return engagementProfilesCanInteract(
    getFleetEngagementProfiles(fleet, shipsById),
    [{ position: starbase.systemPosition, range: starbaseRange }],
  );
}

function findInitialFleetEngagement(
  fleetsAtStar: GameFleet[],
  shipsById: Map<string, GameShip>,
): { attacker: GameFleet; defender: GameFleet } | null {
  for (let i = 0; i < fleetsAtStar.length; i += 1) {
    const left = fleetsAtStar[i];
    for (let j = i + 1; j < fleetsAtStar.length; j += 1) {
      const right = fleetsAtStar[j];
      if (!isHostileOwner(left.ownerId, right.ownerId)) continue;
      if (!canFleetEngageFleet(left, right, shipsById)) continue;
      if (canFleetStartCombat(left) && !canFleetStartCombat(right)) return { attacker: left, defender: right };
      if (canFleetStartCombat(right) && !canFleetStartCombat(left)) return { attacker: right, defender: left };
      return { attacker: left, defender: right };
    }
  }
  return null;
}

function findInitialStarbaseEngagement(
  starId: number,
  fleetsAtStar: GameFleet[],
  shipsById: Map<string, GameShip>,
): { fleet: GameFleet; starbase: ServerStarbase } | null {
  const starbase = state.starbases.find((candidate) => candidate.starId === starId && candidate.status === "online") ?? null;
  if (!starbase) return null;
  for (const fleet of fleetsAtStar) {
    if (canFleetEngageStarbase(fleet, starbase, shipsById)) return { fleet, starbase };
  }
  return null;
}

function canFleetJoinExistingBattle(
  battle: GameBattle,
  fleet: GameFleet,
  shipsById: Map<string, GameShip>,
  fleetsById: Map<string, GameFleet>,
): boolean {
  if (!fleet.shipIds.some((shipId) => shipsById.has(shipId))) return false;
  return battle.participants.some((participant) => {
    if (!isHostileOwner(participant.ownerId, fleet.ownerId)) return false;
    if (participant.sourceType === "fleet") {
      const participantFleet = fleetsById.get(participant.sourceId);
      return !!participantFleet && canFleetEngageFleet(fleet, participantFleet, shipsById);
    }
    if (participant.sourceType === "starbase") {
      const starbase = state.starbases.find((candidate) => candidate.id === participant.sourceId) ?? null;
      return !!starbase && canFleetEngageStarbase(fleet, starbase, shipsById);
    }
    return false;
  });
}

function createBattleParticipantStatsRecord(battle: GameBattle, participantId: string, ownerId: number): void {
  battle.stats.byParticipant[participantId] ??= createEmptyParticipantStats();
  battle.stats.byOwner[String(ownerId)] ??= createEmptyParticipantStats();
}

function getFleetParticipantId(fleetId: string): string {
  return `fleet:${fleetId}`;
}

function getStarbaseParticipantId(starbaseId: string): string {
  return `starbase:${starbaseId}`;
}

function isHostileOwner(ownerA: number, ownerB: number): boolean {
  return ownerA !== ownerB;
}

function buildHostilityEdges(participants: BattleParticipant[]): BattleHostilityEdge[] {
  const edges: BattleHostilityEdge[] = [];
  for (let i = 0; i < participants.length; i += 1) {
    for (let j = i + 1; j < participants.length; j += 1) {
      const a = participants[i];
      const b = participants[j];
      edges.push({
        participantAId: a.id,
        participantBId: b.id,
        hostile: isHostileOwner(a.ownerId, b.ownerId),
      });
    }
  }
  return edges;
}

function areParticipantsHostile(battle: GameBattle, participantAId: string, participantBId: string): boolean {
  if (participantAId === participantBId) return false;
  const edge = battle.hostility.find((candidate) => (
    (candidate.participantAId === participantAId && candidate.participantBId === participantBId)
    || (candidate.participantAId === participantBId && candidate.participantBId === participantAId)
  ));
  if (edge) return edge.hostile;
  const a = battle.participants.find((participant) => participant.id === participantAId);
  const b = battle.participants.find((participant) => participant.id === participantBId);
  return !!a && !!b && isHostileOwner(a.ownerId, b.ownerId);
}

function rangeBandToBattleZone(side: BattleSide, rangeBand: RangeBand): BattleZone {
  const index = RANGE_BAND_INDEX[rangeBand];
  if (side === "attacker") {
    if (index >= RANGE_BAND_INDEX.extreme) return 3;
    if (index >= RANGE_BAND_INDEX.medium) return 2;
    return 1;
  }
  if (index >= RANGE_BAND_INDEX.extreme) return 0;
  if (index >= RANGE_BAND_INDEX.medium) return 1;
  return 2;
}

function getBattleSideForParticipant(battle: GameBattle, participantId: string): BattleSide {
  const participant = battle.participants.find((candidate) => candidate.id === participantId);
  if (!participant) return "defender";
  if (participant.sourceType === "fleet" && battle.attackerFleetIds.includes(participant.sourceId)) return "attacker";
  if (participant.ownerId === battle.attackerFactionId) return "attacker";
  return "defender";
}

function getGroupRoleForRange(rangeBand: RangeBand): CombatGroup["role"] {
  if (rangeBand === "long" || rangeBand === "extreme") return "artillery";
  if (rangeBand === "close" || rangeBand === "pointBlank") return "screen";
  return "line";
}

function getCombatGroupHealthRatio(group: Pick<CombatGroup, "shipIds">, battle: GameBattle): number {
  const shipStates = group.shipIds
    .map((shipId) => battle.ships.find((ship) => ship.shipId === shipId))
    .filter((ship): ship is ServerBattleShipState => !!ship && !ship.destroyed);
  if (shipStates.length === 0) return 0;
  const current = shipStates.reduce((total, ship) => total + ship.shield + ship.armor + ship.hull, 0);
  const max = shipStates.reduce((total, ship) => total + ship.maxShield + ship.maxArmor + ship.maxHull, 0);
  return max > 0 ? clamp(current / max, 0, 1) : 0;
}

function getCombatGroupWeaponRangeSummary(mounts: WeaponMountDefinition[]): { minWeaponRange: number; maxWeaponRange: number } {
  if (mounts.length === 0) return { minWeaponRange: 0, maxWeaponRange: 0 };
  return {
    minWeaponRange: mounts.reduce((min, mount) => Math.min(min, getWeaponMinSystemRange(mount)), Number.POSITIVE_INFINITY),
    maxWeaponRange: getMaxWeaponSystemRange(mounts),
  };
}

function shouldBattleGroupRetreat(group: CombatGroup): boolean {
  if (group.retreatPolicy?.mode !== "hpPercent") return false;
  const threshold = clamp(Number(group.retreatPolicy.thresholdPercent ?? 0), 0, 100) / 100;
  return threshold > 0 && group.hpRatio <= threshold;
}

function syncBattleParticipants(
  battle: GameBattle,
  fleetsById: Map<string, GameFleet>,
  starbaseEntity: ServerStarbase | null,
): void {
  const existing = new Map(battle.participants.map((participant) => [participant.id, participant]));
  const next: BattleParticipant[] = [];
  for (const fleetId of [...battle.attackerFleetIds, ...battle.defenderFleetIds]) {
    const fleet = fleetsById.get(fleetId);
    if (!fleet) continue;
    const participantId = getFleetParticipantId(fleet.id);
    const retreatState = fleet.retreatState
      ? {
        mode: fleet.retreatState.mode,
        status: fleet.retreatState.status,
        targetStarId: fleet.retreatState.targetStarId,
        startedAtYear: fleet.retreatState.startedAtYear,
        miaUntilYear: fleet.retreatState.miaUntilYear ?? null,
      }
      : null;
    const previous = existing.get(participantId);
    next.push({
      id: participantId,
      sourceId: fleet.id,
      sourceType: "fleet",
      ownerId: fleet.ownerId,
      stance: fleet.combatStance,
      canInitiateCombat: fleet.combatStance !== "passive" && fleet.combatStance !== "evade",
      canBeTargeted: true,
      canMove: true,
      canRetreat: true,
      hostileParticipantIds: previous?.hostileParticipantIds ?? [],
      retreatState,
      status: battle.retreatingFleetIds.includes(fleet.id) ? "retreating" : previous?.status ?? "active",
    });
    createBattleParticipantStatsRecord(battle, participantId, fleet.ownerId);
  }

  if (starbaseEntity && battle.starbase && !battle.starbase.destroyed) {
    const participantId = getStarbaseParticipantId(starbaseEntity.id);
    const previous = existing.get(participantId);
    next.push({
      id: participantId,
      sourceId: starbaseEntity.id,
      sourceType: "starbase",
      ownerId: starbaseEntity.ownerId,
      stance: "holdPosition",
      canInitiateCombat: true,
      canBeTargeted: true,
      canMove: false,
      canRetreat: false,
      hostileParticipantIds: previous?.hostileParticipantIds ?? [],
      retreatState: null,
      status: battle.starbase.destroyed ? "destroyed" : "active",
    });
    createBattleParticipantStatsRecord(battle, participantId, starbaseEntity.ownerId);
  }

  battle.participants = next;
  battle.hostility = buildHostilityEdges(next);
  for (const participant of battle.participants) {
    participant.hostileParticipantIds = battle.participants
      .filter((candidate) => areParticipantsHostile(battle, participant.id, candidate.id))
      .map((candidate) => candidate.id);
  }
}

function buildBattleCombatGroups(
  battle: GameBattle,
  shipsById: Map<string, GameShip>,
  fleetsById: Map<string, GameFleet>,
  starbaseEntity: ServerStarbase | null,
): CombatGroup[] {
  const previousGroups = new Map(battle.combatGroups.map((group) => [group.id, group]));
  const groups: CombatGroup[] = [];
  const livingShips = battle.ships.filter((shipState) => !shipState.destroyed);
  const shipStatesById = new Map(livingShips.map((shipState) => [shipState.shipId, shipState]));
  const shipsByFleet = new Map<string, ServerBattleShipState[]>();
  for (const shipState of livingShips) {
    const list = shipsByFleet.get(shipState.fleetId) ?? [];
    list.push(shipState);
    shipsByFleet.set(shipState.fleetId, list);
  }

  for (const [fleetId, shipStates] of shipsByFleet) {
    const fleet = fleetsById.get(fleetId);
    if (!fleet) continue;
    const participantId = getFleetParticipantId(fleetId);
    deployFleetBattleGroups(fleet);
    const configuredGroups = fleet.battleGroups.length > 0
      ? fleet.battleGroups
      : createAutoBattleGroupsForShips(state, fleet, shipStates.map((shipState) => shipsById.get(shipState.shipId)).filter((ship): ship is GameShip => !!ship));

    for (const config of configuredGroups) {
      const chunk = config.shipIds
        .map((shipId) => shipStatesById.get(shipId))
        .filter((shipState): shipState is ServerBattleShipState => !!shipState && shipState.fleetId === fleetId);
      if (chunk.length === 0) continue;
      const firstShip = shipsById.get(chunk[0]?.shipId ?? "");
      if (!firstShip) continue;
      const design = getShipDesignForShip(firstShip);
      const shipKind = design.shipKind;
      const designStats = calculateShipDesignStats(design);
      const maxGroupSize = getCombatGroupMaxSize(shipKind);
      const mounts = designStats.combat.weaponMounts;
      const preferredRangeBand = getPreferredRangeBand(mounts);
      const behavior = config.behavior;
      const groupId = config.id;
      const previous = previousGroups.get(groupId);
      const fleetRetreating = battle.retreatingFleetIds.includes(fleetId) || fleet.combatSettings.retreatOrder === "retreat";
      const manualRetreat = config.currentOrder?.type === "retreat";
      const hpRatio = getCombatGroupHealthRatio({ shipIds: chunk.map((ship) => ship.shipId) }, battle);
      const retreatState = fleet.retreatState
        ? {
          mode: fleet.retreatState.mode,
          status: fleet.retreatState.status,
          targetStarId: fleet.retreatState.targetStarId,
          startedAtYear: fleet.retreatState.startedAtYear,
          miaUntilYear: fleet.retreatState.miaUntilYear ?? null,
        }
        : null;
      const status: CombatGroup["status"] = previous?.status === "escaped" || previous?.status === "destroyed"
        ? previous.status
        : (fleetRetreating || manualRetreat ? "retreating" : "active");
      const position = previous?.position
        ?? config.deployedPosition
        ?? config.originPosition
        ?? getFleetAuthoritativeSystemPosition(fleet);
      const originPosition = previous?.originPosition
        ?? config.originPosition
        ?? position;
      const rangeSummary = getCombatGroupWeaponRangeSummary(mounts);
      const group: CombatGroup = {
        id: groupId,
        battleId: battle.id,
        participantId,
        sourceObjectId: fleetId,
        sourceFleetId: fleetId,
        ownerId: fleet.ownerId,
        shipKind,
        shipDesignId: design.id,
        shipIds: chunk.map((ship) => ship.shipId),
        count: chunk.length,
        maxGroupSize,
        weaponIds: mounts.map((mount) => getWeaponId(mount)),
        role: behavior ?? getGroupRoleForRange(preferredRangeBand),
        behavior,
        preferredRangeBand,
        targetGroupId: previous?.targetGroupId ?? null,
        currentRangeBand: previous?.currentRangeBand ?? "outOfRange",
        movementProgress: previous?.movementProgress ?? 0,
        speed: fleet.speed,
        retreatState,
        status,
        position: cloneSystemPosition(position),
        destination: previous?.destination ?? config.currentOrder?.targetPosition ?? null,
        originPosition: cloneSystemPosition(originPosition),
        leashRadius: config.leashRadius ?? (behavior === "defender" ? DEFENDER_BATTLE_GROUP_LEASH_RADIUS : DEFAULT_BATTLE_GROUP_LEASH_RADIUS),
        currentOrder: config.currentOrder ?? null,
        chaseSetting: config.chaseSetting,
        retreatPolicy: config.retreatPolicy,
        retreatDestination: config.retreatDestination ?? null,
        protectedTarget: config.protectedTarget ?? null,
        maxWeaponRange: rangeSummary.maxWeaponRange,
        minWeaponRange: Number.isFinite(rangeSummary.minWeaponRange) ? rangeSummary.minWeaponRange : 0,
        hpRatio,
      };
      if (status === "active" && shouldBattleGroupRetreat(group)) {
        group.status = "retreating";
        group.currentOrder = { type: "retreat", issuedAtYear: state.clock.year };
      }
      groups.push(group);
      const side = getBattleSideForParticipant(battle, participantId);
      const zone = rangeBandToBattleZone(side, group.currentRangeBand);
      for (const shipState of chunk) {
        shipState.participantId = participantId;
        shipState.groupId = groupId;
        shipState.rangeBand = group.currentRangeBand;
        shipState.zone = zone;
      }
    }
  }

  if (starbaseEntity && battle.starbase && !battle.starbase.destroyed) {
    const participantId = getStarbaseParticipantId(starbaseEntity.id);
    const groupId = `group:starbase:${starbaseEntity.id}`;
    const previous = previousGroups.get(groupId);
    const mounts = getStarbaseWeaponMounts(starbaseEntity);
    const rangeSummary = getCombatGroupWeaponRangeSummary(mounts);
    groups.push({
      id: groupId,
      battleId: battle.id,
      participantId,
      sourceObjectId: starbaseEntity.id,
      sourceFleetId: null,
      ownerId: starbaseEntity.ownerId,
      shipKind: null,
      shipDesignId: null,
      shipIds: [],
      count: 1,
      maxGroupSize: 1,
      weaponIds: mounts.map((mount) => getWeaponId(mount)),
      role: "station",
      behavior: "station",
      preferredRangeBand: getPreferredRangeBand(mounts),
      targetGroupId: previous?.targetGroupId ?? null,
      currentRangeBand: previous?.currentRangeBand ?? "outOfRange",
      movementProgress: 0,
      speed: 0,
      retreatState: null,
      status: "active",
      position: cloneSystemPosition(starbaseEntity.systemPosition ?? getSystemStarbasePosition()),
      destination: null,
      originPosition: cloneSystemPosition(starbaseEntity.systemPosition ?? getSystemStarbasePosition()),
      leashRadius: 0,
      currentOrder: null,
      chaseSetting: "none",
      retreatPolicy: { mode: "none", thresholdPercent: null },
      retreatDestination: null,
      protectedTarget: null,
      maxWeaponRange: rangeSummary.maxWeaponRange,
      minWeaponRange: Number.isFinite(rangeSummary.minWeaponRange) ? rangeSummary.minWeaponRange : 0,
      hpRatio: battle.starbase.maxShield + battle.starbase.maxArmor + battle.starbase.maxHull > 0
        ? clamp((battle.starbase.shield + battle.starbase.armor + battle.starbase.hull) / (battle.starbase.maxShield + battle.starbase.maxArmor + battle.starbase.maxHull), 0, 1)
        : 0,
    });
    battle.starbase.participantId = participantId;
    battle.starbase.groupId = groupId;
    battle.starbase.rangeBand = previous?.currentRangeBand ?? "long";
    battle.starbase.zone = 0;
  }

  return groups;
}

function getCombatGroupWeaponMounts(
  group: CombatGroup,
  shipsById: Map<string, GameShip>,
  starbaseEntity: ServerStarbase | null,
): WeaponMountDefinition[] {
  if (group.shipIds.length > 0) {
    const ship = shipsById.get(group.shipIds[0]);
    return ship ? calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts : [];
  }
  if (starbaseEntity && group.sourceObjectId === starbaseEntity.id) return getStarbaseWeaponMounts(starbaseEntity);
  return [];
}

function getGroupTargetEntityId(group: CombatGroup, targetGroup: CombatGroup | undefined, battle: GameBattle): string | null {
  if (!targetGroup) return null;
  if (targetGroup.shipIds.length > 0) {
    const targetStates = targetGroup.shipIds
      .map((shipId) => battle.ships.find((ship) => ship.shipId === shipId))
      .filter((ship): ship is ServerBattleShipState => !!ship && !ship.destroyed);
    targetStates.sort((a, b) => {
      const damagedDelta = (a.hull / Math.max(1, a.maxHull)) - (b.hull / Math.max(1, b.maxHull));
      if (Math.abs(damagedDelta) > 0.001) return damagedDelta;
      return a.shipId.localeCompare(b.shipId);
    });
    return targetStates[0]?.shipId ?? null;
  }
  if (battle.starbase && targetGroup.sourceObjectId === battle.starbase.starbaseId && !battle.starbase.destroyed) {
    return battle.starbase.starbaseId;
  }
  return group.targetGroupId ?? null;
}

function getProtectedTargetPosition(
  group: CombatGroup,
  groups: CombatGroup[],
  battle: GameBattle,
): ReturnType<typeof systemCenterPosition> | null {
  const protectedTarget = group.currentOrder?.protectedTarget ?? group.protectedTarget;
  if (!protectedTarget) return null;
  if (protectedTarget.position) return cloneSystemPosition(protectedTarget.position);
  if (protectedTarget.kind === "battleGroup" && protectedTarget.id) {
    const target = groups.find((candidate) => candidate.id === protectedTarget.id);
    return target ? cloneSystemPosition(target.position) : null;
  }
  if (protectedTarget.kind === "starbase" && protectedTarget.id && battle.starbase?.starbaseId === protectedTarget.id) {
    const starbaseGroup = groups.find((candidate) => candidate.sourceObjectId === protectedTarget.id);
    return starbaseGroup ? cloneSystemPosition(starbaseGroup.position) : null;
  }
  return null;
}

function isTargetGroupInWeaponRange(group: CombatGroup, target: CombatGroup, mounts: WeaponMountDefinition[]): boolean {
  const distance = distance3(group.position, target.position);
  return mounts.some((mount) => weaponCanFireAtDistance(mount, distance));
}

function scoreTargetGroup(
  group: CombatGroup,
  target: CombatGroup,
  groups: CombatGroup[],
  mounts: WeaponMountDefinition[],
  battle: GameBattle,
): number {
  const distance = distance3(group.position, target.position);
  const inRange = isTargetGroupInWeaponRange(group, target, mounts);
  const damagedScore = (1 - target.hpRatio) * 35;
  const countScore = Math.min(40, target.count * 2);
  let score = 120 - distance + damagedScore + countScore;
  if (inRange) score += 90;

  const explicitTarget = group.currentOrder?.type === "attack"
    && (
      group.currentOrder.targetGroupId === target.id
      || group.currentOrder.targetObjectId === target.sourceObjectId
      || group.currentOrder.targetObjectId === target.sourceFleetId
    );
  if (explicitTarget) score += 250;

  const protectedPosition = getProtectedTargetPosition(group, groups, battle);
  switch (group.behavior) {
    case "screen":
      if (protectedPosition) {
        const threatDistance = distance3(target.position, protectedPosition);
        score += Math.max(0, 90 - threatDistance * 2);
      }
      if (target.behavior === "brawler" || target.behavior === "screen") score += 25;
      score += Math.max(0, 60 - distance);
      break;
    case "brawler":
      score += Math.max(0, 80 - distance * 1.4);
      score += damagedScore;
      break;
    case "line":
      if (distance <= group.maxWeaponRange) score += 45;
      if (distance3(target.position, group.originPosition) <= group.leashRadius + 16) score += 35;
      if (target.behavior === "screen" || target.behavior === "brawler") score += 15;
      break;
    case "artillery":
      if (target.role === "station") score += 140;
      if (target.shipKind && target.count >= 8) score += 35;
      if (target.behavior === "artillery" || target.behavior === "defender") score += 30;
      if (distance >= group.minWeaponRange && distance <= group.maxWeaponRange) score += 55;
      if (target.behavior === "screen" && target.hpRatio > 0.6) score -= 25;
      break;
    case "defender":
      if (distance3(target.position, group.originPosition) <= group.leashRadius) score += 110;
      if (target.behavior === "artillery") score += 35;
      if (protectedPosition) score += Math.max(0, 80 - distance3(target.position, protectedPosition) * 1.5);
      break;
    case "station":
      score += Math.max(0, 90 - distance);
      if (target.behavior === "artillery") score += 35;
      break;
    default:
      break;
  }
  return score;
}

function selectTargetGroup(
  group: CombatGroup,
  groups: CombatGroup[],
  mounts: WeaponMountDefinition[],
  battle: GameBattle,
): CombatGroup | null {
  const hostileGroups = groups.filter((candidate) => (
    candidate.id !== group.id
    && candidate.status !== "destroyed"
    && candidate.status !== "escaped"
    && candidate.count > 0
    && areParticipantsHostile(battle, group.participantId, candidate.participantId)
  ));
  if (hostileGroups.length === 0) return null;
  hostileGroups.sort((a, b) => (
    scoreTargetGroup(group, b, groups, mounts, battle) - scoreTargetGroup(group, a, groups, mounts, battle)
    || a.id.localeCompare(b.id)
  ));
  return hostileGroups[0] ?? null;
}

function getDesiredRangeDistance(group: CombatGroup): number {
  if (group.behavior === "brawler" || group.behavior === "screen") {
    return Math.max(3, Math.min(12, group.maxWeaponRange * 0.55));
  }
  if (group.behavior === "line") {
    return Math.max(12, group.maxWeaponRange * 0.75);
  }
  if (group.behavior === "artillery") {
    return Math.max(group.minWeaponRange + 4, group.maxWeaponRange * 0.92);
  }
  if (group.behavior === "defender") {
    return Math.max(10, group.maxWeaponRange * 0.65);
  }
  return Math.max(6, group.maxWeaponRange * 0.75);
}

function positionAtRangeFromTarget(
  current: ReturnType<typeof systemCenterPosition>,
  target: ReturnType<typeof systemCenterPosition>,
  desiredDistance: number,
): ReturnType<typeof systemCenterPosition> {
  const dx = current.x - target.x;
  const dz = current.z - target.z;
  const distance = Math.hypot(dx, dz);
  const ux = distance <= 0.0001 ? 1 : dx / distance;
  const uz = distance <= 0.0001 ? 0 : dz / distance;
  return { x: target.x + ux * desiredDistance, y: SYSTEM_FLEET_Y, z: target.z + uz * desiredDistance };
}

function getRetreatDestinationForGroup(group: CombatGroup, groups: CombatGroup[]): ReturnType<typeof systemCenterPosition> {
  const nearestHostile = groups
    .filter((candidate) => candidate.ownerId !== group.ownerId && candidate.status !== "destroyed" && candidate.status !== "escaped")
    .sort((a, b) => distance3(group.position, a.position) - distance3(group.position, b.position))[0];
  const awayFrom = nearestHostile?.position ?? group.originPosition;
  const dx = group.position.x - awayFrom.x;
  const dz = group.position.z - awayFrom.z;
  const distance = Math.hypot(dx, dz);
  const ux = distance <= 0.0001 ? 1 : dx / distance;
  const uz = distance <= 0.0001 ? 0 : dz / distance;
  return {
    x: group.originPosition.x + ux * RETREAT_ESCAPE_DISTANCE,
    y: SYSTEM_FLEET_Y,
    z: group.originPosition.z + uz * RETREAT_ESCAPE_DISTANCE,
  };
}

function resolveBattleGroupDestination(
  group: CombatGroup,
  target: CombatGroup | null,
  groups: CombatGroup[],
  battle: GameBattle,
): ReturnType<typeof systemCenterPosition> | null {
  if (group.status === "retreating" || group.currentOrder?.type === "retreat") {
    return getRetreatDestinationForGroup(group, groups);
  }
  if (group.currentOrder?.type === "hold") return group.position;
  if (group.currentOrder?.type === "move" && group.currentOrder.targetPosition) {
    return cloneSystemPosition(group.currentOrder.targetPosition);
  }
  if (group.currentOrder?.type === "protect") {
    const protectedPosition = getProtectedTargetPosition(group, groups, battle);
    if (protectedPosition && target) {
      return movePointToward(protectedPosition, target.position, Math.min(14, distance3(protectedPosition, target.position) * 0.45));
    }
    return protectedPosition;
  }
  if (!target) {
    if (group.behavior === "line" || group.behavior === "artillery" || group.behavior === "defender") return group.originPosition;
    return null;
  }

  if (group.behavior === "artillery") {
    const distance = distance3(group.position, target.position);
    if (distance >= group.minWeaponRange && distance <= group.maxWeaponRange) return group.originPosition;
    return positionAtRangeFromTarget(group.position, target.position, getDesiredRangeDistance(group));
  }
  if (group.behavior === "defender") {
    if (distance3(target.position, group.originPosition) > group.leashRadius + 8) return group.originPosition;
    return positionAtRangeFromTarget(group.position, target.position, getDesiredRangeDistance(group));
  }
  if (group.behavior === "line") {
    const desired = positionAtRangeFromTarget(group.position, target.position, getDesiredRangeDistance(group));
    return clampPositionToLeash(desired, group.originPosition, group.leashRadius);
  }
  return positionAtRangeFromTarget(group.position, target.position, getDesiredRangeDistance(group));
}

function canBattleGroupLeaveLeash(group: CombatGroup): boolean {
  if (group.status === "retreating" || group.currentOrder?.type === "retreat") return true;
  if (group.currentOrder?.type === "move") return true;
  if (group.currentOrder?.type === "attack") return group.chaseSetting !== "none";
  return group.chaseSetting !== "none";
}

function persistCombatGroupPosition(group: CombatGroup, fleetsById: Map<string, GameFleet>): void {
  if (!group.sourceFleetId) return;
  const fleet = fleetsById.get(group.sourceFleetId);
  const config = fleet?.battleGroups.find((candidate) => candidate.id === group.id);
  if (!config) return;
  config.deployedPosition = cloneSystemPosition(group.position);
  config.originPosition = cloneSystemPosition(group.originPosition);
  config.leashRadius = group.leashRadius;
  config.currentOrder = group.currentOrder ?? null;
}

function updateCombatGroupsAndTargets(
  battle: GameBattle,
  shipsById: Map<string, GameShip>,
  fleetsById: Map<string, GameFleet>,
  starbaseEntity: ServerStarbase | null,
  elapsedDays: number,
): void {
  syncBattleParticipants(battle, fleetsById, starbaseEntity);
  let groups = buildBattleCombatGroups(battle, shipsById, fleetsById, starbaseEntity);
  const step = Math.max(0.05, elapsedDays) * BATTLE_GROUP_SPEED_UNITS_PER_DAY;

  for (const group of groups) {
    if (group.status === "destroyed" || group.status === "escaped") continue;
    const mounts = getCombatGroupWeaponMounts(group, shipsById, starbaseEntity);
    const target = group.status === "retreating" ? null : selectTargetGroup(group, groups, mounts, battle);
    group.targetGroupId = target?.id ?? null;
    const distanceToTarget = target ? distance3(group.position, target.position) : Number.POSITIVE_INFINITY;
    group.currentRangeBand = rangeBandForSystemDistance(distanceToTarget);

    if (group.role !== "station") {
      const destination = resolveBattleGroupDestination(group, target, groups, battle);
      group.destination = destination ? cloneSystemPosition(destination) : null;
      if (destination) {
        let nextPosition = movePointToward(group.position, destination, step * Math.max(0.2, group.speed));
        if (!canBattleGroupLeaveLeash(group)) {
          nextPosition = clampPositionToLeash(nextPosition, group.originPosition, group.leashRadius);
        }
        group.movementProgress = distance3(group.position, nextPosition);
        group.position = nextPosition;
      }
      if (group.status === "retreating" && distance3(group.position, group.originPosition) >= RETREAT_ESCAPE_DISTANCE - 1) {
        group.status = "escaped";
      }
      persistCombatGroupPosition(group, fleetsById);
    }
    if (target) {
      group.currentRangeBand = rangeBandForSystemDistance(distance3(group.position, target.position));
    }
  }

  const groupById = new Map(groups.map((group) => [group.id, group]));
  for (const shipState of battle.ships) {
    if (shipState.destroyed || !shipState.groupId) continue;
    const group = groupById.get(shipState.groupId);
    if (!group) continue;
    const targetGroup = group.targetGroupId ? groupById.get(group.targetGroupId) : undefined;
    shipState.targetId = getGroupTargetEntityId(group, targetGroup, battle);
    shipState.rangeBand = group.currentRangeBand;
    shipState.zone = rangeBandToBattleZone(shipState.side, group.currentRangeBand);
  }

  if (battle.starbase?.groupId) {
    const group = groupById.get(battle.starbase.groupId);
    const targetGroup = group?.targetGroupId ? groupById.get(group.targetGroupId) : undefined;
    battle.starbase.rangeBand = group?.currentRangeBand ?? battle.starbase.rangeBand;
    battle.starbase.zone = 0;
    if (group) {
      const targetId = getGroupTargetEntityId(group, targetGroup, battle);
      if (targetId) {
        // Starbases use this local target during the station firing pass.
        group.targetGroupId = targetGroup?.id ?? group.targetGroupId;
      }
    }
  }

  groups = groups.map((group) => ({
    ...group,
    count: group.shipIds.length > 0
      ? group.shipIds.filter((shipId) => !battle.ships.find((ship) => ship.shipId === shipId)?.destroyed).length
      : group.count,
    hpRatio: group.shipIds.length > 0 ? getCombatGroupHealthRatio(group, battle) : group.hpRatio,
  }));
  battle.combatGroups = groups.filter((group) => group.count > 0 || group.role === "station");
}

function recordBattleShot(
  battle: GameBattle,
  actorParticipantId: string,
  actorOwnerId: number,
  targetParticipantId: string | undefined,
  targetOwnerId: number | undefined,
  mount: WeaponMountDefinition,
  roll: { hit: boolean; accuracyMiss: boolean; dodged: boolean },
  damage = createEmptyLayerDamage(),
  killed = false,
): void {
  const actorStats = ensureParticipantStats(battle.stats, actorParticipantId);
  const actorOwnerStats = ensureOwnerStats(battle.stats, actorOwnerId);
  const weaponStats = ensureWeaponStats(battle.stats, actorParticipantId, mount);
  actorStats.shotsFired += 1;
  actorOwnerStats.shotsFired += 1;
  weaponStats.shotsFired += 1;

  if (roll.hit) {
    actorStats.shotsHit += 1;
    actorOwnerStats.shotsHit += 1;
    weaponStats.shotsHit += 1;
    addLayerDamage(actorStats.damageDealt, damage);
    addLayerDamage(actorOwnerStats.damageDealt, damage);
    weaponStats.damageDealt += damage.shield + damage.armor + damage.hull;
  } else if (roll.dodged) {
    actorStats.shotsDodged += 1;
    actorOwnerStats.shotsDodged += 1;
  } else {
    actorStats.shotsMissed += 1;
    actorOwnerStats.shotsMissed += 1;
  }

  if (targetParticipantId && targetOwnerId !== undefined && roll.hit) {
    const targetStats = ensureParticipantStats(battle.stats, targetParticipantId);
    const targetOwnerStats = ensureOwnerStats(battle.stats, targetOwnerId);
    addLayerDamage(targetStats.damageReceived, damage);
    addLayerDamage(targetOwnerStats.damageReceived, damage);
    if (killed) {
      actorStats.shipsDestroyed += 1;
      actorOwnerStats.shipsDestroyed += 1;
      targetStats.shipsLost += 1;
      targetOwnerStats.shipsLost += 1;
      weaponStats.kills += 1;
    }
  }
}

function computeStartingHullForFleet(fleet: GameFleet, shipsById: Map<string, GameShip>): number {
  let total = 0;
  for (const shipId of fleet.shipIds) {
    const ship = shipsById.get(shipId);
    if (!ship) continue;
    total += ship.maxHull;
  }
  return Math.max(1, total);
}

function addFleetToBattle(
  battle: GameBattle,
  fleet: GameFleet,
  side: BattleSide,
  shipsById: Map<string, GameShip>,
): void {
  if (side === "attacker") {
    if (!battle.attackerFleetIds.includes(fleet.id)) battle.attackerFleetIds.push(fleet.id);
  } else {
    if (!battle.defenderFleetIds.includes(fleet.id)) battle.defenderFleetIds.push(fleet.id);
  }

  if (!battle.fleetStartingHull[fleet.id]) {
    battle.fleetStartingHull[fleet.id] = computeStartingHullForFleet(fleet, shipsById);
  }

  const shipIds = fleet.shipIds;
  const zones = getFormationZones(fleet.formation, side, shipIds.length);
  shipIds.forEach((shipId, index) => {
    if (battle.ships.some((existing) => existing.shipId === shipId)) return;
    const ship = shipsById.get(shipId);
    if (!ship) return;
    battle.ships.push(buildBattleShipState(ship, side, zones[index] ?? zones[0] ?? 0));
    if (!battle.participantShipIds.includes(shipId)) {
      battle.participantShipIds.push(shipId);
    }
  });
}

function shouldResolveBattle(battle: GameBattle): { resolved: boolean; winner: BattleSide | null } {
  const attackers = battle.ships.filter((ship) => ship.side === "attacker" && !ship.destroyed);
  const defenders = battle.ships.filter((ship) => ship.side === "defender" && !ship.destroyed);
  const starbaseAlive = !!battle.starbase && !battle.starbase.destroyed;
  if (attackers.length === 0 && (defenders.length > 0 || starbaseAlive)) {
    return { resolved: true, winner: "defender" };
  }
  if (defenders.length === 0 && !starbaseAlive && attackers.length > 0) {
    return { resolved: true, winner: "attacker" };
  }
  if (attackers.length === 0 && defenders.length === 0 && !starbaseAlive) {
    return { resolved: true, winner: "attacker" };
  }
  return { resolved: false, winner: null };
}

function normalizeBattleRuntimeFields(battle: GameBattle): void {
  const mutable = battle as Partial<GameBattle>;
  mutable.startedAtYear ??= state.clock.year;
  mutable.lastTickYear ??= state.clock.year;
  mutable.participants ??= [];
  mutable.combatGroups ??= [];
  mutable.hostility ??= [];
  mutable.stats ??= createEmptyBattleStats();
  mutable.retreatingFleetIds ??= [];
  mutable.fleetStartingHull ??= {};
  mutable.participantShipIds ??= [];
  if (!battle.stats.byParticipant) battle.stats.byParticipant = {};
  if (!battle.stats.byOwner) battle.stats.byOwner = {};
  if (!battle.stats.weapons) battle.stats.weapons = {};
}

function resetFleetForBattle(fleet: GameFleet): void {
  const currentPosition = getFleetAuthoritativeSystemPosition(fleet);
  fleet.orderType = null;
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.movementPlan = null;
  clearFleetOrbit(fleet);
  setFleetPhase(fleet, "idle");
  fleet.hyperlanePosition = null;
  fleet.systemPosition = currentPosition;
  deployFleetBattleGroups(fleet);
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

function resolveBattleGroupRetreatDestinationForFleet(
  fleet: GameFleet,
  groupDestination: BattleGroupRetreatDestination | null | undefined,
): { targetStarId: number; targetSystemPosition?: ReturnType<typeof systemCenterPosition> | null } {
  const destination = groupDestination ?? fleet.combatSettings.retreatDestination ?? { kind: "nearestFriendlyStarbase" as const };
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
    resetFleetForBattle(fleet);
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

function positionAtEffectiveRangeFromTarget(
  source: ContinuousCombatActor,
  target: ContinuousCombatActor,
  desiredEffectiveDistance: number,
): ReturnType<typeof systemCenterPosition> {
  return positionAtRangeFromTarget(source.position, target.position, desiredEffectiveDistance + source.radius + target.radius);
}

function retreatFleetByDoctrine(fleet: GameFleet): boolean {
  if (fleet.retreatState) return false;
  const destination = resolveBattleGroupRetreatDestinationForFleet(fleet, null);
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
  const step = Math.max(0, elapsedDays) * SYSTEM_FLEET_SPEED_UNITS_PER_DAY * Math.max(0.15, fleet.speed);
  if (step <= 0) return false;
  let destination: ReturnType<typeof systemCenterPosition> | null = null;
  if ((order?.type === "move" || order?.type === "guard") && order.targetPosition) {
    destination = cloneSystemPosition(order.targetPosition);
  } else if (fleet.combatStance === "evade" && target) {
    destination = positionAtRangeFromTarget(target.position, actor.position, FLEET_EVADE_DISTANCE + actor.radius + target.radius);
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
  return clamp(stats.combat.evasion + bonus, 0, 0.9);
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

function fireFleetWeaponsAtTarget(
  actor: Extract<ContinuousCombatActor, { kind: "fleet" }>,
  target: ContinuousCombatActor,
  shipsById: Map<string, GameShip>,
): { shipsChanged: boolean; starbasesChanged: boolean; contactsChanged: boolean } {
  let shipsChanged = false;
  let starbasesChanged = false;
  let contactsChanged = false;
  const distance = effectiveActorDistance(actor, target);
  for (const ship of getFleetLivingShips(actor.fleet, shipsById)) {
    const mounts = calculateShipDesignStats(getShipDesignForShip(ship)).combat.weaponMounts;
    ship.weaponCooldowns ??= {};
    for (let index = 0; index < mounts.length; index += 1) {
      const mount = mounts[index];
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
      if (roll.hit) {
        const result = applyWeaponHit(mount, targetLayer);
        shieldDamage = result.shieldDamage;
        armorDamage = result.armorDamage;
        hullDamage = result.hullDamage;
        destroyed = result.destroyed;
        if (targetShip) {
          targetShip.hp = targetShip.hull;
          shipsChanged = true;
        } else if (target.kind === "starbase") {
          target.starbase.lastShieldDamageAtYear = state.clock.year;
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
    }
  }
  return { shipsChanged, starbasesChanged, contactsChanged };
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
      const result = applyWeaponHit(mount, targetShip);
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
  visibilityChanged: boolean;
} {
  let combatContactsChanged = false;
  let shipsChanged = false;
  let fleetsChanged = false;
  let starbasesChanged = false;
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
      combatContactsChanged ||= result.contactsChanged;
      if (result.contactsChanged) {
        actor.fleet.combatStatus = "firing";
        actor.fleet.lastCombatAtYear = state.clock.year;
      }
      continue;
    }
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
  return { combatContactsChanged, shipsChanged, fleetsChanged, starbasesChanged, visibilityChanged };
}

function processBattles(arrivingFleets: GameFleet[]): {
  battlesChanged: boolean;
  shipsChanged: boolean;
  fleetsChanged: boolean;
  starbasesChanged: boolean;
  ownershipChanged: boolean;
  visibilityChanged: boolean;
} {
  let battlesChanged = false;
  let shipsChanged = false;
  let fleetsChanged = false;
  let starbasesChanged = false;
  let ownershipChanged = false;
  let visibilityChanged = false;

  const shipsById = new Map(state.ships.map((ship) => [ship.id, ship]));
  const fleetsById = new Map(state.fleets.map((fleet) => [fleet.id, fleet]));

  const arrivalsByStar = new Map<number, GameFleet[]>();
  for (const fleet of arrivingFleets) {
    const list = arrivalsByStar.get(fleet.currentStarId) ?? [];
    list.push(fleet);
    arrivalsByStar.set(fleet.currentStarId, list);
  }

  const candidateStarIds = new Set<number>(arrivalsByStar.keys());
  for (const fleet of state.fleets) {
    if (isFleetEligibleForSystemCombat(fleet)) candidateStarIds.add(fleet.currentStarId);
  }
  for (const starbase of state.starbases) {
    if (starbase.status === "online") candidateStarIds.add(starbase.starId);
  }

  for (const starId of candidateStarIds) {
    const existingBattle = getActiveBattleForStar(starId);
    if (existingBattle) {
      normalizeBattleRuntimeFields(existingBattle);
      const starbase = state.starbases.find((candidate) => candidate.starId === starId && candidate.status === "online") ?? null;
      if (existingBattle.participants.length === 0) {
        syncBattleParticipants(existingBattle, fleetsById, starbase);
      }
      const fleetsAtStar = state.fleets.filter((fleet) => (
        isFleetEligibleForSystemCombat(fleet, starId)
        && !existingBattle.defenderFleetIds.includes(fleet.id)
        && !existingBattle.attackerFleetIds.includes(fleet.id)
      ));
      for (const fleet of fleetsAtStar) {
        const canJoin = canFleetJoinExistingBattle(existingBattle, fleet, shipsById, fleetsById);
        if (!canJoin) continue;
        const side = getBattleSideForFleet(existingBattle, fleet);
        addFleetToBattle(existingBattle, fleet, side, shipsById);
        resetFleetForBattle(fleet);
        fleetsChanged = true;
      }
      if (starbase && !existingBattle.starbase && existingBattle.participants.some((participant) => {
        if (!isHostileOwner(participant.ownerId, starbase.ownerId)) return false;
        if (participant.sourceType !== "fleet") return false;
        const fleet = fleetsById.get(participant.sourceId);
        return !!fleet && canFleetEngageStarbase(fleet, starbase, shipsById);
      })) {
        existingBattle.starbaseId = starbase.id;
        existingBattle.starbase = buildBattleStarbaseState(starbase);
      }
      battlesChanged = true;
      continue;
    }

    const fleetsAtStar = state.fleets.filter((fleet) => (
      isFleetEligibleForSystemCombat(fleet, starId)
    ));
    const fleetEngagement = findInitialFleetEngagement(fleetsAtStar, shipsById);
    const starbaseEngagement = findInitialStarbaseEngagement(starId, fleetsAtStar, shipsById);
    if (!fleetEngagement && !starbaseEngagement) continue;

    const attackerFactionId = fleetEngagement?.attacker.ownerId ?? starbaseEngagement!.fleet.ownerId;
    const defenderFactionId = fleetEngagement?.defender.ownerId ?? starbaseEngagement!.starbase.ownerId;
    if (attackerFactionId === defenderFactionId) continue;

    let attackerFleets = fleetsAtStar.filter((fleet) => fleet.ownerId === attackerFactionId);
    const initialDefenderFleets = fleetsAtStar.filter((fleet) => fleet.ownerId === defenderFactionId);
    const defenderFleets = fleetsAtStar.filter((fleet) => (
      fleet.ownerId === defenderFactionId
      && attackerFleets.some((attacker) => canFleetEngageFleet(attacker, fleet, shipsById))
    ));
    const defendingStarbase = state.starbases.find((candidate) => (
      candidate.starId === starId
      && candidate.status === "online"
      && candidate.ownerId === defenderFactionId
      && attackerFleets.some((attacker) => canFleetEngageStarbase(attacker, candidate, shipsById))
    )) ?? null;
    attackerFleets = attackerFleets.filter((fleet) => (
      defenderFleets.some((defender) => canFleetEngageFleet(fleet, defender, shipsById))
      || (!!defendingStarbase && canFleetEngageStarbase(fleet, defendingStarbase, shipsById))
      || fleet.id === fleetEngagement?.attacker.id
      || fleet.id === starbaseEngagement?.fleet.id
    ));
    const participatingDefenders = defenderFleets.length > 0
      ? defenderFleets
      : initialDefenderFleets.filter((fleet) => fleet.id === fleetEngagement?.defender.id);
    if (attackerFleets.length === 0 || (participatingDefenders.length === 0 && !defendingStarbase)) continue;

    const battle: GameBattle = {
      id: createRuntimeId("battle", [starId, attackerFactionId, defenderFactionId]),
      starId,
      startedAtYear: state.clock.year,
      lastTickYear: state.clock.year,
      attackerFactionId,
      defenderFactionId,
      attackerFleetIds: [],
      defenderFleetIds: [],
      starbaseId: defendingStarbase?.id ?? null,
      ships: [],
      starbase: defendingStarbase ? buildBattleStarbaseState(defendingStarbase) : null,
      participants: [],
      combatGroups: [],
      hostility: [],
      stats: createEmptyBattleStats(),
      round: 0,
      phase: "opening",
      recentRounds: [],
      retreatingFleetIds: [],
      fleetStartingHull: {},
      participantShipIds: [],
    };

    for (const fleet of attackerFleets) {
      addFleetToBattle(battle, fleet, "attacker", shipsById);
      resetFleetForBattle(fleet);
    }
    for (const fleet of participatingDefenders) {
      addFleetToBattle(battle, fleet, "defender", shipsById);
      resetFleetForBattle(fleet);
    }

    state.battles.push(battle);
    battlesChanged = true;
    fleetsChanged = true;
  }

  if (state.battles.length === 0) {
    return { battlesChanged, shipsChanged, fleetsChanged, starbasesChanged, ownershipChanged, visibilityChanged };
  }

  const destroyedShipIds = new Set<string>();
  const battlesToRemove = new Set<string>();

  for (const battle of state.battles) {
    normalizeBattleRuntimeFields(battle);
    if (battle.phase === "resolved") {
      if (battle.resolvedAtRound !== undefined && battle.round - battle.resolvedAtRound >= 1) {
        battlesToRemove.add(battle.id);
        battlesChanged = true;
      }
      continue;
    }

    const elapsedBattleDays = Math.max(REAL_MS_PER_GAME_HOUR / REAL_MS_PER_GAME_DAY, (state.clock.year - battle.lastTickYear) * GAME_DAYS_PER_YEAR);
    battle.round += 1;
    battle.lastTickYear = state.clock.year;
    const actionsByActor = new Map<string, ServerBattleAction>();
    const hitTargets = new Set<string>();

    const shipStates = battle.ships;
    const shipStateById = new Map(shipStates.map((ship) => [ship.shipId, ship]));
    const starbaseState = battle.starbase && !battle.starbase.destroyed ? battle.starbase : null;
    const starbaseEntity = starbaseState ? state.starbases.find((sb) => sb.id === starbaseState.starbaseId) ?? null : null;
    updateCombatGroupsAndTargets(battle, shipsById, fleetsById, starbaseEntity, elapsedBattleDays);
    const groupById = new Map(battle.combatGroups.map((group) => [group.id, group]));

    for (const shipState of shipStates) {
      if (shipState.destroyed) continue;
      if (!shipState.groupId) {
        shipState.targetId = null;
        continue;
      }
      const group = groupById.get(shipState.groupId);
      const targetGroup = group?.targetGroupId ? groupById.get(group.targetGroupId) : undefined;
      shipState.targetId = group ? getGroupTargetEntityId(group, targetGroup, battle) : null;
    }

    let starbaseTargetId: string | null = null;
    if (starbaseState && starbaseEntity) {
      const starbaseGroup = starbaseState.groupId ? groupById.get(starbaseState.groupId) : null;
      const targetGroup = starbaseGroup?.targetGroupId ? groupById.get(starbaseGroup.targetGroupId) : undefined;
      starbaseTargetId = starbaseGroup ? getGroupTargetEntityId(starbaseGroup, targetGroup, battle) : null;
    }

    const ensureAction = (actorId: string): ServerBattleAction => {
      const existing = actionsByActor.get(actorId);
      if (existing) return existing;
      const created: ServerBattleAction = { actorId };
      actionsByActor.set(actorId, created);
      return created;
    };

    for (const shipState of shipStates) {
      if (shipState.destroyed) continue;
      const action = ensureAction(shipState.shipId);
      const isRetreating = battle.retreatingFleetIds.includes(shipState.fleetId);
      const group = shipState.groupId ? groupById.get(shipState.groupId) : null;
      if (group) {
        const nextZone = rangeBandToBattleZone(shipState.side, group.currentRangeBand);
        if (nextZone !== shipState.zone) {
          shipState.zone = nextZone;
          action.movedToZone = nextZone;
          action.movedToRangeBand = group.currentRangeBand;
        }
        shipState.rangeBand = group.currentRangeBand;
        continue;
      }

      if (isRetreating) {
        const retreatDirection = shipState.side === "attacker" ? 1 : -1;
        const nextZone = clamp(shipState.zone + retreatDirection, 0, 3) as BattleZone;
        if (nextZone !== shipState.zone) {
          shipState.zone = nextZone;
          action.movedToZone = nextZone;
        }
        continue;
      }

      if (!shipState.targetId) continue;
      const target = shipStateById.get(shipState.targetId);
      const targetZone = target ? target.zone : (shipState.targetId === starbaseState?.starbaseId ? starbaseState.zone : null);
      if (targetZone === null || targetZone === undefined) continue;

      const mounts = getShipWeaponMounts(shipState, shipsById);
      const maxRange = mounts.reduce((max, mount) => Math.max(max, getWeaponRange(mount)), 0);
      if (Math.abs(shipState.zone - targetZone) <= maxRange) continue;

      const direction = shipState.side === "attacker" ? -1 : 1;
      const nextZone = clamp(shipState.zone + direction, 0, 3) as BattleZone;
      if (nextZone !== shipState.zone) {
        shipState.zone = nextZone;
        action.movedToZone = nextZone;
      }
    }

    for (const shipState of shipStates) {
      if (shipState.destroyed) continue;
      if (!shipState.targetId) continue;

      const mounts = getShipWeaponMounts(shipState, shipsById);
      if (mounts.length === 0) continue;

      const targetShip = shipStateById.get(shipState.targetId);
      const targetIsStarbase = shipState.targetId === starbaseState?.starbaseId;
      const targetZone = targetShip
        ? targetShip.zone
        : (targetIsStarbase ? starbaseState?.zone : null);
      if (targetZone === null || targetZone === undefined) continue;
      const actorGroup = shipState.groupId ? groupById.get(shipState.groupId) : null;
      const targetGroup = targetShip?.groupId
        ? groupById.get(targetShip.groupId)
        : (targetIsStarbase && starbaseState?.groupId ? groupById.get(starbaseState.groupId) : null);
      const targetDistance = actorGroup && targetGroup
        ? distance3(actorGroup.position, targetGroup.position)
        : Math.abs(shipState.zone - targetZone);
      const rangeBand = rangeBandForSystemDistance(targetDistance);
      if (!mounts.some((mount) => weaponCanFireAtDistance(mount, targetDistance))) continue;

      const action = ensureAction(shipState.shipId);
      action.actorGroupId = shipState.groupId ?? null;
      let totalShieldDamage = 0;
      let totalArmorDamage = 0;
      let totalHullDamage = 0;
      let anyHit = false;
      let anyAccuracyMiss = false;
      let anyDodged = false;
      const targetGroupId = targetShip?.groupId ?? (targetIsStarbase ? starbaseState?.groupId ?? null : null);
      const weaponEffects: ServerBattleWeaponEffect[] = [];

      const targetEvasion = targetShip
        ? getShipEvasion(targetShip, fleetsById, shipsById)
        : (starbaseEntity ? STARBASE_LEVEL_DEFINITIONS[starbaseEntity.level]?.combat.evasion ?? 0 : 0);

      for (const mount of mounts) {
        if (!weaponCanFireAtDistance(mount, targetDistance)) continue;
        if (targetShip?.destroyed) break;
        if (starbaseState?.destroyed && targetIsStarbase) break;
        const roll = rollWeaponShot(mount, targetEvasion);
        anyAccuracyMiss ||= roll.accuracyMiss;
        anyDodged ||= roll.dodged;
        const weaponEffect: ServerBattleWeaponEffect = {
          targetId: shipState.targetId,
          targetGroupId,
          weaponId: getWeaponId(mount),
          weaponName: getWeaponName(mount),
          hit: roll.hit,
          accuracyMiss: roll.accuracyMiss,
          dodged: roll.dodged,
          shieldDamage: 0,
          armorDamage: 0,
          hullDamage: 0,
          targetDestroyed: false,
        };
        if (!roll.hit) {
          recordBattleShot(
            battle,
            shipState.participantId ?? getFleetParticipantId(shipState.fleetId),
            shipState.ownerId,
            targetShip?.participantId ?? (targetIsStarbase && starbaseState ? starbaseState.participantId : undefined),
            targetShip?.ownerId ?? (targetIsStarbase && starbaseState ? starbaseState.ownerId : undefined),
            mount,
            roll,
          );
          weaponEffects.push(weaponEffect);
          continue;
        }
        anyHit = true;

        if (targetShip) {
          const wasDestroyed = targetShip.destroyed;
          const result = applyWeaponHit(mount, targetShip);
          totalShieldDamage += result.shieldDamage;
          totalArmorDamage += result.armorDamage;
          totalHullDamage += result.hullDamage;
          weaponEffect.shieldDamage = result.shieldDamage;
          weaponEffect.armorDamage = result.armorDamage;
          weaponEffect.hullDamage = result.hullDamage;
          targetShip.lastHitRound = battle.round;
          hitTargets.add(targetShip.shipId);
          if (result.destroyed) {
            targetShip.destroyed = true;
          }
          weaponEffect.targetDestroyed = !wasDestroyed && targetShip.destroyed;
          recordBattleShot(
            battle,
            shipState.participantId ?? getFleetParticipantId(shipState.fleetId),
            shipState.ownerId,
            targetShip.participantId,
            targetShip.ownerId,
            mount,
            roll,
            { shield: result.shieldDamage, armor: result.armorDamage, hull: result.hullDamage },
            !wasDestroyed && result.destroyed,
          );
        } else if (targetIsStarbase && starbaseState) {
          const result = applyWeaponHit(mount, starbaseState);
          totalShieldDamage += result.shieldDamage;
          totalArmorDamage += result.armorDamage;
          totalHullDamage += result.hullDamage;
          weaponEffect.shieldDamage = result.shieldDamage;
          weaponEffect.armorDamage = result.armorDamage;
          weaponEffect.hullDamage = result.hullDamage;
          starbaseState.lastHitRound = battle.round;
          if (result.shieldDamage > 0 && starbaseEntity) starbaseEntity.lastShieldDamageAtYear = state.clock.year;
          hitTargets.add(starbaseState.starbaseId);
          if (result.destroyed) {
            starbaseState.destroyed = true;
          }
          weaponEffect.targetDestroyed = result.destroyed;
          recordBattleShot(
            battle,
            shipState.participantId ?? getFleetParticipantId(shipState.fleetId),
            shipState.ownerId,
            starbaseState.participantId,
            starbaseState.ownerId,
            mount,
            roll,
            { shield: result.shieldDamage, armor: result.armorDamage, hull: result.hullDamage },
          );
        }
        weaponEffects.push(weaponEffect);
      }

      const targetDestroyed = targetShip ? targetShip.destroyed : (targetIsStarbase ? !!starbaseState?.destroyed : false);
      const representativeEffect = weaponEffects.find((effect) => effect.hit) ?? weaponEffects[0];
      action.fired = {
        targetId: shipState.targetId,
        targetGroupId,
        weaponId: representativeEffect?.weaponId,
        weaponName: representativeEffect?.weaponName,
        weaponEffects,
        hit: anyHit,
        accuracyMiss: anyAccuracyMiss,
        dodged: anyDodged,
        shieldDamage: totalShieldDamage,
        armorDamage: totalArmorDamage,
        hullDamage: totalHullDamage,
        targetDestroyed,
      };
    }

    if (starbaseState && starbaseEntity && starbaseTargetId) {
      const mounts = getStarbaseWeaponMounts(starbaseEntity);
      if (mounts.length > 0) {
        const target = shipStateById.get(starbaseTargetId);
        if (target && !target.destroyed) {
          const starbaseGroup = starbaseState.groupId ? groupById.get(starbaseState.groupId) : null;
          const targetGroup = target.groupId ? groupById.get(target.groupId) : null;
          const targetDistance = starbaseGroup && targetGroup
            ? distance3(starbaseGroup.position, targetGroup.position)
            : Math.abs(target.zone - starbaseState.zone);
          const rangeBand = rangeBandForSystemDistance(targetDistance);
          if (mounts.some((mount) => weaponCanFireAtDistance(mount, targetDistance))) {
            const action = ensureAction(starbaseState.starbaseId);
            action.actorGroupId = starbaseState.groupId ?? null;
            let totalShieldDamage = 0;
            let totalArmorDamage = 0;
            let totalHullDamage = 0;
            let anyHit = false;
            let anyAccuracyMiss = false;
            let anyDodged = false;
            const targetGroupId = target.groupId ?? null;
            const weaponEffects: ServerBattleWeaponEffect[] = [];
            const targetEvasion = getShipEvasion(target, fleetsById, shipsById);

            for (const mount of mounts) {
              if (!weaponCanFireAtDistance(mount, targetDistance)) continue;
              if (target.destroyed) break;
              const roll = rollWeaponShot(mount, targetEvasion);
              anyAccuracyMiss ||= roll.accuracyMiss;
              anyDodged ||= roll.dodged;
              const weaponEffect: ServerBattleWeaponEffect = {
                targetId: target.shipId,
                targetGroupId,
                weaponId: getWeaponId(mount),
                weaponName: getWeaponName(mount),
                hit: roll.hit,
                accuracyMiss: roll.accuracyMiss,
                dodged: roll.dodged,
                shieldDamage: 0,
                armorDamage: 0,
                hullDamage: 0,
                targetDestroyed: false,
              };
              if (!roll.hit) {
                recordBattleShot(
                  battle,
                  starbaseState.participantId ?? getStarbaseParticipantId(starbaseState.starbaseId),
                  starbaseState.ownerId,
                  target.participantId,
                  target.ownerId,
                  mount,
                  roll,
                );
                weaponEffects.push(weaponEffect);
                continue;
              }
              anyHit = true;
              const wasDestroyed = target.destroyed;
              const result = applyWeaponHit(mount, target);
              totalShieldDamage += result.shieldDamage;
              totalArmorDamage += result.armorDamage;
              totalHullDamage += result.hullDamage;
              weaponEffect.shieldDamage = result.shieldDamage;
              weaponEffect.armorDamage = result.armorDamage;
              weaponEffect.hullDamage = result.hullDamage;
              target.lastHitRound = battle.round;
              hitTargets.add(target.shipId);
              if (result.destroyed) {
                target.destroyed = true;
              }
              weaponEffect.targetDestroyed = !wasDestroyed && target.destroyed;
              recordBattleShot(
                battle,
                starbaseState.participantId ?? getStarbaseParticipantId(starbaseState.starbaseId),
                starbaseState.ownerId,
                target.participantId,
                target.ownerId,
                mount,
                roll,
                { shield: result.shieldDamage, armor: result.armorDamage, hull: result.hullDamage },
                !wasDestroyed && result.destroyed,
              );
              weaponEffects.push(weaponEffect);
            }

            const representativeEffect = weaponEffects.find((effect) => effect.hit) ?? weaponEffects[0];
            action.fired = {
              targetId: target.shipId,
              targetGroupId,
              weaponId: representativeEffect?.weaponId,
              weaponName: representativeEffect?.weaponName,
              weaponEffects,
              hit: anyHit,
              accuracyMiss: anyAccuracyMiss,
              dodged: anyDodged,
              shieldDamage: totalShieldDamage,
              armorDamage: totalArmorDamage,
              hullDamage: totalHullDamage,
              targetDestroyed: target.destroyed,
            };
          }
        }
      }
    }

    for (const shipState of shipStates) {
      if (shipState.destroyed) continue;
      if (hitTargets.has(shipState.shipId)) continue;
      if (battle.round - shipState.lastHitRound < SHIELD_REGEN_DELAY_ROUNDS) continue;
      if (shipState.maxShield <= 0) continue;
      const regen = shipState.maxShield * SHIELD_REGEN_FRACTION;
      shipState.shield = clamp(shipState.shield + regen, 0, shipState.maxShield);
    }

    if (starbaseState && !starbaseState.destroyed) {
      if (!hitTargets.has(starbaseState.starbaseId) && battle.round - starbaseState.lastHitRound >= SHIELD_REGEN_DELAY_ROUNDS) {
        if (starbaseState.maxShield > 0) {
          const regen = starbaseState.maxShield * SHIELD_REGEN_FRACTION;
          starbaseState.shield = clamp(starbaseState.shield + regen, 0, starbaseState.maxShield);
        }
      }
    }

    if (starbaseState && starbaseEntity) {
      starbaseEntity.shield = starbaseState.shield;
      starbaseEntity.armor = starbaseState.armor;
      starbaseEntity.hull = starbaseState.hull;
      starbaseEntity.lastShieldDamageAtYear = hitTargets.has(starbaseState.starbaseId)
        ? state.clock.year
        : starbaseEntity.lastShieldDamageAtYear ?? null;
      starbasesChanged = true;
    }

    for (const shipState of shipStates) {
      if (shipState.destroyed) {
        destroyedShipIds.add(shipState.shipId);
        continue;
      }
      if (shipState.hull <= 0) {
        shipState.destroyed = true;
        destroyedShipIds.add(shipState.shipId);
      }
    }

    for (const shipState of shipStates) {
      const ship = shipsById.get(shipState.shipId);
      if (!ship) continue;
      ship.shield = shipState.shield;
      ship.armor = shipState.armor;
      ship.hull = shipState.hull;
      ship.hp = shipState.hull;
      shipsChanged = true;
    }

    const escapedGroupShipIds = new Set(
      battle.combatGroups
        .filter((group) => group.status === "escaped" && group.shipIds.length > 0)
        .flatMap((group) => group.shipIds),
    );
    if (escapedGroupShipIds.size > 0) {
      const escapedFleetIds = new Set<string>();
      const escapedDestinationsByFleet = new Map<string, BattleGroupRetreatDestination | null | undefined>();
      for (const group of battle.combatGroups) {
        if (group.status === "escaped" && group.sourceFleetId) {
          escapedDestinationsByFleet.set(group.sourceFleetId, group.retreatDestination);
        }
      }
      for (const shipState of shipStates) {
        if (!escapedGroupShipIds.has(shipState.shipId) || shipState.destroyed) continue;
        escapedFleetIds.add(shipState.fleetId);
        const participantId = shipState.participantId ?? getFleetParticipantId(shipState.fleetId);
        ensureParticipantStats(battle.stats, participantId).escapedShips += 1;
        ensureOwnerStats(battle.stats, shipState.ownerId).escapedShips += 1;
      }
      battle.ships = battle.ships.filter((ship) => !escapedGroupShipIds.has(ship.shipId));
      for (const fleetId of escapedFleetIds) {
        const remainingInBattle = battle.ships.some((ship) => ship.fleetId === fleetId && !ship.destroyed);
        if (remainingInBattle) continue;
        battle.attackerFleetIds = battle.attackerFleetIds.filter((id) => id !== fleetId);
        battle.defenderFleetIds = battle.defenderFleetIds.filter((id) => id !== fleetId);
        battle.retreatingFleetIds = battle.retreatingFleetIds.filter((id) => id !== fleetId);
        const fleet = fleetsById.get(fleetId);
        if (fleet) {
          if (!fleet.retreatState) {
            const destination = resolveBattleGroupRetreatDestinationForFleet(fleet, escapedDestinationsByFleet.get(fleetId));
            fleet.retreatState = {
              mode: "system",
              status: "escaping",
              targetStarId: destination.targetStarId,
              targetSystemPosition: destination.targetSystemPosition ?? null,
              startedAtYear: state.clock.year,
            };
          }
          startFleetRetreat(fleet);
          fleetsChanged = true;
        }
      }
      battlesChanged = true;
    }

    for (const fleetId of [...battle.attackerFleetIds, ...battle.defenderFleetIds]) {
      if (battle.retreatingFleetIds.includes(fleetId)) continue;
      const fleetStarting = battle.fleetStartingHull[fleetId] ?? 0;
      if (fleetStarting <= 0) continue;
      const currentHull = shipStates
        .filter((ship) => ship.fleetId === fleetId && !ship.destroyed)
        .reduce((total, ship) => total + ship.hull, 0);
      if (currentHull / fleetStarting <= RETREAT_HULL_RATIO) {
        battle.retreatingFleetIds.push(fleetId);
        battle.phase = "retreating";
        const fleet = fleetsById.get(fleetId);
        if (fleet && !fleet.retreatState) {
          const destination = resolveBattleGroupRetreatDestinationForFleet(fleet, null);
          fleet.retreatState = {
            mode: "system",
            status: "escaping",
            targetStarId: destination.targetStarId,
            targetSystemPosition: destination.targetSystemPosition ?? null,
            startedAtYear: state.clock.year,
          };
        }
        const participantId = getFleetParticipantId(fleetId);
        const retreatingCount = shipStates.filter((ship) => ship.fleetId === fleetId && !ship.destroyed).length;
        ensureParticipantStats(battle.stats, participantId).retreatingShips = retreatingCount;
        if (fleet) ensureOwnerStats(battle.stats, fleet.ownerId).retreatingShips += retreatingCount;
      }
    }

    const retreatingExits: string[] = [];
    for (const fleetId of battle.retreatingFleetIds) {
      const activeShips = shipStates.filter((ship) => ship.fleetId === fleetId && !ship.destroyed);
      if (activeShips.length === 0) {
        retreatingExits.push(fleetId);
        continue;
      }
      const retreatSide = activeShips[0]?.side ?? (battle.attackerFleetIds.includes(fleetId) ? "attacker" : "defender");
      const hasExited = retreatSide === "attacker"
        ? activeShips.every((ship) => ship.zone >= 3)
        : activeShips.every((ship) => ship.zone <= 0);
      if (hasExited) {
        retreatingExits.push(fleetId);
      }
    }

    if (retreatingExits.length > 0) {
      battle.retreatingFleetIds = battle.retreatingFleetIds.filter((fleetId) => !retreatingExits.includes(fleetId));
      battle.attackerFleetIds = battle.attackerFleetIds.filter((fleetId) => !retreatingExits.includes(fleetId));
      battle.defenderFleetIds = battle.defenderFleetIds.filter((fleetId) => !retreatingExits.includes(fleetId));
      battle.ships = battle.ships.filter((ship) => !retreatingExits.includes(ship.fleetId));

      for (const fleetId of retreatingExits) {
        const fleet = fleetsById.get(fleetId);
        if (!fleet) continue;
        const escapedCount = shipStates.filter((ship) => ship.fleetId === fleetId && !ship.destroyed).length;
        ensureParticipantStats(battle.stats, getFleetParticipantId(fleetId)).escapedShips += escapedCount;
        ensureOwnerStats(battle.stats, fleet.ownerId).escapedShips += escapedCount;
        startFleetRetreat(fleet);
        fleetsChanged = true;
      }
    }

    const roundActions: ServerBattleRound = {
      round: battle.round,
      actions: Array.from(actionsByActor.values()),
    };
    battle.recentRounds = [...battle.recentRounds, roundActions].slice(-BATTLE_ROUNDS_HISTORY);

    if (battle.phase === "opening") {
      battle.phase = "engaged";
    }

    const resolution = shouldResolveBattle(battle);
    if (resolution.resolved && resolution.winner) {
      const winnerFactionId = resolution.winner === "attacker" ? battle.attackerFactionId : battle.defenderFactionId;
      const capturedStarbase = resolution.winner === "attacker" && !!battle.starbase && battle.starbase.destroyed;
      battle.phase = "resolved";
      battle.result = {
        winnerFactionId,
        survivingShipIds: battle.participantShipIds.filter((shipId) => {
          const shipState = shipStateById.get(shipId);
          if (shipState) return !shipState.destroyed;
          return shipsById.has(shipId);
        }),
        capturedStarbase,
      };
      battle.resolvedAtRound = battle.round;

      if (capturedStarbase && battle.starbaseId) {
        const starbaseIndex = state.starbases.findIndex((candidate) => candidate.id === battle.starbaseId);
        if (starbaseIndex >= 0) {
          const starbase = state.starbases[starbaseIndex];
          const combat = STARBASE_LEVEL_DEFINITIONS.outpost.combat;
          const rebuilt: ServerStarbase = {
            ...starbase,
            ownerId: winnerFactionId,
            status: "online",
            buildProgress: 1,
            level: "outpost",
            shield: combat.maxShield,
            maxShield: combat.maxShield,
            armor: combat.maxArmor,
            maxArmor: combat.maxArmor,
            hull: combat.maxHull,
            maxHull: combat.maxHull,
            lastShieldDamageAtYear: null,
            economy: calculateStarbaseEconomy("outpost"),
            buildingSlots: createEmptyStarbaseSlots(),
            constructionQueue: [],
            shipQueue: [],
          };
          state.starbases[starbaseIndex] = rebuilt;
          state.starOwnership[rebuilt.starId] = winnerFactionId;
          starbasesChanged = true;
          ownershipChanged = true;
        }
      }

      for (const fleetId of [...battle.attackerFleetIds, ...battle.defenderFleetIds]) {
        const fleet = fleetsById.get(fleetId);
        if (!fleet) continue;
        if (battle.retreatingFleetIds.includes(fleetId)) continue;
        resetFleetForBattle(fleet);
        fleetsChanged = true;
      }
    }

    battlesChanged = true;
  }

  if (destroyedShipIds.size > 0) {
    state.ships = state.ships.filter((ship) => !destroyedShipIds.has(ship.id));
    if (syncFleetMembership(state)) {
      fleetsChanged = true;
    }
    shipsChanged = true;
  }

  if (battlesToRemove.size > 0) {
    state.battles = state.battles.filter((battle) => !battlesToRemove.has(battle.id));
    battlesChanged = true;
  }

  if (starbasesChanged || ownershipChanged) {
    refreshDiscovery();
    visibilityChanged = true;
  }

  if (battlesChanged || shipsChanged || fleetsChanged || starbasesChanged || ownershipChanged) {
    hasDirtyState = true;
  }

  return { battlesChanged, shipsChanged, fleetsChanged, starbasesChanged, ownershipChanged, visibilityChanged };
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

function processEconomyHours(targetHour: number): boolean {
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  let processed = false;
  for (const economy of state.factionEconomies) {
    const processedHour = economy.lastProcessedHour ?? targetHour;
    const elapsedHours = Math.max(0, targetHour - processedHour);
    if (elapsedHours <= 0) continue;
    economy.stockpiles = addResourceCounts(
      economy.stockpiles,
      scaleResourceCounts(economy.monthlyDelta, elapsedHours / GAME_HOURS_PER_MONTH),
    );
    economy.lastProcessedHour = targetHour;
    economy.lastProcessedMonth = gameYearToMonthIndex(elapsedHoursToGameYear(targetHour));
    processed = true;
  }
  if (processed) {
    hasDirtyState = true;
  }
  return processed;
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

function isStarbaseInActiveBattle(starbaseId: string): boolean {
  return state.battles.some((battle) => battle.phase !== "resolved" && battle.starbaseId === starbaseId);
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
    if (starbase.status !== "online" || isStarbaseInActiveBattle(starbase.id)) return starbase;
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

function processStarbaseShipQueues(elapsedDays: number): { starbasesChanged: boolean; fleetsChanged: boolean } {
  if (elapsedDays <= 0) return { starbasesChanged: false, fleetsChanged: false };
  let starbasesChanged = false;
  let fleetsChanged = false;
  state.starbases = state.starbases.map((starbase) => {
    if (starbase.shipQueue.length === 0) return starbase;
    const result = progressStarbaseShipQueue(starbase, elapsedDays);
    if (!result.changed) return starbase;

    const economy = getFactionEconomy(starbase.ownerId);
    if (economy && result.alloysConsumed > 0) {
      const cost = createEmptyResourceCounts();
      cost.alloys = -result.alloysConsumed;
      economy.stockpiles = addResourceCounts(economy.stockpiles, cost);
    }
    for (const completed of result.completed) {
      spawnCompletedShip(starbase, completed);
      fleetsChanged = true;
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

function advanceState(now: number): Set<ServerUpdateField> {
  const changed = new Set<ServerUpdateField>();
  const elapsedMs = Math.max(0, now - state.clock.lastUpdatedAt);
  if (elapsedMs <= 0) return changed;
  const previousFleetSignature = fleetUpdateSignature();
  const arrivingFleets: GameFleet[] = [];
  const scaledMs = elapsedMs * state.clock.speedMultiplier;
  const elapsedGameHours = scaledMs / REAL_MS_PER_GAME_HOUR;
  const elapsedGameDays = elapsedGameHours / 24;
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
  if (combatResult.visibilityChanged) {
    changed.add("visibility");
  }

  if (fleetUpdateSignature() !== previousFleetSignature) {
    hasDirtyState = true;
    changed.add("fleets");
    changed.add("visibility");
    changed.add("starbases");
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
  if (processEconomyHours(nextEconomyHour)) {
    changed.add("factionEconomies");
  }

  const nextPopulationWeek = gameYearToWeekIndex(state.clock.year);
  if (processPopulationWeeks(nextPopulationWeek)) {
    changed.add("factionEconomies");
    changed.add("habitedPlanetSystems");
  }

  return changed;
}

function handleCommand(session: ClientSession, command: ClientCommand): void {
  if (command.type === "join") {
    sendEvent(session.socket, createSnapshot(session.perspective));
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
  if (command.type === "mergeFleets") {
    handleMergeFleets(session.socket, session.perspective, command.targetFleetId, command.sourceFleetIds);
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
  if (command.type === "requestSystemDetails") {
    sendSystemDetails(session.socket, session.perspective, command.starId);
    return;
  }
  if (command.type === "requestPlanetDetails") {
    session.openPlanetId = command.planetId;
    sendPlanetDetails(session.socket, session.perspective, command.planetId);
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
  if (command.type === "createBattleGroup") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "deleteBattleGroup") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "renameBattleGroup") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "moveShipsToBattleGroup") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "splitBattleGroup") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "mergeBattleGroups") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setBattleGroupBehavior") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setBattleGroupRetreatPolicy") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setBattleGroupChaseSetting") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setBattleGroupRetreatDestination") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setFleetCombatSettings") {
    handleSetFleetCombatSettings(session.socket, session.perspective, command.fleetId, command.combatSettings, command.combatStance);
    return;
  }
  if (command.type === "setFleetAlertMode") {
    handleSetFleetAlertMode(session.socket, session.perspective, command.fleetId, command.alertMode);
    return;
  }
  if (command.type === "issueFleetTacticalOrder") {
    handleIssueFleetTacticalOrder(session.socket, session.perspective, command);
    return;
  }
  if (command.type === "issueBattleGroupOrder") {
    reject(session.socket, "Battle groups have been retired; use fleet doctrine instead.");
    return;
  }
  if (command.type === "setSpeedMultiplier") {
    const allowed = new Set([1, 2, 3, 4, 5, 50, 100, 200, 500]);
    if (!allowed.has(command.multiplier)) return reject(session.socket, "Unsupported speed multiplier.");
    state.clock.speedMultiplier = command.multiplier;
    state.clock.syncedAtMs = Date.now();
    hasDirtyState = true;
    accept(session.socket, `Speed set to ${command.multiplier}x.`);
    broadcastUpdates(["clock"]);
  }
}

state = await loadState();
advanceState(Date.now());
await saveState(state);

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

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", (socket, request) => {
  // Validate WebSocket origin
  const origin = request.headers.origin;
  if (!isWebSocketOriginAllowed(origin)) {
    console.warn(`[GameServer] Rejected WebSocket connection from disallowed origin: ${origin}`);
    socket.close(1008, 'Origin not allowed');
    return;
  }

  const token = parseSessionTokenFromCookie(request.headers.cookie);
  const account = token ? authStore.getAccountFromSessionToken(token) : null;
  if (!account) {
    sendEvent(socket, { type: "serverInfo", message: "Authentication required." });
    socket.close();
    return;
  }

  const session: ClientSession = {
    socket,
    account,
    perspective: getPerspectiveFromAccount(account),
    openPlanetId: null,
  };
  clients.add(session);
  sendEvent(socket, { type: "serverInfo", message: "Connected to StellarFronts game server." });

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
});

setInterval(() => {
  const changed = advanceState(Date.now());
  broadcastUpdates(Array.from(changed));
  flushPlanetDetailRefreshes();
  if (hasDirtyState && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) {
    void saveState().catch((error) => console.error("[GameServer] Failed to save state", error));
  }
}, SERVER_TICK_INTERVAL_MS);

console.log(`[GameServer] Listening on ws://localhost:${PORT}`);
