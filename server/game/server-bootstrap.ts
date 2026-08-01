import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { parseSessionTokenFromCookie } from "../auth-store";
import type { GameCatalogPort, StoredGame } from "../auth-store";
import { VERSION_MANIFEST } from "../versionManifest";
import {
  SERVER_TICK_INTERVAL_MS,
  RUNTIME_STATS_INTERVAL_MS,
  RUNTIME_CATALOG_SYNC_INTERVAL_MS,
} from "./constants";
import type { GameRuntime } from "./types";
import type { ServerEvent } from "../../src/game/GameProtocol";
import type {
  DevGameRuntimeRow,
  DevGameRuntimeStats,
  DevRuntimeFailure,
  DevVersionProcessHealth,
} from "../../src/auth/types";

function errorMessage(error: unknown): string {
  const base = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause
    ? (error.cause instanceof Error ? error.cause.message : String(error.cause))
    : "";
  return cause && !base.includes(cause) ? `${base} Cause: ${cause}` : base;
}

export async function initServer(
  createGameRuntime: (game: StoredGame) => Promise<GameRuntime>,
  authStore: GameCatalogPort,
): Promise<void> {
  const PORT = Number(process.env.GAME_SERVER_PORT ?? 8787);
  const GAME_SERVER_STARTED_AT = Date.now();
  const SF_VERSION_ID = VERSION_MANIFEST.versionId;
  const DEFAULT_WS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  const wsAllowedOrigins = new Set(
    (process.env.WS_ALLOWED_ORIGINS?.split(",") ?? DEFAULT_WS_ALLOWED_ORIGINS)
      .map((origin) => origin.trim())
      .filter(Boolean),
  );

  const runtimes = new Map<string, GameRuntime>();
  const runtimeLoads = new Map<string, Promise<GameRuntime>>();
  const runtimeFailures = new Map<string, DevRuntimeFailure>();
  const tickHealth = new Map<string, { lastMs: number; maxMs: number }>();
  let lastRuntimeStatsAt = 0;
  let lastRuntimeSyncAt = 0;
  let runtimeSyncing = false;
  let shuttingDown = false;
  let lastLoopDurationMs = 0;
  let maxLoopDurationMs = 0;

  function isWebSocketOriginAllowed(origin: string | undefined): boolean {
    // Browsers always supply Origin. Origin-less access is useful for local
    // diagnostics and must be explicitly enabled outside tests.
    if (!origin) return process.env.ALLOW_ORIGINLESS_WS === "true" || process.env.NODE_ENV === "test";
    return wsAllowedOrigins.has(origin);
  }

  function sendServerEvent(socket: WebSocket, event: ServerEvent): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(event));
  }

  async function ensureRuntime(game: StoredGame): Promise<GameRuntime> {
    const current = runtimes.get(game.id);
    if (current) return current;
    const loading = runtimeLoads.get(game.id);
    if (loading) return loading;
    const quarantined = runtimeFailures.get(game.id);
    if (quarantined) throw new Error(quarantined.message);
    if (shuttingDown) throw new Error("Version server is shutting down.");

    const load = createGameRuntime(game)
      .then((runtime) => {
        runtimes.set(game.id, runtime);
        runtimeFailures.delete(game.id);
        tickHealth.set(game.id, { lastMs: 0, maxMs: 0 });
        return runtime;
      })
      .catch((error) => {
        const failure: DevRuntimeFailure = {
          gameId: game.id,
          gameName: game.name,
          versionId: SF_VERSION_ID,
          message: errorMessage(error),
          failedAt: Date.now(),
        };
        runtimeFailures.set(game.id, failure);
        console.error(`[GameServer:${SF_VERSION_ID}] Quarantined game ${game.id}: ${failure.message}`);
        throw error;
      })
      .finally(() => {
        runtimeLoads.delete(game.id);
      });
    runtimeLoads.set(game.id, load);
    return load;
  }

  async function disposeRuntime(
    gameId: string,
    runtime: GameRuntime,
    message: string,
    deleteState: boolean,
    saveBeforeRelease = true,
  ): Promise<void> {
    runtimes.delete(gameId);
    tickHealth.delete(gameId);
    try {
      await runtime.dispose(message, deleteState, saveBeforeRelease);
    } catch (error) {
      console.error(`[GameServer:${SF_VERSION_ID}] Failed to dispose game ${gameId}`, error);
      if (saveBeforeRelease) throw error;
    }
  }

  async function syncGameRuntimes(): Promise<void> {
    if (runtimeSyncing || shuttingDown) return;
    runtimeSyncing = true;
    try {
      const games = authStore.listGames().filter(
        (game) => game.versionId === SF_VERSION_ID && game.status === "active",
      );
      const gameById = new Map(games.map((game) => [game.id, game]));

      // Every active game must continue simulating while nobody is connected,
      // but one bad save must not prevent healthy sibling games from loading.
      await Promise.allSettled(games.map((game) => ensureRuntime(game)));

      await Promise.allSettled(Array.from(runtimes.entries()).map(async ([gameId, runtime]) => {
        if (gameById.has(gameId)) return;
        const stillExists = authStore.getGameById(gameId) !== null;
        await disposeRuntime(
          gameId,
          runtime,
          stillExists ? "This game is no longer hosted here." : "This game was deleted.",
          !stillExists,
        );
      }));

      for (const failedGameId of runtimeFailures.keys()) {
        if (!gameById.has(failedGameId)) runtimeFailures.delete(failedGameId);
      }
    } finally {
      lastRuntimeSyncAt = Date.now();
      runtimeSyncing = false;
    }
  }

  function processHealth(): DevVersionProcessHealth {
    return {
      versionId: SF_VERSION_ID,
      pid: process.pid,
      startedAt: GAME_SERVER_STARTED_AT,
      lastHeartbeatAt: Date.now(),
      loadedGames: runtimes.size,
      loadingGames: runtimeLoads.size,
      failedGames: runtimeFailures.size,
      lastLoopDurationMs,
      maxLoopDurationMs,
    };
  }

  function buildRuntimeStats(): DevGameRuntimeStats {
    const games = Array.from(runtimes.values()).map((runtime) => {
      const stats = runtime.getStats();
      const timing = tickHealth.get(runtime.game.id);
      return {
        ...stats,
        versionId: SF_VERSION_ID,
        health: "healthy" as const,
        lastTickDurationMs: timing?.lastMs ?? 0,
        maxTickDurationMs: timing?.maxMs ?? 0,
      };
    });
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
      gameCount: games.length + runtimeFailures.size,
      games,
      processes: [processHealth()],
      failures: Array.from(runtimeFailures.values()),
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

  async function handleConnection(
    socket: WebSocket,
    request: Parameters<NonNullable<Parameters<WebSocketServer["on"]>[1]>>[1],
  ): Promise<void> {
    if (shuttingDown) {
      socket.close(1012, "Version server is restarting.");
      return;
    }
    const origin = request.headers.origin;
    if (!isWebSocketOriginAllowed(origin)) {
      console.warn(`[GameServer] Rejected WebSocket connection from disallowed origin: ${origin ?? "(none)"}`);
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
      sendServerEvent(socket, { type: "serverInfo", message: "Game is hosted elsewhere or unavailable. Reconnect to refresh." });
      socket.close();
      return;
    }
    if (!perspective) {
      sendServerEvent(socket, { type: "serverInfo", message: "Join this game before entering it." });
      socket.close();
      return;
    }
    const failure = runtimeFailures.get(game.id);
    if (failure) {
      sendServerEvent(socket, { type: "serverInfo", message: `Game quarantined: ${failure.message}` });
      socket.close(1011, "Game runtime failed.");
      return;
    }

    const runtime = await ensureRuntime(game);
    runtime.attachClient(socket, account, perspective);
    publishRuntimeStats(true);
  }

  const httpServer = createServer((request, response) => {
    if (request.url === "/health" || request.url === "/ready") {
      const body = JSON.stringify({
        ok: !shuttingDown,
        ready: !shuttingDown,
        ...processHealth(),
        failures: Array.from(runtimeFailures.values()),
      });
      response.writeHead(shuttingDown ? 503 : 200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(body);
      return;
    }
    response.writeHead(404).end();
  });
  const wss = new WebSocketServer({
    server: httpServer,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
  });
  wss.on("connection", (socket, request) => {
    void handleConnection(socket, request).catch((error) => {
      console.error("[GameServer] Failed to accept connection", error);
      sendServerEvent(socket, { type: "serverInfo", message: "Could not enter game." });
      socket.close();
    });
  });

  const tickTimer = setInterval(() => {
    const loopStartedAt = performance.now();
    const now = Date.now();
    for (const [gameId, runtime] of Array.from(runtimes.entries())) {
      const tickStartedAt = performance.now();
      try {
        runtime.tick(now);
        const elapsed = performance.now() - tickStartedAt;
        const previous = tickHealth.get(gameId) ?? { lastMs: 0, maxMs: 0 };
        tickHealth.set(gameId, { lastMs: elapsed, maxMs: Math.max(previous.maxMs, elapsed) });
      } catch (error) {
        const failure: DevRuntimeFailure = {
          gameId,
          gameName: runtime.game.name,
          versionId: SF_VERSION_ID,
          message: `Simulation tick failed: ${errorMessage(error)}`,
          failedAt: Date.now(),
        };
        runtimeFailures.set(gameId, failure);
        console.error(`[GameServer:${SF_VERSION_ID}] ${failure.message}`);
        void disposeRuntime(gameId, runtime, failure.message, false, false)
          .catch((disposeError) => console.error(`[GameServer] Failed to release quarantined game ${gameId}`, disposeError))
          .finally(() => publishRuntimeStats(true));
      }
    }
    lastLoopDurationMs = performance.now() - loopStartedAt;
    maxLoopDurationMs = Math.max(maxLoopDurationMs, lastLoopDurationMs);
    publishRuntimeStats();
    if (now - lastRuntimeSyncAt >= RUNTIME_CATALOG_SYNC_INTERVAL_MS) {
      void syncGameRuntimes().then(() => publishRuntimeStats(true))
        .catch((error) => console.error("[GameServer] Failed to sync game runtimes", error));
    }
  }, SERVER_TICK_INTERVAL_MS);

  let shutdownPromise: Promise<void> | null = null;
  function shutdown(signal: string): Promise<void> {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      shuttingDown = true;
      clearInterval(tickTimer);
      console.log(`[GameServer:${SF_VERSION_ID}] ${signal}: draining ${runtimes.size} game runtime(s).`);
      for (const socket of wss.clients) socket.close(1012, "Version server restarting.");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      const results = await Promise.allSettled(
        Array.from(runtimes.entries()).map(([gameId, runtime]) =>
          disposeRuntime(gameId, runtime, "Version server stopped.", false, true)),
      );
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length > 0) {
        authStore.close();
        throw new Error(`${failed.length} game runtime(s) failed to save during shutdown.`);
      }
      try {
        await new Promise<void>((resolve, reject) => {
          httpServer.close((error) => error ? reject(error) : resolve());
        });
        publishRuntimeStats(true);
      } finally {
        authStore.close();
      }
    })();
    return shutdownPromise;
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void shutdown(signal)
        .then(() => process.exit(0))
        .catch((error) => {
          console.error(`[GameServer:${SF_VERSION_ID}] Graceful shutdown failed`, error);
          process.exit(1);
        });
    });
  }

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`[GameServer] Listening on ws://127.0.0.1:${PORT}`);
  });
}
