import type {
  AdminCommandContext,
  AdminCommandResult,
} from "./AdminCommands";
import type {
  ClientCommand,
  GameDetailEvent,
  GameDetailPayload,
  GameDetailScope,
  GameSnapshot,
  PlanetDetailPayload,
  PlanetDetailsEvent,
  ServerEvent,
  ServerUpdateField,
  SystemDetailPayload,
  SystemDetailsEvent,
} from "./GameProtocol";
import { mergeClientIntelEntities, setClientIntelligence } from "./ClientIntelligence";
import {
  decodeServerEvent,
  ProtocolValidationError,
  reduceSnapshot,
} from "./ProtocolAdapter";

type SnapshotHandler = (snapshot: GameSnapshot, changed?: ServerUpdateField[]) => void;
type MessageHandler = (message: string, ok: boolean) => void;
type AccountResourcesHandler = (darkMatter: number) => void;
type PlanetDetailsHandler = (event: PlanetDetailsEvent) => void;
type DetailHandler<T extends GameDetailPayload = GameDetailPayload> = (event: GameDetailEvent & { payload?: T }) => void;
type AdminCommandHandler = (event: AdminCommandResult) => void;
type PendingRequest<T> = {
  resolve: (event: T) => void;
  reject: (error: Error) => void;
};

interface CachedDetail {
  event: GameDetailEvent;
  payload?: GameDetailPayload;
}

function withClientClockSync<T extends { clock?: GameSnapshot["clock"] }>(event: T): T {
  if (!event.clock) return event;
  return {
    ...event,
    clock: {
      ...event.clock,
      syncedAtMs: Date.now(),
    },
  };
}

/**
 * Server protocol versions THIS client build supports. Client builds are not
 * versioned by the orchestrator — instead each build declares which server
 * protocols it can talk to. Extend this list when you make a new client
 * backwards-compatible with older servers (your call, per build). If a game's
 * server reports a protocol not listed here, the client refuses to connect with
 * a clear message rather than misbehaving.
 */
export class ClientServerVersionError extends Error {}

function getWebSocketUrl(gameId?: string): string {
  // Support VITE_WS_URL env var for production (set at build time by Vite)
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) {
    return appendGameId(import.meta.env.VITE_WS_URL, gameId);
  }
  return appendGameId('ws://localhost:8787', gameId);
}

function appendGameId(baseUrl: string, gameId?: string): string {
  if (!gameId) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("gameId", gameId);
  return url.toString();
}

function createDetailKey(scope: GameDetailScope, id?: string | number | null): string {
  return `${scope}:${id ?? ""}`;
}

export class GameServerClient {
  private socket: WebSocket | null = null;
  private latestSnapshot: GameSnapshot | null = null;
  private snapshotHandlers = new Set<SnapshotHandler>();
  private messageHandlers = new Set<MessageHandler>();
  private accountResourcesHandlers = new Set<AccountResourcesHandler>();
  private planetDetailsHandlers = new Set<PlanetDetailsHandler>();
  private detailHandlers = new Map<string, Set<DetailHandler>>();
  private adminCommandHandlers = new Set<AdminCommandHandler>();
  private detailRequests = new Map<string, PendingRequest<GameDetailEvent>>();
  private detailCache = new Map<string, CachedDetail>();
  private adminCommandRequests = new Map<string, PendingRequest<AdminCommandResult>>();

  constructor(private readonly gameId?: string, private readonly urlOverride?: string) {}

  async connect(): Promise<GameSnapshot> {
    if (this.latestSnapshot) return this.latestSnapshot;

    // Clients always connect to the single public game endpoint; the orchestrator
    // gateway (or the bare dev server) routes to the correct version process by
    // gameId. Compatibility with that game's server version is enforced when the
    // first snapshot arrives (see SUPPORTED_SERVER_PROTOCOL_VERSIONS below).
    const url = this.urlOverride ?? getWebSocketUrl(this.gameId);
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let resolved = false;
      let negotiatedProtocol: number | undefined;

      socket.addEventListener("open", () => {
        this.send({ type: "join" });
      });

      socket.addEventListener("message", (event) => {
        let parsed: ServerEvent;
        try {
          const decoded: unknown = JSON.parse(String(event.data));
          parsed = decodeServerEvent(decoded, negotiatedProtocol);
        } catch (error) {
          const protocolError = error instanceof ProtocolValidationError
            ? new ClientServerVersionError(error.message)
            : new Error("Game server sent an invalid message.");
          socket.close(1002, "Invalid server protocol");
          if (!resolved) {
            resolved = true;
            reject(protocolError);
          } else {
            console.error("[GameClient] Rejected server message", error);
          }
          return;
        }
        if (parsed.type === "snapshot") {
          negotiatedProtocol = parsed.protocolVersion;
          this.latestSnapshot = withClientClockSync(parsed);
          setClientIntelligence(this.latestSnapshot.intelligence, this.latestSnapshot.clock.year);
          for (const handler of this.snapshotHandlers) handler(this.latestSnapshot);
          if (!resolved) {
            resolved = true;
            resolve(this.latestSnapshot);
          }
          return;
        }

        if (parsed.type === "update") {
          if (!this.latestSnapshot) return;
          const update = withClientClockSync(parsed);
          this.latestSnapshot = reduceSnapshot(this.latestSnapshot, update);
          setClientIntelligence(this.latestSnapshot.intelligence, this.latestSnapshot.clock.year);
          for (const handler of this.snapshotHandlers) handler(this.latestSnapshot, parsed.changed);
          return;
        }

        if (parsed.type === "planetDetails") {
          for (const handler of this.planetDetailsHandlers) handler(parsed);
          return;
        }

        if (parsed.type === "detail") {
          const key = createDetailKey(parsed.scope, parsed.id);
          const cached = this.detailCache.get(key);
          const event: GameDetailEvent = parsed.status === "notModified" && cached
            ? { ...parsed, payload: cached.payload }
            : parsed;
          const detailIntel = event.payload && "intelligence" in event.payload
            ? event.payload.intelligence
            : undefined;
          if (Array.isArray(detailIntel)) mergeClientIntelEntities(detailIntel);
          if (event.status === "full" && event.payload) {
            this.detailCache.set(key, { event, payload: event.payload });
          } else if (event.status === "notModified" && cached) {
            this.detailCache.set(key, { event, payload: cached.payload });
          } else if (event.status === "unavailable") {
            this.detailCache.delete(key);
          }

          const pending = this.detailRequests.get(key);
          if (pending) {
            this.detailRequests.delete(key);
            pending.resolve(event);
          }
          for (const handler of this.detailHandlers.get(key) ?? []) handler(event);
          return;
        }

        if (parsed.type === "commandResult") {
          for (const handler of this.messageHandlers) handler(parsed.message, parsed.ok);
          if (!parsed.ok) {
            this.rejectOldestPendingRequest(new Error(parsed.message));
          }
          return;
        }

        if (parsed.type === "accountResources") {
          for (const handler of this.accountResourcesHandlers) handler(parsed.darkMatter);
          return;
        }

        if (parsed.type === "adminCommandResult") {
          if (parsed.requestId) {
            const pending = this.adminCommandRequests.get(parsed.requestId);
            if (pending) {
              this.adminCommandRequests.delete(parsed.requestId);
              pending.resolve(parsed);
            }
          }
          for (const handler of this.adminCommandHandlers) handler(parsed);
        }
      });

      socket.addEventListener("error", () => {
        if (!resolved) reject(new Error(`Could not connect to game server at ${url}`));
      });

      socket.addEventListener("close", () => {
        if (!resolved) reject(new Error("Game server connection closed before snapshot arrived"));
      });
    });
  }

  onSnapshot(handler: SnapshotHandler): () => void {
    this.snapshotHandlers.add(handler);
    if (this.latestSnapshot) handler(this.latestSnapshot);
    return () => this.snapshotHandlers.delete(handler);
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onAccountResources(handler: AccountResourcesHandler): () => void {
    this.accountResourcesHandlers.add(handler);
    return () => this.accountResourcesHandlers.delete(handler);
  }

  onPlanetDetails(handler: PlanetDetailsHandler): () => void {
    this.planetDetailsHandlers.add(handler);
    return () => this.planetDetailsHandlers.delete(handler);
  }

  onAdminCommand(handler: AdminCommandHandler): () => void {
    this.adminCommandHandlers.add(handler);
    return () => this.adminCommandHandlers.delete(handler);
  }

  send(command: ClientCommand): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(command));
  }

  requestSystemDetails(starId: number): Promise<SystemDetailsEvent> {
    const cached = this.getCachedDetail<SystemDetailPayload>("system", starId);
    return this.requestDetail<SystemDetailPayload>("system", starId).then((event) => {
      const payload = event.payload ?? cached;
      if (!payload || !("star" in payload)) throw new Error("System details are unavailable.");
      return { type: "systemDetails", star: payload.star, planetStates: payload.planetStates };
    });
  }

  requestPlanetDetails(planetId: string): Promise<PlanetDetailsEvent> {
    const cached = this.getCachedDetail<PlanetDetailPayload>("planet", planetId);
    return this.requestDetail<PlanetDetailPayload>("planet", planetId).then((event) => {
      const payload = event.payload ?? cached;
      if (!payload || !("planetState" in payload)) throw new Error("Planet details are unavailable.");
      return {
        type: "planetDetails",
        starId: payload.starId,
        planet: payload.planet,
        planetState: payload.planetState,
      };
    });
  }

  requestDetail<T extends GameDetailPayload>(
    scope: GameDetailScope,
    id?: string | number | null,
  ): Promise<GameDetailEvent & { payload?: T }> {
    const key = createDetailKey(scope, id);
    const cached = this.detailCache.get(key);
    return this.requestDetails(this.detailRequests, key, {
      type: "requestDetails",
      scope,
      id,
      knownRevision: cached?.event.revision ?? null,
    }).then((event) => {
      if (event.status === "unavailable") {
        throw new Error(event.message ?? "Information does not exist.");
      }
      return event as GameDetailEvent & { payload?: T };
    });
  }

  subscribeDetail<T extends GameDetailPayload>(
    scope: GameDetailScope,
    id: string | number | null | undefined,
    handler: DetailHandler<T>,
    options: { emitCached?: boolean } = {},
  ): () => void {
    const normalizedId = id ?? null;
    const key = createDetailKey(scope, normalizedId);
    const handlers = this.detailHandlers.get(key) ?? new Set<DetailHandler>();
    handlers.add(handler as DetailHandler);
    this.detailHandlers.set(key, handlers);

    const cached = this.detailCache.get(key);
    if (cached && options.emitCached !== false) {
      window.setTimeout(() => handler(cached.event as GameDetailEvent & { payload?: T }), 0);
    }
    this.send({
      type: "subscribeDetails",
      scope,
      id: normalizedId,
      knownRevision: cached?.event.revision ?? null,
    });

    return () => {
      const current = this.detailHandlers.get(key);
      current?.delete(handler as DetailHandler);
      if (current && current.size === 0) {
        this.detailHandlers.delete(key);
        this.send({ type: "unsubscribeDetails", scope, id: normalizedId });
      }
    };
  }

  getCachedDetail<T extends GameDetailPayload>(scope: GameDetailScope, id?: string | number | null): T | null {
    return (this.detailCache.get(createDetailKey(scope, id))?.payload as T | undefined) ?? null;
  }

  getSnapshot(): GameSnapshot | null {
    return this.latestSnapshot;
  }

  executeAdminCommand(input: string, context?: AdminCommandContext): Promise<AdminCommandResult> {
    const requestId = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    return this.requestDetails(this.adminCommandRequests, requestId, {
      type: "adminCommand",
      input,
      context,
      requestId,
    });
  }

  dispose(): void {
    this.snapshotHandlers.clear();
    this.messageHandlers.clear();
    this.accountResourcesHandlers.clear();
    this.planetDetailsHandlers.clear();
    this.detailHandlers.clear();
    this.adminCommandHandlers.clear();
    this.rejectAllPendingRequests(new Error("Game server client disposed."));
    this.socket?.close();
    this.socket = null;
  }

  private requestDetails<K, T>(
    requests: Map<K, PendingRequest<T>>,
    key: K,
    command: ClientCommand,
  ): Promise<T> {
    if (requests.has(key)) {
      return new Promise((resolve, reject) => {
        const previous = requests.get(key)!;
        requests.set(key, {
          resolve: (event) => {
            previous.resolve(event);
            resolve(event);
          },
          reject: (error) => {
            previous.reject(error);
            reject(error);
          },
        });
      });
    }

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        requests.delete(key);
        reject(new Error("Timed out waiting for server details."));
      }, 8_000);
      requests.set(key, {
        resolve: (event) => {
          window.clearTimeout(timeout);
          resolve(event);
        },
        reject: (error) => {
          window.clearTimeout(timeout);
          reject(error);
        },
      });
      this.send(command);
    });
  }

  private rejectOldestPendingRequest(error: Error): void {
    const adminEntry = this.adminCommandRequests.entries().next();
    if (!adminEntry.done) {
      this.adminCommandRequests.delete(adminEntry.value[0]);
      adminEntry.value[1].reject(error);
      return;
    }
    const detailEntry = this.detailRequests.entries().next();
    if (!detailEntry.done) {
      this.detailRequests.delete(detailEntry.value[0]);
      detailEntry.value[1].reject(error);
    }
  }

  private rejectAllPendingRequests(error: Error): void {
    for (const [, pending] of this.detailRequests) pending.reject(error);
    for (const [, pending] of this.adminCommandRequests) pending.reject(error);
    this.detailRequests.clear();
    this.adminCommandRequests.clear();
  }
}
