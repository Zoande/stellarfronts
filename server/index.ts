import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { GALAXY_MAP } from "../src/data/GalaxyMap";
import { buildFactions, buildHomeSystemOwnership, computeVisibleStarIds } from "../src/data/Factions";
import type { FactionInfo, GalaxyPerspective } from "../src/data/Factions";
import { generateStarMap } from "../src/data/StarMap";
import type { StarData } from "../src/data/StarMap";
import { buildHyperlaneAdjacency, buildHyperlanePairs } from "../src/data/Hyperlanes";
import type {
  ClientCommand,
  FactionState,
  GameClock,
  GameSnapshot,
  ServerEvent,
  ServerShip,
  ServerStarbase,
  ShipTransitPhase,
} from "../src/game/GameProtocol";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "state", "game-state.json");
const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
const GAME_START_YEAR = 2100;
const GAME_YEARS_PER_REAL_DAY = 8;
const DISCOVERY_JUMPS = 2;
const DEPART_DURATION_MS = 120_000;
const JUMP_DURATION_MS = 30_000;
const ARRIVE_DURATION_MS = 150_000;
const BUILD_DURATION_MS = 1_800_000;
const SAVE_INTERVAL_MS = 5_000;
const BROADCAST_INTERVAL_MS = 1_000;

interface GameShip extends ServerShip {
  phaseElapsedMs: number;
}

interface GameState {
  schemaVersion: 1;
  stars: StarData[];
  hyperlanes: Array<[number, number]>;
  adjacency: number[][];
  factions: FactionInfo[];
  starOwnership: number[];
  starbases: ServerStarbase[];
  ships: GameShip[];
  discoveredByFaction: Record<string, number[]>;
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
    route: [faction.homeStarId],
    routeIndex: 0,
    phaseProgress: 0,
    phaseElapsedMs: 0,
    orderType: null,
    systemPosition: systemCenterPosition(),
    hyperlanePosition: null,
  }));

  const now = Date.now();
  const created: GameState = {
    schemaVersion: 1,
    stars,
    hyperlanes,
    adjacency,
    factions,
    starOwnership,
    starbases,
    ships,
    discoveredByFaction: {},
    clock: {
      year: GAME_START_YEAR,
      speedMultiplier: 1,
      lastUpdatedAt: now,
    },
  };
  refreshDiscovery(created);
  return created;
}

async function loadState(): Promise<GameState> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as GameState;
    parsed.adjacency = parsed.adjacency ?? buildHyperlaneAdjacency(parsed.hyperlanes, parsed.stars.length);
    parsed.discoveredByFaction = parsed.discoveredByFaction ?? {};
    parsed.clock.lastUpdatedAt = parsed.clock.lastUpdatedAt ?? Date.now();
    parsed.ships = parsed.ships.map((ship) => ({
      ...ship,
      phaseElapsedMs: ship.phaseElapsedMs ?? Math.round((ship.phaseProgress ?? 0) * phaseDuration(ship.phase)),
      systemPosition: ship.systemPosition ?? systemCenterPosition(),
      hyperlanePosition: ship.hyperlanePosition ?? null,
    }));
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

function addDiscoveryFrom(nextState: GameState, sourceStarId: number, visible: Set<number>): void {
  if (sourceStarId < 0 || sourceStarId >= nextState.adjacency.length) return;
  for (const starId of computeVisibleStarIds(nextState.adjacency, sourceStarId, DISCOVERY_JUMPS)) {
    visible.add(starId);
  }
}

function refreshDiscovery(nextState = state): void {
  for (const faction of nextState.factions) {
    const discovered = new Set<number>();
    addDiscoveryFrom(nextState, faction.homeStarId, discovered);
    for (const starbase of nextState.starbases) {
      if (starbase.ownerId === faction.id && starbase.status === "online") {
        addDiscoveryFrom(nextState, starbase.starId, discovered);
      }
    }
    for (const ship of nextState.ships) {
      if (ship.ownerId === faction.id) addDiscoveryFrom(nextState, ship.currentStarId, discovered);
      if (ship.ownerId === faction.id && ship.hyperlanePosition) {
        addDiscoveryFrom(nextState, ship.hyperlanePosition.fromStarId, discovered);
        addDiscoveryFrom(nextState, ship.hyperlanePosition.toStarId, discovered);
      }
    }
    nextState.discoveredByFaction[String(faction.id)] = Array.from(discovered).sort((a, b) => a - b);
  }
}

function getVisibleSet(perspective: GalaxyPerspective): Set<number> | null {
  if (perspective.mode === "observer") return null;
  return new Set(state.discoveredByFaction[String(perspective.factionId)] ?? []);
}

function isShipVisible(ship: ServerShip, visible: Set<number> | null, perspective: GalaxyPerspective): boolean {
  if (visible === null) return true;
  if (perspective.mode === "faction" && ship.ownerId === perspective.factionId) return true;
  if (visible.has(ship.currentStarId)) return true;
  return !!ship.hyperlanePosition
    && (visible.has(ship.hyperlanePosition.fromStarId) || visible.has(ship.hyperlanePosition.toStarId));
}

function createSnapshot(perspective: GalaxyPerspective): GameSnapshot {
  const visibleSet = getVisibleSet(perspective);
  const visibleStarIds = visibleSet ? Array.from(visibleSet).sort((a, b) => a - b) : null;
  const factions: FactionState[] = state.factions.map((faction) => ({
    ...faction,
    discoveredStarIds: state.discoveredByFaction[String(faction.id)] ?? [],
  }));
  const starbases = visibleSet
    ? state.starbases.filter((starbase) => visibleSet.has(starbase.starId))
    : state.starbases;
  const ships = state.ships.filter((ship) => isShipVisible(ship, visibleSet, perspective));

  return {
    type: "snapshot",
    perspective,
    clock: {
      year: state.clock.year,
      speedMultiplier: state.clock.speedMultiplier,
    },
    stars: state.stars,
    hyperlanes: state.hyperlanes,
    factions,
    starOwnership: state.starOwnership,
    visibleStarIds,
    ships,
    starbases,
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

function reject(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: false, message });
}

function accept(socket: WebSocket, message: string): void {
  sendEvent(socket, { type: "commandResult", ok: true, message });
}

function routeIsAllowed(route: number[], ownerId: number): boolean {
  for (const starId of route) {
    const owner = state.starOwnership[starId] ?? -1;
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
      const owner = state.starOwnership[neighbor] ?? -1;
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
  const route = findRoute(ship, targetStarId);
  if (!route) throw new Error("No discovered safe route to target.");
  ship.targetStarId = targetStarId;
  ship.orderType = orderType;
  ship.route = route;
  ship.routeIndex = 0;
  ship.phase = "departingSystem";
  ship.phaseElapsedMs = 0;
  ship.phaseProgress = 0;
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
  const targetOwner = state.starOwnership[targetStarId] ?? -1;
  if (targetOwner >= 0 && targetOwner !== factionId) return reject(socket, "Cannot enter another faction's territory.");
  try {
    startOrder(ship, targetStarId, "move");
    hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Move order accepted.");
    broadcastSnapshots();
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
  if ((state.starOwnership[targetStarId] ?? -1) !== -1) return reject(socket, "Can only build in unowned systems.");
  if (state.starbases.some((starbase) => starbase.starId === targetStarId)) return reject(socket, "System already has a starbase.");
  try {
    startOrder(ship, targetStarId, "build");
    hasDirtyState = true;
    refreshDiscovery();
    accept(socket, "Build order accepted.");
    broadcastSnapshots();
  } catch (error) {
    reject(socket, error instanceof Error ? error.message : "Build order rejected.");
  }
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
  ship.phase = "idle";
  ship.phaseElapsedMs = 0;
  ship.phaseProgress = 0;
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
      ship.phase = "jumpingHyperlane";
      const fromStarId = ship.route[ship.routeIndex];
      const toStarId = ship.route[ship.routeIndex + 1];
      ship.hyperlanePosition = { fromStarId, toStarId, progress: 0 };
    } else if (ship.phase === "jumpingHyperlane") {
      ship.currentStarId = ship.route[ship.routeIndex + 1];
      ship.routeIndex += 1;
      ship.hyperlanePosition = null;
      ship.phase = "arrivingSystem";
      ship.systemPosition = systemEntryPosition();
    } else if (ship.phase === "arrivingSystem") {
      if (ship.routeIndex < ship.route.length - 1) {
        ship.phase = "departingSystem";
        ship.systemPosition = systemCenterPosition();
      } else if (ship.orderType === "build") {
        ship.phase = "buildingStarbase";
        ship.systemPosition = systemCenterPosition();
      } else {
        completeShipOrder(ship);
      }
    } else if (ship.phase === "buildingStarbase") {
      completeShipOrder(ship);
    }
  }
}

function advanceState(now: number): void {
  const elapsedMs = Math.max(0, now - state.clock.lastUpdatedAt);
  if (elapsedMs <= 0) return;
  const scaledMs = elapsedMs * state.clock.speedMultiplier;
  state.clock.year += (scaledMs / 86_400_000) * GAME_YEARS_PER_REAL_DAY;
  state.clock.lastUpdatedAt = now;

  const movingBefore = state.ships.some((ship) => ship.phase !== "idle");
  for (const ship of state.ships) {
    advanceShip(ship, scaledMs);
  }
  const movingAfter = state.ships.some((ship) => ship.phase !== "idle");
  if (movingBefore || movingAfter) {
    hasDirtyState = true;
    refreshDiscovery();
  }
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
  if (command.type === "setSpeedMultiplier") {
    const allowed = new Set([1, 2, 3, 4, 5, 50, 100, 200, 500]);
    if (!allowed.has(command.multiplier)) return reject(session.socket, "Unsupported speed multiplier.");
    state.clock.speedMultiplier = command.multiplier;
    hasDirtyState = true;
    accept(session.socket, `Speed set to ${command.multiplier}x.`);
    broadcastSnapshots();
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
  sendEvent(socket, createSnapshot(session.perspective));

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
  advanceState(Date.now());
  broadcastSnapshots();
  if (hasDirtyState && Date.now() - lastSaveAt >= SAVE_INTERVAL_MS) {
    void saveState().catch((error) => console.error("[GameServer] Failed to save state", error));
  }
}, BROADCAST_INTERVAL_MS);

console.log(`[GameServer] Listening on ws://localhost:${PORT}`);
