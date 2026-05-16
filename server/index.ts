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
  WEAPON_KIND_DEFINITIONS,
} from "../src/data/Starbase";
import type { StarbaseBuildingKind, StarbaseLevel, StarbaseShipKind, WeaponMountDefinition } from "../src/data/Starbase";
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
import type {
  ClientCommand,
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
  ServerFleet,
  FleetMovementPlan,
  FleetMovementSegment,
  FleetOrbitTarget,
  FleetOrderType,
  ServerEvent,
  ServerShip,
  ServerStarbase,
  ServerUpdateField,
  ShipTransitPhase,
} from "../src/game/GameProtocol";
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
const SYSTEM_FLEET_SPEED_UNITS_PER_DAY = 10.4;
const SYSTEM_PLANET_ORBIT_DISTANCE = 3.4;

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
  schemaVersion: 10;
  stars: StarData[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  ships: GameShip[];
  fleets: GameFleet[];
  battles: GameBattle[];
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

function isFleetFormation(value: string | undefined): value is FleetFormation {
  return !!value && FLEET_FORMATIONS.includes(value as FleetFormation);
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
    status: starbase.status ?? "online",
    buildProgress: starbase.buildProgress ?? 1,
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

function createShip(
  ownerId: number,
  fleetId: string,
  shipKind: StarbaseShipKind = "corvette",
  id = createRuntimeId("ship", [ownerId, shipKind]),
): GameShip {
  const definition = getShipDefinition(shipKind);
  const combat = definition.combat;
  return {
    id,
    ownerId,
    fleetId,
    shipKind,
    speed: definition.speed,
    hp: combat.maxHull,
    maxHp: combat.maxHull,
    shield: combat.maxShield,
    maxShield: combat.maxShield,
    armor: combat.maxArmor,
    maxArmor: combat.maxArmor,
    hull: combat.maxHull,
    maxHull: combat.maxHull,
  };
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
    systemPosition: systemCenterPosition(),
    hyperlanePosition: null,
    movementPlan: null,
    orbitTargetPlanetId: null,
    orbitOffset: null,
    orbitTarget: null,
    mergeTargetFleetId: null,
  };
}

function normalizeShip(
  ship: Partial<ServerShip> & { id: string; ownerId: number },
  fallbackFleetId: string,
): GameShip {
  const definition = getShipDefinition(ship.shipKind);
  const shipKind = definition.kind;
  const combat = definition.combat;
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
    speed: Math.max(0.05, Number(ship.speed) || definition.speed),
    hp: hull,
    maxHp: maxHull,
    shield,
    maxShield,
    armor,
    maxArmor,
    hull,
    maxHull,
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
  const orderType: FleetOrderType = fleet.orderType === "move" || fleet.orderType === "build" || fleet.orderType === "orbit" || fleet.orderType === "merge"
    ? fleet.orderType
    : null;
  return {
    id: fleet.id,
    ownerId: Number.isInteger(fleet.ownerId) ? fleet.ownerId : 0,
    shipIds: Array.isArray(fleet.shipIds) ? fleet.shipIds.filter((id) => typeof id === "string") : [],
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
    systemPosition: fleet.systemPosition ?? systemCenterPosition(),
    hyperlanePosition: fleet.hyperlanePosition ?? null,
    movementPlan: fleet.movementPlan ?? null,
    orbitTargetPlanetId: typeof fleet.orbitTargetPlanetId === "string" ? fleet.orbitTargetPlanetId : null,
    orbitOffset: fleet.orbitOffset ?? null,
    orbitTarget: fleet.orbitTarget ?? null,
    mergeTargetFleetId: typeof fleet.mergeTargetFleetId === "string" ? fleet.mergeTargetFleetId : null,
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
  const starbases = factions.map<ServerStarbase>((faction) => ({
    id: `starbase-${faction.id}`,
    ownerId: faction.id,
    starId: faction.homeStarId,
    status: "online",
    buildProgress: 1,
    level: "starbase",
    economy: calculateStarbaseEconomy("starbase"),
    buildingSlots: createEmptyStarbaseSlots(),
    constructionQueue: [],
    shipQueue: [],
  }));
  const ships: GameShip[] = [];
  const fleets = factions.map<GameFleet>((faction) => {
    const fleetId = `fleet-${faction.id}-1`;
    const ship = createShip(faction.id, fleetId, "corvette", `ship-${faction.id}-1`);
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
    schemaVersion: 10,
    stars,
    planetStates,
    factionEconomies: factions.map((faction) => createInitialFactionEconomyState(faction.id, startMonth)),
    hyperlanes,
    adjacency,
    factions,
    starOwnership,
    starbases,
    ships,
    fleets,
    battles: [],
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
    parsed.schemaVersion = 10;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
    parsed.lastKnownOwnershipByFaction = parsed.lastKnownOwnershipByFaction ?? {};
    parsed.battles = Array.isArray(parsed.battles) ? parsed.battles : [];
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
        return normalizeShip(ship, legacyFleetId);
      });
      hasDirtyState = true;
    } else {
      parsed.fleets = rawFleets.map((fleet) => normalizeFleet(fleet));
      const fallbackFleetId = parsed.fleets[0]?.id ?? "fleet-0";
      parsed.ships = rawShips.map((ship) => normalizeShip(ship, ship.fleetId || fallbackFleetId));
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
  if (changed.includes("fleets")) {
    update.fleets = visibleState.fleets;
  }
  if (changed.includes("starbases")) {
    update.starbases = visibleState.starbases;
  }
  if (changed.includes("battles") || changed.includes("visibility")) {
    update.battles = visibleState.battles;
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
    fleets,
    starbases,
    battles,
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

function createStarbaseOrbitTarget(starbase: ServerStarbase, position = getSystemStarbaseOrbitPosition()): FleetOrbitTarget {
  return {
    kind: "starbase",
    starId: starbase.starId,
    starbaseId: starbase.id,
    position: cloneSystemPosition(position),
  };
}

function getDefaultMoveDestination(starId: number): { position: ReturnType<typeof systemCenterPosition>; orbitTarget: FleetOrbitTarget } {
  const starbase = getStarbaseInSystem(starId);
  if (starbase) {
    const position = getSystemStarbaseOrbitPosition();
    return { position, orbitTarget: createStarbaseOrbitTarget(starbase, position) };
  }
  const position = getSystemStarOrbitPosition();
  return { position, orbitTarget: createStarOrbitTarget(starId, position) };
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
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const fleet = state.fleets.find((candidate) => candidate.id === fleetId);
  if (!fleet) return reject(socket, "Fleet not found.");
  if (fleet.ownerId !== factionId) return reject(socket, "You do not own that fleet.");

  const battle = state.battles.find((candidate) => (
    candidate.phase !== "resolved"
    && (candidate.attackerFleetIds.includes(fleetId) || candidate.defenderFleetIds.includes(fleetId))
  ));
  if (!battle) return reject(socket, "Fleet is not engaged in battle.");

  if (!battle.retreatingFleetIds.includes(fleetId)) {
    battle.retreatingFleetIds.push(fleetId);
    battle.phase = "retreating";
  }
  hasDirtyState = true;
  accept(socket, "Fleet ordered to retreat.");
  broadcastUpdates(["battles", "fleets"]);
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
): void {
  const starbase = validateStarbaseCommand(socket, perspective, starbaseId);
  if (!starbase) return;
  if (!isStarbaseShipKind(shipKind)) return reject(socket, "Invalid ship design.");
  const shipyardCount = countStarbaseShipyards(starbase.buildingSlots);
  if (shipyardCount <= 0) return reject(socket, "Starbase has no completed shipyards.");
  const item = createStarbaseShipQueueItem(shipKind);
  commitStarbase(socket, "Ship queued.", {
    ...starbase,
    shipQueue: [...starbase.shipQueue, item],
  });
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
      starbase = {
        id: createRuntimeId("starbase", [fleet.ownerId, starId]),
        ownerId: fleet.ownerId,
        starId,
        status: "online",
        buildProgress: 1,
        level: "outpost",
        economy: calculateStarbaseEconomy("outpost"),
        buildingSlots: createEmptyStarbaseSlots(),
        constructionQueue: [],
        shipQueue: [],
      };
      state.starbases.push(starbase);
      state.starOwnership[starId] = fleet.ownerId;
    }
    finalOrbitTarget = createStarbaseOrbitTarget(starbase, getSystemStarbaseOrbitPosition());
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
  const shieldPen = clamp(mount.shieldPenetration, 0, 1);
  const armorPen = clamp(mount.armorPenetration, 0, 1);
  const damage = Math.max(0, mount.damage * mount.barrels);

  const shieldComponent = damage * (1 - shieldPen);
  const shieldDamage = Math.min(target.shield, shieldComponent);
  target.shield = Math.max(0, target.shield - shieldDamage);
  const shieldOverflow = Math.max(0, shieldComponent - shieldDamage);
  const afterShield = damage * shieldPen + shieldOverflow;

  const armorComponent = afterShield * (1 - armorPen);
  const armorDamage = Math.min(target.armor, armorComponent);
  target.armor = Math.max(0, target.armor - armorDamage);
  const armorOverflow = Math.max(0, armorComponent - armorDamage);
  const afterArmor = afterShield * armorPen + armorOverflow;

  const hullDamage = Math.min(target.hull, afterArmor);
  target.hull = Math.max(0, target.hull - hullDamage);

  return {
    destroyed: target.hull <= 0,
    shieldDamage,
    armorDamage,
    hullDamage,
  };
}

function getWeaponRange(mount: WeaponMountDefinition): number {
  return WEAPON_KIND_DEFINITIONS[mount.kind]?.range ?? 1;
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
  const combat = STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat;
  const maxShield = Math.max(0, combat?.maxShield ?? 0);
  const maxArmor = Math.max(0, combat?.maxArmor ?? 0);
  const maxHull = Math.max(1, combat?.maxHull ?? 1);
  return {
    starbaseId: starbase.id,
    ownerId: starbase.ownerId,
    zone: 0,
    shield: maxShield,
    maxShield,
    armor: maxArmor,
    maxArmor,
    hull: maxHull,
    maxHull,
    destroyed: false,
    lastHitRound: -999,
  };
}

function getShipDefinitionById(shipId: string, shipsById: Map<string, GameShip>) {
  const ship = shipsById.get(shipId);
  if (!ship) return null;
  return getShipDefinition(ship.shipKind);
}

function getShipEvasion(shipState: ServerBattleShipState, fleetsById: Map<string, GameFleet>, shipsById: Map<string, GameShip>): number {
  const definition = getShipDefinitionById(shipState.shipId, shipsById);
  if (!definition) return 0;
  const fleet = fleetsById.get(shipState.fleetId);
  const bonus = fleet ? FORMATION_EVASION_BONUS[fleet.formation] ?? 0 : 0;
  return clamp(definition.combat.evasion + bonus, 0, 0.9);
}

function getShipSensorRange(shipState: ServerBattleShipState, shipsById: Map<string, GameShip>): number {
  const definition = getShipDefinitionById(shipState.shipId, shipsById);
  return Math.max(1, definition?.combat.sensorRange ?? 1);
}

function getShipWeaponMounts(shipState: ServerBattleShipState, shipsById: Map<string, GameShip>): WeaponMountDefinition[] {
  const definition = getShipDefinitionById(shipState.shipId, shipsById);
  return definition?.combat.weaponMounts ?? [];
}

function getStarbaseWeaponMounts(starbase: ServerStarbase): WeaponMountDefinition[] {
  return STARBASE_LEVEL_DEFINITIONS[starbase.level]?.combat.weaponMounts ?? [];
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

function resetFleetForBattle(fleet: GameFleet): void {
  fleet.orderType = null;
  fleet.targetStarId = null;
  fleet.route = [fleet.currentStarId];
  fleet.routeIndex = 0;
  fleet.movementPlan = null;
  clearFleetOrbit(fleet);
  setFleetPhase(fleet, "idle");
  fleet.hyperlanePosition = null;
  fleet.systemPosition = systemCenterPosition();
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
  const route = computeRetreatRoute(fleet);
  if (!route || route.length <= 1) {
    resetFleetForBattle(fleet);
    return;
  }
  fleet.route = route;
  fleet.routeIndex = 0;
  fleet.targetStarId = route[route.length - 1];
  fleet.orderType = "move";
  const destination = getDefaultMoveDestination(fleet.targetStarId);
  fleet.movementPlan = createFleetMovementPlan(fleet, route, "move", destination.position, destination.orbitTarget);
  applyFleetOrbitTarget(fleet, null);
  const firstSegment = fleet.movementPlan.segments[0];
  setFleetPhase(fleet, firstSegment?.kind === "hyperlane" ? "jumpingHyperlane" : "movingSystem");
  fleet.hyperlanePosition = null;
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

  for (const [starId, arrivals] of arrivalsByStar) {
    const existingBattle = getActiveBattleForStar(starId);
    if (existingBattle) {
      for (const fleet of arrivals) {
        const side = getBattleSideForFleet(existingBattle, fleet);
        addFleetToBattle(existingBattle, fleet, side, shipsById);
        resetFleetForBattle(fleet);
        fleetsChanged = true;
      }
      battlesChanged = true;
      continue;
    }

    const fleetsAtStar = state.fleets.filter((fleet) => (
      fleet.currentStarId === starId && (fleet.phase === "idle" || fleet.phase === "buildingStarbase")
    ));
    const arrivalFactions = Array.from(new Set(arrivals.map((fleet) => fleet.ownerId)));
    if (arrivalFactions.length === 0) continue;
    const attackerFactionId = arrivalFactions[0];
    const starbase = state.starbases.find((candidate) => candidate.starId === starId) ?? null;
    const enemyFleets = fleetsAtStar.filter((fleet) => fleet.ownerId !== attackerFactionId);
    const hasEnemyStarbase = !!starbase && starbase.ownerId !== attackerFactionId;
    const hasEnemyArrivals = arrivalFactions.some((factionId) => factionId !== attackerFactionId);
    const neutralSystem = (state.starOwnership[starId] ?? -1) === -1 && !starbase;

    if (!hasEnemyStarbase && enemyFleets.length === 0 && !(neutralSystem && hasEnemyArrivals)) {
      continue;
    }

    const defenderFactionId = hasEnemyStarbase
      ? starbase!.ownerId
      : (enemyFleets[0]?.ownerId ?? arrivalFactions.find((factionId) => factionId !== attackerFactionId) ?? attackerFactionId);

    const attackerFleets = fleetsAtStar.filter((fleet) => fleet.ownerId === attackerFactionId);
    const defenderFleets = fleetsAtStar.filter((fleet) => fleet.ownerId === defenderFactionId);

    const battle: GameBattle = {
      id: createRuntimeId("battle", [starId, attackerFactionId, defenderFactionId]),
      starId,
      attackerFactionId,
      defenderFactionId,
      attackerFleetIds: [],
      defenderFleetIds: [],
      starbaseId: starbase?.id ?? null,
      ships: [],
      starbase: starbase && starbase.ownerId === defenderFactionId ? buildBattleStarbaseState(starbase) : null,
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
    for (const fleet of defenderFleets) {
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
    if (battle.phase === "resolved") {
      if (battle.resolvedAtRound !== undefined && battle.round - battle.resolvedAtRound >= 1) {
        battlesToRemove.add(battle.id);
        battlesChanged = true;
      }
      continue;
    }

    battle.round += 1;
    const actionsByActor = new Map<string, ServerBattleAction>();
    const hitTargets = new Set<string>();

    const shipStates = battle.ships;
    const shipStateById = new Map(shipStates.map((ship) => [ship.shipId, ship]));
    const starbaseState = battle.starbase && !battle.starbase.destroyed ? battle.starbase : null;
    const starbaseEntity = starbaseState ? state.starbases.find((sb) => sb.id === starbaseState.starbaseId) ?? null : null;

    for (const shipState of shipStates) {
      if (shipState.destroyed) continue;
      const sensorRange = getShipSensorRange(shipState, shipsById);
      const enemies = shipStates.filter((candidate) => (
        !candidate.destroyed
        && candidate.side !== shipState.side
        && Math.abs(candidate.zone - shipState.zone) <= sensorRange
      ));

      if (shipState.side === "attacker" && starbaseState && starbaseEntity) {
        if (Math.abs(starbaseState.zone - shipState.zone) <= sensorRange) {
          enemies.push({
            shipId: starbaseState.starbaseId,
            fleetId: "",
            ownerId: starbaseState.ownerId,
            side: "defender",
            zone: starbaseState.zone,
            targetId: null,
            shield: starbaseState.shield,
            maxShield: starbaseState.maxShield,
            armor: starbaseState.armor,
            maxArmor: starbaseState.maxArmor,
            hull: starbaseState.hull,
            maxHull: starbaseState.maxHull,
            destroyed: starbaseState.destroyed,
            lastHitRound: starbaseState.lastHitRound,
          });
        }
      }

      if (enemies.length === 0) {
        shipState.targetId = null;
        continue;
      }

      enemies.sort((a, b) => Math.abs(a.zone - shipState.zone) - Math.abs(b.zone - shipState.zone));
      const closest = enemies[0];
      if (Math.random() < 0.2 && enemies.length > 1) {
        const weighted = enemies.slice(1);
        const pick = weighted[Math.floor(Math.random() * weighted.length)];
        shipState.targetId = pick.shipId;
      } else {
        shipState.targetId = closest.shipId;
      }
    }

    let starbaseTargetId: string | null = null;
    if (starbaseState && starbaseEntity) {
      const sensorRange = STARBASE_LEVEL_DEFINITIONS[starbaseEntity.level]?.combat.sensorRange ?? 1;
      const attackers = shipStates.filter((ship) => (
        !ship.destroyed && ship.side === "attacker" && Math.abs(ship.zone - starbaseState.zone) <= sensorRange
      ));
      if (attackers.length > 0) {
        attackers.sort((a, b) => Math.abs(a.zone - starbaseState.zone) - Math.abs(b.zone - starbaseState.zone));
        starbaseTargetId = attackers[0].shipId;
      }
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

      const maxRange = mounts.reduce((max, mount) => Math.max(max, getWeaponRange(mount)), 0);
      if (Math.abs(shipState.zone - targetZone) > maxRange) continue;

      const action = ensureAction(shipState.shipId);
      let totalShieldDamage = 0;
      let totalArmorDamage = 0;
      let totalHullDamage = 0;
      let anyHit = false;

      const targetEvasion = targetShip
        ? getShipEvasion(targetShip, fleetsById, shipsById)
        : (starbaseEntity ? STARBASE_LEVEL_DEFINITIONS[starbaseEntity.level]?.combat.evasion ?? 0 : 0);

      for (const mount of mounts) {
        if (targetShip?.destroyed) break;
        if (starbaseState?.destroyed && targetIsStarbase) break;
        const hitChance = clamp(mount.accuracy - targetEvasion, 0, 1);
        if (Math.random() >= hitChance) {
          continue;
        }
        anyHit = true;

        if (targetShip) {
          const result = applyWeaponHit(mount, targetShip);
          totalShieldDamage += result.shieldDamage;
          totalArmorDamage += result.armorDamage;
          totalHullDamage += result.hullDamage;
          targetShip.lastHitRound = battle.round;
          hitTargets.add(targetShip.shipId);
          if (result.destroyed) {
            targetShip.destroyed = true;
          }
        } else if (targetIsStarbase && starbaseState) {
          const result = applyWeaponHit(mount, starbaseState);
          totalShieldDamage += result.shieldDamage;
          totalArmorDamage += result.armorDamage;
          totalHullDamage += result.hullDamage;
          starbaseState.lastHitRound = battle.round;
          hitTargets.add(starbaseState.starbaseId);
          if (result.destroyed) {
            starbaseState.destroyed = true;
          }
        }
      }

      const targetDestroyed = targetShip ? targetShip.destroyed : (targetIsStarbase ? !!starbaseState?.destroyed : false);
      action.fired = {
        targetId: shipState.targetId,
        hit: anyHit,
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
          const maxRange = mounts.reduce((max, mount) => Math.max(max, getWeaponRange(mount)), 0);
          if (Math.abs(target.zone - starbaseState.zone) <= maxRange) {
            const action = ensureAction(starbaseState.starbaseId);
            let totalShieldDamage = 0;
            let totalArmorDamage = 0;
            let totalHullDamage = 0;
            let anyHit = false;
            const targetEvasion = getShipEvasion(target, fleetsById, shipsById);

            for (const mount of mounts) {
              if (target.destroyed) break;
              const hitChance = clamp(mount.accuracy - targetEvasion, 0, 1);
              if (Math.random() >= hitChance) {
                continue;
              }
              anyHit = true;
              const result = applyWeaponHit(mount, target);
              totalShieldDamage += result.shieldDamage;
              totalArmorDamage += result.armorDamage;
              totalHullDamage += result.hullDamage;
              target.lastHitRound = battle.round;
              hitTargets.add(target.shipId);
              if (result.destroyed) {
                target.destroyed = true;
              }
            }

            action.fired = {
              targetId: target.shipId,
              hit: anyHit,
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
          const rebuilt: ServerStarbase = {
            ...starbase,
            ownerId: winnerFactionId,
            status: "online",
            buildProgress: 1,
            level: "outpost",
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
    movementPlan: fleet.movementPlan,
    orbitTargetPlanetId: fleet.orbitTargetPlanetId,
    orbitOffset: fleet.orbitOffset,
    orbitTarget: fleet.orbitTarget,
    mergeTargetFleetId: fleet.mergeTargetFleetId,
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
    return result.starbase;
  });

  if (!changed) return false;
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  return true;
}

function spawnCompletedShip(starbase: ServerStarbase, item: { shipKind: StarbaseShipKind }): void {
  const fleetId = createRuntimeId("fleet", [starbase.ownerId, starbase.starId]);
  const ship = createShip(
    starbase.ownerId,
    fleetId,
    item.shipKind,
    createRuntimeId("ship", [starbase.ownerId, item.shipKind]),
  );
  const fleet = createFleet(starbase.ownerId, starbase.starId, [ship.id], fleetId);
  fleet.phaseStartedAtYear = state.clock.year;
  fleet.speed = ship.speed;
  fleet.systemPosition = getSystemStarbaseOrbitPosition();
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
  const movingAfter = state.fleets.some((fleet) => fleet.phase !== "idle");
  if (movingBefore || movingAfter) {
    refreshDiscovery();
  }

  const battleResult = processBattles(arrivingFleets);
  if (battleResult.battlesChanged) changed.add("battles");
  if (battleResult.shipsChanged) changed.add("ships");
  if (battleResult.fleetsChanged) changed.add("fleets");
  if (battleResult.starbasesChanged) changed.add("starbases");
  if (battleResult.ownershipChanged) {
    changed.add("visibility");
  }
  if (battleResult.visibilityChanged) {
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
    handleBuildStarbaseShip(session.socket, session.perspective, command.starbaseId, command.shipKind);
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
