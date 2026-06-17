import { WebSocket, WebSocketServer } from "ws";
import { authStore, parseSessionTokenFromCookie } from "../auth-store";
import type { StoredGame } from "../auth-store";
import { VERSION_MANIFEST } from "../versionManifest";
import {
  SERVER_TICK_INTERVAL_MS,
  RUNTIME_STATS_INTERVAL_MS,
  RUNTIME_CATALOG_SYNC_INTERVAL_MS,
} from "./constants";
import type { GameRuntime } from "./types";
import type { ServerEvent } from "../../src/game/GameProtocol";
import type { DevGameRuntimeStats } from "../../src/auth/types";

export async function initServer(
  createGameRuntime: (game: StoredGame) => Promise<GameRuntime>,
): Promise<void> {
  const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
  const GAME_SERVER_STARTED_AT = Date.now();
  const SF_VERSION_ID = VERSION_MANIFEST.versionId;

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
      // This process only hosts games assigned to its own code version and still
      // active — the isolation that lets old games stay on old code. A game whose
      // version/status changed away from us is dropped (another process owns it now).
      const games = authStore.listGames().filter(
        (game) => game.versionId === SF_VERSION_ID && game.status === "active",
      );
      const gameById = new Map(games.map((game) => [game.id, game]));
      await Promise.all(games.map((game) => ensureRuntime(game)));
      await Promise.all(Array.from(runtimes.entries()).map(async ([gameId, runtime]) => {
        if (gameById.has(gameId)) return;
        runtimes.delete(gameId);
        // Only truly-deleted games (gone from the catalog) lose their saved state.
        // Games that merely left this process (stopped/archived/reassigned to
        // another version) must keep their state and release ownership cleanly.
        const stillExists = authStore.getGameById(gameId) !== null;
        await runtime.dispose(
          stillExists ? "This game is no longer hosted here." : "This game was deleted.",
          !stillExists,
        );
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
    if (game.versionId !== SF_VERSION_ID || game.status !== "active") {
      // Another version's process owns this game (or it is stopped/archived).
      // The client should re-resolve its endpoint via the auth API.
      sendServerEvent(socket, { type: "serverInfo", message: "Game is hosted on a different version. Reconnect to refresh." });
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
}
