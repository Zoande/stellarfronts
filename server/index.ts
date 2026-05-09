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
  addResourceCounts,
  BUILDING_KINDS,
  cloneResourceCounts,
  createEmptyResourceCounts,
  createInitialFactionEconomyState,
  gameYearToMonthIndex,
  isBuildingCompatible,
  recalculatePlanetStateEconomy,
  URBAN_SUB_DISTRICT_KINDS,
} from "../src/data/Economy";
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
  FactionState,
  GameClock,
  GameUpdate,
  GameSnapshot,
  ServerEvent,
  ServerShip,
  ServerStarbase,
  ServerUpdateField,
  ShipTransitPhase,
} from "../src/game/GameProtocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "state", "game-state.json");
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
const GAME_START_YEAR = 2100;
const GAME_DAYS_PER_YEAR = 360;
const REAL_MS_PER_GAME_DAY = 30_000;
const GAME_MONTHS_PER_YEAR = 12;
const GAME_MONTH_DAYS = GAME_DAYS_PER_YEAR / GAME_MONTHS_PER_YEAR;
const DISCOVERY_JUMPS = 2;
const DEPART_DURATION_MS = 120_000;
const JUMP_DURATION_MS = 30_000;
const ARRIVE_DURATION_MS = 150_000;
const BUILD_DURATION_MS = 1_800_000;
const SAVE_INTERVAL_MS = 5_000;
const SERVER_TICK_INTERVAL_MS = REAL_MS_PER_GAME_DAY;

interface GameShip extends ServerShip {
  phaseElapsedMs: number;
}

interface GameState {
  schemaVersion: 4;
  stars: StarData[];
  planetStates: PlanetState[];
  factionEconomies: FactionEconomyState[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  ships: GameShip[];
  discoveredByFaction: Record<string, number[]>;
  lastKnownOwnershipByFaction: Record<string, number[]>;
  clock: GameClock & { lastUpdatedAt: number };
}

interface ClientSession {
  socket: WebSocket;
  perspective: GalaxyPerspective;
}

const clients = new Set<ClientSession>();
let state: GameState;
let lastSaveAt = 0;
let hasDirtyState = false;

function systemCenterPosition() {
  return { x: 23, y: 4.8, z: -19 };
}

function systemExitPosition() {
  return { x: 42, y: 4.8, z: -28 };
}

function systemEntryPosition() {
  return { x: -42, y: 4.8, z: 28 };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function interpolateSystemPosition(
  from: ReturnType<typeof systemCenterPosition>,
  to: ReturnType<typeof systemCenterPosition>,
  progress: number,
) {
  return {
    x: mix(from.x, to.x, progress),
    y: mix(from.y, to.y, progress),
    z: mix(from.z, to.z, progress),
  };
}

function currentEconomyMonth(nextState = state): number {
  return gameYearToMonthIndex(nextState.clock.year);
}

function currentPopulationQuarter(nextState = state): number {
  return Math.floor(currentEconomyMonth(nextState) / 4);
}

function recalculatePlanetEconomies(nextState = state): void {
  nextState.planetStates = nextState.planetStates.map((planetState) => recalculatePlanetStateEconomy(planetState));
  applyPlanetStatesToStars(nextState.stars, nextState.planetStates);
}

function calculateFactionMonthlyDelta(nextState: GameState, factionId: number) {
  let delta = createEmptyResourceCounts();
  for (const planetState of nextState.planetStates) {
    if (!planetState.isHabited) continue;
    if ((nextState.starOwnership[planetState.starId] ?? -1) !== factionId) continue;
    delta = addResourceCounts(delta, planetState.economy.net);
  }
  return delta;
}

function refreshFactionEconomyDeltas(nextState = state): void {
  for (const economy of nextState.factionEconomies) {
    economy.monthlyDelta = calculateFactionMonthlyDelta(nextState, economy.factionId);
  }
}

function normalizeResourceCounts(counts?: Partial<ResourceCounts>): ResourceCounts {
  return {
    ...createEmptyResourceCounts(),
    ...counts,
  };
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
  const planetStates = buildPlanetStatesFromStars(stars);
  applyPlanetStatesToStars(stars, planetStates);
  const starOwnership = buildHomeSystemOwnership(stars, factions);
  const starbases = factions.map<ServerStarbase>((faction) => ({
    id: `starbase-${faction.id}`,
    ownerId: faction.id,
    starId: faction.homeStarId,
    status: "online",
    buildProgress: 1,
  }));
  const ships = factions.map<GameShip>((faction) => ({
    id: `ship-${faction.id}-1`,
    ownerId: faction.id,
    currentStarId: faction.homeStarId,
    targetStarId: null,
    phase: "idle",
    phaseStartedAtYear: GAME_START_YEAR,
    phaseDurationDays: 0,
    route: [faction.homeStarId],
    routeIndex: 0,
    phaseProgress: 0,
    phaseElapsedMs: 0,
    orderType: null,
    systemPosition: systemCenterPosition(),
    hyperlanePosition: null,
  }));

  const now = Date.now();
  const startMonth = gameYearToMonthIndex(GAME_START_YEAR);
  const created: GameState = {
    schemaVersion: 4,
    stars,
    planetStates,
    factionEconomies: factions.map((faction) => createInitialFactionEconomyState(faction.id, startMonth)),
    hyperlanes,
    adjacency,
    factions,
    starOwnership,
    starbases,
    ships,
    discoveredByFaction: {},
    lastKnownOwnershipByFaction: {},
    clock: {
      year: GAME_START_YEAR,
      speedMultiplier: 1,
      lastUpdatedAt: now,
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
    parsed.schemaVersion = 4;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
    parsed.lastKnownOwnershipByFaction = parsed.lastKnownOwnershipByFaction ?? {};
    parsed.clock.lastUpdatedAt = parsed.clock.lastUpdatedAt ?? Date.now();
    parsed.ships = parsed.ships.map((ship) => ({
      ...ship,
      phaseElapsedMs: ship.phaseElapsedMs ?? Math.round((ship.phaseProgress ?? 0) * phaseDuration(ship.phase)),
      phaseStartedAtYear: ship.phaseStartedAtYear
        ?? parsed.clock.year - (ship.phaseProgress ?? 0) * phaseDurationYears(ship.phase),
      phaseDurationDays: ship.phaseDurationDays ?? phaseDurationDays(ship.phase),
      systemPosition: ship.systemPosition ?? systemCenterPosition(),
      hyperlanePosition: ship.hyperlanePosition ?? null,
    }));
    const metadataChanged = normalizeCelestialObjectDetails(parsed.stars);
    const habitationChanged = ensureHabitedHomePlanets(
      parsed.stars,
      parsed.factions.map((faction) => faction.homeStarId),
    );
    const normalizedPlanetStates = normalizePlanetStates(parsed.stars, parsed.planetStates ?? []);
    parsed.planetStates = normalizedPlanetStates.planetStates;
    recalculatePlanetEconomies(parsed);
    const normalizedFactionEconomies = normalizeFactionEconomies(parsed);
    const factionEconomiesChanged = JSON.stringify(parsed.factionEconomies ?? []) !== JSON.stringify(normalizedFactionEconomies);
    parsed.factionEconomies = normalizedFactionEconomies;
    refreshFactionEconomyDeltas(parsed);
    const planetStateApplied = applyPlanetStatesToStars(parsed.stars, parsed.planetStates);
    if (metadataChanged || habitationChanged || normalizedPlanetStates.changed || planetStateApplied || factionEconomiesChanged) {
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

function phaseDuration(phase: ShipTransitPhase): number {
  switch (phase) {
    case "departingSystem":
      return DEPART_DURATION_MS;
    case "jumpingHyperlane":
      return JUMP_DURATION_MS;
    case "arrivingSystem":
      return ARRIVE_DURATION_MS;
    case "buildingStarbase":
      return BUILD_DURATION_MS;
    default:
      return 1;
  }
}

function phaseDurationDays(phase: ShipTransitPhase): number {
  if (phase === "idle") return 0;
  return phaseDuration(phase) / REAL_MS_PER_GAME_DAY;
}

function phaseDurationYears(phase: ShipTransitPhase): number {
  return phaseDurationDays(phase) / GAME_DAYS_PER_YEAR;
}

function setShipPhase(ship: GameShip, phase: ShipTransitPhase): void {
  ship.phase = phase;
  ship.phaseElapsedMs = 0;
  ship.phaseProgress = 0;
  ship.phaseStartedAtYear = state?.clock?.year ?? ship.phaseStartedAtYear ?? GAME_START_YEAR;
  ship.phaseDurationDays = phaseDurationDays(phase);
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

  for (const ship of nextState.ships) {
    if (ship.ownerId !== factionId) continue;
    addDiscoveryFrom(nextState, ship.currentStarId, visible);
    if (ship.hyperlanePosition) {
      addDiscoveryFrom(nextState, ship.hyperlanePosition.fromStarId, visible);
      addDiscoveryFrom(nextState, ship.hyperlanePosition.toStarId, visible);
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

function isShipVisible(ship: ServerShip, visible: Set<number> | null, perspective: GalaxyPerspective): boolean {
  if (visible === null) return true;
  if (perspective.mode === "faction" && ship.ownerId === perspective.factionId) return true;
  if (visible.has(ship.currentStarId)) return true;
  return !!ship.hyperlanePosition
    && (visible.has(ship.hyperlanePosition.fromStarId) || visible.has(ship.hyperlanePosition.toStarId));
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
  if (changed.includes("starbases")) {
    update.starbases = visibleState.starbases;
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
  const ships = state.ships.filter((ship) => isShipVisible(ship, visibleSet, perspective));
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

  return {
    clock: {
      year: state.clock.year,
      speedMultiplier: state.clock.speedMultiplier,
    },
    hyperlanes,
    factions,
    starOwnership: toOwnershipEntries(starOwnership),
    visibleStarIds,
    knownStarIds,
    ships,
    starbases,
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
  for (const starId of route) {
    const owner = getKnownOwnership(ownerId, starId);
    if (owner >= 0 && owner !== ownerId) return false;
  }
  return true;
}

function findRoute(ship: GameShip, targetStarId: number): number[] | null {
  const discovered = new Set(state.discoveredByFaction[String(ship.ownerId)] ?? []);
  if (!discovered.has(targetStarId)) return null;
  const queue: number[] = [ship.currentStarId];
  const previous = new Map<number, number | null>([[ship.currentStarId, null]]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetStarId) break;
    for (const neighbor of state.adjacency[current] ?? []) {
      if (previous.has(neighbor)) continue;
      if (!discovered.has(neighbor)) continue;
      const owner = getKnownOwnership(ship.ownerId, neighbor);
      if (owner >= 0 && owner !== ship.ownerId) continue;
      previous.set(neighbor, current);
      queue.push(neighbor);
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
  return route.length > 1 && routeIsAllowed(route, ship.ownerId) ? route : null;
}

function startOrder(ship: GameShip, targetStarId: number, orderType: "move" | "build"): void {
  if (orderType === "build" && ship.currentStarId === targetStarId) {
    ship.targetStarId = targetStarId;
    ship.orderType = orderType;
    ship.route = [ship.currentStarId];
    ship.routeIndex = 0;
    setShipPhase(ship, "buildingStarbase");
    ship.systemPosition = systemCenterPosition();
    ship.hyperlanePosition = null;
    return;
  }

  const route = findRoute(ship, targetStarId);
  if (!route) throw new Error("No discovered safe route to target.");
  ship.targetStarId = targetStarId;
  ship.orderType = orderType;
  ship.route = route;
  ship.routeIndex = 0;
  setShipPhase(ship, "departingSystem");
  ship.systemPosition = systemCenterPosition();
  ship.hyperlanePosition = null;
}

function validateCommandPerspective(perspective: GalaxyPerspective): number | null {
  return perspective.mode === "faction" ? perspective.factionId : null;
}

function handleMove(socket: WebSocket, perspective: GalaxyPerspective, shipId: string, targetStarId: number): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const ship = state.ships.find((candidate) => candidate.id === shipId);
  if (!ship) return reject(socket, "Ship not found.");
  if (ship.ownerId !== factionId) return reject(socket, "You do not own that ship.");
  if (ship.phase !== "idle") return reject(socket, "Ship is already busy.");
  const targetOwner = getKnownOwnership(factionId, targetStarId);
  if (targetOwner >= 0 && targetOwner !== factionId) return reject(socket, "Cannot enter another faction's territory.");
  try {
    startOrder(ship, targetStarId, "move");
    hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Move order accepted.");
    broadcastUpdates(["clock", "ships", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Move order rejected.");
  }
}

function handleBuild(socket: WebSocket, perspective: GalaxyPerspective, shipId: string, targetStarId: number): void {
  const factionId = validateCommandPerspective(perspective);
  if (factionId === null) return reject(socket, "Observer mode is read-only.");
  const ship = state.ships.find((candidate) => candidate.id === shipId);
  if (!ship) return reject(socket, "Ship not found.");
  if (ship.ownerId !== factionId) return reject(socket, "You do not own that ship.");
  if (ship.phase !== "idle") return reject(socket, "Ship is already busy.");
  if (getKnownOwnership(factionId, targetStarId) !== -1) return reject(socket, "Can only build in unowned systems.");
  if (state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(socket, "System already has a starbase.");
  try {
    startOrder(ship, targetStarId, "build");
    hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Build order accepted.");
    broadcastUpdates(["clock", "ships", "visibility"]);
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Build order rejected.");
  }
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
  return state.stars[planetState.starId]?.system.planets[planetState.planetIndex]?.objectDetails.districtLimits ?? null;
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
  state.planetStates[index] = recalculatePlanetStateEconomy(nextPlanetState);
  applyPlanetStatesToStars(state.stars, state.planetStates);
  refreshFactionEconomyDeltas();
  hasDirtyState = true;
  accept(socket, message);
  sendPlanetDetails(socket, perspective, nextPlanetState.id);
  broadcastUpdates(["clock", "factionEconomies", "habitedPlanetSystems"]);
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

  commitPlanetState(socket, perspective, "District built.", {
    ...planetState,
    builtDistricts: {
      ...planetState.builtDistricts,
      [districtKind]: planetState.builtDistricts[districtKind] + 1,
    },
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
    if (!isBuildingCompatible(buildingKind, area, subDistrict.kind)) {
      return reject(socket, "Building is incompatible with this sub-district.");
    }

    const urbanSubDistricts = planetState.urbanSubDistricts.map((candidate, index) => (
      index === subDistrictIndex
        ? {
          ...candidate,
          buildings: candidate.buildings.map((building, buildingIndex) => (
            buildingIndex === slotIndex ? buildingKind : building
          )),
        }
        : candidate
    ));
    commitPlanetState(socket, perspective, "Building constructed.", { ...planetState, urbanSubDistricts });
    return;
  }

  if (!isDistrictKind(area)) return reject(socket, "Invalid building area.");
  const slots = planetState.buildings[area];
  if (!isValidSlotIndex(slotIndex, slots.length)) return reject(socket, "Invalid building slot.");
  if (slots[slotIndex]) return reject(socket, "Building slot is occupied.");
  if (!isBuildingCompatible(buildingKind, area)) return reject(socket, "Building is incompatible with this district.");

  commitPlanetState(socket, perspective, "Building constructed.", {
    ...planetState,
    buildings: {
      ...planetState.buildings,
      [area]: slots.map((building, index) => (index === slotIndex ? buildingKind : building)),
    },
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

  commitPlanetState(socket, perspective, "Sub-district changed.", { ...planetState, urbanSubDistricts });
}

function completeShipOrder(ship: GameShip): void {
  if (ship.orderType === "build" && ship.targetStarId !== null) {
    const starId = ship.targetStarId;
    const starbaseExists = state.starbases.some((starbase) => starbase.starId === starId);
    if (!starbaseExists) {
      state.starbases.push({
        id: `starbase-${ship.ownerId}-${starId}-${Date.now()}`,
        ownerId: ship.ownerId,
        starId,
        status: "online",
        buildProgress: 1,
      });
      state.starOwnership[starId] = ship.ownerId;
    }
  }

  ship.targetStarId = null;
  ship.orderType = null;
  ship.route = [ship.currentStarId];
  ship.routeIndex = 0;
  setShipPhase(ship, "idle");
  ship.hyperlanePosition = null;
  ship.systemPosition = systemCenterPosition();
}

function advanceShip(ship: GameShip, scaledMs: number): void {
  let remaining = scaledMs;
  while (remaining > 0 && ship.phase !== "idle") {
    const duration = phaseDuration(ship.phase);
    const available = duration - ship.phaseElapsedMs;
    const step = Math.min(remaining, available);
    ship.phaseElapsedMs += step;
    ship.phaseProgress = Math.max(0, Math.min(1, ship.phaseElapsedMs / duration));
    remaining -= step;

    if (ship.phase === "departingSystem") {
      ship.systemPosition = interpolateSystemPosition(systemCenterPosition(), systemExitPosition(), ship.phaseProgress);
    } else if (ship.phase === "jumpingHyperlane") {
      const fromStarId = ship.route[ship.routeIndex];
      const toStarId = ship.route[ship.routeIndex + 1];
      ship.hyperlanePosition = { fromStarId, toStarId, progress: ship.phaseProgress };
    } else if (ship.phase === "arrivingSystem") {
      ship.systemPosition = interpolateSystemPosition(systemEntryPosition(), systemCenterPosition(), ship.phaseProgress);
    }

    if (ship.phaseElapsedMs < duration) break;

    ship.phaseElapsedMs = 0;
    ship.phaseProgress = 0;

    if (ship.phase === "departingSystem") {
      setShipPhase(ship, "jumpingHyperlane");
      const fromStarId = ship.route[ship.routeIndex];
      const toStarId = ship.route[ship.routeIndex + 1];
      ship.hyperlanePosition = { fromStarId, toStarId, progress: 0 };
    } else if (ship.phase === "jumpingHyperlane") {
      ship.currentStarId = ship.route[ship.routeIndex + 1];
      ship.routeIndex += 1;
      ship.hyperlanePosition = null;
      setShipPhase(ship, "arrivingSystem");
      ship.systemPosition = systemEntryPosition();
    } else if (ship.phase === "arrivingSystem") {
      if (ship.routeIndex < ship.route.length - 1) {
        setShipPhase(ship, "departingSystem");
        ship.systemPosition = systemCenterPosition();
      } else if (ship.orderType === "build") {
        setShipPhase(ship, "buildingStarbase");
        ship.systemPosition = systemCenterPosition();
      } else {
        completeShipOrder(ship);
      }
    } else if (ship.phase === "buildingStarbase") {
      completeShipOrder(ship);
    }
  }
}

function shipUpdateSignature(): string {
  return JSON.stringify(state.ships.map((ship) => ({
    id: ship.id,
    ownerId: ship.ownerId,
    currentStarId: ship.currentStarId,
    targetStarId: ship.targetStarId,
    phase: ship.phase,
    phaseStartedAtYear: ship.phaseStartedAtYear,
    phaseDurationDays: ship.phaseDurationDays,
    route: ship.route,
    routeIndex: ship.routeIndex,
    orderType: ship.orderType,
  })));
}

function processEconomyMonths(targetMonth: number): boolean {
  recalculatePlanetEconomies();
  refreshFactionEconomyDeltas();
  let processed = false;
  for (const economy of state.factionEconomies) {
    while (economy.lastProcessedMonth < targetMonth) {
      economy.stockpiles = addResourceCounts(economy.stockpiles, economy.monthlyDelta);
      economy.lastProcessedMonth += 1;
      processed = true;
    }
  }
  if (processed) {
    hasDirtyState = true;
  }
  return processed;
}

function processPopulationQuarter(_targetQuarter: number): boolean {
  // Population growth is intentionally not implemented yet. This hook exists so
  // future population simulation has a single four-month cadence to attach to.
  return false;
}

function advanceState(now: number): Set<ServerUpdateField> {
  const changed = new Set<ServerUpdateField>();
  const elapsedMs = Math.max(0, now - state.clock.lastUpdatedAt);
  if (elapsedMs <= 0) return changed;
  const previousEconomyMonth = currentEconomyMonth();
  const previousPopulationQuarter = currentPopulationQuarter();
  const previousShipSignature = shipUpdateSignature();
  const scaledMs = elapsedMs * state.clock.speedMultiplier;
  state.clock.year += (scaledMs / REAL_MS_PER_GAME_DAY) / GAME_DAYS_PER_YEAR;
  state.clock.lastUpdatedAt = now;
  changed.add("clock");

  const movingBefore = state.ships.some((ship) => ship.phase !== "idle");
  for (const ship of state.ships) {
    advanceShip(ship, scaledMs);
  }
  const movingAfter = state.ships.some((ship) => ship.phase !== "idle");
  if (movingBefore || movingAfter) {
    refreshDiscovery();
  }

  if (shipUpdateSignature() !== previousShipSignature) {
    hasDirtyState = true;
    changed.add("ships");
    changed.add("visibility");
    changed.add("starbases");
  }

  const nextEconomyMonth = currentEconomyMonth();
  if (nextEconomyMonth > previousEconomyMonth) {
    if (processEconomyMonths(nextEconomyMonth)) {
      changed.add("factionEconomies");
    }
  }

  const nextPopulationQuarter = currentPopulationQuarter();
  if (nextPopulationQuarter > previousPopulationQuarter && processPopulationQuarter(nextPopulationQuarter)) {
    changed.add("factionEconomies");
    changed.add("habitedPlanetSystems");
  }

  return changed;
}

function handleCommand(session: ClientSession, command: ClientCommand): void {
  if (command.type === "join") {
    session.perspective = command.perspective;
    sendEvent(session.socket, createSnapshot(session.perspective));
    return;
  }
  if (command.type === "moveShip") {
    handleMove(session.socket, session.perspective, command.shipId, command.targetStarId);
    return;
  }
  if (command.type === "buildStarbase") {
    handleBuild(session.socket, session.perspective, command.shipId, command.targetStarId);
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
    sendPlanetDetails(session.socket, session.perspective, command.planetId);
    return;
  }
  if (command.type === "setSpeedMultiplier") {
    const allowed = new Set([1, 2, 3, 4, 5, 50, 100, 200, 500]);
    if (!allowed.has(command.multiplier)) return reject(session.socket, "Unsupported speed multiplier.");
    state.clock.speedMultiplier = command.multiplier;
    hasDirtyState = true;
    accept(session.socket, `Speed set to ${command.multiplier}x.`);
    broadcastUpdates(["clock"]);
  }
}

state = await loadState();
advanceState(Date.now());
await saveState(state);

const wss = new WebSocketServer({ port: PORT });
wss.on("connection", (socket) => {
  const session: ClientSession = { socket, perspective: { mode: "observer" } };
  clients.add(session);
  sendEvent(socket, { type: "serverInfo", message: "Connected to StellarFronts game server." });

  socket.on("message", (data) => {
    try {
      const command = JSON.parse(String(data)) as ClientCommand;
      handleCommand(session, command);
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
  if (hasDirtyState && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) {
    void saveState().catch((error) => console.error("[GameServer] Failed to save state", error));
  }
}, SERVER_TICK_INTERVAL_MS);

console.log(`[GameServer] Listening on ws://localhost:${PORT}`);
